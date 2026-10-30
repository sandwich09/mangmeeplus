'use client';

import { useEffect, useRef, useState } from 'react';
import type { ExpenseHistoryResult } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { Modal } from '@/common/components/modal';
import { secondaryButtonClass, quietButtonClass } from '@/common/components/button/button-classes';
import { getExpenseHistory } from './expenses.api';
import { expenseHistoryActionLabel, expenseHistoryActorLabel } from './expense-history.logic';

type HistoryEntry = ExpenseHistoryResult['data'][number];

export function ExpenseHistoryModal({ companyId, expenseId, expenseNumber, onClose }: {
  companyId: string; expenseId: string; expenseNumber: string; onClose: () => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [creatorDisplayName, setCreatorDisplayName] = useState<string | null | undefined>(undefined);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<'permission' | 'load' | null>(null);
  const requestRef = useRef(0);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const requestId = ++requestRef.current;
    let active = true;
    setEntries([]); setCreatorDisplayName(undefined); setPage(0); setHasMore(false); setError(null); setLoading(true); setLoadingMore(false);
    void getExpenseHistory(companyId, expenseId).then((result) => {
      if (!active || requestRef.current !== requestId) return;
      setCreatorDisplayName(result.creatorDisplayName);
      setEntries(result.data); setPage(result.page);
      setHasMore(result.data.length > 0 && result.page * result.pageSize < result.total);
    }).catch((reason: { status?: number }) => {
      if (!active || requestRef.current !== requestId) return;
      setError(reason?.status === 403 ? 'permission' : 'load');
    }).finally(() => {
      if (active && requestRef.current === requestId) setLoading(false);
    });
    return () => { active = false; requestRef.current += 1; };
  }, [companyId, expenseId, retry]);

  useEffect(() => {
    // Retry/load-more controls can disappear after a response. Keep keyboard focus in the dialog.
    if (document.activeElement === document.body) closeButtonRef.current?.focus();
  }, [hasMore, loading, loadingMore, page, error]);

  const loadMore = async () => {
    if (loadingMore || loading || !hasMore) return;
    const requestId = ++requestRef.current;
    setLoadingMore(true); setError(null);
    try {
      const result = await getExpenseHistory(companyId, expenseId, page + 1);
      if (requestRef.current !== requestId) return;
      setEntries(current => {
        const ids = new Set(current.map(entry => entry.id));
        return [...current, ...result.data.filter(entry => !ids.has(entry.id))];
      });
      setPage(result.page);
      setHasMore(result.data.length > 0 && result.page * result.pageSize < result.total);
    } catch (reason) {
      if (requestRef.current === requestId) {
        const denied = (reason as { status?: number })?.status === 403;
        setError(denied ? 'permission' : 'load');
        if (denied) { setEntries([]); setCreatorDisplayName(undefined); setHasMore(false); }
      }
    } finally {
      if (requestRef.current === requestId) setLoadingMore(false);
    }
  };

  const denied = error === 'permission';
  const errorMessage = denied ? 'คุณไม่มีสิทธิ์ดูประวัติรายการนี้' : 'โหลดประวัติไม่สำเร็จ ลองอีกครั้ง';
  return (
    <Modal open title={<div><div>ประวัติรายการจ่าย <span className="ml-1 text-sm font-normal text-gray-500">{expenseNumber}</span></div>{creatorDisplayName !== undefined && <div className="mt-1 text-xs font-normal text-gray-500">สร้างโดย {creatorDisplayName || 'ไม่ทราบชื่อผู้สร้าง'}</div>}</div>} onClose={onClose} size="lg" bodyClassName="px-4 py-3 sm:px-6 sm:py-5" footer={<button ref={closeButtonRef} type="button" className={secondaryButtonClass} onClick={onClose}>ปิด</button>}>
      {loading ? <p role="status" className="py-8 text-center text-sm text-gray-500">กำลังโหลดประวัติ…</p> : error && entries.length === 0 ? (
        <div role="alert" className="py-8 text-center">
          <p className={denied ? 'text-sm text-warning-800' : 'text-sm text-error-700'}>{errorMessage}</p>
          {!denied && <button type="button" className={`${secondaryButtonClass} mt-3`} onClick={() => setRetry(value => value + 1)}>ลองอีกครั้ง</button>}
        </div>
      ) : entries.length === 0 ? <p className="py-8 text-center text-sm text-gray-500">ยังไม่มีประวัติรายการจ่าย</p> : (
        <>
          <ol aria-label="ลำดับกิจกรรมล่าสุดก่อน" className="divide-y divide-gray-100">
            {entries.map(entry => <li key={entry.id} className="relative py-4 pl-5 first:pt-1 last:pb-1">
              <span aria-hidden="true" className="absolute left-0 top-6 h-2.5 w-2.5 rounded-full bg-brand-500" />
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <div className="font-semibold text-gray-900">{expenseHistoryActorLabel(entry.actorType, entry.actorDisplayName)} · {expenseHistoryActionLabel(entry.action)}</div>
                <time dateTime={entry.createdAt} className="text-xs text-gray-500">{formatThaiDateTime(entry.createdAt, 'ไม่ทราบเวลา')}</time>
              </div>
              {entry.result !== 'SUCCESS' && <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${entry.result === 'DENIED' ? 'bg-warning-50 text-warning-800' : 'bg-error-50 text-error-700'}`}>{entry.result === 'DENIED' ? 'ถูกปฏิเสธ' : 'ดำเนินการไม่สำเร็จ'}</span>}
            </li>)}
          </ol>
          {error && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-error-700"><span>{errorMessage}</span>{!denied && <button type="button" className={secondaryButtonClass} onClick={() => void loadMore()}>ลองโหลดอีกครั้ง</button>}</div>}
          {hasMore && !error && <button type="button" className={`${quietButtonClass} mt-4 w-full`} disabled={loadingMore} aria-busy={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'กำลังโหลด…' : 'โหลดเพิ่มเติม'}</button>}
        </>
      )}
    </Modal>
  );
}
