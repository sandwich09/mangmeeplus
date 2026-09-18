import { it } from 'node:test';
import assert from 'node:assert/strict';
import { companyBillingProfile } from './billing-company-profile.js';

it('requires only the billing address, prioritizes registered name, and trims before checking', () => {
  const addressJson = { line1: ' 99 ถนนทดสอบ ', subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร', postalCode: ' 10110 ' };
  const source = { name: ' ร้านที่สมัคร ', registeredName: ' บริษัท จดทะเบียน จำกัด ', addressJson };
  const profile = companyBillingProfile(source);
  assert.equal(profile.name, 'บริษัท จดทะเบียน จำกัด'); assert.equal(profile.nameSource, 'REGISTERED');
  assert.deepEqual(profile.missingFields, []); assert.equal(profile.address.line1, '99 ถนนทดสอบ'); assert.equal(profile.address.line2, null);
  assert.equal(companyBillingProfile({ ...source, registeredName: ' ' }).name, 'ร้านที่สมัคร');
  assert.equal(companyBillingProfile({ ...source, registeredName: null }).nameSource, 'SHOP');
  assert.deepEqual(companyBillingProfile({ ...source, addressJson: { ...addressJson, subdistrict: ' ', postalCode: '1011a' } }).missingFields, ['subdistrict', 'postalCode']);
  assert.deepEqual(companyBillingProfile({}).missingFields, ['name', 'line1', 'subdistrict', 'district', 'province', 'postalCode']);
});
