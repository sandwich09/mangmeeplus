import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { ExpenseAutoPostInternalController } from './expense-auto-post-internal.controller';

describe('ExpenseAutoPostInternalController', () => {
  const originalToken = process.env['WORKER_INTERNAL_TOKEN'];
  beforeEach(() => { process.env['WORKER_INTERNAL_TOKEN'] = 'worker-secret'; });
  afterEach(() => {
    if (originalToken === undefined) delete process.env['WORKER_INTERNAL_TOKEN'];
    else process.env['WORKER_INTERNAL_TOKEN'] = originalToken;
  });

  it('rejects a missing or invalid worker token', () => {
    const controller = new ExpenseAutoPostInternalController({ execute: async () => ({}) } as any);
    assert.throws(() => controller.execute(undefined, {}), UnauthorizedException);
    assert.throws(() => controller.execute('wrong', {}), UnauthorizedException);
  });

  it('runs a bounded drain for a valid token', async () => {
    let limit: number | undefined;
    const expected = { companies: 1, candidates: 2, posted: 2, failed: 0 };
    const controller = new ExpenseAutoPostInternalController({
      execute: async (value?: number) => { limit = value; return expected; },
    } as any);
    assert.deepEqual(await controller.execute('worker-secret', { limit: 25 }), expected);
    assert.equal(limit, 25);
  });
});
