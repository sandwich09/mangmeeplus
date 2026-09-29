'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';
import type { BillingOperatorCompany, BillingOperatorOverview } from '@watchdog-bms/contracts';
import { planTermStateLabel } from '@watchdog-bms/contracts';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { billingControl, billingLabel, billingPlanLabel } from '../billing/billing-display';

// A no-package or expired term has no current tier to name — reads as a live plan otherwise
// (item 8): the same terse chip PartnerListPage/SignupQueuePage already use for this pair of states.
function plan(company: BillingOperatorCompany) {
  return company.planState === 'NO_PACKAGE' || company.planState === 'EXPIRED' ? planTermStateLabel(company.planState) : billingPlanLabel(company.tierKey);
}
function payment(company: BillingOperatorCompany) {
  return company.paymentState === 'NONE' ? 'ยังไม่มีประวัติการชำระเงิน' : billingLabel('payment', company.paymentState);
}
function access(company: BillingOperatorCompany) {
  const tone = company.accessState === 'ACTIVE' ? 'border-green-200 bg-green-50 text-green-800'
    : company.accessState === 'HELD' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 bg-gray-100 text-gray-700';
  return <span className={`inline-flex rounded-lg border px-2 py-1 text-sm ${tone}`}>{company.planState === 'NO_PACKAGE' ? 'ยังไม่มีแพ็กเกจ' : billingLabel('access', company.accessState)}</span>;
}
function term(company: BillingOperatorCompany) {
  if (company.planState === 'NO_PACKAGE') return <><span className="block text-xs text-gray-500">แพ็กเกจ</span>ยังไม่มีแพ็กเกจ</>;
  return company.termEndsAt ? <><span className="block text-xs text-gray-500">{company.source === 'TRIAL' ? 'ทดลองใช้ถึง' : 'ใช้งานถึง'}</span>{formatThaiDate(company.termEndsAt)}</> : 'ยังไม่กำหนด';
}

