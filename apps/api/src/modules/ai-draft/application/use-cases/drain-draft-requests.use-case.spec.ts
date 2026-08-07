/**
 * Shadow coverage for the AI draft-request drain (piece 5).
 *
 * F0 async inventory §5d: `ai.draft.*` permissions ARE entitlement-gated, but this drain never
 * resolves permissions, so the gate never applies and every item is a billable model call made
 * without an entitlement check. The probe measures what the CC1 guard would decide; nothing here
 * branches on it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DrainDraftRequestsUseCase } from './drain-draft-requests.use-case';

function makeDrain(opts: { queued?: Array<{ id: string; companyId: string }>; generateThrows?: boolean } = {}) {
  const shadowRecords: any[] = [];
  const flushes: string[] = [];
  const generated: Array<{ companyId: string; id: string }> = [];
  const batchSizes: number[] = [];

  const repo = {
    listQueuedRequestIds: async (batchSize: number) => { batchSizes.push(batchSize); return opts.queued ?? []; },
  } as any;
  const generate = {
    execute: async (companyId: string, id: string) => {
      generated.push({ companyId, id });
      if (opts.generateThrows) throw new Error('model call blew up');
      return { requestId: id, status: 'READY' };
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

  return { useCase: new DrainDraftRequestsUseCase(repo, generate, shadow), shadowRecords, flushes, generated, batchSizes };
}

describe('DrainDraftRequestsUseCase shadow coverage', () => {
  it('records one observation per queued request under ai_line_assistant', async () => {
    const { useCase, shadowRecords, flushes, generated } = makeDrain({
      queued: [{ id: 'r-1', companyId: 'co-1' }, { id: 'r-2', companyId: 'co-2' }],
    });

    const result = await useCase.execute();

    assert.deepEqual(shadowRecords, [
      { surface: 'ai.draft.drain', companyId: 'co-1', featureKey: 'ai_line_assistant' },
      { surface: 'ai.draft.drain', companyId: 'co-2', featureKey: 'ai_line_assistant' },
    ]);
    assert.deepEqual(flushes, ['ai.draft.drain']);
    // SHADOW ONLY: both requests still generate.
    assert.equal(generated.length, 2);
    assert.equal(result.processed, 2);
  });

  it('records BEFORE the model call, so a spend that happened is a spend that was measured', async () => {
    const { useCase, shadowRecords, flushes } = makeDrain({
      queued: [{ id: 'r-1', companyId: 'co-1' }, { id: 'r-2', companyId: 'co-2' }],
      generateThrows: true,
    });

    await assert.rejects(() => useCase.execute(), /model call blew up/);

    // Mutation guard: move `await sweep.flush()` out of the `finally` and this fails — the first
    // item's observation would vanish with no bucket row AND no persist_failed warn, leaving the
    // health view looking normal while a BLOCKING observation had been dropped.
    assert.equal(shadowRecords.length, 1);
    assert.deepEqual(flushes, ['ai.draft.drain']);
  });

  it('flushes an empty drain without recording anything, and keeps the batch clamp', async () => {
    const { useCase, shadowRecords, flushes, batchSizes } = makeDrain({ queued: [] });
    await useCase.execute(500);
    assert.deepEqual(shadowRecords, []);
    assert.deepEqual(flushes, ['ai.draft.drain']);
    assert.deepEqual(batchSizes, [100], 'the pre-existing 1..100 clamp is untouched');
  });
});
