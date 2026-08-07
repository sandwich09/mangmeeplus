import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReimbursementProjectionReconcilerService } from './reimbursement-projection-reconciler.service';

/**
 * Freeze in place (owner decision 2026-08-04). This reconciler selects intents across ALL tenants
 * with no company filter and runs them under a synthetic system context with `permissions: []`, so it
 * never meets the resolver chokepoint that delivers the freeze. Without its own entitlement read it
 * would keep advancing claims to READY_FOR_PAYMENT, materializing claim-born expenses and enqueueing
 * notification outbox events for a family the tenant can no longer even open.
 */
function makeService(entitlements: Array<{ featureKey: string; enabled: boolean }>) {
  const request = {
    id: 'req-1',
    companyId: 'co-frozen',
    requestNo: 'RB-0001',
    requesterUserId: 'user-1',
    branchId: undefined,
    amount: 1000,
    currency: 'THB',
  } as any;
  const calls: string[] = [];
  const repo = {
    listPendingProjectionIntents: async () => [{ request, kind: 'MANAGER' as const, actorUserId: 'mgr-1', approvalStepId: 'step-1' }],
    listPendingCancellationIntents: async () => [{ request, actorUserId: 'mgr-1', reason: 'ยกเลิก' }],
    findPolicy: async () => { calls.push('findPolicy'); return null; },
    listClaimProjections: async () => { calls.push('listClaimProjections'); return []; },
    completeApprovalProjectionAtomic: async () => { calls.push('completeApprovalProjectionAtomic'); },
    completeCancellationAtomic: async () => { calls.push('completeCancellationAtomic'); },
  } as any;
  const projections = { execute: async () => { calls.push('projections.execute'); } } as any;
  const audit = { log: async () => { calls.push('audit.log'); } } as any;
  const voidExpense = { executeForReimbursement: async () => { calls.push('voidExpense'); } } as any;
  const prisma = {
    client: { companyFeatureEntitlement: { findMany: async () => entitlements } },
  } as any;
  return {
    service: new ReimbursementProjectionReconcilerService(repo, projections, audit, voidExpense, prisma),
    calls,
  };
}

describe('ReimbursementProjectionReconcilerService — freeze in place', () => {
  it('leaves a frozen company\'s intents pending and touches nothing', async () => {
    const { service, calls } = makeService([
      { featureKey: 'reimbursement', enabled: false },
      { featureKey: 'expenses', enabled: true },
    ]);
    const result = await service.execute();
    assert.deepEqual(result, { completed: [], failed: [] });
    assert.deepEqual(calls, [], 'no projection, no status flip, no audit row, no outbox event');
  });

  // The orchestrator materializes and confirms an ExpenseRecord per claim line, so a frozen
  // `expenses` family stops this drain too. Contracts forbid a reimbursement ⇒ expenses dependency
  // edge, so both keys are read from the same entitlement query instead of being declared.
  it('leaves intents pending when expenses is frozen even though reimbursement is on', async () => {
    const { service, calls } = makeService([
      { featureKey: 'reimbursement', enabled: true },
      { featureKey: 'expenses', enabled: false },
    ]);
    const result = await service.execute();
    assert.deepEqual(result, { completed: [], failed: [] });
    assert.deepEqual(calls, [], 'no claim-born expense is materialized into a frozen family');
  });

  it('runs normally while the family is on', async () => {
    const { service, calls } = makeService([
      { featureKey: 'reimbursement', enabled: true },
      { featureKey: 'expenses', enabled: true },
    ]);
    const result = await service.execute();
    assert.deepEqual(result.failed, []);
    assert.deepEqual(result.completed, ['req-1', 'req-1'], 'the projection and the cancellation both run');
    assert.ok(calls.includes('projections.execute'));
    assert.ok(calls.includes('completeApprovalProjectionAtomic'));
    assert.ok(calls.includes('completeCancellationAtomic'));
  });

  it('still runs for a legacy company with no entitlement rows at all (fail-open)', async () => {
    // The canonical evaluator's null sentinel. A company-status filter would strand exactly the
    // partial projections this reconciler exists to repair.
    const { service, calls } = makeService([]);
    await service.execute();
    assert.ok(calls.includes('projections.execute'));
  });
});
