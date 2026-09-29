import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaPg } from '@prisma/adapter-pg';
import { BILLING_ACTIONS, BILLING_DRAFT_POLICY, billingOffer, type BillingPurchaseMode } from '@watchdog-bms/contracts';
import { PrismaClient } from '../../generated/prisma/client';
import { BillingService } from './application/billing.service';
import { BillingReconcilerService } from './application/billing-reconciler.service';
import { StripeRequestError } from './infrastructure/stripe.client';
import { eventDiscountOffer, eventDiscountView, releaseEventDiscount, reserveEventDiscount, useEventDiscount } from './application/billing-event-discount';
import type { EventDiscountSnapshot } from './domain/billing-event-discount.logic';

const databaseUrl = process.env.BILLING_EVENT_DISCOUNT_TEST_DATABASE_URL;

/**
 * Sales-event spec §4.2, §4.3, §6.3, §6.4 against real Postgres: the holder match, the choice of ticket, the version fence,
 * one discount per shop for its lifetime (partial unique), use on paid, release with every link cleared (CHECK), and the
 * deal, suspended-batch and expiry exclusions.
 */
test('first-bill discount: offer, reserve, use and release keep one discount per shop and one way per ticket', { skip: !databaseUrl }, async () => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(databaseUrl!).hostname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const run = randomUUID().slice(0, 8), now = new Date(), later = new Date(now.getTime() + 30 * 86_400_000);
  const shopA = `sd-shop-a-${run}`, shopB = `sd-shop-b-${run}`, holder = `sd-holder-${run}`, stranger = `sd-stranger-${run}`;
  const tax = 'NOT_VAT_REGISTERED' as const, basic = billingOffer('BASIC_499', 'month'), offers = [basic, billingOffer('BASIC_499', 'year'), billingOffer('PRO_999', 'month')];
  const address = { line1: '99 ถนนทดสอบ', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' };
  const batch = (name: string, discountSatang: number) => client.salesEventBatch.create({ data: { eventName: `งาน ${name} ${run}`, batchName: name,
    discountSatang, issueCap: 10, issuedCount: 1, claimStartsAt: new Date(now.getTime() - 3_600_000), claimEndsAt: new Date(now.getTime() + 3_600_000),
    scopeJson: { tiers: ['BASIC_499', 'PRO_999'], intervals: ['month'] }, createdByUserId: `lead-${run}` } });
  const ticket = (batchId: string, serial: string, discountSatang: number, lineUser = `U${run}`) => client.salesEventTicket.create({ data: {
    serial: `${serial}${run}`.slice(0, 16), batchId, batchRevision: 1, salesUserId: `seller-${run}`, holderChannelId: `ch-${run}`, holderProviderUserId: lineUser,
    discountSatang, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0, scopeJson: { tiers: ['BASIC_499', 'PRO_999'], intervals: ['month'] },
    expiresAt: later, claimRequestKey: `claim-${serial}-${run}` } });
  const use = (row: { id: string; version: number; discountSatang: number }): Extract<EventDiscountSnapshot, { choice: 'USE' }> => ({ choice: 'USE',
    ticketSerial: 's', eventName: 'e', expiresAt: later.toISOString(), discountSatang: row.discountSatang, shownDiscountSatang: row.discountSatang,
    applied: { unitAmountSatang: 0, subtotalSatang: 0, taxSatang: 0, totalSatang: 0 }, ticketId: row.id, ticketVersion: row.version, batchId: 'b', salesUserId: 's' });
  const batchIds: string[] = [], third = `sd-shop-c-${run}`;
  try {
    for (const id of [shopA, shopB]) await client.company.create({ data: { id, name: `Synthetic ${id}`, addressJson: address } });
    for (const id of [holder, stranger]) await client.user.create({ data: { id, displayName: id, email: `${id}@example.test` } });
    await client.externalIdentity.create({ data: { userId: holder, provider: 'LINE', providerChannelId: `ch-${run}`, providerUserId: `U${run}` } });
    const first = await batch('first', 10000), second = await batch('second', 5000);
    batchIds.push(first.id, second.id);
    let big = await ticket(first.id, 'BIG', 10000), small = await ticket(second.id, 'SML', 5000);

    // Offer: only the holder's own LINE identity, only cards in scope, the ticket that takes most off.
    const offer = await eventDiscountOffer(client, { userId: holder, companyId: shopA, offer: basic, tax, now });
    assert.equal(offer?.ticket.id, big.id); assert.equal(offer?.amounts.totalSatang, 39900); assert.equal(offer?.ticket.batch.eventName, first.eventName);
    assert.equal(await eventDiscountOffer(client, { userId: stranger, companyId: shopA, offer: basic, tax, now }), null, 'another user never sees it');
    assert.equal(await eventDiscountOffer(client, { userId: holder, companyId: shopA, offer: billingOffer('BASIC_499', 'year'), tax, now }), null, 'yearly is out of scope');
    const view = await eventDiscountView(client, { userId: holder, companyId: shopA, offers, tax, now });
    assert.equal(view?.reason, null); assert.equal(view?.ticketSerial, big.serial);
    assert.deepEqual(view?.offers.map(item => `${item.offerKey}:${item.interval}:${item.shownDiscountSatang}`), ['BASIC_499:month:10000', 'PRO_999:month:10000']);

    // Reserve ISSUED → RESERVED for shop A; the version fence refuses the same quote for shop B.
    assert.equal(await reserveEventDiscount(client, use(big), { userId: holder, companyId: shopA, attemptId: `attempt-a-${run}`, now }), true);
    const reserved = await client.salesEventTicket.findUniqueOrThrow({ where: { id: big.id } });
    assert.deepEqual([reserved.state, reserved.redeemedAs, reserved.companyId, reserved.attemptId, reserved.appliedDiscountSatang, reserved.version],
      ['RESERVED', 'DISCOUNT', shopA, `attempt-a-${run}`, 10000, 2]);
    assert.equal(await reserveEventDiscount(client, use(big), { userId: holder, companyId: shopB, attemptId: `attempt-b-${run}`, now }), false);
    assert.equal(await reserveEventDiscount(client, use(big), { userId: stranger, companyId: shopB, attemptId: `attempt-b-${run}`, now }), false);

    // One discount per shop: the holder's other ticket is not offered to shop A, cannot be reserved there, and the
    // partial unique index refuses a direct write even if the application check were skipped.
    assert.equal(await eventDiscountOffer(client, { userId: holder, companyId: shopA, offer: basic, tax, now }), null);
    assert.equal((await eventDiscountView(client, { userId: holder, companyId: shopA, offers, tax, now }))?.reason, 'COMPANY_ALREADY_USED');
    assert.equal(await reserveEventDiscount(client, use(small), { userId: holder, companyId: shopA, attemptId: `attempt-a2-${run}`, now }), false);
    await assert.rejects(client.salesEventTicket.update({ where: { id: small.id }, data: { state: 'RESERVED', redeemedAs: 'DISCOUNT', companyId: shopA, attemptId: `attempt-raw-${run}` } }));
    assert.equal((await eventDiscountOffer(client, { userId: holder, companyId: shopB, offer: basic, tax, now }))?.ticket.id, small.id, 'shop B still may use the other one');

    // Release: back to ISSUED with every link cleared (the state CHECK would refuse anything else), offered again.
    await releaseEventDiscount(client, `attempt-a-${run}`);
    big = await client.salesEventTicket.findUniqueOrThrow({ where: { id: big.id } });
    assert.deepEqual([big.state, big.redeemedAs, big.companyId, big.attemptId, big.appliedDiscountSatang, big.reservedAt, big.version],
      ['ISSUED', null, null, null, null, null, 3]);
    assert.equal((await eventDiscountOffer(client, { userId: holder, companyId: shopA, offer: basic, tax, now }))?.ticket.id, big.id);

    // Paid: RESERVED → USED on the invoice; a replay agrees, another attempt does not.
    assert.equal(await reserveEventDiscount(client, use(big), { userId: holder, companyId: shopA, attemptId: `attempt-a3-${run}`, now }), true);
    assert.equal(await useEventDiscount(client, { attemptId: `attempt-a3-${run}`, invoiceId: `invoice-a3-${run}`, companyId: shopA, now }), true);
    assert.equal(await useEventDiscount(client, { attemptId: `attempt-a3-${run}`, invoiceId: `invoice-a3-${run}`, companyId: shopA, now }), true);
    assert.equal(await useEventDiscount(client, { attemptId: `attempt-other-${run}`, invoiceId: `invoice-other-${run}`, companyId: shopA, now }), false);
    await releaseEventDiscount(client, `attempt-a3-${run}`);
    const used = await client.salesEventTicket.findUniqueOrThrow({ where: { id: big.id } });
    assert.deepEqual([used.state, used.redeemedAs, used.invoiceId], ['USED', 'DISCOUNT', `invoice-a3-${run}`], 'a used ticket is never released');

    // A deal in force offers nothing and says why (spec §4.2); a suspended batch and an expired ticket offer nothing.
    await client.packageChangeRequest.create({ data: { companyId: shopB, requestedByUserId: holder, requestedTierKey: 'BASIC_499', kind: 'SALES_DEAL',
      status: 'APPROVED', offerExpiresAt: later } });
    assert.equal(await eventDiscountOffer(client, { userId: holder, companyId: shopB, offer: basic, tax, now }), null);
    assert.equal((await eventDiscountView(client, { userId: holder, companyId: shopB, offers, tax, now }))?.reason, 'DEAL_ACTIVE');
    await client.company.create({ data: { id: third, name: 'Synthetic third', addressJson: address } });
    assert.equal((await eventDiscountOffer(client, { userId: holder, companyId: third, offer: basic, tax, now }))?.ticket.id, small.id);
    await client.salesEventBatch.update({ where: { id: second.id }, data: { state: 'SUSPENDED' } });
    assert.equal(await eventDiscountOffer(client, { userId: holder, companyId: third, offer: basic, tax, now }), null, 'suspended batch');
    await client.salesEventBatch.update({ where: { id: second.id }, data: { state: 'OPEN' } });
    small = await client.salesEventTicket.update({ where: { id: small.id }, data: { expiresAt: new Date(now.getTime() - 1000) } });
    assert.equal(await eventDiscountView(client, { userId: holder, companyId: third, offers, tax, now }), undefined, 'expired ticket');
  } finally {
    await client.packageChangeRequest.deleteMany({ where: { companyId: { in: [shopA, shopB] } } });
    await client.salesEventTicket.deleteMany({ where: { batchId: { in: batchIds } } });
    await client.salesEventBatch.deleteMany({ where: { id: { in: batchIds } } });
    await client.externalIdentity.deleteMany({ where: { userId: holder } });
    await client.user.deleteMany({ where: { id: { in: [holder, stranger] } } });
    await client.company.deleteMany({ where: { id: { in: [shopA, shopB, third] } } });
    await client.$disconnect();
  }
});

