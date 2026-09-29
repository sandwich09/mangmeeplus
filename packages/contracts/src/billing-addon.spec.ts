import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_ACTIONS, BILLING_ADDON_OFFER_KEYS, BILLING_ADDON_OFFERS, BILLING_PRODUCT_KINDS, billingProductKind } from './billing.js';

// Add-on foundation (chat credit and receipt image plan PR A, spec §4 and §17.3).
describe('add-on offer catalog', () => {
  it('is exactly the six Owner-confirmed offers, in integer units of their product', () => {
    assert.deepEqual(Object.keys(BILLING_ADDON_OFFERS), [...BILLING_ADDON_OFFER_KEYS]);
    assert.deepEqual(BILLING_ADDON_OFFERS, {
      CHAT_50: { productKind: 'CHAT_CREDIT', quantityUnits: 5000, unitScale: 100, priceSatang: 29900 },
      CHAT_100: { productKind: 'CHAT_CREDIT', quantityUnits: 10000, unitScale: 100, priceSatang: 54900 },
      CHAT_300: { productKind: 'CHAT_CREDIT', quantityUnits: 30000, unitScale: 100, priceSatang: 149900 },
      RECEIPT_IMAGE_20: { productKind: 'RECEIPT_IMAGE', quantityUnits: 20, unitScale: 1, priceSatang: 34900 },
      RECEIPT_IMAGE_50: { productKind: 'RECEIPT_IMAGE', quantityUnits: 50, unitScale: 1, priceSatang: 79900 },
      RECEIPT_IMAGE_100: { productKind: 'RECEIPT_IMAGE', quantityUnits: 100, unitScale: 1, priceSatang: 149900 },
    });
    for (const offer of Object.values(BILLING_ADDON_OFFERS)) {
      assert.ok(Number.isSafeInteger(offer.quantityUnits) && offer.quantityUnits > 0);
      assert.ok(Number.isSafeInteger(offer.priceSatang) && offer.priceSatang > 0);
      assert.equal(offer.unitScale, offer.productKind === 'CHAT_CREDIT' ? 100 : 1);
    }
  });
});

describe('billingProductKind', () => {
  it('reads an absent kind as PACKAGE, the only kind before add-ons', () => {
    assert.equal(billingProductKind(undefined), 'PACKAGE');
    for (const kind of BILLING_PRODUCT_KINDS) assert.equal(billingProductKind(kind), kind);
  });
  it('never guesses an unknown value', () => {
    for (const value of [null, '', 'package', 'ADD_ON', 'TOP_UP', 1, {}, ['PACKAGE']]) assert.equal(billingProductKind(value), null, JSON.stringify(value));
  });
});

describe('billing gates', () => {
  it('add no add-on gate: an offer sells once its Price is bound (Owner 2026-09-29, no switches)', () => {
    assert.ok(!BILLING_ACTIONS.some(action => action.startsWith('addon')), BILLING_ACTIONS.join(', '));
  });
});
