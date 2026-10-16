// Domain models for Notification (Item 06) — no framework imports
import { THAI_SYSTEM_ROLE_NAMES } from '@watchdog-bms/contracts';

export type NotificationSeverity = 'critical' | 'action' | 'insight' | 'info';
export type NotificationChannel = 'web' | 'line';
export type NotificationEventStatus = 'open' | 'resolved' | 'suppressed' | 'expired';
export type NotificationDeliveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'suppressed';
export type NotificationDigestPolicy = 'none' | 'daily' | 'weekly';
export type NotificationRuleStatus = 'enabled' | 'disabled' | 'system';
export type AlertStateStatus = 'active' | 'cooling_down' | 'resolved';
export type RecipientReason = 'owner' | 'role' | 'assigned' | 'team' | 'rule' | 'self';

export type NotificationRule = {
  id: string;
  companyId: string;
  triggerKey: string;
  name: string;
  severity: NotificationSeverity;
  conditionJson: Record<string, unknown>;
  recipientPolicyJson: Record<string, unknown>;
  channelPolicyJson: Record<string, unknown>;
  cooldownMinutes: number;
  digestPolicy: NotificationDigestPolicy;
  status: NotificationRuleStatus;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

const NOTIFICATION_RULE_DISPLAY_NAMES: Record<string, string> = {
  // DailyOwnerSummary sends it to every active OWNER and ADMIN.
  daily_owner_summary: `สรุปประจำวันสำหรับ${THAI_SYSTEM_ROLE_NAMES.OWNER}และ${THAI_SYSTEM_ROLE_NAMES.ADMIN}`,
  stock_low: 'สินค้าต่ำกว่าจุดสั่งซื้อ',
  stockout_risk: 'ความเสี่ยงสินค้าขาด',
  sales_today_low: 'ยอดขายวันนี้ต่ำกว่าเป้าหมาย',
  invoice_overdue: 'ใบแจ้งหนี้เกินกำหนด',
  tax_due_soon: 'ใกล้ถึงกำหนดยื่นภาษี',
  approval_pending: 'รายการรออนุมัติ',
  follow_up_due: 'ถึงกำหนดติดตามลูกค้า',
  campaign_opportunity: 'โอกาสทำการตลาด',
  report_ready: 'รายงานพร้อมดาวน์โหลด',
  system_security_alert: 'แจ้งเตือนความปลอดภัยของระบบ',
};

export function notificationRuleDisplayName(triggerKey: string): string {
  return NOTIFICATION_RULE_DISPLAY_NAMES[triggerKey] ?? 'กฎการแจ้งเตือน';
}

export type NotificationEvent = {
  id: string;
  companyId: string;
  ruleId?: string;
  triggerKey: string;
  sourceModule: string;
  sourceType: string;
  sourceId?: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  payloadJson: Record<string, unknown>;
  sourceRefsJson: Record<string, unknown>;
  deepLinkHref?: string;
  dedupKey: string;
  status: NotificationEventStatus;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt?: Date;
  readAt?: Date;
  dismissedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationRecipient = {
  id: string;
  eventId: string;
  companyId: string;
  userId: string;
  recipientReason: RecipientReason;
  readAt?: Date;
  dismissedAt?: Date;
  snoozedUntil?: Date;
  createdAt: Date;
};

export type NotificationDelivery = {
  id: string;
  recipientId: string;
  companyId: string;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  nextAttemptAt?: Date;
  sentAt?: Date;
  errorCode?: string;
  errorMessage?: string;
  providerMessageId?: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationPreference = {
  id: string;
  companyId: string;
  userId: string;
  enabledChannelsJson: string[];
  enabledTriggerKeysJson: string[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone: string;
  digestFrequency: NotificationDigestPolicy;
  createdAt: Date;
  updatedAt: Date;
};

export type AlertState = {
  id: string;
  companyId: string;
  dedupKey: string;
  status: AlertStateStatus;
  occurrenceCount: number;
  lastTriggeredAt: Date;
  cooldownUntil?: Date;
  lastResolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

// Implemented triggers — only these may be enabled, and LINE delivery of any other
// triggerKey is suppressed by the preference gate. Workflow-emitted keys must appear
// here or their pushes are dropped before reaching the provider.
export const IMPLEMENTED_TRIGGER_KEYS: string[] = [
  'billing.package_updated',
  'daily_owner_summary',
  'stock_low',
  'crm_sla_breach',
  'crm_new_conversation',
  'crm_payment_proof',
  'crm_booking_reminder',
  'workflow.reimbursement_pending_approval',
  'workflow.approval_sla_breach',
  // Audit B9: a claim waiting for payment past the policy deadline reminds whoever can pay it, and
  // the requester is told when a recorded payment of their claim is taken back.
  'workflow.reimbursement_duplicate_confirmed',
  'workflow.reimbursement_duplicate_cancel',
  'workflow.reimbursement_duplicate_sla_breach',
  'workflow.reimbursement_payment_sla_breach',
  'workflow.reimbursement_payment_voided',
  'workflow.reimbursement_finance_blocked_requester',
  'workflow.reimbursement_decision_requester',
  'workflow.reimbursement_correction_requester',
  'workflow.reimbursement_finance_review',
  'workflow.reimbursement_ready_for_payment',
  'workflow.reimbursement_payment_recorded',
  // Payout spec §14: an approved claim sent back to have its payout account corrected (to its
  // requester), and the account given again (to the approvers of the new step).
  'workflow.reimbursement_payout_correction_requested',
  'workflow.reimbursement_payout_correction_submitted',
  // Someone else set a member's payout account (owner decision 2026-10-01): the account owner is told
  // on the web and on LINE. The text names the editor and carries the last 4 digits, never the number.
  'reimbursement.payout_account_set_by_other',
  'expense.substitute_receipt_signature_pending',
  // Separate key from the payer stage on purpose — a shared key put both stages on one dedup/alert
  // state and the payer notification's cooldown suppressed this one. See SIGNATURE_STAGES.
  'expense.substitute_receipt_approval_pending',
  'expense.wht_certificate_cancelled',
  // Disbursement voucher spec §8.6: direct notices, including mandatory LINE delivery.
  'expense.review_requested',
  'expense.disbursement_pending_approval',
  'expense.disbursement_approved',
  'expense.disbursement_returned',
  'expense.disbursement_paid',
  'expense.disbursement_cancelled',

  // The four `expense.signature_*` keys are gone with the approval lifecycle they announced: a
  // personal signature (owner decision 2026-08-20) is usable the moment it is saved, so there is
  // nobody to tell and nothing to wait for.
  // Reports emits this on every completed export (report.use-cases.ts). While it sat in the future
  // list below, the preference gate — which defaults to exactly this array — dropped the LINE push
  // every time, and the preferences screen offers only implemented keys so nobody could opt in
  // either. The notification existed and could never be delivered.
  'report_ready',
  // P29 plan term. Both must live here or the preference gate drops the LINE push — the ladder
  // and the expiry notice are the only warning an owner gets before the shop is suspended.
  'plan_term_expiring',
  'plan_term_expired',
  // Sales console Phase 4 (spec §17.1/§17.2, D3). All three are console notices to มั่งมี staff on
  // the platform tenant, never to a shop: prices and shop names stay out of every body (R14/S24).
  'sales_deal_renewal_pending',
  'sales_deal_renewal_overdue',
  'sales_daily_digest',
  // D-P5-6: 14 days before an auto-renewing deal goes back to the catalog price. Reaches the shop
  // OWNER (console + LINE, number-free) and the sales team's own work list.
  'sales_deal_ending',
];

/**
 * Notices the product owes a person, which a saved preference list therefore cannot drop. That list
 * is frozen the first time a preference row is saved, so every trigger added afterwards is missing
 * from it and its LINE push would be suppressed without anyone having chosen that. A recipient who
 * turned the LINE channel off altogether is still respected.
 */
export const ALWAYS_DELIVERED_TRIGGER_KEYS: string[] = [
  'expense.wht_certificate_cancelled',
  // Disbursement voucher spec §8.6: direct notices, including mandatory LINE delivery.
  'expense.review_requested',
  'expense.disbursement_pending_approval',
  'expense.disbursement_approved',
  'expense.disbursement_returned',
  'expense.disbursement_paid',
  'expense.disbursement_cancelled',

  // Where a member's reimbursements are paid: telling them is the owner's condition for letting
  // anyone else set the account.
  'reimbursement.payout_account_set_by_other',
  // Audit B9, added the same day: a requester whose recorded payment was taken back, and whoever can
  // pay a claim that has waited past the company's deadline. Both are about money a person is owed,
  // and everyone who saved a preference row before today would otherwise get them on the web bell only.
  'workflow.reimbursement_payment_voided',
  'workflow.reimbursement_finance_blocked_requester',
  'workflow.reimbursement_duplicate_confirmed',
  'workflow.reimbursement_duplicate_cancel',
  'workflow.reimbursement_duplicate_sla_breach',
  'workflow.reimbursement_payment_sla_breach',
  // A claim held back from payment until its payout account is corrected, and the account then waiting
  // for approval: neither person asked for the wait, and the money is paid only after both have acted.
  'workflow.reimbursement_payout_correction_requested',
  'workflow.reimbursement_payout_correction_submitted',
];

// Future triggers — disabled until source module exists
export const FUTURE_TRIGGER_KEYS: string[] = [
  'stockout_risk',
  'sales_today_low',
  'invoice_overdue',
  'tax_due_soon',
  'approval_pending',
  'follow_up_due',
  'campaign_opportunity',
  'system_security_alert',
];

/**
 * Ownership, independent of rules and channel preferences. All listed/emitted keys belong here.
 * [] = platform-wide; null = blocked pending a product ownership decision. Required features use
 * the canonical entitlement evaluator's expanded keys, so an explicit submenu OFF wins.
 */
export const NOTIFICATION_TRIGGER_FEATURE_KEYS: Readonly<Record<string, readonly string[] | null>> = {
  'billing.package_updated': [],
  daily_owner_summary: ['dashboard_notifications'],
  stock_low: ['inventory'],
  stockout_risk: ['inventory'],
  crm_sla_breach: ['crm.inbox'],
  crm_new_conversation: ['crm.inbox'],
  crm_payment_proof: ['crm.inbox'],
  crm_booking_reminder: ['crm.bookings'],
  'workflow.reimbursement_pending_approval': ['reimbursement'],
  'workflow.approval_sla_breach': ['reimbursement'],
  'workflow.reimbursement_duplicate_confirmed': ['reimbursement'],
  'workflow.reimbursement_duplicate_cancel': ['reimbursement'],
  'workflow.reimbursement_duplicate_sla_breach': ['reimbursement'],
  'workflow.reimbursement_payment_sla_breach': ['reimbursement'],
  'workflow.reimbursement_payment_voided': ['reimbursement'],
  'workflow.reimbursement_finance_blocked_requester': ['reimbursement'],
  'workflow.reimbursement_decision_requester': ['reimbursement'],
  'workflow.reimbursement_correction_requester': ['reimbursement'],
  'workflow.reimbursement_finance_review': ['reimbursement'],
  'workflow.reimbursement_ready_for_payment': ['reimbursement'],
  'workflow.reimbursement_payment_recorded': ['reimbursement'],
  'workflow.reimbursement_payout_correction_requested': ['reimbursement'],
  'workflow.reimbursement_payout_correction_submitted': ['reimbursement'],
  'reimbursement.payout_account_set_by_other': ['reimbursement'],
  'expense.substitute_receipt_signature_pending': ['expenses'],
  'expense.substitute_receipt_approval_pending': ['expenses'],
  'expense.wht_certificate_cancelled': ['expenses'],
  'expense.review_requested': ['expenses'],
  'expense.disbursement_pending_approval': ['expenses'],
  'expense.disbursement_approved': ['expenses'],
  'expense.disbursement_returned': ['expenses'],
  'expense.disbursement_paid': ['expenses'],
  'expense.disbursement_cancelled': ['expenses'],

  report_ready: ['reports'],
  plan_term_expiring: [],
  plan_term_expired: [],
  sales_deal_renewal_pending: [],
  sales_deal_renewal_overdue: [],
  sales_daily_digest: [],
  sales_deal_ending: [],
  sales_today_low: ['sales_documents'],
  invoice_overdue: ['sales_documents'],
  tax_due_soon: ['thai_tax'],
  approval_pending: ['workflow_automation'],
  follow_up_due: ['crm.followups'],
  // The future marketing module has no sold feature key. Do not invent one or make this global.
  campaign_opportunity: null,
  system_security_alert: [],
  // Template notices stay outside IMPLEMENTED_TRIGGER_KEYS: ownership does not enable LINE.
  'workflow.daily_owner_summary': ['dashboard_notifications'],
  'workflow.low_stock_alert': ['inventory'],
  'workflow.stockout_risk': ['inventory'],
  'workflow.vendor_bill_pending': ['procurement.vendor_bills'],
  'workflow.vendor_bill_second_approval': ['procurement.vendor_bills'],
  'workflow.tax_due_soon': ['thai_tax'],
  'workflow.bank_reconciliation_aging': ['bank_reconciliation.matching'],
  'workflow.overdue_invoice': ['sales_documents'],
  'workflow.crm_follow_up_due': ['crm.followups'],
  'workflow.crm_opportunity_stuck': ['crm.pipeline'],
  'workflow.sales_below_target': ['crm.overview'],
  signup_pending_review: [],
  signup_ops_alert: [],
  crm_pdpa_erasure_completed: ['crm.customers'],
  crm_pdpa_erasure_failed: ['crm.customers'],
};

export function isNotificationTriggerEntitled(triggerKey: string, entitled: ReadonlySet<string> | null): boolean {
  const required = NOTIFICATION_TRIGGER_FEATURE_KEYS[triggerKey];
  return Array.isArray(required) && (entitled === null || required.every(key => entitled.has(key)));
}

export const MAX_DELIVERY_ATTEMPTS = 5;

// Default delivery channels when a user has no NotificationPreference row (A4).
// LINE is on by default so staff get pushes without first opening preferences;
// per-user opt-out still works via the preference channel list.
export const DEFAULT_ENABLED_CHANNELS: string[] = ['web', 'line'];

// Exponential backoff base for a retryable delivery failure; capped at 1h.
export const DELIVERY_BACKOFF_BASE_MS = 30_000;
export const DELIVERY_BACKOFF_MAX_MS = 3_600_000;

// Rows processed per delivery sweep batch (bounds one worker pass).
export const DELIVERY_SWEEP_BATCH_LIMIT = 200;

// Delivery error codes that are transient and worth retrying. Matches the codes
// pushLineMessage emits (RATE_LIMIT for 429, NETWORK_ERROR); HTTP_5xx is handled
// separately in isRetryableDeliveryError. Others (HTTP_4xx auth/bad-request, no
// target, preference/quiet-hours) are terminal.
export const RETRYABLE_DELIVERY_ERROR_CODES: string[] = ['RATE_LIMIT', 'NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_ERROR'];
