import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restartSource } from './billing-restart';

test('restart requires explicit original non-disputed evidence and recovers without changing paid history', async () => {
  const account = { id: 'account', companyId: 'company', customerId: 'cus_original', baseSubscriptionId: 'sub_original',
    paidThrough: new Date('2020-01-01T00:00:00Z'), stripeAccountId: 'acct_original', livemode: false,
    contractAttemptId: 'original-attempt', termProjectionHash: 'original-term' };
  const subscription = { object: 'subscription', id: account.baseSubscriptionId, livemode: false, customer: account.customerId,
    status: 'canceled', metadata: { billingAccountId: account.id } };
  const invoice = { id: 'in_original', status: 'paid', total: 999000, amount_paid: 999000, livemode: false, customer: account.customerId };
  const mapped = [{ providerInvoiceId: invoice.id, providerChargeId: 'ch_original', paidSatang: 999000, applyStatus: 'APPLIED', refundedSatang: 0 }];
  const charge: Record<string, unknown> = { id: 'ch_original', livemode: false, customer: account.customerId, status: 'succeeded',
    paid: true, captured: true, currency: 'thb', amount: 999000, amount_refunded: 0, disputed: false };
  const before = JSON.stringify({ account, mapped });
  const prisma = { client: { billingIssue: { count: async () => 0 }, billingInvoice: { count: async () => 0, findMany: async () => mapped } } };
  const stripe = { assertAccount: async () => {}, request: async (method: string, path: string) => {
    assert.equal(method, 'GET');
    if (path === '/subscriptions/sub_original') return subscription;
    assert.equal(path, '/charges/ch_original'); return charge;
  }, list: async (path: string) => {
    if (path === '/subscriptions') return [subscription];
    assert.equal(path, '/invoices'); return [invoice];
  } };
  const check = () => restartSource(prisma as never, stripe as never, account as never);
  const original = await check(); assert.equal(original.subscriptionId, subscription.id);
  for (const disputed of [true, undefined, null, 0, '', 'false']) {
    charge.disputed = disputed;
    await assert.rejects(check, (error: any) => error.getResponse()?.code === 'BILLING_RESTART_REVIEW', `unproven dispute state ${String(disputed)}`);
  }
  charge.disputed = false;
  assert.deepEqual(await check(), original);
  assert.equal(JSON.stringify({ account, mapped }), before);
});
