/**
 * Shadow coverage for the workflow action-retry sweep (piece 5).
 *
 * This sweep re-executes FAILED_RETRYABLE actions cross-tenant with no entitlement check today
 * (F0 async inventory §5c). The probe measures what the guard would decide; nothing branches on it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RetryDueWorkflowActionsUseCase } from './workflow-retry.use-case';

function makeRetry(opts: { due?: any[]; missingRun?: boolean; executeThrows?: boolean } = {}) {
  const shadowRecords: any[] = [];
  const flushes: string[] = [];
  const executed: any[] = [];

  const repo = {
    listRetryableActionRuns: async () => opts.due ?? [],
    findRunById: async (companyId: string, runId: string) =>
      (opts.missingRun ? null : { companyId, id: runId, ruleName: 'r', payloadJson: {}, actions: [] }),
  } as any;
  const executeAction = {
    execute: async (actionRun: any) => {
      executed.push(actionRun);
      if (opts.executeThrows) throw new Error('action blew up');
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

  return { useCase: new RetryDueWorkflowActionsUseCase(repo, executeAction, shadow), shadowRecords, flushes, executed };
}

const actionRun = (companyId: string) => ({ id: `ar-${companyId}`, companyId, workflowRunId: `wr-${companyId}`, attemptCount: 1 });

describe('RetryDueWorkflowActionsUseCase shadow coverage', () => {
  it('records one observation per due action run under workflow_automation', async () => {
    const { useCase, shadowRecords, flushes, executed } = makeRetry({ due: [actionRun('co-1'), actionRun('co-2')] });
    const result = await useCase.execute();

    assert.deepEqual(shadowRecords, [
      { surface: 'workflow.action.retry', companyId: 'co-1', featureKey: 'workflow_automation' },
      { surface: 'workflow.action.retry', companyId: 'co-2', featureKey: 'workflow_automation' },
    ]);
    assert.deepEqual(flushes, ['workflow.action.retry']);
    // SHADOW ONLY: both retries still execute.
    assert.equal(executed.length, 2);
    assert.equal(result.attempted, 2);
  });

  it('counts an action whose parent run has vanished', async () => {
    const { useCase, shadowRecords, executed } = makeRetry({ due: [actionRun('co-1')], missingRun: true });
    const result = await useCase.execute();
    assert.equal(shadowRecords.length, 1);
    assert.equal(executed.length, 0);
    assert.equal(result.attempted, 0);
  });

  it('flushes buffered evidence when an action throws mid-sweep (finally, not a trailing await)', async () => {
    const { useCase, shadowRecords, flushes } = makeRetry({ due: [actionRun('co-1'), actionRun('co-2')], executeThrows: true });
    await assert.rejects(() => useCase.execute(), /action blew up/);
    // Mutation guard — see `workflow-scan.use-case.spec.ts`.
    assert.equal(shadowRecords.length, 1);
    assert.deepEqual(flushes, ['workflow.action.retry']);
  });
});
