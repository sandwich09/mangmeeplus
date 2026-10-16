'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { secondaryButtonClass } from '@/common/components/button/button-classes';
import { MangmeePage } from '@/common/components/mangmee';
import { Notice } from '@/common/components/notice';
import { FilterTabs } from '@/common/components/tabs';
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
  return <Notice tone="error">{message}</Notice>;
}

/** A document number, an amount or a date inside a notice's sentence never splits across lines (thai-ux-standard §5.3). */
const UNIT_IN_TEXT = /([A-Z]{2,4}-\d{6}-\d{3,6}|฿[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)? บาท|\d{1,2} [ก-๙]{1,3}\.[ก-๙]{1,3}\.? \d{4})/;
function withUnits(text: string): ReactNode {
  return text.split(UNIT_IN_TEXT).map((part, index) => (index % 2 ? <span key={index} className="mangmee-unit">{part}</span> : part));
}

const CENTRE_TABS = [{ key: 'waiting', label: 'ยังรออยู่' }, { key: 'unread', label: 'ยังไม่ได้อ่าน' }, { key: 'all', label: 'ทั้งหมด' }] as const;

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
              ทำเป็นอ่านแล้ว
            </button>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); onDismiss(); }}
            className="flex min-h-11 w-full items-center px-4 text-left text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ลบการแจ้งเตือนนี้
          </button>
        </div>
      )}
    </div>
  );
}

