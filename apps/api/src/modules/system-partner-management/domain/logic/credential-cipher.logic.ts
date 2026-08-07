import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

type EncryptedPayload = {
  v: 1;
  iv: string;   // base64url
  tag: string;  // base64url
  ct: string;   // base64url
};

/**
 * Encrypts a plain string with AES-256-GCM.
 * Returns a JSON string safe to store in encryptedSecretJson column.
 * Never logs or exposes key material.
 */
export function encryptCredential(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload: EncryptedPayload = {
    v: 1,
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ct: ct.toString('base64url'),
  };
  return JSON.stringify(payload);
}

/**
 * Decrypts an AES-256-GCM JSON string produced by encryptCredential.
 * Throws if the key is wrong or the ciphertext is tampered.
 */
export function decryptCredential(stored: string, key: Buffer): string {
  const payload: EncryptedPayload = JSON.parse(stored);
  const iv = Buffer.from(payload.iv, 'base64url');
  const tag = Buffer.from(payload.tag, 'base64url');
  const ct = Buffer.from(payload.ct, 'base64url');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
