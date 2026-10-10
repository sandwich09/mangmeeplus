import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, type BillingPurchaseMode } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { BillingService } from './application/billing.service';
import { BillingReconcilerService } from './application/billing-reconciler.service';
import { BillingCollection } from './application/billing-collection';
import { StripeRequestError } from './infrastructure/stripe.client';
import { endPaidPackage } from './application/billing-end-package';
import { unrepairableBinding } from './application/billing-refund-source';
import { detectBillingIssue } from './application/billing-issues';

const databaseUrl = process.env.BILLING_EVENT_DISCOUNT_RENEWAL_TEST_DATABASE_URL;
const address = { line1: '99 ถนนทดสอบ', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' };
const policy = { ...BILLING_DRAFT_POLICY, portalConfigurationId: 'bpc_synthetic', priceIds: {
  'STARTER_249:month': 'price_StarterMonth', 'STARTER_249:year': 'price_StarterYear', 'BASIC_499:month': 'price_BasicMonth', 'BASIC_499:year': 'price_BasicYear',
  'PRO_999:month': 'price_ProMonth', 'PRO_999:year': 'price_ProYear', 'ENTERPRISE_1999:month': 'price_EntMonth', 'ENTERPRISE_1999:year': 'price_EntYear' } };

/**
 * One shop, one LINE holder, real quote → Checkout → reconcile → bind code against Postgres, with a Stripe fake modelled on
 * billing-advance-deal.pg.spec.ts. `failNextSubscription` loses the response of a subscription Stripe did create.
 */
async function fixture(client: PrismaClient, events: { name: string; discountSatang: number }[]) {
  const run = randomUUID().replaceAll('-', '').slice(0, 12), stripeAccountId = `acct_${run}`, owner = `sdr-owner-${run}`, companyId = `sdr-shop-${run}`;
  const customerId = `cus_${run}`, state = { policy, revision: { id: 'synthetic-revision' }, settings: { version: 1 }, gates: Object.fromEntries(BILLING_ACTIONS.map(action => [action, true])) };
  const customers = new Map<string, Record<string, unknown>>(), sessions: Record<string, any>[] = [], subscriptions = new Map<string, any>();
  const calls: { method: string; path: string; params?: any; key?: string }[] = [];
  const stripeState = { paid: {} as Record<string, any>, failNextSubscription: false, subscriptionError: null as Error | null };
  const stripe = { enabled: true, accountId: stripeAccountId, livemode: false, assertAccount: async () => {},
    request: async (method: string, path: string, params?: any, key?: string): Promise<any> => {
      calls.push({ method, path, params, key });
      const { paid } = stripeState;
      if (path.startsWith('/prices/')) return { id: path.slice(8), object: 'price', livemode: false, active: true, type: 'recurring', product: 'prod_Synthetic',
        currency: 'thb', unit_amount: 49900, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit' };
      if (path.startsWith('/customers/')) {
        const id = path.slice(11), account = await client.billingAccount.findFirstOrThrow({ where: { customerId: id } });
        if (method === 'POST') customers.set(id, params);
        return { id, metadata: { billingAccountId: account.id }, ...customers.get(id) };
      }
      if (path.startsWith('/payment_intents/')) return paid.intent;
      if (path.startsWith('/charges/')) return paid.intent.latest_charge;
      if (path.startsWith('/payment_methods/')) return { id: path.split('/').at(-1), object: 'payment_method', type: 'card', customer: customerId };
      if (method === 'POST' && path === '/checkout/sessions') {
        sessions.push(params);
        return { id: `cs_${run}${sessions.length}`, object: 'checkout.session', livemode: false, mode: params.mode, client_reference_id: params.client_reference_id,
          customer: params.customer, metadata: params.metadata, url: `https://checkout.stripe.com/c/pay/cs_${run}${sessions.length}` };
      }
      if (method === 'POST' && path === '/subscriptions') {
        if (stripeState.subscriptionError) throw stripeState.subscriptionError; // Stripe answered without creating anything.
        const id = `sub_${run}${subscriptions.size + 1}`, item = params.items[0];
        subscriptions.set(id, { id, object: 'subscription', livemode: false, customer: params.customer, status: 'trialing', metadata: params.metadata,
          billing_mode: params.billing_mode, collection_method: params.collection_method, payment_settings: params.payment_settings,
          default_payment_method: params.default_payment_method ?? null, trial_end: params.trial_end, trial_settings: params.trial_settings, cancel_at_period_end: false,
          items: { has_more: false, data: [{ id: `si_${run}`, price: item.price, quantity: item.quantity, tax_rates: item.tax_rates ?? [],
            current_period_start: Math.floor(Date.now() / 1000), current_period_end: params.trial_end }] } });
        if (stripeState.failNextSubscription) { stripeState.failNextSubscription = false; throw new Error('synthetic: response lost after Stripe created it'); }
        return structuredClone(subscriptions.get(id));
      }
      if (path.startsWith('/subscriptions/')) {
        const sub = subscriptions.get(path.split('/').at(-1)!);
        if (!sub) throw new Error(`unmocked subscription ${method} ${path}`);
        if (method === 'POST') { // "หยุดต่ออายุ": cancel at the period end, the operation marker on the subscription.
          sub.cancel_at_period_end = params.cancel_at_period_end; sub.cancel_at = params.cancel_at_period_end ? sub.items.data[0].current_period_end : null;
          Object.assign(sub.metadata, params.metadata);
        }
        if (method === 'DELETE') sub.status = 'canceled';
        return structuredClone(sub);
      }
      throw new Error(`unmocked Stripe request ${method} ${path}`);
    },
    list: async (path: string, params?: any) => {
      const { paid } = stripeState;
      if (path === '/subscriptions') return [...subscriptions.values()].map(sub => structuredClone(sub));
      // A trialing subscription's only invoice before its period ends: the $0 subscription_create one.
      if (path === '/invoices') return params?.subscription ? [{ id: `in_zero_${params.subscription}`, object: 'invoice', livemode: false, customer: customerId,
        status: 'paid', billing_reason: 'subscription_create', total: 0, amount_paid: 0, created: Math.floor(Date.now() / 1000),
        parent: { subscription_details: { subscription: params.subscription } } }] : [];
      if (path === '/invoice_payments') return paid.payments ?? [];
      if (path.endsWith('/line_items')) return paid.checkoutLines ?? [];
      if (path.endsWith('/lines')) return paid.invoiceLines ?? [];
      return [];
    } };
  const service = { prisma: { client }, config: { stripeAccountId, sesWebBaseUrl: 'https://app.example.test' }, stripe,
    assertOwner: async () => {}, assertTaxSettings: async () => {}, settings: async () => state, issue: async () => {},
    account: (id: string, tx = client) => tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: { companyId: id, stripeAccountId, livemode: false } } }),
    purchaseSource: (company: Parameters<BillingService['purchaseSource']>[0], current: Parameters<BillingService['purchaseSource']>[1], tx = client) =>
      BillingService.prototype.purchaseSource.call({ prisma: { client }, stripe } as unknown as BillingService, company, current, tx),
    usage: async () => ({ used: 0, limit: null, remaining: null, resetsAt: null, cadence: 'PAID_GRANTS', expiresAt: null }),
  } as unknown as BillingService;
  const reconciler = new BillingReconcilerService({ client } as any, {} as any, stripe as any, service, {} as any);
  const context = { companyId, userId: owner, requestId: run } as any;

  await client.user.create({ data: { id: owner, displayName: 'Synthetic holder', email: `${owner}@example.test`, emailVerifiedAt: new Date() } });
  await client.externalIdentity.create({ data: { userId: owner, provider: 'LINE', providerChannelId: `ch-${run}`, providerUserId: `U${run}` } });
  await client.company.create({ data: { id: companyId, name: 'Synthetic renewal shop', addressJson: address } });
  const account = await client.billingAccount.create({ data: { companyId, stripeAccountId, livemode: false, customerId } });
  const batchIds: string[] = [], serials: string[] = [];
  for (const [index, event] of events.entries()) {
    const scopeJson = { tiers: ['BASIC_499'], intervals: ['month'] };
    const batch = await client.salesEventBatch.create({ data: { eventName: `${event.name} ${run}`, batchName: 'booth', discountSatang: event.discountSatang, issueCap: 5,
      issuedCount: 1, claimStartsAt: new Date(Date.now() - 3_600_000), claimEndsAt: new Date(Date.now() + 3_600_000), scopeJson, createdByUserId: `lead-${run}` } });
    batchIds.push(batch.id);
    serials.push((await client.salesEventTicket.create({ data: { serial: `R${index}${run}`, batchId: batch.id, batchRevision: 1, salesUserId: `seller-${run}`,
      holderChannelId: `ch-${run}`, holderProviderUserId: `U${run}`, discountSatang: event.discountSatang, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0,
      scopeJson, expiresAt: new Date(Date.now() + 30 * 86_400_000), claimRequestKey: `claim-${index}-${run}` } })).serial);
  }
  let keys = 0;
  const quote = (purchaseMode: BillingPurchaseMode, extra: { eventDiscountChoice?: 'USE' | 'DECLINE'; eventDiscountTicketSerial?: string } = {}) =>
    BillingService.prototype.quote.call(service, context, { offerKey: 'BASIC_499', interval: 'month', purchaseMode, ...extra });
  const checkout = (quoteId: string, consentRevision: string) => BillingService.prototype.checkout.call(service, context,
    { quoteId, consentRevision, accepted: true, channel: 'web' }, `sdr-idem-${run}-${++keys}`);
  /** Stripe's paid one-time Checkout of `amount` for this attempt: the objects `paidPackageCheckoutEvidence` checks. */
  const pay = async (attemptId: string, amount: number, method: 'card' | 'promptpay') => {
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const created = Math.floor(Date.now() / 1000) - 60, meta = { billingAttemptId: attempt.id, billingAccountId: account.id }, n = `${run}${keys}`;
    const charge = { id: `ch_${n}`, livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount, customer: customerId,
      payment_intent: `pi_${n}`, payment_method_details: { type: method }, amount_refunded: 0, disputed: false, balance_transaction: null };
    stripeState.paid = { intent: { id: `pi_${n}`, livemode: false, status: 'succeeded', currency: 'thb', amount_received: amount, customer: customerId, latest_charge: charge,
      // A card Checkout with setup_future_usage leaves the card saved on the customer for the renewals.
      payment_method: method === 'card' ? `pm_${n}` : null, setup_future_usage: method === 'card' ? 'off_session' : null },
      payments: [{ object: 'invoice_payment', livemode: false, status: 'paid', invoice: `in_${n}`, payment: { type: 'payment_intent', payment_intent: `pi_${n}` }, amount_paid: amount, currency: 'thb' }],
      checkoutLines: [{ quantity: 1, currency: 'thb', amount_total: amount, amount_tax: 0, amount_discount: 0,
        price: { id: `price_inline${n}`, product: 'prod_Synthetic', type: 'one_time', active: false, recurring: null, livemode: false, currency: 'thb', unit_amount: amount } }],
      invoiceLines: [{ parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: `ii_${n}`, subscription: null, proration: false } },
        pricing: { price_details: { price: `price_inline${n}`, product: 'prod_Synthetic' } }, amount, currency: 'thb', livemode: false, quantity: 1 }] };
    const session = { id: attempt.checkoutSessionId, object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
      subscription: null, customer: customerId, client_reference_id: attempt.id, metadata: meta, invoice: `in_${n}`, payment_intent: `pi_${n}`,
      invoice_creation: { enabled: true }, currency: 'thb', amount_total: amount, total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: 0 }, created,
      customer_details: { email: `${owner}@example.test` } };
    const invoice = { id: `in_${n}`, object: 'invoice', livemode: false, customer: customerId, metadata: meta, status: 'paid', billing_reason: 'manual',
      collection_method: 'send_invoice', parent: null, currency: 'thb', total: amount, amount_paid: amount, amount_remaining: 0, starting_balance: 0,
      status_transitions: { paid_at: created + 3 }, number: `SDR-${n}` };
    return { attempt, session, invoice };
  };
  /** The reconciler's one-time route for this attempt, under a fresh lease (what reconcileAccount does for an active attempt). */
  const reconcileOneTime = async (paid: Awaited<ReturnType<typeof pay>>) => {
    const lease = `lease-${run}-${++keys}`;
    const current = await client.billingAccount.update({ where: { id: account.id }, data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: paid.attempt.id } });
    try { return await (reconciler as any).reconcileOneTime(current, attempt, lease, undefined, paid.session, paid.invoice); }
    finally { await client.billingAccount.update({ where: { id: account.id }, data: { leaseToken: null, leaseUntil: null } }); }
  };
  const ticket = (serial: string) => client.salesEventTicket.findUniqueOrThrow({ where: { serial } });
  const current = () => client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
  const cleanup = async () => {
    const steps: (() => Promise<unknown>)[] = [
      () => client.billingAccount.updateMany({ where: { companyId }, data: { activeAttemptId: null, contractAttemptId: null, activeCollectionOperationId: null } }),
      () => client.salesEventTicket.deleteMany({ where: { batchId: { in: batchIds } } }),
      () => client.salesEventBatch.deleteMany({ where: { id: { in: batchIds } } }),
      () => client.billingSubscriptionContract.deleteMany({ where: { billingAccountId: account.id } }),
      ...['outboxEvent', 'auditLog', 'billingIssue', 'entitlementCommand', 'entitlementTransition', 'runoffSnapshot', 'companyFeatureEntitlement',
        'companyEntitlementNormalization', 'companyEntitlementSet', 'salesAttribution', 'billingOperation', 'billingReceiptGrant', 'billingQuote']
        .map(model => () => (client as any)[model].deleteMany({ where: { companyId } })),
      () => client.billingAttempt.deleteMany({ where: { billingAccountId: account.id } }),
      () => client.billingInvoice.deleteMany({ where: { billingAccountId: account.id } }),
      () => client.companyPlanTerm.deleteMany({ where: { companyId } }),
      () => client.billingAccount.deleteMany({ where: { companyId } }),
      () => client.externalIdentity.deleteMany({ where: { userId: owner } }),
      () => client.company.deleteMany({ where: { id: companyId } }),
      () => client.user.deleteMany({ where: { id: owner } }),
    ];
    for (const step of steps) await step().catch(() => undefined);
  };
  return { run, client, stripe, stripeState, service, reconciler, context, account, companyId, customerId, serials, sessions, subscriptions, calls,
    quote, checkout, pay, reconcileOneTime, ticket, current, cleanup };
}

