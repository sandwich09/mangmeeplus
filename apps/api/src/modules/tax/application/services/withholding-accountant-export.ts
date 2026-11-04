import { expenseCurrencyLabel } from '@watchdog-bms/contracts';
import { loadWithholdingEstablishments, partitionWithholdingPayments } from './withholding-establishments';
import { createHash } from 'node:crypto';
import { Prisma } from '../../../../generated/prisma/client';
import { buildWorkbook, XLSX_MIME_TYPE, type WorkbookSheet } from '../../../../common/export/xlsx.logic';
import { formatThaiExportDate } from '../../../../common/export/thai-date.logic';
import { printablePnd53PayeeAddress } from '../../domain/logic/pnd53-official-form.logic';
import { withholdingPaymentFacts, currentWithholdingPayments } from './withholding-filing-state';
import type { TaxEventRecord } from '../../domain/ports/tax-event.repository.port';

type ExportEvent = Pick<TaxEventRecord, 'id' | 'sourceType' | 'sourceId' | 'eventDate' | 'branchId' | 'currency' | 'payeeSnapshot' | 'incomeCategoryCode' | 'whtRate' | 'grossAmount' | 'withheldAmount'>;

export async function withholdingAccountantExport(db: Prisma.TransactionClient, companyId: string, form: string, month: string, events: ExportEvent[], establishmentCode?: string, notes: string[] = []) {
  const separate = await db.taxEvent.findMany({ where: { companyId, periodKey: month, eventType: 'WHT_PND2', status: 'ACTIVE' } });
  let pnd2 = await currentWithholdingPayments(db, companyId, separate.map(row => ({ ...row,
    payeeSnapshot: row.payeeSnapshotJson as TaxEventRecord['payeeSnapshot'],
    grossAmount: row.grossAmount?.toString() ?? null, withheldAmount: row.withheldAmount?.toString() ?? null, whtRate: row.whtRate?.toString() ?? null,
  })));
  if (establishmentCode) {
    const context = await loadWithholdingEstablishments(db, companyId, month);
    pnd2 = partitionWithholdingPayments(pnd2, context.branches, context.facts, month).papers.find(p => p.establishment.code === establishmentCode)?.events ?? [];
  }
  const all = [...events, ...pnd2];
  const [categories, handoffs] = await Promise.all([
    db.whtIncomeCategory.findMany({ where: { code: { in: all.flatMap(row => row.incomeCategoryCode ? [row.incomeCategoryCode] : []) } } }),
    db.whtCertificateHandoff.findMany({ where: { companyId, OR: all.map(row => ({ sourcePaymentType: row.sourceType, sourcePaymentId: row.sourceId })) }, orderBy: { createdAt: 'desc' } }),
  ]);
  const certificates = await db.whtCertificate.findMany({ where: { companyId, id: { in: handoffs.flatMap(row => row.certificateId ? [row.certificateId] : []) }, status: 'ISSUED' }, select: { id: true, certificateNumber: true } });
  const certificateNumbers = new Map(certificates.map(row => [row.id, row.certificateNumber]));
  const names = new Map(categories.map(row => [row.code, row.nameTh]));
  const filingLines: { taxEventId: string; sourceType: string; sourceId: string; lineJson: object }[] = [];
  const sheet = (name: string, rows: typeof all): WorkbookSheet => ({ name, freezeRows: 1, rows: [
    ['วันที่จ่าย', 'ผู้รับเงิน', 'เลขผู้เสียภาษี', 'สาขา', 'ที่อยู่', 'ประเภทเงินได้', 'อัตรา (%)', 'สกุลเงิน', 'ยอดจ่าย', 'ภาษีที่หักไว้', 'เลขที่หนังสือรับรอง 50 ทวิ'],
    ...rows.map(row => {
      const cert = handoffs.find(h => h.sourcePaymentType === row.sourceType && h.sourcePaymentId === row.sourceId);
      const cells = [formatThaiExportDate(row.eventDate.toISOString()), row.payeeSnapshot?.name ?? '', row.payeeSnapshot?.taxId ?? '', row.payeeSnapshot?.branchCode ?? '',
        printablePnd53PayeeAddress(row.payeeSnapshot?.address) ?? '', names.get(row.incomeCategoryCode ?? '') ?? '', row.whtRate == null ? '' : Number(row.whtRate), expenseCurrencyLabel(row.currency), Number(row.grossAmount ?? 0), Number(row.withheldAmount ?? 0),
        cert?.status === 'SYSTEM_ISSUED' ? certificateNumbers.get(cert.certificateId ?? '') ?? '' : cert?.status === 'EXTERNAL_LINKED' ? cert.externalCertificateNumber ?? '' : ''];
      if (rows === events) filingLines.push({ taxEventId: row.id, sourceType: row.sourceType, sourceId: row.sourceId, lineJson: { cells, payment: withholdingPaymentFacts(row) } });
      return cells;
    }),
    ...[...new Set(rows.map(row => row.currency))].map(currency => {
      const sameCurrency = rows.filter(row => row.currency === currency);
      return ['รวม', '', '', '', '', '', '', expenseCurrencyLabel(currency),
        Number(sameCurrency.reduce((n, row) => n.plus(row.grossAmount ?? 0), new Prisma.Decimal(0)).toFixed(2)),
        Number(sameCurrency.reduce((n, row) => n.plus(row.withheldAmount ?? 0), new Prisma.Decimal(0)).toFixed(2)), ''];
    }),
  ] });
  const main = sheet(form === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53', events);
  main.rows.push(...notes.map(note => [note]));
  const buffer = buildWorkbook([main, ...(pnd2.length ? [sheet('ภ.ง.ด.2', pnd2)] : [])]);
  return { filingLines, fileName: `รายการให้ผู้ทำบัญชี-${form}-${month}.xlsx`, mimeType: XLSX_MIME_TYPE, contentBase64: buffer.toString('base64'),
    checksum: createHash('sha256').update(buffer).digest('hex'), byteLength: buffer.length };
}
