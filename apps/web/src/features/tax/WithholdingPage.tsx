'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { companyProfilePath, type WithholdingMonthDto, type WithholdingMonthFormDto, type WithholdingMonthIssueDto, type WhtFormType } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, MangmeePage, MetricGrid } from '@/common/components/mangmee';
import { secondaryButtonClass } from '@/common/components/button';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FilterTabs } from '@/common/components/tabs';
import { Notice } from '@/common/components/notice';
import { SelectField } from '@/common/components/field';
import { Pagination } from '@/common/components/data-table/Pagination';
import { ForbiddenState, LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { useConfirm } from '@/common/components/modal/use-confirm';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { downloadArtifact } from '@/common/files/download-artifact';
import { formatThaiDate, formatThaiMonth } from '@/common/i18n/thai-date';
import { downloadSystemWhtCertificate } from '../expenses/expenses.api';
import { amountText } from '../expenses/ExpensesUi';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { MoreActions } from '@/common/components/actions/MoreActions';
import styles from '../expenses/WhtCertificatesPage.module.css';
import { confirmWithholdingRows, exportWithholding, getWithholdingMonth, listWithholdingMonths, markWithholdingFiled, syncWithholding } from './tax.api';

const baht = (value: string) => `${amountText(value)} บาท`;
const button = secondaryButtonClass;
const downloadLabel = (form: WhtFormType) => form === 'PND3' ? 'ดาวน์โหลดแบบ ภ.ง.ด.3' : 'ดาวน์โหลดแบบ ภ.ง.ด.53';
export function withholdingErrorMessage(error: unknown): string {
  return apiErrorMessage(error);
}
const formName = (form: WhtFormType | 'PND2') => form === 'PND2' ? 'ภ.ง.ด.2' : form === 'PND3' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53';
export const withholdingState = (status: string | null) => ['FILED', 'PAID', 'CLOSED'].includes(status ?? '') ? 'ยื่นแล้ว' : status === 'EXPORTED' ? 'ดาวน์โหลดแบบแล้ว' : 'ยังไม่ได้ยื่น';
export function withholdingPaymentPage(rows: WithholdingMonthDto['payments'], filter: string, page: number, pageSize = 10, order: 'newest' | 'oldest' = 'newest') {
  const filtered = rows.filter(row => filter === 'ALL' || row.formType === filter).sort((a, b) => ((a.paymentDate ?? '').localeCompare(b.paymentDate ?? '') || a.id.localeCompare(b.id)) * (order === 'oldest' ? 1 : -1));
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  return { rows: filtered.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize), totalPages, total: filtered.length };
}
const isSourceIssue = (issue: WithholdingMonthIssueDto) => !!(issue.sourceId || issue.expenseId || issue.counterpartyId)
  || issue.issueCode === 'WHT_PAYEE_KIND_UNKNOWN' || /_FILING_REVIEW$/.test(issue.issueCode);