const connect = () => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(databaseUrl!).hostname));
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
};

/**
 * SD-O13 (spec §5.3): CARD_AUTO with the discount pays its first period once at Checkout — card saved — then binds a
 * full-price catalog subscription trialing to that period's end. The binding survives a lost response without a second
 * subscription, the $0 trial invoice is skipped, the shop can stop the first full-price charge while it trials, and its
 * payment source never reads as inconsistent while the binding is pending.
 */
test('CARD_AUTO first bill: discounted one-time Checkout, first period applied, full-price trial bound once, stoppable while trialing', { skip: !databaseUrl }, async () => {
  const client = connect(), f = await fixture(client, [{ name: 'งานเปิดร้าน', discountSatang: 10000 }]);
  try {
    const quoted = await f.quote('CARD_AUTO');
    assert.equal(quoted.purchase?.kind, 'INITIAL'); assert.equal(quoted.totalSatang, 49900, 'the quote itself stays the full renewal price');
    assert.deepEqual([quoted.eventDiscount?.choice, quoted.eventDiscount?.applied?.totalSatang], ['USE', 39900]);

    // Step 1: a payment Checkout on the card that saves it for the renewals, at the discounted amount.
    const opened = await f.checkout(quoted.quoteId, quoted.consentRevision);
    assert.equal(opened.state, 'OPEN');
    const payload = f.sessions.at(-1)!;
    assert.deepEqual([payload.mode, payload.payment_method_types, payload.payment_intent_data.setup_future_usage, payload.line_items[0].price_data.unit_amount],
      ['payment', ['card'], 'off_session', 39900]);
    assert.equal((await f.ticket(f.serials[0]!)).state, 'RESERVED');

    // Step 2: paid → the first period applies through the one-time path; the renewal slot stays held until the subscription binds.
    // Stripe creates the subscription but its answer is lost: the paid period stands, the binding waits for the next pass.
    const paid = await f.pay(opened.attemptId, 39900, 'card');
    f.stripeState.failNextSubscription = true;
    await assert.rejects(f.reconcileOneTime(paid), /response lost/);
    const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: opened.attemptId } });
    assert.deepEqual([invoice.totalSatang, invoice.applyStatus], [39900, 'APPLIED']);
    const used = await f.ticket(f.serials[0]!);
    assert.deepEqual([used.state, used.invoiceId], ['USED', invoice.id]);
    let account = await f.current();
    assert.deepEqual([account.renewalMode, account.activeAttemptId, account.contractAttemptId, account.baseSubscriptionId],
      ['CARD_AUTO', opened.attemptId, opened.attemptId, null]);
    const term = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: f.companyId } });
    assert.equal(term.termEndsAt.toISOString(), account.paidThrough!.toISOString());

    // Step 6: mid-binding the shop reads as paid in its current mode, never SOURCE_INCONSISTENT, and nothing new can be bought.
    assert.equal(await f.service.purchaseSource({ planTerm: term }, account), 'PAID_CURRENT_MODE');
    const pending = await BillingService.prototype.status.call(f.service, f.context);
    assert.deepEqual([pending.purchaseSource, pending.purchaseEligibility, pending.renewalMode, pending.allowedActions.includes('new_sales')],
      ['PAID_CURRENT_MODE', 'ELIGIBLE', 'CARD_AUTO', false]);

    // Step 3 + replay: the next pass finds the subscription Stripe made — no second one — and binds it.
    await f.reconcileOneTime(paid);
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/subscriptions').length, 1, 'a replay never creates a second subscription');
    const [sub] = [...f.subscriptions.values()];
    account = await f.current();
    assert.deepEqual([sub.collection_method, sub.payment_settings.payment_method_types, sub.trial_settings.end_behavior.missing_payment_method],
      ['charge_automatically', ['card'], 'cancel']);
    assert.equal(sub.default_payment_method, paid.session.payment_intent.replace('pi_', 'pm_'), 'the card this Checkout saved');
    assert.deepEqual([sub.items.data[0].price, sub.items.data[0].discounts, sub.trial_end], ['price_BasicMonth', undefined, Math.floor(account.paidThrough!.getTime() / 1000)]);
    assert.equal(f.calls.find(call => call.method === 'POST' && call.path === '/subscriptions')?.key, `mm:${opened.attemptId}:card-renewal`);
    assert.deepEqual([account.baseSubscriptionId, account.activeAttemptId, account.subscriptionState, account.nextChargeAt?.toISOString()],
      [sub.id, null, 'trialing', account.paidThrough!.toISOString()]);
    const contract = await client.billingSubscriptionContract.findUniqueOrThrow({ where: { billingAccountId_sourceAttemptId: { billingAccountId: f.account.id, sourceAttemptId: opened.attemptId } } });
    assert.equal(contract.effectiveAt.toISOString(), account.paidThrough!.toISOString());
    assert.equal((contract.snapshotJson as any).quote.totalSatang, 49900, 'the renewal contract is the full price (spec §5.4)');

    // Step 4: the ordinary reconcile of the bound subscription skips its $0 subscription_create invoice (no zero-invoice review).
    await f.reconciler.reconcileAccount(f.account.id);
    account = await f.current();
    assert.deepEqual([account.renewalMode, account.subscriptionState, account.baseSubscriptionId, account.contractAttemptId], ['CARD_AUTO', 'trialing', sub.id, opened.attemptId]);
    assert.equal(await client.billingInvoice.count({ where: { billingAccountId: f.account.id } }), 1, 'the $0 trial invoice is never recorded as a payment');
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/subscriptions').length, 1);

    // Step 5: "หยุดต่ออายุ" while the first period trials — offered on the page, and it stops the first full-price charge.
    const trialing = await BillingService.prototype.status.call(f.service, f.context);
    assert.equal(trialing.allowedActions.includes('portal_cancel_subscription'), true);
    assert.equal(trialing.allowedActions.includes('new_sales'), false, 'no repeat or upgrade until the first full-price round is paid');
    const collection = new BillingCollection({ client } as any, f.stripe as any, f.service);
    const preview = await collection.preview(f.context, 'CANCEL_RENEWAL');
    await collection.submit(f.context, preview.id, preview.version, preview.previewHash, `sdr-cancel-${f.run}-0001`);
    const lease = `lease-cancel-${f.run}`;
    await collection.advance(await client.billingAccount.update({ where: { id: f.account.id }, data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } }), lease);
    assert.equal((await client.billingOperation.findUniqueOrThrow({ where: { id: preview.id } })).state, 'SUCCEEDED');
    account = await f.current();
    assert.deepEqual([account.cancelAtPeriodEnd, account.nextChargeAt, account.subscriptionState], [true, null, 'trialing']);
    assert.deepEqual([f.subscriptions.get(sub.id).cancel_at_period_end, f.subscriptions.get(sub.id).cancel_at], [true, sub.trial_end]);
  } finally {
    await f.cleanup(); await client.$disconnect();
  }
});