/**
 * The purchase path end to end up to Stripe, through the real quote and Checkout code: "ใช้" by default with the quote's
 * totals kept at full price, the discounted unit amount sent to Checkout, a declined quote that never goes stale, a quote
 * that saw no offer going stale once one exists, the version fence rolling the attempt back, and a refused Checkout
 * releasing the reservation it made.
 */
test('first-bill discount through quote and Checkout: choice, reservation, stale rules and release', { skip: !databaseUrl }, async () => {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(databaseUrl!).hostname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const run = randomUUID().replaceAll('-', '').slice(0, 12), stripeAccountId = `acct_${run}`, owner = `sd-owner-${run}`;
  const shops = [`sd-quote-a-${run}`, `sd-quote-b-${run}`], address = { line1: '99 ถนนทดสอบ', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110' };
  const policy = { ...BILLING_DRAFT_POLICY, portalConfigurationId: 'bpc_synthetic', priceIds: {
    'STARTER_249:month': 'price_StarterMonth', 'STARTER_249:year': 'price_StarterYear', 'BASIC_499:month': 'price_BasicMonth', 'BASIC_499:year': 'price_BasicYear',
    'PRO_999:month': 'price_ProMonth', 'PRO_999:year': 'price_ProYear', 'ENTERPRISE_1999:month': 'price_EntMonth', 'ENTERPRISE_1999:year': 'price_EntYear' } };
  const state = { policy, revision: { id: 'synthetic-revision' }, settings: { version: 1 }, gates: Object.fromEntries(BILLING_ACTIONS.map(action => [action, true])) };
  const customers = new Map<string, Record<string, unknown>>(), sessions: Record<string, any>[] = [];
  let paid: Record<string, any> = {};
  let probe: null | (() => Promise<void>) = null;
  const stripe = { enabled: true, accountId: stripeAccountId, livemode: false,
    assertAccount: async () => { const check = probe; probe = null; if (check) await check(); },
    request: async (method: string, path: string, params?: any): Promise<any> => {
      if (path.startsWith('/prices/')) return { id: path.slice(8), object: 'price', livemode: false, active: true, type: 'recurring', product: 'prod_Synthetic',
        currency: 'thb', unit_amount: 49900, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, billing_scheme: 'per_unit' };
      if (path.startsWith('/customers/')) {
        const id = path.slice(11), account = await client.billingAccount.findFirstOrThrow({ where: { customerId: id } });
        if (method === 'POST') customers.set(id, params);
        return { id, metadata: { billingAccountId: account.id }, ...customers.get(id) };
      }
      if (path.startsWith('/payment_intents/')) return paid.intent;
      if (method === 'POST' && path === '/checkout/sessions') {
        sessions.push(params);
        return { id: `cs_${run}${sessions.length}`, object: 'checkout.session', livemode: false, mode: params.mode, client_reference_id: params.client_reference_id,
          customer: params.customer, metadata: params.metadata, url: `https://checkout.stripe.com/c/pay/cs_${run}${sessions.length}` };
      }
      throw new Error(`unmocked Stripe request ${method} ${path}`);
    },
    list: async (path: string) => path === '/invoice_payments' ? paid.payments ?? [] : path.endsWith('/line_items') ? paid.checkoutLines ?? []
      : path.endsWith('/lines') ? paid.invoiceLines ?? [] : [] };
  const service = { prisma: { client }, config: { stripeAccountId, sesWebBaseUrl: 'https://app.example.test' }, stripe,
    assertOwner: async () => {}, assertTaxSettings: async () => {}, settings: async () => state,
    account: (id: string, tx = client) => tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: { companyId: id, stripeAccountId, livemode: false } } }),
    purchaseSource: (company: Parameters<BillingService['purchaseSource']>[0], current: Parameters<BillingService['purchaseSource']>[1], tx = client) =>
      BillingService.prototype.purchaseSource.call({ prisma: { client }, stripe } as unknown as BillingService, company, current, tx),
    usage: async () => ({ used: 0, limit: null, remaining: null, resetsAt: null, cadence: 'PAID_GRANTS', expiresAt: null }),
  } as unknown as BillingService;
  const quote = (companyId: string, eventDiscountChoice?: 'USE' | 'DECLINE', purchaseMode: BillingPurchaseMode = 'CARD_ONCE') =>
    BillingService.prototype.quote.call(service, { companyId, userId: owner, requestId: run } as any, { offerKey: 'BASIC_499', interval: 'month', purchaseMode, eventDiscountChoice });
  let keys = 0;
  const checkout = (companyId: string, quoteId: string, consentRevision: string) => BillingService.prototype.checkout.call(service, { companyId, userId: owner, requestId: run } as any,
    { quoteId, consentRevision, accepted: true, channel: 'web' }, `sd-idem-${run}-${++keys}`);
  let batchId = '', ticketId = '';
  try {
    await client.user.create({ data: { id: owner, displayName: 'Synthetic holder', email: `${owner}@example.test`, emailVerifiedAt: new Date() } });
    await client.externalIdentity.create({ data: { userId: owner, provider: 'LINE', providerChannelId: `ch-${run}`, providerUserId: `U${run}` } });
    for (const [index, id] of shops.entries()) {
      await client.company.create({ data: { id, name: `Synthetic quote ${index}`, addressJson: address } });
      await client.billingAccount.create({ data: { companyId: id, stripeAccountId, livemode: false, customerId: `cus_${run}${index}` } });
    }
    const batch = await client.salesEventBatch.create({ data: { eventName: `งานเปิดร้าน ${run}`, batchName: 'booth', discountSatang: 10000, issueCap: 5, issuedCount: 1,
      claimStartsAt: new Date(Date.now() - 3_600_000), claimEndsAt: new Date(Date.now() + 3_600_000), scopeJson: { tiers: ['BASIC_499'], intervals: ['month'] }, createdByUserId: `lead-${run}` } });
    batchId = batch.id;
    ticketId = (await client.salesEventTicket.create({ data: { serial: `Q${run}`, batchId, batchRevision: 1, salesUserId: `seller-${run}`, holderChannelId: `ch-${run}`,
      holderProviderUserId: `U${run}`, discountSatang: 10000, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0, scopeJson: { tiers: ['BASIC_499'], intervals: ['month'] },
      expiresAt: new Date(Date.now() + 30 * 86_400_000), claimRequestKey: `claim-${run}` } })).id;
    const ticket = () => client.salesEventTicket.findUniqueOrThrow({ where: { id: ticketId } });

    // Renewing modes carry no offer today, and the quote does not error because of it.
    assert.equal((await quote(shops[0]!, undefined, 'CARD_AUTO')).eventDiscount, undefined);

    // DECLINE: full price, the offer kept for the confirm step, Checkout at full price, the ticket untouched.
    const declined = await quote(shops[0]!, 'DECLINE');
    assert.equal(declined.eventDiscount?.choice, 'DECLINE'); assert.equal(declined.eventDiscount?.applied, undefined); assert.equal(declined.totalSatang, 49900);
    const declinedResult = await checkout(shops[0]!, declined.quoteId, declined.consentRevision);
    assert.equal(declinedResult.state, 'OPEN'); assert.equal(sessions.at(-1)!.line_items[0].price_data.unit_amount, 49900);
    assert.equal((await ticket()).state, 'ISSUED', 'declining keeps the ticket');

    // No offer at quote (batch suspended), one at Checkout: stale, so the buyer gets to choose; nothing is left behind.
    await client.salesEventBatch.update({ where: { id: batchId }, data: { state: 'SUSPENDED' } });
    const blind = await quote(shops[1]!);
    assert.equal(blind.eventDiscount, undefined);
    await client.salesEventBatch.update({ where: { id: batchId }, data: { state: 'OPEN' } });
    await assert.rejects(checkout(shops[1]!, blind.quoteId, blind.consentRevision), /BILLING_QUOTE_STALE|Conflict/);

    // USE by default: the first bill is lower, the quote's own totals stay the renewal (full) price.
    const chosen = await quote(shops[1]!);
    assert.equal(chosen.eventDiscount?.choice, 'USE'); assert.equal(chosen.totalSatang, 49900);
    assert.deepEqual(chosen.eventDiscount?.applied, { unitAmountSatang: 39900, subtotalSatang: 39900, taxSatang: 0, totalSatang: 39900 });
    assert.equal(chosen.eventDiscount?.shownDiscountSatang, 10000); assert.equal(chosen.eventDiscount?.eventName, batch.eventName);

    // The version fence: a ticket changed since the quote makes Checkout stale and rolls the attempt back.
    await client.salesEventTicket.update({ where: { id: ticketId }, data: { version: { increment: 1 } } });
    await assert.rejects(checkout(shops[1]!, chosen.quoteId, chosen.consentRevision), /BILLING_QUOTE_STALE|Conflict/);
    assert.equal(await client.billingAttempt.count({ where: { quoteId: chosen.quoteId } }), 0);
    assert.equal((await service.account(shops[1]!))?.activeAttemptId, null);

    // A Checkout refused before Stripe: reserved inside the Checkout transaction, released with the FAILED attempt.
    const refused = await quote(shops[1]!);
    let seen = '';
    probe = async () => { seen = (await ticket()).state; throw new StripeRequestError('REJECTED', 'synthetic_refusal'); };
    const refusedResult = await checkout(shops[1]!, refused.quoteId, refused.consentRevision);
    assert.equal(refusedResult.state, 'FAILED'); assert.equal(seen, 'RESERVED');
    const released = await ticket();
    assert.deepEqual([released.state, released.companyId, released.attemptId, released.redeemedAs], ['ISSUED', null, null, null]);

    // The real one: reserved for this attempt and shop, Stripe asked for the discounted unit amount.
    const payable = await quote(shops[1]!);
    const opened = await checkout(shops[1]!, payable.quoteId, payable.consentRevision);
    assert.equal(opened.state, 'OPEN'); assert.equal(sessions.at(-1)!.line_items[0].price_data.unit_amount, 39900);
    const reserved = await ticket();
    assert.deepEqual([reserved.state, reserved.redeemedAs, reserved.companyId, reserved.attemptId, reserved.appliedDiscountSatang],
      ['RESERVED', 'DISCOUNT', shops[1], opened.attemptId, 10000]);

    // Paid at the discounted amount: the proof passes, the package applies with full rights, and the ticket is USED on that invoice.
    const attempt = await client.billingAttempt.findUniqueOrThrow({ where: { id: opened.attemptId } });
    const lease = `lease-${run}`, amount = 39900, created = Math.floor(Date.now() / 1000) - 60, customerId = `cus_${run}1`;
    const account = await client.billingAccount.update({ where: { companyId_stripeAccountId_livemode: { companyId: shops[1]!, stripeAccountId, livemode: false } },
      data: { leaseToken: lease, leaseUntil: new Date(Date.now() + 120_000) } });
    const meta = { billingAttemptId: attempt.id, billingAccountId: account.id };
    const charge = { id: `ch_${run}`, livemode: false, status: 'succeeded', paid: true, captured: true, currency: 'thb', amount, customer: customerId,
      payment_intent: `pi_${run}`, payment_method_details: { type: 'card' }, amount_refunded: 0, disputed: false, balance_transaction: null };
    paid = { intent: { id: `pi_${run}`, livemode: false, status: 'succeeded', currency: 'thb', amount_received: amount, customer: customerId, latest_charge: charge },
      payments: [{ object: 'invoice_payment', livemode: false, status: 'paid', invoice: `in_${run}`, payment: { type: 'payment_intent', payment_intent: `pi_${run}` }, amount_paid: amount, currency: 'thb' }],
      checkoutLines: [{ quantity: 1, currency: 'thb', amount_total: amount, amount_tax: 0, amount_discount: 0,
        price: { id: `price_inline${run}`, product: 'prod_Synthetic', type: 'one_time', active: false, recurring: null, livemode: false, currency: 'thb', unit_amount: amount } }],
      invoiceLines: [{ parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: `ii_${run}`, subscription: null, proration: false } },
        pricing: { price_details: { price: `price_inline${run}`, product: 'prod_Synthetic' } }, amount, currency: 'thb', livemode: false, quantity: 1 }] };
    const session = { id: attempt.checkoutSessionId, object: 'checkout.session', livemode: false, mode: 'payment', status: 'complete', payment_status: 'paid',
      subscription: null, customer: customerId, client_reference_id: attempt.id, metadata: meta, invoice: `in_${run}`, payment_intent: `pi_${run}`,
      invoice_creation: { enabled: true }, currency: 'thb', amount_total: amount, total_details: { amount_tax: 0, amount_discount: 0, amount_shipping: 0 }, created,
      customer_details: { email: `${owner}@example.test` } };
    const invoice = { id: `in_${run}`, object: 'invoice', livemode: false, customer: customerId, metadata: meta, status: 'paid', billing_reason: 'manual',
      collection_method: 'send_invoice', parent: null, currency: 'thb', total: amount, amount_paid: amount, amount_remaining: 0, starting_balance: 0,
      status_transitions: { paid_at: created + 3 }, number: `SD-${run}` };
    const reconciler = new BillingReconcilerService({ client } as any, {} as any, stripe as any, service, {} as any);
    await (reconciler as any).reconcileOneTime(account, attempt, lease, undefined, session, invoice);
    const row = await client.billingInvoice.findUniqueOrThrow({ where: { sourceAttemptId: attempt.id } });
    assert.deepEqual([row.totalSatang, row.paidSatang, row.applyStatus], [39900, 39900, 'APPLIED']);
    const usedTicket = await ticket();
    assert.deepEqual([usedTicket.state, usedTicket.redeemedAs, usedTicket.companyId, usedTicket.invoiceId], ['USED', 'DISCOUNT', shops[1], row.id]);
    const after = await client.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.deepEqual([after.activeAttemptId, after.renewalMode, after.contractAttemptId], [null, 'CARD_ONCE', attempt.id]);
    assert.equal((await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId: shops[1]! } })).tierKey, 'BASIC_499', 'rights come from the offer, not the money');
    assert.equal(await client.billingIssue.count({ where: { companyId: shops[1]!, kind: 'EVENT_DISCOUNT_REVIEW' } }), 0);
  } finally {
    const accounts = (await client.billingAccount.findMany({ where: { companyId: { in: shops } }, select: { id: true } })).map(row => row.id);
    const cleanup: (() => Promise<unknown>)[] = [
      () => client.billingAccount.updateMany({ where: { companyId: { in: shops } }, data: { activeAttemptId: null, contractAttemptId: null } }),
      ...(batchId ? [() => client.salesEventTicket.deleteMany({ where: { batchId } }), () => client.salesEventBatch.deleteMany({ where: { id: batchId } })] : []),
      ...['outboxEvent', 'auditLog', 'billingIssue', 'entitlementCommand', 'entitlementTransition', 'runoffSnapshot', 'companyFeatureEntitlement',
        'companyEntitlementNormalization', 'companyEntitlementSet', 'salesAttribution', 'billingOperation', 'billingReceiptGrant', 'billingQuote']
        .map(model => () => (client as any)[model].deleteMany({ where: { companyId: { in: shops } } })),
      () => client.billingAttempt.deleteMany({ where: { billingAccountId: { in: accounts } } }),
      () => client.billingInvoice.deleteMany({ where: { billingAccountId: { in: accounts } } }),
      () => client.companyPlanTerm.deleteMany({ where: { companyId: { in: shops } } }),
      () => client.billingAccount.deleteMany({ where: { companyId: { in: shops } } }),
      () => client.externalIdentity.deleteMany({ where: { userId: owner } }),
      () => client.company.deleteMany({ where: { id: { in: shops } } }),
      () => client.user.deleteMany({ where: { id: owner } }),
    ];
    for (const step of cleanup) await step().catch(() => undefined);
    await client.$disconnect();
  }
});
