import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingOffer, BILLING_DRAFT_POLICY } from '@watchdog-bms/contracts';
import { appendPackageInterval, fullPackagePurchaseImpact, proratedReceiptIncrease } from './billing-package';
import { parseBillingPolicy } from './billing-policy';
import { BillingService } from '../application/billing.service';

test('HIDDEN receipt-only offers stay absent from the catalog and direct requests fail before Stripe', async () => {
  const tiers = ['STARTER_249', 'BASIC_499', 'PRO_999'] as const;
  const variants = tiers.flatMap((tier) => ['month', 'year'].map((interval) => `${tier}:${interval}`));
  let salesEnabled = false, providerCalls = 0, quoteWrites = 0;
  const policy = { ...BILLING_DRAFT_POLICY, portalConfigurationId: 'bpc_test',
    priceIds: Object.fromEntries(variants.map((variant, index) => [variant, `price_test${index}`])) };
  const prisma = { client: {
    billingSettings: { upsert: async () => ({ policyRevisionId: 'test-hidden-policy', gatesJson: { new_sales: salesEnabled } }) },
    billingPolicyRevision: { findUnique: async () => ({ id: 'test-hidden-policy', state: 'ACTIVE', stripeAccountId: 'acct_test', livemode: false, policyJson: policy }) },
    companyMembership: { findUnique: async () => ({ status: 'ACTIVE', user: { status: 'ACTIVE' }, roles: [{ role: { key: 'OWNER', status: 'ACTIVE' } }] }) },
    billingQuote: { create: async () => { quoteWrites += 1; throw new Error('unexpected quote write'); } },
  } } as unknown as ConstructorParameters<typeof BillingService>[0];
  const stripe = { enabled: true, livemode: false, accountId: 'acct_test',
    request: async () => { providerCalls += 1; throw new Error('unexpected provider call'); } } as unknown as ConstructorParameters<typeof BillingService>[2];
  const service = new BillingService(prisma, {} as ConstructorParameters<typeof BillingService>[1], stripe);
  for (const open of [false, true]) {
    salesEnabled = open;
    const catalog = await service.catalog();
    assert.equal(catalog.offers.length, 8, 'only three paid packages plus locked Enterprise, each month/year');
    assert.deepEqual([...new Set(catalog.offers.map((offer) => offer.offerKey))], [...tiers, 'ENTERPRISE_1999']);
    assert.equal(catalog.offers.filter((offer) => offer.availability === 'AVAILABLE').length, open ? 6 : 0);
    for (const offerKey of ['RECEIPT_TOPUP', 'RECEIPT_ADDON']) {
      await assert.rejects(service.quote({ companyId: 'test-company', userId: 'test-owner' } as Parameters<BillingService['quote']>[0],
        { offerKey, interval: 'month', billingEmail: 'owner@example.test' }), /แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน/);
    }
  }
  assert.equal(quoteWrites, 0);
  assert.equal(providerCalls, 0);
});

test('full-package catalog grants annual units upfront and rejects receipt-only/Enterprise purchase inputs', () => {
  for (const [tier, monthly, annualPrice] of [
    ['STARTER_249', 30, 249000], ['BASIC_499', 50, 499000], ['PRO_999', 100, 999000],
  ] as const) {
    assert.equal(billingOffer(tier, 'month').receiptAllowance, monthly);
    const annual = billingOffer(tier, 'year');
    assert.equal(annual.receiptAllowance, monthly * 12);
    assert.equal(annual.priceSatang, annualPrice);
    assert.equal(annual.receiptAllowanceCadence, 'PAID_PERIOD');
  }
  assert.equal(billingOffer('ENTERPRISE_1999', 'year').availability, 'COMING_SOON');
  for (const tier of ['RECEIPT_TOPUP', 'ENTERPRISE_1999', 'FREE_TRIAL_15']) {
    assert.throws(() => fullPackagePurchaseImpact({ tier, interval: 'year', verifiedPaidAt: new Date(), paidThrough: null, remainingPaidReceipts: 0 }));
  }
});

