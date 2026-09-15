'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { ForbiddenState } from '@/common/components/state';
import { LoadingState } from '@/common/components/state/LoadingState';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { formatThaiDate, formatThaiMonth } from '@/common/i18n/thai-date';
import {
  listTaxPeriods,
  syncTaxEvents,
  listTaxEvents,
  listReviewIssues,
  generateVatReport,
  generateWhtReport,
  generateFilingPackage,
  markFiled,
  markPaid,
  listWhtCategories,
  setWhtCategoryStatus,
  type WhtCategory,
  type TaxPeriod,
  type TaxEvent,
  type ReviewIssue,
  type SyncResult,
  type TaxExportFormat,
  type TaxExportArtifact,
} from './tax.api';
import { useToast } from '@/common/components/toast';
import { canSeeRoute } from '@/features/web-core-workspace/route-permissions';

const inputClass = 'mangmee-input';
const btnClass = 'mangmee-btn mangmee-btn-primary disabled:cursor-not-allowed disabled:opacity-50';
const ghostClass = 'mangmee-btn mangmee-btn-secondary disabled:cursor-not-allowed disabled:opacity-50';
const dangerClass = 'mangmee-btn mangmee-btn-danger disabled:cursor-not-allowed disabled:opacity-50';

function money(v?: string | null) {
  return Number(v ?? '0').toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function err(e: unknown) { return apiErrorMessage(e); }
function downloadArtifact(artifact: TaxExportArtifact) {
  const bytes = Uint8Array.from(atob(artifact.contentBase64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: artifact.mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = artifact.fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_BADGE: Record<string, string> = {
  OPEN: 'bg-gray-100 text-gray-700',
  NEEDS_REVIEW: 'bg-warning-100 text-warning-700',
  READY_FOR_REVIEW: 'bg-blue-light-50 text-blue-700',
  REVIEWED: 'bg-brand-100 text-brand-700',
  EXPORTED: 'bg-indigo-100 text-indigo-700',
  FILED: 'bg-teal-100 text-teal-700',
  PAID: 'bg-success-50 text-success-700',
  CLOSED: 'bg-slate-100 text-slate-700',
  AMENDED: 'bg-orange-100 text-orange-700',
};

const FORM_LABELS: Record<string, string> = {
  PP30: 'ภ.พ.30 (VAT)',
  PP36: 'ภ.พ.36 (VAT ต่างประเทศ)',
  PND3: 'ภ.ง.ด.3 (WHT บุคคลธรรมดา)',
  PND53: 'ภ.ง.ด.53 (WHT นิติบุคคล)',
  PND50: 'ภ.ง.ด.50 (CIT รายปี)',
  PND51: 'ภ.ง.ด.51 (CIT ครึ่งปี)',
};

const SEVERITY_BADGE: Record<string, string> = {
  INFO: 'bg-blue-light-50 text-blue-700',
  WARNING: 'bg-warning-50 text-warning-700',
  BLOCKING: 'bg-error-50 text-error-700',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  VAT_OUTPUT: 'ภาษีขาย',
  VAT_INPUT: 'ภาษีซื้อ',
  VAT_EXEMPT: 'ยกเว้น VAT',
  VAT_REVIEW: 'รอตรวจสอบ VAT',
  WHT_PND3: 'หัก ณ ที่จ่าย (บุคคล)',
  WHT_PND53: 'หัก ณ ที่จ่าย (นิติบุคคล)',
};

function Badge({ status, className }: { status: string; className?: string }) {
  const cls = className ?? STATUS_BADGE[status] ?? 'bg-gray-100 text-gray-700';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{status}</span>;
}

function EmptyRow({ cols, text }: { cols: number; text: string }) {
  return <tr><td colSpan={cols} className="px-4 py-6 text-center text-sm text-gray-400">{text}</td></tr>;
}

export function TaxWorkspacePage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const toast = useToast();
  const can = (permission: string) => permissions.includes(permission);
  const canSeeWorkspace = canSeeRoute('/tax', permissions);
  const [tab, setTab] = useState<'VAT' | 'WHT' | 'CIT'>('VAT');
  const [periods, setPeriods] = useState<TaxPeriod[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<TaxPeriod | null>(null);
  const [events, setEvents] = useState<TaxEvent[]>([]);
  const [issues, setIssues] = useState<ReviewIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const loadPeriods = useCallback(async () => {
    if (!canSeeWorkspace) { setPeriods([]); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await listTaxPeriods(companyId, { taxType: tab });
      setPeriods(res.items);
    } catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  }, [canSeeWorkspace, companyId, tab]);

  const loadPeriodDetail = useCallback(async (period: TaxPeriod) => {
    setSelectedPeriod(period);
    setEvents([]);
    setIssues([]);
    setDetailLoading(true);
    try {
      const [evts, iss] = await Promise.all([
        can('tax.event.read') ? listTaxEvents(companyId, period.id) : Promise.resolve([]),
        can('tax.review_issue.read') ? listReviewIssues(companyId, period.id) : Promise.resolve([]),
      ]);
      setEvents(evts);
      setIssues(iss);
    } catch (e) { setError(err(e)); }
    finally { setDetailLoading(false); }
  }, [companyId, permissions]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    setMessage(null);
    try {
      const res = await syncTaxEvents(companyId);
      setSyncResult(res);
      await loadPeriods();
    } catch (e) { setError(err(e)); }
    finally { setSyncing(false); }
  }, [companyId, loadPeriods]);

  const handleMarkFiled = useCallback(async () => {
    if (!selectedPeriod) return;
    setBusyAction('mark-filed');
    try {
      const updated = await markFiled(companyId, selectedPeriod.id, note || undefined);
      setSelectedPeriod(updated);
      await loadPeriods();
      toast.success('บันทึกการยื่นแบบเรียบร้อยแล้ว');
    } catch (e) { setError(err(e)); }
    finally { setBusyAction(null); }
  }, [companyId, selectedPeriod, note, loadPeriods, toast]);

  const handleMarkPaid = useCallback(async () => {
    if (!selectedPeriod) return;
    setBusyAction('mark-paid');
    try {
      const updated = await markPaid(companyId, selectedPeriod.id, note || undefined);
      setSelectedPeriod(updated);
      await loadPeriods();
      toast.success('บันทึกการชำระภาษีเรียบร้อยแล้ว');
    } catch (e) { setError(err(e)); }
    finally { setBusyAction(null); }
  }, [companyId, selectedPeriod, note, loadPeriods, toast]);

  const handleGenerateReport = useCallback(async () => {
    if (!selectedPeriod) return;
    setBusyAction('report');
    setError(null);
    setMessage(null);
    try {
      if (selectedPeriod.taxType === 'VAT') {
        await generateVatReport(companyId, selectedPeriod.id, selectedPeriod.periodKey, selectedPeriod.formType === 'PP36' ? 'PP36' : 'PP30');
      } else if (selectedPeriod.taxType === 'WHT') {
        await generateWhtReport(companyId, selectedPeriod.id, selectedPeriod.periodKey, selectedPeriod.formType === 'PND3' ? 'PND3' : 'PND53');
      }
      setMessage('คำนวณรายงานสำเร็จ');
    } catch (e) { setError(err(e)); }
    finally { setBusyAction(null); }
  }, [companyId, selectedPeriod]);

  const handleExport = useCallback(async (format: TaxExportFormat) => {
    if (!selectedPeriod) return;
    setBusyAction(`export-${format}`);
    setError(null);
    setMessage(null);
    try {
      const result = await generateFilingPackage(companyId, selectedPeriod.id, format);
      downloadArtifact(result.artifact);
      setMessage(`สร้าง export ${result.exportNumber} สำเร็จ`);
      await loadPeriods();
    } catch (e) { setError(err(e)); }
    finally { setBusyAction(null); }
  }, [companyId, selectedPeriod, loadPeriods]);

  useEffect(() => { loadPeriods(); setSelectedPeriod(null); setEvents([]); setIssues([]); }, [loadPeriods]);

  const isLocked = selectedPeriod ? ['FILED', 'PAID', 'CLOSED'].includes(selectedPeriod.status) : false;

  if (!canSeeWorkspace) return <ForbiddenState />;

  return (
    <MangmeePage
      eyebrow="การเงินและบัญชี"
      title="ภาษี"
      description="บริหารจัดการ VAT / WHT / CIT สำหรับบัญชี"
      actions={(
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          {can('tax.config.read') && <Link href={`/companies/${companyId}/settings/tax-codes`} className={ghostClass}>Tax Code</Link>}
          {can('ledger.posting-rule.read') && <Link href={`/companies/${companyId}/settings/tax-accounts`} className={ghostClass}>บัญชีภาษี</Link>}
          {can('tax.report.read') && <Link href={`/companies/${companyId}/tax/reconciliation`} className={ghostClass}>Reconciliation</Link>}
          {can('tax.config.read') && <Link href={`/companies/${companyId}/tax/evidence`} className={ghostClass}>หลักฐานนำเข้า/ส่งออก</Link>}
          {can('tax.event.sync') && <button onClick={handleSync} disabled={syncing} aria-busy={Boolean(syncing)} className={btnClass}>{syncing ? 'กำลังซิงค์...' : 'ซิงค์แหล่งข้อมูล'}</button>}
        </div>
      )}
    >

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && <div className="rounded-lg border border-blue-200 bg-blue-light-50 px-4 py-3 text-sm text-blue-700">{message}</div>}

        {syncResult && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            ซิงค์สำเร็จ: ภาษีขาย {syncResult.vatOutputCreated} · ภาษีซื้อ {syncResult.vatInputCreated} · WHT {syncResult.whtCreated} · ปัญหา {syncResult.reviewIssuesCreated} · ล็อก {syncResult.skippedLocked}
          </div>
        )}

        {/* Tabs */}
        <div className="mangmee-segmented w-fit max-w-full overflow-x-auto">
          {(['VAT', 'WHT', 'CIT'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`mangmee-tab whitespace-nowrap ${tab === t ? 'mangmee-tab-active' : 'hover:text-gray-700'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'WHT' && <WhtIncomeCategoryPanel companyId={companyId} canManage={can('tax.config.manage')} canRead={can('tax.config.read')} />}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Period list */}
          <div>
            <MangmeeCard className="overflow-hidden">
              <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">
                งวด {tab}
              </div>
              {loading && <div className="px-4 py-6 text-center text-sm text-gray-400">กำลังโหลด...</div>}
              {!loading && periods.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-gray-400">ยังไม่มีงวด — กด ซิงค์แหล่งข้อมูล เพื่อเริ่มต้น</div>
              )}
              <ul>
                {periods.map(p => (
                  <li key={p.id}>
                    <button
                      onClick={() => loadPeriodDetail(p)}
                      className={`w-full px-4 py-3 text-left hover:bg-gray-50 ${selectedPeriod?.id === p.id ? 'bg-brand-25' : ''}`}
                    >
                      <div className="flex flex-wrap items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">{formatThaiMonth(p.periodKey)}</span>
                        <Badge status={p.status} />
                      </div>
                      <div className="text-xs text-gray-500">{FORM_LABELS[p.formType] ?? p.formType}</div>
                      {p.dueDate && <div className="text-xs text-gray-400">ครบกำหนด {formatThaiDate(p.dueDate)}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            </MangmeeCard>
          </div>

          {/* Period detail */}
          <div className="space-y-4 lg:col-span-2">
            {!selectedPeriod && (
              <MangmeeCard className="flex h-48 items-center justify-center text-sm text-gray-400">
                เลือกงวดเพื่อดูรายละเอียด
              </MangmeeCard>
            )}

            {selectedPeriod && (detailLoading ? <LoadingState label="กำลังโหลด..." /> : (
              <>
                {/* Period header */}
                <MangmeeCard className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">
                        {FORM_LABELS[selectedPeriod.formType] ?? selectedPeriod.formType} — {formatThaiMonth(selectedPeriod.periodKey)}
                      </h2>
                      <div className="mt-1 flex gap-2">
                        <Badge status={selectedPeriod.status} />
                        {isLocked && <span className="text-xs text-red-600 font-medium">ล็อกแล้ว (ไม่สามารถแก้ไข)</span>}
                      </div>
                    </div>
                    {!isLocked && (can('tax.filing.mark_filed') || can('tax.filing.mark_paid')) && (
                      <div className="flex flex-wrap justify-end gap-2 gap-y-2">
                        <input
                          type="text"
                          value={note}
                          onChange={e => setNote(e.target.value)}
                          placeholder="หมายเหตุ (ถ้ามี)"
                          className={`${inputClass} w-40`}
                        />
                        {can('tax.filing.mark_filed') && <button onClick={handleMarkFiled} disabled={busyAction !== null} aria-busy={Boolean(busyAction === 'mark-filed')} className={ghostClass}>{busyAction === 'mark-filed' ? 'กำลังบันทึก...' : 'ยื่นแบบแล้ว'}</button>}
                        {can('tax.filing.mark_paid') && <button onClick={handleMarkPaid} disabled={busyAction !== null} aria-busy={Boolean(busyAction === 'mark-paid')} className={ghostClass}>{busyAction === 'mark-paid' ? 'กำลังบันทึก...' : 'ชำระแล้ว'}</button>}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                    {selectedPeriod.taxType !== 'CIT' && can('tax.report.recompute') && (
                      <button onClick={handleGenerateReport} disabled={busyAction !== null} aria-busy={Boolean(busyAction === 'report')} className={ghostClass}>{busyAction === 'report' ? 'กำลังคำนวณ...' : 'คำนวณรายงาน'}</button>
                    )}
                    {can('tax.report.export') && (['REVIEW_JSON', 'CSV', 'XLSX', 'PDF'] as TaxExportFormat[]).map(format => (
                      <button key={format} onClick={() => handleExport(format)} disabled={busyAction !== null} aria-busy={Boolean(busyAction === `export-${format}`)} className={ghostClass}>
                        {busyAction === `export-${format}` ? 'กำลังส่งออก...' : `Export ${format}`}
                      </button>
                    ))}
                  </div>
                </MangmeeCard>

                {/* Review issues */}
                {issues.length > 0 && (
                  <MangmeeCard className="border-yellow-200 p-4">
                    <div className="mb-3 text-sm font-medium text-yellow-800">ปัญหาที่ต้องตรวจสอบ ({issues.filter(i => i.status === 'OPEN').length} รายการเปิด)</div>
                    <div className="mangmee-table-scroll">
                      <table className="mangmee-table">
                      <thead>
                        <tr className="border-b text-xs text-gray-500">
                          <th className="pb-2 text-left">ความรุนแรง</th>
                          <th className="pb-2 text-left">รหัส</th>
                          <th className="pb-2 text-left">คำอธิบาย</th>
                          <th className="pb-2 text-left">สถานะ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {issues.map(issue => (
                          <tr key={issue.id} className="border-b last:border-0">
                            <td className="py-2"><span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_BADGE[issue.severity] ?? 'bg-gray-100'}`}>{issue.severity}</span></td>
                            <td className="py-2 font-mono text-xs text-gray-600">{issue.issueCode}</td>
                            <td className="py-2 text-gray-700">{issue.description}</td>
                            <td className="py-2"><Badge status={issue.status} /></td>
                          </tr>
                        ))}
                      </tbody>
                      </table>
                    </div>
                  </MangmeeCard>
                )}

                {/* Tax events */}
                <MangmeeCard className="overflow-hidden">
                  <div className="border-b border-gray-100 px-4 py-3 text-sm font-medium text-gray-700">
                    รายการภาษี ({events.length} รายการ)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="mangmee-table">
                      <thead>
                        <tr>
                          <th>วันที่</th>
                          <th>ประเภท</th>
                          <th>Tax Code</th>
                          <th className="text-right">ฐานภาษี</th>
                          <th className="text-right">ภาษี</th>
                          <th>สถานะ</th>
                          <th>แหล่งข้อมูล</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.length === 0 && <EmptyRow cols={7} text="ไม่มีรายการภาษี" />}
                        {events.map(e => (
                          <tr key={e.id} className="border-b last:border-0 hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-600">{formatThaiDate(e.eventDate)}</td>
                            <td className="px-4 py-2">{EVENT_TYPE_LABELS[e.eventType] ?? e.eventType}</td>
                            <td className="px-4 py-2 font-mono text-gray-700">{e.outputTaxCode ?? '-'}</td>
                            <td className="px-4 py-2 text-right font-mono text-gray-700">{money(e.taxableBase)}</td>
                            <td className="px-4 py-2 text-right font-mono text-gray-900">{money(e.taxAmount)}</td>
                            <td className="px-4 py-2"><Badge status={e.status} /></td>
                            <td className="px-4 py-2 text-xs text-gray-400">{e.sourceType}/{e.sourceId.slice(-8)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </MangmeeCard>
              </>
            ))}
          </div>
        </div>
    </MangmeePage>
  );
}

