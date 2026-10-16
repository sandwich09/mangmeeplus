import type { ExpenseDetail } from '../expenses.model';
import { workspaceDictionary } from '@/common/i18n/workspace-dictionary';
import type { DisbursementVoucherDetail } from './disbursement-vouchers.model';

type Payments = NonNullable<ExpenseDetail['payments']>;
export function disbursementPaymentsToCancel(payments: Payments, paymentId?: string, vouchers: Record<string, DisbursementVoucherDetail> = {}): Payments {
  return payments.filter(payment => payment.status !== 'VOIDED' && payment.disbursementVoucher && (!paymentId || payment.id === paymentId)
    && (!payment.disbursementVoucher.id || vouchers[payment.disbursementVoucher.id]?.header?.status !== 'CANCELLED'));
}
export function expenseDisbursementCancellationWarnings(payments: Payments, vouchers: Record<string, DisbursementVoucherDetail>, _expenseId: string, paymentId?: string): string[] {
  // Cancelling one payment and cancelling the whole expense are two acts: each sentence names its own.
  const sentence = workspaceDictionary.th[paymentId ? 'expenses.disbursement.cancel_payment_warning' : 'expenses.disbursement.cancel_document_warning'];
  return [...new Set(disbursementPaymentsToCancel(payments, paymentId, vouchers).map(payment => payment.disbursementVoucher!.documentNumber))]
    .map(number => sentence.replace('{number}', number));
}
export function expenseDisbursementCancellationToast(message: string, payments: Payments, paymentId?: string, vouchers?: Record<string, DisbursementVoucherDetail>): string {
  const numbers = [...new Set(disbursementPaymentsToCancel(payments, paymentId, vouchers).map(payment => payment.disbursementVoucher!.documentNumber))];
  if (!numbers.length) return message;
  const words = workspaceDictionary.th;
  return paymentId ? numbers.map(number => words['expenses.disbursement.cancel_payment_and_document_toast'].replace('{number}', number)).join(' ')
    : [message, ...numbers.map(number => words['expenses.disbursement.cancel_payment_toast'].replace('{number}', number))].join(' ');
}

export function canAddExpenseToDisbursement(detail: ExpenseDetail, permissions: readonly string[], entryOpen: boolean): boolean {
  return entryOpen && permissions.includes('expense.disbursement.prepare') && detail.status === 'CONFIRMED'
    && Number(detail.outstandingAmount) > 0 && !detail.correctionCapabilities?.disbursementReservation;
}
export function expenseDisbursementPaymentAction(payment: NonNullable<ExpenseDetail['payments']>[number], permissions: readonly string[], entryOpen: boolean): 'view' | 'notice' | 'issue' | 'none' {
  if (payment.disbursementVoucher) return permissions.includes('expense.disbursement.read') && payment.disbursementVoucher.id ? 'view' : 'notice';
  return entryOpen && permissions.includes('expense.disbursement.issue') && payment.canIssueDisbursementVoucher && payment.status !== 'VOIDED' ? 'issue' : 'none';
}
