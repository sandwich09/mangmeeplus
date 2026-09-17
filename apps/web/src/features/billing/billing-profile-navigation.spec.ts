import { it } from 'node:test';
import assert from 'node:assert/strict';
import { billingProfileHref, billingProfileReturnHref, billingProfileSelection } from './billing-profile-navigation';

it('returns to the same company and selected paid package, never to an arbitrary URL or automatic checkout', () => {
  const href = billingProfileHref('company/a', { offer: 'PRO_999', interval: 'year', channel: 'line' });
  const search = new URL(href, 'https://local.test').search;
  assert.equal(billingProfileReturnHref('company/a', search), '/companies/company%2Fa/billing?offer=PRO_999&interval=year&channel=line&profile=updated');
  assert.equal(billingProfileReturnHref('a', '?returnTo=https://evil.test&offer=PRO_999&interval=year'), null);
  assert.equal(billingProfileSelection('?offer=ENTERPRISE_1999&interval=year'), null);
  assert.equal(billingProfileSelection('?offer=PRO_999&interval=monthly'), null);
  assert.equal(billingProfileSelection('?offer=PRO_999&interval=year&channel=https://evil.test')?.channel, 'web');
});
