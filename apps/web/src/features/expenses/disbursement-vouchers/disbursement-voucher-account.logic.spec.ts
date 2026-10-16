import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DISBURSEMENT_VOUCHER_ERROR_WORDS } from '@watchdog-bms/contracts';
import { canRevealDisbursementAccount, disbursementAccountBody, disbursementAccountError, emptyDisbursementAccount, initialDisbursementAccount } from './disbursement-voucher-account.logic';
import type { DisbursementVoucherHeader } from './disbursement-vouchers.model';
test('account checks mirror server digits and bank requirements while accepting spaces, dashes and leading zeroes', () => {
  const fields = { ...emptyDisbursementAccount, payeeBankName: 'กสิกรไทย', payeeAccountNumber: '001-234 5678' };
  assert.equal(disbursementAccountError(fields), null);
  for (const number of ['12345', '123456789012345678901', '0012a3456']) assert.equal(disbursementAccountError({ ...fields, payeeAccountNumber: number }), DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_account_number_invalid);
  assert.equal(disbursementAccountError({ ...fields, payeeBankName: '' }), DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_account_bank_required);
  assert.equal(disbursementAccountError(emptyDisbursementAccount), null);
});
test('draft edits keep the encrypted number on empty input, clear it only explicitly, and send only account fields', () => {
  const stored = initialDisbursementAccount({ payeeBankName: 'กสิกรไทย', payeeAccountName: 'ร้าน ก', payeeAccountLast4: '5678' } as DisbursementVoucherHeader);
  assert.equal(stored.payeeAccountNumber, ''); assert.equal(stored.payeeAccountLast4, '5678');
  assert.deepEqual(disbursementAccountBody(stored), { payeeBankName: 'กสิกรไทย', payeeAccountName: 'ร้าน ก' });
  assert.equal(disbursementAccountError({ ...stored, payeeBankName: '' }), DISBURSEMENT_VOUCHER_ERROR_WORDS.disbursement_account_bank_required);
  assert.deepEqual(disbursementAccountBody({ ...emptyDisbursementAccount, payeeAccountCleared: true }), { payeeBankName: '', payeeAccountName: '', payeeAccountNumber: '' });
  assert.deepEqual(disbursementAccountBody({ ...stored, payeeAccountNumber: '001-234 5678' }), { payeeBankName: 'กสิกรไทย', payeeAccountName: 'ร้าน ก', payeeAccountNumber: '0012345678' });
  assert.deepEqual(disbursementAccountBody(emptyDisbursementAccount), {});
});
test('account reveal follows draft edit rights and the separate prepare-only prefill purpose', () => {
  assert.equal(canRevealDisbursementAccount(['expense.disbursement.approve']), true);
  assert.equal(canRevealDisbursementAccount(['expense.disbursement.pay']), true);
  assert.equal(canRevealDisbursementAccount(['expense.disbursement.prepare'], 'DRAFT'), true);
  for (const status of ['PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED']) assert.equal(canRevealDisbursementAccount(['expense.disbursement.prepare'], status), false);
  assert.equal(canRevealDisbursementAccount(['expense.disbursement.prepare'], 'PAID', true), true);
  assert.equal(canRevealDisbursementAccount(['expense.disbursement.approve'], 'PAID', true), false);
  for (const permissions of [[], ['expense.disbursement.read'], ['expense.disbursement.prepare'], ['expense.disbursement.issue']]) assert.equal(canRevealDisbursementAccount(permissions), false);
});

test('prefill sends only its source, typed number wins, and hidden cash or cheque accounts are omitted', () => {
  const value = { ...emptyDisbursementAccount, payeeBankName: 'ธนาคาร', payeeAccountLast4: '1234', payeeAccountFromVoucherId: 'source' };
  assert.equal(disbursementAccountBody(value).payeeAccountFromVoucherId, 'source');
  assert.equal(disbursementAccountBody({ ...value, payeeAccountNumber: '1234567890' }).payeeAccountFromVoucherId, undefined);
  for (const plannedMethod of ['CASH', 'CHEQUE']) assert.deepEqual(disbursementAccountBody({ ...value, plannedMethod }), {});
});

test('a transfer keeps the account in the saved body; cash and cheque drop it (the method value is BANK_TRANSFER)', () => {
  const fields = { ...emptyDisbursementAccount, payeeBankName: 'กสิกรไทย', payeeAccountName: 'ร้าน ก', payeeAccountNumber: '1234567890' };
  assert.deepEqual(disbursementAccountBody({ ...fields, plannedMethod: 'BANK_TRANSFER' }), disbursementAccountBody(fields));
  assert.notDeepEqual(disbursementAccountBody({ ...fields, plannedMethod: 'BANK_TRANSFER' }), {});
  for (const plannedMethod of ['CASH', 'CHEQUE']) assert.deepEqual(disbursementAccountBody({ ...fields, plannedMethod }), {});
});
