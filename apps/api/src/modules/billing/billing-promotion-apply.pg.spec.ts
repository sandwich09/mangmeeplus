/**
 * Promotion campaigns from paid evidence onwards, against real PostgreSQL (docs/plans/starter-249-bonus-month-promotion-plan.md
 * §6 "Purchase-flow rules"; spec §5–§7; A01, A05, A06, A07, A10, A11, A15, A16, A30, A33, G13, plan R2). The real quote →
 * Checkout → reconcile → bind code with a Stripe fake modelled on billing-event-discount-renewal.pg.spec.ts. The quote is the
 * NORMAL one; the promotion snapshot is pinned into the attempt and its right reserved through the foundation seams, which is
 * what the checkout lane does in the same transaction.
 *
 * Run with:
 *   BILLING_PROMOTION_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-promotion-apply.pg.spec.ts
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, billingOffer, type BillingInterval, type BillingPromotionCampaign, type BillingPurchaseMode } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { BillingService } from './application/billing.service';
import { BILLING_PROMOTION_REVIEW_ISSUE } from '@watchdog-bms/contracts';
import { BillingReconcilerService } from './application/billing-reconciler.service';
import { lockPromotionFence, promotionEligibility, promotionForInvoice, releasePromotion, reservePromotion } from './application/billing-promotion';
import { appendPackageInterval } from './domain/billing-package';
import { termProjectionHash } from './domain/paid-invoice';
import { promotionOfferSignature } from './domain/billing-promotion';

const databaseUrl = process.env.BILLING_PROMOTION_TEST_DATABASE_URL;
const address = { line1: '99 ถนนทดสอบ', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' };
const PRICES: Record<string, [BillingInterval, string]> = { price_StarterMonth: ['month', 'STARTER_249'], price_StarterYear: ['year', 'STARTER_249'] };
const policy = { ...BILLING_DRAFT_POLICY, portalConfigurationId: 'bpc_synthetic', priceIds: {
  'STARTER_249:month': 'price_StarterMonth', 'STARTER_249:year': 'price_StarterYear', 'BASIC_499:month': 'price_BasicMonth', 'BASIC_499:year': 'price_BasicYear',
  'PRO_999:month': 'price_ProMonth', 'PRO_999:year': 'price_ProYear', 'ENTERPRISE_1999:month': 'price_EntMonth', 'ENTERPRISE_1999:year': 'price_EntYear' } };
const tax = policy.taxTreatment, iso = (date: Date | null | undefined) => date?.toISOString() ?? null;
const months = (start: Date, count: number, anchorDay?: number) => appendPackageInterval(start, 'month', anchorDay, count).toISOString();

/** One shop on its own Stripe account with one published campaign that the database clock always finds open. */
async function fixture(client: PrismaClient, options: { trial?: boolean } = {}) {
  const run = randomUUID().replaceAll('-', '').slice(0, 12), stripeAccountId = `acct_${run}`, owner = `pa-owner-${run}`, companyId = `pa-shop-${run}`, customerId = `cus_${run}`;
  const campaign: BillingPromotionCampaign = { campaignId: `promo-${run}`, type: 'BONUS_MONTHS', revision: 1, internalName: 'Synthetic', description: null,
    displayName: 'ซื้อ 1 เดือน ฟรี 1 เดือน', startsAt: '2020-01-01T00:00:00.000Z', endsAt: '2099-01-01T00:00:00.000Z', cap: null, paused: false, endedAt: null,
    rules: (['month', 'year'] as const).map(interval => ({ offerKey: 'STARTER_249' as const, interval, bonusMonths: 1, bonusReceiptUnits: 30,
      offerSignature: promotionOfferSignature(billingOffer('STARTER_249', interval, policy), tax) })) };
  let version = 0;
  /** A new ACTIVE revision carrying the policy and this campaign, as a campaign publication does (plan R1). */
  const publish = async (over: Partial<BillingPromotionCampaign> = {}) => {
    const promotions = { [campaign.campaignId]: { ...campaign, ...over } }, id = `${stripeAccountId}:test`;
    const revision = await client.billingPolicyRevision.create({ data: { stripeAccountId, livemode: false, version: version += 1, state: 'ACTIVE', policyJson: policy,
      promotionJson: promotions, createdByUserId: `admin-${run}` } });
    await client.billingSettings.upsert({ where: { id }, create: { id, stripeAccountId, livemode: false, gatesJson: {}, policyRevisionId: revision.id }, update: { policyRevisionId: revision.id } });
    return { revision, promotions };
  };
  const published = await publish();
  const state = { policy, revision: { id: published.revision.id }, settings: { version: 1, livemode: false }, gates: Object.fromEntries(BILLING_ACTIONS.map(action => [action, true])),
    promotions: published.promotions };
  const sessions: Record<string, any>[] = [], subscriptions = new Map<string, any>(), customers = new Map<string, Record<string, unknown>>();
  const calls: { method: string; path: string; params?: any; key?: string }[] = [], issues: string[] = [];
  /** Everything Stripe holds about paid money, by id; `checkoutLines` is the last Checkout's. */
  const paid = { intents: new Map<string, any>(), charges: new Map<string, any>(), payments: new Map<string, any[]>(), lines: new Map<string, any[]>(),
    checkoutLines: [] as any[], renewals: [] as any[], loseNextSubscription: false };
  const stripe = { enabled: true, accountId: stripeAccountId, livemode: false, assertAccount: async () => {},
    request: async (method: string, path: string, params?: any, key?: string): Promise<any> => {
      calls.push({ method, path, params, key });
      const id = path.split('/').at(-1)!;
      if (path.startsWith('/prices/')) { const [interval, tier] = PRICES[id]!; return { id, object: 'price', livemode: false, active: true, type: 'recurring', product: 'prod_Synthetic',
        currency: 'thb', unit_amount: billingOffer(tier as 'STARTER_249', interval, policy).priceSatang, recurring: { interval, interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit' }; }
      if (path.startsWith('/customers/')) { if (method === 'POST') customers.set(id, params); return { id, metadata: { billingAccountId: account.id }, ...customers.get(id) }; }
      if (path.startsWith('/payment_intents/')) return paid.intents.get(id);
      if (path.startsWith('/charges/')) return paid.charges.get(id);
      if (path.startsWith('/payment_methods/')) return { id, object: 'payment_method', type: 'card', customer: customerId };
      if (method === 'POST' && path === '/checkout/sessions') {
        sessions.push(params);
        return { id: `cs_${run}${sessions.length}`, object: 'checkout.session', livemode: false, mode: params.mode, client_reference_id: params.client_reference_id,
          customer: params.customer, metadata: params.metadata, url: `https://checkout.stripe.com/c/pay/cs_${run}${sessions.length}` };
      }
      if (method === 'POST' && path === '/subscriptions') {
        const subId = `sub_${run}${subscriptions.size + 1}`, item = params.items[0];
        subscriptions.set(subId, { id: subId, object: 'subscription', livemode: false, customer: params.customer, status: 'trialing', metadata: params.metadata,
          billing_mode: params.billing_mode, collection_method: params.collection_method, payment_settings: params.payment_settings,
          default_payment_method: params.default_payment_method ?? null, trial_end: params.trial_end, trial_settings: params.trial_settings, cancel_at_period_end: false,
          items: { has_more: false, data: [{ id: `si_${run}`, price: item.price, quantity: item.quantity, tax_rates: item.tax_rates ?? [],
            current_period_start: Math.floor(Date.now() / 1000), current_period_end: params.trial_end }] } });
        if (paid.loseNextSubscription) { paid.loseNextSubscription = false; throw new Error('synthetic: response lost after Stripe created it'); }
        return structuredClone(subscriptions.get(subId));
      }
      if (path.startsWith('/subscriptions/') && subscriptions.has(id)) return structuredClone(subscriptions.get(id));
      throw new Error(`unmocked Stripe request ${method} ${path}`);
    },
    list: async (path: string, params?: any) => {
      if (path === '/subscriptions') return [...subscriptions.values()].map(sub => structuredClone(sub));
      // A subscription bound trialing: its $0 subscription_create invoice, then whatever it really charged afterwards.
      if (path === '/invoices') return params?.subscription ? [{ id: `in_zero_${params.subscription}`, object: 'invoice', livemode: false, customer: customerId,
        status: 'paid', billing_reason: 'subscription_create', total: 0, amount_paid: 0, created: 1, parent: { subscription_details: { subscription: params.subscription } } },
        ...paid.renewals.filter(invoice => invoice.parent.subscription_details.subscription === params.subscription)] : [];
      if (path === '/invoice_payments') return paid.payments.get(params.invoice) ?? [];
      if (path.endsWith('/line_items')) return paid.checkoutLines;
      if (path.endsWith('/lines')) return paid.lines.get(path.split('/').at(-2)!) ?? [];
      return [];
    } };
  const service = { prisma: { client }, config: { stripeAccountId, sesWebBaseUrl: 'https://app.example.test' }, stripe,
    assertOwner: async () => {}, assertTaxSettings: async () => {}, settings: async () => state, issue: async (_companyId: string, kind: string) => { issues.push(kind); },
    account: (id: string, tx = client) => tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: { companyId: id, stripeAccountId, livemode: false } } }),
    purchaseSource: (company: Parameters<BillingService['purchaseSource']>[0], current: Parameters<BillingService['purchaseSource']>[1], tx = client) =>
      BillingService.prototype.purchaseSource.call({ prisma: { client }, stripe } as unknown as BillingService, company, current, tx),
    usage: async () => ({ used: 0, limit: null, remaining: null, resetsAt: null, cadence: 'PAID_GRANTS', expiresAt: null }),
  } as unknown as BillingService;
  const reconciler = new BillingReconcilerService({ client } as any, {} as any, stripe as any, service, {} as any);
  const context = { companyId, userId: owner, requestId: run } as any;

  await client.user.create({ data: { id: owner, displayName: 'Synthetic owner', email: `${owner}@example.test`, emailVerifiedAt: new Date() } });
  await client.company.create({ data: { id: companyId, name: 'Synthetic promotion shop', addressJson: address } });
  const account = await client.billingAccount.create({ data: { companyId, stripeAccountId, livemode: false, customerId } });
  // A legacy trial still running: its unused receipts carry into the first paid period (G13).
  if (options.trial) await client.companyPlanTerm.create({ data: { companyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 15,
    termStartAt: new Date(Date.now() - 86_400_000), termEndsAt: new Date(Date.now() + 10 * 86_400_000) } });
  let keys = 0;
  /** Pins the campaign into the attempt and reserves its right: fence first, then the reservation (plan §6). */
  const reserve = async (attemptId: string) => {
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: attemptId } }), snapshot = attempt.quoteSnapshot as any;
    const eligible = await promotionEligibility(client, { settings: state, companyId, offer: snapshot.quote.offer, tax, now: new Date() });
    assert.ok(eligible.ok, JSON.stringify(eligible));
    await client.billingAttempt.update({ where: { id: attemptId }, data: { quoteSnapshot: { ...snapshot, promotion: eligible.snapshot } } });
    assert.equal(await client.$transaction(async tx => {
      await lockPromotionFence(tx, 'TEST');
      return reservePromotion(tx, { snapshot: eligible.snapshot, stripeAccountId, livemode: false, billingAccountId: account.id, companyId, attemptId, policyRevisionId: attempt.policyRevisionId });
    }), true);
  };
  /** Quote and Checkout of a Starter purchase; `promotion` turns it into the campaign's purchase. */
  const buy = async (purchaseMode: BillingPurchaseMode, interval: BillingInterval, promotion: boolean) => {
    const quoted = await BillingService.prototype.quote.call(service, context, { offerKey: 'STARTER_249', interval, purchaseMode });
    const opened = await BillingService.prototype.checkout.call(service, context, { quoteId: quoted.quoteId, consentRevision: quoted.consentRevision, accepted: true, channel: 'web' }, `pa-idem-${run}-${++keys}`);
    if (promotion) await reserve(opened.attemptId);
    return { attemptId: opened.attemptId, amount: quoted.totalSatang, kind: quoted.purchase?.kind };
  };
  /** Stripe's objects for money received: the charge, its intent and its invoice payment. */
  const money = (n: string, amount: number, method: 'card' | 'promptpay', invoiceId: string) => {
    const charge = { id: `ch_${n}`, livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount, customer: customerId,
      payment_intent: `pi_${n}`, payment_method_details: { type: method }, amount_refunded: 0, disputed: false, balance_transaction: null };
    paid.charges.set(charge.id, charge);
    paid.intents.set(`pi_${n}`, { id: `pi_${n}`, livemode: false, status: 'succeeded', currency: 'thb', amount_received: amount, customer: customerId, latest_charge: charge,
      payment_method: method === 'card' ? `pm_${n}` : null, setup_future_usage: method === 'card' ? 'off_session' : null });
    paid.payments.set(invoiceId, [{ object: 'invoice_payment', livemode: false, status: 'paid', invoice: invoiceId, payment: { type: 'payment_intent', payment_intent: `pi_${n}` }, amount_paid: amount, currency: 'thb' }]);
  };
  /** The paid one-time Checkout of this attempt (what `paidPackageCheckoutEvidence` checks), paid a minute ago. */
  const pay = async (attemptId: string, amount: number, method: 'card' | 'promptpay') => {
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const created = Math.floor(Date.now() / 1000) - 60, meta = { billingAttemptId: attempt.id, billingAccountId: account.id }, n = `${run}${++keys}`;
    money(n, amount, method, `in_${n}`);
    paid.checkoutLines = [{ quantity: 1, currency: 'thb', amount_total: amount, amount_tax: 0, amount_discount: 0,
      price: { id: `price_inline${n}`, product: 'prod_Synthetic', type: 'one_time', active: false, recurring: null, livemode: false, currency: 'thb', unit_amount: amount } }];
    paid.lines.set(`in_${n}`, [{ parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: `ii_${n}`, subscription: null, proration: false } },
      pricing: { price_details: { price: `price_inline${n}`, product: 'prod_Synthetic' } }, amount, currency: 'thb', livemode: false, quantity: 1 }]);
    const session = { id: attempt.checkoutSessionId, object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
      subscription: null, customer: customerId, client_reference_id: attempt.id, metadata: meta, invoice: `in_${n}`, payment_intent: `pi_${n}`,
      invoice_creation: { enabled: true }, currency: 'thb', amount_total: amount, total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: 0 }, created,
      customer_details: { email: `${owner}@example.test` } };
    const invoice = { id: `in_${n}`, object: 'invoice', livemode: false, customer: customerId, metadata: meta, status: 'paid', billing_reason: 'manual',
      collection_method: 'send_invoice', parent: null, currency: 'thb', total: amount, amount_paid: amount, amount_remaining: 0, starting_balance: 0,
      status_transitions: { paid_at: created + 3 }, number: `PA-${n}` };
    return { attemptId, session, invoice, paidAt: new Date((created + 3) * 1000) };
  };
  /** The bound subscription's first real charge: one catalog-price cycle from `start`, the subscription now active in it. */
  const renew = (subscriptionId: string, start: Date, end: Date, amount: number, method: 'card' | 'promptpay') => {
    const n = `${run}${++keys}`, sub = subscriptions.get(subscriptionId), period = { start: start.getTime() / 1000, end: end.getTime() / 1000 };
    money(n, amount, method, `in_${n}`);
    Object.assign(sub, { status: 'active', trial_end: null }); Object.assign(sub.items.data[0], { current_period_start: period.start, current_period_end: period.end });
    paid.lines.set(`in_${n}`, [{ parent: { type: 'subscription_item_details', subscription_item_details: { proration: false, subscription_item: sub.items.data[0].id, subscription: subscriptionId } },
      pricing: { price_details: { price: sub.items.data[0].price } }, currency: 'thb', quantity: 1, livemode: false, period }]);
    paid.renewals.push({ id: `in_${n}`, object: 'invoice', livemode: false, customer: customerId, status: 'paid', billing_reason: 'subscription_cycle',
      collection_method: method === 'card' ? 'charge_automatically' : 'send_invoice', currency: 'thb', total: amount, amount_paid: amount, amount_remaining: 0, starting_balance: 0,
      created: period.start, number: `PA-${n}`, parent: { subscription_details: { subscription: subscriptionId } }, status_transitions: { paid_at: period.start } });
    return `in_${n}`;
  };
  /** The reconciler's one-time route for this attempt under a fresh lease; `recordOnly` is the invoice import. */
  const reconcileOneTime = async (source: { attemptId: string; session: any; invoice?: any }, recordOnly?: () => Promise<void>) => {
    const lease = `lease-${run}-${++keys}`;
    const current = await client.billingAccount.update({ where: { id: account.id }, data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: source.attemptId } });
    try { return await (reconciler as any).reconcileOneTime(current, attempt, lease, recordOnly, source.session, source.invoice); }
    finally { await client.billingAccount.update({ where: { id: account.id }, data: { leaseToken: null, leaseUntil: null } }); }
  };
  const read = {
    account: () => client.billingAccount.findUniqueOrThrow({ where: { id: account.id } }),
    term: () => client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } }),
    invoice: (attemptId: string) => client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attemptId } }),
    right: () => client.billingPromotionRedemption.findFirstOrThrow({ where: { companyId } }),
    /** Every receipt lot as `[kind, units, serviceStart, serviceEnd, availableAt, expiresAt]`, oldest service first. */
    lots: async () => (await client.billingReceiptGrant.findMany({ where: { companyId }, orderBy: [{ serviceStart: 'asc' }, { kind: 'asc' }] }))
      .map(lot => [lot.kind, lot.units, iso(lot.serviceStart), iso(lot.serviceEnd), iso(lot.availableAt), iso(lot.expiresAt)]),
    review: () => client.billingIssue.count({ where: { companyId, kind: BILLING_PROMOTION_REVIEW_ISSUE } }),
  };
  const cleanup = async () => {
    const steps: (() => Promise<unknown>)[] = [
      () => client.billingAccount.updateMany({ where: { companyId }, data: { activeAttemptId: null, contractAttemptId: null, activeCollectionOperationId: null } }),
      () => client.billingPromotionRedemption.deleteMany({ where: { companyId } }),
      () => client.billingSubscriptionContract.deleteMany({ where: { billingAccountId: account.id } }),
      ...['outboxEvent', 'auditLog', 'billingIssue', 'entitlementCommand', 'entitlementTransition', 'runoffSnapshot', 'companyFeatureEntitlement',
        'companyEntitlementNormalization', 'companyEntitlementSet', 'salesAttribution', 'billingOperation', 'billingReceiptGrant', 'billingQuote']
        .map(model => () => (client as any)[model].deleteMany({ where: { companyId } })),
      () => client.billingAttempt.deleteMany({ where: { billingAccountId: account.id } }),
      () => client.billingInvoice.deleteMany({ where: { billingAccountId: account.id } }),
      () => client.companyPlanTerm.deleteMany({ where: { companyId } }),
      () => client.billingAccount.deleteMany({ where: { companyId } }),
      () => client.company.deleteMany({ where: { id: companyId } }),
      () => client.user.deleteMany({ where: { id: owner } }),
      () => client.billingSettings.deleteMany({ where: { stripeAccountId } }),
      () => client.billingPolicyRevision.deleteMany({ where: { stripeAccountId } }),
    ];
    for (const step of steps) await step().catch(() => undefined);
  };
  return { run, client, account, companyId, campaign, publish, paid, sessions, subscriptions, calls, issues, reconciler, buy, pay, renew, reconcileOneTime, read, cleanup };
}

