import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateJournalBalance, buildReversalLines, deriveBalance } from './journal-balance.logic.js';

describe('validateJournalBalance', () => {
  it('accepts a balanced two-line entry', () => {
    const result = validateJournalBalance([
      { accountId: 'acc1', debitAmount: '1000.00' },
      { accountId: 'acc2', creditAmount: '1000.00' },
    ]);
    assert.equal(result.isBalanced, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.totalDebit, '1000.0000');
    assert.equal(result.totalCredit, '1000.0000');
  });

  it('rejects single line', () => {
    const result = validateJournalBalance([{ accountId: 'acc1', debitAmount: '500' }]);
    assert.equal(result.isBalanced, false);
    assert.ok(result.errors.length > 0);
  });

  it('rejects unbalanced debit/credit', () => {
    const result = validateJournalBalance([
      { accountId: 'acc1', debitAmount: '1000' },
      { accountId: 'acc2', creditAmount: '900' },
    ]);
    assert.equal(result.isBalanced, false);
    assert.ok(result.errors.some((e) => e.includes('ไม่เท่ากับ')));
  });

  it('rejects line with both debit and credit', () => {
    const result = validateJournalBalance([
      { accountId: 'acc1', debitAmount: '500', creditAmount: '500' },
      { accountId: 'acc2', creditAmount: '500' },
    ]);
    assert.equal(result.isBalanced, false);
    assert.ok(result.errors.some((e) => e.includes('ไม่สามารถมีทั้งเดบิตและเครดิต')));
  });

  it('rejects zero-value line', () => {
    const result = validateJournalBalance([
      { accountId: 'acc1', debitAmount: '0', creditAmount: '0' },
      { accountId: 'acc2', creditAmount: '100' },
    ]);
    assert.equal(result.isBalanced, false);
  });

  it('handles multi-line balanced entries', () => {
    const result = validateJournalBalance([
      { accountId: 'ar',  debitAmount: '1070' },
      { accountId: 'rev', creditAmount: '1000' },
      { accountId: 'vat', creditAmount: '70' },
    ]);
    assert.equal(result.isBalanced, true);
  });

  it('returns false for empty lines', () => {
    const result = validateJournalBalance([]);
    assert.equal(result.isBalanced, false);
  });
});

describe('buildReversalLines', () => {
  it('swaps debit and credit', () => {
    const originals = [
      { accountId: 'acc1', debitAmount: '1000', creditAmount: '0', currency: 'THB' },
      { accountId: 'acc2', debitAmount: '0', creditAmount: '1000', currency: 'THB' },
    ];
    const reversed = buildReversalLines(originals);
    assert.equal(reversed[0]?.creditAmount, '1000');
    assert.equal(reversed[0]?.debitAmount, undefined);
    assert.equal(reversed[1]?.debitAmount, '1000');
    assert.equal(reversed[1]?.creditAmount, undefined);
  });

  it('prefixes description with reversal marker', () => {
    const reversed = buildReversalLines([
      { accountId: 'acc1', debitAmount: '100', creditAmount: '0', currency: 'THB', description: 'ลูกหนี้' },
    ]);
    assert.ok(reversed[0]?.description?.startsWith('[กลับรายการ]'));
  });
});

describe('deriveBalance', () => {
  it('DEBIT-normal returns debit minus credit', () => {
    const bal = deriveBalance('DEBIT', '1500', '500');
    assert.equal(bal, 1000);
  });

  it('CREDIT-normal returns credit minus debit', () => {
    const bal = deriveBalance('CREDIT', '200', '1000');
    assert.equal(bal, 800);
  });

  it('handles numeric inputs', () => {
    const bal = deriveBalance('DEBIT', 100, 100);
    assert.equal(bal, 0);
  });
});
