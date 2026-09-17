import { ConflictException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import { companyBillingProfile, type BillingCompanySource, type BillingCompanyProfile, type BillingQuote } from '@watchdog-bms/contracts';
import { billingError } from '../domain/billing-policy';
import type { StripeObject } from '../infrastructure/stripe.client';

export function requireBillingProfile(company: BillingCompanySource): BillingCompanyProfile {
  const profile = companyBillingProfile(company);
  if (profile.missingFields.length) throw new ConflictException({ code: 'BILLING_COMPANY_PROFILE_REQUIRED',
    message: 'กรุณากรอกข้อมูลบริษัทให้ครบก่อนซื้อแพ็กเกจ', missingFields: profile.missingFields });
  return profile;
}

export function assertBillingProfileUnchanged(company: BillingCompanySource, quote: BillingQuote) {
  const current = requireBillingProfile(company);
  if (!quote.billingProfile || !isDeepStrictEqual(current, quote.billingProfile))
    throw billingError('BILLING_QUOTE_STALE', 'ชื่อหรือที่อยู่บนเอกสารเปลี่ยน กรุณาตรวจสอบรายการใหม่');
  return current;
}

export function stripeBillingProfile(profile: BillingCompanyProfile) {
  const address = profile.address;
  return { name: profile.name, address: { country: 'TH', line1: address.line1,
    line2: [address.line2, address.subdistrict].filter(Boolean).join(' '),
    city: address.district, state: address.province, postal_code: address.postalCode } };
}

export function stripeBillingProfileMatches(customer: StripeObject, profile: BillingCompanyProfile): boolean {
  const expected = stripeBillingProfile(profile);
  return customer.name === expected.name && Object.entries(expected.address).every(([key, value]) => customer.address?.[key] === value);
}
