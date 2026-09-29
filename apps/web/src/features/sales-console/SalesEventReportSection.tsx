'use client';
import { useEffect, useState } from 'react';
import type { SalesEventReport, SalesEventReportFigures } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeeStatCard } from '@/common/components/mangmee';
import { LoadingState } from '@/common/components/state';
import { getSalesEventReport } from './sales.api';
import { formatBaht } from './sales-console.logic';
import { salesEventCountLines, salesEventMoneyLines, type SalesEventFigureLine } from './sales-event-report.logic';
import { SalesEmpty, SalesNotice } from './SalesConsoleParts';

/**
 * "ส่วนลดจากงาน" view of the reports page (sales-event spec §10): event → batch → เซลล์ over the
 * discounts handed out in the chosen months. A separate figure from the sales report on purpose — a
 * discount is never a sale for the เซลล์ (SD-Q3). No LINE identity and no document on this screen.
 */

function Lines({ lines, columns }: { lines: SalesEventFigureLine[]; columns: string }) {
  return (
    <dl className={`grid gap-x-3 gap-y-2 ${columns}`}>
      {lines.map((line) => (
        <div key={line.label} className="min-w-0">
          <dt className="text-xs text-gray-500">{line.label}</dt>
          <dd className="text-[15px] font-bold text-gray-900">{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Figures({ figures }: { figures: SalesEventReportFigures }) {
  return (
    <div className="grid gap-3">
      <Lines lines={salesEventCountLines(figures)} columns="grid-cols-3 sm:grid-cols-6" />
      <Lines lines={salesEventMoneyLines(figures)} columns="grid-cols-2 sm:grid-cols-5" />
    </div>
  );
}

export default function SalesEventReportSection({ from, to, teamLeadUserId }: { from: string; to: string; teamLeadUserId: string }) {
  const [report, setReport] = useState<SalesEventReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setReport(null);
    setError(null);
    getSalesEventReport({ from, to, ...(teamLeadUserId ? { teamLeadUserId } : {}) }, { signal: controller.signal })
      .then((answer) => { if (!controller.signal.aborted) setReport(answer); })
      .catch((cause) => { if (!controller.signal.aborted) setError(apiErrorMessage(cause)); });
    return () => controller.abort();
  }, [from, to, teamLeadUserId]);

  if (error) return <SalesNotice tone="error">{error}</SalesNotice>;
  if (!report) return <LoadingState label="กำลังโหลดรายงานส่วนลดจากงาน…" />;

  return (
    <>
      <SalesNotice tone="info">
        ตัวเลขชุดนี้แยกจากยอดขาย ส่วนลดจากงานไม่นับเป็นยอดของเซลล์ ยอดขายยังนับตามดีลและรหัสแนะนำเหมือนเดิม
      </SalesNotice>
      {report.truncated && (
        <SalesNotice tone="warning">มีส่วนลดมากกว่าที่แสดงได้ในครั้งเดียว กรุณาเลือกช่วงเดือนให้สั้นลง</SalesNotice>
      )}
      {report.events.length === 0 ? <SalesEmpty>ยังไม่มีส่วนลดที่แจกในช่วงเดือนที่เลือก</SalesEmpty> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <MangmeeStatCard label="แจกแล้ว" value={`${report.totals.issued.toLocaleString('th-TH')} รายการ`} />
            <MangmeeStatCard label="ใช้เป็นส่วนลดแล้ว" value={`${report.totals.usedAsDiscount.toLocaleString('th-TH')} รายการ`} tone="teal" />
            <MangmeeStatCard label="ส่วนลดที่ให้แล้ว" value={formatBaht(report.totals.appliedDiscountSatang)} tone="amber" />
          </div>
          {report.events.map((event) => (
            <MangmeeCard key={event.eventName} className="grid gap-4 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 break-words text-[15px] font-extrabold text-gray-900">{event.eventName}</p>
                <MangmeeBadge tone="brand">ส่วนลดที่ให้ {formatBaht(event.figures.appliedDiscountSatang)}</MangmeeBadge>
              </div>
              <Figures figures={event.figures} />
              {event.batches.map((batch) => (
                // Native disclosure: a phone sees one line per ชุด until it asks for the เซลล์ rows.
                <details key={batch.batchId} className="rounded-xl border border-gray-200">
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 px-3.5 py-2 text-sm">
                    <span className="min-w-0 break-words font-bold text-gray-900">ชุด {batch.batchName}</span>
                    <span className="text-gray-500">
                      แจก {batch.figures.issued.toLocaleString('th-TH')} · ใช้เป็นส่วนลด {batch.figures.usedAsDiscount.toLocaleString('th-TH')}
                    </span>
                  </summary>
                  <div className="grid gap-4 border-t border-gray-100 p-3.5">
                    <Figures figures={batch.figures} />
                    {batch.agents.map((agent) => (
                      <div key={agent.salesUserId} className="grid gap-2 border-t border-gray-100 pt-3">
                        <p className="text-sm font-bold text-gray-900">{agent.displayName || 'เซลล์ที่ไม่มีชื่อ'}</p>
                        <Figures figures={agent.figures} />
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </MangmeeCard>
          ))}
        </>
      )}
    </>
  );
}
