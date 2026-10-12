import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';
export function canReissueDisbursementVoucher(detail: DisbursementVoucherDetail): boolean {
  return detail.header.status === 'CANCELLED' && detail.header.cancelledAfterPaid && detail.canReissue && !detail.reissuedVoucher
    && detail.lines.some(line => line.expensePaymentId && line.paymentInEffect);
}
export function disbursementCancelledPaymentSentence(detail: DisbursementVoucherDetail): string | null {
  if (detail.header.status !== 'CANCELLED' || !detail.header.cancelledAfterPaid) return null;
  const cancelled = detail.lines.filter(line => line.expensePaymentId && !line.paymentInEffect);
  if (!cancelled.length) return null;
  const words = workspaceDictionary.th;
  const remaining = detail.lines.some(line => line.expensePaymentId && line.paymentInEffect);
  const suffix = remaining ? canReissueDisbursementVoucher(detail) ? words['expenses.disbursement.cancelled_payment_reissue']
    : words['expenses.disbursement.cancelled_payment_ask_issue'] : words['expenses.disbursement.cancelled_payment_empty'];
  if (detail.reissuedVoucher) return words['expenses.disbursement.cancelled_payment_base'].replace('{number}', cancelled.map(line => line.expenseNumber ?? '—').join(', '));
  return `${words['expenses.disbursement.cancelled_payment_base'].replace('{number}', cancelled.map(line => line.expenseNumber ?? '—').join(', '))} ${suffix}`;
}

export function disbursementReissueConfirmation(detail: DisbursementVoucherDetail): string {
  const count = detail.lines.filter(line => line.expensePaymentId && line.paymentInEffect).length;
  return workspaceDictionary.th['expenses.disbursement.reissue_confirm'].replace('{n}', String(count));
}
export function disbursementCancelledPaymentReason(detail: DisbursementVoucherDetail): string | null {
  if (detail.header.status !== 'CANCELLED' || !detail.header.cancelledAfterPaid) return null;
  const reason = detail.header.cancelSourceReason;
  return reason?.trim() ? workspaceDictionary.th['expenses.disbursement.payment_cancel_reason'].replace('{reason}', reason) : null;
}
