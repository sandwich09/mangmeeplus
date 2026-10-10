import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { billingOffer } from '@watchdog-bms/contracts';
import { eventDiscountOffer, eventDiscountPath, eventDiscountRenewalState, eventDiscountView, holderEventDiscountTickets } from './billing-event-discount';
import { BillingService } from './billing.service';

const now = new Date('2026-10-01T03:00:00.000Z');
const future = new Date('2026-10-31T10:00:00.000Z');

describe('sales-event holder view', () => {
  it('routes every shop that can pay in one go to the discount, an auto-renewing shop to credit (spec §4.1, SD-O12)', () => {
    for (const source of ['NO_TERM', 'TRIAL', 'ADMIN_MANUAL', 'PAID_EXPIRED_CURRENT_MODE'] as const) assert.equal(eventDiscountPath(source), 'DISCOUNT', source);
    for (const mode of ['CARD_ONCE', 'PROMPTPAY_ONCE']) assert.equal(eventDiscountPath('PAID_CURRENT_MODE', mode), 'DISCOUNT', mode);
    for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW', 'NONE', null]) assert.equal(eventDiscountPath('PAID_CURRENT_MODE', mode), 'CREDIT', String(mode));
    for (const source of ['PAID_OTHER_MODE', 'SOURCE_INCONSISTENT'] as const) assert.equal(eventDiscountPath(source, 'CARD_ONCE'), null, source);
  });

  it('lists only tickets of the caller’s ACTIVE LINE identities, with plain states and no LINE ids', async () => {
    const queries: any[] = [];
    const db = {
      externalIdentity: { findMany: async (args: any) => { queries.push(args.where); return [{ providerChannelId: 'ch', providerUserId: 'U1' }]; } },
      salesEventTicket: { findMany: async (args: any) => { queries.push(args.where); return [
        { serial: 'AAAA2222', state: 'ISSUED', expiresAt: future, discountSatang: 10_000, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0,
          batch: { eventName: 'งานหนึ่ง', state: 'SUSPENDED' } },
        { serial: 'BBBB3333', state: 'ISSUED', expiresAt: now, discountSatang: 0, rewardChatCreditUnits: 5_000, rewardReceiptImageUnits: 10,
          batch: { eventName: 'งานสอง', state: 'OPEN' } },
        { serial: 'CCCC4444', state: 'RESERVED', expiresAt: future, discountSatang: 10_000, rewardChatCreditUnits: 0, rewardReceiptImageUnits: 0,
          batch: { eventName: 'งานสาม', state: 'OPEN' } },
      ]; } },
    } as any;
    const tickets = await holderEventDiscountTickets(db, 'user-1', now);
    assert.deepEqual(queries[0], { userId: 'user-1', provider: 'LINE', status: 'ACTIVE' });
    assert.deepEqual(queries[1], { holderProvider: 'LINE', OR: [{ holderChannelId: 'ch', holderProviderUserId: 'U1' }] });
    assert.deepEqual(tickets.map((ticket) => [ticket.serial, ticket.state, ticket.batchSuspended]), [
      ['AAAA2222', 'AVAILABLE', true], ['BBBB3333', 'EXPIRED', false], ['CCCC4444', 'IN_PAYMENT', false],
    ]);
    assert.deepEqual(tickets[1], { serial: 'BBBB3333', eventName: 'งานสอง', discountSatang: 0, chatCreditUnits: 5_000,
      receiptImageUnits: 10, expiresAt: now.toISOString(), state: 'EXPIRED', batchSuspended: false });
  });

  it('LINE read (spec §8.1): the owner-only view, plus why this shop may not take the discount now (SD-O12: per event)', async () => {
    const lineRead = (BillingService.prototype as any).lineEventDiscount;
    const tickets = [{ serial: 'AAAA2222' }];
    const context = { userId: 'user-1', companyId: 'company-1' };
    // `spentOnly`: every ticket the holder has is from an event this shop already took one from.
    const self = (path: string | null, spentOnly: boolean, deal: boolean) => {
      const asked: any[] = [];
      return { asked, eventDiscount: async (ctx: any) => { asked.push(ctx); return { path, tickets }; }, prisma: { client: {
        externalIdentity: { findMany: async () => [{ providerChannelId: 'ch', providerUserId: 'U1' }] },
        salesEventTicket: { findMany: async (args: any) => { asked.push(args.where);
          if (args.where.companyId) return spentOnly ? [{ batch: { eventName: 'งานหนึ่ง' } }] : [];
          return spentOnly === ('in' in args.where.batch.eventName) ? [{ id: 't' }] : []; } },
        packageChangeRequest: { findFirst: async () => deal ? { id: 'd' } : null } } } };
    };
    const starting = self('DISCOUNT', false, false);
    assert.deepEqual(await lineRead.call(starting, context), { path: 'DISCOUNT', tickets, block: null });
    assert.equal(starting.asked[0], context, 'the same owner check as the package page');
    assert.deepEqual(starting.asked[1], { companyId: 'company-1', state: { in: ['RESERVED', 'USED'] } }, 'events this shop took a ticket from, any way');
    assert.equal((await lineRead.call(self('DISCOUNT', true, false), context)).block, 'EVENT_ALREADY_USED');
    assert.equal((await lineRead.call(self('DISCOUNT', false, true), context)).block, 'DEAL_ACTIVE');
    const paying = self('CREDIT', true, true);
    assert.deepEqual(await lineRead.call(paying, context), { path: 'CREDIT', tickets, block: null });
    assert.equal(paying.asked.length, 1, 'an auto-renewing shop reads no discount block');
    const denied = { eventDiscount: async () => { throw new Error('ต้องได้รับสิทธิ์จัดการแพ็กเกจบริษัท'); } };
    await assert.rejects(lineRead.call(denied, context), /สิทธิ์จัดการแพ็กเกจ/);
  });

  // UAT 2026-10-10: LINE told a shop sent a QR bill each period that its card is charged by itself. The read now carries how the shop renews, from the account it already loads (no extra query).
  it('the read says how the shop renews, the way the package status reads it, so each reply can say what is true for that shop', async () => {
    const read = (BillingService.prototype as any).eventDiscount;
    const context = { userId: 'user-1', companyId: 'company-1' };
    // `source` is what purchaseSource decided (it has its own specs); this is only the account → mode reading.
    const self = (account: any, source: string) => { const asked: any[] = []; return { asked, assertOwner: async (ctx: any) => { asked.push(ctx); }, account: async () => account, purchaseSource: async () => source,
      prisma: { client: { company: { findUnique: async () => ({ planTerm: null }) }, externalIdentity: { findMany: async () => [] } } } }; };
    const paid = 'PAID_CURRENT_MODE';
    for (const [account, source, path, mode, state] of [
      [{ renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub_1', subscriptionState: 'active' }, paid, 'CREDIT', 'CARD_AUTO', 'RUNNING'],
      [{ renewalMode: 'PROMPTPAY_RENEW', baseSubscriptionId: 'sub_1', subscriptionState: 'active' }, paid, 'CREDIT', 'PROMPTPAY_RENEW', 'RUNNING'],
      // first QR bill paid, subscription not bound yet: the way it renews is known, that it runs is not
      [{ renewalMode: 'PROMPTPAY_RENEW', baseSubscriptionId: null, subscriptionState: 'NONE' }, paid, 'CREDIT', 'PROMPTPAY_RENEW', undefined],
      // a card subscription whose column still says NONE is a card charged by itself, as status() reads it
      [{ renewalMode: 'NONE', baseSubscriptionId: 'sub_1', subscriptionState: 'active' }, paid, 'CREDIT', 'CARD_AUTO', 'RUNNING'],
      [{ renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub_1', subscriptionState: 'active', cancelAtPeriodEnd: true }, paid, 'CREDIT', 'CARD_AUTO', 'STOPPED'],
      [{ renewalMode: 'PROMPTPAY_RENEW', baseSubscriptionId: 'sub_1', subscriptionState: 'active', graceEndsAt: now }, paid, 'CREDIT', 'PROMPTPAY_RENEW', 'UNPAID'],
      [{ renewalMode: 'NONE', baseSubscriptionId: null }, paid, 'CREDIT', 'NONE', undefined],
      [{ renewalMode: 'CARD_ONCE', baseSubscriptionId: null }, paid, 'DISCOUNT', 'CARD_ONCE', undefined],
      [{ renewalMode: 'PROMPTPAY_RENEW', baseSubscriptionId: null }, 'SOURCE_INCONSISTENT', null, 'PROMPTPAY_RENEW', undefined],
      [null, 'NO_TERM', 'DISCOUNT', undefined, undefined],
    ] as const) {
      const shop = self(account, source), view = await read.call(shop, context);
      assert.deepEqual([view.path, view.renewalMode, view.renewalState, view.tickets, shop.asked], [path, mode, state, [], [context]], JSON.stringify([account, source]));
    }
  });

  // Sales-event spec §8.1, table of 2026-10-10: the card/QR sentence is said only of a renewal that runs. The columns are the ones status() reads for the same shop.
  it('says a renewal runs, is switched off or is unpaid only from the account columns the package page reads, and nothing when they do not settle it', () => {
    const bound = { renewalMode: 'CARD_AUTO', baseSubscriptionId: 'sub_1', subscriptionState: 'active', cancelAtPeriodEnd: false, graceEndsAt: null, collectionPauseJson: null } as const;
    const state = (over: Record<string, unknown> = {}) => eventDiscountRenewalState({ ...bound, ...over } as any);
    for (const mode of ['CARD_AUTO', 'PROMPTPAY_RENEW'])
      for (const subscriptionState of ['active', 'trialing']) assert.equal(state({ renewalMode: mode, subscriptionState }), 'RUNNING', `${mode} ${subscriptionState}`);
    // switched off: cancel at the period end, or a subscription already cancelled; the package still runs, which is what puts the shop on the credit path
    assert.equal(state({ cancelAtPeriodEnd: true }), 'STOPPED');
    for (const subscriptionState of ['canceled', 'incomplete_expired']) assert.equal(state({ subscriptionState }), 'STOPPED', subscriptionState);
    // the charge failed or the bill is overdue (a QR shop stays `active` while its bill is open, so the grace the reconciler sets is what shows it); the stronger fact wins over a switch-off
    for (const subscriptionState of ['past_due', 'unpaid']) assert.equal(state({ subscriptionState }), 'UNPAID', subscriptionState);
    assert.equal(state({ graceEndsAt: now }), 'UNPAID');
    assert.equal(state({ subscriptionState: 'canceled', graceEndsAt: now }), 'UNPAID');
    assert.equal(state({ cancelAtPeriodEnd: true, subscriptionState: 'past_due' }), 'UNPAID');
    // not settled: collection paused, a provider state the page has no word for, no subscription bound yet, no account
    assert.equal(state({ collectionPauseJson: { behavior: 'keep_as_draft', resumesAt: null } }), undefined);
    for (const subscriptionState of ['incomplete', 'paused', 'NONE']) assert.equal(state({ subscriptionState }), undefined, subscriptionState);
    assert.equal(state({ baseSubscriptionId: null }), undefined);
    assert.equal(state({ baseSubscriptionId: null, cancelAtPeriodEnd: true, subscriptionState: 'past_due' }), undefined, 'a switch-off or a failure needs the subscription it is about');
    assert.equal(eventDiscountRenewalState(null), undefined);
  });

  it('Owner 2026-09-29: the view lists every discount usable here, best first, each with its own cards; a quote can take a chosen one', async () => {
    const scope = { tiers: ['BASIC_499', 'PRO_999'], intervals: ['month'] };
    const row = (id: string, serial: string, eventName: string, discountSatang: number, day: number) =>
      ({ id, serial, discountSatang, expiresAt: new Date(Date.UTC(2026, 10, day)), scopeJson: scope, batch: { eventName } });
    // The owner's UAT case: event2 ฿10, event3 ฿120, event4 ฿10 (event4 ends first); event3 was the only one shown before.
    const held = [row('a', 'EVT2AAAA', 'event2', 1000, 20), row('b', 'EVT3BBBB', 'event3', 12000, 20), row('c', 'EVT4CCCC', 'event4', 1000, 10)];
    const db = { externalIdentity: { findMany: async () => [{ providerChannelId: 'ch', providerUserId: 'U1' }] },
      salesEventTicket: { findMany: async (args: any) => args.where.companyId ? [] : held },
      packageChangeRequest: { findFirst: async () => null } } as any;
    const input = { userId: 'user-1', companyId: 'company-1', tax: 'NOT_VAT_REGISTERED' as const, now };
    const view = await eventDiscountView(db, { ...input, offers: [billingOffer('BASIC_499', 'month'), billingOffer('BASIC_499', 'year')] });
    assert.equal(view?.ticketSerial, 'EVT3BBBB', 'the default is still the best');
    assert.deepEqual(view?.tickets?.map(ticket => [ticket.eventName, ticket.discountSatang, ticket.offers.map(card => `${card.offerKey}:${card.interval}:${card.shownDiscountSatang}`)]), [
      ['event3', 12000, ['BASIC_499:month:12000']], ['event4', 1000, ['BASIC_499:month:1000']], ['event2', 1000, ['BASIC_499:month:1000']]]);
    // A chosen serial narrows the quote's pick to that ticket; one this shop cannot use gives nothing, so the quote refuses it.
    const offer = billingOffer('BASIC_499', 'month');
    assert.equal((await eventDiscountOffer(db, { ...input, offer }))?.ticket.serial, 'EVT3BBBB');
    assert.equal((await eventDiscountOffer(db, { ...input, offer, serial: 'EVT2AAAA' }))?.amounts.totalSatang, 48900);
    assert.equal(await eventDiscountOffer(db, { ...input, offer, serial: 'NOTHELD1' }), null);
    assert.equal(await eventDiscountOffer(db, { ...input, offer: billingOffer('BASIC_499', 'year'), serial: 'EVT2AAAA' }), null, 'out of scope for this card');
  });

  it('reads no tickets for a login with no LINE linked', async () => {
    const db = { externalIdentity: { findMany: async () => [] },
      salesEventTicket: { findMany: async () => { throw new Error('must not query tickets'); } } } as any;
    assert.deepEqual(await holderEventDiscountTickets(db, 'user-1', now), []);
  });
});
