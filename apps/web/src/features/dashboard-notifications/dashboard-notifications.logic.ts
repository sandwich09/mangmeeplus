import type { DashboardWidget, DashboardFreshness, NotificationSeverity } from './dashboard-notifications.model';

export const NOTIFICATION_CHILD_LINKS = ['preferences', 'rules'] as const;
export type NotificationChildLink = (typeof NOTIFICATION_CHILD_LINKS)[number];

/**
 * Settings links are offered only when their GET and mutation endpoints can be used.
 * The notification centre itself remains available through `notification.read`.
 */
const NOTIFICATION_CHILD_LINK_PERMISSIONS: Record<NotificationChildLink, readonly string[]> = {
  preferences: ['notification.preference.manage'],
  rules: ['notification.rule.manage'],
};

export function visibleNotificationChildLinks(permissions: readonly string[]): NotificationChildLink[] {
  return NOTIFICATION_CHILD_LINKS.filter((link) =>
    NOTIFICATION_CHILD_LINK_PERMISSIONS[link].some((key) => permissions.includes(key)),
  );
}

export function getWidgetMetricValue(widget: DashboardWidget, metricKey: string): number | string | null {
  return widget.metrics.find((m) => m.key === metricKey)?.value ?? null;
}

export function getFirstMetricValue(widget: DashboardWidget): number | string | null {
  return widget.metrics[0]?.value ?? null;
}

export function freshnessLabel(freshness: DashboardFreshness): string {
  const labels: Record<DashboardFreshness, string> = {
    fresh: 'ล่าสุด',
    stale: 'ข้อมูลเก่า',
    partial: 'ข้อมูลบางส่วน',
    unavailable: 'ไม่พร้อมใช้งาน',
  };
  return labels[freshness] ?? freshness;
}

export function severityColor(severity: NotificationSeverity): string {
  switch (severity) {
    case 'critical': return 'text-red-700 bg-red-50';
    case 'action': return 'text-yellow-700 bg-yellow-50';
    case 'insight': return 'text-blue-700 bg-blue-50';
    default: return 'text-gray-600 bg-gray-50';
  }
}

export function severityLabel(severity: NotificationSeverity): string {
  const labels: Record<NotificationSeverity, string> = {
    critical: 'วิกฤต',
    action: 'ต้องดำเนินการ',
    insight: 'ข้อมูลเชิงลึก',
    info: 'แจ้งเพื่อทราบ',
  };
  return labels[severity] ?? severity;
}

/** Header bell badge: hidden at 0, capped at 99+. */
export function notificationBadgeText(total: number): string | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return total > 99 ? '99+' : String(total);
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'เมื่อกี้';
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}

/** Only same-origin app paths are followed: deepLinkHref is server-built, but an absolute
 *  URL there must never turn a notification click into an off-site redirect. Shared by the
 *  bell panel and the notification centre so both ends enforce the same rule. */
export function internalNotificationHref(href: string | null | undefined): string | undefined {
  return href && href.startsWith('/') && !href.startsWith('//') ? href : undefined;
}
