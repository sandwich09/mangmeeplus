import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IngestWorkflowEventUseCase } from './workflow-event-ingest.use-case';
import type { WorkflowEventEnvelope } from '@watchdog-bms/contracts';
import {
  WORKFLOW_TEMPLATE_CATALOG,
  WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS,
  WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG,
  REIMBURSEMENT_REQUEST_LINK,
} from '../../domain/workflow-template-catalog';
import { ruleMatchesEventType } from '../../domain/logic/workflow-event-match.logic';
import { evaluateCondition } from '../../domain/logic/workflow-condition.logic';
import { claimApprovalTaskOutcome, claimIdOfEvent } from '../../domain/logic/workflow-claim-task.logic';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';

function baseEvent(overrides: Partial<WorkflowEventEnvelope> = {}): WorkflowEventEnvelope {
  return {
    eventId: 'evt-1', eventType: 'reimbursement.request_submitted', companyId: 'co-1',
    sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'req-1',
    occurredAt: '2026-07-01T00:00:00.000Z', dedupKey: 'dedup-1', payload: { requestId: 'req-1' }, schemaVersion: 1,
    ...overrides,
  };
}

function fakeRepo(opts: { existing?: any; rules?: any[] } = {}) {
  return {
    findEventInboxByEventId: async () => opts.existing ?? null,
    createEventInbox: async (data: any) => ({ id: 'inbox-1', ...data }),
    updateEventInbox: mock.fn(async () => undefined),
    listEnabledRulesByTrigger: async () => opts.rules ?? [],
  } as any;
}

