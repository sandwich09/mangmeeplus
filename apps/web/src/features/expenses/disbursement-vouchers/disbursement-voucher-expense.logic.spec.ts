import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExpenseDetail } from '../expenses.model';
import { canAddExpenseToDisbursement, expenseDisbursementPaymentAction, expenseDisbursementCancellationWarnings, expenseDisbursementCancellationToast } from './disbursement-voucher-expense.logic';

test('prepare entry needs the right, visible menu, confirmed balance and no reservation', () => {
  const detail = { status: 'CONFIRMED', outstandingAmount: '0.0001', correctionCapabilities: { disbursementReservation: null } } as ExpenseDetail;
  assert.equal(canAddExpenseToDisbursement(detail, ['expense.disbursement.prepare'], true), true);
  assert.equal(canAddExpenseToDisbursement(detail, [], true), false);
  assert.equal(canAddExpenseToDisbursement(detail, ['expense.disbursement.prepare'], false), false);
  for (const status of ['DRAFT', 'READY_FOR_REVIEW', 'VOIDED']) assert.equal(canAddExpenseToDisbursement({ ...detail, status } as ExpenseDetail, ['expense.disbursement.prepare'], true), false);
  assert.equal(canAddExpenseToDisbursement({ ...detail, outstandingAmount: '0.0000' }, ['expense.disbursement.prepare'], true), false);
  assert.equal(canAddExpenseToDisbursement({ ...detail, correctionCapabilities: { ...detail.correctionCapabilities!, disbursementReservation: { voucherId: null, documentNumber: 'DV-1', preparerName: null, viewerMay: 'none', viewerCanPay: false } } }, ['expense.disbursement.prepare'], true), false);
});

test('cancellation warns only that the document will be cancelled and uses the short document toast', () => {
  const payments = [{ id: 'payment', status: 'RECORDED', disbursementVoucher: { id: 'voucher', documentNumber: 'DV-1' } }] as NonNullable<ExpenseDetail['payments']>;
  const prefix = 'ยกเลิกรายการจ่ายนี้ แล้วใบสำคัญจ่ายเลขที่ DV-1 จะถูกยกเลิกด้วย';
  assert.deepEqual(expenseDisbursementCancellationWarnings(payments, {}, 'expense', 'payment'), [prefix]);
  const vouchers = { voucher: { lines: [{ expenseId: 'expense', expensePaymentId: 'payment', paymentInEffect: true }] } } as any;
  assert.deepEqual(expenseDisbursementCancellationWarnings(payments, vouchers, 'expense', 'payment'), [prefix]);
  vouchers.voucher.lines.push({ expenseId: 'other', expensePaymentId: 'other-payment', paymentInEffect: true });
  assert.deepEqual(expenseDisbursementCancellationWarnings(payments, vouchers, 'expense', 'payment'), [prefix]);
  assert.deepEqual(expenseDisbursementCancellationWarnings(payments, vouchers, 'expense'), [prefix]);
  vouchers.voucher.lines[1].paymentInEffect = false;
  assert.deepEqual(expenseDisbursementCancellationWarnings(payments, vouchers, 'expense'), [prefix]);
  assert.equal(expenseDisbursementCancellationToast('ยกเลิกแล้ว', payments, 'payment'), 'ยกเลิกรายการจ่ายแล้ว ใบสำคัญจ่ายเลขที่ DV-1 ถูกยกเลิกด้วย');
  assert.equal(expenseDisbursementCancellationToast('ยกเลิกแล้ว', payments, 'other-payment'), 'ยกเลิกแล้ว');
});
test('payment entries use server eligibility and never offer a command without rights or a visible menu', () => {
  const payment = { status: 'RECORDED', canIssueDisbursementVoucher: true, disbursementVoucher: null } as NonNullable<ExpenseDetail['payments']>[number];
  assert.equal(expenseDisbursementPaymentAction(payment, ['expense.disbursement.issue'], true), 'issue');
  assert.equal(expenseDisbursementPaymentAction(payment, [], true), 'none');
  assert.equal(expenseDisbursementPaymentAction(payment, ['expense.disbursement.issue'], false), 'none');
  assert.equal(expenseDisbursementPaymentAction({ ...payment, canIssueDisbursementVoucher: false }, ['expense.disbursement.issue'], true), 'none');
  assert.equal(expenseDisbursementPaymentAction({ ...payment, status: 'VOIDED' }, ['expense.disbursement.issue'], true), 'none');
  const linked = { ...payment, disbursementVoucher: { id: 'voucher', documentNumber: 'DV-1' } };
  assert.equal(expenseDisbursementPaymentAction(linked, ['expense.disbursement.read'], true), 'view');
  assert.equal(expenseDisbursementPaymentAction(linked, [], true), 'notice');
  assert.equal(expenseDisbursementPaymentAction(linked, ['expense.disbursement.read'], false), 'view');
  assert.equal(expenseDisbursementPaymentAction({ ...linked, disbursementVoucher: { id: null, documentNumber: 'DV-1' } }, ['expense.disbursement.read'], true), 'notice');
});
