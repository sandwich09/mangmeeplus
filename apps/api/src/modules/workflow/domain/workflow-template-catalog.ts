import type { WorkflowActionDefinition, WorkflowConditionNode, WorkflowTemplateStatus, WorkflowTriggerType } from '@watchdog-bms/contracts';

export type WorkflowTemplateSeed = {
  key: string;
  name: string;
  description: string;
  category: string;
  sourceModule: string;
  triggerType: WorkflowTriggerType;
  defaultConditionJson: WorkflowConditionNode;
  defaultActionJson: WorkflowActionDefinition[];
  requiredPermissions: string[];
  requiredSourceModules: string[];
  defaultEnabled: boolean;
  status: WorkflowTemplateStatus;
  unavailableReason?: string;
  /**
   * Zero-setup enablement: prisma/sync-workflow-templates.ts and company onboarding create an
   * ENABLED rule from this template for every ACTIVE company that has NO rule for it yet.
   * Not a persisted WorkflowTemplate column and NOT the same as defaultEnabled (which describes
   * the template row itself); an admin who disables the created rule keeps it disabled forever.
   */
  autoEnable?: boolean;
};

// Default EVENT-trigger binding per template key. Not a persisted WorkflowTemplate column —
// applied by EnableWorkflowTemplateUseCase when the admin doesn't supply their own
// triggerConfigJson, so an EVENT-triggered rule created straight from a template actually
// subscribes to the right source event out of the box instead of matching nothing.
export const WORKFLOW_TEMPLATE_DEFAULT_TRIGGER_CONFIG: Record<string, Record<string, unknown>> = {
  reimbursement_pending_approval: { eventType: 'reimbursement.request_submitted' },
  reimbursement_decision_requester: { eventTypes: ['reimbursement.approved', 'reimbursement.rejected'] },
  reimbursement_correction_requester: { eventType: 'reimbursement.correction_requested' },
  reimbursement_finance_review: { eventType: 'reimbursement.finance_review_updated' },
  // Two ways a claim arrives at the finance desk: a person approved it, or it needed no approval
  // and was sent straight there. The second wrote an event no rule listened to, so nobody was told.
  reimbursement_finance_review_pending: { eventTypes: ['reimbursement.approved', 'reimbursement.finance_review_requested'] },
  reimbursement_ready_for_payment: { eventType: 'reimbursement.ready_for_payment' },
  reimbursement_payment_recorded: { eventType: 'reimbursement.payment_recorded' },
  reimbursement_payment_voided: { eventType: 'reimbursement.payment_voided' },
  reimbursement_payout_correction_requested: { eventType: 'reimbursement.payout_correction_requested' },
  reimbursement_payout_correction_submitted: { eventType: 'reimbursement.payout_correction_submitted' },
  vendor_bill_pending_approval: { eventType: 'vendor_bill.submitted' },
  vendor_bill_second_approval: { eventType: 'vendor_bill.approval_recorded' },
  ai_draft_requested: { eventType: 'ai.draft_requested' },
};

// Per-template cooldown applied when a rule is materialized from the template (auto-enable and
// admin enable), overriding WORKFLOW_DEFAULT_COOLDOWN_SECONDS. Not a persisted WorkflowTemplate
// column. The cooldown is per RULE, not per source record: on an EVENT-triggered reimbursement
// rule an hour-long window means the first claim's notification silences every other claim's for
// the rest of the hour, with no run row and no log. Replays are already blocked by the
// `event:<eventKey>` run dedup key, so these templates must be 0. Scan/schedule templates keep
// the default window — that is where a repeat-alert cadence is what cooldown is actually for.
export const WORKFLOW_TEMPLATE_DEFAULT_COOLDOWN_SECONDS: Record<string, number> = {
  reimbursement_pending_approval: 0,
  reimbursement_decision_requester: 0,
  reimbursement_correction_requester: 0,
  reimbursement_finance_review: 0,
  reimbursement_finance_review_pending: 0,
  reimbursement_ready_for_payment: 0,
  reimbursement_payment_recorded: 0,
  reimbursement_payment_voided: 0,
  reimbursement_payout_correction_requested: 0,
  reimbursement_payout_correction_submitted: 0,
};