export default function BillingCompanyDirectory({ overview, loading, error, requestId, search, query, page, onSearchChange, onSearch, onClear, onPage, onReload, leaving,
  lookup, onLookupChange, onLookup, lookupError }: {
  overview: BillingOperatorOverview | null; loading: boolean; error: string; requestId: string | null;
  search: string; query: string; page: number; onSearchChange: (value: string) => void;
  onSearch: () => void; onClear: () => void; onPage: (page: number) => void; onReload: () => void;
  leaving: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** Purchase without setup PR E (R-E4): search by the 8-char reference a customer reads out. */
  lookup: string; onLookupChange: (value: string) => void; onLookup: () => void; lookupError: string;
}) {
  const companies = overview?.companies ?? [];
  const pagination = overview?.pagination;
  const total = pagination?.total;
  const pageSize = pagination?.pageSize ?? 25;
  const totalPages = total === undefined ? null : Math.max(1, Math.ceil(total / pageSize));
  return <section aria-label="แพ็กเกจและการชำระเงินของบริษัท" aria-busy={loading} className="overflow-hidden rounded-xl border border-gray-200 bg-white">
    <div className="space-y-4 p-4 sm:p-6">
      <form onSubmit={event => { event.preventDefault(); onSearch(); }} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="billing-company-search" className="mb-2 block text-sm font-medium text-gray-700">ค้นหาบริษัท</label>
          <input id="billing-company-search" type="search" value={search} maxLength={100} onChange={event => onSearchChange(event.target.value)} placeholder="ชื่อบริษัทหรือรหัสบริษัท" className="mangmee-input min-h-11 w-full !text-base" />
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="submit" className={`${billingControl} flex-1 sm:flex-none`}>ค้นหา</button>
          <button type="button" onClick={onClear} title="ล้างคำค้นและกลับหน้าแรก" className={`${billingControl} flex-1 whitespace-nowrap sm:flex-none`}>ล้างตัวกรอง</button>
        </div>
      </form>
      {/* Purchase without setup PR E (R-E4/RV27): the reference a customer reads out over the phone. */}
      <form onSubmit={event => { event.preventDefault(); onLookup(); }} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="billing-reference-lookup" className="mb-2 block text-sm font-medium text-gray-700">ค้นหาด้วยเลขอ้างอิง</label>
          <input id="billing-reference-lookup" type="search" value={lookup} maxLength={128} onChange={event => onLookupChange(event.target.value)} placeholder="เลขอ้างอิง 8 ตัวจากลูกค้า เลขใบแจ้งหนี้ หรือเลขส่วนลดจากงาน" className="mangmee-input min-h-11 w-full !text-base" />
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="submit" className={`${billingControl} flex-1 sm:flex-none`}>เปิดรายการ</button>
        </div>
      </form>
      {lookupError && <p role="alert" className="text-sm text-red-700">{lookupError}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-sm text-gray-600">{loading ? 'กำลังโหลดบริษัท…' : error ? 'ยังโหลดรายชื่อไม่ได้' : total === undefined ? `แสดง ${companies.length} บริษัท` : `พบ ${total.toLocaleString('th-TH')} บริษัท${query ? ` สำหรับ “${query}”` : ''}`}</p>
        <button type="button" onClick={onReload} disabled={loading} aria-busy={Boolean(loading)} title="โหลดข้อมูลที่มั่งมีบันทึกไว้ล่าสุด" className="min-h-11 rounded-lg px-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50">โหลดรายการใหม่</button>
      </div>
      {overview && !overview.platformScope && <p className="text-sm text-gray-500">แสดงเฉพาะบริษัทที่คุณได้รับสิทธิ์ดูแล</p>}
    </div>
    {error ? <div role="alert" className="mx-4 mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 sm:mx-6">
      <p>{error}</p><button type="button" onClick={onReload} className="mt-2 min-h-11 underline">ลองอีกครั้ง</button>
      {requestId && <details className="mt-2 text-sm"><summary className="min-h-11 cursor-pointer py-2">ข้อมูลสำหรับตรวจสอบภายใน</summary><p className="break-all">เลขอ้างอิง: {requestId}</p></details>}
      {page > 1 && <button type="button" onClick={() => onPage(1)} className="ml-3 min-h-11 underline">กลับหน้าแรก</button>}
    </div> : loading ? <div aria-hidden="true" className="space-y-3 border-t border-gray-100 p-6">{[1, 2, 3].map(row => <div key={row} className="h-16 animate-pulse rounded bg-gray-100" />)}</div> : companies.length === 0 ? <div className="border-t border-gray-100 p-8 text-center">
      <p className="font-medium text-gray-800">{page > 1 ? 'ไม่มีบริษัทในหน้านี้' : query ? 'ไม่พบบริษัทที่ตรงกับคำค้น' : 'ยังไม่มีบริษัทที่แสดงได้'}</p>
      <p className="mt-2 text-sm text-gray-600">{page > 1 ? 'จำนวนรายการอาจเปลี่ยนไป กลับไปดูรายการหน้าแรกได้' : query ? 'ลองเปลี่ยนคำค้น หรือล้างตัวกรองเพื่อดูรายการทั้งหมด' : 'รายชื่อจะแสดงเมื่อมีบริษัทที่คุณได้รับสิทธิ์ดูแล'}</p>
      {page > 1 && <button type="button" onClick={() => onPage(1)} className="mt-3 min-h-11 px-3 text-brand-800 underline">กลับหน้าแรก</button>}
    </div> : <>
      <div className="hidden xl:block">
        <table className="w-full table-fixed border-t border-gray-200 text-left">
          <caption className="sr-only">บริษัท แพ็กเกจ สถานะการชำระเงิน และสิทธิ์ใช้งาน</caption>
          <thead className="bg-gray-50 text-sm text-gray-600"><tr>{['บริษัท', 'แพ็กเกจ', 'การชำระเงิน', 'การใช้งาน', 'วันสิ้นสุดสิทธิ์'].map((heading, i) => <th key={heading} scope="col" className={`${i === 0 ? 'w-[28%]' : 'w-[18%]'} px-4 py-3 first:pl-6`}>{heading}</th>)}</tr></thead>
          <tbody className="divide-y divide-gray-100 text-sm">{companies.map(company => <tr key={company.companyId} className="align-top hover:bg-gray-50">
            <td className="break-words px-6 py-4"><Link onClick={leaving} href={`/system/billing/companies/${encodeURIComponent(company.companyId)}`} className="inline-flex min-h-11 items-center text-base font-semibold text-brand-800 underline-offset-4 hover:underline">{company.companyName}</Link></td>
            <td className="px-4 py-5 text-gray-900">{plan(company)}</td>
            <td className="px-4 py-5 text-gray-700">{payment(company)}{company.paidThrough && <p className="mt-1 text-xs text-gray-500">ชำระไว้ถึง {formatThaiDate(company.paidThrough)}</p>}</td>
            <td className="px-4 py-4">{access(company)}</td>
            <td className="px-4 py-5 text-gray-700">{term(company)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <div className="divide-y divide-gray-200 border-t border-gray-200 xl:hidden">{companies.map(company => <article key={company.companyId} aria-label={company.companyName} className="space-y-3 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2"><Link onClick={leaving} href={`/system/billing/companies/${encodeURIComponent(company.companyId)}`} className="inline-flex min-h-11 items-center text-base font-semibold text-brand-800 underline underline-offset-4">{company.companyName}</Link>{access(company)}</div>
        <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-gray-500">แพ็กเกจ</dt><dd className="mt-1 text-base text-gray-900">{plan(company)}</dd></div><div><dt className="text-gray-500">วันสิ้นสุดสิทธิ์</dt><dd className="mt-1 text-gray-900">{term(company)}</dd></div>
          <div className="col-span-2"><dt className="text-gray-500">การชำระเงิน</dt><dd className="mt-1 text-gray-900">{payment(company)}{company.paidThrough && <span className="block text-gray-600">ชำระไว้ถึง {formatThaiDate(company.paidThrough)}</span>}</dd></div></dl>
      </article>)}</div>
    </>}
    {!loading && !error && totalPages !== null && (companies.length > 0 || page > 1) && <nav aria-label="หน้ารายการชำระเงินบริษัท" className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 p-4 sm:px-6">
      <p className="text-sm text-gray-600">{companies.length > 0 ? `รายการ ${(page - 1) * pageSize + 1}–${(page - 1) * pageSize + companies.length} จาก ${total?.toLocaleString('th-TH')} บริษัท` : 'ไม่มีรายการในหน้านี้'}</p>
      <div className="flex items-center gap-2"><button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className={billingControl}>ก่อนหน้า</button><span className="text-sm text-gray-600">หน้า {page}</span><button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages} className={billingControl}>ถัดไป</button></div>
    </nav>}
  </section>;
}
