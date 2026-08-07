/**
 * Shadow coverage for the worker-token AI draft endpoints (piece 5).
 *
 * `generate` is the direct-injection path the F0 async inventory records as having neither an
 * entitlement check nor an `assertActiveCompany` guard, so it gets its own surface. `drain` is
 * measured inside its use case, not here — instrumenting both would double-count every drained item.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { UnauthorizedException } from '@nestjs/common';
import { AiDraftInternalController } from './ai-draft-internal.controller';

const TOKEN = 'worker-secret';

function makeController(opts: { generateThrows?: boolean } = {}) {
  const shadowRecords: any[] = [];
  const flushes: string[] = [];
  const generated: any[] = [];
  const drains: any[] = [];

  const drain = { execute: async (batchSize?: number) => { drains.push(batchSize); return { processed: 0, results: [] }; } } as any;
  const generate = {
    execute: async (companyId: string, requestId: string) => {
      generated.push({ companyId, requestId });
      if (opts.generateThrows) throw new Error('generate blew up');
      return { requestId, status: 'READY' };
    },
  } as any;
  const shadow = {
    startSweep: (surface: string) => ({
      record: async (companyId: string | null, featureKey: string | null) => {
        shadowRecords.push({ surface, companyId, featureKey });
        return { wouldBlock: false, reason: 'available' as const };
      },
      flush: async () => { flushes.push(surface); return {}; },
    }),
  } as any;

  return { controller: new AiDraftInternalController(drain, generate, shadow), shadowRecords, flushes, generated, drains };
}

describe('AiDraftInternalController shadow coverage', () => {
  const originalToken = process.env['WORKER_INTERNAL_TOKEN'];

  beforeEach(() => { process.env['WORKER_INTERNAL_TOKEN'] = TOKEN; });
  afterEach(() => {
    if (originalToken === undefined) delete process.env['WORKER_INTERNAL_TOKEN'];
    else process.env['WORKER_INTERNAL_TOKEN'] = originalToken;
  });

  it('rejects a bad worker token before recording or generating', async () => {
    const { controller, shadowRecords, generated } = makeController();
    await assert.rejects(() => controller.generateOne('wrong', { companyId: 'co-1', requestId: 'r-1' }), UnauthorizedException);
    assert.deepEqual(shadowRecords, []);
    assert.deepEqual(generated, []);
  });

  it('records one observation per generate request and generates regardless', async () => {
    const { controller, shadowRecords, flushes, generated } = makeController();
    const result = await controller.generateOne(TOKEN, { companyId: 'co-1', requestId: 'r-1' });

    assert.deepEqual(shadowRecords, [
      { surface: 'ai.draft.generate', companyId: 'co-1', featureKey: 'ai_line_assistant' },
    ]);
    assert.deepEqual(flushes, ['ai.draft.generate']);
    assert.deepEqual(generated, [{ companyId: 'co-1', requestId: 'r-1' }]);
    assert.equal((result as any).status, 'READY');
  });

  it('flushes buffered evidence when generation throws (finally, not a trailing await)', async () => {
    const { controller, shadowRecords, flushes } = makeController({ generateThrows: true });
    await assert.rejects(() => controller.generateOne(TOKEN, { companyId: 'co-1', requestId: 'r-1' }), /generate blew up/);
    // Mutation guard: without the `finally` — or without `return await` — the flush would not run
    // after the failure and the observation would be lost.
    assert.equal(shadowRecords.length, 1);
    assert.deepEqual(flushes, ['ai.draft.generate']);
  });

  it('leaves the drain endpoint uninstrumented at the controller — its use case owns that surface', async () => {
    const { controller, shadowRecords, drains } = makeController();
    await controller.drainQueued(TOKEN, { batchSize: 5 });
    assert.deepEqual(drains, [5]);
    assert.deepEqual(shadowRecords, [], 'double counting every drained item would inflate the denominator');
  });
});
