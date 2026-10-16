import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { RequestContext } from '@watchdog-bms/contracts';
import { Prisma, type PrismaClient, type TaxPeriod } from '../../../../generated/prisma/client';
import type { AttachmentStoragePort, PutObjectResult } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { buildWorkbook, XLSX_MIME_TYPE } from '../../../../common/export/xlsx.logic';
import { renderPnd53OfficialForm, type Pnd53Filing, type Pnd53FilingLine } from '../../domain/logic/pnd53-official-form.logic';
import { renderPnd3OfficialForm } from '../../domain/logic/pnd3-official-form.logic';
import type { TaxExportArtifact } from '../../domain/logic/tax-export.logic';
import { isPeriodLocked } from '../../domain/logic/tax-period.logic';
import { currentWithholdingPayments, orderWithholdingPayments, withholdingPaymentChecksum, withholdingPaymentFacts } from './withholding-filing-state';
import { validateWithholdingFiling } from './withholding-filing-validation';
import { withholdingAccountantExport } from './withholding-accountant-export';
import { assertEstablishmentScope } from './withholding-establishments';

type FrozenPaper = { id: string; companyId: string; taxPeriodId: string; formType: string; periodKey: string; establishmentCode: string; establishmentBranchId: string | null;
  sequence: number; preparedBy: string; payerSnapshotJson: unknown; lines: { rowNumber: number; lineJson: unknown }[] };
const uncertainMessage = 'รายการของแบบที่ยื่นไว้ตรวจได้ไม่ครบ ให้ผู้ทำบัญชีเทียบกับแบบที่ยื่นจริง';
export function uncertainWithholdingPaper() { return new ConflictException({ code: 'WHT_FILING_ROWS_UNCERTAIN', message: uncertainMessage }); }

