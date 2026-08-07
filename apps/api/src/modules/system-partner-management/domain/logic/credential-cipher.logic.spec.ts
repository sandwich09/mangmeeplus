import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { encryptCredential, decryptCredential } from './credential-cipher.logic';

const KEY = randomBytes(32);

describe('credential-cipher.logic', () => {
  it('encrypt→decrypt round-trip returns original value', () => {
    const plain = '{"channelSecret":"abc123","accessToken":"tok456"}';
    const stored = encryptCredential(plain, KEY);
    const recovered = decryptCredential(stored, KEY);
    assert.equal(recovered, plain);
  });

  it('each call produces a different IV (different ciphertext)', () => {
    const plain = 'same-secret';
    const ct1 = encryptCredential(plain, KEY);
    const ct2 = encryptCredential(plain, KEY);
    assert.notEqual(ct1, ct2, 'IV must differ per call');
    // both should still decrypt correctly
    assert.equal(decryptCredential(ct1, KEY), plain);
    assert.equal(decryptCredential(ct2, KEY), plain);
  });

  it('wrong key throws on decryption', () => {
    const plain = 'secret-value';
    const stored = encryptCredential(plain, KEY);
    const wrongKey = randomBytes(32);
    assert.throws(() => decryptCredential(stored, wrongKey));
  });

  it('tampered ciphertext throws on decryption', () => {
    const plain = 'secret';
    const stored = encryptCredential(plain, KEY);
    const payload = JSON.parse(stored);
    // flip a byte in the ciphertext
    const ctBuf = Buffer.from(payload.ct, 'base64url');
    ctBuf[0] ^= 0xff;
    payload.ct = ctBuf.toString('base64url');
    assert.throws(() => decryptCredential(JSON.stringify(payload), KEY));
  });

  it('stored format has v:1, iv, tag, ct fields', () => {
    const stored = encryptCredential('test', KEY);
    const payload = JSON.parse(stored);
    assert.equal(payload.v, 1);
    assert.ok(typeof payload.iv === 'string' && payload.iv.length > 0);
    assert.ok(typeof payload.tag === 'string' && payload.tag.length > 0);
    assert.ok(typeof payload.ct === 'string' && payload.ct.length > 0);
  });
});
