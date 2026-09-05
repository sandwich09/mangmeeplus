/**
 * P10-L §3.2 / §5. The LINE form is two required fields — shop name and mobile number (Owner
 * 2026-09-05) — so its normalisation is its own small thing rather than a branch inside Flow B's
 * `normalizeCompanySignupInput`
 * — that one demands an email, a consent version and two name halves this form never asks for.
 */

/** Spec §3.2: 1–120 characters. Duplicates across shops are legal (P10 §4C). */
export const LINE_SIGNUP_COMPANY_NAME_MAX = 120;
export const LINE_SIGNUP_REFERRAL_CODE_MAX = 128;

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
