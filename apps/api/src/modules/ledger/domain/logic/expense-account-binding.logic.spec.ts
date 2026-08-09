import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from 'decimal.js';
import { resolveExpenseDebits, type ExpenseAccountBindings } from './expense-account-binding.logic';

const bindings = (pairs: Array<[string, string]>): ExpenseAccountBindings => ({
  expenseByCategoryId: new Map(pairs),
  accountsPayableCode: '2120-01',
  employeePayableCode: '2131-09',
  });

const sum = (debits: Array<{ amount: string }>) =>
  debits.reduce((total, debit) => total.add(debit.amount), new Decimal(0)).toFixed(4);

describe('resolveExpenseDebits', () => {
  it('books each line to the reviewed account of its category', () => {
    const result = resolveExpenseDebits({
      totalToAllocate: '1000.0000',
      lines: [
        { expenseCategoryId: 'cat-fuel', netAmount: '600' },
        { expenseCategoryId: 'cat-phone', netAmount: '400' },
      ],
      bindings: bindings([['cat-fuel', '5320-01'], ['cat-phone', '5330-01']]),
    });

    assert.ok(result.ok);
    assert.deepEqual(result.debits, [
      { accountCode: '5320-01', amount: '600.0000' },
      { accountCode: '5330-01', amount: '400.0000' },
    ]);
  });

  it('merges lines that share one category into a single debit', () => {
    const result = resolveExpenseDebits({
      totalToAllocate: '300',
      lines: [
        { expenseCategoryId: 'cat-fuel', netAmount: '100' },
        { expenseCategoryId: 'cat-fuel', netAmount: '200' },
      ],
      bindings: bindings([['cat-fuel', '5320-01']]),
    });

    assert.ok(result.ok);
    assert.deepEqual(result.debits, [{ accountCode: '5320-01', amount: '300.0000' }]);
  });

  // The case the proportional split exists for: unclaimable input VAT is zeroed out of taxTotal, so
  // the expense total stays gross while the line net amounts remain ex-VAT. Summing the lines would
  // under-debit by exactly the VAT and leave the journal unbalanced.
  it('still totals the full expense when line nets are ex-VAT but the total is gross', () => {
    const result = resolveExpenseDebits({
      totalToAllocate: '1070.0000',
      lines: [
        { expenseCategoryId: 'cat-fuel', netAmount: '600' },
        { expenseCategoryId: 'cat-phone', netAmount: '400' },
      ],
      bindings: bindings([['cat-fuel', '5320-01'], ['cat-phone', '5330-01']]),
    });

    assert.ok(result.ok);
    assert.equal(sum(result.debits), '1070.0000');
  });

  // A third of 100 does not divide into 4dp. Whatever the rounding does per line, the debits must
  // re-total exactly or the journal fails validateJournalBalance.
  it('absorbs the rounding residual so the debits re-total exactly', () => {
    const result = resolveExpenseDebits({
      totalToAllocate: '100',
      lines: [
        { expenseCategoryId: 'a', netAmount: '1' },
        { expenseCategoryId: 'b', netAmount: '1' },
        { expenseCategoryId: 'c', netAmount: '1' },
      ],
      bindings: bindings([['a', '5320-01'], ['b', '5330-01'], ['c', '5370-06']]),
    });

    assert.ok(result.ok);
    assert.equal(sum(result.debits), '100.0000');
  });

  it('names every unmapped category instead of guessing an account', () => {
    const result = resolveExpenseDebits({
      totalToAllocate: '100',
      lines: [
        { expenseCategoryId: 'cat-fuel', netAmount: '50' },
        { expenseCategoryId: 'cat-unmapped', netAmount: '50' },
      ],
      bindings: bindings([['cat-fuel', '5320-01']]),
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, 'expense_account_unmapped:cat-unmapped');
  });

  it('reports a line carrying no category at all', () => {
    const result = resolveExpenseDebits({
      totalToAllocate: '100',
      lines: [{ expenseCategoryId: null, netAmount: '100' }],
      bindings: bindings([['cat-fuel', '5320-01']]),
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, 'expense_account_unmapped:no_category');
  });

  it('refuses to apportion a non-zero expense over zero-value lines', () => {
    const result = resolveExpenseDebits({
      totalToAllocate: '100',
      lines: [{ expenseCategoryId: 'cat-fuel', netAmount: '0' }],
      bindings: bindings([['cat-fuel', '5320-01']]),
    });

    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.error, 'expense_allocation_base_zero');
  });

  it('returns no debits for a zero-value expense rather than dividing by zero', () => {
    const result = resolveExpenseDebits({
      totalToAllocate: '0',
      lines: [{ expenseCategoryId: 'cat-fuel', netAmount: '0' }],
      bindings: bindings([['cat-fuel', '5320-01']]),
    });

    assert.ok(result.ok);
    assert.deepEqual(result.debits, []);
  });
});
