import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password-credential.logic';

describe('password credential logic', () => {
  it('verifies the original password only', () => {
    const hash = hashPassword('watchdogbms11');

    assert.equal(verifyPassword('watchdogbms11', hash), true);
    assert.equal(verifyPassword('wrong-password', hash), false);
  });

  it('rejects malformed stored hashes', () => {
    assert.equal(verifyPassword('watchdogbms11', 'invalid'), false);
  });
});
