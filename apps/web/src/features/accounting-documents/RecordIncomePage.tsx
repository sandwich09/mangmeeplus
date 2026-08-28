'use client';

// "บันทึกรายรับ" journey — income-expense-ledger spec F-LED-1 + F-LED-7 S1.
// Mobile-first 390px for 40+ nontechnical users: one question, two big choices, one primary
// action with its disabled reason under it, live totals after the form, no button that predictably fails.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { useToast } from '@/common/components/toast';
import { useBranchFilter } from '@/features/web-core-workspace/WorkspaceScope';
import { ErrorBanner, baht, err, inputClass, btnClass, ghostClass } from '@/features/expenses/ExpensesUi';
import { todayCivilDate } from '@watchdog-bms/contracts';
import type { AccountingPaymentMethod, RevenueCategorySummary } from '@watchdog-bms/contracts';
import { ATTACHMENT_UPLOAD_ACCEPT, uploadFileValidationError } from '@/common/files/upload-file.logic';
import {
  createDocument,
  getVatRegistrationStatus,
  issueDocument,
  listCounterparties,
  listRevenueCategories,
  recordSimpleIncome,
  uploadAccountingDocumentSupporting,
} from './accounting-documents.api';
import { PAYMENT_METHOD_LABELS } from './accounting-documents.model';
import { TransactionBranchField, useTransactionCreateBranchId } from '../web-core-workspace/TransactionBranchField';
import type { CounterpartySummary, DocumentDetail } from './accounting-documents.model';
import {
  VAT_CHOICE_LABELS,
  buildInvoiceDraftInput,
  buildSimpleIncomeInput,
  canCreateIncomeInvoice,
  canIssueIncomeInvoice,
  canRecordReceivedIncome,
  computeIncomeTotals,
  defaultVatChoiceForCategory,
  emptyIncomeLine,
  incomeSubmitBlocker,
  invoiceDraftIdempotencyKey,
  simpleIncomeIdempotencyKey,
  vatVisibilityFromStatus,
  type IncomeFormSnapshot,
  type IncomeLineDraft,
  type IncomeMode,
  type LineVatChoice,
  type VatVisibility,
} from './income-record.logic';
import { useSalesRootAvailability } from './sales-root-availability';

function ChoiceButton({ active, onClick, disabled, children, ariaLabel }: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'min-h-12 rounded-xl border px-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        active ? 'border-brand-500 bg-brand-25 text-brand-700 ring-2 ring-brand-200' : 'border-gray-200 bg-white text-gray-700 hover:border-brand-200',
      )}
    >
      {children}
    </button>
  );
}