/** Spec §5.2: PROMPTPAY_RENEW discounts only the first period's one-time amount; its subscription binds at the catalog price. */
test('PROMPTPAY_RENEW first bill: discounted QR payment, then a full-price send_invoice subscription from the period end', { skip: !databaseUrl }, async () => {
  const client = connect(), f = await fixture(client, [{ name: 'งานเปิดร้าน QR', discountSatang: 10000 }]);
  try {
    const quoted = await f.quote('PROMPTPAY_RENEW');
    assert.deepEqual([quoted.purchase?.kind, quoted.totalSatang, quoted.eventDiscount?.applied?.totalSatang], ['INITIAL', 49900, 39900]);
    const opened = await f.checkout(quoted.quoteId, quoted.consentRevision);
    const payload = f.sessions.at(-1)!;
    assert.deepEqual([payload.mode, payload.payment_method_types, payload.payment_intent_data.setup_future_usage, payload.line_items[0].price_data.unit_amount],
      ['payment', ['promptpay'], undefined, 39900]);
    await f.reconcileOneTime(await f.pay(opened.attemptId, 39900, 'promptpay'));
    const [sub] = [...f.subscriptions.values()], account = await f.current();
    assert.deepEqual([sub.collection_method, sub.payment_settings.payment_method_types, sub.items.data[0].price, sub.trial_end],
      ['send_invoice', ['promptpay'], 'price_BasicMonth', Math.floor(account.paidThrough!.getTime() / 1000)]);
    assert.deepEqual([account.renewalMode, account.baseSubscriptionId, account.activeAttemptId], ['PROMPTPAY_RENEW', sub.id, null]);
    assert.equal(f.calls.find(call => call.method === 'POST' && call.path === '/subscriptions')?.key, `mm:${opened.attemptId}:promptpay-renewal`);
    const contract = await client.billingSubscriptionContract.findFirstOrThrow({ where: { billingAccountId: f.account.id } });
    assert.deepEqual([contract.effectiveAt.toISOString(), (contract.snapshotJson as any).quote.totalSatang], [account.paidThrough!.toISOString(), 49900]);
    assert.deepEqual([(await f.ticket(f.serials[0]!)).state, (await client.billingInvoice.findFirstOrThrow({ where: { sourceAttemptId: opened.attemptId } })).totalSatang],
      ['USED', 39900]);
  } finally {
    await f.cleanup(); await client.$disconnect();
  }
});

