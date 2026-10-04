import type { DashboardWidget, DashboardFreshness, NotificationChannel, NotificationItem, NotificationSeverity, DashboardMetricValue } from './dashboard-notifications.model';
import { NOTIFICATION_SEVERITY_LABELS } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';

export function dashboardMetricValueText(metric: DashboardMetricValue): string {
  if (metric.value === null || metric.value === undefined || metric.value === '') return '—';
  if (metric.key === 'last_movement_at') return formatThaiDateTime(String(metric.value));
  if (typeof metric.value === 'number') return `${metric.value.toLocaleString('th-TH')}${metric.unit ? ` ${metric.unit}` : ''}`;
  return metric.unit ? `${metric.value} ${metric.unit}` : String(metric.value);
}

export function notificationRuleChannelsText(channels: readonly NotificationChannel[]): string {
  return channels.map((channel) => channel === 'line' ? 'LINE' : channel === 'web' ? t('notification.delivery.channel.web', 'th') : 'ช่องทางอื่น').join(', ');
}

/** The detail line under a rule. A rule that lists no channel leaves that part out (delivery follows each person's settings). */
export function notificationRuleDetailText(rule: { channels: readonly NotificationChannel[]; cooldownMinutes: number }): string {
  return [
    ...(rule.channels.length > 0 ? [`ช่องทาง: ${notificationRuleChannelsText(rule.channels)}`] : []),
    `พักการแจ้งเตือน ${rule.cooldownMinutes.toLocaleString('th-TH')} นาที`,
  ].join(' · ');
}

/**
 * A notice still waiting for its reader. One the server calls resolved is done with: it is never unread, whatever its read
 * time says (the badge and the unread list already leave it out). The dot, the tint, the bold title, "mark as read" and
 * "mark all" all follow this one rule.
 */
export function isUnreadNotification(item: Pick<NotificationItem, 'read' | 'status'>): boolean {
  return !item.read && item.status !== 'resolved';
}

/**
 * The sentence under a notice's title. It was written when the notice was raised and can ask for something ("waiting for you
 * to record the payment"); once the notice is resolved that request is no longer true, so a resolved notice shows its title
 * and its "done" tag only.
 */
export function notificationBodyText(item: Pick<NotificationItem, 'body' | 'status'>): string {
  return item.status === 'resolved' ? '' : item.body;
}

export function visibleNotifications(items: NotificationItem[], filter: 'all' | 'unread'): NotificationItem[] {
  return filter === 'unread' ? items.filter(isUnreadNotification) : items;
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
  return NOTIFICATION_SEVERITY_LABELS[severity] ?? severity;
}

/** The tag in front of a notice: how urgent it is, or that it is done. A done notice is no longer urgent, so it loses the urgent colour. */
export function notificationTag(item: Pick<NotificationItem, 'severity' | 'status'>): { label: string; tone: string } {
  return item.status === 'resolved' ? { label: 'ดำเนินการแล้ว', tone: severityColor('info') } : { label: severityLabel(item.severity), tone: severityColor(item.severity) };
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