const connect = () => {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_ci'), 'only a disposable local *_ci database');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
};
/** Runs `body` with its own client and fixtures, always cleaned up; `at` freezes the application clock (the database keeps its own). */
const scenario = (name: string, body: (shop: (options?: { trial?: boolean }) => Promise<Awaited<ReturnType<typeof fixture>>>, client: PrismaClient) => Promise<void>, at?: string) =>
  test(name, { skip: !databaseUrl }, async () => {
    const client = connect(), made: Awaited<ReturnType<typeof fixture>>[] = [];
    if (at) mock.timers.enable({ apis: ['Date'], now: new Date(at) });
    try { await body(async options => { const f = await fixture(client, options); made.push(f); return f; }, client); }
    finally { mock.timers.reset(); for (const f of made) await f.cleanup(); await client.$disconnect(); }
  });

scenario('CARD_ONCE month: one paid month and one free month, 30 + 30 receipts, the right consumed and applied once; a later normal repeat starts at benefitEnd', async shop => {
  const f = await shop({ trial: true }), bought = await f.buy('CARD_ONCE', 'month', true);
  assert.deepEqual([bought.kind, bought.amount], ['INITIAL', 24900]);
  const paid = await f.pay(bought.attemptId, bought.amount, 'card'), S = iso(paid.paidAt)!, paidEnd = months(paid.paidAt, 1), benefitEnd = months(paid.paidAt, 2);
  await f.reconcileOneTime(paid);

  const invoice = await f.read.invoice(bought.attemptId);
  // A01/A07: the financial period is the paid month only; the service this bill gives ends a month later.
  assert.deepEqual([invoice.applyStatus, invoice.totalSatang, iso(invoice.periodStart), iso(invoice.periodEnd), iso(invoice.benefitEnd)], ['APPLIED', 24900, S, paidEnd, benefitEnd]);
  let account = await f.read.account();
  assert.deepEqual([iso(account.paidThrough), iso((await f.read.term()).termEndsAt), account.renewalMode, account.activeAttemptId, account.baseSubscriptionId, account.nextChargeAt],
    [benefitEnd, benefitEnd, 'CARD_ONCE', null, null, null]);
  // A10: base 30 of the paid month and bonus 30 of the free month, both usable from the payment and ending at benefitEnd.
  // G13: the trial's carried receipts end with the PAID month — a trial gift is not stretched by the free time.
  const lots = await f.read.lots();
  assert.deepEqual(lots.filter(lot => lot[0] !== 'TRIAL_CARRYOVER'), [['INITIAL', 30, S, paidEnd, S, benefitEnd], ['PROMOTION', 30, paidEnd, benefitEnd, S, benefitEnd]]);
  assert.deepEqual(lots.filter(lot => lot[0] === 'TRIAL_CARRYOVER'), [['TRIAL_CARRYOVER', 15, S, paidEnd, S, paidEnd]]);
  assert.equal((await f.client.billingReceiptGrant.findFirstOrThrow({ where: { companyId: f.companyId, kind: 'PROMOTION' } })).sourceKey, `promo:${invoice.id}`);
  const right = await f.read.right();
  assert.deepEqual([right.state, right.invoiceId, right.attemptId, iso(right.paidStart), iso(right.paidEnd), iso(right.bonusEnd), !!right.benefitAppliedAt],
    ['CONSUMED', invoice.id, bought.attemptId, S, paidEnd, benefitEnd, true]);
  assert.equal((await promotionForInvoice(f.client, invoice.id))?.id, right.id);
  assert.equal(f.calls.some(call => call.path === '/subscriptions' && call.method === 'POST'), false, 'a one-time purchase binds no subscription');
  const audit = await f.client.auditLog.findFirstOrThrow({ where: { companyId: f.companyId, action: 'billing.invoice.applied' } });
  assert.deepEqual((audit.metadataJson as any).promotion, { campaignId: f.campaign.campaignId, paidEnd, benefitEnd });

  // A16: the same paid event again changes nothing — one invoice, one base lot, one bonus lot, the same redemption.
  await f.reconcileOneTime(paid);
  assert.deepEqual(await f.read.lots(), lots);
  assert.deepEqual([(await f.read.right()).version, await f.client.billingInvoice.count({ where: { billingAccountId: f.account.id } }), await f.read.review()], [right.version, 1, 0]);
  assert.equal(iso((await f.read.account()).paidThrough), benefitEnd);

  // Plan R2: a later NORMAL repeat names this bill as its source at paidThrough = benefitEnd, applies, and starts there.
  // Its attempt is written directly: the quote side of R2 belongs to the checkout lane.
  const first = await f.client.billingAttempt.findUniqueOrThrow({ where: { id: bought.attemptId } }), old = first.quoteSnapshot as any, term = await f.read.term();
  const { promotion: _promotion, trialCarryover: _trial, featurePlan: _plan, capacity: _capacity, ...base } = old, quoteId = randomUUID();
  const repeat = await f.client.billingAttempt.create({ data: { billingAccountId: f.account.id, initiatingUserId: first.initiatingUserId, quoteId, channel: 'web',
    idempotencyKey: `pa-repeat-${f.run}`, requestHash: 'synthetic', policyRevisionId: first.policyRevisionId, consentRevision: first.consentRevision, consentAt: new Date(),
    status: 'OPEN', checkoutSessionId: `cs_${f.run}repeat`, quoteSnapshot: { ...base, quote: { ...old.quote, quoteId, purchase: { ...old.quote.purchase, kind: 'REPEAT' } },
      termHash: termProjectionHash(term), oneTime: { invoiceId: invoice.id, paidThrough: benefitEnd, anchorDay: account.billingAnchorDay, offerKey: 'STARTER_249', interval: 'month' } } } });
  await f.client.billingAccount.update({ where: { id: f.account.id }, data: { activeAttemptId: repeat.id } });
  await f.reconcileOneTime(await f.pay(repeat.id, 24900, 'card'));
  const next = await f.read.invoice(repeat.id), nextEnd = months(new Date(benefitEnd), 1, account.billingAnchorDay!);
  assert.deepEqual([next.applyStatus, iso(next.periodStart), iso(next.periodEnd), next.benefitEnd], ['APPLIED', benefitEnd, nextEnd, null]);
  account = await f.read.account();
  assert.deepEqual([iso(account.paidThrough), iso((await f.read.term()).termEndsAt)], [nextEnd, nextEnd]);
  // The repeat carries the still-valid paid lot to its own end; the bonus lot keeps the end of its free month.
  assert.deepEqual((await f.read.lots()).filter(lot => lot[0] !== 'TRIAL_CARRYOVER').map(lot => [lot[0], lot[1], lot[5]]),
    [['INITIAL', 30, nextEnd], ['PROMOTION', 30, benefitEnd], ['REPEAT', 30, nextEnd]]);
  assert.deepEqual([(await f.read.right()).version, await f.read.review()], [right.version, 0]);
});

