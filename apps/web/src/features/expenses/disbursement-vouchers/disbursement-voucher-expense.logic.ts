import type { ExpenseDetail } from '../expenses.model';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';

type Payments = NonNullable<ExpenseDetail['payments']>;
export function disbursementPaymentsToCancel(payments: Payments, paymentId?: string, vouchers: Record<string, DisbursementVoucherDetail> = {}): Payments {
  return payments.filter(payment => payment.status !== 'VOIDED' && payment.disbursementVoucher && (!paymentId || payment.id === paymentId)
    && (!payment.disbursementVoucher.id || vouchers[payment.disbursementVoucher.id]?.header?.status !== 'CANCELLED'));
}
export function expenseDisbursementCancellationWarnings(payments: Payments, vouchers: Record<string, DisbursementVoucherDetail>, _expenseId: string, paymentId?: string): string[] {
  return [...new Map(disbursementPaymentsToCancel(payments, paymentId, vouchers).map(payment => [payment.disbursementVoucher!.documentNumber, payment])).values()].map(payment => {
    const voucher = payment.disbursementVoucher!;
    return workspaceDictionary.th['expenses.disbursement.cancel_payment_warning'].replace('{number}', voucher.documentNumber);
  });
}
export function expenseDisbursementCancellationToast(message: string, payments: Payments, paymentId?: string, vouchers?: Record<string, DisbursementVoucherDetail>): string {
  const numbers = [...new Set(disbursementPaymentsToCancel(payments, paymentId, vouchers).map(payment => payment.disbursementVoucher!.documentNumber))];
  return numbers.length ? numbers.map(number => workspaceDictionary.th['expenses.disbursement.cancel_payment_and_document_toast'].replace('{number}', number)).join(' ') : message;
}

export function canAddExpenseToDisbursement(detail: ExpenseDetail, permissions: readonly string[], entryOpen: boolean): boolean {
  return entryOpen && permissions.includes('expense.disbursement.prepare') && detail.status === 'CONFIRMED'
    && Number(detail.outstandingAmount) > 0 && !detail.correctionCapabilities?.disbursementReservation;
}
export function expenseDisbursementPaymentAction(payment: NonNullable<ExpenseDetail['payments']>[number], permissions: readonly string[], entryOpen: boolean): 'view' | 'notice' | 'issue' | 'none' {
  if (payment.disbursementVoucher) return permissions.includes('expense.disbursement.read') && payment.disbursementVoucher.id ? 'view' : 'notice';
  return entryOpen && permissions.includes('expense.disbursement.issue') && payment.canIssueDisbursementVoucher && payment.status !== 'VOIDED' ? 'issue' : 'none';
}
