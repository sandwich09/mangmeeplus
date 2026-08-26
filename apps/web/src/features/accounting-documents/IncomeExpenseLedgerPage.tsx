'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  IncomeExpenseLedgerEntries,
  IncomeExpenseLedgerEntry,
  IncomeExpenseLedgerEntryType,
  IncomeExpenseLedgerExport,
  IncomeExpenseLedgerSummary,
} from '@watchdog-bms/contracts';
import { todayCivilDate } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { MangmeeBadge, MangmeeCard, MangmeePage, MangmeeStatCard } from '@/common/components/mangmee';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { Modal } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { formatThaiDate } from '@/common/i18n/thai-date';
import {
  createPayment,
  exportIncomeExpenseLedger,
  getIncomeExpenseLedgerSummary,
  listIncomeExpenseLedgerEntries,
  newAccountingPaymentIdempotencyKey,
} from './accounting-documents.api';
import { PAYMENT_METHOD_LABELS, type AccountingPaymentMethod } from './accounting-documents.model';
import {
  canExportLedger,
  canReceiveLedgerPayment,
  canStartLedgerIncomeFlow,
  isLedgerEntryOverdue,
  ledgerBarWidth,
  ledgerMonthPeriod,
  ledgerReceivePaymentBlocker,
  vatRegistrationAlertCopy,
  visibleLedgerEntryTypes,
} from './income-expense-ledger.logic';

const TYPE_LABEL: Record<IncomeExpenseLedgerEntryType, string> = {
  ALL: 'ทั้งหมด',
  INCOME: 'รายรับ',
  EXPENSE: 'รายจ่าย',
  RECEIVABLE: 'รอรับเงิน',
};

const STATUS_LABEL: Record<string, string> = {
  ISSUED: 'ยืนยันแล้ว',
  CREDITED: 'ออกใบลดหนี้แล้ว',
  DEBITED: 'ออกใบเพิ่มหนี้แล้ว',
  CLOSED: 'ปิดแล้ว',
  CONFIRMED: 'ยืนยันแล้ว',
  VOIDED: 'ยกเลิกแล้ว',
};

const INCOME_STATUSES = ['ISSUED', 'CREDITED', 'DEBITED', 'CLOSED'];
const EXPENSE_STATUSES = ['CONFIRMED', 'VOIDED'];
const RECEIVED_PAYMENT_METHODS: AccountingPaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'];

function money(value?: string) {
  if (value === undefined) return '—';
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-base text-red-800 sm:flex-row sm:items-center sm:justify-between">
      <span>{message}</span>
      <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11 shrink-0" onClick={onRetry}>ลองใหม่</button>
    </div>
  );
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

function downloadLedgerFiles(result: IncomeExpenseLedgerExport) {
  saveBlob(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }), result.csvFileName);
  const bytes = Uint8Array.from(atob(result.xlsxBase64), (character) => character.charCodeAt(0));
  saveBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), result.xlsxFileName);
}

function unavailableCopy(reason?: 'NO_PERMISSION' | 'DATA_MISMATCH') {
  return reason === 'DATA_MISMATCH' ? 'คำนวณไม่สำเร็จ ลองรีเฟรช' : 'เปิดฝั่งนี้เร็ว ๆ นี้';
}

function SummarySkeleton() {
  return (
    <div role="status" aria-busy="true" className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="กำลังโหลดตัวเลขสรุป">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl border border-gray-100 bg-gray-100" />)}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="กำลังโหลดยอดตามหมวด" className="mt-5 space-y-4">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="animate-pulse">
          <div className="h-5 w-2/3 rounded bg-gray-100" />
          <div className="mt-2 h-3 rounded-full bg-gray-100" style={{ width: `${85 - index * 20}%` }} />
        </div>
      ))}
    </div>
  );
}

function EntriesSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="กำลังโหลดรายการในสมุด" className="mt-5 space-y-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-xl border border-gray-100 bg-gray-50 md:h-14" />
      ))}
    </div>
  );
}

