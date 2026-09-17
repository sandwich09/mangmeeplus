import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertBillingProfileUnchanged, requireBillingProfile, stripeBillingProfile, stripeBillingProfileMatches } from './billing-company-profile';
import type { BillingQuote } from '@watchdog-bms/contracts';

it('blocks missing/changed profiles before checkout and maps every address part to Stripe', () => {
  const company = { name: 'ร้านที่สมัคร', registeredName: 'บริษัท จดทะเบียน จำกัด', addressJson: {
    line1: '99 ถนนทดสอบ', line2: 'ชั้น 2', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110',
  } };
  const billingProfile = requireBillingProfile(company), quote = { billingProfile } as BillingQuote;
  assert.deepEqual(assertBillingProfileUnchanged(company, quote), billingProfile);
  // PostgreSQL jsonb reorders object keys when the stored quote is read back.
  const stored = { ...billingProfile, address: Object.fromEntries(Object.entries(billingProfile.address).reverse()) };
  assert.deepEqual(assertBillingProfileUnchanged(company, { billingProfile: stored } as BillingQuote), billingProfile);
  assert.throws(() => requireBillingProfile({ ...company, addressJson: {} }), e => (e as any).getResponse().code === 'BILLING_COMPANY_PROFILE_REQUIRED');
  assert.throws(() => assertBillingProfileUnchanged({ ...company, registeredName: 'เปลี่ยนชื่อ' }, quote), e => (e as any).getResponse().code === 'BILLING_QUOTE_STALE');
  assert.throws(() => assertBillingProfileUnchanged(company, {} as BillingQuote), e => (e as any).getResponse().code === 'BILLING_QUOTE_STALE');
  const payload = stripeBillingProfile(billingProfile);
  assert.deepEqual(payload, { name: company.registeredName, address: { country: 'TH', line1: '99 ถนนทดสอบ',
    line2: 'ชั้น 2 คลองเตย', city: 'คลองเตย', state: 'กรุงเทพมหานคร', postal_code: '10110' } });
  assert.equal(stripeBillingProfileMatches(payload, billingProfile), true);
  assert.equal(stripeBillingProfileMatches({ ...payload, name: company.name }, billingProfile), false);
  assert.equal(stripeBillingProfileMatches({ ...payload, address: {} }, billingProfile), false);
});
