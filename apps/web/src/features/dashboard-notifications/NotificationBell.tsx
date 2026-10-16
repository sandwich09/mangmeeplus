'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { quietButtonClass, secondaryButtonClass } from '@/common/components/button/button-classes';
import { FilterTabs } from '@/common/components/tabs';
import { Notice } from '@/common/components/notice';
import { useToast } from '@/common/components/toast';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { getUnreadCount, listNotifications, markAllRead, markRead, NOTIFICATIONS_CHANGED_EVENT } from './dashboard-notifications.api';
import type { NotificationItem } from './dashboard-notifications.model';
import { formatRelativeTime, notificationBadgeText, notificationTag, internalNotificationHref, isUnreadNotification, notificationBodyText } from './dashboard-notifications.logic';

const POLL_MS = 60_000;
const BELL_ROWS = 8;
const NO_ITEMS: { waiting: NotificationItem[]; earlier: NotificationItem[] } = { waiting: [], earlier: [] };

export function NotificationBell({ companyId, locale }: { companyId: string; locale: SupportedLocale }) {
  const toast = useToast();
  const [filter, setFilter] = useState<'waiting' | 'unread' | 'all'>('unread');
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(NO_ITEMS);
  const [loading, setLoading] = useState(false);
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useCloseOnOutsideClick(ref, useCallback(() => setOpen(false), []));

  const refreshCount = useCallback(() => {
    getUnreadCount(companyId).then((count) => setUnread(count.total)).catch(() => undefined);
  }, [companyId]);

  useEffect(() => {
    refreshCount();
    const timer = window.setInterval(refreshCount, POLL_MS);
    window.addEventListener('focus', refreshCount);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshCount);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshCount);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshCount);
    };
  }, [refreshCount]);

  // Each tab is filtered by the server before paging, including already-read waiting work.
  const loadRevision = useRef(0);
  const loadItems = useCallback(() => {
    const revision = ++loadRevision.current;
    setLoading(true);
    setError(false);
    listNotifications(companyId, { waiting: filter === 'waiting' ? true : undefined, read: filter === 'unread' ? false : undefined, pageSize: BELL_ROWS })
      .then(result => { if (revision === loadRevision.current) setItems({ waiting: result.items, earlier: [] }); })
      .catch(() => { if (revision === loadRevision.current) setError(true); })
      .finally(() => { if (revision === loadRevision.current) setLoading(false); });
  }, [companyId, filter]);
  useEffect(() => { if (open) loadItems(); return () => { loadRevision.current++; }; }, [open, loadItems]);

  const togglePanel = () => {
    setOpen(wasOpen => !wasOpen);
  };

  const markItemsRead = (isTarget: (entry: NotificationItem) => boolean) => setItems((current) => ({
    waiting: current.waiting.map((entry) => (isTarget(entry) ? { ...entry, read: true } : entry)),
    earlier: current.earlier.map((entry) => (isTarget(entry) ? { ...entry, read: true } : entry)),
  }));

  const handleItemClick = (item: NotificationItem) => {
    setOpen(false);
    if (!isUnreadNotification(item)) return;
    void markRead(companyId, item.id)
      .then(() => markItemsRead((entry) => entry.id === item.id))
      .catch((err: unknown) => toast.error(err));
  };

  const handleMarkAllRead = async () => {
    if (markAllBusy) return;
    setMarkAllBusy(true);
    try {
      await markAllRead(companyId);
      setItems((current) => ({ waiting: current.waiting.map((entry) => ({ ...entry, read: true })), earlier: current.earlier.map((entry) => ({ ...entry, read: true })) }));
      setUnread(0);
      loadItems();
    } catch (err) {
      toast.error(err);
    } finally {
      setMarkAllBusy(false);
    }
  };

  const badge = notificationBadgeText(unread);
  const inboxHref = `/companies/${companyId}/notifications`;

  const row = (item: NotificationItem) => {
    // `unread` here is this row's own state (the rule of `isUnreadNotification`), not the count in the badge.
    const unread = isUnreadNotification(item), sentence = notificationBodyText(item), tag = notificationTag(item);
    const body = (
      <>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tag.tone}`}>{tag.label}</span>
          <span className="text-xs text-gray-500">{formatRelativeTime(item.createdAt)}</span>
          {unread && <span aria-hidden className="ml-auto h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
        </div>
        <div className={`mt-1 line-clamp-2 text-sm ${unread ? 'font-bold text-gray-900' : 'font-medium text-gray-600'}`}>{item.title}</div>
        {sentence && <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{sentence}</div>}
      </>
    );
    const rowClass = `block w-full border-b border-gray-50 px-4 py-3 text-left hover:bg-brand-25 ${unread ? 'bg-brand-25/50' : ''}`;
    const href = internalNotificationHref(item.deepLinkHref);
    return href ? (
      <Link key={item.id} href={href} className={rowClass} onClick={() => handleItemClick(item)}>
        {body}
      </Link>
    ) : (
      <button key={item.id} type="button" className={rowClass} onClick={() => handleItemClick(item)}>
        {body}
      </button>
    );
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={togglePanel}
        aria-label={t('shell.notifications', locale)}
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 text-gray-600 hover:border-brand-200 hover:bg-brand-25 hover:text-brand-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        <DesignIcons.bell className="h-[18px] w-[18px]" />
        {badge && (
          <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold leading-none text-white">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-[calc(var(--app-header-h)+8px)] z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[var(--shadow-theme-md)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(360px,calc(100vw-2rem))]">
          <div className="flex min-h-12 items-center justify-between gap-2 border-b border-gray-100 py-1 pl-4 pr-2">
            <span className="text-sm font-bold text-gray-900">{t('shell.notifications', locale)}</span>
            {/* Shown only while something waits: a greyed "all read" under an empty list read as a statement, not a button. */}
            {unread > 0 && !loading && !error && (
              <button type="button" className={quietButtonClass} onClick={handleMarkAllRead} disabled={markAllBusy} aria-busy={Boolean(markAllBusy)}>
                ทำเป็นอ่านแล้วทั้งหมด
              </button>
            )}
          </div>
          <FilterTabs tabs={[{ key: 'waiting', label: 'ยังรออยู่' }, { key: 'unread', label: 'ยังไม่ได้อ่าน' }, { key: 'all', label: 'ทั้งหมด' }]} value={filter} aria-label="สถานะการแจ้งเตือน" onChange={key => setFilter(key as typeof filter)} />
          <div className="max-h-[min(380px,60dvh)] overflow-y-auto">
            {loading ? (
              <p role="status" className="px-4 py-6 text-center text-sm text-gray-500">กำลังโหลด…</p>
            ) : error ? (
              <div className="p-3">
                <Notice tone="error" action={<button type="button" className={secondaryButtonClass} onClick={loadItems} aria-busy={Boolean(loading)}>ลองอีกครั้ง</button>}>
                  โหลดการแจ้งเตือนไม่สำเร็จ
                </Notice>
              </div>
            ) : items.waiting.length + items.earlier.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">ยังไม่มีการแจ้งเตือน</p>
            ) : (
              <>
                {items.waiting.map(row)}
                {items.waiting.length > 0 && items.earlier.length > 0 && (
                  <p className="border-b border-gray-50 bg-gray-50 px-4 py-1.5 text-xs font-semibold text-gray-500">ก่อนหน้านี้</p>
                )}
                {items.earlier.map(row)}
              </>
            )}
          </div>
          <Link href={inboxHref} className="flex min-h-11 items-center justify-center border-t border-gray-100 px-4 py-2 text-sm font-bold text-brand-700 hover:bg-brand-25" onClick={() => setOpen(false)}>
            ดูทั้งหมด
          </Link>
        </div>
      )}
    </div>
  );
}
