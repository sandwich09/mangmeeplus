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
  const state = { unavailable: false, row: attempt as any, customer: { id: 'cus_test', metadata: { billingAccountId: 'account' } } as Record<string, unknown> };
  const tx = { $queryRaw: async () => [], billingAccount: { findUniqueOrThrow: async () => account,
    updateMany: async () => { writes.push('release'); return { count: 1 }; } },
    billingAttempt: { updateMany: async (input: any) => { assert.equal(input.data.status, 'FAILED');
      assert.deepEqual(input.where.collectionJson.equals, state.row.collectionJson); writes.push('fail'); return { count: 1 }; } },
    billingIssue: { updateMany: async () => { writes.push('resolve'); return { count: 1 }; } } };
  const prisma = { client: { $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
  const stripe = { request: async (...args: unknown[]) => { calls.push(args); if (state.unavailable) throw new Error('unavailable'); return state.customer; } };
  const reconciler = new BillingReconcilerService(prisma as any, {} as any, stripe as any, {} as any, {} as any);
  const settle = (row: unknown) => { state.row = row; return (reconciler as any).settleProfileSync(account, row, 'lease'); };
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
  // 2026-10-10: one hour after the first send a pass only reads; ten quiet minutes later the attempt is over even
  // unconfirmed — no Checkout was ever sent for it, and the next purchase writes the profile again.
  const aged = (minutes: number) => { calls.length = 0; writes.length = 0;
    return { ...attempt, collectionJson: { profileSync: { ...attempt.collectionJson.profileSync, startedAt: new Date(Date.now() - minutes * 60_000).toISOString() } } }; };
  const unsynced = state.customer; state.customer = { id: 'cus_test', metadata: { billingAccountId: 'account' } };
  for (const minutes of [71, 24 * 60]) {
    const row = aged(minutes);
    assert.equal(await settle(row), true);
    assert.deepEqual([calls, writes], [[['GET', '/customers/cus_test']], ['fail', 'release', 'resolve']]);
  }
  // Inside the quiet margin the pass reads and waits; a failed read at any age waits too.
  assert.equal(await settle(aged(65)), true); assert.deepEqual([calls, writes], [[['GET', '/customers/cus_test']], []]);
  state.unavailable = true; await assert.rejects(settle(aged(24 * 60))); assert.equal(writes.length, 0);
  state.unavailable = false; state.customer = unsynced;
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

// 2026-10-10: a Checkout request whose answer was lost and which the provider never created stops holding the shop
// once the read finds no session of the attempt and nothing of ours can still be in flight (ten minutes).
it('an unknown Checkout the provider never created stops holding the shop once it can no longer appear', async () => {
  const account = { id: 'account', companyId: 'company', customerId: 'cus_test', livemode: false, activeAttemptId: 'attempt', leaseToken: 'lease', leaseUntil: new Date(Date.now() + 60_000) };
  const attempt = { id: 'attempt', status: 'UNKNOWN', errorCode: 'unavailable', checkoutSessionId: null, createdAt: new Date(Date.now() - 25 * 3600000), updatedAt: new Date(Date.now() - 25 * 3600000),
    quoteSnapshot: { productId: 'prod_test', quote: { purchaseMode: 'PROMPTPAY_ONCE' } } };
  const writes: string[] = [], posts: unknown[][] = [];
  const release = async (input: any) => { if (input.data.activeAttemptId === null) writes.push('release'); return { count: 1 }; };
  const end = async (input: any) => { writes.push(`attempt:${input.data.status}`); return { count: 1 }; };
  const tx = { $queryRaw: async () => [], billingAccount: { findUniqueOrThrow: async () => account, update: release, updateMany: release },
    billingAttempt: { update: end, updateMany: end }, billingIssue: { updateMany: async () => ({ count: 0 }) }, auditLog: { create: async () => { writes.push('audit'); } } };
  const prisma = { client: { ...tx, $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
  // The provider's complete list of this customer's Checkout sessions: none carries this attempt.
  const stripe = { list: async () => [], request: async (...args: unknown[]) => { posts.push(args); throw new Error('nothing may be sent'); } };
  const reconciler = new BillingReconcilerService(prisma as any, {} as any, stripe as any, {} as any, {} as any);
  await assert.doesNotReject((reconciler as any).reconcileOneTime(account, attempt, 'lease'), 'the pass must end the attempt, not fail for ever');
  assert.equal(posts.length, 0);
  assert.deepEqual(writes, ['attempt:EXPIRED', 'release', 'audit']);
  // Within ten minutes of the last write the same read ends nothing: the pass fails as before.
  await assert.rejects((reconciler as any).reconcileOneTime(account, { ...attempt, updatedAt: new Date(Date.now() - 540_000) }, 'lease'), /billing\.checkout_unknown/);
});
