import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const EMAIL_OTP_TTL_MS = 10 * 60_000;
export const EMAIL_REAUTH_TTL_MS = 5 * 60_000;
export const EMAIL_OTP_COOLDOWN_MS = 60_000;
export const EMAIL_OTP_POLICY = 'ACCOUNT_EMAIL_OTP_V1';
export type EmailRequirement = 'READY' | 'MISSING' | 'UNVERIFIED' | 'CHANGE_PENDING';
export type EmailProof = {
  policyVersion: typeof EMAIL_OTP_POLICY; userId: string; email: string;
  verifiedAt: string; emailRevision: number; securityBindingHash: string;
};

type SecurityUser = {
  id: string; status: string; email: string | null; emailVerifiedAt: Date | null;
  emailRevision: number; emailLoginEnabledAt?: Date | null;
  credential: { id: string; passwordHash: string; status: string; updatedAt: Date; expiresAt: Date | null } | null;
  externalIdentities: { id: string; provider: string; providerChannelId: string; providerUserId: string; status: string; linkedAt: Date }[];
};

/** Include security writers by value; ordinary login/last-seen updates do not revoke a proof. */
export function emailSecurityBinding(user: SecurityUser): string {
  return createHash('sha256').update(JSON.stringify([
    user.id, user.status, user.email, user.emailVerifiedAt?.toISOString(), user.emailRevision,
    user.credential && [user.credential.id, user.credential.passwordHash, user.credential.status,
      user.credential.updatedAt.toISOString(), user.credential.expiresAt?.toISOString()],
    [...user.externalIdentities].sort((a, b) => a.id.localeCompare(b.id)).map(i =>
      [i.id, i.provider, i.providerChannelId, i.providerUserId, i.status, i.linkedAt.toISOString()]),
    // Preserve pre-passwordless proof hashes for every existing account until explicit opt-in.
    ...(user.emailLoginEnabledAt ? [['EMAIL_LOGIN_ENABLED', user.emailLoginEnabledAt.toISOString()]] : []),
  ])).digest('hex');
}

export function emailReauthBinding(user: SecurityUser): string {
  return emailSecurityBinding({ ...user, emailRevision: 0 });
}

export function emailRequirement(
  user: { email: string | null; emailVerifiedAt: Date | null },
  pending: { status: string; expiresAt: Date } | null, now: Date,
): EmailRequirement {
  if (pending?.status === 'PENDING' && pending.expiresAt > now) return 'CHANGE_PENDING';
  if (!user.email?.trim()) return 'MISSING';
  return user.emailVerifiedAt ? 'READY' : 'UNVERIFIED';
}

export function newEmailOtp(): string { return String(randomInt(0, 1_000_000)).padStart(6, '0'); }
export type OtpBinding = {
  environment: string; id: string; userId: string; email: string; emailRevision: number;
  securityBindingHash: string; sessionId: string; keyVersion: string; expiresAt: Date;
};
export function emailOtpDigest(code: string, binding: OtpBinding, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid email OTP key configuration.');
  return createHmac('sha256', Buffer.from(key, 'hex')).update(JSON.stringify([
    EMAIL_OTP_POLICY, binding.environment, binding.id, binding.userId, binding.email,
    binding.emailRevision, binding.securityBindingHash, binding.sessionId, binding.keyVersion,
    binding.expiresAt.toISOString(), code,
  ])).digest('hex');
}
export function matchesEmailOtp(code: string, digest: string, binding: OtpBinding, key: string): boolean {
  if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(Buffer.from(emailOtpDigest(code, binding, key), 'hex'), Buffer.from(digest, 'hex'));
}
