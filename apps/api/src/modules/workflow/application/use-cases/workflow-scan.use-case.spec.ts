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
import { isReimbursementClaimApprover } from '@watchdog-bms/contracts';
import { RunWorkflowScanUseCase } from './workflow-scan.use-case';
import { WorkflowScanCandidatesProvider } from './workflow-scan-candidates.use-case';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { WORKFLOW_TEMPLATE_CATALOG, WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS } from '../../domain/workflow-template-catalog';
import { evaluateCondition } from '../../domain/logic/workflow-condition.logic';

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

/**
 * Audit B9: the only reminder covered claims waiting for approval, so a claim waiting for payment
 * was never chased. It rides the same SLA scan and the same policy deadline; these tests pin what
 * the scan offers the rule and when the rule's own condition fires.
 */
describe('payment reminder candidates (audit B9)', () => {
  const NOW = new Date('2026-10-01T12:00:00.000Z');
  const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);
  const claim = (extra: Record<string, unknown>) => ({
    id: 'rb-1', requestNo: 'RB-202610-00001', status: 'READY_FOR_PAYMENT', amount: '250', outstandingAmount: '250',
    currency: 'THB', requesterUserId: 'u_staff', financeReviewStatus: 'NOT_REQUIRED',
    submittedAt: hoursAgo(200), approvedAt: hoursAgo(100), ...extra,
  });
  const step = (extra: Record<string, unknown>) => ({
    companyId: 'co-1', reimbursementRequestId: 'rb-1', status: 'APPROVED', invalidatedAt: null,
    decisionByUserId: 'u_manager', decidedAt: hoursAgo(100), ...extra,
  });
  const template = () => WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_payment_sla_breach')!;

  function provider(rows: any[], policy: Record<string, unknown> | null = { slaHours: 48 }, steps: any[] = [], voids: any[] = []) {
    const queries: any[] = [];
    const reimbursementRepo = {
      findPolicy: async () => policy,
      listRequests: async (where: any) => { queries.push(where); return rows; },
    } as any;
    // The real repository over stored steps, so the "who approved it" rule is the one under test.
    const workflowRepo = new PrismaWorkflowRepository({
      client: {
        reimbursementApprovalStep: {
          findMany: async ({ where }: any) => steps
            .filter((row) => row.companyId === where.companyId && where.reimbursementRequestId.in.includes(row.reimbursementRequestId)
              && row.status === where.status && row.invalidatedAt === where.invalidatedAt && row.decisionByUserId != null && row.decidedAt != null)
            .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime()),
        },
        reimbursementPayment: {
          findMany: async ({ where }: any) => voids
            .filter((row) => (row.companyId ?? 'co-1') === where.companyId && where.reimbursementRequestId.in.includes(row.reimbursementRequestId)
              && row.status === where.status && row.voidedAt != null)
            .sort((a, b) => a.voidedAt.getTime() - b.voidedAt.getTime()),
        },
      },
    } as any);
    // Who would approve a claim under the policy: the reimbursement module's own resolver, faked.
    const wouldApproveAsked: any[] = [];
    const approverRoutes = {
      resolveWouldBeApproverUserIds: async (...args: any[]) => { wouldApproveAsked.push(args); return ['u_manager', 'u_manager_2']; },
    } as any;
    return {
      candidates: new WorkflowScanCandidatesProvider(reimbursementRepo, {} as any, {} as any, {} as any, {} as any, approverRoutes, workflowRepo),
      queries, wouldApproveAsked,
    };
  }
  const fires = (payload: Record<string, unknown>) => evaluateCondition(template().defaultConditionJson, payload, NOW).matched;

  it('D2: suppresses confirmed duplicates and preserves the payment turn for unresolved and clear claims', async () => {
    const { candidates, queries } = provider([
      claim({ id: 'confirmed', confirmedDuplicateExpenseCount: 1 }),
      claim({ id: 'unresolved', duplicateCandidates: [{ status: 'OPEN', candidateType: 'ATTACHMENT_CHECKSUM' }] }),
      claim({ id: 'own-unresolved', duplicateConfirmationPendingCount: 1 }),
      claim({ id: 'clear' }),
    ], { slaHours: 48, duplicatePolicy: 'BLOCK_PAYMENT' }, ['confirmed', 'unresolved', 'own-unresolved', 'clear'].map((id) => step({ reimbursementRequestId: id })));
    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);
    assert.deepEqual(items.map((item) => [item.sourceId, item.payload.paymentDuplicateBlock, item.payload.approvedByUserId]),
      [['unresolved', 'UNRESOLVED', 'u_manager'], ['own-unresolved', 'UNRESOLVED', 'u_manager'], ['clear', 'NONE', 'u_manager']]);
    assert.equal(queries[0].withDuplicateCandidates, true);
    for (const policy of ['WARN', 'BLOCK_SUBMIT']) {
      const { candidates } = provider([claim({ confirmedDuplicateExpenseCount: 1 })], { slaHours: 48, duplicatePolicy: policy });
      assert.deepEqual(await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW), []);
    }
  });

  // Review: offering every waiting claim wrote a skipped run row per claim per hour in every
  // company. Only a claim past its deadline is offered; the rest cost nothing downstream.
  it('offers only the claims waiting for payment past the policy deadline', async () => {
    const { candidates, queries } = provider([
      claim({ id: 'rb-late', approvedAt: hoursAgo(49) }),
      claim({ id: 'rb-fresh', approvedAt: hoursAgo(47) }),
    ]);

    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.deepEqual(queries, [{ companyId: 'co-1', statuses: ['READY_FOR_PAYMENT', 'PARTIALLY_PAID'], withDuplicateCandidates: true }]);
    assert.deepEqual(items.map((item) => [item.sourceType, item.sourceId, fires(item.payload)]), [
      ['reimbursement_request', 'rb-late', true],
    ]);
    assert.deepEqual(items[0]!.payload, {
      requestId: 'rb-late', requestNo: 'RB-202610-00001', ageHours: 49, slaRisk: true, amount: '250', currency: 'THB', paymentDuplicateBlock: 'NONE',
      requesterUserId: 'u_staff', approverRecipientUserIds: ['u_manager', 'u_manager_2'],
      notificationPeriodKey: `payable:${hoursAgo(49).toISOString()}`,
    });
  });

  // Final review W4: the payment endpoint refuses a claim being cancelled, so nobody is late paying it.
  it('offers no claim that is being cancelled, however long it has waited', async () => {
    const { candidates } = provider([
      claim({ id: 'rb-late' }),
      claim({ id: 'rb-being-cancelled', cancellationPendingAt: hoursAgo(60) }),
    ]);
    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);
    assert.deepEqual(items.map((item) => item.sourceId), ['rb-late']);
  });

  // Review M1: a reminder is one push per period, not one per scan window. For a claim waiting for
  // payment the period is the time it became payable, which a void starts again.
  it('files the reminder under the time the claim became payable, and a void starts both that and the clock again', async () => {
    const paidThenVoided = claim({ id: 'rb-voided', approvedAt: hoursAgo(300) });
    const { candidates } = provider([claim({ id: 'rb-plain', approvedAt: hoursAgo(60) }), paidThenVoided], undefined, [], [
      { reimbursementRequestId: 'rb-voided', status: 'VOIDED', voidedAt: hoursAgo(200) },
      { reimbursementRequestId: 'rb-voided', status: 'VOIDED', voidedAt: hoursAgo(10) },
      { reimbursementRequestId: 'rb-voided', status: 'RECORDED', voidedAt: null },
      { reimbursementRequestId: 'rb-plain', status: 'VOIDED', voidedAt: hoursAgo(5), companyId: 'co-2' },
    ]);

    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    // Approved 300 hours ago, but payable again only since the last void 10 hours ago: not late yet.
    assert.deepEqual(items.map((item) => item.sourceId), ['rb-plain']);
    assert.equal(items[0]!.payload['notificationPeriodKey'], `payable:${hoursAgo(60).toISOString()}`);

    // Once the deadline passes again, counted from that void, it is a new period and a new reminder.
    const later = new Date(NOW.getTime() + 40 * 3_600_000);
    const voided = (await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', later)).find((item) => item.sourceId === 'rb-voided');
    assert.equal(voided!.payload['notificationPeriodKey'], `payable:${hoursAgo(10).toISOString()}`);
    assert.equal(voided!.payload['ageHours'], 50);
  });

  // Owner rule 2026-10-01: the reminder goes to whose turn it is. The scan names them from what
  // the claim itself records; the notice then prefers them when they can pay.
  it('names whoever approved the claim in the round it was last sent in', async () => {
    const { candidates } = provider([claim({})], undefined, [
      step({ decisionByUserId: 'u_manager', decidedAt: hoursAgo(100) }),
      // An earlier round: decided before the claim was sent again, and since invalidated.
      step({ decisionByUserId: 'u_old_round', decidedAt: hoursAgo(300), invalidatedAt: hoursAgo(250) }),
      step({ decisionByUserId: 'u_rejecter', status: 'REJECTED', decidedAt: hoursAgo(90) }),
      step({ decisionByUserId: 'u_other_claim', reimbursementRequestId: 'rb-2', decidedAt: hoursAgo(80) }),
      step({ decisionByUserId: 'u_other_company', companyId: 'co-2', decidedAt: hoursAgo(70) }),
    ]);

    const [item] = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.equal(item!.payload['approvedByUserId'], 'u_manager');
    assert.equal(item!.payload['requesterUserId'], 'u_staff');
    assert.equal(item!.payload['financeReviewerUserId'], undefined);
  });

  it('names the finance reviewer too when the claim went through finance review', async () => {
    const { candidates } = provider(
      [claim({ financeReviewStatus: 'APPROVED_FOR_PAYMENT', financeReviewedByUserId: 'u_finance', financeReviewedAt: hoursAgo(60) })],
      undefined, [step({})],
    );

    const [item] = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.equal(item!.payload['financeReviewerUserId'], 'u_finance');
    assert.equal(item!.payload['approvedByUserId'], 'u_manager');
    // The notice asks the finance reviewer first, then the approver, then the would-be approvers.
    assert.deepEqual(template().defaultActionJson[0]!.configJson['preferRecipientPayloadKeys'], ['financeReviewerUserId', 'approvedByUserId', 'approverRecipientUserIds']);
    assert.deepEqual(template().defaultActionJson[0]!.configJson['neverPreferRecipientPayloadKeys'], ['requesterUserId']);
  });

  // Review: the ready-to-pay notice of a claim that needed no approval asked the people who would
  // have approved it, but its reminder went to everyone able, the shop owner included.
  it('names the would-be approvers for a claim nobody passed or approved, and only for such a claim', async () => {
    const { candidates, wouldApproveAsked } = provider(
      [
        claim({ id: 'rb-auto', branchId: 'br-1' }),
        claim({ id: 'rb-resent', submittedAt: hoursAgo(50) }),
        claim({ id: 'rb-approved' }),
      ],
      { slaHours: 48, defaultApproverRole: 'MANAGER' },
      [step({ reimbursementRequestId: 'rb-resent', decidedAt: hoursAgo(120) }), step({ reimbursementRequestId: 'rb-approved' })],
    );

    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.deepEqual(items.map((item) => [item.sourceId, item.payload['approvedByUserId'], item.payload['approverRecipientUserIds']]), [
      ['rb-auto', undefined, ['u_manager', 'u_manager_2']],
      // Its only approval predates the last submission, so nobody approved it in this round.
      ['rb-resent', undefined, ['u_manager', 'u_manager_2']],
      ['rb-approved', 'u_manager', undefined],
    ]);
    // Asked with the company, its current policy and the claim, and never for a claim that has an approver.
    assert.equal(wouldApproveAsked.length, 2);
    assert.deepEqual([wouldApproveAsked[0][0], wouldApproveAsked[0][1].defaultApproverRole, wouldApproveAsked[0][2].id, wouldApproveAsked[0][2].branchId], ['co-1', 'MANAGER', 'rb-auto', 'br-1']);
  });

  it('still reminds, naming nobody, when the would-be approvers cannot be resolved', async () => {
    const { candidates } = provider([claim({ id: 'rb-auto' })]);
    (candidates as any).approverRoutes = { resolveWouldBeApproverUserIds: async () => { throw new Error('lookup failed'); } };

    const [item] = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.equal(item!.sourceId, 'rb-auto');
    assert.equal(item!.payload['approverRecipientUserIds'], undefined);
  });

  it('takes the latest approval still in force when a claim has more than one', async () => {
    const { candidates } = provider([claim({})], undefined, [
      step({ decisionByUserId: 'u_first', decidedAt: hoursAgo(150) }),
      step({ decisionByUserId: 'u_latest', decidedAt: hoursAgo(100) }),
    ]);

    const [item] = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.equal(item!.payload['approvedByUserId'], 'u_latest');
  });

  // The claim's own approver has one definition, `isReimbursementClaimApprover` in contracts (who may
  // see the claim's account number and open its payment slip). The scan cannot call it from a query
  // and restates it, so the two are held together here: the scan names somebody exactly when that
  // rule has somebody, and it is the same person.
  it('names an approver exactly when the claim approver rule in contracts has one', async () => {
    const claims = [
      claim({ id: 'rb-approved' }),
      claim({ id: 'rb-resent', submittedAt: hoursAgo(50) }),
      claim({ id: 'rb-at-submit', submittedAt: hoursAgo(100) }),
      claim({ id: 'rb-undone' }),
      claim({ id: 'rb-rejected' }),
      claim({ id: 'rb-auto' }),
      // No submission in force: nobody is a claim's approver by a past decision.
      claim({ id: 'rb-no-round', submittedAt: undefined }),
    ];
    const steps = [
      step({ reimbursementRequestId: 'rb-approved' }),
      step({ reimbursementRequestId: 'rb-resent', decidedAt: hoursAgo(120) }),
      step({ reimbursementRequestId: 'rb-at-submit', decidedAt: hoursAgo(100) }),
      step({ reimbursementRequestId: 'rb-undone', invalidatedAt: hoursAgo(90) }),
      step({ reimbursementRequestId: 'rb-rejected', status: 'REJECTED' }),
      step({ reimbursementRequestId: 'rb-no-round' }),
    ];
    const { candidates } = provider(claims, undefined, steps);

    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    const named = items.map((item) => [item.sourceId, item.payload['approvedByUserId']]);
    assert.deepEqual(named, claims.map((row: any) => [row.id, isReimbursementClaimApprover('u_manager', {
      submittedAt: row.submittedAt, approvalSteps: steps.filter((entry: any) => entry.reimbursementRequestId === row.id) as any,
    }) ? 'u_manager' : undefined]));
    // Both answers occur, so neither side passes by answering the same thing for every claim.
    assert.deepEqual(named, [
      ['rb-approved', 'u_manager'], ['rb-resent', undefined], ['rb-at-submit', 'u_manager'], ['rb-undone', undefined],
      ['rb-rejected', undefined], ['rb-auto', undefined], ['rb-no-round', undefined],
    ]);
  });

  it('starts the clock at the finance decision when there was one, not at the approval before it', async () => {
    const { candidates } = provider([
      claim({ id: 'rb-passed-recently', approvedAt: hoursAgo(100), financeReviewedAt: hoursAgo(10) }),
      claim({ id: 'rb-passed-long-ago', approvedAt: hoursAgo(100), financeReviewedAt: hoursAgo(60) }),
    ]);

    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.deepEqual(items.map((item) => [item.sourceId, item.payload['ageHours']]), [['rb-passed-long-ago', 60]]);
  });

  // Payout spec §14.4: a corrected payout account is approved again, which sets `approvedAt` anew. A
  // claim finance passed long before became payable again only then.
  it('starts the clock again when a corrected payout account is approved, also for a claim finance passed long before', async () => {
    const { candidates } = provider([
      claim({ id: 'rb-approved-again-recently', financeReviewedAt: hoursAgo(300), approvedAt: hoursAgo(10) }),
      claim({ id: 'rb-approved-again-long-ago', financeReviewedAt: hoursAgo(300), approvedAt: hoursAgo(60) }),
    ]);

    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.deepEqual(items.map((item) => [item.sourceId, item.payload['ageHours'], item.payload['notificationPeriodKey']]),
      [['rb-approved-again-long-ago', 60, `payable:${hoursAgo(60).toISOString()}`]]);
  });

  it('reminds for what is left to pay on a legacy part-paid claim', async () => {
    const { candidates } = provider([claim({ status: 'PARTIALLY_PAID', amount: '250', outstandingAmount: '100' })]);

    const [item] = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.equal(item!.payload['amount'], '100');
    assert.equal(fires(item!.payload), true);
  });

  // Same rule as approvals: the deadline is the company's own, and a company that set none is not
  // chased. It is not even looked at further: no approver or void lookup, no run row.
  it('offers nothing for a company that has not set a deadline in its claim policy', async () => {
    let lookups = 0;
    const { candidates } = provider([claim({ approvedAt: hoursAgo(5000) })], null);
    (candidates as any).workflowRepo = {
      findClaimApprovers: async () => { lookups += 1; return new Map(); },
      findClaimLastPaymentVoids: async () => { lookups += 1; return new Map(); },
    };

    assert.deepEqual(await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW), []);
    assert.equal(lookups, 0);
  });

  // Review: the scan drops a whole company's candidates when the adapter throws, so one claim with
  // a policy snapshot that cannot be read silenced the reminders of all the others.
  it('keeps reminding for the other claims when one claim carries a policy snapshot that cannot be read', async () => {
    const { candidates } = provider([
      claim({ id: 'rb-broken', approvalPolicySnapshotJson: { schemaVersion: 1, unexpected: true } }),
      claim({ id: 'rb-fine' }),
    ]);

    const items = await candidates.forTemplate('reimbursement_payment_sla_breach', 'co-1', NOW);

    assert.deepEqual(items.map((item) => item.sourceId), ['rb-fine']);
  });

  it('is an auto-enabled SLA_SCAN rule on the default scan cadence, and only a notice', () => {
    assert.equal(template().triggerType, 'SLA_SCAN');
    assert.equal(template().autoEnable, true);
    assert.equal(template().status, 'AVAILABLE');
    // The scan templates keep the default rule cooldown; that is the cadence approvals use too.
    assert.equal(WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS['reimbursement_payment_sla_breach'], undefined);
    assert.equal(WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS['approval_sla_breach'], undefined);
    // No task action: a task per scan window is how stale tasks pile up (audit B8).
    assert.deepEqual(template().defaultActionJson.map((action) => action.actionType), ['SEND_NOTIFICATION']);
  });
});

