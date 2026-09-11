import type {
  DashboardSnapshot,
  NotificationListResult,
  NotificationUnreadCount,
  NotificationPreference,
  NotificationRule,
  NotificationDelivery,
  DashboardPeriodKind,
  NotificationChannel,
  NotificationItem,
} from './dashboard-notifications.model';
import { authedApiFetch, type AuthedInit } from '@/common/api/authed-fetch';

type RawNotificationItem = Omit<NotificationItem, 'sourceModule' | 'status' | 'read' | 'deliveryChannels'> & {
  sourceRefs?: Array<{ module?: string }>;
  status?: NotificationItem['status'];
  readAt?: string;
  dismissedAt?: string;
  deliveryChannels?: NotificationChannel[];
};

type RawRule = {
  id: string;
  companyId: string;
  triggerKey: string;
  name: string;
  severity: NotificationRule['severity'];
  conditionJson: Record<string, unknown>;
  recipientPolicyJson: Record<string, unknown>;
  channelPolicyJson: { channels?: NotificationChannel[] } & Record<string, unknown>;
  cooldownMinutes: number;
  digestPolicy: NotificationRule['digestPolicy'];
  status: NotificationRule['status'];
};

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

async function apiFetch<T>(path: string, init?: AuthedInit): Promise<T> {
  try {
    return await authedApiFetch<T>(path, init);
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      throw new Error('ยังไม่พบ API endpoint นี้ หรือ backend ยังไม่ได้รัน');
    }
    throw error;
  }
}

// ---- Dashboard ----

export function getDashboard(companyId: string, periodKind?: DashboardPeriodKind, branchId?: string): Promise<DashboardSnapshot> {
  return apiFetch(`/v1/companies/${companyId}/dashboard${qs({ periodKind, branchId })}`);
}

export function generateSnapshot(companyId: string, periodKind?: DashboardPeriodKind, branchId?: string): Promise<DashboardSnapshot> {
  return apiFetch(`/v1/companies/${companyId}/dashboard/snapshots/generate`, {
    method: 'POST',
    body: JSON.stringify({ periodKind, ...(branchId ? { branchId } : {}) }),
  });
}

// ---- Notifications ----

export function listNotifications(
  companyId: string,
  params?: { status?: string; severity?: string; read?: boolean; cursor?: string; pageSize?: number },
): Promise<NotificationListResult> {
  return apiFetch<{ items: RawNotificationItem[]; nextCursor?: string }>(`/v1/companies/${companyId}/notifications${qs(params)}`)
    .then((res) => {
      const items = res.items.map(normalizeNotification);
      return { items, nextCursor: res.nextCursor, total: items.length };
    });
}

export function getUnreadCount(companyId: string): Promise<NotificationUnreadCount> {
  return apiFetch(`/v1/companies/${companyId}/notifications/unread-count`);
}

export const NOTIFICATIONS_CHANGED_EVENT = 'watchdog:notifications-changed';

function notifyNotificationsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

export function markRead(companyId: string, notificationId: string): Promise<void> {
  return apiFetch(`/v1/companies/${companyId}/notifications/${notificationId}/read`, { method: 'POST', body: '{}', suppressErrorToast: true }).then(notifyNotificationsChanged);
}

export function markAllRead(companyId: string): Promise<void> {
  return apiFetch(`/v1/companies/${companyId}/notifications/read-all`, { method: 'POST', body: '{}', suppressErrorToast: true }).then(notifyNotificationsChanged);
}

export function dismissNotification(companyId: string, notificationId: string): Promise<void> {
  return apiFetch(`/v1/companies/${companyId}/notifications/${notificationId}/dismiss`, { method: 'POST', body: '{}', suppressErrorToast: true }).then(notifyNotificationsChanged);
}

// ---- Preferences ----

export function getPreferences(companyId: string): Promise<NotificationPreference> {
  return apiFetch(`/v1/companies/${companyId}/notification-preferences`);
}

export function updatePreferences(companyId: string, body: Partial<NotificationPreference>): Promise<NotificationPreference> {
  return apiFetch(`/v1/companies/${companyId}/notification-preferences`, { method: 'PUT', body: JSON.stringify(body) });
}

// ---- Rules ----

export function listRules(companyId: string): Promise<{ items: NotificationRule[] }> {
  return apiFetch<RawRule[]>(`/v1/companies/${companyId}/notification-rules`)
    .then((items) => ({ items: items.map(normalizeRule) }));
}

export function updateRule(companyId: string, ruleId: string, body: Partial<NotificationRule>): Promise<NotificationRule> {
  return apiFetch<RawRule>(`/v1/companies/${companyId}/notification-rules/${ruleId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    suppressErrorToast: true,
  })
    .then(normalizeRule);
}

// ---- Deliveries ----

export function listDeliveries(companyId: string, params?: { channel?: string; status?: string }): Promise<{ items: NotificationDelivery[] }> {
  return apiFetch(`/v1/companies/${companyId}/notification-deliveries${qs(params)}`);
}

export function retryDelivery(companyId: string, deliveryId: string): Promise<void> {
  return apiFetch(`/v1/companies/${companyId}/notification-deliveries/${deliveryId}/retry`, { method: 'POST', body: '{}' });
}

export function normalizeNotification(raw: RawNotificationItem): NotificationItem {
  return {
    ...raw,
    sourceModule: raw.sourceRefs?.[0]?.module ?? 'dashboard',
    status: raw.dismissedAt ? 'dismissed' : raw.status ?? 'open',
    read: Boolean(raw.readAt),
    deliveryChannels: raw.deliveryChannels ?? [],
  };
}

export function normalizeRule(raw: RawRule): NotificationRule {
  const channels = Array.isArray(raw.channelPolicyJson?.channels) ? raw.channelPolicyJson.channels : [];
  return {
    id: raw.id,
    companyId: raw.companyId,
    triggerKey: raw.triggerKey,
    label: raw.name,
    description: raw.triggerKey,
    status: raw.status,
    severity: raw.severity,
    channels,
    cooldownMinutes: raw.cooldownMinutes,
    conditionJson: raw.conditionJson,
    recipientPolicyJson: raw.recipientPolicyJson,
    channelPolicyJson: raw.channelPolicyJson,
    digestPolicy: raw.digestPolicy,
  };
}
