import { reimbursementFinanceBlockedRequesterNotice, reimbursementPaymentTurnNotice, REIMBURSEMENT_PAYMENT_VOIDED_TITLE, THAI_SYSTEM_ROLE_NAMES as ROLE } from '@watchdog-bms/contracts';
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
  reimbursement_finance_blocked_requester: { eventType: 'reimbursement.finance_review_updated' },
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
  reimbursement_finance_blocked_requester: 0,
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
  reimbursement_finance_blocked_requester: 'reimbursement_decision_requester',
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

// The name each template shipped with before its current one, from this file's history (every name was
// English until 2026-10-03). A rule copies its template's name when it is created and keeps it, so a rule
// still named one of these was never named by its company; the release sync gives it the current name
// (renameDefaultNamedTemplateRulesForCompany). Any other name is the company's own and is never touched.
export const WORKFLOW_TEMPLATE_FORMER_NAMES: Record<string, readonly string[]> = {
  daily_owner_summary: ['Daily owner summary'],
  low_stock_alert: ['Low stock alert'],
  stockout_risk: ['Stockout risk'],
  reimbursement_pending_approval: ['Reimbursement pending approval'],
  approval_sla_breach: ['Approval SLA breach'],
  reimbursement_payment_sla_breach: ['Reimbursement payment SLA breach'],
  reimbursement_decision_requester: ['Reimbursement decision requester alert'],
  reimbursement_correction_requester: ['Reimbursement correction requester alert'],
  reimbursement_finance_review: ['Reimbursement finance review'],
  reimbursement_finance_review_pending: ['Reimbursement awaiting finance review'],
  reimbursement_ready_for_payment: ['Reimbursement ready for payment'],
  reimbursement_payment_recorded: ['Reimbursement payment recorded'],
  reimbursement_payment_voided: ['Reimbursement payment voided'],
  reimbursement_payout_correction_requested: ['Reimbursement payout account correction requested'],
  reimbursement_payout_correction_submitted: ['Reimbursement payout account awaiting approval'],
  vendor_bill_pending_approval: ['Vendor bill pending'],
  vendor_bill_second_approval: ['Vendor bill awaiting second approval'],
  tax_due_soon: ['Tax due soon'],
  bank_reconciliation_aging: ['Bank reconciliation aging'],
  overdue_invoice_follow_up: ['Overdue invoice follow-up'],
  crm_follow_up_due: ['CRM follow-up due'],
  crm_opportunity_stuck: ['Opportunity stuck'],
  sales_below_target: ['Sales below target'],
  ai_draft_requested: ['AI draft requested'],
  outbound_webhook: ['Outbound webhook'],
};