// Review M1: the approval reminder is one push per round the claim was sent in. A claim sent again
// and late again is reminded again; a scan window in the same round is not a new reminder.
describe('approval reminder period (review M1)', () => {
  const NOW = new Date('2026-10-01T12:00:00.000Z');
  const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

  it('files the reminder under the submission round of the claim', async () => {
    const pending = (id: string, submittedAt: Date) => ({
      id, requestNo: `RB-${id}`, status: 'PENDING_APPROVAL', amount: '250', currency: 'THB', requesterUserId: 'u_staff',
      submittedAt, currentApprovalStepId: `step-${id}`,
      approvalSteps: [{ id: `step-${id}`, status: 'PENDING', assignedApproverUserIds: ['u_manager'], approverRoleSnapshot: 'MANAGER' }],
    });
    const reimbursementRepo = {
      findPolicy: async () => ({ slaHours: 48 }),
      listRequests: async () => [pending('rb-1', hoursAgo(72)), pending('rb-2', hoursAgo(1))],
      findActiveApproverUserIds: async (_companyId: string, userIds: string[]) => new Set(userIds),
    } as any;
    const approverRoutes = {
      resolveOwnerRecipientUserIds: async (_companyId: string, inputs: any[]) => inputs.map(() => ['u_owner']),
      resolveSubmissionRoutesBestEffort: async () => [],
    } as any;
    const candidates = new WorkflowScanCandidatesProvider(reimbursementRepo, {} as any, {} as any, {} as any, {} as any, approverRoutes, {} as any);

    const items = await candidates.forTemplate('approval_sla_breach', 'co-1', NOW);

    assert.deepEqual(items.map((item) => [item.sourceId, item.payload['slaRisk'], item.payload['notificationPeriodKey']]), [
      ['rb-1', true, `round:${hoursAgo(72).toISOString()}`],
      ['rb-2', false, `round:${hoursAgo(1).toISOString()}`],
    ]);
    assert.deepEqual(items[0]!.payload['approverRecipientUserIds'], ['u_manager']);
  });

  // Final review W4: approve and reject refuse a claim being cancelled, so no approver is late with it.
  it('chases nobody for a claim that is being cancelled, and chases its approver again once the cancellation is withdrawn', async () => {
    const pending = (id: string, cancellationPendingAt?: Date) => ({
      id, requestNo: `RB-${id}`, status: 'PENDING_APPROVAL', amount: '250', currency: 'THB', requesterUserId: 'u_staff',
      submittedAt: hoursAgo(72), currentApprovalStepId: `step-${id}`, ...(cancellationPendingAt && { cancellationPendingAt }),
      approvalSteps: [{ id: `step-${id}`, status: 'PENDING', assignedApproverUserIds: ['u_manager'], approverRoleSnapshot: 'MANAGER' }],
    });
    let rows = [pending('rb-waiting'), pending('rb-being-cancelled', hoursAgo(60))];
    const reimbursementRepo = {
      findPolicy: async () => ({ slaHours: 48 }),
      listRequests: async () => rows,
      findActiveApproverUserIds: async (_companyId: string, userIds: string[]) => new Set(userIds),
    } as any;
    const approverRoutes = {
      resolveOwnerRecipientUserIds: async (_companyId: string, inputs: any[]) => inputs.map(() => ['u_owner']),
      resolveSubmissionRoutesBestEffort: async () => [],
    } as any;
    const candidates = new WorkflowScanCandidatesProvider(reimbursementRepo, {} as any, {} as any, {} as any, {} as any, approverRoutes, {} as any);

    assert.deepEqual((await candidates.forTemplate('approval_sla_breach', 'co-1', NOW)).map((item) => item.sourceId), ['rb-waiting']);
    rows = [pending('rb-waiting'), pending('rb-being-cancelled')];
    assert.deepEqual((await candidates.forTemplate('approval_sla_breach', 'co-1', NOW)).map((item) => [item.sourceId, item.payload['slaRisk']]),
      [['rb-waiting', true], ['rb-being-cancelled', true]]);
  });

  // Payout spec §14.7: a claim sent back to have its payout account corrected is PENDING_APPROVAL. While
  // it is with its requester no approver is late with it; once the account is given, its approvers have
  // waited since then, not since the claim was first sent.
  it('chases nobody for a claim that waits for its requester, and counts a corrected account from when it was given', async () => {
    const setAside = { id: 'step-1', status: 'APPROVED', assignedApproverUserIds: ['u_manager'], approverRoleSnapshot: 'MANAGER', invalidatedAt: hoursAgo(100), invalidatedReason: 'payout_account_correction' };
    const inRound = (id: string, payoutCorrectionSubmittedAt?: Date) => ({
      id, requestNo: `RB-${id}`, status: 'PENDING_APPROVAL', amount: '250', currency: 'THB', requesterUserId: 'u_staff',
      submittedAt: hoursAgo(200), payoutCorrectionRequestedAt: hoursAgo(100),
      ...(payoutCorrectionSubmittedAt
        ? { payoutCorrectionSubmittedAt, currentApprovalStepId: 'step-2', approvalSteps: [setAside, { id: 'step-2', status: 'PENDING', assignedApproverUserIds: ['u_manager'], approverRoleSnapshot: 'MANAGER' }] }
        : { currentApprovalStepId: null, approvalSteps: [setAside] }),
    });
    const reimbursementRepo = {
      findPolicy: async () => ({ slaHours: 48 }),
      listRequests: async () => [inRound('rb-with-requester'), inRound('rb-given-recently', hoursAgo(3)), inRound('rb-given-long-ago', hoursAgo(60))],
      findActiveApproverUserIds: async (_companyId: string, userIds: string[]) => new Set(userIds),
    } as any;
    const approverRoutes = {
      resolveOwnerRecipientUserIds: async (_companyId: string, inputs: any[]) => inputs.map(() => ['u_owner']),
      resolveSubmissionRoutesBestEffort: async () => [],
    } as any;
    const candidates = new WorkflowScanCandidatesProvider(reimbursementRepo, {} as any, {} as any, {} as any, {} as any, approverRoutes, {} as any);

    const items = await candidates.forTemplate('approval_sla_breach', 'co-1', NOW);

    assert.deepEqual(items.map((item) => [item.sourceId, item.payload['slaRisk'], item.payload['ageHours'], item.payload['notificationPeriodKey']]), [
      ['rb-given-recently', false, 3, `round:${hoursAgo(3).toISOString()}`],
      // Late by its own wait, and a reminder of its own: the period is the round, not the first submission.
      ['rb-given-long-ago', true, 60, `round:${hoursAgo(60).toISOString()}`],
    ]);
    assert.deepEqual(items.map((item) => item.payload['approverRecipientUserIds']), [['u_manager'], ['u_manager']]);
  });
});

