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
test('only approval or payment permission offers account reveal, independently of the document action state', () => {
  assert.equal(canRevealDisbursementAccount(['expense.disbursement.approve']), true);
  assert.equal(canRevealDisbursementAccount(['expense.disbursement.pay']), true);
  for (const permissions of [[], ['expense.disbursement.read'], ['expense.disbursement.prepare'], ['expense.disbursement.issue']]) assert.equal(canRevealDisbursementAccount(permissions), false);
});