function ReceivePaymentModal({
  companyId,
  entry,
  today,
  onClose,
  onDone,
}: {
  companyId: string;
  entry: IncomeExpenseLedgerEntry;
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const [amount, setAmount] = useState(entry.outstandingAmount ?? '');
  const [whtAmount, setWhtAmount] = useState('');
  const [whtReference, setWhtReference] = useState('');
  const [method, setMethod] = useState<AccountingPaymentMethod>('BANK_TRANSFER');
  const [paidOn, setPaidOn] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paymentAttempt = useRef<{ signature: string; key: string } | null>(null);
  const blocker = ledgerReceivePaymentBlocker({ amount, whtAmount, outstandingAmount: entry.outstandingAmount ?? '', paidOn, today });

  const save = async () => {
    if (blocker || busy) return;
    setBusy(true);
    setError(null);
    try {
      const signature = JSON.stringify([entry.id, amount, whtAmount, whtReference.trim(), method, paidOn]);
      if (paymentAttempt.current?.signature !== signature) {
        paymentAttempt.current = { signature, key: newAccountingPaymentIdempotencyKey(entry.id) };
      }
      await createPayment(companyId, {
        idempotencyKey: paymentAttempt.current.key,
        direction: 'RECEIVED',
        method,
        amount,
        ...(Number(whtAmount) > 0 ? { whtAmount } : {}),
        ...(Number(whtAmount) > 0 && whtReference.trim() ? { externalReference: whtReference.trim() } : {}),
        paidAt: `${paidOn}T00:00:00+07:00`,
        ...(entry.branchId && { branchId: entry.branchId }),
        ...(entry.counterpartyId && { counterpartyId: entry.counterpartyId }),
        allocateToDocumentId: entry.id,
      });
      toast.success(`รับชำระ ${entry.referenceNumber ?? 'เอกสาร'} เรียบร้อยแล้ว`);
      onDone();
    } catch (cause) {
      setError(apiErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };

  return (
    <Modal open title={`รับชำระ — ${entry.referenceNumber ?? 'เอกสาร'}`} size="sm" closeLabel="ยกเลิก" onClose={() => { if (!busy) onClose(); }}>
      <form className="space-y-4" onSubmit={submit}>
        <div className="rounded-xl bg-brand-25 p-4 text-base text-gray-700">
          <p className="font-semibold text-gray-900">{entry.partyName ?? 'ลูกค้าทั่วไป'}</p>
          <p className="mt-1">ยอดค้าง <strong className="text-lg tabular-nums">฿{money(entry.outstandingAmount)}</strong></p>
        </div>

        <label className="block text-base font-semibold text-gray-700">
          เงินที่ได้รับ
          <input className="mangmee-input mt-2 min-h-12 w-full text-base" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={Boolean(blocker && !amount)} />
        </label>

        <fieldset>
          <legend className="text-base font-semibold text-gray-700">ช่องทางรับเงิน</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {RECEIVED_PAYMENT_METHODS.map((item) => (
              <button key={item} type="button" className={`min-h-12 rounded-xl border px-3 text-base font-semibold ${method === item ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-gray-200 bg-white text-gray-700'}`} aria-pressed={method === item} onClick={() => setMethod(item)}>
                {PAYMENT_METHOD_LABELS[item]}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block text-base font-semibold text-gray-700">
          วันที่รับเงิน
          <ThemedDate className="mt-2 min-h-12 w-full text-base" value={paidOn} max={today} required onChange={(event) => setPaidOn(event.target.value)} />
        </label>

        <details className="rounded-xl border border-gray-200 p-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-base font-semibold text-gray-700">ถูกหัก ณ ที่จ่าย (ถ้ามี)</summary>
          <div className="mt-3 space-y-3">
            <label className="block text-base text-gray-700">
              ยอดที่ลูกค้าหักไว้
              <input className="mangmee-input mt-2 min-h-12 w-full text-base" type="number" inputMode="decimal" min="0" step="0.01" value={whtAmount} onChange={(event) => setWhtAmount(event.target.value)} />
            </label>
            <label className="block text-base text-gray-700">
              เลขที่หนังสือรับรอง 50 ทวิ (ถ้ามี)
              <input className="mangmee-input mt-2 min-h-12 w-full text-base" maxLength={160} value={whtReference} onChange={(event) => setWhtReference(event.target.value)} />
            </label>
          </div>
        </details>

        {error && <ErrorBanner message={error} onRetry={() => void save()} />}
        <div className="space-y-2">
          <button type="submit" className="mangmee-btn mangmee-btn-primary min-h-14 w-full text-base" disabled={Boolean(blocker) || busy}>{busy ? 'กำลังบันทึก...' : `ยืนยันรับชำระ ฿${money(amount)}`}</button>
          {(blocker || busy) && <p className="text-base text-gray-600">{busy ? 'กำลังบันทึก กรุณารอสักครู่' : blocker}</p>}
          <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-12 w-full text-base" disabled={busy} onClick={onClose}>ยกเลิก</button>
        </div>
      </form>
    </Modal>
  );
}

function EntryCard({ entry, today, canReceivePayment, onReceivePayment }: { entry: IncomeExpenseLedgerEntry; today: string; canReceivePayment: boolean; onReceivePayment: () => void }) {
  const overdue = isLedgerEntryOverdue(entry.dueDate, today, entry.outstandingAmount);
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white transition hover:border-brand-200">
      <Link href={entry.evidenceHref} className="block min-h-11 p-4 hover:bg-brand-25 focus-visible:outline-2 focus-visible:outline-brand-500">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <MangmeeBadge className="!text-base" tone={entry.side === 'INCOME' ? 'brand' : 'amber'}>{entry.side === 'INCOME' ? 'รายรับ' : 'รายจ่าย'}</MangmeeBadge>
              <span className="text-base font-semibold text-gray-900">{entry.referenceNumber ?? 'ยังไม่มีเลขเอกสาร'}</span>
              {overdue && <MangmeeBadge className="!text-base" tone="danger">เกินกำหนด</MangmeeBadge>}
            </div>
            <p className="mt-2 truncate text-base text-gray-700">{entry.partyName ?? 'ไม่ระบุคู่ค้า'}</p>
            <p className="mt-1 text-base text-gray-500">{entry.categoryLabels.join(' · ') || 'ยังไม่จัดหมวด'} · {formatThaiDate(entry.date)}</p>
            {entry.dueDate && <p className={`mt-1 text-base ${overdue ? 'font-semibold text-red-700' : 'text-gray-500'}`}>ครบกำหนด {formatThaiDate(entry.dueDate)}</p>}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-bold tabular-nums text-gray-900">฿{money(entry.amount)}</p>
            <p className="mt-1 text-base text-gray-500">{STATUS_LABEL[entry.status] ?? 'สถานะเอกสาร'}</p>
          </div>
        </div>
        {entry.outstandingAmount !== undefined && Number(entry.outstandingAmount) > 0 && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-base font-semibold text-amber-800">{entry.side === 'INCOME' ? 'รอรับ' : 'รอจ่าย'} ฿{money(entry.outstandingAmount)}</p>
        )}
      </Link>
      {canReceivePayment && <div className="border-t border-gray-100 p-3"><button type="button" className="mangmee-btn mangmee-btn-primary min-h-12 w-full text-base" onClick={onReceivePayment}>รับชำระ</button></div>}
    </div>
  );
}

export function IncomeExpenseLedgerPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const router = useRouter();
  const toast = useToast();
  const today = useMemo(() => todayCivilDate('Asia/Bangkok'), []);
  const entryTypes = useMemo(() => visibleLedgerEntryTypes(permissions), [permissions]);
  const [month, setMonth] = useState(today.slice(0, 7));
  const period = useMemo(() => ledgerMonthPeriod(month, today), [month, today]);
  const [type, setType] = useState<IncomeExpenseLedgerEntryType>(entryTypes[0] ?? 'ALL');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [summary, setSummary] = useState<IncomeExpenseLedgerSummary | null>(null);
  const [entries, setEntries] = useState<IncomeExpenseLedgerEntries | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(entryTypes.length > 0);
  const [entriesLoading, setEntriesLoading] = useState(entryTypes.length > 0);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [paymentEntry, setPaymentEntry] = useState<IncomeExpenseLedgerEntry | null>(null);
  const [chartSide, setChartSide] = useState<'INCOME' | 'EXPENSE'>(permissions.includes('accounting.document.read') ? 'INCOME' : 'EXPENSE');
  const summaryRequest = useRef(0);
  const entriesRequest = useRef(0);

  useEffect(() => {
    if (entryTypes.includes(type)) return;
    setType(entryTypes[0] ?? 'ALL');
  }, [entryTypes, type]);

  const loadSummary = useCallback(async () => {
    if (entryTypes.length === 0) return;
    const request = ++summaryRequest.current;
    setSummaryLoading(true);
    setSummaryError(null);
    setSummary(null);
    try {
      const result = await getIncomeExpenseLedgerSummary(companyId, { from: period.from, to: period.to });
      if (request === summaryRequest.current) setSummary(result);
    } catch (error) {
      if (request === summaryRequest.current) setSummaryError(apiErrorMessage(error));
    } finally {
      if (request === summaryRequest.current) setSummaryLoading(false);
    }
  }, [companyId, entryTypes.length, period.from, period.to]);

  const loadEntries = useCallback(async () => {
    if (entryTypes.length === 0 || !entryTypes.includes(type)) return;
    const request = ++entriesRequest.current;
    setEntriesLoading(true);
    setEntriesError(null);
    setEntries(null);
    try {
      const result = await listIncomeExpenseLedgerEntries(companyId, {
        type,
        ...(categoryId && { categoryId }),
        ...(status && { status }),
        from: period.from,
        to: period.to,
        page,
        pageSize: 20,
      });
      if (request === entriesRequest.current) setEntries(result);
    } catch (error) {
      if (request === entriesRequest.current) setEntriesError(apiErrorMessage(error));
    } finally {
      if (request === entriesRequest.current) setEntriesLoading(false);
    }
  }, [categoryId, companyId, entryTypes, page, period.from, period.to, status, type]);

  useEffect(() => { void loadSummary(); }, [loadSummary, refreshKey]);
  useEffect(() => { void loadEntries(); }, [loadEntries, refreshKey]);

  const selectType = (next: IncomeExpenseLedgerEntryType) => {
    setType(next);
    setCategoryId('');
    setStatus('');
    setPage(1);
  };

  const categories = useMemo(() => {
    if (!summary) return [];
    const rows = type === 'EXPENSE'
      ? summary.expense.byCategory
      : type === 'ALL'
        ? [...summary.income.byCategory, ...summary.expense.byCategory]
        : summary.income.byCategory;
    return [...new Map(rows.flatMap((row) => row.categoryId ? [[row.categoryId, row] as const] : [])).values()];
  }, [summary, type]);

  const chartRows = chartSide === 'INCOME' ? summary?.income.byCategory ?? [] : summary?.expense.byCategory ?? [];
  const chartAvailable = chartSide === 'INCOME' ? summary?.income.available : summary?.expense.available;
  const chartReason = chartSide === 'INCOME' ? summary?.income.unavailableReason : summary?.expense.unavailableReason;
  const chartMax = Math.max(0, ...chartRows.map((row) => Math.abs(Number(row.amount)) || 0));
  const canDownload = canExportLedger(type, permissions);
  const exportDisabledReason = exporting
    ? 'กำลังเตรียมไฟล์ กรุณารอสักครู่'
    : entriesLoading
      ? 'รอโหลดรายการให้เสร็จก่อน'
      : entriesError
        ? 'โหลดรายการไม่สำเร็จ กรุณาลองใหม่ก่อนดาวน์โหลด'
      : !entries?.total
        ? 'ยังไม่มีรายการในช่วงที่เลือก'
        : '';

  const download = async () => {
    if (!canDownload || exportDisabledReason) return;
    setExporting(true);
    try {
      const result = await exportIncomeExpenseLedger(companyId, {
        type,
        ...(categoryId && { categoryId }),
        ...(status && { status }),
        from: period.from,
        to: period.to,
      });
      downloadLedgerFiles(result);
      toast.success(`ดาวน์โหลด ${result.rowCount.toLocaleString('th-TH')} รายการแล้ว`);
    } catch (error) {
      toast.error(apiErrorMessage(error));
    } finally {
      setExporting(false);
    }
  };

  const canRecordIncome = canStartLedgerIncomeFlow(permissions);
  const canUploadExpense = permissions.includes('expense.receipt.upload');
  const canCreateExpense = permissions.includes('expense.create');
  const canReceivePayment = permissions.includes('accounting.payment.create');
  const expenseEmptyAction = canUploadExpense
    ? { href: `/companies/${companyId}/expenses/upload`, label: 'อัปโหลดใบเสร็จรายการแรก' }
    : canCreateExpense
      ? { href: `/companies/${companyId}/expenses/manual`, label: 'กรอกรายจ่ายรายการแรก' }
      : null;
  const emptyAction = type === 'EXPENSE'
    ? expenseEmptyAction
    : canRecordIncome
      ? { href: `/companies/${companyId}/sales-documents`, label: type === 'RECEIVABLE' ? 'ออกบิลรายการแรก' : 'บันทึกรายรับรายการแรก' }
      : type === 'ALL'
        ? expenseEmptyAction
        : null;
  const vatAlert = summary?.income.vatRegistrationAlert;
  const vatAlertText = vatAlert ? vatRegistrationAlertCopy(vatAlert) : null;

  if (entryTypes.length === 0) {
    return (
      <MangmeePage title="สมุดรายรับ–รายจ่าย" description="รวมรายการจากเอกสารขายและค่าใช้จ่ายที่บันทึกไว้">
        <MangmeeCard className="p-6 text-center">
          <h2 className="text-lg font-bold text-gray-900">ยังไม่มีสิทธิ์เปิดสมุดนี้</h2>
          <p className="mt-2 text-base text-gray-600">ติดต่อเจ้าของกิจการเพื่อขอสิทธิ์ดูเอกสารขายหรือรายการรายจ่าย</p>
        </MangmeeCard>
      </MangmeePage>
    );
  }

  return (
    <>
      <MangmeePage
        eyebrow="การเงิน"
        title="สมุดรายรับ–รายจ่าย"
        description="ดูยอดตามเอกสารและเงินที่รับ–จ่ายจริงในที่เดียว ตัวเลขนี้ยังไม่รวมการกระทบยอดธนาคาร"
      >
        <div className="space-y-5">
        <MangmeeCard className="p-4 sm:p-5">
          <label htmlFor="ledger-month" className="block text-base font-bold text-gray-900">เดือนที่ต้องการดู</label>
          <input
            id="ledger-month"
            type="month"
            max={today.slice(0, 7)}
            className="mangmee-input mt-2 min-h-12 w-full text-base sm:max-w-xs"
            value={period.month}
            onChange={(event) => { setMonth(event.target.value); setCategoryId(''); setStatus(''); setPage(1); }}
          />
          <p className="mt-2 text-base text-gray-500">ข้อมูลถึง {formatThaiDate(period.to)}</p>
        </MangmeeCard>

        {summaryError && <ErrorBanner message={summaryError} onRetry={() => setRefreshKey((value) => value + 1)} />}
        {summaryLoading ? <SummarySkeleton /> : summary && (
          <>
            <div className="grid grid-cols-2 gap-3 [&_.mangmee-stat-label]:!text-base [&_.mangmee-stat-sub]:!text-base [&_.mangmee-stat-value]:[overflow-wrap:anywhere] lg:grid-cols-3">
              <MangmeeStatCard label="ยอดขายจากเอกสาร" value={summary.income.available ? `฿${money(summary.income.salesDocumentTotal)}` : '—'} sub={!summary.income.available ? unavailableCopy(summary.income.unavailableReason) : 'ตามวันที่ในเอกสาร'} />
              <MangmeeStatCard label="รับเงินแล้ว" value={summary.income.available ? `฿${money(summary.income.receivedTotal)}` : '—'} sub={!summary.income.available ? unavailableCopy(summary.income.unavailableReason) : Number(summary.income.withheldTaxTotal ?? 0) > 0 ? `รวมถูกหัก ณ ที่จ่าย ฿${money(summary.income.withheldTaxTotal)}` : 'ตามวันที่รับเงิน'} tone="brand" />
              <MangmeeStatCard label="รอรับเงิน" value={summary.income.available ? `฿${money(summary.income.receivableOutstanding)}` : '—'} sub={!summary.income.available ? unavailableCopy(summary.income.unavailableReason) : 'ยอด ณ ปัจจุบัน ไม่ผูกเดือนที่เลือก'} tone="amber" />
              <MangmeeStatCard label="รายจ่ายที่บันทึก" value={summary.expense.available ? `฿${money(summary.expense.recordedExpenseTotal)}` : '—'} sub={!summary.expense.available ? unavailableCopy(summary.expense.unavailableReason) : 'รายการที่ยืนยันแล้ว'} tone="amber" />
              <MangmeeStatCard label="จ่ายแล้ว" value={summary.expense.available ? `฿${money(summary.expense.paidExpenseTotal)}` : '—'} sub={!summary.expense.available ? unavailableCopy(summary.expense.unavailableReason) : 'ตามวันที่จ่ายเงิน'} tone="slate" />
              <MangmeeStatCard label="ส่วนต่างเงินรับ–เงินจ่าย" value={summary.cashDifference !== undefined ? `฿${money(summary.cashDifference)}` : '—'} sub={summary.cashDifference !== undefined ? 'เงินรับแล้ว หักเงินจ่ายแล้ว' : 'ต้องมีข้อมูลที่คำนวณสำเร็จทั้งสองฝั่ง'} tone="brand" />
            </div>
            {vatAlert && vatAlertText && (
              <section
                aria-labelledby="vat-registration-alert-title"
                className={`rounded-2xl border p-4 sm:p-5 ${vatAlert.level === 'REACHED' ? 'border-red-200 bg-red-50 text-red-950' : 'border-amber-200 bg-amber-50 text-amber-950'}`}
              >
                <h2 id="vat-registration-alert-title" className="text-lg font-bold">{vatAlertText.title}</h2>
                <p className="mt-2 text-base font-semibold">{vatAlertText.detail}</p>
                <p className="mt-2 text-base leading-7">
                  นี่เป็นการเตือนจากเอกสารที่บันทึกในมั่งมีเท่านั้น ไม่ใช่การยืนยันสถานะภาษี กรุณาให้นักบัญชีตรวจรายรับทั้งหมดและรายการยกเว้น
                  {vatAlert.level === 'REACHED' && ' หากรายรับตามกฎหมายเกินเกณฑ์ กรมสรรพากรระบุให้ยื่นคำขอจดทะเบียนภายใน 30 วันนับแต่วันที่รายรับเกิน'}
                </p>
                <a
                  href="https://www.rd.go.th/7061.html"
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-current px-4 text-base font-bold underline underline-offset-4"
                >
                  อ่านหลักเกณฑ์จากกรมสรรพากร
                </a>
              </section>
            )}
            <MangmeeCard className="border-brand-100 bg-brand-25 p-4 sm:p-5">
              <p className="text-base font-semibold text-gray-700">ส่วนต่างรายรับ–รายจ่ายที่บันทึก (ตามเอกสาร)</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-brand-800">{summary.documentDifference !== undefined ? `฿${money(summary.documentDifference)}` : '—'}</p>
              <p className="mt-1 text-base text-gray-600">ยอดขายจากเอกสาร หักรายจ่ายที่บันทึกไว้</p>
            </MangmeeCard>
          </>
        )}

        <MangmeeCard className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold text-gray-900">ยอดตามหมวด</h2>
              <p className="mt-1 text-base text-gray-600">เทียบสัดส่วนจากยอดในเดือนที่เลือก</p>
            </div>
            <div className="flex rounded-xl bg-gray-100 p-1" aria-label="เลือกฝั่งกราฟ">
              {permissions.includes('accounting.document.read') && <button type="button" className={`min-h-11 rounded-lg px-4 text-base font-semibold ${chartSide === 'INCOME' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600'}`} onClick={() => setChartSide('INCOME')}>รายรับ</button>}
              {permissions.includes('expense.read') && <button type="button" className={`min-h-11 rounded-lg px-4 text-base font-semibold ${chartSide === 'EXPENSE' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600'}`} onClick={() => setChartSide('EXPENSE')}>รายจ่าย</button>}
            </div>
          </div>
          {summaryLoading ? <ChartSkeleton />
            : summaryError ? <p className="mt-5 rounded-xl bg-red-50 p-4 text-base text-red-800">ยังแสดงยอดตามหมวดไม่ได้ กรุณากด “ลองใหม่” ด้านบน</p>
            : !chartAvailable ? <p className="mt-5 rounded-xl bg-amber-50 p-4 text-base text-amber-800">{unavailableCopy(chartReason)}</p>
              : chartRows.length === 0 ? <p className="mt-5 rounded-xl bg-gray-50 p-5 text-center text-base text-gray-600">ยังไม่มีข้อมูลหมวดในเดือนนี้</p>
                : <div className="mt-5 space-y-4">
                    {chartRows.map((row) => (
                      <div key={`${row.categoryId ?? 'none'}:${row.label}`}>
                        <div className="mb-1.5 flex items-center justify-between gap-3 text-base">
                          <span className="min-w-0 truncate font-medium text-gray-700">{row.label}</span>
                          <span className="shrink-0 font-bold tabular-nums text-gray-900">฿{money(row.amount)}</span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-gray-100"><span className={`block h-3 rounded-full ${chartSide === 'INCOME' ? 'bg-brand-500' : 'bg-amber-500'}`} style={{ width: `${ledgerBarWidth(row.amount, chartMax)}%` }} /></div>
                      </div>
                    ))}
                  </div>}
        </MangmeeCard>

        <MangmeeCard className="p-4 sm:p-5">
          <h2 className="text-xl font-bold text-gray-900">รายการในสมุด</h2>
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="เลือกประเภทรายการ">
            {entryTypes.map((entryType) => <button key={entryType} type="button" className={`min-h-11 shrink-0 rounded-full px-4 text-base font-semibold ${type === entryType ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'}`} onClick={() => selectType(entryType)}>{TYPE_LABEL[entryType]}</button>)}
          </div>
          {type === 'RECEIVABLE' && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-800">รอรับเงินเป็นยอด ณ ปัจจุบัน ไม่ผูกเดือนที่เลือก</p>}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-base font-semibold text-gray-700">
              หมวด
              <ThemedSelect className="mangmee-input mt-2 min-h-12 w-full text-base" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
                <option value="">ทุกหมวด</option>
                {categories.map((category) => <option key={category.categoryId} value={category.categoryId}>{category.label}</option>)}
              </ThemedSelect>
            </label>
            {(type === 'INCOME' || type === 'EXPENSE') && <label className="text-base font-semibold text-gray-700">
              สถานะ
              <ThemedSelect className="mangmee-input mt-2 min-h-12 w-full text-base" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
                <option value="">ทุกสถานะที่แสดงในสมุด</option>
                {(type === 'INCOME' ? INCOME_STATUSES : EXPENSE_STATUSES).map((item) => <option key={item} value={item}>{STATUS_LABEL[item]}</option>)}
              </ThemedSelect>
            </label>}
          </div>

          {entriesError && <div className="mt-4"><ErrorBanner message={entriesError} onRetry={() => setRefreshKey((value) => value + 1)} /></div>}
          {entriesLoading ? <EntriesSkeleton />
            : entries && entries.data.length === 0 ? <div className="mt-5 rounded-xl bg-gray-50 p-6 text-center"><span aria-hidden="true" className="text-4xl">📒</span><p className="mt-3 text-lg font-bold text-gray-900">ยังไม่มีรายการในช่วงที่เลือก</p><p className="mt-2 text-base text-gray-600">{emptyAction ? 'เริ่มรายการแรกได้เลย ข้อมูลจะกลับมาแสดงในสมุดนี้' : 'ลองเปลี่ยนเดือนหรือตัวกรองเพื่อค้นหารายการอื่น'}</p>{emptyAction && <Link href={emptyAction.href} className="mangmee-btn mangmee-btn-primary mt-4 min-h-14 text-base">{emptyAction.label}</Link>}</div>
              : entries && <>
                  <div className="mt-5 space-y-3 md:hidden">
                    {entries.data.map((entry) => (
                      <EntryCard
                        key={`${entry.side}:${entry.id}`}
                        entry={entry}
                        today={today}
                        canReceivePayment={type === 'RECEIVABLE' && canReceiveLedgerPayment(entry, permissions)}
                        onReceivePayment={() => setPaymentEntry(entry)}
                      />
                    ))}
                  </div>
                  <div className="mangmee-table-scroll mt-5 hidden md:block">
                    <table className="mangmee-table min-w-full" style={{ fontSize: '1rem' }}>
                      <thead>
                        <tr>
                          {[
                            'ประเภท', 'วันที่', 'เลขเอกสาร', 'คู่ค้า', 'หมวด', 'สถานะ',
                            'จำนวนเงิน', 'ยอดค้าง', 'ครบกำหนด',
                            ...(type === 'RECEIVABLE' && canReceivePayment ? ['ทำรายการ'] : []),
                          ].map((label) => <th className="!text-base" key={label}>{label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {entries.data.map((entry) => {
                          const overdue = isLedgerEntryOverdue(entry.dueDate, today, entry.outstandingAmount);
                          const canReceive = type === 'RECEIVABLE' && canReceiveLedgerPayment(entry, permissions);
                          return (
                            <tr
                              key={`${entry.side}:${entry.id}`}
                              className="cursor-pointer"
                              onClick={(event) => {
                                if (!(event.target as HTMLElement).closest('a,button')) router.push(entry.evidenceHref);
                              }}
                            >
                              <td><MangmeeBadge className="!text-base" tone={entry.side === 'INCOME' ? 'brand' : 'amber'}>{entry.side === 'INCOME' ? 'รายรับ' : 'รายจ่าย'}</MangmeeBadge></td>
                              <td>{formatThaiDate(entry.date)}</td>
                              <td><Link className="font-semibold text-brand-700 hover:underline" href={entry.evidenceHref}>{entry.referenceNumber ?? 'ยังไม่มีเลข'}</Link></td>
                              <td>{entry.partyName ?? 'ไม่ระบุคู่ค้า'}</td>
                              <td>{entry.categoryLabels.join(' · ') || 'ยังไม่จัดหมวด'}</td>
                              <td>{STATUS_LABEL[entry.status] ?? 'สถานะเอกสาร'}</td>
                              <td className="text-right font-bold tabular-nums">฿{money(entry.amount)}</td>
                              <td className="text-right font-semibold tabular-nums">{entry.outstandingAmount !== undefined && Number(entry.outstandingAmount) > 0 ? `฿${money(entry.outstandingAmount)}` : '—'}</td>
                              <td>
                                {entry.dueDate ? (
                                  <span className={overdue ? 'font-semibold text-red-700' : ''}>
                                    {formatThaiDate(entry.dueDate)}
                                    {overdue && <span className="ml-2 inline-block rounded-full bg-red-50 px-2 py-1 font-semibold">เกินกำหนด</span>}
                                  </span>
                                ) : '—'}
                              </td>
                              {type === 'RECEIVABLE' && canReceivePayment && (
                                <td>{canReceive ? <button type="button" className="mangmee-btn mangmee-btn-primary min-h-11 text-base" onClick={() => setPaymentEntry(entry)}>รับชำระ</button> : '—'}</td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11" disabled={entries.page <= 1 || entriesLoading} onClick={() => setPage((value) => Math.max(1, value - 1))}>ก่อนหน้า</button>
                    <span className="text-base text-gray-600">หน้า {entries.page.toLocaleString('th-TH')}</span>
                    <button type="button" className="mangmee-btn mangmee-btn-secondary min-h-11" disabled={entries.page * entries.pageSize >= entries.total || entriesLoading} onClick={() => setPage((value) => value + 1)}>ถัดไป</button>
                  </div>
                </>}

          {canDownload && (
            <div className="mt-6 border-t border-gray-100 pt-5">
              <button type="button" className="mangmee-btn mangmee-btn-primary min-h-14 w-full text-base sm:w-auto" disabled={Boolean(exportDisabledReason)} onClick={() => void download()}>{exporting ? 'กำลังเตรียมไฟล์...' : 'ดาวน์โหลด Excel และ CSV'}</button>
              {exportDisabledReason && <p className="mt-2 text-base text-gray-600">{exportDisabledReason}</p>}
            </div>
          )}
        </MangmeeCard>

        {(canRecordIncome || canUploadExpense || canCreateExpense) && (
          <MangmeeCard className="p-4 sm:p-5">
            <h2 className="text-lg font-bold text-gray-900">เพิ่มรายการใหม่</h2>
            <p className="mt-1 text-base text-gray-600">เลือกวิธีที่ตรงกับเอกสารในมือ</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {canRecordIncome && <Link href={`/companies/${companyId}/sales-documents`} className="mangmee-btn mangmee-btn-secondary min-h-14 text-base">บันทึกรายรับ</Link>}
              {canUploadExpense && <Link href={`/companies/${companyId}/expenses/upload`} className="mangmee-btn mangmee-btn-secondary min-h-14 text-base">ถ่ายหรืออัปโหลดใบเสร็จ</Link>}
              {canCreateExpense && <Link href={`/companies/${companyId}/expenses/manual`} className="mangmee-btn mangmee-btn-secondary min-h-14 text-base">กรอกรายจ่ายเอง</Link>}
            </div>
          </MangmeeCard>
        )}
        </div>
      </MangmeePage>
      {paymentEntry && <ReceivePaymentModal companyId={companyId} entry={paymentEntry} today={today} onClose={() => setPaymentEntry(null)} onDone={() => { setPaymentEntry(null); setRefreshKey((value) => value + 1); }} />}
    </>
  );
}
