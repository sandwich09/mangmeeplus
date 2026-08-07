import { createHash, randomBytes } from 'node:crypto';

export function generateRawToken(size = 32): string {
  return randomBytes(size).toString('base64url');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
