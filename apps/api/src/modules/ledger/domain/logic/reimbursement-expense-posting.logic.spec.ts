import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerJournalLineInput, LedgerSourcePostingInput } from '@watchdog-bms/contracts';
import { buildDefaultPostingLines, DEFAULT_ACCOUNT_CODES } from './posting-engine.logic.js';

function balanced(lines: LedgerJournalLineInput[]): boolean {
  const debit = lines.reduce((sum, line) => sum + Number(line.debitAmount ?? 0), 0);
  const credit = lines.reduce((sum, line) => sum + Number(line.creditAmount ?? 0), 0);
  return Math.abs(debit - credit) < 0.0001;
}

function line(lines: LedgerJournalLineInput[], accountCode: string): LedgerJournalLineInput | undefined {
  return lines.find((l) => l.accountId === accountCode);
}

function expenseSource(event: string, over: Partial<LedgerSourcePostingInput> = {}): LedgerSourcePostingInput {
  return {
    companyId: 'company-1', branchId: 'branch-1', sourceType: 'expense.record', sourceId: 'expense-1',
    sourceEventType: event, idempotencyKey: 'expense-1', sourceDate: '2026-07-01', periodKey: '2026-07', currency: 'THB',
    totalAmount: '107.00', taxTotal: '7.00', whtTotal: '0',
    lines: [{ sourceLineId: 'expense-line-1', netAmount: '100.00', vatAmount: '7.00' }],
    ...over,
  };
}

describe('GAP-02 reimbursement→expense ledger posting', () => {
  it('claim-born expense credits employee payable (2130-01) with VAT and no WHT, balanced', () => {
    const lines = buildDefaultPostingLines(expenseSource('expense.claim.confirmed'))!;
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.EXPENSE_GENERAL)?.debitAmount, '100.0000');
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.INPUT_VAT)?.debitAmount, '7.0000');
    // payable = net (107) - wht (0) = 107, credited to employee payable rather than trade AP
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.EMPLOYEE_PAYABLE)?.creditAmount, '107.0000');
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.ACCOUNTS_PAYABLE), undefined);
    assert.equal(balanced(lines), true);
  });

  it('claim-born expense credits employee payable with WHT withheld, balanced', () => {
    // net 107 incl. 7 VAT, WHT 3 → payable 104
    const lines = buildDefaultPostingLines(expenseSource('expense.claim.confirmed', { whtTotal: '3.00' }))!;
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.EXPENSE_GENERAL)?.debitAmount, '100.0000');
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.INPUT_VAT)?.debitAmount, '7.0000');
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.WHT_PAYABLE)?.creditAmount, '3.0000');
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.EMPLOYEE_PAYABLE)?.creditAmount, '104.0000');
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.ACCOUNTS_PAYABLE), undefined);
    assert.equal(balanced(lines), true);
  });

  it('claim-born expense with no VAT still credits employee payable, balanced', () => {
    const lines = buildDefaultPostingLines(expenseSource('expense.claim.confirmed', {
      totalAmount: '100.00', taxTotal: '0', lines: [{ sourceLineId: 'expense-line-1', netAmount: '100.00', vatAmount: '0' }],
    }))!;
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.INPUT_VAT), undefined);
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.EMPLOYEE_PAYABLE)?.creditAmount, '100.0000');
    assert.equal(balanced(lines), true);
  });

  it('regression: a plain expense still credits trade AP (2120-01), not employee payable', () => {
    const lines = buildDefaultPostingLines(expenseSource('expense.confirmed'))!;
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.ACCOUNTS_PAYABLE)?.creditAmount, '107.0000');
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.EMPLOYEE_PAYABLE), undefined);
    assert.equal(balanced(lines), true);
  });

  it('reimbursement.payment debits employee payable and credits cash, balanced', () => {
    const lines = buildDefaultPostingLines({
      companyId: 'company-1', sourceType: 'reimbursement.payment', sourceId: 'payment-1',
      sourceEventType: 'reimbursement.payment', idempotencyKey: 'payment-1', sourceDate: '2026-07-05',
      periodKey: '2026-07', currency: 'THB', totalAmount: '104.00', lines: [],
    })!;
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.EMPLOYEE_PAYABLE)?.debitAmount, '104.0000');
    assert.equal(line(lines, DEFAULT_ACCOUNT_CODES.CASH_OR_BANK)?.creditAmount, '104.0000');
    assert.equal(balanced(lines), true);
  });
});
