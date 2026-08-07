import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const HASH_BYTES = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, HASH_BYTES).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, encodedHash: string): boolean {
  const [algorithm, salt, expectedHash] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHash) return false;

  const actualHash = scryptSync(password, salt, HASH_BYTES).toString('hex');
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(actualHash, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
