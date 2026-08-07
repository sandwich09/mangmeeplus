import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { assertWorkerToken } from './worker-token';

describe('assertWorkerToken', () => {
  const originalToken = process.env['WORKER_INTERNAL_TOKEN'];

  beforeEach(() => {
    process.env['WORKER_INTERNAL_TOKEN'] = 'expected-worker-token';
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env['WORKER_INTERNAL_TOKEN'];
    else process.env['WORKER_INTERNAL_TOKEN'] = originalToken;
  });

  it('accepts the configured token', () => {
    assert.doesNotThrow(() => assertWorkerToken('expected-worker-token'));
  });

  it('rejects a wrong token', () => {
    assert.throws(() => assertWorkerToken('wrong-token'), UnauthorizedException);
  });

  it('rejects a missing token', () => {
    assert.throws(() => assertWorkerToken(undefined), UnauthorizedException);
  });

  it('rejects an empty token even if it would match an empty secret', () => {
    process.env['WORKER_INTERNAL_TOKEN'] = '';
    assert.throws(() => assertWorkerToken(''), UnauthorizedException);
  });

  it('fails closed when the secret is not configured', () => {
    delete process.env['WORKER_INTERNAL_TOKEN'];
    assert.throws(() => assertWorkerToken('anything'), UnauthorizedException);
  });
});