function Issue({ issue, companyId, permissions }: { issue: WithholdingMonthIssueDto; companyId: string; permissions: string[] }) {
  const payer = /_FILING_PAYER$/.test(issue.issueCode);
  const kind = /KIND/.test(issue.issueCode);
  const canEditExpense = permissions.includes('expense.read') && permissions.includes('expense.update') && permissions.includes('expense.confirm');
  const canEditPayee = permissions.includes('accounting.counterparty.read') && permissions.includes('accounting.counterparty.manage');
  const expenseHref = issue.expenseId && canEditExpense ? `/companies/${companyId}/expenses/${issue.expenseId}` : null;
  const payeeHref = issue.counterpartyId && canEditPayee ? `/companies/${companyId}/counterparties/${issue.counterpartyId}` : null;
  const href = payer ? permissions.includes('company.setup.read') ? `${companyProfilePath(companyId)}?from=withholding` : null
    : kind ? payeeHref ?? expenseHref : expenseHref ?? payeeHref;
  const canReadExpenses = ['expense.read', 'expense.read_own', 'expense.read_related'].some(permission => permissions.includes(permission));
  const actionHref = href ?? (canReadExpenses ? `/companies/${companyId}/expenses` : null);
  return <Notice tone="warning" action={actionHref ? <Link className="inline-flex min-h-11 items-center underline" href={actionHref}>{href ? payer ? 'ตั้งค่าร้าน › ข้อมูลร้าน' : href === payeeHref ? 'เปิดคู่ค้า' : 'เปิดค่าใช้จ่าย' : 'กลับไปรายการค่าใช้จ่าย'}</Link> : undefined}>
    {issue.description}{payer && !permissions.includes('company.legal_identity.manage') && ' ให้เจ้าของกิจการหรือผู้มีสิทธิ์แก้ข้อมูลร้านตรวจข้อมูลให้ครบ'}{!href && !payer && (issue.expenseId || issue.counterpartyId) && ' ให้ผู้มีสิทธิ์แก้รายการนี้เป็นผู้แก้'}
  </Notice>;
}
type PaperAction = WithholdingMonthFormDto & { id?: string | null; sequence?: number; filedAt?: string | null };
export const withholdingPaperName = (sequence = 0) => sequence ? `ยื่นเพิ่มเติมครั้งที่ ${sequence}` : 'ยื่นปกติ';
export function WithholdingFormCard({ form, periodKey, companyId, permissions, busy, error, paperErrors = {}, centralIssues = false, onDownload, onFiled, onConfirmRows }: {
  form: WithholdingMonthFormDto; periodKey: string; companyId: string; permissions: string[]; busy: boolean; error?: string; paperErrors?: Record<string, string>; centralIssues?: boolean;
  onDownload: (paper?: PaperAction) => void; onFiled: (paper?: PaperAction) => void; onConfirmRows?: (paper: PaperAction) => void;
}) {
  const papers: PaperAction[] = form.papers?.length ? [...form.papers].sort((a, b) => a.sequence - b.sequence).map(paper => ({ ...paper, issues: paper.issues.filter(issue => !['WHT_PAYEE_KIND_UNKNOWN', 'WHT_PAYER_MODE_REQUIRED'].includes(issue.issueCode) || form.issues.some(i => i.issueCode === issue.issueCode)) })) : [form];
  const multiple = papers.length > 1;
  const totals = form.monthTotals ?? form;
  return <MangmeeCard className="flex min-w-0 flex-col gap-4 p-4">
    <h2 className="text-base font-semibold">{formName(form.formType)} {form.formType === 'PND3' ? '(จ่ายให้บุคคล)' : '(จ่ายให้บริษัท)'}</h2>
    {!multiple && <PaperStatus form={papers[0]!} />}
    <MetricGrid columns={3} items={[
      { key: 'count', label: 'รายการ', value: String(totals.paymentCount), unit: 'รายการ', dot: 'bg-gray-400' },
      { key: 'paid', label: 'ยอดจ่าย', value: amountText(totals.totalPaid), unit: 'บาท', dot: 'bg-brand-500' },
      { key: 'withheld', label: 'ภาษีที่หักไว้', value: amountText(totals.totalWithheld), unit: 'บาท', dot: 'bg-brand-500' },
    ]} />
    <p className="text-sm text-gray-500">กำหนดยื่น {formatThaiDate(form.dueDate, '')}</p>
    {!multiple && !!form.unfiledPaymentCount && !form.rowsUncertainNotice && !form.issues.some(issue => issue.issueCode === 'WHT_FILED_PAYMENT_OMITTED') && <Notice tone="warning">มีรายการที่ยังไม่อยู่ในแบบที่ยื่น {form.unfiledPaymentCount} รายการ ให้ผู้ทำบัญชียื่นเพิ่มเติม</Notice>}
    <div className="mt-auto pt-2 space-y-4">{papers.map(paper => <WithholdingPaper key={paper.sequence ?? 0} paper={paper} multiple={multiple} centralIssues={centralIssues} companyId={companyId} permissions={permissions} busy={busy} error={paperErrors[String(paper.sequence ?? 0)] ?? (paper.sequence ? undefined : error)} onDownload={() => onDownload(paper)} onFiled={() => onFiled(paper)} onConfirmRows={() => onConfirmRows?.(paper)} />)}</div>
  </MangmeeCard>;
}
function PaperStatus({ form }: { form: PaperAction }) {
  const stale = form.status === 'EXPORTED' && form.issues.some(issue => issue.issueCode === 'WHT_FILING_CHANGED_AFTER_DOWNLOAD');
  return <MangmeeBadge className="self-start" tone={stale ? 'amber' : ['FILED', 'PAID', 'CLOSED'].includes(form.status ?? '') ? 'brand' : 'slate'}>{stale ? 'มีรายการเปลี่ยนหลังดาวน์โหลดแบบ' : ['FILED', 'PAID', 'CLOSED'].includes(form.status ?? '') ? 'ยื่นแล้ว' : form.accountantPrepared ? 'ผู้ทำบัญชีจัดทำแบบนี้เอง' : withholdingState(form.status)}</MangmeeBadge>;
}
function WithholdingPaper({ paper, multiple, centralIssues, companyId, permissions, busy, error, onDownload, onFiled, onConfirmRows }: {
  paper: PaperAction; multiple: boolean; centralIssues: boolean; companyId: string; permissions: string[]; busy: boolean; error?: string;
  onDownload: () => void; onFiled: () => void; onConfirmRows: () => void;
}) {
  const issuesRef = useRef<HTMLDivElement>(null);
  const [explainDownload, setExplainDownload] = useState(false);
  const isFiled = ['FILED', 'PAID', 'CLOSED'].includes(paper.status ?? '');
  const stale = paper.status === 'EXPORTED' && paper.issues.some(issue => issue.issueCode === 'WHT_FILING_CHANGED_AFTER_DOWNLOAD');
  const blocking = paper.issues.some(issue => issue.severity === 'BLOCKING');
  const canPrepare = permissions.includes('wht.pnd53.prepare');
  useEffect(() => {
    if (!error || busy) return;
    const target = centralIssues && typeof document !== 'undefined' ? document.querySelector<HTMLDivElement>('[data-testid="withholding-fixes"]') : null;
    (target ?? issuesRef.current)?.scrollIntoView({ block: 'start' });
  }, [error, busy, centralIssues]);
  function download() {
    if ((!isFiled && blocking) || paper.canDownload === false) {
      setExplainDownload(true);
      const target = centralIssues && typeof document !== 'undefined' ? document.querySelector<HTMLDivElement>('[data-testid="withholding-fixes"]') : null;
      (target ?? issuesRef.current)?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start' });
      return;
    }
    onDownload();
  }

  return <section aria-label={multiple ? withholdingPaperName(paper.sequence) : undefined} className="space-y-3">
    {multiple && <><p className="text-sm font-semibold">{withholdingPaperName(paper.sequence)}{isFiled && paper.filedAt ? ` · ${formatThaiDate(paper.filedAt)}` : ''}</p><PaperStatus form={paper} /><p className="text-sm text-gray-500">{paper.paymentCount} รายการ · หักไว้ {baht(paper.totalWithheld)}</p></>}

    <div ref={issuesRef} tabIndex={-1} className="scroll-mt-24 space-y-3">
      {explainDownload && paper.canDownload === false && !paper.issues.length && !paper.rowsUncertainNotice && <Notice tone="warning">ยังดาวน์โหลดไม่ได้ ดึงรายการล่าสุดแล้วตรวจข้อมูลก่อนดาวน์โหลด</Notice>}
      {error && !paper.issues.some(issue => issue.description === error) && <Notice tone="error">{error}</Notice>}
      {paper.issues.filter(issue => !centralIssues || (!isSourceIssue(issue) && (explainDownload || error || !/_FILING_PAYER$/.test(issue.issueCode)))).map(issue => <Issue key={issue.id} issue={issue} companyId={companyId} permissions={permissions} />)}
      {paper.paymentBasisChanged && <Notice tone="warning">รายการของแบบที่ยื่นไว้ต่างจากวันที่จ่ายจริง ให้ผู้ทำบัญชีเทียบกับแบบที่ยื่นแล้ว</Notice>}
      {paper.cancellations?.map((row, index) => <Notice key={index} tone="warning">ยกเลิกหลังยื่น: {row.payeeName} หักไว้ {baht(row.withheld)} ระบบแก้แบบที่ยื่นแล้วไม่ได้ ให้ผู้ทำบัญชีแจ้งกรมสรรพากร</Notice>)}
      {!!paper.cancelledPayeeNames?.length && <Notice tone="warning">มีผู้รับเงินที่ถูกยกเลิกหลังยื่นในเดือนนี้: {paper.cancelledPayeeNames.join(' · ')} ให้ผู้ทำบัญชีตรวจยอดก่อนยื่น</Notice>}
      {!!paper.sequence && <Notice tone="info">เงินเพิ่ม (ถ้ามี) ให้ผู้ทำบัญชีคำนวณและกรอกก่อนยื่น</Notice>}
      {paper.rowsUncertainNotice && <Notice tone="warning">{paper.rowsUncertainNotice}{(!canPrepare || !paper.canConfirmRows) && ' ให้ผู้ที่มีสิทธิ์จัดทำแบบภาษียืนยันรายการ'}</Notice>}
      {paper.rowsConfirmation && <p className="text-sm text-gray-600">ยืนยันรายการของแบบที่ยื่นแล้ว · {paper.rowsConfirmation.displayName ?? 'ผู้จัดทำแบบภาษี'} · {formatThaiDate(paper.rowsConfirmation.at)}</p>}
    </div>
    {paper.paymentCount === 0 && !isFiled && !paper.issues.length ? <p>เดือนนี้ไม่มีรายการ</p> : canPrepare && <ActionGroup className="!flex-col sm:[&>button]:min-w-48">
      {paper.canConfirmRows && <button type="button" className={button} disabled={busy} aria-busy={busy} onClick={onConfirmRows}>ยืนยันรายการของแบบที่ยื่น</button>}
      <button type="button" className={button} disabled={busy} aria-busy={busy} onClick={download}>{isFiled ? 'ดาวน์โหลดแบบที่ยื่น' : paper.accountantPrepared ? 'ดาวน์โหลดรายการให้ผู้ทำบัญชี' : paper.sequence ? `ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ ${paper.sequence}` : downloadLabel(paper.formType)}</button>
      {paper.status === 'EXPORTED' && !stale && paper.canMarkFiled !== false && <button type="button" className={button} disabled={busy} aria-busy={busy} onClick={onFiled}>บันทึกว่ายื่นแล้ว</button>}
    </ActionGroup>}
  </section>;
}
export function WithholdingPage({ companyId, permissions, systemCertificatesAvailable = true }: { companyId: string; permissions: string[]; systemCertificatesAvailable?: boolean }) {
  const [months, setMonths] = useState<string[]>([]);
  const [periodKey, setPeriodKey] = useState('');
  const [month, setMonth] = useState<WithholdingMonthDto | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [busyForm, setBusyForm] = useState<Partial<Record<WhtFormType, boolean>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [certificateBusy, setCertificateBusy] = useState<string | null>(null);
  const [establishmentCode, setEstablishmentCode] = useState('');
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');
  const { confirm, confirmDialog } = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const listHeading = useRef<HTMLHeadingElement>(null);
  const canRead = permissions.includes('wht.pnd53.read');
  const canPrepare = permissions.includes('wht.pnd53.prepare');
  async function refreshMonths() {
    const result = await listWithholdingMonths(companyId);
    const choices = result.months.length ? result.months : [new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 7)];
    const origin = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('periodKey');
    const initial = origin && /^\d{4}-(0[1-9]|1[0-2])$/.test(origin) ? origin : choices[0];
    setMonths([...new Set([...choices, initial])].sort().reverse()); setPeriodKey(value => value || initial);
  }
  useEffect(() => { if (canRead) void refreshMonths().catch(e => { setError(apiErrorMessage(e)); setLoading(false); }); }, [companyId, canRead]);
  useEffect(() => {
    if (!canRead || !periodKey) return;
    let active = true; setLoading(true); setMonth(null); setErrors({}); setError(''); setPage(1);
    void (async () => {
      if (canPrepare) {
        try { await syncWithholding(companyId, 'PND53'); }
        catch (e) { if (active) setError(apiErrorMessage(e)); }
      }
      if (!active) return;
      try { const value = await getWithholdingMonth(companyId, periodKey); if (active) setMonth(value); }
      catch (e) { if (active) setError(apiErrorMessage(e)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [companyId, periodKey, canRead, canPrepare]);
  async function sync() {
    setSyncing(true); setError(''); setErrors({});
    try { await syncWithholding(companyId, 'PND53'); await refreshMonths(); if (periodKey) setMonth(await getWithholdingMonth(companyId, periodKey)); toast.success('ดึงรายการล่าสุดแล้ว'); }
    catch (e) { setError(apiErrorMessage(e)); } finally { setSyncing(false); }
  }
  async function retry() {
    setLoading(true); setError('');
    try { await refreshMonths(); if (periodKey) setMonth(await getWithholdingMonth(companyId, periodKey)); }
    catch (e) { setError(apiErrorMessage(e)); }
    finally { setLoading(false); }
  }
  async function act(form: PaperAction, filed: boolean | 'confirm') {
    if (!form.periodId) return;
    const establishment = (month?.establishments?.length ?? 0) > 1 ? month?.establishments?.find(row => row.code === form.establishmentCode) : undefined;
    if (filed === 'confirm' && !await confirm({ title: `ยืนยันรายการของแบบที่ยื่น ${formName(form.formType)} เดือน ${formatThaiMonth(periodKey)}`, message: 'ยืนยันว่าเทียบรายการกับแบบที่ยื่นจริงแล้ว ระบบจะใช้รายการนี้เป็นแบบที่ยื่นไว้และจัดทำแบบยื่นเพิ่มเติมจากรายการใหม่', confirmLabel: 'ยืนยันรายการ', cancelLabel: 'กลับ', variant: 'primary' })) return;
    if (filed === true && !await confirm({ title: `บันทึกว่ายื่น ${formName(form.formType)} ${withholdingPaperName(form.sequence)} เดือน ${formatThaiMonth(periodKey)}${establishment ? ` ในนาม ${establishment.name} (${establishment.code})` : ''} แล้ว?`, message: 'ใช้เมื่อนำแบบไปยื่นกรมสรรพากรแล้ว', confirmLabel: 'บันทึกว่ายื่นแล้ว', cancelLabel: 'ยังไม่ได้ยื่น', variant: 'primary' })) return;
    setBusyForm(value => ({ ...value, [form.formType]: true })); setErrors(value => ({ ...value, [form.sequence ? `${form.formType}:${form.sequence}` : form.formType]: '' }));
    try {
      if (filed === 'confirm') { if (!form.id) return; await confirmWithholdingRows(companyId, form.id); toast.success('ยืนยันรายการของแบบที่ยื่นแล้ว'); }
      else if (filed) await markWithholdingFiled(companyId, form.formType, form.periodId, undefined, form.establishmentCode, form.sequence);
      else {
        downloadArtifact((await exportWithholding(companyId, form.formType, form.periodId, form.accountantPrepared ? 'XLSX' : 'PDF', form.establishmentCode, form.sequence)).artifact);
        toast.success(form.accountantPrepared ? 'ดาวน์โหลดรายการให้ผู้ทำบัญชีแล้ว' : `${form.sequence ? `ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ ${form.sequence}` : downloadLabel(form.formType)} แล้ว`);
      }
    } catch (e) { setErrors(value => ({ ...value, [form.sequence ? `${form.formType}:${form.sequence}` : form.formType]: withholdingErrorMessage(e) })); }
    finally {
      try { setMonth(await getWithholdingMonth(companyId, periodKey)); } catch (e) { setError(apiErrorMessage(e)); }
      setBusyForm(value => ({ ...value, [form.formType]: false }));
    }
  }
  async function certificate(id: string) {
    setCertificateBusy(id); setError('');
    try {
      const result = await downloadSystemWhtCertificate(companyId, id, { suppressErrorToast: true });
      downloadArtifact(result.pdfArtifact);
      toast.success(`ดาวน์โหลดหนังสือรับรอง ${result.certificateNumber} แล้ว`);
    }
    catch (e) { setError(apiErrorMessage(e)); } finally { setCertificateBusy(null); }
  }
  if (!canRead) return <ForbiddenState />;
  const establishments = month?.establishments ?? [];
  const selected = establishments.find(row => row.code === establishmentCode) ?? establishments[0];
  const forms = selected?.forms ?? month?.forms ?? [];
  const sourceIssues = [...new Map(forms.flatMap(form => [form, ...(form.papers ?? [])]).flatMap(form => form.issues).filter(isSourceIssue).map(issue => [issue.sourceId ? [issue.issueCode, issue.sourceId].join(':') : issue.description, issue])).values()];
  const paged = withholdingPaymentPage(month?.payments ?? [], filter, page, 10, order);
  return <MangmeePage className="mangmee-flat" title="ภาษีหัก ณ ที่จ่าย">
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <SelectField id="withholding-month" label="เดือนที่จ่าย" value={periodKey} disabled={syncing || Object.values(busyForm).some(Boolean)} onChange={e => setPeriodKey(e.target.value)}>{months.map(key => <option key={key} value={key}>{formatThaiMonth(key)}</option>)}</SelectField>
        {/* One size side by side at every width (owner: buttons in a group are one size). */}
        <div className="ml-auto grid w-full auto-cols-fr grid-flow-col gap-3 sm:w-auto sm:min-w-80 [&>*]:min-w-0 [&>details>summary]:w-full">
          {permissions.includes('wht.pnd53.prepare') && <button type="button" className={button} disabled={syncing || loading} aria-busy={syncing || loading} onClick={() => void sync()}>ดึงรายการล่าสุด</button>}
          {permissions.includes('wht.certificate.issue') && <MoreActions label="เพิ่มเติม" align="end" closeOnPress><Link href={`/companies/${companyId}/expenses/wht-certificates`}>ดูหนังสือรับรอง 50 ทวิ</Link></MoreActions>}
        </div>
      </div>
      {error && <Notice tone="error" action={<button type="button" className={button} onClick={() => void retry()}>ลองอีกครั้ง</button>}>{error}</Notice>}
      {loading ? <LoadingState /> : month && <>
        {establishments.length > 1 && <SelectField id="withholding-establishment" label="ยื่นในนาม" value={selected?.code ?? ''} disabled={syncing || Object.values(busyForm).some(Boolean)} onChange={e => { setEstablishmentCode(e.target.value); setErrors({}); }}>
          {establishments.map(row => <option key={row.code} value={row.code}>{row.name} ({row.code})</option>)}
        </SelectField>}
        {!!month.unpaidExpenses?.length && <p className="text-sm text-gray-600">ยืนยันแล้ว ยังไม่ได้จ่าย · {month.unpaidExpenses.length} รายการ ยังไม่อยู่ในแบบ {month.unpaidExpenses.map(row => <Link key={row.expenseId} className="ml-2 underline" href={`/companies/${companyId}/expenses/${row.expenseId}`}>{row.payeeName || 'เปิดรายจ่าย'}</Link>)}</p>}
        <WithholdingFixes month={month} forms={forms} companyId={companyId} permissions={permissions} sourceIssues={sourceIssues} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">{forms.map(form => <WithholdingFormCard key={form.formType} centralIssues form={{ ...form, issues: form.issues.filter(issue => !(issue.issueCode === 'WHT_PAYER_MODE_REQUIRED' && month.establishmentIssues?.length)) }} periodKey={periodKey} companyId={companyId} permissions={permissions} busy={!!busyForm[form.formType] || syncing} error={errors[form.formType]} paperErrors={Object.fromEntries((form.papers ?? []).map(p => [String(p.sequence), errors[p.sequence ? `${form.formType}:${p.sequence}` : form.formType] ?? '']))} onDownload={(paper = form) => void act(paper, false)} onFiled={(paper = form) => void act(paper, true)} onConfirmRows={paper => void act(paper, 'confirm')} />)}</div>
        {!!month.separatePnd2?.length && <MangmeeCard className="space-y-3 p-4"><h2 className="text-base font-semibold">ต้องจัดทำ ภ.ง.ด.2 แยก</h2>{month.separatePnd2.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3"><div><p>{row.payeeName} · {row.incomeCategoryLabel}</p><p>จ่าย {baht(row.paid)} · หักไว้ {baht(row.withheld)}</p></div>{row.expenseId && <Link className="underline" href={`/companies/${companyId}/expenses/${row.expenseId}`}>เปิดรายจ่าย</Link>}</div>)}</MangmeeCard>}
        <MangmeeCard className="min-w-0 space-y-4 p-4">
          <h2 ref={listHeading} className="scroll-mt-4 text-lg font-semibold">รายการที่หักภาษีของเดือนนี้</h2>
          <FilterTabs aria-label="แบบภาษี" value={filter} onChange={value => { setFilter(value); setPage(1); }} tabs={[{ key: 'ALL', label: 'ทั้งหมด' }, { key: 'PND3', label: 'ภ.ง.ด.3' }, { key: 'PND53', label: 'ภ.ง.ด.53' }].map(tab => ({ ...tab, count: month.payments.filter(row => tab.key === 'ALL' || row.formType === tab.key).length }))} />
          {paged.rows.length === 0 ? <p>{sourceIssues.length || month.establishmentIssues?.length ? 'แก้ข้อมูลรายการจ่ายเพื่อแสดงในแบบ' : 'เดือนนี้ไม่มีรายการ'}</p> : <WithholdingPayments systemCertificatesAvailable={systemCertificatesAvailable} rows={paged.rows} month={month} companyId={companyId} order={order} onOrder={() => { setOrder(order === 'newest' ? 'oldest' : 'newest'); setPage(1); }} onOpen={href => router.push(href)} certificateBusy={certificateBusy} onCertificate={id => void certificate(id)} />}
          {paged.totalPages > 1 && <Pagination prominent page={Math.min(page, paged.totalPages)} totalPages={paged.totalPages} onPageChange={next => { setPage(next); listHeading.current?.scrollIntoView({ block: 'start' }); }} />}
        </MangmeeCard>
      </>}
    </div>{confirmDialog}
  </MangmeePage>;
}

function WithholdingFixes({ month, forms, companyId, permissions, sourceIssues }: { month: WithholdingMonthDto; forms: WithholdingMonthFormDto[]; companyId: string; permissions: string[]; sourceIssues: WithholdingMonthIssueDto[] }) {
  // A form and each of its papers (normal and additional filings) can carry facts; rows below are de-duplicated.
  const papers = forms.flatMap(form => [form, ...(form.papers ?? [])]);
  const canReadExpenses = ['expense.read', 'expense.read_own', 'expense.read_related'].some(permission => permissions.includes(permission));
  const branchSettings = `/companies/${companyId}/settings/branches?from=withholding&periodKey=${month.periodKey}`;
  const payerIssues = [...new Map(papers.flatMap(form => form.issues).filter(issue => /_FILING_PAYER$/.test(issue.issueCode)).map(issue => [issue.description, issue])).values()];
  const incomeRows = [...new Map(papers.flatMap(form => form.accountantTypes ?? []).map(row => [`${row.payeeName}:${row.incomeType}`, row])).values()];
  if (!month.undatedPayments?.length && !month.paidWithoutWithholding?.length && !sourceIssues.length && !payerIssues.length && !incomeRows.length && !month.establishmentIssues?.length) return null;
  const rowClass = 'flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-gray-50 py-3 text-sm hover:bg-gray-50';
  // MangmeeCard passes on only its class, so the test id sits on a wrapper.
  return <div data-testid="withholding-fixes" tabIndex={-1} className="scroll-mt-24"><MangmeeCard className="p-4"><h2 className="text-base font-semibold">ต้องแก้ก่อนยื่น</h2>
        {month.establishmentIssues?.map(issue => <Notice key={[issue.issueCode, issue.branchId].join(':')} tone="warning" action={permissions.includes('company.branch.read') ? <Link className="underline" href={`${branchSettings}${issue.branchId ? `&branchId=${encodeURIComponent(issue.branchId)}` : ''}`}>ตั้งค่าร้าน › สาขา</Link> : undefined}>
          {issue.issueCode === 'WHT_PAYER_MODE_REQUIRED' ? 'มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี' : `${issue.branchName} ยังไม่มีรหัสสาขาภาษี${issue.paymentCount ? ` · ${issue.paymentCount} รายการ` : ''}`}
          {!permissions.includes('company.legal_identity.manage') && issue.issueCode === 'WHT_PAYER_MODE_REQUIRED' && ' ให้ผู้ที่แก้ไขข้อมูลร้านได้เป็นผู้บันทึก'}
          {!permissions.includes('company.branch.manage') && issue.issueCode === 'WHT_BRANCH_HAS_NO_CODE' && ' ให้ผู้ที่แก้ไขสาขาได้กรอกรหัสสาขาภาษี'}
        </Notice>)}
    {month.undatedPayments?.map(row => <Link key={row.paymentId} className={rowClass} href={`/companies/${companyId}/expenses/${row.expenseId}?section=payment`}>
      <span className="min-w-0 flex-1 break-words font-semibold">{row.payeeName || 'ไม่มีชื่อผู้รับเงิน'}</span><span className="font-bold tabular-nums">{baht(row.amount)}</span><MangmeeBadge tone="amber">ยังไม่รู้วันที่จ่ายจริง</MangmeeBadge>
    </Link>)}
    {month.paidWithoutWithholding?.map(row => <Link key={row.expenseId} className={rowClass} href={`/companies/${companyId}/expenses/${row.expenseId}?section=payment`}><span className="min-w-0 flex-1 break-words font-semibold">{row.payeeName || 'ไม่มีชื่อผู้รับเงิน'}</span><MangmeeBadge tone="amber">จ่ายเต็มยอด ยังไม่ได้หักภาษี</MangmeeBadge></Link>)}
    {/* Every row reads the same: what is wrong at the left, one badge at the right, and the whole row opens where it is fixed. */}
    {payerIssues.map(issue => permissions.includes('company.setup.read')
      ? <Link key={issue.id} className={rowClass} href={`${companyProfilePath(companyId)}?from=withholding`}><span className="min-w-0 flex-1 break-words">{issue.description}</span><MangmeeBadge tone="amber">ข้อมูลร้านยังไม่ครบ</MangmeeBadge></Link>
      : <div key={issue.id} className={rowClass}><span className="min-w-0 flex-1 break-words">{issue.description} ให้ผู้มีสิทธิ์แก้ข้อมูลร้านตรวจข้อมูลให้ครบ{canReadExpenses && <> <Link className="inline-flex min-h-11 items-center underline" href={`/companies/${companyId}/expenses`}>กลับไปรายการค่าใช้จ่าย</Link></>}</span><MangmeeBadge tone="amber">ข้อมูลร้านยังไม่ครบ</MangmeeBadge></div>)}
    {sourceIssues.map(issue => <Issue key={issue.id} issue={issue} companyId={companyId} permissions={permissions} />)}
    {incomeRows.map(row => { const expense = month.payments.find(payment => payment.payeeName === row.payeeName && payment.incomeCategoryLabel === row.incomeType);
      const contents = <><span className="min-w-0 flex-1 break-words font-semibold">{row.payeeName} · {row.incomeType}</span><MangmeeBadge tone="amber">ให้ผู้ทำบัญชีจัดทำแบบ</MangmeeBadge></>;
      return expense?.expenseId ? <Link key={`${row.payeeName}:${row.incomeType}`} className={rowClass} href={`/companies/${companyId}/expenses/${expense.expenseId}`}>{contents}</Link> : <div key={`${row.payeeName}:${row.incomeType}`} className={rowClass}>{contents}</div>;
    })}
  </MangmeeCard></div>;
}

export function WithholdingPayments({ rows, month, companyId, order, onOrder, onOpen, certificateBusy, onCertificate, systemCertificatesAvailable = true }: {
  systemCertificatesAvailable?: boolean; rows: WithholdingMonthDto['payments']; month: WithholdingMonthDto; companyId: string; order: 'newest' | 'oldest'; onOrder: () => void;
  onOpen: (href: string) => void; certificateBusy: string | null; onCertificate: (id: string) => void;
}) {
  const sort = <button type="button" className="min-h-11 text-left" aria-label={order === 'newest' ? 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่' : 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า'} onClick={onOrder}>วันที่จ่าย {order === 'newest' ? '↓' : '↑'}</button>;
  const open = (row: WithholdingMonthDto['payments'][number]) => row.expenseId ? {
    role: 'link', tabIndex: 0, 'data-href': `/companies/${companyId}/expenses/${row.expenseId}`, 'aria-label': `เปิดรายจ่าย ${row.payeeName}`,
    onClick: () => onOpen(`/companies/${companyId}/expenses/${row.expenseId}`),
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); onOpen(`/companies/${companyId}/expenses/${row.expenseId}`); } },
  } : {};
  const paper = (row: WithholdingMonthDto['payments'][number]) => {
    const code = row.paper?.establishmentCode ?? (row.establishment?.kind === 'ESTABLISHMENT' ? row.establishment.code : undefined);
    const forms = month.establishments?.length ? month.establishments.find(item => item.code === code)?.forms : !row.establishment || row.establishment.kind === 'ESTABLISHMENT' ? month.forms : [];
    const count = forms?.find(form => form.formType === row.formType)?.papers?.length ?? 0;
    return count > 1 || (row.paper === null && count > 0) ? <p className={styles.number}>{row.paper ? withholdingPaperName(row.paper.sequence) : row.paper === undefined && (!row.establishment || row.establishment.kind === 'ESTABLISHMENT') ? 'ยื่นปกติ' : 'ยังไม่อยู่ในแบบ'}</p> : null;
  };
  const name = (row: WithholdingMonthDto['payments'][number]) => <><div className={styles.name}>{row.payeeName || 'ไม่มีชื่อผู้รับเงิน'}</div>{row.establishment?.kind === 'ESTABLISHMENT' && (month.establishments?.length ?? 0) > 1 ? <p className={styles.number}>ยื่นโดย {row.establishment.name}</p> : row.establishment?.kind === 'BRANCH_HAS_NO_CODE' ? <p className={styles.number}>ยังไม่มีรหัสสาขาภาษี</p> : null}</>;
  const income = (row: WithholdingMonthDto['payments'][number]) => <>{row.incomeCategoryLabel ?? 'ยังไม่ได้เลือกว่าจ่ายค่าอะไร'}{row.rate && ` · ${Number(row.rate)}%`}</>;
  const certificate = (row: WithholdingMonthDto['payments'][number]) => <><MangmeeBadge tone={row.certificate?.state === 'SYSTEM_ISSUED' ? 'brand' : 'slate'} className={styles.badge}>{row.certificate?.state === 'SYSTEM_ISSUED' ? 'ออกแล้ว' : row.certificate?.state === 'EXTERNAL_LINKED' ? t(systemCertificatesAvailable ? 'expenses.certificates.external' : 'expenses.certificates.outside_external', 'th') : row.certificate?.state === 'CANCELLED' ? 'ยกเลิกแล้ว' : 'ยังไม่ออก'}</MangmeeBadge>{row.certificate?.number && <p className={styles.number}>{row.certificate.number}</p>}{systemCertificatesAvailable && row.certificate?.canDownload && <button type="button" aria-label="ดาวน์โหลดหนังสือรับรอง" className={`${button} mt-2 !min-w-0 !px-2`} disabled={certificateBusy === row.certificate.handoffId} aria-busy={certificateBusy === row.certificate.handoffId} onClick={event => { event.stopPropagation(); onCertificate(row.certificate!.handoffId); }}>ดาวน์โหลด</button>}</>;
  return <div className={styles.section}>
    <div className={styles.phoneSort}>{sort}</div>
    <table className={styles.table}><colgroup>{[22, 11, 8, 21, 13, 13, 12].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead><tr><th>ผู้รับเงิน</th><th>{sort}</th><th>แบบ</th><th>จ่ายค่าอะไร</th><th className={`${styles.money} !whitespace-normal`}>ยอดจ่าย (บาท)</th><th className={`${styles.money} !whitespace-normal`}>ภาษีที่หักไว้ (บาท)</th><th className={styles.status}>50 ทวิ</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} {...open(row)}><td>{name(row)}</td><td className={styles.date}>{formatThaiDate(row.paymentDate, '')}</td><td>{formName(row.formType)}{paper(row)}</td><td>{income(row)}</td><td className={styles.money}>{amountText(row.paid)}</td><td className={styles.money}>{amountText(row.withheld)}</td><td className={styles.status}>{certificate(row)}</td></tr>)}</tbody>
    </table>
    <div className={styles.cards}>{rows.map(row => <div key={row.id} {...open(row)} className={`${styles.card} border-b border-gray-50`}>
      <div className={styles.heading}><div>{name(row)}</div><span className={styles.money}>{baht(row.withheld)}</span></div>
      <p className={styles.number}>{formatThaiDate(row.paymentDate, '')} · {formName(row.formType)}</p>{paper(row)}<p className="mt-2 text-sm">{income(row)} · จ่าย {baht(row.paid)}</p><div className="mt-2">{certificate(row)}</div>
    </div>)}</div>
  </div>;
}