/**
 * Owner 2026-10-10, option "ค": a paid purchase whose renewal subscription the provider never created is repaired by the
 * system itself. The first period is delivered before the binding; the binding is re-sent under its key for one hour, sends
 * nothing for ten quiet minutes, then goes out again under a new key, as often as it takes. Never a send while a refund
 * touches the payment, and never again after the provider refused the request.
 */
test('PROMPTPAY_RENEW paid, subscription never created: same key for an hour, then a new generation under a new key until it binds', { skip: !databaseUrl }, async () => {
  const client = connect(), f = await fixture(client, [{ name: 'งานซ่อมรอบถัดไป', discountSatang: 10000 }]);
  const posts = () => f.calls.filter(call => call.method === 'POST' && call.path === '/subscriptions');
  const journal = async () => (await client.billingAttempt.findUniqueOrThrow({ where: { id: opened.attemptId } })).collectionJson as Record<string, any>;
  const sentAgo = async (ms: number) => client.billingAttempt.update({ where: { id: opened.attemptId }, data: {
    collectionJson: { ...await journal(), qrSubscriptionRequestedAt: new Date(Date.now() - ms).toISOString() } } });
  let opened!: Awaited<ReturnType<typeof f.checkout>>;
  try {
    const quoted = await f.quote('PROMPTPAY_RENEW');
    opened = await f.checkout(quoted.quoteId, quoted.consentRevision);
    const paid = await f.pay(opened.attemptId, 39900, 'promptpay'), key = `mm:${opened.attemptId}:promptpay-renewal`;
    f.stripeState.subscriptionError = new StripeRequestError('UNKNOWN', 'unavailable', 60, undefined, undefined, 503);
    await assert.rejects(f.reconcileOneTime(paid), /stripe\.unavailable/);
    // The paid period is delivered before the binding; only the slot waits.
    assert.equal((await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: opened.attemptId } })).applyStatus, 'APPLIED');
    assert.deepEqual([(await f.current()).activeAttemptId, (await f.current()).baseSubscriptionId], [opened.attemptId, null]);
    // Inside the hour: the same key again.
    await sentAgo(30 * 60_000);
    await assert.rejects(f.reconcileOneTime(paid), /stripe\.unavailable/);
    assert.deepEqual(posts().map(call => call.key), [key, key]);
    // Between one hour and one hour ten: the pass reads and sends nothing.
    await sentAgo(65 * 60_000);
    await f.reconcileOneTime(paid);
    assert.equal(posts().length, 2, 'ten quiet minutes after the last possible send of a generation');
    assert.equal((await f.current()).activeAttemptId, opened.attemptId);
    // A day later the provider still holds nothing: generation 2 under a new key, journalled before the send.
    await sentAgo(24 * 3_600_000);
    await assert.rejects(f.reconcileOneTime(paid), /stripe\.unavailable/);
    assert.equal(posts().at(-1)!.key, `${key}:g2`, 'a key that stored a 5xx replays it: the next generation has its own');
    assert.equal((await journal()).qrSubscriptionGeneration, 2);
    assert.ok(Date.now() - Date.parse((await journal()).qrSubscriptionRequestedAt) < 60_000, 'the generation starts its own hour');
    await assert.rejects(f.reconcileOneTime(paid), /stripe\.unavailable/);
    assert.deepEqual(posts().slice(-2).map(call => call.key), [`${key}:g2`, `${key}:g2`], 'never a second new generation inside seventy minutes');
    // A staff refund request for this payment stops the repair.
    const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: opened.attemptId } });
    const refund = await client.billingOperation.create({ data: { companyId: f.companyId, stripeAccountId: f.account.stripeAccountId, livemode: false, type: 'REFUND',
      state: 'AWAITING_APPROVAL', referenceId: invoice.id, sourceVersion: 0, proposedJson: {}, reason: 'synthetic', initiatorUserId: f.context.userId,
      requestHash: `refund-${f.run}`, expiresAt: new Date(Date.now() + 600_000) } });
    await sentAgo(71 * 60_000);
    await f.reconcileOneTime(paid);
    assert.equal(posts().length, 4, 'nothing is sent while a refund request exists for this payment');
    await client.billingOperation.update({ where: { id: refund.id }, data: { state: 'CANCELLED' } });
    // The provider works again: generation 3 binds and the shop is released.
    f.stripeState.subscriptionError = null;
    await f.reconcileOneTime(paid);
    const account = await f.current(), [sub] = [...f.subscriptions.values()];
    assert.equal(posts().at(-1)!.key, `${key}:g3`);
    assert.deepEqual([f.subscriptions.size, account.baseSubscriptionId, account.activeAttemptId, sub.trial_end],
      [1, sub.id, null, Math.floor(account.paidThrough!.getTime() / 1000)]);
  } finally {
    await f.cleanup(); await client.$disconnect();
  }
});

