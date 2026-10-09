import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingOffer, BILLING_DRAFT_POLICY, type BillingQuote } from '@watchdog-bms/contracts';
import { paymentCheckoutSnapshot, prepaidCardAuto } from './billing-checkout-mode';
import { eventDiscountAmounts, eventDiscountBasis, eventDiscountCardAuto, eventDiscountCheckoutRule, eventDiscountExpected, eventDiscountPurchase, pickEventDiscount, type EventDiscountSnapshot } from './billing-event-discount.logic';

test('spec §5.1: 499 less 100 in all three tax treatments, whole baht only, never below ฿10 or the full price', () => {
  assert.deepEqual(eventDiscountAmounts(49900, 10000, 'NOT_VAT_REGISTERED'),
    { unitAmountSatang: 39900, subtotalSatang: 39900, taxSatang: 0, totalSatang: 39900, shownDiscountSatang: 10000 });
  assert.deepEqual(eventDiscountAmounts(49900, 10000, 'EXCLUSIVE_VAT_7'),
    { unitAmountSatang: 39900, subtotalSatang: 39900, taxSatang: 2793, totalSatang: 42693, shownDiscountSatang: 10000 });
  assert.deepEqual(eventDiscountAmounts(49900, 10000, 'INCLUSIVE_VAT_7'),
    { unitAmountSatang: 39201, subtotalSatang: 36636, taxSatang: 2565, totalSatang: 39201, shownDiscountSatang: 10699 });
  assert.equal(eventDiscountAmounts(49900, 10050, 'NOT_VAT_REGISTERED'), null, 'satang discounts are refused');
  assert.equal(eventDiscountAmounts(49900, 0, 'NOT_VAT_REGISTERED'), null);
  assert.equal(eventDiscountAmounts(49900, 48900, 'NOT_VAT_REGISTERED')?.unitAmountSatang, 1000, 'exactly ฿10 is allowed');
  assert.equal(eventDiscountAmounts(49900, 49000, 'NOT_VAT_REGISTERED'), null, 'below ฿10 is no discount, not a partial one');
  assert.equal(eventDiscountAmounts(49900, 60000, 'EXCLUSIVE_VAT_7'), null);
});

const quote = (over: Partial<BillingQuote> = {}) => ({ purchaseMode: 'CARD_ONCE', purchase: { kind: 'INITIAL' }, ...over }) as BillingQuote;
test('spec §4.1.1 / SD-O12 / SD-O13: any package payment made in one go, the first bill of a package started in a renewing mode; never a deal', () => {
  for (const kind of ['INITIAL', 'RESTART', 'REPEAT', 'SCHEDULED_CHANGE', 'UPGRADE', 'FULL_PACKAGE_UPGRADE'])
    for (const purchaseMode of ['CARD_ONCE', 'PROMPTPAY_ONCE'] as const)
      assert.equal(eventDiscountPurchase(quote({ purchaseMode, purchase: { kind } as BillingQuote['purchase'] })), true, `${kind} ${purchaseMode}`);
  assert.equal(eventDiscountPurchase(quote({ purchase: { kind: 'ADVANCE_DEAL' } as BillingQuote['purchase'] })), false);
  // SD-O13 (Owner 2026-09-29): a first purchase or a restart pays its first period now; a running subscription's purchases never.
  for (const purchaseMode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) {
    for (const kind of ['INITIAL', 'RESTART'])
      assert.equal(eventDiscountPurchase(quote({ purchaseMode, purchase: { kind } as BillingQuote['purchase'] })), true, `${kind} ${purchaseMode}`);
    for (const kind of ['REPEAT', 'UPGRADE', 'SCHEDULED_CHANGE', 'FULL_PACKAGE_UPGRADE', 'ADVANCE_DEAL'])
      assert.equal(eventDiscountPurchase(quote({ purchaseMode, purchase: { kind } as BillingQuote['purchase'] })), false, `${kind} ${purchaseMode}`);
    assert.equal(eventDiscountPurchase(quote({ purchaseMode, deal: { dealId: 'd', months: 1, description: '', baseLabel: '' } })), false);
  }
  assert.equal(eventDiscountPurchase(quote({ deal: { dealId: 'd', months: 1, description: '', baseLabel: '' } })), false);
});

test('SD-O13: only a CARD_AUTO snapshot that chose USE pays its first period once and binds its subscription afterwards', () => {
  const card = { quote: { purchaseMode: 'CARD_AUTO' as const } };
  assert.equal(eventDiscountCardAuto({ ...card, eventDiscount: { choice: 'USE' } }), true);
  assert.equal(eventDiscountCardAuto({ ...card, eventDiscount: { choice: 'DECLINE' } }), false);
  assert.equal(eventDiscountCardAuto(card), false);
  assert.equal(eventDiscountCardAuto({ quote: { purchaseMode: 'PROMPTPAY_RENEW' }, eventDiscount: { choice: 'USE' } }), false, 'PROMPTPAY_RENEW is a payment Checkout already');
  assert.equal(eventDiscountCardAuto(undefined), false);
});

