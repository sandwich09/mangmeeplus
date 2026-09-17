'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';
import type { BillingOperatorIssue } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { billingControl, billingIssueLabel, billingLabel } from '../billing/billing-display';

export default function BillingIssueDirectory({ items, loading, error, requestId, queue, cursor, nextCursor, disabled, scoped, onFilter, onPage, onReload, issueHref, leaving }: {
  items: BillingOperatorIssue[]; loading: boolean; error: string; requestId: string | null;
  queue: string; cursor: string | null; nextCursor: string | null; disabled: boolean; scoped: boolean;
  onFilter: (value: string) => void; onPage: (cursor: string | null) => void; onReload: () => void;
  issueHref: (id: string) => string; leaving: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return <section aria-label="รายการปัญหาการชำระเงิน" aria-busy={loading} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-end gap-3">
          <div className="min-w-0 flex-1 sm:w-64 sm:flex-none">
            <label htmlFor="billing-issue-filter" className="mb-2 block text-sm font-medium text-gray-700">แสดงรายการ</label>
            <ThemedSelect id="billing-issue-filter" aria-label="แสดงรายการ" value={queue} disabled={loading || disabled} onChange={event => onFilter(event.target.value)} className="min-h-11 w-full !text-base">
              <option value="">ยังไม่เสร็จทั้งหมด</option><option value="UNASSIGNED">ยังไม่มีคนรับเรื่อง</option><option value="OVERDUE">เกินกำหนดติดตาม</option>
            </ThemedSelect>
          </div>
          <button type="button" onClick={() => onFilter('')} className={`${billingControl} shrink-0 whitespace-nowrap`}>ล้างตัวกรอง</button>
        </div>
        <button type="button" onClick={onReload} disabled={loading} aria-busy={Boolean(loading)} title="โหลดรายการที่มั่งมีบันทึกไว้ใหม่" className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-lg px-3 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4"><path d="M20 7v5h-5M4 17v-5h5" strokeLinecap="round" strokeLinejoin="round"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17" strokeLinecap="round"/></svg>
          โหลดรายการใหม่
        </button>
      </div>
      <div className="flex flex-wrap justify-between gap-2 text-sm text-gray-600">
        <p role="status">{loading ? 'กำลังโหลดรายการ…' : error ? 'ยังโหลดรายการไม่ได้' : disabled ? 'ยังไม่เปิดใช้การชำระเงิน' : `แสดง ${items.length} รายการในหน้านี้`}</p>
        {scoped && <p>เฉพาะบริษัทที่คุณมีสิทธิ์ดูแล</p>}
      </div>
    </div>
    {error ? <div role="alert" className="mx-4 mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 sm:mx-6">
      <p>{error}</p><button type="button" onClick={onReload} className="mt-2 min-h-11 underline">ลองอีกครั้ง</button>
      {cursor && <button type="button" onClick={() => onPage(null)} className="ml-4 min-h-11 underline">กลับหน้าแรก</button>}
      {requestId && <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2">ข้อมูลสำหรับตรวจสอบภายใน</summary><p className="break-all">เลขอ้างอิง: {requestId}</p></details>}
    </div> : loading ? <div aria-hidden="true" className="space-y-3 border-t border-gray-100 p-6">{[1, 2, 3].map(row => <div key={row} className="h-20 animate-pulse rounded bg-gray-100" />)}</div>
      : disabled || items.length === 0 ? <div className="flex min-h-60 flex-col items-center justify-center border-t border-gray-100 px-6 py-10 text-center">
        <p className="text-lg font-semibold text-gray-900">{disabled ? 'ยังไม่เปิดใช้การชำระเงินในระบบนี้' : cursor ? 'ไม่มีรายการในหน้านี้' : queue ? 'ไม่พบรายการตามตัวกรองนี้' : 'ไม่พบรายการที่รอดำเนินการ'}</p>
        <p className="mt-2 max-w-lg text-base text-gray-600">{disabled ? 'รายการจะแสดงเมื่อเปิดใช้การชำระเงินและระบบบันทึกปัญหาที่ต้องตรวจสอบ' : cursor ? 'รายการอาจเปลี่ยนสถานะแล้ว กลับหน้าแรกเพื่อดูรายการปัจจุบัน' : queue ? 'ล้างตัวกรองเพื่อดูปัญหาที่ยังไม่เสร็จทั้งหมด' : 'เมื่อระบบบันทึกปัญหาการชำระเงินหรือการเปิดสิทธิ์ จะแสดงไว้ที่นี่'}</p>
        {cursor && <button type="button" onClick={() => onPage(null)} className="mt-3 min-h-11 px-3 text-brand-800 underline">กลับหน้าแรก</button>}
      </div> : <div className="divide-y divide-gray-100 border-t border-gray-200">
        {items.map(item => {
          const followUp = item.effectiveFollowUpAt ?? item.followUpAt;
          return <article key={item.id} aria-label={billingIssueLabel(item.kind)} className="grid gap-4 p-4 sm:p-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1.25fr)_minmax(0,1.2fr)_auto] xl:items-center">
            <div className="min-w-0">
              <p className="text-sm text-gray-600">{item.companyId ? item.companyName ?? 'ไม่พบชื่อบริษัท' : 'ระบบชำระเงินส่วนกลาง'}</p>
              <h2 className="mt-1 text-base font-semibold text-gray-900">{billingIssueLabel(item.kind)}</h2>
              {item.priority !== 'NORMAL' && <span className={`mt-2 inline-flex rounded-lg border px-2 py-1 text-sm ${item.priority === 'CRITICAL' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{billingLabel('priority', item.priority)}</span>}
            </div>
            <div className="min-w-0 text-sm">
              <p className="text-gray-500">ผู้รับผิดชอบ</p><p className="mt-1 text-base text-gray-900">{item.assigneeUserId ? item.assigneeName ?? 'ไม่พบชื่อผู้รับผิดชอบ' : 'ยังไม่มีคนรับเรื่อง'}</p>
              {item.assigneeUserId && !item.assigneeAvailable && <p className="mt-1 text-amber-800">ผู้รับผิดชอบเดิมไม่มีสิทธิ์แล้ว</p>}
              <p className="mt-1 text-gray-600">{billingLabel('issue', item.state)}</p>
            </div>
            <div className="text-sm"><p className="text-gray-500">กำหนดติดตาม</p><p className="mt-1 text-base text-gray-900">{followUp ? formatThaiDateTime(followUp) : 'ยังไม่กำหนด'}</p>{item.overdue && <p className="mt-1 font-medium text-amber-800">เกินกำหนดติดตาม</p>}</div>
            <Link onClick={leaving} href={issueHref(item.id)} className="inline-flex min-h-11 items-center justify-center rounded-lg px-3 font-semibold text-brand-800 underline-offset-4 hover:bg-brand-25 hover:underline">ดูรายละเอียด</Link>
          </article>;
        })}
      </div>}
    {!loading && !error && !disabled && (items.length > 0 || cursor) && <nav aria-label="หน้ารายการปัญหาการชำระเงิน" className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 p-4 sm:px-6">
      <p className="text-sm text-gray-600">แสดงครั้งละไม่เกิน 25 รายการ</p>
      <div className="flex gap-2"><button type="button" onClick={() => onPage(null)} disabled={!cursor} className={billingControl}>หน้าแรก</button><button type="button" onClick={() => onPage(nextCursor)} disabled={!nextCursor} className={billingControl}>หน้าถัดไป</button></div>
    </nav>}
  </section>;
}
