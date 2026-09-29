import { isDeepStrictEqual } from 'node:util';
import { companyBillingProfile, type BillingCompanySource, type BillingCompanyProfile, type BillingQuote } from '@watchdog-bms/contracts';
import { billingError, configurationHash } from '../domain/billing-policy';
import type { StripeObject } from '../infrastructure/stripe.client';
import type { Prisma } from '../../../generated/prisma/client';
import type { AppConfigService } from '../../../common/config/app-config.service';

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

/**
 * PR E (R-E3/§2.6): enqueue a `CUSTOMER_PROFILE_SYNC` op, called by identity/profile writers
 * (`CompanyIdentityUseCase.patch` — the shop's own edit and the team's `UpdatePartnerIdentityUseCase`
 * both go through it — and `UpdatePartnerProfileUseCase`) in the SAME transaction as their own write.
 * A plain function, not a class method: those use-cases live outside billing, and BillingModule
 * already imports SystemPartnerManagementModule, so a service injected the other way would cycle.
 * No-op when billing is off or the company has no
 * Stripe Customer yet. Idempotent per `version` via the op's own unique idempotency key.
 */
export async function enqueueCustomerProfileSync(tx: Prisma.TransactionClient, config: Pick<AppConfigService, 'stripeAccountId' | 'billingMode'>,
  companyId: string, reason: string, adminUserId: string, version: number | string): Promise<void> {
  const stripeAccountId = config.stripeAccountId;
  if (!stripeAccountId || !['test', 'live'].includes(config.billingMode)) return;
  const livemode = config.billingMode === 'live';
  const account = await tx.billingAccount.findUnique({ where: { companyId_stripeAccountId_livemode: { companyId, stripeAccountId, livemode } } });
  if (!account?.customerId) return;
  try {
    await tx.billingOperation.create({ data: { type: 'CUSTOMER_PROFILE_SYNC', state: 'QUEUED', companyId, stripeAccountId: account.stripeAccountId, livemode: account.livemode,
      referenceId: account.id, proposedJson: { accountId: account.id, customerId: account.customerId } as Prisma.InputJsonValue, sourceVersion: account.version,
      reason, initiatorUserId: adminUserId, requestHash: configurationHash([companyId, version]), idempotencyKey: `customer-sync:${companyId}:${version}`,
      expiresAt: new Date(Date.now() + 86_400_000), scheduledFor: new Date() } });
  } catch (error) { if ((error as { code?: string }).code !== 'P2002') throw error; }
}
