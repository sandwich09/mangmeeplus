import type { BankLedgerAccountRecord } from '../models/banking.model.js';

const BANK_ACCOUNT_MARKERS = new Set(['BANK', 'CASH', 'CASH_AND_BANK', 'CASH_OR_BANK']);

export function isBankLedgerAccount(account: BankLedgerAccountRecord): boolean {
  const marker = account.cashFlowCategory?.trim().toUpperCase();
  const reportGroup = account.reportGroup?.trim().toLowerCase();
  return account.status === 'ACTIVE'
    && account.isPosting
    && !account.isControlled
    && account.accountClass === 'ASSET'
    && account.normalBalance === 'DEBIT'
    && (
      (marker !== undefined && BANK_ACCOUNT_MARKERS.has(marker))
      || reportGroup === 'cash'
      || /^111[1-4]-\d{2}$/.test(account.code)
    );
}
