import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingApprovalMode, canApproveBillingChange } from './billing-approval';

const approval = 'system.billing.approval.approve';
const manage = 'system.billing.refund.manage';
test('only a current platform admin with both capabilities can confirm their own billing change', () => {
  assert.equal(canApproveBillingChange({ platformScope: true, capabilities: [approval, manage] }, 'owner', 'owner', manage), true);
  for (const access of [
    { platformScope: false, capabilities: [approval, manage] },
    { platformScope: true, capabilities: [approval] },
    { platformScope: true, capabilities: [manage] },
    { platformScope: false, capabilities: [] },
  ]) assert.equal(canApproveBillingChange(access, 'owner', 'owner', manage), false);
  assert.equal(canApproveBillingChange({ platformScope: false, capabilities: [approval] }, 'requester', 'reviewer', manage), true);
  assert.equal(canApproveBillingChange({ platformScope: true, capabilities: [manage] }, 'requester', 'reviewer', manage), false);
});
// Purchase without setup PR E (R-E6, DQ7): the admin document/recipient permission follows the
// exact same single-admin rule as refund.manage above — platform + both keys can self-confirm,
// a scoped operator cannot, and a genuine second reviewer always can.
const overrideManage = 'system.billing.override.manage';
test('the admin document/recipient permission (override.manage) follows the same single-admin rule', () => {
  assert.equal(canApproveBillingChange({ platformScope: true, capabilities: [approval, overrideManage] }, 'owner', 'owner', overrideManage), true);
  for (const access of [
    { platformScope: false, capabilities: [approval, overrideManage] },
    { platformScope: true, capabilities: [approval] },
    { platformScope: true, capabilities: [overrideManage] },
    { platformScope: false, capabilities: [] },
  ]) assert.equal(canApproveBillingChange(access, 'owner', 'owner', overrideManage), false);
  assert.equal(canApproveBillingChange({ platformScope: false, capabilities: [approval] }, 'requester', 'reviewer', overrideManage), true);
  assert.equal(canApproveBillingChange({ platformScope: true, capabilities: [overrideManage] }, 'requester', 'reviewer', overrideManage), false);
});

test('evidence names the real approval mode without inventing independent review', () => {
  assert.equal(billingApprovalMode({ initiatorUserId: 'owner', approverUserId: null }), null);
  assert.equal(billingApprovalMode({ initiatorUserId: 'owner', approverUserId: 'owner' }), 'SINGLE_ADMIN');
  assert.equal(billingApprovalMode({ initiatorUserId: 'owner', approverUserId: 'reviewer' }), 'SECOND_REVIEWER');
});