test('Pro yearly repurchase: eight remaining months become twenty, 1200 units available now', () => {
  const impact = fullPackagePurchaseImpact({ tier: 'PRO_999', interval: 'year',
    verifiedPaidAt: new Date('2026-09-13T05:00:00Z'), paidThrough: new Date('2027-05-13T05:00:00Z'), remainingPaidReceipts: 0 });
  assert.equal(impact.receiptAvailableAt.toISOString(), '2026-09-13T05:00:00.000Z');
  assert.equal(impact.serviceStartsAt.toISOString(), '2027-05-13T05:00:00.000Z');
  assert.equal(impact.paidThrough.toISOString(), '2028-05-13T05:00:00.000Z');
  assert.deepEqual(impact.nextRenewalAt, impact.paidThrough);
  assert.equal(impact.remainingReceipts, 1200);
  const again = fullPackagePurchaseImpact({ tier: 'PRO_999', interval: 'year', verifiedPaidAt: impact.receiptAvailableAt,
    paidThrough: impact.paidThrough, remainingPaidReceipts: 1100 });
  assert.equal(again.paidThrough.toISOString(), '2029-05-13T05:00:00.000Z');
  assert.equal(again.remainingReceipts, 2300);
});

test('first/expired purchase starts now; short months and leap years preserve the explicit anniversary', () => {
  const now = new Date('2026-01-31T23:30:00Z');
  for (const paidThrough of [null, new Date('2025-01-31T23:30:00Z')]) {
    const impact = fullPackagePurchaseImpact({ tier: 'BASIC_499', interval: 'month', verifiedPaidAt: now, paidThrough, remainingPaidReceipts: 20 });
    assert.equal(impact.serviceStartsAt.toISOString(), now.toISOString());
    assert.equal(impact.paidThrough.toISOString(), '2026-02-28T23:30:00.000Z');
    assert.equal(impact.remainingReceipts, 50);
    assert.equal(appendPackageInterval(impact.paidThrough, 'month', 31).toISOString(), '2026-03-31T23:30:00.000Z');
  }
  assert.equal(appendPackageInterval(new Date('2024-02-29T10:00:00Z'), 'year', 29).toISOString(), '2025-02-28T10:00:00.000Z');
  assert.equal(appendPackageInterval(new Date('2027-02-28T10:00:00Z'), 'year', 29).toISOString(), '2028-02-29T10:00:00.000Z');
});

test('upgrade adds only prorated units, including the future periods already bought', () => {
  const start = new Date('2026-01-01T00:00:00Z'), end = new Date('2027-01-01T00:00:00Z');
  const halfway = new Date((start.getTime() + end.getTime()) / 2);
  assert.equal(proratedReceiptIncrease([{ start, end, oldAllowance: 50, newAllowance: 100 }], halfway), 25);
  assert.equal(proratedReceiptIncrease([{ start, end, oldAllowance: 600, newAllowance: 1200 }], halfway), 300);
  assert.equal(proratedReceiptIncrease([
    { start, end, oldAllowance: 600, newAllowance: 1200 },
    { start: end, end: new Date('2028-01-01T00:00:00Z'), oldAllowance: 600, newAllowance: 1200 },
  ], halfway), 900, 'do not upgrade all prepaid time for the price/allowance of just one period');
  assert.equal(proratedReceiptIncrease([{ start, end, oldAllowance: 50, newAllowance: 100 }], new Date(end.getTime() - 1)), 0);
  assert.equal(proratedReceiptIncrease([{ start, end, oldAllowance: 50, newAllowance: 100 }], end), 0);
});

test('invalid/overlapping history and unsafe counts fail closed; approved defaults do not enable sales', () => {
  const start = new Date('2026-01-01Z'), end = new Date('2027-01-01Z');
  const period = { start, end, oldAllowance: 600, newAllowance: 1200 };
  assert.throws(() => proratedReceiptIncrease([period, period], start));
  assert.throws(() => proratedReceiptIncrease([{ ...period, newAllowance: 50 }], start));
  for (const remainingPaidReceipts of [-1, 0.5, NaN, 2_147_483_647]) {
    assert.throws(() => fullPackagePurchaseImpact({ tier: 'PRO_999', interval: 'year', verifiedPaidAt: start, paidThrough: end, remainingPaidReceipts }));
  }
  assert.throws(() => appendPackageInterval(new Date(NaN), 'month'));
  assert.throws(() => appendPackageInterval(start, 'month', 32));
  assert.deepEqual(parseBillingPolicy(BILLING_DRAFT_POLICY), BILLING_DRAFT_POLICY);
  assert.throws(() => parseBillingPolicy({ ...BILLING_DRAFT_POLICY, planChanges: 'NEXT_PERIOD' }));
  assert.throws(() => parseBillingPolicy({ ...BILLING_DRAFT_POLICY, taxRateId: 'txr_oldVatRate' }));
  assert.deepEqual(BILLING_DRAFT_POLICY.priceIds, {});
});
