'use client';

import { isExpenseEvidenceFile, expenseEvidenceAssessment, expenseEvidenceInputError, EXPENSE_RECEIPT_SOURCE_TYPES, type ExpenseEvidenceAssessment } from '@watchdog-bms/contracts';

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent, type DragEvent, type FormEvent, type MutableRefObject, type ReactNode } from 'react';
import Link from 'next/link';
import type { CreateExpenseDraftInput } from '@watchdog-bms/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { InfoTip } from '@/common/components/field/InfoTip';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { CoverLoader, LoadingState } from '@/common/components/state';
import {
  getExpenseCaptureCapability,
  listExpenses, getExpense, initReceiptUpload, completeReceiptUpload,
  confirmExpense, rejectExpense, voidExpense, markExpenseReady, markExpenseReadyAsReviewer, recordExpensePayment, runDuplicateCheck, dismissDuplicate,
  uploadReceiptFile, updateExpenseDraft, listExpenseCategories, listExpenseWhtIncomeCategories,
  updateExpenseReviewFields, uploadExpenseEvidenceFile,
  createAccountantPackage, downloadIndexXlsx, requestExpenseExtraction, overrideNonExpenseClassification,
  createExpenseDraft, deleteExpense, confirmExpenseBuyerMatch,
} from './expenses.api';
import type { WhtIncomeCategoryOption } from './expenses.api';
import {
  EXPENSE_VAT_MODE_LABELS, CAPTURE_SOURCE_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, buildExpenseDraftReviewPayload,
  expenseSubstituteReceiptAction, deriveExpenseClassificationReviewState, hasAiGrandTotalMismatch, hasUnresolvedDuplicateWarning,
  allowsDomesticInputTaxCode, clearExpenseTaxSelections, expenseDocumentReviewFieldsComplete, hasCurrentExpenseDocumentReview,
  TAX_EVIDENCE_REASON_LABELS, AI_SUMMARY_STATUS_LABELS, AI_MISSING_FIELD_LABELS,
  ATTACHMENT_PURPOSE_LABELS, MIME_TYPE_LABELS, SUBSTITUTE_RECEIPT_STATUS_LABELS, expenseValueLabel,
  deriveExpenseAuditChecks, deriveExpenseReviewSteps, initialExpenseReviewStep, expenseNeedsReceiptOrSubstitute, expenseCapabilities,
  calculateManualExpenseTotals, buildManualExpenseLines, canAccessExpenseTab, canDeleteExpense, expenseDeleteErrorMessage,
  expenseDeleteTargetLabel, firstFilled, isExpensePendingReview, expenseReimbursementProgressLabel, summarizeExpenseKpis,
  isBlockedCheckBillClassification, lateDocumentDays, EXPENSE_DATE_STATUS_LABELS, expenseClassificationConfirmBlocker,
  POSTING_STATUS_LABELS, aiGrandTotalValue, expenseAiFieldProvenance, expenseRatePercent, expenseDocumentWhtRate,
  vatRatePreset, vatRatePresetValue, vatTreatmentForPreset, expensePercentToRate, expenseRateToPercent,
  effectiveVatRateLabel, vatModeRequiresRate,
  PAYEE_ENTITY_KIND_LABELS, AI_SUGGESTION_FIELD_LABELS, applyExpenseAiSuggestion, expenseAiSuggestion, expenseAiCategorySuggestion,
  EXPENSE_LINE_CHARGE_KINDS, EXPENSE_LINE_CHARGE_KIND_LABELS,
  insertExpenseReviewLine, removeExpenseReviewLine, applyChargeKindChange, changeExpenseVatSourceType,
  formatTaxId, taxIdDigits, reviewValues, incompleteSourceReviewLine,
  expenseReviewWithholdsTax, expenseVatSourceValidationMessage, expenseVatBlockedWayOut } from './expenses.model';
export { reviewValues } from './expenses.model';
import type { AiReviewField, ExpenseAiSuggestion, ExpenseSummary, ExpenseDetail, ExpenseDraftReviewValues, ExpenseCategorySummary, ExpenseLineChargeKind, ExpenseReviewStepKey, ExpenseCapabilities, ExpensesTab, ManualExpenseItem } from './expenses.model';
import type { BusinessDocumentClassification, BuyerEntityKind, ExpenseCaptureCapabilityDto, ExpenseExtractionResult, ExpenseLineVatTreatment, ExpenseVatSourceOverrideInput, ExpenseWhtInput } from '@watchdog-bms/contracts';
import { useExpenseReviewTotals, type ExpenseReviewTotalsState } from './useExpenseReviewTotals';
import { AI_BUDGET_REFUSAL_CODES, isCalculatedExpenseRounding, expenseVatReconciliationMessage, isBlockingExpenseVatReconciliation, isCheckBillClassification } from '@watchdog-bms/contracts';
import { counterpartyAutoSaveNotice, counterpartyHref } from '../counterparties/counterparties.logic';
import { COUNTERPARTY_READ_PERMISSION, type CounterpartyAutoSaveNotice } from '../counterparties/counterparties.model';
import { CategoryManagePanel, SignaturePanel, EvidencePanel, IconBtn } from './ExpensesWorkspacePanels';
import { useBranchFilter } from '../web-core-workspace/WorkspaceScope';
import { TransactionBranchField, useTransactionCreateBranchId } from '../web-core-workspace/TransactionBranchField';
import { isBranchScope403 } from '../web-core-workspace/branch-scope-label.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale, DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { Modal, useConfirm } from '@/common/components/modal';
import { TextareaField } from '@/common/components/field';
import { buyerMatchBannerState, type RestorableClaimStatus } from './expense-buyer-match.logic';
import { findForbiddenChars, normalizeDecimalInput, REASON_MAX_LENGTH, sanitizeReasonInput, stripDisallowed } from '@/common/forms/sanitize';
import {
  ATTACHMENT_UPLOAD_ACCEPT,
  uploadErrorMessage,
} from '@/common/files/upload-file.logic';
import { TransactionTaxLineSelector } from '@/features/tax/TransactionTaxLineSelector';
import { taxDefinitionRateForSource } from '@/features/tax/transaction-tax.model';
import {
  captureFileRejection, captureMegabytes, entryForFile, runSingleFileUploads,
  type CaptureUploadEntry, type CaptureUploadState,
} from './expense-capture-upload.logic';
import { captureReadJobNotice } from './expense-capture-status.logic';
import { addressMissingListFilter } from './expense-address-missing-view.logic';
import {
  bangkokMonthKey, classifyUploadFile, HeicDecodeError, isReceiptQuotaBlocked,
  availableExpenseSessionStorage,
  prepareReceiptFile, RECEIPT_QUOTA_ERROR_CODE, RECEIPT_UPLOAD_ACCEPT, type ReceiptQuotaLatch,
  expenseExtractionRetryMode,
  expenseExtractionRetryRequestId,
  expenseExtractionResponseIsUnknown,
  requestExpenseExtractionWithRecovery,
  writeExpenseExtractionAttempt,
} from './expense-upload.logic';
import {
  err, baht, baht0, dateShort, inputClass, btnClass, ghostClass, dangerClass, successBtn, successBtnStyle,
  ICON, KPI, StatCard, StatusBadge, TAX_TONE, ErrorBanner, InfoBanner, StateBanner, HowItWorks,
} from './ExpensesUi';
import { generateSourceJournal } from '../ledger/ledger.api';
import { validateExpenseReview, type ExpenseFieldIssue } from './expense-review-validation';
import { isExpenseSourceDraftMissing } from './expense-source-draft.model';
import { useMenuFilterState } from '../web-core-workspace/MenuFilterScope';
import { hasRecordedTax, showsTaxCapture, useExpenseCapturePolicy } from './expense-capture-policy';

