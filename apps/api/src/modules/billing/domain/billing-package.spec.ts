import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingOffer, BILLING_DRAFT_POLICY, FEATURE_PACKAGE_PRESETS, TIER_FEATURE_PRESETS } from '@watchdog-bms/contracts';
import { appendPackageInterval, packageAnchorDay, fullPackagePurchaseImpact, invoiceServiceEnd, promotionBoundaries, proratedPackagePrice, proratedReceiptIncrease } from './billing-package';
import { assertRefundControlPolicy, effectiveBillingGates, assertStripePrice, assertStripePortalConfiguration, parseBillingPolicy } from './billing-policy';
import { BillingService } from '../application/billing.service';

test('provider prices require exact requested identity, product and recurring contract', () => {
  const price = { id: 'price_ProYear', object: 'price', livemode: false, active: true, type: 'recurring', product: 'prod_Pro',
    currency: 'thb', unit_amount: 999000, recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit', tax_behavior: 'inclusive' };
  const validate = (value: object) => assertStripePrice(value, billingOffer('PRO_999', 'year'), BILLING_DRAFT_POLICY, false, price.id);
  validate(price); validate({ ...price, product: { id: 'prod_Pro' } });
  for (const override of [{ id: 'price_other' }, { product: null }, { product: '' }, { object: undefined }, { active: false },
    { livemode: true }, { unit_amount: 0 }, { currency: 'usd' }, { recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } }])
    assert.throws(() => validate({ ...price, ...override }));
});

test('provider Portal configuration requires explicit safe flags and exact native binding', () => {
  const portal = { id: 'bpc_Test', object: 'billing_portal.configuration', livemode: false, active: true,
    features: { payment_method_update: { enabled: true }, subscription_update: { enabled: false }, subscription_cancel: { enabled: false } } };
  assertStripePortalConfiguration(portal, portal.id, false);
  for (const override of [{ id: 'bpc_other' }, { object: undefined }, { livemode: undefined }, { active: 1 },
    { features: {} }, { features: { ...portal.features, subscription_update: { enabled: true } } },
    { features: { ...portal.features, subscription_cancel: { enabled: true } } }])
    assert.throws(() => assertStripePortalConfiguration({ ...portal, ...override }, portal.id, false));
});

