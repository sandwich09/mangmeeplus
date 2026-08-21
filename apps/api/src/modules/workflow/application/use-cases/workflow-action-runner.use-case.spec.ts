import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ExecuteWorkflowActionUseCase } from './workflow-action-runner.use-case';
import { WORKFLOW_TEMPLATE_CATALOG, WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG } from '../../domain/workflow-template-catalog';
import { ruleMatchesEventType } from '../../domain/logic/workflow-event-match.logic';

// H-07 follow-up: vendor_bill.approval_recorded → notify the remaining eligible
// approvers (permission-resolved), never the submitter or the first approver.

const secondApprovalTemplate = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'vendor_bill_second_approval')!;

// The real event payload shape emitted by ApproveVendorBillUseCase for a partial approval.
const approvalRecordedPayload = {
  billId: 'bill_1',
  vendorBillNumber: 'VB-2026-001',
  status: 'PENDING_APPROVAL',
  grandTotalAmount: '150000.00',
  recordedApprovers: 1,
  requiredApprovers: 2,
  submitterUserId: 'u_submitter',
  approverUserIds: ['u_first_approver'],
  eventType: 'vendor_bill.approval_recorded',
};

function actionRun(configJson: Record<string, unknown>): any {
  return {
    id: 'ar_1', workflowRunId: 'run_1', actionKey: 'notify_second_approver',
    actionType: 'SEND_NOTIFICATION', actionConfigSnapshotJson: configJson,
    attemptCount: 0, idempotencyKey: 'run_1:notify_second_approver', startedAt: undefined,
  };
}

const context = (payload: Record<string, unknown>): any => ({
  companyId: 'co_1', ruleName: 'Vendor bill awaiting second approval',
  sourceModule: 'procurement', sourceType: 'vendor_bill', sourceId: 'bill_1',
  payload, siblingActions: [],
});

describe('vendor_bill_second_approval template wiring (H-07 follow-up)', () => {
  it('subscribes to vendor_bill.approval_recorded and is available', () => {
    assert.equal(secondApprovalTemplate.status, 'AVAILABLE');
    assert.equal(secondApprovalTemplate.triggerType, 'EVENT');
    assert.ok(ruleMatchesEventType(WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG['vendor_bill_second_approval']!, 'vendor_bill.approval_recorded'));
    // The default condition must reference a field the event payload actually carries.
    assert.deepEqual(secondApprovalTemplate.defaultConditionJson, { field: 'billId', op: 'EXISTS' });
    assert.ok('billId' in approvalRecordedPayload);
  });
});