/** Restoration/confirmation renders the frozen rows, never today's sources or establishment mode. */
export async function renderFrozenWithholdingPaper(paper: FrozenPaper): Promise<TaxExportArtifact> {
  const rows = [...paper.lines].sort((a, b) => a.rowNumber - b.rowNumber).map(l => l.lineJson as Pnd53FilingLine & { cells?: (string | number)[] });
  let bytes: Buffer;
  if (paper.preparedBy === 'ACCOUNTANT') {
    bytes = buildWorkbook([{ name: paper.formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53', freezeRows: 1, rows: [
      ['วันที่จ่าย', 'ผู้รับเงิน', 'เลขผู้เสียภาษี', 'สาขา', 'ที่อยู่', 'ประเภทเงินได้', 'อัตรา', 'ยอดจ่าย', 'ภาษีที่หักไว้', 'เลขที่หนังสือรับรอง 50 ทวิ'],
      ...rows.map(r => r.cells ?? []),
      ['รวม', '', '', '', '', '', '', Number(rows.reduce((n, r) => n.plus(r.cells?.[7] ?? 0), new Prisma.Decimal(0)).toFixed(2)), Number(rows.reduce((n, r) => n.plus(r.cells?.[8] ?? 0), new Prisma.Decimal(0)).toFixed(2))],
    ] }]);
  } else {
    const filing = { ...(paper.payerSnapshotJson as Pnd53Filing), sequence: paper.sequence, lines: rows.map(r => ({ ...r, paidAt: new Date(r.paidAt) })) };
    bytes = await (paper.formType === 'PND3' ? renderPnd3OfficialForm : renderPnd53OfficialForm)(filing);
  }
  const workbook = paper.preparedBy === 'ACCOUNTANT';
  return { fileName: `${workbook ? 'รายการให้ผู้ทำบัญชี-' : ''}${paper.formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}-${paper.periodKey}-${paper.establishmentCode}${paper.sequence ? `-เพิ่มเติมครั้งที่-${paper.sequence}` : ''}.${workbook ? 'xlsx' : 'pdf'}`,
    mimeType: workbook ? XLSX_MIME_TYPE : 'application/pdf', contentBase64: bytes.toString('base64'), byteLength: bytes.length, checksum: createHash('sha256').update(bytes).digest('hex') };
}
async function storeFrozenPackage(tx: Prisma.TransactionClient, storage: AttachmentStoragePort, paper: FrozenPaper, actor: string | null,
  render: typeof renderFrozenWithholdingPaper, storedObjects: PutObjectResult[]) {
  const artifact = await render(paper);
  const stored = await storage.putObject({ objectKey: `${paper.companyId}/tax-filings/${randomUUID()}`, mimeType: artifact.mimeType, bytes: Buffer.from(artifact.contentBase64, 'base64') });
  storedObjects.push(stored);
  const attachment = await tx.attachmentObject.create({ data: { companyId: paper.companyId, branchId: paper.establishmentBranchId,
    ...stored, originalFileName: artifact.fileName, mimeType: artifact.mimeType, status: 'ACTIVE', uploadedByUserId: actor ?? 'system:wht-filing-backfill', uploadedAt: new Date() } });
  const pkg = await tx.taxFilingPackage.create({ data: { companyId: paper.companyId, taxPeriodId: paper.taxPeriodId, whtFilingId: paper.id,
    formType: paper.formType as 'PND3' | 'PND53', periodKey: paper.periodKey, exportNumber: `RESTORED-${paper.id}`, exportFormat: paper.preparedBy === 'ACCOUNTANT' ? 'XLSX' : 'PDF',
    attachmentId: attachment.id, checksum: artifact.checksum, generatedByUserId: actor } });
  await tx.attachmentLink.create({ data: { companyId: paper.companyId, attachmentId: attachment.id, targetType: 'tax.filing_package', targetId: pkg.id, purpose: 'tax.filing_export', linkedByUserId: actor ?? 'system:wht-filing-backfill' } });
  return pkg.id;
}
/** Period lock + no-paper fence makes this one-off release operation idempotent. No existing paper is touched. */
export async function restoreLegacyWithholdingPeriod(db: PrismaClient, storage: AttachmentStoragePort, candidate: Pick<TaxPeriod, 'id' | 'companyId'>,
  render = renderFrozenWithholdingPaper): Promise<'exact' | 'uncertain' | 'skipped'> {
  const stored: PutObjectResult[] = [];
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "TaxPeriod" WHERE id = ${candidate.id} AND "companyId" = ${candidate.companyId} FOR UPDATE`;
      const period = await tx.taxPeriod.findFirst({ where: { id: candidate.id, companyId: candidate.companyId } });
      if (!period || !['PND3', 'PND53'].includes(period.formType) || !['EXPORTED', 'FILED', 'PAID', 'CLOSED'].includes(period.status)
        || await tx.whtFiling.findFirst({ where: { companyId: period.companyId, taxPeriodId: period.id } })) return 'skipped';
      const pkg = await tx.taxFilingPackage.findFirst({ where: { companyId: period.companyId, taxPeriodId: period.id, status: { not: 'VOIDED' }, exportFormat: { in: ['PDF', 'XLSX'] } }, orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }] });
      const snapshot = pkg ? await tx.taxReportSnapshot.findFirst({ where: { companyId: period.companyId, taxPeriodId: period.id, reportJson: { path: ['filingPackageId'], equals: pkg.id } }, orderBy: { snapshotAt: 'desc' } }) : null;
      const events = orderWithholdingPayments((await currentWithholdingPayments(tx, period.companyId, await tx.taxEvent.findMany({ where: { companyId: period.companyId, taxPeriodId: period.id, status: 'ACTIVE' } })))
        .map(e => ({ ...e, payeeSnapshot: e.payeeSnapshotJson as import('@watchdog-bms/contracts').PayeeSnapshot | null, grossAmount: e.grossAmount?.toString() ?? null, withheldAmount: e.withheldAmount?.toString() ?? null, whtRate: e.whtRate?.toString() ?? null })), period.formType);
      // Historical branch rule, not the current payer-mode fact; sequence=1 skips only today's overdue check.
      const validation = await validateWithholdingFiling(tx, period.companyId, period.formType as 'PND3' | 'PND53', period, events, [], undefined, 1, true);
      const rowsChecksum = withholdingPaymentChecksum(events);
      const exact = snapshot?.checksum === rowsChecksum;
      const workbook = pkg?.exportFormat === 'XLSX' ? await withholdingAccountantExport(tx, period.companyId, period.formType, period.periodKey, events) : null;
      const lines = workbook?.filingLines ?? events.map((e, i) => ({ taxEventId: e.id, sourceType: e.sourceType, sourceId: e.sourceId,
        lineJson: { ...validation.candidateFiling!.lines[i], payment: withholdingPaymentFacts(e) } }));
      const paper = await tx.whtFiling.create({ data: { companyId: period.companyId, taxPeriodId: period.id, formType: period.formType,
        periodKey: period.periodKey, establishmentCode: validation.payer.payerBranch, establishmentBranchId: validation.establishmentBranchId, sequence: 0,
        status: isPeriodLocked(period.status) ? 'FILED' : 'EXPORTED', filedAt: period.filedAt, filedNote: period.reviewNote,
        preparedBy: workbook ? 'ACCOUNTANT' : 'SYSTEM', payerSnapshotJson: JSON.parse(JSON.stringify(validation.payer)),
        rowsChecksum, rowsCertain: exact, downloadedAt: pkg?.downloadedAt ?? pkg?.generatedAt ?? null,
        lines: { create: lines.map((l, i) => ({ ...l, rowNumber: i + 1, lineJson: JSON.parse(JSON.stringify(l.lineJson)) })) },
      }, include: { lines: true } });
      if (exact) {
        const filingPackageId = await storeFrozenPackage(tx, storage, paper, pkg?.generatedByUserId ?? null, render, stored);
        await tx.whtFiling.updateMany({ where: { id: paper.id, companyId: paper.companyId, filingPackageId: null }, data: { filingPackageId } });
      }
      return exact ? 'exact' : 'uncertain';
    }, { isolationLevel: 'Serializable', timeout: 120_000 });
  } catch (error) { await Promise.all(stored.map(s => storage.deleteObject(s).catch(() => undefined))); throw error; }
}
/** The sole exception to a filed paper's immutable metadata: false -> true once, with audit; lines never change. */
export async function confirmWithholdingRows(db: PrismaClient, storage: AttachmentStoragePort, ctx: RequestContext, filingId: string,
  render = renderFrozenWithholdingPaper) {
  if (!ctx.permissions.includes('wht.pnd53.prepare')) throw new ForbiddenException({ code: 'WHT_FILING_CONFIRM_FORBIDDEN', message: 'ไม่มีสิทธิ์ยืนยันรายการของแบบ ให้ผู้ที่มีสิทธิ์จัดทำแบบภาษีตรวจและยืนยัน' });
  const stored: PutObjectResult[] = [];
  try {
    return await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "WhtFiling" WHERE id = ${filingId} AND "companyId" = ${ctx.companyId} FOR UPDATE`;
      const paper = await tx.whtFiling.findFirst({ where: { id: filingId, companyId: ctx.companyId }, include: { lines: { orderBy: { rowNumber: 'asc' } } } });
      if (!paper) throw new NotFoundException('ไม่พบแบบนี้ เปิดข้อมูลเดือนนี้ใหม่');
      assertEstablishmentScope(ctx, paper.establishmentBranchId);
      if (paper.rowsCertain) return { confirmed: true };
      const period = await tx.taxPeriod.findFirst({ where: { companyId: ctx.companyId, id: paper.taxPeriodId } });
      const legacyFiled = period && isPeriodLocked(period.status);
      const confirmation = { userId: ctx.userId, at: new Date().toISOString() };
      const filingPackageId = await storeFrozenPackage(tx, storage, paper, ctx.userId, render, stored);
      const changed = await tx.whtFiling.updateMany({ where: { id: paper.id, companyId: ctx.companyId, rowsCertain: false },
        data: { rowsCertain: true, filingPackageId, ...(legacyFiled && paper.status !== 'FILED' ? { status: 'FILED' as const, filedAt: period.filedAt } : {}), payerSnapshotJson: { ...(paper.payerSnapshotJson as Prisma.JsonObject), rowsConfirmation: confirmation } } });
      if (changed.count !== 1) throw uncertainWithholdingPaper();
      await tx.auditLog.create({ data: { companyId: ctx.companyId, actorUserId: ctx.userId, action: 'tax.wht_filing.confirm_rows', targetType: 'wht_filing', targetId: paper.id,
        requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { ...confirmation, rowsChecksum: paper.rowsChecksum, filingPackageId } } });
      return { confirmed: true };
    }, { isolationLevel: 'Serializable', timeout: 120_000 });
  } catch (error) { await Promise.all(stored.map(s => storage.deleteObject(s).catch(() => undefined))); throw error; }
}
