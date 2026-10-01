import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ExecuteWorkflowActionUseCase } from './workflow-action-runner.use-case';
import { PrismaWorkflowRepository } from '../../infrastructure/prisma-workflow.repository';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { PrismaPermissionResolverRepository } from '../../../access-control/infrastructure/prisma-permission-resolver.repository';
import { WORKFLOW_TEMPLATE_CATALOG, WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG } from '../../domain/workflow-template-catalog';
import { ruleMatchesEventType } from '../../domain/logic/workflow-event-match.logic';
import { evaluateCondition } from '../../domain/logic/workflow-condition.logic';

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
      findSourceBranchId: mock.fn(async () => null),
    };
    notify = { execute: mock.fn(async () => ({ skipped: false, event: { id: 'ne_1' } })) };
  });

  // Shadow probe double: SEND_NOTIFICATION never reaches the CALL_WEBHOOK sweep, so a probe that
  // is never touched is the faithful stand-in here.
  const shadow = { startSweep: () => { throw new Error('no shadow sweep on this action type'); } } as any;
  // Every holder in these tests can act; who cannot is the subject of the B12 block below.
  const access = {
    resolveAccess: async () => ({
      permissions: ['procurement.vendor_bill.approve', 'reimbursement.payment.record', 'reimbursement.finance_review'],
      scopes: {},
    }),
  } as any;
  const make = () => new ExecuteWorkflowActionUseCase(repo, {} as any, {} as any, notify, {} as any, shadow, access);

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
    assert.equal(sent.deepLinkHref, '/companies/co_1/reimbursements/rb_1');
    assert.equal(sent.sourceRefs[0].webPath, sent.deepLinkHref);

    // The approval-review task carries no path of its own: it inherits the sibling's, so LINE
    // and the task list open the exact same screen.
    await make().execute({ ...actionRun(taskAction!.configJson), actionKey: taskAction!.actionKey, actionType: 'CREATE_APPROVAL_REVIEW_REQUEST' }, reimbursementContext);
    const created = (repo.createTask.mock.calls[0] as any).arguments[0];
    assert.equal(created.webDeepLink, '/companies/co_1/reimbursements/rb_1');
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

    // AC11: the submitter is this event's actor and never gets told their own claim is pending
    // approval, but a genuinely different approver (the manager) still does.
    it('excludes the submitter/actor from the alert but still notifies the other approver', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => []);
      repo.findUserIdsByRoles = mock.fn(async () => []);

      await runNotify({ requesterUserId: 'u_owner', actorUserId: 'u_owner', approverRecipientUserIds: ['u_manager', 'u_owner'] });

      assert.deepEqual((notify.execute.mock.calls[0] as any).arguments[0].recipientUserIds, ['u_manager']);
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

    // AC11 + H-18: a solo owner submitting and self-approving excludes the only resolved
    // recipient (themselves). That is expected for an owner-only company, not a failure, so it
    // is a graceful skip (skipWhenAllRecipientsExcluded) rather than a dead-lettered retry.
    it('skips gracefully — never notifies, never retries — when the sole frozen approver is also the actor', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => []);
      repo.findUserIdsByRoles = mock.fn(async () => []);

      await runNotify({ requesterUserId: 'u_owner', actorUserId: 'u_owner', approverRecipientUserIds: ['u_owner'] });

      assert.equal(notify.execute.mock.callCount(), 0);
      const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
      assert.equal(finalUpdate.status, 'SUCCEEDED');
      assert.equal(finalUpdate.resultJson.skipped, true);
      assert.equal(finalUpdate.resultJson.reason, 'all_recipients_excluded');
    });
  });

  // AC11 says the actor of an event is not told about their own action: the payer who just
  // recorded a payment does not hear "paid". "Ready for payment" is the exception (audit B9, owner
  // rule 2026-10-01): its actor approved the claim, and the notice is about the NEXT step, which
  // is theirs when they hold the pay right. Leaving them out is how approved claims sat unpaid.
  describe('reimbursement payment notices and the actor of the event (spec §11 / AC11, audit B9)', () => {
    const runReady = (payload: Record<string, unknown>) => {
      const ready = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_ready_for_payment')!;
      return make().execute(actionRun(ready.defaultActionJson[0]!.configJson), {
        companyId: 'co_1', ruleName: 'Reimbursement ready for payment', sourceModule: 'reimbursements',
        sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-1', amount: '250', currency: 'THB', ...payload },
        siblingActions: [],
      } as any);
    };

    it('ready_for_payment: the approver who can record the payment is told, as their own next step', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_approver', 'u_finance']);
      await runReady({ actorUserId: 'u_approver' });

      const sent = (notify.execute.mock.calls[0] as any).arguments[0];
      assert.deepEqual(sent.recipientUserIds, ['u_approver', 'u_finance']);
      assert.equal(sent.body, 'ยอด 250 THB · รอคุณบันทึกการจ่ายเงิน');
    });

    it('ready_for_payment: a solo owner who approved their own claim gets the one notice to pay it', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner']);
      await runReady({ requesterUserId: 'u_owner', actorUserId: 'u_owner' });

      assert.deepEqual((notify.execute.mock.calls[0] as any).arguments[0].recipientUserIds, ['u_owner']);
      const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
      assert.equal(finalUpdate.status, 'SUCCEEDED');
      assert.notEqual(finalUpdate.resultJson.skipped, true);
    });

    it('ready_for_payment: an approver without the pay right is not told to pay', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_finance']);
      await runReady({ actorUserId: 'u_approver' });

      assert.deepEqual((notify.execute.mock.calls[0] as any).arguments[0].recipientUserIds, ['u_finance']);
    });

    it('payment_recorded: a solo owner paying their own claim skips gracefully instead of notifying themselves', async () => {
      const paid = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_payment_recorded')!;
      repo.findUserIdsByPermissions = mock.fn(async () => []);
      repo.findUserIdsByRoles = mock.fn(async () => []);
      await make().execute(actionRun(paid.defaultActionJson[0]!.configJson), {
        companyId: 'co_1', ruleName: 'Reimbursement payment recorded', sourceModule: 'reimbursements',
        sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: {
          requestId: 'rb_1', requestNo: 'RB-1', paidAmount: '250', currency: 'THB', paymentNo: 'RP-1',
          requesterUserId: 'u_owner', actorUserId: 'u_owner',
        },
        siblingActions: [],
      } as any);

      assert.equal(notify.execute.mock.callCount(), 0);
      const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
      assert.equal(finalUpdate.resultJson.skipped, true);
      assert.equal(finalUpdate.resultJson.reason, 'all_recipients_excluded');
    });
  });

  // Owner rule 2026-10-01: an action notice goes to the person whose turn it is, not to everyone
  // who holds the right. The mechanism is generic; the claim templates that use it follow below.
  describe('preferRecipientPayloadKeys narrows permission recipients to whose turn it is', () => {
    const send = async (cfg: Record<string, unknown>, payload: Record<string, unknown>) => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin', 'u_mgr_1', 'u_mgr_2']);
      await make().execute(
        actionRun({ triggerKey: 'workflow.test', severity: 'action', recipientPermissions: ['reimbursement.payment.record'], ...cfg }),
        { companyId: 'co_1', ruleName: 'r', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1', payload, siblingActions: [] } as any,
      );
      return (notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds;
    };
    const prefer = { preferRecipientPayloadKeys: ['firstChoice', 'secondChoice'], neverPreferRecipientPayloadKeys: ['requesterUserId'] };

    it('takes the first payload group that names somebody able to act', async () => {
      assert.deepEqual(await send(prefer, { firstChoice: 'u_mgr_1', secondChoice: ['u_admin'] }), ['u_mgr_1']);
      // A list is a group: everyone in it who can act, and nobody else.
      assert.deepEqual(await send(prefer, { firstChoice: ['u_mgr_2', 'u_mgr_1', 'u_gone'] }), ['u_mgr_1', 'u_mgr_2']);
    });

    it('moves to the next group when the first names nobody able, or only someone never preferred', async () => {
      assert.deepEqual(await send(prefer, { firstChoice: 'u_cannot_act', secondChoice: ['u_admin', 'u_mgr_2'] }), ['u_admin', 'u_mgr_2']);
      assert.deepEqual(await send(prefer, { firstChoice: 'u_mgr_1', secondChoice: 'u_admin', requesterUserId: 'u_mgr_1' }), ['u_admin']);
    });

    it('keeps the whole group when no preferred group has anyone able to act', async () => {
      const everyone = ['u_owner', 'u_admin', 'u_mgr_1', 'u_mgr_2'];
      assert.deepEqual(await send(prefer, {}), everyone);
      assert.deepEqual(await send(prefer, { firstChoice: 'u_cannot_act', secondChoice: [] }), everyone);
      // Never preferred is not excluded: with nobody else to prefer, they are still in the whole group.
      assert.deepEqual(await send(prefer, { firstChoice: 'u_owner', requesterUserId: 'u_owner' }), everyone);
    });

    it('leaves a rule snapshot without the key exactly as it was: everyone able to act', async () => {
      const everyone = ['u_owner', 'u_admin', 'u_mgr_1', 'u_mgr_2'];
      assert.deepEqual(await send({}, { firstChoice: 'u_mgr_1', actorUserId: 'u_mgr_1', requesterUserId: 'u_staff' }), everyone);
      // The pre-preference ready-to-pay snapshot, as rules pinned before this change still hold it.
      assert.deepEqual(await send({
        triggerKey: 'workflow.reimbursement_ready_for_payment', titleTemplate: 'พร้อมจ่ายเบิกจ่าย: {{requestNo}}',
        bodyTemplate: 'ยอด {{amount}} {{currency}} · รอคุณบันทึกการจ่ายเงิน',
      }, { requestNo: 'RB-1', amount: '250', currency: 'THB', actorUserId: 'u_mgr_1', requesterUserId: 'u_staff' }), everyone);
    });

    it('narrows only the permission group, never role or payload recipients', async () => {
      repo.findUserIdsByRoles = mock.fn(async () => ['u_auditor']);
      assert.deepEqual(
        await send({ ...prefer, recipientRoles: ['AUDITOR_READONLY'], recipientPayloadKeys: ['watcherUserId'] }, { firstChoice: 'u_mgr_1', watcherUserId: 'u_watcher' }),
        ['u_auditor', 'u_mgr_1', 'u_watcher'],
      );
    });
  });

  // Audit B9: a requester told "paid" was never told when that payment was taken back.
  describe('payment voided notice to the requester (audit B9)', () => {
    const voided = () => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_payment_voided')!;
    // What the void transaction writes: the source is the PAYMENT, the claim rides the payload.
    const runVoided = (payload: Record<string, unknown>) => make().execute(
      { ...actionRun(voided().defaultActionJson[0]!.configJson), actionKey: voided().defaultActionJson[0]!.actionKey },
      {
        companyId: 'co_1', ruleName: voided().name, sourceModule: 'reimbursements',
        sourceType: 'reimbursement_payment', sourceId: 'pay_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-202610-00007', requesterUserId: 'u_requester', paymentStatus: 'UNPAID', reversalEntryId: null, ...payload },
        siblingActions: voided().defaultActionJson,
      } as any,
    );

    it('tells the requester in plain Thai, with the link to the claim and no figure', async () => {
      await runVoided({ actorUserId: 'u_payer' });

      const sent = (notify.execute.mock.calls[0] as any).arguments[0];
      assert.deepEqual(sent.recipientUserIds, ['u_requester']);
      assert.equal(sent.triggerKey, 'workflow.reimbursement_payment_voided');
      assert.equal(sent.title, 'ยกเลิกการจ่ายเงินเบิก: RB-202610-00007');
      assert.equal(sent.body, 'การจ่ายเงินที่บันทึกไว้ถูกยกเลิก ใบเบิกกลับไปรอจ่าย');
      // The claim page, not a payment id: the source of this event is the payment row.
      assert.equal(sent.deepLinkHref, '/companies/co_1/reimbursements/rb_1');
      // The claim number is the only figure anywhere in the notice: no amount, no account, no id.
      assert.doesNotMatch(sent.body, /\d/);
      assert.doesNotMatch(`${sent.title} ${sent.body}`, /https?:|[A-Z]{2,}_[A-Z_]+|UNPAID|pay_1|rb_1/);
    });

    it('does not tell a requester who voided their own payment', async () => {
      await runVoided({ actorUserId: 'u_requester' });

      assert.equal(notify.execute.mock.callCount(), 0);
      const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
      assert.equal(finalUpdate.status, 'SUCCEEDED');
      assert.equal(finalUpdate.resultJson.reason, 'all_recipients_excluded');
    });

    it('subscribes to the void event and skips one written before the payload named the requester', () => {
      assert.equal(voided().autoEnable, true);
      assert.ok(ruleMatchesEventType(WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG['reimbursement_payment_voided']!, 'reimbursement.payment_voided'));
      const now = new Date('2026-10-01T00:00:00.000Z');
      assert.equal(evaluateCondition(voided().defaultConditionJson, { requestId: 'rb_1', paymentStatus: 'UNPAID' }, now).matched, false);
      assert.equal(evaluateCondition(voided().defaultConditionJson, { requestId: 'rb_1', requesterUserId: 'u_requester' }, now).matched, true);
    });
  });

  // Audit B9: nothing reminded anyone that a claim was waiting for payment.
  describe('payment reminder notice (audit B9)', () => {
    const reminder = () => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_payment_sla_breach')!;
    const runReminder = () => make().execute(
      { ...actionRun(reminder().defaultActionJson[0]!.configJson), actionKey: reminder().defaultActionJson[0]!.actionKey },
      {
        companyId: 'co_1', ruleName: reminder().name, sourceModule: 'reimbursements',
        sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-202610-00007', ageHours: 80, slaRisk: true, amount: '250', currency: 'THB' },
        siblingActions: reminder().defaultActionJson,
      } as any,
    );

    it('reminds everyone who can record the payment, in plain Thai, with the link to the claim', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_approver', 'u_finance']);
      await runReminder();

      assert.deepEqual((repo.findUserIdsByPermissions.mock.calls[0] as any).arguments, ['co_1', ['reimbursement.payment.record']]);
      const sent = (notify.execute.mock.calls[0] as any).arguments[0];
      assert.deepEqual(sent.recipientUserIds, ['u_approver', 'u_finance']);
      assert.equal(sent.triggerKey, 'workflow.reimbursement_payment_sla_breach');
      assert.equal(sent.severity, 'critical');
      assert.equal(sent.title, 'ใบเบิกรอจ่ายเงินเกินกำหนด: RB-202610-00007');
      assert.equal(sent.body, 'ยอด 250 THB · รอคุณบันทึกการจ่ายเงิน');
      assert.equal(sent.deepLinkHref, '/companies/co_1/reimbursements/rb_1');
      assert.doesNotMatch(`${sent.title} ${sent.body}`, /SLA|[A-Z]{2,}_[A-Z_]+|rb_1/);
    });

    // The scan comes round again every window. Retrying into a dead letter each time (a suspended
    // company, nobody covering the branch) would bury the dead-letter list; an EVENT still retries.
    it('skips quietly when nobody can record the payment right now, instead of dead-lettering every scan', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => []);
      await runReminder();

      assert.equal(notify.execute.mock.callCount(), 0);
      const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
      assert.equal(finalUpdate.status, 'SUCCEEDED');
      assert.deepEqual(finalUpdate.resultJson, { skipped: true, reason: 'no_recipients' });

      const ready = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_ready_for_payment')!;
      await make().execute(actionRun(ready.defaultActionJson[0]!.configJson), {
        companyId: 'co_1', ruleName: ready.name, sourceModule: 'reimbursements', sourceType: 'reimbursement_request',
        sourceId: 'rb_1', payload: { requestId: 'rb_1', requestNo: 'RB-1', amount: '250', currency: 'THB' }, siblingActions: [],
      } as any);
      assert.equal((repo.updateActionRun.mock.calls.at(-1) as any).arguments[1].status, 'FAILED_RETRYABLE');
    });
  });

  // Audit B15: `decision` is a code word in the event payload. A notice says it in the words the
  // claim page uses, whatever the rule snapshot holds, because LINE pushes the stored text as it is.
  describe('claim notices never print a decision code word (audit B15)', () => {
    const notice = async (templateKey: string, decision: string) => {
      const template = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === templateKey)!;
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_finance']);
      await make().execute(actionRun(template.defaultActionJson[0]!.configJson), {
        companyId: 'co_1', ruleName: template.name, sourceModule: 'reimbursements',
        sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: {
          requestId: 'rb_1', requestNo: 'RB-1', amount: '250', currency: 'THB', decision,
          requesterUserId: 'u_requester', actorUserId: 'u_filer',
        },
        siblingActions: [],
      } as any);
      return (notify.execute.mock.calls.at(-1) as any).arguments[0];
    };

    it('tells the requester of a below-threshold claim filed on their behalf in plain Thai', async () => {
      const sent = await notice('reimbursement_decision_requester', 'BELOW_APPROVAL_THRESHOLD');

      assert.deepEqual(sent.recipientUserIds, ['u_requester']);
      assert.equal(sent.title, 'ผลอนุมัติเบิกจ่าย: RB-1');
      assert.equal(sent.body, 'ผลการพิจารณา: ไม่ต้องอนุมัติตามนโยบาย · ยอด 250 THB');
    });

    it('says every decision a shipped claim notice can carry in Thai', async () => {
      for (const [templateKey, decision, words] of [
        ['reimbursement_decision_requester', 'APPROVED', 'อนุมัติ'],
        ['reimbursement_decision_requester', 'REJECTED', 'ไม่อนุมัติ'],
        ['reimbursement_decision_requester', 'BELOW_APPROVAL_THRESHOLD', 'ไม่ต้องอนุมัติตามนโยบาย'],
        ['reimbursement_finance_review', 'BLOCKED', 'ระงับ'],
      ] as const) {
        const sent = await notice(templateKey, decision);
        assert.ok(sent.body.includes(`: ${words} ·`), `${templateKey} ${decision}: ${sent.body}`);
        assert.doesNotMatch(`${sent.title} ${sent.body}`, /[A-Z]{2,}_[A-Z_]+|APPROVED|REJECTED|BLOCKED/, decision);
      }
    });

    it('prints a value it has no words for as it came, never a JavaScript internal', async () => {
      const sent = await notice('reimbursement_decision_requester', 'constructor');
      assert.equal(sent.body, 'ผลการพิจารณา: constructor · ยอด 250 THB');
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
    assert.equal(sent.body, 'ยอด 250 THB · รอคุณบันทึกการจ่ายเงิน');
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

  it('falls back to the reimbursement journey page (never /reimbursements/reimbursement_request/:id) when no path template is set', async () => {
    repo.findUserIdsByRoles = mock.fn(async () => ['u_manager']);
    await make().execute(actionRun({ triggerKey: 'workflow.test', severity: 'info', recipientRoles: ['MANAGER'] }), {
      companyId: 'co_1', ruleName: 'r', sourceModule: 'reimbursements', sourceType: 'reimbursement_request',
      sourceId: 'rb_9', payload: {}, siblingActions: [],
    } as any);
    const sent = (notify.execute.mock.calls[0] as any).arguments[0];
    assert.equal(sent.deepLinkHref, '/companies/co_1/reimbursements/rb_9');
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
    assert.equal(sent.deepLinkHref, '/companies/co_1/reimbursements/rb_9');
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
 * Audit B12: a recipient picked by permission must be able to act on THIS record, or the notice is
 * a link that answers 403. The REAL permission resolver decides here (over membership fixtures),
 * so the three rules it applies (ACTIVE role, entitlement filter, branch scope) are the three
 * rules these tests prove, not a restatement of them.
 */
describe('SEND_NOTIFICATION recipients picked by permission can act on the record (audit B12)', () => {
  const PAY = 'reimbursement.payment.record';
  const APPROVE_BILL = 'procurement.vendor_bill.approve';
  const role = (status: string, permission: string) => ({
    role: { key: 'CUSTOM_PAYER', status, permissions: [{ permission: { key: permission } }] },
  });
  const member = (extra: Record<string, unknown> = {}) => ({
    id: 'm', companyId: 'co_1', branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null,
    roles: [role('ACTIVE', PAY)], branchScopes: [], company: { status: 'ACTIVE' }, ...extra,
  });

  function harness(opts: {
    memberships: Record<string, unknown>;
    sourceBranchId?: string | null;
    entitlements?: Array<{ featureKey: string; enabled: boolean }>;
  }) {
    const updates: any[] = [];
    const sent: any[] = [];
    const repo = {
      updateActionRun: async (_id: string, data: any) => { updates.push(data); },
      findUserIdsByRoles: async () => [],
      // The query's own rule: every active member holding the right through ANY role.
      findUserIdsByPermissions: async () => Object.keys(opts.memberships),
      findSourceBranchId: mock.fn(async () => opts.sourceBranchId ?? null),
    } as any;
    const prisma = {
      client: {
        companyMembership: { findFirst: async ({ where }: any) => opts.memberships[where.userId] ?? null },
        // Every branch named in a scope is ACTIVE here; a closed branch is the resolver's own spec.
        branch: { findMany: async ({ where }: any) => (where.id.in as string[]).map((id) => ({ id })) },
        companyFeatureEntitlement: { findMany: async () => opts.entitlements ?? [] },
      },
    } as any;
    const access = new PermissionResolverService(new PrismaPermissionResolverRepository(prisma));
    const notify = { execute: async (input: any) => { sent.push(input); return { skipped: false, event: { id: 'ne_1' } }; } } as any;
    const shadow = { startSweep: () => { throw new Error('no shadow sweep on this action type'); } } as any;
    return {
      useCase: new ExecuteWorkflowActionUseCase(repo, {} as any, {} as any, notify, {} as any, shadow, access),
      repo, sent, updates,
    };
  }

  const readyToPay = () => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_ready_for_payment')!;
  const claimContext = (): any => ({
    companyId: 'co_1', ruleName: 'Reimbursement ready for payment', sourceModule: 'reimbursements',
    sourceType: 'reimbursement_request', sourceId: 'rb_1',
    payload: { requestId: 'rb_1', requestNo: 'RB-1', amount: '250', currency: 'THB', actorUserId: 'u_someone_else' },
    siblingActions: [],
  });

  it('notifies neither a member outside the claim branch nor a member whose paying role is inactive', async () => {
    const h = harness({
      sourceBranchId: 'br_claim',
      memberships: {
        u_all_branches: member(),
        u_claim_branch_only: member({ branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'br_claim' }),
        u_other_branch: member({ branchScopeMode: 'SELECTED_BRANCHES', branchScopes: [{ branchId: 'br_other' }] }),
        u_inactive_role: member({ roles: [role('DISABLED', PAY)] }),
      },
    });

    await h.useCase.execute(actionRun(readyToPay().defaultActionJson[0]!.configJson), claimContext());

    assert.deepEqual(h.sent[0]?.recipientUserIds, ['u_all_branches', 'u_claim_branch_only']);
    assert.deepEqual((h.repo.findSourceBranchId.mock.calls[0] as any).arguments, ['co_1', 'reimbursement_request', 'rb_1']);
    assert.equal(h.updates.at(-1)?.status, 'SUCCEEDED');
  });

  it('keeps a branch-limited payer for a company-central claim, exactly as the pay endpoint does', async () => {
    const h = harness({
      sourceBranchId: null,
      memberships: { u_other_branch: member({ branchScopeMode: 'SELECTED_BRANCHES', branchScopes: [{ branchId: 'br_other' }] }) },
    });

    await h.useCase.execute(actionRun(readyToPay().defaultActionJson[0]!.configJson), claimContext());

    assert.deepEqual(h.sent[0]?.recipientUserIds, ['u_other_branch']);
  });

  it('drops a holder whose right is switched off by the company entitlement', async () => {
    const billContext = context(approvalRecordedPayload);
    const cfg = secondApprovalTemplate.defaultActionJson[0]!.configJson;
    const memberships = { u_second: member({ roles: [role('ACTIVE', APPROVE_BILL)] }) };

    // No entitlement rows at all is the legacy fail-open company: the right stands.
    const open = harness({ memberships });
    await open.useCase.execute(actionRun(cfg), billContext);
    assert.deepEqual(open.sent[0]?.recipientUserIds, ['u_second']);

    // Rows exist and procurement is not among them: the resolver strips the right, so nobody is
    // left to tell. Nothing resolving at all stays the retryable failure it always was.
    const closed = harness({ memberships, entitlements: [{ featureKey: 'expenses', enabled: true }] });
    await closed.useCase.execute(actionRun(cfg), billContext);
    assert.equal(closed.sent.length, 0);
    assert.equal(closed.updates.at(-1)?.status, 'FAILED_RETRYABLE');
  });

  it('drops a holder the resolver refuses outright without failing the others', async () => {
    const h = harness({
      memberships: {
        u_payer: member(),
        // SELECTED_BRANCHES with no branch left: the resolver answers 403 for this member.
        u_no_branch_left: member({ branchScopeMode: 'SELECTED_BRANCHES', branchScopes: [] }),
        u_suspended_company: member({ company: { status: 'SUSPENDED' } }),
      },
    });

    await h.useCase.execute(actionRun(readyToPay().defaultActionJson[0]!.configJson), claimContext());

    assert.deepEqual(h.sent[0]?.recipientUserIds, ['u_payer']);
  });

  it('reads the branch from the claim or the vendor bill, and from nothing else', async () => {
    const queries: any[] = [];
    const table = (name: string, branchId: string | null) => ({
      findFirst: async (query: any) => { queries.push({ name, ...query }); return { branchId }; },
    });
    const repository = new PrismaWorkflowRepository({
      client: { reimbursementRequest: table('claim', 'br_claim'), vendorBill: table('bill', null) },
    } as any);

    assert.equal(await repository.findSourceBranchId('co_1', 'reimbursement_request', 'rb_1'), 'br_claim');
    assert.equal(await repository.findSourceBranchId('co_1', 'vendor_bill', 'bill_1'), null);
    assert.equal(await repository.findSourceBranchId('co_1', 'stock_balance', 'p_1'), null);
    assert.equal(await repository.findSourceBranchId('co_1', 'reimbursement_request', undefined), null);
    // Tenant-bound: the record is looked up inside the run's own company, never by id alone.
    assert.deepEqual(queries, [
      { name: 'claim', where: { id: 'rb_1', companyId: 'co_1' }, select: { branchId: true } },
      { name: 'bill', where: { id: 'bill_1', companyId: 'co_1' }, select: { branchId: true } },
    ]);
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
      useCase: new ExecuteWorkflowActionUseCase(repo, audit, {} as any, {} as any, {} as any, shadow, {} as any),
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
