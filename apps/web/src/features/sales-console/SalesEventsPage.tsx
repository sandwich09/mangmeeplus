'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SalesEventBatchView } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { listSalesEventBatches } from './sales.api';
import { batchStatusMeta } from './sales-events.logic';
import SalesEventBatchForm from './SalesEventBatchForm';
import { SalesEmpty, SalesNotice } from './SalesConsoleParts';

/** One row: what a lead scans for (status, closing time, how many went out and how they were used). */
function BatchRow({ batch, canManage, now }: { batch: SalesEventBatchView; canManage: boolean; now: Date }) {
  const status = batchStatusMeta(batch, now);
  const left = Math.max(0, batch.issueCap - batch.issuedCount);
  return (
    <Link href={`/sales/events/${encodeURIComponent(batch.id)}`} className="flex min-h-12 items-start justify-between gap-3 border-t border-gray-100 px-4 py-3 first:border-t-0 hover:bg-gray-50">
      <span className="min-w-0">
        <span className="block break-words text-[15px] font-bold text-gray-900">{batch.eventName}</span>
        <span className="block break-words text-sm text-gray-700">{batch.batchName}</span>
        <span className="mt-0.5 block text-xs text-gray-500">ปิดรับ {formatThaiDateTime(batch.claimEndsAt)}</span>
        <span className="mt-0.5 block text-xs text-gray-500">
          {canManage
            ? `แจกแล้ว ${batch.issuedCount.toLocaleString('th-TH')} · ใช้เป็นส่วนลด ${batch.counts.usedAsDiscount.toLocaleString('th-TH')} · ใช้เป็นเครดิต ${batch.counts.usedAsCredit.toLocaleString('th-TH')} · เหลือแจกได้ ${left.toLocaleString('th-TH')}`
            : `คุณแจกแล้ว ${batch.counts.issued.toLocaleString('th-TH')} · ทั้งชุดเหลือแจกได้ ${left.toLocaleString('th-TH')}`}
        </span>
      </span>
      <MangmeeBadge tone={status.tone} className="shrink-0">{status.label}</MangmeeBadge>
    </Link>
  );
}

export default function SalesEventsPage({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [batches, setBatches] = useState<SalesEventBatchView[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const now = new Date();

  const loadFirst = useCallback((signal?: AbortSignal) => {
    setError(null);
    return listSalesEventBatches(null, { signal })
      .then((result) => { if (!signal?.aborted) { setBatches(result.items); setNextCursor(result.nextCursor); } })
      .catch((cause) => { if (!signal?.aborted) { setBatches([]); setError(apiErrorMessage(cause)); } });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadFirst(controller.signal);
    return () => controller.abort();
  }, [loadFirst]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await listSalesEventBatches(nextCursor);
      setBatches((previous) => [...(previous ?? []), ...result.items]);
      setNextCursor(result.nextCursor);
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <MangmeePage
      eyebrow="ทีมขายมั่งมี"
      title="ส่วนลดจากงาน"
      description={canManage
        ? 'ตั้งชุดส่วนลดสำหรับงานขาย มอบหมายเซลล์ผู้แจก แล้วให้ลูกค้าสแกน QR รับผ่าน LINE'
        : 'ชุดส่วนลดที่คุณได้รับมอบหมายให้แจก เปิดชุดเพื่อแสดง QR ให้ลูกค้าสแกน'}
      actions={canManage && !creating
        ? <button type="button" className="mangmee-btn mangmee-btn-primary" onClick={() => setCreating(true)}>สร้างชุดส่วนลด</button>
        : undefined}
    >
      {creating && (
        <SalesEventBatchForm onCancel={() => setCreating(false)}
          onSaved={(batch) => router.push(`/sales/events/${encodeURIComponent(batch.id)}`)} />
      )}
      {error && <SalesNotice tone="error">{error}</SalesNotice>}
      {batches === null ? <LoadingState label="กำลังโหลดชุดส่วนลด…" />
        : batches.length === 0
          ? <SalesEmpty>{canManage ? 'ยังไม่มีชุดส่วนลด กด "สร้างชุดส่วนลด" เพื่อเริ่มแจกในงานถัดไป' : 'ยังไม่มีชุดส่วนลดที่คุณได้รับมอบหมายให้แจก'}</SalesEmpty>
          : <MangmeeCard>{batches.map((batch) => <BatchRow key={batch.id} batch={batch} canManage={canManage} now={now} />)}</MangmeeCard>}
      {nextCursor && (
        <button type="button" className="mangmee-btn mangmee-btn-secondary w-full" disabled={loadingMore} aria-busy={loadingMore}
          onClick={() => void loadMore()}>โหลดชุดส่วนลดเพิ่ม</button>
      )}
    </MangmeePage>
  );
}