// A template added next to one a company already has follows that one's switch: where the company
// turned the older notice off, the new one is created switched off too. An admin who disabled "paid"
// did not ask for "payment voided", and one who disabled the approval reminder did not ask for the
// payment reminder. The admin can still enable it; nothing else about auto-enable changes.
export const WORKFLOW_TEMPLATE_FOLLOWS_SIBLING: Record<string, string> = {
  reimbursement_payment_voided: 'reimbursement_payment_recorded',
  reimbursement_payment_sla_breach: 'approval_sla_breach',
  // The two notices of a payout account correction (payout spec §17.3): "your claim needs its account
  // corrected" beside "your claim needs correcting", "a new account waits for your approval" beside
  // "a claim waits for your approval".
  reimbursement_payout_correction_requested: 'reimbursement_correction_requester',
  reimbursement_payout_correction_submitted: 'reimbursement_pending_approval',
};

// Notices of two kinds about the same record that take each other's place (final review item 15): the newer
// one retires the open one of the other kind, as a notice already retires an earlier one of its own kind.
// "Paid" and "payment voided" are about the same money: after a void "จ่ายเงินเบิกแล้ว" is no longer true, and
// after the next payment "ยกเลิกการจ่ายเงินเบิก" is not. Keyed by the notice's trigger key and read by the
// action runner, not kept in a rule's config, so a rule pinned or edited before this follows it too.
export const WORKFLOW_NOTICE_ALSO_REPLACES: Record<string, readonly string[]> = {
  'workflow.reimbursement_payment_voided': ['workflow.reimbursement_payment_recorded'],
  'workflow.reimbursement_payment_recorded': ['workflow.reimbursement_payment_voided'],
};

// Step-journey spec §11/§13: every reimbursement notification links straight to that claim's
// journey page (one page per request — no more tab/drawer routing). Rendered by the action runner
// with the event payload + companyId (same renderer as titles); the plain sourceWebPath is the
// fallback when an action has no deepLinkPathTemplate (see workflow-action-runner.use-case.ts).
export const REIMBURSEMENT_REQUEST_LINK = '/companies/{{companyId}}/reimbursements/{{requestId}}';