test('promotion spec §7: a CARD_AUTO promotion purchase is prepaid like the discounted first bill, read from its own snapshot', () => {
  const promotion = { campaignId: 'c' }, auto = { quote: { purchaseMode: 'CARD_AUTO' as const } }, once = { quote: { purchaseMode: 'CARD_ONCE' as const } };
  assert.equal(prepaidCardAuto({ ...auto, promotion }), true);
  assert.equal(paymentCheckoutSnapshot({ ...auto, promotion }), true);
  assert.equal(prepaidCardAuto({ ...auto, promotion, repeat: { subscriptionId: 'sub_1' } }), false, 'a repeat on a live subscription keeps its own path');
  assert.equal(paymentCheckoutSnapshot({ ...auto, promotion, repeat: { subscriptionId: 'sub_1' } }), false);
  // One-time modes and PROMPTPAY_RENEW were payment Checkouts already; a promotion changes nothing there.
  assert.equal(prepaidCardAuto({ ...once, promotion }), false);
  assert.equal(paymentCheckoutSnapshot({ ...once, promotion }), true);
  assert.equal(prepaidCardAuto({ quote: { purchaseMode: 'PROMPTPAY_RENEW' }, promotion }), false);
  assert.equal(paymentCheckoutSnapshot({ quote: { purchaseMode: 'PROMPTPAY_RENEW' }, promotion }), true);
  // Without a promotion every answer is the event-discount one, unchanged.
  assert.equal(prepaidCardAuto(auto), false); assert.equal(paymentCheckoutSnapshot(auto), false);
  assert.equal(prepaidCardAuto({ ...auto, eventDiscount: { choice: 'USE' } }), true);
  assert.equal(paymentCheckoutSnapshot({ ...auto, eventDiscount: { choice: 'USE' } }), true);
  assert.equal(prepaidCardAuto({ ...auto, eventDiscount: { choice: 'USE' }, repeat: {} }), true, 'the event-discount rule is not narrowed');
  assert.equal(prepaidCardAuto({ ...auto, eventDiscount: { choice: 'DECLINE' } }), false);
  assert.equal(paymentCheckoutSnapshot({ ...auto, advanceDeal: {} }), true);
  assert.equal(prepaidCardAuto(undefined), false); assert.equal(prepaidCardAuto(null), false);
});

test('spec §4.3: the card gets the ticket that takes most off it, in scope; ties go to the one expiring first, then id', () => {
  const scope = { tiers: ['BASIC_499'], intervals: ['month'] }, at = (day: number) => new Date(Date.UTC(2026, 9, day));
  const tickets = [
    { id: 'b', discountSatang: 10000, expiresAt: at(20), scopeJson: scope },
    { id: 'a', discountSatang: 10000, expiresAt: at(20), scopeJson: scope },
    { id: 'c', discountSatang: 10000, expiresAt: at(10), scopeJson: scope },
    { id: 'd', discountSatang: 5000, expiresAt: at(1), scopeJson: scope },
    { id: 'e', discountSatang: 20000, expiresAt: at(1), scopeJson: { tiers: ['PRO_999'], intervals: ['month'] } },
  ];
  const offer = billingOffer('BASIC_499', 'month');
  assert.equal(pickEventDiscount(tickets, offer, 'NOT_VAT_REGISTERED')?.ticket.id, 'c');
  assert.equal(pickEventDiscount(tickets.slice(0, 2), offer, 'NOT_VAT_REGISTERED')?.ticket.id, 'a');
  assert.equal(pickEventDiscount(tickets, billingOffer('BASIC_499', 'year'), 'NOT_VAT_REGISTERED'), null, 'yearly is out of scope');
  assert.equal(pickEventDiscount(tickets, billingOffer('PRO_999', 'month'), 'NOT_VAT_REGISTERED')?.ticket.id, 'e');
  // An upgrade: scope from the target offer, the amount off its prorated difference; under ฿10 after it = no discount.
  assert.deepEqual(pickEventDiscount(tickets, billingOffer('PRO_999', 'month'), 'NOT_VAT_REGISTERED', 25000)?.amounts,
    { unitAmountSatang: 5000, subtotalSatang: 5000, taxSatang: 0, totalSatang: 5000, shownDiscountSatang: 20000 });
  assert.equal(pickEventDiscount(tickets, billingOffer('PRO_999', 'month'), 'NOT_VAT_REGISTERED', 20500), null);
});

