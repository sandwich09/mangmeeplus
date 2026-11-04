import { isSerializationFailure } from '../../../../common/database/prisma-error';
import { confirmWithholdingRows, uncertainWithholdingPaper } from '../services/legacy-withholding-filing';
import { cancelledWithholdingRows, cancelledPayeeNames, cancelledPayeesNote } from '../services/withholding-filing-history';
import { loadWithholdingEstablishments, partitionWithholdingPayments, selectWithholdingPaper, assertEstablishmentScope } from '../services/withholding-establishments';
import { ATTACHMENT_STORAGE, type AttachmentStoragePort } from '../../../data-model-core/domain/ports/attachment-storage.port';
import { withholdingAccountantExport } from '../services/withholding-accountant-export';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../audit/application/audit.service';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import type { RequestContext, TaxExportFormat } from '@watchdog-bms/contracts';
import * as crypto from 'node:crypto';
import { buildTaxExportArtifact } from '../../domain/logic/tax-export.logic';
import { renderPnd53OfficialForm } from '../../domain/logic/pnd53-official-form.logic';
import { renderPnd3OfficialForm } from '../../domain/logic/pnd3-official-form.logic';
import { isPeriodLocked } from '../../domain/logic/tax-period.logic';
import { PrismaTaxRepository } from '../../infrastructure/repositories/prisma-tax.repository';

import { validateWithholdingFiling, withholdingPaperBlockers } from '../services/withholding-filing-validation';

import { assertOpenWithholdingSequence, withholdingPaperPayments, currentWithholdingPayments, withholdingPaymentChecksum, withholdingPaymentFacts, orderWithholdingPayments } from '../services/withholding-filing-state';

const paperFileName = (name: string, code: string) => name.replace(/(?:-\d{5})?(\.(?:pdf|xlsx))$/, `-${code}$1`);
const EXPORT_FORMATS = new Set(['REVIEW_JSON', 'CSV', 'XLSX', 'PDF']);
@Injectable()
export class GenerateTaxFilingPackageUseCase {
  constructor(
    private readonly taxRepo: PrismaTaxRepository,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
    private readonly audit: AuditService,
    @Inject(ATTACHMENT_STORAGE) private readonly storage: AttachmentStoragePort,
  ) {}

  async confirmRows(ctx: RequestContext, filingId: string) {
    return confirmWithholdingRows(this.taxRepo.prisma.client, this.storage, ctx, filingId);
  }

