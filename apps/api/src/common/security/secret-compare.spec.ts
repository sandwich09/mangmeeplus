/**
 * L-07: constant-time comparison of worker/internal secrets, plus the cross-app guard test.
 * The compare helper is duplicated per app (separate bundles); this spec is what makes a
 * one-sided edit fail, following the NestPinoLoggerBridge precedent in logger.spec.ts.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UnauthorizedException } from '@nestjs/common';
import { assertInternalSecret, timingSafeStringEqual } from './secret-compare';

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
    // Multi-byte: equal char count, different byte count.
    assert.equal(timingSafeStringEqual('ก', 'a'), false);
  });

  it('handles an empty expected value and an empty supplied value', () => {
    assert.equal(timingSafeStringEqual('supplied', ''), false);
    assert.equal(timingSafeStringEqual('', 'expected'), false);
    assert.equal(timingSafeStringEqual('', ''), true, 'the caller, not the compare, rejects empties');
  });
});

describe('assertInternalSecret', () => {
  it('throws when the expected secret is not configured (fail-closed)', () => {
    assert.throws(() => assertInternalSecret('anything', undefined), UnauthorizedException);
    assert.throws(() => assertInternalSecret('anything', ''), UnauthorizedException);
  });

  it('throws when the provided secret is missing or empty', () => {
    assert.throws(() => assertInternalSecret(undefined, 'expected'), UnauthorizedException);
    assert.throws(() => assertInternalSecret('', 'expected'), UnauthorizedException);
  });

  it('throws on a mismatch at the same and at a different length', () => {
    assert.throws(() => assertInternalSecret('expectee', 'expected'), UnauthorizedException);
    assert.throws(() => assertInternalSecret('wrong-but-longer', 'expected'), UnauthorizedException);
  });

  it('does not throw when the secret matches', () => {
    assert.doesNotThrow(() => assertInternalSecret('expected', 'expected'));
  });
});

describe('cross-app compare helper', () => {
  it('stays byte-identical to the AI Gateway copy (single-sided edits must fail here)', () => {
    const marker = '// ── L-07 shared block';
    const sharedBlock = (path: string) => {
      const text = readFileSync(path, 'utf8');
      const start = text.indexOf(marker);
      assert.notEqual(start, -1, `${path} must still declare the ${marker} marker`);
      return text.slice(start).trim();
    };
    assert.equal(
      sharedBlock(join(__dirname, 'secret-compare.ts')),
      sharedBlock(join(__dirname, '../../../../ai-gateway/src/common/security/internal-secret.ts')),
      'the constant-time compare must be kept identical in apps/api and apps/ai-gateway',
    );
  });
});