// First-pass template catalog (spec section 18). Availability reflects the ACTUAL
// current repo state as of item 16 implementation: a template is AVAILABLE only when
// its source module already exposes the event and/or read API the trigger needs.
// All templates default to disabled — admin must enable/configure each from web.
export const WORKFLOW_TEMPLATE_CATALOG: WorkflowTemplateSeed[] = [
  {
    key: 'daily_owner_summary',
    name: `สรุปประจำวันสำหรับ${ROLE.OWNER}และ${ROLE.ADMIN}`,
    description: `ส่งลิงก์สรุปภาพรวมธุรกิจให้${ROLE.OWNER}และ${ROLE.ADMIN}ทุกวันเวลาเจ็ดโมงเช้าตามเวลาของบริษัท`,
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
    unavailableReason: 'ระบบแจ้งสรุปประจำวันผ่านการตั้งค่าการแจ้งเตือนโดยเฉพาะ',
  },
  {
    key: 'low_stock_alert',
    name: 'แจ้งเตือนสินค้าใกล้ถึงจุดสั่งซื้อ',
    description: `แจ้ง${ROLE.INVENTORY}และ${ROLE.OWNER} และสร้างงานให้${ROLE.INVENTORY} เมื่อสินค้าคงเหลือไม่เกินจุดสั่งซื้อ`,
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
    name: 'ความเสี่ยงสินค้าขาด',
    description: `แจ้ง${ROLE.OWNER}และ${ROLE.INVENTORY} เมื่อจำนวนสินค้าที่คาดว่าจะเหลือน้อยกว่าที่กำหนด`,
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
    unavailableReason: 'ส่วนงานคลังสินค้ายังไม่มีข้อมูลคาดการณ์จำนวนวันที่สินค้าเหลือ',
  },
  {
    key: 'reimbursement_pending_approval',
    name: 'คำขอเบิกค่าใช้จ่ายรออนุมัติ',
    description: 'แจ้งผู้อนุมัติและสร้างงานตรวจสอบเมื่อมีคำขอเบิกค่าใช้จ่ายส่งเข้ามา',
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
    name: 'รายการเบิกจ่ายรออนุมัติเกินกำหนด',
    description: `เตือนและสร้างงานให้ผู้อนุมัติของรายการเบิกจ่ายเมื่อรายการรออนุมัติเกินเวลาที่กำหนด โดยแจ้ง${ROLE.OWNER}แทนเมื่อไม่มีผู้อนุมัติคนใดดำเนินการได้`,
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
    name: 'รายการเบิกจ่ายรอบันทึกการจ่ายเกินกำหนด',
    description: 'เตือนผู้มีหน้าที่บันทึกการจ่ายเงินตามลำดับสิทธิ์ เมื่อรายการเบิกจ่ายรอบันทึกการจ่ายเกินเวลาที่กำหนด หากไม่มีผู้ใดทำได้ให้เตือนทุกคนที่มีสิทธิ์',
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
          // D2: the scan suppresses confirmed duplicates; the runner chooses unresolved words even for old/edited rules.
          titleTemplate: reimbursementPaymentTurnNotice('overdue').title,
          bodyTemplate: reimbursementPaymentTurnNotice('overdue').body,
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
    name: 'แจ้งผลคำขอเบิกค่าใช้จ่าย',
    description: 'แจ้งผู้ขอเบิกเมื่อคำขอได้รับอนุมัติหรือถูกปฏิเสธ',
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
    name: 'แจ้งแก้ไขคำขอเบิกค่าใช้จ่าย',
    description: 'แจ้งผู้ขอเบิกเมื่อผู้ตรวจสอบด้านการเงินส่งคำขอกลับมาให้แก้ไข',
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
    key: 'reimbursement_finance_blocked_requester',
    name: 'แจ้งผู้เบิกเมื่อระงับการจ่าย',
    description: 'แจ้งผู้เบิกเมื่อผู้ตรวจการเงินระงับการจ่าย ให้เปิดใบเบิกดูรายละเอียดและรอผู้ตรวจการเงินดำเนินการต่อ',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'EVENT',
    defaultConditionJson: { type: 'ALL', conditions: [{ field: 'decision', op: 'EQ', value: 'BLOCKED' }, { field: 'requesterUserId', op: 'EXISTS' }] },
    defaultActionJson: [{
      actionKey: 'notify_requester_finance_blocked',
      actionType: 'SEND_NOTIFICATION',
      configJson: {
        triggerKey: 'workflow.reimbursement_finance_blocked_requester',
        recipientPayloadKeys: ['requesterUserId'],
        severity: 'info',
        titleTemplate: `${reimbursementFinanceBlockedRequesterNotice().title}: {{requestNo}}`,
        bodyTemplate: reimbursementFinanceBlockedRequesterNotice().body,
        deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
        excludeRecipientPayloadKeys: ['actorUserId'],
        skipWhenAllRecipientsExcluded: true,
      },
    }],
    requiredPermissions: ['reimbursement.read_own'],
    requiredSourceModules: ['reimbursements'],
    defaultEnabled: false,
    autoEnable: true,
    status: 'AVAILABLE',
  },
  {
    key: 'reimbursement_finance_review',
    name: 'รายการเบิกจ่ายติดขัดระหว่างตรวจการเงิน',
    description: `แจ้งผู้ตรวจสอบด้านการเงินเมื่อรายการติดขัด โดยแจ้ง${ROLE.OWNER}เมื่อไม่มีผู้ตรวจสอบคนอื่น`,
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
          // Owner decision 2026-10-02, the rule of the arrival notice below: to the reviewers who can act
          // on the claim's branch, and to the shop owner only when nobody else can review the claim.
          lastResortRecipientRoles: ['OWNER'],
          severity: 'action',
          titleTemplate: 'ตรวจสอบการเงินเบิกจ่าย: {{requestNo}}',
          bodyTemplate: 'ผลตรวจสอบ: {{decision}} · ยอด {{amount}} {{currency}}',
          deepLinkPathTemplate: REIMBURSEMENT_REQUEST_LINK,
          // Step-journey spec §11 (AC11): the actor of this event never gets notified about their
          // own action — a solo owner submitting/approving/paying their own claim gets none of
          // these pushes. An owner-only company excluding the sole recipient is expected, not a
          // failure (H-18), so this is a graceful skip rather than a dead-lettered retry.
          // The requester gets the requester notice even when they can review finance (controller decision 2026-10-02).
          excludeRecipientPayloadKeys: ['actorUserId', 'requesterUserId'],
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
    name: 'รายการเบิกจ่ายรอตรวจการเงิน',
    description: `แจ้งผู้ตรวจสอบด้านการเงินเมื่อรายการมาถึงคิวตรวจสอบ โดยแจ้ง${ROLE.OWNER}เมื่อไม่มีผู้ตรวจสอบคนอื่น`,
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
          // NO actor exclusion, as for the ready-to-pay notice below (owner decision 2026-10-02). Whoever
          // put the claim on this desk (the approver, or the sender of a claim nobody approves) may review
          // finance themselves: the review is then their own next task. Left out as the actor, with the
          // owner no longer told in their place, a shop whose approver is its one finance reviewer told
          // nobody. They get the notice in the web bell only: no LINE push about what one has just done.
          webOnlyRecipientPayloadKeys: ['actorUserId'],
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
    name: 'รายการเบิกจ่ายพร้อมบันทึกการจ่าย',
    description: 'แจ้งผู้มีหน้าที่บันทึกการจ่ายเงินตามลำดับสิทธิ์เมื่อรายการพร้อมจ่าย หากไม่มีผู้ใดทำได้ให้เตือนทุกคนที่มีสิทธิ์',
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
          titleTemplate: reimbursementPaymentTurnNotice('ready').title,
          // Worded as the reader's own next step: every recipient is someone who can record it.
          // D2: confirmed duplicates emit no ready event; old events without the field keep today's words.
          bodyTemplate: reimbursementPaymentTurnNotice('ready').body,
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
    name: 'แจ้งเมื่อบันทึกการจ่ายเงินแล้ว',
    description: 'แจ้งผู้ขอเบิกเมื่อบันทึกการจ่ายเงินแล้ว',
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
    name: 'แจ้งเมื่อยกเลิกรายการจ่ายเงิน',
    description: 'แจ้งผู้ขอเบิกเมื่อยกเลิกรายการจ่ายเงินที่บันทึกไว้',
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
          titleTemplate: REIMBURSEMENT_PAYMENT_VOIDED_TITLE,
          // No figure and no reason on purpose: the reason is free text typed by the person who
          // voided, and a notice must never be able to carry an account number.
          // D2: composed from the post-void claim in its transaction; the runner retains legacy-event fallback.
          bodyTemplate: '{{paymentVoidedNotice}}',
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
    name: 'แจ้งแก้ไขบัญชีรับเงินคืน',
    description: 'แจ้งผู้ขอเบิกเมื่อบัญชีรับเงินที่อนุมัติแล้วถูกส่งกลับมาให้แก้ไข',
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
    name: 'บัญชีรับเงินคืนที่แก้ไขแล้วรออนุมัติ',
    description: 'แจ้งผู้อนุมัติขั้นตอนถัดไปเมื่อผู้ขอเบิกส่งบัญชีรับเงินที่แก้ไขแล้ว',
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
    name: 'ใบวางบิลรออนุมัติ',
    description: `แจ้ง${ROLE.FINANCE}และ${ROLE.ACCOUNTANT} และสร้างงานให้${ROLE.FINANCE} เมื่อมีใบวางบิลส่งขออนุมัติ`,
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
    name: 'ใบวางบิลรอผู้อนุมัติคนถัดไป',
    description: 'แจ้งผู้อนุมัติคนถัดไปเมื่อใบวางบิลที่ต้องอนุมัติสองคนผ่านการอนุมัติครั้งแรกและรอผู้อนุมัติอีกคน',
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
    name: 'ใกล้ถึงกำหนดยื่นภาษี',
    description: `แจ้ง${ROLE.ACCOUNTANT}และ${ROLE.OWNER} และสร้างงานตรวจสอบให้${ROLE.ACCOUNTANT} เมื่อใกล้กำหนดยื่นภาษีเงินได้นิติบุคคลและยังไม่ได้ยื่น`,
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
    name: 'รายการเดินบัญชีธนาคารที่ยังไม่จับคู่เกินกำหนด',
    description: 'แจ้งฝ่ายการเงินและสร้างงานเมื่อพบรายการเดินบัญชีธนาคารที่ยังไม่จับคู่เกินเวลาที่กำหนด',
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
    name: 'ติดตามใบแจ้งหนี้เกินกำหนด',
    description: `แจ้ง${ROLE.FINANCE} เมื่อใบแจ้งหนี้ที่ออกแล้วเกินกำหนดและยังไม่ได้ชำระ`,
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
    unavailableReason: 'ส่วนงานเอกสารบัญชียังไม่มีข้อมูลหรือเหตุการณ์สำหรับค้นหารายการตามวันครบกำหนด',
  },
  {
    key: 'crm_follow_up_due',
    name: 'ถึงกำหนดติดตามลูกค้า',
    description: `แจ้ง${ROLE.SALES}และ${ROLE.MANAGER} และสร้างงานติดตามลูกค้าให้${ROLE.SALES} เมื่องานติดตามลูกค้าที่ยังเปิดอยู่เลยกำหนด`,
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
    name: 'โอกาสการขายไม่มีความคืบหน้า',
    description: `แจ้ง${ROLE.MANAGER} และสร้างงานตรวจสอบให้${ROLE.MANAGER} เมื่อโอกาสการขายที่เปิดอยู่ไม่มีการเปลี่ยนขั้นตอนเป็นเวลาหลายวัน`,
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
    name: 'ยอดขายต่ำกว่าเป้าหมาย',
    description: `แจ้ง${ROLE.OWNER}และ${ROLE.MANAGER} เมื่อยอดขายจริงต่ำกว่าเป้าหมายตามวันที่กำหนด`,
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
    unavailableReason: 'ส่วนงานข้อมูลยอดขายและเป้าหมายยังไม่มีข้อมูลให้ใช้งาน',
  },
  {
    key: 'ai_draft_requested',
    name: 'ขอให้ AI ช่วยร่างข้อมูล',
    description: 'ขอให้ AI ช่วยร่างข้อมูลแทนผู้ขอที่ตั้งค่าไว้เมื่อเกิดเหตุการณ์ ผู้ใช้ต้องตรวจและนำร่างไปใช้ในเว็บ',
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
    name: 'ส่งข้อมูลไปยังระบบภายนอก',
    description: 'ส่งข้อมูลที่ลงชื่อรับรองแล้วไปยังการเชื่อมต่อระบบภายนอกที่บริษัทตั้งไว้ เมื่อเกิดเหตุการณ์ที่เลือก การเชื่อมต่อที่เพิ่มใหม่จะปิดใช้งานไว้ก่อนเสมอ',
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