describe('IngestWorkflowEventUseCase', () => {
  it('catalogs one auto-enabled requester template for both reimbursement decision events', () => {
    const template = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_decision_requester');
    const triggerConfig = WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG['reimbursement_decision_requester'];

    assert.equal(template?.triggerType, 'EVENT');
    // The template row itself still ships not-enabled; the ENABLED *rule* per company comes
    // from autoEnable (sync script / onboarding), which is what "zero admin setup" means.
    assert.equal(template?.defaultEnabled, false);
    assert.equal(template?.autoEnable, true);
    assert.equal(template?.defaultActionJson[0]?.configJson['triggerKey'], 'workflow.reimbursement_decision_requester');
    assert.deepEqual(template?.defaultActionJson[0]?.configJson['recipientPayloadKeys'], ['requesterUserId']);
    assert.equal(ruleMatchesEventType(triggerConfig ?? {}, 'reimbursement.approved'), true);
    assert.equal(ruleMatchesEventType(triggerConfig ?? {}, 'reimbursement.rejected'), true);
  });

  it('auto-enables every reimbursement-flow template, each AVAILABLE and event-bound where applicable', () => {
    const autoKeys = WORKFLOW_TEMPLATE_CATALOG.filter((entry) => entry.autoEnable).map((entry) => entry.key).sort();
    assert.deepEqual(autoKeys, [
      'approval_sla_breach',
      'reimbursement_correction_requester',
      'reimbursement_decision_requester',
      'reimbursement_finance_review',
      'reimbursement_finance_review_pending',
      'reimbursement_payment_recorded',
      'reimbursement_payment_sla_breach',
      'reimbursement_payment_voided',
      'reimbursement_payout_correction_requested',
      'reimbursement_payout_correction_submitted',
      'reimbursement_pending_approval',
      'reimbursement_ready_for_payment',
    ]);
    // An auto-enabled rule is created straight to ENABLED, so a non-AVAILABLE template would
    // produce a rule the admin UI refuses to re-enable.
    for (const key of autoKeys) {
      assert.equal(WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === key)?.status, 'AVAILABLE', key);
    }
    for (const [key, eventType] of [
      ['reimbursement_pending_approval', 'reimbursement.request_submitted'],
      ['reimbursement_correction_requester', 'reimbursement.correction_requested'],
      ['reimbursement_finance_review', 'reimbursement.finance_review_updated'],
      ['reimbursement_finance_review_pending', 'reimbursement.approved'],
      ['reimbursement_finance_review_pending', 'reimbursement.finance_review_requested'],
      ['reimbursement_ready_for_payment', 'reimbursement.ready_for_payment'],
      ['reimbursement_payment_recorded', 'reimbursement.payment_recorded'],
      ['reimbursement_payment_voided', 'reimbursement.payment_voided'],
    ] as const) {
      assert.equal(ruleMatchesEventType(WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG[key] ?? {}, eventType), true, key);
    }
  });

  it('targets the new payment templates at the right recipients with a renderable title', () => {
    const ready = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_ready_for_payment');
    const paid = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_payment_recorded');

    assert.deepEqual(ready?.defaultActionJson[0]?.configJson['recipientPermissions'], ['reimbursement.payment.record']);
    assert.equal(ready?.defaultActionJson[0]?.configJson['severity'], 'action');
    assert.equal(ready?.defaultActionJson[0]?.configJson['titleTemplate'], 'พร้อมจ่ายเบิกจ่าย: {{requestNo}}');
    assert.equal(ready?.defaultActionJson[0]?.configJson['triggerKey'], 'workflow.reimbursement_ready_for_payment');

    assert.deepEqual(paid?.defaultActionJson[0]?.configJson['recipientPayloadKeys'], ['requesterUserId']);
    assert.equal(paid?.defaultActionJson[0]?.configJson['severity'], 'info');
    assert.equal(paid?.defaultActionJson[0]?.configJson['titleTemplate'], 'จ่ายเงินเบิกแล้ว: {{requestNo}}');
    assert.equal(paid?.defaultActionJson[0]?.configJson['triggerKey'], 'workflow.reimbursement_payment_recorded');
  });

  it('routes a correction request to the requester, not back to finance', () => {
    const correction = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_correction_requester');
    const cfg = correction?.defaultActionJson[0]?.configJson ?? {};
    assert.deepEqual(cfg['recipientPayloadKeys'], ['requesterUserId']);
    assert.equal(cfg['deepLinkPathTemplate'], REIMBURSEMENT_REQUEST_LINK);
    assert.equal(
      ruleMatchesEventType(WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG['reimbursement_correction_requester'] ?? {}, 'reimbursement.correction_requested'),
      true,
    );
  });

  it('uses the submission assignment snapshot for both notification and task assignee', () => {
    const template = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_pending_approval');
    const [notifyAction, taskAction] = template?.defaultActionJson ?? [];

    assert.deepEqual(notifyAction?.configJson['recipientPayloadKeys'], ['approverRecipientUserIds']);
    // AC11: the submitter (this event's actor) never gets told their own claim is pending approval.
    assert.deepEqual(notifyAction?.configJson['excludeRecipientPayloadKeys'], ['actorUserId']);
    assert.equal(taskAction?.actionType, 'CREATE_APPROVAL_REVIEW_REQUEST');
    assert.equal(taskAction?.configJson['assigneeUserPayloadKey'], 'approverTaskUserId');
    assert.equal(taskAction?.configJson['assigneeRolePayloadKey'], 'approverTaskRole');
  });

  // F16: every reimbursement alert used to send `body: title`, so LINE printed the same line twice.
  // Step-journey spec §11/§13 (AC10/AC11): every one of these also links straight to the claim's
  // journey page and excludes the event's own actor from its recipients, with a graceful skip
  // (never a dead-lettered retry) when that exclusion empties the recipient list — the exact
  // shape of an owner-only company acting on its own claim. "Ready for payment" keeps its actor
  // (audit B9): they approved, and recording the payment is their next step. So does the arrival at
  // the finance desk (owner decision 2026-10-02), for an approver who reviews finance themselves.
  it('gives every reimbursement notification a body distinct from its title, the journey-page link, and actor exclusion', () => {
    const notifications = WORKFLOW_TEMPLATE_CATALOG
      .filter((entry) => entry.sourceModule === 'reimbursements' && entry.triggerType === 'EVENT')
      .map((entry) => ({ key: entry.key, cfg: entry.defaultActionJson.find((a) => a.actionType === 'SEND_NOTIFICATION')?.configJson ?? {} }));

    assert.equal(notifications.length, 10);
    for (const { key, cfg } of notifications) {
      assert.equal(typeof cfg['bodyTemplate'], 'string', key);
      assert.notEqual(cfg['bodyTemplate'], cfg['titleTemplate'], key);
      // A body worth pushing carries the figures the title does not. The void notice is the one
      // that carries none: it says what happened to the claim, and the claim page has the rest.
      // The paid notice prints the sentence the payment event carries, which holds the amount, how
      // the payment was made and whether a slip is attached (payout spec §17.3).
      // The notice that a claim was sent back for its payout account prints the sentence its event carries
      // too: the reason in the fixed list's own words, and nothing a person typed (payout spec §17.3).
      if (key === 'reimbursement_payment_recorded') assert.equal(cfg['bodyTemplate'], '{{paidNotice}}', key);
      else if (key === 'reimbursement_payout_correction_requested') assert.equal(cfg['bodyTemplate'], '{{payoutCorrectionNotice}}', key);
      else if (key !== 'reimbursement_payment_voided') assert.match(String(cfg['bodyTemplate']), /\{\{(amount|paidAmount)\}\}/, key);
      assert.equal(cfg['deepLinkPathTemplate'], REIMBURSEMENT_REQUEST_LINK, key);
      // Two notices are about the NEXT step, which may be the actor's own: paying a claim one has approved, and
      // (owner decision 2026-10-02) reviewing at the finance desk a claim one has approved. Their actor is not
      // left out, and gets the notice in the web bell only.
      if (key === 'reimbursement_ready_for_payment' || key === 'reimbursement_finance_review_pending') {
        assert.equal(cfg['excludeRecipientPayloadKeys'], undefined, key);
        assert.equal(cfg['skipWhenAllRecipientsExcluded'], undefined, key);
        assert.deepEqual(cfg['webOnlyRecipientPayloadKeys'], ['actorUserId'], key);
        continue;
      }
      assert.equal(cfg['webOnlyRecipientPayloadKeys'], undefined, key);
      assert.deepEqual(cfg['excludeRecipientPayloadKeys'], ['actorUserId'], key);
      assert.equal(cfg['skipWhenAllRecipientsExcluded'], true, key);
    }
    // The SLA scan is a system reminder, not an actor's own event — it must stay unaffected.
    const sla = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'approval_sla_breach');
    const slaCfg = sla?.defaultActionJson.find((a) => a.actionType === 'SEND_NOTIFICATION')?.configJson ?? {};
    assert.equal(slaCfg['excludeRecipientPayloadKeys'], undefined);
    assert.equal(slaCfg['deepLinkPathTemplate'], undefined);
  });

  // Live UAT 2026-08-29: approver and requester were notified, the finance desk was not — nothing
  // subscribed to the claim ARRIVING at finance review, only to finance's own BLOCKED decision.
  it('notifies finance-review permission holders when an approved claim arrives at their desk', () => {
    const template = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_finance_review_pending');
    const cfg = template?.defaultActionJson[0]?.configJson ?? {};

    assert.equal(template?.status, 'AVAILABLE');
    assert.equal(template?.autoEnable, true);
    assert.deepEqual(template?.defaultConditionJson, { field: 'status', op: 'EQ', value: 'FINANCE_REVIEW' });
    assert.equal(
      ruleMatchesEventType(WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG['reimbursement_finance_review_pending'] ?? {}, 'reimbursement.approved'),
      true,
    );
    assert.deepEqual(cfg['recipientPermissions'], ['reimbursement.finance_review']);
    // Owner decision 2026-10-02: the people who review, not the shop owner, who holds every right and is told only
    // when nobody else can review the claim.
    assert.deepEqual(cfg['lastResortRecipientRoles'], ['OWNER']);
    assert.equal(cfg['triggerKey'], 'workflow.reimbursement_finance_review');
    assert.equal(cfg['deepLinkPathTemplate'], REIMBURSEMENT_REQUEST_LINK);
  });

  // Review: a claim below the approval threshold in a company with finance review on wrote only
  // `finance_review_requested`, which no rule listened to, so it reached the finance desk unannounced.
  // And the pending-approval rule matched it, with no approver to tell: a dead letter per claim.
  it('announces a claim that needed no approval to the finance desk, and asks nobody to approve it', () => {
    const now = new Date('2026-10-01T00:00:00.000Z');
    const arrival = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_finance_review_pending')!;
    const pending = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_pending_approval')!;
    // What submit writes on `request_submitted` and `finance_review_requested` for such a claim.
    const sentToFinance = { requestId: 'rb-1', requestNo: 'RB-202610-00003', status: 'FINANCE_REVIEW', requesterUserId: 'staff-1', amount: '80', currency: 'THB' };

    assert.equal(ruleMatchesEventType(WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG['reimbursement_finance_review_pending'] ?? {}, 'reimbursement.finance_review_requested'), true);
    assert.equal(evaluateCondition(arrival.defaultConditionJson, sentToFinance, now).matched, true);

    assert.equal(evaluateCondition(pending.defaultConditionJson, sentToFinance, now).matched, false);
    assert.equal(evaluateCondition(pending.defaultConditionJson, { ...sentToFinance, status: 'READY_FOR_PAYMENT' }, now).matched, false);
    // A claim that does wait for a person is announced exactly as before.
    assert.equal(evaluateCondition(pending.defaultConditionJson, { ...sentToFinance, status: 'PENDING_APPROVAL' }, now).matched, true);
  });

  it('routes the finance-review template to finance-review permission holders and stays out of the approve path', () => {
    const template = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_finance_review');
    const cfg = template?.defaultActionJson[0]?.configJson ?? {};

    assert.equal(template?.status, 'AVAILABLE');
    assert.equal(template?.autoEnable, true);
    assert.deepEqual(cfg['recipientPermissions'], ['reimbursement.finance_review']);
    // Owner decision 2026-10-02: the rule of the arrival notice. The reviewers, and the shop owner only as the last
    // resort. The reviewer who blocked the claim is still left out, as the actor of the event.
    assert.deepEqual(cfg['lastResortRecipientRoles'], ['OWNER']);
    assert.deepEqual([cfg['excludeRecipientPayloadKeys'], cfg['skipWhenAllRecipientsExcluded']], [['actorUserId'], true]);
    assert.equal(cfg['triggerKey'], 'workflow.reimbursement_finance_review');
    assert.equal(cfg['severity'], 'action');
    assert.equal(cfg['deepLinkPathTemplate'], REIMBURSEMENT_REQUEST_LINK);
    assert.equal(
      ruleMatchesEventType(WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG['reimbursement_finance_review'] ?? {}, 'reimbursement.finance_review_updated'),
      true,
    );

    // NEEDS_INFO now goes to the requester; APPROVED_FOR_PAYMENT has its own payer template.
    const now = new Date('2026-08-05T00:00:00.000Z');
    const payload = (decision: string) => ({ requestId: 'rb-1', requestNo: 'RB-202608-00021', decision, amount: '250', currency: 'THB' });
    assert.equal(evaluateCondition(template!.defaultConditionJson, payload('NEEDS_INFO'), now).matched, false);
    assert.equal(evaluateCondition(template!.defaultConditionJson, payload('BLOCKED'), now).matched, true);
    assert.equal(evaluateCondition(template!.defaultConditionJson, payload('APPROVED_FOR_PAYMENT'), now).matched, false);
  });

  // F1: cooldown is per rule, not per claim. Every EVENT-triggered reimbursement template must
  // materialize with 0 or one claim's notification blacks out the next hour of claims; the
  // scan-style templates are the ones cooldown is genuinely for and keep the default.
  it('pins every EVENT-triggered reimbursement template to cooldown 0 and leaves scan templates alone', () => {
    const eventReimbursementKeys = WORKFLOW_TEMPLATE_CATALOG
      .filter((entry) => entry.sourceModule === 'reimbursements' && entry.triggerType === 'EVENT')
      .map((entry) => entry.key);

    assert.ok(eventReimbursementKeys.length >= 4);
    for (const key of eventReimbursementKeys) {
      assert.equal(WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS[key], 0, key);
    }
    assert.equal(WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS['approval_sla_breach'], undefined);
  });

  it('is idempotent on (companyId, eventId): a re-delivered event is a no-op', async () => {
    const repo = fakeRepo({ existing: { id: 'inbox-existing' } });
    const runner = { execute: mock.fn(async () => ({ status: 'SUCCEEDED' })) };
    const uc = new IngestWorkflowEventUseCase(repo, runner as any);
    const result = await uc.execute(baseEvent());
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'already_processed');
    assert.equal(runner.execute.mock.callCount(), 0);
  });

  it('records SKIPPED with no_matching_rules when no ENABLED rule subscribes to the eventType', async () => {
    const repo = fakeRepo({ rules: [{ triggerConfigJson: { eventType: 'some.other.event' } }] });
    const runner = { execute: mock.fn(async () => ({ status: 'SUCCEEDED' })) };
    const uc = new IngestWorkflowEventUseCase(repo, runner as any);
    const result = await uc.execute(baseEvent());
    assert.equal(result.skipped, true);
    assert.equal(result.reason, 'no_matching_rules');
    assert.equal(runner.execute.mock.callCount(), 0);
  });

  it('runs every matching ENABLED rule exactly once', async () => {
    const matchingRule = { id: 'rule-1', triggerConfigJson: { eventType: 'reimbursement.request_submitted' }, template: { sourceModule: 'reimbursements' } };
    const repo = fakeRepo({ rules: [matchingRule] });
    const runner = { execute: mock.fn(async (_input: any) => ({ status: 'SUCCEEDED', runId: 'run-1' })) };
    const uc = new IngestWorkflowEventUseCase(repo, runner as any);
    const result = await uc.execute(baseEvent());
    assert.equal(result.skipped, false);
    assert.equal(result.matchedRuleCount, 1);
    assert.equal(runner.execute.mock.callCount(), 1);
    const callArgs: any = runner.execute.mock.calls[0]?.arguments[0];
    assert.equal(callArgs.rule.id, 'rule-1');
    assert.equal(callArgs.triggerType, 'EVENT');
    assert.equal(callArgs.dedupKey, 'event:dedup-1');
    const update: any = repo.updateEventInbox.mock.calls.at(-1)?.arguments[1];
    assert.equal(update.errorCode, null);
    assert.equal(update.errorMessage, null);
  });

  // A cooldown/duplicate skip returns before createRun, so a fully-skipped event used to leave the
  // inbox row saying MATCHED with no run, no log and no reason anywhere (the F1 outage).
  it('records the skip reasons on the inbox row when every matching rule skipped', async () => {
    const rule = (id: string) => ({ id, triggerConfigJson: { eventType: 'reimbursement.request_submitted' }, template: { sourceModule: 'reimbursements' } });
    const repo = fakeRepo({ rules: [rule('rule-1'), rule('rule-2')] });
    const runner = { execute: mock.fn(async () => ({ status: 'SKIPPED', reason: 'cooldown' })) };
    const uc = new IngestWorkflowEventUseCase(repo, runner as any);

    const result = await uc.execute(baseEvent());

    assert.equal(result.matchedRuleCount, 2);
    const update: any = repo.updateEventInbox.mock.calls.at(-1)?.arguments[1];
    assert.equal(update.status, 'MATCHED');
    assert.equal(update.errorCode, 'RUNS_SKIPPED');
    assert.equal(update.errorMessage, 'cooldown×2');
  });
});

