'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { SalesReportMonth, SalesReportRow } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage, MangmeeStatCard } from '@/common/components/mangmee';
import { SelectField, TextField } from '@/common/components/field';
import { LoadingState } from '@/common/components/state';
import { formatThaiMonth } from '@/common/i18n/thai-date';
import { getSalesReportSummary } from './sales.api';
import {
  defaultSalesReportRange, formatBaht, SALES_DEDUCTION_RULE, salesDeductionLine, salesReportLeads, salesReportRangeError, salesReportRowsOf,
  salesReportTotals, sortSalesReportMonths, type SalesReportRange, type SalesReportTotals,
} from './sales-console.logic';
import { SalesEmpty, SalesNotice } from './SalesConsoleParts';
import SalesEventReportSection from './SalesEventReportSection';

/**
 * §17.2: a shop is counted once, at its first paid activation, so this report is a plain sum — no
 * renewals to chase and nothing to reconcile. The endpoint answers in the caller's own scope (an
 * agent sees only themselves, a หัวหน้า every team they lead), which is why this page never asks
 * who it is talking to: the shape of the answer decides whether it reads as "ยอดของฉัน" or a table.
 *
 * Nothing here opens a financial document — a เซลล์ may see what a shop opened with, never its
 * invoices (§B "no invoice/financial documents").
 */

const COLUMNS = [
  { key: 'dealActivations', label: 'ดีลพิเศษ' },
  { key: 'referralActivations', label: 'แนะนำร้าน' },
  { key: 'flaggedCount', label: 'ถูกธง' },
] as const;

