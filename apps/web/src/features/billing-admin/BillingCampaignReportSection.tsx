'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { BillingPromotionCampaignReport } from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { billingControl, billingLink, billingPermissionLabel } from '../billing/billing-display';
import { getCampaignReport } from './billing-campaigns.api';
import {
  CAMPAIGN_TONE_CLASS, REPORT_FREE_MONTHS_NOTE, campaignError, campaignLoadFailure, countText, reportCountItems, reportMoneyView, reportRowView,
  type CampaignLoadFailure,
} from './billing-campaigns.logic';

/** Usage of a published campaign (spec §4 "รายงาน"): counts, free time granted, money only with the finance permission, and the shops with links. */
export default function BillingCampaignReportSection({ campaignId }: { campaignId: string }) {
  const [report, setReport] = useState<BillingPromotionCampaignReport | null>(null);
  const [failure, setFailure] = useState<CampaignLoadFailure | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [pageError, setPageError] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setLoading(true); setFailure(null); setPageError('');
    getCampaignReport(campaignId)
      .then(value => { if (token === generation.current) setReport(value); })
      .catch(cause => { if (token === generation.current) { setReport(null); setFailure(campaignLoadFailure(cause)); } })
      .finally(() => { if (token === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [campaignId, reload]);
  async function more() {
    if (!report?.nextCursor || paging) return;
    const token = generation.current;
    setPaging(true); setPageError('');
    try {
      const next = await getCampaignReport(campaignId, report.nextCursor);
      if (token === generation.current) setReport(current => (current ? { ...next, companies: [...current.companies, ...next.companies] } : next));
    } catch (cause) {
      if (token === generation.current) setPageError(campaignError(cause).text);
    } finally { if (token === generation.current) setPaging(false); }
  }
  const money = report ? reportMoneyView(report) : null;
  return <section aria-label="รายงานการใช้สิทธิ์" aria-busy={loading} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-gray-900">รายงานการใช้สิทธิ์</h2>
      <button type="button" className={billingControl} disabled={loading} aria-busy={loading} onClick={() => setReload(value => value + 1)}>โหลดรายงานใหม่</button>
    </div>
    {loading && !report && <p role="status" className="text-gray-600">กำลังโหลดรายงาน…</p>}
    {failure && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
      <p>{failure.text}</p>
      {failure.kind === 'failed' && <button type="button" className={`${billingControl} mt-3`} onClick={() => setReload(value => value + 1)}>ลองอีกครั้ง</button>}
    </div>}
    {report && <>
      <p className="text-sm text-gray-600">ข้อมูล ณ {formatThaiDateTime(report.generatedAt)}</p>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {reportCountItems(report.counts).map(item => <div key={item.label} className="min-w-0 rounded-lg bg-gray-50 p-3">
          <dt className="text-sm text-gray-600">{item.label}</dt><dd className="mt-1 text-xl font-semibold text-gray-900">{item.value}</dd>
        </div>)}
      </dl>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-gray-50 p-3"><dt className="text-sm text-gray-600">เดือนฟรีที่ให้ไปแล้ว</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{countText(report.bonusMonthsGranted)} เดือน</dd></div>
        <div className="rounded-lg bg-gray-50 p-3"><dt className="text-sm text-gray-600">ใบเสร็จแถมที่ให้ไปแล้ว</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{countText(report.bonusReceiptUnitsGranted)} ใบ</dd></div>
        {money ? <>
          <div className="rounded-lg bg-gray-50 p-3"><dt className="text-sm text-gray-600">เงินที่รับจริง</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{money.received}</dd></div>
          <div className="rounded-lg bg-gray-50 p-3"><dt className="text-sm text-gray-600">เงินที่คืนแล้ว</dt><dd className="mt-1 text-lg font-semibold text-gray-900">{money.refunded}</dd></div>
        </> : <div className="rounded-lg bg-gray-50 p-3 sm:col-span-2"><dt className="text-sm text-gray-600">เงินที่รับจริงและเงินที่คืนแล้ว</dt>
          <dd className="mt-1 text-gray-700">แสดงเมื่อบัญชีมีสิทธิ์ “{billingPermissionLabel('system.billing.financial.read')}”</dd></div>}
      </dl>
      <p className="rounded-lg bg-gray-50 p-3 text-gray-700">{REPORT_FREE_MONTHS_NOTE}</p>
      <h3 className="font-semibold text-gray-900">ร้านที่ขอใช้สิทธิ์</h3>
      {report.companies.length === 0 ? <p className="text-gray-600">ยังไม่มีร้านที่ขอใช้สิทธิ์</p> : <ul className="space-y-3">
        {report.companies.map(company => {
          const shown = reportRowView(company);
          return <li key={company.companyId} className="rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="min-w-0 font-semibold text-gray-900 [overflow-wrap:anywhere]">{shown.title}</p>
              <span className={`inline-flex rounded-lg border px-2 py-1 text-sm ${CAMPAIGN_TONE_CLASS[shown.tone]}`}>{shown.stateLabel}</span>
            </div>
            <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {shown.facts.map(fact => <div key={fact.label} className="min-w-0"><dt className="text-gray-500">{fact.label}</dt><dd className="text-gray-900">{fact.value}</dd></div>)}
            </dl>
            {shown.notes.length > 0 && <ul className="mt-2 list-inside list-disc text-sm text-amber-800">{shown.notes.map(note => <li key={note}>{note}</li>)}</ul>}
            {(shown.attemptHref || shown.invoiceHref) && <div className="mt-1 flex flex-wrap gap-x-3">
              {shown.attemptHref && <Link className={billingLink} href={shown.attemptHref} aria-label={`ดูรายการชำระเงินของ ${shown.title}`}>ดูรายการชำระเงิน</Link>}
              {shown.invoiceHref && <Link className={billingLink} href={shown.invoiceHref} aria-label={`ดูใบแจ้งหนี้ของ ${shown.title}`}>ดูใบแจ้งหนี้</Link>}
            </div>}
          </li>;
        })}
      </ul>}
      {pageError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">{pageError}</p>}
      {report.nextCursor && <button type="button" className={billingControl} disabled={paging} aria-busy={paging} onClick={() => void more()}>ดูเพิ่ม</button>}
    </>}
  </section>;
}
