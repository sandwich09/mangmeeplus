'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { ForbiddenState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import {
  listNotifications,
  markRead,
  markAllRead,
  dismissNotification,
  listRules,
  updateRule,
  getPreferences,
  updatePreferences,
  NOTIFICATIONS_CHANGED_EVENT,
} from './dashboard-notifications.api';
import {
  formatRelativeTime,
  internalNotificationHref,
  visibleNotifications,
  isUnreadNotification,
  notificationBodyText,
  notificationTag,
  notificationRuleChannelsText,
  notificationRuleDetailText,
} from './dashboard-notifications.logic';
import type { NotificationItem, NotificationRule, NotificationPreference } from './dashboard-notifications.model';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';

function ErrorBanner({ message }: { message: string }) {
  return <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{message}</div>;
}

// ---- Notification Center Page ----

/**
 * One 44px control instead of two 16px text links 8px apart, one of which dismissed the
 * notification. It also reclaims ~40px of row width and stops the row reflowing when a busy
 * label ("กำลังทำเครื่องหมาย...") replaced a short one mid-tap.
 */
function NotificationRowMenu({ read, busy, busyLabel, onMarkRead, onDismiss }: {
  read: boolean;
  busy: boolean;
  busyLabel: string | null;
  onMarkRead: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(ref, () => setOpen(false));

  return (
    <div ref={ref} className="relative z-10 shrink-0">
      <button
        type="button"
        aria-label="ตัวเลือกการแจ้งเตือน"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40 sm:h-9 sm:w-9"
      >
        {busyLabel ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : '⋮'}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 min-w-40 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
          {!read && (
            <button
              type="button"
              onClick={() => { setOpen(false); onMarkRead(); }}
              className="flex min-h-11 w-full items-center px-4 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              อ่านแล้ว
            </button>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); onDismiss(); }}
            className="flex min-h-11 w-full items-center px-4 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ปิด
          </button>
        </div>
      )}
    </div>
  );
}