import { civilPeriodKey, todayCivilDate, isCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';
import { apiErrorCode } from '@/common/api/api-error-message';

// The upload copy promises "about 10–20 seconds"; past that the honest message is the queue one.
const QUEUE_BUSY_AFTER_MS = 8_000;

// ── period control (day / month) ─────────────────────────────────────────────
type Gran = 'day' | 'month';
function periodRange(gran: Gran, month: string, day: string): { fromDate: string; toDate: string } {
  if (gran === 'day') return { fromDate: day, toDate: day };
  const [y, m] = month.split('-').map((n) => parseInt(n, 10));
  const last = new Date(y!, m!, 0).getDate();
  return { fromDate: `${month}-01`, toDate: `${month}-${String(last).padStart(2, '0')}` };
}

function LateDocumentBadge({ expense, locale }: { expense: ExpenseSummary; locale: SupportedLocale }) {
  // Spec §5.2: "late" is document date vs upload date. When the document date IS the upload date's
  // placeholder the comparison measures nothing — it can only ever say "not late", which is a
  // reassurance about a date nobody read. Say what is actually wrong instead.
  const status = expense.dateStatus ?? 'verified';
  if (status === 'unverified' || status === 'implausible') {
    return <MangmeeBadge tone="amber">{EXPENSE_DATE_STATUS_LABELS[status]}</MangmeeBadge>;
  }
  const days = lateDocumentDays(expense);
  return days === null
    ? null
    : <MangmeeBadge tone="amber">{messageWithParams(t('expenses.late_document_days', locale), { days: String(days) })}</MangmeeBadge>;
}

/** Spec §5.2: a row whose date was READ but only by choosing the DD/MM order says so, quietly. */
function DocumentDateBadge({ expense }: { expense: ExpenseSummary }) {
  return expense.dateStatus === 'assumed'
    ? <MangmeeBadge tone="sky">{EXPENSE_DATE_STATUS_LABELS.assumed}</MangmeeBadge>
    : null;
}

export type ExtractionNotice = { tone: 'info' | 'error'; message: string };

const EXPENSE_NOTICE_PREFIX = 'expenses.extractionNotice.';

export function InlineSpinner() {
  return <span aria-hidden="true" className="h-5 w-5 rounded-full border-2 border-current/25 border-t-current animate-spin" />;
}

function messageWithParams(message: string, params?: Record<string, string>): string {
  return Object.entries(params ?? {}).reduce((text, [key, value]) => text.replace(`{${key}}`, value), message);
}

function fieldIssue(issues: ExpenseFieldIssue[], field: string): ExpenseFieldIssue | undefined {
  return issues.find((issue) => issue.field === field);
}

/** §8: the way forward of a registry notice, dropped entirely when the reader may not open it. */
function RegistryNoticeLink({ companyId, notice }: { companyId: string; notice: CounterpartyAutoSaveNotice }) {
  const locale = useWorkspaceLocale();
  if (!notice.counterpartyId) return null;
  return (
    <>
      {' '}
      <Link href={counterpartyHref(companyId, notice.counterpartyId)} className="font-semibold underline underline-offset-2">
        {t('counterparties.open_registry', locale)}
      </Link>
    </>
  );
}

function validationInputClass(issue?: ExpenseFieldIssue): string {
  return cx(inputClass, issue?.severity === 'error' && 'border-error-500 ring-1 ring-error-500');
}

function FieldIssueNote({ issue }: { issue?: ExpenseFieldIssue }) {
  const locale = useWorkspaceLocale();
  if (!issue) return null;
  return (
    <p className={cx('mt-1 text-xs', issue.severity === 'error' ? 'text-error-500' : 'text-warning-700')}>
      {messageWithParams(t(issue.messageKey, locale), issue.params)}
    </p>
  );
}

function partialDraftMayDeferIssue(issue: ExpenseFieldIssue, values: ExpenseDraftReviewValues): boolean {
  if (issue.field === 'vendorNameSnapshot') return values.vendorNameSnapshot.trim() === '';
  if (issue.field === 'expenseDate') return values.expenseDate.trim() === '';
  if (issue.field === 'vendorEntityKindSnapshot' || issue.field === 'whtCategoryCode' || issue.field === 'lines' || issue.field === 'total') return true;
  const match = /^lines\.(\d+)\.(description|quantity|unitPrice|vatRate)$/.exec(issue.field);
  if (!match) return false;
  const line = values.lines[Number(match[1])];
  if (!line || !incompleteSourceReviewLine(line, values.vatMode)) return false;
  return line[match[2] as 'description' | 'quantity' | 'unitPrice' | 'vatRate'].trim() === '';
}

export function AiFieldLabel({ label, field, summary }: { label: ReactNode; field: AiReviewField; summary: Record<string, unknown> | null }) {
  const locale = useWorkspaceLocale();
  const provenance = expenseAiFieldProvenance(summary, field);
  return (
    <>
      {label}
      {provenance?.recognized && <span className="ml-1 inline-flex rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700" title={t('expenses.ai_field_source', locale)}>AI</span>}
    </>
  );
}

export function AiFieldMissingHint({ field, summary }: { field: AiReviewField; summary: Record<string, unknown> | null }) {
  const locale = useWorkspaceLocale();
  return expenseAiFieldProvenance(summary, field)?.missing
    ? <p className="mt-1 text-xs text-warning-700">{t('expenses.ai_field_missing', locale)}</p>
    : null;
}

export function expenseNoticeKey(expenseId: string): string {
  return `${EXPENSE_NOTICE_PREFIX}${expenseId}`;
}

export const DOCUMENT_KIND_LABELS: Record<SupportedLocale, Record<string, string>> = {
  th: {
    RECEIPT: 'ใบเสร็จ', TAX_INVOICE: 'ใบกำกับภาษี', ABBREVIATED_TAX_INVOICE: 'ใบกำกับภาษีอย่างย่อ', SUPPLIER_INVOICE_OR_BILL: 'ใบแจ้งหนี้/บิลผู้ขาย',
    ORDER_OR_CHECK_BILL: 'ใบสั่งอาหาร/เช็กบิล', QUOTATION: 'ใบเสนอราคา', PURCHASE_ORDER: 'ใบสั่งซื้อ', DELIVERY_NOTE: 'ใบส่งของ',
    APPOINTMENT_CARD: 'ใบนัด', BOOKING_CONFIRMATION: 'ใบยืนยันการจอง', RESERVATION_CONFIRMATION: 'ใบยืนยันการสำรอง',
    SIGNATURE_IMAGE: 'รูปลายเซ็น', OTHER_BUSINESS_DOCUMENT: 'เอกสารธุรกิจอื่น', NON_FINANCIAL_IMAGE: 'รูปภาพที่ไม่ใช่เอกสารการเงิน', NEEDS_REVIEW: 'เอกสารที่ต้องตรวจเพิ่มเติม',
  },
  en: {
    RECEIPT: 'receipt', TAX_INVOICE: 'tax invoice', ABBREVIATED_TAX_INVOICE: 'abbreviated tax invoice', SUPPLIER_INVOICE_OR_BILL: 'supplier invoice/bill',
    ORDER_OR_CHECK_BILL: 'order/check bill', QUOTATION: 'quotation', PURCHASE_ORDER: 'purchase order', DELIVERY_NOTE: 'delivery note',
    APPOINTMENT_CARD: 'appointment card', BOOKING_CONFIRMATION: 'booking confirmation', RESERVATION_CONFIRMATION: 'reservation confirmation',
    SIGNATURE_IMAGE: 'signature image', OTHER_BUSINESS_DOCUMENT: 'other business document', NON_FINANCIAL_IMAGE: 'non-financial image', NEEDS_REVIEW: 'document needing review',
  },
};

export function nonExpenseNotice(classification: Pick<BusinessDocumentClassification, 'contentKind' | 'documentKind'>, locale: SupportedLocale): ExtractionNotice {
  const kind = DOCUMENT_KIND_LABELS[locale][classification.documentKind] ?? (locale === 'th' ? 'เอกสารธุรกิจอื่น' : 'other business document');
  const actionKey: DictionaryKey = classification.contentKind === 'UNREADABLE' || classification.contentKind === 'MULTI_DOCUMENT'
    ? 'expenses.extract_not_expense_reupload'
    : classification.documentKind === 'ORDER_OR_CHECK_BILL'
      ? 'expenses.extract_not_expense_final_bill'
      : ['APPOINTMENT_CARD', 'BOOKING_CONFIRMATION', 'RESERVATION_CONFIRMATION'].includes(classification.documentKind)
        ? 'expenses.extract_not_expense_booking'
        : ['QUOTATION', 'PURCHASE_ORDER', 'DELIVERY_NOTE'].includes(classification.documentKind)
          ? 'expenses.extract_not_expense_commercial'
          : 'expenses.extract_not_expense_generic';
  return { tone: 'info', message: `${t('expenses.extract_not_expense_prefix', locale)} ${kind} — ${t(actionKey, locale)}` };
}

export function extractionNotice(result: ExpenseExtractionResult, locale: SupportedLocale): ExtractionNotice {
  // Appendix §3: the read did not happen inside the request — it is a durable JOB now, and
  // `readJobId` is the fact that says so. The status is only how far that job has got, so keying
  // on it alone answered a replayed DONE job (same file, same bytes) with the success copy of a
  // synchronous read, over a response that carries no fields at all. The file is stored either
  // way, and the review page follows the job from here.
  const jobNotice = captureReadJobNotice(result);
  if (jobNotice) return { tone: jobNotice.tone, message: t(jobNotice.messageKey, locale) };
  if (result.status === 'ok') {
    const fields = result.fields;
    const summary = [
      fields?.vendorName && `${t('expenses.extract_vendor', locale)} ${fields.vendorName}`,
      fields?.documentNumber && `${t('expenses.extract_doc_number', locale)} ${fields.documentNumber}`,
      fields?.expenseDate && `${t('expenses.extract_date', locale)} ${dateShort(fields.expenseDate)}`,
      fields?.grandTotalAmount && `${t('expenses.extract_grand_total', locale)} ${baht(fields.grandTotalAmount)}`,
    ].filter((value): value is string => Boolean(value));
    return { tone: 'info', message: summary.length > 0 ? `${t('expenses.extract_ok_prefix', locale)}: ${summary.join(' · ')} — ${t('expenses.extract_ok_suffix', locale)}` : t('expenses.extract_ok_no_fields', locale) };
  }
  if (result.status === 'not_expense_document') {
    return result.classification
      ? nonExpenseNotice(result.classification, locale)
      : { tone: 'info', message: t('expenses.extract_not_expense_generic', locale) };
  }
  if (result.status === 'unsupported') return { tone: 'info', message: t('expenses.extract_unsupported', locale) };
  if (result.status === 'not_configured') return { tone: 'info', message: t('expenses.extract_not_configured', locale) };
  if (result.status === 'no_attachment') return { tone: 'error', message: t('expenses.extract_no_attachment', locale) };
  if (result.errorCode === 'OCR_FEATURE_DISABLED') return { tone: 'info', message: t('expenses.extract_ocr_disabled', locale) };
  if (result.errorCode === 'OCR_MONTHLY_LIMIT_EXCEEDED') return { tone: 'info', message: t('expenses.extract_ocr_limit', locale) };
  if (result.errorCode === 'OCR_REQUEST_ALREADY_ADMITTED') return { tone: 'info', message: t('expenses.extract_ocr_duplicate', locale) };
  if (result.errorCode === 'OCR_QUOTA_UNAVAILABLE') return { tone: 'error', message: t('expenses.extract_ocr_unavailable', locale) };
  // Spec §9.2 (web): the company's monthly AI MONEY refused the read. Tone `info`, not `error` —
  // nothing broke, the file and the draft are untouched, and the answer is to type it in. Each code
  // keeps its own sentence: `insufficient` must never read as "used up", and `unavailable` must
  // never claim the budget is full. No retry is offered or performed.
  if (result.errorCode === AI_BUDGET_REFUSAL_CODES.exceeded) {
    return { tone: 'info', message: t(result.budgetScope === 'OCR' ? 'expenses.extract_ai_budget_ocr_exceeded' : 'expenses.extract_ai_budget_exceeded', locale) };
  }
  if (result.errorCode === AI_BUDGET_REFUSAL_CODES.insufficient) return { tone: 'info', message: t('expenses.extract_ai_budget_insufficient', locale) };
  if (result.errorCode === AI_BUDGET_REFUSAL_CODES.unavailable) return { tone: 'info', message: t('expenses.extract_ai_budget_unavailable', locale) };
  if (result.errorCode === AI_BUDGET_REFUSAL_CODES.busy) return { tone: 'info', message: t('expenses.extract_ai_budget_busy', locale) };
  return { tone: 'error', message: t('expenses.extract_failed', locale) };
}

/** One label per upload state, so the list never invents a status the machine does not have. */
const CAPTURE_STATE_LABELS: Record<CaptureUploadState, DictionaryKey> = {
  PENDING: 'expenses.capture.file_state_pending',
  UPLOADING: 'expenses.capture.file_state_uploading',
  STORED: 'expenses.capture.file_state_stored',
  FAILED: 'expenses.capture.file_state_failed',
};

// ── Upload Panel (info strip + dropzone + LINE gradient card) ─────────────────
function UploadPanel({ companyId, branchId, canManagePlan, onSuccess, onBatchSuccess, onNoDocument }: { companyId: string; branchId?: string; canManagePlan: boolean; onSuccess: (expenseId: string, notice: ExtractionNotice) => void; onBatchSuccess?: (created: Array<{ expenseId: string; notice: ExtractionNotice }>) => void; onNoDocument?: () => void }) {
  const locale = useWorkspaceLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  // One file is one expense (A01), and so is each of several: picking three receipts runs today's
  // single-file path three times (appendix §25, owner decision 2026-09-19).
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileName, setFileName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  // P10-L §15.1: the shop hit its monthly AI image-read ceiling. Latched with the month it happened
  // in, because the next image this month meets the same wall — but the ceiling resets on the 1st,
  // so a latch from last month must stop blocking without a reload.
  const [quotaLatch, setQuotaLatch] = useState<ReceiptQuotaLatch | null>(null);
  /** The draft the refused read left behind, so the shop can still go and type it in. */
  const [blockedExpenseId, setBlockedExpenseId] = useState<string | null>(null);
  const quotaBlocked = isReceiptQuotaBlocked(quotaLatch, todayCivilDate());
  // P4: past the advertised 10–20s read time, a spinner reads as "the system is down" when in fact
  // the queue is just long. Say which one it is.
  const [queueBusy, setQueueBusy] = useState(false);
  useEffect(() => {
    if (!extracting) { setQueueBusy(false); return; }
    const timer = window.setTimeout(() => setQueueBusy(true), QUEUE_BUSY_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [extracting]);

  // ── several files (appendix §25): one ROW of state each, N ordinary single uploads ──────────
  const [capability, setCapability] = useState<ExpenseCaptureCapabilityDto | null>(null);
  const [captureFiles, setCaptureFiles] = useState<CaptureUploadEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getExpenseCaptureCapability(companyId)
      .then((limits) => { if (!cancelled) setCapability(limits); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [companyId]);

  /**
   * The size and type gate comes from the server's own capability (§4.1) — the client no longer
   * carries a 4 MB PDF ceiling of its own, because a 10 MiB PDF is read automatically now.
   */
  const rejectFile = (file: File): string | null => {
    const rejection = captureFileRejection(file, capability);
    if (rejection === 'unsupported') {
      return capability
        ? messageWithParams(t('expenses.capture.upload_unsupported', locale), { types: 'JPG, PNG, HEIC, PDF' })
        : t('expenses.upload_unsupported_file', locale);
    }
    if (rejection === 'too_large' && capability) {
      return messageWithParams(t('expenses.capture.upload_too_large', locale), {
        size: captureMegabytes(file.size), limit: captureMegabytes(capability.maxBytes),
      });
    }
    return null;
  };

  const selectFiles = async (picked: File[]) => {
    setSelectedFiles([]); setFileName(''); setFileNotice(null); setError(null);
    setCaptureFiles([]);
    if (picked.length === 0) return;
    setPreparing(true);
    try {
      const prepared: File[] = [];
      for (const file of picked) {
        const rejection = rejectFile(file);
        if (rejection) { setError(rejection); return; }
        const ready = await prepareReceiptFile(file);
        prepared.push(ready.file);
        // The resize note belongs to the one-file screen; a list of files shows its own sizes.
        if (picked.length === 1 && ready.resized) {
          setFileNotice(`${t('expenses.upload_resized', locale)} ${(ready.file.size / 1024 / 1024).toFixed(2)} MB`);
        }
      }
      setSelectedFiles(prepared);
      setFileName(prepared.length === 1 ? prepared[0]!.name : `${prepared.length} ไฟล์`);
    } catch (cause) {
      setError(cause instanceof HeicDecodeError ? t('expenses.upload_heic_unsupported', locale) : uploadErrorMessage(cause));
    } finally {
      setPreparing(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void selectFiles([...(event.target.files ?? [])]);
  };

  const handleDrag = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'dragenter' || event.type === 'dragover') setDragActive(true);
    if (event.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    const dropped = [...(event.dataTransfer.files ?? [])];
    if (dropped.length > 0) void selectFiles(dropped);
  };

  /**
   * ONE receipt, through the path it has always taken: init → PUT → complete → extraction request.
   *
   * Resolves once the file is STORED; `notice` is what the read had to say about it. A refused READ
   * is a notice, not a failure — the receipt is saved either way (§17.6). `notice: null` means the
   * monthly read ceiling refused it, which latches the banner and keeps the user on this panel.
   */
  const uploadOneFile = async (file: File): Promise<{ expenseId: string; notice: ExtractionNotice | null }> => {
    const intent = await initReceiptUpload(companyId, { originalFileName: file.name, mimeType: file.type, byteSize: file.size, ...(branchId ? { branchId } : {}), note: note.trim() });
    await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
    await completeReceiptUpload(companyId, intent.expenseId, intent.attachmentId, { byteSize: file.size });
    setExtracting(true);
    try {
      const runAttempt = (requestId: string) => {
        const attempt = { requestId, attachmentId: intent.attachmentId };
        writeExpenseExtractionAttempt(availableExpenseSessionStorage(window), companyId, intent.expenseId, attempt);
        return requestExpenseExtractionWithRecovery({
          attempt,
          request: (stableRequestId) => requestExpenseExtraction(companyId, intent.expenseId, stableRequestId),
          read: () => getExpense(companyId, intent.expenseId),
          wait: () => new Promise((resolve) => setTimeout(resolve, 1500)),
        });
      };
      const ocrRequestId = globalThis.crypto.randomUUID();
      let outcome = await runAttempt(ocrRequestId);
      const retryMode = outcome.pending ? 'none' : expenseExtractionRetryMode(outcome.result);
      if (retryMode === 'new_request') {
        const retryRequestId = expenseExtractionRetryRequestId(
          retryMode,
          ocrRequestId,
          globalThis.crypto.randomUUID(),
        );
        outcome = await runAttempt(retryRequestId);
      }
      if (!outcome.pending) writeExpenseExtractionAttempt(availableExpenseSessionStorage(window), companyId, intent.expenseId, null);
      return { expenseId: intent.expenseId, notice: extractionNotice(outcome.result, locale) };
    } catch (e) {
      // The receipt IS saved; only the AI read was refused. Staying on the upload tab is the
      // point: `onSuccess` routes to the review screen, which would unmount this panel and take
      // the banner and the disabled button with it — the shop would land on an empty draft with
      // no idea why nothing was read, and could walk straight back and upload again.
      if (apiErrorCode(e) === RECEIPT_QUOTA_ERROR_CODE) {
        writeExpenseExtractionAttempt(availableExpenseSessionStorage(window), companyId, intent.expenseId, null);
        setQuotaLatch({ monthKey: bangkokMonthKey(todayCivilDate()), message: err(e, locale) });
        setBlockedExpenseId(intent.expenseId);
        return { expenseId: intent.expenseId, notice: null };
      }
      if (!expenseExtractionResponseIsUnknown(e)) {
        writeExpenseExtractionAttempt(availableExpenseSessionStorage(window), companyId, intent.expenseId, null);
      }
      return {
        expenseId: intent.expenseId,
        notice: { tone: 'error', message: `${t('expenses.upload_extract_failed_prefix', locale)} — ${err(e)} ${t('expenses.upload_extract_failed_suffix', locale)}` },
      };
    } finally { setExtracting(false); }
  };

  /**
   * Several files, one at a time (appendix §25). No group, no second screen: each file is its own
   * draft, and the landing is the one a single receipt has today — the detail page for one file,
   * the list with the newest highlighted for several.
   */
  const handleBatchUpload = async () => {
    setLoading(true); setError(null);
    const entries = captureFiles.length > 0 ? captureFiles : selectedFiles.map(entryForFile);
    setCaptureFiles(entries);
    try {
      const run = await runSingleFileUploads<ExtractionNotice | null>({
        entries: entries.map((entry, index) => ({ entry, file: selectedFiles[index] ?? null })),
        onChange: setCaptureFiles,
        upload: async (file) => {
          try {
            const done = await uploadOneFile(file);
            return { expenseId: done.expenseId, result: done.notice };
          } catch (cause) { setError(err(cause)); throw cause; }
        },
      });
      const created = run.created.filter((row): row is { expenseId: string; result: ExtractionNotice } => Boolean(row.result));
      // Nothing to land on, or the read ceiling latched: the banner and the rows stay on screen.
      if (created.length !== run.created.length || created.length === 0) return;
      onBatchSuccess?.(created.map((row) => ({ expenseId: row.expenseId, notice: row.result })));
    } catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  };

  const handleUpload = async () => {
    if (!branchId) { setError(t('transaction.source_branch_required', locale)); return; }
    const forbidden = findForbiddenChars(note);
    if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
    if (selectedFiles.length > 1 || captureFiles.length > 1) { await handleBatchUpload(); return; }
    const file = selectedFiles[0] ?? null;
    if (!file) { setError(t('expenses.upload_select_file_error', locale)); return; }
    setLoading(true); setError(null);
    try {
      const done = await uploadOneFile(file);
      if (done.notice) onSuccess(done.expenseId, done.notice);
    } catch (e) { setError(err(e)); }
    finally { setLoading(false); }
  };

  /** Rows come from the machine once sending started; before that, from what the user just picked. */
  const captureRows: CaptureUploadEntry[] = captureFiles.length > 0
    ? captureFiles
    : selectedFiles.length > 1
      ? selectedFiles.map(entryForFile)
      : [];
  const flow = [t('expenses.flow_upload', locale), t('expenses.flow_ai_read', locale), t('expenses.flow_confirm', locale)];
  const uploadPhase = preparing
    ? t('expenses.upload_phase_preparing', locale)
    : extracting
      ? t(queueBusy ? 'expenses.upload_phase_queued' : 'expenses.upload_phase_extracting', locale)
      : loading ? t('expenses.upload_phase_uploading', locale) : null;

  return (
    <div className="space-y-4">
      <HowItWorks
        title={t('expenses.upload_what_title', locale)}
        description={t('expenses.upload_what_desc', locale)}
        steps={flow}
      />

      <MangmeeCard className="p-6">
        {quotaBlocked && (
          <div role="alert" className="mb-4 rounded-xl border border-[#FECDCA] bg-error-50 px-4 py-3 text-sm text-error-700">
            <p className="font-medium">⚠ {quotaLatch!.message}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-semibold">
              {/* G18: the package page is where the quota is bought; staff without the permission
                  cannot buy, so they are told who can instead of being sent to a page that bounces. */}
              {canManagePlan
                ? <Link href={`/companies/${companyId}/billing`} className="inline-flex min-h-11 items-center underline">เปลี่ยนแพ็กเกจ</Link>
                : <span className="inline-flex min-h-11 items-center">แจ้งเจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจให้เปลี่ยนแพ็กเกจ</span>}
              {blockedExpenseId && (
                <Link href={`/companies/${companyId}/expenses/${blockedExpenseId}`} className="inline-flex min-h-11 items-center underline">
                  กรอกใบเสร็จที่เพิ่งอัปโหลดเอง
                </Link>
              )}
            </div>
          </div>
        )}
        {error && <div className="mb-4"><ErrorBanner message={error} focus /></div>}
        {/* Phones get the camera, not a dropzone. A phone has no drag, no file manager and no
            click, so the desktop copy below ("ลากไฟล์มาวาง หรือคลิกเพื่อเลือก") is an instruction the
            user cannot follow on the device they are holding — while photographing the receipt
            is the entire job. Desktop keeps its dropzone verbatim. */}
        <div className="flex flex-col gap-3 sm:hidden">
          <label className={cx(btnClass, 'h-12 w-full cursor-pointer text-base')}>
            <span className="inline-flex items-center justify-center gap-2">📷 {t('expenses.upload_capture_cta', locale)}</span>
            {/* `capture` restricts the picker to the camera, so the button below keeps PDF and HEIC reachable. */}
            <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFileChange} />
          </label>
          <label className="flex h-12 w-full cursor-pointer items-center justify-center rounded-lg border border-gray-300 bg-white text-base font-medium text-gray-700">
            {t('expenses.upload_pick_cta', locale)}
            {/* `multiple` only here and on the dropzone: the camera above still takes one photo. */}
            <input type="file" accept={RECEIPT_UPLOAD_ACCEPT} multiple className="sr-only" onChange={handleFileChange} />
          </label>
          <p className="text-sm leading-6 text-gray-500">{t('expenses.upload_capture_hint', locale)}</p>
          {preparing ? <p className="text-sm font-semibold text-brand-700">{t('expenses.upload_preparing', locale)}</p> : fileName && <p className="truncate rounded-lg bg-brand-25 px-3.5 py-2 text-sm font-semibold text-brand-700">✓ {fileName}</p>}
        </div>

        <label
          className={cx(
            'hidden cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-11 text-center transition sm:flex',
            dragActive ? 'border-brand-500 bg-brand-50 shadow-[0_0_0_4px_rgba(52,211,153,0.14)]' : 'border-brand-300 bg-brand-25 hover:bg-brand-50',
          )}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm">📤</span>
          <div className="text-lg font-bold text-gray-800">{t('expenses.upload_dropzone_title', locale)}</div>
          <div className="text-sm text-gray-500">{t('expenses.upload_dropzone_hint', locale)}</div>
          {preparing ? <div className="text-sm font-semibold text-brand-700">{t('expenses.upload_preparing', locale)}</div> : fileName && <div className="mt-1 inline-flex items-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-brand-700">✓ {fileName}</div>}
          <input ref={fileRef} type="file" accept={RECEIPT_UPLOAD_ACCEPT} multiple className="hidden" onChange={handleFileChange} />
        </label>
        {fileNotice && <div className="mt-3"><InfoBanner message={fileNotice} /></div>}
        {captureRows.length > 0 && (
          <div className="mt-4 space-y-2" data-capture-file-list>
            <p className="text-sm font-semibold text-gray-800">{t('expenses.capture.files_title', locale)}</p>
            <p className="text-xs leading-5 text-gray-500">{t('expenses.capture.multi_hint', locale)}</p>
            <ul className="space-y-2">
              {captureRows.map((row, index) => (
                <li key={`${row.name}:${index}`} className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-800">{row.name}</p>
                    <p className="text-xs text-gray-500">
                      {captureMegabytes(row.size)} · {t(CAPTURE_STATE_LABELS[row.state], locale)}
                    </p>
                  </div>
                  {row.state === 'FAILED' && (
                    <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} disabled={loading} aria-busy={Boolean(loading)} onClick={() => void handleBatchUpload()}>
                      {t('expenses.capture.retry_file', locale)}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-semibold text-gray-600" htmlFor="receipt-upload-note">{t('expenses.upload_note', locale)}</label>
          <input id="receipt-upload-note" className={inputClass} placeholder={t('expenses.upload_note_placeholder', locale)} value={note} onChange={(e) => setNote(stripDisallowed(e.target.value))} />
        </div>
        <div className="mt-5 flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px]" style={{ background: '#F4EBFF', color: '#7A5AF8' }}>{ICON.sparkle}</span>
          <p className="text-sm leading-relaxed text-gray-600">{t('expenses.upload_ai_strip_before', locale)}<b className="text-gray-800">{t('expenses.upload_ai_strip_bold', locale)}</b>{t('expenses.upload_ai_strip_after', locale)}</p>
        </div>
        <button className={cx(btnClass, 'mt-5 h-12 w-full text-base')} onClick={handleUpload} disabled={loading || preparing || quotaBlocked} aria-busy={Boolean(loading)} data-loading-indicator>
          <span className="inline-flex items-center justify-center gap-2">
            {(preparing || loading || extracting) && <InlineSpinner />}
            {extracting
              ? t('expenses.ai_reading', locale)
              : preparing
                ? t('expenses.upload_preparing', locale)
                : loading
                  ? t('expenses.uploading', locale)
                  : t(captureRows.length > 0 ? 'expenses.capture.upload_cta' : 'expenses.upload_cta', locale)}
          </span>
        </button>
        {uploadPhase && <p role="status" aria-live="polite" className="mt-2 text-center text-sm font-semibold text-brand-700">{uploadPhase}</p>}
        {onNoDocument && (
          <button type="button" className="mt-3 min-h-11 w-full text-center text-sm font-semibold text-brand-600 sm:min-h-0 hover:underline" onClick={onNoDocument}>
            {t('expenses.upload_no_document_link', locale)}
          </button>
        )}
      </MangmeeCard>
    </div>
  );
}

// ── Document type / tax evidence review + substitute + signature fill ─────────
function CheckBillGuidanceCard({ companyId, expenseId, canReview, canStartSubstitute, onReviewDocument, receiptUploading, onAttachPrimaryReceipt }: {
  companyId: string;
  expenseId: string;
  canReview: boolean;
  canStartSubstitute: boolean;
  onReviewDocument: () => void;
  receiptUploading: boolean;
  onAttachPrimaryReceipt?: (file: File) => Promise<void>;
}) {
  const locale = useWorkspaceLocale();
  const [answer, setAnswer] = useState<'paid' | 'unpaid' | null>(null);
  return (
    <section className="space-y-3 rounded-2xl border-2 border-warning-200 bg-warning-50 p-4" aria-labelledby="check-bill-guidance-title">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-100 text-warning-700" aria-hidden="true">{ICON.alert}</span>
        <div className="min-w-0">
          <h4 id="check-bill-guidance-title" className="text-base font-extrabold text-gray-900">{t('expenses.check_bill_title', locale)}</h4>
          <p className="mt-1 text-sm leading-6 text-gray-700">{t('expenses.check_bill_description', locale)}</p>
        </div>
      </div>

      {answer === null && (
        <div className="space-y-2">
          <p className="text-base font-bold text-gray-900">{t('expenses.check_bill_paid_question', locale)}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className={btnClass} onClick={() => setAnswer('paid')}>{t('expenses.check_bill_paid_action', locale)}</button>
            <button type="button" className={ghostClass} onClick={() => setAnswer('unpaid')}>{t('expenses.check_bill_unpaid_action', locale)}</button>
          </div>
          {onAttachPrimaryReceipt && (
            <label className={cx(ghostClass, 'flex min-h-11 w-full cursor-pointer items-center justify-center text-center')}>
              {receiptUploading ? t('expenses.uploading', locale) : t('expenses.check_bill_upload_final', locale)}
              <input className="hidden" type="file" accept={ATTACHMENT_UPLOAD_ACCEPT} disabled={receiptUploading} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void onAttachPrimaryReceipt(file);
              }} />
            </label>
          )}
        </div>
      )}

      <div aria-live="polite">
        {answer === 'paid' && (
          <div className="space-y-3 rounded-xl bg-white p-3">
          <div>
            <p className="font-bold text-gray-900">{t('expenses.check_bill_paid_title', locale)}</p>
            <p className="mt-1 text-sm leading-6 text-gray-600">{t('expenses.check_bill_paid_description', locale)}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {onAttachPrimaryReceipt && (
              <label className={cx(btnClass, 'flex min-h-11 cursor-pointer items-center justify-center text-center')}>
                {receiptUploading ? t('expenses.uploading', locale) : t('expenses.check_bill_upload_final', locale)}
                <input className="hidden" type="file" accept={ATTACHMENT_UPLOAD_ACCEPT} disabled={receiptUploading} onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void onAttachPrimaryReceipt(file);
                }} />
              </label>
            )}
            {canStartSubstitute && <Link className={ghostClass} href={`/companies/${companyId}/expenses/substitute-receipts/new?expenseId=${encodeURIComponent(expenseId)}&route=check-bill`}>{t('expenses.check_bill_start_new_substitute', locale)}</Link>}
            {canReview && !canStartSubstitute && <button type="button" className={ghostClass} onClick={onReviewDocument}>{t('expenses.doc_review_before_substitute', locale)}</button>}
            <button type="button" className={ghostClass} onClick={() => setAnswer(null)}>{t('expenses.check_bill_back', locale)}</button>
          </div>
          {canReview
            ? <p className="text-xs leading-5 text-warning-700">{t('expenses.check_bill_new_draft_note', locale)}</p>
            : <p className="text-sm font-semibold leading-6 text-warning-700">{t('expenses.check_bill_waiting_finance', locale)}</p>}
          </div>
        )}

        {answer === 'unpaid' && (
          <div className="space-y-3 rounded-xl bg-white p-3">
          <div>
            <p className="font-bold text-gray-900">{t('expenses.check_bill_unpaid_title', locale)}</p>
            <p className="mt-1 text-sm leading-6 text-gray-600">{t('expenses.check_bill_unpaid_description', locale)}</p>
          </div>
          <button type="button" className={ghostClass} onClick={() => setAnswer(null)}>{t('expenses.check_bill_back', locale)}</button>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Vendor-address §8 Slice 2 (AC13): the buyer a full tax invoice printed, against the company
 * registry. Warn-only — both ways forward are a person's choice and nothing here disables any other
 * control on the page. The state is decided in `expense-buyer-match.logic.ts`.
 */
export function BuyerMatchBanner({ companyId, detail, editable, claimed, permissions, onSaved, onOpenLines }: {
  companyId: string;
  detail: ExpenseDetail;
  /** The page's own "review form is editable" rule — the mark button follows it exactly. */
  editable: boolean;
  claimed: boolean;
  permissions: readonly string[];
  onSaved: () => Promise<void>;
  /** Takes the reviewer to the line Tax Codes; without it the guidance is words only. */
  onOpenLines?: () => void;
}) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const banner = buyerMatchBannerState({ companyId, detail, permissions, editable, claimed });
  if (banner.kind === 'none') return null;
  // The write and the readback fail differently: a refused write says why, a failed readback says
  // the change is saved and only the screen is stale.
  const run = async (write: () => Promise<unknown>, doneKey: DictionaryKey): Promise<boolean> => {
    setBusy(true); setError(null);
    try {
      try { await write(); } catch (e) { setError(err(e, locale)); return false; }
      try { await onSaved(); } catch {
        const message = t('expenses.review_saved_refresh_failed', locale);
        setError(message); toast.warning(message);
        return true;
      }
      toast.success(t(doneKey, locale));
      return true;
    } finally { setBusy(false); }
  };
  // Mark and undo are a person's act through the existing review save — the same PATCH that already
  // carries `inputVatClaimStatus` — never an automatic change and never a new mutation. The API stamps
  // the replaced status on the mark, which is what the undo sends back.
  const setClaimStatus = (inputVatClaimStatus: 'NON_CLAIMABLE' | RestorableClaimStatus, doneKey: DictionaryKey) =>
    run(() => updateExpenseReviewFields(companyId, detail.id, { expectedUpdatedAt: detail.updatedAt, inputVatClaimStatus }), doneKey);
  const markNonClaimable = async () => {
    if (!(await confirm({ title: t('expenses.buyer_match_mark_title', locale), message: t('expenses.buyer_match_mark_message', locale),
      confirmLabel: t('expenses.buyer_match_mark_non_claimable', locale), cancelLabel: t('expenses.cancel', locale) }))) return;
    await setClaimStatus('NON_CLAIMABLE', 'expenses.buyer_match_marked_toast');
  };
  const submitReason = async () => {
    if (await run(() => confirmExpenseBuyerMatch(companyId, detail.id, reason.trim()), 'expenses.buyer_match_confirmed_toast')) setReasonOpen(false);
  };
  const restore = banner.restoreClaimStatus;
  const undoButton = restore && (
    <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => void setClaimStatus(restore, 'expenses.buyer_match_unmarked_toast')}>
      {t('expenses.buyer_match_undo', locale)}
    </button>
  );
  if (banner.kind !== 'mismatch') {
    return (
      <div className="space-y-2">
        {banner.kind === 'unchecked' ? (
          <p role="status" className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600">
            {t('expenses.buyer_match_unchecked', locale)}{' '}
            {banner.settingsHref
              ? <Link className="inline-flex min-h-11 items-center font-semibold text-brand-700 underline" href={banner.settingsHref}>{t('expenses.buyer_match_open_settings', locale)}</Link>
              : t('expenses.buyer_match_ask_owner', locale)}
          </p>
        ) : (
          <p className="text-xs text-gray-500">{banner.kind === 'confirmed'
            ? t('expenses.buyer_match_confirmed', locale).replace('{reason}', banner.reason)
            : t('expenses.buyer_match_marked_non_claimable', locale)}</p>
        )}
        {error && <ErrorBanner message={error} />}
        {undoButton}
      </div>
    );
  }

  return (
    <MangmeeCard className="space-y-3 border-warning-100 bg-warning-50 p-4 text-sm">
      {confirmDialog}
      <h3 className="font-semibold text-warning-700">{t('expenses.buyer_match_title', locale)}</h3>
      <p className="text-xs text-warning-700">{t('expenses.buyer_match_hint', locale)}</p>
      {banner.differences.length > 0 && (
        <dl className="space-y-2">
          {banner.differences.map((difference) => (
            <div key={difference.reason} className="rounded-lg bg-white px-3 py-2 text-xs">
              <dt className="font-semibold text-gray-700">{t(difference.labelKey, locale)}</dt>
              <dd className="mt-1 break-words text-gray-600">{t('expenses.buyer_match_printed', locale)}: <span className="font-medium text-gray-900">{difference.printed}</span></dd>
              <dd className="break-words text-gray-600">{t('expenses.buyer_match_registered', locale)}: <span className="font-medium text-gray-900">{difference.registered}</span></dd>
            </div>
          ))}
        </dl>
      )}
      {error && !reasonOpen && <ErrorBanner message={error} />}
      {banner.markHintKey && <p className="text-xs text-warning-700">{t(banner.markHintKey, locale)}</p>}
      {(banner.canConfirm || banner.canMarkNonClaimable || undoButton || (banner.openLines && onOpenLines)) && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {banner.openLines && onOpenLines && (
            // Navigation only — no write, so nothing to wait for and no reason to lock it while busy.
            <button type="button" className={ghostClass} onClick={onOpenLines}>{t('expenses.buyer_match_open_lines', locale)}</button>
          )}
          {banner.canConfirm && (
            <button type="button" className={ghostClass} disabled={busy} onClick={() => { setReason(''); setError(null); setReasonOpen(true); }}>
              {t('expenses.buyer_match_confirm', locale)}
            </button>
          )}
          {banner.canMarkNonClaimable && (
            <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => void markNonClaimable()}>
              {t('expenses.buyer_match_mark_non_claimable', locale)}
            </button>
          )}
          {undoButton}
        </div>
      )}
      <Modal
        open={reasonOpen}
        size="sm"
        title={t('expenses.buyer_match_confirm_title', locale)}
        closeLabel={t('expenses.close', locale)}
        onClose={() => { if (!busy) setReasonOpen(false); }}
        footer={(
          <>
            <button type="button" className={ghostClass} disabled={busy} onClick={() => setReasonOpen(false)}>{t('expenses.cancel', locale)}</button>
            {/* Never disabled for an empty reason: the refusal names what to type (D5), a greyed-out
                button on a phone explains nothing. */}
            <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={() => void submitReason()}>
              {t(busy ? 'expenses.saving' : 'expenses.buyer_match_confirm_submit', locale)}
            </button>
          </>
        )}
      >
        <div className="space-y-3">
          {error && <ErrorBanner message={error} />}
          <TextareaField
            label={t('expenses.buyer_match_confirm_reason', locale)}
            hint={t('expenses.buyer_match_confirm_reason_hint', locale)}
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(sanitizeReasonInput(event.target.value))}
          />
        </div>
      </Modal>
    </MangmeeCard>
  );
}

export function DocumentReviewSection({ companyId, detail, isMutable, canReview, onSaved, onAttachPrimaryReceipt, receiptUploading = false, onDirtyChange, showSubstituteAction = true }: { companyId: string; detail: ExpenseDetail; isMutable: boolean; canReview: boolean; onSaved: () => Promise<void>; onAttachPrimaryReceipt?: (file: File) => Promise<void>; receiptUploading?: boolean; onDirtyChange?: (dirty: boolean) => void; showSubstituteAction?: boolean }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const [docType, setDocType] = useState(detail.sourceDocumentType);
  const [taxStatus, setTaxStatus] = useState(detail.taxEvidenceStatus);
  const [categoryId, setCategoryId] = useState<string>(detail.expenseCategoryId ?? '');
  const [categories, setCategories] = useState<ExpenseCategorySummary[]>([]);
  const [classificationOverrideReason, setClassificationOverrideReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const assertAllowed = (...values: string[]) => {
    const forbidden = findForbiddenChars(values.join(''));
    if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
  };

  useEffect(() => {
    setDocType(detail.sourceDocumentType); setTaxStatus(detail.taxEvidenceStatus); setCategoryId(detail.expenseCategoryId ?? '');
  }, [detail.id, detail.primaryAttachmentId, detail.extractionId, detail.sourceDocumentType, detail.taxEvidenceStatus, detail.expenseCategoryId]);
  useEffect(() => {
    void listExpenseCategories(companyId).then(setCategories).catch(() => setCategories([]));
  }, [companyId]);

  const run = async (fn: () => Promise<unknown>, doneText: string, refresh = true, inline = false) => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const result = await fn();
      if (result === false) return;
      if (refresh) {
        try { await onSaved(); } catch {
          setError('บันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาโหลดหน้าอีกครั้ง');
          return;
        }
      }
      if (inline) setInfo(doneText); else toast.success(doneText);
    } catch (e) { setError(err(e, locale)); } finally { setBusy(false); }
  };
  const defaultAssessment = (source: ExpenseDetail): ExpenseEvidenceAssessment => expenseEvidenceAssessment(source) ?? {
    route: EXPENSE_RECEIPT_SOURCE_TYPES.some(type => type === source.sourceDocumentType) || source.sourceDocumentType === 'NEEDS_REVIEW' ? 'SOURCE_DOCUMENT' : 'ALTERNATIVE_EVIDENCE',
    receiptProblem: EXPENSE_RECEIPT_SOURCE_TYPES.some(type => type === source.sourceDocumentType) || source.sourceDocumentType === 'NEEDS_REVIEW' ? 'NONE' : 'NOT_AVAILABLE',
    attachmentIds: source.attachments.filter(file => isExpenseEvidenceFile(file) && file.id === source.primaryAttachmentId).map(file => file.id), reason: '',
  };
  const [assessment, setAssessment] = useState<ExpenseEvidenceAssessment>(() => defaultAssessment(detail));
  const [showEvidenceOptions, setShowEvidenceOptions] = useState(() => defaultAssessment(detail).receiptProblem !== 'NONE');
  const persistedAssessment = JSON.stringify(defaultAssessment(detail));
  useEffect(() => { setAssessment(JSON.parse(persistedAssessment)); }, [detail.id, persistedAssessment]);
  const dirty = docType !== detail.sourceDocumentType || taxStatus !== detail.taxEvidenceStatus || categoryId !== (detail.expenseCategoryId ?? '')
    || JSON.stringify(assessment) !== persistedAssessment;
  useEffect(() => {
    if (!dirty || !isMutable || !canReview) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, isMutable, canReview]);
  const reviewSaved = hasCurrentExpenseDocumentReview(detail);
  const assessmentError = expenseEvidenceInputError(assessment, { ...detail, sourceDocumentType: docType, taxEvidenceStatus: taxStatus,
    inputVatClaimStatus: assessment.route !== 'SOURCE_DOCUMENT' ? 'NON_CLAIMABLE' : detail.inputVatClaimStatus }, true);
  const reviewComplete = expenseDocumentReviewFieldsComplete({ sourceDocumentType: docType, taxEvidenceStatus: taxStatus }) && !assessmentError;
  const canStartSubstitute = isMutable && canReview && reviewSaved && assessment.route === 'SUBSTITUTE_RECEIPT' && !dirty && !busy && !receiptUploading;
  const documentFieldsRef = useRef<HTMLDivElement>(null);
  const openDocumentReview = () => {
    const fields = documentFieldsRef.current;
    const section = fields?.closest('details');
    if (section) section.open = true;
    fields?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fields?.querySelector<HTMLElement>('[role="combobox"]')?.focus({ preventScroll: true });
  };
  const aiCategorySuggestion = expenseAiCategorySuggestion(detail.aiVerificationSummaryJson);
  // Live dirtiness for the parent's ถัดไป gate — only while the บันทึกการตรวจ button exists
  // (a read-only viewer has nothing to save and must never be blocked). State, not a ref: the
  // parent has to re-render to disable ถัดไป, which a ref cannot make it do (Owner report
  // 2026-08-29 — the button stayed live and the click was refused in silence).
  useEffect(() => {
    onDirtyChange?.(isMutable && canReview && (dirty || busy));
  }, [onDirtyChange, isMutable, canReview, dirty, busy]);
  const classificationReviewState = deriveExpenseClassificationReviewState(detail.aiVerificationSummaryJson, canReview);
  const classificationBlocked = classificationReviewState.blocked;
  const checkBillBlocked = isBlockedCheckBillClassification(detail.aiVerificationSummaryJson);
  const classificationConfirmBlocker = expenseClassificationConfirmBlocker({ sourceDocumentType: docType, reason: classificationOverrideReason });
  const canResolveClassification = classificationReviewState.showFinanceOverride && classificationConfirmBlocker === null;
  const saveDocumentReview = (next?: { docType: ExpenseDetail['sourceDocumentType']; taxStatus: ExpenseDetail['taxEvidenceStatus'] }, acknowledge = true) => {
    const nextDocType = next?.docType ?? docType;
    const nextTaxStatus = next?.taxStatus ?? taxStatus;
    const disallowsTaxCode = expenseDocumentReviewFieldsComplete({ sourceDocumentType: nextDocType, taxEvidenceStatus: nextTaxStatus })
      && (assessment.route !== 'SOURCE_DOCUMENT' || !allowsDomesticInputTaxCode(nextDocType, nextTaxStatus));
    const currentReview = reviewValues(detail);
    const sanitizedReview = disallowsTaxCode && currentReview.lines.some((line) => line.taxCodeDefinitionId || line.externalTaxCode)
      ? buildExpenseDraftReviewPayload({
        ...currentReview,
        lines: clearExpenseTaxSelections(currentReview.lines),
      })
      : {};
    return updateExpenseReviewFields(companyId, detail.id, {
      expectedUpdatedAt: detail.updatedAt,
      ...sanitizedReview,
      sourceDocumentType: nextDocType,
      taxEvidenceStatus: nextTaxStatus,
      ...(acknowledge && { documentReviewAcknowledged: true as const }),
      evidenceAssessment: assessment,
      ...(disallowsTaxCode && { inputVatClaimStatus: 'NON_CLAIMABLE' as const }),
      expenseCategoryId: categoryId || null,
    });
  };
  const overrideClassification = () => {
    assertAllowed(classificationOverrideReason);
    return overrideNonExpenseClassification(companyId, detail.id, {
      expectedUpdatedAt: detail.updatedAt,
      sourceDocumentType: docType,
      acknowledged: true,
      reason: classificationOverrideReason.trim(),
    });
  };
  const evidence = detail.substituteReceiptEvidence;
  const substituteAction = expenseSubstituteReceiptAction(companyId, detail.id, detail.aiVerificationSummaryJson, evidence);
  const paperAwaiting = evidence?.status === 'PREPARED' && evidence.signatureMode === 'PAPER' && !evidence.payerUserId;
  const certifierName = evidence?.paperSubmission?.payer.name || evidence?.payerName;
  const DocumentReviewContainer = checkBillBlocked ? 'details' : 'div';

  return (
    <MangmeeCard className="space-y-3 p-4 text-sm">
      <h3 className="font-semibold text-gray-800">{t('expenses.doc_review_title', locale)}</h3>
      {error && <ErrorBanner message={error} />}
      {info && <InfoBanner message={info} />}
      {checkBillBlocked
        ? <CheckBillGuidanceCard key={detail.id} companyId={companyId} expenseId={detail.id} canReview={canReview} canStartSubstitute={canStartSubstitute} onReviewDocument={openDocumentReview} receiptUploading={receiptUploading} onAttachPrimaryReceipt={onAttachPrimaryReceipt} />
        : classificationBlocked && <InfoBanner message={t(classificationReviewState.showFinanceOverride ? 'expenses.non_expense_override_hint' : 'expenses.non_expense_waiting_finance', locale)} />}
      {classificationReviewState.showFinanceOverride && (
        checkBillBlocked ? (
          <details className="rounded-xl border border-gray-200 bg-white p-3">
            <summary className="cursor-pointer font-semibold text-gray-700">{t('expenses.check_bill_finance_review', locale)}</summary>
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-gray-600">{t('expenses.non_expense_override_reason', locale)}</div>
              <textarea className={inputClass} rows={2} maxLength={500} value={classificationOverrideReason} onChange={(e) => setClassificationOverrideReason(stripDisallowed(e.target.value))} placeholder={t('expenses.non_expense_override_reason_placeholder', locale)} />
              <button className={cx(btnClass, 'mt-2')} disabled={busy || !canResolveClassification} aria-busy={Boolean(busy)} onClick={() => run(overrideClassification, 'ยืนยันการจัดประเภทรายการเรียบร้อยแล้ว')}>{t('expenses.non_expense_override_action', locale)}</button>
              {classificationConfirmBlocker && <p className="mt-1 text-xs font-medium text-warning-700">{t(classificationConfirmBlocker, locale)}</p>}
            </div>
          </details>
        ) : (
          <div>
            <div className="mb-1 text-xs font-medium text-gray-600">{t('expenses.non_expense_override_reason', locale)}</div>
            <textarea className={inputClass} rows={2} maxLength={500} value={classificationOverrideReason} onChange={(e) => setClassificationOverrideReason(stripDisallowed(e.target.value))} placeholder={t('expenses.non_expense_override_reason_placeholder', locale)} />
          </div>
        )
      )}
      <DocumentReviewContainer className={checkBillBlocked ? 'rounded-xl border border-gray-200 bg-white p-3' : undefined}>
        {checkBillBlocked && (
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-gray-700">
            {t('expenses.check_bill_accounting_details', locale)}
          </summary>
        )}
        <div className={checkBillBlocked ? 'mt-3 space-y-3 border-t border-gray-100 pt-3' : 'space-y-3'}>
        <div ref={documentFieldsRef} className="grid scroll-mt-24 grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className="mb-1 flex min-h-6 items-center gap-1.5 text-xs font-medium text-gray-600">
            {t('expenses.doc_type', locale)}
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_doc_type', locale)} />
          </div>
          <ThemedSelect aria-label={t('expenses.doc_type', locale)} className={inputClass} value={docType} onChange={(e) => setDocType(e.target.value as ExpenseDetail['sourceDocumentType'])} disabled={busy || !isMutable || !canReview}>
            {Object.entries(SOURCE_DOCUMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </ThemedSelect>
        </div>
        <div>
          <div className="mb-1 flex min-h-6 items-center gap-1.5 text-xs font-medium text-gray-600">
            {t('expenses.tax_evidence_status', locale)}
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_tax_status', locale)} />
          </div>
          <ThemedSelect aria-label={t('expenses.tax_evidence_status', locale)} className={inputClass} value={taxStatus} onChange={(e) => setTaxStatus(e.target.value as ExpenseDetail['taxEvidenceStatus'])} disabled={busy || !isMutable || !canReview}>
            {Object.entries(TAX_EVIDENCE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </ThemedSelect>
          {detail.taxEvidenceReasonCode && <p className="mt-1 text-xs text-gray-400">{t('expenses.reason_label', locale)}: {expenseValueLabel(TAX_EVIDENCE_REASON_LABELS, detail.taxEvidenceReasonCode)}</p>}
        </div>
        <div>
          <div className="mb-1 flex min-h-6 items-center text-xs font-medium text-gray-600">
            <AiFieldLabel label={t('expenses.category', locale)} field="category" summary={detail.aiVerificationSummaryJson} />
          </div>
          <ThemedSelect aria-label={t('expenses.category', locale)} className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={busy || !isMutable || !canReview}>
            <option value="">{t('expenses.category_unspecified', locale)}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </ThemedSelect>
          {/* Spec S1-R4: an auto-filled category arrives pre-selected in the box above; a suggestion
              the server refused to write is offered here instead, and only a tap applies it. Only
              `categoryId` moves, so nothing else the reviewer typed is touched. */}
          {aiCategorySuggestion && aiCategorySuggestion.expenseCategoryId !== categoryId && isMutable && canReview && (
            <button
              type="button"
              className={cx(ghostClass, 'mt-1.5 w-full justify-start text-left')}
              disabled={busy}
              onClick={() => setCategoryId(aiCategorySuggestion.expenseCategoryId)}
            >
              {t('expenses.category_ai_suggested', locale)}: {aiCategorySuggestion.categoryName} · {t('expenses.category_ai_suggested_apply', locale)}
            </button>
          )}
          <AiFieldMissingHint field="category" summary={detail.aiVerificationSummaryJson} />
        </div>
      </div>
      <div className="space-y-3">
        <button type="button" className={ghostClass} onClick={() => setShowEvidenceOptions(value => !value)}>{showEvidenceOptions ? 'ซ่อนตัวเลือกหลักฐาน' : 'เอกสารมีปัญหา / เลือกหลักฐาน'}</button>
        {showEvidenceOptions && <div className="space-y-3 rounded-xl border border-gray-200 p-3">
          <label className="block">เอกสารนี้มีปัญหาอะไร?
            <ThemedSelect className={inputClass} aria-label="ปัญหาของเอกสาร" disabled={busy || !isMutable || !canReview} value={assessment.receiptProblem} onChange={event => {
              const receiptProblem = event.target.value as ExpenseEvidenceAssessment['receiptProblem'];
              setAssessment(value => ({ ...value, receiptProblem, route: receiptProblem === 'NONE' ? 'SOURCE_DOCUMENT' : 'ALTERNATIVE_EVIDENCE' }));
              if (receiptProblem !== 'NONE') setTaxStatus('SUPPORTING_ONLY');
            }}>
              <option value="NONE">มีเอกสารใช้ประกอบรายการ</option><option value="NOT_AVAILABLE">ไม่มีใบเสร็จ</option>
              <option value="LOST">ใบเสร็จสูญหาย</option><option value="MATERIAL_INCOMPLETE">ข้อมูลสำคัญไม่ครบ</option>
            </ThemedSelect>
          </label>
          {assessment.receiptProblem === 'LOST' && <p className="text-gray-600">ขอสำเนาหรือเอกสารแทนจากผู้ขายได้ ระหว่างรอเก็บรายการนี้เป็นแบบร่างไว้ก่อน</p>}
          {assessment.receiptProblem === 'MATERIAL_INCOMPLETE' && <p className="text-gray-600">ถ้าเพียงรูปไม่ชัด ให้เปลี่ยนไฟล์หรืออ่านเอกสารอีกครั้งก่อน</p>}
          {assessment.receiptProblem !== 'NONE' && <label className="block">ต้องการใช้หลักฐานแบบใด
            <ThemedSelect className={inputClass} aria-label="ทางใช้หลักฐาน" disabled={busy || !isMutable || !canReview} value={assessment.route} onChange={event => setAssessment(value => ({ ...value, route: event.target.value as ExpenseEvidenceAssessment['route'] }))}>
              <option value="ALTERNATIVE_EVIDENCE">ใช้หลักฐานอื่นที่มี</option><option value="SUBSTITUTE_RECEIPT">จัดทำใบรับรองแทนใบเสร็จ</option>
            </ThemedSelect>
          </label>}
          {assessment.attachmentIds.some(id => !detail.attachments.some(file => file.id === id && isExpenseEvidenceFile(file))) && <div className="rounded-xl bg-warning-50 p-3 text-warning-700">
            <p>ไฟล์ที่เคยเลือกบางไฟล์ใช้ไม่ได้แล้ว กรุณาเลือกหลักฐานใหม่</p>
            <button type="button" className={ghostClass} disabled={busy || !isMutable || !canReview} aria-busy={Boolean(busy)} onClick={() => setAssessment(value => ({ ...value, attachmentIds: value.attachmentIds.filter(id => detail.attachments.some(file => file.id === id && isExpenseEvidenceFile(file))) }))}>เอาไฟล์ที่ใช้ไม่ได้ออก</button>
          </div>}
          <fieldset disabled={busy || !isMutable || !canReview} className="space-y-1"><legend>เลือกไฟล์ที่ใช้ประกอบรายการ</legend>
            {detail.attachments.filter(file => isExpenseEvidenceFile(file)).map(file => <label key={file.id} className="flex min-h-11 items-center gap-2 break-all">
              <input type="checkbox" checked={assessment.attachmentIds.includes(file.id)} onChange={event => setAssessment(value => ({ ...value, attachmentIds: event.target.checked ? [...value.attachmentIds, file.id] : value.attachmentIds.filter(id => id !== file.id) }))} />{file.originalFileName}
            </label>)}
            {!detail.attachments.some(file => isExpenseEvidenceFile(file)) && <p className="text-gray-600">{detail.attachments.length ? "เอกสารที่ระบบออกและประวัติหลักฐานดูได้จากรายการเอกสารแนบ" : isMutable ? "ยังไม่มีไฟล์แนบ เก็บร่างแล้วเพิ่มหลักฐานภายหลังได้" : "ไม่มีไฟล์หลักฐานแนบกับรายการนี้"}</p>}
          </fieldset>
          {assessment.receiptProblem !== 'NONE' && <label className="block">เหตุผลที่ใช้หลักฐานนี้
            <textarea aria-label="เหตุผลที่ใช้หลักฐานนี้" className={inputClass} rows={2} maxLength={assessment.route === 'SUBSTITUTE_RECEIPT' ? 500 : 2000} disabled={busy || !isMutable || !canReview} value={assessment.reason} onChange={event => setAssessment(value => ({ ...value, reason: event.target.value }))} />
          </label>}
        </div>}
      </div>
      {isMutable && canReview && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => run(() => saveDocumentReview(undefined, false), 'บันทึกแบบร่างแล้ว กลับมาแก้รายการนี้ต่อได้')}>บันทึกแบบร่าง</button>
          <button className={btnClass} disabled={busy || !reviewComplete || (!dirty && reviewSaved)} aria-busy={Boolean(busy)} onClick={() => run(() => saveDocumentReview(), 'บันทึกการตรวจเอกสารเรียบร้อยแล้ว')}>{t(busy ? 'expenses.saving' : !dirty && reviewSaved ? 'expenses.doc_review_saved' : 'expenses.doc_review_save', locale)}</button>
          {(!reviewComplete || dirty || !reviewSaved || busy) && <p id={`expense-document-review-hint-${detail.id}`} role="status" className="w-full rounded-xl border border-warning-100 bg-warning-50 p-3 text-sm font-medium text-warning-700">{busy ? t('expenses.saving', locale) : assessmentError ?? t(!reviewComplete ? 'expenses.doc_review_choose_required' : 'expenses.doc_review_required_next', locale)}</p>}
          {classificationReviewState.showFinanceOverride && !checkBillBlocked && <button className={btnClass} disabled={busy || !canResolveClassification} aria-busy={Boolean(busy)} onClick={() => run(overrideClassification, 'ยืนยันการจัดประเภทรายการเรียบร้อยแล้ว')}>{t('expenses.non_expense_override_action', locale)}</button>}
          {/* `w-full` puts the reason on its own line of the wrapping row, under the buttons —
              a disabled button on a phone has no tooltip to fall back on. */}
          {classificationReviewState.showFinanceOverride && !checkBillBlocked && classificationConfirmBlocker && (
            <p className="w-full text-xs font-medium text-warning-700">{t(classificationConfirmBlocker, locale)}</p>
          )}
          {showSubstituteAction && canStartSubstitute && !classificationBlocked && (!evidence || evidence.status === 'SUPERSEDED') && (
            <>
              <Link className={ghostClass} href={substituteAction.href} aria-disabled={busy || dirty} onClick={(event) => { if (busy || dirty) event.preventDefault(); }}>
                {t(substituteAction.labelKey, locale)}
              </Link>
              {isCheckBillClassification(detail.aiVerificationSummaryJson) && <p className="text-sm text-gray-600">{t('expenses.check_bill_new_draft_note', locale)}</p>}
            </>
          )}

        </div>
      )}
        </div>
      </DocumentReviewContainer>
      {evidence && (
        <div className="space-y-3 rounded-xl border border-warning-100 bg-warning-50 p-4 text-sm" aria-label="ใบรับรองแทนใบเสร็จของรายการนี้">
          <p className="font-semibold text-gray-800">ใบรับรองแทนใบเสร็จรับเงิน {evidence.documentNumber}</p>
          <p className="font-semibold text-warning-700">{paperAwaiting
            ? evidence.paperSubmission ? 'รอตรวจรับฉบับลงนาม' : 'รออัปโหลดฉบับลงนามบนกระดาษ'
            : expenseValueLabel(SUBSTITUTE_RECEIPT_STATUS_LABELS, evidence.status)}</p>
          <p>{evidence.fundingSource === 'COMPANY' ? 'บริษัทจ่ายเต็มจำนวน' : evidence.fundingSource === 'PERSONAL_ADVANCE' ? 'พนักงานสำรองจ่ายเต็มจำนวน' : 'เอกสารเดิมยังไม่ระบุเงินที่ใช้ชำระ'}</p>
          <p>{t('expenses.substitute_wizard.payer', locale)}: {certifierName || (paperAwaiting ? 'รอกรอกชื่อบนกระดาษ' : '—')}</p>
          {evidence.fundingSource === 'PERSONAL_ADVANCE' && <p className="text-xs text-gray-600">{detail.reimbursementProgress?.requestId ? `สถานะใบเบิก: ${expenseReimbursementProgressLabel(detail.reimbursementProgress)}` : "ใบรับรองนี้ยังไม่ใช่การจ่ายคืนเงินให้พนักงาน"}</p>}
          <Link className={btnClass} href={evidence.status === 'SUPERSEDED'
            ? `/companies/${encodeURIComponent(companyId)}/expenses/substitute-receipts/${encodeURIComponent(evidence.id)}`
            : substituteAction.href} aria-disabled={busy || dirty} onClick={(event) => { if (busy || dirty) event.preventDefault(); }}>
            {t(evidence.status === 'SUPERSEDED' ? 'expenses.substitute_hub.view_history' : substituteAction.labelKey, locale)}
          </Link>
        </div>
      )}
    </MangmeeCard>
  );
}

type EditableReviewLineField = 'description' | 'quantity' | 'unitPrice' | 'discountAmount' | 'vatRate';

export function ExpenseReviewEditSection({ companyId, detail, isMutable, canReview, canConfirm, showSaveDraft = false, onSaved, saveRef, onValidationChange, vatOverrideRef, onTotalsChange, totalsRetry = 0, skipUnchangedSave = false, permissions = [] }: {
  companyId: string;
  detail: ExpenseDetail;
  isMutable: boolean;
  canReview: boolean;
  /** Vendor-address §8: decides only whether the registry notices may carry their "ดู" link. */
  permissions?: readonly string[];
  onTotalsChange?: (state: ExpenseReviewTotalsState | null) => void;
  totalsRetry?: number;
  /** Owner decision 2026-08-28: accepting the document VAT total rides on confirm, not on review, so
   *  a confirmer is never shown a refusal with no control that can clear it. */
  canConfirm: boolean;
  /** Explicit save is available only on the first review step; later steps use navigation saves. */
  showSaveDraft?: boolean;
  /** Back/Next in an existing certificate must preserve signed no-op revisions. */
  skipUnchangedSave?: boolean;
  onSaved: () => Promise<void>;
  /** The ถัดไป/chip navigation and the first-step draft button use the same save. */
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
  onValidationChange?: (errorCount: number, firstErrorMessage: string | null) => void;
  /** Plan 13.11.B: the VAT card collects "ใช้ยอดตามเอกสาร"; the page's confirm button spends it. */
  vatOverrideRef?: MutableRefObject<ExpenseVatSourceOverrideInput | null>;
}) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const [values, setValues] = useState<ExpenseDraftReviewValues>(() => reviewValues(detail));
  const [sourceCategories, setSourceCategories] = useState<ExpenseCategorySummary[]>([]);
  const [sourceCategoryError, setSourceCategoryError] = useState(false);
  // WHT certificate system issuance plan §1.2: ACTIVE income categories for the dropdown below.
  // Mirrors accounts-payable's AccountsPayablePages.tsx — an empty catalog is a valid state (the
  // seeded categories are DRAFT until an accountant activates them), so a fetch failure must not
  // block reviewing or confirming an ordinary expense.
  const [whtCategories, setWhtCategories] = useState<WhtIncomeCategoryOption[]>([]);
  useEffect(() => {
    let active = true;
    void listExpenseWhtIncomeCategories(companyId).then((categories) => { if (active) setWhtCategories(categories); }).catch(() => { if (active) setWhtCategories([]); });
    return () => { active = false; };
  }, [companyId]);
  useEffect(() => {
    if (!detail.sourceDraft) return;
    let active = true;
    void listExpenseCategories(companyId).then((categories) => {
      if (active) { setSourceCategories(categories.filter((category) => category.status === 'ACTIVE')); setSourceCategoryError(false); }
    }).catch(() => { if (active) setSourceCategoryError(true); });
    return () => { active = false; };
  }, [companyId, Boolean(detail.sourceDraft)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // §7 cases a-d: what the LAST save did to the counterparty registry. It lives here and not on
  // `detail` because the API returns it on the write response only — a refetch would lose it.
  const [registryNotice, setRegistryNotice] = useState<CounterpartyAutoSaveNotice | null>(null);
  // Keyed by line index. `custom` is needed because "custom, nothing typed yet" and "unset" are the
  // same stored value (''), so the preset cannot be derived from the rate alone.
  const [vatEditors, setVatEditors] = useState<Record<number, { custom?: boolean }>>({});
  // Same reason as `custom` above: a blank branch code means "สำนักงานใหญ่" AND "สาขา, nothing typed
  // yet", so which of the two the reviewer picked cannot be read back off the value (A6/CON-8).
  const [branchIsBranch, setBranchIsBranch] = useState(() => Boolean(detail.vendorBranchCodeSnapshot));
  const [vatSourceDirty, setVatSourceDirty] = useState(false);
  const [taxFactsDirty, setTaxFactsDirty] = useState(false);
  const addedLineKind = useRef<ExpenseLineChargeKind | null | undefined>(undefined);
  // The stored date, not the edited one: a reviewer mid-edit must not have the tax fields vanish
  // under their cursor. `hasRecordedTax` then keeps them visible for a document that already
  // carries VAT, whatever the workspace mode says (spec §7.5).
  const capture = useExpenseCapturePolicy(companyId, detail.expenseDate ?? undefined);
  const showsTax = showsTaxCapture(capture.mode, hasRecordedTax(detail.lines));
  const aiGrandTotal = aiGrandTotalValue(detail.aiVerifiedFieldsJson);
  const aiSuggestion = useMemo(() => expenseAiSuggestion(detail.aiVerificationSummaryJson), [detail.aiVerificationSummaryJson]);
  const issues = useMemo(() => validateExpenseReview(values, { today: todayCivilDate(), aiGrandTotal, whtAmount: detail.whtAmount, sourceDocumentType: detail.sourceDocumentType }), [values, aiGrandTotal, detail.whtAmount, detail.sourceDocumentType]);
  const vendorNameIssue = fieldIssue(issues, 'vendorNameSnapshot');
  const vendorTaxIdIssue = fieldIssue(issues, 'vendorTaxIdSnapshot');
  const vendorAddressIssue = fieldIssue(issues, 'vendorAddressSnapshot');
  const documentNumberIssue = fieldIssue(issues, 'vendorDocumentNumber');
  const expenseDateIssue = fieldIssue(issues, 'expenseDate');
  const linesIssue = fieldIssue(issues, 'lines');
  const whtValueIssue = fieldIssue(issues, 'whtInput.value') ?? fieldIssue(issues, 'whtRate');
  const whtUnitIssue = fieldIssue(issues, 'whtInput.inputType');
  const payeeEntityKindIssue = fieldIssue(issues, 'vendorEntityKindSnapshot');
  const whtCategoryIssue = fieldIssue(issues, 'whtCategoryCode');

  const documentWhtRate = expenseDocumentWhtRate(values.lines);
  const whtInput: ExpenseWhtInput = values.whtInput ?? { inputType: 'RATE', value: expenseRateToPercent(documentWhtRate ?? '') };
  const withholdsTax = expenseReviewWithholdsTax(values, detail.whtAmount);
  const vatSource = values.vatSource ?? { inputType: 'NONE' as const };
  const vatSourceMode = vatSource.lines?.length ? 'LINES' : vatSource.inputType;
  const vatSourceError = expenseVatSourceValidationMessage(vatSource, values.vatMode);
  const sourceCategoryIncompleteIndexes = detail.sourceDraft
    ? values.lines.flatMap((line, index) => !line.chargeKind && !line.expenseCategoryId ? [index] : [])
    : [];
  const sourceCategoryMessage = sourceCategoryIncompleteIndexes.length
    ? `${t('expenses.source_draft_item_n', locale).replace('{n}', String(sourceCategoryIncompleteIndexes[0]! + 1))} ${t('expenses.category', locale)}: ${t('expenses.source_draft_missing_one', locale)}`
    : null;
  const blockingIssueCount = issues.filter((issue) => issue.severity === 'error').length
    + (vatSourceError ? 1 : 0) + sourceCategoryIncompleteIndexes.length;
  const firstBlockingIssue = issues.find((issue) => issue.severity === 'error');
  const firstBlockingMessage = firstBlockingIssue
    ? messageWithParams(t(firstBlockingIssue.messageKey, locale), firstBlockingIssue.params)
    : vatSourceError ?? sourceCategoryMessage;
  const liveTotals = useExpenseReviewTotals(companyId, detail, values,
    isMutable && (canReview || !detail.sourceDraft), firstBlockingMessage, totalsRetry, onTotalsChange);
  const totalIssues = liveTotals?.status === 'ready' && liveTotals.totals && aiGrandTotal
    && Math.abs(Number(liveTotals.totals.grandTotalAmount) - Number(aiGrandTotal)) > 0.05
    ? [{ field: 'total', severity: 'warn' as const, messageKey: 'expenses.v_total_mismatch' as const,
      params: { computed: Number(liveTotals.totals.grandTotalAmount).toFixed(2), ai: Number(aiGrandTotal).toFixed(2) } }]
    : liveTotals ? [] : issues.filter((issue) => issue.field === 'total');
  const showsVatCard = showsTax || vatModeRequiresRate(values.vatMode) || vatSource.inputType !== 'NONE' || Boolean(vatSource.lines?.length) || withholdsTax;
  const vatSnapshot = liveTotals?.status === 'ready' ? liveTotals.totals?.vatCaptureSnapshotJson : detail.vatCaptureSnapshotJson;
  const snapshotSourceAmount = vatSnapshot?.source.vatAmount ?? (() => {
    const amounts = vatSnapshot?.source.lineSources
      ?.filter((line) => line.inputType === 'AMOUNT' || line.inputType === 'BOTH')
      .map((line) => Number(line.vatAmount));
    return amounts?.length && amounts.every(Number.isFinite)
      ? amounts.reduce((sum, amount) => sum + amount, 0).toFixed(4)
      : null;
  })();
  const vatBaseGroups = [...(vatSnapshot?.calculation.lineResults.reduce((groups, line) => {
    const rate = Number(line.vatRatePercent);
    if (!Number.isFinite(rate) || rate <= 0) return groups;
    groups.set(line.vatRatePercent!, (groups.get(line.vatRatePercent!) ?? 0) + Number(line.acceptedTaxableAmount));
    return groups;
  }, new Map<string, number>()) ?? new Map<string, number>())]
    .sort(([left], [right]) => Number(left) - Number(right));
  const acceptedVatBase = vatBaseGroups.reduce((sum, [, amount]) => sum + amount, 0);
  const collapsesVatBase = vatBaseGroups.length === 1
    && (Math.abs(acceptedVatBase - Number(liveTotals?.totals?.taxableAmount ?? detail.taxableAmount)) < 0.005
      || values.lines.every((line) => isCalculatedExpenseRounding(line) || Number(line.vatRate) > 0));
  const vatStatusLabel = vatSnapshot?.reconciliation.status === 'MATCHED' ? 'ตรงกับระบบ'
    : vatSnapshot?.reconciliation.status === 'REVIEWER_ACCEPTED' ? 'ผู้ตรวจยืนยันยอดตามเอกสาร'
    : vatSnapshot?.reconciliation.status === 'MISMATCH' ? 'ยอดไม่ตรง'
      : vatSnapshot?.reconciliation.status === 'NEEDS_REVIEW' || vatSnapshot?.reconciliation.status === 'SOURCE_ONLY' ? 'รอตรวจ'
        : vatSnapshot?.reconciliation.status === 'CALCULATED_ONLY' ? 'ระบบคำนวณ'
          : 'ไม่ใช้ VAT';
  // Plan 13.11.B: a blocked reconciliation says which line to open and, for a reviewer, offers the
  // one named way through — "ใช้ยอดตามเอกสาร" with a reason and the VAT line taking the difference.
  const vatBlocked = !vatSourceDirty && isBlockingExpenseVatReconciliation(vatSnapshot);
  const vatAttentionLines = (vatSnapshot?.reconciliation.attentionLineNumbers ?? [])
    .map((lineNumber) => ({ lineNumber, description: values.lines[lineNumber - 1]?.description?.trim() ?? '' }));
  const vatCarrierLines = values.lines
    .map((line, index) => ({ lineNumber: index + 1, description: line.description?.trim() ?? '', vatRate: line.vatRate }))
    .filter((line) => Number(line.vatRate) > 0);
  // One helper decides what a blocked receipt offers, so "nothing" cannot come back as an answer.
  const vatWayOut = expenseVatBlockedWayOut({ canConfirm, vatCarrierLineCount: vatCarrierLines.length });
  const [vatOverrideReason, setVatOverrideReason] = useState('');
  const [vatOverrideLineNumber, setVatOverrideLineNumber] = useState<number | null>(null);
  const sourceMissing = (field: string, itemRef?: string) => Boolean(detail.sourceDraft
    && isExpenseSourceDraftMissing(detail.sourceDraft, field, itemRef));
  const sourceMissingNote = (field: string, itemRef?: string) => sourceMissing(field, itemRef)
    ? <p className="mt-1 text-xs text-warning-700">{t('expenses.source_draft_missing_one', locale)}</p>
    : null;

  useEffect(() => {
    setValues(reviewValues(detail)); setVatEditors({}); setVatSourceDirty(false); setTaxFactsDirty(false);
    setVatOverrideReason(''); setVatOverrideLineNumber(null);
  }, [detail.id, detail.updatedAt]);
  useEffect(() => {
    if (!vatOverrideRef) return;
    const reason = vatOverrideReason.trim();
    // Owner decision 2026-08-28: whoever may confirm the expense may also accept the document total.
    // Gating this on canReview left everyone else staring at a refusal with no control to act on.
    vatOverrideRef.current = vatBlocked && canConfirm && reason !== '' && vatOverrideLineNumber !== null
      ? { reason, vatLineNumber: vatOverrideLineNumber, expectedUpdatedAt: detail.updatedAt }
      : null;
  }, [canConfirm, detail.updatedAt, vatBlocked, vatOverrideLineNumber, vatOverrideReason, vatOverrideRef]);
  useEffect(() => { onValidationChange?.(blockingIssueCount, firstBlockingMessage); }, [blockingIssueCount, firstBlockingMessage, onValidationChange]);

  const updateLine = (index: number, field: EditableReviewLineField, value: string, vatTreatment?: ExpenseLineVatTreatment | null) => {
    if (field !== 'description') setVatSourceDirty(true);
    if (field === 'vatRate') setTaxFactsDirty(true);
    setValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index
        ? { ...line, [field]: value, ...(field === 'vatRate' && { vatTreatment: vatTreatment ?? null }) } : line),
    }));
  };

  // The line-array rules live in `expenses.model.ts` so they are tested by being run, not by
  // matching this file's source.
  const insertLine = (chargeKind: ExpenseLineChargeKind | null) => {
    setVatSourceDirty(true);
    setValues((v) => insertExpenseReviewLine(v, chargeKind));
    addedLineKind.current = chargeKind;
  };

  useEffect(() => {
    if (addedLineKind.current === undefined) return;
    const kind = addedLineKind.current;
    addedLineKind.current = undefined;
    // The shared insertion rule adds the last product or charge; wait for that row to render.
    const index = values.lines.reduce((last, line, at) => (line.chargeKind ?? null) === kind ? at : last, -1);
    const heading = document.getElementById(`expense-review-line-${detail.id}-${index}`);
    heading?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    heading?.focus({ preventScroll: true });
  }, [detail.id, values.lines.length]);

  const removeLine = (index: number) => {
    setVatSourceDirty(true);
    setVatEditors({});
    setValues((v) => removeExpenseReviewLine(v, index));
  };

  /** Rendered as two groups but stored as one array, so `index` stays the line number the issues,
   *  the VAT source and the saved payload all agree on. */
  const entries = values.lines.map((line, index) => ({ line, index }));
  const productEntries = entries.filter((entry) => entry.line.chargeKind == null);
  const chargeEntries = entries.filter((entry) => entry.line.chargeKind != null && !isCalculatedExpenseRounding(entry.line));

  const setVatSourceType = (inputType: 'RATE' | 'AMOUNT' | 'BOTH' | 'NONE' | 'LINES') => {
    setVatSourceDirty(true);
    setTaxFactsDirty(true);
    setValues((state) => changeExpenseVatSourceType(state, inputType));
  };

  const setVatLineSourceType = (index: number, inputType: 'RATE' | 'AMOUNT' | 'BOTH' | 'NONE') => {
    setVatSourceDirty(true);
    setTaxFactsDirty(true);
    setValues((state) => changeExpenseVatSourceType(state, inputType, index));
  };

  const setVatLineSourceValue = (index: number, field: 'vatRatePercent' | 'vatAmount', value: string) => {
    setVatSourceDirty(true);
    setTaxFactsDirty(true);
    setValues((state) => ({
      ...state,
      vatSource: {
        inputType: 'NONE',
        lines: state.lines.flatMap((line, lineIndex) => {
          if (isCalculatedExpenseRounding(line)) return [];
          const current = state.vatSource?.lines?.find((line) => line.lineNumber === lineIndex + 1)
            ?? { lineNumber: lineIndex + 1, inputType: 'NONE' as const };
          return [lineIndex === index ? { ...current, [field]: value } : current];
        }),
      },
    }));
  };

  const setDocumentVatPercent = (vatRatePercent: string) => {
    const vatRate = expensePercentToRate(vatRatePercent);
    setVatSourceDirty(true);
    setTaxFactsDirty(true);
    setValues((state) => ({
      ...state,
      vatSource: { ...(state.vatSource ?? { inputType: 'RATE' as const }), vatRatePercent },
      lines: state.lines.map((line) => ({
        ...line,
        // A document rate applies to its taxable portion. Preserve an explicit 0%-VAT line such
        // as a tip; unknown and positive-rate lines follow the reviewed document rate.
        vatRate: line.vatRate.trim() !== '' && Number(line.vatRate) === 0 ? line.vatRate : vatRate,
      })),
    }));
  };

  const setDocumentVatAmount = (vatAmount: string) => {
    setVatSourceDirty(true);
    setTaxFactsDirty(true);
    setValues((state) => ({
      ...state,
      vatSource: { ...(state.vatSource ?? { inputType: 'AMOUNT' as const }), vatAmount },
    }));
  };

  const save = async (explicitDraftSave = false): Promise<boolean> => {
    if (busy || !isMutable) return false;
    if (skipUnchangedSave && JSON.stringify(values) === JSON.stringify(reviewValues(detail))) return true;
    // The registry notice belongs to the save that produced it; a refused save must not leave the
    // previous one on screen as if it described this attempt.
    setError(null); setInfo(null); setRegistryNotice(null);
    const partialSourceSave = explicitDraftSave && Boolean(detail.sourceDraft);
    const partialHasFinancialLines = values.lines.some((line) => line.id
      || !incompleteSourceReviewLine(line, values.vatMode));
    if (partialSourceSave && !partialHasFinancialLines && taxFactsDirty) {
      const message = locale === 'th'
        ? 'บันทึกข้อมูล VAT หรือภาษีหัก ณ ที่จ่ายไม่ได้จนกว่าจะกรอกรายการให้ครบ'
        : 'Complete the line item before saving VAT or withholding tax details';
      setError(message); toast.error(message);
      return false;
    }
    const saveIssues = partialSourceSave
      ? issues.filter((issue) => issue.severity === 'error' && !partialDraftMayDeferIssue(issue, values))
      : issues.filter((issue) => issue.severity === 'error');
    const saveIssueCount = saveIssues.length + (vatSourceError ? 1 : 0)
      + (partialSourceSave ? 0 : sourceCategoryIncompleteIndexes.length);
    if (saveIssueCount > 0) {
      const firstSaveIssue = saveIssues[0];
      const message = firstSaveIssue
        ? messageWithParams(t(firstSaveIssue.messageKey, locale), firstSaveIssue.params)
        : vatSourceError ?? sourceCategoryMessage
          ?? t('expenses.v_blocking_count', locale).replace('{count}', String(saveIssueCount));
      setError(message);
      if (explicitDraftSave) toast.error(message);
      return false;
    }
    const forbidden = findForbiddenChars([
      values.vendorNameSnapshot, values.vendorTaxIdSnapshot, values.vendorAddressSnapshot, values.vendorDocumentNumber,
      ...values.lines.map((line) => line.description),
    ].join(''));
    if (forbidden.length > 0) {
      const message = t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '));
      setError(message);
      if (explicitDraftSave) toast.error(message);
      return false;
    }
    setBusy(true);
    try {
      const update = canReview ? updateExpenseReviewFields : updateExpenseDraft;
      const disallowsTaxCode = !allowsDomesticInputTaxCode(detail.sourceDocumentType, detail.taxEvidenceStatus);
      const savedExpense = await update(companyId, detail.id, {
        expectedUpdatedAt: detail.updatedAt,
        ...buildExpenseDraftReviewPayload(disallowsTaxCode
          ? { ...values, lines: clearExpenseTaxSelections(values.lines) }
          : values, canReview ? {
            sourceDraft: detail.sourceDraft,
            originalLines: detail.lines,
            partial: partialSourceSave,
          } : undefined),
        ...(disallowsTaxCode && { inputVatClaimStatus: 'NON_CLAIMABLE' as const }),
      });
      // §7/§8: set before the readback, so a failed refresh still cannot swallow the news that the
      // registry row was created, filled, or missed. NOOP/SKIPPED clear it back to silence.
      const notice = counterpartyAutoSaveNotice(savedExpense?.vendorCounterpartyAutoSave, {
        canReadCounterparty: permissions.includes(COUNTERPARTY_READ_PERMISSION),
      });
      setRegistryNotice(notice);
      if (notice?.kind === 'toast') {
        toast.success(
          messageWithParams(t(notice.messageKey, locale), notice.params),
          notice.counterpartyId
            ? { href: counterpartyHref(companyId, notice.counterpartyId), label: t('counterparties.view', locale) }
            : undefined,
        );
      }
      try { await onSaved(); } catch {
        // The PATCH succeeded. A failed readback must not claim the draft was lost or replay the write.
        const message = t('expenses.review_saved_refresh_failed', locale);
        setError(message);
        toast.warning(message);
        return false;
      }
      setInfo(t('expenses.review_saved', locale));
      if (explicitDraftSave) toast.success(t(detail.status === 'DRAFT' ? 'expenses.review_draft_saved' : 'expenses.source_draft_saved', locale));
      return true;
    } catch (e) { const message = err(e); setError(message); if (explicitDraftSave) toast.error(message); return false; }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = isMutable ? save : null;
    return () => { saveRef.current = null; };
  });

  return (
    <MangmeeCard className="space-y-4 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-800">{t('expenses.vendor_and_lines', locale)}</h3>
        {!isMutable && <span className="text-xs text-gray-400">{t('expenses.read_only', locale)}</span>}
      </div>
      {showSaveDraft && isMutable && <button type="button" className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void save(true)}>
        {busy ? t('expenses.source_draft_saving', locale)
          : t(detail.status === 'DRAFT' ? 'expenses.review_save_draft' : 'expenses.source_draft_save', locale)}
      </button>}
      {error && <ErrorBanner message={error} />}
      {info && <InfoBanner message={info} />}
      {/* §8: the expense saved, the registry write did not. A warning bar, never an error one —
          nothing here may read as "the expense failed" — and it names the counterparty page as
          the place to try again. */}
      {registryNotice?.kind === 'bar' && (
        <p role="status" className="rounded-xl border border-warning-100 bg-warning-50 p-3 text-xs font-semibold text-warning-700">
          {t(registryNotice.messageKey, locale)}
          <RegistryNoticeLink companyId={companyId} notice={registryNotice} />
        </p>
      )}
      {aiSuggestion && isMutable && (
        <div className="space-y-2 rounded-xl border border-warning-100 bg-warning-50 p-3">
          <p className="text-xs font-semibold text-warning-700">{t('expenses.ai_suggestion_title', locale)}</p>
          <p className="text-xs text-warning-700">{t('expenses.ai_suggestion_hint', locale)}</p>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {(Object.keys(aiSuggestion) as Array<keyof ExpenseAiSuggestion>).map((key) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="text-gray-500">{AI_SUGGESTION_FIELD_LABELS[key]}</dt>
                <dd className="font-medium text-gray-800">{aiSuggestion[key]}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => setValues((v) => applyExpenseAiSuggestion(v, aiSuggestion))}>
            {t('expenses.ai_suggestion_apply', locale)}
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600"><AiFieldLabel label={t('expenses.vendor_name', locale)} field="vendorNameSnapshot" summary={detail.aiVerificationSummaryJson} /></span>
          <input className={validationInputClass(vendorNameIssue)} aria-invalid={vendorNameIssue?.severity === 'error' || undefined} value={values.vendorNameSnapshot} onChange={(e) => setValues((v) => ({ ...v, vendorNameSnapshot: stripDisallowed(e.target.value) }))} disabled={!isMutable || busy} />
          <FieldIssueNote issue={vendorNameIssue} />
          <AiFieldMissingHint field="vendorNameSnapshot" summary={detail.aiVerificationSummaryJson} />
          {!vendorNameIssue && sourceMissingNote('vendorName')}
        </label>
        <div>
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <label htmlFor={`expense-vendor-tax-${detail.id}`}><AiFieldLabel label={t('expenses.vendor_tax_id', locale)} field="vendorTaxIdSnapshot" summary={detail.aiVerificationSummaryJson} /></label>
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_tax_id', locale)} />
          </span>
          {/* No maxLength: a full ID formats to exactly 17 characters, so the attribute blocked every
              insertion into a complete number — typing the missing leading 0 in front did nothing.
              taxIdDigits already caps the stored value at 13 digits, dropping the overflow. */}
          <input id={`expense-vendor-tax-${detail.id}`} className={validationInputClass(vendorTaxIdIssue)} aria-invalid={vendorTaxIdIssue?.severity === 'error' || undefined} inputMode="numeric" placeholder="0-0000-00000-00-0" value={formatTaxId(values.vendorTaxIdSnapshot)} onChange={(e) => setValues((v) => ({ ...v, vendorTaxIdSnapshot: taxIdDigits(e.target.value) }))} disabled={!isMutable || busy} />
          <FieldIssueNote issue={vendorTaxIdIssue} />
          <AiFieldMissingHint field="vendorTaxIdSnapshot" summary={detail.aiVerificationSummaryJson} />
        </div>
        {/* Vendor address spec §11.2: under the tax id, a 3-row textarea, the same AI badge as every
            other read field. No maxLength — §8 says an over-long address is refused with a way
            forward, never silently truncated, and maxLength would eat the tail of a paste in
            silence. The length rule lives in the validator, where the reviewer can see it. */}
        <label className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-gray-600"><AiFieldLabel label={t('expenses.vendor_address', locale)} field="vendorAddressSnapshot" summary={detail.aiVerificationSummaryJson} /></span>
          <textarea aria-label={t('expenses.vendor_address', locale)} className={cx(validationInputClass(vendorAddressIssue), 'resize-y')} rows={3}
            aria-invalid={vendorAddressIssue?.severity === 'error' || undefined} value={values.vendorAddressSnapshot}
            onChange={(e) => setValues((v) => ({ ...v, vendorAddressSnapshot: stripDisallowed(e.target.value) }))} disabled={!isMutable || busy} />
          <FieldIssueNote issue={vendorAddressIssue} />
          {!vendorAddressIssue && <p className="mt-1 text-xs text-gray-500">{t('expenses.vendor_address_hint', locale)}</p>}
          <AiFieldMissingHint field="vendorAddressSnapshot" summary={detail.aiVerificationSummaryJson} />
          {/* §7 case c / A4: ONE quiet line, no button and nothing to choose. The owner rejected the
              compare-and-choose panel in round 1; the registry already kept the newest address (or
              kept its own when locked), and the history lives on the counterparty page. */}
          {registryNotice?.kind === 'hint' && (
            <p className="mt-1 text-xs text-gray-500">
              {t(registryNotice.messageKey, locale)}
              <RegistryNoticeLink companyId={companyId} notice={registryNotice} />
            </p>
          )}
        </label>
        {/* A6: สำนักงานใหญ่/สาขา plus the code the document prints — never a dropdown of registry
            branches, so there is no "no match" state to explain. `branchIsBranch` is local because
            "สาขา picked, code not typed yet" and "สำนักงานใหญ่" are the same stored value (''),
            exactly like the VAT editors' `custom` flag above. */}
        <div className="sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.vendor_branch', locale)}</span>
          <div className="flex flex-wrap items-start gap-2">
            <div className="mangmee-segmented shrink-0" role="group" aria-label={t('expenses.vendor_branch', locale)}>
              {([false, true] as const).map((isBranch) => (
                <button key={String(isBranch)} type="button" aria-pressed={branchIsBranch === isBranch} disabled={!isMutable || busy}
                  className={cx('mangmee-tab', branchIsBranch === isBranch && 'mangmee-tab-active', (!isMutable || busy) && 'cursor-not-allowed opacity-50')}
                  onClick={() => {
                    setBranchIsBranch(isBranch);
                    if (!isBranch) setValues((v) => ({ ...v, vendorBranchCodeSnapshot: '' }));
                  }}>
                  {t(isBranch ? 'expenses.vendor_branch_branch' : 'expenses.vendor_branch_head_office', locale)}
                </button>
              ))}
            </div>
            {branchIsBranch && (
              <label className="min-w-0 flex-1 basis-40">
                <span className="sr-only">{t('expenses.vendor_branch_code', locale)}</span>
                <input className={inputClass} inputMode="numeric" placeholder="00001" aria-label={t('expenses.vendor_branch_code', locale)}
                  value={values.vendorBranchCodeSnapshot}
                  onChange={(e) => setValues((v) => ({ ...v, vendorBranchCodeSnapshot: e.target.value.replace(/\D/g, '').slice(0, 5) }))}
                  disabled={!isMutable || busy} />
              </label>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">{t('expenses.vendor_branch_code_hint', locale)}</p>
        </div>
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600"><AiFieldLabel label={t('expenses.document_number', locale)} field="vendorDocumentNumber" summary={detail.aiVerificationSummaryJson} /></span>
          <input className={validationInputClass(documentNumberIssue)} aria-invalid={documentNumberIssue?.severity === 'error' || undefined} value={values.vendorDocumentNumber} onChange={(e) => setValues((v) => ({ ...v, vendorDocumentNumber: stripDisallowed(e.target.value) }))} disabled={!isMutable || busy} />
          <FieldIssueNote issue={documentNumberIssue} />
          <AiFieldMissingHint field="vendorDocumentNumber" summary={detail.aiVerificationSummaryJson} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600"><AiFieldLabel label={t('expenses.expense_date', locale)} field="expenseDate" summary={detail.aiVerificationSummaryJson} /></span>
          <ThemedDate aria-label={t('expenses.expense_date', locale)} className={validationInputClass(expenseDateIssue)} aria-invalid={expenseDateIssue?.severity === 'error' || undefined} value={values.expenseDate} onChange={(e) => setValues((v) => ({ ...v, expenseDate: e.target.value }))} disabled={!isMutable || busy} />
          <FieldIssueNote issue={expenseDateIssue} />
          <AiFieldMissingHint field="expenseDate" summary={detail.aiVerificationSummaryJson} />
          <p className="mt-1 text-sm text-gray-500">{!isMutable ? "ข้อมูลวันที่ตามเอกสารที่บันทึกไว้" : detail.expenseNumber ? `แก้วันที่ได้ เลขรายจ่าย ${detail.expenseNumber} จะคงเดิม` : 'ตรวจวันที่เอกสารให้ตรงกับหลักฐานก่อนบันทึก วันที่จ่ายบันทึกแยกในขั้นตอนชำระเงิน'}</p>
          {!expenseDateIssue && sourceMissingNote('expenseDate')}
        </label>
        {values.businessPurpose !== undefined && (
          <label className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.source_draft_business_purpose', locale)}</span>
            <textarea aria-label={t('expenses.source_draft_business_purpose', locale)} className={inputClass} rows={2} maxLength={500} value={values.businessPurpose}
              onChange={(event) => setValues((current) => ({ ...current, businessPurpose: stripDisallowed(event.target.value) }))}
              disabled={!isMutable || busy} />
          </label>
        )}
        <div className="sm:col-span-2">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <label htmlFor={`expense-vat-mode-${detail.id}`}>{t('expenses.vat_mode', locale)}</label>
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_mode', locale)} />
            {/* Spec §19g decision 3: the mode never names a rate; the rate comes from the lines. */}
            {vatModeRequiresRate(values.vatMode) && (
              <span className="font-semibold text-gray-500">· {effectiveVatRateLabel(values.lines.filter((line) => !isCalculatedExpenseRounding(line)))}</span>
            )}
          </span>
          <ThemedSelect id={`expense-vat-mode-${detail.id}`} className={inputClass} value={values.vatMode} onChange={(e) => { setVatSourceDirty(true); setValues((v) => ({ ...v, vatMode: e.target.value as ExpenseDraftReviewValues['vatMode'] })); }} disabled={!isMutable || busy}>
            {Object.entries(EXPENSE_VAT_MODE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </ThemedSelect>
        </div>
        {showsVatCard && (
          <div className="space-y-3 rounded-xl border border-brand-100 bg-brand-25 p-3 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-gray-800">ภาษีมูลค่าเพิ่ม (VAT)</p>
                <p className="text-xs text-gray-500">เลือกหน่วยตามที่เอกสารพิมพ์ ระบบจะเก็บค่าต้นฉบับแยกจากค่าที่คำนวณ</p>
              </div>
              {!vatSourceDirty && vatSnapshot && (
                <MangmeeBadge tone={['MATCHED', 'REVIEWER_ACCEPTED'].includes(vatSnapshot.reconciliation.status) ? 'brand' : ['MISMATCH', 'NEEDS_REVIEW', 'SOURCE_ONLY'].includes(vatSnapshot.reconciliation.status) ? 'danger' : 'slate'}>
                  {vatStatusLabel}
                </MangmeeBadge>
              )}
            </div>
            {capture.mode === 'SIMPLE' && (
              <p className="rounded-lg bg-white px-3 py-2 text-xs text-gray-600">VAT นี้เป็นส่วนหนึ่งของต้นทุนและขอคืนไม่ได้ ระบบเก็บเพื่อให้ยอดเอกสารและฐานหัก ณ ที่จ่ายถูกต้อง</p>
            )}
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">เอกสารระบุ VAT เป็นหน่วยใด</span>
              <ThemedSelect
                className={inputClass}
                value={vatSourceMode}
                aria-label="เอกสารระบุ VAT เป็นหน่วยใด"
                onChange={(event) => setVatSourceType(event.target.value as 'RATE' | 'AMOUNT' | 'BOTH' | 'NONE' | 'LINES')}
                disabled={!isMutable || busy}
              >
                <option value="NONE">ไม่ได้ระบุ</option>
                <option value="RATE">เปอร์เซ็นต์ (%)</option>
                <option value="AMOUNT">จำนวนเงิน (บาท)</option>
                <option value="BOTH">ระบุทั้งเปอร์เซ็นต์และจำนวนเงิน</option>
                <option value="LINES">แยกหน่วยตามรายการ</option>
              </ThemedSelect>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(vatSource.inputType === 'RATE' || vatSource.inputType === 'BOTH') && (
                <label>
                  <span className="mb-1 block text-xs font-medium text-gray-600">อัตรา VAT จากเอกสาร (%)</span>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="99.9999"
                      step="0.0001"
                      className={cx(inputClass, 'pr-10')}
                      aria-invalid={Boolean(expenseVatSourceValidationMessage({ inputType: 'RATE', vatRatePercent: vatSource.vatRatePercent }, values.vatMode)) || undefined} value={vatSource.vatRatePercent ?? ''}
                      onChange={(event) => setDocumentVatPercent(event.target.value)}
                      disabled={!isMutable || busy}
                    />
                    <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
                  </div>
                </label>
              )}
              {(vatSource.inputType === 'AMOUNT' || vatSource.inputType === 'BOTH') && (
                <label>
                  <span className="mb-1 block text-xs font-medium text-gray-600">VAT จากเอกสาร (บาท)</span>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className={cx(inputClass, 'pr-14')}
                      aria-invalid={Boolean(expenseVatSourceValidationMessage({ inputType: 'AMOUNT', vatAmount: vatSource.vatAmount }, values.vatMode)) || undefined} value={vatSource.vatAmount ?? ''}
                      onChange={(event) => setDocumentVatAmount(event.target.value)}
                      disabled={!isMutable || busy}
                    />
                    <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">บาท</span>
                  </div>
                </label>
              )}
            </div>
            {vatSourceMode === 'LINES' && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">ใช้เมื่อบิลมีหลายอัตราหรือบางรายการไม่เสีย VAT โดยกรอกตามแต่ละบรรทัดในเอกสาร</p>
                {values.lines.map((line, index) => {
                  if (isCalculatedExpenseRounding(line)) return null;
                  const sourceLine = vatSource.lines?.find((line) => line.lineNumber === index + 1)
                    ?? { lineNumber: index + 1, inputType: 'NONE' as const };
                  return (
                    <div key={index} className="rounded-lg border border-brand-100 bg-white p-2">
                      <p className="mb-2 text-xs font-semibold text-gray-700">รายการ {index + 1}</p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <ThemedSelect
                          className={inputClass}
                          value={sourceLine.inputType}
                          onChange={(event) => setVatLineSourceType(index, event.target.value as 'RATE' | 'AMOUNT' | 'BOTH' | 'NONE')}
                          disabled={!isMutable || busy}
                        >
                          <option value="NONE">ไม่ได้ระบุ</option>
                          <option value="RATE">เปอร์เซ็นต์ (%)</option>
                          <option value="AMOUNT">จำนวนเงิน (บาท)</option>
                          <option value="BOTH">ทั้งสองค่า</option>
                        </ThemedSelect>
                        {(sourceLine.inputType === 'RATE' || sourceLine.inputType === 'BOTH') && (
                          <label className="relative">
                            <span className="sr-only">อัตรา VAT จากเอกสาร รายการ {index + 1}</span>
                            <input type="number" min="0" max="99.9999" step="0.0001" className={cx(inputClass, 'pr-10')} aria-invalid={Boolean(expenseVatSourceValidationMessage({ inputType: 'RATE', vatRatePercent: sourceLine.vatRatePercent }, values.vatMode)) || undefined} value={sourceLine.vatRatePercent ?? ''} onChange={(event) => setVatLineSourceValue(index, 'vatRatePercent', event.target.value)} disabled={!isMutable || busy} />
                            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
                          </label>
                        )}
                        {(sourceLine.inputType === 'AMOUNT' || sourceLine.inputType === 'BOTH') && (
                          <label className="relative">
                            <span className="sr-only">VAT จากเอกสาร รายการ {index + 1}</span>
                            <input type="number" min="0" step="0.01" className={cx(inputClass, 'pr-14')} aria-invalid={Boolean(expenseVatSourceValidationMessage({ inputType: 'AMOUNT', vatAmount: sourceLine.vatAmount }, values.vatMode)) || undefined} value={sourceLine.vatAmount ?? ''} onChange={(event) => setVatLineSourceValue(index, 'vatAmount', event.target.value)} disabled={!isMutable || busy} />
                            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">บาท</span>
                          </label>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {vatSourceError && <p className="text-xs font-medium text-error-600">{vatSourceError}</p>}
            {vatSourceDirty && liveTotals?.status !== 'ready'
              ? <p className="rounded-lg bg-white px-3 py-2 text-xs text-gray-500">{liveTotals?.status === 'error' ? 'กรุณาตรวจข้อมูลเพื่อคำนวณยอดล่าสุด' : 'กำลังคำนวณยอดล่าสุด…'}</p>
              : vatSnapshot && (
                <div className="rounded-lg bg-white px-3 py-2">
                  <MoneyRow label="VAT จากเอกสาร" value={snapshotSourceAmount ?? '0'} muted={snapshotSourceAmount === null} />
                  <MoneyRow label="VAT ที่ระบบคำนวณ" value={vatSnapshot.calculation.vatAmount} />
                  <MoneyRow label="VAT ที่ใช้บันทึก" value={liveTotals?.totals?.vatAmount ?? detail.vatAmount} />
                  {vatSnapshot.reconciliation.differenceAmount !== null && <MoneyRow label="ส่วนต่าง" value={vatSnapshot.reconciliation.differenceAmount} />}
                  <MoneyRow
                    label={collapsesVatBase ? 'ฐาน VAT (ยอดก่อน VAT ที่ใช้)' : 'ยอดก่อน VAT ที่ใช้'}
                    value={liveTotals?.totals?.taxableAmount ?? detail.taxableAmount}
                  />
                  {!collapsesVatBase && vatBaseGroups.map(([rate, amount]) => (
                    <MoneyRow key={rate} label={`ฐาน VAT ${Number(rate)}% (ใช้จริง)`} value={amount.toFixed(4)} />
                  ))}
                  <MoneyRow label="ยอดรวม (รวม VAT)" value={liveTotals?.totals?.grandTotalAmount ?? detail.grandTotalAmount} />
                  <p className="mt-1 text-xs text-gray-500">ยอดที่ใช้: {vatSnapshot.reconciliation.acceptedSource === 'SOURCE_AMOUNT' ? 'ตามเอกสาร' : 'ระบบคำนวณ'}</p>
                </div>
              )}
            {vatBlocked && vatSnapshot && (
              <div className="space-y-2 rounded-lg border border-error-100 bg-white px-3 py-2">
                <p className="text-xs font-medium text-error-600">{expenseVatReconciliationMessage(vatSnapshot)}</p>
                {vatAttentionLines.length > 0 && (
                  <ul className="list-inside list-disc text-xs text-gray-600">
                    {vatAttentionLines.map((line) => (
                      <li key={line.lineNumber}>รายการที่ {line.lineNumber}{line.description ? ` · ${line.description}` : ''}</li>
                    ))}
                  </ul>
                )}
                {/* Owner requirement 2026-08-28: a blocked receipt must never end in a blank panel. The
                    override needs a VAT-bearing line to carry the difference — correct accounting, since
                    the difference must not land on ผัก/ผลไม้/ค่าขนส่ง — but when no line bears VAT the whole
                    block used to render nothing at all: a refusal, and no control and no explanation
                    anywhere on the screen. Both ways out are now named. */}
                {vatWayOut === 'SET_VAT_RATE_FIRST' && (
                  <div className="space-y-1 border-t border-gray-100 pt-2">
                    <p className="text-xs font-semibold text-gray-700">ยังเลือก “ใช้ยอดตามเอกสาร” ไม่ได้ เพราะไม่มีรายการไหนมี VAT</p>
                    <p className="text-xs text-gray-600">
                      ส่วนต่าง VAT ต้องลงที่รายการที่เสียภาษี จะลงที่รายการยกเว้น เช่น ผัก ผลไม้ เนื้อสัตว์ ค่าขนส่ง แสตมป์ ไม่ได้
                      ถ้าใบเสร็จเก็บ VAT จริง ให้ใส่อัตรา VAT ที่รายการที่เสียภาษีก่อน (รายการยกเว้นคงไว้ที่ 0) แล้วช่องเลือกจะขึ้นมาเอง
                    </p>
                  </div>
                )}
                {vatWayOut === 'NEEDS_CONFIRMER' && (
                  <div className="space-y-1 border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-600">
                      แก้ไขและบันทึกร่างได้ตามปกติ แต่การยืนยันด้วยยอดตามเอกสารต้องใช้สิทธิ์ยืนยันเอกสาร ให้ส่งต่อผู้ที่มีสิทธิ์นั้นตรวจ
                    </p>
                  </div>
                )}
                {vatWayOut === 'OVERRIDE_FORM' && (
                  <div className="space-y-2 border-t border-gray-100 pt-2">
                    <p className="text-xs font-semibold text-gray-700">ถ้าตรวจแล้วเอกสารถูกต้อง ให้เลือก “ใช้ยอดตามเอกสาร”</p>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-600">รายการที่รับส่วนต่าง VAT</span>
                      <ThemedSelect
                        className={inputClass}
                        value={vatOverrideLineNumber === null ? '' : String(vatOverrideLineNumber)}
                        onChange={(event) => setVatOverrideLineNumber(event.target.value === '' ? null : Number(event.target.value))}
                        disabled={busy}
                      >
                        <option value="">ยังไม่เลือก</option>
                        {vatCarrierLines.map((line) => (
                          <option key={line.lineNumber} value={line.lineNumber}>
                            รายการที่ {line.lineNumber}{line.description ? ` · ${line.description}` : ''}
                          </option>
                        ))}
                      </ThemedSelect>
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-600">เหตุผล (จำเป็น)</span>
                      <textarea
                        className={inputClass}
                        rows={2}
                        maxLength={500}
                        value={vatOverrideReason}
                        onChange={(event) => setVatOverrideReason(event.target.value)}
                        disabled={busy}
                        placeholder="เช่น ใบเสร็จพิมพ์ VAT รวมทั้งใบ ตรวจกับร้านแล้ว"
                      />
                    </label>
                    <p className="text-xs text-gray-500">
                      {vatOverrideReason.trim() !== '' && vatOverrideLineNumber !== null
                        ? 'กด “ยืนยันและลงบัญชี” เพื่อบันทึกโดยใช้ยอดตามเอกสาร ระบบจะเก็บชื่อผู้ตัดสินใจและเหตุผลไว้ในประวัติการตรวจสอบ'
                        : 'เลือกรายการที่รับส่วนต่างและกรอกเหตุผลก่อน จึงจะยืนยันด้วยยอดตามเอกสารได้'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {/* RA-18: the payee's taxpayer class decides ภ.ง.ด.3 vs ภ.ง.ด.53, so it is only asked for when
            this document actually withholds tax, and confirmation blocks until it is picked — never
            guessed. The blank choice disappears once a class is stored because the update contract has
            no clear-to-null idiom for the vendor snapshot fields, so re-picking it would be a no-op. */}
        {withholdsTax && (
          <div className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-600">
              <label htmlFor={`expense-payee-entity-kind-${detail.id}`}>{t('expenses.payee_entity_kind', locale)}</label>
            </span>
            <ThemedSelect id={`expense-payee-entity-kind-${detail.id}`} aria-label={t('expenses.payee_entity_kind', locale)} className={validationInputClass(payeeEntityKindIssue)} aria-invalid={payeeEntityKindIssue?.severity === 'error' || undefined} value={values.vendorEntityKindSnapshot ?? ''} onChange={(e) => setValues((v) => ({ ...v, vendorEntityKindSnapshot: e.target.value as BuyerEntityKind | '' }))} disabled={!isMutable || busy}>
              {!detail.vendorEntityKindSnapshot && <option value="">{t('expenses.category_unspecified', locale)}</option>}
              {Object.entries(PAYEE_ENTITY_KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </ThemedSelect>
            <FieldIssueNote issue={payeeEntityKindIssue} />
          </div>
        )}
        {/* WHT certificate system issuance plan §1.2 (S2/S3): the income category a 50 ทวิ
            certificate needs to print, same "only asked for when withholding tax" gate as the payee
            taxpayer class above. Picking a category fills whtRate from its defaultRate — mirroring
            the AP settlement form's suggestion behaviour — but the rate is not independently
            editable here, unlike AP: this is a classification field, not a new payment entry. */}
        {withholdsTax && (
          <div className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-600">
              <label htmlFor={`expense-wht-category-${detail.id}`}>{t('expenses.wht_income_category', locale)}</label>
            </span>
            <ThemedSelect id={`expense-wht-category-${detail.id}`} aria-label={t('expenses.wht_income_category', locale)} className={validationInputClass(whtCategoryIssue)} aria-invalid={whtCategoryIssue?.severity === 'error' || undefined} value={values.whtCategoryCode ?? ''} onChange={(e) => {
              const code = e.target.value;
              const picked = whtCategories.find((item) => item.code === code);
              setValues((v) => ({ ...v, whtCategoryCode: code, whtRate: picked ? String(Number(picked.defaultRate)) : '' }));
            }} disabled={!isMutable || busy}>
              {!detail.whtCategoryCode && <option value="">{t('expenses.category_unspecified', locale)}</option>}
              {whtCategories.map((item) => <option key={item.code} value={item.code}>{item.nameTh}</option>)}
            </ThemedSelect>
            <FieldIssueNote issue={whtCategoryIssue} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <h4 className="font-semibold text-gray-800">{t('expenses.line_items', locale)}</h4>
        {isMutable && (
          <button type="button" className={ghostClass} disabled={busy} onClick={() => insertLine(null)}>{t('expenses.add_line', locale)}</button>
        )}
      </div>

      {values.lines.length === 0 && (
        <div>
          <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">{t('expenses.no_line_items', locale)}</p>
          <FieldIssueNote issue={linesIssue} />
        </div>
      )}
      {productEntries.map(({ line, index }) => {
        const taxAmounts = calculateManualExpenseTotals({ ...line, vatMode: values.vatMode });
        const descriptionIssue = fieldIssue(issues, `lines.${index}.description`);
        const quantityIssue = fieldIssue(issues, `lines.${index}.quantity`);
        const unitPriceIssue = fieldIssue(issues, `lines.${index}.unitPrice`);
        const discountIssue = fieldIssue(issues, `lines.${index}.discountAmount`);
        const vatRateIssue = fieldIssue(issues, `lines.${index}.vatRate`);
        const vatPercent = expenseRatePercent(line.vatRate);
        // "custom, nothing typed yet" stores the same '' as "unset", so the flag has to be sticky.
        const showCustomRate = vatRatePreset(line.vatRate, line.vatTreatment) === 'custom' || vatEditors[index]?.custom === true;
        const linePreset = showCustomRate ? 'custom' : vatRatePreset(line.vatRate, line.vatTreatment);
        return (
        <div key={index} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span id={`expense-review-line-${detail.id}-${index}`} tabIndex={-1} className="text-xs font-semibold text-gray-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{t('expenses.line_number', locale)} {index + 1}</span>
            {isMutable && <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-error-500 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => removeLine(index)} title={t('expenses.delete', locale)} aria-label={`${t('expenses.delete_line_aria', locale)} ${index + 1}`}>{ICON.trash}</button>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* A textarea, not an input: on a phone the single line clipped the description at the
                field edge (a seeded 33-character line needed 278px of a 264px box at 390 wide, and
                194px at 320), so the value being checked against the receipt could not be read in
                one look. Two rows and wrapping at every width — a one-line box would clip the same
                way on a narrow desktop window, and splitting the control by breakpoint would mean
                two DOM fields for one value. */}
            <label className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_description', locale)}</span>
              <textarea aria-label={t('expenses.line_description', locale)} className={cx(validationInputClass(descriptionIssue), 'resize-y')} rows={2} aria-invalid={descriptionIssue?.severity === 'error' || undefined} value={line.description} onChange={(e) => updateLine(index, 'description', stripDisallowed(e.target.value))} disabled={!isMutable || busy} />
              <FieldIssueNote issue={descriptionIssue} />
              {!descriptionIssue && (sourceMissingNote('description', line.sourceItemRef) ?? sourceMissingNote('review', line.sourceItemRef))}
            </label>
            {detail.sourceDraft && !line.chargeKind && (
              <label className="sm:col-span-2">
                <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.category', locale)}</span>
                <ThemedSelect className={inputClass} value={line.expenseCategoryId ?? ''} disabled={!isMutable || busy || !canReview}
                  aria-invalid={sourceCategoryIncompleteIndexes.includes(index) || undefined}
                  aria-label={`${t('expenses.source_draft_item_n', locale).replace('{n}', String(index + 1))} ${t('expenses.category', locale)}`}
                  onChange={(event) => setValues((current) => ({ ...current, lines: current.lines.map((entry, entryIndex) => entryIndex === index
                    ? { ...entry, expenseCategoryId: event.target.value || null } : entry) }))}>
                  <option value="" disabled={Boolean(line.expenseCategoryId)}>{t('expenses.category_unspecified', locale)}</option>
                  {line.expenseCategoryId && !sourceCategories.some((category) => category.id === line.expenseCategoryId)
                    && <option value={line.expenseCategoryId}>{t('expenses.source_draft_saved_category', locale)}</option>}
                  {sourceCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </ThemedSelect>
                {(sourceMissing('expenseCategoryId', line.sourceItemRef) || !line.expenseCategoryId)
                  && <p className="mt-1 text-xs text-warning-700">{t('expenses.source_draft_missing_one', locale)}</p>}
                {sourceCategoryError && <p role="alert" className="mt-1 text-xs text-warning-700">{t('expenses.source_draft_category_error', locale)}</p>}
              </label>
            )}
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_quantity', locale)}</span>
              <input type="number" min="0" step="0.0001" className={validationInputClass(quantityIssue)} aria-invalid={quantityIssue?.severity === 'error' || undefined} value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} disabled={!isMutable || busy} />
              <FieldIssueNote issue={quantityIssue} />
              {!quantityIssue && sourceMissingNote('quantity', line.sourceItemRef)}
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_unit_price', locale)}</span>
              <input type="number" min="0" step="0.0001" className={validationInputClass(unitPriceIssue)} aria-invalid={unitPriceIssue?.severity === 'error' || undefined} value={line.unitPrice} onChange={(e) => updateLine(index, 'unitPrice', normalizeDecimalInput(e.target.value))} disabled={!isMutable || busy} />
              <FieldIssueNote issue={unitPriceIssue} />
              {!unitPriceIssue && sourceMissingNote('unitPrice', line.sourceItemRef)}
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_discount', locale)}</span>
              <input type="number" min="0" step="0.0001" className={validationInputClass(discountIssue)} aria-invalid={discountIssue?.severity === 'error' || undefined} value={line.discountAmount} onChange={(e) => updateLine(index, 'discountAmount', normalizeDecimalInput(e.target.value))} disabled={!isMutable || busy} />
              <FieldIssueNote issue={discountIssue} />
            </label>
            {/* Spec §19g decision 4: a rate, a preset, or the VAT amount the document prints — all
                three write the same stored decimal fraction. The bare 0–1 box asked reviewers to
                convert "11.78 VAT TTL" into 0.07 in their heads.
                The block takes the full row: as a half-width cell its printed-VAT sub-fields wrapped
                their labels onto two lines and left a column-tall hole beside ส่วนลด. */}
            {showsVatCard && <div className="sm:col-span-2">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
                <label htmlFor={`expense-vat-rate-${detail.id}-${index}`}>{t('expenses.line_vat_rate', locale)}</label>
                <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_rate', locale)} />
              </span>
              <ThemedSelect
                id={`expense-vat-rate-${detail.id}-${index}`}
                className={validationInputClass(vatRateIssue)}
                aria-invalid={vatRateIssue?.severity === 'error' || undefined}
                value={linePreset}
                onChange={(e) => {
                  const preset = e.target.value;
                  setVatEditors((current) => ({ ...current, [index]: { custom: preset === 'custom' } }));
                  updateLine(index, 'vatRate', vatRatePresetValue(preset, line.vatRate), vatTreatmentForPreset(preset));
                }}
                disabled={!isMutable || busy}
              >
                <option value="standard">{t('expenses.vat_rate_preset_standard', locale)}</option>
                <option value="exempt">{t('expenses.vat_rate_preset_exempt', locale)}</option>
                <option value="zero">{t('expenses.vat_rate_preset_zero', locale)}</option>
                <option value="nonVat">{t('expenses.vat_rate_preset_non_vat', locale)}</option>
                {linePreset === 'unknownZero' && <option value="unknownZero">{t('expenses.vat_rate_preset_unknown_zero', locale)}</option>}
                <option value="custom">{t('expenses.vat_rate_preset_custom', locale)}</option>
                {!showCustomRate && line.vatRate.trim() === '' && <option value="unset">{t('expenses.vat_rate_preset_unset', locale)}</option>}
              </ThemedSelect>
              <FieldIssueNote issue={vatRateIssue} />
              {showCustomRate && (
                <label className="mt-2 block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_vat_percent', locale)}</span>
                  <input type="number" min="0" max="99.9999" step="0.0001" className={inputClass}
                    value={expenseRateToPercent(line.vatRate)}
                    onChange={(e) => updateLine(index, 'vatRate', expensePercentToRate(e.target.value))}
                    disabled={!isMutable || busy} />
                </label>
              )}
              {vatPercent !== null && <p className="mt-1 text-xs text-gray-500">{t('expenses.rate_percent_echo', locale).replace('{percent}', vatPercent)}</p>}
            </div>}
          </div>
          {!showsTax ? null
            : allowsDomesticInputTaxCode(detail.sourceDocumentType, detail.taxEvidenceStatus) ? <div className="mt-3">
            <TransactionTaxLineSelector
              companyId={companyId}
              branchId={detail.branchId ?? undefined}
              sourceType="expense.record"
              sourceId={detail.id}
              sourceLineId={detail.lines[index]?.id ?? `line-${index + 1}`}
              transactionContext="DOMESTIC_PURCHASE"
              direction="INPUT"
              documentDate={values.expenseDate}
              netAmount={String(taxAmounts.subtotal)}
              grossAmount={String(taxAmounts.grandTotal)}
              enteredTaxAmount={String(taxAmounts.vat)}
              value={line.taxCodeDefinitionId ?? ''}
              disabled={!isMutable || busy}
              labelAddon={<InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_tax_code', locale)} />}
              canConfigureTax={capture.canConfigureTax}
              suggestedTaxCode={detail.categoryDefaultInputTaxCode ?? null}
              onChange={(id, definition) => { setTaxFactsDirty(true); setValues((current) => ({ ...current, lines: current.lines.map((item, lineIndex) => lineIndex === index ? { ...item, taxCodeDefinitionId: id || null, externalTaxCode: definition?.externalCode ?? null, vatRate: definition ? taxDefinitionRateForSource(definition.rate, 'expense') : '', vatTreatment: definition && Number(definition.rate) === 0 ? item.vatTreatment : null } : item) })); }}
            />
          </div> : <p className="mt-3 text-xs text-gray-500">รหัสภาษีซื้อในประเทศเลือกได้เมื่อเอกสารถูกจัดประเภทเป็นใบกำกับภาษีเท่านั้น</p>}
        </div>
        );
      })}

      {/* Spec §5.1: the additional charges are their own group below the goods, because a service
          charge is not a thing that was bought. One printed amount each, so the card asks for the
          kind and the amount and nothing else; quantity stays 1 and the VAT treatment follows the
          document through the same preset the goods rows use. Single column: at 390px a two-up
          select and money field left neither readable. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <h4 className="font-semibold text-gray-800">{t(chargeEntries.some(({ line }) => line.chargeKind === 'ROUNDING') ? 'expenses.charges_and_adjustments_section' : 'expenses.charges_section', locale)}</h4>
        {isMutable && (
          <button type="button" className={ghostClass} disabled={busy} onClick={() => insertLine('SERVICE_CHARGE')}>{t('expenses.add_charge', locale)}</button>
        )}
      </div>

      {chargeEntries.length === 0 && (
        <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">{t('expenses.no_charges', locale)}</p>
      )}
      {chargeEntries.map(({ line, index }, chargeIndex) => {
        const chargeKind = line.chargeKind!;
        const amountIssue = fieldIssue(issues, `lines.${index}.unitPrice`);
        const quantityIssue = fieldIssue(issues, `lines.${index}.quantity`);
        const orderIssue = fieldIssue(issues, `lines.${index}.chargeKind`);
        const vatRateIssue = fieldIssue(issues, `lines.${index}.vatRate`);
        const showCustomRate = vatRatePreset(line.vatRate, line.vatTreatment) === 'custom' || vatEditors[index]?.custom === true;
        const linePreset = showCustomRate ? 'custom' : vatRatePreset(line.vatRate, line.vatTreatment);
        return (
        <div key={`charge-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span id={`expense-review-line-${detail.id}-${index}`} tabIndex={-1} className="text-xs font-semibold text-gray-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{t('expenses.line_number', locale)} {productEntries.length + chargeIndex + 1}</span>
            {isMutable && <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-error-500 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => removeLine(index)} title={t('expenses.delete', locale)} aria-label={`${t('expenses.delete_charge_aria', locale)} ${index + 1}`}>{ICON.trash}</button>}
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`expense-charge-kind-${detail.id}-${index}`}>{t(chargeKind === 'ROUNDING' ? 'expenses.adjustment_kind' : 'expenses.charge_kind', locale)}</label>
              <ThemedSelect
                id={`expense-charge-kind-${detail.id}-${index}`}
                className={validationInputClass(orderIssue)}
                value={chargeKind}
                onChange={(e) => {
                  const next = e.target.value as ExpenseLineChargeKind;
                  setVatSourceDirty(true);
                  // The reviewer's own wording wins; only the untouched default follows the kind.
                  setValues((current) => ({
                    ...current,
                    lines: current.lines.map((item, lineIndex) => lineIndex === index ? applyChargeKindChange(item, next) : item),
                  }));
                }}
                disabled={!isMutable || busy}
              >
                {EXPENSE_LINE_CHARGE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{EXPENSE_LINE_CHARGE_KIND_LABELS[kind]}</option>
                ))}
              </ThemedSelect>
              <FieldIssueNote issue={orderIssue} />
            </div>
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_description', locale)}</span>
              <input type="text" className={inputClass} value={line.description} onChange={(e) => updateLine(index, 'description', stripDisallowed(e.target.value))} disabled={!isMutable || busy} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t(chargeKind === 'ROUNDING' ? 'expenses.adjustment_amount' : 'expenses.charge_amount', locale)}</span>
              {/* No `min`: ปัดเศษ is the one kind a bill prints as a deduction, and the validator is
                  what refuses a minus sign on any other kind. */}
              <input type="number" step="0.0001" className={validationInputClass(amountIssue ?? quantityIssue)} aria-invalid={amountIssue?.severity === 'error' || undefined} value={line.unitPrice} onChange={(e) => updateLine(index, 'unitPrice', normalizeDecimalInput(e.target.value))} disabled={!isMutable || busy} />
              <FieldIssueNote issue={amountIssue ?? quantityIssue} />
              {chargeKind === 'ROUNDING' && <p className="mt-1 text-xs text-gray-500">{t('expenses.rounding_explanation', locale)}</p>}
            </label>
            {showsVatCard && <div>
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
                <label htmlFor={`expense-charge-vat-${detail.id}-${index}`}>{t('expenses.line_vat_rate', locale)}</label>
                <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_rate', locale)} />
              </span>
              <ThemedSelect
                id={`expense-charge-vat-${detail.id}-${index}`}
                className={validationInputClass(vatRateIssue)}
                aria-invalid={vatRateIssue?.severity === 'error' || undefined}
                value={linePreset}
                onChange={(e) => {
                  const preset = e.target.value;
                  setVatEditors((current) => ({ ...current, [index]: { custom: preset === 'custom' } }));
                  updateLine(index, 'vatRate', vatRatePresetValue(preset, line.vatRate), vatTreatmentForPreset(preset));
                }}
                disabled={!isMutable || busy}
              >
                <option value="standard">{t('expenses.vat_rate_preset_standard', locale)}</option>
                <option value="exempt">{t('expenses.vat_rate_preset_exempt', locale)}</option>
                <option value="zero">{t('expenses.vat_rate_preset_zero', locale)}</option>
                <option value="nonVat">{t('expenses.vat_rate_preset_non_vat', locale)}</option>
                {linePreset === 'unknownZero' && <option value="unknownZero">{t('expenses.vat_rate_preset_unknown_zero', locale)}</option>}
                <option value="custom">{t('expenses.vat_rate_preset_custom', locale)}</option>
                {!showCustomRate && line.vatRate.trim() === '' && <option value="unset">{t('expenses.vat_rate_preset_unset', locale)}</option>}
              </ThemedSelect>
              <FieldIssueNote issue={vatRateIssue} />
              {showCustomRate && (
                <label className="mt-2 block">
                  <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_vat_percent', locale)}</span>
                  <input type="number" min="0" max="99.9999" step="0.0001" className={inputClass}
                    value={expenseRateToPercent(line.vatRate)}
                    onChange={(e) => updateLine(index, 'vatRate', expensePercentToRate(e.target.value))}
                    disabled={!isMutable || busy} />
                </label>
              )}
            </div>}
          </div>
        </div>
        );
      })}

      {values.lines.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <span>{t('expenses.document_wht_rate', locale)}</span>
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_wht_rate', locale)} />
          </span>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.wht_input_unit', locale)}</span>
              <ThemedSelect
                className={validationInputClass(whtUnitIssue)}
                aria-invalid={whtUnitIssue?.severity === 'error' || undefined}
                value={whtInput.inputType}
              onChange={(event) => { setTaxFactsDirty(true); setValues((current) => ({ ...current, whtInput: { ...current.whtInput, inputType: event.target.value as ExpenseWhtInput['inputType'], value: '' } })); }}
                disabled={!isMutable || busy}
              >
                <option value="RATE">{t('expenses.wht_unit_percent', locale)}</option>
                <option value="AMOUNT">{t('expenses.wht_unit_baht', locale)}</option>
              </ThemedSelect>
              <FieldIssueNote issue={whtUnitIssue} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t(whtInput.inputType === 'AMOUNT' ? 'expenses.wht_value_baht' : 'expenses.wht_value_percent', locale)}</span>
              <input
                id={`expense-wht-rate-${detail.id}`}
                type="number"
                inputMode="decimal"
                min="0"
                max={whtInput.inputType === 'RATE' ? '100' : undefined}
                step="0.01"
                className={validationInputClass(whtValueIssue)}
                aria-invalid={whtValueIssue?.severity === 'error' || undefined}
                value={whtInput.value}
                onChange={(event) => { setTaxFactsDirty(true); setValues((current) => ({ ...current, whtInput: { ...current.whtInput, inputType: whtInput.inputType, value: event.target.value } })); }}
                disabled={!isMutable || busy}
              />
              <FieldIssueNote issue={whtValueIssue} />
            </label>
          </div>
          {!values.whtInput && documentWhtRate === null && <p className="mt-1 text-xs text-warning-700">{t('expenses.wht_multiple_rates_hint', locale)}</p>}
          {(Number(whtInput.value) > 0 || whtInput.baseAmount !== undefined) && <label className="mt-3 block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.wht_base', locale)}</span>
            <input type="number" inputMode="decimal" min="0" step="0.01"
              aria-invalid={Boolean(fieldIssue(issues, 'whtInput.baseAmount'))}
              className={validationInputClass(fieldIssue(issues, 'whtInput.baseAmount'))}
              value={whtInput.baseAmount ?? ''} disabled={!isMutable || busy}
              onChange={(event) => { setTaxFactsDirty(true); const base = event.target.value;
                setValues((current) => { const next = { ...whtInput, ...current.whtInput };
                  if (base === '') delete next.baseAmount; else next.baseAmount = base;
                  return { ...current, whtInput: next }; }); }} />
            <FieldIssueNote issue={fieldIssue(issues, 'whtInput.baseAmount')} />
            <span className="mt-1 block text-xs text-gray-500">{t('expenses.wht_base_hint', locale)}</span>
          </label>}
          <p className="mt-1 text-xs text-gray-500">{t(whtInput.inputType === 'AMOUNT' ? 'expenses.wht_amount_hint' : 'expenses.wht_percent_hint', locale)}</p>
        </div>
      )}

      {totalIssues.map((issue, index) => <FieldIssueNote key={`${issue.messageKey}-${index}`} issue={issue} />)}

      {isMutable && busy && <p className="text-center text-xs text-gray-500">{t('expenses.saving', locale)}</p>}
    </MangmeeCard>
  );
}

// ── Detail (popup dialog) ─────────────────────────────────────────────────────
export function MoneyRow({ label, value, muted, negative }: { label: ReactNode; value: string; muted?: boolean; negative?: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between py-1.5 text-sm">
      <span className={muted ? 'text-gray-400' : 'text-gray-500'}>{label}</span>
      <span className={cx('tabular-nums font-semibold', negative ? 'text-error-500' : 'text-gray-900')}>{negative ? '- ' : ''}{baht(value)}</span>
    </div>
  );
}

export const STEP_LABEL_KEYS: Record<ExpenseReviewStepKey, DictionaryKey> = {
  data: 'expenses.step_data',
  evidence: 'expenses.step_evidence',
  review: 'expenses.step_review',
};
export const STEP_HELPER_KEYS: Record<ExpenseReviewStepKey, DictionaryKey> = {
  data: 'expenses.step_data_helper',
  evidence: 'expenses.step_evidence_helper',
  review: 'expenses.step_review_helper',
};

// ── List (period + cards + export + chips + search + grid rows + detail) ──────
// Identity, vendor, dates, amount and status share the table width; narrower screens use cards.
const GRID = 'grid grid-cols-[minmax(160px,1fr)_minmax(150px,1.4fr)_minmax(150px,1fr)_minmax(100px,0.7fr)_minmax(140px,1fr)_84px] items-center gap-3';
const LIST_PAGE_SIZE = 10;

function ExpenseListPage({ companyId, caps, userId, onSelect }: { companyId: string; caps: ExpenseCapabilities; userId: string; onSelect: (id: string) => void }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('view');
  const requestedFrom = searchParams.get('fromDate');
  const requestedTo = searchParams.get('toDate');
  const requestedBranchId = searchParams.get('branchId');
  // GAP-11: `addressMissing` is a URL view like the others so the ภ.พ.30 workpaper checklist and the
  // chip below can both link to exactly this list without duplicating the query.
  const sourceView = requestedView === 'pending' || requestedView === 'unpaid' || requestedView === 'addressMissing' ? requestedView
    : requestedView === 'confirmed' && isCivilDate(requestedFrom) && isCivilDate(requestedTo) && requestedFrom <= requestedTo ? 'confirmed' : null;
  // §11.4: the checklist link carries a valid range, so this view is period-scoped like `confirmed`
  // is; the chip's own link carries none, so this stays the every-period filter it always was.
  const addressMissingRange = sourceView === 'addressMissing' ? addressMissingListFilter(requestedFrom, requestedTo) : null;
  const toast = useToast();
  const [rows, setRows] = useState<ExpenseSummary[]>([]);
  const [catNames, setCatNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [categoryNamesLoading, setCategoryNamesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Filters ride in the menu-scoped store so opening a row and coming back does not throw the
  // period away — reviewing กันยายน should not mean re-picking it once per receipt. Refreshing
  // or leaving for another menu still resets. `page` deliberately stays local: the effect below
  // forces it back to 1 whenever a filter changes, so a restored page number would not survive.
  const [chip, setChip] = useMenuFilterState<'all' | 'draft' | 'pending' | 'confirmed' | 'rejected'>('expenses.list.chip', () => 'all');
  const [query, setQuery] = useMenuFilterState('expenses.list.query', () => '');
  const [gran, setGran] = useMenuFilterState<Gran>('expenses.list.gran', () => 'month');
  const [month, setMonth] = useMenuFilterState('expenses.list.month', () => civilPeriodKey(todayCivilDate()));
  const [day, setDay] = useMenuFilterState('expenses.list.day', () => todayCivilDate());
  const [page, setPage] = useState(1);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [columnSet, setColumnSet] = useMenuFilterState<'summary' | 'full'>('expenses.list.columnSet', () => 'summary');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // EXP-UX-01: `?highlight=<expenseId>` is written by ส่งตรวจสอบ. Always the id, never "the newest
  // row" — with two people submitting at once, "newest" points at somebody else's document.
  const highlightId = searchParams.get('highlight') ?? '';
  const [highlightReadyId, setHighlightReadyId] = useState('');
  useEffect(() => {
    if (!highlightId || sourceView) return;
    let active = true;
    // A just-submitted backdated document must open in its document month, where the list now lives.
    void getExpense(companyId, highlightId)
      .then((expense) => {
        if (!active) return;
        const documentDate = expense.expenseDate.slice(0, 10);
        if (isCivilDate(documentDate)) { setGran('month'); setMonth(civilPeriodKey(documentDate)); }
      })
      .catch(() => {}) // A stale or inaccessible highlight must not block the list.
      .finally(() => { if (active) setHighlightReadyId(highlightId); });
    return () => { active = false; };
  }, [companyId, highlightId, sourceView, setGran, setMonth]);
  const focusedHighlight = useRef('');
  const scrolledToHighlight = useRef('');
  const branchFilter = useBranchFilter();
  // LINE answer deep-links carry ?branchId= — the answer was branch-scoped, so landing must not
  // silently widen to all branches. Applied once per value, only when the branch is visible to this
  // user; locked single-branch scopes keep their forced branch.
  const appliedBranchParam = useRef('');
  useEffect(() => {
    if (!requestedBranchId || !branchFilter || branchFilter.locked) return;
    if (appliedBranchParam.current === requestedBranchId) return;
    if (!branchFilter.branches.some((b) => b.id === requestedBranchId)) return;
    appliedBranchParam.current = requestedBranchId;
    branchFilter.setBranchId(requestedBranchId);
  }, [requestedBranchId, branchFilter]);
  const branchId = branchFilter?.branchId ?? '';
  const { fromDate, toDate } = sourceView
    ? { fromDate: sourceView === 'confirmed' ? requestedFrom! : undefined, toDate: sourceView === 'confirmed' ? requestedTo! : undefined }
    : periodRange(gran, month, day);
  const loadVersion = useRef(0);
  useEffect(() => { if (sourceView) { setChip('all'); setQuery(''); } }, [sourceView, requestedFrom, requestedTo, setChip, setQuery]);

  const load = useCallback(async () => {
    if (highlightId && !sourceView && highlightReadyId !== highlightId) return;
    const version = ++loadVersion.current;
    setLoading(true); setRows([]); setError(null);
    try {
      const loaded: ExpenseSummary[] = [];
      // Counts and totals must not silently stop at the first 200 documents.
      for (let nextPage = 1; ; nextPage += 1) {
        const res = await listExpenses(companyId, {
          ...(branchId ? { branchId } : {}),
          ...(sourceView === 'confirmed' ? { status: 'CONFIRMED', fromDate, toDate }
            : sourceView === 'unpaid' ? { status: 'CONFIRMED' }
            // §11.4: scoped to the checklist's range when the URL carries a valid one, every period
            // otherwise (§8 - the chip's own link, so old documents can be filled in any time).
            : sourceView === 'addressMissing' ? addressMissingListFilter(requestedFrom, requestedTo)
            : { fromDate, toDate }),
          page: nextPage, pageSize: 200,
        });
        if (version !== loadVersion.current) return;
        loaded.push(...res.data);
        if (loaded.length >= res.total) break;
        if (res.data.length === 0 || nextPage >= 50) throw new Error('โหลดรายการไม่ครบ กรุณาเลือกช่วงวันที่สั้นลง หรือลองใหม่');
      }
      setRows(loaded);
    } catch (e) {
      if (version !== loadVersion.current) return;
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setError(err(e));
    }
    finally { if (version === loadVersion.current) setLoading(false); }
    // `branchFilter` is deliberately absent: reportBranchForbidden is stable per companyId, which is here.
  }, [companyId, branchId, fromDate, toDate, sourceView, requestedFrom, requestedTo, highlightId, highlightReadyId]);
  useEffect(() => { void load(); return () => { loadVersion.current += 1; }; }, [load]);
  useEffect(() => {
    setCategoryNamesLoading(true);
    void listExpenseCategories(companyId)
      .then((cs) => setCatNames(Object.fromEntries(cs.map((c) => [c.id, c.name]))))
      .catch(() => {})
      .finally(() => setCategoryNamesLoading(false));
  }, [companyId]);

  const sourceRows = useMemo(() => rows.filter((row) => sourceView === 'pending' ? isExpensePendingReview(row)
    : sourceView === 'unpaid' ? row.status === 'CONFIRMED' && ['UNPAID', 'PARTIALLY_PAID'].includes(row.paymentStatus) : true), [rows, sourceView]);
  const kpi = useMemo(() => summarizeExpenseKpis(sourceRows, todayCivilDate()), [sourceRows]);

  const chipCounts = useMemo(() => ({
    all: sourceRows.length,
    draft: sourceRows.filter((r) => r.status === 'DRAFT').length,
    pending: sourceRows.filter((r) => isExpensePendingReview(r)).length,
    confirmed: sourceRows.filter((r) => r.status === 'CONFIRMED').length,
    rejected: sourceRows.filter((r) => r.status === 'REJECTED').length,
  }), [sourceRows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sourceRows.filter((r) => {
      if (chip === 'draft' && r.status !== 'DRAFT') return false;
      if (chip === 'pending' && !isExpensePendingReview(r)) return false;
      if (chip === 'confirmed' && r.status !== 'CONFIRMED') return false;
      if (chip === 'rejected' && r.status !== 'REJECTED') return false;
      if (!q) return true;
      return `${r.expenseNumber ?? ''} ${r.vendorNameSnapshot ?? ''} ${r.vendorDocumentNumber ?? ''}`.toLowerCase().includes(q);
    });
  }, [sourceRows, chip, query]);

  useEffect(() => { setPage(1); setExportNotice(null); }, [chip, query, gran, month, day, branchId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, page]);
  const pageStart = filtered.length === 0 ? 0 : (page - 1) * LIST_PAGE_SIZE + 1;
  const pageEnd = Math.min(page * LIST_PAGE_SIZE, filtered.length);

  // Land on the row, not near it: a highlight the user still has to hunt for through a chip, a
  // search box or a page number is no confirmation at all. Filters survive the detail-page round
  // trip (MenuFilterScope), so a leftover chip/query would otherwise hide the row that was just
  // submitted. Once per id — after that the user's own filtering wins.
  useEffect(() => {
    if (!highlightId || focusedHighlight.current === highlightId) return;
    if (!rows.some((row) => row.id === highlightId)) return;
    const index = filtered.findIndex((row) => row.id === highlightId);
    if (index < 0) { setChip('all'); setQuery(''); return; }
    focusedHighlight.current = highlightId;
    setPage(Math.floor(index / LIST_PAGE_SIZE) + 1);
  }, [highlightId, rows, filtered, setChip, setQuery]);

  // Once per highlighted id — re-scrolling on every re-render would fight the user's own scrolling.
  // The desktop grid and the mobile card list both render (one is CSS-hidden), so scroll the copy
  // that actually has a layout box; scrollIntoView on a `display:none` node is a silent no-op.
  useEffect(() => {
    if (!highlightId || scrolledToHighlight.current === highlightId) return;
    const node = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="expenses-row"][data-highlighted], [data-testid="expenses-card"][data-highlighted]'),
    ).find((el) => el.offsetParent !== null);
    if (!node) return;
    scrolledToHighlight.current = highlightId;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightId, pagedRows]);
  const confirmTarget = rows.find((row) => row.id === confirmId);
  const confirmLabel = confirmTarget && expenseDeleteTargetLabel(confirmTarget);

  const removeExpense = async () => {
    if (!confirmTarget) return;
    setDeleting(true); setDeleteError(null);
    try {
      await deleteExpense(companyId, confirmTarget.id);
      setConfirmId(null);
      await load();
      toast.success('ลบรายการค่าใช้จ่ายเรียบร้อยแล้ว');
    } catch (e) { setDeleteError(expenseDeleteErrorMessage(e, locale)); }
    finally { setDeleting(false); }
  };

  const exportExcel = async () => {
    if (exporting) return;
    const version = loadVersion.current;
    setExporting(true); setExportError(null); setExportNotice(null);
    try {
      const result = await createAccountantPackage(companyId, { dateField: 'expenseDate', fromDate, toDate, columnSet, ...(branchId ? { branchId } : {}) });
      if (version !== loadVersion.current) return;
      // The package covers confirmed expenses only. Downloading an empty workbook reads as a broken
      // export; say which rows it would have contained instead.
      if (result.rowCount === 0) { toast.warning(t('expenses.export_empty', locale)); return; }
      if (result.truncated) setExportNotice(`ส่งออก ${result.rowCount} จากทั้งหมด ${result.totalMatched} รายการ — แบ่งช่วงวันที่ให้สั้นลงเพื่อส่งออกให้ครบ`);
      // An incomplete package must never look complete: files the caller may not open are dropped
      // from the manifest, so say how many instead of handing over a quietly short set.
      if (result.skippedEvidence.length > 0) {
        setExportNotice((prev) => [prev, `ข้ามไฟล์แนบ ${result.skippedEvidence.length} ไฟล์ที่คุณไม่มีสิทธิ์เปิด`].filter(Boolean).join(' · '));
      }
      downloadIndexXlsx(result, `expense-index-${gran === 'month' ? month : day}.xlsx`);
      setExported(true); setTimeout(() => setExported(false), 3000);
    } catch (e) {
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setExportError(err(e));
    }
    finally { setExporting(false); }
  };

  const chips: Array<{ key: typeof chip; label: string }> = [
    { key: 'all', label: t('expenses.chip_all', locale) }, { key: 'draft', label: t('expenses.chip_draft', locale) }, { key: 'pending', label: t('expenses.chip_pending', locale) }, { key: 'confirmed', label: t('expenses.chip_confirmed', locale) }, { key: 'rejected', label: t('expenses.chip_rejected', locale) },
  ];
  const cards = [
    { label: t('expenses.kpi_total', locale), value: baht(kpi.total), sub: `${kpi.counted} ${t('expenses.kpi_total_sub', locale)}`, icon: ICON.receipt, ...KPI.amber },
    { label: t('expenses.kpi_pending', locale), value: `${kpi.pending} ${t('expenses.unit_document', locale)}`, sub: t('expenses.kpi_pending_sub', locale), icon: ICON.clock, ...KPI.sky },
    { label: t('expenses.kpi_outstanding', locale), value: baht(kpi.outstanding), sub: t('expenses.kpi_outstanding_sub', locale), icon: ICON.wallet, ...KPI.purple },
    { label: t('expenses.kpi_overdue', locale), value: baht(kpi.overdue), sub: `${kpi.overdueCount} ${t('expenses.kpi_overdue_sub', locale)}`, icon: ICON.alert, ...KPI.danger, danger: true },
    { label: t('expenses.kpi_vat', locale), value: baht(kpi.vat), sub: t('expenses.kpi_vat_sub', locale), icon: ICON.doc, ...KPI.brand },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {caps.canUploadReceipts && <Link className={btnClass} href={`/companies/${companyId}/expenses/upload`}>อัปโหลดใบเสร็จ</Link>}
        {caps.canCreate && <Link className={ghostClass} href={`/companies/${companyId}/expenses/manual`}>บันทึกเอง</Link>}
      </div>
      {sourceView && <div role="status" className="rounded-xl bg-brand-25 p-3 text-sm text-brand-800">
        {sourceView === 'confirmed' ? `รายการยืนยันแล้ว · วันที่เอกสาร ${dateShort(fromDate)} – ${dateShort(toDate)}`
          : sourceView === 'pending' ? 'ใบเสร็จรอตรวจ · ทุกช่วงเวลา รวมฉบับร่าง'
            : sourceView === 'addressMissing' ? (addressMissingRange?.fromDate && addressMissingRange?.toDate
                ? `${t('expenses.view_vendor_address_missing', locale)} · วันที่เอกสาร ${dateShort(addressMissingRange.fromDate)} – ${dateShort(addressMissingRange.toDate)}`
                : t('expenses.view_vendor_address_missing', locale))
              : 'ค้างจ่ายที่ยืนยันแล้ว · ทุกช่วงเวลา'}
        <button className="ml-2 min-h-11 underline" onClick={() => router.replace(`/companies/${companyId}/expenses`)}>กลับไปดูรายการตามเดือน</button>
      </div>}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        {/* period control (finBar) */}
        {!sourceView && <div className="w-full sm:w-auto">
          <div className="flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible">
            <div className="mangmee-segmented shrink-0 whitespace-nowrap">
              <button className={cx('mangmee-tab', gran === 'day' && 'mangmee-tab-active')} onClick={() => setGran('day')}>{t('expenses.granularity_day', locale)}</button>
              <button className={cx('mangmee-tab', gran === 'month' && 'mangmee-tab-active')} onClick={() => setGran('month')}>{t('expenses.granularity_month', locale)}</button>
            </div>
            {gran === 'day'
              ? <ThemedDate className={cx(inputClass, 'w-auto shrink-0 whitespace-nowrap')} value={day} onChange={(e) => setDay(e.target.value)} />
              : <ThemedDate mode="month" className={cx(inputClass, 'w-auto shrink-0 whitespace-nowrap')} value={month} onChange={(e) => setMonth(e.target.value)} />}
            {gran === 'day' && <button className={cx(ghostClass, 'shrink-0 whitespace-nowrap px-3')} onClick={() => setDay(todayCivilDate())}>{t('expenses.today', locale)}</button>}
          </div>
          <p className="mt-1 text-xs text-gray-400">{t('expenses.document_filter_desc', locale)}</p>
        </div>}
        {/* Export uses the shared dialog so opening options never resizes this toolbar. */}
        {(!sourceView || sourceView === 'confirmed') && (
          <button type="button" className={cx(ghostClass, 'self-start lg:ml-auto')} aria-haspopup="dialog" onClick={() => setExportOpen(true)}>
            ส่งออกเอกสารยืนยันแล้ว
          </button>
        )}
      </div>
      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="ส่งออกเอกสารยืนยันแล้ว" size="sm"
        footer={<button type="button" className={cx(btnClass, exporting && 'cursor-wait opacity-60')} onClick={exportExcel} aria-disabled={exporting} aria-busy={exporting}>
          {exporting ? t('expenses.generating', locale) : t('expenses.export_excel', locale)}
        </button>}>
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t('expenses.export_desc', locale)}</p>
          <p className="text-sm font-semibold text-gray-800">{dateShort(fromDate)} – {dateShort(toDate)}</p>
          <label className="block space-y-2 text-sm font-semibold text-gray-700">
            <span>{t('expenses.export_columns', locale)}</span>
            <ThemedSelect className={cx(inputClass, 'w-full')} value={columnSet} onChange={(e) => setColumnSet(e.target.value as 'summary' | 'full')} aria-label={t('expenses.export_columns', locale)}>
              <option value="summary">{t('expenses.export_columns_summary', locale)}</option>
              <option value="full">{t('expenses.export_columns_full', locale)}</option>
            </ThemedSelect>
          </label>
          {exportError && <ErrorBanner message={exportError} />}
          {exportNotice && <p role="status" className="text-sm font-semibold text-warning-700">{exportNotice}</p>}
          {exported && <p role="status" className="text-sm font-semibold text-brand-600">✓ {t('expenses.downloaded', locale)}</p>}
        </div>
      </Modal>

      {/* KPI cards */}
      <div className="hidden gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">{cards.map((c) => <StatCard key={c.label} {...c} />)}</div>
      <details className="rounded-xl border border-gray-200 bg-white p-3 sm:hidden">
        <summary className="cursor-pointer text-sm font-semibold">{kpi.counted} รายการ · {baht(kpi.total)} · ดูสรุปยอด</summary>
        <div className="mt-3 grid gap-2">{cards.map((c) => <StatCard key={c.label} {...c} />)}</div>
      </details>

      {error && <ErrorBanner message={error} />}

      {/* full-width list; row click opens the detail popup */}
      <MangmeeCard className="p-4">
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {chips.map((c) => (
              <button key={c.key} onClick={() => setChip(c.key)}
                className={cx('inline-flex min-h-11 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-semibold transition sm:min-h-0',
                  chip === c.key ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200')}>
                {c.label}
                <span className={cx('tabular-nums inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-extrabold', chip === c.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500')}>{chipCounts[c.key]}</span>
              </button>
            ))}
            {/* §11.4: the way into "ใบกำกับที่ยังไม่มีที่อยู่ผู้ขาย". It carries no count because the
                server answers it across every period, not out of the rows already loaded here.
                No fromDate/toDate on purpose - unlike the ภ.พ.30 checklist's own link, this chip
                stays the browse-the-whole-backlog entry point (see addressMissingListFilter). */}
            <button type="button" aria-pressed={sourceView === 'addressMissing'}
              onClick={() => router.replace(`/companies/${companyId}/expenses${sourceView === 'addressMissing' ? '' : '?view=addressMissing'}`)}
              className={cx('col-span-2 inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-sm font-semibold leading-tight transition sm:col-span-1',
                sourceView === 'addressMissing' ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200')}>
              {t('expenses.chip_vendor_address_missing', locale)}
            </button>
            <div className="relative order-first col-span-2 w-full sm:col-span-3 lg:col-span-5 lg:ml-auto lg:max-w-[19.2rem]">
              <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                placeholder={t('expenses.search_placeholder', locale)}
                value={query} onChange={(e) => setQuery(e.target.value)} />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
                {ICON.search}
              </span>
            </div>
          </div>

          {loading || categoryNamesLoading ? <LoadingState label="กำลังโหลด..." />
            : filtered.length === 0 ? <p className="py-10 text-center text-sm text-gray-500">{t('expenses.empty_period', locale)}</p>
              : <>
          <div className="hidden xl:block">
          <div className="overflow-x-auto" data-testid="expenses-grid">
            <div className="min-w-[900px]">
              <div className={cx(GRID, 'mt-3 border-b border-gray-100 px-2 pb-2 text-[13px] font-bold uppercase tracking-wide text-gray-400')}>
                <div>{t('expenses.col_expense_number', locale)}</div><div>{t('expenses.col_vendor_category', locale)}</div><div>{t('expenses.col_date_source', locale)}</div><div className="text-right">{t('expenses.col_total', locale)}</div><div className="text-right">{t('expenses.col_status', locale)}</div><div className="text-right"><span className="sr-only">การทำงาน</span></div>
              </div>
              {loading ? <p className="py-8 text-center text-sm text-gray-500">{t('expenses.loading', locale)}</p>
                : filtered.length === 0 ? <p className="py-10 text-center text-sm text-gray-500">{t('expenses.empty_period', locale)}</p>
                  : pagedRows.map((e) => (
                      <div key={e.id} onClick={() => onSelect(e.id)} data-testid="expenses-row"
                        {...(e.id === highlightId ? { 'data-highlighted': 'true' } : {})}
                        className={cx(GRID, 'cursor-pointer border-b border-gray-50 px-2 py-3 transition hover:bg-gray-50',
                          e.id === highlightId && 'rounded-xl ring-2 ring-brand-500 bg-brand-25')}>
                        <div className="min-w-0 font-mono text-sm font-semibold text-gray-700 [overflow-wrap:anywhere]">{firstFilled(e.expenseNumber) ?? t('expenses.number_pending', locale)}</div>
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold text-gray-900">{firstFilled(e.vendorNameSnapshot) ?? t('expenses.vendor_pending', locale)}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
                            {e.expenseCategoryId && catNames[e.expenseCategoryId] && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600">{catNames[e.expenseCategoryId]}</span>}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500"><span className="font-semibold">{t('expenses.document_date', locale)}:</span> {e.dateStatus === 'unverified' ? 'ยังไม่ระบุ' : dateShort(e.expenseDate)}</div>
                          <div className="mt-0.5 text-xs text-gray-500"><span className="font-semibold">{t('expenses.intake_date', locale)}:</span> {dateShort(e.uploadedAt)}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <LateDocumentBadge expense={e} locale={locale} />
                            <DocumentDateBadge expense={e} />
                            <MangmeeBadge tone="slate">{expenseValueLabel(CAPTURE_SOURCE_LABELS, e.captureSource, 'ช่องทางอื่น')}</MangmeeBadge>
                          </div>
                        </div>
                        <div className="tabular-nums text-right text-[15px] font-bold text-gray-900">{baht(e.grandTotalAmount)}</div>
                        <div className="flex flex-col items-end gap-1">{e.reimbursementProgress ? <span className="text-xs text-success-700">{expenseReimbursementProgressLabel(e.reimbursementProgress)}</span> : <><StatusBadge status={e.status} /><StatusBadge status={e.paymentStatus} /></>}</div>
                        <div className="flex items-center justify-end gap-1.5">
                          <IconBtn title="ดูรายละเอียด" onClick={(event) => { event.stopPropagation(); onSelect(e.id); }}>{ICON.eye}</IconBtn>
                          {canDeleteExpense(e, userId, caps) && (
                            <IconBtn title="ลบ" tone="danger" onClick={(event) => { event.stopPropagation(); setDeleteError(null); setConfirmId(e.id); }}>{ICON.trash}</IconBtn>
                          )}
                        </div>
                      </div>
                    ))}
            </div>
          </div>
          </div>
          <div className="mt-3 space-y-3 xl:hidden" data-testid="expenses-card-list">
            {pagedRows.map((e) => (
              <MangmeeCard key={e.id} className={cx('overflow-hidden', e.id === highlightId && 'ring-2 ring-brand-500')}>
                <button
                  type="button"
                  className="block min-h-11 w-full p-4 text-left"
                  onClick={() => onSelect(e.id)}
                  data-testid="expenses-card"
                  {...(e.id === highlightId ? { 'data-highlighted': 'true' } : {})}
                >
                  <div className="min-w-0">
                    <span className="block text-xs font-medium text-gray-500">{t('expenses.col_expense_number', locale)}</span>
                    <span className="mt-1 block font-mono text-sm font-semibold text-gray-700 [overflow-wrap:anywhere]">{firstFilled(e.expenseNumber) ?? t('expenses.number_pending', locale)}</span>
                    <span className="mt-2 block truncate text-sm font-semibold text-gray-900">{firstFilled(e.vendorNameSnapshot) ?? t('expenses.vendor_pending', locale)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-500">
                    <div><span className="block font-semibold">{t('expenses.document_date', locale)}</span>{e.dateStatus === 'unverified' ? 'ยังไม่ระบุ' : dateShort(e.expenseDate)}</div>
                    <div className="text-right"><span className="block font-semibold">{t('expenses.intake_date', locale)}</span>{dateShort(e.uploadedAt)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge status={e.status} />
                    <LateDocumentBadge expense={e} locale={locale} />
                    <DocumentDateBadge expense={e} />
                  </div>
                  <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{baht(e.grandTotalAmount)}</div>
                </button>
              </MangmeeCard>
            ))}
          </div>
          </>}
          {!loading && filtered.length > 0 && (
            <>
                  <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-4 text-sm text-gray-500">
                    <div className="tabular-nums">
                      {t('expenses.pagination_showing', locale)} {pageStart}-{pageEnd} {t('expenses.pagination_of', locale)} {filtered.length} {t('expenses.pagination_items', locale)}
                    </div>
                    {totalPages > 1 && (
                      <div className="flex items-center gap-2">
                        <button className={ghostClass} disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>{t('expenses.previous', locale)}</button>
                        <span className="tabular-nums rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700">{page} / {totalPages}</span>
                        <button className={ghostClass} disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>{t('expenses.next', locale)}</button>
                      </div>
                    )}
                  </div>
                </>
              )}
      </MangmeeCard>

      {/* A11Y-01: the shared Modal owns the dialog role, focus trap, Escape and the labelled close
          button. The hand-rolled overlay this replaces had none of them. */}
      <Modal
        open={Boolean(confirmTarget)}
        size="sm"
        title={confirmLabel ? `ลบรายการ “${confirmLabel}” อย่างถาวร?` : 'ลบรายการนี้อย่างถาวร?'}
        closeLabel={t('expenses.close', locale)}
        onClose={() => { if (!deleting) setConfirmId(null); }}
        footer={(
          <>
            <button type="button" className={ghostClass} disabled={deleting} onClick={() => setConfirmId(null)}>ยกเลิก</button>
            <button type="button" className={dangerClass} disabled={deleting} aria-busy={Boolean(deleting)} onClick={() => void removeExpense()}>{deleting ? 'กำลังลบ...' : 'ลบถาวร'}</button>
          </>
        )}
      >
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-gray-600">รายการค่าใช้จ่ายนี้จะถูกลบอย่างถาวรพร้อมข้อมูลที่เกี่ยวข้อง และไม่สามารถย้อนกลับได้</p>
          {deleteError && <ErrorBanner message={deleteError} />}
        </div>
      </Modal>

    </div>
  );
}

function ManualExpensePanel({ companyId, branchId, canAttachReceipt, onSuccess }: { companyId: string; branchId?: string; canAttachReceipt: boolean; onSuccess: (expenseId: string) => void }) {
  const locale = useWorkspaceLocale();
  const [expenseDate, setExpenseDate] = useState(todayCivilDate());
  const [items, setItems] = useState<ManualExpenseItem[]>([{ description: '', quantity: '1', unitPrice: '', discountAmount: '0' }]);
  const [serviceCharge, setServiceCharge] = useState('');
  const [taxCodeDefinitionId, setTaxCodeDefinitionId] = useState('');
  const [taxCodeName, setTaxCodeName] = useState('');
  const [externalTaxCode, setExternalTaxCode] = useState<string>();
  const [vatRate, setVatRate] = useState('');
  const [vatMode, setVatMode] = useState<ExpenseDetail['vatMode']>('NO_VAT');
  // Spec §19g decision 3: the mode is the document's arithmetic, not the Tax Code's. The Tax Code
  // only seeds it — once the reviewer states what the receipt prints, re-picking a code must not
  // silently move the money.
  const [vatModeTouched, setVatModeTouched] = useState(false);
  // Re-asked when the date moves: a company registered mid-year must not be offered input VAT on
  // a document dated before it registered.
  const capture = useExpenseCapturePolicy(companyId, expenseDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [preparingReceipt, setPreparingReceipt] = useState(false);
  // Set when the draft was created but the receipt upload failed: submitting again
  // would create a second draft, so the submit button becomes "open the saved draft".
  const [savedExpenseId, setSavedExpenseId] = useState<string | null>(null);
  const draftSave = useRef<{ key: string; body?: CreateExpenseDraftInput }>({ key: '' });

  const selectReceiptFile = async (file: File | null) => {
    setReceiptFile(null); setError('');
    if (!file) return;
    if (classifyUploadFile(file.name, file.type) === 'unsupported') { setError(t('expenses.upload_unsupported_file', locale)); return; }
    setPreparingReceipt(true);
    try {
      setReceiptFile((await prepareReceiptFile(file)).file);
    } catch (cause) {
      setError(cause instanceof HeicDecodeError ? t('expenses.upload_heic_unsupported', locale) : uploadErrorMessage(cause));
    } finally { setPreparingReceipt(false); }
  };

  const setItem = (index: number, patch: Partial<ManualExpenseItem>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  const itemNet = (item: ManualExpenseItem) =>
    Math.max(0, Number(item.quantity || '0') * Number(item.unitPrice || '0') - Number(item.discountAmount || '0'));

  // A printed service charge becomes its own line, the same shape the OCR path writes for a
  // SERVICE_CHARGE adjustment, so the summary below previews exactly what gets sent.
  const lines = buildManualExpenseLines({
    items,
    serviceChargeAmount: serviceCharge,
    serviceChargeDescription: t('expenses.manual_service_charge', locale),
    vatRate, taxCodeDefinitionId, externalTaxCode,
  });

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (!draftSave.current.body) {
        if (!branchId) throw new Error(t('transaction.source_branch_required', locale));
        const forbidden = findForbiddenChars(items.map((item) => item.description).join(''));
        if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
        if (!(totals.grandTotal > 0)) throw new Error(t('expenses.manual_total_required', locale));
        draftSave.current.key ||= crypto.randomUUID();
        draftSave.current.body = {
          idempotencyKey: draftSave.current.key,
          captureSource: 'WEB_MANUAL', expenseDate, branchId, vatMode,
          inputVatClaimStatus: taxCodeDefinitionId ? 'NEEDS_REVIEW' : 'NON_CLAIMABLE',
          lines,
        };
      }
      let result: ExpenseSummary;
      try { result = await createExpenseDraft(companyId, draftSave.current.body); }
      catch (cause) {
        // A validation refusal has not committed. A network/5xx outcome is ambiguous:
        // retain that exact command until its retry recovers the original expense.
        if ([400, 422].includes((cause as { statusCode?: number }).statusCode ?? 0)) draftSave.current.body = undefined;
        throw cause;
      }
      if (receiptFile) {
        try {
          // The receipt slot: only expense.receipt.primary satisfies the confirm rule.
          await uploadExpenseEvidenceFile(companyId, result.id, result.branchId ?? null, receiptFile, 'expense.receipt.primary');
        } catch (uploadCause) {
          setSavedExpenseId(result.id);
          setError(`${t('expenses.manual_receipt_upload_failed', locale)}: ${err(uploadCause)}`);
          return;
        }
      }
      onSuccess(result.id);
    } catch (cause) { setError(err(cause)); } finally { setBusy(false); }
  }

  // Same shape the review form uses (expense-review-validation.computedGrandTotal): the discount is
  // applied first and the result priced as a single unit, then the lines are summed, so both paths
  // run one arithmetic whether or not a service charge line exists.
  const afterDiscount = lines.map((line) => Math.max(0, Number(line.quantity || '0') * Number(line.unitPrice || '0') - Number(line.discountAmount || '0')));
  const totals = lines.reduce((sum, line, index) => {
    const lineTotals = calculateManualExpenseTotals({ quantity: '1', unitPrice: afterDiscount[index]!, vatRate: line.vatRate, vatMode });
    return { subtotal: sum.subtotal + lineTotals.subtotal, vat: sum.vat + lineTotals.vat, grandTotal: sum.grandTotal + lineTotals.grandTotal };
  }, { subtotal: 0, vat: 0, grandTotal: 0 });
  const amountReady = totals.grandTotal > 0;
  const sectionTitle = (icon: ReactNode, title: DictionaryKey, helper: DictionaryKey) => (
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700">{icon}</span>
      <div>
        <h3 className="font-semibold text-gray-800">{t(title, locale)}</h3>
        <p className="mt-0.5 text-xs text-gray-500">{t(helper, locale)}</p>
      </div>
    </div>
  );
  const req = <span aria-hidden="true" className="text-error-500"> *</span>;
  return <div className="space-y-4">
    <div><h2 className="text-lg font-bold text-gray-900">{t('expenses.manual_title', locale)}</h2><p className="text-sm text-gray-500">{t('expenses.manual_intro', locale)}</p></div>
    {error && <ErrorBanner message={error} focus />}
    {error && draftSave.current.body && !savedExpenseId && <p role="status" className="text-sm text-gray-600">ยังยืนยันผลการบันทึกไม่ได้ กดบันทึกซ้ำเพื่อตรวจคำสั่งเดิม แล้วเปิดรายการที่บันทึกไว้เพื่อแก้ไขต่อ</p>}
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <MangmeeCard className="space-y-3 p-4">
          {sectionTitle(ICON.doc, 'expenses.manual_document_section', 'expenses.manual_document_helper')}
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_date', locale)}{req}</span><ThemedDate aria-label={t('expenses.manual_date', locale)} className={inputClass} value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /><span className="mt-1 block text-sm text-gray-500">ตรวจวันที่ให้ตรงกับเอกสารก่อนบันทึก วันที่จ่ายระบุแยกในขั้นตอนชำระเงิน</span></label>
            <div className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_receipt', locale)}</span>
              {canAttachReceipt ? <>
                <ThemedFile file={receiptFile} accept={RECEIPT_UPLOAD_ACCEPT} disabled={busy || preparingReceipt || !!savedExpenseId} loading={Boolean(busy || preparingReceipt)} onChange={(file) => void selectReceiptFile(file)} />
                {preparingReceipt ? <p className="mt-1 text-xs text-gray-500">{t('expenses.upload_preparing', locale)}</p>
                  : !receiptFile && <p className="mt-1 text-xs text-gray-400">{t('expenses.manual_receipt_helper', locale)}</p>}
              </> : <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">{t('expenses.manual_receipt_forbidden', locale)}</p>}
            </div>
          </div>
        </MangmeeCard>
        <MangmeeCard className="space-y-3 p-4">
          {sectionTitle(ICON.wallet, 'expenses.manual_items_section', 'expenses.manual_items_helper')}
          {items.map((item, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-gray-200">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                <span className="text-xs font-bold text-gray-600">{t('expenses.manual_item_n', locale).replace('{n}', String(index + 1))}</span>
                <span className="flex items-center gap-1.5">
                  <span className="tabular-nums text-xs font-semibold text-gray-500">{baht(itemNet(item))}</span>
                  {items.length > 1 && (
                    <button type="button" aria-label={t('expenses.manual_remove_item', locale)} disabled={busy} aria-busy={Boolean(busy)} onClick={() => setItems((current) => current.filter((_, i) => i !== index))} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-error-50 hover:text-error-600">
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M3.5 5.5h13m-9.5 0v-1a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v1m-6.5 0 .6 10a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4l.6-10M8.2 8.5v5m3.6-5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                </span>
              </div>
              <div className="grid gap-3 p-3 sm:grid-cols-3">
                <label className="sm:col-span-3"><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_description', locale)}{req}</span><input required className={inputClass} value={item.description} onChange={(event) => setItem(index, { description: stripDisallowed(event.target.value) })} /></label>
                <label><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_quantity', locale)}{req}</span><input required type="number" min="0" step="0.0001" className={inputClass} value={item.quantity} onChange={(event) => setItem(index, { quantity: event.target.value })} /></label>
                <label><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_unit_price', locale)}{req}</span><input required type="number" min="0" step="0.0001" className={inputClass} value={item.unitPrice} onChange={(event) => setItem(index, { unitPrice: normalizeDecimalInput(event.target.value) })} /></label>
                <label><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_discount', locale)}</span><input type="number" min="0" step="0.0001" className={inputClass} value={item.discountAmount} onChange={(event) => setItem(index, { discountAmount: normalizeDecimalInput(event.target.value) })} /></label>
              </div>
            </div>
          ))}
          <button type="button" disabled={busy} onClick={() => setItems((current) => [...current, { description: '', quantity: '1', unitPrice: '', discountAmount: '0' }])} className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 px-3 py-2.5 text-sm font-bold text-brand-700 transition hover:border-brand-300 hover:bg-brand-25">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M10 4.5v11m-5.5-5.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            {t('expenses.manual_add_item', locale)}
          </button>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_service_charge', locale)}</span>
            <input type="number" min="0" step="0.01" className={inputClass} value={serviceCharge} onChange={(event) => setServiceCharge(event.target.value)} />
            <p className="mt-1 text-xs text-gray-400">{t('expenses.manual_service_charge_helper', locale)}</p>
          </label>
        </MangmeeCard>
        {showsTaxCapture(capture.mode) && <MangmeeCard className="space-y-3 p-4">
          {sectionTitle(ICON.receipt, 'expenses.manual_tax_section', 'expenses.manual_tax_helper')}
          <TransactionTaxLineSelector companyId={companyId} branchId={branchId} sourceType="expense.record" sourceId="new-manual-expense" sourceLineId="line-1" transactionContext="DOMESTIC_PURCHASE" direction="INPUT" documentDate={expenseDate} netAmount={String(totals.subtotal)} grossAmount={String(totals.grandTotal)} enteredTaxAmount={String(totals.vat)} value={taxCodeDefinitionId} canConfigureTax={capture.canConfigureTax} onChange={(id, definition) => { setTaxCodeDefinitionId(id); setTaxCodeName(definition ? `${definition.externalCode} · ${definition.displayName}` : ''); setExternalTaxCode(definition?.externalCode); setVatRate(definition ? taxDefinitionRateForSource(definition.rate, 'expense') : ''); if (!vatModeTouched) setVatMode(!definition || definition.calculationMethod === 'NONE' ? 'NO_VAT' : definition.calculationMethod === 'INCLUSIVE' ? 'VAT_INCLUDED' : 'VAT_EXCLUDED'); }} />
          <div>
            <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
              <label htmlFor="manual-expense-vat-mode">{t('expenses.vat_mode', locale)}</label>
              <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_mode', locale)} />
            </span>
            <ThemedSelect id="manual-expense-vat-mode" className={inputClass} value={vatMode} onChange={(event) => { setVatMode(event.target.value as ExpenseDetail['vatMode']); setVatModeTouched(true); }}>
              {Object.entries(EXPENSE_VAT_MODE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </ThemedSelect>
          </div>
        </MangmeeCard>}
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <MangmeeCard className="space-y-4 p-4">
          <h3 className="font-semibold text-gray-800">{t('expenses.manual_summary_title', locale)}</h3>
          {(items.length > 1 || Number(serviceCharge || '0') > 0) && (
            <ul className="space-y-1.5 border-b border-dashed border-gray-200 pb-3 text-xs text-gray-600">
              {items.map((item, index) => (
                <li key={index} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{item.description || t('expenses.manual_item_n', locale).replace('{n}', String(index + 1))}</span>
                  <span className="tabular-nums font-medium">{baht(itemNet(item))}</span>
                </li>
              ))}
              {Number(serviceCharge || '0') > 0 && (
                <li className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate">{t('expenses.manual_service_charge', locale)}</span>
                  <span className="tabular-nums font-medium">{baht(Number(serviceCharge))}</span>
                </li>
              )}
            </ul>
          )}
          <div className="space-y-2">
            <MoneyRow label={t('expenses.manual_before_tax', locale)} value={String(totals.subtotal)} />
            <MoneyRow label={t('expenses.vat', locale)} value={String(totals.vat)} />
            <div className="border-t border-dashed border-gray-200 pt-3">
              <div className="text-sm font-semibold text-gray-700">{t('expenses.manual_total', locale)}</div>
              <div className="mt-1 tabular-nums text-2xl font-black text-gray-900">{baht(totals.grandTotal)}</div>
            </div>
          </div>
          {showsTaxCapture(capture.mode) && <MangmeeBadge tone={taxCodeDefinitionId ? 'purple' : 'slate'}>{taxCodeName || t('expenses.manual_no_tax_code', locale)}</MangmeeBadge>}
          {savedExpenseId
            ? <button type="button" className={cx(btnClass, 'w-full')} onClick={() => onSuccess(savedExpenseId)}>{t('expenses.manual_open_saved', locale)}</button>
            : <>
              {/* `item.unitPrice` is truthy for "0", so a ฿0 draft used to save happily here and was
                  only refused much later, by จัดทำใบรับรองแทนใบเสร็จ. The rule belongs to this form. */}
              <button formNoValidate={Boolean(draftSave.current.body)} disabled={busy || preparingReceipt || (!draftSave.current.body && (!expenseDate || !amountReady || !items.every((item) => item.description.trim() && item.unitPrice)))} aria-busy={Boolean(busy)} className={cx(btnClass, 'w-full')}>{busy ? t('expenses.manual_saving', locale) : t('expenses.manual_save_draft', locale)}</button>
              {!amountReady && <p className="text-xs font-semibold leading-5 text-warning-700">{t('expenses.manual_total_required', locale)}</p>}
            </>}
          <p className="text-xs leading-relaxed text-gray-500">{t('expenses.manual_intro', locale)}</p>
        </MangmeeCard>
      </div>
    </form>
  </div>;
}

// ── Hub ───────────────────────────────────────────────────────────────────────
const EXPENSES_TABS: ReadonlyArray<ExpensesTab> = ['list', 'upload', 'manual', 'categories', 'signatures', 'evidence'];
const EXPENSES_TAB_ROUTES: Record<ExpensesTab, string> = {
  list: '',
  upload: '/upload',
  manual: '/manual',
  categories: '/categories',
  signatures: '/signatures',
  evidence: '/evidence',
};
const TAB_META: Record<ExpensesTab, { labelKey: DictionaryKey; descKey: DictionaryKey }> = {
  list: { labelKey: 'expenses.tab_list', descKey: 'expenses.tab_list_desc' },
  upload: { labelKey: 'expenses.tab_upload', descKey: 'expenses.tab_upload_desc' },
  manual: { labelKey: 'expenses.tab_manual', descKey: 'expenses.tab_manual_desc' },
  categories: { labelKey: 'expenses.tab_categories', descKey: 'expenses.tab_categories_desc' },
  signatures: { labelKey: 'expenses.tab_signatures', descKey: 'expenses.tab_signatures_desc' },
  evidence: { labelKey: 'expenses.tab_evidence', descKey: 'expenses.tab_evidence_desc' },
};

export function ExpensesHubPage({ companyId, userId, permissions, tab = 'list' }: { companyId: string; userId: string; permissions: string[]; tab?: ExpensesTab }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const branchFilter = useBranchFilter();
  const branchId = branchFilter?.branchId ?? '';
  const createBranchId = useTransactionCreateBranchId();
  const toast = useToast();
  const caps = expenseCapabilities(permissions);
  // A2: the LINE ticket names one signature. The `?tab=` redirect below already carries every other
  // query param through to the real route, so this only has to read it once it lands.
  const [focusSignatureId, setFocusSignatureId] = useState('');
  useEffect(() => {
    setFocusSignatureId(new URLSearchParams(window.location.search).get('signatureId') ?? '');
  }, [tab]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('tab');
    if (tab === 'list' && EXPENSES_TABS.includes(requested as ExpensesTab)) {
      params.delete('tab');
      const target = `/companies/${companyId}/expenses${EXPENSES_TAB_ROUTES[requested as ExpensesTab]}`;
      const query = params.toString();
      router.replace(query ? `${target}?${query}` : target);
      return;
    }
    const expenseId = params.get('expenseId');
    if (expenseId) {
      router.replace(`/companies/${companyId}/expenses/${encodeURIComponent(expenseId)}`);
    }
  }, [companyId, router, tab]);

  const openListExpense = (expenseId: string) => {
    router.push(`/companies/${companyId}/expenses/${encodeURIComponent(expenseId)}`);
  };
  const storeExtractionNotice = (expenseId: string, notice: ExtractionNotice) => {
    try { window.sessionStorage.setItem(expenseNoticeKey(expenseId), JSON.stringify(notice)); } catch { /* storage may be disabled */ }
  };

  // Every expense submenu renders through this one shell, so the heading names the tab the user
  // clicked rather than the hub — `labelKey` is the sidebar's own wording, so the two cannot drift.
  const meta = TAB_META[tab];
  const forbidden = !canAccessExpenseTab(tab, caps);

  return (
    <MangmeePage
      eyebrow={t('expenses.eyebrow', locale)}
      title={t(meta.labelKey, locale)}
      description={t(meta.descKey, locale)}
    >
      {forbidden ? <StateBanner error="Forbidden" /> : (
        <>
          {tab === 'list' && <ExpenseListPage companyId={companyId} caps={caps} userId={userId} onSelect={openListExpense} />}
          {(tab === 'upload' || tab === 'manual') && <>
            <TransactionBranchField value={createBranchId} invalid={!createBranchId} />
            {/* Owner report 2026-08-28: with several branches and the all-branches filter on, this panel is
                disabled — pressing อัปโหลด did nothing and said nothing. The field itself now reads as an
                error, and pressing the dead panel says why instead of leaving a standing banner on screen.
                A single-branch company defaults to its branch and never reaches this. */}
            <div onClickCapture={() => {
              if (createBranchId) return;
              toast.error(t('transaction.branch_required_before_create', locale));
              // Scroll only, never focus: focusing the control opens its picker, which reads as the
              // page acting for the user (Owner report 2026-08-29). The field's invalid styling and
              // the toast already say what to do. The tag now sits on the field wrapper — the
              // control itself is a ThemedSelect, not a <select>.
              const field = document.querySelector<HTMLElement>('[data-transaction-branch-select]');
              field?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}>
            <fieldset disabled={!createBranchId} className="min-w-0">
              {tab === 'upload' && <UploadPanel companyId={companyId} branchId={createBranchId} canManagePlan={permissions.includes('company.plan.manage')} {...(caps.canCreate ? { onNoDocument: () => router.push(`/companies/${companyId}/expenses/substitute-receipts/new`) } : {})} onSuccess={(expenseId, notice) => { storeExtractionNotice(expenseId, notice); openListExpense(expenseId); }} onBatchSuccess={(created) => { for (const row of created) storeExtractionNotice(row.expenseId, row.notice); router.push(`/companies/${companyId}/expenses?highlight=${encodeURIComponent(created.at(-1)!.expenseId)}`); }} />}
              {tab === 'manual' && <ManualExpensePanel companyId={companyId} branchId={createBranchId} canAttachReceipt={caps.canUploadReceipts && permissions.includes('attachment.create')} onSuccess={openListExpense} />}
            </fieldset>
            </div>
          </>}
          {tab === 'categories' && <CategoryManagePanel companyId={companyId} />}
          {tab === 'signatures' && <SignaturePanel companyId={companyId} {...(focusSignatureId ? { focusSignatureId } : {})} />}
          {tab === 'evidence' && <EvidencePanel companyId={companyId} canExport={caps.canExportPackage} canReadLedger={caps.canReadLedger} canPostLedger={caps.canPostLedger} canPostClaimPayments={caps.canPostLedger && permissions.includes('reimbursement.finance_review')} onOpenExpense={openListExpense} />}
        </>
      )}
    </MangmeePage>
  );
}
