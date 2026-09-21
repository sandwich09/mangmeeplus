import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BillingAccount, CompanyPlanTerm } from '../../../generated/prisma/client';
import { termProjectionHash } from '../domain/paid-invoice';
import { billingPurchaseSource } from './billing-purchase-source';

const now = new Date('2026-09-21T00:00:00.000Z');
const manual = { companyId: 'company', tierKey: 'BASIC_499', billingReceiptAccountId: null,
  termStartAt: new Date('2026-09-01T00:00:00.000Z'), termEndsAt: new Date('2026-10-01T00:00:00.000Z'),
  branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50, termDisabledAt: null,
  warmupUntil: null, warmupSlipLimit: null, capacityOverride: null } as CompanyPlanTerm;
const empty = { id: 'account', baseSubscriptionId: null, paidThrough: null, termProjectionHash: null, renewalMode: 'NONE' } as BillingAccount;

test('purchase source separates unbilled legacy rows from verified paid and inconsistent mappings', () => {
  assert.equal(billingPurchaseSource(null, null, false, now), 'NO_TERM');
  assert.equal(billingPurchaseSource(null, empty, false, now), 'NO_TERM');
  assert.equal(billingPurchaseSource(manual, empty, false, now), 'ADMIN_MANUAL');
  assert.equal(billingPurchaseSource({ ...manual, tierKey: 'FREE_TRIAL_15' }, empty, false, now), 'TRIAL');
  assert.equal(billingPurchaseSource(manual, empty, true, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource({ ...manual, billingReceiptAccountId: 'another' }, empty, false, now), 'PAID_OTHER_MODE');
  const paid = { ...manual, billingReceiptAccountId: empty.id };
  const account = { ...empty, baseSubscriptionId: 'sub_paid', paidThrough: manual.termEndsAt,
    termProjectionHash: termProjectionHash(paid) };
  assert.equal(billingPurchaseSource(paid, account, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...account, paidThrough: now }, true, now), 'PAID_EXPIRED_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...account, termProjectionHash: 'stale' }, true, now), 'SOURCE_INCONSISTENT');

  // PR #667's one-time purchases leave no subscription behind: the contract is the renewal mode
  // plus the paid term. Without this they would all read SOURCE_INCONSISTENT and could never buy
  // again — neither from the catalog nor through a sales deal.
  const once = { ...account, baseSubscriptionId: null, renewalMode: 'CARD_ONCE' } as BillingAccount;
  assert.equal(billingPurchaseSource(paid, once, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...once, renewalMode: 'PROMPTPAY_ONCE' }, true, now), 'PAID_CURRENT_MODE');
  assert.equal(billingPurchaseSource(paid, { ...once, paidThrough: now }, true, now), 'PAID_EXPIRED_CURRENT_MODE');
  // A QR renewal that has not bound its subscription yet is still incomplete, not a contract.
  assert.equal(billingPurchaseSource(paid, { ...once, renewalMode: 'PROMPTPAY_RENEW' }, true, now), 'SOURCE_INCONSISTENT');
  assert.equal(billingPurchaseSource(paid, { ...once, renewalMode: 'NONE' }, true, now), 'SOURCE_INCONSISTENT');
});