scenario('PROMPTPAY_ONCE year: twelve paid months and one free month, 360 + 30 receipts', async shop => {
  const f = await shop(), bought = await f.buy('PROMPTPAY_ONCE', 'year', true);
  const paid = await f.pay(bought.attemptId, bought.amount, 'promptpay'), S = iso(paid.paidAt)!, paidEnd = months(paid.paidAt, 12), benefitEnd = months(paid.paidAt, 13);
  await f.reconcileOneTime(paid);
  const invoice = await f.read.invoice(bought.attemptId), account = await f.read.account();
  assert.deepEqual([invoice.applyStatus, invoice.totalSatang, iso(invoice.periodEnd), iso(invoice.benefitEnd), iso(account.paidThrough), iso((await f.read.term()).termEndsAt), account.renewalMode],
    ['APPLIED', bought.amount, paidEnd, benefitEnd, benefitEnd, benefitEnd, 'PROMPTPAY_ONCE']);
  assert.deepEqual(await f.read.lots(), [['INITIAL', 360, S, paidEnd, S, benefitEnd], ['PROMOTION', 30, paidEnd, benefitEnd, S, benefitEnd]]);
  assert.deepEqual([(await f.read.right()).state, iso((await f.read.right()).bonusEnd)], ['CONSUMED', benefitEnd]);
});

