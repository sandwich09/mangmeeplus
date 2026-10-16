import { createHash } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { civilDate, type WhtHandoffPrefillDto } from '@watchdog-bms/contracts';
import { allocateExpenseWithholding } from '../../domain/logic/expense-payment-withholding.logic';

export const WHT_PAYMENT_REQUIRED = 'ยังไม่มีรายการจ่าย บันทึกการจ่ายก่อนออกหนังสือรับรอง 50 ทวิ';
export const WHT_PAYMENT_DATE_REQUIRED = 'ยังไม่ทราบวันที่จ่ายเงินจริง เปิดรายการจ่ายแล้วระบุวันที่ก่อนออกหนังสือรับรอง 50 ทวิ';

/** One certificate covers one payment. The document date is never a payment fallback. */
export async function certificatePayment(db: any, companyId: string, row: any, paymentId?: string): Promise<WhtHandoffPrefillDto> {
  const prefill = row.prefillSnapshotJson as WhtHandoffPrefillDto;
  if (row.sourcePaymentType !== 'expense.record') {
    const events = row.sourcePaymentType === 'procurement.supplier_payment' ? [{ sourceType: row.sourcePaymentType, sourceId: row.sourcePaymentId }]
      : await db.taxEvent.findMany({ where: { companyId, id: { in: row.taxEventIdsJson ?? [] }, status: 'ACTIVE' } });
    return { ...prefill, paymentDate: await certificateEventPaymentDate(db, companyId, events) };
  }
  const payments = await db.expensePayment.findMany({ where: { companyId, expenseId: row.sourcePaymentId, status: 'RECORDED' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (!payments.length) throw new ConflictException({ code: 'wht_certificate_payment_required', message: WHT_PAYMENT_REQUIRED });
  const selected = paymentId ?? prefill.expensePaymentId;
  if (!selected && payments.length > 1) throw new ConflictException({ code: 'wht_certificate_payment_selection_required', message: 'รายการนี้จ่ายหลายครั้ง เลือกรายการจ่ายที่จะออกหนังสือรับรอง 50 ทวิ' });
  const payment = selected ? payments.find((p: any) => p.id === selected) : payments[0];
  if (!payment) throw new ConflictException({ code: 'wht_certificate_payment_required', message: WHT_PAYMENT_REQUIRED });
  if (!payment.paidAtConfirmed) throw new ConflictException({ code: 'wht_certificate_payment_date_required', message: WHT_PAYMENT_DATE_REQUIRED });
  const [expense, company] = await Promise.all([
    db.expenseRecord.findFirst({ where: { companyId, id: row.sourcePaymentId }, select: { netPayableAmount: true } }),
    db.company.findUnique({ where: { id: companyId }, select: { timezone: true } }),
  ]);
  const totals = prefill.expenseTotals ?? { grossAmount: prefill.grossAmount, withheldAmount: prefill.withheldAmount };
  const share = allocateExpenseWithholding(payments, String(expense.netPayableAmount), totals.grossAmount, totals.withheldAmount).find(p => p.id === payment.id)!;
  return { ...prefill, expensePaymentId: payment.id, expenseTotals: totals, paymentDate: civilDate(payment.paidAt, company?.timezone ?? 'Asia/Bangkok'), grossAmount: share.grossAmount, withheldAmount: share.whtAmount };
}

export async function certificateEventPaymentDate(db: any, companyId: string, events: any[]): Promise<string> {
  if (!events.length) throw new ConflictException({ code: 'wht_certificate_payment_required', message: WHT_PAYMENT_REQUIRED });
  const keys = new Set(events.map(e => `${e.sourceType}:${e.sourceType === 'expense.record' ? e.sourceLineKey?.match(/^payment:([^:]+)/)?.[1] : e.sourceId}`));
  if (keys.size !== 1) throw new ConflictException({ code: 'wht_certificate_payment_selection_required', message: 'รายการนี้จ่ายหลายครั้ง เลือกรายการจ่ายที่จะออกหนังสือรับรอง 50 ทวิ' });
  const event = events[0];
  if (event?.sourceType === 'expense.record') {
    const id = event.sourceLineKey?.match(/^payment:([^:]+)/)?.[1];
    if (!id) throw new ConflictException({ code: 'wht_certificate_payment_required', message: WHT_PAYMENT_REQUIRED });
    const payment = await db.expensePayment.findFirst({ where: { companyId, expenseId: event.sourceId, id, status: 'RECORDED' } });
    if (!payment) throw new ConflictException({ code: 'wht_certificate_payment_required', message: WHT_PAYMENT_REQUIRED });
    if (!payment.paidAtConfirmed) throw new ConflictException({ code: 'wht_certificate_payment_date_required', message: WHT_PAYMENT_DATE_REQUIRED });
    const company = await db.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
    return civilDate(payment.paidAt, company?.timezone ?? 'Asia/Bangkok');
  }
  if (event?.sourceType === 'procurement.supplier_payment') {
    const payment = await db.supplierPayment.findFirst({ where: { companyId, id: event.sourceId, status: 'RECORDED' } });
    if (payment) return payment.paymentDate.toISOString().slice(0, 10);
  }
  throw new ConflictException({ code: 'wht_certificate_payment_required', message: WHT_PAYMENT_REQUIRED });
}

export async function paymentHandoff(db: any, companyId: string, row: any, paymentId?: string) {
    if (paymentId && row.sourcePaymentType === 'expense.record' && row.prefillSnapshotJson.expensePaymentId !== paymentId) {
      const paymentPrefill = await certificatePayment(db, companyId, row, paymentId);
      const creationCommandId = `wht-payment:${row.sourcePaymentId}:${paymentId}`;
      const hash = createHash('sha256').update(JSON.stringify(paymentPrefill)).digest('hex');
      // Insert-if-absent (ON CONFLICT DO NOTHING): a double click must not lose to a unique-key 500.
      await db.whtCertificateHandoff.createMany({ skipDuplicates: true,
        data: [{ companyId: companyId, creationCommandId, payloadFingerprint: hash,
          sourceFeatureKey: row.sourceFeatureKey, sourcePaymentType: row.sourcePaymentType, sourcePaymentId: row.sourcePaymentId,
          sourceBranchId: row.sourceBranchId, branchCode: row.branchCode, payeeId: null, payeeAddress: row.payeeAddress,
          status: 'REQUIRED', certificateRound: 0, prefillSnapshotJson: paymentPrefill, prefillSnapshotHash: hash,
          availabilityVectorJson: row.availabilityVectorJson ?? {}, taxEventIdsJson: [] }],
      });
      row = await db.whtCertificateHandoff.findUniqueOrThrow({ where: { companyId_creationCommandId: { companyId, creationCommandId } } });
    }
  return row;
}

/** Caller holds the expense lock: two handoffs must not issue the same payment twice. */
export async function assertPaymentNotCertified(db: any, companyId: string, row: any, prefill: WhtHandoffPrefillDto) {
  if (!prefill.expensePaymentId) return;
  const issued = await db.whtCertificateHandoff.findFirst({ where: { companyId, sourcePaymentType: 'expense.record',
    sourcePaymentId: row.sourcePaymentId, id: { not: row.id }, status: { in: ['SYSTEM_ISSUED', 'EXTERNAL_LINKED'] },
    prefillSnapshotJson: { path: ['expensePaymentId'], equals: prefill.expensePaymentId } } });
  if (issued) throw new ConflictException({ code: 'wht_certificate_payment_already_issued', message: 'รายการจ่ายนี้มีหนังสือรับรองแล้ว เปิดหนังสือรับรองเดิมเพื่อดาวน์โหลดหรือแก้ไข' });
}