function MonthFigures({ rows, totals }: { rows: SalesReportRow[]; totals: SalesReportTotals }) {
  return (
    <>
      {/* 390 px first: the same numbers as cards, because five columns do not fit a phone. */}
      <div className="grid gap-2 sm:hidden">
        {rows.map((row) => (
          <div key={row.salesUserId} className="rounded-xl border border-gray-200 p-3.5">
            <p className="text-[15px] font-bold text-gray-900">{row.displayName}</p>
            <p className={`mt-1 text-lg font-extrabold ${row.amountSatang < 0 ? 'text-error-700' : 'text-brand-800'}`}>{formatBaht(row.amountSatang)}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              ดีลพิเศษ {row.dealActivations} ร้าน · แนะนำร้าน {row.referralActivations} ร้าน
            </p>
            {row.flaggedCount > 0 && (
              <p className="mt-1 text-xs font-semibold text-warning-700">ถูกธง {row.flaggedCount} ร้าน · ยังไม่นับในยอด</p>
            )}
          </div>
        ))}
      </div>

      <div className="mangmee-table-scroll hidden sm:block">
        <table className="mangmee-table">
          <thead>
            <tr>
              <th scope="col">เซลล์</th>
              {COLUMNS.map((column) => <th key={column.key} scope="col" className="text-right">{column.label}</th>)}
              <th scope="col" className="text-right">ยอดเปิดบริษัท</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.salesUserId}>
                <th scope="row" className="font-bold text-gray-900">{row.displayName}</th>
                {COLUMNS.map((column) => <td key={column.key} className="text-right">{row[column.key].toLocaleString('th-TH')}</td>)}
                <td className="text-right font-bold text-gray-900">{formatBaht(row.amountSatang)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row" className="font-bold text-gray-900">รวมทั้งเดือน</th>
              {COLUMNS.map((column) => <td key={column.key} className="text-right font-bold">{totals[column.key].toLocaleString('th-TH')}</td>)}
              <td className="text-right font-bold text-brand-800">{formatBaht(totals.amountSatang)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function SalesReportsPage() {
  // `?view=events` opens the sales-event discount report (spec §10) — its own figures, never sales.
  const params = useSearchParams();
  const [eventsView, setEventsView] = useState(() => params.get('view') === 'events');
  const [range, setRange] = useState<SalesReportRange>(() => defaultSalesReportRange());
  const [leadFilter, setLeadFilter] = useState('');
  const [months, setMonths] = useState<SalesReportMonth[] | null>(null);
  // Built from the UNFILTERED answer: picking one team narrows the rows to it, and rebuilding the
  // list from those rows would leave the filter holding one choice and no way back to "ทุกทีม".
  const [leads, setLeads] = useState<{ userId: string; displayName: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const rangeError = salesReportRangeError(range);

  const load = useCallback((current: SalesReportRange, teamLeadUserId: string, signal?: AbortSignal) => {
    setError(null);
    return getSalesReportSummary({ ...current, ...(teamLeadUserId ? { teamLeadUserId } : {}) }, { signal })
      .then((summary) => {
        if (signal?.aborted) return;
        setMonths(summary.months);
        if (!teamLeadUserId) setLeads(salesReportLeads(summary.months));
      })
      .catch((cause) => { if (!signal?.aborted) { setMonths([]); setError(apiErrorMessage(cause)); } });
  }, []);

  useEffect(() => {
    if (rangeError) { setMonths([]); return; }
    const controller = new AbortController();
    void load(range, leadFilter, controller.signal);
    return () => controller.abort();
  }, [range, leadFilter, rangeError, load]);

  const sorted = sortSalesReportMonths(months ?? []);
  const rows = salesReportRowsOf(months ?? []);
  const totals = salesReportTotals(rows);
  // One agent in the whole answer = the caller is reading their own numbers (§B "ยอดของฉัน"). An
  // empty answer says nothing about who is asking, so it keeps the neutral title.
  const ownNumbers = rows.length > 0 && new Set(rows.map((row) => row.salesUserId)).size === 1;

  return (
    <MangmeePage
      eyebrow="ทีมขายมั่งมี"
      title={eventsView ? 'รายงานส่วนลดจากงาน' : ownNumbers ? 'ยอดของฉัน' : 'รายงานยอดขาย'}
      description={eventsView
        ? 'นับส่วนลดที่แจกในช่วงเดือนที่เลือก ตามงาน ชุด และเซลล์ผู้แจก'
        : `นับเฉพาะร้านที่เปิดใช้งานครั้งแรก ร้านละครั้งเดียว · รอบต่ออายุไม่นับ · ${SALES_DEDUCTION_RULE}`}
    >
      <div role="group" aria-label="เลือกรายงาน" className="grid grid-cols-2 gap-2">
        {[{ events: false, label: 'ยอดขาย' }, { events: true, label: 'ส่วนลดจากงาน' }].map((tab) => (
          <button key={tab.label} type="button" aria-pressed={eventsView === tab.events} onClick={() => setEventsView(tab.events)}
            className={`min-h-11 rounded-lg border px-3 text-sm font-semibold ${eventsView === tab.events ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <MangmeeCard className="grid gap-4 p-4 sm:grid-cols-3">
        {/* Native month boxes: the picker every phone already knows, and the exact 'YYYY-MM' the
            endpoint parses — no format to agree on twice. */}
        <TextField label="ตั้งแต่เดือน" name="reportFrom" type="month" value={range.from}
          onChange={(event) => setRange((previous) => ({ ...previous, from: event.target.value }))} />
        <TextField label="ถึงเดือน" name="reportTo" type="month" value={range.to}
          onChange={(event) => setRange((previous) => ({ ...previous, to: event.target.value }))} />
        {leads.length > 1 && (
          <SelectField label="หัวหน้าทีม" name="reportTeamLead" value={leadFilter}
            onChange={(event) => setLeadFilter(event.target.value)}>
            <option value="">ทุกทีม</option>
            {leads.map((lead) => <option key={lead.userId} value={lead.userId}>{lead.displayName}</option>)}
          </SelectField>
        )}
      </MangmeeCard>

      {rangeError && <SalesNotice tone="warning">{rangeError}</SalesNotice>}

      {eventsView ? !rangeError && <SalesEventReportSection from={range.from} to={range.to} teamLeadUserId={leadFilter} /> : <>
      {error && <SalesNotice tone="error">{error}</SalesNotice>}

      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <MangmeeStatCard label="ยอดเปิดบริษัทรวม" value={formatBaht(totals.amountSatang)} />
          <MangmeeStatCard label="ร้านที่เปิดจากดีลพิเศษ" value={`${totals.dealActivations.toLocaleString('th-TH')} ร้าน`} tone="teal" />
          <MangmeeStatCard label="ร้านที่เปิดจากการแนะนำ" value={`${totals.referralActivations.toLocaleString('th-TH')} ร้าน`} tone="amber" />
        </div>
      )}

      {months === null ? <LoadingState label="กำลังโหลดรายงาน…" />
        : rows.length === 0 ? <SalesEmpty>ยังไม่มีร้านที่เปิดใช้งานในช่วงเดือนที่เลือก</SalesEmpty>
          : sorted.map((month) => (
            <MangmeeCard key={month.monthKey} className="grid gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[15px] font-extrabold text-gray-900">{formatThaiMonth(`${month.monthKey}-01`)}</p>
                <MangmeeBadge tone={month.totals.amountSatang < 0 ? 'danger' : 'brand'}>{formatBaht(month.totals.amountSatang)}</MangmeeBadge>
              </div>
              <MonthFigures rows={month.rows} totals={month.totals} />
              {/* Owner 2026-10-02: a refund or a lost dispute is its own line in the month it happened,
                  with the shop and the month whose credit it takes back — stacked, so it fits 390 px. */}
              {month.deductions.length > 0 && (
                <div className="grid gap-2 border-t border-gray-100 pt-3">
                  <p className="text-xs font-bold text-gray-700">รายการหักในเดือนนี้</p>
                  <ul className="grid gap-2">
                    {month.deductions.map((deduction, index) => {
                      const line = salesDeductionLine(deduction,
                        ownNumbers ? undefined : month.rows.find((row) => row.salesUserId === deduction.salesUserId)?.displayName);
                      return (
                        <li key={`${deduction.occurredAt}:${index}`} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="break-words text-sm font-semibold text-gray-900">{line.title}</p>
                            <p className="mt-0.5 text-xs text-gray-500">{line.detail}</p>
                          </div>
                          <p className="shrink-0 text-sm font-bold text-error-700">{line.amount}</p>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </MangmeeCard>
          ))}

      {totals.flaggedCount > 0 && (
        <SalesNotice tone="warning">
          มี {totals.flaggedCount.toLocaleString('th-TH')} ร้านที่ระบบตั้งธงไว้และยังไม่นับรวมในยอด ผู้ดูแลระบบเป็นผู้ตรวจ
        </SalesNotice>
      )}
      </>}
    </MangmeePage>
  );
}