// A05/A06: months are counted once from the start with the original anchor day — never from a clamped date.
scenario('paid on 31 January: paidEnd 28 February and benefitEnd 31 March; a promotion repeat continues from the old paidThrough on the same anchor', async shop => {
  const a = await shop(), first = await a.buy('CARD_ONCE', 'month', true), paidA = await a.pay(first.attemptId, first.amount, 'card');
  assert.equal(iso(paidA.paidAt), '2027-01-31T02:59:03.000Z');
  await a.reconcileOneTime(paidA);
  const invoiceA = await a.read.invoice(first.attemptId), accountA = await a.read.account();
  assert.deepEqual([iso(invoiceA.periodEnd), iso(invoiceA.benefitEnd), iso(accountA.paidThrough), accountA.billingAnchorDay],
    ['2027-02-28T02:59:03.000Z', '2027-03-31T02:59:03.000Z', '2027-03-31T02:59:03.000Z', 31]);

  // A06: a normal month first (to 28 Feb, anchor 31), then the promotion as a repeat while that month runs.
  const b = await shop(), normal = await b.buy('CARD_ONCE', 'month', false);
  await b.reconcileOneTime(await b.pay(normal.attemptId, normal.amount, 'card'));
  const before = await b.read.account(), oldEnd = iso(before.paidThrough)!;
  assert.deepEqual([oldEnd.slice(0, 10), before.billingAnchorDay, (await b.read.invoice(normal.attemptId)).benefitEnd], ['2027-02-28', 31, null]);
  const repeat = await b.buy('CARD_ONCE', 'month', true);
  assert.equal(repeat.kind, 'REPEAT');
  const paidB = await b.pay(repeat.attemptId, repeat.amount, 'card'), start = new Date(oldEnd), paidEnd = months(start, 1, 31), benefitEnd = months(start, 2, 31);
  await b.reconcileOneTime(paidB);
  const invoiceB = await b.read.invoice(repeat.attemptId), after = await b.read.account();
  assert.deepEqual([paidEnd.slice(0, 10), benefitEnd.slice(0, 10)], ['2027-03-31', '2027-04-30']);
  assert.deepEqual([iso(invoiceB.periodStart), iso(invoiceB.periodEnd), iso(invoiceB.benefitEnd), iso(after.paidThrough), after.billingAnchorDay, iso((await b.read.term()).termEndsAt)],
    [oldEnd, paidEnd, benefitEnd, benefitEnd, 31, benefitEnd]);
  const boughtAt = iso(paidB.paidAt);
  // Both new lots are usable from the payment, before their service starts; the running month's lot is carried to benefitEnd.
  assert.deepEqual((await b.read.lots()).map(lot => [lot[0], lot[1], lot[2], lot[3], lot[5]]), [
    ['INITIAL', 30, (await b.read.lots())[0]![2], oldEnd, benefitEnd], ['REPEAT', 30, oldEnd, paidEnd, benefitEnd], ['PROMOTION', 30, paidEnd, benefitEnd, benefitEnd]]);
  assert.deepEqual((await b.read.lots()).slice(1).map(lot => lot[4]), [boughtAt, boughtAt]);
  const right = await b.read.right();
  assert.deepEqual([right.state, iso(right.paidStart), iso(right.paidEnd), iso(right.bonusEnd)], ['CONSUMED', oldEnd, paidEnd, benefitEnd]);
}, '2027-01-31T03:00:00.000Z');