/**
 * The catalog every withholding decision picks from.
 *
 * It ships DRAFT on purpose — the seed stamps "Accountant verification required" on all 15 rows —
 * and until an accountant activates a row nothing may withhold under it. This panel is where that
 * verification is recorded; without it the pay-side withholding form has an empty dropdown and the
 * whole feature is unreachable.
 */
function WhtIncomeCategoryPanel({ companyId, canManage, canRead }: { companyId: string; canManage: boolean; canRead: boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<WhtCategory[]>([]);
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!canRead) return;
    listWhtCategories(companyId).then(setRows).catch((cause) => setError(apiErrorMessage(cause)));
  }, [companyId, canRead]);
  useEffect(() => { load(); }, [load]);

  if (!canRead) return null;
  const active = rows.filter((row) => row.status === 'ACTIVE').length;

  async function toggle(row: WhtCategory) {
    setBusyCode(row.code); setError('');
    try {
      const next = await setWhtCategoryStatus(companyId, row.code, row.status === 'ACTIVE' ? 'DRAFT' : 'ACTIVE');
      setRows((current) => current.map((item) => item.code === row.code ? { ...item, status: next.status } : item));
      toast.success(row.status === 'ACTIVE' ? 'คืนหมวดเงินได้เป็นร่างเรียบร้อยแล้ว' : 'เปิดใช้งานหมวดเงินได้เรียบร้อยแล้ว');
    } catch (cause) { setError(apiErrorMessage(cause)); } finally { setBusyCode(null); }
  }

  return (
    <MangmeeCard className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-gray-700">หมวดเงินได้ หัก ณ ที่จ่าย</div>
          <div className="text-xs text-gray-500">เปิดใช้งานแล้ว {active} จาก {rows.length} หมวด — หมวดที่ยังไม่เปิดจะเลือกตอนบันทึกจ่ายไม่ได้</div>
        </div>
      </div>
      {error && <div className="px-4 py-2 text-xs text-error-600">{error}</div>}
      {active === 0 && rows.length > 0 && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          ยังไม่มีหมวดที่เปิดใช้งาน — ผู้ทำบัญชีต้องตรวจอัตราตามประกาศกรมสรรพากรแล้วกดเปิดใช้งานก่อน จึงจะหักภาษี ณ ที่จ่ายตอนจ่ายเจ้าหนี้ได้
        </div>
      )}
      <div className="mangmee-table-scroll">
        <table className="mangmee-table min-w-full">
          <thead><tr><th>หมวดเงินได้</th><th>แบบ</th><th>อัตรา</th><th>สถานะ</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">ไม่พบหมวดเงินได้</td></tr>}
            {rows.map((row) => (
              <tr key={row.code}>
                <td>{row.nameTh}<small className="block font-mono text-xs text-gray-400">{row.code}</small></td>
                <td>{row.formType === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53'}</td>
                <td className="tabular-nums">{Number(row.defaultRate)}%</td>
                <td><Badge status={row.status} /></td>
                <td>
                  {canManage && (
                    <button
                      className={row.status === 'ACTIVE' ? ghostClass : btnClass}
                      disabled={busyCode === row.code} aria-busy={Boolean(busyCode === row.code)}
                      onClick={() => void toggle(row)}
                    >
                      {row.status === 'ACTIVE' ? 'คืนเป็นร่าง' : 'เปิดใช้งาน'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MangmeeCard>
  );
}
