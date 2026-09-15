import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertMappedCharge, observeBillingCharges } from './billing-financial';

const account = { id: 'account', companyId: 'company', customerId: 'cus_owner', stripeAccountId: 'acct_owner', livemode: false };
const invoice = { id: 'invoice', providerChargeId: 'ch_paid', paidSatang: 999000 };
const charge = { id: 'ch_paid', customer: 'cus_owner', livemode: false, currency: 'thb', status: 'succeeded', paid: true,
  captured: true, amount: 999000, amount_refunded: 100, disputed: true };

test('financial observations reject malformed or differently owned money evidence', () => {
  assert.doesNotThrow(() => assertMappedCharge(charge, account, invoice));
  for (const patch of [{ id: 'ch_other' }, { customer: 'cus_other' }, { livemode: true }, { currency: 'usd' }, { amount: 1 },
    { amount_refunded: -1 }, { amount_refunded: 999001 }, { amount_refunded: 0.5 }, { disputed: undefined }, { captured: false }]) {
    assert.throws(() => assertMappedCharge({ ...charge, ...patch }, account, invoice), /financial_charge_mismatch/);
  }
});

test('a stale financial observer cannot update an invoice or open a case', async () => {
  let mutations = 0;
  const tx = { $queryRaw: async () => [], company: { findUnique: async () => ({ id: account.companyId }) },
    billingAccount: { findUniqueOrThrow: async () => ({ ...account, leaseToken: 'successor', leaseUntil: new Date(Date.now() + 60000) }) },
    billingInvoice: { update: async () => { mutations++; } } };
  const prisma = { client: { billingInvoice: { findMany: async () => [invoice] }, $transaction: async (fn: (db: typeof tx) => Promise<void>) => fn(tx) } };
  const stripe = { accountId: account.stripeAccountId, livemode: false, request: async () => charge };
  await assert.rejects(observeBillingCharges(prisma as any, stripe as any, account as any, 'expired-worker'), /financial_lost_lease/);
  assert.equal(mutations, 0);
});
