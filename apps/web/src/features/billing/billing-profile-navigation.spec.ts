import { it } from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_PAID_TIERS } from '@watchdog-bms/contracts';
import { billingProfileHref, billingProfileReturnHref, billingProfileSelection } from './billing-profile-navigation';

it('returns to the same company and selected paid package, never to an arbitrary URL or automatic checkout', () => {
  const href = billingProfileHref('company/a', { offer: 'PRO_999', interval: 'year', channel: 'line' });
  const search = new URL(href, 'https://local.test').search;
  assert.equal(billingProfileReturnHref('company/a', search), '/companies/company%2Fa/billing?offer=PRO_999&interval=year&channel=line&profile=updated');
  assert.equal(billingProfileReturnHref('a', '?returnTo=https://evil.test&offer=PRO_999&interval=year'), null);
  // The detour carries exactly the paid tiers the catalog sells — ENTERPRISE joined them in Phase 6
  // — and nothing else, so this follows the contract rather than a snapshot of it.
  for (const tier of BILLING_PAID_TIERS) assert.equal(billingProfileSelection(`?offer=${tier}&interval=year`)?.offer, tier);
  assert.equal(billingProfileSelection('?offer=NOT_A_TIER&interval=year'), null);
  assert.equal(billingProfileSelection('?offer=PRO_999&interval=monthly'), null);
  assert.equal(billingProfileSelection('?offer=PRO_999&interval=year&channel=https://evil.test')?.channel, 'web');
  const once = billingProfileHref('company/a', { offer: 'PRO_999', interval: 'month', channel: 'web', purchaseMode: 'CARD_ONCE' });
  assert.equal(billingProfileReturnHref('company/a', new URL(once, 'https://local.test').search),
    '/companies/company%2Fa/billing?offer=PRO_999&interval=month&channel=web&purchaseMode=CARD_ONCE&profile=updated');
  assert.equal(billingProfileSelection('?offer=PRO_999&interval=month&purchaseMode=INVALID')?.purchaseMode, undefined);
  const full = billingProfileHref('c1', { offer: 'BASIC_499', interval: 'month', channel: 'web', purchaseMode: 'CARD_ONCE', purchaseIntent: 'FULL_PACKAGE' });
  assert.equal(billingProfileSelection(new URL(full, 'https://local.test').search)?.purchaseIntent, 'FULL_PACKAGE');
  assert.match(billingProfileReturnHref('c1', new URL(full, 'https://local.test').search) ?? '', /purchaseIntent=FULL_PACKAGE/);
  assert.equal(billingProfileSelection('?offer=BASIC_499&interval=month&purchaseIntent=INVALID')?.purchaseIntent, undefined);
});

it('carries a deal through the address detour and back to its own card', () => {
  const href = billingProfileHref('c1', { offer: 'PRO_999', interval: 'month', channel: 'web', purchaseMode: 'PROMPTPAY_ONCE', dealId: 'deal-1' });
  const search = new URL(href, 'https://local.test').search;
  assert.equal(search, '?offer=PRO_999&interval=month&channel=web&purchaseMode=PROMPTPAY_ONCE&deal=deal-1&returnTo=billing');
  assert.equal(billingProfileReturnHref('c1', search),
    '/companies/c1/billing?offer=PRO_999&interval=month&channel=web&purchaseMode=PROMPTPAY_ONCE&deal=deal-1&profile=updated');
  assert.equal(billingProfileSelection(search)?.dealId, 'deal-1');
  // The id is echoed straight into the next quote body, so only an opaque token comes back.
  assert.equal(billingProfileSelection('?offer=PRO_999&interval=month&deal=../../evil')?.dealId, undefined);
  assert.equal(billingProfileSelection('?offer=PRO_999&interval=month')?.dealId, undefined);
  // A deal never smuggles in a tier the catalog would refuse.
  assert.equal(billingProfileSelection('?offer=FREE_TRIAL_15&interval=month&deal=deal-1'), null);
});
