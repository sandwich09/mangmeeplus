import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { ObjectVersionCleanupInternalController } from './object-version-cleanup-internal.controller';

describe('ObjectVersionCleanupInternalController', () => {
  const previous = process.env['WORKER_INTERNAL_TOKEN'];
  beforeEach(() => { process.env['WORKER_INTERNAL_TOKEN'] = 'worker-token-value-1234567890'; });
  afterEach(() => {
    if (previous === undefined) delete process.env['WORKER_INTERNAL_TOKEN'];
    else process.env['WORKER_INTERNAL_TOKEN'] = previous;
  });

  it('authenticates every claim/completion endpoint and passes fencing fields unchanged', async () => {
    const calls: any[] = [];
    const controller = new ObjectVersionCleanupInternalController({
      claim: async (batchSize: number) => { calls.push(['claim', batchSize]); return { tasks: [] }; },
      complete: async (id: string, token: string) => { calls.push(['complete', id, token]); return true; },
      fail: async (id: string, token: string, code: string) => { calls.push(['fail', id, token, code]); return false; },
    } as any);

    await assert.rejects(() => controller.claim('wrong', { batchSize: 4 }), UnauthorizedException);
    await controller.claim('worker-token-value-1234567890', { batchSize: 4 });
    assert.deepEqual(
      await controller.complete('worker-token-value-1234567890', 'task-1', { claimToken: 'claim-1' }),
      { written: true },
    );
    assert.deepEqual(
      await controller.fail('worker-token-value-1234567890', 'task-1', {
        claimToken: 'claim-1', errorCode: 's3_delete_failed:timeout',
      }),
      { written: false },
    );
    assert.deepEqual(calls, [
      ['claim', 4],
      ['complete', 'task-1', 'claim-1'],
      ['fail', 'task-1', 'claim-1', 's3_delete_failed:timeout'],
    ]);
  });
});
