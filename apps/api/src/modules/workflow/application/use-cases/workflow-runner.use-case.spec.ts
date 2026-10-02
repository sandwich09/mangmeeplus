import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RunWorkflowRuleUseCase } from './workflow-runner.use-case';
import { ExecuteWorkflowActionUseCase } from './workflow-action-runner.use-case';

const noopAudit = { log: async () => undefined } as any;
/** SEND_NOTIFICATION never reaches the CALL_WEBHOOK shadow sweep; touching it here is a bug. */
const noShadowSweep = { startSweep: () => { throw new Error('no shadow sweep on this action type'); } } as any;

function baseRule(overrides: Partial<any> = {}): any {
  return {
    id: 'rule-1', companyId: 'co-1', name: 'Test Rule', status: 'ENABLED',
    triggerType: 'EVENT', currentVersion: 1, cooldownSeconds: 3600, lastRunAt: undefined,
    ...overrides,
  };
}

function baseVersion(overrides: Partial<any> = {}): any {
  return {
    id: 'v-1', ruleId: 'rule-1', version: 1, status: 'ENABLED',
    triggerSnapshotJson: {}, conditionSnapshotJson: { field: 'requestId', op: 'EXISTS' },
    actionSnapshotJson: [{ actionKey: 'notify', actionType: 'SEND_NOTIFICATION', configJson: {} }],
    recipientSnapshotJson: {}, cooldownSeconds: 3600,
    ...overrides,
  };
}

function fakeRepo(opts: { version?: any; existingRun?: any } = {}) {
  const runs: any[] = [];
  const actionRuns: any[] = [];
  return {
    findLatestRuleVersion: async () => opts.version ?? baseVersion(),
    findRunByDedupKey: async () => opts.existingRun ?? null,
    createRun: async (data: any) => { const row = { id: 'run-1', ...data }; runs.push(row); return row; },
    updateRun: mock.fn(async (_id: string, data: any) => ({ id: 'run-1', ...data })),
    createActionRun: async (data: any) => { const row = { id: `action-${actionRuns.length + 1}`, attemptCount: 0, ...data }; actionRuns.push(row); return row; },
    findActionRunById: async (_c: string, id: string) => actionRuns.find((a) => a.id === id) ?? { id, status: 'SUCCEEDED' },
  } as any;
}

describe('RunWorkflowRuleUseCase', () => {
  it('skips a disabled rule without creating a run', async () => {
    const repo = fakeRepo();
    const executeAction = { execute: mock.fn(async () => undefined) };
    const uc = new RunWorkflowRuleUseCase(repo, noopAudit, executeAction as any);
    const result = await uc.execute({ rule: baseRule({ status: 'DISABLED' }), triggerType: 'EVENT', dedupKey: 'd1', payload: {}, now: new Date() });
    assert.equal(result.status, 'SKIPPED');
    assert.equal(result.reason, 'rule_not_enabled');
    assert.equal(executeAction.execute.mock.callCount(), 0);
  });

  it('skips on duplicate dedup key without re-running actions', async () => {
    const repo = fakeRepo({ existingRun: { id: 'existing-run-1' } });
    const executeAction = { execute: mock.fn(async () => undefined) };
    const uc = new RunWorkflowRuleUseCase(repo, noopAudit, executeAction as any);
    const result = await uc.execute({ rule: baseRule(), triggerType: 'EVENT', dedupKey: 'd1', payload: { requestId: 'r1' }, now: new Date() });
    assert.equal(result.status, 'SKIPPED');
    assert.equal(result.reason, 'duplicate_dedup_key');
    assert.equal(result.runId, 'existing-run-1');
    assert.equal(executeAction.execute.mock.callCount(), 0);
  });

  it('skips within the cooldown window', async () => {
    const repo = fakeRepo();
    const executeAction = { execute: mock.fn(async () => undefined) };
    const uc = new RunWorkflowRuleUseCase(repo, noopAudit, executeAction as any);
    const now = new Date('2026-07-01T12:00:00.000Z');
    const rule = baseRule({ lastRunAt: new Date(now.getTime() - 10_000), cooldownSeconds: 3600 });
    const result = await uc.execute({ rule, triggerType: 'EVENT', dedupKey: 'd1', payload: { requestId: 'r1' }, now });
    assert.equal(result.status, 'SKIPPED');
    assert.equal(result.reason, 'cooldown');
    assert.equal(executeAction.execute.mock.callCount(), 0);
  });

  // F1: the reimbursement EVENT templates ship cooldown 0 for exactly this reason — the window is
  // per RULE, so a shared non-zero cooldown silences every claim but the first inside it.
  it('runs a second event on the same rule when cooldown is 0 (distinct dedup keys)', async () => {
    const repo = fakeRepo({ version: baseVersion({ cooldownSeconds: 0 }) });
    const executeAction = { execute: mock.fn(async () => undefined) };
    const uc = new RunWorkflowRuleUseCase(repo, noopAudit, executeAction as any);
    const now = new Date('2026-07-01T12:00:00.000Z');

    const first = await uc.execute({
      rule: baseRule({ cooldownSeconds: 0 }), triggerType: 'EVENT',
      dedupKey: 'event:reimbursement.request_submitted:rb-1', payload: { requestId: 'rb-1' }, now,
    });
    const second = await uc.execute({
      rule: baseRule({ cooldownSeconds: 0, lastRunAt: now }), triggerType: 'EVENT',
      dedupKey: 'event:reimbursement.request_submitted:rb-2', payload: { requestId: 'rb-2' },
      now: new Date(now.getTime() + 60_000),
    });

    assert.equal(first.status, 'SUCCEEDED');
    assert.equal(second.status, 'SUCCEEDED');
    assert.equal(executeAction.execute.mock.callCount(), 2);
  });

  it('creates a SKIPPED run (no action runs) when the condition does not match', async () => {
    const repo = fakeRepo();
    const executeAction = { execute: mock.fn(async () => undefined) };
    const uc = new RunWorkflowRuleUseCase(repo, noopAudit, executeAction as any);
    const result = await uc.execute({ rule: baseRule(), triggerType: 'EVENT', dedupKey: 'd1', payload: {}, now: new Date() });
    assert.equal(result.status, 'SKIPPED');
    assert.equal(result.reason, 'condition_not_matched');
    assert.equal(executeAction.execute.mock.callCount(), 0);
  });

  it('creates a run and executes every action when the condition matches', async () => {
    const repo = fakeRepo();
    repo.findActionRunById = async (_c: string, id: string) => ({ id, status: 'SUCCEEDED' });
    const executeAction = { execute: mock.fn(async () => undefined) };
    const uc = new RunWorkflowRuleUseCase(repo, noopAudit, executeAction as any);
    const result = await uc.execute({ rule: baseRule(), triggerType: 'EVENT', dedupKey: 'd1', payload: { requestId: 'r1' }, now: new Date() });
    assert.equal(result.status, 'SUCCEEDED');
    assert.equal(executeAction.execute.mock.callCount(), 1);
  });

  it('marks the run FAILED when every action ends in a failed/dead-lettered state', async () => {
    const repo = fakeRepo();
    repo.findActionRunById = async (_c: string, id: string) => ({ id, status: 'DEAD_LETTERED' });
    const executeAction = { execute: mock.fn(async () => undefined) };
    const uc = new RunWorkflowRuleUseCase(repo, noopAudit, executeAction as any);
    const result = await uc.execute({ rule: baseRule(), triggerType: 'EVENT', dedupKey: 'd1', payload: { requestId: 'r1' }, now: new Date() });
    assert.equal(result.status, 'FAILED');
  });
});