  async execute(ctx: RequestContext, periodId: string, exportFormat: TaxExportFormat, establishmentCode?: string, sequence = 0) {
    if (!EXPORT_FORMATS.has(exportFormat)) throw new BadRequestException('Unsupported tax export format.');
    const period = await this.taxRepo.findPeriodById(ctx.companyId, periodId);
    if (!period) throw new NotFoundException('Tax period not found.');
    if (period.formType === 'PND2') throw new ConflictException({ code: 'WHT_PND2_SEPARATE', message: 'ประเภทนี้ต้องยื่น ภ.ง.ด.2 แยก ให้ผู้ทำบัญชีจัดทำแบบให้' });

    const freezesPaper = ['PND3', 'PND53'].includes(period.formType) && ['PDF', 'XLSX'].includes(exportFormat);
    const db = this.taxRepo.prisma.client;
    const context = freezesPaper ? await loadWithholdingEstablishments(db, ctx.companyId, period.periodKey) : null;
    const existingPapers = freezesPaper ? await db.whtFiling.findMany({ where: { companyId: ctx.companyId, taxPeriodId: period.id }, include: { lines: true } }) : [];
    const allEvents = await this.taxRepo.findEventsByPeriod(ctx.companyId, period.id, 'ACTIVE');
    const activeEvents = freezesPaper ? await currentWithholdingPayments(db, ctx.companyId, allEvents) : allEvents;
    const projection = context ? await withholdingPaperBlockers(db, ctx, period, undefined, activeEvents) : null;
    const partition = projection?.partition ?? null;
    if (freezesPaper) {
      const codes = [...new Set([...existingPapers.map(p => p.establishmentCode), ...partition!.papers.map(p => p.establishment.code)])];
      if (!establishmentCode && codes.length > 1) throw new ConflictException({ code: 'WHT_ESTABLISHMENT_REQUIRED', message: 'เดือนนี้มีหลายสาขาที่ยื่น เลือกสาขาก่อนดาวน์โหลดหรือบันทึกว่ายื่นแล้ว' });
      establishmentCode ??= codes[0];
      if (establishmentCode && !/^\d{5}$/.test(establishmentCode)) throw new BadRequestException({ code: 'WHT_ESTABLISHMENT_INVALID', message: 'รหัสสาขาภาษีไม่ถูกต้อง เลือกสาขาอีกครั้ง' });
      if (existingPapers.some(p => p.establishmentCode === establishmentCode && p.sequence === sequence && !p.rowsCertain)) throw uncertainWithholdingPaper();
      const filed = await this.taxRepo.prisma.client.whtFiling.findFirst({
        where: { companyId: ctx.companyId, taxPeriodId: period.id, ...(establishmentCode ? { establishmentCode } : {}), sequence, status: 'FILED', rowsCertain: true }, include: { latestPackage: true },
      });
      if (filed) {
        assertEstablishmentScope(ctx, filed.establishmentBranchId);
        const pkg = filed.latestPackage;
        const attachment = pkg?.attachmentId ? await this.taxRepo.prisma.client.attachmentObject.findFirst({ where: { id: pkg.attachmentId, companyId: ctx.companyId } }) : null;
        if (!pkg || !attachment) throw this.storedFileUnavailable();
        let bytes: Buffer;
        try { bytes = (await this.storage.getObject({ bucket: attachment.bucket, objectKey: attachment.objectKey, objectVersionId: attachment.objectVersionId ?? undefined })).bytes; }
        catch { throw this.storedFileUnavailable(); }
        if (crypto.createHash('sha256').update(bytes).digest('hex') !== pkg.checksum) throw this.storedFileUnavailable();
        return { ...this.toDto(pkg), artifact: { fileName: sequence ? attachment.originalFileName : paperFileName(attachment.originalFileName, filed.establishmentCode), mimeType: attachment.mimeType,
          contentBase64: bytes.toString('base64'), checksum: pkg.checksum!, byteLength: bytes.length } };
      }
    }

    if (freezesPaper && sequence !== 0) assertOpenWithholdingSequence(existingPapers.filter(p => p.establishmentCode === establishmentCode), sequence);
    const [reviewIssues, latestSnapshot, reconciliation] = await Promise.all([
      this.taxRepo.findIssuesByPeriod(ctx.companyId, period.id, { status: 'OPEN' }),
      this.taxRepo.prisma.client.taxReportSnapshot.findFirst({
        where: { companyId: ctx.companyId, taxPeriodId: period.id },
        orderBy: { snapshotAt: 'desc' },
      }),
      ['PP30', 'PP36'].includes(period.formType) ? (this.taxRepo.prisma.client as any).taxReconciliationRun.findFirst({
        where: { companyId: ctx.companyId, branchId: null, formType: period.formType, periodKey: period.periodKey }, orderBy: { createdAt: 'desc' },
      }) : null,
    ]);
    const selected = partition ? selectWithholdingPaper(ctx, partition, establishmentCode) : null;
    if (partition && !selected && (activeEvents.length || projection!.unassignedBlockers.length)) throw new ConflictException({ code: 'WHT_BRANCH_HAS_NO_CODE', message: 'สาขายังไม่มีรหัสสาขาภาษี เปิดตั้งค่าสาขาแล้วกรอกรหัสก่อนดาวน์โหลดแบบ' });
    const events = freezesPaper ? orderWithholdingPayments(withholdingPaperPayments(selected?.events ?? [], existingPapers), period.formType) : activeEvents;
    const paperIssues = reviewIssues;
    if (['PP30', 'PP36'].includes(period.formType)) {
      if (!reconciliation) throw new ConflictException('A current tax reconciliation run is required before export');
      if (reconciliation.status !== 'REVIEWED' || reconciliation.blockingIssueCount > 0) throw new ConflictException('Tax reconciliation must be reviewed with no blocking lines before export');
      if (reviewIssues.some((issue) => issue.severity === 'BLOCKING')) throw new ConflictException('Blocking tax review issues must be resolved before export');
      const latestSourceUpdate = events.reduce((latest, event) => Math.max(latest, event.updatedAt.getTime()), 0);
      if (latestSourceUpdate > new Date(reconciliation.reviewedAt ?? reconciliation.updatedAt).getTime()) throw new ConflictException('Tax reconciliation is stale after source changes');
    }
    const rows = events.map((event) => ({
      eventType: event.eventType,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
      eventDate: event.eventDate.toISOString().slice(0, 10),
      outputTaxCode: event.outputTaxCode,
      taxInvoiceNumber: event.taxInvoiceNumber,
      taxableBase: event.taxableBase,
      taxAmount: event.taxAmount,
      grossAmount: event.grossAmount,
      withheldAmount: event.withheldAmount,
      reviewNote: event.reviewNote,
    }));
    const payload = {
      generatedAt: new Date().toISOString(),
      period,
      latestReport: latestSnapshot?.reportJson ?? null,
      rows,
      reviewIssues,
      disclaimer: 'Manual filing review package only. Confirm with accountant/RD before submission.',
    };
    const validation = freezesPaper ? await validateWithholdingFiling(this.taxRepo.prisma.client, ctx.companyId, period.formType as 'PND3' | 'PND53', period, events, paperIssues, selected?.establishment, sequence, false, ctx) : null;
    const blocking = validation?.issues.find(issue => issue.severity === 'BLOCKING');
    if (blocking) throw new ConflictException({ code: (blocking.issueCode.startsWith(`${period.formType}_FILING_`) || blocking.issueCode === 'WHT_FILING_CHANGED_AFTER_DOWNLOAD') ? blocking.issueCode : `${period.formType}_FILING_REVIEW`, message: blocking.description, issues: validation!.issues });
    if (validation?.accountantPrepared && exportFormat === 'PDF') throw new ConflictException({ code: 'WHT_ACCOUNTANT_PREPARES', message: 'ผู้ทำบัญชีจัดทำแบบนี้เอง ดาวน์โหลดรายการให้ผู้ทำบัญชีแทน' });
    const paperEvents = validation ? events.filter(event => validation.eventIds.includes(event.id)) : events;
    const cancelledNames = sequence > 0 ? cancelledPayeeNames(await cancelledWithholdingRows(db, ctx.companyId, existingPapers), paperEvents) : [];
    const workbook = freezesPaper && exportFormat === 'XLSX'
      ? await withholdingAccountantExport(this.taxRepo.prisma.client, ctx.companyId, period.formType, period.periodKey, paperEvents, selected?.establishment.code, cancelledNames.length ? [cancelledPayeesNote(cancelledNames)] : []) : null;
    const artifact = workbook ? (({ filingLines: _lines, ...file }) => file)(workbook)
      : validation ? await this.buildWithholdingArtifact(period.formType as 'PND3' | 'PND53', validation.filing!)
      : buildTaxExportArtifact(exportFormat, `tax-${period.formType}-${period.periodKey}`, rows, payload);
    if (validation) artifact.fileName = paperFileName(artifact.fileName, validation.payer.payerBranch).replace(/(\.(?:pdf|xlsx))$/, `${sequence ? `-เพิ่มเติมครั้งที่-${sequence}` : ''}$1`);
    const reserved = await this.reserveNumber.execute({
      companyId: ctx.companyId,
      documentType: 'tax.filing_export',
      periodKey: period.periodKey,
      idempotencyKey: `tax.filing_export:${period.id}:${exportFormat}:${artifact.checksum}`,
      reservedByUserId: ctx.userId,
    });
    let pkg;
    if (validation) {
      const stored = await this.storage.putObject({ objectKey: `${ctx.companyId}/tax-filings/${crypto.randomUUID()}`, mimeType: artifact.mimeType, bytes: Buffer.from(artifact.contentBase64, 'base64') });
      try {
        pkg = await this.taxRepo.recordWithholdingDownload({ ctx, period, sequence, exportFormat, exportNumber: reserved.documentNumber, artifact, stored,
          establishmentCode: validation.payer.payerBranch, establishmentBranchId: validation.establishmentBranchId,
          preparedBy: validation.accountantPrepared ? 'ACCOUNTANT' : 'SYSTEM', payerSnapshotJson: validation.payer,
          rowsChecksum: withholdingPaymentChecksum(paperEvents), rowsCertain: !isPeriodLocked(period.status) || existingPapers.some(p => p.rowsCertain && p.status === 'FILED'),
          lines: workbook?.filingLines ?? paperEvents.map((event, index) => ({ taxEventId: event.id, sourceType: event.sourceType, sourceId: event.sourceId,
            lineJson: { ...validation.filing!.lines[index], payment: withholdingPaymentFacts(event) } })),
        });
      } catch (error) {
        // Only this new, unlinked object is eligible for cleanup; never overwrite/delete an older paper.
        await this.storage.deleteObject(stored).catch(() => undefined);
        // A concurrent change won the Serializable snapshot (P2034, or 40001 from a raw statement).
        if (isSerializationFailure(error)) throw new ConflictException({ code: 'WHT_FILING_CHANGED_DURING_DOWNLOAD', message: 'มีรายการเปลี่ยนระหว่างดาวน์โหลด ดาวน์โหลดอีกครั้ง' });
        throw error;
      }
    } else pkg = await this.taxRepo.prisma.client.taxFilingPackage.create({ data: {
      companyId: ctx.companyId, taxPeriodId: period.id, formType: period.formType as any, periodKey: period.periodKey,
      exportNumber: reserved.documentNumber, exportFormat, checksum: artifact.checksum, generatedByUserId: ctx.userId,
    } });
    await this.commitNumber.execute({
      id: reserved.id,
      companyId: ctx.companyId,
      ownerType: 'tax.filing_package',
      ownerId: pkg.id,
    });
    if (!validation && !isPeriodLocked(period.status)) await this.taxRepo.updatePeriodStatus(ctx.companyId, period.id, 'EXPORTED');
    await this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'tax.filing_package.generate',
      targetType: 'tax_filing_package',
      targetId: pkg.id,
      requestId: ctx.requestId,
      result: 'SUCCESS',
      riskLevel: 'HIGH',
      metadataJson: { formType: period.formType, periodKey: period.periodKey, exportFormat, checksum: artifact.checksum, byteLength: artifact.byteLength },
    });
    return { ...this.toDto(pkg), artifact };
  }

  private storedFileUnavailable() {
    return new ConflictException({ code: 'WHT_FILING_FILE_UNAVAILABLE', message: 'เปิดแบบที่ยื่นไว้ไม่ได้ ลองอีกครั้งหรือติดต่อทีมงานมั่งมี' });
  }

  private async buildWithholdingArtifact(formType: 'PND3' | 'PND53', filing: import('../../domain/logic/pnd53-official-form.logic').Pnd53Filing) {
    const buffer = await (formType === 'PND3' ? renderPnd3OfficialForm : renderPnd53OfficialForm)(filing);
    return { fileName: `${formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}-${filing.periodKey}.pdf`, mimeType: 'application/pdf', contentBase64: buffer.toString('base64'),
      checksum: crypto.createHash('sha256').update(buffer).digest('hex'), byteLength: buffer.length };
  }

  private toDto(row: any) {
    return {
      id: row.id,
      companyId: row.companyId,
      taxPeriodId: row.taxPeriodId,
      formType: row.formType,
      periodKey: row.periodKey,
      exportNumber: row.exportNumber,
      status: row.status,
      exportFormat: row.exportFormat,
      attachmentId: row.attachmentId ?? null,
      checksum: row.checksum ?? null,
      generatedAt: row.generatedAt.toISOString(),
      downloadedAt: row.downloadedAt?.toISOString() ?? null,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      filedManuallyAt: row.filedManuallyAt?.toISOString() ?? null,
      filedManuallyNote: row.filedManuallyNote ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
