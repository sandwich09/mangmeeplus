import assert from 'node:assert/strict';
import { test } from 'node:test';
import { skipSingleExpenseSelection, amountError, cleanAmountInput, groupAmountInput, initialAmount, lockOtherBranchRows, nextDraftCommand, payeeRule, selectionAllowed, selectedTotal } from './disbursement-voucher-form.logic';
import type { DisbursementPayableExpense } from '@watchdog-bms/contracts';
const row = (key: string, kind: 'TAX_ID' | 'NAME' | null, tax: string | null = null) => ({ payeeKey: key, payeeKeyKind: kind, vendorTaxId: tax }) as DisbursementPayableExpense;
test('payee mirror uses server keys: matching tax, matching names without tax, and explicit confirmation', () => {
  assert.equal(payeeRule([row('tax', 'TAX_ID', '0123'), row('tax', 'TAX_ID', '๐๑๒๓')]), 'none');
  assert.equal(payeeRule([row('name', 'NAME'), row('name', 'NAME', ' ')]), 'warning');
  for (const rows of [[row('a', 'NAME'), row('b', 'NAME')], [row('a', 'NAME'), row('a', 'NAME', '123')], [row('a', 'TAX_ID', '123'), row('b', 'NAME')], [row('a', null), row('b', null)]]) assert.equal(payeeRule(rows), 'confirm');
  assert.equal(payeeRule([]), 'none');
  assert.equal(payeeRule([row('a', null)]), 'none');
});
test('amounts must be positive with at most two decimals and never exceed rounded outstanding', () => {
  for (const value of ['', '0', '01', '00.2', '-1', '1.001', '1e2', 'NaN', '1,000', ' 1 ', '1.25']) assert.ok(amountError(value, '1.2399'));
  for (const value of ['1', '1.2', '1.23', '1.24']) assert.equal(amountError(value, '1.2399'), null);
  assert.equal(amountError('99999999999999.99', '99999999999999.9999'), null);
  assert.equal(initialAmount('1.2399'), '1.24');
  assert.equal(initialAmount('104.0000'), '104.00');
  assert.equal(selectedTotal(['0.10', '0.20', '99999999999999.99']), '100000000000000.29');
});
test('twenty selected rows fit and the twenty-first is refused without losing the existing selection', () => {
  assert.equal(selectionAllowed(29), true);
  assert.equal(selectionAllowed(30), false);
});
test('command id is reused on unchanged retries and renewed on every form change including changing back', () => {
  let serial = 0; const mint = () => `command-${++serial}`;
  let id = nextDraftCommand(null, false, mint);
  assert.equal(nextDraftCommand(id, false, mint), id);
  id = nextDraftCommand(id, true, mint);
  assert.equal(id, 'command-2');
  assert.equal(nextDraftCommand(id, true, mint), 'command-3');
});
test('an amount refusal says which of the two things is wrong, and typed separators are dropped rather than refused', () => {
  assert.equal(amountError('abc', '4000.0000'), 'พิมพ์ยอดเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง เช่น 1500 หรือ 1500.50');
  assert.equal(amountError('', '4000.0000'), amountError('1.234', '4000.0000'));
  for (const value of ['0', '4000.01']) assert.equal(amountError(value, '4000.0000'), 'ยอดต้องมากกว่า 0 และไม่เกินยอดค้างจ่าย 4,000.00 บาท');
  assert.equal(cleanAmountInput(' ฿1,234.50 '), '1234.50');
  assert.equal(amountError(cleanAmountInput('1,000'), '4000.0000'), null);
  // While its box is not being typed in, a stored amount reads with commas; what is not a plain number is shown as typed.
  assert.deepEqual(['19400.00', '999', '1000', '1234567.5', '', 'abc', '12.'].map(groupAmountInput), ['19,400.00', '999', '1,000', '1,234,567.5', '', 'abc', '12.']);
});
test('once a line is chosen, unchosen lines of another branch are locked with the one-branch sentence', () => {
  const rows = [{ expenseId: 'a', branchId: 'ho', selectable: true }, { expenseId: 'b', branchId: 'siam', selectable: true }, { expenseId: 'c', branchId: null, selectable: true }] as DisbursementPayableExpense[];
  assert.deepEqual(lockOtherBranchRows(rows, {}, null), { rows, reasons: {} });
  const locked = lockOtherBranchRows(rows, { a: '1.00' }, 'ho');
  assert.deepEqual(locked.rows.map(row => row.selectable), [true, false, true]);
  assert.deepEqual(locked.reasons, { b: 'อยู่คนละสาขากับรายการที่เลือกไว้ หนึ่งใบรวมได้เฉพาะรายการของสาขาเดียว' });
  assert.deepEqual(lockOtherBranchRows(rows, { a: '1.00', b: '1.00' }, 'ho').reasons, {});
});

test('only an eligible source expense with one eligible candidate skips selection', () => {
  const entry = { expenseId: 'a', payeeKey: 'payee', selectable: true } as DisbursementPayableExpense;
  const second = { ...entry, expenseId: 'b' };
  assert.equal(skipSingleExpenseSelection(entry, [entry]), true);
  assert.equal(skipSingleExpenseSelection(entry, [entry, { ...second, selectable: false }]), true);
  assert.equal(skipSingleExpenseSelection(entry, [entry, second]), false);
  assert.equal(skipSingleExpenseSelection(entry, [entry, { ...second, payeeKey: 'another' }]), true);
  assert.equal(skipSingleExpenseSelection(null, [entry]), false);
  assert.equal(skipSingleExpenseSelection({ ...entry, selectable: false }, [{ ...entry, selectable: false }]), false);
});

test('legacy four-decimal balances round half up and allow full settlement in 3000 seeded cases', () => {
  assert.equal(initialAmount('2209780.6682'), '2209780.67');
  assert.equal(amountError('2209780.67', '2209780.6682'), null);
  let seed = 614;
  for (let i = 0; i < 3000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const units = BigInt(seed + 10000), cents = (units + 50n) / 100n;
    const outstanding = `${units / 10000n}.${String(units % 10000n).padStart(4, '0')}`;
    const expected = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
    assert.equal(initialAmount(outstanding), expected);
    assert.equal(amountError(expected, outstanding), null);
    const tooMuch = `${(cents + 1n) / 100n}.${String((cents + 1n) % 100n).padStart(2, '0')}`;
    assert.ok(amountError(tooMuch, outstanding));
  }
});