export function RecordIncomePage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const canReceived = canRecordReceivedIncome(permissions);
  const canInvoice = canCreateIncomeInvoice(permissions);
  const canIssue = canIssueIncomeInvoice(permissions);
  const canReadVatStatus = permissions.includes('company.vat_registration.read');
  const salesAvailability = useSalesRootAvailability(companyId, (canReceived || canInvoice) && canReadVatStatus);
  const [mode, setMode] = useState<IncomeMode | null>(null);

  // Deep link ?mode=..., honoured only when the user can actually finish that journey (7.2 row 1).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const requested = new URLSearchParams(window.location.search).get('mode');
    if (requested === 'received' && canReceived) setMode('received');
    if (requested === 'invoice' && canInvoice) setMode('invoice');
  }, [canReceived, canInvoice]);

  if (!canReceived && !canInvoice) {
    // Reachable only by direct URL — every menu/button into here is permission-gated already.
    return (
      <MangmeePage eyebrow="การเงินและบัญชี" title="บันทึกรายรับ">
        <MangmeeCard className="p-6 text-center">
          <div className="text-3xl" aria-hidden="true">🔒</div>
          <p className="mt-2 text-base font-semibold text-gray-800">คุณยังไม่มีสิทธิ์บันทึกรายรับ</p>
          <p className="mt-1 text-base text-gray-500">ติดต่อเจ้าของกิจการเพื่อขอสิทธิ์สร้างและออกเอกสารขาย</p>
          <a href={`/companies/${companyId}/sales-documents`} className={`${ghostClass} mt-4 inline-flex h-11 items-center`}>ไปหน้าเอกสารขาย</a>
        </MangmeeCard>
      </MangmeePage>
    );
  }

  if (!canReadVatStatus) {
    return (
      <MangmeePage eyebrow="การเงินและบัญชี" title="บันทึกรายรับ">
        <MangmeeCard className="p-6 text-center">
          <p className="text-lg font-bold text-gray-900">ยังตรวจสถานะ VAT ของกิจการไม่ได้</p>
          <p className="mt-2 text-base text-gray-600">ติดต่อเจ้าของกิจการเพื่อเพิ่มสิทธิ์ดูสถานะ VAT ก่อนบันทึกรายรับ เพื่อป้องกันการออกเอกสารผิดประเภท</p>
          <a href={`/companies/${companyId}/sales-documents`} className={`${ghostClass} mt-4 inline-flex min-h-11 items-center`}>กลับหน้าเอกสารขาย</a>
        </MangmeeCard>
      </MangmeePage>
    );
  }

  if (salesAvailability.state !== 'OPEN') {
    return (
      <MangmeePage eyebrow="การเงินและบัญชี" title="บันทึกรายรับ">
        <MangmeeCard className="border-amber-200 bg-amber-50 p-6 text-center">
          <p className="text-lg font-bold text-amber-950">
            {salesAvailability.state === 'LOADING' ? 'กำลังตรวจสอบความพร้อมของระบบ...'
              : salesAvailability.state === 'CLOSED' ? 'ยังบันทึกรายรับใหม่ไม่ได้ชั่วคราว'
                : 'ยังตรวจสอบความพร้อมของระบบไม่ได้'}
          </p>
          <p className="mt-2 text-base text-amber-900">รายการเดิมยังเปิดดูและรับชำระได้ตามปกติ</p>
          {salesAvailability.state === 'ERROR' && <button type="button" className={`${ghostClass} mt-4 min-h-12`} onClick={salesAvailability.retry}>ลองตรวจสอบอีกครั้ง</button>}
          <a href={`/companies/${companyId}/sales-documents`} className={`${ghostClass} mt-4 inline-flex min-h-12 items-center`}>ดูรายการเดิม</a>
        </MangmeeCard>
      </MangmeePage>
    );
  }

  if (mode === null) {
    return (
      <MangmeePage
        eyebrow="การเงินและบัญชี"
        title="บันทึกรายรับ"
        description="เลือกวิธีที่ตรงกับการขายครั้งนี้"
        actions={<a href={`/companies/${companyId}/sales-documents`} className="text-base font-semibold text-brand-600 hover:text-brand-700">← เอกสารขาย</a>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {canReceived && (
            <button
              type="button"
              onClick={() => setMode('received')}
              className="mangmee-card min-h-[132px] p-5 text-left transition hover:border-brand-300 hover:bg-brand-25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              <div className="text-3xl" aria-hidden="true">💵</div>
              <div className="mt-2 text-lg font-bold text-gray-900">รับเงินแล้ว</div>
              <div className="mt-1 text-base leading-relaxed text-gray-600">ขายแล้วเก็บเงินทันที — ระบบออกเอกสารขาย บันทึกรับเงิน และออกใบเสร็จให้ครบในครั้งเดียว</div>
            </button>
          )}
          {canInvoice && (
            <button
              type="button"
              onClick={() => setMode('invoice')}
              className="mangmee-card min-h-[132px] p-5 text-left transition hover:border-brand-300 hover:bg-brand-25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
            >
              <div className="text-3xl" aria-hidden="true">🧾</div>
              <div className="mt-2 text-lg font-bold text-gray-900">ออกบิลไว้ก่อน</div>
              <div className="mt-1 text-base leading-relaxed text-gray-600">ส่งบิลให้ลูกค้า รอเก็บเงินภายหลัง{!canIssue ? ' — คุณบันทึกได้เป็นร่าง ผู้มีสิทธิ์ออกบิลเป็นผู้ยืนยัน' : ''}</div>
            </button>
          )}
        </div>
      </MangmeePage>
    );
  }

  return (
    <IncomeForm
      key={mode}
      companyId={companyId}
      mode={mode}
      canIssueInvoice={canIssue}
      canAttach={permissions.includes('attachment.create')}
      onBack={() => setMode(null)}
    />
  );
}

