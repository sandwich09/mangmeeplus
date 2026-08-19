'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DATA_RIGHTS_CASE_STATUSES,
  DATA_RIGHTS_CASE_TYPES,
  type DataRightsCaseStatus,
  type DataRightsCaseType,
} from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { listDataRightsCases, type DataRightsCaseSummary, type DataRightsDueFilter } from './data-rights.api';
import {
  CASE_TYPE_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  isOverdueCase,
  isLatestRequestEpoch,
} from './data-rights.logic';

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(date);
}

function targetLabel(item: DataRightsCaseSummary): string {
  if (item.caseType === 'USER_ACCOUNT_ERASURE') return `ผู้ใช้ ${item.targetUserId ?? '—'}`;
  if (item.caseType === 'MEMBERSHIP_EXIT') return `สมาชิก ${item.membershipId ?? '—'}`;
  return `กิจการ ${item.companyId ?? '—'}`;
}

function CaseSkeleton() {
  return (
    <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5">
      <div className="h-4 w-28 rounded bg-gray-100" />
      <div className="mt-4 h-6 w-2/3 rounded bg-gray-100" />
      <div className="mt-3 h-4 w-1/2 rounded bg-gray-100" />
    </div>
  );
}

export default function DataRightsListPage() {
  const [items, setItems] = useState<DataRightsCaseSummary[]>([]);
  const [status, setStatus] = useState<'' | DataRightsCaseStatus>('');
  const [caseType, setCaseType] = useState<'' | DataRightsCaseType>('');
  const [dueFilter, setDueFilter] = useState<DataRightsDueFilter>('ALL');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestEpochRef = useRef(0);

  const load = useCallback(async (cursor?: string) => {
    const requestEpoch = ++requestEpochRef.current;
    if (!cursor) {
      setItems([]);
      setNextCursor(null);
    }
    cursor ? setLoadingMore(true) : setLoading(true);
    setError(null);
    try {
      const result = await listDataRightsCases({
        status: status || undefined,
        caseType: caseType || undefined,
        cursor,
        pageSize: 100,
        dueFilter,
      });
      if (!isLatestRequestEpoch(requestEpoch, requestEpochRef.current)) return;
      setItems((current) => cursor ? [...current, ...result.items] : result.items);
      setNextCursor(result.nextCursor);
    } catch (caught) {
      if (!isLatestRequestEpoch(requestEpoch, requestEpochRef.current)) return;
      const apiError = caught as Error & { status?: number };
      setError(apiError.status === 403
        ? 'บัญชีนี้ไม่มีสิทธิ์จัดการคำขอสิทธิข้อมูล'
        : apiErrorMessage(caught));
    } finally {
      if (isLatestRequestEpoch(requestEpoch, requestEpochRef.current)) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [caseType, dueFilter, status]);

  useEffect(() => { void load(); }, [load]);

  const changeFilter = (change: () => void) => {
    requestEpochRef.current += 1;
    setItems([]);
    setNextCursor(null);
    setError(null);
    setLoading(true);
    setLoadingMore(false);
    change();
  };

  const counts = useMemo(() => ({
    loaded: items.length,
    overdue: items.filter((item) => isOverdueCase(item)).length,
    review: items.filter((item) => item.status === 'RETENTION_REVIEW').length,
    verify: items.filter((item) => item.status === 'VERIFICATION').length,
  }), [items]);

  return (
    <main className="min-h-dvh bg-[#f6f8f7] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="overflow-hidden rounded-3xl border border-emerald-100 bg-[radial-gradient(circle_at_top_right,_rgba(34,197,94,0.14),_transparent_38%),linear-gradient(135deg,#ffffff,#f4fff7)] px-5 py-6 shadow-sm sm:px-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="max-w-3xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1 text-xs font-semibold text-emerald-700">
                <span aria-hidden="true">⚖</span> ศูนย์ควบคุมสิทธิข้อมูล
              </span>
              <h1 className="mt-3 text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">คำขอสิทธิข้อมูลและการปิดพื้นที่ทำงาน</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
                ติดตามการยืนยันตัวตน ตัดสินใจเก็บรักษา และบังคับแยกผู้อนุมัติ ผู้ดำเนินการ กับผู้ตรวจอิสระในทุกประเภทเคส
              </p>
            </div>
            <Link href="/system/data-rights/new" className="mangmee-btn mangmee-btn-primary shrink-0">
              <span aria-hidden="true" className="text-lg">＋</span> เปิดเคสใหม่
            </Link>
          </div>
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm text-amber-900">
            <strong>ระบบนี้ไม่ลบข้อมูลอัตโนมัติ</strong> — ทุกเคสต้องใช้ System Admin อย่างน้อย 2 บัญชีเพื่อแยกหน้าที่ และการดำเนินการจริงต้องทำตาม runbook พร้อมหลักฐานตรวจอิสระ
          </div>
        </section>

        <section aria-label="สรุปรายการที่โหลด" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['รายการที่โหลด', counts.loaded, 'text-gray-900', 'bg-white'],
            ['เกินกำหนด', counts.overdue, 'text-red-700', 'bg-red-50'],
            ['รอตัดสินใจ 12 หมวด', counts.review, 'text-amber-800', 'bg-amber-50'],
            ['รอตรวจยืนยัน', counts.verify, 'text-indigo-700', 'bg-indigo-50'],
          ].map(([label, value, tone, surface]) => (
            <div key={String(label)} className={`rounded-2xl border border-gray-200 p-4 shadow-sm ${surface}`}>
              <p className="text-xs font-medium text-gray-500">{label}</p>
              <p className={`mt-1 text-2xl font-bold ${tone}`}>{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="space-y-1.5 text-sm font-medium text-gray-700">
              สถานะ
              <ThemedSelect value={status} onChange={(event) => {
                const next = event.target.value as '' | DataRightsCaseStatus;
                if (next !== status) changeFilter(() => setStatus(next));
              }}>
                <option value="">ทุกสถานะ</option>
                {DATA_RIGHTS_CASE_STATUSES.map((value) => <option key={value} value={value}>{STATUS_LABEL[value]}</option>)}
              </ThemedSelect>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-gray-700">
              ประเภทคำขอ
              <ThemedSelect value={caseType} onChange={(event) => {
                const next = event.target.value as '' | DataRightsCaseType;
                if (next !== caseType) changeFilter(() => setCaseType(next));
              }}>
                <option value="">ทุกประเภท</option>
                {DATA_RIGHTS_CASE_TYPES.map((value) => <option key={value} value={value}>{CASE_TYPE_LABEL[value]}</option>)}
              </ThemedSelect>
            </label>
            <label className="space-y-1.5 text-sm font-medium text-gray-700">
              กำหนดเวลา
              <ThemedSelect value={dueFilter} onChange={(event) => {
                const next = event.target.value as DataRightsDueFilter;
                if (next !== dueFilter) changeFilter(() => setDueFilter(next));
              }}>
                <option value="ALL">ทั้งหมด</option>
                <option value="OVERDUE">เกินกำหนด</option>
                <option value="OPEN">ยังไม่ยุติเรื่อง (รวม BLOCKED)</option>
                <option value="RESOLVED">ยุติเรื่องแล้ว</option>
              </ThemedSelect>
            </label>
          </div>
          <p className="mt-3 text-xs text-gray-500">แสดง {items.length} รายการจากตัวกรองฝั่งระบบ</p>
        </section>

        {error && (
          <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
            <button type="button" className="ml-3 font-semibold underline" onClick={() => void load()}>ลองใหม่</button>
          </div>
        )}

        {!error && (
          <section aria-live="polite" className="space-y-3">
            {loading ? (
              <div className="grid gap-3 lg:grid-cols-2"><CaseSkeleton /><CaseSkeleton /><CaseSkeleton /><CaseSkeleton /></div>
            ) : items.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-gray-300 bg-white px-6 py-14 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-xl" aria-hidden="true">⌕</div>
                <h2 className="mt-4 font-semibold text-gray-900">ไม่พบเคสตามตัวกรอง</h2>
                <p className="mt-1 text-sm text-gray-500">ลองเปลี่ยนสถานะ ประเภทคำขอ หรือกำหนดเวลา</p>
              </div>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {items.map((item) => {
                  const overdue = isOverdueCase(item);
                  return (
                    <Link
                      key={item.id}
                      href={`/system/data-rights/${encodeURIComponent(item.id)}`}
                      className="group rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[item.status]}`}>{STATUS_LABEL[item.status]}</span>
                        <span className={`text-xs font-semibold ${overdue ? 'text-red-600' : 'text-gray-500'}`}>
                          {overdue ? 'เกินกำหนด · ' : 'ครบกำหนด · '}{formatDateTime(item.dueAt)}
                        </span>
                      </div>
                      <h2 className="mt-4 text-lg font-semibold text-gray-950 group-hover:text-emerald-800">{CASE_TYPE_LABEL[item.caseType]}</h2>
                      <p className="mt-1 break-all font-mono text-sm text-gray-600">{targetLabel(item)}</p>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
                        <span>{SOURCE_LABEL[item.requestSource]} · รับ {formatDateTime(item.receivedAt)}</span>
                        <span className="font-mono">{item.requestKey}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            {nextCursor && !loading && (
              <div className="text-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void load(nextCursor)}
                  className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  {loadingMore ? 'กำลังโหลด…' : 'โหลดรายการเพิ่มเติม'}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