export function NotificationCenterPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const canRead = canSeeRoute('/notifications', permissions);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(canRead);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'unread' | 'waiting'>('unread');
  const [busyRow, setBusyRow] = useState<{ id: string; action: 'read' | 'dismiss' } | null>(null);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const visibleItems = visibleNotifications(items, filter);
  // What still asks for something stays on top; finished notices wait under one closed line at the end.
  const openItems = visibleItems.filter((item) => item.status !== 'resolved');
  const finishedItems = visibleItems.filter((item) => item.status === 'resolved');

  // The chosen tab lives in the address, so coming back from a document returns to the same list.
  useEffect(() => {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'all' || tab === 'waiting') setFilter(tab);
  }, []);
  const chooseFilter = (next: 'all' | 'unread' | 'waiting') => {
    setFilter(next);
    window.history.replaceState(null, '', next !== 'unread' ? `?tab=${next}` : window.location.pathname);
  };

  // Each tab asks the server for its own list. Only the newest request may fill the page: an earlier
  // tab's slower answer used to land last and show unread notices under ทั้งหมด (seen 2026-10-13).
  const latestRequest = useRef(0);
  function reload() {
    if (!canRead) return;
    const request = ++latestRequest.current;
    setLoading(true);
    setError(null);
    listNotifications(companyId, { waiting: filter === 'waiting' ? true : undefined, read: filter === 'unread' ? false : undefined, pageSize: 50 })
      .then((res) => { if (request !== latestRequest.current) return; setItems(res.items); setLoading(false); })
      .catch((err: unknown) => { if (request !== latestRequest.current) return; setError(apiErrorMessage(err)); setLoading(false); });
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
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setMarkAllBusy(false);
    }
  }

  function internalHref(item: NotificationItem): string | undefined {
    return internalNotificationHref(item.deepLinkHref);
  }

  // One row: the tag and the time, then the title at the row's full width, then the sentence. The tag used to sit in a
  // column of its own and left the title half of a phone's width.
  const row = (item: NotificationItem) => {
    const unread = isUnreadNotification(item), href = internalHref(item), tag = notificationTag(item), sentence = notificationBodyText(item);
    return (
      <div key={item.id} className="relative flex items-start gap-2 p-3 sm:p-4">
        {/* The whole row is the target, badge included. It used to be a <div role="link">
            covering only the middle column — about 180px of a 390px screen, and not a real
            link: no long-press, no open-in-new-tab, Enter only. The overlay link is a
            sibling of the menu button rather than its parent, because a <button> inside an
            <a> is invalid and Safari treats it unpredictably. */}
        {href && (
          <Link
            href={href}
            onClick={() => { if (unread) void handleMarkRead(item.id); }}
            className="absolute inset-0 z-0"
            aria-label={item.title}
          />
        )}
        <div className="pointer-events-none relative min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${tag.tone}`}>{tag.label}</span>
            <span className="text-xs text-gray-500">{formatRelativeTime(item.createdAt)}</span>
            {unread && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
          </div>
          <p className={`mt-1 break-words text-sm ${unread ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>{withUnits(item.title)}</p>
          {sentence && <p className="mt-0.5 text-sm text-gray-600">{withUnits(sentence)}</p>}
        </div>
        <div className="relative z-10 flex shrink-0 flex-col items-center">
          <NotificationRowMenu
            read={!isUnreadNotification(item)}
            busy={markAllBusy || busyRow !== null}
            busyLabel={busyRow?.id === item.id ? (busyRow.action === 'read' ? 'กำลังทำเครื่องหมาย...' : 'กำลังปิด...') : null}
            onMarkRead={() => handleMarkRead(item.id)}
            onDismiss={() => handleDismiss(item.id)}
          />
          {href && <span aria-hidden="true" className="pointer-events-none text-lg text-gray-400">›</span>}
        </div>
      </div>
    );
  };

  if (!canRead) return <ForbiddenState />;

  return (
    <MangmeePage
      title="การแจ้งเตือน"
      // Only while something is unread: a greyed button on an empty page says nothing.
      actions={items.some(isUnreadNotification) && (
        <button
          type="button"
          onClick={handleMarkAllRead}
          disabled={loading || markAllBusy || busyRow !== null} aria-busy={Boolean(markAllBusy)}
          className={secondaryButtonClass}
        >
          ทำเป็นอ่านแล้วทั้งหมด
        </button>
      )}
    >
      <FilterTabs aria-label="การแจ้งเตือนที่แสดง" value={filter} onChange={chooseFilter} tabs={CENTRE_TABS} />

      {loading && <p role="status" className="text-sm text-gray-500">กำลังโหลด…</p>}
      {/* A failed read is never shown with the "nothing here" sentence, and it carries its own retry. */}
      {error && (
        <Notice tone="error" action={<button type="button" className={secondaryButtonClass} onClick={reload} aria-busy={Boolean(loading)}>ลองอีกครั้ง</button>}>
          {error}
        </Notice>
      )}

      {!loading && !error && visibleItems.length === 0 && (
        <p className="text-sm text-gray-500">{filter === 'unread' ? 'ไม่มีการแจ้งเตือนที่ยังไม่ได้อ่าน' : 'ยังไม่มีการแจ้งเตือน'}</p>
      )}

      {openItems.length > 0 && (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">{openItems.map(row)}</div>
      )}
      {finishedItems.length > 0 && (
        <details className="group rounded-lg border border-gray-200 bg-white">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-semibold text-gray-700 sm:px-4 [&::-webkit-details-marker]:hidden">
            <span>เสร็จแล้ว ({finishedItems.length.toLocaleString('th-TH')})</span>
            <span aria-hidden="true" className="text-gray-400 transition group-open:rotate-90">›</span>
          </summary>
          <div className="divide-y divide-gray-100 border-t border-gray-100">{finishedItems.map(row)}</div>
        </details>
      )}
    </MangmeePage>
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
    void save({ ...pref, enabledChannels }, enabled ? 'ปิดช่องทาง LINE แล้ว' : 'เปิดช่องทาง LINE แล้ว');
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
      toast.success(newStatus === 'enabled' ? 'เปิดใช้งานกฎการแจ้งเตือนแล้ว' : 'ปิดใช้งานกฎการแจ้งเตือนแล้ว');
    } catch {
      // A silent revert read as "the switch is broken"; failing loudly names the action that failed.
      toast.error(newStatus === 'enabled' ? 'เปิดใช้งานกฎการแจ้งเตือนไม่สำเร็จ ลองอีกครั้ง' : 'ปิดใช้งานกฎการแจ้งเตือนไม่สำเร็จ ลองอีกครั้ง');
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