// A16: an import records and holds; the retry applies. The right is consumed at the first verified sight of the money.
scenario('invoice import then retry: consumed while HELD with nothing granted, then applied once with the dates of the verified payment', async shop => {
  const f = await shop(), bought = await f.buy('CARD_ONCE', 'month', true), paid = await f.pay(bought.attemptId, bought.amount, 'card');
  const paidEnd = months(paid.paidAt, 1), benefitEnd = months(paid.paidAt, 2);
  await f.reconcileOneTime(paid, async () => {});
  let invoice = await f.read.invoice(bought.attemptId), right = await f.read.right();
  assert.deepEqual([invoice.applyStatus, iso(invoice.periodEnd), invoice.benefitEnd, right.state, right.invoiceId, right.benefitAppliedAt, right.bonusEnd],
    ['HELD', paidEnd, null, 'CONSUMED', invoice.id, null, null]);
  assert.deepEqual([await f.read.lots(), (await f.read.account()).paidThrough], [[], null]);
  await f.reconcileOneTime(paid, async () => {}); // the import replayed: still held, still one consumed right
  assert.deepEqual([(await f.read.right()).version, await f.read.lots()], [right.version, []]);

  await f.reconcileOneTime(paid);
  invoice = await f.read.invoice(bought.attemptId); right = await f.read.right();
  assert.deepEqual([invoice.applyStatus, iso(invoice.periodEnd), iso(invoice.benefitEnd), iso(right.paidEnd), iso(right.bonusEnd), iso((await f.read.account()).paidThrough)],
    ['APPLIED', paidEnd, benefitEnd, paidEnd, benefitEnd, benefitEnd]);
  assert.deepEqual((await f.read.lots()).map(lot => [lot[0], lot[1], lot[5]]), [['INITIAL', 30, benefitEnd], ['PROMOTION', 30, benefitEnd]]);
  assert.deepEqual([await f.read.review(), await f.client.billingPromotionRedemption.count({ where: { companyId: f.companyId } })], [0, 1]);
});

