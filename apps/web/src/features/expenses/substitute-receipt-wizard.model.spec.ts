import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mayApproveSubstituteReceipt,
  payeeTaxIdDigits,
  resolveWizardStep,
  validatePayeeIdentity,
} from './substitute-receipt-wizard.model';

test('validates and normalizes substitute-receipt payee identity fields', () => {
  assert.deepEqual(validatePayeeIdentity({
    payeeName: '', payeeAddress: '', payeeTaxId: '', vendorNameSnapshot: 'ผู้ขายเดิม',
  }), {});
  assert.deepEqual(validatePayeeIdentity({
    payeeName: ' ', payeeAddress: 'ก'.repeat(301), payeeTaxId: '123-456', vendorNameSnapshot: null,
  }), {
    payeeName: 'payee_name_required',
    payeeAddress: 'payee_address_too_long',
    payeeTaxId: 'payee_tax_id_13',
  });
  assert.deepEqual(validatePayeeIdentity({
    payeeName: 'ก'.repeat(201), payeeAddress: '', payeeTaxId: '', vendorNameSnapshot: 'ผู้ขายเดิม',
  }), { payeeName: 'payee_name_too_long' });
  assert.equal(payeeTaxIdDigits('1-2345-67890-12-3'), '1234567890123');
  assert.equal(payeeTaxIdDigits('12345678901234').length, 14, 'do not silently cap an incomplete overlong entry');
});

test('resolves the wizard step from evidence status', () => {
  assert.equal(resolveWizardStep(null), 'expense');
  assert.equal(resolveWizardStep({ status: 'PREPARED' }), 'certify');
  assert.equal(resolveWizardStep({ status: 'PAYER_CERTIFIED' }), 'approve');
  assert.equal(resolveWizardStep({ status: 'ISSUED' }), 'done');
  assert.equal(resolveWizardStep({ status: 'SUPERSEDED' }), 'done');
});

test('allows approval of another payer with expense.confirm', () => {
  assert.equal(mayApproveSubstituteReceipt({
    userId: 'approver',
    payerUserId: 'payer',
    canConfirm: true,
    isOwner: false,
    approvalMode: 'DESIGNATED_APPROVERS',
  }), true);
});

test('allows self-approval only for an owner in owner-self mode', () => {
  const input = {
    userId: 'payer',
    payerUserId: 'payer',
    canConfirm: true,
    approvalMode: 'OWNER_SELF' as const,
  };
  assert.equal(mayApproveSubstituteReceipt({ ...input, isOwner: true }), true);
  assert.equal(mayApproveSubstituteReceipt({ ...input, isOwner: false }), false);
  assert.equal(mayApproveSubstituteReceipt({
    ...input,
    isOwner: true,
    approvalMode: 'DESIGNATED_APPROVERS',
  }), false);
  assert.equal(mayApproveSubstituteReceipt({ ...input, canConfirm: false, isOwner: true }), false);
});
