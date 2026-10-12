import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, Logger } from '@nestjs/common';
import { ReimbursementProjectionReconcilerService } from './reimbursement-projection-reconciler.service';
import { ListReimbursementApproverOptionsUseCase } from '../use-cases/reimbursement-policy.use-case';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';

// The pass logs a line per claim; the cases that read those lines capture them themselves.
Logger.overrideLogger(false);

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
    findCancellationBlocker: async () => null,
    findCancellationCertificates: async () => [],
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
    assert.deepEqual(result, { completed: [], failed: [], blocked: [] });
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
    assert.deepEqual(result, { completed: [], failed: [], blocked: [] });
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

  function replay(kind: 'POLICY' | 'MANAGER' | 'FINANCE', roles: any[], policy: Record<string, unknown> | null = null, approvalSteps: any[] = [], submittedAt?: Date) {
    const request = {
      id: 'req-1', companyId: 'co-1', requestNo: 'RB-0001', requesterUserId: 'staff-1', branchId: 'br-1',
      amount: '80.0000', currency: 'THB', approvalSteps, submittedAt,
    } as any;
    const outbox: any[] = [];
    const tx = { outboxEvent: { createMany: async ({ data }: any) => { outbox.push(...data); } } };
    const complete = async (input: any) => { await input.onReadyPersisted(tx); };
    const repo = {
      listPendingProjectionIntents: async () => [{ request, kind, actorUserId: kind === 'POLICY' ? 'staff-1' : kind === 'FINANCE' ? 'fin-1' : 'mgr-1', approvalStepId: 'step-1' }],
      listPendingCancellationIntents: async () => [],
      findPolicy: async () => policy,
      paymentNoticeFacts: async () => ({ paymentDuplicateBlock: 'NONE', duplicateReasons: [] }),
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
    return { service, repo, outbox, ready: () => outbox.find((row) => row.eventType === 'reimbursement.ready_for_payment')?.payloadJson.data };
  }

  it('D2: every projection replay path reads the transaction block without widening recipient payloads', async (t) => {
    for (const kind of ['POLICY', 'MANAGER', 'FINANCE'] as const) for (const block of ['CONFIRMED', 'UNRESOLVED', 'NONE']) await t.test(`${kind}/${block}`, async () => {
      const h = replay(kind, [approverRole('MANAGER', ['mgr-1'])]);
      let reads = 0;
      h.repo.paymentNoticeFacts = async (tx: any) => { assert.ok(tx.outboxEvent); reads++; return { paymentDuplicateBlock: block, duplicateReasons: [] }; };
      assert.deepEqual((await h.service.execute()).failed, []);
      assert.equal(reads, 1);
      assert.equal(!!h.ready(), block !== 'CONFIRMED');
      if (h.ready()) {
        assert.equal(h.ready().paymentDuplicateBlock, block);
        assert.equal(h.ready().requesterUserId, 'staff-1');
        if (kind === 'POLICY') assert.deepEqual(h.ready().approverRecipientUserIds, ['mgr-1']);
      }
      assert.ok(h.outbox.some((event) => event.eventType !== 'reimbursement.ready_for_payment'));
    });
  });

  it('names the holders of the policy role who cover the claim branch, excluding the requester when self-approval is off', async () => {
    const { service, ready } = replay('POLICY', [
      approverRole('MANAGER', ['mgr-1', 'staff-1']),
      approverRole('OWNER', ['owner-1']),
    ]);

    assert.deepEqual((await service.execute()).completed, ['req-1']);

    // The owner's 2026-10-04 rule also applies to managers: a peer can approve, so this is not solo.
    assert.deepEqual(ready().approverRecipientUserIds, ['mgr-1']);
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
    const steps = [
      { status: 'APPROVED', decisionByUserId: 'mgr-earlier', decidedAt: decided(1), invalidatedAt: decided(2) },
      { status: 'APPROVED', decisionByUserId: 'mgr-2', decidedAt: decided(3) },
    ];
    // Sent again at 02:00 and approved by mgr-2 at 03:00: the approver of the round the claim is in.
    const finance = replay('FINANCE', [approverRole('MANAGER', ['mgr-1', 'mgr-2'])], null, steps, decided(2));

    await finance.service.execute();

    assert.deepEqual(finance.ready().approverRecipientUserIds, ['mgr-2']);

    // The same rule as the live finance review (`isReimbursementClaimApprover` in contracts): sent again at
    // 04:00 with no new approval, the claim has no approver of its own and the replay names nobody.
    const resent = replay('FINANCE', [approverRole('MANAGER', ['mgr-1', 'mgr-2'])], null, steps, decided(4));
    await resent.service.execute();
    assert.equal(resent.ready().approverRecipientUserIds, undefined);
  });
});

