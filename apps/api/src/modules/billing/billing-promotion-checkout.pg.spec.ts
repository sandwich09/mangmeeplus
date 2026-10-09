/**
 * A promotion purchase through the real quote, Checkout, status, attempt, history and catalog code against real PostgreSQL
 * (docs/plans/starter-249-bonus-month-promotion-plan.md §1 R2/R3/R10, §2, §6 "Purchase-flow rules"; spec §3, §6, §7;
 * A01, A03, A04, A10, A15, A17, A30, A34, A36). Stripe is a fake; nothing here proves native provider behaviour.
 *
 * Run with:
 *   BILLING_PROMOTION_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-promotion-checkout.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, billingOffer, type BillingBenefitChoice, type BillingPolicy, type BillingPromotionCampaign,
  type BillingPurchaseMode, type BillingQuote } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { BillingService, type BillingSnapshot } from './application/billing.service';
import { BillingReconcilerService } from './application/billing-reconciler.service';
import { consumePromotion, markPromotionApplied, promotionUsage } from './application/billing-promotion';
import { appendPackageInterval, promotionBoundaries } from './domain/billing-package';
import { termProjectionHash } from './domain/paid-invoice';
import { promotionOfferSignature } from './domain/billing-promotion';
import { StripeRequestError } from './infrastructure/stripe.client';

const databaseUrl = process.env.BILLING_PROMOTION_TEST_DATABASE_URL;
const HOUR = 3_600_000;
type Body = { offerKey?: string; interval?: string; purchaseMode?: BillingPurchaseMode; benefitChoice?: BillingBenefitChoice; promotionCampaignId?: string;
  purchaseIntent?: 'FULL_PACKAGE' };

describe('promotion purchase: quote, Checkout and views on PostgreSQL', { skip: !databaseUrl }, () => {
  let client: PrismaClient, service: BillingService;
  const run = randomUUID().replaceAll('-', '').slice(0, 12), stripeAccountId = `acct_${run}`, owner = `promo-owner-${run}`, holder = `promo-holder-${run}`;
  const companyIds: string[] = [], batchIds: string[] = [], customers = new Map<string, Record<string, unknown>>(), sessions: Record<string, any>[] = [];
  const address = { line1: '99 ถนนทดสอบ', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' };
  const policy: BillingPolicy = { ...BILLING_DRAFT_POLICY, portalConfigurationId: 'bpc_synthetic', priceIds: {
    'STARTER_249:month': 'price_StarterMonth', 'STARTER_249:year': 'price_StarterYear', 'BASIC_499:month': 'price_BasicMonth', 'BASIC_499:year': 'price_BasicYear',
    'PRO_999:month': 'price_ProMonth', 'PRO_999:year': 'price_ProYear', 'ENTERPRISE_1999:month': 'price_EntMonth', 'ENTERPRISE_1999:year': 'price_EntYear' } };
  const tax = policy.taxTreatment, month = billingOffer('STARTER_249', 'month', policy), year = billingOffer('STARTER_249', 'year', policy);
  let sequence = 0, keys = 0, paid: Record<string, any> = {};
  /** Runs once inside the next Checkout, after its reservation committed and before the pre-dispatch barrier. */
  let probe: null | (() => Promise<void>) = null;
  let sessionFailure: StripeRequestError | null = null;
  const stripe = { enabled: true, accountId: stripeAccountId, livemode: false,
    assertAccount: async () => { const check = probe; probe = null; if (check) await check(); },
    request: async (method: string, path: string, params?: any): Promise<any> => {
      if (path.startsWith('/prices/')) {
        const [tier, interval] = Object.entries(policy.priceIds).find(([, id]) => id === path.slice(8))![0].split(':'), offer = billingOffer(tier as 'STARTER_249', interval as 'month', policy);
        return { id: path.slice(8), object: 'price', livemode: false, active: true, type: 'recurring', product: 'prod_Synthetic', currency: 'thb',
          unit_amount: offer.priceSatang, recurring: { interval, interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit' };
      }
      if (path.startsWith('/customers/')) {
        const id = path.slice(11), account = await client.billingAccount.findFirstOrThrow({ where: { customerId: id } });
        if (method === 'POST') customers.set(id, params);
        return { id, metadata: { billingAccountId: account.id }, ...customers.get(id) };
      }
      if (path.startsWith('/payment_intents/')) return paid.intent;
      if (method === 'POST' && path === '/checkout/sessions') {
        if (sessionFailure) { const failure = sessionFailure; sessionFailure = null; throw failure; }
        const session = { id: `cs_${run}${sessions.length + 1}`, object: 'checkout.session', livemode: false, mode: params.mode, status: 'open',
          client_reference_id: params.client_reference_id, customer: params.customer, metadata: params.metadata, url: `https://checkout.stripe.com/c/pay/cs_${run}${sessions.length + 1}` };
        sessions.push({ ...params, session });
        return session;
      }
      if (method === 'GET' && path.startsWith('/checkout/sessions/')) return sessions.find(item => item.session.id === path.slice(19))!.session;
      if (method === 'POST' && path === '/invoices/create_preview') {
        const amount = params.invoice_items[0].amount;
        return { id: 'in_preview', object: 'invoice', livemode: false, currency: 'thb', parent: null, total: amount, amount_due: amount, amount_paid: 0, starting_balance: 0,
          ending_balance: 0, amount_shipping: 0, total_taxes: [], discounts: [], total_discount_amounts: [], total_pretax_credit_amounts: [],
          lines: { has_more: false, data: [{ amount, currency: 'thb', quantity: 1, discountable: false, parent: { type: 'invoice_item_details', subscription_item_details: null } }] } };
      }
      throw new Error(`unmocked Stripe request ${method} ${path}`);
    },
    list: async (path: string) => path === '/invoice_payments' ? paid.payments ?? [] : path.endsWith('/line_items') ? paid.checkoutLines ?? []
      : path.endsWith('/lines') ? paid.invoiceLines ?? [] : [] };

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_ci'), 'only a disposable local *_ci database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    // The real service on the real database; only the owner check, the Stripe tax read and the OCR usage read are stubbed.
    service = new BillingService({ client } as any, { stripeAccountId, sesWebBaseUrl: 'https://app.example.test', aiMonthlyBudgetSatang: 0 } as any, stripe as any);
    service.assertOwner = async () => {}; service.assertTaxSettings = async () => {};
    service.usage = async () => ({ used: 0, limit: null, remaining: null, resetsAt: null, cadence: 'PAID_GRANTS', expiresAt: null });
    for (const id of [owner, holder]) await client.user.create({ data: { id, displayName: id, email: `${id}@example.test`, emailVerifiedAt: new Date() } });
    await client.externalIdentity.create({ data: { userId: holder, provider: 'LINE', providerChannelId: `ch-${run}`, providerUserId: `U${run}` } });
  });
  after(async () => {
    const where = { companyId: { in: companyIds } }, accounts = (await client.billingAccount.findMany({ where, select: { id: true } })).map(row => row.id);
    const steps: (() => Promise<unknown>)[] = [
      () => client.billingAccount.updateMany({ where, data: { activeAttemptId: null, contractAttemptId: null } }),
      () => client.salesEventTicket.deleteMany({ where: { batchId: { in: batchIds } } }), () => client.salesEventBatch.deleteMany({ where: { id: { in: batchIds } } }),
      ...['billingPromotionRedemption', 'outboxEvent', 'auditLog', 'billingIssue', 'entitlementCommand', 'entitlementTransition', 'runoffSnapshot', 'companyFeatureEntitlement',
        'companyEntitlementNormalization', 'companyEntitlementSet', 'salesAttribution', 'billingOperation', 'billingReceiptGrant', 'billingQuote']
        .map(model => () => (client as any)[model].deleteMany({ where })),
      () => client.billingSubscriptionContract.deleteMany({ where: { billingAccountId: { in: accounts } } }),
      () => client.billingAttempt.deleteMany({ where: { billingAccountId: { in: accounts } } }),
      () => client.billingInvoice.deleteMany({ where: { billingAccountId: { in: accounts } } }),
      () => client.companyPlanTerm.deleteMany({ where }), () => client.billingAccount.deleteMany({ where }),
      () => client.externalIdentity.deleteMany({ where: { userId: holder } }), () => client.company.deleteMany({ where: { id: { in: companyIds } } }),
      () => client.user.deleteMany({ where: { id: { in: [owner, holder] } } }),
      () => client.billingSettings.deleteMany({ where: { stripeAccountId } }), () => client.billingPolicyRevision.deleteMany({ where: { stripeAccountId } }),
    ];
    for (const step of steps) await step().catch(() => undefined);
    await client.$disconnect();
  });

  const campaign = (over: Partial<BillingPromotionCampaign> = {}): BillingPromotionCampaign => ({ campaignId: `promo-${run}-${sequence += 1}`, type: 'BONUS_MONTHS', revision: 1,
    internalName: 'Synthetic', description: null, displayName: 'ซื้อ 1 เดือน ฟรี 1 เดือน', startsAt: new Date(Date.now() - HOUR).toISOString(),
    endsAt: new Date(Date.now() + HOUR).toISOString(), cap: null, paused: false, endedAt: null, rules: [
      { offerKey: 'STARTER_249', interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30, offerSignature: promotionOfferSignature(month, tax) },
      { offerKey: 'STARTER_249', interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30, offerSignature: promotionOfferSignature(year, tax) }], ...over });
  /** What a publication does: a new ACTIVE revision (the policy plus exactly these campaigns) and a new settings version. */
  async function publish(campaigns: BillingPromotionCampaign[], base: BillingPolicy = policy) {
    const revision = await client.billingPolicyRevision.create({ data: { stripeAccountId, livemode: false, version: sequence += 1, state: 'ACTIVE', policyJson: base,
      promotionJson: Object.fromEntries(campaigns.map(item => [item.campaignId, item])), createdByUserId: `admin-${run}` } });
    const id = `${stripeAccountId}:test`, gatesJson = Object.fromEntries(BILLING_ACTIONS.map(action => [action, true]));
    await client.billingSettings.upsert({ where: { id }, create: { id, stripeAccountId, livemode: false, gatesJson, policyRevisionId: revision.id },
      update: { policyRevisionId: revision.id, version: { increment: 1 } } });
  }
  async function shop() {
    const id = `promo-co-${run}-${sequence += 1}`;
    companyIds.push(id);
    await client.company.create({ data: { id, name: `Synthetic ${id}`, addressJson: address } });
    await client.billingAccount.create({ data: { companyId: id, stripeAccountId, livemode: false, customerId: `cus_${run}${sequence}` } });
    return id;
  }
  const ctx = (companyId: string, userId = owner) => ({ companyId, userId, requestId: run }) as any;
  const quote = (companyId: string, benefitChoice?: BillingBenefitChoice, body: Body = {}, userId = owner) =>
    service.quote(ctx(companyId, userId), { offerKey: 'STARTER_249', interval: 'month', purchaseMode: 'CARD_ONCE', ...(benefitChoice ? { benefitChoice } : {}), ...body });
  const checkout = (companyId: string, q: BillingQuote, key = `promo-idem-${run}-${keys += 1}`, userId = owner) =>
    service.checkout(ctx(companyId, userId), { quoteId: q.quoteId, consentRevision: q.consentRevision, accepted: true, channel: 'web' }, key);
  const refused = (promise: Promise<unknown>, code: string, reason?: string) => assert.rejects(promise, (error: any) => {
    const body = error?.getResponse?.() ?? {};
    assert.deepEqual([body.code, body.reason], [code, reason], String(error?.stack ?? error));
    return true;
  });
  const account = (companyId: string) => client.billingAccount.findUniqueOrThrow({ where: { companyId_stripeAccountId_livemode: { companyId, stripeAccountId, livemode: false } } });
  const right = (companyId: string, campaignId: string) => client.billingPromotionRedemption.findUnique({
    where: { promotionEnvironmentId_campaignId_companyId: { promotionEnvironmentId: 'TEST', campaignId, companyId } } });
  const snapshotOf = async (quoteId: string) => (await client.billingQuote.findUniqueOrThrow({ where: { id: quoteId } })).snapshotJson as unknown as BillingSnapshot;
  /**
   * A verified one-time payment applied by the real reconciler. Lane A2 makes that apply promotion-aware; until it lands,
   * the promotion part is written here exactly as plan §6 says it will be (every step is idempotent, so it stays true after).
   */
  async function applyPaid(companyId: string, attemptId: string) {
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: attemptId } }), snapshot = attempt.quoteSnapshot as unknown as BillingSnapshot;
    const n = sequence += 1, lease = `lease-${run}-${n}`, amount = snapshot.quote.offer.priceSatang, created = Math.floor(Date.now() / 1000) - 60;
    const locked = await client.billingAccount.update({ where: { id: attempt.billingAccountId }, data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    const customerId = locked.customerId!, meta = { billingAttemptId: attempt.id, billingAccountId: locked.id };
    const charge = { id: `ch_${run}${n}`, livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount, customer: customerId,
      payment_intent: `pi_${run}${n}`, payment_method_details: { type: 'card' }, amount_refunded: 0, disputed: false, balance_transaction: null };
    paid = { intent: { id: `pi_${run}${n}`, livemode: false, status: 'succeeded', currency: 'thb', amount_received: amount, customer: customerId, latest_charge: charge },
      payments: [{ object: 'invoice_payment', livemode: false, status: 'paid', invoice: `in_${run}${n}`, payment: { type: 'payment_intent', payment_intent: `pi_${run}${n}` }, amount_paid: amount, currency: 'thb' }],
      checkoutLines: [{ quantity: 1, currency: 'thb', amount_total: amount, amount_tax: 0, amount_discount: 0,
        price: { id: `price_inline${run}${n}`, product: 'prod_Synthetic', type: 'one_time', active: false, recurring: null, livemode: false, currency: 'thb', unit_amount: amount } }],
      invoiceLines: [{ parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: `ii_${run}${n}`, subscription: null, proration: false } },
        pricing: { price_details: { price: `price_inline${run}${n}`, product: 'prod_Synthetic' } }, amount, currency: 'thb', livemode: false, quantity: 1 }] };
    const session = { id: attempt.checkoutSessionId, object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
      subscription: null, customer: customerId, client_reference_id: attempt.id, metadata: meta, invoice: `in_${run}${n}`, payment_intent: `pi_${run}${n}`,
      invoice_creation: { enabled: true }, currency: 'thb', amount_total: amount, total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: 0 }, created,
      customer_details: { email: `${owner}@example.test` } };
    const invoice = { id: `in_${run}${n}`, object: 'invoice', livemode: false, customer: customerId, metadata: meta, status: 'paid', billing_reason: 'manual',
      collection_method: 'send_invoice', parent: null, currency: 'thb', total: amount, amount_paid: amount, amount_remaining: 0, starting_balance: 0,
      status_transitions: { paid_at: created + 3 }, number: `PR-${run}-${n}` };
    await (new BillingReconcilerService({ client } as any, {} as any, stripe as any, service, {} as any) as any).reconcileOneTime(locked, attempt, lease, undefined, session, invoice);
    const row = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } });
    assert.equal(row.applyStatus, 'APPLIED');
    if (snapshot.promotion) {
      const { paidEnd, benefitEnd } = promotionBoundaries({ serviceStartsAt: row.periodStart, interval: snapshot.promotion.interval, anchorDay: snapshot.oneTime?.anchorDay,
        bonusMonths: snapshot.promotion.bonusMonths });
      assert.equal(row.periodEnd.getTime(), paidEnd.getTime(), 'the financial period is the paid one');
      assert.equal(await consumePromotion(client, { attemptId: attempt.id, invoiceId: row.id, companyId, now: new Date() }), true);
      await markPromotionApplied(client, { invoiceId: row.id, paidStart: row.periodStart, paidEnd, bonusEnd: benefitEnd, now: new Date() });
      await client.billingInvoice.update({ where: { id: row.id }, data: { benefitEnd } });
      const term = await client.companyPlanTerm.update({ where: { companyId }, data: { termEndsAt: benefitEnd } });
      await client.billingAccount.update({ where: { id: locked.id }, data: { paidThrough: benefitEnd, termProjectionHash: termProjectionHash(term) } });
    }
    return client.billingInvoice.findUniqueOrThrow({ where: { id: row.id } });
  }

  it('quotes 2 and 13 months with 60 and 390 receipts for a new shop, refuses another tier, and never changes a quote that names no benefit (A01)', async () => {
    const live = campaign();
    await publish([live]);
    const s = await shop(), started = Date.now();
    const monthly = await quote(s, 'PROMOTION');
    const start = new Date(monthly.promotion!.paidStart);
    assert.ok(Math.abs(start.getTime() - started) < 60_000);
    assert.deepEqual(monthly.promotion, { campaignId: live.campaignId, displayName: live.displayName, bonusMonths: 1, bonusReceiptUnits: 30, totalReceiptUnits: 60,
      paidStart: start.toISOString(), paidEnd: appendPackageInterval(start, 'month').toISOString(), benefitEnd: appendPackageInterval(start, 'month', undefined, 2).toISOString(),
      expectedNextChargeAt: null });
    // Money and the paid period are the normal purchase's: 249 baht for one month; only `promotion` tells the free time.
    assert.deepEqual([monthly.benefitChoice, monthly.totalSatang, monthly.purchase?.kind, monthly.purchase?.projectedPaidThrough, monthly.purchase?.receiptUnitsAdded],
      ['PROMOTION', 24900, 'INITIAL', monthly.promotion!.paidEnd, 30]);
    const pinned = await snapshotOf(monthly.quoteId);
    assert.deepEqual({ ...pinned.promotion, termsHash: undefined, offerSignature: undefined }, { environmentId: 'TEST', campaignId: live.campaignId, revision: 1, termsHash: undefined,
      displayName: live.displayName, offerKey: 'STARTER_249', interval: 'month', offerSignature: undefined, bonusMonths: 1, bonusReceiptUnits: 30 });
    assert.equal(pinned.eventDiscount, undefined);

    const yearly = await quote(s, 'PROMOTION', { interval: 'year', purchaseMode: 'CARD_AUTO', promotionCampaignId: live.campaignId }), from = new Date(yearly.promotion!.paidStart);
    assert.deepEqual([yearly.promotion!.totalReceiptUnits, yearly.promotion!.paidEnd, yearly.promotion!.benefitEnd, yearly.promotion!.expectedNextChargeAt, yearly.totalSatang, yearly.purchase?.receiptUnitsAdded],
      [390, appendPackageInterval(from, 'year').toISOString(), appendPackageInterval(from, 'month', undefined, 13).toISOString(), yearly.promotion!.benefitEnd, 249000, 360]);
    const renewing = (await quote(s, 'PROMOTION', { purchaseMode: 'PROMPTPAY_RENEW' })).promotion!;
    assert.deepEqual([renewing.expectedNextChargeAt, renewing.totalReceiptUnits], [renewing.benefitEnd, 60], 'a renewing mode first charges again when the free time ends');

    // Another tier is not in the campaign: an error with its reason, and no quote row. NORMAL stays purchasable.
    const before = await client.billingQuote.count({ where: { companyId: s } });
    await refused(quote(s, 'PROMOTION', { offerKey: 'BASIC_499' }), 'PROMOTION_UNAVAILABLE', 'OFFER_NOT_COVERED');
    await refused(quote(s, 'PROMOTION', { promotionCampaignId: 'unknown-campaign' }), 'PROMOTION_UNAVAILABLE', 'CHANGED');
    assert.equal(await client.billingQuote.count({ where: { companyId: s } }), before);
    assert.equal((await quote(s, 'NORMAL', { offerKey: 'BASIC_499' })).totalSatang, 49900);

    // No `benefitChoice`: the quote and its snapshot carry no promotion key at all, and equal an explicit NORMAL one but for that key.
    const plain = await quote(s), normal = await quote(s, 'NORMAL');
    assert.equal('benefitChoice' in plain, false); assert.equal('promotion' in plain, false); assert.equal('eventDiscount' in plain, false);
    const plainSnapshot = await snapshotOf(plain.quoteId);
    assert.equal('promotion' in plainSnapshot, false); assert.equal('benefitChoice' in plainSnapshot.quote, false);
    const stable = ({ quoteId: _id, expiresAt: _expires, benefitChoice: _choice, purchase, ...rest }: BillingQuote) => ({ ...rest, purchase: { ...purchase, projectedPaidThrough: null } });
    assert.deepEqual(stable(plain), stable(normal));
    assert.deepEqual([normal.benefitChoice, normal.promotion, (await snapshotOf(normal.quoteId)).promotion], ['NORMAL', undefined, undefined]);
  });

  it('refuses an ineligible promotion with its reason and never falls back to a normal quote (A34)', async () => {
    const live = campaign(), s = await shop();
    const closed: [BillingPromotionCampaign, string][] = [[{ ...live, paused: true }, 'PAUSED'], [{ ...live, endedAt: new Date().toISOString() }, 'ENDED'],
      [{ ...live, startsAt: new Date(Date.now() + HOUR / 2).toISOString() }, 'NOT_STARTED'], [{ ...live, rules: [live.rules[1]!] }, 'OFFER_NOT_COVERED']];
    for (const [next, reason] of closed) {
      await publish([next]);
      await refused(quote(s, 'PROMOTION'), 'PROMOTION_UNAVAILABLE', reason);
    }
    await publish([]);
    await refused(quote(s, 'PROMOTION'), 'PROMOTION_UNAVAILABLE', 'OFFER_NOT_COVERED');
    assert.equal(await client.billingQuote.count({ where: { companyId: s } }), 0, 'no refusal left a quote behind');
    // A shop without campaigns sees nothing new anywhere.
    const status = await service.status(ctx(s)), catalog = await service.catalog();
    for (const key of ['promotions', 'promotion', 'upgradeDeferredUntil']) assert.equal(key in status, false, key);
    assert.equal('promotions' in catalog, false);
    assert.equal((await quote(s, 'NORMAL')).totalSatang, 24900);
  });

  it('reserves with the attempt, refuses the next shop at a cap of 1, replays without reserving again, and shows the right (A03, A15, A36)', async () => {
    const live = campaign({ cap: 1 });
    await publish([live]);
    const [first, second] = [await shop(), await shop()];
    // The package page before anyone bought: both rules, for anyone. The public catalog: terms only.
    assert.deepEqual((await service.status(ctx(first))).promotions?.map(view => [view.campaignId, view.interval, view.totalMonths, view.totalReceiptUnits, view.available, view.reason]),
      [[live.campaignId, 'month', 2, 60, true, null], [live.campaignId, 'year', 13, 390, true, null]]);
    assert.deepEqual((await service.catalog()).promotions, [
      { displayName: live.displayName, offerKey: 'STARTER_249', interval: 'month', bonusMonths: 1, bonusReceiptUnits: 30, totalMonths: 2, totalReceiptUnits: 60, endsAt: live.endsAt },
      { displayName: live.displayName, offerKey: 'STARTER_249', interval: 'year', bonusMonths: 1, bonusReceiptUnits: 30, totalMonths: 13, totalReceiptUnits: 390, endsAt: live.endsAt }]);

    const [mine, theirs] = [await quote(first, 'PROMOTION', { purchaseMode: 'CARD_AUTO' }), await quote(second, 'PROMOTION')];
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 0, consumed: 0, taken: 0 }, 'a quote takes nothing');
    let seen: string | undefined;
    probe = async () => { seen = (await right(first, live.campaignId))?.state; };
    const key = `promo-replay-${run}`, opened = await checkout(first, mine, key);
    assert.equal(opened.state, 'OPEN'); assert.equal(seen, 'RESERVED', 'reserved before any provider request');
    const reserved = (await right(first, live.campaignId))!, attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: opened.attemptId } });
    assert.deepEqual([reserved.state, reserved.attemptId, reserved.policyRevisionId, reserved.billingAccountId, reserved.releaseCount],
      ['RESERVED', opened.attemptId, attempt.policyRevisionId, attempt.billingAccountId, 0]);
    // CARD_AUTO: paid now in a payment Checkout at the full price, the card saved for the renewal bound later; never a discount.
    const sent = sessions.at(-1)!;
    assert.deepEqual([sent.mode, sent.payment_method_types, sent.line_items[0].price_data.unit_amount, sent.payment_intent_data.setup_future_usage],
      ['payment', ['card'], 24900, 'off_session']);

    // The cap is used: the second shop's Checkout is refused whole — no attempt, no slot, no session, nothing counted.
    const count = sessions.length;
    await refused(checkout(second, theirs), 'PROMOTION_UNAVAILABLE', 'CAP_FULL');
    assert.equal(await client.billingAttempt.count({ where: { quoteId: theirs.quoteId } }), 0);
    assert.equal((await account(second)).activeAttemptId, null); assert.equal(sessions.length, count); assert.equal(await right(second, live.campaignId), null);
    await refused(quote(second, 'PROMOTION'), 'PROMOTION_UNAVAILABLE', 'CAP_FULL');
    assert.deepEqual((await service.status(ctx(second))).promotions?.map(view => [view.available, view.reason]), [[false, 'CAP_FULL'], [false, 'CAP_FULL']]);
    assert.equal((await quote(second, 'NORMAL')).totalSatang, 24900, 'the normal package stays purchasable');

    // The same Checkout key again: the same attempt and its open session, the right counted once.
    const replay = await checkout(first, mine, key);
    assert.deepEqual([replay.attemptId, replay.state, replay.checkoutUrl], [opened.attemptId, 'OPEN', opened.checkoutUrl]);
    assert.equal(sessions.length, count);
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 1, consumed: 0, taken: 1 });
    assert.equal((await right(first, live.campaignId))!.version, reserved.version);

    // While the right is reserved the shop has a purchase in flight: no second quote, and the views name the right.
    await refused(quote(first, 'PROMOTION'), 'BILLING_EXISTING_SUBSCRIPTION');
    const status = await service.status(ctx(first));
    assert.deepEqual(status.promotion, { campaignId: live.campaignId, displayName: live.displayName, state: 'RESERVED', paidEnd: null, benefitEnd: null, bonusMonths: 1,
      bonusReceiptUnits: 30, renewalSetupState: 'PENDING', expectedNextChargeAt: null });
    assert.equal('promotions' in status, false, 'nothing is advertised to a shop that cannot buy now');
    assert.deepEqual((await service.attempt(ctx(first), opened.attemptId)).promotion, status.promotion);
  });

  it('keeps a reserved right when the campaign is paused or ended before dispatch, and gives it back when the base policy changed (A04, A30, plan R3)', async () => {
    const live = campaign();
    await publish([live]);
    const [kept, ended, changed, plain] = [await shop(), await shop(), await shop(), await shop()];
    const dispatched = async (companyId: string, next: BillingPromotionCampaign) => {
      const q = await quote(companyId, 'PROMOTION', { purchaseMode: 'PROMPTPAY_ONCE' });
      probe = () => publish([next]);
      const result = await checkout(companyId, q);
      assert.equal(result.state, 'OPEN', 'a promise made before the campaign closed is kept');
      assert.equal((await right(companyId, live.campaignId))?.state, 'RESERVED');
      assert.deepEqual([sessions.at(-1)!.mode, sessions.at(-1)!.payment_method_types, sessions.at(-1)!.payment_intent_data.setup_future_usage], ['payment', ['promptpay'], undefined]);
      // The paused or ended campaign is still the active revision: the buyer can come back to the open Checkout.
      assert.equal((await service.resume(ctx(companyId), result.attemptId)).checkoutUrl, result.checkoutUrl);
      await refused(quote(await shop(), 'PROMOTION'), 'PROMOTION_UNAVAILABLE', next.paused ? 'PAUSED' : 'ENDED');
      await publish([live]);
    };
    await dispatched(kept, { ...live, paused: true });
    await dispatched(ended, { ...live, endedAt: new Date().toISOString() });

    // A purchase without a promotion keeps today's rule exactly: any new revision stops it before dispatch and hides its link.
    const normal = await quote(plain, 'NORMAL');
    probe = () => publish([{ ...live, paused: true }]);
    await refused(checkout(plain, normal), 'BILLING_SALES_CLOSED');
    assert.equal((await account(plain)).activeAttemptId, null);
    await publish([live]);
    const open = await checkout(plain, await quote(plain, 'NORMAL'));
    await publish([live]);
    assert.equal((await service.resume(ctx(plain), open.attemptId)).checkoutUrl, null);

    // The base policy changed between the reservation and the dispatch: fail closed, release, tell the audit which attempt.
    const q = await quote(changed, 'PROMOTION'), count = sessions.length;
    probe = () => publish([live], { ...policy, graceDays: 3 });
    await refused(checkout(changed, q), 'BILLING_SALES_CLOSED');
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { quoteId: q.quoteId } }), released = (await right(changed, live.campaignId))!;
    assert.deepEqual([attempt.status, (await account(changed)).activeAttemptId, sessions.length], ['FAILED', null, count]);
    assert.deepEqual([released.state, released.attemptId, released.releaseCount], ['RELEASED', null, 1]);
    const audit = await client.auditLog.findFirstOrThrow({ where: { companyId: changed, action: 'billing.promotion.released', targetId: released.id } });
    assert.deepEqual([(audit.metadataJson as any).attemptId, (audit.metadataJson as any).campaignId], [attempt.id, live.campaignId]);
    assert.equal('promotion' in await service.attempt(ctx(changed), attempt.id), false, 'a released right is no longer shown on its attempt');
    await publish([live]);
  });

  it('releases the right when the provider refused the Checkout, keeps it on an unknown outcome, and takes a released right again (A10)', async () => {
    const live = campaign({ cap: 2 });
    await publish([live]);
    const [rejected, unknown] = [await shop(), await shop()];
    sessionFailure = new StripeRequestError('REJECTED', 'synthetic_refusal');
    const failed = await checkout(rejected, await quote(rejected, 'PROMOTION'));
    assert.equal(failed.state, 'FAILED');
    const released = (await right(rejected, live.campaignId))!;
    assert.deepEqual([released.state, released.attemptId, released.releaseCount, (await account(rejected)).activeAttemptId], ['RELEASED', null, 1, null]);
    assert.equal(await client.auditLog.count({ where: { companyId: rejected, action: 'billing.promotion.released', metadataJson: { path: ['attemptId'], equals: failed.attemptId } } }), 1);
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 0, consumed: 0, taken: 0 });

    // A timeout proves nothing: the attempt stays UNKNOWN, the slot and the right stay taken, nothing is audited as released.
    sessionFailure = new StripeRequestError('UNKNOWN', 'synthetic_timeout');
    const lost = await checkout(unknown, await quote(unknown, 'PROMOTION'));
    assert.equal(lost.state, 'UNKNOWN');
    assert.deepEqual([(await right(unknown, live.campaignId))!.state, (await right(unknown, live.campaignId))!.attemptId, (await account(unknown)).activeAttemptId],
      ['RESERVED', lost.attemptId, lost.attemptId]);
    assert.equal(await client.auditLog.count({ where: { companyId: unknown, action: 'billing.promotion.released' } }), 0);

    // The released shop buys again: the same row, a new attempt.
    const again = await checkout(rejected, await quote(rejected, 'PROMOTION'));
    const taken = (await right(rejected, live.campaignId))!;
    assert.deepEqual([again.state, taken.id, taken.state, taken.attemptId, taken.releaseCount], ['OPEN', released.id, 'RESERVED', again.attemptId, 1]);
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 2, consumed: 0, taken: 2 });
  });

  it('uses one benefit per purchase: a promotion leaves the event ticket alone and an event discount leaves the campaign alone (A17, A34)', async () => {
    const live = campaign();
    await publish([live]);
    const [withPromotion, withTicket] = [await shop(), await shop()];
    const scopeJson = { tiers: ['STARTER_249'], intervals: ['month'] };
    const batch = await client.salesEventBatch.create({ data: { eventName: `งานโปร ${run}`, batchName: 'booth', discountSatang: 5000, issueCap: 5, issuedCount: 1,
      claimStartsAt: new Date(Date.now() - HOUR), claimEndsAt: new Date(Date.now() + HOUR), scopeJson, createdByUserId: `lead-${run}` } });
    batchIds.push(batch.id);
    const ticketId = (await client.salesEventTicket.create({ data: { serial: `P${run}`, batchId: batch.id, batchRevision: 1, salesUserId: `seller-${run}`, holderChannelId: `ch-${run}`,
      holderProviderUserId: `U${run}`, discountSatang: 5000, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0, scopeJson, expiresAt: new Date(Date.now() + 30 * 24 * HOUR),
      claimRequestKey: `claim-${run}` } })).id;
    const ticket = () => client.salesEventTicket.findUniqueOrThrow({ where: { id: ticketId } });

    // PROMOTION: the ticket on offer is recorded as declined, the Checkout charges the full price, the ticket stays ISSUED.
    const promo = await quote(withPromotion, 'PROMOTION', {}, holder);
    assert.deepEqual([promo.benefitChoice, promo.eventDiscount?.choice, promo.eventDiscount?.applied, promo.promotion?.totalReceiptUnits], ['PROMOTION', 'DECLINE', undefined, 60]);
    assert.deepEqual((await snapshotOf(promo.quoteId)).eventDiscount, { choice: 'DECLINE', offeredTicketId: ticketId });
    assert.equal((await checkout(withPromotion, promo, undefined, holder)).state, 'OPEN');
    assert.equal(sessions.at(-1)!.line_items[0].price_data.unit_amount, 24900);
    assert.deepEqual([(await ticket()).state, (await right(withPromotion, live.campaignId))?.state], ['ISSUED', 'RESERVED']);

    // NORMAL declines the ticket as well. EVENT_DISCOUNT uses it and never touches the campaign.
    const normal = await quote(withTicket, 'NORMAL', {}, holder);
    assert.deepEqual([normal.benefitChoice, normal.eventDiscount?.choice, normal.promotion], ['NORMAL', 'DECLINE', undefined]);
    const discounted = await quote(withTicket, 'EVENT_DISCOUNT', {}, holder);
    assert.deepEqual([discounted.benefitChoice, discounted.eventDiscount?.choice, discounted.eventDiscount?.applied?.totalSatang, discounted.promotion], ['EVENT_DISCOUNT', 'USE', 19900, undefined]);
    assert.equal((await snapshotOf(discounted.quoteId)).promotion, undefined);
    assert.equal((await checkout(withTicket, discounted, undefined, holder)).state, 'OPEN');
    assert.equal(sessions.at(-1)!.line_items[0].price_data.unit_amount, 19900);
    assert.deepEqual([(await ticket()).state, (await ticket()).companyId, await right(withTicket, live.campaignId)], ['RESERVED', withTicket, null]);
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 1, consumed: 0, taken: 1 });
    // Asking for the ticket without holding one is an error, not a quiet normal quote.
    await refused(quote(await shop(), 'EVENT_DISCOUNT'), 'SALES_EVENT_TICKET_UNAVAILABLE');
  });

  it('after the purchase applied: the source stays readable, an upgrade waits, the right is used once, and the views tell the free time (A03, plan R2, Q5)', async () => {
    const live = campaign();
    await publish([live]);
    const s = await shop(), opened = await checkout(s, await quote(s, 'PROMOTION'));
    const invoice = await applyPaid(s, opened.attemptId), paidThrough = (await account(s)).paidThrough!;
    assert.equal(paidThrough.getTime(), invoice.benefitEnd!.getTime()); assert.ok(invoice.periodEnd < invoice.benefitEnd!);
    const used = (await right(s, live.campaignId))!;
    assert.deepEqual([used.state, used.invoiceId, used.paidEnd?.getTime(), used.bonusEnd?.getTime()], ['CONSUMED', invoice.id, invoice.periodEnd.getTime(), invoice.benefitEnd!.getTime()]);

    // R2: paidThrough is the end of the free time, the invoice's financial period ends a month earlier — still one healthy source.
    const status = await service.status(ctx(s));
    assert.deepEqual([status.purchaseSource, status.purchaseBlockCode, status.paidThrough, status.interval, status.reference], ['PAID_CURRENT_MODE', null, paidThrough.toISOString(), 'month', invoice.id]);
    assert.deepEqual(status.promotion, { campaignId: live.campaignId, displayName: live.displayName, state: 'CONSUMED', paidEnd: invoice.periodEnd.toISOString(),
      benefitEnd: paidThrough.toISOString(), bonusMonths: 1, bonusReceiptUnits: 30, renewalSetupState: 'NOT_REQUIRED', expectedNextChargeAt: null });
    assert.equal(status.upgradeDeferredUntil, paidThrough.toISOString());
    assert.deepEqual(status.promotions?.map(view => [view.interval, view.available, view.reason]), [['month', false, 'ALREADY_USED'], ['year', false, 'ALREADY_USED']]);
    assert.deepEqual((await service.attempt(ctx(s), opened.attemptId)).promotion, status.promotion);
    const item = (await service.history(ctx(s), { limit: 10 })).items.find(row => row.id === invoice.id)!;
    assert.deepEqual([item.periodEnd, item.promotion], [invoice.periodEnd.toISOString(),
      { displayName: live.displayName, paidEnd: invoice.periodEnd.toISOString(), benefitEnd: paidThrough.toISOString(), bonusReceiptUnits: 30 }]);

    // Once per company per campaign, whatever the interval; the normal repeat continues from the end of the free time.
    await refused(quote(s, 'PROMOTION'), 'PROMOTION_UNAVAILABLE', 'ALREADY_USED');
    const repeat = await quote(s, 'NORMAL');
    assert.deepEqual([repeat.purchase?.kind, repeat.purchase?.previousPaidThrough, repeat.purchase?.projectedPaidThrough],
      ['REPEAT', paidThrough.toISOString(), appendPackageInterval(paidThrough, 'month', (await account(s)).billingAnchorDay!).toISOString()]);
    // Q5: an immediate upgrade over the promotion purchase waits until everything committed ended — differential or full-package.
    await refused(quote(s, 'NORMAL', { offerKey: 'BASIC_499' }), 'PROMOTION_UPGRADE_DEFERRED');
    await refused(quote(s, undefined, { offerKey: 'PRO_999', purchaseIntent: 'FULL_PACKAGE' }), 'PROMOTION_UPGRADE_DEFERRED');
    // The locked Checkout recheck reads the same source: the normal repeat opens.
    assert.equal((await checkout(s, repeat)).state, 'OPEN');

    // A second campaign is a new right: bought as a repeat, it starts where the free time ends and keeps the anchor day.
    const other = await shop(), first = await checkout(other, await quote(other, 'PROMOTION')), source = await applyPaid(other, first.attemptId);
    const next = campaign({ displayName: 'แคมเปญที่สอง' });
    await publish([live, next]);
    const second = await quote(other, 'PROMOTION'), anchorDay = (await account(other)).billingAnchorDay!;
    assert.deepEqual([second.purchase?.kind, second.promotion?.campaignId, second.promotion?.paidStart, second.promotion?.paidEnd, second.promotion?.benefitEnd],
      ['REPEAT', next.campaignId, source.benefitEnd!.toISOString(), appendPackageInterval(source.benefitEnd!, 'month', anchorDay).toISOString(),
        appendPackageInterval(source.benefitEnd!, 'month', anchorDay, 2).toISOString()]);
    assert.equal(second.purchase?.projectedPaidThrough, second.promotion?.paidEnd);
    assert.equal((await checkout(other, second)).state, 'OPEN');
    assert.equal((await right(other, next.campaignId))?.state, 'RESERVED');
  });

  it('refuses a promotion on an upgrade, a scheduled change and a live card subscription, and still sells them normally (plan R10)', async () => {
    const live = campaign();
    await publish([live]);
    // An active one-time Starter month bought normally.
    const s = await shop();
    await applyPaid(s, (await checkout(s, await quote(s, 'NORMAL'))).attemptId);
    for (const [body, kind] of [[{ offerKey: 'BASIC_499' }, 'UPGRADE'], [{ interval: 'year' }, 'SCHEDULED_CHANGE']] as const) {
      await refused(quote(s, 'PROMOTION', body), 'PROMOTION_UNAVAILABLE', 'PURCHASE_KIND_UNSUPPORTED');
      assert.equal((await quote(s, 'NORMAL', body)).purchase?.kind, kind);
    }
    await refused(quote(s, 'PROMOTION', { offerKey: 'BASIC_499', purchaseIntent: 'FULL_PACKAGE' }), 'PROMOTION_UNAVAILABLE', 'PURCHASE_KIND_UNSUPPORTED');
    // The page says so up front: the same offer may repeat with the promotion, the other cadence may not.
    assert.deepEqual((await service.status(ctx(s))).promotions?.map(view => [view.interval, view.available, view.reason]),
      [['month', true, null], ['year', false, 'PURCHASE_KIND_UNSUPPORTED']]);
    assert.equal((await quote(s, 'PROMOTION')).purchase?.kind, 'REPEAT');

    // A live CARD_AUTO subscription: its repeat runs through a provider schedule the promotion does not enter in release 1.
    const sub = await shop(), paidThrough = appendPackageInterval(new Date(), 'month');
    const term = await client.companyPlanTerm.create({ data: { companyId: sub, tierKey: 'STARTER_249', branchLimit: month.branchLimit, employeeLimit: month.employeeLimit,
      monthlySlipLimit: 30, termStartAt: new Date(), termEndsAt: paidThrough, billingReceiptAccountId: (await account(sub)).id } });
    const bound = await client.billingAccount.update({ where: { id: (await account(sub)).id }, data: { baseSubscriptionId: `sub_${run}`, renewalMode: 'CARD_AUTO',
      subscriptionState: 'active', paidThrough, billingAnchorDay: paidThrough.getUTCDate(), contractAttemptId: `contract-${run}`, termProjectionHash: termProjectionHash(term) } });
    await client.billingSubscriptionContract.create({ data: { billingAccountId: bound.id, sourceAttemptId: `contract-${run}`, effectiveAt: new Date(Date.now() - HOUR),
      snapshotJson: { quote: { offer: month }, priceId: policy.priceIds['STARTER_249:month'], policy } } });
    Object.defineProperty(service, 'repeater', { configurable: true, value: { source: async () => ({ subscriptionId: `sub_${run}`, paidThrough: paidThrough.toISOString(),
      anchorDay: bound.billingAnchorDay, sourceInterval: 'month' }) } });
    try {
      await refused(quote(sub, 'PROMOTION', { purchaseMode: 'CARD_AUTO' }), 'PROMOTION_UNAVAILABLE', 'PURCHASE_KIND_UNSUPPORTED');
      assert.equal((await quote(sub, 'NORMAL', { purchaseMode: 'CARD_AUTO' })).purchase?.kind, 'REPEAT');
      assert.equal(await right(sub, live.campaignId), null);
    } finally { delete (service as any).repeater; }
  });
});