// Owner decision 2026-10-02: the approval reminder is for the claim's approvers, and for the shop owner only when
// none of them can act. The scan decides who that is, and the notice names nobody else. Before, a claim from before
// approvers were frozen on the step, whose role can no longer approve, named nobody: only the owner's separate
// mention in the notice reached anyone.
describe('approval reminder: who the scan names as the people to approve an overdue claim', () => {
  const NOW = new Date('2026-10-01T12:00:00.000Z');
  const sentAt = new Date(NOW.getTime() - 72 * 3_600_000);
  /** An overdue claim on a step that names these approvers, or (sent before steps named anyone) only its role. */
  const overdue = (id: string, assignedApproverUserIds?: string[]) => ({
    id, requestNo: `RB-${id}`, status: 'PENDING_APPROVAL', amount: '250', currency: 'THB', requesterUserId: 'u_staff', branchId: 'br-1',
    submittedAt: sentAt, currentApprovalStepId: `step-${id}`,
    approvalSteps: [{ id: `step-${id}`, status: 'PENDING', approverRoleSnapshot: 'MANAGER', ...(assignedApproverUserIds && { assignedApproverUserIds }) }],
  });

  it('names the approvers of the step who can still act, and the shop owner only when none of them can', async () => {
    const reimbursementRepo = {
      findPolicy: async () => ({ slaHours: 48 }),
      listRequests: async () => [
        overdue('rb-approvers', ['u_manager', 'u_left']),
        overdue('rb-nobody-left', ['u_left']),
        overdue('rb-route'),
        overdue('rb-dead-route'),
      ],
      // u_left no longer holds what approving asks of them.
      findActiveApproverUserIds: async (_companyId: string, userIds: string[]) => new Set(userIds.filter((userId) => userId !== 'u_left')),
    } as any;
    const routeInputs: any[] = [];
    const approverRoutes = {
      resolveOwnerRecipientUserIds: async (_companyId: string, inputs: any[]) => inputs.map(() => ['u_owner']),
      // Today's route of a step that names nobody: the holders of its role, or none when the role can no longer approve.
      resolveSubmissionRoutesBestEffort: async (_companyId: string, inputs: any[]) => {
        routeInputs.push(...inputs);
        return [{ recipientUserIds: ['u_manager_2'], effectiveTaskRole: 'MANAGER' }, null];
      },
    } as any;
    const candidates = new WorkflowScanCandidatesProvider(reimbursementRepo, {} as any, {} as any, {} as any, {} as any, approverRoutes, {} as any);

    const items = await candidates.forTemplate('approval_sla_breach', 'co-1', NOW);

    assert.deepEqual(items.map((item) => [item.sourceId, item.payload['slaRisk'], item.payload['approverRecipientUserIds'], item.payload['approverTaskUserId'], item.payload['approverTaskRole']]), [
      // The approvers frozen on the step who can still act: not the one who left, and not the owner beside them.
      ['rb-approvers', true, ['u_manager'], 'u_manager', 'MANAGER'],
      // None of them can: the owner approves it now, and is the one reminded.
      ['rb-nobody-left', true, ['u_owner'], 'u_owner', 'OWNER'],
      // A step that names nobody: today's holders of its role.
      ['rb-route', true, ['u_manager_2'], 'u_manager_2', 'MANAGER'],
      // Its role can no longer approve and the route finds nobody: the owner, where it named nobody at all.
      ['rb-dead-route', true, ['u_owner'], 'u_owner', 'MANAGER'],
    ]);
    // Only the two steps that name nobody ask for today's route.
    assert.equal(routeInputs.length, 2);
    // The owner is still named apart in the payload, for a rule pinned before the notice stopped reading it.
    assert.deepEqual(items.map((item) => item.payload['ownerRecipientUserIds']), [['u_owner'], ['u_owner'], ['u_owner'], ['u_owner']]);
    // What the notice reads: the approvers and nobody else.
    const notice = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'approval_sla_breach')!.defaultActionJson.find((action) => action.actionType === 'SEND_NOTIFICATION')!;
    assert.deepEqual(notice.configJson['recipientPayloadKeys'], ['approverRecipientUserIds']);
  });
});
