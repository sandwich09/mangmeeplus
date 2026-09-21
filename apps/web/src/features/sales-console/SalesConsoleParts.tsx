'use client';
import type { ReactNode } from 'react';
import { billingPlanLabel, type SalesAgentCredentialHandoff, type SalesCompanySearchItem, type SalesDealView } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard } from '@/common/components/mangmee';
import { formatThaiDate, formatThaiDateTime } from '@/common/i18n/thai-date';
import {
  baseTierLabel, formatBaht, SALES_ACCESS_STATE_META, SALES_DEAL_STATUS_META,
} from './sales-console.logic';

/** One banner shape for the whole console, so an error and a warning never look like two apps. */
export function SalesNotice({ tone, children }: { tone: 'error' | 'warning' | 'info'; children: ReactNode }) {
  const toneClass = tone === 'error'
    ? 'border-error-500 bg-error-50 text-error-700'
    : tone === 'warning'
      ? 'border-warning-500 bg-warning-50 text-warning-700'
      : 'border-brand-200 bg-brand-25 text-brand-800';
  return (
    <p role={tone === 'error' ? 'alert' : undefined} className={`rounded-xl border px-3.5 py-2.5 text-sm leading-6 ${toneClass}`}>
      {children}
    </p>
  );
}

export function SalesEmpty({ children }: { children: ReactNode }) {
  return <MangmeeCard className="p-6 text-center text-sm text-gray-500">{children}</MangmeeCard>;
}

export function SalesDealStatusBadge({ status }: { status: SalesDealView['status'] }) {
  const meta = SALES_DEAL_STATUS_META[status];
  return <MangmeeBadge tone={meta.tone}>{meta.label}</MangmeeBadge>;
}

export function SalesAccessStateBadge({ state }: { state: SalesCompanySearchItem['accessState'] }) {
  const meta = SALES_ACCESS_STATE_META[state];
  return <MangmeeBadge tone={meta.tone}>{meta.label}</MangmeeBadge>;
}

/**
 * Q4/S33: the console may search every shop in the system, so the row shows the four fields the
 * spec allows and nothing else — no revenue, no receipts, no owner PII.
 */
export function SalesCompanyLine({ company }: { company: SalesCompanySearchItem }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[15px] font-bold text-gray-900">{company.name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        <SalesAccessStateBadge state={company.accessState} />
        {/* The row printed the raw tier key (PRO_999) at a เซลล์ standing in the shop. */}
        {company.tierKey && <span>{billingPlanLabel(company.tierKey)}</span>}
        {company.province && <span>{company.province}</span>}
        <span>เปิดร้าน {formatThaiDate(company.createdAt)}</span>
      </p>
    </div>
  );
}

/** The deal card body every list, preview and approval queue shares. */
export function SalesDealSummary({ deal }: { deal: SalesDealView }) {
  const snapshot = deal.snapshot;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-3">
      <div><dt className="text-xs font-semibold text-gray-500">แพ็กเกจฐาน</dt><dd className="font-bold text-gray-900">{baseTierLabel(snapshot.base)}</dd></div>
      <div><dt className="text-xs font-semibold text-gray-500">ราคา (รวม VAT ถ้ามี)</dt><dd className="font-bold text-gray-900">{formatBaht(snapshot.priceSatang)}</dd></div>
      <div><dt className="text-xs font-semibold text-gray-500">ระยะเวลา</dt><dd className="font-bold text-gray-900">{snapshot.months} เดือน</dd></div>
      <div><dt className="text-xs font-semibold text-gray-500">สาขา</dt><dd className="font-bold text-gray-900">{snapshot.branchLimit}</dd></div>
      <div><dt className="text-xs font-semibold text-gray-500">ผู้ใช้</dt><dd className="font-bold text-gray-900">{snapshot.employeeLimit}</dd></div>
      <div><dt className="text-xs font-semibold text-gray-500">ใบเสร็จต่อเดือน</dt><dd className="font-bold text-gray-900">{snapshot.monthlySlipLimit}</dd></div>
      <div className="col-span-2 sm:col-span-3">
        <dt className="text-xs font-semibold text-gray-500">เครดิต AI ต่อเดือน</dt>
        <dd className="font-bold text-gray-900">
          {snapshot.aiMonthlyBudgetSatang === null ? 'ใช้ค่าเริ่มต้นของแพ็กเกจ'
            : snapshot.aiMonthlyBudgetSatang === 0 ? 'ปิดการใช้ AI' : formatBaht(snapshot.aiMonthlyBudgetSatang)}
        </dd>
      </div>
      {snapshot.description && (
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs font-semibold text-gray-500">โน้ตถึงลูกค้า</dt>
          <dd className="whitespace-pre-line break-words text-gray-700">{snapshot.description}</dd>
        </div>
      )}
      {deal.offerExpiresAt && (
        <div className="col-span-2 sm:col-span-3">
          <dt className="text-xs font-semibold text-gray-500">ข้อเสนอใช้ได้ถึง</dt>
          <dd className="font-bold text-gray-900">{formatThaiDateTime(deal.offerExpiresAt)}</dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Q3/S28: a new เซลล์ is never LINE-linked, so the screen of whoever created the account is the
 * only place this password exists. Said plainly, with a copy button, and never fetched again.
 */
export function SalesCredentialPanel({ credential, onClose }: { credential: SalesAgentCredentialHandoff; onClose: () => void }) {
  return (
    <MangmeeCard className="border-brand-200 bg-brand-25 p-4">
      <p className="text-[15px] font-extrabold text-gray-900">รหัสผ่านชั่วคราวของ {credential.username}</p>
      <p className="mt-0.5 text-xs font-semibold text-gray-500">แสดงครั้งเดียว · ระบบจะให้ตั้งรหัสผ่านใหม่เมื่อเข้าใช้งานครั้งแรก</p>
      <div className="mt-2.5 flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white py-0 pl-3 pr-1.5">
        <span data-testid="sales-temporary-password" className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-extrabold tracking-[.06em] text-gray-800">{credential.temporaryPassword}</span>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(credential.temporaryPassword)} className="min-h-11 shrink-0 px-1.5 text-[13px] font-extrabold text-brand-600">คัดลอก</button>
      </div>
      <p className="mt-2 text-xs leading-6 text-gray-500">
        {credential.lineNotified ? 'ส่งรหัสทาง LINE ให้แล้วด้วย' : 'บัญชีนี้ยังไม่ได้ผูก LINE กรุณาส่งรหัสให้เจ้าตัวด้วยตนเอง'}
        {credential.expiresAt ? ` · ใช้ได้ถึง ${formatThaiDateTime(credential.expiresAt)}` : ''}
      </p>
      <button type="button" onClick={onClose} className="mangmee-btn mangmee-btn-secondary mt-3 w-full">ปิดกล่องนี้</button>
    </MangmeeCard>
  );
}