test('spec §4.3 stale rules: USE reserves, DECLINE never goes stale, a quote that saw no offer goes stale once one exists', () => {
  assert.equal(eventDiscountCheckoutRule({ choice: 'USE' }, false), 'RESERVE');
  assert.equal(eventDiscountCheckoutRule({ choice: 'DECLINE' }, true), 'PROCEED');
  assert.equal(eventDiscountCheckoutRule(undefined, true), 'STALE');
  assert.equal(eventDiscountCheckoutRule(undefined, false), 'PROCEED');
});

test('spec §5.2: the expected first bill comes only from a consistent USE snapshot', () => {
  const offer = billingOffer('BASIC_499', 'month'), amounts = eventDiscountAmounts(offer.priceSatang, 10000, 'NOT_VAT_REGISTERED')!;
  const { shownDiscountSatang, ...applied } = amounts;
  const snapshot = () => ({ quote: quote({ offer }), policy: { ...BILLING_DRAFT_POLICY, taxTreatment: 'NOT_VAT_REGISTERED' as const },
    eventDiscount: { choice: 'USE', ticketSerial: 'ABCD2345', eventName: 'งาน', expiresAt: '2026-11-01T00:00:00.000Z', discountSatang: 10000,
      shownDiscountSatang, applied: { ...applied }, ticketId: 't', ticketVersion: 1, batchId: 'b', salesUserId: 'u' } as EventDiscountSnapshot });
  assert.deepEqual(eventDiscountExpected(snapshot()), amounts);
  const tampered = snapshot(); (tampered.eventDiscount as { applied: { totalSatang: number } }).applied.totalSatang = 100;
  assert.equal(eventDiscountExpected(tampered), null);
  const bigger = snapshot(); (bigger.eventDiscount as { discountSatang: number }).discountSatang = 20000;
  assert.equal(eventDiscountExpected(bigger), null, 'a discount that does not match its own amounts is refused');
  assert.equal(eventDiscountExpected({ ...snapshot(), eventDiscount: { choice: 'DECLINE', offeredTicketId: 't' } }), null);
  // SD-O13: a renewing mode's first bill (INITIAL/RESTART) is discounted like a one-time payment; a running subscription's REPEAT never.
  assert.deepEqual(eventDiscountExpected({ ...snapshot(), quote: quote({ offer, purchaseMode: 'CARD_AUTO' }) }), amounts);
  assert.deepEqual(eventDiscountExpected({ ...snapshot(), quote: quote({ offer, purchaseMode: 'PROMPTPAY_RENEW', purchase: { kind: 'RESTART' } as BillingQuote['purchase'] }) }), amounts);
  assert.equal(eventDiscountExpected({ ...snapshot(), quote: quote({ offer, purchaseMode: 'CARD_AUTO', purchase: { kind: 'REPEAT' } as BillingQuote['purchase'] }) }), null);
  assert.equal(eventDiscountExpected({ ...snapshot(), deal: {} }), null);
  assert.equal(eventDiscountExpected({ ...snapshot(), upgrade: { amountSatang: 20000 } }), null, 'an upgrade source on a non-upgrade quote is refused');
});

test('SD-O12: an UPGRADE takes the discount off its own prorated charge, recomputed from the same basis at Checkout', () => {
  const offer = billingOffer('PRO_999', 'month'), upgrade = { amountSatang: 31000 }, policy = { ...BILLING_DRAFT_POLICY, taxTreatment: 'EXCLUSIVE_VAT_7' as const };
  const upgradeQuote = quote({ offer, purchase: { kind: 'UPGRADE' } as BillingQuote['purchase'] });
  assert.equal(eventDiscountBasis({ quote: upgradeQuote, upgrade }), 31000);
  assert.equal(eventDiscountBasis({ quote: quote({ offer }) }), offer.priceSatang);
  const amounts = eventDiscountAmounts(31000, 10000, 'EXCLUSIVE_VAT_7')!, { shownDiscountSatang, ...applied } = amounts;
  assert.deepEqual(amounts, { unitAmountSatang: 21000, subtotalSatang: 21000, taxSatang: 1470, totalSatang: 22470, shownDiscountSatang: 10000 });
  const eventDiscount = { choice: 'USE', ticketSerial: 'ABCD2345', eventName: 'งาน', expiresAt: '2026-11-01T00:00:00.000Z', discountSatang: 10000,
    shownDiscountSatang, applied, ticketId: 't', ticketVersion: 1, batchId: 'b', salesUserId: 'u' } as EventDiscountSnapshot;
  assert.deepEqual(eventDiscountExpected({ quote: upgradeQuote, policy, upgrade, eventDiscount }), amounts);
  assert.equal(eventDiscountExpected({ quote: upgradeQuote, policy, eventDiscount }), null, 'an UPGRADE without its source has no basis');
  assert.equal(eventDiscountExpected({ quote: upgradeQuote, policy, upgrade: { amountSatang: 32000 }, eventDiscount }), null, 'a different charge does not add up');
});
