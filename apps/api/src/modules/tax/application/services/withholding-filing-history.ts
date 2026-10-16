import type { Prisma } from '../../../../generated/prisma/client';
import type { WithholdingCancellationDto } from '@watchdog-bms/contracts';

type Paper = { id: string; status: string; formType: string; filedAt?: Date | null; lines: { sourceType: string; sourceId: string; lineJson: unknown }[] };
/** Source cancellation is a fact alongside the paper, never a replacement of its frozen row. */
export async function cancelledWithholdingRows(db: Prisma.TransactionClient, companyId: string, papers: Paper[]): Promise<WithholdingCancellationDto[]> {
  const lines = papers.filter(p => p.status === 'FILED').flatMap(p => p.lines.map(line => ({ paper: p, line })));
  const ids = (type: string) => lines.filter(l => l.line.sourceType === type).map(l => l.line.sourceId);
  const expenses = ids('expense.record'), suppliers = ids('procurement.supplier_payment');
  const select = { id: true, voidedAt: true, voidedByUserId: true };
  const [expenseRows, supplierRows] = await Promise.all([
    expenses.length ? db.expenseRecord.findMany({ where: { companyId, id: { in: expenses }, status: 'VOIDED' }, select }) : [],
    suppliers.length ? db.supplierPayment.findMany({ where: { companyId, id: { in: suppliers }, status: 'VOIDED' }, select }) : [],
  ]);
  const paymentIds = lines.flatMap(({ line }) => { const key = (line.lineJson as { payment?: unknown[] }).payment?.[13]; return typeof key === 'string' && key.startsWith('payment:') ? [key.slice(8).split(':line:')[0]] : []; });
  const voidedPayments = paymentIds.length ? await db.expensePayment.findMany({ where: { companyId, id: { in: paymentIds }, status: 'VOIDED' }, select }) : [];
  return lines.flatMap(({ paper, line }) => {
    const paymentKey = (line.lineJson as { payment?: (string | null)[] }).payment?.[13];
    const source = voidedPayments.find(p => typeof paymentKey === 'string' && p.id === paymentKey.slice(8).split(':line:')[0]) ?? (line.sourceType === 'expense.record' ? expenseRows : supplierRows).find(s => s.id === line.sourceId);
    if (!source?.voidedAt || (paper.filedAt && source.voidedAt < paper.filedAt)) return [];
    const payment = (line.lineJson as { payment?: (string | null)[] }).payment;
    if (!payment) return [];
    return [{ filingId: paper.id, formType: paper.formType as 'PND3' | 'PND53', sourceType: line.sourceType, sourceId: line.sourceId,
      payeeName: payment[9] ?? '', payeeTaxId: payment[10] ?? null, withheld: payment[7] ?? '0',
      cancelledAt: source.voidedAt.toISOString(), cancelledByUserId: source.voidedByUserId }];
  });
}
export function cancelledPayeeNames(cancelled: WithholdingCancellationDto[], events: { payeeSnapshot?: { name?: string | null; taxId?: string | null } | null }[]) {
  const normalizeId = (value?: string | null) => value?.replace(/\D/g, '') || null;
  // A corrected taxpayer number can differ: matching the printed name is a warning, never netting.
  return [...new Set(cancelled.filter(c => events.some(e => {
    const payee = e.payeeSnapshot;
    return (normalizeId(c.payeeTaxId) && normalizeId(c.payeeTaxId) === normalizeId(payee?.taxId))
      || (c.payeeName.trim() && c.payeeName.trim() === payee?.name?.trim());
  })).map(c => c.payeeName))];
}
export const cancelledPayeesNote = (names: string[]) => `มีผู้รับเงินที่ถูกยกเลิกหลังยื่นในเดือนนี้: ${names.join(' · ')} ให้ผู้ทำบัญชีตรวจยอดก่อนยื่น`;
