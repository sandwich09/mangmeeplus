import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BILLING_ADDON_OFFER_KEYS, BILLING_DRAFT_POLICY, type BillingPolicy } from '@watchdog-bms/contracts';
import { parseBillingPolicy } from './billing-policy';

// Add-on foundation (chat credit and receipt image plan PR A, A3; spec §8.4, A37). A policy that fails to
// parse leaves the account with no policy at all, which closes every package sale — so both directions matter.
const packages: BillingPolicy = { ...BILLING_DRAFT_POLICY, priceIds: { 'PRO_999:year': 'price_ProYear' }, zeroPriceIds: { 'PRO_999:year': 'price_ZeroProYear' } };
const addOnPriceIds = Object.fromEntries(BILLING_ADDON_OFFER_KEYS.map(key => [key, `price_AddOn${key.replace(/_/g, '')}`]));

test('a policy written before add-ons still parses to itself', () => {
  assert.deepEqual(parseBillingPolicy(BILLING_DRAFT_POLICY), BILLING_DRAFT_POLICY);
  assert.deepEqual(parseBillingPolicy(packages), packages);
  assert.equal('addOnPriceIds' in parseBillingPolicy(packages), false);
});

test('a policy binding add-on Prices keeps every binding, and binding none is allowed', () => {
  assert.deepEqual(parseBillingPolicy({ ...packages, addOnPriceIds }).addOnPriceIds, addOnPriceIds);
  assert.deepEqual(parseBillingPolicy({ ...packages, addOnPriceIds: { CHAT_50: 'price_Chat50' } }).addOnPriceIds, { CHAT_50: 'price_Chat50' });
  assert.deepEqual(parseBillingPolicy({ ...packages, addOnPriceIds: {} }).addOnPriceIds, {});
});

test('an add-on binding must name a known offer and a well-formed Price', () => {
  for (const mapping of [null, [], 'price_Chat50', { CHAT_40: 'price_Chat40' }, { 'PRO_999:year': 'price_Other' }, { CHAT_50: '' },
    { CHAT_50: 'prod_Chat50' }, { CHAT_50: 'price_Chat-50' }, { CHAT_50: 50 }, { CHAT_50: null }])
    assert.throws(() => parseBillingPolicy({ ...packages, addOnPriceIds: mapping }), JSON.stringify(mapping));
});

test('an add-on Price is never shared with another offer, a package Price or a prepaid Price', () => {
  for (const mapping of [{ CHAT_50: 'price_Same', CHAT_100: 'price_Same' }, { RECEIPT_IMAGE_20: 'price_ProYear' }, { CHAT_300: 'price_ZeroProYear' }])
    assert.throws(() => parseBillingPolicy({ ...packages, addOnPriceIds: mapping }), /Invalid add-on price mapping/, JSON.stringify(mapping));
});
