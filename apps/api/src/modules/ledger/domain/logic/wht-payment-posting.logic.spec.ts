import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { LedgerJournalLineInput, LedgerSourcePostingInput } from '@watchdog-bms/contracts';
import { buildDefaultPostingLines, resolvePostingLinesFromRule } from './posting-engine.logic.js';

/**
 * Withholding splits one side of a settlement entry: the counter-account moves by the whole debt
 * while the cash moves by less, and the difference sits with the RD. These cover both routes that
 * can produce such an entry — the built-in defaults and an accountant-configured PostingRule.
 */

function payment(overrides: Partial<LedgerSourcePostingInput> = {}): LedgerSourcePostingInput {
  return {
    companyId: 'company-1', branchId: 'branch-1',
    sourceType: 'procurement.supplier_payment', sourceId: 'payment-1',
    sourceEventType: 'accounting.payment.made', idempotencyKey: 'payment-1',
    sourceDate: '2026-08-05', periodKey: '2026-08', currency: 'THB',
    // 1,070 of debt cleared, 30 withheld, so 1,040 actually left the bank.
    totalAmount: '1070', taxTotal: '0', whtTotal: '30',
    lines: [{ sourceLineId: 'allocation-1', netAmount: '1070' }],
    ...overrides,
  } as LedgerSourcePostingInput;
}

const sum = (lines: LedgerJournalLineInput[], key: 'debitAmount' | 'creditAmount') =>
  lines.reduce((total, line) => total + parseFloat(line[key] ?? '0'), 0);

const amountOn = (lines: LedgerJournalLineInput[], accountId: string, key: 'debitAmount' | 'creditAmount') =>
  lines.filter((line) => line.accountId === accountId).reduce((total, line) => total + parseFloat(line[key] ?? '0'), 0);

describe('withholding on the built-in payment defaults', () => {
  it('relieves the payable in full and splits the credit between cash and the RD', () => {
    const lines = buildDefaultPostingLines(payment())!;
    assert.equal(amountOn(lines, '2120-01', 'debitAmount'), 1070);
    assert.equal(amountOn(lines, '1110-01', 'creditAmount'), 1040);
    assert.equal(amountOn(lines, '2210-02', 'creditAmount'), 30);
    assert.equal(sum(lines, 'debitAmount'), sum(lines, 'creditAmount'));
  });

  it('leaves a payment that withheld nothing exactly as it was', () => {
    const lines = buildDefaultPostingLines(payment({ totalAmount: '1070', whtTotal: '0' }))!;
    assert.equal(lines.length, 2);
    assert.equal(amountOn(lines, '2120-01', 'debitAmount'), 1070);
    assert.equal(amountOn(lines, '1110-01', 'creditAmount'), 1070);
  });

  it('treats an expense settlement, which never carries whtTotal, as a plain two-line entry', () => {
    const lines = buildDefaultPostingLines(payment({
      sourceEventType: 'expense.payment', whtTotal: undefined as never,
    }))!;
    assert.equal(lines.length, 2);
    assert.equal(amountOn(lines, '1110-01', 'creditAmount'), 1070);
  });
});

describe('withholding on an accountant-configured posting rule', () => {
  const mapping = { debitAccountCode: '2120-01', creditAccountCode: '1110-01' };

  it('refuses to post rather than emit a two-line entry that hides the withheld tax', () => {
    // Returning null routes the caller to posting_rule_missing, which tells the accountant to name
    // the WHT account. A two-line entry would silently credit cash by the full debt.
    assert.equal(resolvePostingLinesFromRule(payment(), mapping), null);
  });

  it('credits the RD account named on the rule when paying', () => {
    const lines = resolvePostingLinesFromRule(payment(), { ...mapping, whtAccountCode: '2132-04' })!;
    assert.equal(amountOn(lines, '2120-01', 'debitAmount'), 1070);
    assert.equal(amountOn(lines, '1110-01', 'creditAmount'), 1040);
    assert.equal(amountOn(lines, '2132-04', 'creditAmount'), 30);
    assert.equal(sum(lines, 'debitAmount'), sum(lines, 'creditAmount'));
  });

  it('debits it instead when receiving, because being withheld from creates a claim, not a debt', () => {
    const lines = resolvePostingLinesFromRule(payment({
      sourceEventType: 'accounting.payment.received', sourceType: 'accounting.payment',
      // Receivable side: AR is credited in full, cash and the tax credit share the debit.
    }), { debitAccountCode: '1110-01', creditAccountCode: '1210-00', whtAccountCode: '1270-00' })!;
    assert.equal(amountOn(lines, '1210-00', 'creditAmount'), 1070);
    assert.equal(amountOn(lines, '1110-01', 'debitAmount'), 1040);
    assert.equal(amountOn(lines, '1270-00', 'debitAmount'), 30);
    assert.equal(sum(lines, 'debitAmount'), sum(lines, 'creditAmount'));
  });

  it('keeps a rule with no withholding on its original two lines', () => {
    const lines = resolvePostingLinesFromRule(payment({ whtTotal: '0' }), mapping)!;
    assert.equal(lines.length, 2);
    assert.equal(amountOn(lines, '1110-01', 'creditAmount'), 1070);
  });
});

describe('being withheld from, on the receivable side', () => {
  const receipt = (whtTotal: string) => payment({
    sourceType: 'accounting.payment', sourceId: 'receipt-1',
    sourceEventType: 'accounting.payment.received', whtTotal,
  });

  it('relieves the receivable in full and books the withheld tax as a claim, not as cash', () => {
    const lines = buildDefaultPostingLines(receipt('30'))!;
    assert.equal(amountOn(lines, '1210-00', 'creditAmount'), 1070);
    assert.equal(amountOn(lines, '1110-01', 'debitAmount'), 1040);
    // An asset: we later credit it against income tax. Booking it as cash would misstate the bank.
    assert.equal(amountOn(lines, '1270-00', 'debitAmount'), 30);
    assert.equal(sum(lines, 'debitAmount'), sum(lines, 'creditAmount'));
  });

  it('leaves an ordinary receipt on its original two lines', () => {
    const lines = buildDefaultPostingLines(receipt('0'))!;
    assert.equal(lines.length, 2);
    assert.equal(amountOn(lines, '1110-01', 'debitAmount'), 1070);
    assert.equal(amountOn(lines, '1210-00', 'creditAmount'), 1070);
  });
});
