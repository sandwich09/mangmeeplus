import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Company-scoped recipient OTP (spec §18.2 R-A8/R-D2). A sibling of the account email OTP digest: the
 * account tuple binds `emailRevision`/`securityBindingHash`, this one binds the company instead, so a
 * code proves the new mailbox for one company, one user and one session only.
 */
export const BILLING_RECIPIENT_OTP_POLICY = 'BILLING_RECIPIENT_OTP_V1';
/** How long a confirmed code may still open the change review. */
export const BILLING_RECIPIENT_PROOF_TTL_MS = 30 * 60_000;
export type RecipientOtpBinding = { environment: string; id: string; userId: string; companyId: string; email: string;
  sessionId: string; keyVersion: string; expiresAt: Date };

export function recipientOtpDigest(code: string, b: RecipientOtpBinding, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid email OTP key configuration.');
  return createHmac('sha256', Buffer.from(key, 'hex')).update(JSON.stringify([BILLING_RECIPIENT_OTP_POLICY, b.environment, b.id,
    b.userId, b.companyId, b.email, b.sessionId, b.keyVersion, b.expiresAt.toISOString(), code])).digest('hex');
}

export function matchesRecipientOtp(code: string, digest: string, b: RecipientOtpBinding, key: string): boolean {
  if (!/^\d{6}$/.test(code) || !/^[a-f0-9]{64}$/.test(digest)) return false;
  return timingSafeEqual(Buffer.from(recipientOtpDigest(code, b, key), 'hex'), Buffer.from(digest, 'hex'));
}
