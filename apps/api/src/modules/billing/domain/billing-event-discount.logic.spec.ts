import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingOffer, BILLING_DRAFT_POLICY, type BillingQuote } from '@watchdog-bms/contracts';
import { eventDiscountAmounts, eventDiscountCheckoutRule, eventDiscountExpected, eventDiscountPurchase, pickEventDiscount, type EventDiscountSnapshot } from './billing-event-discount.logic';

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
test('spec §4.1.1: first purchases paid in one go only; deals, upgrades, repeats and renewing modes never', () => {
  assert.equal(eventDiscountPurchase(quote()), true);
  assert.equal(eventDiscountPurchase(quote({ purchaseMode: 'PROMPTPAY_ONCE', purchase: { kind: 'RESTART' } as BillingQuote['purchase'] })), true);
  for (const kind of ['REPEAT', 'SCHEDULED_CHANGE', 'UPGRADE', 'FULL_PACKAGE_UPGRADE', 'ADVANCE_DEAL'])
    assert.equal(eventDiscountPurchase(quote({ purchase: { kind } as BillingQuote['purchase'] })), false, kind);
  for (const purchaseMode of ['CARD_AUTO', 'PROMPTPAY_RENEW'] as const) assert.equal(eventDiscountPurchase(quote({ purchaseMode })), false, purchaseMode);
  assert.equal(eventDiscountPurchase(quote({ deal: { dealId: 'd', months: 1, description: '', baseLabel: '' } })), false);
  assert.equal(eventDiscountPurchase(quote({ upgrade: { prorationAt: '', nextRenewalTotalSatang: 0, segments: [] } })), false);
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
  assert.equal(eventDiscountExpected({ ...snapshot(), quote: quote({ offer, purchaseMode: 'CARD_AUTO' }) }), null);
  assert.equal(eventDiscountExpected({ ...snapshot(), deal: {} }), null);
});