// A15/A30: only a Checkout proven unpaid gives the right back; money that was promised the campaign keeps it after the campaign ends.
scenario('expired unpaid releases the right; a paid proof after the campaign ended still gets the bonus; a paid proof without its right applies as a normal purchase under review', async shop => {
  const expired = await shop(), a = await expired.buy('PROMPTPAY_ONCE', 'month', true);
  const attemptA = await expired.client.billingAttempt.findUniqueOrThrow({ where: { id: a.attemptId } });
  const session = { id: attemptA.checkoutSessionId, object: 'checkout.session', livemode: false, mode: 'payment', status: 'open', payment_status: 'unpaid', subscription: null,
    customer: expired.account.customerId, client_reference_id: a.attemptId, metadata: { billingAttemptId: a.attemptId, billingAccountId: expired.account.id }, invoice: null };
  // Still open (the QR may yet be paid): nothing is released.
  await expired.reconcileOneTime({ attemptId: a.attemptId, session });
  assert.deepEqual([(await expired.read.right()).state, (await expired.read.account()).activeAttemptId], ['RESERVED', a.attemptId]);
  await expired.reconcileOneTime({ attemptId: a.attemptId, session: { ...session, status: 'expired' } });
  const released = await expired.read.right();
  assert.deepEqual([released.state, released.attemptId, released.releaseCount, !!released.releasedAt, (await expired.read.account()).activeAttemptId,
    (await expired.client.billingAttempt.findUniqueOrThrow({ where: { id: a.attemptId } })).status], ['RELEASED', null, 1, true, null, 'EXPIRED']);
  const audit = await expired.client.auditLog.findFirstOrThrow({ where: { companyId: expired.companyId, action: 'billing.promotion.released' } });
  assert.deepEqual([audit.targetId, audit.requestId, audit.metadataJson], [released.id, a.attemptId, { attemptId: a.attemptId, campaignId: expired.campaign.campaignId, reason: 'checkout_expired_unpaid' }]);
  // Money for that expired Checkout after all: held for an operator (the slot is gone), reviewed, and never a bonus.
  await expired.reconcileOneTime(await expired.pay(a.attemptId, a.amount, 'promptpay'));
  assert.deepEqual([(await expired.read.invoice(a.attemptId)).applyStatus, (await expired.read.invoice(a.attemptId)).benefitEnd, (await expired.read.right()).state, await expired.read.lots(), await expired.read.review()],
    ['HELD', null, 'RELEASED', [], 1]);

  // A30: reserved while the campaign ran, paid after an Admin ended it.
  const late = await shop(), b = await late.buy('PROMPTPAY_ONCE', 'month', true);
  await late.publish({ endedAt: new Date().toISOString() });
  const paidB = await late.pay(b.attemptId, b.amount, 'promptpay');
  await late.reconcileOneTime(paidB);
  assert.deepEqual([iso((await late.read.invoice(b.attemptId)).benefitEnd), (await late.read.right()).state, (await late.read.lots()).map(lot => lot[0])],
    [months(paidB.paidAt, 2), 'CONSUMED', ['INITIAL', 'PROMOTION']]);

  // The right was given back while the attempt still held the slot (the dispatch was proven never to have reached Stripe), yet it was paid.
  const lost = await shop(), c = await lost.buy('CARD_ONCE', 'month', true);
  await releasePromotion(lost.client, c.attemptId);
  const paidC = await lost.pay(c.attemptId, c.amount, 'card'), paidEnd = months(paidC.paidAt, 1);
  await lost.reconcileOneTime(paidC);
  const invoice = await lost.read.invoice(c.attemptId);
  assert.deepEqual([invoice.applyStatus, iso(invoice.periodEnd), invoice.benefitEnd, iso((await lost.read.account()).paidThrough), iso((await lost.read.term()).termEndsAt)],
    ['APPLIED', paidEnd, null, paidEnd, paidEnd]);
  assert.deepEqual((await lost.read.lots()).map(lot => [lot[0], lot[1], lot[5]]), [['INITIAL', 30, paidEnd]]);
  assert.deepEqual([(await lost.read.right()).state, (await lost.read.right()).invoiceId, await lost.read.review()], ['RELEASED', null, 1]);
  assert.equal((await lost.client.billingIssue.findFirstOrThrow({ where: { companyId: lost.companyId, kind: BILLING_PROMOTION_REVIEW_ISSUE } })).referenceId, invoice.id);
  await lost.reconcileOneTime(paidC); // a replay of an applied bill neither consumes nor re-opens anything
  assert.deepEqual([await lost.read.review(), (await lost.read.lots()).length], [1, 1]);
});

