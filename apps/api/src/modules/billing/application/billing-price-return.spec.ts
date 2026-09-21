/**
 * D-P5-6 — the two pure halves of `SCHEDULE_PRICE_RETURN`: the exact write that reaches Stripe,
 * and the shapes that count as "the shop is back on the catalog price".
 *
 * `observed()` is the operation's only definition of done, so what it REFUSES matters more than
 * what it accepts: every refusal here is a subscription this platform would otherwise call
 * returned while the customer is still being charged the deal price, or while the cycle they
 * already paid for has moved.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceReturnObserved, priceReturnParams, type PriceReturnProposed } from './billing-price-return';
import type { BillingSnapshot } from './billing.service';

const CATALOG = 'price_catalog', DEAL = 'price_deal', ITEM = 'si_1', SUB = 'sub_1';
const RETURN_AT = '2026-12-31T10:00:00.000Z', target = Date.parse(RETURN_AT) / 1000;

const proposed: PriceReturnProposed = {
  accountId: 'acct_1', dealRequestId: 'deal_1', subscriptionId: SUB, subscriptionItemId: ITEM,
  paidThrough: RETURN_AT, sourceHash: 'hash', sourceTermHash: 'term',
  dealPriceId: DEAL, params: {},
  snapshot: { priceId: CATALOG, policy: { taxRateId: 'txr_1' } } as unknown as BillingSnapshot,
};

const sub = (over: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  id: SUB, status: 'active', billing_mode: { type: 'classic' }, collection_method: 'charge_automatically',
  items: { has_more: false, data: [{ id: ITEM, price: CATALOG, quantity: 1, tax_rates: [{ id: 'txr_1' }],
    current_period_end: target, ...item }] },
  ...over,
});

test('the write swaps the price and touches nothing else (D-P5-6)', () => {
  assert.deepEqual(priceReturnParams({ itemId: ITEM, catalogPriceId: CATALOG, taxRateId: 'txr_1' }), {
    // The cycle the customer already paid for must not be re-priced, credited or re-invoiced.
    proration_behavior: 'none',
    // A swap that silently needs a new payment is a failure, not a subscription in limbo.
    payment_behavior: 'error_if_incomplete',
    items: [{ id: ITEM, price: CATALOG, quantity: 1, tax_rates: ['txr_1'] }],
  });
  // No VAT registration, no tax rate on the line — not an empty array Stripe would read as "clear".
  assert.deepEqual(priceReturnParams({ itemId: ITEM, catalogPriceId: CATALOG, taxRateId: null }),
    { proration_behavior: 'none', payment_behavior: 'error_if_incomplete',
      items: [{ id: ITEM, price: CATALOG, quantity: 1 }] });
});

test('"returned" means the catalog price bills the NEXT cycle, and this one is untouched', () => {
  assert.equal(priceReturnObserved(proposed, sub()), true);

  // Still on the deal price: the whole point of the operation has not happened.
  assert.equal(priceReturnObserved(proposed, sub({}, { price: DEAL })), false);
  // The boundary moved, so the customer paid for a period that no longer exists.
  assert.equal(priceReturnObserved(proposed, sub({}, { current_period_end: target + 86400 })), false);
  // A schedule appeared underneath us; its phases, not this item, decide what bills next.
  assert.equal(priceReturnObserved(proposed, sub({ schedule: 'sub_sched_1' })), false);
  // Someone cancelled instead: there is no next cycle to return to.
  assert.equal(priceReturnObserved(proposed, sub({ cancel_at_period_end: true })), false);
  assert.equal(priceReturnObserved(proposed, sub({ cancel_at: target })), false);
  assert.equal(priceReturnObserved(proposed, sub({ status: 'canceled' })), false);
  // Collection was paused or a pending update is queued: the next invoice is not ours to predict.
  assert.equal(priceReturnObserved(proposed, sub({ pause_collection: { behavior: 'void' } })), false);
  assert.equal(priceReturnObserved(proposed, sub({ pending_update: {} })), false);
  // A discount, a second item or a quantity change would make the invoice something else entirely.
  assert.equal(priceReturnObserved(proposed, sub({}, { discounts: [{ id: 'di_1' }] })), false);
  assert.equal(priceReturnObserved(proposed, sub({}, { quantity: 2 })), false);
  assert.equal(priceReturnObserved(proposed, sub({ items: { has_more: true, data: [] } })), false);
  // Tax drifted off the line the policy says every paid line carries.
  assert.equal(priceReturnObserved(proposed, sub({}, { tax_rates: [] })), false);
  assert.equal(priceReturnObserved(proposed, sub({}, { tax_rates: [{ id: 'txr_other' }] })), false);
  // A different subscription or item id is a mapping mistake, never a success.
  assert.equal(priceReturnObserved(proposed, sub({ id: 'sub_2' })), false);
  assert.equal(priceReturnObserved(proposed, sub({}, { id: 'si_2' })), false);
  // Invoiced by hand rather than charged: a QR-billed subscription has no card cycle to swap.
  assert.equal(priceReturnObserved(proposed, sub({ collection_method: 'send_invoice' })), false);
});
