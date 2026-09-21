/**
 * The LINE form collects shop name, mobile number and an unverified shop contact email, so its
 * normalisation is its own small thing rather than a branch inside Flow B's
 * `normalizeCompanySignupInput`
 * — that one collects a verified account email and two name halves this form never asks for.
 */
import { isEmail } from 'class-validator';
import type { LineSignupIntent } from '@watchdog-bms/contracts';
import { SIGNUP_DISCOVERY_SOURCE_OPTIONS, SIGNUP_DISCOVERY_OTHER_MAX, type SignupDiscoverySource } from '@watchdog-bms/contracts';

/** Spec §3.2: 1–120 characters. Duplicates across shops are legal (P10 §4C). */
export const LINE_SIGNUP_COMPANY_NAME_MAX = 120;
export const LINE_SIGNUP_REFERRAL_CODE_MAX = 128;
export const LINE_SIGNUP_CONTACT_EMAIL_MAX = 254;
export const LINE_SIGNUP_INTENTS: readonly LineSignupIntent[] = ['FIRST_SHOP', 'ADD_SHOP'];
export const LINE_OPTIONAL_EMAIL_POLICY = 'LINE_CONTACT_OPTIONAL_V1';

export function normalizeSignupDiscovery(source: unknown, other: unknown): {
  discoverySource: SignupDiscoverySource | null; discoverySourceOther: string | null;
} {
  if (source != null && !SIGNUP_DISCOVERY_SOURCE_OPTIONS.some((option) => option.value === source)) {
    throw new Error('line_signup_discovery_source_invalid');
  }
  if (other != null && (typeof other !== 'string' || other.trim().length > SIGNUP_DISCOVERY_OTHER_MAX)) {
    throw new Error('line_signup_discovery_other_invalid');
  }
  return {
    discoverySource: (source as SignupDiscoverySource | null | undefined) ?? null,
    discoverySourceOther: source === 'OTHER' && typeof other === 'string' ? other.trim() || null : null,
  };
}

/**
 * D6: the "รหัสเซลล์" field is only meaningful with discoverySource 'SALES'.
 *
 * A code typed under any other answer is dropped rather than refused — the customer switched
 * their answer and the stale field came along for the ride; nothing about that is an error worth
 * blocking a signup for. Shape is checked here; whether the code belongs to an ACTIVE agent is a
 * database question the submit use-case answers (SALES_CODE_UNKNOWN).
 */
export function normalizeSignupSalesCode(source: unknown, code: unknown): string | null {
  if (source !== 'SALES') return null;
  if (code == null || (typeof code === 'string' && !code.trim())) return null;
  if (typeof code !== 'string') throw new Error('line_signup_discovery_sales_code_invalid');
  return code.trim().toUpperCase();
}

export function optionalLineContactEmail(value: unknown): string | null {
  if (value == null || (typeof value === 'string' && !value.trim())) return null;
  return requireLineContactEmail(value);
}

export function lineIntakeContactComplete(request: { contactEmail: string | null; phoneNumber: string | null; intakePolicyVersion?: string | null }): boolean {
  return Boolean(request.phoneNumber && (request.contactEmail || request.intakePolicyVersion === LINE_OPTIONAL_EMAIL_POLICY));
}

/** Contact data only: syntax does not prove mailbox ownership or enable account recovery. */
export function requireLineContactEmail(value: unknown): string {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    throw new Error('line_signup_email_required');
  }
  if (typeof value !== 'string') throw new Error('line_signup_email_invalid');
  const email = value.trim().toLowerCase();
  if (email.length > LINE_SIGNUP_CONTACT_EMAIL_MAX || !isEmail(email)) throw new Error('line_signup_email_invalid');
  return email;
}

export function normalizeLineCompanyName(value: string): string {
  const name = value.trim();
  if (!name || name.length > LINE_SIGNUP_COMPANY_NAME_MAX) throw new Error('invalid_companyName');
  return name;
}

/**
 * Thai mobile: exactly 10 digits starting 0, however the shop owner spaced or dashed it. Same rule
 * as the web signup form's `isThaiMobile`, restated here because it lives in the web bundle.
 * Blank returns null — `account-profile` uses that to clear a stored number. The LIFF signup form
 * goes through `requireThaiMobile` instead, which refuses blank (spec §3.2).
 */
export function normalizeThaiMobile(value: string | undefined | null): string | null {
  const digits = (value ?? '').replace(/[^0-9]/g, '');
  if (!digits) return null;
  if (!/^0\d{9}$/.test(digits)) throw new Error('invalid_phoneNumber');
  return digits;
}

/**
 * The LIFF form's phone field, required since Owner 2026-09-05 (spec §3.2). Same digit rule as
 * `normalizeThaiMobile` — which stays optional-tolerant because `account-profile` uses blank to
 * CLEAR a stored number — but blank is an answer to refuse here, and the two outcomes carry their
 * own codes so the page can name the field rather than print a generic failure.
 */
export function requireThaiMobile(value: string | undefined | null): string {
  let phone: string | null;
  try {
    phone = normalizeThaiMobile(value);
  } catch {
    throw new Error('line_signup_phone_invalid');
  }
  if (!phone) throw new Error('line_signup_phone_required');
  return phone;
}

export function normalizeReferralCode(value: string | undefined | null): string | null {
  const code = value?.trim() ?? '';
  if (!code) return null;
  if (code.length > LINE_SIGNUP_REFERRAL_CODE_MAX || !/^[A-Za-z0-9_-]+$/.test(code)) {
    throw new Error('invalid_referralCode');
  }
  return code;
}

/**
 * Review B-05: the web form lets the client mint its idempotency key, which is fine there because
 * the client owns the form state. Here the server mints it from the identity it just verified, so
 * a caller cannot choose to collide with — or dodge — anyone else's key. Uniqueness of an OPEN
 * application is still the partial unique index's job, not this string's.
 */
export function lineExternalSignupId(channelId: string, providerUserId: string, uuid: string): string {
  return `line:${channelId}:${providerUserId}:${uuid}`;
}
