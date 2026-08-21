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
  reimbursement_ready_for_payment: { eventType: 'reimbursement.ready_for_payment' },
  reimbursement_payment_recorded: { eventType: 'reimbursement.payment_recorded' },
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
  reimbursement_ready_for_payment: 0,
  reimbursement_payment_recorded: 0,
};

// Reimbursement notifications must land on the hub tab that can actually act on the claim.
// Rendered by the action runner with the event payload + companyId (same renderer as titles);
// the plain sourceWebPath is the fallback when an action has no deepLinkPathTemplate.
const reimbursementHubLink = (tab: string) => `/companies/{{companyId}}/reimbursements?tab=${tab}&focus={{requestId}}`;

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
    defaultConditionJson: { field: 'requestId', op: 'EXISTS' },
    defaultActionJson: [
      {
        actionKey: 'notify_approver',
        actionType: 'SEND_NOTIFICATION',
        configJson: {
          triggerKey: 'workflow.reimbursement_pending_approval',
          // OWNER too: matchesApproverRole treats an owner as an approver for every claim, so an
          // owner-only company (no MANAGER membership) resolved zero recipients and notified nobody.
          // The sibling approval-review TASK stays MANAGER-assigned — that is a worklist, not an alert.
          recipientRoles: ['MANAGER', 'OWNER'],
          // Audit H-18: the filer used to be invited to approve their own claim, landing on a
          // button that answers self_approval_denied. The submit payload only carries
          // requesterUserId while the policy forbids self-approval, so a company that allows it
          // keeps notifying the filer — one rule, expressed once, at the point that knows it.
          excludeRecipientPayloadKeys: ['requesterUserId'],
          // An owner-only company has nobody left to tell once the filer is excluded, and that is
          // correct rather than a failure. Opt-in: the dual-approval vendor bill wants the opposite,
          // where nobody left means the company genuinely lacks a second approver.
          skipWhenAllRecipientsExcluded: true,
          severity: 'action',
          // Title comes from the sibling task template; the body must carry the numbers instead of
          // repeating it (the live notification showed the same line twice).
          bodyTemplate: 'ยอด {{amount}} {{currency}} · รออนุมัติจากคุณ',
          deepLinkPathTemplate: reimbursementHubLink('approvals'),
        },
      },
      { actionKey: 'create_approval_task', actionType: 'CREATE_APPROVAL_REVIEW_REQUEST', configJson: { titleTemplate: 'อนุมัติเบิกจ่าย: {{requestNo}}', priority: 'HIGH', assigneeRole: 'MANAGER' } },
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
    description: 'Escalate to owner/manager when a pending reimbursement approval exceeds the policy SLA age.',
    category: 'finance',
    sourceModule: 'reimbursements',
    triggerType: 'SLA_SCAN',
    defaultConditionJson: { field: 'slaRisk', op: 'EQ', value: true },
    defaultActionJson: [
      { actionKey: 'escalate_sla', actionType: 'SEND_NOTIFICATION', configJson: { triggerKey: 'workflow.approval_sla_breach', recipientRoles: ['OWNER', 'MANAGER'], severity: 'critical' } },
      { actionKey: 'create_escalation_task', actionType: 'CREATE_WORKFLOW_TASK', configJson: { titleTemplate: 'อนุมัติเกิน SLA: {{requestNo}}', priority: 'CRITICAL', assigneeRole: 'MANAGER' } },
    ],
    requiredPermissions: ['reimbursement.approve'],
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
          deepLinkPathTemplate: reimbursementHubLink('mine'),
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
          deepLinkPathTemplate: reimbursementHubLink('mine'),
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
          deepLinkPathTemplate: reimbursementHubLink('finance'),
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
    description: 'Notify everyone who can record a reimbursement payment when a claim clears finance review.',
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
          severity: 'action',
          titleTemplate: 'พร้อมจ่ายเบิกจ่าย: {{requestNo}}',
          bodyTemplate: 'ยอด {{amount}} {{currency}} · รอบันทึกการจ่ายเงิน',
          deepLinkPathTemplate: reimbursementHubLink('finance'),
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
          // paidAmount, not amount: this event carries the payment's own figures.
          bodyTemplate: 'จ่ายแล้ว {{paidAmount}} {{currency}} · เลขที่จ่าย {{paymentNo}}',
          deepLinkPathTemplate: reimbursementHubLink('mine'),
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