test('HIDDEN receipt-only offers stay absent from the catalog and direct requests fail before Stripe', async () => {
  const tiers = ['STARTER_249', 'BASIC_499', 'PRO_999', 'ENTERPRISE_1999'] as const;
  const variants = tiers.flatMap((tier) => ['month', 'year'].map((interval) => `${tier}:${interval}`));
  let salesEnabled = false, providerCalls = 0, quoteWrites = 0;
  const policy = { ...BILLING_DRAFT_POLICY, portalConfigurationId: 'bpc_test',
    priceIds: Object.fromEntries(variants.map((variant, index) => [variant, `price_test${index}`])) };
  const prisma = { client: {
    billingSettings: { findUnique: async () => ({ policyRevisionId: 'test-hidden-policy', gatesJson: { new_sales: salesEnabled } }) },
    billingPolicyRevision: { findUnique: async () => ({ id: 'test-hidden-policy', state: 'ACTIVE', stripeAccountId: 'acct_test', livemode: false, policyJson: policy }) },
    companyMembership: { findUnique: async () => ({ status: 'ACTIVE', user: { status: 'ACTIVE' }, roles: [{ role: { key: 'OWNER', status: 'ACTIVE' } }] }) },
    billingQuote: { create: async () => { quoteWrites += 1; throw new Error('unexpected quote write'); } },
  } } as unknown as ConstructorParameters<typeof BillingService>[0];
  const stripe = { enabled: true, livemode: false, accountId: 'acct_test',
    request: async () => { providerCalls += 1; throw new Error('unexpected provider call'); } } as unknown as ConstructorParameters<typeof BillingService>[2];
  const service = new BillingService(prisma, { aiMonthlyBudgetSatang: 120000 } as ConstructorParameters<typeof BillingService>[1], stripe);
  // This case checks offer admission before Stripe; owner authorization has its own tests.
  service.assertOwner = async () => {};
  for (const open of [false, true]) {
    salesEnabled = open;
    const catalog = await service.catalog();
    assert.equal(catalog.offers.length, 8, 'four paid packages, each month/year');
    assert.deepEqual([...new Set(catalog.offers.map((offer) => offer.offerKey))], [...tiers]);
    // All four paid tiers share the same open/closed gate once both exact Price variants are bound.
    assert.equal(catalog.offers.filter((offer) => offer.availability === 'AVAILABLE').length, open ? 8 : 0);
    assert.equal(catalog.aiMonthlyBudgetSatang, 120000);
    assert.deepEqual(catalog.offers.find((offer) => offer.offerKey === 'ENTERPRISE_1999')!.featureKeys,
      [...TIER_FEATURE_PRESETS.ENTERPRISE_1999]);
    assert.deepEqual(catalog.offers.find((offer) => offer.offerKey === 'STARTER_249')!.featureKeys,
      [...FEATURE_PACKAGE_PRESETS.starter.featureKeys]);
    for (const offerKey of ['RECEIPT_TOPUP', 'RECEIPT_ADDON']) {
      await assert.rejects(service.quote({ companyId: 'test-company', userId: 'test-owner' } as Parameters<BillingService['quote']>[0],
        { offerKey, interval: 'month', billingEmail: 'owner@example.test' }), /แพ็กเกจนี้ยังไม่เปิดรับชำระเงิน/);
    }
  }
  assert.equal(quoteWrites, 0);
  assert.equal(providerCalls, 0);
});

test('full-package catalog grants annual units upfront, sells Enterprise at ten months, and rejects receipt-only purchase inputs', () => {
  for (const [tier, monthly, annualPrice] of [
    ['STARTER_249', 30, 249000], ['BASIC_499', 50, 499000], ['PRO_999', 100, 999000],
    // Phase 6 (Owner 2026-09-21): the same ×10 annual rule as every other tier — 1,999 ×10 = 19,990.
    ['ENTERPRISE_1999', 500, 1999000],
  ] as const) {
    assert.equal(billingOffer(tier, 'month').receiptAllowance, monthly);
    const annual = billingOffer(tier, 'year');
    assert.equal(annual.receiptAllowance, monthly * 12);
    assert.equal(annual.priceSatang, annualPrice);
    assert.equal(annual.receiptAllowanceCadence, 'PAID_PERIOD');
    assert.deepEqual(annual.featureKeys, [...TIER_FEATURE_PRESETS[tier]]);
  }
  // Unbound Enterprise still reads "เร็ว ๆ นี้"; a bound one is an ordinary closed-sales offer the
  // catalog can open.
  assert.equal(billingOffer('ENTERPRISE_1999', 'year').availability, 'COMING_SOON');
  assert.equal(billingOffer('ENTERPRISE_1999', 'year', { ...BILLING_DRAFT_POLICY,
    priceIds: { 'ENTERPRISE_1999:year': 'price_EnterpriseYear' } }).availability, 'UNAVAILABLE');
  // Enterprise is a purchasable package now; only hidden receipt tiers and the trial are refused.
  assert.equal(fullPackagePurchaseImpact({ tier: 'ENTERPRISE_1999', interval: 'year',
    verifiedPaidAt: new Date('2026-09-21T00:00:00Z'), paidThrough: null, remainingPaidReceipts: 0 }).receiptUnitsAdded, 6000);
  for (const tier of ['RECEIPT_TOPUP', 'FREE_TRIAL_15']) {
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
    assert.equal(appendPackageInterval(impact.paidThrough, 'month', 1).toISOString(), '2026-03-31T23:30:00.000Z');
  }
  assert.equal(appendPackageInterval(new Date('2024-02-29T10:00:00Z'), 'year', 29).toISOString(), '2025-02-28T10:00:00.000Z');
  assert.equal(appendPackageInterval(new Date('2027-02-28T10:00:00Z'), 'year', 29).toISOString(), '2028-02-29T10:00:00.000Z');
});