test('PROMPTPAY_RENEW paid, the provider refuses the subscription: no blind retry, the case waits for staff', { skip: !databaseUrl }, async () => {
  const client = connect(), f = await fixture(client, [{ name: 'งานถูกปฏิเสธ', discountSatang: 10000 }]);
  const posts = () => f.calls.filter(call => call.method === 'POST' && call.path === '/subscriptions');
  try {
    const quoted = await f.quote('PROMPTPAY_RENEW'), opened = await f.checkout(quoted.quoteId, quoted.consentRevision);
    const paid = await f.pay(opened.attemptId, 39900, 'promptpay');
    const key = `mm:${opened.attemptId}:promptpay-renewal`;
    const journal = async () => (await client.billingAttempt.findUniqueOrThrow({ where: { id: opened.attemptId } })).collectionJson as Record<string, any>;
    const sentAgo = async (ms: number) => client.billingAttempt.update({ where: { id: opened.attemptId }, data: {
      collectionJson: { ...await journal(), qrSubscriptionRequestedAt: new Date(Date.now() - ms).toISOString() } } });
    // Not a refusal of this subscription: an idempotency conflict, a credentials problem, a rate limit. No marker; the next generation goes out.
    const retried: [StripeRequestError, RegExp][] = [
      [new StripeRequestError('REJECTED', 'request_rejected', 60, 'idempotency_key_in_use', 'idempotency_error', 409), /stripe\.request_rejected/],
      [new StripeRequestError('REJECTED', 'request_rejected', 60, undefined, 'invalid_request_error', 401), /stripe\.request_rejected/],
      [new StripeRequestError('RETRY', 'rate_limited', 60, 'rate_limit', undefined, 429), /stripe\.rate_limited/]];
    for (const [index, [error, message]] of retried.entries()) {
      f.stripeState.subscriptionError = error;
      if (index) await sentAgo(71 * 60_000);
      await assert.rejects(f.reconcileOneTime(paid), message);
      assert.equal((await journal()).qrSubscriptionRefused, undefined, `HTTP ${error.status} is not a refusal`);
    }
    assert.deepEqual(posts().map(call => call.key), [key, `${key}:g2`, `${key}:g3`]);
    // A 400: the provider refused this request.
    f.stripeState.subscriptionError = new StripeRequestError('REJECTED', 'request_rejected', 60, 'resource_missing', 'invalid_request_error', 400);
    await sentAgo(71 * 60_000);
    await assert.rejects(f.reconcileOneTime(paid), /stripe\.request_rejected/);
    const refused = (await journal()).qrSubscriptionRefused;
    assert.deepEqual([refused?.generation, refused?.status, refused?.code], [4, 400, 'resource_missing']);
    f.stripeState.subscriptionError = null;
    await sentAgo(24 * 3_600_000);
    await assert.rejects(f.reconcileOneTime(paid), /billing\.subscription_binding_refused/);
    assert.equal(posts().length, 4, 'a refusal is never sent again by itself, under any key');
    assert.equal((await f.current()).activeAttemptId, opened.attemptId);
  } finally {
    await f.cleanup(); await client.$disconnect();
  }
});

