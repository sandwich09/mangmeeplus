/**
 * Shadow coverage for the workflow scan sweep (piece 5).
 *
 * The scan is one of the `workflow_automation` async surfaces the F0 inventory records as
 * entitlement-blind. These tests pin the two things that make its evidence trustworthy: every
 * scanned rule is counted (including rules the scan then skips), and a mid-sweep throw still
 * flushes what was already observed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RunWorkflowScanUseCase } from './workflow-scan.use-case';

function makeScan(opts: { rules?: any[]; candidatesThrow?: boolean; runnerThrows?: boolean } = {}) {
  const shadowRecords: any[] = [];
  const flushes: string[] = [];
  const runs: any[] = [];

  const repo = { listAllEnabledRulesByTrigger: async () => opts.rules ?? [] } as any;
  const candidates = {
    forTemplate: async () => {
      if (opts.candidatesThrow) throw new Error('source module unavailable');
      return [{ sourceType: 'expense', sourceId: 'x-1', payload: {} }];
    },
  } as any;
  const runner = {
    execute: async (input: any) => {
      runs.push(input);
      if (opts.runnerThrows) throw new Error('runner blew up');
      return { runId: 'r-1', status: 'CREATED' };
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

  return { useCase: new RunWorkflowScanUseCase(repo, candidates, runner, shadow), shadowRecords, flushes, runs };
}

const rule = (companyId: string, templateKey: string | null = 'low_stock') => ({
  companyId,
  triggerType: 'THRESHOLD_SCAN',
  template: templateKey ? { key: templateKey, sourceModule: 'inventory' } : undefined,
});

describe('RunWorkflowScanUseCase shadow coverage', () => {
  it('records one observation per scanned rule under workflow_automation', async () => {
    const { useCase, shadowRecords, flushes } = makeScan({ rules: [rule('co-1'), rule('co-2')] });
    const result = await useCase.execute('THRESHOLD_SCAN');

    assert.deepEqual(shadowRecords, [
      { surface: 'workflow.scan', companyId: 'co-1', featureKey: 'workflow_automation' },
      { surface: 'workflow.scan', companyId: 'co-2', featureKey: 'workflow_automation' },
    ]);
    assert.deepEqual(flushes, ['workflow.scan']);
    // SHADOW ONLY: the scan proceeds exactly as before.
    assert.equal(result.rulesScanned, 2);
    assert.equal(result.runsCreated, 2);
  });

  it('counts a rule whose template is missing — it is still work this tenant would be asked about', async () => {
    const { useCase, shadowRecords, runs } = makeScan({ rules: [rule('co-1', null)] });
    await useCase.execute('SCHEDULE');
    assert.equal(shadowRecords.length, 1);
    assert.equal(runs.length, 0, 'the rule is still skipped — only the denominator changed');
  });

  it('counts a rule whose source module is unavailable this tick', async () => {
    const { useCase, shadowRecords, runs } = makeScan({ rules: [rule('co-1')], candidatesThrow: true });
    await useCase.execute('SLA_SCAN');
    assert.equal(shadowRecords.length, 1);
    assert.equal(runs.length, 0);
  });

  it('flushes buffered evidence when the runner throws mid-sweep (finally, not a trailing await)', async () => {
    const { useCase, shadowRecords, flushes } = makeScan({ rules: [rule('co-1'), rule('co-2')], runnerThrows: true });
    await assert.rejects(() => useCase.execute('THRESHOLD_SCAN'), /runner blew up/);
    // Mutation guard: move `await sweep.flush()` out of the `finally` and this fails — the first
    // rule's observation would be lost with no bucket row AND no persist_failed warn.
    assert.equal(shadowRecords.length, 1);
    assert.deepEqual(flushes, ['workflow.scan']);
  });

  it('flushes an empty sweep without recording anything', async () => {
    const { useCase, shadowRecords, flushes } = makeScan({ rules: [] });
    await useCase.execute('SCHEDULE');
    assert.deepEqual(shadowRecords, []);
    assert.deepEqual(flushes, ['workflow.scan']);
  });
});
