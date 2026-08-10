'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ForbiddenState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import {
  listNotifications,
  markRead,
  markAllRead,
  dismissNotification,
  listRules,
  updateRule,
  getPreferences,
  updatePreferences,
} from './dashboard-notifications.api';
import {
  severityColor,
  severityLabel,
  formatRelativeTime,
  visibleNotificationChildLinks, internalNotificationHref } from './dashboard-notifications.logic';
import type { NotificationItem, NotificationRule, NotificationPreference, NotificationSeverity } from './dashboard-notifications.model';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';

function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{message}</div>;
}

// ---- Notification Center Page ----

export function NotificationCenterPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const toast = useToast();
  const router = useRouter();
  const canRead = canSeeRoute('/notifications', permissions);
  const childLinks = visibleNotificationChildLinks(permissions);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(canRead);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [busyRow, setBusyRow] = useState<{ id: string; action: 'read' | 'dismiss' } | null>(null);
  const [markAllBusy, setMarkAllBusy] = useState(false);

  function reload() {
    if (!canRead) return;
    setLoading(true);
    listNotifications(companyId, { read: filter === 'unread' ? false : undefined, pageSize: 50 })
      .then((res) => { setItems(res.items); setLoading(false); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : 'โหลดล้มเหลว'); setLoading(false); });
  }

  useEffect(() => { reload(); }, [canRead, companyId, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMarkRead(id: string) {
    if (busyRow || markAllBusy) return;
    setBusyRow({ id, action: 'read' });
    try {
      await markRead(companyId, id).catch(() => null);
      setItems((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } finally {
      setBusyRow(null);
    }
  }

  async function handleDismiss(id: string) {
    if (busyRow || markAllBusy) return;
    setBusyRow({ id, action: 'dismiss' });
    try {
      await dismissNotification(companyId, id).catch(() => null);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } finally {
      setBusyRow(null);
    }
  }

  async function handleMarkAllRead() {
    if (busyRow || markAllBusy) return;
    setMarkAllBusy(true);
    try {
      await markAllRead(companyId).then(() => toast.success('ทำเครื่องหมายว่าอ่านทั้งหมดเรียบร้อยแล้ว')).catch(() => null);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    } finally {
      setMarkAllBusy(false);
    }
  }

  function internalHref(item: NotificationItem): string | undefined {
    return internalNotificationHref(item.deepLinkHref);
  }

  async function handleOpen(item: NotificationItem) {
    const href = internalHref(item);
    if (!href) return;
    if (!item.read) await handleMarkRead(item.id);
    router.push(href);
  }

  if (!canRead) return <ForbiddenState />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold text-gray-900">ศูนย์การแจ้งเตือน</h1>
        <div className="flex gap-2">
          <button
            onClick={handleMarkAllRead}
            disabled={markAllBusy || busyRow !== null}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {markAllBusy ? 'กำลังทำเครื่องหมาย...' : 'อ่านทั้งหมด'}
          </button>
          {childLinks.includes('preferences') && (
            <Link
              href={`/companies/${companyId}/settings/notifications`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ตั้งค่า
            </Link>
          )}
          {childLinks.includes('rules') && (
            <Link
              href={`/companies/${companyId}/notifications/rules`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              กฎ
            </Link>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        {(['unread', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${filter === f ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {f === 'unread' ? 'ยังไม่ได้อ่าน' : 'ทั้งหมด'}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-400">กำลังโหลด...</p>}
      {error && <ErrorBanner message={error} />}

      {!loading && items.length === 0 && (
        <p className="text-sm text-gray-400">ไม่มีการแจ้งเตือน</p>
      )}

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
        {items.map((item) => (
          <div key={item.id} className={`flex items-start gap-3 p-3 ${item.read ? 'opacity-60' : ''}`}>
            <span className={`mt-0.5 rounded px-1.5 py-0.5 text-xs font-semibold ${severityColor(item.severity as NotificationSeverity)}`}>
              {severityLabel(item.severity as NotificationSeverity)}
            </span>
            <div
              className={`flex-1 min-w-0 ${internalHref(item) ? 'cursor-pointer' : ''}`}
              role={internalHref(item) ? 'link' : undefined}
              tabIndex={internalHref(item) ? 0 : undefined}
              onClick={() => void handleOpen(item)}
              onKeyDown={(event) => { if (event.key === 'Enter') void handleOpen(item); }}
            >
              <p className="text-sm font-medium text-gray-900 truncate">{item.title}</p>
              <p className="text-xs text-gray-500">{item.body}</p>
              <p className="text-xs text-gray-400 mt-0.5">{formatRelativeTime(item.createdAt)}</p>
            </div>
            <div className="flex gap-2 shrink-0">
              {!item.read && (
                <button disabled={markAllBusy || busyRow !== null} onClick={() => handleMarkRead(item.id)} className="text-xs text-brand-700 hover:underline disabled:opacity-40">
                  {busyRow?.id === item.id && busyRow.action === 'read' ? 'กำลังทำเครื่องหมาย...' : 'อ่านแล้ว'}
                </button>
              )}
              <button disabled={markAllBusy || busyRow !== null} onClick={() => handleDismiss(item.id)} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40">
                {busyRow?.id === item.id && busyRow.action === 'dismiss' ? 'กำลังปิด...' : 'ปิด'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Notification Preferences Page ----

export function NotificationPreferencesPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const toast = useToast();
  const canManage = permissions.includes('notification.preference.manage');
  const [pref, setPref] = useState<NotificationPreference | null>(null);
  const [loading, setLoading] = useState(canManage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    getPreferences(companyId)
      .then((res) => { setPref(res); setLoading(false); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : 'โหลดล้มเหลว'); setLoading(false); });
  }, [canManage, companyId]);

  async function save(next: NotificationPreference, successMessage?: string) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePreferences(companyId, next);
      setPref(updated);
      if (successMessage) toast.success(successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกล้มเหลว');
    } finally {
      setSaving(false);
    }
  }

  function toggleChannel(channel: 'web' | 'line') {
    if (!pref) return;
    const enabled = pref.enabledChannels.includes(channel);
    const enabledChannels = enabled ? pref.enabledChannels.filter((c) => c !== channel) : [...pref.enabledChannels, channel];
    void save({ ...pref, enabledChannels }, enabled ? 'ปิดช่องทาง LINE เรียบร้อยแล้ว' : 'เปิดช่องทาง LINE เรียบร้อยแล้ว');
  }

  function updateQuietHours(key: 'quietHoursStart' | 'quietHoursEnd', value: string) {
    if (!pref) return;
    setPref({ ...pref, [key]: value });
  }

  if (!canManage) return <ForbiddenState description="บัญชีของคุณไม่มีสิทธิ์ตั้งค่าการแจ้งเตือน" />;
  if (loading) return <p className="text-sm text-gray-400">กำลังโหลด...</p>;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">ตั้งค่าการแจ้งเตือน</h1>
        <Link href={`/companies/${companyId}/notifications`} className="text-sm text-brand-700 hover:underline">กลับ</Link>
      </div>
      {error && <ErrorBanner message={error} />}
      {pref && (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
          <div>
            <p className="text-sm font-medium text-gray-800">ช่องทาง</p>
            <div className="mt-2 flex gap-2">
              {(['web', 'line'] as const).map((channel) => (
                <button
                  key={channel}
                  disabled={saving || channel === 'web'}
                  onClick={() => toggleChannel(channel)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${pref.enabledChannels.includes(channel) ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'} disabled:opacity-60`}
                >
                  {channel === 'web' ? 'Web' : 'LINE'}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">
              เริ่มเวลาเงียบ
              <input
                value={pref.quietHoursStart ?? ''}
                disabled={saving}
                onChange={(event) => updateQuietHours('quietHoursStart', event.target.value)}
                onBlur={() => save(pref)}
                placeholder="22:00"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-sm font-medium text-gray-700">
              สิ้นสุดเวลาเงียบ
              <input
                value={pref.quietHoursEnd ?? ''}
                disabled={saving}
                onChange={(event) => updateQuietHours('quietHoursEnd', event.target.value)}
                onBlur={() => save(pref)}
                placeholder="07:00"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-gray-400">Web ยังบันทึกทุกแจ้งเตือนเสมอ ส่วน LINE ถูกกดตาม preference และ quiet hours</p>
        </div>
      )}
    </div>
  );
}

// ---- Notification Rules Page ----

export function NotificationRulesPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const toast = useToast();
  const canManage = permissions.includes('notification.rule.manage');
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [loading, setLoading] = useState(canManage);
  const [error, setError] = useState<string | null>(null);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    listRules(companyId)
      .then((res) => { setRules(res.items); setLoading(false); })
      .catch((err: unknown) => { setError(err instanceof Error ? err.message : 'โหลดล้มเหลว'); setLoading(false); });
  }, [canManage, companyId]);

  async function toggleRule(rule: NotificationRule) {
    if (busyRuleId) return;
    setBusyRuleId(rule.id);
    const newStatus = rule.status === 'enabled' ? 'disabled' : 'enabled';
    try {
      await updateRule(companyId, rule.id, { status: newStatus });
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, status: newStatus } : r));
      toast.success(newStatus === 'enabled' ? 'เปิดใช้งานกฎการแจ้งเตือนเรียบร้อยแล้ว' : 'ปิดใช้งานกฎการแจ้งเตือนเรียบร้อยแล้ว');
    } catch {
      // A silent revert read as "the switch is broken"; failing loudly names the action that failed.
      toast.error(newStatus === 'enabled' ? 'เปิดใช้งานกฎการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่' : 'ปิดใช้งานกฎการแจ้งเตือนไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setBusyRuleId(null);
    }
  }

  if (!canManage) return <ForbiddenState description="บัญชีของคุณไม่มีสิทธิ์จัดการกฎการแจ้งเตือน" />;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-gray-900">กฎการแจ้งเตือน</h1>
      {loading && <p className="text-sm text-gray-400">กำลังโหลด...</p>}
      {error && <ErrorBanner message={error} />}
      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
        {rules.map((rule) => (
          <div key={rule.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{rule.label}</p>
              {rule.description && <p className="text-xs text-gray-500">{rule.description}</p>}
              <p className="text-xs text-gray-400">ช่องทาง: {rule.channels.join(', ')} · คูลดาวน์ {rule.cooldownMinutes} นาที</p>
            </div>
            {rule.status !== 'system' && (
              <button
                onClick={() => toggleRule(rule)}
                disabled={busyRuleId !== null}
                className={`rounded-full px-3 py-1 text-xs font-medium disabled:opacity-40 ${rule.status === 'enabled' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
              >
                {busyRuleId === rule.id ? (rule.status === 'enabled' ? 'กำลังปิด...' : 'กำลังเปิด...') : rule.status === 'enabled' ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
