import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_EXPIRY_AFTER_APPROVAL_DAYS,
  CLAIM_REMINDER_AFTER_HOURS,
  CLAIM_RESEND_MIN_WINDOW_MS,
  CLAIM_TOKEN_TTL_HOURS,
  canResendClaim,
  claimTokenExpiresAt,
  claimWindowRemainingMs,
  daysSinceApproval,
  hashClaimToken,
  maskEmail,
  publicSignupStatusKey,
  suggestedUsernameFromEmail,
} from './account-claim.logic';
import { COMPANY_SIGNUP_STATES, type CompanySignupState } from './company-signup.logic';

const NOW = new Date('2026-09-01T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe('account claim logic', () => {
  it('keeps the Owner-locked 72h TTL and reminds 24h before it dies', () => {
    assert.equal(CLAIM_TOKEN_TTL_HOURS, 72);
    assert.equal(CLAIM_REMINDER_AFTER_HOURS, 48);
  });

  it('hashes tokens deterministically and never returns the raw token', () => {
    const raw = 'sJ2h_raw-token-value';
    assert.equal(hashClaimToken(raw), hashClaimToken(raw));
    assert.notEqual(hashClaimToken(raw), raw);
    assert.match(hashClaimToken(raw), /^[0-9a-f]{64}$/);
    assert.notEqual(hashClaimToken(raw), hashClaimToken(`${raw}x`));
  });

  it('maps every internal state onto the coarse public allowlist', () => {
    assert.equal(publicSignupStatusKey('RECEIVED'), 'CHECKING');
    assert.equal(publicSignupStatusKey('VALIDATED'), 'CHECKING');
    assert.equal(publicSignupStatusKey('PENDING_REVIEW'), 'PENDING_REVIEW');
    assert.equal(publicSignupStatusKey('EMAIL_PENDING'), 'AWAITING_CLAIM');
    assert.equal(publicSignupStatusKey('EMAIL_FAILED'), 'AWAITING_CLAIM');
    assert.equal(publicSignupStatusKey('READY'), 'READY');
    assert.equal(publicSignupStatusKey('COMPLETED'), 'READY');
    assert.equal(publicSignupStatusKey('REJECTED'), 'REJECTED');
    assert.equal(publicSignupStatusKey('EXPIRED'), 'EXPIRED');
    // The public surface must never leak an internal failure as its own status.
    assert.equal(publicSignupStatusKey('PROVISIONING_FAILED'), 'CHECKING');
    assert.equal(publicSignupStatusKey('SUSPENDED'), 'CHECKING');
  });

  it('collapses any unmapped state to CHECKING rather than leaking it', () => {
    const allowed = new Set(['CHECKING', 'PENDING_REVIEW', 'AWAITING_CLAIM', 'READY', 'REJECTED', 'EXPIRED']);
    for (const state of COMPANY_SIGNUP_STATES) {
      assert.ok(allowed.has(publicSignupStatusKey(state)), `${state} escaped the allowlist`);
    }
  });

  it('allows self-serve resend while approved, and for 30 days after the link expired', () => {
    assert.equal(canResendClaim('EMAIL_PENDING', daysAgo(400), NOW), true);
    assert.equal(canResendClaim('EMAIL_FAILED', daysAgo(400), NOW), true);
    assert.equal(canResendClaim('EXPIRED', daysAgo(29), NOW), true);
    assert.equal(canResendClaim('EXPIRED', daysAgo(30), NOW), true);
    // Past the self-serve window the applicant goes through an admin — who has no age limit.
    assert.equal(canResendClaim('EXPIRED', daysAgo(31), NOW), false);
    assert.equal(canResendClaim('EXPIRED', null, NOW), false);
    assert.equal(canResendClaim('PENDING_REVIEW', null, NOW), false);
    assert.equal(canResendClaim('REJECTED', daysAgo(1), NOW), false);
    assert.equal(canResendClaim('COMPLETED', daysAgo(1), NOW), false);
  });

  it('counts whole days since approval for the queue flag', () => {
    assert.equal(daysSinceApproval(null, NOW), undefined);
    assert.equal(daysSinceApproval(daysAgo(0), NOW), 0);
    assert.equal(daysSinceApproval(daysAgo(7), NOW), 7);
    // A clock skew into the future must not produce a negative age.
    assert.equal(daysSinceApproval(new Date(NOW.getTime() + 86_400_000), NOW), 0);
  });

  it('masks the address so the claim page confirms the mailbox without revealing it', () => {
    assert.equal(maskEmail('somchai@gmail.com'), 'so***@gmail.com');
    assert.equal(maskEmail('ab@x.co'), 'ab***@x.co');
    assert.equal(maskEmail('a@x.co'), 'a***@x.co');
    assert.equal(maskEmail('not-an-email'), '***');
  });

  it('suggests a username from the email local part, or nothing at all', () => {
    assert.equal(suggestedUsernameFromEmail('Somchai.Jai@gmail.com'), 'somchai.jai');
    assert.equal(suggestedUsernameFromEmail('a+b_c@x.co'), 'ab_c');
    // Too short after cleaning, and Thai local parts, yield no suggestion rather than a bad one.
    assert.equal(suggestedUsernameFromEmail('ab@x.co'), undefined);
    assert.equal(suggestedUsernameFromEmail('สมชาย@x.co'), undefined);
    assert.equal(suggestedUsernameFromEmail('...abc@x.co'), 'abc');
  });
});

/**
 * Review F7. The token TTL is 72 hours; the activation window is 30 days and a self-serve resend
 * does not restart it. A link resent on day 28 was therefore minted alive until day 31, and the
 * day-30 sweep killed it mid-life — the applicant tapped a link that had been valid when it was
 * sent and got the same blank refusal an unknown token gets.
 */
describe('a claim link never outlives its own activation window (F7)', () => {
  it('gives the full 72 hours while the window has room for it', () => {
    const expiry = claimTokenExpiresAt(NOW, daysAgo(1));
    assert.equal(expiry.getTime() - NOW.getTime(), CLAIM_TOKEN_TTL_HOURS * 3_600_000);
  });

  it('clamps the link to the end of its window, never past it', () => {
    // Day 28 of 30: a full TTL would outlive the window by a day and be swept mid-life.
    const expiry = claimTokenExpiresAt(NOW, daysAgo(28));
    assert.equal(expiry.getTime(), daysAgo(28).getTime() + CLAIM_EXPIRY_AFTER_APPROVAL_DAYS * 86_400_000);
    assert.ok(expiry.getTime() - NOW.getTime() < CLAIM_TOKEN_TTL_HOURS * 3_600_000);
  });

  it('keeps the plain TTL when there is no window to clamp to', () => {
    assert.equal(claimTokenExpiresAt(NOW, null).getTime() - NOW.getTime(), CLAIM_TOKEN_TTL_HOURS * 3_600_000);
  });

  it('measures what is left of the window, so a nearly dead one can be refused', () => {
    assert.equal(claimWindowRemainingMs(NOW, daysAgo(CLAIM_EXPIRY_AFTER_APPROVAL_DAYS)), 0);
    assert.ok(claimWindowRemainingMs(NOW, daysAgo(1)) > CLAIM_RESEND_MIN_WINDOW_MS);
    assert.equal(claimWindowRemainingMs(NOW, null), Number.POSITIVE_INFINITY);
  });
});

describe('public status mapping is total', () => {
  it('has an entry for every declared state', () => {
    for (const state of COMPANY_SIGNUP_STATES as readonly CompanySignupState[]) {
      assert.equal(typeof publicSignupStatusKey(state), 'string');
    }
  });
});
