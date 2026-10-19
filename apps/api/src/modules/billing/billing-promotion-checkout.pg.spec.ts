/**
 * A promotion purchase through the real quote, Checkout, status, attempt, history and catalog code against real PostgreSQL
 * (docs/plans/starter-249-bonus-month-promotion-plan.md §1 R2/R3/R10, §2, §6 "Purchase-flow rules"; spec §3, §6, §7;
 * A01, A03, A04, A10, A15, A17, A30, A34, A36). A paid Checkout is applied by the real reconciler through its public
 * `reconcileAccount`, renewal bind included. Stripe is a fake; nothing here proves native provider behaviour.
 *
 * Run with:
 *   BILLING_PROMOTION_TEST_DATABASE_URL='postgresql://…@127.0.0.1:5432/watchdog_step0_ci' \
 *     pnpm --filter @watchdog-bms/api exec tsx --test src/modules/billing/billing-promotion-checkout.pg.spec.ts
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, billingOffer, type BillingBenefitChoice, type BillingPolicy, type BillingPromotionCampaign,
  type BillingPurchaseMode, type BillingQuote } from '@watchdog-bms/contracts';
import { Prisma, PrismaClient } from '../../generated/prisma/client';
import { BillingService, type BillingSnapshot } from './application/billing.service';
import { BillingReconcilerService } from './application/billing-reconciler.service';
import { promotionUsage } from './application/billing-promotion';
import { appendPackageInterval, packageAnchorDay } from './domain/billing-package';
import { termProjectionHash } from './domain/paid-invoice';
import { promotionOfferSignature } from './domain/billing-promotion';
import { StripeRequestError } from './infrastructure/stripe.client';

const databaseUrl = process.env.BILLING_PROMOTION_TEST_DATABASE_URL;
const HOUR = 3_600_000;
type Body = { offerKey?: string; interval?: string; purchaseMode?: BillingPurchaseMode; benefitChoice?: BillingBenefitChoice; promotionCampaignId?: string;
  purchaseIntent?: 'FULL_PACKAGE' };

describe('promotion purchase: quote, Checkout and views on PostgreSQL', { skip: !databaseUrl }, () => {
  let client: PrismaClient, service: BillingService, reconciler: BillingReconcilerService;
  const run = randomUUID().replaceAll('-', '').slice(0, 12), stripeAccountId = `acct_${run}`, owner = `promo-owner-${run}`, holder = `promo-holder-${run}`;
  const companyIds: string[] = [], batchIds: string[] = [], customers = new Map<string, Record<string, unknown>>(), sessions: Record<string, any>[] = [];
  const address = { line1: '99 ถนนทดสอบ', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' };
  const policy: BillingPolicy = { ...BILLING_DRAFT_POLICY, portalConfigurationId: 'bpc_synthetic', priceIds: {
    'STARTER_249:month': 'price_StarterMonth', 'STARTER_249:year': 'price_StarterYear', 'BASIC_499:month': 'price_BasicMonth', 'BASIC_499:year': 'price_BasicYear',
    'PRO_999:month': 'price_ProMonth', 'PRO_999:year': 'price_ProYear', 'ENTERPRISE_1999:month': 'price_EntMonth', 'ENTERPRISE_1999:year': 'price_EntYear' } };
  const tax = policy.taxTreatment, month = billingOffer('STARTER_249', 'month', policy), year = billingOffer('STARTER_249', 'year', policy);
  let sequence = 0, keys = 0;
  /** Everything the fake Stripe holds about paid money and bound renewals, by id. `loseNextSubscription`: the next bind request fails before Stripe acts. */
  const paid = { intents: new Map<string, any>(), charges: new Map<string, any>(), invoices: new Map<string, any>(), payments: new Map<string, any[]>(),
    lines: new Map<string, any[]>(), subscriptions: new Map<string, any>(), loseNextSubscription: false };
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
      const id = path.split('/').at(-1)!;
      if (method === 'GET' && (path === '/refunds' || path === '/credit_notes')) return { object: 'list', data: [], has_more: false };
      if (path.startsWith('/payment_intents/')) return paid.intents.get(id);
      if (path.startsWith('/charges/')) return paid.charges.get(id);
      if (method === 'GET' && path.startsWith('/invoices/')) return paid.invoices.get(id);
      if (path.startsWith('/payment_methods/')) return { id, object: 'payment_method', type: 'card', customer: [...paid.intents.values()].find(intent => intent.payment_method === id)?.customer };
      if (method === 'POST' && path === '/subscriptions') {
        if (paid.loseNextSubscription) { paid.loseNextSubscription = false; throw new Error('synthetic: the bind request never reached Stripe'); }
        const subId = `sub_${run}b${paid.subscriptions.size + 1}`, item = params.items[0];
        paid.subscriptions.set(subId, { id: subId, object: 'subscription', livemode: false, customer: params.customer, status: 'trialing', metadata: params.metadata,
          billing_mode: params.billing_mode, collection_method: params.collection_method, payment_settings: params.payment_settings,
          default_payment_method: params.default_payment_method ?? null, trial_end: params.trial_end, trial_settings: params.trial_settings, cancel_at_period_end: false,
          items: { has_more: false, data: [{ id: `si_${subId}`, price: item.price, quantity: item.quantity, tax_rates: item.tax_rates ?? [],
            current_period_start: Math.floor(Date.now() / 1000), current_period_end: params.trial_end }] } });
        return structuredClone(paid.subscriptions.get(subId));
      }
      if (path.startsWith('/subscriptions/') && paid.subscriptions.has(id)) return structuredClone(paid.subscriptions.get(id));
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
    list: async (path: string, params?: any): Promise<any[]> => {
      if (path === '/checkout/sessions') return sessions.map(item => item.session).filter(session => session.customer === params.customer);
      if (path === '/subscriptions') return [...paid.subscriptions.values()].filter(sub => sub.customer === params.customer).map(sub => structuredClone(sub));
      // A subscription bound trialing has only its $0 subscription_create invoice.
      if (path === '/invoices') return params?.subscription ? [{ id: `in_zero_${params.subscription}`, object: 'invoice', livemode: false,
        customer: paid.subscriptions.get(params.subscription).customer, status: 'paid', billing_reason: 'subscription_create', total: 0, amount_paid: 0, created: 1,
        parent: { subscription_details: { subscription: params.subscription } } }] : [];
      if (path === '/invoice_payments') return paid.payments.get(params.invoice) ?? [];
      if (path.endsWith('/line_items') || path.endsWith('/lines')) return paid.lines.get(path.split('/').at(-2)!) ?? [];
      return [];
    } };

  before(async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname) && url.pathname.endsWith('_ci'), 'only a disposable local *_ci database');
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    // The real service on the real database; only the owner check, the Stripe tax read and the OCR usage read are stubbed.
    service = new BillingService({ client } as any, { stripeAccountId, sesWebBaseUrl: 'https://app.example.test', aiMonthlyBudgetSatang: 0 } as any, stripe as any);
    service.assertOwner = async () => {}; service.assertTaxSettings = async () => {};
    service.usage = async () => ({ used: 0, limit: null, remaining: null, resetsAt: null, cadence: 'PAID_GRANTS', expiresAt: null });
    reconciler = new BillingReconcilerService({ client } as any, {} as any, stripe as any, service, {} as any);
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
   * The buyer pays the open Checkout of this attempt at the fake Stripe — session complete and paid a minute ago, its invoice,
   * payment, charge and lines — and the reconciler's public pass does everything else: evidence, apply, promotion, bind.
   */
  async function pay(attemptId: string) {
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: attemptId } }), snapshot = attempt.quoteSnapshot as unknown as BillingSnapshot;
    const current = await client.billingAccount.findUniqueOrThrow({ where: { id: attempt.billingAccountId } });
    const session = sessions.find(item => item.session.id === attempt.checkoutSessionId)!;
    assert.equal(session.mode, 'payment', 'pay() models a paid payment-mode Checkout, not a subscription-mode Checkout');
    const n = `${run}${sequence += 1}`, amount = snapshot.quote.offer.priceSatang, created = Math.floor(Date.now() / 1000) - 60;
    const customerId = current.customerId!, meta = { billingAttemptId: attempt.id, billingAccountId: current.id }, card = !snapshot.quote.purchaseMode!.startsWith('PROMPTPAY');
    const charge = { id: `ch_${n}`, livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount, customer: customerId,
      payment_intent: `pi_${n}`, payment_method_details: { type: card ? 'card' : 'promptpay' }, amount_refunded: 0, disputed: false, balance_transaction: null };
    paid.charges.set(charge.id, charge);
    paid.intents.set(`pi_${n}`, { id: `pi_${n}`, livemode: false, status: 'succeeded', currency: 'thb', amount_received: amount, customer: customerId, latest_charge: charge,
      payment_method: card ? `pm_${n}` : null, setup_future_usage: session.payment_intent_data?.setup_future_usage ?? null });
    paid.payments.set(`in_${n}`, [{ object: 'invoice_payment', livemode: false, status: 'paid', invoice: `in_${n}`, payment: { type: 'payment_intent', payment_intent: `pi_${n}` }, amount_paid: amount, currency: 'thb' }]);
    paid.lines.set(attempt.checkoutSessionId!, [{ quantity: 1, currency: 'thb', amount_total: amount, amount_tax: 0, amount_discount: 0,
      price: { id: `price_inline${n}`, product: 'prod_Synthetic', type: 'one_time', active: false, recurring: null, livemode: false, currency: 'thb', unit_amount: amount } }]);
    paid.lines.set(`in_${n}`, [{ parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: `ii_${n}`, subscription: null, proration: false } },
      pricing: { price_details: { price: `price_inline${n}`, product: 'prod_Synthetic' } }, amount, currency: 'thb', livemode: false, quantity: 1 }]);
    paid.invoices.set(`in_${n}`, { id: `in_${n}`, object: 'invoice', livemode: false, customer: customerId, metadata: meta, status: 'paid', billing_reason: 'manual',
      collection_method: 'send_invoice', parent: null, currency: 'thb', total: amount, amount_paid: amount, amount_remaining: 0, starting_balance: 0,
      status_transitions: { paid_at: created + 3 }, number: `PR-${n}` });
    Object.assign(session.session, { status: 'complete', payment_status: 'paid', subscription: null,
      invoice: `in_${n}`, payment_intent: `pi_${n}`, invoice_creation: { enabled: true }, currency: 'thb', amount_total: amount,
      total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: 0 }, created, customer_details: { email: `${owner}@example.test` } });
    return new Date((created + 3) * 1000);
  }
  /** Pays, runs the reconciler once, and returns the applied bill. */
  async function applyPaid(attemptId: string) {
    await pay(attemptId);
    await reconciler.reconcileAccount((await client.billingAttempt.findUniqueOrThrow({ where: { id: attemptId } })).billingAccountId);
    const row = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attemptId } });
    assert.equal(row.applyStatus, 'APPLIED');
    return row;
  }

  it('PAY-MENU history carries the purchased Thai package label, interval and recorded card or PromptPay method', async () => {
    const autoOffer = billingOffer('PRO_999', 'month', policy);
    await publish([campaign({ rules: [{ offerKey: autoOffer.offerKey, interval: autoOffer.interval, bonusMonths: 1,
      bonusReceiptUnits: autoOffer.receiptAllowance, offerSignature: promotionOfferSignature(autoOffer, tax) }] })]);
    for (const [offerKey, interval, purchaseMode, label, method] of [
      ['BASIC_499', 'month', 'CARD_ONCE', 'เติบโต', 'CARD'],
      ['STARTER_249', 'year', 'PROMPTPAY_ONCE', 'เริ่มต้น', 'PROMPTPAY'],
      ['PRO_999', 'month', 'CARD_AUTO', 'มืออาชีพ', 'CARD'],
      ['ENTERPRISE_1999', 'year', 'PROMPTPAY_RENEW', 'ธุรกิจ', 'PROMPTPAY'],
    ] as const) {
      const s = await shop(), opened = await checkout(s, await quote(s, purchaseMode === 'CARD_AUTO' ? 'PROMOTION' : 'NORMAL', { offerKey, interval, purchaseMode }));
      const invoice = await applyPaid(opened.attemptId);
      const history = await service.history(ctx(s), { limit: 10 });
      assert.equal(history.items.length, 1);
      assert.equal(history.items[0]!.id, invoice.id);
      assert.deepEqual(history.items[0]!.offer, { key: offerKey, label, interval });
      assert.equal(history.items[0]!.method, method);
    }
  });

  it('PAY-MENU history leaves the method null when its source attempt has no known purchase mode', async () => {
    await publish([]);
    const s = await shop(), opened = await checkout(s, await quote(s, 'NORMAL'));
    const invoice = await applyPaid(opened.attemptId);
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: opened.attemptId } });
    const snapshot = attempt.quoteSnapshot as unknown as BillingSnapshot;
    const { purchaseMode: _mode, ...withoutMode } = snapshot.quote;
    for (const storedQuote of [withoutMode, { ...withoutMode, purchaseMode: 'UNKNOWN_MODE' }]) {
      await client.billingAttempt.update({ where: { id: attempt.id }, data: {
        quoteSnapshot: { ...snapshot, quote: storedQuote } as unknown as Prisma.InputJsonValue } });
      const item = (await service.history(ctx(s), { limit: 10 })).items[0]!;
      assert.deepEqual(item.offer, { key: 'STARTER_249', label: 'เริ่มต้น', interval: 'month' });
      assert.equal(item.method, null, 'never infer card from the charge or current account mode');
    }
    await client.billingInvoice.update({ where: { id: invoice.id }, data: { sourceAttemptId: null } });
    assert.equal((await service.history(ctx(s), { limit: 10 })).items[0]!.method, null, 'no source attempt is also unknown');
  });

  it('PAY-MENU adjustments carry the invoice facts and verified paidAt, never its local creation date', async () => {
    await publish([]);
    const s = await shop(), opened = await checkout(s, await quote(s, 'NORMAL', { offerKey: 'BASIC_499', purchaseMode: 'PROMPTPAY_ONCE' }));
    const invoice = await applyPaid(opened.attemptId), provider = paid.invoices.get(invoice.providerInvoiceId)!;
    await client.billingInvoice.update({ where: { id: invoice.id }, data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
    for (const kind of ['refunds', 'credit-notes'] as const) {
      const result = await service.adjustments(ctx(s), invoice.id, kind);
      assert.equal(result.invoice.id, invoice.id);
      assert.deepEqual(result.invoice.offer, { key: 'BASIC_499', label: 'เติบโต', interval: 'month' });
      assert.equal(result.invoice.method, 'PROMPTPAY');
      assert.equal(result.invoice.amountSatang, invoice.totalSatang);
      assert.equal(result.invoice.periodStart, invoice.periodStart.toISOString());
      assert.equal(result.invoice.periodEnd, invoice.periodEnd.toISOString());
      assert.equal(result.invoice.paidAt, new Date(provider.status_transitions.paid_at * 1000).toISOString());
      assert.notEqual(result.invoice.paidAt, result.invoice.createdAt);
    }
    const paidAt = provider.status_transitions.paid_at;
    try {
      delete provider.status_transitions.paid_at;
      assert.equal((await service.adjustments(ctx(s), invoice.id, 'refunds')).invoice.paidAt, null, 'missing payment time stays unknown');
    } finally { provider.status_transitions.paid_at = paidAt; }
  });

  it('PAY-MENU adjustments refuse another shop invoice before reading its provider data', async () => {
    await publish([]);
    const s = await shop(), other = await shop(), opened = await checkout(s, await quote(s, 'NORMAL'));
    const invoice = await applyPaid(opened.attemptId);
    assert.deepEqual((await service.history(ctx(other), { limit: 10 })).items, []);
    probe = async () => { assert.fail('another shop invoice must be refused before calling Stripe'); };
    try {
      for (const kind of ['refunds', 'credit-notes'] as const) {
        await assert.rejects(service.adjustments(ctx(other), invoice.id, kind), NotFoundException);
      }
    } finally { probe = null; }
  });

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
    const [kept, ended, changed, plain, plainChanged, gated] = [await shop(), await shop(), await shop(), await shop(), await shop(), await shop()];
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

    // A purchase with NO promotion is not disturbed by a campaign either: the pause lands between its reservation and its
    // dispatch (a new revision, the same base policy) and it still dispatches; a later publication does not hide its link.
    const normal = await quote(plain, 'NORMAL'), sent = sessions.length;
    probe = () => publish([{ ...live, paused: true }]);
    const open = await checkout(plain, normal);
    assert.deepEqual([open.state, sessions.length, (await account(plain)).activeAttemptId], ['OPEN', sent + 1, open.attemptId]);
    assert.equal((await service.resume(ctx(plain), open.attemptId)).checkoutUrl, open.checkoutUrl, 'the buyer can come back to the open Checkout after a pause');
    await publish([live]);
    assert.equal((await service.resume(ctx(plain), open.attemptId)).checkoutUrl, open.checkoutUrl);
    // A gate that this purchase does not depend on changed (settings version only): it still dispatches.
    const settingsId = `${stripeAccountId}:test`, gates = Object.fromEntries(BILLING_ACTIONS.map(action => [action, true]));
    const setGates = (over: Record<string, boolean>) => client.billingSettings.update({ where: { id: settingsId }, data: { gatesJson: { ...gates, ...over }, version: { increment: 1 } } });
    const gatedQuote = await quote(gated, 'NORMAL');
    probe = async () => { await setGates({ portal_cancel_subscription: false }); };
    assert.equal((await checkout(gated, gatedQuote)).state, 'OPEN');
    // Its own gates stay the barrier they were: sales closed between the reservation and the dispatch stops it, and hides the open link.
    const [late, stopped] = [await shop(), sessions.length];
    const lateQuote = await quote(late, 'NORMAL');
    probe = async () => { await setGates({ new_sales: false }); };
    await refused(checkout(late, lateQuote), 'BILLING_SALES_CLOSED');
    assert.deepEqual([sessions.length, (await account(late)).activeAttemptId], [stopped, null]);
    assert.equal((await service.resume(ctx(plain), open.attemptId)).checkoutUrl, null);
    await setGates({});
    // A base-policy change still fails closed for a normal purchase, and hides the link of the one already open.
    const priced = await quote(plainChanged, 'NORMAL');
    probe = () => publish([live], { ...policy, graceDays: 3 });
    await refused(checkout(plainChanged, priced), 'BILLING_SALES_CLOSED');
    assert.deepEqual([sessions.length, (await account(plainChanged)).activeAttemptId], [stopped, null]);
    assert.equal((await service.resume(ctx(plain), open.attemptId)).checkoutUrl, null);
    await publish([live]);

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

  it('journey, CARD_ONCE month: quote → Checkout → paid → the real apply → two months and 60 receipts; once per shop; a normal repeat starts at benefitEnd; an upgrade waits until benefitEnd (A01, A03, plan R2, Q5)', async () => {
    const live = campaign();
    await publish([live]);
    const s = await shop(), quoted = await quote(s, 'PROMOTION'), opened = await checkout(s, quoted);
    const invoice = await applyPaid(opened.attemptId), paidThrough = (await account(s)).paidThrough!;
    assert.equal(paidThrough.getTime(), invoice.benefitEnd!.getTime()); assert.ok(invoice.periodEnd < invoice.benefitEnd!);
    // Counted from the verified payment: one paid month, then one free month. 30 base + 30 bonus receipts, all usable now.
    assert.deepEqual([invoice.totalSatang, invoice.periodEnd.toISOString(), invoice.benefitEnd!.toISOString()],
      [24900, appendPackageInterval(invoice.periodStart, 'month').toISOString(), appendPackageInterval(invoice.periodStart, 'month', undefined, 2).toISOString()]);
    assert.ok(Math.abs(invoice.periodStart.getTime() - Date.parse(quoted.promotion!.paidStart)) < 120_000, 'the dates the quote told, from the real payment time');
    const usage = await BillingService.prototype.usage.call(service, s);
    assert.deepEqual([usage.limit, usage.remaining, usage.expiresAt], [60, 60, paidThrough.toISOString()]);
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
    // The locked Checkout recheck reads the same source: the normal repeat opens, is paid, and its service starts at benefitEnd.
    const again = await checkout(s, repeat);
    assert.equal(again.state, 'OPEN');
    const second = await applyPaid(again.attemptId), stacked = (await account(s)).paidThrough!;
    assert.deepEqual([second.periodStart.toISOString(), second.periodEnd.toISOString(), second.benefitEnd, stacked.toISOString()],
      [paidThrough.toISOString(), repeat.purchase!.projectedPaidThrough, null, repeat.purchase!.projectedPaidThrough]);
    assert.equal((await right(s, live.campaignId))!.version, used.version, 'a normal purchase never touches the right');
    // With normal time stacked behind the promotion, the upgrade still opens when the promotion's own service ends — not later.
    await refused(quote(s, 'NORMAL', { offerKey: 'BASIC_499' }), 'PROMOTION_UPGRADE_DEFERRED');
    assert.equal((await service.status(ctx(s))).upgradeDeferredUntil, paidThrough.toISOString());
    await refused(quote(s, 'PROMOTION'), 'PROMOTION_UNAVAILABLE', 'ALREADY_USED');
    assert.equal((await quote(s, 'NORMAL')).purchase?.kind, 'REPEAT', 'NORMAL stays purchasable');

    // A second campaign is a new right: bought as a repeat, it starts where the free time ends and keeps the anchor day.
    const other = await shop(), first = await checkout(other, await quote(other, 'PROMOTION')), source = await applyPaid(first.attemptId);
    const next = campaign({ displayName: 'แคมเปญที่สอง' });
    await publish([live, next]);
    const further = await quote(other, 'PROMOTION'), anchorDay = (await account(other)).billingAnchorDay!;
    assert.deepEqual([further.purchase?.kind, further.promotion?.campaignId, further.promotion?.paidStart, further.promotion?.paidEnd, further.promotion?.benefitEnd],
      ['REPEAT', next.campaignId, source.benefitEnd!.toISOString(), appendPackageInterval(source.benefitEnd!, 'month', anchorDay).toISOString(),
        appendPackageInterval(source.benefitEnd!, 'month', anchorDay, 2).toISOString()]);
    assert.equal(further.purchase?.projectedPaidThrough, further.promotion?.paidEnd);
    assert.equal((await checkout(other, further)).state, 'OPEN');
    assert.equal((await right(other, next.campaignId))?.state, 'RESERVED');
  });

  it('journey, CARD_AUTO year: paid → applied → renewal bound at benefitEnd (13 months); setup is PENDING → READY, REVIEW only for an issue about this purchase; the $0 trial invoice grants nothing (A05, plan R11)', async () => {
    const live = campaign();
    await publish([live]);
    const s = await shop(), quoted = await quote(s, 'PROMOTION', { interval: 'year', purchaseMode: 'CARD_AUTO' }), opened = await checkout(s, quoted);
    const setup = async () => { const use = (await service.status(ctx(s))).promotion!; return [use.state, use.renewalSetupState, use.expectedNextChargeAt]; };
    assert.deepEqual(await setup(), ['RESERVED', 'PENDING', null]);

    // Paid and applied, but the request that binds the renewal never reached Stripe: the money and the service are kept.
    const paidAt = await pay(opened.attemptId), accountId = (await account(s)).id, benefitEnd = appendPackageInterval(paidAt, 'month', undefined, 13);
    paid.loseNextSubscription = true;
    await assert.rejects(reconciler.reconcileAccount(accountId), /never reached Stripe/);
    const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: opened.attemptId } });
    assert.deepEqual([invoice.applyStatus, invoice.totalSatang, invoice.periodStart.toISOString(), invoice.periodEnd.toISOString(), invoice.benefitEnd?.toISOString()],
      ['APPLIED', 249000, paidAt.toISOString(), appendPackageInterval(paidAt, 'year').toISOString(), benefitEnd.toISOString()]);
    assert.deepEqual([(await account(s)).paidThrough?.toISOString(), (await account(s)).activeAttemptId, (await account(s)).baseSubscriptionId], [benefitEnd.toISOString(), opened.attemptId, null]);
    assert.deepEqual(await setup(), ['CONSUMED', 'PENDING', benefitEnd.toISOString()]);
    // An open review of other money of this shop says nothing about this purchase's renewal: still PENDING, here and on the attempt.
    const unrelated = await service.issue(s, 'FINANCIAL_REVIEW', `ch_other_${run}`);
    assert.deepEqual(await setup(), ['CONSUMED', 'PENDING', benefitEnd.toISOString()]);
    assert.equal((await service.attempt(ctx(s), opened.attemptId)).promotion?.renewalSetupState, 'PENDING');
    // What the scan records when a pass over this account fails — that one is about this purchase.
    await service.issue(s, 'RECONCILIATION_FAILED', accountId);
    assert.deepEqual(await setup(), ['CONSUMED', 'REVIEW', benefitEnd.toISOString()]);
    assert.equal((await service.attempt(ctx(s), opened.attemptId)).promotion?.renewalSetupState, 'REVIEW');

    // The next pass binds: full catalog price and cadence, the saved card, first charge when the free time ends.
    await reconciler.reconcileAccount(accountId);
    const [sub] = [...paid.subscriptions.values()].filter(item => item.metadata.billingAttemptId === opened.attemptId);
    assert.deepEqual([sub.trial_end, sub.items.data[0].price, sub.collection_method, sub.default_payment_method], [benefitEnd.getTime() / 1000, 'price_StarterYear', 'charge_automatically', paid.intents.get(sessions.at(-1)!.session.payment_intent).payment_method]);
    let bound = await account(s);
    assert.deepEqual([bound.renewalMode, bound.baseSubscriptionId, bound.activeAttemptId, bound.subscriptionState, bound.paidThrough?.toISOString(), bound.nextChargeAt?.toISOString()],
      ['CARD_AUTO', sub.id, null, 'trialing', benefitEnd.toISOString(), benefitEnd.toISOString()]);
    assert.deepEqual(await setup(), ['CONSUMED', 'READY', benefitEnd.toISOString()]);
    const usage = await BillingService.prototype.usage.call(service, s);
    assert.deepEqual([usage.limit, usage.remaining], [390, 390]);

    // The ordinary pass over the bound subscription meets its $0 trial invoice: no bill, no receipts, no review, the right untouched.
    const before = [await client.billingReceiptGrant.count({ where: { companyId: s } }), (await right(s, live.campaignId))!.version];
    await reconciler.reconcileAccount(accountId);
    bound = await account(s);
    assert.deepEqual([await client.billingInvoice.count({ where: { billingAccountId: accountId } }), await client.billingReceiptGrant.count({ where: { companyId: s } }),
      (await right(s, live.campaignId))!.version, bound.paidThrough?.toISOString(), [...paid.subscriptions.values()].filter(item => item.customer === bound.customerId).length],
      [1, before[0], before[1], benefitEnd.toISOString(), 1]);
    assert.deepEqual((await client.billingIssue.findMany({ where: { companyId: s, state: { not: 'RESOLVED' } }, select: { id: true } })).map(issue => issue.id), [unrelated.id]);
    assert.deepEqual(await setup(), ['CONSUMED', 'READY', benefitEnd.toISOString()]);
  });

  it('gives back a right stranded on a Checkout that was never requested once createBy passed — and only then (spec §6, A30)', async () => {
    const live = campaign({ cap: 2 });
    await publish([live]);
    /** The process died right after the reservation committed: the attempt as that commit left it, and nothing at the provider. */
    const stranded = async (choice: 'PROMOTION' | 'NORMAL') => {
      const s = await shop();
      sessionFailure = new StripeRequestError('UNKNOWN', 'synthetic_timeout');
      const lost = await checkout(s, await quote(s, choice));
      await client.billingAttempt.update({ where: { id: lost.attemptId }, data: { status: 'CREATING', version: 0, errorCode: null, collectionJson: Prisma.DbNull } });
      await client.billingIssue.deleteMany({ where: { companyId: s } });
      return { s, attemptId: lost.attemptId, accountId: (await account(s)).id };
    };
    const overdue = (companyId: string) => client.billingPromotionRedemption.updateMany({ where: { companyId, campaignId: live.campaignId },
      data: { acceptedAt: new Date(Date.now() - 11 * 60_000), createBy: new Date(Date.now() - 60_000) } });
    const held = async (shopOf: { s: string; attemptId: string }, status: string) => assert.deepEqual(
      [(await client.billingAttempt.findUniqueOrThrow({ where: { id: shopOf.attemptId } })).status, (await account(shopOf.s)).activeAttemptId, (await right(shopOf.s, live.campaignId))?.state],
      [status, shopOf.attemptId, 'RESERVED']);

    // Before createBy the first request may still start: nothing is released, the pass fails as it always did.
    const a = await stranded('PROMOTION');
    await assert.rejects(reconciler.reconcileAccount(a.accountId), /billing\.checkout_unknown/);
    await held(a, 'CREATING');
    // Past createBy, never requested, nothing at the provider: terminal, the slot and the cap seat free, the audit names the attempt.
    await service.issue(a.s, 'RECONCILIATION_FAILED', a.accountId);
    await overdue(a.s);
    await reconciler.reconcileAccount(a.accountId);
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: a.attemptId } }), released = (await right(a.s, live.campaignId))!;
    assert.deepEqual([attempt.status, attempt.errorCode, attempt.checkoutSessionId, (await account(a.s)).activeAttemptId], ['EXPIRED', 'BILLING_CHECKOUT_NOT_STARTED', null, null]);
    assert.deepEqual([released.state, released.attemptId, released.releaseCount], ['RELEASED', null, 1]);
    assert.deepEqual(await promotionUsage(client, 'TEST', live.campaignId), { reserved: 0, consumed: 0, taken: 0 });
    const audit = await client.auditLog.findFirstOrThrow({ where: { companyId: a.s, action: 'billing.promotion.released', targetId: released.id } });
    assert.deepEqual(audit.metadataJson, { attemptId: a.attemptId, campaignId: live.campaignId, reason: 'checkout_never_started' });
    assert.equal(await client.billingIssue.count({ where: { companyId: a.s, state: { not: 'RESOLVED' } } }), 0, 'the failed passes before createBy are settled');
    // The request that never started can never start now: the barrier's own guard finds no CREATING attempt.
    assert.equal((await client.billingAttempt.updateMany({ where: { id: a.attemptId, status: 'CREATING', version: 0 }, data: { status: 'REQUESTING' } })).count, 0);
    assert.equal('promotion' in await service.status(ctx(a.s)), false);
    assert.equal((await checkout(a.s, await quote(a.s, 'PROMOTION'))).state, 'OPEN', 'the shop buys with the campaign again');

    // A request that was started, or whose outcome is unknown, is never released by time alone: within ten minutes of its last
    // write it stays held; after that a provider read that finds no session of the attempt ends it (2026-10-10).
    for (const status of ['REQUESTING', 'UNKNOWN']) {
      const b = await stranded('PROMOTION');
      await client.billingAttempt.update({ where: { id: b.attemptId }, data: { status, version: 1 } });
      await overdue(b.s);
      await assert.rejects(reconciler.reconcileAccount(b.accountId), /billing\.checkout_unknown/);
      await held(b, status);
      assert.equal(await client.auditLog.count({ where: { companyId: b.s, action: 'billing.promotion.released' } }), 0);
      await client.billingAttempt.update({ where: { id: b.attemptId }, data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
      await reconciler.reconcileAccount(b.accountId);
      const over = await client.billingAttempt.findUniqueOrThrow({ where: { id: b.attemptId } });
      assert.deepEqual([over.status, over.errorCode, (await account(b.s)).activeAttemptId, (await right(b.s, live.campaignId))?.state], ['EXPIRED', 'BILLING_CHECKOUT_NOT_STARTED', null, 'RELEASED']);
      assert.equal(await client.auditLog.count({ where: { companyId: b.s, action: 'billing.checkout.not_started', targetId: b.attemptId } }), 1);
      await client.billingPromotionRedemption.deleteMany({ where: { companyId: b.s } });
    }
    // The shop that died before it even had a Customer at the provider: no Customer means no Checkout, the same release.
    const c = await stranded('PROMOTION');
    await client.billingAccount.update({ where: { id: c.accountId }, data: { customerId: null } });
    await assert.rejects(reconciler.reconcileAccount(c.accountId), /billing\.customer_unknown/);
    await overdue(c.s);
    await reconciler.reconcileAccount(c.accountId);
    assert.deepEqual([(await client.billingAttempt.findUniqueOrThrow({ where: { id: c.attemptId } })).status, (await account(c.s)).activeAttemptId, (await right(c.s, live.campaignId))?.state],
      ['EXPIRED', null, 'RELEASED']);
    // An attempt without a promotion has no createBy: held within ten minutes of its last write, ended by the same read after.
    const d = await stranded('NORMAL');
    await assert.rejects(reconciler.reconcileAccount(d.accountId), /billing\.checkout_unknown/);
    assert.deepEqual([(await client.billingAttempt.findUniqueOrThrow({ where: { id: d.attemptId } })).status, (await account(d.s)).activeAttemptId], ['CREATING', d.attemptId]);
    await client.billingAttempt.update({ where: { id: d.attemptId }, data: { updatedAt: new Date(Date.now() - 11 * 60_000) } });
    await reconciler.reconcileAccount(d.accountId);
    assert.deepEqual([(await client.billingAttempt.findUniqueOrThrow({ where: { id: d.attemptId } })).status, (await account(d.s)).activeAttemptId], ['EXPIRED', null]);
    // The shop's own cancel waits 60 seconds instead of ten minutes, on the same read.
    const e = await stranded('NORMAL');
    await client.billingAttempt.update({ where: { id: e.attemptId }, data: { status: 'UNKNOWN', version: 1, updatedAt: new Date(Date.now() - 61_000) } });
    await assert.rejects(reconciler.reconcileAccount(e.accountId), /billing\.checkout_unknown/);
    await reconciler.reconcileAccount(e.accountId, undefined, undefined, undefined, 60_000);
    assert.deepEqual([(await client.billingAttempt.findUniqueOrThrow({ where: { id: e.attemptId } })).status, (await account(e.s)).activeAttemptId], ['EXPIRED', null]);
  });

  it('refuses a promotion on an upgrade, a scheduled change and a live card subscription, and still sells them normally (plan R10)', async () => {
    const live = campaign();
    await publish([live]);
    // An active one-time Starter month bought normally.
    const s = await shop();
    await applyPaid((await checkout(s, await quote(s, 'NORMAL'))).attemptId);
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
      subscriptionState: 'active', paidThrough, billingAnchorDay: packageAnchorDay(paidThrough), contractAttemptId: `contract-${run}`, termProjectionHash: termProjectionHash(term) } });
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