/**
 * 2026-10-10: the paid period ends and its renewal subscription was never made. Once no send can be in flight the binding is
 * over: the account reads as a paid period with no renewal, the slot is free, and after the period the shop buys again.
 */
test('PROMPTPAY_RENEW paid, never bound, the period reaches its end: the slot is released and the shop can buy again', { skip: !databaseUrl }, async (t) => {
  const client = connect(), f = await fixture(client, [{ name: 'งานสิ้นงวด', discountSatang: 10000 }]);
  t.mock.timers.enable({ apis: ['Date'], now: new Date() });
  try {
    const quoted = await f.quote('PROMPTPAY_RENEW'), opened = await f.checkout(quoted.quoteId, quoted.consentRevision);
    const paid = await f.pay(opened.attemptId, 39900, 'promptpay');
    f.stripeState.subscriptionError = new StripeRequestError('UNKNOWN', 'unavailable', 60, undefined, undefined, 503);
    await assert.rejects(f.reconcileOneTime(paid), /stripe\.unavailable/);
    const paidThrough = (await f.current()).paidThrough!;
    const sentAgo = async (ms: number) => client.billingAttempt.update({ where: { id: opened.attemptId }, data: {
      collectionJson: { qrSubscriptionRequestedAt: new Date(Date.now() - ms).toISOString() } } });
    // Half an hour before the end, a send of five minutes ago may still be in flight: the pass waits as before.
    t.mock.timers.setTime(paidThrough.getTime() - 30 * 60_000);
    await sentAgo(5 * 60_000);
    await assert.rejects(f.reconcileOneTime(paid), /billing\.promptpay_renewal_boundary/);
    assert.equal((await f.current()).activeAttemptId, opened.attemptId);
    // One hour ten after the generation's first send nothing can be in flight: the binding is over, nothing is sent.
    await sentAgo(71 * 60_000);
    await f.reconcileOneTime(paid);
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/subscriptions').length, 1);
    let account = await f.current();
    assert.deepEqual([account.activeAttemptId, account.renewalMode, account.baseSubscriptionId, account.contractAttemptId, account.nextChargeAt, account.paidThrough?.toISOString()],
      [null, 'PROMPTPAY_ONCE', null, opened.attemptId, null, paidThrough.toISOString()], 'a paid period with no renewal, as stored');
    assert.equal((await client.billingAttempt.findUniqueOrThrow({ where: { id: opened.attemptId } })).status, 'COMPLETED');
    assert.equal(await client.auditLog.count({ where: { companyId: f.companyId, action: 'billing.renewal_binding.ended', targetId: opened.attemptId } }), 1);
    let status = await BillingService.prototype.status.call(f.service, f.context);
    assert.deepEqual([status.purchaseSource, status.renewalMode, status.nextChargeAt], ['PAID_CURRENT_MODE', 'PROMPTPAY_ONCE', null]);
    // After the period: a shop whose package ended, and a new purchase is quoted.
    t.mock.timers.setTime(paidThrough.getTime() + 60_000);
    status = await BillingService.prototype.status.call(f.service, f.context);
    assert.deepEqual([status.purchaseSource, status.purchaseBlockCode ?? null], ['PAID_EXPIRED_CURRENT_MODE', null]);
    const again = await f.quote('PROMPTPAY_RENEW');
    assert.equal(again.totalSatang, 49900);
  } finally {
    t.mock.timers.reset();
    await f.cleanup(); await client.$disconnect();
  }
});