describe('ExecuteWorkflowActionUseCase SEND_NOTIFICATION recipients', () => {
  function actionRun(configJson: Record<string, unknown>): any {
    return {
      id: 'action-1', workflowRunId: 'run-1', actionKey: 'notify', actionType: 'SEND_NOTIFICATION',
      actionConfigSnapshotJson: configJson, attemptCount: 0, idempotencyKey: 'action-key-1', status: 'QUEUED',
    };
  }

  it('merges and deduplicates role recipients with string values from payload keys', async () => {
    const updates: any[] = [];
    const notifications: any[] = [];
    const repo = {
      updateActionRun: async (_id: string, data: any) => { updates.push(data); },
      findUserIdsByRoles: async (_companyId: string, roles: string[]) => {
        assert.deepEqual(roles, ['MANAGER']);
        return ['manager-1', 'requester-1'];
      },
      findUserIdsByPermissions: async () => [],
    } as any;
    const notify = {
      execute: async (input: any) => {
        notifications.push(input);
        return { skipped: false, event: { id: 'notification-1' } };
      },
    } as any;
    const useCase = new ExecuteWorkflowActionUseCase(repo, noopAudit, {} as any, notify, {} as any, noShadowSweep, {} as any);

    await useCase.execute(
      actionRun({ recipientRoles: ['MANAGER'], recipientPayloadKeys: ['requesterUserId', 'watcherUserId', 'notAString'] }),
      {
        companyId: 'co-1', ruleName: 'Decision alert', sourceModule: 'reimbursements',
        sourceType: 'reimbursement_request', sourceId: 'rb-1',
        payload: { requesterUserId: 'requester-1', watcherUserId: 'watcher-1', notAString: 42 },
        siblingActions: [],
      },
    );

    assert.deepEqual(notifications[0]?.recipientUserIds, ['manager-1', 'requester-1', 'watcher-1']);
    assert.equal(updates.at(-1)?.status, 'SUCCEEDED');
  });

  it('keeps the action retryable when neither roles nor payload keys resolve a recipient', async () => {
    const updates: any[] = [];
    const repo = {
      updateActionRun: async (_id: string, data: any) => { updates.push(data); },
      findUserIdsByRoles: async () => [],
      findUserIdsByPermissions: async () => [],
      createDeadLetter: async () => { throw new Error('must not dead-letter on first retryable failure'); },
    } as any;
    const useCase = new ExecuteWorkflowActionUseCase(repo, noopAudit, {} as any, { execute: async () => undefined } as any, {} as any, noShadowSweep, {} as any);

    await useCase.execute(
      actionRun({ recipientPayloadKeys: ['requesterUserId'] }),
      { companyId: 'co-1', ruleName: 'Decision alert', payload: {}, siblingActions: [] },
    );

    assert.equal(updates.at(-1)?.status, 'FAILED_RETRYABLE');
    assert.match(updates.at(-1)?.lastErrorMessage, /recipientPayloadKeys/);
  });
});
