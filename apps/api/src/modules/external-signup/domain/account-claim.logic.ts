import { createHash } from 'node:crypto';
import type { PublicSignupStatusKey } from '@watchdog-bms/contracts';
import type { CompanySignupState } from './company-signup.logic';

/** Spec P11 F-EM-3 / P10 §4B: Owner-locked claim TTL, re-confirmed 2026-08-30. */
export const CLAIM_TOKEN_TTL_HOURS = 72;

/**
 * Spec §4D ④: the applicant may re-send to themselves for 30 days after approval; past that the
 * request leaves the main queue and only an admin can reissue — but an admin always can.
 */
export const SELF_SERVE_RESEND_WINDOW_DAYS = 30;

/**
 * Spec §4D ④: past this age an approved-but-unclaimed request is swept to `EXPIRED` and drops out
 * of the main queue. Same boundary as the self-serve window by design — the day the applicant can
 * no longer revive the request themselves is the day it stops sitting in the operators' list.
 */
export const CLAIM_EXPIRY_AFTER_APPROVAL_DAYS = SELF_SERVE_RESEND_WINDOW_DAYS;

/** Spec §4D ①: one reminder, 24h before the link dies. */
export const CLAIM_REMINDER_AFTER_HOURS = CLAIM_TOKEN_TTL_HOURS - 24;

/**
 * Tokens are stored hash-only (P11 §2 rule 2). The raw token is high-entropy random, so a plain
 * SHA-256 is the right primitive here — the same shape the reset/verify tokens already use. A
 * password KDF would buy nothing against a 32-byte random secret and would cost latency per lookup.
 */
export function hashClaimToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/**
 * Coarse public mapping (spec §3). Anything not on this allowlist collapses to CHECKING so an
 * internal state added later can never leak review detail to an unauthenticated caller.
 */
export function publicSignupStatusKey(state: CompanySignupState): PublicSignupStatusKey {
  switch (state) {
    case 'PENDING_REVIEW':
      return 'PENDING_REVIEW';
    case 'EMAIL_PENDING':
    case 'EMAIL_FAILED':
      return 'AWAITING_CLAIM';
    case 'EMAIL_VERIFIED':
    case 'PROVISIONING':
    case 'READY':
    case 'LINE_LINK_PENDING':
    case 'COMPLETED':
      return 'READY';
    case 'REJECTED':
      return 'REJECTED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'CHECKING';
  }
}

/**
 * Spec §4D ②/④: an approved request never dead-ends. Self-serve resend covers the live
 * EMAIL_PENDING window plus expired links for 30 days after the activation window started; after
 * that it is admin-only.
 *
 * Review R09: the window is `claimWindowStartedAt`, which an admin reissue restarts — measuring
 * from `approvedAt` meant a reissued old approval was already outside its own window the moment it
 * was sent. Callers pass `claimWindowStartedAt ?? approvedAt` so a row written before that column
 * existed behaves exactly as it used to.
 */
export function canResendClaim(
  state: CompanySignupState,
  windowStartedAt: Date | null,
  now: Date,
): boolean {
  if (state === 'EMAIL_PENDING' || state === 'EMAIL_FAILED') return true;
  if (state !== 'EXPIRED' || !windowStartedAt) return false;
  const ageDays = (now.getTime() - windowStartedAt.getTime()) / 86_400_000;
  return ageDays <= SELF_SERVE_RESEND_WINDOW_DAYS;
}

/**
 * Review F7: a claim link may not outlive the window it belongs to. The token TTL is 72 hours and
 * the activation window is 30 days, so a link resent on day 28 used to be minted alive until day
 * 31 — and the sweep parked the request at day 30, killing the link mid-life and telling the
 * applicant nothing. The expiry is therefore the EARLIER of the two clocks.
 *
 * A row with no window (nothing has approved it yet) keeps the plain TTL: there is no window to
 * clamp to, and minting is gated on EMAIL_PENDING elsewhere.
 */
export function claimTokenExpiresAt(now: Date, windowStartedAt: Date | null): Date {
  const ttlEnd = new Date(now.getTime() + CLAIM_TOKEN_TTL_HOURS * 3_600_000);
  if (!windowStartedAt) return ttlEnd;
  const windowEnd = new Date(windowStartedAt.getTime() + CLAIM_EXPIRY_AFTER_APPROVAL_DAYS * 86_400_000);
  return windowEnd < ttlEnd ? windowEnd : ttlEnd;
}

/**
 * Below this, a fresh link is not worth sending: it would arrive, sit in an inbox, and be dead
 * before most people open it. The applicant is told to ask an operator instead — reissue has no
 * age limit at all (spec §4D ④).
 */
export const CLAIM_RESEND_MIN_WINDOW_MS = 3_600_000;

export function claimWindowRemainingMs(now: Date, windowStartedAt: Date | null): number {
  if (!windowStartedAt) return Number.POSITIVE_INFINITY;
  return windowStartedAt.getTime() + CLAIM_EXPIRY_AFTER_APPROVAL_DAYS * 86_400_000 - now.getTime();
}

/** Whole days since approval, for the queue's "approved but never started" flag (spec §4D ③). */
export function daysSinceApproval(approvedAt: Date | null, now: Date): number | undefined {
  if (!approvedAt) return undefined;
  return Math.max(0, Math.floor((now.getTime() - approvedAt.getTime()) / 86_400_000));
}

/**
 * "somchai@gmail.com" → "so***@gmail.com". The claim page is unauthenticated, so it may only
 * confirm to the holder of the link which mailbox this was sent to — never reveal a full address.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at);
  return `${local.slice(0, 2)}***${domain}`;
}

/**
 * Default username suggestion = email local part, reduced to the characters the login form accepts.
 * Empty result means "no suggestion" — the claim page then asks the applicant to type one.
 */
export function suggestedUsernameFromEmail(email: string): string | undefined {
  const local = email.slice(0, email.lastIndexOf('@')).toLowerCase();
  const cleaned = local.replace(/[^a-z0-9._-]/g, '').replace(/^[._-]+/, '').slice(0, 32);
  return cleaned.length >= 3 ? cleaned : undefined;
}