/**
 * Audit B4. The reconciler was only ever run by hand; it now runs on a schedule, and the same code
 * carries out one claim for the person who presses "ดำเนินการต่อ". So a pass has to get past whatever
 * it meets: one claim, or one company, that cannot be repaired never stops the others; a cancellation
 * a person has to unblock is left to them; and every claim it repairs or fails to repair is one line
 * in the log.
 */
describe('ReimbursementProjectionReconcilerService scheduled pass', () => {
  const claim = (id: string, companyId = 'co-1', over: Record<string, unknown> = {}) => ({
    id, companyId, requestNo: id, requesterUserId: 'staff-1', branchId: 'br-1', amount: '100.0000', currency: 'THB',
    status: 'PENDING_APPROVAL', currentApprovalStepId: `step-${id}`,
    approvalSteps: [{ id: `step-${id}`, status: 'APPROVED', decisionByUserId: 'mgr-1' }], ...over,
  }) as any;

  function pass(options: {
    decided?: any[];
    cancelling?: Array<{ request: any; reason?: string }>;
    /** What stops carrying out a claim's decision, by claim id. */
    projectionFails?: Record<string, unknown>;
    /** What stops voiding a claim's expense record, by claim id. */
    voidFails?: Record<string, unknown>;
    /** Companies whose entitlement read fails. */
    entitlementFails?: string[];
    /** Companies whose family is switched off. */
    frozenCompanies?: string[];
    blockers?: Record<string, unknown>;
    /** The claim as a later read finds it, by claim id. Default: unchanged. */
    latest?: Record<string, any>;
  }) {
    const calls: string[] = [];
    const lines: Array<{ level: 'log' | 'warn'; line: any }> = [];
    // A claim on the cancellation list holds its intent, as the repository's query guarantees.
    const cancelling = (options.cancelling ?? []).map((entry) => ({ ...entry, request: { cancellationPendingAt: new Date('2026-10-01T02:00:00.000Z'), ...entry.request } }));
    const all = [...(options.decided ?? []), ...cancelling.map((entry) => entry.request)];
    const repo = {
      listPendingProjectionIntents: async () => (options.decided ?? []).map((request) => ({ request, kind: 'MANAGER' as const, actorUserId: 'mgr-1', approvalStepId: `step-${request.id}` })),
      listPendingCancellationIntents: async () => cancelling.map(({ request, reason }) => ({ request, actorUserId: 'staff-1', reason: reason ?? 'ลูกค้ายกเลิกงาน' })),
      findPolicy: async () => null,
      findRequestById: async (_companyId: string, id: string) => (options.latest && id in options.latest ? options.latest[id] : all.find((request) => request.id === id) ?? null),
      findCancellationBlocker: async (request: any) => options.blockers?.[request.id] ?? null,
      findCancellationCertificates: async () => [],
      listClaimProjections: async (_companyId: string, id: string) => [{ id: `exp-${id}`, sourceReimbursementLineId: `line-${id}` }],
      assertCancellationPending: async () => undefined,
      completeApprovalProjectionAtomic: async (input: any) => { calls.push(`ready:${input.requestId}`); },
      completeCancellationAtomic: async (input: any) => { calls.push(`cancelled:${input.requestId}`); },
    } as any;
    const projections = { execute: async (_ctx: unknown, request: any) => {
      if (options.projectionFails && request.id in options.projectionFails) throw options.projectionFails[request.id];
      calls.push(`project:${request.id}`);
    } } as any;
    const voidExpense = { executeForReimbursement: async (_ctx: unknown, expenseId: string) => {
      const id = expenseId.replace('exp-', '');
      if (options.voidFails && id in options.voidFails) throw options.voidFails[id];
      calls.push(`void:${id}`);
    } } as any;
    const prisma = { client: { companyFeatureEntitlement: { findMany: async ({ where }: any) => {
      calls.push(`entitlement:${where.companyId}`);
      if (options.entitlementFails?.includes(where.companyId)) throw new Error('entitlement store unavailable');
      return options.frozenCompanies?.includes(where.companyId) ? [{ featureKey: 'reimbursement', enabled: false }, { featureKey: 'expenses', enabled: true }] : [];
    } } } } as any;
    const service = new ReimbursementProjectionReconcilerService(repo, projections, { log: async () => undefined } as any, voidExpense, prisma,
      { resolveWouldBeApproverUserIds: async () => [] } as any);
    (service as any).logger = { log: (line: any) => lines.push({ level: 'log', line }), warn: (line: any) => lines.push({ level: 'warn', line }) };
    return { service, calls, lines, work: () => calls.filter((call) => !call.startsWith('entitlement:')) };
  }

  it('goes on past a claim that cannot be repaired and past a company whose entitlement read fails', async () => {
    const { service, work } = pass({
      decided: [claim('a', 'co-broken'), claim('b', 'co-1'), claim('c', 'co-1')],
      cancelling: [{ request: claim('d', 'co-broken') }, { request: claim('e', 'co-1') }, { request: claim('f', 'co-2') }],
      entitlementFails: ['co-broken'],
      projectionFails: { b: new ConflictException({ code: 'accounting_period_locked', message: 'Accounting period 2026-09 is not open.' }) },
      voidFails: { e: new Error('connection reset') },
    });

    const result = await service.execute();

    assert.deepEqual(result.completed, ['c', 'f'], 'the claims after a failing one are still carried out');
    assert.deepEqual(result.failed.map((row) => row.requestId), ['a', 'b', 'd', 'e']);
    assert.deepEqual(work(), ['project:c', 'ready:c', 'void:f', 'cancelled:f'], 'nothing is done for a claim that failed, and nothing is skipped after it');
  });

  it('reads a company\'s entitlement once per pass, however many of its claims wait', async () => {
    const { service, calls } = pass({ decided: [claim('a'), claim('b')], cancelling: [{ request: claim('c') }, { request: claim('d', 'co-2') }] });
    await service.execute();
    assert.deepEqual(calls.filter((call) => call.startsWith('entitlement:')), ['entitlement:co-1', 'entitlement:co-2']);
  });

  it('leaves a cancellation a person has to unblock to that person: no void is tried for it', async () => {
    const { service, work, lines } = pass({
      cancelling: [
        { request: claim('short'), reason: 'พอ' },
        { request: claim('closed') },
        { request: claim('fine') },
      ],
      blockers: { closed: { code: 'accounting_period_locked', periodKey: '2026-09' } },
    });

    const result = await service.execute();

    assert.deepEqual(result, { completed: ['fine'], failed: [], blocked: ['short', 'closed'] });
    assert.deepEqual(work(), ['void:fine', 'cancelled:fine'], 'a blocked cancellation would fail the same way on every pass, and burn a journal number each time');
    assert.deepEqual(lines.map((entry) => entry.line.requestId), ['fine'], 'a claim left to a person is neither repaired nor failed');
  });

  it('writes one structured line per claim it repairs or fails to repair, with a stable code and no free text', async () => {
    const { service, lines } = pass({
      decided: [claim('ok'), claim('locked'), claim('crashed')],
      cancelling: [{ request: claim('gone', 'co-2') }],
      projectionFails: {
        locked: new ConflictException({ code: 'accounting_period_locked', message: 'Accounting period 2026-09 is not open; reopen it before confirming.' }),
        crashed: new Error('connect ECONNREFUSED 10.0.3.7:5432'),
      },
    });

    await service.execute();

    assert.deepEqual(lines, [
      { level: 'log', line: { msg: 'reimbursement.reconcile.repaired', companyId: 'co-1', requestId: 'ok', kind: 'MANAGER' } },
      { level: 'warn', line: { msg: 'reimbursement.reconcile.failed', companyId: 'co-1', requestId: 'locked', kind: 'MANAGER', code: 'accounting_period_locked' } },
      { level: 'warn', line: { msg: 'reimbursement.reconcile.failed', companyId: 'co-1', requestId: 'crashed', kind: 'MANAGER', code: 'RECONCILE_FAILED' } },
      { level: 'log', line: { msg: 'reimbursement.reconcile.repaired', companyId: 'co-2', requestId: 'gone', kind: 'CANCELLATION' } },
    ]);
  });

  it('does not call it a failure when a person finished, cancelled or is carrying out the same claim at that moment', async () => {
    const changed = () => new ConflictException('reimbursement_projection_decision_changed');
    const { service, lines } = pass({
      decided: [claim('finished'), claim('being-cancelled'), claim('racing')],
      cancelling: [{ request: claim('withdrawn') }, { request: claim('closed-by-person') }],
      projectionFails: {
        finished: changed(), 'being-cancelled': new ConflictException('reimbursement_cancellation_pending'),
        // Two confirmations of the same expense record: PostgreSQL rolls one back.
        racing: Object.assign(new Error('could not serialize access'), { code: 'P2034' }),
      },
      voidFails: { withdrawn: new ConflictException('reimbursement_cancellation_intent_changed'), 'closed-by-person': new ConflictException({ code: 'expense_changed' }) },
      latest: {
        finished: claim('finished', 'co-1', { status: 'READY_FOR_PAYMENT', currentApprovalStepId: undefined }),
        'being-cancelled': claim('being-cancelled', 'co-1', { cancellationPendingAt: new Date() }),
        withdrawn: claim('withdrawn', 'co-1', { cancellationPendingAt: undefined }),
        'closed-by-person': claim('closed-by-person', 'co-1', { status: 'CANCELLED' }),
      },
    });

    const result = await service.execute();

    assert.deepEqual(result, { completed: [], failed: [], blocked: [] });
    // The one claim another party is still writing is named, so a "race" that repeats on every pass is seen.
    assert.deepEqual(lines, [{ level: 'log', line: { msg: 'reimbursement.reconcile.busy', companyId: 'co-1', requestId: 'racing', kind: 'MANAGER', code: 'P2034' } }]);
  });

  describe('one claim, for the person who presses ดำเนินการต่อ', () => {
    it('recognises the translated expense void race in scheduled claim cancellation', async () => {
      const error = new ConflictException({ code: 'expense_changed_retry', message: 'กรุณาลองใหม่' });
      const scheduled = pass({ cancelling: [{ request: claim('a') }], voidFails: { a: error } });
      assert.deepEqual(await scheduled.service.execute(), { completed: [], failed: [], blocked: [] });
      assert.deepEqual(scheduled.lines, [{ level: 'log', line: { msg: 'reimbursement.reconcile.busy', companyId: 'co-1', requestId: 'a', kind: 'CANCELLATION', code: 'expense_changed_retry' } }]);
      assert.deepEqual(scheduled.work(), []);
    });
    it('carries out the decision the claim holds, and does nothing for a claim that holds none', async () => {
      const waiting = pass({ decided: [claim('a')] });
      assert.equal(await waiting.service.repair('co-1', 'a'), true);
      assert.deepEqual(waiting.work(), ['project:a', 'ready:a']);
      assert.deepEqual(waiting.lines.map((entry) => entry.line), [{ msg: 'reimbursement.reconcile.repaired', companyId: 'co-1', requestId: 'a', kind: 'MANAGER', by: 'person' }]);

      // Pressed again after it went through, a claim still waiting for its approver, one being cancelled, one that is gone.
      for (const [id, latest] of [
        ['done', claim('done', 'co-1', { status: 'READY_FOR_PAYMENT', currentApprovalStepId: undefined })],
        ['undecided', claim('undecided', 'co-1', { approvalSteps: [{ id: 'step-undecided', status: 'PENDING' }] })],
        ['cancelling', claim('cancelling', 'co-1', { cancellationPendingAt: new Date() })],
        ['gone', null],
      ] as const) {
        const idle = pass({ latest: { [id]: latest } });
        assert.equal(await idle.service.repair('co-1', id), false, id);
        assert.deepEqual(idle.calls, [], `${id}: nothing is read or written past the claim itself`);
      }
    });

    it('says what stopped it, so the person reads why', async () => {
      const locked = new ConflictException({ code: 'accounting_period_locked', message: 'closed' });
      const { service, work } = pass({ decided: [claim('a')], projectionFails: { a: locked } });
      await assert.rejects(service.repair('co-1', 'a'), (error) => error === locked);
      assert.deepEqual(work(), []);
    });

    it('answers "being carried out" when the scheduled pass holds the same claim, and "nothing left" once that pass finished it', async () => {
      const lost = Object.assign(new Error('could not serialize access'), { code: 'P2034' });
      let reads = 0;
      const racing = pass({ decided: [claim('a')], projectionFails: { a: lost } });
      await assert.rejects(racing.service.repair('co-1', 'a'), /reimbursement_resume_in_progress/);

      const beaten = pass({ decided: [claim('b')], projectionFails: { b: new ConflictException('reimbursement_projection_decision_changed') } });
      const find = (beaten.service as any).repo.findRequestById;
      (beaten.service as any).repo.findRequestById = async (companyId: string, id: string) =>
        (++reads === 1 ? find(companyId, id) : claim('b', 'co-1', { status: 'READY_FOR_PAYMENT', currentApprovalStepId: undefined }));
      assert.equal(await beaten.service.repair('co-1', 'b'), false);
    });

    it('leaves a frozen company\'s claim exactly as it is', async () => {
      const { service, work } = pass({ decided: [claim('a')], frozenCompanies: ['co-1'] });
      await assert.rejects(service.repair('co-1', 'a'), /reimbursement_resume_unavailable/);
      assert.deepEqual(work(), []);
    });
  });
});

