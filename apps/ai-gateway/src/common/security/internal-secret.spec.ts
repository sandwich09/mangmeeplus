/**
 * L-07: gateway copy of the constant-time internal-secret compare.
 * Byte-identity with the API copy is asserted by
 * `apps/api/src/common/security/secret-compare.spec.ts`; this spec covers behaviour.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { assertInternalSecret, timingSafeStringEqual } from './internal-secret';

describe('assertInternalSecret', () => {
  it('throws when the expected secret is not configured (fail-closed)', () => {
    assert.throws(() => assertInternalSecret('anything', undefined), UnauthorizedException);
    assert.throws(() => assertInternalSecret('anything', ''), UnauthorizedException);
  });

  it('throws when the provided secret is missing or empty', () => {
    assert.throws(() => assertInternalSecret(undefined, 'expected'), UnauthorizedException);
    assert.throws(() => assertInternalSecret('', 'expected'), UnauthorizedException);
  });

  it('throws on a mismatch at the same byte length', () => {
    assert.throws(() => assertInternalSecret('expectee', 'expected'), UnauthorizedException);
  });

  it('throws on a mismatch at a different byte length', () => {
    assert.throws(() => assertInternalSecret('wrong', 'expected'), UnauthorizedException);
    assert.throws(() => assertInternalSecret('wrong-but-longer', 'expected'), UnauthorizedException);
  });

  it('does not throw when the secret matches', () => {
    assert.doesNotThrow(() => assertInternalSecret('expected', 'expected'));
  });
});

describe('timingSafeStringEqual', () => {
  it('accepts equal strings', () => {
    assert.equal(timingSafeStringEqual('shared-secret', 'shared-secret'), true);
  });

  it('rejects unequal strings of the same byte length', () => {
    assert.equal(timingSafeStringEqual('shared-secret', 'shored-secret'), false);
  });

  it('rejects unequal strings of different byte lengths', () => {
    assert.equal(timingSafeStringEqual('short', 'a-much-longer-secret'), false);
    assert.equal(timingSafeStringEqual('a-much-longer-secret', 'short'), false);
    assert.equal(timingSafeStringEqual('ก', 'a'), false);
  });

  it('handles an empty expected value and an empty supplied value', () => {
    assert.equal(timingSafeStringEqual('supplied', ''), false);
    assert.equal(timingSafeStringEqual('', 'expected'), false);
    assert.equal(timingSafeStringEqual('', ''), true, 'the caller, not the compare, rejects empties');
  });
});
