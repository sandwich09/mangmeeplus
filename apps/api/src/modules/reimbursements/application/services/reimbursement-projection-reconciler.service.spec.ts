import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ReimbursementProjectionReconcilerService } from './reimbursement-projection-reconciler.service';
import { ListReimbursementApproverOptionsUseCase } from '../use-cases/reimbursement-policy.use-case';

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
    service: new ReimbursementProjectionReconcilerService(repo, projections, audit, voidExpense, prisma, {} as any),
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

/**
 * Owner rule 2026-10-01: the ready-to-pay notice of a claim nobody had to approve asks first the
 * people who would have approved it. The live submit names them on the event; a replay must name
 * the same people, or the same claim would notify differently depending on who finished it. The
 * REAL route resolver runs here over role fixtures.
 */
describe('ReimbursementProjectionReconcilerService replay of a claim that needed no approval', () => {
  const permissions = (...keys: string[]) => keys.map((key) => ({ permission: { key } }));
  const approverRole = (key: string, userIds: string[], branchScope: Record<string, unknown> = { branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null, branchScopes: [] }) => ({
    key, name: key, scopeKey: 'system', status: 'ACTIVE',
    permissions: permissions('reimbursement.read', 'reimbursement.approve', 'reimbursement.reject'),
    memberships: userIds.map((userId) => ({ membership: { userId, ...branchScope, roles: [{ role: { key, status: 'ACTIVE' } }] } })),
  });

  function replay(kind: 'POLICY' | 'MANAGER' | 'FINANCE', roles: any[], policy: Record<string, unknown> | null = null, approvalSteps: any[] = []) {
    const request = {
      id: 'req-1', companyId: 'co-1', requestNo: 'RB-0001', requesterUserId: 'staff-1', branchId: 'br-1',
      amount: '80.0000', currency: 'THB', approvalSteps,
    } as any;
    const outbox: any[] = [];
    const tx = { outboxEvent: { createMany: async ({ data }: any) => { outbox.push(...data); } } };
    const complete = async (input: any) => { await input.onReadyPersisted(tx); };
    const repo = {
      listPendingProjectionIntents: async () => [{ request, kind, actorUserId: kind === 'POLICY' ? 'staff-1' : kind === 'FINANCE' ? 'fin-1' : 'mgr-1', approvalStepId: 'step-1' }],
      listPendingCancellationIntents: async () => [],
      findPolicy: async () => policy,
      completeApprovalProjectionAtomic: complete,
      completeFinanceProjectionAtomic: complete,
      completePolicyProjectionAtomic: complete,
    } as any;
    const prisma = {
      client: {
        companyFeatureEntitlement: { findMany: async () => [] },
        role: { findMany: async () => roles },
        branch: { findMany: async () => [{ id: 'br-1', name: 'สาขาหลัก' }] },
      },
    } as any;
    const service = new ReimbursementProjectionReconcilerService(
      repo, { execute: async () => undefined } as any, { log: async () => undefined } as any, {} as any, prisma,
      new ListReimbursementApproverOptionsUseCase(prisma),
    );
    return { service, ready: () => outbox.find((row) => row.eventType === 'reimbursement.ready_for_payment')?.payloadJson.data };
  }

  it('names the holders of the policy role who cover the claim branch', async () => {
    const { service, ready } = replay('POLICY', [
      approverRole('MANAGER', ['mgr-1', 'staff-1']),
      approverRole('OWNER', ['owner-1']),
    ]);

    assert.deepEqual((await service.execute()).completed, ['req-1']);

    // staff-1 is the requester and a manager, and a manager may approve their own claim, so the
    // route keeps them. The notice is what never asks a requester alone (neverPreferRecipientPayloadKeys),
    // which is why the event carries the requester next to this list.
    assert.deepEqual(ready().approverRecipientUserIds, ['mgr-1', 'staff-1']);
    assert.equal(ready().requesterUserId, 'staff-1');
  });

  it('falls back to the owner when no holder of the policy role covers the branch, as submission does', async () => {
    const { service, ready } = replay('POLICY', [
      approverRole('MANAGER', ['mgr-other-branch'], { branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'br-2', branchScopes: [] }),
      approverRole('OWNER', ['owner-1']),
    ]);

    await service.execute();

    assert.deepEqual(ready().approverRecipientUserIds, ['owner-1']);
  });

  it('names nobody when nobody could approve, and never for a claim a person did approve', async () => {
    const nobody = replay('POLICY', []);
    assert.deepEqual((await nobody.service.execute()).completed, ['req-1']);
    assert.equal(nobody.ready().approverRecipientUserIds, undefined);

    // An approved claim has its own approver: the actor of the event. No fallback group is added.
    const approved = replay('MANAGER', [approverRole('MANAGER', ['mgr-1', 'mgr-2'])]);
    await approved.service.execute();
    assert.equal(approved.ready().approverRecipientUserIds, undefined);
  });

  // Review: a finance reviewer may not hold the pay right. The live finance review names the
  // claim's own approver on the event, and so does the replay.
  it('names the claim approver when it replays a claim that finance passed', async () => {
    const decided = (hour: number) => new Date(`2026-10-01T0${hour}:00:00.000Z`);
    const finance = replay('FINANCE', [approverRole('MANAGER', ['mgr-1', 'mgr-2'])], null, [
      { status: 'APPROVED', decisionByUserId: 'mgr-earlier', decidedAt: decided(1), invalidatedAt: decided(2) },
      { status: 'APPROVED', decisionByUserId: 'mgr-2', decidedAt: decided(3) },
    ]);

    await finance.service.execute();

    assert.deepEqual(finance.ready().approverRecipientUserIds, ['mgr-2']);
  });
});
