import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BILLING_DRAFT_POLICY, billingOffer } from '@watchdog-bms/contracts';
import { BillingCollection } from './billing-collection';
import type { BillingAccount } from '../../../generated/prisma/client';
import type { RequestContext } from '../../auth/domain/models/request-context.model';

// Focused worker fault checks. Full HTTP/PG/browser coverage lives in billing-collection-smoke.
function fixture(expired = false, promptPayRenew = false, advanceCardTrial = false, eventDiscountTrial = false, promotionTrial = false) {
  const end = new Date(Date.now() + (expired ? -1 : 1) * 86400000); end.setMilliseconds(0);
  const account = { id: 'account', companyId: 'company', stripeAccountId: 'acct_test', livemode: false, customerId: 'cus_test',
    baseSubscriptionId: 'sub_test', paidThrough: end, version: 1, termProjectionHash: 'paid-term', activeAttemptId: null,
    activeCollectionOperationId: null, leaseToken: 'lease', leaseUntil: new Date(Date.now() + 60000),
    renewalMode: promptPayRenew ? 'PROMPTPAY_RENEW' : 'CARD_AUTO' } as unknown as BillingAccount;
  const sub: Record<string, any> = { id: 'sub_test', object: 'subscription', customer: 'cus_test', livemode: false, metadata: { billingAccountId: 'account' },
    status: expired ? 'past_due' : promptPayRenew || advanceCardTrial || eventDiscountTrial || promotionTrial ? 'trialing' : 'active', billing_mode: { type: 'classic' },
    collection_method: promptPayRenew ? 'send_invoice' : 'charge_automatically',
    payment_settings: promptPayRenew ? { payment_method_types: ['promptpay'] } : undefined, cancel_at_period_end: false,
    items: { data: [{ price: 'price_ProYear', quantity: 1, current_period_start: Math.floor(end.getTime() / 1000) - 365 * 86400, current_period_end: end.getTime() / 1000 }] } };
  const policy = { ...BILLING_DRAFT_POLICY, priceIds: { 'PRO_999:year': 'price_ProYear' } };
  let operation: Record<string, any>, companyHeld = false, gateOpen = true, lost = false, writes = 0;
  const tx = {
    $queryRaw: async () => [], company: { findUnique: async () => ({ status: companyHeld ? 'DISABLED' : 'ACTIVE', planTerm: null }) },
    billingSubscriptionContract: { findFirst: async () => ({ snapshotJson: { policy, priceId: 'price_ProYear',
      quote: { offer: billingOffer('PRO_999', 'year'), totalSatang: 999000, purchaseMode: promptPayRenew ? 'PROMPTPAY_RENEW' : 'CARD_AUTO' },
      ...(advanceCardTrial ? { advanceDeal: { firstCycleEndsAt: end.toISOString() } } : {}),
      ...(eventDiscountTrial ? { eventDiscount: { choice: 'USE' } } : {}),
      ...(promotionTrial ? { promotion: { campaignId: 'promo-test', bonusMonths: 1, bonusReceiptUnits: 30 } } : {}) } }) },
    billingOperation: {
      create: async ({ data }: any) => (operation = { ...data, id: 'operation', state: 'PREVIEW', version: 1, resultJson: null, errorCode: null, observedAt: null }),
      findFirstOrThrow: async () => operation,
      findFirst: async () => operation, findUniqueOrThrow: async () => operation, findUnique: async () => null,
      updateMany: async ({ data }: any) => { Object.assign(operation, { ...data, version: operation.version + 1 }); return { count: 1 }; },
      update: async ({ data }: any) => { const next = { ...data, version: operation.version + 1 }; Object.assign(operation, next); return operation; },
    },
    billingAccount: {
      findUniqueOrThrow: async () => account,
      update: async ({ data }: any) => { Object.assign(account, { ...data, version: account.version + 1 }); return account; },
    },
    billingIssue: { updateMany: async () => ({ count: 1 }) }, auditLog: { create: async () => ({}) },
  };
  const service = new BillingCollection({ client: { ...tx, $transaction: async (run: any) => run(tx) } } as unknown as ConstructorParameters<typeof BillingCollection>[0],
    { accountId: 'acct_test', livemode: false, assertAccount: async () => {}, list: async () => [sub],
      request: async (method: string, path: string, params: any, key: string) => {
        assert.equal(path, '/subscriptions/sub_test');
        if (method !== 'GET') {
          writes++; assert.equal(key, 'mm:collection:operation');
          if (method === 'DELETE') { assert.deepEqual(params, { prorate: false, invoice_now: false }); sub.status = 'canceled'; }
          else { sub.cancel_at_period_end = params.cancel_at_period_end; sub.cancel_at = params.cancel_at_period_end ? end.getTime() / 1000 : null;
            Object.assign(sub.metadata, params.metadata); }
          if (lost) throw new Error('response lost after commit');
        }
        return structuredClone(sub);
      } } as unknown as ConstructorParameters<typeof BillingCollection>[1],
    { assertOwner: async () => {}, account: async () => account, settings: async () => ({ gates: { portal_cancel_subscription: gateOpen } }),
      issue: async () => {}, assertTaxSettings: async () => {} } as unknown as ConstructorParameters<typeof BillingCollection>[2]);
  return { service, sub, account, operation: () => operation!, writes: () => writes,
    hold: () => { companyHeld = true; }, close: () => { gateOpen = false; }, lose: () => { lost = true; },
    queue: async () => {
      await service.preview({ companyId: 'company', userId: 'owner' } as RequestContext, 'CANCEL_RENEWAL');
      operation!.state = 'QUEUED'; account.activeCollectionOperationId = 'operation';
    } };
}