describe('ExecuteWorkflowActionUseCase SEND_NOTIFICATION recipient resolution', () => {
  let repo: any;
  let notify: any;

  beforeEach(() => {
    repo = {
      updateActionRun: mock.fn(async () => undefined),
      findUserIdsByRoles: mock.fn(async () => []),
      findUserIdsByPermissions: mock.fn(async () => ['u_submitter', 'u_first_approver', 'u_second', 'u_third']),
    };
    notify = { execute: mock.fn(async () => ({ skipped: false, event: { id: 'ne_1' } })) };
  });

  // Shadow probe double: SEND_NOTIFICATION never reaches the CALL_WEBHOOK sweep, so a probe that
  // is never touched is the faithful stand-in here.
  const shadow = { startSweep: () => { throw new Error('no shadow sweep on this action type'); } } as any;
  const make = () => new ExecuteWorkflowActionUseCase(repo, {} as any, {} as any, notify, {} as any, shadow);

  it('notifies permission holders minus the submitter and recorded approvers (catalog config)', async () => {
    const cfg = secondApprovalTemplate.defaultActionJson[0]!.configJson;
    await make().execute(actionRun(cfg), context(approvalRecordedPayload));

    assert.equal(repo.findUserIdsByPermissions.mock.callCount(), 1);
    assert.deepEqual((repo.findUserIdsByPermissions.mock.calls[0] as any).arguments, ['co_1', ['procurement.vendor_bill.approve']]);
    assert.equal(notify.execute.mock.callCount(), 1);
    const sent = (notify.execute.mock.calls[0] as any).arguments[0];
    assert.deepEqual(sent.recipientUserIds, ['u_second', 'u_third']);
    assert.equal(sent.triggerKey, 'workflow.vendor_bill_second_approval');
    assert.ok(sent.title.includes('VB-2026-001'));
    const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
    assert.equal(finalUpdate.status, 'SUCCEEDED');
  });

  it('fails retryable (no notification) when exclusions leave no eligible second approver', async () => {
    repo.findUserIdsByPermissions = mock.fn(async () => ['u_submitter', 'u_first_approver']);
    const cfg = secondApprovalTemplate.defaultActionJson[0]!.configJson;
    await make().execute(actionRun(cfg), context(approvalRecordedPayload));

    assert.equal(notify.execute.mock.callCount(), 0);
    const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
    assert.equal(finalUpdate.status, 'FAILED_RETRYABLE');
  });

  it('resolves the reimbursement deep link from the template path, for both the notification and the sibling task', async () => {
    const pendingApproval = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_pending_approval')!;
    const [notifyAction, taskAction] = pendingApproval.defaultActionJson;
    const payload = {
      requestId: 'rb_1', requestNo: 'RB-202601-000001', eventType: 'reimbursement.request_submitted',
      approverRecipientUserIds: ['u_manager'], approverTaskUserId: 'u_manager', approverTaskRole: 'ACCOUNTANT',
    };
    const reimbursementContext: any = {
      companyId: 'co_1', ruleName: 'Reimbursement pending approval',
      sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1',
      payload, siblingActions: pendingApproval.defaultActionJson,
    };
    repo.findUserIdsByRoles = mock.fn(async () => []);
    repo.findTaskByActionRunId = mock.fn(async () => null);
    repo.createTask = mock.fn(async (data: any) => ({ id: 'task_1', ...data }));

    await make().execute({ ...actionRun(notifyAction!.configJson), actionKey: notifyAction!.actionKey }, reimbursementContext);
    const sent = (notify.execute.mock.calls[0] as any).arguments[0];
    assert.equal(sent.deepLinkHref, '/companies/co_1/reimbursements?tab=approvals&focus=rb_1');
    assert.equal(sent.sourceRefs[0].webPath, sent.deepLinkHref);

    // The approval-review task carries no path of its own: it inherits the sibling's, so LINE
    // and the task list open the exact same screen.
    await make().execute({ ...actionRun(taskAction!.configJson), actionKey: taskAction!.actionKey, actionType: 'CREATE_APPROVAL_REVIEW_REQUEST' }, reimbursementContext);
    const created = (repo.createTask.mock.calls[0] as any).arguments[0];
    assert.equal(created.webDeepLink, '/companies/co_1/reimbursements?tab=approvals&focus=rb_1');
    assert.equal(created.assigneeUserId, 'u_manager');
    assert.equal(created.assigneeRole, undefined, 'a later ACCOUNTANT must not inherit this frozen task');
  });

  describe('pending-approval alert follows the frozen recipients', () => {
    const pendingApproval = () => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_pending_approval')!;
    const runNotify = (payload: Record<string, unknown>) => {
      const [notifyAction] = pendingApproval().defaultActionJson;
      return make().execute({ ...actionRun(notifyAction!.configJson), actionKey: notifyAction!.actionKey }, {
        companyId: 'co_1', ruleName: 'Reimbursement pending approval', sourceModule: 'reimbursements',
        sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-1', amount: '250', currency: 'THB', ...payload },
        siblingActions: pendingApproval().defaultActionJson,
      } as any);
    };

    it('does not re-evaluate the requester after submission resolved an exact self-approval route', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => []);
      repo.findUserIdsByRoles = mock.fn(async () => []);

      await runNotify({ requesterUserId: 'u_owner', approverRecipientUserIds: ['u_manager', 'u_owner'] });

      assert.deepEqual((notify.execute.mock.calls[0] as any).arguments[0].recipientUserIds, ['u_manager', 'u_owner']);
    });

    // Nothing resolving AT ALL still means the roles name people who do not exist — a later
    // membership change fixes it, so that case keeps retrying.
    it('still fails when no recipient resolved in the first place', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => []);
      repo.findUserIdsByRoles = mock.fn(async () => []);
      await runNotify({ requesterUserId: 'u_owner', approverRecipientUserIds: [] });

      assert.equal(notify.execute.mock.callCount(), 0);
      const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
      assert.equal(finalUpdate.status, 'FAILED_RETRYABLE');
    });

    it('notifies a sole frozen self-approver because that decision was already validated at submit', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => []);
      repo.findUserIdsByRoles = mock.fn(async () => []);

      await runNotify({ requesterUserId: 'u_owner', approverRecipientUserIds: ['u_owner'] });

      assert.deepEqual((notify.execute.mock.calls[0] as any).arguments[0].recipientUserIds, ['u_owner']);
    });
  });

  // F16: `body: title` made every LINE push repeat itself. bodyTemplate is read from the action's
  // OWN config (no sibling fallback), so the pending-approval alert can borrow the task's title and
  // still say something new in the body.
  it('renders bodyTemplate from the payload instead of repeating the title', async () => {
    const ready = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_ready_for_payment')!;
    repo.findUserIdsByPermissions = mock.fn(async () => ['u_finance']);
    await make().execute(actionRun(ready.defaultActionJson[0]!.configJson), {
      companyId: 'co_1', ruleName: 'Reimbursement ready for payment', sourceModule: 'reimbursements',
      sourceType: 'reimbursement_request', sourceId: 'rb_1',
      payload: {
        requestId: 'rb_1', requestNo: 'RB-202608-00021', amount: '250', currency: 'THB',
        approverRecipientUserIds: ['u_manager'],
      },
      siblingActions: [],
    } as any);

    const sent = (notify.execute.mock.calls[0] as any).arguments[0];
    assert.equal(sent.title, 'พร้อมจ่ายเบิกจ่าย: RB-202608-00021');
    assert.equal(sent.body, 'ยอด 250 THB · รอบันทึกการจ่ายเงิน');
  });

  it('keeps the sibling-borrowed title but not the body on the pending-approval alert', async () => {
    const pendingApproval = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_pending_approval')!;
    const [notifyAction] = pendingApproval.defaultActionJson;
    repo.findUserIdsByRoles = mock.fn(async () => []);
    repo.findUserIdsByPermissions = mock.fn(async () => []);
    await make().execute({ ...actionRun(notifyAction!.configJson), actionKey: notifyAction!.actionKey }, {
      companyId: 'co_1', ruleName: 'Reimbursement pending approval', sourceModule: 'reimbursements',
      sourceType: 'reimbursement_request', sourceId: 'rb_1',
      payload: {
        requestId: 'rb_1', requestNo: 'RB-202608-00021', amount: '250', currency: 'THB',
        approverRecipientUserIds: ['u_manager'],
      },
      siblingActions: pendingApproval.defaultActionJson,
    } as any);

    const sent = (notify.execute.mock.calls[0] as any).arguments[0];
    assert.deepEqual((repo.findUserIdsByRoles.mock.calls[0] as any).arguments[1], []);
    assert.deepEqual(sent.recipientUserIds, ['u_manager']);
    assert.equal(sent.title, 'อนุมัติเบิกจ่าย: RB-202608-00021');
    assert.equal(sent.body, 'ยอด 250 THB · รออนุมัติจากคุณ');
  });

  it('falls back to the reimbursement hub (never /reimbursements/reimbursement_request/:id) when no path template is set', async () => {
    repo.findUserIdsByRoles = mock.fn(async () => ['u_manager']);
    await make().execute(actionRun({ triggerKey: 'workflow.test', severity: 'info', recipientRoles: ['MANAGER'] }), {
      companyId: 'co_1', ruleName: 'r', sourceModule: 'reimbursements', sourceType: 'reimbursement_request',
      sourceId: 'rb_9', payload: {}, siblingActions: [],
    } as any);
    const sent = (notify.execute.mock.calls[0] as any).arguments[0];
    assert.equal(sent.deepLinkHref, '/companies/co_1/reimbursements?focus=rb_9');
  });

  it('ignores an off-site deepLinkPathTemplate and uses the source path instead', async () => {
    repo.findUserIdsByRoles = mock.fn(async () => ['u_manager']);
    await make().execute(actionRun({
      triggerKey: 'workflow.test', severity: 'info', recipientRoles: ['MANAGER'],
      deepLinkPathTemplate: 'https://evil.example/{{requestId}}',
    }), {
      companyId: 'co_1', ruleName: 'r', sourceModule: 'reimbursements', sourceType: 'reimbursement_request',
      sourceId: 'rb_9', payload: { requestId: 'rb_9' }, siblingActions: [],
    } as any);
    const sent = (notify.execute.mock.calls[0] as any).arguments[0];
    assert.equal(sent.deepLinkHref, '/companies/co_1/reimbursements?focus=rb_9');
  });

  it('still unions role recipients and payload-key recipients with permission recipients', async () => {
    repo.findUserIdsByRoles = mock.fn(async () => ['u_owner']);
    repo.findUserIdsByPermissions = mock.fn(async () => ['u_second']);
    const cfg = {
      triggerKey: 'workflow.test', severity: 'info',
      recipientRoles: ['OWNER'], recipientPermissions: ['procurement.vendor_bill.approve'],
      recipientPayloadKeys: ['requesterUserId'], excludeRecipientPayloadKeys: ['submitterUserId'],
    };
    await make().execute(actionRun(cfg), context({ ...approvalRecordedPayload, requesterUserId: 'u_requester' }));

    const sent = (notify.execute.mock.calls[0] as any).arguments[0];
    assert.deepEqual(sent.recipientUserIds, ['u_owner', 'u_second', 'u_requester']);
  });
});

