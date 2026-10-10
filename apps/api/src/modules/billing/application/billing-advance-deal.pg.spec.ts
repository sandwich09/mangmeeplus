import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, billingOffer } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../../generated/prisma/client';
import { buildDealSnapshot } from '../../sales-console/domain/sales-deal.logic';
import { termProjectionHash } from '../domain/paid-invoice';
import { appendPackageInterval } from '../domain/billing-package';
import { hashBilling } from '../domain/billing-policy';
import { invoiceFindingSource } from './billing-invoice-finding';
import { BillingReconcilerService } from './billing-reconciler.service';
import { BillingService, type BillingSnapshot } from './billing.service';
import { StripeRequestError } from '../infrastructure/stripe.client';

const databaseUrl = process.env.BILLING_TEST_DATABASE_URL;
const MS_DAY = 86_400_000;

function fixtureStripe(run: string, stripeAccountId: string, billingAccountId: string, customerId: string, dealPriceId: string, dealPriceSatang: number) {
  const compact = run.replaceAll('-', '');
  const subscriptions = new Map<string, any>();
  const calls: { method: string; path: string; params?: any; key?: string }[] = [];
  const paid: Record<string, any> = {}; // Set by `pay`: the paid one-time Checkout of the advance attempt.
  let sessionPayload: any;
  const fail: { subscription: Error | null } = { subscription: null }; // Stripe answers the create without creating anything.
  const stripe = {
    enabled: true, accountId: stripeAccountId, livemode: false,
    assertAccount: async () => {},
    request: async (method: string, path: string, params?: any, key?: string): Promise<any> => {
      calls.push({ method, path, params, key });
      if (path === `/customers/${customerId}`) return { id: customerId, metadata: { billingAccountId }, email: `${compact}@example.test`,
        name: 'Synthetic advance deal', address: { country: 'TH', line1: '99 ถนนสุขุมวิท', line2: 'คลองเตย', city: 'คลองเตย', state: 'กรุงเทพมหานคร', postal_code: '10110' } };
      if (path.startsWith('/prices/')) {
        const id = path.slice('/prices/'.length), dealPrice = id === dealPriceId;
        return { id, object: 'price', livemode: false, active: true, type: 'recurring', product: 'prod_Basic', currency: 'thb',
          unit_amount: dealPrice ? dealPriceSatang : 49900,
          recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit' };
      }
      if (method === 'POST' && path === '/checkout/sessions') {
        sessionPayload = params;
        return { id: `cs_${compact}`, object: 'checkout.session', livemode: false, mode: params.mode,
          client_reference_id: params.client_reference_id, customer: customerId, metadata: params.metadata,
          url: `https://checkout.stripe.com/c/pay/cs_${compact}` };
      }
      if (method === 'GET' && path.startsWith('/payment_methods/')) return { id: path.split('/').at(-1), object: 'payment_method', type: 'card', customer: customerId };
      if (method === 'POST' && path === '/subscriptions') {
        if (fail.subscription) throw fail.subscription;
        const attemptId = params.metadata.billingAttemptId, id = `sub_${compact}`;
        const subscription = { id, object: 'subscription', livemode: false, customer: customerId, status: 'trialing',
          metadata: params.metadata, billing_mode: { type: 'classic' },
          collection_method: params.collection_method,
          payment_settings: params.payment_settings,
          default_payment_method: params.default_payment_method ?? null,
          trial_end: params.trial_end, items: { has_more: false, data: [{ price: params.items[0].price,
            quantity: params.items[0].quantity, tax_rates: params.items[0].tax_rates ?? [] }] } };
        subscriptions.set(id, subscription);
        assert.equal(subscription.metadata.billingAttemptId, attemptId);
        return subscription;
      }
      if (path.startsWith('/subscriptions/')) {
        const id = path.split('/').at(-1)!, subscription = subscriptions.get(id);
        if (!subscription) throw new Error(`unmocked subscription ${method} ${path}`);
        if (method === 'DELETE') { subscription.status = 'canceled'; return subscription; }
        return subscription;
      }
      if (method === 'GET' && path === `/checkout/sessions/${paid.session?.id}`) return paid.session;
      if (method === 'GET' && path === `/invoices/${paid.invoice?.id}`) return paid.invoice;
      if (method === 'GET' && path === `/payment_intents/${paid.intent?.id}`) return paid.intent;
      throw new Error(`unmocked Stripe request ${method} ${path}`);
    },
    list: async (path: string) => path === '/subscriptions' ? [...subscriptions.values()] :
      path === '/invoices' ? [] : path === '/invoice_payments' ? paid.payments : path.endsWith('/line_items') ? paid.checkoutLines :
      path.endsWith('/lines') ? paid.invoiceLines : (() => { throw new Error(`unmocked Stripe list ${path}`); })(),
    captured: () => ({ calls, sessionPayload, subscriptions, paid, fail }),
  };
  return stripe;
}

async function createFixture(client: PrismaClient, options: { currentMode: 'CARD_ONCE' | 'PROMPTPAY_ONCE'; paidThrough: Date }) {
  const run = randomUUID(), compact = run.replaceAll('-', ''), companyId = `billing-advance-${run}`;
  const userId = `owner-${run}`, salesUserId = `sales-${run}`, stripeAccountId = `acct_${compact}`;
  const customerId = `cus_${compact}`, oldAttemptId = `old_${compact}`, lease = `lease_${compact}`;
  const dealPriceId = `price_deal${compact}`;
  const priceSatang = 29900;
  await client.company.create({ data: { id: companyId, name: 'Synthetic advance deal', status: 'ACTIVE', addressJson: {
    line1: '99 ถนนสุขุมวิท', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' } } });
  await client.user.create({ data: { id: userId, displayName: 'Synthetic owner', email: `${compact}@example.test`, emailVerifiedAt: new Date() } });
  await client.user.create({ data: { id: salesUserId, displayName: 'Synthetic sales agent', email: `${compact}.sales@example.test` } });
  const account = await client.billingAccount.create({ data: { companyId, stripeAccountId, livemode: false, customerId,
    renewalMode: options.currentMode, leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
  const policy = { ...BILLING_DRAFT_POLICY, portalConfigurationId: 'bpc_synthetic', priceIds: {
    'STARTER_249:month': 'price_StarterMonth', 'STARTER_249:year': 'price_StarterYear',
    'BASIC_499:month': 'price_BasicMonth', 'BASIC_499:year': 'price_BasicYear',
    'PRO_999:month': 'price_ProMonth', 'PRO_999:year': 'price_ProYear' } };
  const currentOffer = { ...billingOffer('BASIC_499', 'month', policy), availability: 'AVAILABLE' as const, reason: null };
  const deal = buildDealSnapshot({ base: 'BASIC_499', priceSatang, months: 6, branchLimit: 2, employeeLimit: 5,
    monthlySlipLimit: 50, featureKeys: [], aiMonthlyBudgetSatang: null,
    description: 'ข้อเสนอพิเศษสำหรับร้านคุณ', autoRenew: true, cadence: 'month', cycles: 6 });
  const dealRow = await client.packageChangeRequest.create({ data: { companyId, requestedByUserId: userId, requestedTierKey: deal.base,
    status: 'APPROVED', kind: 'SALES_DEAL', salesUserId, approvedByUserId: salesUserId, approvedAt: new Date(),
    offerExpiresAt: new Date(Date.now() + MS_DAY), offerSnapshotJson: deal, stripePriceId: dealPriceId,
    stripePriceCreatedAt: new Date(), priceState: 'READY' } });
  const startsAt = options.paidThrough;
  const previousStart = new Date(startsAt.getTime() - 30 * MS_DAY);
  const term = await client.companyPlanTerm.create({ data: { companyId, tierKey: currentOffer.offerKey,
    branchLimit: currentOffer.branchLimit, employeeLimit: currentOffer.employeeLimit, monthlySlipLimit: currentOffer.monthlySlipLimit,
    termStartAt: previousStart, termEndsAt: startsAt, billingReceiptAccountId: account.id } });
  const oldInvoice = await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_old${compact}`,
    sourceAttemptId: oldAttemptId, offerSnapshot: currentOffer, contractSnapshot: { quote: { offer: currentOffer } },
    policyRevisionId: 'synthetic-revision', currency: 'THB', totalSatang: currentOffer.priceSatang, paidSatang: currentOffer.priceSatang,
    periodStart: previousStart, periodEnd: startsAt, providerStatus: 'paid', evidenceHash: `old-evidence-${compact}`,
    applyStatus: 'APPLIED', appliedAt: new Date() } });
  await client.billingReceiptGrant.create({ data: { companyId, billingAccountId: account.id, sourceKey: oldInvoice.id,
    sourceHash: `old-grant-${compact}`, kind: 'INITIAL', units: currentOffer.receiptAllowance, serviceStart: previousStart,
    serviceEnd: startsAt, availableAt: previousStart, expiresAt: startsAt, policyRevisionId: 'synthetic-revision' } });
  await client.billingAccount.update({ where: { id: account.id }, data: { contractAttemptId: oldAttemptId, paidThrough: startsAt,
    billingAnchorDay: startsAt.getUTCDate(), termProjectionHash: termProjectionHash(term) } });
  const stripe = fixtureStripe(run, stripeAccountId, account.id, customerId, dealPriceId, priceSatang);
  const state = { policy, revision: { id: 'synthetic-revision' }, settings: { version: 1 },
    gates: Object.fromEntries(BILLING_ACTIONS.map(action => [action, true])) };
  const service = {
    prisma: { client }, config: { stripeAccountId, sesWebBaseUrl: 'https://app.example.test' }, stripe,
    assertOwner: async () => {}, assertTaxSettings: async () => {}, settings: async () => state,
    account: (id: string, tx = client) => tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: {
      companyId: id, stripeAccountId, livemode: false } } }),
    purchaseSource: (company: Parameters<BillingService['purchaseSource']>[0], current: Parameters<BillingService['purchaseSource']>[1], tx = client) =>
      BillingService.prototype.purchaseSource.call({ prisma: { client }, stripe }, company, current, tx),
    usage: async () => ({ used: 0, limit: 50, remaining: 50, resetsAt: null, cadence: 'PAID_GRANTS', expiresAt: startsAt.toISOString() }),
  } as unknown as BillingService;
  const reconciler = new BillingReconcilerService({ client } as any, {} as any, stripe as any, service, {} as any);
  return { run, compact, companyId, userId, salesUserId, stripeAccountId, customerId, oldAttemptId, lease, dealPriceId, priceSatang,
    policy, currentOffer, deal, dealRow, account, term, oldInvoice, stripe, service, reconciler, client };
}

async function quoteAndCheckout(f: Awaited<ReturnType<typeof createFixture>>, purchaseMode: 'CARD_AUTO' | 'PROMPTPAY_RENEW') {
  const context = { companyId: f.companyId, userId: f.userId, requestId: f.run } as any;
  const quote = await BillingService.prototype.quote.call(f.service, context, { billingEmail: 'ignored@example.test',
    dealId: f.dealRow.id, purchaseMode });
  assert.equal(quote.purchase?.kind, 'ADVANCE_DEAL');
  assert.equal(quote.advanceDeal?.startsAt, (await f.service.account(f.companyId))!.paidThrough!.toISOString());
  assert.equal(quote.advanceDeal?.firstCycleEndsAt, appendPackageInterval(quote.advanceDeal ? new Date(quote.advanceDeal.startsAt) : new Date(), 'month',
    new Date(quote.advanceDeal!.startsAt).getUTCDate()).toISOString());
  const result = await BillingService.prototype.checkout.call(f.service, context,
    { quoteId: quote.quoteId, consentRevision: quote.consentRevision, accepted: true, channel: 'web' } as any,
    `idem_${f.compact}`);
  assert.equal(result.state, 'OPEN');
  const { sessionPayload } = (f.stripe as any).captured();
  assert.equal(sessionPayload.mode, 'payment');
  assert.deepEqual(sessionPayload.payment_method_types, [purchaseMode === 'CARD_AUTO' ? 'card' : 'promptpay']);
  if (purchaseMode === 'CARD_AUTO') assert.equal(sessionPayload.payment_intent_data.setup_future_usage, 'off_session');
  else assert.equal(sessionPayload.payment_intent_data.setup_future_usage, undefined);
  const attempt = await f.client.billingAttempt.findUniqueOrThrow({ where: { id: result.attemptId } });
  return { quote, attempt, context };
}

function evidence(f: Awaited<ReturnType<typeof createFixture>>, attempt: any, refundedSatang = 0) {
  return { invoiceId: `in_advance${f.compact}`, customerId: f.customerId, chargeId: `ch_advance${f.compact}`,
    checkoutSessionId: attempt.checkoutSessionId, paidAt: new Date(), number: null, totalSatang: f.priceSatang,
    taxSatang: 0, refundedSatang, disputed: false, feeSatang: null, evidenceHash: `advance-evidence-${f.compact}` };
}

function paymentIntent(f: Awaited<ReturnType<typeof createFixture>>, purchaseMode: 'CARD_AUTO' | 'PROMPTPAY_RENEW') {
  return { id: `pi_advance${f.compact}`, object: 'payment_intent', payment_method: purchaseMode === 'CARD_AUTO' ? `pm_advance${f.compact}` : null,
    setup_future_usage: purchaseMode === 'CARD_AUTO' ? 'off_session' : null };
}

async function reconcile(f: Awaited<ReturnType<typeof createFixture>>, attempt: any, purchaseMode: 'CARD_AUTO' | 'PROMPTPAY_RENEW', refunded = 0) {
  const account = await f.client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
  return (f.reconciler as any).reconcileAdvanceDeal(account, attempt, attempt.quoteSnapshot as BillingSnapshot,
    evidence(f, attempt, refunded), paymentIntent(f, purchaseMode), f.lease) as Promise<void>;
}

/** Stripe's paid card Checkout for the attempt: the objects `paidPackageCheckoutEvidence` checks (billing-event-discount-renewal.pg.spec.ts). */
function pay(f: Awaited<ReturnType<typeof createFixture>>, attempt: any) {
  const { quote, productId } = attempt.quoteSnapshot as BillingSnapshot, n = f.compact, created = Math.floor(Date.now() / 1000);
  const total = quote.totalSatang, tax = quote.taxSatang, price = quote.offer.priceSatang, meta = { billingAttemptId: attempt.id, billingAccountId: f.account.id };
  const charge = { id: `ch_advance${n}`, livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount: total, customer: f.customerId,
    payment_intent: `pi_advance${n}`, payment_method_details: { type: 'card' }, amount_refunded: 0, disputed: false, balance_transaction: null };
  return Object.assign((f.stripe as any).captured().paid, {
    intent: { ...paymentIntent(f, 'CARD_AUTO'), livemode: false, status: 'succeeded', currency: 'thb', amount_received: total, customer: f.customerId, latest_charge: charge },
    payments: [{ object: 'invoice_payment', livemode: false, status: 'paid', invoice: `in_advance${n}`, amount_paid: total, currency: 'thb',
      payment: { type: 'payment_intent', payment_intent: `pi_advance${n}` } }],
    checkoutLines: [{ quantity: 1, currency: 'thb', amount_total: total, amount_tax: tax, amount_discount: 0, price: { id: `price_inline${n}`, product: productId,
      type: 'one_time', active: false, recurring: null, livemode: false, currency: 'thb', unit_amount: price } }],
    invoiceLines: [{ parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: `ii_advance${n}`, subscription: null, proration: false } },
      pricing: { price_details: { price: `price_inline${n}`, product: productId } }, amount: price, currency: 'thb', livemode: false, quantity: 1 }],
    session: { id: attempt.checkoutSessionId, object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
      subscription: null, customer: f.customerId, client_reference_id: attempt.id, metadata: meta, invoice: `in_advance${n}`, payment_intent: `pi_advance${n}`,
      invoice_creation: { enabled: true }, currency: 'thb', amount_total: total, total_details: { amount_tax: tax, amount_discount: 0, amount_shipping: 0 }, created: created - 60 },
    invoice: { id: `in_advance${n}`, object: 'invoice', livemode: false, customer: f.customerId, metadata: meta, status: 'paid', billing_reason: 'manual',
      collection_method: 'send_invoice', parent: null, currency: 'thb', total, amount_paid: total, amount_remaining: 0, starting_balance: 0,
      total_taxes: tax ? [{ amount: tax }] : [], created, status_transitions: { paid_at: created }, number: null },
  });
}

/** Stripe's paid card renewal of the deal's bound subscription, as `paidInvoiceEvidence` checks it; the Checkout stays `pay`'s. */
function renew(f: Awaited<ReturnType<typeof createFixture>>, attempt: any, subscriptionId: string, start: Date, end: Date) {
  const paid = pay(f, attempt), n = `renewal${f.compact}`, created = Math.floor(Date.now() / 1000);
  return Object.assign(paid, {
    intent: { ...paid.intent, id: `pi_${n}`, latest_charge: { ...paid.intent.latest_charge, id: `ch_${n}`, payment_intent: `pi_${n}` } },
    payments: [{ ...paid.payments[0], invoice: `in_${n}`, payment: { type: 'payment_intent', payment_intent: `pi_${n}` } }],
    invoiceLines: [{ parent: { type: 'subscription_item_details', subscription_item_details: { subscription_item: `si_${n}`, subscription: subscriptionId, proration: false } },
      pricing: { price_details: { price: (attempt.quoteSnapshot as BillingSnapshot).priceId } }, currency: 'thb', livemode: false, quantity: 1,
      period: { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) } }],
    invoice: { ...paid.invoice, id: `in_${n}`, metadata: {}, billing_reason: 'subscription_cycle', collection_method: 'charge_automatically',
      parent: { subscription_details: { subscription: subscriptionId } }, created, status_transitions: { paid_at: created } },
  });
}

/** A provider scan that found this paid invoice with no local row: what the operator's IMPORT_INVOICE imports. */
async function discovered(f: Awaited<ReturnType<typeof createFixture>>, invoice: any) {
  const base = { companyId: f.companyId, stripeAccountId: f.stripeAccountId, livemode: false, state: 'SUCCEEDED', sourceVersion: 0,
    reason: 'synthetic_scan', initiatorUserId: f.userId, expiresAt: new Date(Date.now() + MS_DAY) };
  const scan = await f.client.billingOperation.create({ data: { ...base, type: 'SCAN_PROVIDER_INVOICES', requestHash: `scan-${f.compact}`,
    proposedJson: { accountId: f.account.id, customerId: f.customerId } } });
  const observation = { accountId: f.account.id, customerId: f.customerId, providerInvoiceId: invoice.id, created: invoice.created,
    status: 'paid', currency: 'thb', total: invoice.total, paid: invoice.amount_paid, classification: 'LOCAL_MISSING' };
  const finding = await f.client.billingOperation.create({ data: { ...base, type: 'OBSERVE_PROVIDER_INVOICE', referenceId: scan.id,
    proposedJson: observation, requestHash: hashBilling([scan.id, observation]) } });
  const account = await f.client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
  return { id: finding.id, sourceHash: (await invoiceFindingSource(f.client as any, account, finding.id)).sourceHash };
}

async function clean(client: PrismaClient, companyId: string, userIds: string[], accountId: string) {
  await client.outboxEvent.deleteMany({ where: { companyId } });
  await client.auditLog.deleteMany({ where: { companyId } });
  await client.billingIssue.deleteMany({ where: { companyId } });
  await client.entitlementCommand.deleteMany({ where: { companyId } });
  await client.entitlementTransition.deleteMany({ where: { companyId } });
  await client.runoffSnapshot.deleteMany({ where: { companyId } });
  await client.companyFeatureEntitlement.deleteMany({ where: { companyId } });
  await client.companyEntitlementNormalization.deleteMany({ where: { companyId } });
  await client.companyEntitlementSet.deleteMany({ where: { companyId } });
  await client.salesAttribution.deleteMany({ where: { companyId } });
  await client.billingOperation.deleteMany({ where: { companyId } });
  await client.billingSubscriptionContract.deleteMany({ where: { billingAccountId: accountId } });
  await client.billingReceiptGrant.deleteMany({ where: { companyId } });
  await client.billingQuote.deleteMany({ where: { companyId } });
  await client.billingAttempt.deleteMany({ where: { billingAccountId: accountId } });
  await client.billingInvoice.deleteMany({ where: { billingAccountId: accountId } });
  await client.packageChangeRequest.deleteMany({ where: { companyId } });
  await client.companyPlanTerm.deleteMany({ where: { companyId } });
  await client.billingAccount.deleteMany({ where: { companyId } });
  await client.company.deleteMany({ where: { id: companyId } });
  await client.user.deleteMany({ where: { id: { in: userIds } } });
}

test('advance deal Checkout charges once, binds a delayed renewal, preserves the old term, and cancels on refund',
  { skip: !databaseUrl }, async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci', '/watchdog_preview_20260923'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const f = await createFixture(client, { currentMode: 'CARD_ONCE', paidThrough: new Date(Date.now() + 3 * MS_DAY) });
    try {
      const { quote, attempt } = await quoteAndCheckout(f, 'CARD_AUTO');
      assert.equal(quote.purchaseMode, 'CARD_AUTO');
      const oldTerm = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: f.companyId } });
      const oldAccount = await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      await reconcile(f, attempt, 'CARD_AUTO');
      let current = await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      assert.equal(current.renewalMode, 'CARD_ONCE');
      assert.equal(current.contractAttemptId, f.oldAttemptId);
      assert.equal(current.paidThrough?.toISOString(), oldAccount.paidThrough?.toISOString());
      assert.equal(current.baseSubscriptionId, null);
      assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: f.companyId } })).termEndsAt.toISOString(), oldTerm.termEndsAt.toISOString());
      assert.equal((await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } })).applyStatus, 'PENDING');
      assert.equal((await client.billingOperation.findUniqueOrThrow({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: f.stripeAccountId, livemode: false, idempotencyKey: `advance-deal:${attempt.id}` } } })).state, 'PAID');
      const pending = await BillingService.prototype.status.call(f.service, { companyId: f.companyId, userId: f.userId } as any);
      assert.equal(pending.renewalMode, 'CARD_ONCE');
      assert.equal(pending.pendingDeal?.purchaseMode, 'CARD_AUTO');
      assert.equal(pending.pendingDeal?.state, 'PAID');
      assert.equal(pending.pendingDeal?.startsAt, oldAccount.paidThrough?.toISOString());
      assert.equal(pending.pendingDeal?.nextChargeAt, quote.advanceDeal?.nextChargeAt);
      await reconcile(f, attempt, 'CARD_AUTO');
      assert.equal((f.stripe as any).captured().calls.filter((call: any) => call.method === 'POST' && call.path === '/subscriptions').length, 1,
        'reconciliation replay must reuse the bound subscription');
      await client.billingAccount.update({ where: { id: f.account.id }, data: { termProjectionHash: 'old-source-drift' } });
      await reconcile(f, attempt, 'CARD_AUTO');
      assert.equal([...((f.stripe as any).captured().subscriptions.values())][0].status, 'canceled',
        'a HELD source must stop the bound future trial before it can collect');
      assert.equal((await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } })).activeAttemptId, attempt.id);
      assert.equal((await client.billingOperation.findUniqueOrThrow({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: f.stripeAccountId, livemode: false, idempotencyKey: `advance-deal:${attempt.id}` } } })).state, 'PAID');
      await reconcile(f, attempt, 'CARD_AUTO', f.priceSatang);
      current = await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      assert.equal(current.activeAttemptId, null);
      assert.equal(current.renewalMode, 'CARD_ONCE');
      assert.equal(current.paidThrough?.toISOString(), oldAccount.paidThrough?.toISOString());
      assert.equal((await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } })).applyStatus, 'HELD');
      assert.equal((await client.packageChangeRequest.findUniqueOrThrow({ where: { id: f.dealRow.id } })).status, 'CANCELLED');
      assert.equal((await client.billingOperation.findUniqueOrThrow({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: f.stripeAccountId, livemode: false, idempotencyKey: `advance-deal:${attempt.id}` } } })).state, 'CANCELLED');
      assert.equal([...((f.stripe as any).captured().subscriptions.values())][0].status, 'canceled');
      assert.equal(await client.billingInvoice.count({ where: { billingAccountId: f.account.id, providerInvoiceId: `in_advance${f.compact}` } }), 1);
    } finally {
      await clean(client, f.companyId, [f.userId, f.salesUserId], f.account.id);
      await client.$disconnect();
    }
  });

test('PromptPay advance checkout remains payment-only and activates at the existing term boundary',
  { skip: !databaseUrl }, async (t) => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci', '/watchdog_preview_20260923'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    // Let quote and Checkout observe a live old term, then cross its boundary before reconciliation.
    t.mock.timers.enable({ apis: ['Date'], now: new Date() });
    const startsAt = new Date(Date.now() + 5_000); startsAt.setMilliseconds(0);
    const f = await createFixture(client, { currentMode: 'PROMPTPAY_ONCE', paidThrough: startsAt });
    try {
      const { attempt } = await quoteAndCheckout(f, 'PROMPTPAY_RENEW');
      const endsAt = new Date((attempt.quoteSnapshot as unknown as BillingSnapshot).advanceDeal!.firstCycleEndsAt);
      t.mock.timers.tick(6_000);
      const oldTerm = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: f.companyId } });
      await reconcile(f, attempt, 'PROMPTPAY_RENEW');
      const current = await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } });
      const operation = await client.billingOperation.findUniqueOrThrow({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: f.stripeAccountId, livemode: false, idempotencyKey: `advance-deal:${attempt.id}` } } });
      const appliedTerm = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: f.companyId } });
      assert.equal(invoice.applyStatus, 'APPLIED');
      assert.equal(operation.state, 'APPLIED');
      assert.equal((await client.packageChangeRequest.findUniqueOrThrow({ where: { id: f.dealRow.id } })).status, 'APPLIED');
      assert.equal(appliedTerm.termStartAt.toISOString(), startsAt.toISOString());
      assert.equal(appliedTerm.termEndsAt.toISOString(), endsAt.toISOString());
      assert.equal(current.renewalMode, 'PROMPTPAY_RENEW');
      assert.equal(current.contractAttemptId, attempt.id);
      assert.equal(current.paidThrough?.toISOString(), endsAt.toISOString());
      assert.equal(current.nextChargeAt?.toISOString(), endsAt.toISOString());
      assert.equal(current.baseSubscriptionId, `sub_${f.compact}`);
      assert.notEqual(appliedTerm.termEndsAt.toISOString(), oldTerm.termEndsAt.toISOString());
      assert.equal([...((f.stripe as any).captured().subscriptions.values())][0].collection_method, 'send_invoice');
      assert.equal((await client.billingSubscriptionContract.findUniqueOrThrow({ where: { billingAccountId_sourceAttemptId: {
        billingAccountId: f.account.id, sourceAttemptId: attempt.id } } })).effectiveAt.toISOString(), endsAt.toISOString());
      await reconcile(f, attempt, 'PROMPTPAY_RENEW');
      assert.equal((f.stripe as any).captured().calls.filter((call: any) => call.method === 'POST' && call.path === '/subscriptions').length, 1,
        'boundary replay must not create a second subscription or charge');
    } finally {
      await clean(client, f.companyId, [f.userId, f.salesUserId], f.account.id);
      await client.$disconnect();
      t.mock.timers.reset();
    }
  });

/** Owner 2026-10-10, option "ค": the deal's renewal subscription is sent until the provider holds it (the reconciler's `createBindingSubscription`). */
test('advance deal paid, subscription never created: same key for an hour, then a new generation under a new key until it binds',
  { skip: !databaseUrl }, async () => {
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const f = await createFixture(client, { currentMode: 'PROMPTPAY_ONCE', paidThrough: new Date(Date.now() + 3 * MS_DAY) });
    const captured = (f.stripe as any).captured(), posts = () => captured.calls.filter((call: any) => call.method === 'POST' && call.path === '/subscriptions');
    try {
      const { attempt } = await quoteAndCheckout(f, 'PROMPTPAY_RENEW'), key = `mm:${attempt.id}:advance-renewal`;
      const journal = async () => (await client.billingAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).collectionJson as Record<string, any>;
      const sentAgo = async (ms: number) => client.billingAttempt.update({ where: { id: attempt.id }, data: {
        collectionJson: { ...await journal(), advanceSubscriptionRequestedAt: new Date(Date.now() - ms).toISOString() } } });
      captured.fail.subscription = new StripeRequestError('UNKNOWN', 'unavailable', 60, undefined, undefined, 503);
      await assert.rejects(reconcile(f, attempt, 'PROMPTPAY_RENEW'), /stripe\.unavailable/);
      await sentAgo(30 * 60_000);
      await assert.rejects(reconcile(f, attempt, 'PROMPTPAY_RENEW'), /stripe\.unavailable/);
      assert.deepEqual(posts().map((call: any) => call.key), [key, key]);
      // A day later the provider still holds nothing: generation 2 under its own key, not "review for ever".
      await sentAgo(24 * 3_600_000);
      await assert.rejects(reconcile(f, attempt, 'PROMPTPAY_RENEW'), /stripe\.unavailable/);
      assert.equal(posts().at(-1).key, `${key}:g2`);
      assert.equal((await journal()).advanceSubscriptionGeneration, 2);
      // Ten quiet minutes after a generation's hour: the pass reads and sends nothing.
      await sentAgo(65 * 60_000);
      await reconcile(f, attempt, 'PROMPTPAY_RENEW');
      assert.equal(posts().length, 3);
      assert.equal((await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } })).activeAttemptId, attempt.id);
      captured.fail.subscription = null;
      await sentAgo(71 * 60_000);
      await reconcile(f, attempt, 'PROMPTPAY_RENEW');
      assert.equal(posts().at(-1).key, `${key}:g3`);
      const operation = await client.billingOperation.findUniqueOrThrow({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: f.stripeAccountId, livemode: false, idempotencyKey: `advance-deal:${attempt.id}` } } });
      assert.deepEqual([captured.subscriptions.size, (operation.resultJson as any).subscriptionId, operation.state], [1, `sub_${f.compact}`, 'PAID']);
      // The provider refuses a later create (the subscription was removed there): journalled, and never sent again by itself.
      captured.subscriptions.clear();
      await client.billingOperation.update({ where: { id: operation.id }, data: { resultJson: {} } });
      captured.fail.subscription = new StripeRequestError('REJECTED', 'request_rejected', 60, 'resource_missing', 'invalid_request_error', 400);
      await sentAgo(71 * 60_000);
      await assert.rejects(reconcile(f, attempt, 'PROMPTPAY_RENEW'), /stripe\.request_rejected/);
      assert.deepEqual([(await journal()).advanceSubscriptionRefused?.generation, (await journal()).advanceSubscriptionRefused?.status], [4, 400]);
      captured.fail.subscription = null;
      await sentAgo(24 * 3_600_000);
      await assert.rejects(reconcile(f, attempt, 'PROMPTPAY_RENEW'), /billing\.subscription_binding_refused/);
      assert.equal(posts().length, 5);
    } finally {
      await clean(client, f.companyId, [f.userId, f.salesUserId], f.account.id);
      await client.$disconnect();
    }
  });

test('advance deal keeps its payment pending without binding a Stripe trial beyond the provider window',
  { skip: !databaseUrl }, async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci', '/watchdog_preview_20260923'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const startsAt = new Date(Date.now()); startsAt.setUTCFullYear(startsAt.getUTCFullYear() + 3); startsAt.setMilliseconds(0);
    const f = await createFixture(client, { currentMode: 'CARD_ONCE', paidThrough: startsAt });
    try {
      const { quote, attempt } = await quoteAndCheckout(f, 'CARD_AUTO');
      await reconcile(f, attempt, 'CARD_AUTO');
      const operation = await client.billingOperation.findUniqueOrThrow({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: f.stripeAccountId, livemode: false, idempotencyKey: `advance-deal:${attempt.id}` } } });
      const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } });
      const account = await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      assert.equal(operation.state, 'PAID');
      assert.equal((operation.resultJson as any)?.subscriptionId, undefined);
      assert.equal(invoice.applyStatus, 'PENDING');
      assert.equal(account.renewalMode, 'CARD_ONCE');
      assert.equal(account.paidThrough?.toISOString(), quote.advanceDeal!.startsAt);
      assert.equal((f.stripe as any).captured().calls.filter((call: any) => call.method === 'POST' && call.path === '/subscriptions').length, 0);
      const status = await BillingService.prototype.status.call(f.service, { companyId: f.companyId, userId: f.userId } as any);
      assert.equal(status.pendingDeal?.state, 'PENDING_BINDING');
      assert.equal(status.renewalMode, 'CARD_ONCE');
    } finally {
      await clean(client, f.companyId, [f.userId, f.salesUserId], f.account.id);
      await client.$disconnect();
    }
  });

test('a discovered card advance-deal invoice imports through the one-time Checkout route and waits for review',
  { skip: !databaseUrl }, async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci', '/watchdog_preview_20260923'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const f = await createFixture(client, { currentMode: 'CARD_ONCE', paidThrough: new Date(Date.now() + 3 * MS_DAY) });
    try {
      const { attempt } = await quoteAndCheckout(f, 'CARD_AUTO');
      const paid = pay(f, attempt), finding = await discovered(f, paid.invoice);
      const before = await client.billingAccount.update({ where: { id: f.account.id }, data: { leaseToken: null, leaseUntil: null } });
      // A card advance deal's invoice has no subscription: it must not fall through to the subscription binding.
      await f.reconciler.importDiscoveredInvoice(f.account.id, finding.id, finding.sourceHash, async () => {});
      const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } });
      assert.deepEqual([invoice.providerInvoiceId, invoice.subscriptionId, invoice.providerStatus, invoice.applyStatus, invoice.paidSatang, invoice.totalSatang],
        [paid.invoice.id, null, 'paid', 'HELD', paid.invoice.total, paid.invoice.total]);
      assert.ok(invoice.evidenceHash);
      assert.equal(await client.billingIssue.count({ where: { companyId: f.companyId, kind: 'PAID_HELD', referenceId: invoice.id } }), 1);
      const after = await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      assert.deepEqual([after.renewalMode, after.contractAttemptId, after.paidThrough?.toISOString(), after.baseSubscriptionId],
        [before.renewalMode, before.contractAttemptId, before.paidThrough?.toISOString(), null], 'an import records the payment and changes no rights');
      assert.equal(await client.billingOperation.count({ where: { companyId: f.companyId, type: 'CUSTOMER_ADVANCE_RENEWING_DEAL' } }), 0);
      assert.equal((f.stripe as any).captured().calls.filter((call: any) => call.method === 'POST' && call.path === '/subscriptions').length, 0);
    } finally {
      await clean(client, f.companyId, [f.userId, f.salesUserId], f.account.id);
      await client.$disconnect();
    }
  });

test('a held card advance-deal invoice retries through the one-time Checkout route, never the subscription path',
  { skip: !databaseUrl }, async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci', '/watchdog_preview_20260923'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const f = await createFixture(client, { currentMode: 'CARD_ONCE', paidThrough: new Date(Date.now() + 3 * MS_DAY) });
    try {
      const { attempt } = await quoteAndCheckout(f, 'CARD_AUTO');
      pay(f, attempt);
      // The normal paid path (active attempt) holds the payment while the old term's source has drifted.
      const source = await client.billingAccount.update({ where: { id: f.account.id }, data: { leaseToken: null, leaseUntil: null, termProjectionHash: 'old-source-drift' } });
      await f.reconciler.reconcileAccount(f.account.id);
      const held = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } });
      assert.equal(held.applyStatus, 'HELD');
      await client.billingAccount.update({ where: { id: f.account.id }, data: { termProjectionHash: termProjectionHash(f.term) } });
      const { calls } = (f.stripe as any).captured(), from = calls.length;
      // The operator's RETRY_APPLY of that held invoice.
      await f.reconciler.reconcileAccount(f.account.id, undefined, undefined, held.id);
      const retry = calls.slice(from).map((call: any) => `${call.method} ${call.path}`);
      assert.ok(retry.includes(`GET /checkout/sessions/${attempt.checkoutSessionId}`), 'the retry re-verifies the paid Checkout');
      assert.ok(!retry.some((call: string) => call.includes('/subscriptions')), 'never the subscription path, and a held payment binds no renewal');
      assert.equal((await client.billingOperation.findUniqueOrThrow({ where: { stripeAccountId_livemode_idempotencyKey: {
        stripeAccountId: f.stripeAccountId, livemode: false, idempotencyKey: `advance-deal:${attempt.id}` } } })).type, 'CUSTOMER_ADVANCE_RENEWING_DEAL');
      const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } });
      assert.deepEqual([invoice.id, invoice.applyStatus, invoice.evidenceHash], [held.id, 'HELD', held.evidenceHash]);
      const current = await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      assert.deepEqual([current.renewalMode, current.contractAttemptId, current.paidThrough?.toISOString(), current.baseSubscriptionId, current.activeAttemptId],
        ['CARD_ONCE', f.oldAttemptId, source.paidThrough?.toISOString(), null, attempt.id], 'the old one-time term stays authoritative');
      assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: f.companyId } })).termEndsAt.toISOString(), f.term.termEndsAt.toISOString());
    } finally {
      await clean(client, f.companyId, [f.userId, f.salesUserId], f.account.id);
      await client.$disconnect();
    }
  });

test('a discovered renewal of a card advance deal\'s subscription imports against its one-time payment Checkout',
  { skip: !databaseUrl }, async (t) => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci', '/watchdog_preview_20260923'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    // As the PromptPay test: quote against a live old term, then cross its boundary so the paid deal activates.
    t.mock.timers.enable({ apis: ['Date'], now: new Date() });
    const startsAt = new Date(Date.now() + 5_000); startsAt.setMilliseconds(0);
    const f = await createFixture(client, { currentMode: 'CARD_ONCE', paidThrough: startsAt });
    try {
      const { attempt } = await quoteAndCheckout(f, 'CARD_AUTO');
      const advance = (attempt.quoteSnapshot as unknown as BillingSnapshot).advanceDeal!, endsAt = new Date(advance.firstCycleEndsAt);
      t.mock.timers.tick(6_000);
      await reconcile(f, attempt, 'CARD_AUTO');
      const subscriptionId = `sub_${f.compact}`, active = await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      assert.deepEqual([active.renewalMode, active.baseSubscriptionId, active.contractAttemptId, active.paidThrough?.toISOString()],
        ['CARD_AUTO', subscriptionId, attempt.id, endsAt.toISOString()]);
      // The trial ends and Stripe charges the first renewal; the scan finds that invoice with no local row.
      t.mock.timers.tick(endsAt.getTime() - Date.now() + 60_000);
      const paid = renew(f, attempt, subscriptionId, endsAt, appendPackageInterval(endsAt, 'month', advance.anchorDay));
      const finding = await discovered(f, paid.invoice);
      await client.billingAccount.update({ where: { id: f.account.id }, data: { leaseToken: null, leaseUntil: null } });
      // The subscription path must expect the deal's payment-mode Checkout, not a subscription-mode one.
      await f.reconciler.importDiscoveredInvoice(f.account.id, finding.id, finding.sourceHash, async () => {});
      const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { billingAccountId_providerInvoiceId: {
        billingAccountId: f.account.id, providerInvoiceId: paid.invoice.id } } });
      assert.deepEqual([invoice.subscriptionId, invoice.sourceAttemptId, invoice.providerStatus, invoice.applyStatus, invoice.periodStart.toISOString(), invoice.paidSatang],
        [subscriptionId, null, 'paid', 'HELD', endsAt.toISOString(), paid.invoice.total]);
      assert.equal(await client.billingIssue.count({ where: { companyId: f.companyId, kind: 'PAID_HELD', referenceId: invoice.id } }), 1);
      const after = await client.billingAccount.findUniqueOrThrow({ where: { id: f.account.id } });
      assert.deepEqual([after.renewalMode, after.baseSubscriptionId, after.contractAttemptId, after.paidThrough?.toISOString()],
        ['CARD_AUTO', subscriptionId, attempt.id, endsAt.toISOString()], 'an import records the payment and changes no rights');
      assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: f.companyId } })).termEndsAt.toISOString(), endsAt.toISOString());
      assert.equal((f.stripe as any).captured().calls.filter((call: any) => call.method === 'POST' && call.path === '/subscriptions').length, 1);
    } finally {
      await clean(client, f.companyId, [f.userId, f.salesUserId], f.account.id);
      await client.$disconnect();
      t.mock.timers.reset();
    }
  });
