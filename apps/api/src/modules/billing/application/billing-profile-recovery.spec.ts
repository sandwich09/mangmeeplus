import { it } from 'node:test';
import assert from 'node:assert/strict';
import { companyBillingProfile } from '@watchdog-bms/contracts';
import { BillingReconcilerService } from './billing-reconciler.service';
import { stripeCustomerSyncPayload, stripeCustomerSynced } from './billing-company-profile';

function harness(quote: Record<string, unknown>) {
  const account = { id: 'account', companyId: 'company', customerId: 'cus_test', activeAttemptId: 'attempt', leaseToken: 'lease', leaseUntil: new Date(Date.now() + 60_000) };
  const attempt = { id: 'attempt', status: 'UNKNOWN', checkoutSessionId: null, quoteSnapshot: { quote },
    collectionJson: { profileSync: { startedAt: new Date(Date.now() - 61_000).toISOString(), customerId: 'cus_test', confirmed: false } } };
  const calls: unknown[][] = [], writes: string[] = [];
  const state = { unavailable: false, customer: { id: 'cus_test', metadata: { billingAccountId: 'account' } } as Record<string, unknown> };
  const tx = { $queryRaw: async () => [], billingAccount: { findUniqueOrThrow: async () => account,
    updateMany: async () => { writes.push('release'); return { count: 1 }; } },
    billingAttempt: { updateMany: async (input: any) => { assert.equal(input.data.status, 'FAILED');
      assert.deepEqual(input.where.collectionJson.equals, attempt.collectionJson); writes.push('fail'); return { count: 1 }; } },
    billingIssue: { updateMany: async () => { writes.push('resolve'); return { count: 1 }; } } };
  const prisma = { client: { $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
  const stripe = { request: async (...args: unknown[]) => { calls.push(args); if (state.unavailable) throw new Error('unavailable'); return state.customer; } };
  const reconciler = new BillingReconcilerService(prisma as any, {} as any, stripe as any, {} as any, {} as any);
  const settle = (row: unknown) => (reconciler as any).settleProfileSync(account, row, 'lease');
  return { attempt, calls, writes, state, settle };
}

it('settles only the original pre-payment profile write before releasing a failed purchase', async () => {
  const quote = { billingProfile: companyBillingProfile({ name: 'ร้านทดสอบ', addressJson: { line1: '99', subdistrict: 'คลองเตย',
    district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } }), billingEmail: null, companyName: 'ร้านทดสอบ' };
  const { attempt, calls, writes, state, settle } = harness(quote);
  state.customer = { ...state.customer, ...stripeCustomerSyncPayload({ quote }) };
  assert.equal(await settle({ ...attempt, collectionJson: null }), false);
  assert.equal(await settle({ ...attempt, checkoutSessionId: 'cs_paid' }), false);
  assert.equal(await settle({ ...attempt, collectionJson: { profileSync: { ...attempt.collectionJson.profileSync, confirmed: true } } }), false);
  assert.equal(await settle({ ...attempt, collectionJson: { profileSync: { ...attempt.collectionJson.profileSync, startedAt: new Date().toISOString() } } }), true);
  assert.equal(calls.length, 0); assert.equal(writes.length, 0);
  state.unavailable = true; await assert.rejects(settle(attempt)); assert.equal(writes.length, 0);
  state.unavailable = false; calls.length = 0;
  assert.equal(await settle(attempt), true);
  // The replay carries exactly the bytes the checkout first sent under the same idempotency key (R-A2).
  assert.deepEqual(calls, [['GET', '/customers/cus_test'], ['POST', '/customers/cus_test', stripeCustomerSyncPayload({ quote }), 'mm:attempt:billing-profile']]);
  assert.deepEqual(writes, ['fail', 'release', 'resolve']);
  calls.length = 0;
  await assert.rejects(settle({ ...attempt, collectionJson: { profileSync: { ...attempt.collectionJson.profileSync,
    startedAt: new Date(Date.now() - 24 * 3600000).toISOString() } } }));
  assert.equal(calls.length, 0, 'never replay an ambiguous command outside the provider idempotency window');
});

it('an incomplete profile syncs the name only and accepts the address Stripe Checkout stored (RV16)', async () => {
  const quote = { billingProfile: companyBillingProfile({ name: 'ร้านไม่มีที่อยู่', addressJson: {} }), billingEmail: null, companyName: 'ร้านไม่มีที่อยู่' };
  const payload = stripeCustomerSyncPayload({ quote });
  assert.deepEqual(payload, { name: 'ร้านไม่มีที่อยู่' });
  const { attempt, calls, writes, state, settle } = harness(quote);
  state.customer = { ...state.customer, name: 'ร้านไม่มีที่อยู่', email: 'typed@example.test', address: { country: 'TH', line1: 'จาก Checkout', postal_code: '10110' } };
  assert.equal(stripeCustomerSynced(state.customer, { quote }), true);
  assert.equal(await settle(attempt), true);
  assert.deepEqual(calls[1], ['POST', '/customers/cus_test', payload, 'mm:attempt:billing-profile']);
  assert.deepEqual(writes, ['fail', 'release', 'resolve']);
});
