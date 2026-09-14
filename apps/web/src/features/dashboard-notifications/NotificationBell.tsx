'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import { useToast } from '@/common/components/toast';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { DesignIcons } from '@/features/web-core-workspace/design-icons';
import { getUnreadCount, listNotifications, markAllRead, markRead, NOTIFICATIONS_CHANGED_EVENT } from './dashboard-notifications.api';
import type { NotificationItem } from './dashboard-notifications.model';
import { formatRelativeTime, notificationBadgeText, severityColor, severityLabel, internalNotificationHref } from './dashboard-notifications.logic';

const POLL_MS = 60_000;

export function NotificationBell({ companyId, locale }: { companyId: string; locale: SupportedLocale }) {
  const toast = useToast();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
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

  const loadItems = useCallback(() => {
    setLoading(true);
    setError(false);
    listNotifications(companyId, { pageSize: 8 })
      .then((result) => setItems(result.items))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [companyId]);

  const togglePanel = () => {
    setOpen((wasOpen) => {
      if (!wasOpen) loadItems();
      return !wasOpen;
    });
  };

  const handleItemClick = (item: NotificationItem) => {
    setOpen(false);
    if (item.read) return;
    void markRead(companyId, item.id)
      .then(() => setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry))))
      .catch((err: unknown) => toast.error(err));
  };

  const handleMarkAllRead = async () => {
    if (markAllBusy) return;
    setMarkAllBusy(true);
    try {
      await markAllRead(companyId);
      setItems((current) => current.map((entry) => ({ ...entry, read: true })));
      setUnread(0);
      toast.success('ทำเครื่องหมายว่าอ่านทั้งหมดเรียบร้อยแล้ว');
    } catch (err) {
      toast.error(err);
    } finally {
      setMarkAllBusy(false);
    }
  };

  const badge = notificationBadgeText(unread);
  const inboxHref = `/companies/${companyId}/notifications`;

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
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-[calc(var(--app-header-h)+8px)] z-50 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[var(--shadow-theme-md)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-[min(360px,calc(100vw-2rem))]">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-bold text-gray-900">{t('shell.notifications', locale)}</span>
            <button type="button" className="text-xs font-semibold text-brand-700 hover:underline disabled:opacity-40" onClick={handleMarkAllRead} disabled={unread === 0 || markAllBusy || loading || error} aria-busy={Boolean(markAllBusy || loading)}>
              อ่านทั้งหมดแล้ว
            </button>
          </div>
          <div className="max-h-[min(380px,60dvh)] overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">กำลังโหลด...</p>
            ) : error ? (
              <div className="px-4 py-6 text-center text-sm text-red-700">โหลดการแจ้งเตือนไม่สำเร็จ <button type="button" className="underline" onClick={loadItems}>ลองใหม่</button></div>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-500">ยังไม่มีการแจ้งเตือน</p>
            ) : (
              items.map((item) => {
                const body = (
                  <>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${severityColor(item.severity)}`}>{item.status === 'resolved' ? 'ดำเนินการแล้ว' : severityLabel(item.severity)}</span>
                      <span className="text-[11px] text-gray-400">{formatRelativeTime(item.createdAt)}</span>
                      {!item.read && <span aria-hidden className="ml-auto h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                    </div>
                    <div className={`mt-1 truncate text-sm ${item.read ? 'font-medium text-gray-600' : 'font-bold text-gray-900'}`}>{item.title}</div>
                    {item.body && <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{item.body}</div>}
                  </>
                );
                const rowClass = `block w-full border-b border-gray-50 px-4 py-3 text-left hover:bg-brand-25 ${item.read ? '' : 'bg-brand-25/50'}`;
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
              })
            )}
          </div>
          <Link href={inboxHref} className="block border-t border-gray-100 px-4 py-3 text-center text-sm font-bold text-brand-700 hover:bg-brand-25" onClick={() => setOpen(false)}>
            ดูการแจ้งเตือนทั้งหมด
          </Link>
        </div>
      )}
    </div>
  );
}