test('full-price BASIC after one used STARTER receipt carries 29 and grants 50 now', () => {
  const start = new Date('2026-09-23T00:00:00Z');
  const starterEnd = appendPackageInterval(start, 'month');
  const impact = fullPackagePurchaseImpact({ tier: 'BASIC_499', interval: 'month', verifiedPaidAt: new Date(start.getTime() + 60_000),
    paidThrough: starterEnd, remainingPaidReceipts: 29, anchorDay: packageAnchorDay(start) });
  assert.equal(impact.receiptUnitsAdded, 50);
  assert.equal(impact.remainingReceipts, 79);
  assert.equal(impact.paidThrough.toISOString(), appendPackageInterval(starterEnd, 'month', packageAnchorDay(start)).toISOString());
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
  const monthEnd = new Date('2026-01-31T00:00:00Z');
  const starterToBasic = [{ start, end: monthEnd, oldAllowance: 30, newAllowance: 50 }];
  assert.equal(proratedReceiptIncrease(starterToBasic, new Date(start.getTime() + 60_000)), 20);
  assert.equal(29 + proratedReceiptIncrease(starterToBasic, new Date(start.getTime() + 60_000)), 49);
  assert.equal(proratedReceiptIncrease(starterToBasic, new Date('2026-01-16T00:00:00Z')), 10);
  const bangkokStart = new Date('2026-09-22T17:00:00Z'), bangkokEnd = new Date('2026-10-22T17:00:00Z');
  const sameDayLate = new Date('2026-09-23T16:59:00Z');
  assert.equal(proratedReceiptIncrease([{ start: bangkokStart, end: bangkokEnd, oldAllowance: 30, newAllowance: 50 }], sameDayLate), 20);
  assert.equal(proratedPackagePrice(24900, 49900, bangkokStart, bangkokEnd, sameDayLate), 25000);
  assert.equal(proratedReceiptIncrease([{ start: bangkokStart, end: bangkokEnd, oldAllowance: 30, newAllowance: 50 }], new Date('2026-09-23T17:00:00Z')), 19);
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
  for (const count of [0, -1, 1.5, NaN, 1201]) assert.throws(() => appendPackageInterval(start, 'month', 1, count));
  assert.deepEqual(parseBillingPolicy(BILLING_DRAFT_POLICY), BILLING_DRAFT_POLICY);
  assert.throws(() => parseBillingPolicy({ ...BILLING_DRAFT_POLICY, planChanges: 'NEXT_PERIOD' }));
  assert.throws(() => parseBillingPolicy({ ...BILLING_DRAFT_POLICY, taxRateId: 'txr_oldVatRate' }));
  assert.deepEqual(BILLING_DRAFT_POLICY.priceIds, {});
});


test('refund policy is closed for old settings and validates approved integer bounds',()=>{
  assert.equal(effectiveBillingGates({new_sales:true}).refunds,false);
  for(const refundLimitSatang of [undefined,null]){
    const policy=parseBillingPolicy({...BILLING_DRAFT_POLICY,refundLimitSatang});
    assert.doesNotThrow(()=>assertRefundControlPolicy(policy,false));
    assert.throws(()=>assertRefundControlPolicy(policy,true));
  }
  for(const value of [0,-1,1.1,2147483648,'24900',true,Infinity,NaN])
    assert.throws(()=>parseBillingPolicy({...BILLING_DRAFT_POLICY,refundLimitSatang:value}));
  for(const refundLimitSatang of [1,24901,2147483647])
    assert.doesNotThrow(()=>assertRefundControlPolicy(parseBillingPolicy({...BILLING_DRAFT_POLICY,refundLimitSatang}),true));
  assert.throws(()=>assertRefundControlPolicy({...BILLING_DRAFT_POLICY,refundLimitSatang:24900,refundPolicy:null},true));
});