/**
 * Owner 2026-10-10, option "ค", second half: the provider refused the renewal, so the system cannot repair it. Staff refund the
 * purchase; a partial refund releases nothing, the full refund ends the package by its own rule and the next pass settles
 * the purchase: slot free, the review case resolved, and the shop buys again.
 */
test('PROMPTPAY_RENEW paid, renewal refused, refunded in full: the package ends by the refund rule, the next pass releases the shop, a new quote is accepted', { skip: !databaseUrl }, async () => {
  const client = connect(), f = await fixture(client, [{ name: 'งานคืนเงิน', discountSatang: 10000 }]);
  const lifecycle = { execute: async (cmd: { companyId: string; targetStatus: string }, tx: any) => tx.company.update({ where: { id: cmd.companyId }, data: { status: cmd.targetStatus } }) };
  try {
    const quoted = await f.quote('PROMPTPAY_RENEW'), opened = await f.checkout(quoted.quoteId, quoted.consentRevision);
    const paid = await f.pay(opened.attemptId, 39900, 'promptpay');
    f.stripeState.subscriptionError = new StripeRequestError('REJECTED', 'request_rejected', 60, 'resource_missing', 'invalid_request_error', 400);
    await assert.rejects(f.reconcileOneTime(paid), /stripe\.request_rejected/);
    f.stripeState.subscriptionError = null;
    const invoice = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: opened.attemptId } });
    const issue = { companyId: f.companyId, stripeAccountId: f.account.stripeAccountId, livemode: false, kind: 'RECONCILIATION_FAILED' as const, referenceId: f.account.id };
    await client.$transaction(tx => detectBillingIssue(tx, issue)); // what the scan opens when the pass fails
    const binding = await unrepairableBinding(client as any, await f.current(), invoice);
    assert.equal(binding?.kind, 'RENEWAL', 'the refund of this purchase is allowed although it holds the slot');
    const end = (requireFullRefund = true) => client.$transaction(tx => endPaidPackage(tx, lifecycle as never, { companyId: f.companyId, accountId: f.account.id, invoiceId: invoice.id,
      requireFullRefund, actorUserId: null, requestId: `end-${f.run}`, reason: 'refunded' }));
    /** The provider's charge after a refund, and the invoice row as the refund's own observation records it. */
    const refunded = async (satang: number) => { f.stripeState.paid.intent.latest_charge.amount_refunded = satang;
      await client.billingInvoice.update({ where: { id: invoice.id }, data: { refundedSatang: satang } }); };

    // A partial refund releases nothing and cannot end the package.
    await refunded(10000);
    assert.equal(await end(), 'BILLING_END_PACKAGE_NOT_REFUNDED');
    await assert.rejects(f.reconcileOneTime(paid), /billing\.subscription_binding_refused/);
    assert.equal((await f.current()).activeAttemptId, opened.attemptId);

    // The full refund: the package ends through the refund's existing rule, then the pass settles the purchase.
    await refunded(39900);
    assert.equal(await end(), null, 'no renewal exists to cancel first, and this purchase is not a pending one to wait for');
    await f.reconcileOneTime(paid);
    const account = await f.current();
    assert.deepEqual([account.activeAttemptId, account.renewalMode, account.baseSubscriptionId, account.contractAttemptId], [null, 'PROMPTPAY_ONCE', null, opened.attemptId]);
    assert.equal(f.calls.filter(call => call.method === 'POST' && call.path === '/subscriptions').length, 1, 'nothing is sent to the provider');
    const audit = await client.auditLog.findFirstOrThrow({ where: { companyId: f.companyId, action: 'billing.renewal_binding.ended', targetId: opened.attemptId } });
    assert.equal((audit.metadataJson as any).reason, 'refunded_in_full');
    assert.equal((await client.billingIssue.findFirstOrThrow({ where: { companyId: f.companyId, kind: 'RECONCILIATION_FAILED', referenceId: f.account.id } })).state, 'RESOLVED');
    assert.equal(await unrepairableBinding(client as any, account, invoice), null);
    const status = await BillingService.prototype.status.call(f.service, f.context);
    assert.deepEqual([status.purchaseSource, status.renewalMode, status.purchaseBlockCode ?? null], ['PAID_EXPIRED_CURRENT_MODE', 'PROMPTPAY_ONCE', null]);
    assert.equal((await f.quote('PROMPTPAY_RENEW')).totalSatang, 49900, 'the shop buys again');
  } finally {
    await f.cleanup(); await client.$disconnect();
  }
});