// First-pass template catalog (spec section 18). Availability reflects the ACTUAL
// current repo state as of item 16 implementation: a template is AVAILABLE only when
// its source module already exposes the event and/or read API the trigger needs.
// All templates default to disabled — admin must enable/configure each from web.
export const WORKFLOW_TEMPLATE_CATALOG: WorkflowTemplateSeed[] = [
  {
    key: 'daily_owner_summary',
    name: 'Daily owner summary',
    description: 'Send Owner/Admin a daily dashboard summary link at 07:00 company time.',
    category: 'dashboard',
    sourceModule: 'dashboard',
    triggerType: 'SCHEDULE',
    defaultConditionJson: { field: 'periodKey', op: 'EXISTS' },
    defaultActionJson: [
      { actionKey: 'notify_owner_admin', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.daily_owner_summary', recipientRoles: ['OWNER', 'ADMIN'], severity: 'info' } },
    ],
    requiredPermissions: ['dashboard.read'],
    requiredSourceModules: ['dashboard'],
    defaultEnabled: false,
    status: 'DEPRECATED',
    unavailableReason: 'Daily owner summaries are produced by the dedicated notification scheduler.',
  },
  {
    key: 'low_stock_alert',
    name: 'Low stock alert',
    description: 'Notify inventory/owner and create a task when a product balance is at or below its reorder point.',
    category: 'inventory',
    sourceModule: 'inventory',
    triggerType: 'THRESHOLD_SCAN',
    defaultConditionJson: { field: 'productId', op: 'EXISTS' },
    defaultActionJson: [
      { actionKey: 'notify_inventory_owner', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.low_stock_alert', recipientRoles: ['OWNER', 'INVENTORY'], severity: 'action' } },
      { actionKey: 'create_reorder_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { titleTemplate: 'สินค้าใกล้หมด: {{productName}}', priority: 'HIGH', assigneeRole: 'INVENTORY' } },
    ],
    requiredPermissions: ['inventory.report.read'],
    requiredSourceModules: ['inventory'],
    defaultEnabled: false,
    status: 'AVAILABLE',
  },
  {
    key: 'stockout_risk',
    name: 'Stockout risk',
    description: 'Notify owner/inventory and create a reorder review task when projected days-of-stock fall below a threshold.',
    category: 'inventory',
    sourceModule: 'inventory',
    triggerType: 'THRESHOLD_SCAN',
    defaultConditionJson: { field: 'daysLeft', op: 'LTE', value: 7 },
    defaultActionJson: [
      { actionKey: 'notify_stockout_risk', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.stockout_risk', recipientRoles: ['OWNER', 'INVENTORY'], severity: 'action' } },
    ],
    requiredPermissions: ['inventory.report.read'],
    requiredSourceModules: ['inventory'],
    defaultEnabled: false,
    status: 'UNAVAILABLE',
    unavailableReason: 'Inventory module does not yet expose a stockout-risk (days-left) projection read API.',
  },
  {
    key: 'reimbursement_pending_approval',
    name: 'Reimbursement pending approval',
    description: 'Notify the assigned approver and create an approval-review task when a reimbursement request is submitted.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    // Only a claim that waits for a person. A claim below the approval threshold is submitted too,
    // but has no approver: matching it retried the notice into a dead letter on every such claim
    // and created an approval task for nobody.
    defaultConditionJson: { field: 'status', op: 'EQ', value: 'PENDING_APPROVAL' },
    defaultActionJson: [
      {
        actionKey: 'notify_approver',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_pending_approval',
          recipientPayloadKeys: ['approverRecipientUserIds'],
          severity: 'action',
          // Title comes from the sibling task template; the body must carry the numbers instead of
          // repeating it (the live notification showed the same line twice).
          bodyTemplate: 'ยอด {{amount}} {{currency}} · รออนุมัติจากคุณ',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): the actor of this event never gets notified about their
          // own action — a solo owner submitting/approving/paying their own claim gets none of
          // these pushes. An owner-only company excluding the sole recipient is expected, not a
          // failure (H-18), so this is a graceful skip rather than a dead-lettered retry.
          excludeRecipientPayloadKeys: ['actorUserId'],
          skipWhenAllRecipientsExcluded: true,
        },
      },
      { actionKey: 'create_approval_task', actionType: 'CREATE_APPROVAL_REVIEW_REQUEST', configJson: { titleTemplate: 'อนุมัติเบิกจ่าย: {{requestNo}}', priority: 'HIGH', assigneeUserPayloadKey: 'approverTaskUserId', assigneeRolePayloadKey: 'approverTaskRole' } },
    ],
    requiredPermissions: ['reimbursement.approve'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    key: 'approval_sla_breach',
    name: 'Approval SLA breach',
    description: 'Remind the approvers of a claim (the shop owner only when none of them can act) when it has waited for approval longer than the policy SLA age.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'SLA_SCAN',
    defaultConditionJson: { field: 'slaRisk', op: 'EQ', value: true },
    defaultActionJson: [
      // Owner decision 2026-10-02: to the claim's approvers only. The owner was added to every reminder
      // (`ownerRecipientUserIds`), whoever the approvers were. The scan names the owner AS the approvers
      // when none of them can act any more, which is the one case the owner is told.
      { actionKey: 'escalate_sla', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.approval_sla_breach', recipientPayloadKeys: ['approverRecipientUserIds'], severity: 'critical' } },
      { actionKey: 'create_escalation_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { titleTemplate: 'ใบเบิกรออนุมัติเกินกำหนด: {{requestNo}}', priority: 'CRITICAL', assigneeUserPayloadKey: 'approverTaskUserId', assigneeRolePayloadKey: 'approverTaskRole' } },
    ],
    requiredPermissions: ['reimbursement.approve'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    // Audit B9: the only reminder covered approvals, so a claim waiting for payment was never
    // chased. Same scan, same policy deadline and same cadence as the approval reminder above;
    // only a notice, because a task per scan window would pile up (audit B8).
    key: 'reimbursement_payment_sla_breach',
    name: 'Reimbursement payment SLA breach',
    description: 'Remind the person whose turn it is to record the payment (whoever passed or approved the claim, when they can pay), else everyone who can, when a claim has waited for payment longer than the policy SLA age.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'SLA_SCAN',
    defaultConditionJson: { field: 'slaRisk', op: 'EQ', value: true },
    defaultActionJson: [
      {
        actionKey: 'remind_payer',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_payment_sla_breach',
          recipientPermissions: ['reimbursement.payment.record'],
          // The same preference as the ready-to-pay notice, read from what the claim records: the
          // finance reviewer who passed it, else whoever approved it, else (for a claim nobody had
          // to approve) the people who would have, when they can record the payment. Never the
          // requester alone. With no such person, everyone able to record it.
          preferRecipientPayloadKeys: ['financeReviewerUserId', 'approvedByUserId', 'approverRecipientUserIds'],
          neverPreferRecipientPayloadKeys: ['requesterUserId'],
          // 'action', not 'critical': a critical notice is pushed through a person's quiet hours,
          // and a claim that has waited two days can wait until morning.
          severity: 'action',
          titleTemplate: 'ใบเบิกรอจ่ายเงินเกินกำหนด: {{requestNo}}',
          bodyTemplate: 'ยอด {{amount}} {{currency}} · รอคุณบันทึกการจ่ายเงิน',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // The scan comes round again by itself, so having nobody who can pay right now (a
          // suspended company, no payer covering the branch) is not a failure to retry into a
          // dead letter every window.
          skipWhenNoRecipients: true,
        },
      },
    ],
    requiredPermissions: ['reimbursement.payment.record'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    key: 'reimbursement_decision_requester',
    name: 'Reimbursement decision requester alert',
    description: 'Notify the requester when their reimbursement is approved or rejected.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'requesterUserId', op: 'EXISTS' },
    defaultActionJson: [
      {
        actionKey: 'notify_requester',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_decision_requester',
          recipientPayloadKeys: ['requesterUserId'],
          severity: 'info',
          // Sole action on this template: without its own titleTemplate the title falls back to
          // the rule name and acceptance criterion B ("rendered {{requestNo}}") cannot hold.
          titleTemplate: 'ผลอนุมัติเบิกจ่าย: {{requestNo}}',
          bodyTemplate: 'ผลการพิจารณา: {{decision}} · ยอด {{amount}} {{currency}}',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): the actor of this event never gets notified about their
          // own action — a solo owner submitting/approving/paying their own claim gets none of
          // these pushes. An owner-only company excluding the sole recipient is expected, not a
          // failure (H-18), so this is a graceful skip rather than a dead-lettered retry.
          excludeRecipientPayloadKeys: ['actorUserId'],
          skipWhenAllRecipientsExcluded: true,
        },
      },
    ],
    requiredPermissions: ['reimbursement.read_own'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    key: 'reimbursement_correction_requester',
    name: 'Reimbursement correction requester alert',
    description: 'Notify the requester when finance returns a reimbursement draft for correction.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'requesterUserId', op: 'EXISTS' },
    defaultActionJson: [
      {
        actionKey: 'notify_requester_correction',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_correction_requester',
          recipientPayloadKeys: ['requesterUserId'],
          severity: 'action',
          titleTemplate: 'ใบเบิกต้องแก้ไข: {{requestNo}}',
          bodyTemplate: '{{note}} · ยอด {{amount}} {{currency}}',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): the actor of this event never gets notified about their
          // own action — a solo owner submitting/approving/paying their own claim gets none of
          // these pushes. An owner-only company excluding the sole recipient is expected, not a
          // failure (H-18), so this is a graceful skip rather than a dead-lettered retry.
          excludeRecipientPayloadKeys: ['actorUserId'],
          skipWhenAllRecipientsExcluded: true,
        },
      },
    ],
    requiredPermissions: ['reimbursement.read_own'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    key: 'reimbursement_finance_review',
    name: 'Reimbursement finance review',
    description: 'Notify everyone who can run finance review when a claim is blocked.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    // NEEDS_INFO now returns to the requester as a DRAFT and has its own requester template.
    // APPROVED_FOR_PAYMENT has the ready-for-payment template; only BLOCKED stays on this desk.
    defaultConditionJson: { field: 'decision', op: 'EQ', value: 'BLOCKED' },
    defaultActionJson: [
      {
        actionKey: 'notify_finance_reviewer',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_finance_review',
          recipientPermissions: ['reimbursement.finance_review'],
          severity: 'action',
          titleTemplate: 'ตรวจสอบการเงินเบิกจ่าย: {{requestNo}}',
          bodyTemplate: 'ผลตรวจสอบ: {{decision}} · ยอด {{amount}} {{currency}}',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): the actor of this event never gets notified about their
          // own action — a solo owner submitting/approving/paying their own claim gets none of
          // these pushes. An owner-only company excluding the sole recipient is expected, not a
          // failure (H-18), so this is a graceful skip rather than a dead-lettered retry.
          excludeRecipientPayloadKeys: ['actorUserId'],
          skipWhenAllRecipientsExcluded: true,
        },
      },
    ],
    requiredPermissions: ['reimbursement.finance_review'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    // Live UAT 2026-08-29: the approver and the requester were notified but the finance desk
    // learned nothing when a claim ARRIVED — the sibling template above only fires on a BLOCKED
    // finance decision, i.e. on finance's own action.
    key: 'reimbursement_finance_review_pending',
    name: 'Reimbursement awaiting finance review',
    description: 'Notify the people who can run finance review on the claim (the shop owner only when nobody else can) when a claim arrives at the finance desk.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    // `reimbursement.approved` is emitted only when the policy routes the claim to finance review,
    // but the condition states the arrival explicitly so a wider emit can never widen this rule.
    defaultConditionJson: { field: 'status', op: 'EQ', value: 'FINANCE_REVIEW' },
    defaultActionJson: [
      {
        actionKey: 'notify_finance_reviewer',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_finance_review',
          recipientPermissions: ['reimbursement.finance_review'],
          // Owner decision 2026-10-02: to the people who review at the finance desk and can act on the
          // claim's branch, not to the shop owner, who holds every right and was told of every claim of
          // every branch. The owner is told only where nobody else can review the claim.
          lastResortRecipientRoles: ['OWNER'],
          severity: 'action',
          titleTemplate: 'ใบเบิกรอตรวจสอบการเงิน: {{requestNo}}',
          bodyTemplate: 'ยอด {{amount}} {{currency}} · รอตรวจสอบการเงิน',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): the actor of this event never gets notified about their
          // own action — a solo owner submitting/approving/paying their own claim gets none of
          // these pushes. An owner-only company excluding the sole recipient is expected, not a
          // failure (H-18), so this is a graceful skip rather than a dead-lettered retry.
          excludeRecipientPayloadKeys: ['actorUserId'],
          skipWhenAllRecipientsExcluded: true,
        },
      },
    ],
    requiredPermissions: ['reimbursement.finance_review'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    key: 'reimbursement_ready_for_payment',
    name: 'Reimbursement ready for payment',
    description: 'Notify the person whose turn it is to record this reimbursement payment (the finance reviewer who passed it, else whoever approved it, when they can pay), else everyone who can, when a claim is ready for payment.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'requestId', op: 'EXISTS' },
    defaultActionJson: [
      {
        actionKey: 'notify_payer',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_ready_for_payment',
          recipientPermissions: ['reimbursement.payment.record'],
          // Owner rule 2026-10-01: whose turn it is, not everyone who can pay (a shop owner holds
          // every right and was pushed for every claim). The order is the one the claim page and
          // the payment reminder use (`paymentTurnUserIds`): first the finance reviewer who passed
          // the claim, whom the event names when its actor is someone else (the approver of a
          // corrected payout account). Then the actor of this event when they can record the
          // payment: the approver, the finance reviewer, or whoever filed on someone's behalf a
          // claim that needed no approval. Next, the approvers the event names: the claim's own
          // approver when finance passed it (a finance reviewer may not hold the pay right), or
          // the people who would have approved a claim nobody had to approve. Never the requester
          // alone. With no such person, everyone able to pay.
          preferRecipientPayloadKeys: ['financeReviewerUserId', 'actorUserId', 'approverRecipientUserIds'],
          neverPreferRecipientPayloadKeys: ['requesterUserId'],
          severity: 'action',
          titleTemplate: 'พร้อมจ่ายเบิกจ่าย: {{requestNo}}',
          // Worded as the reader's own next step: every recipient is someone who can record it.
          bodyTemplate: 'ยอด {{amount}} {{currency}} · รอคุณบันทึกการจ่ายเงิน',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // NO actor exclusion, unlike every other claim notice (audit B9, owner rule 2026-10-01:
          // a claim has a requester and an approver, and the approver records the payment). The
          // actor of this event approved the claim; paying it is a different step, and it is
          // theirs. Excluding them left the approver-payer with no notice at all for the pay
          // step, which is how approved claims sat unpaid in production.
          // The actor gets it in the web bell only, though: a LINE push about what one has just
          // done oneself is the annoyance AC11 exists to prevent. Anyone else is pushed as usual.
          webOnlyRecipientPayloadKeys: ['actorUserId'],
        },
      },
    ],
    requiredPermissions: ['reimbursement.payment.record'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    key: 'reimbursement_payment_recorded',
    name: 'Reimbursement payment recorded',
    description: 'Notify the requester when their reimbursement has been paid.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'requestId', op: 'EXISTS' },
    defaultActionJson: [
      {
        actionKey: 'notify_requester_paid',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_payment_recorded',
          recipientPayloadKeys: ['requesterUserId'],
          severity: 'info',
          titleTemplate: 'จ่ายเงินเบิกแล้ว: {{requestNo}}',
          // Payout spec §17.3 (AC37, AC21): the sentence the payment event itself carries, built where
          // the payment is recorded: the method actually used, the last 4 digits of the account a
          // transfer went into, the amount, and whether a slip is attached. Nothing here assembles it
          // from raw fields, so no rule can print a method code or more of an account than that.
          // The event still carries paidAmount, currency and paymentNo: a rule pinned or edited before
          // this body keeps rendering "จ่ายแล้ว {{paidAmount}} {{currency}} · เลขที่จ่าย {{paymentNo}}".
          bodyTemplate: '{{paidNotice}}',
          // The claim page: the requester opens the slip there, on the payment's own row.
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): the actor of this event never gets notified about their
          // own action — a solo owner submitting/approving/paying their own claim gets none of
          // these pushes. An owner-only company excluding the sole recipient is expected, not a
          // failure (H-18), so this is a graceful skip rather than a dead-lettered retry.
          excludeRecipientPayloadKeys: ['actorUserId'],
          skipWhenAllRecipientsExcluded: true,
        },
      },
    ],
    requiredPermissions: ['reimbursement.read_own'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    // Audit B9: a requester told "paid" was never told when that payment was taken back.
    key: 'reimbursement_payment_voided',
    name: 'Reimbursement payment voided',
    description: 'Notify the requester when a recorded payment of their reimbursement is voided.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    // The requester, not just the claim: a void event written before its payload named the
    // requester has nobody to tell, and must skip rather than retry into a dead letter.
    defaultConditionJson: { field: 'requesterUserId', op: 'EXISTS' },
    defaultActionJson: [
      {
        actionKey: 'notify_requester_payment_voided',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_payment_voided',
          recipientPayloadKeys: ['requesterUserId'],
          severity: 'info',
          titleTemplate: 'ยกเลิกการจ่ายเงินเบิก: {{requestNo}}',
          // No figure and no reason on purpose: the reason is free text typed by the person who
          // voided, and a notice must never be able to carry an account number.
          bodyTemplate: 'การจ่ายเงินที่บันทึกไว้ถูกยกเลิก ใบเบิกกลับไปรอจ่าย',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): the actor of this event never gets notified about their
          // own action — a solo owner submitting/approving/paying their own claim gets none of
          // these pushes. An owner-only company excluding the sole recipient is expected, not a
          // failure (H-18), so this is a graceful skip rather than a dead-lettered retry.
          excludeRecipientPayloadKeys: ['actorUserId'],
          skipWhenAllRecipientsExcluded: true,
        },
      },
    ],
    requiredPermissions: ['reimbursement.read_own'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    // Payout spec §14, §17.3: an approved claim was sent back to have its payout account corrected.
    // To the requester alone, the one person it concerns (owner rule 2026-10-01).
    key: 'reimbursement_payout_correction_requested',
    name: 'Reimbursement payout account correction requested',
    description: 'Notify the requester when their approved reimbursement is sent back to have its payout account corrected.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'requesterUserId', op: 'EXISTS' },
    defaultActionJson: [
      {
        actionKey: 'notify_requester_payout_correction',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_payout_correction_requested',
          recipientPayloadKeys: ['requesterUserId'],
          severity: 'action',
          // The title and the body are the sentences the event itself carries, built in contracts where the
          // claim is sent back (`reimbursementPayoutSentBackNotice`), from what the claim held at that moment:
          // an account is corrected ("ใบเบิกต้องแก้บัญชีรับเงิน"), a missing one added, cash chosen again. The
          // body is the reason in the words of the fixed list and what to do. Nothing here assembles a
          // sentence, so no rule can print a code word or say "แก้บัญชี" of a claim with no account, and
          // the note a person typed is in no notice at all.
          titleTemplate: '{{payoutCorrectionTitle}}: {{requestNo}}',
          bodyTemplate: '{{payoutCorrectionNotice}}',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): a requester who asked for their own account to be changed is
          // not told what they have just done.
          excludeRecipientPayloadKeys: ['actorUserId'],
          skipWhenAllRecipientsExcluded: true,
        },
      },
    ],
    requiredPermissions: ['reimbursement.read_own'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    // Payout spec §14, §17.3: the requester gave the account again. To the approvers of the new step
    // alone: the people the claim had, or whoever its recorded role or the owner reaches when none of
    // them can act any more. A notice only: the approval is asked for on the claim's own page.
    key: 'reimbursement_payout_correction_submitted',
    name: 'Reimbursement payout account awaiting approval',
    description: 'Notify the approvers of the new step when the requester has given the payout account of a claim sent back for correction.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'status', op: 'EQ', value: 'PENDING_APPROVAL' },
    defaultActionJson: [
      {
        actionKey: 'notify_approver_payout_correction',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_payout_correction_submitted',
          recipientPayloadKeys: ['approverRecipientUserIds'],
          severity: 'action',
          // The title is the claim's own status label and the end of the body names the same thing, both from
          // the event (`reimbursementPayoutAnswerNotice`), by what the requester answered: another account
          // ("รออนุมัติบัญชีรับเงินใหม่"), the same account, a first account, or cash.
          titleTemplate: '{{payoutAnswerTitle}}: {{requestNo}}',
          bodyTemplate: 'ยอด {{amount}} {{currency}} · {{payoutAnswerNotice}}',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): a requester who is their own approver gave the account
          // themselves, and is not told so.
          excludeRecipientPayloadKeys: ['actorUserId'],
          skipWhenAllRecipientsExcluded: true,
        },
      },
    ],
    requiredPermissions: ['reimbursement.approve'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    key: 'vendor_bill_pending_approval',
    name: 'Vendor bill pending',
    description: 'Notify finance/accountant and create a task when a vendor bill is submitted for approval.',
    category: 'procurement',
    sourceModule: 'procurement',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'billId', op: 'EXISTS' },
    defaultActionJson: [
      { actionKey: 'notify_finance', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.vendor_bill_pending', recipientRoles: ['FINANCE', 'ACCOUNTANT'], severity: 'action' } },
      { actionKey: 'create_vendor_bill_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { titleTemplate: 'บิลรอตรวจสอบ: {{supplierName}}', priority: 'NORMAL', assigneeRole: 'FINANCE' } },
    ],
    requiredPermissions: ['procurement.vendor_bill.read'],
    requiredSourceModules: ['procurement'],
    defaultEnabled: false,
    status: 'AVAILABLE',
  },
  {
    key: 'vendor_bill_second_approval',
    name: 'Vendor bill awaiting second approval',
    description: 'Notify the other eligible approvers when a bill at or above the dual-approval threshold has its first approval recorded and waits for a second, different approver (H-07).',
    category: 'procurement',
    sourceModule: 'procurement',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'billId', op: 'EXISTS' },
    defaultActionJson: [
      {
        actionKey: 'notify_second_approver',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.vendor_bill_second_approval',
          recipientPermissions: ['procurement.vendor_bill.approve'],
          excludeRecipientPayloadKeys: ['submitterUserId', 'approverUserIds'],
          severity: 'action',
          titleTemplate: 'บิลรอผู้อนุมัติคนที่สอง: {{vendorBillNumber}}',
        },
      },
    ],
    requiredPermissions: ['procurement.vendor_bill.read'],
    requiredSourceModules: ['procurement'],
    defaultEnabled: false,
    status: 'AVAILABLE',
  },
  {
    key: 'tax_due_soon',
    name: 'Tax due soon',
    description: 'Notify accountant/owner and create a checklist task when a CIT period is due soon and not yet filed.',
    category: 'tax',
    sourceModule: 'tax',
    triggerType: 'SCHEDULE',
    defaultConditionJson: {
      type: 'ALL',
      conditions: [
        { field: 'dueDate', op: 'WITHIN_NEXT', value: { amount: 7, unit: 'days' } },
        { field: 'status', op: 'NOT_IN', value: ['FILED', 'PAID'] },
      ],
    },
    defaultActionJson: [
      { actionKey: 'notify_tax_due', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.tax_due_soon', recipientRoles: ['ACCOUNTANT', 'OWNER'], severity: 'action' } },
      { actionKey: 'create_tax_checklist_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { titleTemplate: 'ภาษีครบกำหนด: {{formType}} ({{periodKey}})', priority: 'HIGH', assigneeRole: 'ACCOUNTANT' } },
    ],
    requiredPermissions: ['tax.period.read'],
    requiredSourceModules: ['tax'],
    defaultEnabled: false,
    status: 'AVAILABLE',
  },
  {
    key: 'bank_reconciliation_aging',
    name: 'Bank reconciliation aging',
    description: 'Notify finance and create a task when an unmatched bank statement line ages past a threshold.',
    category: 'banking',
    sourceModule: 'banking',
    triggerType: 'THRESHOLD_SCAN',
    defaultConditionJson: { field: 'ageDays', op: 'GT', value: 7 },
    defaultActionJson: [
      { actionKey: 'notify_finance_aging', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.bank_reconciliation_aging', recipientRoles: ['FINANCE'], severity: 'action' } },
      { actionKey: 'create_reconciliation_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { titleTemplate: 'รายการยังไม่กระทบยอด', priority: 'NORMAL', assigneeRole: 'FINANCE' } },
    ],
    requiredPermissions: ['bank.match.read'],
    requiredSourceModules: ['banking'],
    defaultEnabled: false,
    status: 'AVAILABLE',
  },
  {
    key: 'overdue_invoice_follow_up',
    name: 'Overdue invoice follow-up',
    description: 'Notify finance/sales and create a follow-up task when an issued invoice is overdue and unpaid.',
    category: 'accounting',
    sourceModule: 'accounting-documents',
    triggerType: 'THRESHOLD_SCAN',
    defaultConditionJson: { field: 'dueDate', op: 'OLDER_THAN', value: { amount: 0, unit: 'days' } },
    defaultActionJson: [
      { actionKey: 'notify_overdue_invoice', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.overdue_invoice', recipientRoles: ['FINANCE'], severity: 'action' } },
    ],
    requiredPermissions: ['accounting.invoice.read'],
    requiredSourceModules: ['accounting-documents'],
    defaultEnabled: false,
    status: 'UNAVAILABLE',
    unavailableReason: 'Accounting Documents module does not yet expose an overdue/due-date filtered read API or event.',
  },
  {
    key: 'crm_follow_up_due',
    name: 'CRM follow-up due',
    description: 'Notify the sales owner and create a task link when a CRM follow-up task is open and overdue.',
    category: 'crm',
    sourceModule: 'crm',
    triggerType: 'THRESHOLD_SCAN',
    defaultConditionJson: { field: 'status', op: 'EQ', value: 'OVERDUE' },
    defaultActionJson: [
      { actionKey: 'notify_sales_owner', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.crm_follow_up_due', recipientRoles: ['SALES', 'MANAGER'], severity: 'action' } },
      { actionKey: 'create_follow_up_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { titleTemplate: 'ติดตามลูกค้า: {{customerName}}', priority: 'NORMAL', assigneeRole: 'SALES' } },
    ],
    requiredPermissions: ['crm.follow_up.read'],
    requiredSourceModules: ['crm'],
    defaultEnabled: false,
    status: 'AVAILABLE',
  },
  {
    key: 'crm_opportunity_stuck',
    name: 'Opportunity stuck',
    description: 'Notify the sales manager and create a review task when an open opportunity has had no stage change for N days.',
    category: 'crm',
    sourceModule: 'crm',
    triggerType: 'SCHEDULE',
    defaultConditionJson: { field: 'daysSinceStageChange', op: 'GT', value: 14 },
    defaultActionJson: [
      { actionKey: 'notify_sales_manager', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.crm_opportunity_stuck', recipientRoles: ['MANAGER'], severity: 'action' } },
      { actionKey: 'create_review_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { titleTemplate: 'โอกาสขายค้าง: {{opportunityName}}', priority: 'NORMAL', assigneeRole: 'MANAGER' } },
    ],
    requiredPermissions: ['crm.opportunity.read'],
    requiredSourceModules: ['crm'],
    defaultEnabled: false,
    status: 'AVAILABLE',
  },
  {
    key: 'sales_below_target',
    name: 'Sales below target',
    description: 'Notify owner/manager and create a review task when actual sales fall below target by a cutoff date.',
    category: 'crm',
    sourceModule: 'reports-bi',
    triggerType: 'SCHEDULE',
    defaultConditionJson: { field: 'actualVsTargetRatio', op: 'LT', value: 1 },
    defaultActionJson: [
      { actionKey: 'notify_sales_below_target', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.sales_below_target', recipientRoles: ['OWNER', 'MANAGER'], severity: 'action' } },
    ],
    requiredPermissions: ['crm.report.read'],
    requiredSourceModules: ['reports-bi'],
    defaultEnabled: false,
    status: 'UNAVAILABLE',
    unavailableReason: 'Sales target / BI data source (Master Implementation Checklist item 18) is not yet implemented.',
  },
  {
    key: 'ai_draft_requested',
    name: 'AI draft requested',
    description: 'Request a safe AI draft (item 17) on behalf of a configured requester when an event occurs. Set templateKey and requesterUserId in the action config; the draft is reviewed and applied only in web.',
    category: 'ai',
    sourceModule: 'ai-draft',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'eventType', op: 'EXISTS' },
    defaultActionJson: [
      { actionKey: 'request_ai_draft', actionType: 'REQUEST_AI_DRAFT', configJson: { templateKey: 'workflow_review_checklist', requesterUserId: '' } },
    ],
    requiredPermissions: ['ai.suggestion.request'],
    requiredSourceModules: ['ai-draft'],
    defaultEnabled: false,
    status: 'AVAILABLE',
  },
  {
    key: 'outbound_webhook',
    name: 'Outbound webhook',
    description: 'Call a signed, allowlisted, admin-configured webhook endpoint when a selected event occurs. Disabled by default.',
    category: 'integration',
    sourceModule: 'workflow',
    triggerType: 'EVENT',
    defaultConditionJson: { field: 'eventType', op: 'EXISTS' },
    defaultActionJson: [
      { actionKey: 'call_webhook', actionType: 'CALL_WEBHOOK', configJson: { endpointId: '' } },
    ],
    requiredPermissions: ['workflow.webhook.manage'],
    requiredSourceModules: ['workflow'],
    defaultEnabled: false,
    status: 'AVAILABLE',
  },
];