/**
 * Shadow coverage for the OUTBOUND webhook row of the F0 async inventory (piece 5).
 *
 * `callWebhook` is the one seam every dispatch path converges on — retry sweep, synchronous rule
 * run and both replay paths — so the observation cannot be missed by taking a different route in.
 */
describe('CALL_WEBHOOK shadow coverage', () => {
  const webhookRun = (): any => ({
    id: 'ar_wh', workflowRunId: 'run_wh', actionKey: 'call_webhook', actionType: 'CALL_WEBHOOK',
    actionConfigSnapshotJson: {}, attemptCount: 0, idempotencyKey: 'run_wh:call_webhook', startedAt: undefined,
  });

  function makeWebhook() {
    const shadowRecords: any[] = [];
    const flushes: string[] = [];
    const updates: any[] = [];
    const repo = {
      updateActionRun: async (_id: string, data: any) => { updates.push(data); },
      createDeadLetter: async () => undefined,
      // No endpointId in the config, so dispatch raises FinalActionError immediately after the
      // probe — which is exactly the case that proves the observation is taken up front.
      findWebhookEndpointById: async () => null,
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
    const audit = { log: async () => undefined } as any;
    return {
      useCase: new ExecuteWorkflowActionUseCase(repo, audit, {} as any, {} as any, {} as any, shadow),
      shadowRecords, flushes, updates,
    };
  }

  it('records the outbound dispatch under workflow_automation before the endpoint checks', async () => {
    const { useCase, shadowRecords, flushes, updates } = makeWebhook();
    await useCase.execute(webhookRun(), context(approvalRecordedPayload));

    assert.deepEqual(shadowRecords, [
      { surface: 'workflow.webhook.dispatch', companyId: 'co_1', featureKey: 'workflow_automation' },
    ]);
    assert.deepEqual(flushes, ['workflow.webhook.dispatch']);
    // SHADOW ONLY: the dispatch still fails for its own reason (no endpointId), never because of
    // the probe. A missing endpoint is a FINAL error, so the run dead-letters as it always did.
    assert.equal(updates.at(-1)?.status, 'DEAD_LETTERED');
  });
});
