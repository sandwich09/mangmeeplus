// Client-side models for dashboard and notifications (Item 06)

export type DashboardPeriodKind = 'today' | 'week' | 'month' | 'quarter' | 'last_month' | 'custom';
export type DashboardFreshness = 'fresh' | 'stale' | 'partial' | 'unavailable';

export type DashboardMetricValue = {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  severity?: 'normal' | 'info' | 'warning' | 'critical';
  freshness: 'fresh' | 'stale' | 'unavailable';
  sourceRefs?: Array<{ module: string; sourceType: string; sourceId?: string; label: string; href?: string; permissionKey?: string }>;
};

export type DashboardWidget = {
  key: string;
  title: string;
  kind: string;
  module: string;
  metrics: DashboardMetricValue[];
  href?: string;
  unavailableReason?: string;
};

export type DashboardSnapshot = {
  id: string;
  companyId: string;
  periodKind: DashboardPeriodKind;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  freshnessStatus: DashboardFreshness;
  widgets: DashboardWidget[];
};

export type NotificationSeverity = 'critical' | 'action' | 'insight' | 'info';
export type NotificationStatus = 'open' | 'resolved' | 'dismissed';
export type NotificationChannel = 'web' | 'line';
export type NotificationDigestFrequency = 'none' | 'daily' | 'weekly';

export type NotificationItem = {
  id: string;
  companyId: string;
  triggerKey: string;
  sourceModule: string;
  severity: NotificationSeverity;
  status: NotificationStatus;
  title: string;
  body: string;
  deepLinkHref?: string;
  deliveryChannels: NotificationChannel[];
  periodKey?: string;
  read: boolean;
  readAt?: string;
  dismissedAt?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type NotificationListResult = {
  items: NotificationItem[];
  nextCursor?: string;
  total: number;
};

export type NotificationUnreadCount = {
  total: number;
  bySeverity: Record<NotificationSeverity, number>;
};

export type NotificationPreference = {
  userId: string;
  enabledChannels: NotificationChannel[];
  enabledTriggerKeys: string[];
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone: string;
  digestFrequency: NotificationDigestFrequency;
};

export type NotificationRule = {
  id: string;
  companyId: string;
  triggerKey: string;
  label: string;
  description?: string;
  status: 'enabled' | 'disabled' | 'system';
  severity: NotificationSeverity;
  channels: NotificationChannel[];
  cooldownMinutes: number;
  conditionJson: Record<string, unknown>;
  recipientPolicyJson: Record<string, unknown>;
  channelPolicyJson: Record<string, unknown>;
  digestPolicy: NotificationDigestFrequency;
};

export type NotificationDelivery = {
  id: string;
  recipientId: string;
  channel: NotificationChannel;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'suppressed';
  attemptCount: number;
  createdAt: string;
  sentAt?: string;
  errorCode?: string;
};