function IncomeForm({ companyId, mode, canIssueInvoice, canAttach, onBack }: {
  companyId: string;
  mode: IncomeMode;
  canIssueInvoice: boolean;
  canAttach: boolean;
  onBack: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const branch = useBranchFilter();
  const branchId = useTransactionCreateBranchId() || undefined;

  const [documentDate, setDocumentDate] = useState(todayCivilDate());
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<IncomeLineDraft[]>([emptyIncomeLine()]);
  const [counterpartyId, setCounterpartyId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<AccountingPaymentMethod | null>(null);
  const [priceIncludesVat, setPriceIncludesVat] = useState<boolean | null>(null);
  const [note, setNote] = useState('');
  const [whtRate, setWhtRate] = useState('');
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentLinked, setAttachmentLinked] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Invoice mode, truth after a partial failure: the draft exists even though issue failed.
  const [failedDraft, setFailedDraft] = useState<DocumentDetail | null>(null);
  const [savedReceived, setSavedReceived] = useState<Awaited<ReturnType<typeof recordSimpleIncome>> | null>(null);
  const [failedStep, setFailedStep] = useState<'attachment' | 'issue' | null>(null);
  // Per-page-load nonce for the deterministic idempotency key (see income-record.logic).
  const nonceRef = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'n0');

  const [visibility, setVisibility] = useState<VatVisibility>('LOADING');
  const [vatRetryKey, setVatRetryKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setVisibility('LOADING');
    // asOf = the document date: a company that registered mid-year must not get VAT controls on
    // an earlier-dated sale (same rule as the expense capture policy). A failed read shows the
    // controls. A failed read is an explicit retry state: neither showing nor hiding VAT is safe
    // without the effective-date fact.
    getVatRegistrationStatus(companyId, documentDate)
      .then((view) => { if (!cancelled) setVisibility(vatVisibilityFromStatus(view.status)); })
      .catch(() => { if (!cancelled) setVisibility('ERROR'); });
    return () => { cancelled = true; };
  }, [companyId, documentDate, vatRetryKey]);

  const [categories, setCategories] = useState<RevenueCategorySummary[] | null>(null);
  const [categoriesUnavailable, setCategoriesUnavailable] = useState(false);
  const [categoriesRetryKey, setCategoriesRetryKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setCategories(null);
    setCategoriesUnavailable(false);
    listRevenueCategories(companyId)
      .then((data) => { if (!cancelled) setCategories([...data].sort((a, b) => a.sortOrder - b.sortOrder)); })
      .catch(() => { if (!cancelled) { setCategories([]); setCategoriesUnavailable(true); } });
    return () => { cancelled = true; };
  }, [companyId, categoriesRetryKey]);

  const [counterparties, setCounterparties] = useState<CounterpartySummary[] | null>(null);
  const [counterpartiesUnavailable, setCounterpartiesUnavailable] = useState(false);
  const [counterpartiesRetryKey, setCounterpartiesRetryKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setCounterparties(null);
    setCounterpartiesUnavailable(false);
    listCounterparties(companyId, { pageSize: 200 })
      .then((res) => {
        if (cancelled) return;
        setCounterparties(res.data.filter((c) => c.status === 'ACTIVE' && c.type !== 'VENDOR'));
      })
      .catch(() => { if (!cancelled) { setCounterparties([]); setCounterpartiesUnavailable(true); } });
    return () => { cancelled = true; };
  }, [companyId, counterpartiesRetryKey]);

  const form: IncomeFormSnapshot = { mode, visibility, lines, priceIncludesVat, paymentMethod, whtRate, documentDate, dueDate };
  const totals = computeIncomeTotals(form);
  const blocker = (!branchId ? 'กรุณาเลือกสาขาของรายการ' : null) ?? attachmentError ?? incomeSubmitBlocker(form);
  const showVat = visibility === 'SHOWN';
  const anyVat7 = showVat && lines.some((line) => line.vatChoice === 'VAT7');
  const draftOnly = mode === 'invoice' && !canIssueInvoice;

  const updateLine = (index: number, patch: Partial<IncomeLineDraft>) =>
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const changeCategory = (index: number, categoryId: string) => {
    const category = (categories ?? []).find((c) => c.id === categoryId);
    // §7.9: the category is the only source of a VAT default; a category with no confirmed code
    // (or no category) resets the line to "must choose" — the system never guesses.
    updateLine(index, {
      revenueCategoryId: categoryId,
      vatChoice: categoryId ? defaultVatChoiceForCategory(category?.defaultOutputTaxCode) : null,
    });
  };

  const methods: AccountingPaymentMethod[] = advancedOpen || paymentMethod === 'CHEQUE'
    ? ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER', 'CHEQUE']
    : ['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER'];

  const cta = mode === 'received'
    ? `บันทึกรับเงิน ${baht(totals.grand)}`
    : draftOnly ? 'บันทึกร่างใบแจ้งหนี้' : `ออกบิล ${baht(totals.grand)}`;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const extras = { counterpartyId: counterpartyId || undefined, branchId, note: note.trim() || undefined };
      if (mode === 'received') {
        let result = savedReceived;
        if (!result) {
          const { idempotencyKey: _placeholder, ...payload } = buildSimpleIncomeInput(form, { ...extras, idempotencyKey: 'pending' });
          const idempotencyKey = simpleIncomeIdempotencyKey(nonceRef.current, payload);
          result = await recordSimpleIncome(companyId, { ...payload, idempotencyKey });
        }
        if (attachmentFile && !attachmentLinked) {
          try {
            await uploadAccountingDocumentSupporting(companyId, result.invoice.id, result.invoice.branchId, attachmentFile);
            setAttachmentLinked(true);
          } catch (uploadError) {
            setSavedReceived(result);
            setFailedStep('attachment');
            setError(err(uploadError));
            return;
          }
        }
        toast.success(result.receipt.documentNumber
          ? `บันทึกรายรับเรียบร้อย · ออกใบเสร็จ ${result.receipt.documentNumber} ให้แล้ว`
          : 'บันทึกรายรับเรียบร้อย · ออกใบเสร็จให้แล้ว');
        router.replace(`/companies/${companyId}/sales-documents?documentId=${encodeURIComponent(result.invoice.id)}`);
        return;
      }
      // Invoice mode: create once, then issue. A failed issue never re-creates and never
      // pretends to roll back — the saved draft is shown truthfully instead.
      const draft = failedDraft ?? await createDocument(companyId, buildInvoiceDraftInput(form, {
        ...extras,
        idempotencyKey: invoiceDraftIdempotencyKey(nonceRef.current),
      }));
      let attachmentReady = attachmentLinked;
      try {
        if (attachmentFile && !attachmentReady) {
          await uploadAccountingDocumentSupporting(companyId, draft.id, draft.branchId, attachmentFile);
          attachmentReady = true;
          setAttachmentLinked(true);
        }
        if (draftOnly) {
          toast.success('บันทึกร่างใบแจ้งหนี้แล้ว — ผู้มีสิทธิ์ออกบิลเป็นผู้ยืนยันอีกครั้ง');
          router.replace(`/companies/${companyId}/sales-documents?documentId=${encodeURIComponent(draft.id)}`);
          return;
        }
        const issued = await issueDocument(companyId, draft.id);
        toast.success(issued.documentNumber ? `ออกบิลเรียบร้อยแล้ว · เลขที่ ${issued.documentNumber}` : 'ออกบิลเรียบร้อยแล้ว');
        router.replace(`/companies/${companyId}/sales-documents?documentId=${encodeURIComponent(issued.id)}`);
      } catch (issueError) {
        setFailedDraft(draft);
        setFailedStep(attachmentFile && !attachmentReady ? 'attachment' : 'issue');
        setError(err(issueError));
      }
    } catch (submitError) {
      setError(err(submitError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <MangmeePage
      eyebrow="การเงินและบัญชี"
      title={mode === 'received' ? 'บันทึกรายรับ — รับเงินแล้ว' : 'บันทึกรายรับ — ออกบิลไว้ก่อน'}
      description={mode === 'received' ? 'กรอกรายการขาย เลือกช่องทางรับเงิน ระบบออกเอกสารและใบเสร็จให้ครบ' : 'กรอกรายการขายเพื่อออกบิลให้ลูกค้า แล้วตามเก็บเงินภายหลัง'}
      actions={<button type="button" className="text-base font-semibold text-brand-600 hover:text-brand-700" onClick={onBack}>← เปลี่ยนวิธีบันทึก</button>}
    >
      <div className="mx-auto w-full max-w-2xl space-y-4 pb-6">
        {!savedReceived && !failedDraft && <TransactionBranchField value={branchId ?? ''} />}
        {savedReceived ? (
          <MangmeeCard className="space-y-3 p-4">
            <ErrorBanner message={`บันทึกรายรับและออกใบเสร็จแล้ว แต่แนบไฟล์ไม่สำเร็จ: ${error ?? 'เกิดข้อผิดพลาด'}`} />
            <p className="text-base leading-relaxed text-gray-800">รายการไม่สูญหายและระบบจะไม่บันทึกซ้ำ ลองแนบไฟล์เดิมอีกครั้ง หรือเปิดเอกสารที่บันทึกแล้ว</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={`${btnClass} h-12`} disabled={busy} onClick={() => void submit()}>
                {busy ? 'กำลังแนบไฟล์...' : 'ลองแนบไฟล์อีกครั้ง'}
              </button>
              <a className={`${ghostClass} flex h-12 items-center justify-center`} href={`/companies/${companyId}/sales-documents?documentId=${encodeURIComponent(savedReceived.invoice.id)}`}>
                เปิดรายการที่บันทึกแล้ว
              </a>
            </div>
          </MangmeeCard>
        ) : failedDraft ? (
          <MangmeeCard className="space-y-3 p-4">
            <ErrorBanner message={`${failedStep === 'attachment' ? 'บันทึกร่างแล้ว แต่แนบไฟล์ไม่สำเร็จ' : 'ออกบิลไม่สำเร็จ'}: ${error ?? 'เกิดข้อผิดพลาด'}`} />
            <p className="text-base leading-relaxed text-gray-800">
              ร่างใบแจ้งหนี้ถูกบันทึกไว้เรียบร้อยแล้ว (ยังไม่ออกเลขเอกสาร) ข้อมูลที่กรอกไม่หาย —
              {failedStep === 'attachment' ? ' ลองแนบไฟล์อีกครั้ง หรือเปิดร่างเพื่อตรวจสอบ' : ' ลองออกบิลอีกครั้ง หรือเปิดร่างเพื่อตรวจและออกบิลจากหน้าเอกสารขาย'}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" className={`${btnClass} h-12`} disabled={busy} onClick={() => void submit()}>
                {busy ? 'กำลังทำรายการ...' : failedStep === 'attachment' ? 'ลองแนบไฟล์อีกครั้ง' : 'ลองออกบิลอีกครั้ง'}
              </button>
              <a className={`${ghostClass} flex h-12 items-center justify-center`} href={`/companies/${companyId}/sales-documents?documentId=${encodeURIComponent(failedDraft.id)}`}>
                เปิดร่างใบแจ้งหนี้
              </a>
            </div>
          </MangmeeCard>
        ) : (
          <fieldset disabled={busy} className="min-w-0 space-y-4">
            {error && <ErrorBanner message={error} />}
            {visibility === 'ERROR' && (
              <MangmeeCard className="space-y-3 border-red-200 bg-red-50 p-4">
                <ErrorBanner message="ตรวจสอบสถานะ VAT ไม่สำเร็จ ข้อมูลที่กรอกยังอยู่ครบ" />
                <button type="button" className={`${ghostClass} min-h-11 w-full text-base`} onClick={() => setVatRetryKey((value) => value + 1)}>ลองตรวจสถานะ VAT อีกครั้ง</button>
              </MangmeeCard>
            )}
            {visibility === 'UNKNOWN' && (
              <MangmeeCard className="border-amber-200 bg-amber-50 p-4">
                <p className="text-base font-bold text-amber-900">กิจการยังไม่ได้ยืนยันสถานะจดทะเบียน VAT</p>
                <p className="mt-1 text-base text-amber-800">กรุณาให้เจ้าของกิจการหรือนักบัญชียืนยันสถานะ VAT ก่อน เพื่อไม่ให้ออกเอกสารผิดประเภท ข้อมูลที่กรอกไว้ยังอยู่ครบ</p>
              </MangmeeCard>
            )}

            <MangmeeCard className="space-y-3 p-4">
              <label className="block text-base font-bold text-gray-700">
                {mode === 'received' ? 'วันที่รับเงิน' : 'วันที่เอกสาร'}
                <ThemedDate className={`${inputClass} mt-1`} value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} aria-label={mode === 'received' ? 'วันที่รับเงิน' : 'วันที่เอกสาร'} />
              </label>
              {mode === 'invoice' && (
                <label className="block text-base font-bold text-gray-700">
                  วันครบกำหนดชำระ <span className="font-normal text-gray-500">(ไม่บังคับ)</span>
                  <ThemedDate className={`${inputClass} mt-1`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="วันครบกำหนดชำระ" />
                </label>
              )}
            </MangmeeCard>

            <MangmeeCard className="space-y-3 p-4">
              <h2 className="text-base font-bold text-gray-900">รายการขาย</h2>
              {lines.map((line, index) => {
                const started = line.description.trim() !== '' || line.amount.trim() !== '';
                return (
                  <div key={index} className="space-y-2 rounded-xl border border-gray-200 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-semibold text-gray-500">รายการที่ {index + 1}</span>
                      {lines.length > 1 && (
                        <button type="button" className="flex h-11 items-center px-2 text-base font-semibold text-error-500" onClick={() => setLines((current) => current.filter((_l, i) => i !== index))}>
                          ลบรายการ
                        </button>
                      )}
                    </div>
                    <input
                      autoFocus={index === 0}
                      className={inputClass}
                      placeholder="ขายอะไร เช่น ข้าวสาร 5 กก."
                      maxLength={500}
                      value={line.description}
                      onChange={(e) => updateLine(index, { description: e.target.value })}
                      aria-label={`รายละเอียดของรายการที่ ${index + 1}`}
                    />
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                      <label className="block text-base text-gray-600">
                        ราคาต่อหน่วย (บาท)
                        <input
                          className={`${inputClass} mt-1 text-right`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={line.amount}
                          onChange={(e) => updateLine(index, { amount: e.target.value })}
                          aria-label={`จำนวนเงินของรายการที่ ${index + 1}`}
                        />
                      </label>
                      <label className="block text-base text-gray-600">
                        จำนวน
                        <input
                          className={`${inputClass} mt-1 text-right`}
                          inputMode="decimal"
                          value={line.quantity}
                          onChange={(e) => updateLine(index, { quantity: e.target.value })}
                          aria-label={`จำนวนของรายการที่ ${index + 1}`}
                        />
                      </label>
                    </div>
                    <label className="block text-base text-gray-600">
                      หมวดรายรับ
                      {categories === null ? (
                        <div className={`${inputClass} mt-1 flex items-center text-gray-400`}>กำลังโหลดหมวด...</div>
                      ) : categoriesUnavailable ? (
                        <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-base text-amber-900">
                          <p>โหลดหมวดรายรับไม่สำเร็จ — ยังบันทึกแบบไม่ระบุหมวดได้</p>
                          <button type="button" className="mt-2 min-h-11 font-semibold text-brand-700 underline" onClick={() => setCategoriesRetryKey((value) => value + 1)}>ลองโหลดหมวดอีกครั้ง</button>
                        </div>
                      ) : (
                        <ThemedSelect className={`${inputClass} mt-1`} value={line.revenueCategoryId} onChange={(e) => changeCategory(index, e.target.value)} aria-label={`หมวดรายรับของรายการที่ ${index + 1}`}>
                          <option value="">ไม่ระบุหมวด</option>
                          {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                        </ThemedSelect>
                      )}
                    </label>
                    {visibility === 'LOADING' && <p className="text-base text-gray-500">กำลังตรวจสถานะ VAT ของกิจการ...</p>}
                    {showVat && (
                      <label className="block text-base text-gray-600">
                        VAT ของรายการนี้
                        <ThemedSelect
                          className={`${inputClass} mt-1`}
                          value={line.vatChoice ?? ''}
                          onChange={(e) => updateLine(index, { vatChoice: (e.target.value || null) as LineVatChoice })}
                          aria-label={`วิธีคิด VAT ของรายการที่ ${index + 1}`}
                          aria-invalid={started && line.vatChoice === null}
                        >
                          <option value="">ยังไม่เลือก — ต้องเลือกก่อนยืนยัน</option>
                          <option value="VAT7">{VAT_CHOICE_LABELS.VAT7}</option>
                          <option value="EXEMPT">{VAT_CHOICE_LABELS.EXEMPT}</option>
                          <option value="ZERO">{VAT_CHOICE_LABELS.ZERO}</option>
                        </ThemedSelect>
                        {started && line.vatChoice === null && (
                          <span className="mt-1 block text-base font-semibold text-amber-700">เลือกวิธีคิด VAT ของรายการนี้ — ระบบไม่เดาให้</span>
                        )}
                      </label>
                    )}
                    {advancedOpen && (
                      <label className="block text-base text-gray-600">
                        ส่วนลด (บาท)
                        <input
                          className={`${inputClass} mt-1 text-right`}
                          inputMode="decimal"
                          placeholder="0.00"
                          value={line.discountAmount}
                          onChange={(e) => updateLine(index, { discountAmount: e.target.value })}
                          aria-label={`ส่วนลดของรายการที่ ${index + 1}`}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
              <button type="button" className={`${ghostClass} h-12 w-full`} onClick={() => setLines((current) => [...current, emptyIncomeLine(current[current.length - 1])])}>
                + เพิ่มรายการ
              </button>
            </MangmeeCard>

            {anyVat7 && (
              <MangmeeCard className="space-y-2 p-4">
                <div className="text-base font-bold text-gray-700">ราคาที่กรอกรวม VAT แล้วหรือยัง</div>
                <div className="grid grid-cols-2 gap-2">
                  <ChoiceButton active={priceIncludesVat === true} onClick={() => setPriceIncludesVat(true)}>รวม VAT แล้ว</ChoiceButton>
                  <ChoiceButton active={priceIncludesVat === false} onClick={() => setPriceIncludesVat(false)}>ยังไม่รวม VAT</ChoiceButton>
                </div>
              </MangmeeCard>
            )}

            <MangmeeCard className="space-y-2 p-4">
              <div className="text-base font-bold text-gray-700">ลูกค้า <span className="font-normal text-gray-500">(ไม่บังคับ)</span></div>
              {counterparties === null ? (
                <div className={`${inputClass} flex items-center text-gray-400`}>กำลังโหลดรายชื่อลูกค้า...</div>
              ) : counterpartiesUnavailable ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-base text-amber-900">
                  <p>โหลดรายชื่อลูกค้าไม่สำเร็จ — ตอนนี้บันทึกเป็น “ลูกค้าทั่วไป” ได้</p>
                  <button type="button" className="mt-2 min-h-11 font-semibold text-brand-700 underline" onClick={() => setCounterpartiesRetryKey((value) => value + 1)}>ลองโหลดรายชื่อลูกค้าอีกครั้ง</button>
                </div>
              ) : (
                <ThemedSelect className={inputClass} value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)} aria-label="ลูกค้า">
                  <option value="">ลูกค้าทั่วไป (ไม่ระบุชื่อ)</option>
                  {counterparties.map((counterparty) => <option key={counterparty.id} value={counterparty.id}>{counterparty.displayName}</option>)}
                </ThemedSelect>
              )}
              <p className="text-base text-gray-500">ไม่เลือก = ไม่ระบุชื่อลูกค้า ระบบไม่สร้างรายชื่อลูกค้าใหม่ให้เอง</p>
            </MangmeeCard>

            {mode === 'received' && (
              <MangmeeCard className="space-y-2 p-4">
                <div className="text-base font-bold text-gray-700">ช่องทางรับเงิน</div>
                <div className="grid grid-cols-2 gap-2">
                  {methods.map((method) => (
                    <ChoiceButton key={method} active={paymentMethod === method} onClick={() => setPaymentMethod(method)}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </ChoiceButton>
                  ))}
                </div>
              </MangmeeCard>
            )}

            <MangmeeCard className="p-4">
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between text-left text-base font-bold text-gray-700"
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((open) => !open)}
              >
                ตัวเลือกเพิ่มเติม
                <span aria-hidden="true" className="text-gray-400">{advancedOpen ? '▲' : '▼'}</span>
              </button>
              {advancedOpen && (
                <div className="mt-3 space-y-3">
                  <label className="block text-base text-gray-600">
                    หมายเหตุ
                    <input className={`${inputClass} mt-1`} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} aria-label="หมายเหตุ" />
                  </label>
                  {canAttach && (
                    <label className="block text-base text-gray-600">
                      ไฟล์แนบ <span className="text-gray-500">(ไม่บังคับ)</span>
                      <input
                        className={`${inputClass} mt-1 py-2`}
                        type="file"
                        accept={ATTACHMENT_UPLOAD_ACCEPT}
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          const fileError = file ? uploadFileValidationError(file) : null;
                          setAttachmentError(fileError);
                          setAttachmentFile(fileError ? null : file);
                          setAttachmentLinked(false);
                        }}
                        aria-label="ไฟล์แนบเอกสารขาย"
                      />
                      <span className="mt-1 block text-base text-gray-500">รองรับ PDF, JPG และ PNG</span>
                      {attachmentError && <span className="mt-1 block text-base font-semibold text-red-700">{attachmentError}</span>}
                    </label>
                  )}
                  <label className="block text-base text-gray-600">
                    ลูกค้าหัก ณ ที่จ่าย (%)
                    <input className={`${inputClass} mt-1 text-right`} inputMode="decimal" placeholder="เว้นว่างถ้าไม่ถูกหัก" value={whtRate} onChange={(e) => setWhtRate(e.target.value)} aria-label="อัตราถูกหัก ณ ที่จ่าย" />
                  </label>
                  <p className="text-base text-gray-500">เปิดส่วนนี้แล้วมีช่อง "ส่วนลด" ในแต่ละรายการด้านบน{mode === 'received' ? ' และช่องทาง "เช็ค" ในช่องทางรับเงิน' : ''}</p>
                </div>
              )}
            </MangmeeCard>
          </fieldset>
        )}
      </div>

      {!failedDraft && (
        <div className="mangmee-safe-bottom mx-auto w-full max-w-2xl">
          <div className="rounded-t-2xl border border-gray-200 bg-white p-4 shadow-[0_-8px_24px_rgba(16,24,40,0.08)] sm:rounded-2xl">
            <dl className="space-y-1 text-base">
              {showVat && (
                <>
                  <div className="flex justify-between"><dt className="text-gray-500">ยอดก่อน VAT</dt><dd className="tabular-nums text-gray-800">{baht(totals.taxable)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500">VAT</dt><dd className="tabular-nums text-gray-800">{baht(totals.vat)}</dd></div>
                </>
              )}
              <div className="flex items-baseline justify-between font-bold text-gray-900"><dt className="text-base">ยอดรวมทั้งสิ้น</dt><dd className="tabular-nums text-xl">{baht(totals.grand)}</dd></div>
              {totals.wht > 0 && (
                <>
                  <div className="flex justify-between"><dt className="text-gray-500">ถูกหัก ณ ที่จ่าย</dt><dd className="tabular-nums text-gray-800">−{baht(totals.wht)}</dd></div>
                  {mode === 'received' && <div className="flex justify-between font-semibold text-gray-900"><dt>เงินที่ได้รับจริง</dt><dd className="tabular-nums">{baht(totals.cash)}</dd></div>}
                </>
              )}
            </dl>
            <button type="button" className={`${btnClass} mt-3 h-14 w-full text-base`} disabled={busy || !!blocker} onClick={() => void submit()}>
              {busy ? 'กำลังบันทึก...' : cta}
            </button>
            {blocker && !busy && <p role="status" className="mt-2 text-center text-base font-medium text-gray-600">{blocker}</p>}
            {!blocker && !busy && draftOnly && <p className="mt-2 text-center text-base text-gray-500">จะบันทึกเป็นร่าง — ผู้มีสิทธิ์ออกบิลเป็นผู้กดออกเอกสาร</p>}
          </div>
        </div>
      )}
    </MangmeePage>
  );
}