// Payout spec §14.2, §14.6: a claim sent back to have its payout account corrected is PENDING_APPROVAL
// with its expense records already built. Its approval moves it on in the approval's own transaction,
// so it never holds a decision for this service to carry out, whoever asks and whatever its steps say.
describe('ReimbursementProjectionReconcilerService and a claim whose payout account is being corrected', () => {
  const sentBackAt = new Date('2026-10-02T03:00:00.000Z');
  const at = new Date('2026-10-01T00:00:00.000Z');
  const setAside = { id: 'step-1', status: 'APPROVED', decisionByUserId: 'mgr-1', decidedAt: at, invalidatedAt: sentBackAt, invalidatedReason: 'payout_account_correction', sequenceNo: 1, assignedAt: at, createdAt: at, updatedAt: at };
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'rb-1', companyId: 'co-1', branchId: 'br-1', requestNo: 'RB-202610-000001', requesterUserId: 'staff-1', requesterDisplayNameSnapshot: 'ผู้เบิก',
    reason: 'แท็กซี่', categoryKey: 'travel', amount: '100.0000', currency: 'THB', incurredDate: at, status: 'PENDING_APPROVAL',
    financeReviewStatus: 'NOT_REQUIRED', paymentStatus: 'NOT_PAYABLE', duplicateStatus: 'NO_MATCH', receiptRequirementStatus: 'ATTACHED',
    postingStatus: 'posted', paymentTotalAmount: '0.0000', outstandingAmount: '100.0000', createdByUserId: 'staff-1', createdAt: at, updatedAt: sentBackAt,
    payoutCorrectionRequestedAt: sentBackAt, lines: [], ...over,
  });
  const withRequester = row({ currentApprovalStepId: null, approvalSteps: [setAside] });
  const withApprovers = row({ currentApprovalStepId: 'step-2', payoutCorrectionSubmittedAt: sentBackAt, approvalSteps: [setAside, { ...setAside, id: 'step-2', status: 'PENDING', decisionByUserId: null, decidedAt: null, invalidatedAt: null, invalidatedReason: null }] });
  // A row no transaction of a round leaves behind: its new step decided, the claim not moved on. Outside a
  // round that is exactly a decision waiting to be carried out.
  const torn = row({ currentApprovalStepId: 'step-2', payoutCorrectionSubmittedAt: sentBackAt, approvalSteps: [setAside, { ...setAside, id: 'step-2', invalidatedAt: null, invalidatedReason: null }] });
  const outsideARound = { ...torn, payoutCorrectionRequestedAt: null, payoutCorrectionSubmittedAt: null };

  function service(claim: any) {
    const calls: string[] = [];
    const repo = {
      findRequestById: async () => new PrismaReimbursementRepository({} as any, {} as any)['toRequest'](claim),
      findPolicy: async () => null,
      completeApprovalProjectionAtomic: async () => { calls.push('ready'); },
    } as any;
    const prisma = { client: { companyFeatureEntitlement: { findMany: async () => [] } } } as any;
    const reconciler = new ReimbursementProjectionReconcilerService(repo, { execute: async () => { calls.push('project'); } } as any,
      { log: async () => undefined } as any, {} as any, prisma, { resolveWouldBeApproverUserIds: async () => [] } as any);
    (reconciler as any).logger = { log: () => undefined, warn: () => undefined };
    return { reconciler, calls };
  }

  it('carries out nothing for it when a person presses "ดำเนินการต่อ"', async () => {
    for (const [phase, claim] of [['with its requester', withRequester], ['with its approvers', withApprovers], ['a torn row', torn]] as const) {
      const { reconciler, calls } = service(claim);
      assert.equal(await reconciler.repair('co-1', 'rb-1'), false, phase);
      assert.deepEqual(calls, [], phase);
    }
    // The same steps on a claim in no round are a decision, and it is carried out.
    const ordinary = service(outsideARound);
    assert.equal(await ordinary.reconciler.repair('co-1', 'rb-1'), true);
    assert.deepEqual(ordinary.calls, ['project', 'ready']);
  });

  // Final review W7: the newest decided claims come first, and the newest of all is the one a live
  // approve, submit or finance request is still carrying out.
  it('asks the database only for decisions made at least a minute ago, in each of the three lists, unless the caller names another moment', async () => {
    const queries: any[] = [];
    const repo = new PrismaReimbursementRepository({ client: { reimbursementRequest: { findMany: async (query: any) => { queries.push(query.where); return []; } } } } as any, {} as any);
    const before = Date.now();
    await repo.listPendingProjectionIntents();
    const after = Date.now();
    assert.deepEqual(queries.map((where) => where.status), ['PENDING_APPROVAL', 'FINANCE_REVIEW', 'APPROVED']);
    for (const where of queries) {
      const cutoff = where.updatedAt?.lt?.getTime();
      assert.ok(cutoff >= before - 60_000 && cutoff <= after - 60_000, `${where.status}: decided before ${where.updatedAt?.lt?.toISOString()}`);
    }
    queries.length = 0;
    const moment = new Date('2026-10-02T03:00:00.000Z');
    await repo.listPendingProjectionIntents(10, moment);
    assert.deepEqual(queries.map((where) => where.updatedAt), [{ lt: moment }, { lt: moment }, { lt: moment }]);
  });

  it('is never on the list the scheduled pass works through: the database is asked for no claim in a round, and none it returns is taken', async () => {
    const queries: any[] = [];
    const answer = (rows: any[]) => new PrismaReimbursementRepository({ client: { reimbursementRequest: { findMany: async (query: any) => {
      queries.push(query.where);
      return query.where.status === 'PENDING_APPROVAL' ? rows : [];
    } } } } as any, {} as any).listPendingProjectionIntents();
    // Whatever the query returned, a claim in a round yields no intent.
    assert.deepEqual(await answer([withRequester, withApprovers, torn]), []);
    assert.deepEqual((await answer([outsideARound])).map((intent) => [intent.request.id, intent.kind, intent.approvalStepId]), [['rb-1', 'MANAGER', 'step-2']]);
    const decided = queries.find((where) => where.status === 'PENDING_APPROVAL');
    assert.equal(decided.payoutCorrectionRequestedAt, null);
    assert.equal('payoutCorrectionRequestedAt' in decided, true);
  });
});