export function NotificationCenterPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const toast = useToast();
  const router = useRouter();
  const canRead = canSeeRoute('/notifications', permissions);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(canRead);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [busyRow, setBusyRow] = useState<{ id: string; action: 'read' | 'dismiss' } | null>(null);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const visibleItems = visibleNotifications(items, filter);

  function reload() {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    listNotifications(companyId, { read: filter === 'unread' ? false : undefined, pageSize: 50 })
      .then((res) => { setItems(res.items); setLoading(false); })
      .catch((err: unknown) => { setError(apiErrorMessage(err)); setLoading(false); });
  }

  useEffect(() => {
    reload();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, reload);
  }, [canRead, companyId, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleMarkRead(id: string) {
    if (busyRow || markAllBusy) return;
    setBusyRow({ id, action: 'read' });
    setError(null);
    try {
      await markRead(companyId, id);
      setItems((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusyRow(null);
    }
  }

  async function handleDismiss(id: string) {
    if (busyRow || markAllBusy) return;
    setBusyRow({ id, action: 'dismiss' });
    setError(null);
    try {
      await dismissNotification(companyId, id);
      setItems((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setBusyRow(null);
    }
  }

  async function handleMarkAllRead() {
    if (busyRow || markAllBusy) return;
    setMarkAllBusy(true);
    setError(null);
    try {
      await markAllRead(companyId);
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      toast.success('ทำเครื่องหมายว่าอ่านทั้งหมดเรียบร้อยแล้ว');
    } catch (err) {
      setError(apiErrorMessage(err));
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
    if (isUnreadNotification(item)) await handleMarkRead(item.id);
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
            disabled={loading || markAllBusy || busyRow !== null || !items.some(isUnreadNotification)} aria-busy={Boolean(markAllBusy)}
            className="inline-flex min-h-11 items-center rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-0"
          >
            {markAllBusy ? 'กำลังทำเครื่องหมาย...' : 'อ่านทั้งหมด'}
          </button>
        </div>
      </div>

      {/* A scroll strip rather than a wrapping row: chips that wrap strand the last one on a
          line of its own at 390px. Same recipe the 2026-08-05 follow-up used for tab bars. */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {(['unread', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-3 py-1 text-sm font-medium sm:min-h-0 ${filter === f ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
          >
            {f === 'unread' ? 'ยังไม่ได้อ่าน' : 'ทั้งหมด'}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-gray-400">กำลังโหลด...</p>}
      {error && <ErrorBanner message={error} />}

      {!loading && visibleItems.length === 0 && (
        <p className="text-sm text-gray-400">ไม่มีการแจ้งเตือน</p>
      )}

      <div className="rounded-lg border border-gray-200 bg-white overflow-hidden divide-y divide-gray-100">
        {visibleItems.map((item) => (
          <div key={item.id} className={`relative flex items-start gap-3 p-3 ${isUnreadNotification(item) ? '' : 'opacity-60'}`}>
            {/* The whole row is the target, badge included. It used to be a <div role="link">
                covering only the middle column — about 180px of a 390px screen, and not a real
                link: no long-press, no open-in-new-tab, Enter only. The overlay link is a
                sibling of the menu button rather than its parent, because a <button> inside an
                <a> is invalid and Safari treats it unpredictably. */}
            {internalHref(item) && (
              <Link
                href={internalHref(item)!}
                onClick={() => { if (isUnreadNotification(item)) void handleMarkRead(item.id); }}
                className="absolute inset-0 z-0"
                aria-label={item.title}
              />
            )}
            <span className={`pointer-events-none relative mt-0.5 rounded px-1.5 py-0.5 text-xs font-semibold ${notificationTag(item).tone}`}>
              {notificationTag(item).label}
            </span>
            <div className="pointer-events-none relative min-w-0 flex-1">
              <p className="break-words text-sm font-medium text-gray-900">{item.title}</p>
              {notificationBodyText(item) && <p className="text-xs text-gray-500">{notificationBodyText(item)}</p>}
              <p className="text-xs text-gray-400 mt-0.5">{formatRelativeTime(item.createdAt)}</p>
            </div>
            <NotificationRowMenu
              read={!isUnreadNotification(item)}
              busy={markAllBusy || busyRow !== null}
              busyLabel={busyRow?.id === item.id ? (busyRow.action === 'read' ? 'กำลังทำเครื่องหมาย...' : 'กำลังปิด...') : null}
              onMarkRead={() => handleMarkRead(item.id)}
              onDismiss={() => handleDismiss(item.id)}
            />
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
      .catch((err: unknown) => { setError(apiErrorMessage(err)); setLoading(false); });
  }, [canManage, companyId]);

  async function save(next: NotificationPreference, successMessage?: string) {
    setSaving(true);
    setError(null);
    try {
      const updated = await updatePreferences(companyId, next);
      setPref(updated);
      if (successMessage) toast.success(successMessage);
    } catch (err) {
      setError(apiErrorMessage(err));
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
        <Link href={`/companies/${companyId}/notifications`} className="inline-flex min-h-11 min-w-11 items-center justify-center text-sm text-brand-700 hover:underline sm:min-h-0 sm:min-w-0">กลับ</Link>
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
                  disabled={saving || channel === 'web'} aria-busy={Boolean(saving)}
                  onClick={() => toggleChannel(channel)}
                  className={`inline-flex min-h-11 items-center rounded-md px-3 py-1.5 text-sm font-medium sm:min-h-0 ${pref.enabledChannels.includes(channel) ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'} disabled:opacity-60`}
                >
                  {notificationRuleChannelsText([channel])}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-gray-700">
              เริ่มเวลาเงียบ
              <input
                type="time"
                value={pref.quietHoursStart ?? ''}
                disabled={saving}
                onChange={(event) => updateQuietHours('quietHoursStart', event.target.value)}
                onBlur={() => save(pref)}
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:min-h-0"
              />
            </label>
            <label className="text-sm font-medium text-gray-700">
              สิ้นสุดเวลาเงียบ
              <input
                type="time"
                value={pref.quietHoursEnd ?? ''}
                disabled={saving}
                onChange={(event) => updateQuietHours('quietHoursEnd', event.target.value)}
                onBlur={() => save(pref)}
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm sm:min-h-0"
              />
            </label>
          </div>
          <p className="text-xs text-gray-400">หน้าเว็บบันทึกทุกการแจ้งเตือนเสมอ ส่วน LINE จะส่งตามการตั้งค่าและช่วงเวลางดแจ้งเตือน</p>
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
      .catch((err: unknown) => { setError(apiErrorMessage(err)); setLoading(false); });
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
              <p className="text-xs text-gray-400">{notificationRuleDetailText(rule)}</p>
            </div>
            {rule.status !== 'system' && (
              <button
                onClick={() => toggleRule(rule)}
                disabled={busyRuleId !== null} aria-busy={Boolean(busyRuleId === rule.id)}
                className={`inline-flex min-h-11 items-center rounded-full px-3 py-1 text-xs font-medium disabled:opacity-40 sm:min-h-0 ${rule.status === 'enabled' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}
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
