import { isDeepStrictEqual } from 'node:util';
import { companyBillingProfile, type BillingCompanySource, type BillingCompanyProfile, type BillingQuote } from '@watchdog-bms/contracts';
import { billingError } from '../domain/billing-policy';
import type { StripeObject } from '../infrastructure/stripe.client';

/** R-A1: an incomplete profile no longer refuses a purchase; the quote pins what it saw (maybe with missingFields). */
export const billingProfileComplete = (profile: BillingCompanyProfile | undefined) => !!profile && profile.missingFields.length === 0;

/** R-A10: drift since the quote is always QUOTE_STALE; a legacy quote without billingProfile stays stale as before. */
export function assertBillingProfileUnchanged(company: BillingCompanySource, quote: BillingQuote): BillingCompanyProfile {
  const current = companyBillingProfile(company);
  if (!quote.billingProfile || !isDeepStrictEqual(current, quote.billingProfile))
    throw billingError('BILLING_QUOTE_STALE', 'ชื่อหรือที่อยู่บนเอกสารเปลี่ยน กรุณาตรวจสอบรายการใหม่');
  return current;
}

export type StripeCustomerSyncSnapshot = { quote: Pick<BillingQuote, 'billingProfile' | 'billingEmail' | 'companyName'> };

/**
 * R-A2: the one Customer payload used by checkout, repeat and the reconciler. It is derived from the
 * snapshot alone, so `mm:<attempt>:billing-profile` always carries the same bytes: the name always;
 * the address only when all five parts are present (never blanks over the address Stripe Checkout
 * stored — RV16); the email only when the quote pinned one (the current recipient or a verified
 * account email).
 */
export function stripeCustomerSyncPayload(snapshot: StripeCustomerSyncSnapshot) {
  const profile = snapshot.quote.billingProfile, address = profile?.address;
  return { name: profile?.name || snapshot.quote.companyName.trim(),
    ...(billingProfileComplete(profile) && address ? { address: { country: 'TH', line1: address.line1,
      line2: [address.line2, address.subdistrict].filter(Boolean).join(' '), city: address.district, state: address.province, postal_code: address.postalCode } } : {}),
    ...(snapshot.quote.billingEmail ? { email: snapshot.quote.billingEmail } : {}) };
}

/** Compares only the keys the payload sends: a Checkout-collected address under an incomplete profile matches. */
export function stripeCustomerSynced(customer: StripeObject, snapshot: StripeCustomerSyncSnapshot): boolean {
  const expected = stripeCustomerSyncPayload(snapshot);
  return customer.name === expected.name && (!expected.email || customer.email === expected.email) &&
    (!expected.address || Object.entries(expected.address).every(([key, value]) => customer.address?.[key] === value));
}
