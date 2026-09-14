'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { Pp30BoxesDto, TaxReconciliationDetailDto, TaxReconciliationLineDto, TaxReconciliationRunDto, TaxReportForm } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { LoadingState } from '@/common/components/state/LoadingState';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { useBranchFilter } from '@/features/web-core-workspace/WorkspaceScope';
import { isBranchScope403 } from '@/features/web-core-workspace/branch-scope-label.logic';
import { createTaxReconciliation, getPp30Boxes, getTaxReconciliation, listTaxReconciliations, reviewTaxReconciliation } from './transaction-tax.api';
import { pp30SalesSideRecorded, transactionTaxCapabilities, transactionTaxErrorMessage } from './transaction-tax.model';
import { civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';

function sourceHref(companyId: string, line: TaxReconciliationLineDto): string {
  const params = new URLSearchParams({ sourceId: line.sourceId });
  if (line.sourceLineId) params.set('sourceLineId', line.sourceLineId);
  if (line.sourceType.startsWith('expense.')) return `/companies/${companyId}/expenses?expenseId=${encodeURIComponent(line.sourceId)}`;
  if (line.sourceType.startsWith('procurement.')) return `/companies/${companyId}/accounts-payable?billId=${encodeURIComponent(line.sourceId)}`;
  if (line.sourceType.startsWith('accounting.')) return `/companies/${companyId}/accounting?documentId=${encodeURIComponent(line.sourceId)}`;
  return `/companies/${companyId}/tax?${params.toString()}`;
}

const boxLabels: Record<keyof Pp30BoxesDto, string> = {
  box1TotalSales: '1 ยอดขายทั้งหมด', box2ZeroRatedSales: '2 ยอดขายอัตรา 0%', box3ExemptSales: '3 ยอดขายยกเว้น',
  box4TaxableSales: '4 ยอดขายที่เสียภาษี', box5OutputTax: '5 ภาษีขาย', box6EligiblePurchases: '6 ยอดซื้อที่มีสิทธิ์',
  box7InputTax: '7 ภาษีซื้อ', box8TaxPayable: '8 ภาษีต้องชำระ', box9TaxOverpaid: '9 ภาษีชำระเกิน',
};

export function TaxReconciliationPage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const toast = useToast();
  const capability = transactionTaxCapabilities(permissions);
  const branch = useBranchFilter();
  const [formType, setFormType] = useState<Extract<TaxReportForm, 'PP30' | 'PP36' | 'CUSTOMS_SUPPORT'>>('PP30');
  const [periodKey, setPeriodKey] = useState(civilPeriodKey(todayCivilDate()));
  const [detail, setDetail] = useState<TaxReconciliationDetailDto | null>(null);
  const [history, setHistory] = useState<TaxReconciliationRunDto[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [boxes, setBoxes] = useState<Pp30BoxesDto | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try { setHistory(await listTaxReconciliations(companyId, { formType, periodKey, branchId: branch?.branchId || undefined, page: 1, pageSize: 20 })); }
    catch (cause) {
      if (isBranchScope403(cause, branch?.branchId)) { branch?.reportBranchForbidden(); return; }
      setError(transactionTaxErrorMessage(cause));
    }
    finally { setHistoryLoading(false); }
  }, [branch?.branchId, companyId, formType, periodKey]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function loadRun(run: TaxReconciliationRunDto) {
    if (!['PP30', 'PP36', 'CUSTOMS_SUPPORT'].includes(run.formType)) return;
    setBusy(true); setError('');
    try {
      const [nextDetail, nextBoxes] = await Promise.all([
        getTaxReconciliation(companyId, run.id, { page: 1, pageSize: 100 }),
        run.formType === 'PP30' ? getPp30Boxes(companyId, run.periodKey, run.branchId || undefined) : Promise.resolve(null),
      ]);
      setFormType(run.formType as 'PP30' | 'PP36' | 'CUSTOMS_SUPPORT'); setPeriodKey(run.periodKey); setDetail(nextDetail); setBoxes(nextBoxes);
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }

  async function generate() {
    setBusy(true); setError('');
    try {
      const run = await createTaxReconciliation(companyId, { formType, periodKey, branchId: branch?.branchId || undefined });
      const [nextDetail, nextBoxes] = await Promise.all([
        getTaxReconciliation(companyId, run.id, { page: 1, pageSize: 100 }),
        formType === 'PP30' ? getPp30Boxes(companyId, periodKey, branch?.branchId || undefined) : Promise.resolve(null),
      ]);
      setDetail(nextDetail); setBoxes(nextBoxes);
      await loadHistory();
    } catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }
  async function review() {
    if (!detail) return;
    setBusy(true); setError('');
    try { await reviewTaxReconciliation(companyId, detail.id, note || undefined); setDetail(await getTaxReconciliation(companyId, detail.id, { page: 1, pageSize: 100 })); toast.success('ยืนยันการตรวจสอบเรียบร้อยแล้ว'); }
    catch (cause) { setError(transactionTaxErrorMessage(cause)); } finally { setBusy(false); }
  }

  if (!capability.canReadReports) return <MangmeePage title="Tax Reconciliation"><MangmeeCard className="p-6 text-sm text-red-700">คุณไม่มีสิทธิ์อ่านรายงานภาษี</MangmeeCard></MangmeePage>;
  return (
    <MangmeePage title="PP30 / PP36 / Customs Reconciliation" description="กระทบยอด Source → Tax Event → Journal → ช่องรายงาน พร้อม deep link กลับรายการต้นทาง โดยแยก Customs Support ออกจาก ภ.พ.30">
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <MangmeeCard className="mb-5 p-4">
        <div className="grid items-end gap-3 sm:grid-cols-4">
          <label className="text-xs font-bold text-gray-600">แบบ<ThemedSelect value={formType} onChange={(event) => setFormType(event.target.value as 'PP30' | 'PP36' | 'CUSTOMS_SUPPORT')}><option value="PP30">ภ.พ.30</option><option value="PP36">ภ.พ.36</option><option value="CUSTOMS_SUPPORT">Customs / Excise support</option></ThemedSelect></label>
          <label className="text-xs font-bold text-gray-600">รอบภาษี<ThemedDate mode="month" value={periodKey} onChange={(event) => setPeriodKey(event.target.value)} className="mangmee-input w-full" /></label>
          <div className="text-xs text-gray-500">สาขา: {branch?.branchId || 'ทุกสาขาในขอบเขต'}</div>
          {capability.canRecomputeReports && <button disabled={busy || !periodKey} aria-busy={Boolean(busy)} onClick={() => void generate()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy ? 'กำลังประมวลผล...' : 'สร้าง Reconciliation'}</button>}
        </div>
      </MangmeeCard>
      <MangmeeCard className="mb-5 overflow-hidden">
        <div className="border-b border-gray-100 p-4"><strong>ผล Reconciliation ล่าสุด</strong><p className="text-xs text-gray-500">ผู้มีสิทธิ์อ่านรายงานเปิดผลเดิมได้โดยไม่ต้อง recompute</p></div>
        {historyLoading ? <LoadingState label="กำลังโหลด..." /> : !history.length ? <div className="p-6 text-center text-sm text-gray-500">ยังไม่มีผลในตัวกรองนี้</div> : <div className="divide-y divide-gray-100">{history.map((run) => <button key={run.id} type="button" onClick={() => void loadRun(run)} className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-gray-50"><span><strong>{run.formType} · {run.periodKey}</strong><span className="ml-2 text-xs text-gray-500">{formatThaiDateTime(run.createdAt)}</span></span><span className={`rounded-full px-2 py-1 text-xs font-bold ${run.blockingIssueCount ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{run.status} · {run.blockingIssueCount}</span></button>)}</div>}
      </MangmeeCard>
      {boxes && !pp30SalesSideRecorded(boxes) && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"><strong>ระบบบันทึกเฉพาะฝั่งภาษีซื้อ (box 6–7)</strong> — งวดนี้ยังไม่มีเอกสารฝั่งขายในระบบ ยอด box 8/9 จึงยังไม่ใช่ยอดยื่นจริง กรุณารวมยอดขายจากระบบขายของกิจการก่อนยื่น ภ.พ.30</div>}
      {boxes && <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(Object.entries(boxes) as Array<[keyof Pp30BoxesDto, string]>).map(([key, value]) => <MangmeeCard key={key} className="p-4"><div className="text-xs font-bold text-gray-500">{boxLabels[key]}</div>{(key === 'box8TaxPayable' || key === 'box9TaxOverpaid') && !pp30SalesSideRecorded(boxes)
        ? <div className="mt-1 text-xl font-bold text-gray-400">—</div>
        : <div className="mt-1 text-xl font-bold text-gray-900">{Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2 })}</div>}</MangmeeCard>)}</div>}
      {!detail ? <MangmeeCard className="p-10 text-center text-sm text-gray-500">เลือกแบบและรอบภาษีเพื่อสร้างผลกระทบยอด</MangmeeCard> : <>
        <MangmeeCard className="mb-5 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{detail.formType} · {detail.periodKey}</strong><div className="text-xs text-gray-500">checksum {detail.checksum} · {detail.total} lines</div></div><div className="flex flex-wrap items-center gap-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${detail.blockingIssueCount ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>{detail.blockingIssueCount} blocking · {detail.status}</span>{detail.status !== 'REVIEWED' && capability.canReviewIssues && <><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="หมายเหตุการตรวจ" className="mangmee-input min-w-[10rem] flex-1" /><button disabled={busy || detail.blockingIssueCount > 0} aria-busy={Boolean(busy)} onClick={() => void review()} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">ยืนยันตรวจแล้ว</button></>}</div></div>{detail.blockingIssueCount > 0 && <p className="mt-2 text-xs text-red-700">ต้องแก้ blocking issues ที่ source/config ก่อนจึงจะ mark reviewed ได้</p>}</MangmeeCard>
        <MangmeeCard className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead className="bg-gray-50 text-gray-600"><tr><th className="p-3">Source</th><th className="p-3">Tax Code / Component</th><th className="p-3">Source</th><th className="p-3">Event</th><th className="p-3">Journal</th><th className="p-3">Report</th><th className="p-3">Delta S/E · E/J · E/R</th><th className="p-3">Issue</th></tr></thead><tbody className="divide-y">{detail.lines.map((line) => <tr key={line.id} className={line.blocking ? 'bg-red-50' : ''}><td className="p-3"><Link href={sourceHref(companyId, line)} className="font-bold text-brand-700">{line.sourceType}<br />{line.sourceId.slice(0, 12)}…</Link>{line.taxEventId && <div className="mt-1 text-gray-500">event {line.taxEventId.slice(0, 8)}</div>}{line.journalEntryId && <div className="text-gray-500">journal {line.journalEntryId.slice(0, 8)}</div>}</td><td className="p-3">{line.externalTaxCode || '—'}<br />{line.componentKey}</td><td className="p-3">{line.sourceBaseAmount}<br />tax {line.sourceTaxAmount}</td><td className="p-3">{line.eventBaseAmount}<br />tax {line.eventTaxAmount}</td><td className="p-3">{line.journalTaxAmount}</td><td className="p-3">{line.reportAmount}</td><td className="p-3">{line.sourceEventDelta}<br />{line.eventJournalDelta}<br />{line.eventReportDelta}</td><td className={`p-3 font-bold ${line.blocking ? 'text-red-700' : 'text-emerald-700'}`}>{line.issueCode}</td></tr>)}</tbody></table>{!detail.lines.length && <div className="p-10 text-center text-sm text-gray-500">ไม่พบ transaction-tax line ในรอบนี้</div>}</MangmeeCard>
      </>}
    </MangmeePage>
  );
}
