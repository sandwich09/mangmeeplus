import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BillingAccount } from '../../../generated/prisma/client';
import { canConvertDealSubscription, dealSubscriptionCancelled, type DealSubscriptionCancelSource } from './billing-deal-subscription-cancel';

const account = { id: 'account_1', customerId: 'cus_1', livemode: false } as BillingAccount;
const source: DealSubscriptionCancelSource = { accountId: account.id, subscriptionId: 'sub_1', dealRequestId: 'deal_1', attemptId: 'attempt_1' };
const subscription = (over: Record<string, unknown> = {}) => ({
  id: source.subscriptionId, object: 'subscription', livemode: false, customer: account.customerId,
  metadata: { billingAccountId: account.id }, status: 'canceled', ...over,
});

test('a deal conversion releases its reservation only after the exact old subscription is canceled', () => {
  assert.equal(dealSubscriptionCancelled(source, account, subscription()), true);
  assert.equal(dealSubscriptionCancelled(source, account, subscription({ status: 'active' })), false);
  assert.equal(dealSubscriptionCancelled(source, account, subscription({ id: 'sub_other' })), false);
  assert.equal(dealSubscriptionCancelled(source, account, subscription({ customer: 'cus_other' })), false);
  assert.equal(dealSubscriptionCancelled(source, account, subscription({ metadata: { billingAccountId: 'account_other' } })), false);
});

test('only a healthy live CARD_AUTO subscription may enter a deal conversion', () => {
  const now = new Date('2026-09-22T00:00:00.000Z');
  const active = { baseSubscriptionId: 'sub_1', renewalMode: 'CARD_AUTO', subscriptionState: 'active',
    paidThrough: new Date('2026-10-01T00:00:00.000Z'), cancelAtPeriodEnd: false, graceEndsAt: null } as BillingAccount;
  assert.equal(canConvertDealSubscription(active, now), true);
  assert.equal(canConvertDealSubscription({ ...active, renewalMode: 'PROMPTPAY_RENEW' }, now), false);
  assert.equal(canConvertDealSubscription({ ...active, paidThrough: now }, now), false);
  assert.equal(canConvertDealSubscription({ ...active, cancelAtPeriodEnd: true }, now), false);
  assert.equal(canConvertDealSubscription({ ...active, graceEndsAt: now }, now), false);
});
