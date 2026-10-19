'use client';

import { useEffect, useRef, useState } from 'react';
import type { DashboardExpenseMonthsDto } from '@watchdog-bms/contracts';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { Notice } from '@/common/components/notice';
import { secondaryButtonClass } from '@/common/components/button/button-classes';
import { getExpenseMonths } from './dashboard-notifications.api';

const MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const MONTHS_LONG = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** The scale's top: the next 1, 2 or 5 step above the largest month (72,000 → 80,000), so the bars never touch it. */
export function chartTop(max: number): number {
  if (max <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(max));
  for (const factor of [1, 2, 4, 5, 8, 10]) if (factor * step >= max * 1.05) return factor * step;
  return 10 * step;
}

const whole = (value: number) => Math.round(value).toLocaleString('th-TH');
const money = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "รายจ่ายรายเดือน" of the owner's home (Figma HOME-01, 2026-10-14): a year's confirmed expenses by month, this month
 * dark, months without a figure left empty. Owner 2026-10-15: no caption and no chosen-month line under it.
 */
export function ExpenseMonthsCard({ companyId, branchId }: { companyId: string; branchId?: string }) {
  const today = todayCivilDate('Asia/Bangkok');
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = today.slice(0, 7);
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState<DashboardExpenseMonthsDto | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  // A phone opens the chart on this month (or December of an earlier year), at the right end.
  useEffect(() => {
    const row = scroller.current;
    const bar = row?.querySelector<HTMLElement>(`[data-month="${year === thisYear ? thisMonth : `${year}-12`}"]`);
    if (!row || !bar || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = bar.offsetLeft - row.clientWidth / 2 + bar.offsetWidth / 2;
  }, [data, year, thisYear, thisMonth]);

  useEffect(() => {
    let live = true;
    setError(false); setData(null);
    getExpenseMonths(companyId, year, branchId)
      .then((value) => { if (live) setData(value); })
      .catch(() => { if (live) { setData(null); setError(true); } });
    return () => { live = false; };
  }, [companyId, branchId, year, attempt]);

  const months = data?.year === year ? data.months : [];
  const top = chartTop(Math.max(0, ...months.map((row) => Number(row.total))));
  const years = [...new Set([...(data?.years ?? []), thisYear, year])].sort((a, b) => a - b);

  return (
    <section aria-labelledby="home-expense-months" className="mangmee-card mangmee-card-shadow overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#eaf3ee] px-4 py-3 sm:px-6">
        <h2 id="home-expense-months" className="text-base font-medium text-gray-900">รายจ่ายรายเดือน</h2>
        <div className="w-full sm:w-40">
          <ThemedSelect aria-label="ปี" className="mangmee-home-select" value={String(year)} onChange={(event) => {
            const next = Number(event.target.value);
            setYear(next);
          }}>
            {years.map((value) => <option key={value} value={value}>ปี {value + 543}</option>)}
          </ThemedSelect>
        </div>
      </div>
      <div className="grid gap-3 px-4 pb-5 pt-3 sm:px-6 sm:pb-6">
        {error ? (
          <Notice tone="error" action={<button type="button" className={secondaryButtonClass} onClick={() => setAttempt((n) => n + 1)}>ลองอีกครั้ง</button>}>
            โหลดรายจ่ายรายเดือนไม่สำเร็จ
          </Notice>
        ) : !data || data.year !== year ? <div role="status" aria-busy="true" className="py-8 text-sm text-gray-500">กำลังโหลดรายจ่ายรายเดือน…</div> : <>
          {/* The scale stays; the months scroll sideways on a phone (owner 2026-10-15), each month wide enough for its name and figure. */}
          <div className="flex min-w-0 gap-3">
            <div className="relative mt-5 h-44 w-11 shrink-0 text-right text-xs text-gray-700 sm:w-12" aria-hidden="true">
              <span className="absolute right-0 top-0 -translate-y-1/2">{whole(top)}</span>
              <span className="absolute right-0 top-1/2 -translate-y-1/2">{whole(top / 2)}</span>
              <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
            </div>
            <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto pb-1 [scrollbar-width:thin]">
              <div className="min-w-[34rem] pt-5 sm:min-w-0">
                <div className="relative h-44">
                  {[0, 50, 100].map((at) => <div key={at} aria-hidden="true" className="absolute inset-x-0 border-t border-gray-200" style={{ top: `${at}%` }} />)}
                  <div className="relative grid h-full grid-cols-12 items-end gap-2 sm:gap-3">
                    {Array.from({ length: 12 }, (_, index) => {
                      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
                      const row = months.find((item) => item.month === key);
                      const total = Number(row?.total ?? 0);
                      const future = key > thisMonth;
                      const label = `${MONTHS_LONG[index]} ${year + 543}`;
                      return (
                        <div key={key} role="img" aria-label={future ? `${label} ยังไม่ถึง` : `${label} รวม ${money(total)} บาท`} data-month={key}
                          className="flex h-full flex-col items-center justify-end">
                          {future ? null : <>
                            <span aria-hidden="true" className="mb-1 whitespace-nowrap text-[0.6875rem] text-gray-800 sm:text-xs">{total > 0 ? whole(total) : ''}</span>
                            <span aria-hidden="true" className={`w-full max-w-[40px] ${key === thisMonth ? 'bg-[#43834b]' : 'bg-[#93b89d]'}`}
                              style={{ height: `${(total / top) * 100}%` }} />
                          </>}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-1.5 grid grid-cols-12 gap-2 text-center text-xs text-gray-800 sm:gap-3 sm:text-[0.8125rem]" aria-hidden="true">
                  {MONTHS_SHORT.map((name) => <span key={name} className="whitespace-nowrap">{name}</span>)}
                </div>
              </div>
            </div>
          </div>
        </>}
      </div>
    </section>
  );
}
