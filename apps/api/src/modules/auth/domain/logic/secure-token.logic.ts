import { createHash, randomBytes } from 'node:crypto';

export function generateRawToken(size = 32): string {
  return randomBytes(size).toString('base64url');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

// A password change (including an admin reset) invalidates every earlier LINE
// recovery password without coupling each credential writer to this feature.
export function hashLineRecoveryPassword(rawPassword: string, credentialHash: string): string {
  return hashToken(`line-recovery:${credentialHash}:${rawPassword}`);
}
