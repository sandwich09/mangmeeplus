import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  reimbursementPaymentVoidedNotice, reimbursementPayoutAnswerNotice, reimbursementPayoutSentBackNotice,
  type ReimbursementPayoutCorrectionReason, type ReimbursementPayoutHeld, type ReimbursementPayoutRoundAnswer,
} from '@watchdog-bms/contracts';
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
  // Every holder in these tests can act; who cannot is the subject of the B12 block below. `u_owner` is the shop owner.
  const access = {
    resolveAccess: async (userId: string) => ({
      permissions: ['procurement.vendor_bill.approve', 'reimbursement.payment.record', 'reimbursement.finance_review'],
      roles: userId === 'u_owner' ? ['OWNER'] : ['STAFF'],
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
      await runReady({ actorUserId: 'u_approver', requesterUserId: 'u_staff' });

      const sent = (notify.execute.mock.calls[0] as any).arguments[0];
      assert.deepEqual(sent.recipientUserIds, ['u_approver']);
      assert.equal(sent.body, 'ยอด 250.00 บาท · รอคุณบันทึกการจ่ายเงิน');
    });

    // Owner, 2026-10-01: "แจ้งเตือนไปเจ้าของตลอดแบบนี้น่ารำคาญ". The shop owner holds every right, so
    // "everyone who can pay" pushed the owner for every approved claim. It is the approver's turn.
    it('ready_for_payment: a manager approves where the owner, an admin and a second manager can all pay, and only that manager is told', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin', 'u_manager', 'u_manager_2']);
      await runReady({ actorUserId: 'u_manager', requesterUserId: 'u_staff' });

      assert.deepEqual((notify.execute.mock.calls[0] as any).arguments[0].recipientUserIds, ['u_manager']);
    });

    it('ready_for_payment: the finance reviewer who passed the claim is the one told, when they can pay', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_finance', 'u_manager']);
      await runReady({ actorUserId: 'u_finance', requesterUserId: 'u_staff', decision: 'APPROVED_FOR_PAYMENT' });

      assert.deepEqual((notify.execute.mock.calls[0] as any).arguments[0].recipientUserIds, ['u_finance']);
    });

    // Review: a finance reviewer without the pay right passes a claim, and the notice went straight
    // to everyone able to pay. The event names the claim's own approver, who is asked next.
    it('ready_for_payment: when the finance reviewer cannot pay, the claim approver is told before everyone else', async () => {
      const passedByFinance = { actorUserId: 'u_finance', requesterUserId: 'u_staff', decision: 'APPROVED_FOR_PAYMENT', approverRecipientUserIds: ['u_manager'] };
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin', 'u_manager']);
      await runReady(passedByFinance);
      assert.deepEqual((notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds, ['u_manager']);

      // Neither of them can pay: everyone who can.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin']);
      await runReady(passedByFinance);
      assert.deepEqual((notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds, ['u_owner', 'u_admin']);

      // The finance reviewer can pay: it stays their turn, not the approver's.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_finance', 'u_manager']);
      await runReady(passedByFinance);
      assert.deepEqual((notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds, ['u_finance']);
    });

    it('ready_for_payment: a claim that needed no approval, filed on someone else\'s behalf, goes to whoever filed it', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_preparer']);
      await runReady({ actorUserId: 'u_preparer', requesterUserId: 'u_staff', decision: 'BELOW_APPROVAL_THRESHOLD' });

      assert.deepEqual((notify.execute.mock.calls[0] as any).arguments[0].recipientUserIds, ['u_preparer']);
    });

    // The requester filed it and nobody approved it: the actor IS the requester, who is never the
    // one told alone to pay their own claim, so the notice goes to everyone who can.
    it('ready_for_payment: a claim that needed no approval, filed by its requester, does not go to the requester alone', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_manager', 'u_requester']);
      await runReady({ actorUserId: 'u_requester', requesterUserId: 'u_requester', decision: 'BELOW_APPROVAL_THRESHOLD' });

      assert.deepEqual((notify.execute.mock.calls[0] as any).arguments[0].recipientUserIds, ['u_owner', 'u_manager', 'u_requester']);
    });

    // ...unless the event names who would have approved it: they are asked before everyone else.
    it('ready_for_payment: a claim that needed no approval goes to the people who would have approved it, when they can pay', async () => {
      const filedByRequester = { actorUserId: 'u_requester', requesterUserId: 'u_requester', decision: 'BELOW_APPROVAL_THRESHOLD' };
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_manager', 'u_manager_2', 'u_requester']);
      await runReady({ ...filedByRequester, approverRecipientUserIds: ['u_manager', 'u_manager_2', 'u_requester'] });
      assert.deepEqual((notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds, ['u_manager', 'u_manager_2']);

      // None of them can record the payment: everyone who can is told.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin']);
      await runReady({ ...filedByRequester, approverRecipientUserIds: ['u_manager'] });
      assert.deepEqual((notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds, ['u_owner', 'u_admin']);

      // Filed on someone's behalf: whoever filed it still comes first.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_manager', 'u_preparer']);
      await runReady({ actorUserId: 'u_preparer', requesterUserId: 'u_staff', approverRecipientUserIds: ['u_manager'] });
      assert.deepEqual((notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds, ['u_preparer']);
    });

    // Owner rule: the approver keeps the to-do item in the bell, without a LINE push about an
    // approval they have just made themselves. Anyone else who is told is pushed as usual.
    it('ready_for_payment: the actor of the event gets the notice in the web bell only, others on LINE too', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_approver', 'u_finance']);
      await runReady({ actorUserId: 'u_approver', requesterUserId: 'u_staff' });
      let sent = (notify.execute.mock.calls.at(-1) as any).arguments[0];
      assert.deepEqual(sent.recipientUserIds, ['u_approver']);
      assert.deepEqual(sent.webOnlyRecipientUserIds, ['u_approver']);

      // The approver cannot pay: the others are told, and none of them is the actor.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_finance']);
      await runReady({ actorUserId: 'u_approver', requesterUserId: 'u_staff' });
      sent = (notify.execute.mock.calls.at(-1) as any).arguments[0];
      assert.deepEqual(sent.recipientUserIds, ['u_owner', 'u_finance']);
      assert.equal(sent.recipientUserIds.some((userId: string) => sent.webOnlyRecipientUserIds.includes(userId)), false);

      // A solo owner who approved their own claim: told with everyone able to pay, in the bell only.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin']);
      await runReady({ actorUserId: 'u_owner', requesterUserId: 'u_owner' });
      sent = (notify.execute.mock.calls.at(-1) as any).arguments[0];
      assert.deepEqual(sent.recipientUserIds, ['u_owner', 'u_admin']);
      assert.deepEqual(sent.webOnlyRecipientUserIds, ['u_owner']);
    });

    it('a notice that names nobody for the bell only pushes everyone on LINE, as before', async () => {
      const paid = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_payment_recorded')!;
      await make().execute(actionRun(paid.defaultActionJson[0]!.configJson), {
        companyId: 'co_1', ruleName: paid.name, sourceModule: 'reimbursements', sourceType: 'reimbursement_payment', sourceId: 'pay_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-1', paidAmount: '250', currency: 'THB', paymentNo: 'RP-1', requesterUserId: 'u_staff', actorUserId: 'u_payer' },
        siblingActions: [],
      } as any);

      assert.deepEqual((notify.execute.mock.calls.at(-1) as any).arguments[0].webOnlyRecipientUserIds, []);
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

  // Review M1: the notice store keeps one notice per trigger, record and period. An event's run is
  // its period, so the next event of the same kind is a new notice; a scan has none of its own.
  describe('the period a notice belongs to (review M1)', () => {
    const pending = () => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_pending_approval')!;
    const sendPending = async (run: Record<string, unknown>, context: Record<string, unknown>) => {
      const [notifyAction] = pending().defaultActionJson;
      await make().execute({ ...actionRun(notifyAction!.configJson), actionKey: notifyAction!.actionKey, ...run }, {
        companyId: 'co_1', ruleName: 'Reimbursement pending approval', sourceModule: 'reimbursements',
        sourceType: 'reimbursement_request', sourceId: 'rb_1', siblingActions: pending().defaultActionJson,
        payload: { requestId: 'rb_1', requestNo: 'RB-1', amount: '250', currency: 'THB', approverRecipientUserIds: ['u_manager'] },
        ...context,
      } as any);
      return (notify.execute.mock.calls.at(-1) as any).arguments[0];
    };

    it('files an event notice under its run, so a claim sent again is a new notice and a retry is not', async () => {
      const round1 = await sendPending({ workflowRunId: 'run_round_1' }, { triggerType: 'EVENT' });
      const retry = await sendPending({ workflowRunId: 'run_round_1', attemptCount: 1 }, { triggerType: 'EVENT' });
      const round2 = await sendPending({ workflowRunId: 'run_round_2' }, { triggerType: 'EVENT' });

      assert.deepEqual([round1.periodKey, retry.periodKey, round2.periodKey], ['run_round_1', 'run_round_1', 'run_round_2']);
      // The newer notice replaces the older one in the bell.
      assert.equal(round2.supersedeEarlier, true);
    });

    // Final review item 15: after a void the "paid" notice of the claim is no longer true, and after the next
    // payment the "voided" one is not. Each replaces the other, whatever the rule's own config says.
    it('has "payment voided" replace the claim\'s "paid" notice and the reverse, and no other notice replace another kind', async () => {
      const sentFor = async (templateKey: string, configJson?: Record<string, unknown>) => {
        const template = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === templateKey)!;
        const [notifyAction] = template.defaultActionJson;
        await make().execute({ ...actionRun(configJson ?? notifyAction!.configJson), actionKey: notifyAction!.actionKey, workflowRunId: `run_${templateKey}` }, {
          companyId: 'co_1', ruleName: template.name, sourceModule: 'reimbursements', sourceType: 'reimbursement_payment', sourceId: 'pay_1',
          triggerType: 'EVENT', siblingActions: template.defaultActionJson,
          payload: {
            requestId: 'rb_1', requestNo: 'RB-1', paidAmount: '250', currency: 'THB', paymentNo: 'RP-1', paidNotice: 'โอนเงิน 250.00 บาท',
            requesterUserId: 'u_staff', actorUserId: 'u_payer', approverRecipientUserIds: ['u_manager'],
          },
        } as any);
        return (notify.execute.mock.calls.at(-1) as any).arguments[0];
      };

      const voided = await sentFor('reimbursement_payment_voided');
      assert.equal(voided.supersedeEarlier, true);
      assert.deepEqual(voided.alsoSupersedeTriggerKeys, ['workflow.reimbursement_payment_recorded']);
      assert.deepEqual((await sentFor('reimbursement_payment_recorded')).alsoSupersedeTriggerKeys, ['workflow.reimbursement_payment_voided']);
      // A rule pinned before this, with the body it had then: the pairing is the notice's, not the rule's.
      const pinned = { triggerKey: 'workflow.reimbursement_payment_voided', recipientPayloadKeys: ['requesterUserId'], severity: 'info', titleTemplate: 'ยกเลิกการจ่ายเงินเบิก: {{requestNo}}' };
      assert.deepEqual((await sentFor('reimbursement_payment_voided', pinned)).alsoSupersedeTriggerKeys, ['workflow.reimbursement_payment_recorded']);
      assert.equal((await sentFor('reimbursement_pending_approval')).alsoSupersedeTriggerKeys, undefined);
    });

    it('gives a scan notice no period of its own, so a scan window never pushes again', async () => {
      for (const triggerType of ['SLA_SCAN', 'THRESHOLD_SCAN', 'SCHEDULE']) {
        const sent = await sendPending({ workflowRunId: `run_${triggerType}` }, { triggerType });
        assert.equal(sent.periodKey, undefined, triggerType);
      }
    });

    it('takes the period a scan names in its payload: one push per period, not per window', async () => {
      const payload = { requestId: 'rb_1', requestNo: 'RB-1', approverRecipientUserIds: ['u_manager'], notificationPeriodKey: 'round:2026-10-01T03:00:00.000Z' };
      const first = await sendPending({ workflowRunId: 'run_hour_1' }, { triggerType: 'SLA_SCAN', payload });
      const nextWindow = await sendPending({ workflowRunId: 'run_hour_2' }, { triggerType: 'SLA_SCAN', payload });

      assert.deepEqual([first.periodKey, nextWindow.periodKey], ['round:2026-10-01T03:00:00.000Z', 'round:2026-10-01T03:00:00.000Z']);
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

    // Owner decision 2026-10-02: a notice that goes to everyone holding a right reached the shop owner every time,
    // because the owner holds every right. `lastResortRecipientRoles` leaves the holders of a role out while anybody
    // else is able to act. Before, there was no way to say so: the whole group was told.
    it('leaves the holders of a last-resort role out while anybody else can act, and tells them when nobody else can', async () => {
      const lastResort = { lastResortRecipientRoles: ['OWNER'] };
      assert.deepEqual(await send(lastResort, {}), ['u_admin', 'u_mgr_1', 'u_mgr_2']);
      // Whoever the event names comes first, as before: the owner too, when it is the owner's own turn.
      assert.deepEqual(await send({ ...prefer, ...lastResort }, { firstChoice: 'u_owner' }), ['u_owner']);
      assert.deepEqual(await send({ ...prefer, ...lastResort }, { firstChoice: 'u_mgr_1' }), ['u_mgr_1']);
      // The event names nobody able to act: everyone else who is, and still not the owner.
      assert.deepEqual(await send({ ...prefer, ...lastResort }, { firstChoice: 'u_cannot_act' }), ['u_admin', 'u_mgr_1', 'u_mgr_2']);
      // A role nobody here holds leaves nobody out, and a list that is no list is read as none.
      assert.deepEqual(await send({ lastResortRecipientRoles: ['AUDITOR_READONLY'] }, {}), ['u_owner', 'u_admin', 'u_mgr_1', 'u_mgr_2']);
      assert.deepEqual(await send({ lastResortRecipientRoles: 'OWNER' }, {}), ['u_owner', 'u_admin', 'u_mgr_1', 'u_mgr_2']);

      // Nobody but the owner can act: the owner is the one to tell.
      const alone = async (cfg: Record<string, unknown>) => {
        repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner']);
        await make().execute(
          actionRun({ triggerKey: 'workflow.test', severity: 'action', recipientPermissions: ['reimbursement.payment.record'], ...cfg }),
          { companyId: 'co_1', ruleName: 'r', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1', payload: {}, siblingActions: [] } as any,
        );
        return (notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds;
      };
      assert.deepEqual(await alone(lastResort), ['u_owner']);
      // The roles are the ones the permission resolver answered for each holder: no role is looked up for this.
      assert.ok(repo.findUserIdsByRoles.mock.calls.every((call: any) => call.arguments[1].length === 0));
    });

    // Controller decision 2026-10-02: a notice that leaves its actor out weighs its last resort AFTER that. Someone
    // who is not going to get the notice is not "somebody else able to act": where the actor is the only other
    // holder, the last resort is told. Before, the actor counted as somebody else and was then left out, so nobody
    // was told and the record just sat.
    it('weighs the last resort after leaving out whoever the notice excludes, so its actor is not the "somebody else"', async () => {
      const leavesActorOut = { lastResortRecipientRoles: ['OWNER'], excludeRecipientPayloadKeys: ['actorUserId'], skipWhenAllRecipientsExcluded: true };
      /** Who is told of an event by `actorUserId` when these people hold the right, and how the action ended. */
      const told = async (holders: string[], actorUserId: string, cfg: Record<string, unknown> = leavesActorOut) => {
        repo.findUserIdsByPermissions = mock.fn(async () => holders);
        const before = notify.execute.mock.callCount();
        await make().execute(
          actionRun({ triggerKey: 'workflow.test', severity: 'action', recipientPermissions: ['reimbursement.finance_review'], ...cfg }),
          { companyId: 'co_1', ruleName: 'r', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1', payload: { actorUserId }, siblingActions: [] } as any,
        );
        const final = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
        return { to: notify.execute.mock.callCount() > before ? (notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds : null, status: final.status, skipped: final.resultJson?.reason ?? null };
      };

      // Somebody else can act: they are told, and neither the actor nor the last resort is.
      assert.deepEqual(await told(['u_owner', 'u_admin', 'u_mgr_1'], 'u_admin'), { to: ['u_mgr_1'], status: 'SUCCEEDED', skipped: null });
      // The actor is the only other holder: nobody else is left, so the last resort is told. The actor is not.
      assert.deepEqual(await told(['u_owner', 'u_admin'], 'u_admin'), { to: ['u_owner'], status: 'SUCCEEDED', skipped: null });
      // The last resort acted, alone: nobody is told, quietly (nothing is retried into a dead letter).
      assert.deepEqual(await told(['u_owner'], 'u_owner'), { to: null, status: 'SUCCEEDED', skipped: 'all_recipients_excluded' });
      // The last resort acted where others can act: they are told.
      assert.deepEqual(await told(['u_owner', 'u_admin'], 'u_owner'), { to: ['u_admin'], status: 'SUCCEEDED', skipped: null });

      // A notice that does NOT leave its actor out is as it was: the actor is somebody else who can act, and is told.
      assert.deepEqual((await told(['u_owner', 'u_admin'], 'u_admin', { lastResortRecipientRoles: ['OWNER'] })).to, ['u_admin']);
      // And a notice with no last resort leaves its actor out exactly as before, whoever else there is.
      const noLastResort = { excludeRecipientPayloadKeys: ['actorUserId'], skipWhenAllRecipientsExcluded: true };
      assert.deepEqual((await told(['u_owner', 'u_admin', 'u_mgr_1'], 'u_admin', noLastResort)).to, ['u_owner', 'u_mgr_1']);
      assert.deepEqual(await told(['u_admin'], 'u_admin', noLastResort), { to: null, status: 'SUCCEEDED', skipped: 'all_recipients_excluded' });
      // Without the quiet-skip key, everyone being left out is still the failure it was (the vendor bill's second approver).
      assert.deepEqual(await told(['u_admin'], 'u_admin', { excludeRecipientPayloadKeys: ['actorUserId'] }), { to: null, status: 'FAILED_RETRYABLE', skipped: null });
    });
  });

  // Audit B9: a requester told "paid" was never told when that payment was taken back.
  describe('payment voided notice to the requester (audit B9)', () => {
    const voided = () => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_payment_voided')!;
    // What the void transaction writes: the source is the PAYMENT, the claim rides the payload.
    const runVoided = (payload: Record<string, unknown>, cfg = voided().defaultActionJson[0]!.configJson) => make().execute(
      { ...actionRun(cfg), actionKey: voided().defaultActionJson[0]!.actionKey },
      {
        companyId: 'co_1', ruleName: voided().name, sourceModule: 'reimbursements',
        sourceType: 'reimbursement_payment', sourceId: 'pay_1',
        payload: { eventType: 'reimbursement.payment_voided', requestId: 'rb_1', requestNo: 'RB-202610-00007', requesterUserId: 'u_requester', paymentStatus: 'UNPAID', reversalEntryId: null, ...payload },
        siblingActions: voided().defaultActionJson,
      } as any,
    );

    it('D2: voided notices retain only the requester and state the actual next step even for an edited rule', async (t) => {
      for (const block of [undefined, 'NONE', 'UNRESOLVED', 'CONFIRMED'] as const) await t.test(block ?? 'legacy', async () => {
        notify.execute.mock.resetCalls();
        const text = reimbursementPaymentVoidedNotice({ status: 'READY_FOR_PAYMENT', paymentDuplicateBlock: block,
          duplicateReasons: block === 'CONFIRMED' ? ['EXPENSE_CONFIRMED_DUPLICATE'] : ['ATTACHMENT_CHECKSUM'] });
        await runVoided({ actorUserId: 'u_payer', ...(block && { paymentVoidedNotice: text }) },
          { ...voided().defaultActionJson[0]!.configJson, triggerKey: 'workflow.edited_void_notice', bodyTemplate: 'การจ่ายเงินที่บันทึกไว้ถูกยกเลิก ใบเบิกกลับไปรอจ่าย' });
        const sent = (notify.execute.mock.calls[0] as any).arguments[0];
        assert.deepEqual(sent.recipientUserIds, ['u_requester']);
        assert.equal(sent.body, text);
      });
    });

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
    const runReminder = (payload: Record<string, unknown> = {}) => make().execute(
      { ...actionRun(reminder().defaultActionJson[0]!.configJson), actionKey: reminder().defaultActionJson[0]!.actionKey },
      {
        companyId: 'co_1', ruleName: reminder().name, sourceModule: 'reimbursements',
        sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-202610-00007', ageHours: 80, slaRisk: true, amount: '250', currency: 'THB', ...payload },
        siblingActions: reminder().defaultActionJson,
      } as any,
    );
    const reminded = () => (notify.execute.mock.calls.at(-1) as any).arguments[0].recipientUserIds;

    // Owner rule 2026-10-01: the reminder goes to whose turn it is, like the ready-to-pay notice.
    it('reminds only the manager who approved, where the owner, an admin and a second manager can all pay', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin', 'u_manager', 'u_manager_2']);
      await runReminder({ requesterUserId: 'u_staff', approvedByUserId: 'u_manager' });

      assert.deepEqual(reminded(), ['u_manager']);
    });

    it('reminds the finance reviewer who passed the claim before its approver, when they can pay', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_finance', 'u_manager']);
      await runReminder({ requesterUserId: 'u_staff', financeReviewerUserId: 'u_finance', approvedByUserId: 'u_manager' });
      assert.deepEqual(reminded(), ['u_finance']);

      // A finance reviewer without the pay right: the approver is next in line.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_manager']);
      await runReminder({ requesterUserId: 'u_staff', financeReviewerUserId: 'u_finance', approvedByUserId: 'u_manager' });
      assert.deepEqual(reminded(), ['u_manager']);
    });

    it('reminds everyone who can pay when the approver cannot, has left, or the claim needed no approval', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin']);
      await runReminder({ requesterUserId: 'u_staff', approvedByUserId: 'u_manager_without_pay_right' });
      assert.deepEqual(reminded(), ['u_owner', 'u_admin']);

      await runReminder({ requesterUserId: 'u_staff' });
      assert.deepEqual(reminded(), ['u_owner', 'u_admin']);
    });

    // Review: a claim that needed no approval was reminded to everyone able, the owner included.
    it('reminds the people who would have approved a claim nobody had to approve, before everyone else', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin', 'u_manager', 'u_requester']);
      await runReminder({ requesterUserId: 'u_requester', approverRecipientUserIds: ['u_manager', 'u_requester'] });
      assert.deepEqual(reminded(), ['u_manager']);

      // None of them can pay: everyone who can.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_admin']);
      await runReminder({ requesterUserId: 'u_requester', approverRecipientUserIds: ['u_manager'] });
      assert.deepEqual(reminded(), ['u_owner', 'u_admin']);
    });

    it('still reminds a solo owner who filed and approved their own claim', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner']);
      await runReminder({ requesterUserId: 'u_owner', approvedByUserId: 'u_owner' });

      assert.deepEqual(reminded(), ['u_owner']);
    });

    it('never reminds a requester alone to pay their own claim when others can', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_owner', 'u_manager']);
      await runReminder({ requesterUserId: 'u_manager', approvedByUserId: 'u_manager' });

      assert.deepEqual(reminded(), ['u_owner', 'u_manager']);
    });

    it('reminds everyone who can record the payment, in plain Thai, with the link to the claim', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_approver', 'u_finance']);
      await runReminder();

      assert.deepEqual((repo.findUserIdsByPermissions.mock.calls[0] as any).arguments, ['co_1', ['reimbursement.payment.record']]);
      const sent = (notify.execute.mock.calls[0] as any).arguments[0];
      assert.deepEqual(sent.recipientUserIds, ['u_approver', 'u_finance']);
      assert.equal(sent.triggerKey, 'workflow.reimbursement_payment_sla_breach');
      // Not 'critical': that severity is pushed through a person's quiet hours.
      assert.equal(sent.severity, 'action');
      assert.equal(sent.title, 'ใบเบิกรอจ่ายเงินเกินกำหนด: RB-202610-00007');
      assert.equal(sent.body, 'ยอด 250.00 บาท · รอคุณบันทึกการจ่ายเงิน');
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

  // Owner decision 2026-10-02: a claim that has waited for approval past the company's deadline is the business of
  // its approvers. Before, the reminder added the shop owner to every one of them, whoever the approvers were.
  describe('approval reminder notice (owner decision 2026-10-02)', () => {
    const sla = () => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'approval_sla_breach')!;
    const notifyAction = () => sla().defaultActionJson.find((a) => a.actionType === 'SEND_NOTIFICATION')!;
    // What the scan hands the rule for a claim past its deadline: its approvers, and the owner named apart.
    const runReminder = (payload: Record<string, unknown>, cfg: Record<string, unknown> = notifyAction().configJson) => make().execute(
      { ...actionRun(cfg), actionKey: notifyAction().actionKey },
      {
        companyId: 'co_1', ruleName: sla().name, triggerType: 'SLA_SCAN', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: {
          requestId: 'rb_1', requestNo: 'RB-202610-00007', ageHours: 80, slaRisk: true, amount: '250', currency: 'THB',
          ownerRecipientUserIds: ['u_owner'], notificationPeriodKey: 'round:2026-10-01T03:00:00.000Z', ...payload,
        },
        siblingActions: sla().defaultActionJson,
      } as any,
    );
    const reminded = () => (notify.execute.mock.calls.at(-1) as any).arguments[0];

    it('reminds the approvers of the claim, and the shop owner only when the scan names the owner as the one to approve it', async () => {
      await runReminder({ approverRecipientUserIds: ['u_manager', 'u_manager_2'], approverTaskUserId: 'u_manager', approverTaskRole: 'MANAGER' });

      assert.deepEqual(reminded().recipientUserIds, ['u_manager', 'u_manager_2']);
      assert.deepEqual(notifyAction().configJson['recipientPayloadKeys'], ['approverRecipientUserIds']);
      // The notice itself is as it was: the same trigger, title, link and once-per-round period.
      assert.deepEqual([reminded().triggerKey, reminded().severity, reminded().title, reminded().deepLinkHref, reminded().periodKey],
        ['workflow.approval_sla_breach', 'critical', 'ใบเบิกรออนุมัติเกินกำหนด: RB-202610-00007', '/companies/co_1/reimbursements/rb_1', 'round:2026-10-01T03:00:00.000Z']);

      // None of the claim's approvers can act any more: the scan names the owner as the one who approves it now.
      await runReminder({ approverRecipientUserIds: ['u_owner'], approverTaskUserId: 'u_owner', approverTaskRole: 'OWNER' });
      assert.deepEqual(reminded().recipientUserIds, ['u_owner']);
      // A shop owner who is one of the claim's approvers is reminded as that.
      await runReminder({ approverRecipientUserIds: ['u_owner', 'u_manager'], approverTaskUserId: 'u_manager', approverTaskRole: 'MANAGER' });
      assert.deepEqual(reminded().recipientUserIds, ['u_owner', 'u_manager']);

      // A rule pinned before this, or one an admin edited to say so, names the owner itself: the owner is still added.
      const pinnedBefore = { ...notifyAction().configJson, recipientPayloadKeys: ['approverRecipientUserIds', 'ownerRecipientUserIds'] };
      await runReminder({ approverRecipientUserIds: ['u_manager'], approverTaskUserId: 'u_manager', approverTaskRole: 'MANAGER' }, pinnedBefore);
      assert.deepEqual(reminded().recipientUserIds, ['u_manager', 'u_owner']);
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
      assert.equal(sent.body, 'ผลการพิจารณา: ไม่ต้องอนุมัติตามนโยบาย · ยอด 250.00 บาท');
    });

    it('says every decision a shipped claim notice can carry in Thai', async () => {
      for (const [templateKey, decision, words] of [
        ['reimbursement_decision_requester', 'APPROVED', 'อนุมัติ'],
        ['reimbursement_decision_requester', 'REJECTED', 'ส่งกลับให้แก้แล้ว'],
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
      assert.equal(sent.body, 'ผลการพิจารณา: constructor · ยอด 250.00 บาท');
    });
  });

  // Review: bodies printed the stored decimal next to a currency code ("ยอด 1234.5000 THB"). Money is
  // put into Thai text where the decision is, before any template renders, so a rule pinned long
  // ago gets it too.
  describe('claim notices write money as Thai text', () => {
    const body = async (templateKey: string, payload: Record<string, unknown>) => {
      const template = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === templateKey)!;
      const action = template.defaultActionJson.find((a) => a.actionType === 'SEND_NOTIFICATION')!;
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_finance']);
      await make().execute({ ...actionRun(action.configJson), actionKey: action.actionKey }, {
        companyId: 'co_1', ruleName: template.name, sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-1', currency: 'THB', requesterUserId: 'u_requester', actorUserId: 'u_actor', approverRecipientUserIds: ['u_manager'], ...payload },
        siblingActions: template.defaultActionJson,
      } as any);
      return (notify.execute.mock.calls.at(-1) as any).arguments[0].body;
    };

    it('writes "1,234.50 บาท" in every claim notice that carries an amount', async () => {
      assert.equal(await body('reimbursement_pending_approval', { amount: '1234.5000' }), 'ยอด 1,234.50 บาท · รออนุมัติจากคุณ');
      assert.equal(await body('reimbursement_decision_requester', { amount: '1234.5000', decision: 'APPROVED' }), 'ผลการพิจารณา: อนุมัติ · ยอด 1,234.50 บาท');
      assert.equal(await body('reimbursement_correction_requester', { amount: '80', note: 'แก้ยอด' }), 'แก้ยอด · ยอด 80.00 บาท');
      assert.equal(await body('reimbursement_finance_review', { amount: '80', decision: 'BLOCKED' }), 'ผลตรวจสอบ: ระงับ · ยอด 80.00 บาท');
      assert.equal(await body('reimbursement_finance_review_pending', { amount: 1000 }), 'ยอด 1,000.00 บาท · รอตรวจสอบการเงิน');
      assert.equal(await body('reimbursement_ready_for_payment', { amount: '1234567.891' }), 'ยอด 1,234,567.89 บาท · รอคุณบันทึกการจ่ายเงิน');
      assert.equal(await body('reimbursement_payment_sla_breach', { amount: '250.0000' }), 'ยอด 250.00 บาท · รอคุณบันทึกการจ่ายเงิน');
    });

    it('reaches a rule snapshot pinned before this, whose template still says {{amount}} {{currency}}', async () => {
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_finance']);
      await make().execute(actionRun({
        triggerKey: 'workflow.reimbursement_ready_for_payment', recipientPermissions: ['reimbursement.payment.record'],
        titleTemplate: 'พร้อมจ่ายเบิกจ่าย: {{requestNo}}', bodyTemplate: 'ยอด {{amount}} {{currency}} · รอบันทึกการจ่ายเงิน',
      }), {
        companyId: 'co_1', ruleName: 'r', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-1', amount: '1234.5000', currency: 'THB' }, siblingActions: [],
      } as any);

      assert.equal((notify.execute.mock.calls.at(-1) as any).arguments[0].body, 'ยอด 1,234.50 บาท · รอบันทึกการจ่ายเงิน');
    });

    it('keeps another currency as its raw pair rather than calling it baht, and leaves non-amounts alone', async () => {
      assert.equal(await body('reimbursement_pending_approval', { amount: '99.5000', currency: 'USD' }), 'ยอด 99.5000 USD · รออนุมัติจากคุณ');
      assert.equal(await body('reimbursement_pending_approval', { amount: 'ไม่ระบุ' }), 'ยอด ไม่ระบุ บาท · รออนุมัติจากคุณ');
    });
  });

  // Payout spec §17.3 (AC37, AC21): the "paid" notice says how the payment was really made. The payment
  // event carries that as a finished sentence (the reimbursements module builds it from the payment's own
  // facts); the template prints it and adds nothing, so no rule can print a method code or more of an
  // account than its last 4 digits.
  describe('the paid notice is the sentence the payment event carries', () => {
    const paid = () => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_payment_recorded')!;
    /** A payment event as RecordReimbursementPaymentUseCase writes it, recorded by `u_payer` for `u_requester`. */
    const event = (overrides: Record<string, unknown> = {}) => ({
      requestId: 'rb_1', requestNo: 'RB-202610-00007', requesterUserId: 'u_requester', paymentNo: 'RBPAY-202610-000001',
      paidAmount: '1614.5000', currency: 'THB', sourceType: 'REIMBURSEMENT_PAYMENT', paymentStatus: 'PAID',
      paidNotice: 'โอนเข้าบัญชีลงท้าย 1234 จำนวน 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป',
      eventType: 'reimbursement.payment_recorded', actorUserId: 'u_payer', ...overrides,
    });
    const send = async (configJson: Record<string, unknown>, payload: Record<string, unknown>) => {
      await make().execute(actionRun(configJson), {
        companyId: 'co_1', ruleName: paid().name, triggerType: 'EVENT', sourceModule: 'reimbursements',
        sourceType: 'reimbursement_payment', sourceId: 'pay_1', payload, siblingActions: [],
      } as any);
      return (notify.execute.mock.calls.at(-1) as any)?.arguments[0];
    };
    const catalogConfig = () => paid().defaultActionJson[0]!.configJson;

    it('tells the requester, and only the requester, in the event\'s own words, with a link to the claim page', async () => {
      // Nobody is picked by a role or a permission: holding the pay right tells nobody that someone else was paid.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_payer', 'u_owner']);
      for (const paidNotice of ['โอนเข้าบัญชีลงท้าย 1234 จำนวน 1,614.50 บาท มีสลิปแนบ แตะเพื่อดูสลิป', 'จ่ายเป็นเงินสด 1,614.50 บาท']) {
        const sent = await send(catalogConfig(), event({ paidNotice }));
        assert.equal(sent.title, 'จ่ายเงินเบิกแล้ว: RB-202610-00007');
        assert.equal(sent.body, paidNotice);
        assert.deepEqual(sent.recipientUserIds, ['u_requester']);
        assert.equal(sent.deepLinkHref, '/companies/co_1/reimbursements/rb_1');
        assert.equal(sent.triggerKey, 'workflow.reimbursement_payment_recorded');
      }
    });

    it('does not tell a requester who recorded the payment themselves', async () => {
      const before = notify.execute.mock.callCount();
      await send(catalogConfig(), event({ actorUserId: 'u_requester' }));
      assert.equal(notify.execute.mock.callCount(), before);
      const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
      assert.deepEqual([finalUpdate.status, finalUpdate.resultJson.reason], ['SUCCEEDED', 'all_recipients_excluded']);
    });

    // Old rule snapshots and rules an admin edited are not re-pinned. They read the same event.
    it('keeps a rule pinned or edited before the sentence working: the event still carries what its body prints', async () => {
      const pinnedBefore = { ...catalogConfig(), bodyTemplate: 'จ่ายแล้ว {{paidAmount}} {{currency}} · เลขที่จ่าย {{paymentNo}}' };
      assert.equal((await send(pinnedBefore, event())).body, 'จ่ายแล้ว 1,614.50 บาท · เลขที่จ่าย RBPAY-202610-000001');
      const adminEdited = { ...catalogConfig(), titleTemplate: 'โอนเงินเบิกให้แล้ว {{requestNo}}', bodyTemplate: 'ตรวจยอด {{paidAmount}} {{currency}} ได้ที่หน้าใบเบิก' };
      const sent = await send(adminEdited, event());
      assert.deepEqual([sent.title, sent.body], ['โอนเงินเบิกให้แล้ว RB-202610-00007', 'ตรวจยอด 1,614.50 บาท ได้ที่หน้าใบเบิก']);
      // Either way the notice goes to the requester and opens the claim.
      assert.deepEqual([sent.recipientUserIds, sent.deepLinkHref], [['u_requester'], '/companies/co_1/reimbursements/rb_1']);
    });

    // A payment recorded by the build before this one, read by the rule after its re-pin: the event has
    // no sentence. The notice is then its title, with nothing made up underneath it.
    // Final review W3: such an event has nothing for the body to print, and an empty body is no notice.
    it('prints the title as the body for a payment event written before the sentence existed', async () => {
      const sent = await send(catalogConfig(), event({ paidNotice: undefined }));
      assert.deepEqual([sent.title, sent.body], ['จ่ายเงินเบิกแล้ว: RB-202610-00007', 'จ่ายเงินเบิกแล้ว: RB-202610-00007']);
    });

    it('prints nothing of the event but the sentence: no code word, raw decimal or currency code', async () => {
      for (const paidNotice of ['โอนเข้าพร้อมเพย์เบอร์ลงท้าย 5678 จำนวน 80.00 บาท มีสลิปแนบ แตะเพื่อดูสลิป', 'จ่ายเป็นเช็ค 80.00 บาท', 'จ่ายด้วยวิธีอื่น 80.00 บาท']) {
        const sent = await send(catalogConfig(), event({ paidAmount: '80.0000', paidNotice }));
        assert.doesNotMatch(`${sent.title} ${sent.body}`.replace('RB-202610-00007', ''), /[A-Za-z_]|\d\.\d{3,}/, paidNotice);
      }
    });
  });

  // Payout spec §14, §17.3: an approved claim sent back to have its payout account corrected. Each notice
  // goes only to the person it concerns (owner rule 2026-10-01): the requester when the claim is sent
  // back, the approvers of the new step when the account is given.
  describe('the two notices of a payout account correction', () => {
    const template = (key: string) => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === key)!;
    const send = async (key: string, payload: Record<string, unknown>) => {
      const action = template(key).defaultActionJson.find((a) => a.actionType === 'SEND_NOTIFICATION')!;
      // Nobody is picked by a role or a permission: whoever else may approve or pay is not told.
      repo.findUserIdsByPermissions = mock.fn(async () => ['u_payer', 'u_owner']);
      await make().execute({ ...actionRun(action.configJson), actionKey: action.actionKey }, {
        companyId: 'co_1', ruleName: template(key).name, triggerType: 'EVENT', sourceModule: 'reimbursements',
        sourceType: 'reimbursement_request', sourceId: 'rb_1', payload, siblingActions: template(key).defaultActionJson,
      } as any);
      return (notify.execute.mock.calls.at(-1) as any)?.arguments[0];
    };
    /**
     * As `sendBackForPayoutCorrection` writes it: sent back by `u_payer`, with the title and the body as finished
     * sentences, chosen by what the claim held when it was sent back.
     */
    const sentBack = (overrides: Record<string, unknown> = {}, held: ReimbursementPayoutHeld = 'ACCOUNT', reasonCode: ReimbursementPayoutCorrectionReason = 'ACCOUNT_NUMBER_WRONG') => {
      const notice = reimbursementPayoutSentBackNotice(held, reasonCode);
      return {
        requestId: 'rb_1', requestNo: 'RB-202610-00007', requesterUserId: 'u_requester', status: 'PENDING_APPROVAL',
        payoutCorrectionTitle: notice.title, payoutCorrectionNotice: notice.body,
        eventType: 'reimbursement.payout_correction_requested', actorUserId: 'u_payer', ...overrides,
      };
    };
    /**
     * As `SubmitPayoutCorrectionUseCase` writes it: the requester answered, and the answer waits for `u_manager`. The
     * title and the end of the body are finished sentences, chosen by what was answered.
     */
    const accountGiven = (overrides: Record<string, unknown> = {}, answer: ReimbursementPayoutRoundAnswer | null = 'NEW_ACCOUNT') => {
      const notice = reimbursementPayoutAnswerNotice(answer);
      return {
        requestId: 'rb_1', requestNo: 'RB-202610-00007', requesterUserId: 'u_requester', amount: '1614.5000', currency: 'THB',
        status: 'PENDING_APPROVAL', stepId: 'step_2', approverRecipientUserIds: ['u_manager'], payoutAnswerTitle: notice.title, payoutAnswerNotice: notice.body,
        eventType: 'reimbursement.payout_correction_submitted', actorUserId: 'u_requester', ...overrides,
      };
    };

    it('tells the requester alone that the claim needs its account corrected, with the reason and a link to the claim', async () => {
      const sent = await send('reimbursement_payout_correction_requested', sentBack());
      assert.deepEqual([sent.title, sent.body], ['ใบเบิกต้องแก้บัญชีรับเงิน: RB-202610-00007', 'เหตุผล: เลขบัญชีไม่ถูกต้อง · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน']);
      assert.deepEqual([sent.recipientUserIds, sent.deepLinkHref, sent.triggerKey, sent.severity],
        [['u_requester'], '/companies/co_1/reimbursements/rb_1', 'workflow.reimbursement_payout_correction_requested', 'action']);
      assert.doesNotMatch(`${sent.title} ${sent.body}`.replace('RB-202610-00007', ''), /[A-Za-z_]/);
    });

    it('does not tell a requester who asked for their own account to be changed', async () => {
      const before = notify.execute.mock.callCount();
      await send('reimbursement_payout_correction_requested', sentBack({ actorUserId: 'u_requester' }));
      assert.equal(notify.execute.mock.callCount(), before);
      const finalUpdate = (repo.updateActionRun.mock.calls.at(-1) as any).arguments[1];
      assert.deepEqual([finalUpdate.status, finalUpdate.resultJson.reason], ['SUCCEEDED', 'all_recipients_excluded']);
    });

    it('tells the approvers of the new step, and nobody else, that a new account waits for their approval', async () => {
      const sent = await send('reimbursement_payout_correction_submitted', accountGiven({ approverRecipientUserIds: ['u_manager', 'u_manager_2'] }));
      assert.deepEqual([sent.title, sent.body], ['รออนุมัติบัญชีรับเงินใหม่: RB-202610-00007', 'ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติบัญชีรับเงินใหม่']);
      assert.deepEqual([sent.recipientUserIds, sent.deepLinkHref, sent.triggerKey, sent.severity],
        [['u_manager', 'u_manager_2'], '/companies/co_1/reimbursements/rb_1', 'workflow.reimbursement_payout_correction_submitted', 'action']);
      assert.doesNotMatch(`${sent.title} ${sent.body}`.replace('RB-202610-00007', ''), /[A-Za-z_]|\d\.\d{3,}/);
      // A requester who is their own approver gave the account themselves, and is not told so.
      const before = notify.execute.mock.callCount();
      await send('reimbursement_payout_correction_submitted', accountGiven({ approverRecipientUserIds: ['u_requester'] }));
      assert.equal(notify.execute.mock.callCount(), before);
    });

    // Payout spec §17.3. The title used to be the template's own, one for every claim: a claim with no account, and a
    // claim that asked for cash, were told their "บัญชีรับเงิน" needed correcting.
    it('titles and words the send-back notice by what the claim held: an account is corrected, a missing one added, cash chosen again', async () => {
      const cases = [
        ['ACCOUNT', 'BANK_WRONG', 'ใบเบิกต้องแก้บัญชีรับเงิน: RB-202610-00007', 'เหตุผล: ธนาคารไม่ถูกต้อง · เปิดใบเบิกเพื่อแก้บัญชีรับเงิน'],
        ['NOTHING', 'NO_ACCOUNT_ON_CLAIM', 'ใบเบิกต้องเพิ่มบัญชีรับเงิน: RB-202610-00007', 'เหตุผล: ใบนี้ยังไม่มีบัญชีรับเงิน · เปิดใบเบิกเพื่อเพิ่มบัญชีรับเงิน'],
        ['CASH', 'CASH_NOT_PAYABLE', 'ใบเบิกต้องเลือกวิธีรับเงินคืนอีกครั้ง: RB-202610-00007', 'เหตุผล: จ่ายเป็นเงินสดไม่ได้ · เปิดใบเบิกเพื่อเลือกวิธีรับเงินคืน'],
      ] as const;
      for (const [held, reasonCode, title, body] of cases) {
        const sent = await send('reimbursement_payout_correction_requested', sentBack({}, held, reasonCode));
        assert.deepEqual([sent.title, sent.body, sent.recipientUserIds], [title, body, ['u_requester']], held);
        assert.doesNotMatch(`${sent.title} ${sent.body}`.replace('RB-202610-00007', ''), /[A-Za-z_]/, held);
      }
    });

    // The title and the body used to say "บัญชีรับเงินใหม่" of every answer: of the same account, of a first account, of cash.
    it('titles and words the approvers\' notice by what the requester answered, and says "ใหม่" only of another account', async () => {
      const expected = {
        NEW_ACCOUNT: ['รออนุมัติบัญชีรับเงินใหม่: RB-202610-00007', 'ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติบัญชีรับเงินใหม่'],
        SAME_ACCOUNT: ['รออนุมัติบัญชีรับเงินเดิม: RB-202610-00007', 'ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติบัญชีรับเงินเดิม'],
        CASH_INSTEAD: ['รออนุมัติการรับเป็นเงินสด: RB-202610-00007', 'ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติการรับเป็นเงินสด'],
        ACCOUNT_INSTEAD: ['รออนุมัติบัญชีรับเงิน: RB-202610-00007', 'ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติบัญชีรับเงิน'],
        SAME_CASH: ['รออนุมัติการรับเป็นเงินสด: RB-202610-00007', 'ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติการรับเป็นเงินสด'],
        FIRST_ACCOUNT: ['รออนุมัติบัญชีรับเงิน: RB-202610-00007', 'ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติบัญชีรับเงิน'],
        FIRST_CASH: ['รออนุมัติการรับเป็นเงินสด: RB-202610-00007', 'ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติการรับเป็นเงินสด'],
      } satisfies Record<ReimbursementPayoutRoundAnswer, [string, string]>;
      for (const [answer, words] of Object.entries(expected) as Array<[ReimbursementPayoutRoundAnswer, [string, string]]>) {
        const sent = await send('reimbursement_payout_correction_submitted', accountGiven({}, answer));
        assert.deepEqual([sent.title, sent.body, sent.recipientUserIds], [...words, ['u_manager']], answer);
        assert.doesNotMatch(`${sent.title} ${sent.body}`.replace('RB-202610-00007', ''), /[A-Za-z_]|\d\.\d{3,}/, answer);
      }
      // An answer with no record of how its round began: words that are true of every answer.
      const unknown = await send('reimbursement_payout_correction_submitted', accountGiven({}, null));
      assert.deepEqual([unknown.title, unknown.body], ['รออนุมัติวิธีรับเงินคืน: RB-202610-00007', 'ยอด 1,614.50 บาท · รอคุณตรวจและอนุมัติวิธีรับเงินคืน']);
    });

    it('lets neither template assemble a sentence of its own: both print what the event carries', () => {
      const words = (key: string) => {
        const { titleTemplate, bodyTemplate } = template(key).defaultActionJson[0]!.configJson as { titleTemplate: string; bodyTemplate: string };
        return [titleTemplate, bodyTemplate];
      };
      assert.deepEqual(words('reimbursement_payout_correction_requested'), ['{{payoutCorrectionTitle}}: {{requestNo}}', '{{payoutCorrectionNotice}}']);
      assert.deepEqual(words('reimbursement_payout_correction_submitted'), ['{{payoutAnswerTitle}}: {{requestNo}}', 'ยอด {{amount}} {{currency}} · {{payoutAnswerNotice}}']);
    });

    it('creates no task and reads no account: each is one notice, about where the claim stands', () => {
      for (const key of ['reimbursement_payout_correction_requested', 'reimbursement_payout_correction_submitted']) {
        assert.deepEqual(template(key).defaultActionJson.map((action) => action.actionType), ['SEND_NOTIFICATION'], key);
        assert.doesNotMatch(JSON.stringify(template(key).defaultActionJson), /accountLast4|accountNumber|bankName|accountName|\{\{note\}\}|reasonCode/, key);
      }
      // A claim nobody has to approve sends no "waits for your approval" notice: its event is the ready-to-pay one.
      assert.deepEqual(template('reimbursement_payout_correction_submitted').defaultConditionJson, { field: 'status', op: 'EQ', value: 'PENDING_APPROVAL' });
    });
  });

  // Review: a task title carried an English tag ("[Approval review] ...") and the approval reminder
  // said "SLA". Both are read by the approver in their task list and on LINE: plain Thai.
  describe('task and reminder titles are plain Thai', () => {
    it('creates the approval task under the claim title alone, with a Thai description', async () => {
      const pendingApproval = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_pending_approval')!;
      const taskAction = pendingApproval.defaultActionJson.find((a) => a.actionType === 'CREATE_APPROVAL_REVIEW_REQUEST')!;
      repo.findTaskByActionRunId = mock.fn(async () => null);
      repo.createTask = mock.fn(async (data: any) => ({ id: 'task_1', ...data }));

      await make().execute({ ...actionRun(taskAction.configJson), actionKey: taskAction.actionKey, actionType: 'CREATE_APPROVAL_REVIEW_REQUEST' }, {
        companyId: 'co_1', ruleName: pendingApproval.name, sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-202610-00007', approverTaskUserId: 'u_manager' }, siblingActions: pendingApproval.defaultActionJson,
      } as any);

      const created = (repo.createTask.mock.calls[0] as any).arguments[0];
      assert.equal(created.title, 'อนุมัติเบิกจ่าย: RB-202610-00007');
      assert.doesNotMatch(`${created.title} ${created.description}`, /[A-Za-z]{3,}(?<!RB)/);
    });

    it('titles the approval reminder without the word SLA', () => {
      const sla = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'approval_sla_breach')!;
      const titles = sla.defaultActionJson.map((a) => a.configJson['titleTemplate']).filter(Boolean);
      assert.deepEqual(titles, ['ใบเบิกรออนุมัติเกินกำหนด: {{requestNo}}']);
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
    assert.equal(sent.body, 'ยอด 250.00 บาท · รอคุณบันทึกการจ่ายเงิน');
  });

  // Final review W3: the "paid" notice reads a sentence the payment event itself carries. An event
  // written by the build before that sentence existed (between the release task and the cutover, or
  // after a rollback) has none, and the notice went out with a title and an empty body.
  it('falls back to the title when the rendered body is empty, and keeps a body that says something', async () => {
    const paid = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_payment_recorded')!;
    const cfg = paid.defaultActionJson[0]!.configJson;
    const send = async (payload: Record<string, unknown>) => {
      notify.execute.mock.resetCalls();
      await make().execute(actionRun(cfg), {
        companyId: 'co_1', ruleName: 'Reimbursement payment recorded', sourceModule: 'reimbursements', sourceType: 'reimbursement_payment', sourceId: 'pay_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-202608-00021', requesterUserId: 'u_requester', actorUserId: 'u_payer', ...payload }, siblingActions: [],
      } as any);
      const sent = (notify.execute.mock.calls[0] as any).arguments[0];
      return [sent.title, sent.body];
    };
    assert.equal(cfg['bodyTemplate'], '{{paidNotice}}');
    // The older build's event: amount and number, no finished sentence.
    assert.deepEqual(await send({ paidAmount: '250', currency: 'THB', paymentNo: 'RBPAY-1' }), ['จ่ายเงินเบิกแล้ว: RB-202608-00021', 'จ่ายเงินเบิกแล้ว: RB-202608-00021']);
    assert.deepEqual(await send({ paidNotice: '   ' }), ['จ่ายเงินเบิกแล้ว: RB-202608-00021', 'จ่ายเงินเบิกแล้ว: RB-202608-00021']);
    assert.deepEqual(await send({ paidNotice: 'โอนเข้าบัญชีลงท้าย 6789 จำนวน 250.00 บาท' }), ['จ่ายเงินเบิกแล้ว: RB-202608-00021', 'โอนเข้าบัญชีลงท้าย 6789 จำนวน 250.00 บาท']);
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
    assert.equal(sent.body, 'ยอด 250.00 บาท · รออนุมัติจากคุณ');
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
        company: { findUnique: async () => ({ status: 'ACTIVE', archivedAt: null, planTerm: null }) },
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

  it('D3: tells requester once, falls back only when they cannot cancel, and excludes the confirmer', async (t) => {
    for (const canCancel of [true, false]) for (const actor of ['u_finance', 'u_requester', 'u_else']) for (const overdue of [false, true]) await t.test(`${canCancel}/${actor}/${overdue}`, async () => {
      const h = harness({ sourceBranchId: 'br_claim', memberships: {
        u_requester: member({ roles: canCancel ? [role('ACTIVE', 'reimbursement.cancel_own')] : [] }),
        u_finance: member({ roles: [role('ACTIVE', 'reimbursement.finance_review')] }),
        u_owner: member({ roles: [role('ACTIVE', 'reimbursement.payment.record')] }),
        u_second_finance: member({ roles: [role('ACTIVE', 'reimbursement.finance_review')] }),
        u_outside: member({ roles: [role('ACTIVE', 'reimbursement.finance_review')], branchScopeMode: 'SELECTED_BRANCHES', branchScopes: [{ branchId: 'elsewhere' }] }),
      } });
      const modes = overdue ? ['cancel'] : ['requester', 'cancel'];
      for (const mode of modes) await h.useCase.execute(actionRun({ triggerKey: overdue ? 'workflow.reimbursement_duplicate_sla_breach' : 'workflow.reimbursement_duplicate_confirmed',
        duplicateRecipient: mode, recipientPayloadKeys: ['requesterUserId'], recipientPermissions: ['reimbursement.finance_review'], excludeRecipientPayloadKeys: [], skipWhenNoRecipients: true,
        titleTemplate: 'รายการซ้ำ: {{requestNo}}', bodyTemplate: 'รายการซ้ำ', }), {
        ...claimContext(), payload: { requestId: 'rb_1', requestNo: 'RB-1', requesterUserId: 'u_requester', status: 'READY_FOR_PAYMENT', actorUserId: actor, financeReviewerUserId: 'u_finance' },
      });
      const finance = actor === 'u_finance' ? 'u_second_finance' : 'u_finance';
      const expected = overdue ? (canCancel ? ['u_requester'] : [finance]) : (canCancel ? ['u_requester'] : ['u_requester', finance]);
      assert.deepEqual(h.sent.flatMap(row => row.recipientUserIds).sort(), expected.filter(id => id !== actor).sort());
      assert.ok(h.sent.every(row => !/[A-Za-z_]/.test(row.body)));
      assert.ok(h.sent.every(row => row.body.includes('ยกเลิก')));
    });
  });

  const readyToPay = () => WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_ready_for_payment')!;
  const claimContext = (): any => ({
    companyId: 'co_1', ruleName: 'Reimbursement ready for payment', sourceModule: 'reimbursements',
    sourceType: 'reimbursement_request', sourceId: 'rb_1',
    payload: { requestId: 'rb_1', requestNo: 'RB-1', amount: '250', currency: 'THB', actorUserId: 'u_someone_else' },
    siblingActions: [],
  });

  it('D2: old or edited payer rules keep recipients, check unresolved duplicates first and suppress confirmed duplicates', async (t) => {
    for (const key of ['reimbursement_ready_for_payment', 'reimbursement_payment_sla_breach']) {
      for (const block of [undefined, 'NONE', 'UNRESOLVED', 'CONFIRMED']) await t.test(`${key}/${block ?? 'legacy'}`, async () => {
        const h = harness({ sourceBranchId: 'br_claim', memberships: { u_owner: member(), u_approver: member() } });
        const context = claimContext();
        context.payload = { ...context.payload, actorUserId: 'u_approver', approvedByUserId: 'u_approver', requesterUserId: 'u_staff', ...(block && { paymentDuplicateBlock: block }) };
        // A rule pinned before this release, even if an admin kept its old sentences.
        const cfg = { ...WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === key)!.defaultActionJson[0]!.configJson,
          titleTemplate: key === 'reimbursement_ready_for_payment' ? 'พร้อมจ่ายเบิกจ่าย: {{requestNo}}' : 'ใบเบิกรอจ่ายเงินเกินกำหนด: {{requestNo}}',
          bodyTemplate: 'ยอด {{amount}} {{currency}} · รอคุณบันทึกการจ่ายเงิน' };
        await h.useCase.execute(actionRun(cfg), context);
        if (block === 'CONFIRMED') { assert.deepEqual(h.sent, []); assert.equal(h.updates.at(-1).resultJson.reason, 'confirmed_duplicate'); return; }
        assert.deepEqual(h.sent[0].recipientUserIds, ['u_approver']);
        assert.equal(h.sent[0].body, block === 'UNRESOLVED'
          ? 'ยอด 250.00 บาท · รอคุณตรวจรายการที่อาจซ้ำก่อนบันทึกการจ่ายเงิน'
          : 'ยอด 250.00 บาท · รอคุณบันทึกการจ่ายเงิน');
        if (block === 'UNRESOLVED') assert.match(h.sent[0].title, /รอตรวจรายการที่อาจซ้ำ/);
      });
    }
  });

  it('D2: changing a payer rule trigger key cannot bypass the source payment block', async (t) => {
    for (const kind of ['ready', 'overdue']) for (const block of ['CONFIRMED', 'UNRESOLVED']) await t.test(`${kind}/${block}`, async () => {
      const h = harness({ sourceBranchId: 'br_claim', memberships: { u_owner: member(), u_approver: member() } });
      const context = claimContext();
      context.triggerType = kind === 'ready' ? 'EVENT' : 'SLA_SCAN';
      context.payload = { ...context.payload, actorUserId: 'u_approver', requesterUserId: 'u_staff', paymentDuplicateBlock: block,
        ...(kind === 'ready' && { eventType: 'reimbursement.ready_for_payment' }) };
      const cfg = { ...readyToPay().defaultActionJson[0]!.configJson, triggerKey: 'workflow.edited_payer_notice' };
      await h.useCase.execute(actionRun(cfg), context);
      if (block === 'CONFIRMED') assert.deepEqual(h.sent, []);
      else { assert.deepEqual(h.sent[0].recipientUserIds, ['u_approver']); assert.match(h.sent[0].body, /รอคุณตรวจรายการที่อาจซ้ำก่อน/); }
    });
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

  // Whose turn it is only counts when that person can act: an approver who holds the pay right
  // for another branch cannot record this payment, so everyone who can is told instead.
  it('tells everyone who can pay when the approver cannot record the payment for the claim branch', async () => {
    const h = harness({
      sourceBranchId: 'br_claim',
      memberships: {
        u_owner: member(),
        u_admin: member(),
        u_approver: member({ branchScopeMode: 'SELECTED_BRANCHES', branchScopes: [{ branchId: 'br_other' }] }),
      },
    });
    const context = claimContext();
    context.payload = { ...context.payload, actorUserId: 'u_approver', requesterUserId: 'u_staff' };

    await h.useCase.execute(actionRun(readyToPay().defaultActionJson[0]!.configJson), context);

    assert.deepEqual(h.sent[0]?.recipientUserIds, ['u_owner', 'u_admin']);
  });

  it('tells only the approver when they can record the payment for the claim branch', async () => {
    const h = harness({
      sourceBranchId: 'br_claim',
      memberships: {
        u_owner: member(),
        u_approver: member({ branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'br_claim' }),
      },
    });
    const context = claimContext();
    context.payload = { ...context.payload, actorUserId: 'u_approver', requesterUserId: 'u_staff' };

    await h.useCase.execute(actionRun(readyToPay().defaultActionJson[0]!.configJson), context);

    assert.deepEqual(h.sent[0]?.recipientUserIds, ['u_approver']);
  });

  // One order for whose turn it is to pay (owner rule 2026-10-01): the finance reviewer who passed the
  // claim, then its approver. The claim page and the payment reminder ask in that order. After a
  // correction round the approver is the actor of the ready-to-pay event, and the notice asked them first.
  it('asks the finance reviewer who passed the claim before its approver, in the order the claim page and the reminder name them', async () => {
    const cfg = readyToPay().defaultActionJson[0]!.configJson;
    const reminder = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_payment_sla_breach')!.defaultActionJson[0]!.configJson;
    assert.deepEqual(cfg['preferRecipientPayloadKeys'], ['financeReviewerUserId', 'actorUserId', 'approverRecipientUserIds']);
    assert.equal((reminder['preferRecipientPayloadKeys'] as string[])[0], 'financeReviewerUserId');
    // The event of an approval that ends a round on a claim finance passed: the approver acted, the reviewer is named.
    const toldAfterARound = async (memberships: Record<string, unknown>) => {
      const h = harness({ sourceBranchId: 'br_claim', memberships });
      const context = claimContext();
      context.payload = { ...context.payload, actorUserId: 'u_approver', requesterUserId: 'u_staff', financeReviewerUserId: 'u_finance', approverRecipientUserIds: ['u_finance'] };
      await h.useCase.execute(actionRun(cfg), context);
      return h.sent[0]?.recipientUserIds;
    };
    const elsewhere = member({ branchScopeMode: 'SELECTED_BRANCHES', branchScopes: [{ branchId: 'br_other' }] });
    assert.deepEqual(await toldAfterARound({ u_owner: member(), u_approver: member(), u_finance: member() }), ['u_finance']);
    // A reviewer who cannot record this payment is not asked: the approver is, when they can.
    assert.deepEqual(await toldAfterARound({ u_owner: member(), u_approver: member(), u_finance: elsewhere }), ['u_approver']);
    assert.deepEqual(await toldAfterARound({ u_owner: member(), u_approver: member() }), ['u_approver']);
    // Neither can: everyone able to.
    assert.deepEqual(await toldAfterARound({ u_owner: member(), u_admin: member(), u_approver: elsewhere, u_finance: elsewhere }), ['u_owner', 'u_admin']);

    // A claim finance never saw is unchanged: its approver, the actor, is asked first.
    const h = harness({ sourceBranchId: 'br_claim', memberships: { u_owner: member(), u_approver: member() } });
    const context = claimContext();
    context.payload = { ...context.payload, actorUserId: 'u_approver', requesterUserId: 'u_staff' };
    await h.useCase.execute(actionRun(cfg), context);
    assert.deepEqual(h.sent[0]?.recipientUserIds, ['u_approver']);
  });

  // ---- The finance desk (owner decisions 2026-10-02) ----
  const REVIEW = 'reimbursement.finance_review';
  /** A member whose one role, of this key, holds the finance-review right. */
  const holding = (key: string, extra: Record<string, unknown> = {}, status = 'ACTIVE') =>
    member({ roles: [{ role: { key, status, permissions: [{ permission: { key: REVIEW } }] } }], ...extra });
  const elsewhere = { branchScopeMode: 'SELECTED_BRANCHES', branchScopes: [{ branchId: 'br_other' }] };
  const arrival = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_finance_review_pending')!;
  const arrivalCfg = arrival.defaultActionJson[0]!.configJson;
  /** A notice of the finance desk about a claim its approver (u_approver) passed, run against these members. */
  const announce = async (memberships: Record<string, unknown>, cfg: Record<string, unknown> = arrivalCfg, payload: Record<string, unknown> = {}) => {
    const h = harness({ sourceBranchId: 'br_claim', memberships });
    await h.useCase.execute({ ...actionRun(cfg), actionKey: arrival.defaultActionJson[0]!.actionKey }, {
      companyId: 'co_1', ruleName: arrival.name, sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1',
      payload: { requestId: 'rb_1', requestNo: 'RB-1', status: 'FINANCE_REVIEW', decision: 'APPROVED', amount: '250', currency: 'THB', requesterUserId: 'u_staff', actorUserId: 'u_approver', ...payload },
      siblingActions: [],
    } as any);
    return { to: h.sent[0]?.recipientUserIds, bellOnly: h.sent[0]?.webOnlyRecipientUserIds, status: h.updates.at(-1)?.status, result: h.updates.at(-1)?.resultJson };
  };

  // Owner decision 2026-10-02: a claim that arrives at the finance desk is announced to the people who review there
  // and can act on its branch, and not to the shop owner, who holds every right, unless nobody else can review it.
  // Before, every holder of the right was told, the owner included, for every claim of every branch.
  it('announces a claim at the finance desk to its reviewers, and to the shop owner only when nobody else can review it', async () => {
    assert.deepEqual(arrivalCfg['lastResortRecipientRoles'], ['OWNER']);

    // The owner, an accountant and a company's own finance role all hold the right: the two who review are told.
    const desk = { u_owner: holding('OWNER'), u_accountant: holding('ACCOUNTANT'), u_finance: holding('CUSTOM_FINANCE') };
    assert.deepEqual((await announce(desk)).to, ['u_accountant', 'u_finance']);
    // One reviewer for this branch is enough to leave the owner out.
    assert.deepEqual((await announce({ ...desk, u_accountant: holding('ACCOUNTANT', elsewhere), u_finance: holding('CUSTOM_FINANCE', { branchScopeMode: 'DEFAULT_BRANCH_ONLY', defaultBranchId: 'br_claim' }) })).to, ['u_finance']);
    // Whoever cannot review THIS claim is not "somebody else": a reviewer of another branch, one whose role is switched off.
    assert.deepEqual((await announce({ u_owner: holding('OWNER'), u_elsewhere: holding('ACCOUNTANT', elsewhere), u_off: holding('ACCOUNTANT', {}, 'DISABLED') })).to, ['u_owner']);
    // A shop where the owner is the finance desk, alone or with a second owner.
    assert.deepEqual((await announce({ u_owner: holding('OWNER') })).to, ['u_owner']);
    assert.deepEqual((await announce({ u_owner: holding('OWNER'), u_owner_2: holding('OWNER') })).to, ['u_owner', 'u_owner_2']);
    // A member who holds the owner role beside another one is the shop owner all the same.
    const ownerAndFinance = member({ roles: [{ role: { key: 'OWNER', status: 'ACTIVE', permissions: [] } }, { role: { key: 'FINANCE', status: 'ACTIVE', permissions: [{ permission: { key: REVIEW } }] } }] });
    assert.deepEqual((await announce({ u_owner: ownerAndFinance, u_accountant: holding('ACCOUNTANT') })).to, ['u_accountant']);
    // A claim nobody had to approve arrives by its own event, from whoever sent it: the same people are told.
    assert.deepEqual((await announce(desk, arrivalCfg, { eventType: 'reimbursement.finance_review_requested', decision: undefined, actorUserId: 'u_staff' })).to, ['u_accountant', 'u_finance']);

    // A rule pinned before this, or one an admin edited, has no such key: every holder who can act, as before.
    const { lastResortRecipientRoles: _added, ...pinnedBefore } = arrivalCfg;
    assert.deepEqual((await announce(desk, pinnedBefore)).to, ['u_owner', 'u_accountant', 'u_finance']);
  });

  // Owner decision 2026-10-02 (the same day, after the one above): an approver who also reviews finance puts the claim
  // on their own desk by approving it. The review is their next task, so the notice is theirs too, in the web bell
  // only: no LINE push about what they have just done, as the ready-to-pay notice does for an approver who pays.
  // Before, they were left out as the actor of the event, and with the owner no longer told in their place a shop
  // whose approver is its one finance reviewer told nobody at all.
  it('gives the one who put the claim on the finance desk the notice in the web bell only, when they review there themselves', async () => {
    // The approver is the only reviewer besides the owner: the task is in the approver's bell, and the owner is not told.
    assert.deepEqual(await announce({ u_owner: holding('OWNER'), u_approver: holding('ACCOUNTANT') }),
      { to: ['u_approver'], bellOnly: ['u_approver'], status: 'SUCCEEDED', result: { skipped: false, reason: undefined } });
    // Another reviewer beside them: both are told, and only the approver is spared the LINE push.
    assert.deepEqual(await announce({ u_owner: holding('OWNER'), u_approver: holding('ACCOUNTANT'), u_finance: holding('CUSTOM_FINANCE') }),
      { to: ['u_approver', 'u_finance'], bellOnly: ['u_approver'], status: 'SUCCEEDED', result: { skipped: false, reason: undefined } });
    // An approver who cannot review this claim (no finance right, or it is for another branch) is told nothing, as before.
    const others = { u_owner: holding('OWNER'), u_finance: holding('CUSTOM_FINANCE') };
    for (const memberships of [others, { ...others, u_approver: holding('ACCOUNTANT', elsewhere) }]) {
      const told = await announce(memberships);
      assert.deepEqual(told.to, ['u_finance']);
      assert.equal(told.to.some((userId: string) => told.bellOnly.includes(userId)), false, 'the reviewer who did not act is pushed as usual');
    }
    // The shop owner approved: where someone else reviews, that one is told and the owner is not. In a shop where the
    // owner is the finance desk, the review is the owner's own next task: in the bell, with no LINE push.
    assert.deepEqual((await announce(others, arrivalCfg, { actorUserId: 'u_owner' })).to, ['u_finance']);
    const ownerAlone = await announce({ u_owner: holding('OWNER') }, arrivalCfg, { actorUserId: 'u_owner' });
    assert.deepEqual([ownerAlone.to, ownerAlone.bellOnly], [['u_owner'], ['u_owner']]);
    // A claim nobody had to approve, sent by someone who reviews finance: theirs to review, in the bell only.
    const sentByReviewer = await announce({ u_owner: holding('OWNER'), u_accountant: holding('ACCOUNTANT'), u_finance: holding('CUSTOM_FINANCE') }, arrivalCfg,
      { eventType: 'reimbursement.finance_review_requested', decision: undefined, requesterUserId: 'u_accountant', actorUserId: 'u_accountant' });
    assert.deepEqual([sentByReviewer.to, sentByReviewer.bellOnly], [['u_accountant', 'u_finance'], ['u_accountant']]);

    // The catalog says so the way the ready-to-pay notice does: nobody is left out as the actor, and the actor is the one for the bell only.
    const readyCfg = readyToPay().defaultActionJson[0]!.configJson;
    for (const cfg of [arrivalCfg, readyCfg]) {
      assert.deepEqual([cfg['excludeRecipientPayloadKeys'], cfg['skipWhenAllRecipientsExcluded'], cfg['webOnlyRecipientPayloadKeys']], [undefined, undefined, ['actorUserId']]);
    }
    // The rule as it shipped (one pinned before these decisions, or kept by an admin's edit) has no last resort and
    // leaves its actor out: every other holder is told, the owner included, as it always was.
    const asShipped = { ...arrivalCfg, lastResortRecipientRoles: undefined, webOnlyRecipientPayloadKeys: undefined, excludeRecipientPayloadKeys: ['actorUserId'], skipWhenAllRecipientsExcluded: true };
    const shipped = await announce({ u_owner: holding('OWNER'), u_approver: holding('ACCOUNTANT') }, asShipped);
    assert.deepEqual([shipped.to, shipped.bellOnly], [['u_owner'], []]);
  });

  // Owner decision 2026-10-02: the finance desk's other notice, a claim a reviewer blocked, follows the rule of the
  // arrival notice. To the reviewers who can act on the claim's branch, and to the shop owner only when nobody else
  // can review it. Before, every reviewer was told, the owner included, whoever else was at the desk.
  it('tells the reviewers that a claim was blocked, and the shop owner only when nobody else can review it', async () => {
    const blockedCfg = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'reimbursement_finance_review')!.defaultActionJson[0]!.configJson;
    /** u_finance blocks the claim, unless a case says who did. */
    const block = async (memberships: Record<string, unknown>, cfg: Record<string, unknown> = blockedCfg, actorUserId = 'u_finance') => {
      const h = harness({ sourceBranchId: 'br_claim', memberships });
      await h.useCase.execute({ ...actionRun(cfg), actionKey: 'notify_finance_reviewer' }, {
        companyId: 'co_1', ruleName: 'Reimbursement finance review', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-1', status: 'FINANCE_REVIEW', decision: 'BLOCKED', amount: '250', currency: 'THB', requesterUserId: 'u_staff', actorUserId },
        siblingActions: [],
      } as any);
      return { to: h.sent[0]?.recipientUserIds, notice: h.sent[0], status: h.updates.at(-1)?.status, result: h.updates.at(-1)?.resultJson };
    };
    // The owner, an accountant and a finance role review; the finance role blocked the claim: the accountant is told.
    const desk = { u_owner: holding('OWNER'), u_accountant: holding('ACCOUNTANT'), u_finance: holding('CUSTOM_FINANCE') };
    const told = await block(desk);
    assert.deepEqual(told.to, ['u_accountant']);
    assert.deepEqual(blockedCfg['lastResortRecipientRoles'], ['OWNER']);
    // The notice itself is as it was: in plain Thai, pushed on LINE too, with the link to the claim.
    assert.deepEqual([told.notice.triggerKey, told.notice.severity, told.notice.title, told.notice.body, told.notice.deepLinkHref, told.notice.webOnlyRecipientUserIds],
      ['workflow.reimbursement_finance_review', 'action', 'ตรวจสอบการเงินเบิกจ่าย: RB-1', 'ผลตรวจสอบ: ระงับ · ยอด 250.00 บาท', '/companies/co_1/reimbursements/rb_1', []]);
    // The shop owner blocked it: the others are told, as before.
    assert.deepEqual((await block(desk, blockedCfg, 'u_owner')).to, ['u_accountant', 'u_finance']);
    // Nobody else can review this claim: the one who blocked it reviews for another branch now, another reviewer's
    // role is switched off. The owner is the one left to tell.
    assert.deepEqual((await block({ u_owner: holding('OWNER'), u_finance: holding('CUSTOM_FINANCE', elsewhere), u_off: holding('ACCOUNTANT', {}, 'DISABLED') })).to, ['u_owner']);
    // The one who blocked it is the only reviewer besides the owner. A block is not their next task and they are
    // not told of what they did; with them left out no reviewer is left, so the owner is told (the last resort is
    // weighed after the actor is left out). Before, nobody was told and the claim just sat.
    assert.deepEqual((await block({ u_owner: holding('OWNER'), u_finance: holding('CUSTOM_FINANCE') })).to, ['u_owner']);
    // An owner-only shop, where the owner blocked the claim: there is nobody else to tell, and nothing is retried.
    const ownerOnly = await block({ u_owner: holding('OWNER') }, blockedCfg, 'u_owner');
    assert.deepEqual([ownerOnly.to, ownerOnly.status, ownerOnly.result], [undefined, 'SUCCEEDED', { skipped: true, reason: 'all_recipients_excluded' }]);

    // A rule pinned before this, or one an admin edited, has no such key: every reviewer but the one who blocked it.
    const { lastResortRecipientRoles: _added, ...pinnedBefore } = blockedCfg;
    assert.deepEqual((await block(desk, pinnedBefore)).to, ['u_owner', 'u_accountant']);
  });

  it('tells the requester once about a finance block in all three desk shapes, never their own block', async () => {
    const template = WORKFLOW_TEMPLATE_CATALOG.find(t => t.key === 'reimbursement_finance_blocked_requester');
    assert.ok(template, 'requester block template must exist');
    const now = new Date();
    assert.equal(evaluateCondition(template.defaultConditionJson, { decision: 'BLOCKED', requesterUserId: 'u_staff' }, now).matched, true);
    for (const payload of [{ decision: 'BLOCKED' }, { decision: 'APPROVED_FOR_PAYMENT', requesterUserId: 'u_staff' }, { decision: 'NEEDS_INFO', requesterUserId: 'u_staff' }]) {
      assert.equal(evaluateCondition(template.defaultConditionJson, payload, now).matched, false);
    }
    assert.equal(template.name, 'แจ้งผู้เบิกเมื่อระงับการจ่าย');
    assert.doesNotMatch(template.description, /[a-zA-Z_]/);
    for (const [desk, actorUserId] of [
      [{ u_owner: holding('OWNER'), u_finance: holding('FINANCE'), u_accountant: holding('ACCOUNTANT') }, 'u_finance'],
      [{ u_owner: holding('OWNER'), u_finance: holding('FINANCE') }, 'u_finance'],
      [{ u_owner: holding('OWNER') }, 'u_owner'],
    ] as const) {
      const h = harness({ sourceBranchId: 'br_claim', memberships: desk });
      const action: { actionKey: string; configJson: Record<string, unknown> } = template.defaultActionJson[0]!;
      const context = {
        companyId: 'co_1', ruleName: template.name, triggerType: 'EVENT', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1',
        payload: { requestId: 'rb_1', requestNo: 'RB-1', requesterUserId: 'u_staff', actorUserId, decision: 'BLOCKED', note: 'ห้ามคัดลอก 0123456789' }, siblingActions: [],
      };
      await h.useCase.execute({ ...actionRun(action.configJson), actionKey: action.actionKey }, context);
      assert.equal(h.sent.length, 1);
      const notice = h.sent[0];
      assert.deepEqual(notice.recipientUserIds, ['u_staff']);
      assert.equal(notice.title, 'ใบเบิกของคุณถูกระงับการจ่าย: RB-1');
      assert.equal(notice.body, 'ใบเบิกยังอยู่ขั้นตรวจการเงิน รอผู้ตรวจการเงินดำเนินการต่อ หากผู้ตรวจระบุเหตุผล อ่านได้ในใบเบิก');
      assert.equal(notice.deepLinkHref, '/companies/co_1/reimbursements/rb_1');
      assert.equal(notice.periodKey, actionRun(action.configJson).workflowRunId);
      assert.doesNotMatch(notice.body, /0123456789|ห้ามคัดลอก|BLOCKED/);
      await h.useCase.execute({ ...actionRun(action.configJson), actionKey: action.actionKey }, { ...context, payload: { ...context.payload, requesterUserId: actorUserId } });
      assert.equal(h.sent.length, 1, 'requester who blocked their own claim gets none');
    }
  });

  it('gives a requester who reviews finance only their requester notice and weighs the desk fallback after both exclusions', async () => {
    const templates = ['reimbursement_finance_review', 'reimbursement_finance_blocked_requester'].map(key => WORKFLOW_TEMPLATE_CATALOG.find(t => t.key === key)!);
    const reviewer = holding('ACCOUNTANT');
    const owner = holding('OWNER');
    for (const { memberships, requesterUserId, actorUserId, deskRecipients } of [
      { memberships: { u_owner: owner, u_blocker: reviewer, u_requester: reviewer, u_other: reviewer }, requesterUserId: 'u_requester', actorUserId: 'u_blocker', deskRecipients: ['u_other'] },
      { memberships: { u_owner: owner, u_blocker: reviewer, u_requester: reviewer }, requesterUserId: 'u_requester', actorUserId: 'u_blocker', deskRecipients: ['u_owner'] },
      { memberships: { u_owner: owner, u_requester: reviewer }, requesterUserId: 'u_requester', actorUserId: 'u_owner', deskRecipients: [] },
      { memberships: { u_owner: owner, u_blocker: reviewer }, requesterUserId: 'u_owner', actorUserId: 'u_blocker', deskRecipients: [] },
      // An ordinary requester leaves the desk's recipients unchanged.
      { memberships: { u_owner: owner, u_blocker: reviewer, u_other: reviewer }, requesterUserId: 'u_staff', actorUserId: 'u_blocker', deskRecipients: ['u_other'] },
      { memberships: { u_owner: owner, u_blocker: reviewer }, requesterUserId: 'u_staff', actorUserId: 'u_blocker', deskRecipients: ['u_owner'] },
      { memberships: { u_owner: owner }, requesterUserId: 'u_staff', actorUserId: 'u_owner', deskRecipients: [] },
      // The requester blocks their own claim: neither template tells them.
      { memberships: { u_owner: owner, u_requester: reviewer }, requesterUserId: 'u_requester', actorUserId: 'u_requester', deskRecipients: ['u_owner'] },
    ]) {
      const h = harness({ sourceBranchId: 'br_claim', memberships });
      for (const template of templates) {
        const action = template.defaultActionJson[0]!;
        await h.useCase.execute({ ...actionRun(action.configJson), actionKey: action.actionKey }, {
          companyId: 'co_1', ruleName: template.name, triggerType: 'EVENT', sourceModule: 'reimbursements', sourceType: 'reimbursement_request', sourceId: 'rb_1',
          payload: { requestId: 'rb_1', requestNo: 'RB-1', requesterUserId, actorUserId, decision: 'BLOCKED', amount: '250', currency: 'THB' }, siblingActions: [],
        });
      }
      const requesterNotices = h.sent.filter(n => n.recipientUserIds.includes(requesterUserId));
      assert.deepEqual(requesterNotices.map(n => n.triggerKey), requesterUserId === actorUserId ? [] : ['workflow.reimbursement_finance_blocked_requester']);
      assert.deepEqual(h.sent.filter(n => n.triggerKey === 'workflow.reimbursement_finance_review').flatMap(n => n.recipientUserIds), deskRecipients);
      assert.ok(h.sent.every(n => !n.recipientUserIds.includes(actorUserId)));
    }
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

  // Review: the membership can be ACTIVE while the login is suspended. Such a member cannot act, and
  // as the only holder they would be the only recipient of a notice nobody then sees.
  it('asks only for holders whose membership and login are both active', async () => {
    const queries: any[] = [];
    const repository = new PrismaWorkflowRepository({
      client: { companyMembership: { findMany: async (query: any) => { queries.push(query); return [{ userId: 'u_payer' }]; } } },
    } as any);

    assert.deepEqual(await repository.findUserIdsByPermissions('co_1', [PAY]), ['u_payer']);
    assert.equal(queries[0].where.companyId, 'co_1');
    assert.equal(queries[0].where.status, 'ACTIVE');
    assert.deepEqual(queries[0].where.user, { status: 'ACTIVE' });
    assert.deepEqual(queries[0].where.roles.some.role.permissions.some.permission.key, { in: [PAY] });
  });

  // Review: a lookup that threw was not a retryable error, so one database blip sent the notice
  // straight to the dead letters. It is a read; it is retried like a failed send.
  it('retries the notice when looking up its recipients fails, instead of dead-lettering it', async () => {
    for (const failing of ['findUserIdsByPermissions', 'findUserIdsByRoles', 'findSourceBranchId', 'resolveAccess'] as const) {
      const h = harness({ memberships: { u_payer: member() } });
      h.repo.createDeadLetter = async () => { throw new Error(`${failing}: must not dead-letter on the first failure`); };
      const blip = async () => { throw new Error('connection reset'); };
      if (failing === 'resolveAccess') (h.useCase as any).access = { resolveAccess: blip };
      else h.repo[failing] = blip;

      await h.useCase.execute(actionRun(readyToPay().defaultActionJson[0]!.configJson), claimContext());

      assert.equal(h.sent.length, 0, failing);
      assert.equal(h.updates.at(-1)?.status, 'FAILED_RETRYABLE', failing);
      assert.match(h.updates.at(-1)?.lastErrorMessage, /Recipient lookup failed: connection reset/, failing);
    }
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

// Review 2026-10-01: the overdue-approval reminder is a scan, and a scan comes round every window. Each window's
// run asked for a task of its own, so a claim that stayed overdue collected one more identical reminder an hour.
describe('a scan keeps one open task per rule and record (the overdue-approval reminder)', () => {
  const sla = WORKFLOW_TEMPLATE_CATALOG.find((t) => t.key === 'approval_sla_breach')!;
  const taskAction = sla.defaultActionJson.find((a) => a.actionType === 'CREATE_WORKFLOW_TASK')!;

  function world() {
    const tasks: any[] = [];
    const ruleOfRun: Record<string, string> = {};
    const results: Record<string, any> = {};
    const repo = {
      updateActionRun: async (id: string, data: any) => { if (data.status !== 'RUNNING') results[id] = data; },
      findTaskByActionRunId: async (_companyId: string, actionRunId: string) => tasks.find((task) => task.workflowActionRunId === actionRunId) ?? null,
      // The repository's query over the rows held here; its SQL is asked of real PostgreSQL in the reimbursement gate.
      findOpenTaskOfRuleForSource: async (companyId: string, workflowRunId: string, sourceType: string, sourceId: string) => tasks.find((task) =>
        task.companyId === companyId && task.sourceType === sourceType && task.sourceId === sourceId && ['OPEN', 'SNOOZED'].includes(task.status)
        && task.workflowRunId !== workflowRunId && ruleOfRun[task.workflowRunId] === ruleOfRun[workflowRunId]) ?? null,
      createTask: async (data: any) => { const task = { id: `task_${tasks.length + 1}`, status: 'OPEN', ...data }; tasks.push(task); return task; },
    };
    const runner = new ExecuteWorkflowActionUseCase(repo as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    /** One scan window that finds the claim overdue: a run of the rule, and that run's task action. */
    const window = async (run: string, options: { claim?: string; rule?: string; triggerType?: string } = {}) => {
      ruleOfRun[run] = options.rule ?? 'rule_sla';
      const claim = options.claim ?? 'rb_1';
      await runner.execute({
        id: `ar_${run}`, workflowRunId: run, actionKey: taskAction.actionKey, actionType: 'CREATE_WORKFLOW_TASK', actionConfigSnapshotJson: taskAction.configJson,
        attemptCount: 0, idempotencyKey: `${run}:${taskAction.actionKey}`,
      } as any, {
        companyId: 'co_1', ruleName: sla.name, triggerType: options.triggerType ?? 'SLA_SCAN', sourceModule: 'reimbursements', sourceType: 'reimbursement_request',
        sourceId: claim, payload: { requestId: claim, requestNo: 'RB-202610-00007', approverTaskUserId: 'u_manager', slaRisk: true }, siblingActions: sla.defaultActionJson,
      } as any);
      return results[`ar_${run}`];
    };
    const open = (claim = 'rb_1') => tasks.filter((task) => task.sourceId === claim && task.status === 'OPEN').map((task) => task.id);
    return { tasks, window, open };
  }

  it('creates the reminder task once while the claim stays overdue, however many windows pass', async () => {
    const { tasks, window } = world();
    const first = await window('run_01h');
    assert.deepEqual([first.status, first.resultJson, first.targetId], ['SUCCEEDED', { created: true }, 'task_1']);
    // Before: a second and a third task, one for every window the claim was still overdue in.
    for (const run of ['run_02h', 'run_03h', 'run_04h']) {
      const later = await window(run);
      assert.deepEqual([later.status, later.resultJson, later.targetType, later.targetId],
        ['SUCCEEDED', { skipped: true, reason: 'open_task_exists' }, 'workflow_task', 'task_1'], run);
    }
    assert.deepEqual(tasks.map((task) => [task.title, task.priority, task.assigneeUserId, task.sourceId]),
      [['ใบเบิกรออนุมัติเกินกำหนด: RB-202610-00007', 'CRITICAL', 'u_manager', 'rb_1']]);
    // A task the person snoozed is still their open reminder: no second one arrives behind it.
    tasks[0].status = 'SNOOZED';
    assert.deepEqual((await window('run_05h')).resultJson, { skipped: true, reason: 'open_task_exists' });
    assert.equal(tasks.length, 1);
  });

  it('gives each submission round one task: a claim sent again is reminded anew, and again only once', async () => {
    const { tasks, window, open } = world();
    for (const run of ['run_01h', 'run_02h']) await window(run);
    // The claim is corrected and sent again: its tasks are cancelled, and the new round is reminded with its own.
    tasks[0].status = 'CANCELED';
    for (const run of ['run_09h', 'run_10h', 'run_11h']) await window(run);
    // Before: five tasks, one per window, four of them open.
    assert.deepEqual([tasks.map((task) => task.status), open()], [['CANCELED', 'OPEN'], ['task_2']]);
    // Closed by hand without approving: the claim is still overdue, so the next window says so again, once.
    tasks[1].status = 'DONE';
    for (const run of ['run_12h', 'run_13h']) await window(run);
    assert.deepEqual([tasks.map((task) => task.status), open()], [['CANCELED', 'DONE', 'OPEN'], ['task_3']]);
  });

  it('keeps one open task per claim and per rule, and leaves event-triggered tasks as they were', async () => {
    const { tasks, window, open } = world();
    // Two windows each for: the claim, another overdue claim, and another rule looking at the first claim.
    for (const hour of ['01h', '02h']) {
      await window(`run_${hour}`);
      await window(`run_${hour}_other_claim`, { claim: 'rb_2' });
      await window(`run_${hour}_other_rule`, { rule: 'rule_admin_copy' });
    }
    // Before: six tasks. Each claim has its own, and so has each rule; the second window added none.
    assert.deepEqual([open('rb_1'), open('rb_2')], [['task_1', 'task_3'], ['task_2']]);
    // A retry of the same action run finds its own task, as before.
    assert.deepEqual((await window('run_01h')).resultJson, { alreadyExisted: true });
    // An event happens once and its run is its own: a task per event, whatever is open.
    assert.deepEqual((await window('event_1', { triggerType: 'EVENT' })).resultJson, { created: true });
    assert.deepEqual((await window('event_2', { triggerType: 'EVENT' })).resultJson, { created: true });
    assert.equal(tasks.length, 5);
  });

  it('asks the database for an open or snoozed task of the same rule and record, made by another run', async () => {
    const asked: any[] = [];
    const row = { id: 'task_1', companyId: 'co_1', title: 't', priority: 'CRITICAL', status: 'OPEN', createdAt: new Date(), updatedAt: new Date() };
    const repo = new PrismaWorkflowRepository({ client: { workflowTask: { findFirst: async (args: any) => { asked.push(args); return asked.length === 1 ? row : null; } } } } as any);
    assert.equal((await repo.findOpenTaskOfRuleForSource('co_1', 'run_9', 'reimbursement_request', 'rb_1'))?.id, 'task_1');
    assert.equal(await repo.findOpenTaskOfRuleForSource('co_1', 'run_9', 'reimbursement_request', 'rb_1'), null);
    assert.deepEqual(asked[0], { where: {
      companyId: 'co_1', sourceType: 'reimbursement_request', sourceId: 'rb_1', status: { in: ['OPEN', 'SNOOZED'] },
      // Not a task of the asking run itself, so two task actions of one rule both create theirs.
      workflowRunId: { not: 'run_9' },
      // The same rule: the task's run and the asking run belong to one rule.
      workflowRun: { rule: { runs: { some: { id: 'run_9' } } } },
    } });
  });
});

// Owner 2026-10-02: text a shop user reads is plain Thai and true. These are the words a rule's notice and task
// fall back to when the rule has none of its own; what the runner does is unchanged.
describe('fallback words of a rule, in Thai', () => {
  const english = (text: string) => /[A-Za-z]/.test(text.replace(/\bAI\b/g, ''));
  const ruleContext: any = {
    companyId: 'co_1', ruleName: 'กฎของร้านทดสอบ', sourceModule: 'procurement', sourceType: 'vendor_bill', sourceId: 'bill_1',
    payload: { billId: 'bill_1' }, siblingActions: [],
  };
  const run = (actionType: string, configJson: Record<string, unknown>): any => ({
    id: 'ar_9', workflowRunId: 'run_9', actionKey: 'fallback_case', actionType, actionConfigSnapshotJson: configJson,
    attemptCount: 0, idempotencyKey: 'run_9:fallback_case', startedAt: undefined,
  });
  let repo: any;
  let notify: any;
  beforeEach(() => {
    repo = {
      updateActionRun: mock.fn(async () => undefined),
      findUserIdsByRoles: mock.fn(async () => []),
      findUserIdsByPermissions: mock.fn(async () => ['u_1']),
      findSourceBranchId: mock.fn(async () => null),
      findTaskByActionRunId: mock.fn(async () => null),
      createTask: mock.fn(async (data: any) => ({ id: 'task_9', ...data })),
    };
    notify = { execute: mock.fn(async () => ({ skipped: false, event: { id: 'ne_9' } })) };
  });
  const access = { resolveAccess: async () => ({ permissions: ['procurement.vendor_bill.approve'], roles: ['STAFF'], scopes: {} }) } as any;
  const make = () => new ExecuteWorkflowActionUseCase(repo, {} as any, {} as any, notify, {} as any, {} as any, access);

  it('titles a notice that has no title of its own by its rule', async () => {
    await make().execute(run('SEND_NOTIFICATION', { recipientPermissions: ['procurement.vendor_bill.approve'] }), ruleContext);
    const sent = (notify.execute.mock.calls[0] as any).arguments[0];
    assert.equal(sent.title, 'แจ้งเตือนจากกฎอัตโนมัติ: กฎของร้านทดสอบ');
  });

  it('asks for the AI draft by hand when the rule names no requester, as before but in Thai', async () => {
    await make().execute(run('REQUEST_AI_DRAFT', { templateKey: 'workflow_review_checklist', requesterUserId: '' }), ruleContext);
    assert.equal(repo.createTask.mock.callCount(), 1);
    const task = (repo.createTask.mock.calls[0] as any).arguments[0];
    assert.equal(task.title, 'ต้องดำเนินการเอง: กฎของร้านทดสอบ');
    assert.equal(english(task.description), false, task.description);
    assert.match(task.description, /ยังไม่ได้ระบุผู้ขอหรือแบบร่าง/);
    assert.deepEqual((repo.updateActionRun.mock.calls.at(-1) as any).arguments[1].resultJson, { fallback: true });
  });

  it('asks for a report export by hand when a rule wants one, in Thai', async () => {
    await make().execute(run('CREATE_REPORT_EXPORT_DRAFT', { reason: 'provider not implemented' }), ruleContext);
    const task = (repo.createTask.mock.calls[0] as any).arguments[0];
    assert.equal(task.title, 'ต้องดำเนินการเอง: กฎของร้านทดสอบ');
    assert.equal(english(task.description), false, task.description);
    assert.match(task.description, /หน้ารายงาน/);
  });
});
