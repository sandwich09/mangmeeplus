// Domain models for Notification (Item 06) — no framework imports

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
  'daily_owner_summary',
  'stock_low',
  'crm_sla_breach',
  'crm_new_conversation',
  'crm_payment_proof',
  'crm_booking_reminder',
  'workflow.reimbursement_pending_approval',
  'workflow.approval_sla_breach',
  'workflow.reimbursement_decision_requester',
  'workflow.reimbursement_finance_review',
  'workflow.reimbursement_ready_for_payment',
  'workflow.reimbursement_payment_recorded',
  'expense.substitute_receipt_signature_pending',
  // Separate key from the payer stage on purpose — a shared key put both stages on one dedup/alert
  // state and the payer notification's cooldown suppressed this one. See SIGNATURE_STAGES.
  'expense.substitute_receipt_approval_pending',
  // The four `expense.signature_*` keys are gone with the approval lifecycle they announced: a
  // personal signature (owner decision 2026-08-20) is usable the moment it is saved, so there is
  // nobody to tell and nothing to wait for.
  // Reports emits this on every completed export (report.use-cases.ts). While it sat in the future
  // list below, the preference gate — which defaults to exactly this array — dropped the LINE push
  // every time, and the preferences screen offers only implemented keys so nobody could opt in
  // either. The notification existed and could never be delivered.
  'report_ready',
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