test('approved offer prices and upfront quota share a snapshot and retain original defaults',()=>{
  const original=billingOffer('PRO_999','year');
  const policy=parseBillingPolicy({...BILLING_DRAFT_POLICY,offerTerms:{PRO_999:{monthlyPriceSatang:109901,annualPriceSatang:1099001,monthlyReceiptAllowance:125}}});
  const offer=billingOffer('PRO_999','year',policy);
  assert.equal(offer.priceSatang,1099001);assert.equal(offer.receiptAllowance,1500);
  assert.equal(offer.branchLimit,original.branchLimit);assert.equal(offer.employeeLimit,original.employeeLimit);
  assert.deepEqual(billingOffer('BASIC_499','year',policy),billingOffer('BASIC_499','year'));
  assert.equal(billingOffer('ENTERPRISE_1999','year',policy).availability,'COMING_SOON');
  // Phase 6: Enterprise reads `offerTerms` like every other tier now that it is sellable.
  const enterprisePolicy=parseBillingPolicy({...BILLING_DRAFT_POLICY,offerTerms:{ENTERPRISE_1999:{monthlyPriceSatang:199900,annualPriceSatang:1999000,monthlyReceiptAllowance:2500}}});
  assert.equal(billingOffer('ENTERPRISE_1999','month',enterprisePolicy).receiptAllowance,2500);
  const input={tier:'PRO_999',interval:'year',verifiedPaidAt:new Date('2026-09-15Z'),paidThrough:new Date('2027-05-15Z'),remainingPaidReceipts:200};
  assert.equal(fullPackagePurchaseImpact({...input,offer}).remainingReceipts,1700);
  assert.equal(fullPackagePurchaseImpact({...input,offer:original}).remainingReceipts,1400);
  assert.throws(()=>fullPackagePurchaseImpact({...input,offer:billingOffer('BASIC_499','year')}));
  for(const offerTerms of [false,[],{RECEIPT_TOPUP:{monthlyPriceSatang:199900,annualPriceSatang:1999000,monthlyReceiptAllowance:2000}},
    {PRO_999:{}},{PRO_999:{...policy.offerTerms!.PRO_999,extra:1}},...[-1,0,0.5,178956971,'125',NaN].map(monthlyReceiptAllowance=>({PRO_999:{...policy.offerTerms!.PRO_999,monthlyReceiptAllowance}})),
    ...[999,1000.5,100000000,'109901'].map(monthlyPriceSatang=>({PRO_999:{...policy.offerTerms!.PRO_999,monthlyPriceSatang}}))])
    assert.throws(()=>parseBillingPolicy({...policy,offerTerms}));
  assert.throws(()=>parseBillingPolicy({...policy,taxTreatment:'EXCLUSIVE_VAT_7',taxRateId:'txr_test',offerTerms:{PRO_999:{...policy.offerTerms!.PRO_999,annualPriceSatang:99999999}}}));
  assert.deepEqual(billingOffer('PRO_999','year',{offerTerms:null}),original);
});

test('capacity policy accepts paired bounded limits without changing prices, receipt quantities or old defaults',()=>{
  const terms={monthlyPriceSatang:99900,annualPriceSatang:999000,monthlyReceiptAllowance:100};
  for(const limits of [{branchLimit:1,employeeLimit:1},{branchLimit:1000,employeeLimit:1000},{branchLimit:7,employeeLimit:25}]){
    const policy=parseBillingPolicy({...BILLING_DRAFT_POLICY,offerTerms:{PRO_999:{...terms,...limits}}});
    assert.deepEqual(billingOffer('PRO_999','year',policy),{...billingOffer('PRO_999','year'),...limits});
  }
  for(const limits of [{branchLimit:7},{employeeLimit:25},{branchLimit:null,employeeLimit:25},
    ...[0,-1,1.5,1001,'5',true,Infinity].map(branchLimit=>({branchLimit,employeeLimit:25})),
    ...[0,-1,1.5,1001,'25',true,Infinity].map(employeeLimit=>({branchLimit:7,employeeLimit}))])
    assert.throws(()=>parseBillingPolicy({...BILLING_DRAFT_POLICY,offerTerms:{PRO_999:{...terms,...limits}}}));
});

