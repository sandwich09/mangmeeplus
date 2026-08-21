import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { IngestWorkflowEventUseCase } from './workflow-event-ingest.use-case';
import type { WorkflowEventEnvelope } from '@watchdog-bms/contracts';
import {
  WORKFLOW_TEMPLATE_CATALOG,
  WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS,
  WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG,
} from '../../domain/workflow-template-catalog';
import { ruleMatchesEventType } from '../../domain/logic/workflow-event-match.logic';
import { evaluateCondition } from '../../domain/logic/workflow-condition.logic';

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
      'reimbursement_payment_recorded',
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
      ['reimbursement_ready_for_payment', 'reimbursement.ready_for_payment'],
      ['reimbursement_payment_recorded', 'reimbursement.payment_recorded'],
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
    assert.match(String(cfg['deepLinkPathTemplate']), /tab=mine/);
    assert.equal(
      ruleMatchesEventType(WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG['reimbursement_correction_requester'] ?? {}, 'reimbursement.correction_requested'),
      true,
    );
  });

  // F16: an owner is an approver for every claim (matchesApproverRole), so an owner-only company
  // used to resolve zero recipients for the alert while the review task stayed manager-assigned.
  it('notifies managers AND owners about a pending approval, keeping the task manager-assigned', () => {
    const template = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_pending_approval');
    const [notifyAction, taskAction] = template?.defaultActionJson ?? [];

    assert.deepEqual(notifyAction?.configJson['recipientRoles'], ['MANAGER', 'OWNER']);
    assert.equal(taskAction?.actionType, 'CREATE_APPROVAL_REVIEW_REQUEST');
    assert.equal(taskAction?.configJson['assigneeRole'], 'MANAGER');
  });

  // F16: every reimbursement alert used to send `body: title`, so LINE printed the same line twice.
  it('gives every reimbursement notification a body distinct from its title', () => {
    const notifications = WORKFLOW_TEMPLATE_CATALOG
      .filter((entry) => entry.sourceModule === 'reimbursements' && entry.triggerType === 'EVENT')
      .map((entry) => ({ key: entry.key, cfg: entry.defaultActionJson.find((a) => a.actionType === 'SEND_NOTIFICATION')?.configJson ?? {} }));

    assert.equal(notifications.length, 6);
    for (const { key, cfg } of notifications) {
      assert.equal(typeof cfg['bodyTemplate'], 'string', key);
      assert.notEqual(cfg['bodyTemplate'], cfg['titleTemplate'], key);
      // A body worth pushing carries the figures the title does not.
      assert.match(String(cfg['bodyTemplate']), /\{\{(amount|paidAmount)\}\}/, key);
    }
  });

  it('routes the finance-review template to finance-review permission holders and stays out of the approve path', () => {
    const template = WORKFLOW_TEMPLATE_CATALOG.find((entry) => entry.key === 'reimbursement_finance_review');
    const cfg = template?.defaultActionJson[0]?.configJson ?? {};

    assert.equal(template?.status, 'AVAILABLE');
    assert.equal(template?.autoEnable, true);
    assert.deepEqual(cfg['recipientPermissions'], ['reimbursement.finance_review']);
    assert.equal(cfg['triggerKey'], 'workflow.reimbursement_finance_review');
    assert.equal(cfg['severity'], 'action');
    assert.match(String(cfg['deepLinkPathTemplate']), /tab=finance/);
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
