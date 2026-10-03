// Notification shared contracts (Item 06)

export type NotificationSeverity = 'critical' | 'action' | 'insight' | 'info';

/** The bell and the notification pages show these; report rows reuse the words for the same levels. */
export const NOTIFICATION_SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  critical: 'สำคัญ',
  action: 'ต้องดำเนินการ',
  insight: 'ข้อมูลเชิงลึก',
  info: 'แจ้งเพื่อทราบ',
};

export type NotificationChannel = 'web' | 'line';

export type NotificationEventStatus = 'open' | 'resolved' | 'suppressed' | 'expired';

export type NotificationDeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'skipped'
  | 'suppressed';

export type NotificationTriggerKey =
  | 'daily_owner_summary'
  | 'stock_low'
  | 'stockout_risk'
  | 'sales_today_low'
  | 'invoice_overdue'
  | 'tax_due_soon'
  | 'approval_pending'
  | 'follow_up_due'
  | 'campaign_opportunity'
  | 'report_ready'
  | 'system_security_alert';

export type NotificationSourceRef = {
  module: string;
  sourceType: string;
  sourceId?: string;
  href?: string;
  label: string;
  permissionKey?: string;
};

export type NotificationSummaryDto = {
  status?: NotificationEventStatus;
  id: string;
  companyId: string;
  triggerKey: NotificationTriggerKey | string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  sourceRefs: NotificationSourceRef[];
  deepLinkHref?: string;
  createdAt: string;
  readAt?: string;
  dismissedAt?: string;
  deliveryChannels: NotificationChannel[];
};

export type NotificationPreferenceDto = {
  userId: string;
  enabledChannels: NotificationChannel[];
  enabledTriggerKeys: string[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone: string;
  digestFrequency: 'none' | 'daily' | 'weekly';
};

export type NotificationRuleDto = {
  id: string;
  companyId: string;
  triggerKey: string;
  name: string;
  severity: NotificationSeverity;
  conditionJson: Record<string, unknown>;
  recipientPolicyJson: Record<string, unknown>;
  channelPolicyJson: Record<string, unknown>;
  cooldownMinutes: number;
  digestPolicy: 'none' | 'daily' | 'weekly';
  status: 'enabled' | 'disabled' | 'system';
};

export type NotificationDeliveryDto = {
  id: string;
  recipientId: string;
  companyId: string;
  channel: NotificationChannel;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  sentAt?: string;
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
};

export type UnreadCountDto = {
  total: number;
  bySeverity: {
    critical: number;
    action: number;
    insight: number;
    info: number;
  };
};

export type ListNotificationsQuery = {
  status?: NotificationEventStatus;
  severity?: NotificationSeverity;
  triggerKey?: string;
  read?: boolean;
  cursor?: string;
  pageSize?: number;
};

export type UpdatePreferenceDto = {
  enabledChannels?: NotificationChannel[];
  enabledTriggerKeys?: string[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
  digestFrequency?: 'none' | 'daily' | 'weekly';
};

export type UpdateRuleDto = {
  conditionJson?: Record<string, unknown>;
  recipientPolicyJson?: Record<string, unknown>;
  channelPolicyJson?: Record<string, unknown>;
  cooldownMinutes?: number;
  digestPolicy?: 'none' | 'daily' | 'weekly';
  status?: 'enabled' | 'disabled';
};
