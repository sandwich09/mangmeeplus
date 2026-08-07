// Domain ports for Dashboard and Notification (Item 06)
import type { DashboardSnapshot, DashboardWidgetConfig } from '../models/dashboard.model';
import type {
  NotificationRule,
  NotificationEvent,
  NotificationRecipient,
  NotificationDelivery,
  NotificationPreference,
  AlertState,
} from '../models/notification.model';

// ---- Dashboard ----

export interface DashboardSnapshotRepositoryPort {
  findLatest(companyId: string, periodKind: string): Promise<DashboardSnapshot | null>;
  findById(companyId: string, id: string): Promise<DashboardSnapshot | null>;
  create(data: Omit<DashboardSnapshot, 'id' | 'createdAt'>): Promise<DashboardSnapshot>;
}

export interface DashboardWidgetConfigRepositoryPort {
  list(companyId: string): Promise<DashboardWidgetConfig[]>;
  upsert(companyId: string, widgetKey: string, data: Partial<DashboardWidgetConfig>): Promise<DashboardWidgetConfig>;
}

// ---- Notification Rules ----

export interface NotificationRuleRepositoryPort {
  list(companyId: string): Promise<NotificationRule[]>;
  findById(companyId: string, id: string): Promise<NotificationRule | null>;
  findByTriggerKey(companyId: string, triggerKey: string): Promise<NotificationRule | null>;
  update(companyId: string, id: string, data: Partial<NotificationRule>): Promise<NotificationRule>;
}

// ---- Notification Events ----

export type ListEventsFilter = {
  status?: string;
  severity?: string;
  triggerKey?: string;
  read?: boolean;
  cursor?: string;
  pageSize?: number;
};

export interface NotificationEventRepositoryPort {
  findByDedupKey(companyId: string, dedupKey: string): Promise<NotificationEvent | null>;
  findById(companyId: string, id: string): Promise<NotificationEvent | null>;
  list(companyId: string, userId: string, filter: ListEventsFilter): Promise<{ items: NotificationEvent[]; nextCursor?: string }>;
  create(data: Omit<NotificationEvent, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotificationEvent>;
  update(companyId: string, id: string, data: Partial<NotificationEvent>): Promise<NotificationEvent>;
}

// ---- Notification Recipients ----

export interface NotificationRecipientRepositoryPort {
  findByEventAndUser(eventId: string, userId: string): Promise<NotificationRecipient | null>;
  listByUser(companyId: string, userId: string, filter: { read?: boolean; cursor?: string; pageSize?: number }): Promise<{ items: NotificationRecipient[]; nextCursor?: string }>;
  countUnread(companyId: string, userId: string): Promise<{ total: number; bySeverity: Record<string, number> }>;
  create(data: Omit<NotificationRecipient, 'id' | 'createdAt'>): Promise<NotificationRecipient>;
  update(companyId: string, id: string, data: Partial<NotificationRecipient>): Promise<NotificationRecipient>;
  markAllRead(companyId: string, userId: string): Promise<number>;
}

// ---- Notification Deliveries ----

export interface NotificationDeliveryRepositoryPort {
  findById(companyId: string, id: string): Promise<NotificationDelivery | null>;
  listByCompany(companyId: string, filter: { channel?: string; status?: string; cursor?: string; pageSize?: number }): Promise<{ items: NotificationDelivery[]; nextCursor?: string }>;
  listQueued(companyId: string, limit: number): Promise<NotificationDelivery[]>;
  create(data: Omit<NotificationDelivery, 'id' | 'createdAt' | 'updatedAt'>): Promise<NotificationDelivery>;
  update(companyId: string, id: string, data: Partial<NotificationDelivery>): Promise<NotificationDelivery>;
}

// ---- Notification Preferences ----

export interface NotificationPreferenceRepositoryPort {
  findByUser(companyId: string, userId: string): Promise<NotificationPreference | null>;
  upsert(companyId: string, userId: string, data: Partial<NotificationPreference>): Promise<NotificationPreference>;
}

// ---- Alert State ----

export interface AlertStateRepositoryPort {
  findByDedupKey(companyId: string, dedupKey: string): Promise<AlertState | null>;
  upsert(companyId: string, dedupKey: string, data: Partial<AlertState>): Promise<AlertState>;
}

// ---- Dashboard Metric Provider Port ----

import type { DashboardWidget } from '@watchdog-bms/contracts';

export type DashboardMetricProviderPort = {
  moduleKey: string;
  collectMetrics(input: {
    companyId: string;
    userId: string;
    permissions: string[];
    periodStart: Date;
    periodEnd: Date;
  }): Promise<DashboardWidget[]>;
};