test('overdue cancellation deletes without final invoice/proration and recovers lost response without changing paid expiry', async () => {
  const f = fixture(true), end = f.account.paidThrough;
  await f.queue(); assert.equal(f.operation().proposedJson.method, 'DELETE');
  f.lose(); await f.service.advance(f.account, 'lease'); assert.equal(f.operation().state, 'UNKNOWN');
  await f.service.advance(f.account, 'lease'); assert.equal(f.operation().state, 'SUCCEEDED');
  assert.equal(f.writes(), 1); assert.equal(f.account.paidThrough, end); assert.equal(f.account.nextChargeAt, null);
});

test('a completed scheduled cancellation is observed even when recovery runs after Stripe terminates the subscription', async () => {
  const f = fixture(); await f.queue(); f.lose(); await f.service.advance(f.account, 'lease');
  assert.equal(f.operation().state, 'UNKNOWN'); f.sub.status = 'canceled'; f.sub.cancel_at = null; f.sub.cancel_at_period_end = false;
  await f.service.advance(f.account, 'lease'); assert.equal(f.operation().state, 'SUCCEEDED'); assert.equal(f.writes(), 1);
});

test('PromptPay invoice subscription can stop its next bill without charging a saved card', async () => {
  const f = fixture(false, true);
  await f.queue();
  assert.equal(f.operation().proposedJson.params.cancel_at_period_end, true);
  await f.service.advance(f.account, 'lease');
  assert.equal(f.operation().state, 'SUCCEEDED');
  assert.equal(f.sub.collection_method, 'send_invoice');
  assert.deepEqual(f.sub.payment_settings.payment_method_types, ['promptpay']);
  assert.equal(f.account.nextChargeAt, null);
});

test('prepaid card deal trial can stop the next charge while keeping the paid term', async () => {
  const f = fixture(false, false, true), paidThrough = f.account.paidThrough;
  await f.queue();
  assert.equal(f.operation().proposedJson.params.cancel_at_period_end, true);
  await f.service.advance(f.account, 'lease');
  assert.equal(f.operation().state, 'SUCCEEDED');
  assert.equal(f.sub.status, 'trialing');
  assert.equal(f.account.paidThrough, paidThrough);
  assert.equal(f.account.nextChargeAt, null);
});

test('SD-O13: a card trialing through its discounted first period can stop the first full-price charge and keeps the paid term', async () => {
  const f = fixture(false, false, false, true), paidThrough = f.account.paidThrough;
  await f.queue();
  assert.equal(f.operation().proposedJson.params.cancel_at_period_end, true);
  await f.service.advance(f.account, 'lease');
  assert.equal(f.operation().state, 'SUCCEEDED');
  assert.equal(f.sub.status, 'trialing'); assert.equal(f.sub.cancel_at_period_end, true);
  assert.equal(f.account.paidThrough, paidThrough);
  assert.equal(f.account.nextChargeAt, null);
  // A card subscription trialing for any other reason is still refused here.
  const other = fixture(); other.sub.status = 'trialing';
  await assert.rejects(other.service.preview({ companyId: 'company', userId: 'owner' } as RequestContext, 'CANCEL_RENEWAL'));
});

