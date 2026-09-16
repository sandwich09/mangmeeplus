import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailOtpDigest, matchesEmailOtp, newEmailOtp, emailRequirement, emailReauthBinding,
  emailSecurityBinding, type OtpBinding } from './email-otp.logic';
import { renderEmailOtp } from '../../infrastructure/auth-email.templates';

const now = new Date('2026-09-15T12:00:00Z');
const binding: OtpBinding = { environment: 'uat', id: 'challenge', userId: 'owner', email: 'owner@example.com',
  emailRevision: 3, securityBindingHash: 'security', sessionId: 'session', keyVersion: '1',
  expiresAt: new Date(now.getTime() + 600_000) };
const key = 'ab'.repeat(32);

test('OTP preserves zeroes and cannot move between target, user, environment, session or key', () => {
  const digest = emailOtpDigest('000012', binding, key);
  assert.equal(matchesEmailOtp('000012', digest, binding, key), true);
  for (const code of ['12', '000013', ' 000012', '000012\n', 'abcdef']) assert.equal(matchesEmailOtp(code, digest, binding, key), false);
  for (const change of [{ environment: 'production' }, { id: 'other' }, { userId: 'other' },
    { email: 'other@example.com' }, { emailRevision: 4 }, { sessionId: 'other' }, { keyVersion: '2' },
    { securityBindingHash: 'changed' }, { expiresAt: now }]) {
    assert.equal(matchesEmailOtp('000012', digest, { ...binding, ...change }, key), false);
  }
  assert.equal(matchesEmailOtp('000012', digest, binding, 'cd'.repeat(32)), false);
  assert.throws(() => emailOtpDigest('000012', binding, 'short'));
  for (let i = 0; i < 100; i++) assert.match(newEmailOtp(), /^\d{6}$/);
});

test('expired pending cannot lock out a verified user; blank email never passes verification', () => {
  const user = { email: 'owner@example.com', emailVerifiedAt: now };
  assert.equal(emailRequirement(user, null, now), 'READY');
  assert.equal(emailRequirement({ ...user, email: null }, null, now), 'MISSING');
  assert.equal(emailRequirement({ ...user, email: ' ' }, null, now), 'MISSING');
  assert.equal(emailRequirement({ ...user, emailVerifiedAt: null }, null, now), 'UNVERIFIED');
  assert.equal(emailRequirement(user, { status: 'PENDING', expiresAt: binding.expiresAt }, now), 'CHANGE_PENDING');
  assert.equal(emailRequirement(user, { status: 'PENDING', expiresAt: now }, now), 'READY');
  assert.equal(emailRequirement(user, { status: 'REVOKED', expiresAt: binding.expiresAt }, now), 'READY');
});

test('credential/identity/account security changes invalidate proof, resend revision does not force new LINE reauth', () => {
  const user = { id: 'owner', status: 'ACTIVE', email: null, emailVerifiedAt: null, emailRevision: 1,
    credential: null, externalIdentities: [{ id: 'line', provider: 'LINE', providerChannelId: 'channel', providerUserId: 'U1',
      status: 'ACTIVE', linkedAt: now }] };
  const original = emailSecurityBinding(user);
  for (const changed of [{ ...user, status: 'DISABLED' }, { ...user, emailRevision: 2 },
    { ...user, externalIdentities: [] }, { ...user, email: 'new@example.com' }]) {
    assert.notEqual(emailSecurityBinding(changed), original);
  }
  assert.equal(emailReauthBinding(user), emailReauthBinding({ ...user, emailRevision: 2 }));
  assert.notEqual(emailReauthBinding(user), emailReauthBinding({ ...user, email: 'new@example.com' }));
});

test('mail contains the same code in text and HTML, never in subject or a URL', () => {
  const result = renderEmailOtp('000012', binding.expiresAt);
  assert.ok(result.text.includes('000012'));
  assert.ok(result.html.includes('000012'));
  assert.ok(!result.subject.includes('000012'));
  assert.ok(!result.html.includes('href='));
  assert.throws(() => renderEmailOtp('12', binding.expiresAt));
});

import { emailAccessDigest, matchesEmailAccessCode, matchesEmailBrowserSecret } from './email-access.logic';
import { hashToken } from './secure-token.logic';
test('public email login code is purpose/browser/identity bound and never accepts account-change OTP', () => {
  const secret = 'a'.repeat(43);
  const proof = { id: 'public', email: 'owner@example.com', browserSecretHash: hashToken(secret), keyVersion: '1',
    environment: 'local', userId: 'user', securityBindingHash: 'security', expiresAt: now };
  const digest = emailAccessDigest('000012', proof, key);
  assert.ok(matchesEmailAccessCode('000012', digest, proof, key));
  assert.ok(matchesEmailBrowserSecret(secret, proof.browserSecretHash));
  assert.equal(matchesEmailBrowserSecret('b'.repeat(43), proof.browserSecretHash), false);
  for (const change of [{ id: 'other' }, { email: 'other@example.com' }, { browserSecretHash: 'changed' },
    { environment: 'production' }, { userId: null }, { keyVersion: '2' }, { securityBindingHash: 'changed' }, { expiresAt: new Date(0) }]) {
    assert.equal(matchesEmailAccessCode('000012', digest, { ...proof, ...change }, key), false);
  }
  assert.equal(matchesEmailAccessCode('000012', emailOtpDigest('000012', binding, key), proof, key), false);
  for (const code of ['12', ' 000012', '000012\n', '000013']) assert.equal(matchesEmailAccessCode(code, digest, proof, key), false);
});

test('existing proof hashes remain byte-identical until passwordless opt-in', () => {
  const user = { id: 'owner', status: 'ACTIVE', email: 'a@example.test', emailVerifiedAt: now, emailRevision: 4, credential: null, externalIdentities: [] };
  const legacy = createHash('sha256').update(JSON.stringify([user.id, user.status, user.email, now.toISOString(), 4, null, []])).digest('hex');
  assert.equal(emailSecurityBinding(user), legacy);
  assert.equal(emailSecurityBinding({ ...user, emailLoginEnabledAt: null }), legacy);
  assert.notEqual(emailSecurityBinding({ ...user, emailLoginEnabledAt: now }), legacy);
});
