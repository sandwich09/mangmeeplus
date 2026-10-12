import { DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import type { DisbursementVoucherHeader } from './disbursement-vouchers.model';
export type DisbursementPayeeAccountFields = { payeeBankName: string; payeeAccountName: string; payeeAccountNumber: string; payeeAccountLast4: string | null; payeeAccountCleared: boolean };
export const emptyDisbursementAccount: DisbursementPayeeAccountFields = { payeeBankName: '', payeeAccountName: '', payeeAccountNumber: '', payeeAccountLast4: null, payeeAccountCleared: false };
const digits = (number: string) => number.replace(/[\s-]/g, '');
export function initialDisbursementAccount(header: DisbursementVoucherHeader): DisbursementPayeeAccountFields {
  return { ...emptyDisbursementAccount, payeeBankName: header.payeeBankName ?? '', payeeAccountName: header.payeeAccountName ?? '', payeeAccountLast4: header.payeeAccountLast4 ?? null };
}
export function disbursementAccountError(fields: DisbursementPayeeAccountFields): string | null {
  const number = digits(fields.payeeAccountNumber);
  if (number && !/^\d{6,20}$/.test(number)) return DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_account_number_invalid;
  return (number || fields.payeeAccountLast4) && !fields.payeeBankName.trim() ? DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_account_bank_required : null;
}
export function disbursementAccountBody(fields: DisbursementPayeeAccountFields): { payeeBankName?: string; payeeAccountName?: string; payeeAccountNumber?: string } {
  const number = digits(fields.payeeAccountNumber);
  if (!number && fields.payeeAccountCleared) return { payeeBankName: '', payeeAccountName: '', payeeAccountNumber: '' };
  if (!number && !fields.payeeBankName && !fields.payeeAccountName && !fields.payeeAccountLast4) return {};
  return { payeeBankName: fields.payeeBankName.trim(), payeeAccountName: fields.payeeAccountName.trim(), ...(number ? { payeeAccountNumber: number } : {}) };
}
export function canRevealDisbursementAccount(permissions: readonly string[]): boolean {
  return permissions.includes('expense.disbursement.approve') || permissions.includes('expense.disbursement.pay');
}