// Promotion spec §7: the bound subscription trials to `benefitEnd` (= `paidThrough`); stopping keeps the paid and the free time,
// resuming adds nothing — for a saved card and for a PromptPay invoice subscription alike.
for (const promptPay of [false, true]) test(`promotion ${promptPay ? 'PROMPTPAY_RENEW' : 'CARD_AUTO'}: renewal can be stopped and resumed while the subscription trials to the end of the free time`, async () => {
  const f = fixture(false, promptPay, false, false, true), benefitEnd = f.account.paidThrough, context = { companyId: 'company', userId: 'owner' } as RequestContext;
  await f.queue();
  assert.deepEqual([f.operation().proposedJson.method, f.operation().proposedJson.params.cancel_at_period_end], ['POST', true]);
  await f.service.advance(f.account, 'lease');
  assert.equal(f.operation().state, 'SUCCEEDED');
  assert.deepEqual([f.sub.status, f.sub.cancel_at_period_end, f.sub.cancel_at], ['trialing', true, benefitEnd!.getTime() / 1000]);
  assert.deepEqual([f.account.paidThrough, f.account.nextChargeAt, f.account.cancelAtPeriodEnd], [benefitEnd, null, true]);

  await f.service.preview(context, 'RESUME_RENEWAL');
  assert.equal(f.operation().proposedJson.params.cancel_at_period_end, false);
  f.operation().state = 'QUEUED'; f.account.activeCollectionOperationId = 'operation';
  await f.service.advance(f.account, 'lease');
  assert.equal(f.operation().state, 'SUCCEEDED');
  assert.deepEqual([f.sub.status, f.sub.cancel_at_period_end, f.sub.cancel_at], ['trialing', false, null]);
  assert.deepEqual([f.account.paidThrough, f.account.nextChargeAt, f.account.cancelAtPeriodEnd], [benefitEnd, benefitEnd, false], 'the first charge is back at the end of the free time');
  assert.equal(f.writes(), 2);
});

test('old ambiguous command never posts again without an observed result', async () => {
  const f = fixture(); await f.queue();
  f.operation().resultJson = { startedAt: new Date(Date.now() - 24 * 3600000).toISOString() };
  await f.service.advance(f.account, 'lease'); assert.equal(f.operation().state, 'UNKNOWN'); assert.equal(f.writes(), 0);
  assert.equal(f.account.activeCollectionOperationId, 'operation');
});

test('a hold or closed action gate appearing after confirmation prevents external mutation', async () => {
  for (const gate of [false, true]) {
    const f = fixture(); await f.queue(); if (gate) f.close(); else f.hold();
    await f.service.advance(f.account, 'lease'); assert.equal(f.operation().state, 'BLOCKED'); assert.equal(f.writes(), 0);
    assert.equal(f.operation().resultJson.startedAt, undefined);
  }
});

test('a stale worker lease cannot mutate the provider or release another command reservation', async () => {
  const f = fixture(); await f.queue();
  await assert.rejects(f.service.advance(f.account, 'wrong-lease'));
  assert.equal(f.writes(), 0); assert.equal(f.account.activeCollectionOperationId, 'operation'); assert.equal(f.operation().state, 'QUEUED');
});


test('an unresolved email-recipient update does not block preview, confirmation or dispatch of renewal cancellation', async () => {
  const f = fixture(); f.account.activeEmailOperationId = 'unknown-email-operation';
  // No worker is currently running; its unresolved email reservation remains in place.
  f.account.leaseUntil = null;
  const context = { companyId: 'company', userId: 'owner' } as RequestContext;
  const preview = await f.service.preview(context, 'CANCEL_RENEWAL');
  await f.service.submit(context, preview.id, preview.version, preview.previewHash, 'cancel-renewal-while-email-pending');
  assert.equal(f.account.activeCollectionOperationId, preview.id);
  f.account.leaseUntil = new Date(Date.now() + 60_000);
  await f.service.advance(f.account, 'lease');
  assert.equal(f.operation().state, 'SUCCEEDED'); assert.equal(f.writes(), 1);
  assert.equal(f.account.activeEmailOperationId, 'unknown-email-operation');
});

test('a paid prepaid plan change shows its real start date and cannot be withdrawn', async () => {
  const f = fixture(), context = { companyId: 'company', userId: 'owner' } as RequestContext;
  const row = await f.service.preview(context, 'CANCEL_RENEWAL');
  const operation = f.operation(), effectiveAt = new Date(Date.now() + 86_400_000).toISOString();
  operation.type = 'CUSTOMER_PREPAID_PLAN_CHANGE'; operation.state = 'BLOCKED'; operation.resultJson = null;
  operation.proposedJson = { ...operation.proposedJson, action: 'PREPAID_PLAN_CHANGE', effectiveAt,
    paidThrough: new Date(Date.now() + 32 * 86_400_000).toISOString() };
  f.account.leaseUntil = null;
  const view = f.service.view(operation as any, 'owner');
  assert.equal(view.effectiveAt, effectiveAt); assert.deepEqual(view.allowedActions, []);
  await assert.rejects(f.service.withdraw(context, row.id, operation.version));
  assert.equal(operation.state, 'BLOCKED');
});