// A11/A33: both renewing modes pay the first period once, then bind the catalog-price subscription trialing to benefitEnd.
for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) scenario(`${mode}: bound trialing to benefitEnd, the $0 trial invoice grants nothing, the first renewal runs from benefitEnd with base units only`, async shop => {
  const f = await shop(), method = mode === 'CARD_AUTO' ? 'card' : 'promptpay', bought = await f.buy(mode, 'month', true);
  const paid = await f.pay(bought.attemptId, bought.amount, method), S = iso(paid.paidAt)!, paidEnd = months(paid.paidAt, 1), benefitEnd = months(paid.paidAt, 2);
  // Stripe creates the subscription but its answer is lost: the purchase stands with its bonus, the slot stays held, and the
  // next pass (a worker restart, a webhook replay) binds the subscription Stripe already made — never a second one.
  f.paid.loseNextSubscription = true;
  await assert.rejects(f.reconcileOneTime(paid), /response lost/);
  const invoice = await f.read.invoice(bought.attemptId), trialEnd = Date.parse(benefitEnd) / 1000;
  assert.deepEqual([invoice.applyStatus, iso(invoice.periodEnd), iso(invoice.benefitEnd)], ['APPLIED', paidEnd, benefitEnd]);
  let account = await f.read.account();
  assert.deepEqual([account.renewalMode, account.activeAttemptId, account.baseSubscriptionId, iso(account.paidThrough)], [mode, bought.attemptId, null, benefitEnd]);
  await f.reconcileOneTime(paid);
  const [sub] = [...f.subscriptions.values()];
  // The first real charge: the catalog price and cadence, at the end of the free time — never at the end of the paid month.
  assert.deepEqual([sub.trial_end, sub.items.data[0].price, sub.items.data[0].quantity, sub.collection_method, sub.payment_settings.payment_method_types],
    [trialEnd, 'price_StarterMonth', 1, mode === 'CARD_AUTO' ? 'charge_automatically' : 'send_invoice', [method]]);
  assert.equal(f.calls.find(call => call.method === 'POST' && call.path === '/subscriptions')?.key, `mm:${bought.attemptId}:${method}-renewal`);
  account = await f.read.account();
  assert.deepEqual([account.renewalMode, account.baseSubscriptionId, account.activeAttemptId, account.contractAttemptId, iso(account.paidThrough), iso(account.nextChargeAt), account.subscriptionState],
    [mode, sub.id, null, bought.attemptId, benefitEnd, benefitEnd, 'trialing']);
  const contract = await f.client.billingSubscriptionContract.findUniqueOrThrow({ where: { billingAccountId_sourceAttemptId: { billingAccountId: f.account.id, sourceAttemptId: bought.attemptId } } });
  assert.deepEqual([iso(contract.effectiveAt), (contract.snapshotJson as any).quote.totalSatang], [benefitEnd, 24900]);
  const firstLots = await f.read.lots(), right = await f.read.right();
  assert.deepEqual(firstLots, [['INITIAL', 30, S, paidEnd, S, benefitEnd], ['PROMOTION', 30, paidEnd, benefitEnd, S, benefitEnd]]);

  // The ordinary reconcile of the bound subscription: still one subscription, its $0 trial invoice skipped without a review.
  await f.reconciler.reconcileAccount(f.account.id);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/subscriptions').length, 1);
  assert.deepEqual([await f.client.billingInvoice.count({ where: { billingAccountId: f.account.id } }), f.issues, await f.read.lots(), (await f.read.right()).version],
    [1, [], firstLots, right.version]);

  // The free time is over and Stripe charged the first real cycle, starting exactly at benefitEnd.
  mock.timers.enable({ apis: ['Date'], now: Date.parse(benefitEnd) + 3_600_000 });
  const renewalEnd = months(new Date(benefitEnd), 1), renewalId = f.renew(sub.id, new Date(benefitEnd), new Date(renewalEnd), 24900, method);
  await f.reconciler.reconcileAccount(f.account.id);
  const renewal = await f.client.billingInvoice.findFirstOrThrow({ where: { billingAccountId: f.account.id, providerInvoiceId: renewalId } });
  assert.deepEqual([renewal.applyStatus, renewal.totalSatang, iso(renewal.periodStart), iso(renewal.periodEnd), renewal.benefitEnd, renewal.sourceAttemptId],
    ['APPLIED', 24900, benefitEnd, renewalEnd, null, null]);
  // The renewal is recorded as the normal offer: nothing can read it as a second promotion purchase.
  assert.equal('promotion' in (renewal.contractSnapshot as object), false);
  assert.equal('promotion' in (contract.snapshotJson as object), true, 'the bound contract keeps it: stop/resume renewal reads it while trialing');
  account = await f.read.account();
  assert.deepEqual([iso(account.paidThrough), iso((await f.read.term()).termEndsAt), iso(account.nextChargeAt), account.subscriptionState], [renewalEnd, renewalEnd, renewalEnd, 'active']);
  assert.deepEqual((await f.read.lots()).map(lot => [lot[0], lot[1], lot[2], lot[5]]),
    [['INITIAL', 30, S, benefitEnd], ['PROMOTION', 30, paidEnd, benefitEnd], ['RENEWAL', 30, benefitEnd, renewalEnd]]);
  const after = await f.read.right();
  assert.deepEqual([after.state, after.version, after.invoiceId, iso(after.bonusEnd), await f.client.billingPromotionRedemption.count({ where: { companyId: f.companyId } })],
    ['CONSUMED', right.version, invoice.id, benefitEnd, 1]);
  await f.reconciler.reconcileAccount(f.account.id); // the renewal replayed
  assert.deepEqual([await f.client.billingInvoice.count({ where: { billingAccountId: f.account.id } }), (await f.read.lots()).length, f.issues, await f.read.review()], [2, 3, [], 0]);
});
