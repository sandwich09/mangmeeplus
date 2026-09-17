import { it } from 'node:test';
import assert from 'node:assert/strict';
import { BillingReconcilerService } from './billing-reconciler.service';
import { requireBillingProfile, stripeBillingProfile } from './billing-company-profile';

it('settles only the original pre-payment profile write before releasing a failed purchase', async () => {
  const profile = requireBillingProfile({ name: 'ร้านทดสอบ', addressJson: { line1: '99', subdistrict: 'คลองเตย',
    district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } });
  const account = { id: 'account', companyId: 'company', customerId: 'cus_test', activeAttemptId: 'attempt', leaseToken: 'lease', leaseUntil: new Date(Date.now() + 60_000) };
  const attempt = { id: 'attempt', status: 'UNKNOWN', checkoutSessionId: null, quoteSnapshot: { quote: { billingProfile: profile } },
    collectionJson: { profileSync: { startedAt: new Date(Date.now() - 61_000).toISOString(), customerId: 'cus_test', confirmed: false } } };
  const calls: unknown[][] = [], writes: string[] = [];
  let unavailable = false;
  const customer = { id: 'cus_test', metadata: { billingAccountId: 'account' }, ...stripeBillingProfile(profile) };
  const tx = { $queryRaw: async () => [], billingAccount: { findUniqueOrThrow: async () => account,
    updateMany: async () => { writes.push('release'); return { count: 1 }; } },
    billingAttempt: { updateMany: async (input: any) => { assert.equal(input.data.status, 'FAILED');
      assert.deepEqual(input.where.collectionJson.equals, attempt.collectionJson); writes.push('fail'); return { count: 1 }; } },
    billingIssue: { updateMany: async () => { writes.push('resolve'); return { count: 1 }; } } };
  const prisma = { client: { $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
  const stripe = { request: async (...args: unknown[]) => { calls.push(args); if (unavailable) throw new Error('unavailable'); return customer; } };
  const reconciler = new BillingReconcilerService(prisma as any, {} as any, stripe as any, {} as any, {} as any);
  const settle = (row: unknown) => (reconciler as any).settleProfileSync(account, row, 'lease');
  assert.equal(await settle({ ...attempt, collectionJson: null }), false);
  assert.equal(await settle({ ...attempt, checkoutSessionId: 'cs_paid' }), false);
  assert.equal(await settle({ ...attempt, collectionJson: { profileSync: { ...attempt.collectionJson.profileSync, confirmed: true } } }), false);
  assert.equal(await settle({ ...attempt, collectionJson: { profileSync: { ...attempt.collectionJson.profileSync, startedAt: new Date().toISOString() } } }), true);
  assert.equal(calls.length, 0); assert.equal(writes.length, 0);
  unavailable = true; await assert.rejects(settle(attempt)); assert.equal(writes.length, 0);
  unavailable = false; calls.length = 0;
  assert.equal(await settle(attempt), true);
  assert.deepEqual(calls, [['GET', '/customers/cus_test'], ['POST', '/customers/cus_test', stripeBillingProfile(profile), 'mm:attempt:billing-profile']]);
  assert.deepEqual(writes, ['fail', 'release', 'resolve']);
  calls.length = 0;
  await assert.rejects(settle({ ...attempt, collectionJson: { profileSync: { ...attempt.collectionJson.profileSync,
    startedAt: new Date(Date.now() - 24 * 3600000).toISOString() } } }));
  assert.equal(calls.length, 0, 'never replay an ambiguous command outside the provider idempotency window');
});