test('promotion boundaries count months once from the start: 2 months for a month, 13 for a year, anniversary kept through short months', () => {
  const ends = (start: string, interval: 'month' | 'year', anchorDay?: number, bonusMonths = 1) => {
    const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: new Date(start), interval, anchorDay, bonusMonths });
    return [paidEnd.toISOString(), benefitEnd.toISOString()];
  };
  // Spec §5 example: paid 5 Oct 2026 10:00 Bangkok.
  assert.deepEqual(ends('2026-10-05T03:00:00.000Z', 'month'), ['2026-11-05T03:00:00.000Z', '2026-12-05T03:00:00.000Z']);
  assert.deepEqual(ends('2026-10-05T03:00:00.000Z', 'year'), ['2027-10-05T03:00:00.000Z', '2027-11-05T03:00:00.000Z'], '13 months, never 24');
  // 31 Jan → paid end clamps to 28 Feb, the free month still ends 31 Mar (not 28 Mar).
  assert.deepEqual(ends('2026-01-31T03:00:00.000Z', 'month'), ['2026-02-28T03:00:00.000Z', '2026-03-31T03:00:00.000Z']);
  assert.deepEqual(ends('2028-01-31T03:00:00.000Z', 'month'), ['2028-02-29T03:00:00.000Z', '2028-03-31T03:00:00.000Z'], 'leap year');
  assert.deepEqual(ends('2028-02-29T03:00:00.000Z', 'year'), ['2029-02-28T03:00:00.000Z', '2029-03-29T03:00:00.000Z'], 'bought on 29 Feb');
  assert.deepEqual(ends('2026-12-15T03:00:00.000Z', 'month'), ['2027-01-15T03:00:00.000Z', '2027-02-15T03:00:00.000Z'], 'December into the next year');
  // A continuing purchase starts at a clamped paidThrough and keeps the shop's original anchor day.
  assert.deepEqual(ends('2026-02-28T03:00:00.000Z', 'month', 31), ['2026-03-31T03:00:00.000Z', '2026-04-30T03:00:00.000Z']);
  assert.deepEqual(ends('2026-02-28T03:00:00.000Z', 'month'), ['2026-03-28T03:00:00.000Z', '2026-04-28T03:00:00.000Z'], 'without the anchor the day would drift');
  // 02:00 Bangkok on 5 Oct is still 4 Oct in UTC: keep the Bangkok anniversary and clock.
  assert.deepEqual(ends('2026-10-04T19:00:00.000Z', 'month'), ['2026-11-04T19:00:00.000Z', '2026-12-04T19:00:00.000Z']);
  assert.deepEqual(ends('2026-10-05T03:00:00.000Z', 'month', undefined, 2), ['2026-11-05T03:00:00.000Z', '2027-01-05T03:00:00.000Z']);
  for (const bonusMonths of [0, -1, 1.5]) assert.throws(() => ends('2026-10-05T03:00:00.000Z', 'month', undefined, bonusMonths));
});

test('an invoice gives service until its benefit end when it has one, else until its period end', () => {
  const periodEnd = new Date('2026-11-05T03:00:00.000Z'), benefitEnd = new Date('2026-12-05T03:00:00.000Z');
  assert.equal(invoiceServiceEnd({ periodEnd, benefitEnd }), benefitEnd);
  assert.equal(invoiceServiceEnd({ periodEnd, benefitEnd: null }), periodEnd);
  assert.equal(invoiceServiceEnd({ periodEnd }), periodEnd);
});
