import { THAI_SYSTEM_ROLE_NAMES, DISBURSEMENT_VOUCHER_ERROR_WORDS, E_WHT_WORDS, E_WHT_REDUCED_RATE, todayCivilDate } from '@watchdog-bms/contracts';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import type { DisbursementPaymentFields, DisbursementVoucherCommandInput, DisbursementVoucherDetail, PayDisbursementVoucherInput } from './disbursement-vouchers.model';

/** The read model owns the action; a reader who has "กลับไปแก้" is told to press it, another reader needs a person who can recover the document. */
export function disbursementPaymentCorrectionHint(detail: DisbursementVoucherDetail, canTakeBack = false): string {
  if (canTakeBack) return 'ยอดต้องเท่ายอดที่อนุมัติ ถ้าไม่เท่า กดกลับไปแก้';
  const name = detail.preparerActive !== false ? detail.preparerName
    : detail.senderActive !== false ? detail.submittedByName : THAI_SYSTEM_ROLE_NAMES.OWNER;
  return `ยอดต้องเท่ายอดที่อนุมัติ ถ้าไม่เท่า ให้ ${name || 'ผู้เตรียมหรือผู้ส่งใบนี้'} แก้ใบก่อน`;
}

export function canPayDisbursementVoucher(detail: DisbursementVoucherDetail): boolean {
  return detail.header.status === 'APPROVED' && detail.actions.pay;
}
export function disbursementWithholdingLines(detail: DisbursementVoucherDetail): DisbursementVoucherDetail['lines'] {
  return detail.lines.filter(line => Number(line.whtAmount) > 0 && (detail.header.status === 'PAID'
    || ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'].includes(detail.header.status) && line.withholdingCertificate?.state === 'E_WHT'));
}
export function initialDisbursementPayment(header: Pick<DisbursementVoucherDetail['header'], 'plannedMethod'>, now = new Date()): DisbursementPaymentFields {
  return { paidDate: todayCivilDate('Asia/Bangkok', now), paymentMethod: header.plannedMethod ?? 'BANK_TRANSFER', paidFromRef: '' };
}
export function disbursementPaymentDateError(date: string, now = new Date()): string | undefined {
  if (!date) return 'เลือกวันที่จ่ายจริงก่อนบันทึก';
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
  return (['E_WHT', 'PENDING', 'SYSTEM_ISSUED', 'EXTERNAL_LINKED'] as const).map(state => ({ state,
    lines: disbursementWithholdingLines(detail).filter(line => line.withholdingCertificate?.state === state),
  })).filter(group => group.lines.length > 0);
}

export function disbursementEWhtPaymentWarning(detail: Pick<DisbursementVoucherDetail, 'lines'>, date: string): string | null {
  return date && detail.lines.some(line => line.whtRemittance === 'E_WHT' && line.eWhtReducedRateApplied)
    && !E_WHT_REDUCED_RATE.windows.some(window => date >= window.from && date <= window.to) ? E_WHT_WORDS['W-P2'] : null;
}
