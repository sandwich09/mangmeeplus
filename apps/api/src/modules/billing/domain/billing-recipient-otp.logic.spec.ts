import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_RECIPIENT_PROOF_TTL_MS, matchesRecipientOtp, recipientOtpDigest, type RecipientOtpBinding } from './billing-recipient-otp.logic';

const key = 'a'.repeat(64);
const binding: RecipientOtpBinding = { environment: 'local', id: 'challenge-1', userId: 'user-1', companyId: 'company-1',
  email: 'new@example.test', sessionId: 'session-1', keyVersion: 'v1', expiresAt: new Date('2026-09-28T10:00:00.000Z') };

describe('company recipient OTP digest (R-A8)', () => {
  it('is deterministic and matches only the exact code', () => {
    const digest = recipientOtpDigest('123456', binding, key);
    assert.match(digest, /^[a-f0-9]{64}$/);
    assert.equal(recipientOtpDigest('123456', { ...binding }, key), digest);
    assert.equal(matchesRecipientOtp('123456', digest, binding, key), true);
    assert.equal(matchesRecipientOtp('123457', digest, binding, key), false);
  });

  it('binds the company, user, session, mailbox, key version and expiry', () => {
    const digest = recipientOtpDigest('123456', binding, key);
    for (const change of [{ companyId: 'company-2' }, { userId: 'user-2' }, { sessionId: 'session-2' }, { email: 'other@example.test' },
      { keyVersion: 'v2' }, { id: 'challenge-2' }, { environment: 'uat' }, { expiresAt: new Date('2026-09-28T10:00:01.000Z') }]) {
      assert.equal(matchesRecipientOtp('123456', digest, { ...binding, ...change }, key), false, JSON.stringify(change));
    }
    assert.equal(matchesRecipientOtp('123456', digest, binding, 'b'.repeat(64)), false);
  });

  it('refuses malformed codes and digests without throwing, and a malformed key loudly', () => {
    const digest = recipientOtpDigest('123456', binding, key);
    for (const code of ['12345', '1234567', 'abcdef', ' 123456', '']) assert.equal(matchesRecipientOtp(code, digest, binding, key), false, code);
    assert.equal(matchesRecipientOtp('123456', 'not-a-digest', binding, key), false);
    assert.throws(() => recipientOtpDigest('123456', binding, 'short'), /Invalid email OTP key/);
  });

  it('keeps a confirmed code usable for 30 minutes', () => assert.equal(BILLING_RECIPIENT_PROOF_TTL_MS, 30 * 60_000));
});
