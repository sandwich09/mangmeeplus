'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDate, formatThaiMonth } from '@/common/i18n/thai-date';
import {
  closePeriod,
  ensurePeriod,
  getBalanceSheet,
  getGeneralLedger,
  getPnl,
  getTrialBalance,
  listJournals,
  listPeriods,
  runCloseChecks,
  type AccountingPeriod,
  type BalanceSheet,
  type GlAccountLine,
  type JournalEntrySummary,
  type PeriodCloseRun,
  type PnlReport,
  type TrialBalance,
} from './ledger.api';
import { civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';
import { useConfirm } from '@/common/components/modal';

const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:cursor-not-allowed disabled:opacity-50';
const ghostClass = 'mangmee-btn mangmee-btn-secondary disabled:cursor-not-allowed disabled:opacity-50';

function money(value?: string) {
  return Number(value ?? '0').toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function err(e: unknown) {
  return apiErrorMessage(e);
}

function SummaryBox({ label, value }: { label: string; value: string }) {
  return (
    <MangmeeCard className="px-4 py-3">
      <div className="text-xs font-medium uppercase text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-bold text-gray-900">{value}</div>
    </MangmeeCard>
  );
}

export function LedgerReportsPage({ companyId }: { companyId: string }) {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const searchParams = useSearchParams();
  const sourceType = searchParams.get('sourceType') ?? '';
  const sourceId = searchParams.get('sourceId') ?? '';
  const [periodKey, setPeriodKey] = useState(civilPeriodKey(todayCivilDate()));
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [pnl, setPnl] = useState<PnlReport | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null);
  const [gl, setGl] = useState<GlAccountLine[]>([]);
  const [journals, setJournals] = useState<JournalEntrySummary[]>([]);
  const [journalTotal, setJournalTotal] = useState(0);
  const [closeRun, setCloseRun] = useState<PeriodCloseRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPeriod = useMemo(() => periods.find((p) => p.periodKey === periodKey), [periodKey, periods]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const period = await ensurePeriod(companyId, periodKey);
      const [nextPeriods, tb, nextPnl, bs, nextGl, nextJournals] = await Promise.all([
        listPeriods(companyId),
        getTrialBalance(companyId, period.periodKey),
        getPnl(companyId, period.periodKey),
        getBalanceSheet(companyId, period.periodKey),
        getGeneralLedger(companyId, period.periodKey),
        listJournals(companyId, sourceId
          ? { ...(sourceType ? { sourceType } : {}), sourceId, page: 1, pageSize: 50 }
          : { periodId: period.id, page: 1, pageSize: 50 }),
      ]);
      setPeriods(nextPeriods);
      setTrialBalance(tb);
      setPnl(nextPnl);
      setBalanceSheet(bs);
      setGl(nextGl);
      setJournals(nextJournals.data);
      setJournalTotal(nextJournals.total);
    } catch (e) {
      setError(err(e));
    } finally {
      setLoading(false);
    }
  }, [companyId, periodKey, sourceId, sourceType]);

  useEffect(() => { void load(); }, [load]);

  async function checks() {
    if (!selectedPeriod) return;
    setError(null);
    try {
      setCloseRun(await runCloseChecks(companyId, selectedPeriod.id));
    } catch (e) {
      setError(err(e));
    }
  }

  async function close() {
    if (!selectedPeriod) return;
    if (!(await confirm({
      title: 'ปิดงวดบัญชี',
      message: 'เมื่อปิดงวดแล้วจะไม่สามารถบันทึกหรือแก้ไขรายการในงวดนี้ได้ ยืนยันการปิดงวดใช่หรือไม่',
    }))) return;
    setError(null);
    try {
      await closePeriod(companyId, selectedPeriod.id, `ปิดงวดจากหน้าสมุดรายวัน ${new Date().toISOString()}`);
      await load();
      toast.success('ปิดงวดเรียบร้อยแล้ว');
    } catch (e) {
      setError(err(e));
    }
  }

  return (
    <MangmeePage
      eyebrow="การเงินและบัญชี"
      title="สมุดรายวัน"
      description="บันทึกรายการที่ผ่านรายการแล้ว งบทดลอง งบการเงิน และการปิดงวด"
      actions={(
        <div className="flex flex-wrap items-center gap-2">
          <ThemedDate mode="month" aria-label="งวด" className={inputClass} value={periodKey} onChange={(e) => setPeriodKey(e.target.value)} />
          <button className={ghostClass} onClick={() => void load()} disabled={loading}>{loading ? 'กำลังโหลด...' : 'รีเฟรช'}</button>
          <button className={ghostClass} onClick={() => void checks()} disabled={!selectedPeriod}>ตรวจสอบก่อนปิดงวด</button>
          <button className={btnClass} onClick={() => void close()} disabled={!selectedPeriod || selectedPeriod.status === 'CLOSED'}>ปิดงวด</button>
        </div>
      )}
    >
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryBox label="งวด" value={`${formatThaiMonth(periodKey)} ${selectedPeriod ? `(${selectedPeriod.status})` : ''}`} />
        <SummaryBox label="ผลต่างงบทดลอง" value={money(trialBalance?.difference)} />
        <SummaryBox label="กำไรสุทธิ" value={money(pnl?.netProfit)} />
        <SummaryBox label="สินทรัพย์รวม" value={money(balanceSheet?.totalAssets)} />
      </div>

      <MangmeeCard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-gray-900">รายการ JV</div>
            <div className="mt-0.5 text-xs text-gray-500">
              {sourceId ? `กรองตามเอกสารต้นทาง ${sourceId}` : `${formatThaiMonth(periodKey)} · ${journalTotal} รายการ`}
            </div>
          </div>
          {sourceId && <a className="text-xs font-semibold text-brand-700 hover:underline" href={`/companies/${companyId}/journal`}>ล้างตัวกรอง</a>}
        </div>
        <div className="overflow-x-auto">
          <table className="mangmee-table">
            <thead><tr><th>เลขที่ JV</th><th>วันที่</th><th>เอกสารต้นทาง</th><th className="text-right">เดบิต</th><th className="text-right">เครดิต</th><th>สถานะ</th></tr></thead>
            <tbody>
              {journals.map((journal) => (
                <tr key={journal.id}>
                  <td className="whitespace-nowrap font-semibold text-brand-700">{journal.entryNumber}</td>
                  <td className="whitespace-nowrap">{formatThaiDate(journal.entryDate)}</td>
                  <td>
                    <div>{journal.memo ?? journal.sourceId ?? '-'}</div>
                    {journal.sourceType && <div className="mt-0.5 text-xs text-gray-400">{journal.sourceType}</div>}
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(journal.totalDebit)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{money(journal.totalCredit)}</td>
                  <td className="whitespace-nowrap">{journal.status}</td>
                </tr>
              ))}
              {!loading && journals.length === 0 && (
                <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={6}>{sourceId ? 'ยังไม่พบ JV ของเอกสารนี้' : 'ยังไม่มี JV ในงวดนี้'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </MangmeeCard>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <MangmeeCard className="overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">งบทดลอง</div>
            <div className="mangmee-table-scroll">
              <table className="mangmee-table">
              <thead><tr><th>บัญชี</th><th className="text-right">เดบิต</th><th className="text-right">เครดิต</th><th className="text-right">คงเหลือ</th></tr></thead>
              <tbody>
                {(trialBalance?.lines ?? []).map((line) => (
                  <tr key={line.accountId}>
                    <td>{line.accountCode} {line.accountNameTh}</td>
                    <td className="text-right">{money(line.totalDebit)}</td>
                    <td className="text-right">{money(line.totalCredit)}</td>
                    <td className="text-right">{money(line.balance)}</td>
                  </tr>
                ))}
                {!loading && (trialBalance?.lines.length ?? 0) === 0 && <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={4}>ยังไม่มีรายการที่ผ่านรายการในงวดนี้</td></tr>}
              </tbody>
              </table>
            </div>
          </MangmeeCard>

          <MangmeeCard className="overflow-hidden">
            <div className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">บัญชีแยกประเภท</div>
            <div className="mangmee-table-scroll">
              <table className="mangmee-table">
              <thead><tr><th>บัญชี</th><th className="text-right">เดบิต</th><th className="text-right">เครดิต</th><th className="text-right">คงเหลือปลายงวด</th></tr></thead>
              <tbody>
                {gl.map((line) => (
                  <tr key={line.accountId}>
                    <td>{line.accountCode} {line.accountNameTh}</td>
                    <td className="text-right">{money(line.totalDebit)}</td>
                    <td className="text-right">{money(line.totalCredit)}</td>
                    <td className="text-right">{money(line.endingBalance)}</td>
                  </tr>
                ))}
                {!loading && gl.length === 0 && <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={4}>ยังไม่มีความเคลื่อนไหวทางบัญชี</td></tr>}
              </tbody>
              </table>
            </div>
          </MangmeeCard>
        </div>

        <aside className="space-y-4">
          <MangmeeCard className="p-4">
            <h2 className="text-sm font-semibold text-gray-900">งบการเงิน</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">รายได้</dt><dd className="font-medium">{money(pnl?.revenue)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">ต้นทุน</dt><dd className="font-medium">{money(pnl?.totalCost)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">ค่าใช้จ่าย</dt><dd className="font-medium">{money(pnl?.totalExpense)}</dd></div>
              <div className="flex justify-between border-t border-gray-100 pt-2"><dt className="text-gray-500">กำไรสุทธิ</dt><dd className="font-bold">{money(pnl?.netProfit)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">หนี้สิน</dt><dd className="font-medium">{money(balanceSheet?.totalLiabilities)}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">ส่วนของเจ้าของ</dt><dd className="font-medium">{money(balanceSheet?.totalEquity)}</dd></div>
            </dl>
          </MangmeeCard>

          <MangmeeCard className="p-4">
            <h2 className="text-sm font-semibold text-gray-900">ตรวจสอบก่อนปิดงวด</h2>
            <div className="mt-3 space-y-2">
              {(closeRun?.checks ?? []).map((check) => (
                <div key={check.checkKey} className="rounded-lg border border-gray-100 px-3 py-2 text-sm">
                  <div className="flex justify-between gap-3"><span className="font-medium text-gray-900">{check.checkKey}</span><span className={check.status === 'PASSED' ? 'text-[#027A48]' : 'text-red-700'}>{check.status}</span></div>
                  <p className="mt-1 text-gray-500">{check.message}</p>
                </div>
              ))}
              {!closeRun && <p className="text-sm text-gray-400">กด "ตรวจสอบก่อนปิดงวด" ก่อนปิดงวดบัญชี</p>}
            </div>
          </MangmeeCard>

          <MangmeeCard className="p-4">
            <h2 className="text-sm font-semibold text-gray-900">ผังบัญชี Master Data</h2>
            <p className="mt-2 text-sm text-gray-500">ดูผังบัญชีทั้งหมด ตรวจ Template ความพร้อม และผลกระทบก่อนแก้ไข</p>
            <a
              className="mt-3 inline-flex text-sm font-semibold text-brand-700 hover:underline"
              href={`/companies/${companyId}/settings/chart-of-accounts`}
            >
              เปิดผังบัญชี Master Data →
            </a>
          </MangmeeCard>
        </aside>
      </section>
      {confirmDialog}
    </MangmeePage>
  );
}