/**
 * Audit B8: approval and SLA tasks were closed only by hand, so "งานที่ได้รับมอบหมาย" kept listing
 * claims long since approved, rejected or paid. The REAL repository runs here over an in-memory
 * store, so the query, the status rule and the idempotence are what these tests prove.
 */
describe('claim approval tasks close when the claim moves on (audit B8)', () => {
  const NOW = new Date('2026-10-01T05:00:00.000Z');
  const task = (id: string, extra: Record<string, unknown> = {}): any => ({
    id, companyId: 'co-1', sourceType: 'reimbursement_request', sourceId: 'req-1', status: 'OPEN',
    templateKey: 'reimbursement_pending_approval', ...extra,
  });

  function store(
    tasks: any[],
    claims: Array<{ id: string; companyId?: string; status: string; payoutCorrectionRequestedAt?: Date; payoutCorrectionSubmittedAt?: Date }>,
    rules: any[] = [],
  ) {
    const inbox = new Map<string, any>();
    const writes: any[] = [];
    const matches = (row: any, where: any) => (where.companyId === undefined || row.companyId === where.companyId)
      && row.sourceType === where.sourceType
      && (typeof where.sourceId === 'string' ? row.sourceId === where.sourceId : row.sourceId != null)
      && where.status.in.includes(row.status)
      && where.workflowRun.rule.template.key.in.includes(row.templateKey);
    const prisma = {
      client: {
        workflowEventInbox: {
          findUnique: async ({ where }: any) => inbox.get(`${where.companyId_eventId.companyId}:${where.companyId_eventId.eventId}`) ?? null,
          create: async ({ data }: any) => {
            const row = { id: `inbox-${inbox.size + 1}`, ...data };
            inbox.set(`${data.companyId}:${data.eventId}`, row);
            return row;
          },
          update: async () => undefined,
        },
        workflowRule: { findMany: async () => rules },
        workflowTask: {
          findMany: async ({ where }: any) => tasks.filter((row) => matches(row, where)).map((row) => ({ id: row.id, companyId: row.companyId, sourceId: row.sourceId })),
          updateMany: async ({ where, data }: any) => {
            const hits = tasks.filter((row) => where.id.in.includes(row.id) && where.status.in.includes(row.status));
            hits.forEach((row) => Object.assign(row, data));
            writes.push({ ids: hits.map((row) => row.id), data });
            return { count: hits.length };
          },
        },
        reimbursementRequest: {
          findMany: async ({ where }: any) => claims
            .filter((claim) => where.id.in.includes(claim.id))
            .map((claim) => ({
              id: claim.id, companyId: claim.companyId ?? 'co-1', status: claim.status,
              payoutCorrectionRequestedAt: claim.payoutCorrectionRequestedAt ?? null, payoutCorrectionSubmittedAt: claim.payoutCorrectionSubmittedAt ?? null,
            })),
        },
      },
    } as any;
    return { repo: new PrismaWorkflowRepository(prisma), writes };
  }
  const noRules = { execute: mock.fn(async () => ({ status: 'SUCCEEDED' as const })) };
  const statuses = (tasks: any[]) => Object.fromEntries(tasks.map((row) => [row.id, row.status]));

  it('approve closes the approver task and the SLA task as done, and nothing else', async () => {
    const tasks = [
      task('approval'),
      task('sla', { templateKey: 'approval_sla_breach', status: 'SNOOZED' }),
      task('admin-made', { templateKey: 'some_admin_rule' }),
      task('other-claim', { sourceId: 'req-2' }),
      task('other-company', { companyId: 'co-2' }),
    ];
    const { repo } = store(tasks, [{ id: 'req-1', status: 'READY_FOR_PAYMENT' }, { id: 'req-2', status: 'PENDING_APPROVAL' }]);

    await new IngestWorkflowEventUseCase(repo, noRules as any).execute(baseEvent({ eventType: 'reimbursement.approved' }));

    assert.deepEqual(statuses(tasks), {
      approval: 'DONE', sla: 'DONE', 'admin-made': 'OPEN', 'other-claim': 'OPEN', 'other-company': 'OPEN',
    });
    assert.ok(tasks[0]!.completedAt instanceof Date);
    assert.equal(tasks[0]!.cancelReason, undefined);
  });

  it('reject, cancel and a return to draft close them as cancelled', async () => {
    for (const [eventType, claimStatus] of [
      ['reimbursement.rejected', 'REJECTED'],
      ['reimbursement.cancelled', 'CANCELLED'],
      ['reimbursement.reopened', 'DRAFT'],
    ] as const) {
      const tasks = [task('approval'), task('sla', { templateKey: 'approval_sla_breach' })];
      const { repo } = store(tasks, [{ id: 'req-1', status: claimStatus }]);

      await new IngestWorkflowEventUseCase(repo, noRules as any).execute(baseEvent({ eventType }));

      assert.deepEqual(statuses(tasks), { approval: 'CANCELED', sla: 'CANCELED' }, eventType);
      assert.equal(tasks[0]!.cancelReason, 'ใบเบิกนี้ไม่ได้รออนุมัติแล้ว', eventType);
      assert.equal(tasks[0]!.completedAt, undefined, eventType);
    }
  });

  it('leaves a paid claim with no open claim task, reading the claim from a payment event', async () => {
    const tasks = [task('approval'), task('sla', { templateKey: 'approval_sla_breach' })];
    const { repo } = store(tasks, [{ id: 'req-1', status: 'PAID' }]);

    await new IngestWorkflowEventUseCase(repo, noRules as any).execute(baseEvent({
      eventType: 'reimbursement.payment_recorded', sourceType: 'reimbursement_payment', sourceId: 'pay-1',
      payload: { requestId: 'req-1', paymentNo: 'RP-1' },
    }));

    assert.deepEqual(tasks.filter((row) => ['OPEN', 'SNOOZED'].includes(row.status)), []);
    assert.deepEqual(statuses(tasks), { approval: 'DONE', sla: 'DONE' });
  });

  it('keeps the task while the claim still waits for approval', async () => {
    const tasks = [task('approval')];
    const { repo, writes } = store(tasks, [{ id: 'req-1', status: 'PENDING_APPROVAL' }]);

    await new IngestWorkflowEventUseCase(repo, noRules as any).execute(baseEvent({ eventType: 'reimbursement.approval_projection_started' }));

    assert.deepEqual(statuses(tasks), { approval: 'OPEN' });
    assert.deepEqual(writes, []);
  });

  it('replaying an event changes nothing, not even the task of a later round', async () => {
    const tasks = [task('round-1')];
    const { repo, writes } = store(tasks, [{ id: 'req-1', status: 'REJECTED' }]);
    const uc = new IngestWorkflowEventUseCase(repo, noRules as any);
    const submitted = baseEvent({ eventId: 'evt-submit', eventType: 'reimbursement.request_submitted' });
    const rejected = baseEvent({ eventId: 'evt-reject', eventType: 'reimbursement.rejected' });

    await uc.execute(rejected);
    assert.deepEqual(statuses(tasks), { 'round-1': 'CANCELED' });
    const closedAs = { ...tasks[0] };
    const writesAfterFirst = writes.length;

    // The same event again: dropped at the inbox, no write at all.
    assert.equal((await uc.execute(rejected)).reason, 'already_processed');
    assert.deepEqual(tasks[0], closedAs);
    assert.equal(writes.length, writesAfterFirst);

    // A resubmission is processed once and gets its task; replaying that submit event must not
    // supersede the very task it stands for.
    await uc.execute(submitted);
    tasks.push(task('round-2'));
    assert.equal((await uc.execute(submitted)).reason, 'already_processed');
    assert.deepEqual(statuses(tasks), { 'round-1': 'CANCELED', 'round-2': 'OPEN' });
  });

  it('a claim sent again supersedes what an earlier round left open, before its own task is created', async () => {
    const tasks = [task('round-1'), task('round-1-sla', { templateKey: 'approval_sla_breach' })];
    const rule = { id: 'rule-1', companyId: 'co-1', triggerConfigJson: { eventType: 'reimbursement.request_submitted' }, template: { key: 'reimbursement_pending_approval', sourceModule: 'reimbursements' } };
    const { repo } = store(tasks, [{ id: 'req-1', status: 'PENDING_APPROVAL' }], [rule]);
    // The rule run is where the new round's task is born.
    const runner = { execute: mock.fn(async () => { tasks.push(task('round-2')); return { status: 'SUCCEEDED' as const, runId: 'run-2' }; }) };

    await new IngestWorkflowEventUseCase(repo, runner as any).execute(baseEvent({ eventType: 'reimbursement.request_submitted' }));

    assert.deepEqual(statuses(tasks), { 'round-1': 'CANCELED', 'round-1-sla': 'CANCELED', 'round-2': 'OPEN' });
    assert.equal(tasks[0]!.cancelReason, 'ใบเบิกนี้ถูกส่งใหม่ จึงมีงานอนุมัติใหม่แทน');
  });

  it('closes at once the task of a submit event that arrives after the claim was already approved', async () => {
    const tasks: any[] = [];
    const rule = { id: 'rule-1', companyId: 'co-1', triggerConfigJson: { eventType: 'reimbursement.request_submitted' }, template: { key: 'reimbursement_pending_approval', sourceModule: 'reimbursements' } };
    const { repo } = store(tasks, [{ id: 'req-1', status: 'READY_FOR_PAYMENT' }], [rule]);
    const runner = { execute: mock.fn(async () => { tasks.push(task('late')); return { status: 'SUCCEEDED' as const, runId: 'run-1' }; }) };

    await new IngestWorkflowEventUseCase(repo, runner as any).execute(baseEvent({ eventType: 'reimbursement.request_submitted' }));

    assert.deepEqual(statuses(tasks), { late: 'DONE' });
  });

  it('never fails the event when closing a task fails: its notices matter more', async () => {
    const repo = fakeRepo({ rules: [{ id: 'rule-1', triggerConfigJson: { eventType: 'reimbursement.approved' }, template: { sourceModule: 'reimbursements' } }] });
    repo.closeSettledClaimTasks = mock.fn(async () => { throw new Error('database blip'); });
    const runner = { execute: mock.fn(async () => ({ status: 'SUCCEEDED' as const, runId: 'run-1' })) };

    const result = await new IngestWorkflowEventUseCase(repo, runner as any).execute(baseEvent({ eventType: 'reimbursement.approved' }));

    assert.equal(result.matchedRuleCount, 1);
    assert.equal(runner.execute.mock.callCount(), 1);
    assert.equal(repo.closeSettledClaimTasks.mock.callCount(), 1);
  });

  it('the release sweep closes the backlog across companies once, and a second run closes nothing', async () => {
    const tasks = [
      task('paid-claim'),
      task('paid-claim-sla', { templateKey: 'approval_sla_breach' }),
      task('rejected-claim', { sourceId: 'req-2' }),
      task('still-pending', { sourceId: 'req-3' }),
      task('claim-deleted', { sourceId: 'req-gone' }),
      task('other-company-approved', { companyId: 'co-2', sourceId: 'req-4' }),
      task('already-done', { status: 'DONE', completedAt: new Date('2026-09-01T00:00:00.000Z') }),
      task('admin-made', { templateKey: 'some_admin_rule' }),
      task('stock-task', { sourceType: 'stock_balance', sourceId: 'p-1', templateKey: 'low_stock_alert' }),
    ];
    const { repo } = store(tasks, [
      { id: 'req-1', status: 'PAID' }, { id: 'req-2', status: 'REJECTED' }, { id: 'req-3', status: 'PENDING_APPROVAL' },
      { id: 'req-4', companyId: 'co-2', status: 'FINANCE_REVIEW' },
    ]);

    assert.equal(await repo.closeSettledClaimTasks({}, NOW), 5);
    assert.deepEqual(statuses(tasks), {
      'paid-claim': 'DONE', 'paid-claim-sla': 'DONE', 'rejected-claim': 'CANCELED', 'still-pending': 'OPEN',
      'claim-deleted': 'CANCELED', 'other-company-approved': 'DONE', 'already-done': 'DONE',
      'admin-made': 'OPEN', 'stock-task': 'OPEN',
    });
    assert.equal(tasks[0]!.completedAt, NOW);
    // Closed by hand before the sweep: its own completion time is not rewritten.
    assert.deepEqual(tasks[6]!.completedAt, new Date('2026-09-01T00:00:00.000Z'));

    const before = JSON.stringify(tasks);
    assert.equal(await repo.closeSettledClaimTasks({}, new Date('2026-10-02T00:00:00.000Z')), 0);
    assert.equal(JSON.stringify(tasks), before);
  });

  // Review: superseding ignores the claim's status, so called without a claim it would have
  // cancelled every open approval task of every company.
  it('refuses to supersede without naming the claim, and closes nothing', async () => {
    const tasks = [task('pending-claim'), task('other-company', { companyId: 'co-2', sourceId: 'req-9' })];
    const { repo, writes } = store(tasks, [{ id: 'req-1', status: 'PENDING_APPROVAL' }]);

    await assert.rejects(() => repo.closeSettledClaimTasks({ supersede: true }), /supersede needs the claim/);
    await assert.rejects(() => repo.closeSettledClaimTasks({ companyId: 'co-1', supersede: true }), /supersede needs the claim/);

    assert.deepEqual(statuses(tasks), { 'pending-claim': 'OPEN', 'other-company': 'OPEN' });
    assert.deepEqual(writes, []);
  });

  // Payout spec §14: a claim sent back to have its payout account corrected is PENDING_APPROVAL, with
  // nothing to approve while its requester gives the account. A reminder task that chased its approver
  // is cancelled then, kept while a new account waits for them, and done when they approve it.
  it('cancels a task that asks for approval once the claim is with its requester for its account', async () => {
    const sentBackAt = new Date('2026-10-01T03:00:00.000Z');
    const phases: Array<[string, string, Record<string, unknown>, string]> = [
      ['reimbursement.payout_correction_requested', 'PENDING_APPROVAL', { payoutCorrectionRequestedAt: sentBackAt }, 'CANCELED'],
      ['reimbursement.payout_correction_submitted', 'PENDING_APPROVAL', { payoutCorrectionRequestedAt: sentBackAt, payoutCorrectionSubmittedAt: NOW }, 'OPEN'],
      ['reimbursement.ready_for_payment', 'READY_FOR_PAYMENT', {}, 'DONE'],
    ];
    for (const [eventType, status, round, expected] of phases) {
      const tasks = [task('sla', { templateKey: 'approval_sla_breach' }), task('other-claim', { sourceId: 'req-2' })];
      const { repo } = store(tasks, [{ id: 'req-1', status, ...round }, { id: 'req-2', status: 'PENDING_APPROVAL' }]);
      await new IngestWorkflowEventUseCase(repo, noRules as any).execute(baseEvent({ eventType }));
      assert.deepEqual(statuses(tasks), { sla: expected, 'other-claim': 'OPEN' }, eventType);
    }
    assert.equal(claimApprovalTaskOutcome('PENDING_APPROVAL', true), 'CANCELED');
    assert.equal(claimApprovalTaskOutcome('PENDING_APPROVAL', false), null);
    // Only a claim waiting for approval can be with its requester for its account.
    assert.equal(claimApprovalTaskOutcome('READY_FOR_PAYMENT', true), 'DONE');
  });

  it('decides the outcome from the claim status, and finds the claim an event is about', () => {
    assert.equal(claimApprovalTaskOutcome('PENDING_APPROVAL'), null);
    for (const status of ['APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'PARTIALLY_PAID', 'PAID']) {
      assert.equal(claimApprovalTaskOutcome(status), 'DONE', status);
    }
    for (const status of ['DRAFT', 'REJECTED', 'CANCELLED', 'VOIDED', undefined]) {
      assert.equal(claimApprovalTaskOutcome(status), 'CANCELED', String(status));
    }
    assert.equal(claimIdOfEvent(baseEvent()), 'req-1');
    assert.equal(claimIdOfEvent(baseEvent({ sourceType: 'reimbursement_payment', sourceId: 'pay-1', payload: { requestId: 'req-9' } })), 'req-9');
    // A policy change names no claim, and another module's event is never read as one.
    assert.equal(claimIdOfEvent(baseEvent({ eventType: 'reimbursement.policy_updated', sourceType: 'reimbursement_policy', sourceId: 'policy-1', payload: {} })), undefined);
    assert.equal(claimIdOfEvent(baseEvent({ eventType: 'vendor_bill.submitted', sourceType: 'vendor_bill', sourceId: 'bill-1', payload: { requestId: 'req-1' } })), undefined);
  });
});
