import { it } from 'node:test';
import assert from 'node:assert/strict';
import { assertBillingProfileUnchanged, billingProfileComplete, stripeCustomerSyncPayload, stripeCustomerSynced } from './billing-company-profile';
import { companyBillingProfile, type BillingQuote } from '@watchdog-bms/contracts';

const company = { name: 'ร้านที่สมัคร', registeredName: 'บริษัท จดทะเบียน จำกัด', addressJson: {
  line1: '99 ถนนทดสอบ', line2: 'ชั้น 2', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: '10110',
} };
const stripeAddress = { country: 'TH', line1: '99 ถนนทดสอบ', line2: 'ชั้น 2 คลองเตย', city: 'คลองเตย', state: 'กรุงเทพมหานคร', postal_code: '10110' };

it('never refuses a missing profile, but a profile changed since the quote is stale (R-A1/R-A10)', () => {
  const billingProfile = companyBillingProfile(company), quote = { billingProfile } as BillingQuote;
  assert.deepEqual(assertBillingProfileUnchanged(company, quote), billingProfile);
  // PostgreSQL jsonb reorders object keys when the stored quote is read back.
  const stored = { ...billingProfile, address: Object.fromEntries(Object.entries(billingProfile.address).reverse()) };
  assert.deepEqual(assertBillingProfileUnchanged(company, { billingProfile: stored } as BillingQuote), billingProfile);
  const empty = { ...company, addressJson: {} }, emptyProfile = companyBillingProfile(empty);
  assert.deepEqual(emptyProfile.missingFields, ['line1', 'subdistrict', 'district', 'province', 'postalCode']);
  assert.deepEqual(assertBillingProfileUnchanged(empty, { billingProfile: emptyProfile } as BillingQuote), emptyProfile);
  assert.equal(billingProfileComplete(emptyProfile), false); assert.equal(billingProfileComplete(billingProfile), true); assert.equal(billingProfileComplete(undefined), false);
  const stale = (e: unknown) => (e as { getResponse(): { code: string } }).getResponse().code === 'BILLING_QUOTE_STALE';
  assert.throws(() => assertBillingProfileUnchanged(empty, quote), stale);
  assert.throws(() => assertBillingProfileUnchanged({ ...company, registeredName: 'เปลี่ยนชื่อ' }, quote), stale);
  assert.throws(() => assertBillingProfileUnchanged(company, {} as BillingQuote), stale);
});

it('builds one Customer payload from the snapshot: name always, address only when complete, email only when pinned (R-A2)', () => {
  const complete = { quote: { billingProfile: companyBillingProfile(company), billingEmail: 'owner@example.test', companyName: 'ร้านที่สมัคร' } };
  assert.deepEqual(stripeCustomerSyncPayload(complete), { name: company.registeredName, address: stripeAddress, email: 'owner@example.test' });
  // The same snapshot always yields the same bytes for `mm:<attempt>:billing-profile`.
  assert.equal(JSON.stringify(stripeCustomerSyncPayload(complete)), JSON.stringify(stripeCustomerSyncPayload(structuredClone(complete))));
  const noSetup = { quote: { billingProfile: companyBillingProfile({ name: ' ร้านใหม่ ', addressJson: {} }), billingEmail: null, companyName: ' ร้านใหม่ ' } };
  assert.deepEqual(stripeCustomerSyncPayload(noSetup), { name: 'ร้านใหม่' });
  // A legacy quote without a profile falls back to the shop name.
  assert.deepEqual(stripeCustomerSyncPayload({ quote: { billingEmail: null, companyName: ' ร้านเดิม ' } }), { name: 'ร้านเดิม' });
});

it('compares only what the payload sends, so a Checkout address under an incomplete profile matches', () => {
  const complete = { quote: { billingProfile: companyBillingProfile(company), billingEmail: 'owner@example.test', companyName: 'ร้านที่สมัคร' } };
  const customer = { name: company.registeredName, email: 'owner@example.test', address: stripeAddress };
  assert.equal(stripeCustomerSynced(customer, complete), true);
  assert.equal(stripeCustomerSynced({ ...customer, name: company.name }, complete), false);
  assert.equal(stripeCustomerSynced({ ...customer, address: {} }, complete), false);
  assert.equal(stripeCustomerSynced({ ...customer, email: 'other@example.test' }, complete), false);
  const noSetup = { quote: { billingProfile: companyBillingProfile({ name: 'ร้านใหม่', addressJson: {} }), billingEmail: null, companyName: 'ร้านใหม่' } };
  assert.equal(stripeCustomerSynced({ name: 'ร้านใหม่', email: 'typed@example.test', address: { country: 'TH', line1: 'จาก Checkout' } }, noSetup), true);
  assert.equal(stripeCustomerSynced({ name: 'ร้านอื่น', email: null, address: null }, noSetup), false);
});
