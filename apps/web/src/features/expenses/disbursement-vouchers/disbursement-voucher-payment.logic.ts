import { DISBURSEMENT_VOUCHER_ERROR_WORDS, todayCivilDate } from '@watchdog-bms/contracts';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import type { DisbursementPaymentFields, DisbursementVoucherCommandInput, DisbursementVoucherDetail, PayDisbursementVoucherInput } from './disbursement-vouchers.model';

export function canPayDisbursementVoucher(detail: DisbursementVoucherDetail): boolean {
  return detail.header.status === 'APPROVED' && detail.actions.pay;
}
export function disbursementWithholdingLines(detail: DisbursementVoucherDetail): DisbursementVoucherDetail['lines'] {
  return detail.header.status === 'PAID' ? detail.lines.filter(line => Number(line.whtAmount) > 0) : [];
}
export function initialDisbursementPayment(header: Pick<DisbursementVoucherDetail['header'], 'plannedMethod'>, now = new Date()): DisbursementPaymentFields {
  return { paidDate: todayCivilDate('Asia/Bangkok', now), paymentMethod: header.plannedMethod ?? '', paidFromRef: '' };
}
export function disbursementPaymentDateError(date: string, now = new Date()): string | undefined {
  return date > todayCivilDate('Asia/Bangkok', now) ? workspaceDictionary.th['expenses.disbursement.future_paid_date'] : undefined;
}
export function disbursementPaymentMethodError(method: DisbursementPaymentFields['paymentMethod']): string | undefined {
  return method ? undefined : DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_payment_method_required;
}
export function disbursementPaymentBody(base: DisbursementVoucherCommandInput, fields: DisbursementPaymentFields): PayDisbursementVoucherInput {
  return { ...base, ...(fields.paidDate ? { paidDate: fields.paidDate } : {}),
    ...(fields.paymentMethod ? { paymentMethod: fields.paymentMethod } : {}),
    ...(fields.paidFromRef.trim() ? { paidFromRef: fields.paidFromRef.trim() } : {}),
    ...(fields.slipAttachmentId ? { slipAttachmentId: fields.slipAttachmentId } : {}) };
}
export function disbursementCancelledPaymentLines(detail: DisbursementVoucherDetail): DisbursementVoucherDetail['lines'] {
  return detail.header.status === 'CANCELLED' ? detail.lines.filter(line => line.expensePaymentId && !line.paymentInEffect) : [];
}
export function disbursementVoucherDocumentHref(companyId: string, row: { id: string; status: string; primaryAction: string }): string {
  return `/companies/${companyId}/expenses/disbursement-vouchers/${encodeURIComponent(row.id)}${row.status === 'APPROVED' && row.primaryAction === 'pay' ? '#disbursement-voucher-pay' : ''}`;
}

export function disbursementWithholdingGroups(detail: DisbursementVoucherDetail) {
  return (['PENDING', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED'] as const).map(state => ({ state,
    lines: disbursementWithholdingLines(detail).filter(line => line.withholdingCertificate?.state === state),
  })).filter(group => group.lines.length > 0);
}
