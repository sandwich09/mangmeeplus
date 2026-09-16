import { createHmac, timingSafeEqual } from 'node:crypto';
import { hashToken } from './secure-token.logic';
export const EMAIL_ACCESS_POLICY = 'EMAIL_ACCESS_V1';
export type EmailAccessBinding = { id: string; email: string; browserSecretHash: string; keyVersion: string;
  environment: string; userId: string | null; securityBindingHash: string | null; expiresAt: Date };
export function emailAccessDigest(code: string, binding: EmailAccessBinding, key: string): string {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid email OTP key configuration.');
  return createHmac('sha256', Buffer.from(key, 'hex')).update(JSON.stringify([
    EMAIL_ACCESS_POLICY, binding.id, binding.email, binding.browserSecretHash, binding.keyVersion,
    binding.environment, binding.userId, binding.securityBindingHash, binding.expiresAt.toISOString(), code,
  ])).digest('hex');
}
export function matchesEmailAccessCode(code: string, digest: string, binding: EmailAccessBinding, key: string): boolean {
  return /^\d{6}$/.test(code) && /^[a-f0-9]{64}$/.test(digest) &&
    timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(emailAccessDigest(code, binding, key), 'hex'));
}
export function matchesEmailBrowserSecret(secret: string, digest: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(secret) && /^[a-f0-9]{64}$/.test(digest) &&
    timingSafeEqual(Buffer.from(hashToken(secret), 'hex'), Buffer.from(digest, 'hex'));
}