/**
 * Owner 2026-09-29: a holder with discounts from two events picks the smaller one for this payment; the other stays ISSUED
 * and is the one offered on the next payment. A pick this shop cannot use is refused in plain Thai, never swapped silently.
 */
test('choose which held discount a payment uses: the pick is charged, the other stays for the next payment', { skip: !databaseUrl }, async () => {
  const client = connect(), f = await fixture(client, [{ name: 'event3', discountSatang: 12000 }, { name: 'event2', discountSatang: 1000 }]);
  const [big, small] = f.serials as [string, string];
  try {
    const listed = await BillingService.prototype.status.call(f.service, f.context);
    assert.deepEqual(listed.eventDiscount?.tickets?.map(item => [item.ticketSerial, item.discountSatang]), [[big, 12000], [small, 1000]], 'every usable discount, best first');
    assert.equal(listed.eventDiscount?.ticketSerial, big, 'the default is still the best');

    await assert.rejects(f.quote('CARD_ONCE', { eventDiscountTicketSerial: 'NOTHELD99' }), /SALES_EVENT_TICKET_UNAVAILABLE|Conflict/);
    const picked = await f.quote('CARD_ONCE', { eventDiscountChoice: 'USE', eventDiscountTicketSerial: small });
    assert.deepEqual([picked.eventDiscount?.ticketSerial, picked.eventDiscount?.applied?.totalSatang], [small, 48900]);
    const opened = await f.checkout(picked.quoteId, picked.consentRevision);
    assert.equal(f.sessions.at(-1)!.line_items[0].price_data.unit_amount, 48900);
    assert.deepEqual([(await f.ticket(small)).state, (await f.ticket(big)).state], ['RESERVED', 'ISSUED']);
    await f.reconcileOneTime(await f.pay(opened.attemptId, 48900, 'card'));
    assert.deepEqual([(await f.ticket(small)).state, (await f.ticket(big)).state], ['USED', 'ISSUED']);
    // The used one cannot be picked again here; the other is what the next payment (this shop's next period) is offered.
    await assert.rejects(f.quote('CARD_ONCE', { eventDiscountTicketSerial: small }), /SALES_EVENT_TICKET_UNAVAILABLE|Conflict/);
    const next = await f.quote('CARD_ONCE');
    assert.deepEqual([next.purchase?.kind, next.eventDiscount?.ticketSerial, next.eventDiscount?.applied?.totalSatang], ['REPEAT', big, 37900]);
  } finally {
    await f.cleanup(); await client.$disconnect();
  }
});
