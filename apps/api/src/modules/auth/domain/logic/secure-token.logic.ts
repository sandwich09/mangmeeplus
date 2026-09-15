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

export type EmailRecoveryBinding = { id:string; email:string|null; emailVerifiedAt:Date|null; credential:{passwordHash:string;updatedAt:Date}|null };
export const EMAIL_RECOVERY_TOKEN = /^er1\.[a-f0-9]{64}\.[a-f0-9]{64}\.[A-Za-z0-9_-]{43}$/;
export function emailRecoveryBinding(user:EmailRecoveryBinding):string {
  return hashToken(JSON.stringify(['email-reset',user.id,user.email?.toLowerCase(),user.emailVerifiedAt?.toISOString()]));
}
export function emailRecoveryCredential(user:EmailRecoveryBinding):string {
  return hashToken(JSON.stringify([user.credential?.passwordHash,user.credential?.updatedAt.toISOString()]));
}
export function generateEmailRecoveryToken(user:EmailRecoveryBinding):string {
  return `er1.${emailRecoveryBinding(user)}.${emailRecoveryCredential(user)}.${generateRawToken()}`;
}
