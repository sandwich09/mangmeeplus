'use client';
import { AccountingExportFormatSelect, AccountingExportFeedback, type AccountingExportFormat } from './AccountingExportControls';
import type { AccountingSoftwareExportResult } from '@watchdog-bms/contracts';
import { focusExpenseField } from './expense-focus.logic';
import { canEditSubstituteReceipt } from './substitute-receipt-wizard.model';

import { showInputVatQuestion, showListedInputVatRight } from './expense-input-vat-right.logic';

import { ExpenseInputVatRight } from './ExpenseInputVatRight';
import { whtFilingRouteHint, isExpenseCancelled, thaiTaxIdChecksumValid, expenseDateIsReadable, expenseDocumentDateStatus, civilDate } from '@watchdog-bms/contracts';
import { mergeExpenseUnsavedFields, expenseTaxEvidenceReasonMessage } from './expenses.model';

import { THAI_SYSTEM_ROLE_NAMES, ATTACHMENT_SOURCE_TYPES_LABEL } from '@watchdog-bms/contracts';

import { isExpenseEvidenceFile, expenseEvidenceAssessment, expenseEvidenceInputError, EXPENSE_RECEIPT_SOURCE_TYPES, type ExpenseEvidenceAssessment } from '@watchdog-bms/contracts';

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent, type DragEvent, type FormEvent, type MutableRefObject, type ReactNode } from 'react';
import Link from 'next/link';
import { CloseIcon } from '@/common/icons';
import type { CreateExpenseDraftInput } from '@watchdog-bms/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { readExpenseListState, expenseListUrl, expenseDetailUrl, scrollExpenseListRow } from './expense-list-navigation.logic';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { InfoTip } from '@/common/components/field/InfoTip';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { CoverLoader, EmptyState, ErrorState, LoadingState } from '@/common/components/state';
import { Pagination } from '@/common/components/data-table/Pagination';
import {
  getExpenseCaptureCapability,
  listExpenses, getExpense, initReceiptUpload, completeReceiptUpload,
  confirmExpense, rejectExpense, voidExpense, markExpenseReady, markExpenseReadyAsReviewer, recordExpensePayment, runDuplicateCheck, dismissDuplicate,
  uploadReceiptFile, updateExpenseDraft, listExpenseCategories, listExpenseWhtIncomeCategories,
  updateExpenseReviewFields, uploadExpenseEvidenceFile,
  createAccountingSoftwareExport, downloadAccountingSoftwareExport, createAccountantPackage, downloadIndexXlsx, requestExpenseExtraction, overrideNonExpenseClassification,
  createExpenseDraft, deleteExpense, confirmExpenseBuyerMatch,
} from './expenses.api';
import type { WhtIncomeCategoryOption } from './expenses.api';
import {
  EXPENSE_VAT_MODE_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, buildExpenseDraftReviewPayload,
  expenseSubstituteReceiptAction, deriveExpenseClassificationReviewState, hasAiGrandTotalMismatch, hasUnresolvedDuplicateWarning,
  allowsDomesticInputTaxCode, clearExpenseTaxSelections, expenseDocumentReviewFieldsComplete, hasCurrentExpenseDocumentReview,
  TAX_EVIDENCE_REASON_LABELS, AI_SUMMARY_STATUS_LABELS, AI_MISSING_FIELD_LABELS,
  ATTACHMENT_PURPOSE_LABELS, MIME_TYPE_LABELS, expenseSubstituteReceiptStatus, expenseValueLabel,
  deriveExpenseAuditChecks, deriveExpenseReviewSteps, initialExpenseReviewStep, expenseNeedsReceiptOrSubstitute, expenseCapabilities,
  calculateManualExpenseTotals, buildManualExpenseLines, canAccessExpenseTab, canDeleteExpense, canCancelExpenseInsteadOfDelete, expenseDeleteErrorMessage,
  expenseListStatus, expenseListMonth, expenseDeleteTargetLabel, firstFilled, isExpensePendingReview, expenseReimbursementProgressLabel, summarizeExpenseKpis,
  canExportExpenseList, isFreeExpenseListDraft, expenseUiPermissions,
  isBlockedCheckBillClassification, lateDocumentDays, EXPENSE_DATE_STATUS_LABELS, expenseClassificationConfirmBlocker,
  POSTING_STATUS_LABELS, aiGrandTotalValue, expenseAiFieldProvenance, expenseRatePercent, expenseDocumentWhtRate,
  vatRatePreset, vatRatePresetValue, vatTreatmentForPreset, expensePercentToRate, expenseRateToPercent,
  effectiveVatRateLabel, vatModeRequiresRate,
  PAYEE_ENTITY_KIND_LABELS, expenseWhtCategoryOptions, AI_SUGGESTION_FIELD_LABELS, applyExpenseAiSuggestion, expenseAiSuggestion, expenseAiCategorySuggestion,
  EXPENSE_LINE_CHARGE_KINDS, EXPENSE_LINE_CHARGE_KIND_LABELS,
  insertExpenseReviewLine, removeExpenseReviewLine, applyChargeKindChange, changeExpenseVatSourceType,
  formatTaxId, taxIdDigits, reviewValues, incompleteSourceReviewLine,
  expenseReviewWithholdsTax, changeExpenseReviewWhtInput, sanitizeExpenseWhtTyping, normalizeExpenseWhtValue, expenseWhtCategoriesForPayee, changeExpensePayeeType, expenseVatSourceValidationMessage, expenseVatBlockedWayOut } from './expenses.model';
export { reviewValues } from './expenses.model';
import type { AiReviewField, ExpenseAiSuggestion, ExpenseSummary, ExpenseDetail, ExpenseDraftReviewValues, ExpenseCategorySummary, ExpenseLineChargeKind, ExpenseReviewStepKey, ExpenseCapabilities, ExpensesTab, ManualExpenseItem } from './expenses.model';
import type { BusinessDocumentClassification, BuyerEntityKind, ExpenseCaptureCapabilityDto, ExpenseExtractionResult, ExpenseLineVatTreatment, ExpenseVatSourceOverrideInput, ExpenseWhtInput } from '@watchdog-bms/contracts';
import { useExpenseReviewTotals, type ExpenseReviewTotalsState } from './useExpenseReviewTotals';
import { AI_BUDGET_REFUSAL_CODES, EXPENSE_WITHHOLDING_WORDS, isCalculatedExpenseRounding, expenseVatReconciliationMessage, isBlockingExpenseVatReconciliation, isCheckBillClassification } from '@watchdog-bms/contracts';
import { counterpartyAutoSaveNotice, counterpartyHref } from '../counterparties/counterparties.logic';
import { COUNTERPARTY_READ_PERMISSION, type CounterpartyAutoSaveNotice } from '../counterparties/counterparties.model';
import { CategoryManagePanel, SignaturePanel, EvidencePanel, IconBtn } from './ExpensesWorkspacePanels';
import { ExpensePayeeField } from './ExpensePayeeField';
import { EvidenceBundleDownload } from './EvidenceBundleDownload';
import { ReceiptUploadResult } from './ReceiptUploadResult';
import { ManualExpenseEntryNotEnabled } from './ManualExpenseEntryNotEnabled';
import { manualEntryView, nextManualEntryAdmission } from './manual-expense-entry.logic';
import { useBranchFilter, useBranchScopeLabel } from '../web-core-workspace/WorkspaceScope';
import { TransactionBranchField, useTransactionCreateBranchId } from '../web-core-workspace/TransactionBranchField';
import { isBranchScope403 } from '../web-core-workspace/branch-scope-label.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale, DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { MangmeeBadge, MangmeeCard, MangmeePage, MetricGrid, cx } from '@/common/components/mangmee';
import { Modal, useConfirm } from '@/common/components/modal';
import { Notice } from '@/common/components/notice';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { quietButtonClass } from '@/common/components/button/button-classes';
import { UNSAVED_NAVIGATION_EVENT } from '@/common/components/unsaved-navigation/request-navigation';
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
  appendReceiptFiles, captureFileRejection, captureMegabytes, entryForFile, runSingleFileUploads,
  type CaptureUploadEntry, type CaptureUploadState,
} from './expense-capture-upload.logic';
import { captureReadJobNotice, freeAllowanceNotice } from './expense-capture-status.logic';
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
  err, baht, baht0, amountText, dateShort, inputClass, btnClass, ghostClass, dangerClass, successBtn, successBtnStyle,
  ICON, StatusBadge, TAX_TONE, ErrorBanner, InfoBanner, StateBanner,
  tapTargetClass, WholeWords, EXPORT_FOR_ACCOUNTANT,
} from './ExpensesUi';
import { generateSourceJournal } from '../ledger/ledger.api';
import { expenseReviewMessage, validateExpenseReview, type ExpenseFieldIssue } from './expense-review-validation';
import { isExpenseSourceDraftMissing } from './expense-source-draft.model';
import { useMenuFilterState } from '../web-core-workspace/MenuFilterScope';
import { hasRecordedTax, showsTaxCapture, useExpenseCapturePolicy } from './expense-capture-policy';

import { civilPeriodKey, todayCivilDate, isCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';
import { apiErrorCode } from '@/common/api/api-error-message';

// The upload copy promises "about 10–20 seconds"; past that the honest message is the queue one.
const QUEUE_BUSY_AFTER_MS = 8_000;

// ── month period control ─────────────────────────────────────────────
function periodRange(month: string): { fromDate: string; toDate: string } {
  const [y, m] = month.split('-').map((n) => parseInt(n, 10));
  const last = new Date(y!, m!, 0).getDate();
  return { fromDate: `${month}-01`, toDate: `${month}-${String(last).padStart(2, '0')}` };
}

function LateDocumentBadge({ expense, locale }: { expense: ExpenseSummary; locale: SupportedLocale }) {
  // Spec §5.2: "late" is document date vs upload date. When the document date IS the upload date's
  // placeholder the comparison measures nothing — it can only ever say "not late", which is a
  // reassurance about a date nobody read. Say what is actually wrong instead.
  const status = expense.dateStatus ?? 'verified';
  // No date read: the row already says ยังไม่ระบุ, and the owner wants no second label for it (2026-10-15).
  if (status === 'unverified') return null;
  if (status === 'implausible') {
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

export type ExtractionNotice = { tone: 'info' | 'error'; message: string; persistent?: boolean };

const EXPENSE_NOTICE_PREFIX = 'expenses.extractionNotice.';

export function InlineSpinner() {
  return <span aria-hidden="true" className="h-5 w-5 rounded-full border-2 border-current/25 border-t-current animate-spin" />;
}

function messageWithParams(message: string, params?: Record<string, string>): string {
  return Object.entries(params ?? {}).reduce((text, [key, value]) => text.replace(`{${key}}`, value), message);
}

/** Field labels and hints of this workspace's forms: 14 px, the size the standard asks for text a person must read. */
const FIELD_LABEL = 'mb-1 block text-sm font-medium text-gray-700';
const FIELD_HINT = 'mt-1 text-sm text-gray-500';
/** The answers of the "is there a receipt" questions, in the words the form and the read-only view share. */
const RECEIPT_PROBLEM_LABELS: Record<string, string> = { NOT_AVAILABLE: 'ไม่มีใบเสร็จ', LOST: 'ใบเสร็จหาย', MATERIAL_INCOMPLETE: 'มี แต่ข้อมูลสำคัญไม่ครบ' };
const EVIDENCE_ROUTE_LABELS: Record<string, string> = { SOURCE_DOCUMENT: 'ใบเสร็จที่แนบไว้', ALTERNATIVE_EVIDENCE: 'หลักฐานอื่นที่มี เช่น สลิป', SUBSTITUTE_RECEIPT: 'ทำใบรับรองแทนใบเสร็จ' };

/** A saved value read as a fact: its name, then the value (side by side from 640 px). Nothing is drawn for an empty value. */
function Fact({ label, children }: { label: ReactNode; children?: ReactNode }) {
  if (children == null || children === false || children === '') return null;
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-gray-900 sm:text-right">{children}</dd>
    </div>
  );
}

function fieldIssue(issues: ExpenseFieldIssue[], field: string): ExpenseFieldIssue | undefined {
  return issues.find((issue) => issue.field === field);
}

/** Problems that are said beside a field of the withholding block, in the block's own order. */
const WHT_ISSUE_FIELDS = ['vendorEntityKindSnapshot', 'whtCategoryCode', 'whtInput.inputType', 'whtInput.value', 'whtRate', 'whtInput.baseAmount'];

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

export function FieldIssueNote({ issue, canEdit }: { issue?: ExpenseFieldIssue; canEdit: boolean }) {
  const locale = useWorkspaceLocale();
  if (!issue) return null;
  return (
    <p className={cx('mt-1 text-xs', issue.severity === 'error' ? 'text-error-500' : 'text-warning-700')}>
      {expenseReviewMessage(issue.messageKey, locale, canEdit, issue.params)}
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

export function AiFieldMissingHint({ field, summary, canEdit }: { field: AiReviewField; summary: Record<string, unknown> | null; canEdit: boolean }) {
  const locale = useWorkspaceLocale();
  return expenseAiFieldProvenance(summary, field)?.missing
    ? <p className="mt-1 text-xs text-warning-700">{expenseReviewMessage('expenses.ai_field_missing', locale, canEdit)}</p>
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
  if (result.errorCode === 'FREE_MULTI_DOCUMENT_UNSUPPORTED') return { tone: 'info', message: t('expenses.free_multi_document_unsupported', locale) };
  if (result.status === 'ok') {
    const allowance = freeAllowanceNotice(result.freeAllowance, locale);
    if (allowance) return { tone: 'info', message: allowance, persistent: true };
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
export function UploadPanel({ companyId, branchId, canManagePlan, userId, caps, onSuccess, onBatchSuccess, freeExpenseDrafts = false }: { companyId: string; branchId?: string; canManagePlan: boolean; userId: string; caps: ExpenseCapabilities; onSuccess: (expenseId: string, notice: ExtractionNotice) => void; onBatchSuccess?: (created: Array<{ expenseId: string; notice: ExtractionNotice }>) => void; freeExpenseDrafts?: boolean }) {
  const locale = useWorkspaceLocale();
  const { confirm, confirmDialog } = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const fileFieldRef = useRef<HTMLDivElement>(null);
  const [validationAttempt, setValidationAttempt] = useState(0);
  const submitAttempted = validationAttempt > 0;
  // One file is one expense (A01), and so is each of several: picking three receipts runs today's
  // single-file path three times (appendix §25, owner decision 2026-09-19).
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [note, setNote] = useState('');
  const originals = useRef<File[]>([]);
  const notices = useRef(new Map<string, ExtractionNotice>());
  const leaveAllowed = useRef(false);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  // P10-L §15.1: the shop hit its monthly AI image-read ceiling. Latched with the month it happened
  // in, because the next image this month meets the same wall — but the ceiling resets on the 1st,
  // so a latch from last month must stop blocking without a reload.
  const [quotaLatch, setQuotaLatch] = useState<ReceiptQuotaLatch | null>(null);
  const stopBatchRef = useRef(false);
  /** The draft the refused read left behind, so the shop can still go and type it in. */
  const [blockedExpenseId, setBlockedExpenseId] = useState<string | null>(null);
  const [sentExpenseIds, setSentExpenseIds] = useState<string[]>([]);
  const uploadPending = useRef(false);
  const uploadAttempts = useRef(new Map<File, { intent: Awaited<ReturnType<typeof initReceiptUpload>>; step: 'upload' | 'complete' | 'extract' }>());
  const sendAfterPreparation = useRef(false);
  const senderOnly = !freeExpenseDrafts && !caps.canReview && !caps.canConfirm;
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
        ? messageWithParams(t('expenses.capture.upload_unsupported', locale), { types: ATTACHMENT_SOURCE_TYPES_LABEL })
        : t('expenses.upload_unsupported_file', locale);
    }
    if (rejection === 'too_large' && capability) {
      return messageWithParams(t('expenses.capture.upload_too_large', locale), {
        size: captureMegabytes(file.size), limit: captureMegabytes(capability.maxBytes),
      });
    }
    return null;
  };

  const selectFiles = async (picked: File[], fromCamera = false) => {
    if (loading || preparing || uploadPending.current) return;
    setFileNotice(null); setError(null); setValidationAttempt(0);
    const combined = appendReceiptFiles(originals.current, picked);
    const added = combined.filter(file => !originals.current.includes(file));
    if (!added.length) return;
    setPreparing(true);
    try {
      const prepared: File[] = [];
      for (const file of added) {
        const rejection = rejectFile(file);
        if (rejection) { setError(rejection); return; }
        const ready = await prepareReceiptFile(file);
        prepared.push(ready.file);
        // The resize note belongs to the one-file screen; a list of files shows its own sizes.
        if (picked.length === 1 && ready.resized) {
          setFileNotice(`${t('expenses.upload_resized', locale)} ${(ready.file.size / 1024 / 1024).toFixed(2)} เมกะไบต์`);
        }
      }
      originals.current = combined;
      const files = [...selectedFiles, ...prepared];
      setSelectedFiles(files);
      if (captureFiles.length) setCaptureFiles([...captureFiles, ...prepared.map(entryForFile)]);
      setPreparing(false);
      const sendNow = sendAfterPreparation.current || fromCamera && branchId && selectedFiles.length === 0;
      sendAfterPreparation.current = false;
      if (sendNow) await handleUpload(files);
    } catch (cause) {
      setError(cause instanceof HeicDecodeError ? t('expenses.upload_heic_unsupported', locale) : uploadErrorMessage(cause));
    } finally {
      sendAfterPreparation.current = false;
      setPreparing(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    void selectFiles(files);
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
    let attempt = uploadAttempts.current.get(file);
    if (attempt?.step === 'complete') {
      // A lost completion answer may already have bound the ACTIVE file. That endpoint cannot
      // complete an ACTIVE attachment again; read the same expense before retrying the command.
      const { expenseId, attachmentId } = attempt.intent;
      const saved = await getExpense(companyId, expenseId);
      if (saved.primaryAttachmentId === attachmentId
        && saved.attachments.some(attachment => attachment.id === attachmentId && attachment.status === 'ACTIVE')) attempt.step = 'extract';
    }
    if (!attempt) {
      const intent = await initReceiptUpload(companyId, { originalFileName: file.name, mimeType: file.type, byteSize: file.size, ...(branchId ? { branchId } : {}), note: note.trim() });
      attempt = { intent, step: 'upload' };
      uploadAttempts.current.set(file, attempt);
    }
    const { intent } = attempt;
    if (attempt.step === 'upload') {
      await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
      attempt.step = 'complete';
    }
    if (attempt.step === 'complete') {
      await completeReceiptUpload(companyId, intent.expenseId, intent.attachmentId, { byteSize: file.size });
      attempt.step = 'extract';
    }
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
      // the banner and its way out with it — the shop would land on an empty draft with
      // no idea why nothing was read, and could walk straight back and upload again.
      const code = apiErrorCode(e);
      if (freeExpenseDrafts && code === 'FREE_MULTI_DOCUMENT_UNSUPPORTED') {
        writeExpenseExtractionAttempt(availableExpenseSessionStorage(window), companyId, intent.expenseId, null);
        return { expenseId: intent.expenseId, notice: { tone: 'info', message: t('expenses.free_multi_document_unsupported', locale) } };
      }
      if (code === RECEIPT_QUOTA_ERROR_CODE || (freeExpenseDrafts && code === 'FREE_DOCUMENT_LIMIT_REACHED')) {
        writeExpenseExtractionAttempt(availableExpenseSessionStorage(window), companyId, intent.expenseId, null);
        if (freeExpenseDrafts) stopBatchRef.current = true;
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
  const handleBatchUpload = async (files = selectedFiles, retryIndex?: number) => {
    if (uploadPending.current || quotaBlocked) return;
    uploadPending.current = true;
    setLoading(true); setError(null); stopBatchRef.current = false;
    const entries = captureFiles.length > 0 ? captureFiles : files.map(entryForFile);
    setCaptureFiles(entries);
    try {
      const run = await runSingleFileUploads<ExtractionNotice | null>({
        entries: entries.map((entry, index) => ({ entry, file: files[index] ?? null })),
        retryIndex, onChange: setCaptureFiles, describeFailure: cause => err(cause, locale),
        shouldStop: () => stopBatchRef.current,
        upload: async file => {
          const done = await uploadOneFile(file);
          if (done.notice) notices.current.set(done.expenseId, done.notice);
          return { expenseId: done.expenseId, result: done.notice };
        },
      });
      // Stay beside failures; sent rows remain stored and never enter a retry again.
      if (run.entries.some(row => !row.expenseId || !notices.current.has(row.expenseId))) return;
      const created = run.entries.map(row => ({ expenseId: row.expenseId!, notice: notices.current.get(row.expenseId!)! }));
      leaveAllowed.current = true;
      if (senderOnly) setSentExpenseIds(created.map(row => row.expenseId));
      else if (created.length === 1) onSuccess(created[0]!.expenseId, created[0]!.notice);
      else onBatchSuccess?.(created);
    } catch (e) { setError(err(e)); }
    finally { uploadPending.current = false; setLoading(false); }
  };

  const handleUpload = async (files = selectedFiles) => {
    if (uploadPending.current) return;
    if (preparing) { sendAfterPreparation.current = true; return; }
    if (quotaBlocked) { focusExpenseField(document.querySelector<HTMLElement>('[data-upload-quota]')); return; }
    if (!branchId || files.length === 0) {
      setValidationAttempt(attempt => attempt + 1);
      return;
    }
    const forbidden = findForbiddenChars(note);
    if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
    await handleBatchUpload(files);
  };

  // Run after the inline error is in the DOM, including repeated presses on the same missing field.
  useEffect(() => {
    if (!validationAttempt) return;
    if (!selectedFiles.length) {
      const picker = fileFieldRef.current;
      const control = picker?.querySelector<HTMLElement>(window.matchMedia('(min-width: 640px)').matches ? '[data-upload-dropzone]' : '[capture]');
      focusExpenseField(picker, control);
    } else if (!branchId) {
      const field = document.querySelector<HTMLElement>('[data-transaction-branch-select]');
      focusExpenseField(field?.parentElement ?? field, field?.querySelector<HTMLElement>('[role="combobox"], select, input'));
    }
  }, [validationAttempt]);

  const hasUnsent = !sentExpenseIds.length && selectedFiles.some((_, index) => !captureFiles[index]?.expenseId);
  const askToLeave = async () => !hasUnsent || leaveAllowed.current || await confirm({
    title: 'ยังไม่ได้บันทึกสิ่งที่แก้', message: 'ออกจากหน้านี้ สิ่งที่แก้ไว้จะหายไป',
    confirmLabel: 'ออกโดยไม่บันทึก', cancelLabel: 'อยู่ต่อ', variant: 'danger',
  });
  useEffect(() => {
    if (!hasUnsent) return;
    const unload = (event: BeforeUnloadEvent) => { if (!leaveAllowed.current) { event.preventDefault(); event.returnValue = ''; } };
    const click = (event: MouseEvent) => {
      if (leaveAllowed.current || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.href === window.location.href) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void askToLeave().then(leave => { if (leave) { leaveAllowed.current = true; anchor.click(); } });
    };
    const original = window.history.state;
    if (original?.receiptUpload !== window.location.href) window.history.pushState({ ...original, receiptUpload: window.location.href }, '', window.location.href);
    let restoring = false;
    const back = (event: PopStateEvent) => {
      if (leaveAllowed.current) return;
      event.stopImmediatePropagation();
      if (restoring) { restoring = false; return; }
      restoring = true; window.history.forward();
      void askToLeave().then(leave => { if (leave) { leaveAllowed.current = true; window.history.go(-2); } });
    };
    const directNavigation = (event: Event) => {
      if (leaveAllowed.current) return;
      event.preventDefault();
      void askToLeave().then(leave => { if (leave) { leaveAllowed.current = true; (event as CustomEvent<() => void>).detail(); } });
    };
    window.addEventListener(UNSAVED_NAVIGATION_EVENT, directNavigation);
    window.addEventListener('beforeunload', unload); window.addEventListener('popstate', back, true);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener(UNSAVED_NAVIGATION_EVENT, directNavigation); window.removeEventListener('beforeunload', unload); window.removeEventListener('popstate', back, true); document.removeEventListener('click', click, true); };
  }, [hasUnsent, confirm]);

  /** Rows come from the machine once sending started; before that, from what the user just picked. */
  const captureRows: CaptureUploadEntry[] = captureFiles.length > 0
    ? captureFiles
    : selectedFiles.map(entryForFile);
  const uploadPhase = preparing
    ? t('expenses.upload_phase_preparing', locale)
    : extracting
      ? t(queueBusy ? 'expenses.upload_phase_queued' : 'expenses.upload_phase_extracting', locale)
      : loading ? t('expenses.upload_phase_uploading', locale) : null;
  const hasFiles = selectedFiles.length > 0 || captureRows.length > 0;
  const fileMissing = submitAttempted && !hasFiles && !preparing;
  /** Only unsent files can be removed; stored rows stay in the retry ledger. */
  const removeSelected = (index: number) => {
    const rest = selectedFiles.filter((_, at) => at !== index);
    setSelectedFiles(rest); setFileNotice(null);
    originals.current = originals.current.filter((_, at) => at !== index);
    if (captureFiles.length) setCaptureFiles(rows => rows.filter((_, at) => at !== index));
  };
  // A small image need not say 0.0 เมกะไบต์.
  const sizeText = (bytes: number) => bytes >= 104_858 ? captureMegabytes(bytes) : '';

  if (sentExpenseIds.length) return <ReceiptUploadResult companyId={companyId} expenseIds={sentExpenseIds} userId={userId} caps={caps} onSendAnother={() => {
    setSentExpenseIds([]); setSelectedFiles([]); setCaptureFiles([]); setFileNotice(null); setError(null); setNote(''); setValidationAttempt(0); originals.current = []; notices.current.clear(); uploadAttempts.current.clear(); leaveAllowed.current = false;
  }} />;

  return (
    <div className="space-y-4 [overflow-anchor:none]">
      <MangmeeCard className="p-4 sm:p-6">
        {quotaBlocked && (
          <div data-upload-quota role="alert" className="mb-4 rounded-xl border border-[#FECDCA] bg-error-50 px-4 py-3 text-sm text-error-700">
            <p className="font-medium">⚠ {quotaLatch!.message}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-semibold">
              {/* G18: the package page is where the quota is bought; staff without the permission
                  cannot buy, so they are told who can instead of being sent to a page that bounces. */}
              {canManagePlan
                ? <Link href={`/companies/${companyId}/billing`} className="inline-flex min-h-11 items-center underline">เปลี่ยนแพ็กเกจ</Link>
                : <span className="inline-flex min-h-11 items-center">แจ้ง{THAI_SYSTEM_ROLE_NAMES.OWNER}หรือผู้มีสิทธิ์จัดการแพ็กเกจให้เปลี่ยนแพ็กเกจ</span>}
              {blockedExpenseId && (
                <Link href={`/companies/${companyId}/expenses/${blockedExpenseId}`} className="inline-flex min-h-11 items-center underline">
                  กรอกใบเสร็จที่เพิ่งอัปโหลดเอง
                </Link>
              )}
            </div>
          </div>
        )}
        {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
        <div ref={fileFieldRef} data-receipt-upload-picker>
        <div className="space-y-3 sm:hidden">
          <ActionGroup className={hasFiles ? "!grid !grid-flow-col !auto-cols-fr" : "!grid !grid-cols-1"}>
            <label className={cx(ghostClass, 'w-full cursor-pointer')}>
              {hasFiles ? 'ถ่ายเพิ่ม' : t('expenses.upload_capture_cta', locale)}
              <input type="file" accept="image/*" capture="environment" className="sr-only" aria-invalid={fileMissing || undefined} aria-describedby={fileMissing ? 'receipt-upload-file-error' : undefined} disabled={loading || preparing} onChange={event => { const files = [...(event.target.files ?? [])]; event.target.value = ''; void selectFiles(files, true); }} />
            </label>
            <label className={cx(ghostClass, 'w-full cursor-pointer')}>
              {hasFiles ? 'เลือกเพิ่ม' : t('expenses.upload_pick_cta', locale)}
              <input type="file" accept={RECEIPT_UPLOAD_ACCEPT} multiple className="sr-only" aria-invalid={fileMissing || undefined} aria-describedby={fileMissing ? 'receipt-upload-file-error' : undefined} disabled={loading || preparing} onChange={handleFileChange} />
            </label>
          </ActionGroup>
          {!hasFiles && !preparing && <p className={FIELD_HINT}>{t('expenses.upload_capture_hint', locale)}</p>}
          {preparing && <p className="text-sm font-semibold text-brand-700">{t('expenses.upload_preparing', locale)}</p>}
        </div>

        <label data-upload-dropzone tabIndex={0} role="button" aria-label={t('expenses.upload_dropzone_title', locale)}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileRef.current?.click(); } }}
          className={cx(
            'hidden cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-9 text-center transition sm:flex',
            dragActive ? 'border-brand-500 bg-brand-50 shadow-[0_0_0_4px_rgba(52,211,153,0.14)]' : 'border-brand-300 bg-brand-25 hover:bg-brand-50',
          )}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
        >
          <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-brand-700 shadow-sm">{ICON.upload}</span>
          <div className="text-lg font-bold text-gray-800">{t('expenses.upload_dropzone_title', locale)}</div>
          <div className="text-sm text-gray-500"><WholeWords text="PDF หรือรูปภาพ" /></div>
          {preparing && <div className="text-sm font-semibold text-brand-700">{t('expenses.upload_preparing', locale)}</div>}
          <input ref={fileRef} type="file" accept={RECEIPT_UPLOAD_ACCEPT} multiple disabled={loading || preparing} className="hidden" aria-invalid={fileMissing || undefined} aria-describedby={fileMissing ? 'receipt-upload-file-error' : undefined} onChange={handleFileChange} />
        </label>
        {fileMissing && <p id="receipt-upload-file-error" role="alert" className="mt-1 text-sm text-error-700">เลือกรูปใบเสร็จก่อน</p>}
        </div>
        <p className={FIELD_HINT}>{t('expenses.capture.multi_hint', locale)}</p>
        {fileNotice && <div className="mt-3"><InfoBanner message={fileNotice} /></div>}
        {captureRows.length > 0 && (
          <div className="mt-4 space-y-2" data-capture-file-list>
            <p className="text-sm font-semibold text-gray-800">{t('expenses.capture.files_title', locale)}</p>
            <ul className="space-y-2">
              {captureRows.map((row, index) => (
                <li key={`${row.name}:${index}`} className="flex items-center gap-3 border-b border-gray-100 py-2">
                  <ReceiptUploadThumbnail file={selectedFiles[index]} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 [overflow-wrap:anywhere]">{row.name}</p>
                    <p className="min-h-5 text-sm text-gray-500">
                      {sizeText(row.size)}{sizeText(row.size) && row.state !== 'PENDING' ? ' · ' : ''}{row.state !== 'PENDING' && (row.state === 'UPLOADING' && extracting ? uploadPhase : t(CAPTURE_STATE_LABELS[row.state], locale))}
                      {row.error && <span className="block text-error-700">{row.error}</span>}
                    </p>
                    {row.state === 'FAILED' && (
                      <button type="button" className={cx(ghostClass, 'mt-2')} disabled={loading} aria-busy={loading} onClick={() => void handleBatchUpload(selectedFiles, index)}>
                        {t('expenses.capture.retry_file', locale)}
                      </button>
                    )}
                  </div>
                  {!row.expenseId && (
                    <button type="button" aria-label={`เอาออก ${row.name}`} disabled={loading} aria-busy={loading} className={cx(quietButtonClass, '!min-h-11 !min-w-11 !p-2')} onClick={() => removeSelected(index)}><span aria-hidden="true">×</span></button>
                  )}

                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-4">
          <TransactionBranchField fill value={branchId ?? ''} invalid={!branchId && submitAttempted} helpText={!branchId && submitAttempted ? 'เลือกสาขาก่อนส่ง' : null} />
        </div>
        <div className="mt-4">
          <label className={FIELD_LABEL} htmlFor="receipt-upload-note">{t('expenses.upload_note', locale)}</label>
          <input id="receipt-upload-note" className={inputClass} placeholder={t('expenses.upload_note_placeholder', locale)} value={note} onChange={(e) => setNote(stripDisallowed(e.target.value))} />
        </div>
      </MangmeeCard>
      <FormActionBar><ActionGroup>
        <button type="button" className={btnClass} onClick={() => void handleUpload()} disabled={loading} aria-busy={loading} data-loading-indicator>
          {extracting ? t('expenses.ai_reading', locale) : loading ? t('expenses.uploading', locale) : `${t('expenses.upload_cta', locale)}${captureRows.length ? ` ${captureRows.length} ใบ` : ''}`}
        </button>
      </ActionGroup></FormActionBar>
      {uploadPhase && <p role="status" aria-live="polite" className="text-sm font-semibold text-brand-700 sm:text-right">{uploadPhase}</p>}
      {confirmDialog}
    </div>
  );
}
function ReceiptUploadThumbnail({ file }: { file?: File }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file?.type.startsWith('image/')) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-50 text-gray-500" aria-hidden="true">
    {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-6 w-6"><path d="M6 2h8l4 4v16H6zM14 2v5h4M9 12h6M9 16h6" /></svg>}
  </span>;
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

export function DocumentReviewSection({ companyId, detail, isMutable, canReview, onSaved, onAttachPrimaryReceipt, receiptUploading = false, onDirtyChange, showSubstituteAction = true, substituteReceiptFlow = false, saveRef, fixAction, canAnswerVatStatus = false, canEditShopIdentity = false, canReadTaxPeriods = false, documentDetails }: {
  documentDetails?: ReactNode;
  companyId: string; detail: ExpenseDetail; isMutable: boolean; canReview: boolean; onSaved: () => Promise<void>; onAttachPrimaryReceipt?: (file: File) => Promise<void>; receiptUploading?: boolean; onDirtyChange?: (dirty: boolean) => void; showSubstituteAction?: boolean;
  fixAction?: (key: string) => ReactNode;
  canAnswerVatStatus?: boolean; canEditShopIdentity?: boolean; canReadTaxPeriods?: boolean;
  /** Only for the certificate wizard that embeds this card: the receipt questions start open on "no receipt, make a certificate" while nothing is saved, the certificate is not offered as a document type, and a lone line category is shown as the category. Screen only; nothing is saved until the save button. */
  substituteReceiptFlow?: boolean;
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const vatSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [vatDirty, setVatDirty] = useState(false);
  const [docType, setDocType] = useState(detail.sourceDocumentType);
  const [taxStatus, setTaxStatus] = useState(detail.taxEvidenceStatus);
  const [categoryId, setCategoryId] = useState<string>(detail.expenseCategoryId ?? '');
  const [categories, setCategories] = useState<ExpenseCategorySummary[]>([]);
  const [classificationOverrideReason, setClassificationOverrideReason] = useState('');
  const [validationShown, setValidationShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const assertAllowed = (...values: string[]) => {
    const forbidden = findForbiddenChars(values.join(''));
    if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
  };

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
          setError('บันทึกแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ เปิดหน้านี้ใหม่');
          return;
        }
      }
      if (inline) setInfo(doneText); else toast.success(doneText);
    } catch (e) { setError(err(e, locale)); } finally { setBusy(false); }
  };
  // A saved answer always wins. With none saved, the screen starts from the document type; in the
  // certificate wizard it starts from what that wizard is for: no receipt, a certificate instead.
  const defaultAssessment = (source: ExpenseDetail): ExpenseEvidenceAssessment => expenseEvidenceAssessment(source) ?? {
    route: substituteReceiptFlow ? 'SUBSTITUTE_RECEIPT' : EXPENSE_RECEIPT_SOURCE_TYPES.some(type => type === source.sourceDocumentType) || source.sourceDocumentType === 'NEEDS_REVIEW' ? 'SOURCE_DOCUMENT' : 'ALTERNATIVE_EVIDENCE',
    receiptProblem: substituteReceiptFlow ? 'NOT_AVAILABLE' : EXPENSE_RECEIPT_SOURCE_TYPES.some(type => type === source.sourceDocumentType) || source.sourceDocumentType === 'NEEDS_REVIEW' ? 'NONE' : 'NOT_AVAILABLE',
    attachmentIds: source.attachments.filter(file => isExpenseEvidenceFile(file) && file.id === source.primaryAttachmentId).map(file => file.id), reason: '',
  };
  const [assessment, setAssessment] = useState<ExpenseEvidenceAssessment>(() => defaultAssessment(detail));
  const [showEvidenceOptions, setShowEvidenceOptions] = useState(() => substituteReceiptFlow || defaultAssessment(detail).receiptProblem !== 'NONE');
  const persistedAssessment = JSON.stringify(defaultAssessment(detail));
  const [taxAnswerTouched, setTaxAnswerTouched] = useState(false);
  const documentSnapshot = useRef({ id: detail.id, docType: detail.sourceDocumentType, taxStatus: detail.taxEvidenceStatus, categoryId: detail.expenseCategoryId ?? '', assessment: defaultAssessment(detail) });
  useEffect(() => {
    const incoming = { id: detail.id, docType: detail.sourceDocumentType, taxStatus: detail.taxEvidenceStatus, categoryId: detail.expenseCategoryId ?? '', assessment: JSON.parse(persistedAssessment) as ExpenseEvidenceAssessment };
    const previous = documentSnapshot.current;
    const keepInput = previous.id === detail.id && isMutable;
    if (!keepInput) setTaxAnswerTouched(false);
    const next = keepInput ? mergeExpenseUnsavedFields(previous, incoming, { id: detail.id, docType, taxStatus, categoryId, assessment }) : incoming;
    const nextAssessment = keepInput ? mergeExpenseUnsavedFields(previous.assessment, incoming.assessment, assessment) : incoming.assessment;
    setDocType(next.docType); setTaxStatus(next.taxStatus); setCategoryId(next.categoryId);
    setAssessment({ ...nextAssessment, attachmentIds: nextAssessment.attachmentIds.filter(id => detail.attachments.some(file => file.id === id && isExpenseEvidenceFile(file))) });
    documentSnapshot.current = incoming;
  }, [detail.id, detail.updatedAt, detail.primaryAttachmentId, detail.extractionId, detail.sourceDocumentType, detail.taxEvidenceStatus, detail.expenseCategoryId, persistedAssessment, isMutable]);
  const dirty = docType !== detail.sourceDocumentType || taxStatus !== detail.taxEvidenceStatus || categoryId !== (detail.expenseCategoryId ?? '')
    || JSON.stringify(assessment) !== persistedAssessment;
  useEffect(() => {
    if (!dirty || !isMutable || !canReview) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, isMutable, canReview]);
  const reviewSaved = hasCurrentExpenseDocumentReview(detail);
  const noDocument = !substituteReceiptFlow && (assessment.receiptProblem === 'NOT_AVAILABLE' || assessment.receiptProblem === 'LOST');
  const reviewDocType = noDocument ? 'EXPENSE_NOTE_TEXT' : docType;
  const reviewTaxStatus = noDocument ? 'SUPPORTING_ONLY' : taxStatus;
  const assessmentError = expenseEvidenceInputError(assessment, { ...detail, sourceDocumentType: reviewDocType, taxEvidenceStatus: reviewTaxStatus,
    inputVatClaimStatus: assessment.route !== 'SOURCE_DOCUMENT' ? 'NON_CLAIMABLE' : detail.inputVatClaimStatus }, true);
  const reviewComplete = expenseDocumentReviewFieldsComplete({ sourceDocumentType: reviewDocType, taxEvidenceStatus: reviewTaxStatus }) && !assessmentError;
  const taxEvidenceReason = expenseTaxEvidenceReasonMessage(detail.taxEvidenceReasonCode);
  const receiptActionRequired = Boolean(assessmentError && assessment.route === 'SOURCE_DOCUMENT' && !assessment.attachmentIds.length);
  const [evidenceFocus, setEvidenceFocus] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (!evidenceFocus) return;
    const target = document.getElementById(evidenceFocus.id);
    if (target) { focusExpenseField(target); setEvidenceFocus(null); }
  }, [evidenceFocus, showEvidenceOptions, validationShown]);
  const openEvidenceOptions = () => {
    setShowEvidenceOptions(true);
    setEvidenceFocus({ id: `expense-receipt-question-${detail.id}` });
  };
  const canStartSubstitute = isMutable && canReview && reviewSaved && assessment.route === 'SUBSTITUTE_RECEIPT' && !dirty && !busy && !receiptUploading;
  const documentFieldsRef = useRef<HTMLDivElement>(null);
  const openDocumentReview = () => {
    const fields = documentFieldsRef.current;
    const section = fields?.closest('details');
    if (section) section.open = true;
    focusExpenseField(fields?.querySelector<HTMLElement>('[role="combobox"]') ?? fields);
  };
  const aiCategorySuggestion = expenseAiCategorySuggestion(detail.aiVerificationSummaryJson);
  // The parent retains unsaved state when leaving for the separate certificate journey.
  useEffect(() => {
    onDirtyChange?.(isMutable && canReview && (dirty || vatDirty || busy));
  }, [onDirtyChange, isMutable, canReview, dirty, vatDirty, busy]);
  const classificationReviewState = deriveExpenseClassificationReviewState(detail.aiVerificationSummaryJson, canReview);
  const classificationBlocked = classificationReviewState.blocked;
  const checkBillBlocked = isBlockedCheckBillClassification(detail.aiVerificationSummaryJson);
  const classificationConfirmBlocker = expenseClassificationConfirmBlocker({ sourceDocumentType: docType, reason: classificationOverrideReason });
  const canResolveClassification = classificationReviewState.showFinanceOverride && classificationConfirmBlocker === null;
  const saveDocumentReview = (next?: { docType: ExpenseDetail['sourceDocumentType']; taxStatus: ExpenseDetail['taxEvidenceStatus'] }, acknowledge = true) => {
    const nextDocType = next?.docType ?? reviewDocType;
    const nextTaxStatus = next?.taxStatus ?? reviewTaxStatus;
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
      expenseCategoryId: categoryId || null,
    }).then(result => {
      documentSnapshot.current = { id: detail.id, docType: nextDocType, taxStatus: nextTaxStatus, categoryId, assessment };
      return result;
    });
  };
  const saveDocumentAndRight = async () => {
    await saveDocumentReview();
    const saved = await vatSaveRef.current?.() ?? true;
    await onSaved();
    return saved;
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
  const editable = isMutable && canReview;
  const evidenceFiles = detail.attachments.filter(file => isExpenseEvidenceFile(file));
  // The evidence hint describes the documents available, without deciding the input VAT right.
  const showTaxEvidenceHint = docType !== 'NEEDS_REVIEW' && docType !== 'TAX_INVOICE' && docType !== 'ABBREVIATED_TAX_INVOICE';
  const fieldsChosen = expenseDocumentReviewFieldsComplete({ sourceDocumentType: reviewDocType, taxEvidenceStatus: reviewTaxStatus });
  const otherEvidenceMissing = assessment.receiptProblem !== 'NONE' && assessment.route === 'ALTERNATIVE_EVIDENCE'
    && (!assessment.attachmentIds.length || !assessment.reason.trim());
  // What still blocks the save, said before the button it blocks and in the words of this card's own labels.
  const reviewBlocker = !fieldsChosen ? t('expenses.doc_review_choose_required', locale)
    : receiptActionRequired ? 'ยังไม่มีใบเสร็จ แนบไฟล์ หรือบอกว่าไม่มีใบเสร็จ'
      : otherEvidenceMissing ? 'แนบหลักฐานที่มี แล้วบอกเหตุผล'
        : assessmentError;
  useEffect(() => {
    if (!saveRef) return;
    saveRef.current = editable && detail.substituteReceiptEvidence?.status !== 'ISSUED' ? async () => {
      setValidationShown(true);
      if (!reviewComplete) {
        setShowEvidenceOptions(true);
        setEvidenceFocus({ id: docType === 'NEEDS_REVIEW' && !noDocument ? `expense-doc-type-${detail.id}`
          : taxStatus === 'NEEDS_REVIEW' && !noDocument ? `expense-tax-evidence-${detail.id}`
            : !assessment.attachmentIds.length ? `expense-evidence-files-${detail.id}` : `expense-evidence-reason-${detail.id}` });
        return false;
      }
      setBusy(true); setError(null);
      try {
        return await saveDocumentAndRight();
      } catch (cause) {
        setError(err(cause, locale));
        return false;
      } finally { setBusy(false); }
    } : null;
    return () => { saveRef.current = null; };
  });
  const attachFileButton = (label: string) => onAttachPrimaryReceipt && (
    <label className={cx(ghostClass, 'relative cursor-pointer')}>
      {receiptUploading ? t('expenses.uploading', locale) : label}
      <input type="file" aria-label={label} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" accept={RECEIPT_UPLOAD_ACCEPT} disabled={receiptUploading} onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (file) void onAttachPrimaryReceipt(file);
      }} />
    </label>
  );
  const categoryName = categories.find((category) => category.id === categoryId)?.name;
  // An expense with no category of its own and one category across all its lines
  // shows that one in the category box. It is shown, never written: the box's value stays empty.
  const lineCategoryIds = !detail.expenseCategoryId && !categoryId && detail.lines.every(line => line.expenseCategoryId)
    ? [...new Set(detail.lines.map(line => line.expenseCategoryId).filter(Boolean))] : [];
  const lineCategoryName = lineCategoryIds.length === 1 ? categories.find((category) => category.id === lineCategoryIds[0])?.name : undefined;

  return (
    <MangmeeCard className="space-y-3 p-4 text-sm">
      <h3 className="font-semibold text-gray-800">{documentDetails ? 'รายละเอียดเอกสาร' : t('expenses.doc_review_title', locale)}</h3>
      {documentDetails}
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
              <div className={FIELD_LABEL}>{t('expenses.non_expense_override_reason', locale)}</div>
              <textarea className={inputClass} rows={2} maxLength={500} value={classificationOverrideReason} onChange={(e) => setClassificationOverrideReason(stripDisallowed(e.target.value))} placeholder={t('expenses.non_expense_override_reason_placeholder', locale)} />
              <button className={cx(btnClass, 'mt-2')} disabled={busy || !canResolveClassification} aria-busy={Boolean(busy)} onClick={() => run(overrideClassification, 'ยืนยันการจัดประเภทรายการแล้ว')}>{t('expenses.non_expense_override_action', locale)}</button>
              {classificationConfirmBlocker && <p className="mt-1 text-sm font-medium text-warning-700">{t(classificationConfirmBlocker, locale)}</p>}
            </div>
          </details>
        ) : (
          <div>
            <div className={FIELD_LABEL}>{t('expenses.non_expense_override_reason', locale)}</div>
            <textarea className={inputClass} rows={2} maxLength={500} value={classificationOverrideReason} onChange={(e) => setClassificationOverrideReason(stripDisallowed(e.target.value))} placeholder={t('expenses.non_expense_override_reason_placeholder', locale)} />
          </div>
        )
      )}
      {!editable ? (
        // A person who cannot change these answers reads them as facts: no boxes that look open, no
        // hints for typing, nothing drawn for an answer that was never given.
        <div className="space-y-2" data-document-review-facts>
          {isMutable && !noDocument && <p className="text-sm text-gray-600">ผู้ตรวจจะเลือกประเภทเอกสารให้ กด “ถัดไป” ได้เลย</p>}
          <dl className="divide-y divide-gray-100">
            {!noDocument && <Fact label={t('expenses.doc_type', locale)}>{docType === 'NEEDS_REVIEW' ? (isMutable ? null : 'ยังไม่ได้เลือก') : expenseValueLabel(SOURCE_DOCUMENT_TYPE_LABELS, docType)}</Fact>}
            <Fact label="หลักฐานรายจ่าย">{!documentDetails && reviewTaxStatus === 'NEEDS_REVIEW' ? null : expenseValueLabel(TAX_EVIDENCE_STATUS_LABELS, reviewTaxStatus)}</Fact>
          </dl>
          {showInputVatQuestion(detail) && <ExpenseInputVatRight companyId={companyId} detail={detail} showLabel={false} canReview={!isMutable && canReview} onSaved={onSaved} fixAction={fixAction} canAnswerVatStatus={canAnswerVatStatus} canEditShopIdentity={canEditShopIdentity} canReadTaxPeriods={canReadTaxPeriods}
            renderReadOnly={content => <dl><Fact label="สิทธิภาษีซื้อ">{content}</Fact></dl>} />}
          <dl className="divide-y divide-gray-100">
            <Fact label={t('expenses.category', locale)}>{categoryName ?? lineCategoryName}</Fact>
            <Fact label="ใบเสร็จ">{assessment.receiptProblem === 'NONE' ? null : RECEIPT_PROBLEM_LABELS[assessment.receiptProblem]}</Fact>
            <Fact label="ใช้แทนใบเสร็จ">{assessment.receiptProblem === 'NONE' ? null : EVIDENCE_ROUTE_LABELS[assessment.route]}</Fact>
            <Fact label="เหตุผล">{assessment.receiptProblem === 'NONE' ? null : assessment.reason.trim()}</Fact>
            <Fact label="หมายเหตุ">{assessment.note?.trim()}</Fact>
            {!documentDetails && <Fact label="ไฟล์ที่ใช้ประกอบรายการ">{evidenceFiles.filter(file => assessment.attachmentIds.includes(file.id)).map(file => file.originalFileName).join(', ')}</Fact>}

          </dl>
        </div>
      ) : (
      <DocumentReviewContainer className={checkBillBlocked ? 'rounded-xl border border-gray-200 bg-white p-3' : undefined}>
        {checkBillBlocked && (
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-gray-700">
            {t('expenses.check_bill_accounting_details', locale)}
          </summary>
        )}
        <div className={checkBillBlocked ? 'mt-3 space-y-3 border-t border-gray-100 pt-3' : 'space-y-3'}>
        <div ref={documentFieldsRef} className="grid scroll-mt-24 grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] items-start gap-3">
        {!noDocument && <div>
          <div className="mb-1 flex min-h-6 items-start gap-1.5 whitespace-nowrap text-sm font-medium text-gray-700">
            {t('expenses.doc_type', locale)}
          </div>
          <ThemedSelect aria-label={t('expenses.doc_type', locale)} wrapLabel id={`expense-doc-type-${detail.id}`} placeholder={t('expenses.document_type_choose', locale)} className={inputClass} value={docType} aria-invalid={validationShown && docType === 'NEEDS_REVIEW' || undefined} onChange={(e) => { const type = e.target.value as ExpenseDetail['sourceDocumentType']; setDocType(type); if (!taxAnswerTouched && taxStatus === 'NEEDS_REVIEW' && !detail.taxEvidenceReasonCode) setTaxStatus(type === 'TAX_INVOICE' ? 'USABLE_FOR_TAX' : 'SUPPORTING_ONLY'); }} disabled={busy}>
            {/* In the certificate wizard the certificate itself is not a type to pick: before one exists it only blocks the wizard. A record already saved with it still shows it. */}
            {Object.entries(SOURCE_DOCUMENT_TYPE_LABELS).filter(([k]) => k !== 'NEEDS_REVIEW' && (!substituteReceiptFlow || k !== 'SUBSTITUTE_RECEIPT' || docType === k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </ThemedSelect>
          {docType === 'TAX_INVOICE' && (docType !== detail.sourceDocumentType || detail.inputVatClaimStatus === 'NEEDS_REVIEW') && Number(detail.vatAmount) > 0 && detail.inputVatRight?.vatStatus !== 'NOT_REGISTERED' && <p className="mt-1 text-sm text-gray-600">มีใบกำกับภาษีเต็มรูป — รอตรวจสอบสิทธิภาษีซื้อ</p>}
          {validationShown && docType === 'NEEDS_REVIEW' && <p role="alert" className="mt-1 text-sm text-error-700">เลือกประเภทเอกสาร</p>}
        </div>}
        {!noDocument && <div>
          <div className={cx(FIELD_LABEL, 'min-h-6 whitespace-nowrap')}>{t('expenses.tax_evidence_status', locale)}</div>
          <ThemedSelect aria-label={t('expenses.tax_evidence_status', locale)} wrapLabel id={`expense-tax-evidence-${detail.id}`} className={inputClass} value={taxStatus} aria-invalid={validationShown && taxStatus === 'NEEDS_REVIEW' || undefined} onChange={(e) => { setTaxAnswerTouched(true); setTaxStatus(e.target.value as ExpenseDetail['taxEvidenceStatus']); }} disabled={busy} aria-describedby={showTaxEvidenceHint ? `expense-tax-evidence-hint-${detail.id}` : undefined}>
            {Object.entries(TAX_EVIDENCE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </ThemedSelect>
          {validationShown && taxStatus === 'NEEDS_REVIEW' && <p role="alert" className="mt-1 text-sm text-error-700">{t('expenses.tax_evidence_status', locale)}: เลือกคำตอบ</p>}
          {showTaxEvidenceHint && <p id={`expense-tax-evidence-hint-${detail.id}`} className="mt-1 text-sm text-gray-500 [text-wrap:pretty]">{t('expenses.tax_evidence_status_hint', locale)}</p>}
          {taxEvidenceReason && <p className="mt-1 text-sm text-gray-500">{t('expenses.reason_label', locale)}: {taxEvidenceReason}</p>}
        </div>}
        <div className="col-span-full">{docType !== detail.sourceDocumentType && !noDocument && Number(detail.vatAmount) > 0 && detail.inputVatRight?.vatStatus !== 'NOT_REGISTERED'
          ? <p className="text-sm text-gray-600">กด “ถัดไป” เพื่อบันทึกประเภทเอกสาร แล้วดูสิทธิภาษีซื้อที่ระบบตอบ</p>
          : <ExpenseInputVatRight companyId={companyId} detail={detail} canReview={canReview} saveRef={vatSaveRef} fixAction={key => key === 'receipt' ? attachFileButton('แนบเอกสาร') : fixAction?.(key)} canAnswerVatStatus={canAnswerVatStatus} canEditShopIdentity={canEditShopIdentity} canReadTaxPeriods={canReadTaxPeriods} onDirtyChange={setVatDirty} />}</div>
        <div>
          <div className={cx(FIELD_LABEL, 'min-h-6 whitespace-nowrap')}>
            <AiFieldLabel label={t('expenses.category', locale)} field="category" summary={detail.aiVerificationSummaryJson} />
          </div>
          <ThemedSelect aria-label={t('expenses.category', locale)} className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={busy}>
            <option value="">{lineCategoryName ? `${lineCategoryName} (ตามรายการ)` : t('expenses.category_unspecified', locale)}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </ThemedSelect>
          {/* Spec S1-R4: an auto-filled category arrives pre-selected in the box above; a suggestion
              the server refused to write is offered here instead, and only a tap applies it. Only
              `categoryId` moves, so nothing else the reviewer typed is touched. */}
          {aiCategorySuggestion && aiCategorySuggestion.expenseCategoryId !== categoryId && (
            <button
              type="button"
              className={cx(ghostClass, 'mt-1.5 w-full justify-start text-left')}
              disabled={busy}
              onClick={() => setCategoryId(aiCategorySuggestion.expenseCategoryId)}
            >
              {t('expenses.category_ai_suggested', locale)}: {aiCategorySuggestion.categoryName} · {t('expenses.category_ai_suggested_apply', locale)}
            </button>
          )}
          <AiFieldMissingHint canEdit={isMutable && canReview} field="category" summary={detail.aiVerificationSummaryJson} />
        </div>
      </div>
      {assessment.route === 'SOURCE_DOCUMENT' && assessment.receiptProblem === 'NONE' && editable && <div className="space-y-2">
        {assessment.attachmentIds.length === 0 && <>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" aria-label="มีตัวจริง ยังไม่ได้แนบรูป" aria-describedby={`expense-original-document-hint-${detail.id}`} disabled={busy}
            checked={assessment.originalDocumentAvailable ?? false} onChange={event => setAssessment(value => ({ ...value, originalDocumentAvailable: event.target.checked }))} />
          มีตัวจริง ยังไม่ได้แนบรูป
        </label>
        <p id={`expense-original-document-hint-${detail.id}`} className="text-sm text-gray-600">เลือกเมื่อมีเอกสารตัวจริงแต่ยังไม่ได้ถ่ายรูป แนบรูปทีหลังได้</p>
        </>}
        <TextareaField label="หมายเหตุ" aria-label="หมายเหตุ" rows={2} maxLength={500} disabled={busy}
          value={assessment.note ?? ''} onChange={event => setAssessment(value => ({ ...value, note: event.target.value }))} />
      </div>}
      <div className="space-y-3">
        {/* One door to "there is no receipt, or it has a problem". It stays in one place whatever the state. */}
        <button type="button" className={ghostClass} aria-expanded={showEvidenceOptions} onClick={() => (showEvidenceOptions ? setShowEvidenceOptions(false) : openEvidenceOptions())}>{showEvidenceOptions ? 'ซ่อนคำถามเรื่องใบเสร็จ' : 'ไม่มีใบเสร็จ หรือใบเสร็จมีปัญหา'}</button>
        {showEvidenceOptions && <div id={`expense-evidence-options-${detail.id}`} tabIndex={-1} className="scroll-mt-24 space-y-3 rounded-xl border border-gray-200 p-3">
          <label className="block"><span className={FIELD_LABEL}>มีใบเสร็จของรายการนี้ไหม</span>
            <ThemedSelect id={`expense-receipt-question-${detail.id}`} className={inputClass} aria-label="มีใบเสร็จของรายการนี้ไหม" disabled={busy} value={assessment.receiptProblem} onChange={event => {
              const receiptProblem = event.target.value as ExpenseEvidenceAssessment['receiptProblem'];
              setAssessment(value => ({ ...value, originalDocumentAvailable: false, receiptProblem, route: receiptProblem === 'NONE' ? 'SOURCE_DOCUMENT' : 'ALTERNATIVE_EVIDENCE' }));
              if (!substituteReceiptFlow && (receiptProblem === 'NOT_AVAILABLE' || receiptProblem === 'LOST')) {
                setDocType('EXPENSE_NOTE_TEXT'); setTaxStatus('SUPPORTING_ONLY');
              } else if (!substituteReceiptFlow && receiptProblem === 'NONE' && noDocument) {
                setDocType('NEEDS_REVIEW'); setTaxStatus('NEEDS_REVIEW');
              } else if (receiptProblem !== 'NONE') setTaxStatus('SUPPORTING_ONLY');
            }}>
              <option value="NONE">มี</option><option value="NOT_AVAILABLE">{RECEIPT_PROBLEM_LABELS.NOT_AVAILABLE}</option>
              <option value="LOST">{RECEIPT_PROBLEM_LABELS.LOST}</option><option value="MATERIAL_INCOMPLETE">{RECEIPT_PROBLEM_LABELS.MATERIAL_INCOMPLETE}</option>
            </ThemedSelect>
          </label>
          {assessment.receiptProblem === 'LOST' && <p className="text-sm text-gray-600">ขอสำเนาหรือเอกสารแทนจากผู้ขายได้ ระหว่างรอบันทึกร่างไว้ก่อนได้</p>}
          {assessment.receiptProblem === 'MATERIAL_INCOMPLETE' && <p className="text-sm text-gray-600">ถ้าเพียงรูปไม่ชัด ให้เปลี่ยนไฟล์หรืออ่านเอกสารอีกครั้งก่อน</p>}
          {assessment.receiptProblem !== 'NONE' && <label className="block"><span className={FIELD_LABEL}>จะใช้อะไรแทน</span>
            <ThemedSelect className={inputClass} aria-label="จะใช้อะไรแทน" disabled={busy} value={assessment.route} onChange={event => setAssessment(value => ({ ...value, route: event.target.value as ExpenseEvidenceAssessment['route'] }))}>
              <option value="ALTERNATIVE_EVIDENCE">{EVIDENCE_ROUTE_LABELS.ALTERNATIVE_EVIDENCE}</option><option value="SUBSTITUTE_RECEIPT">{EVIDENCE_ROUTE_LABELS.SUBSTITUTE_RECEIPT}</option>
            </ThemedSelect>
          </label>}
          {assessment.attachmentIds.some(id => !detail.attachments.some(file => file.id === id && isExpenseEvidenceFile(file))) && (
            <Notice tone="warning" action={<button type="button" className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => setAssessment(value => ({ ...value, attachmentIds: value.attachmentIds.filter(id => detail.attachments.some(file => file.id === id && isExpenseEvidenceFile(file))) }))}>เอาไฟล์ที่ใช้ไม่ได้ออก</button>}>
              ไฟล์ที่เคยเลือกบางไฟล์ใช้ไม่ได้แล้ว เลือกไฟล์ใหม่
            </Notice>
          )}
          <fieldset id={`expense-evidence-files-${detail.id}`} aria-invalid={validationShown && !assessment.attachmentIds.length && assessment.route !== 'SUBSTITUTE_RECEIPT' && !assessment.originalDocumentAvailable || undefined} aria-describedby={`expense-evidence-files-error-${detail.id}`} disabled={busy} className="space-y-1"><legend className={FIELD_LABEL}>ไฟล์ที่ใช้ประกอบรายการ</legend>
            {evidenceFiles.map(file => <label key={file.id} className="flex min-h-11 items-center gap-2 [overflow-wrap:anywhere]">
              <input type="checkbox" aria-label={file.originalFileName} checked={assessment.attachmentIds.includes(file.id)} onChange={event => setAssessment(value => ({ ...value, attachmentIds: event.target.checked ? [...value.attachmentIds, file.id] : value.attachmentIds.filter(id => id !== file.id) }))} />{file.originalFileName}
            </label>)}
            {/* A statement keeps its button on the same row: with no file to tick, the way to add one is here.
                While the receipt statement below already carries the attach button, it is not drawn twice. */}
            {evidenceFiles.length === 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-600">{detail.attachments.length ? 'เอกสารที่ระบบออกดูได้จากรายการเอกสารแนบ' : 'ยังไม่มีไฟล์'}</p>
                {attachFileButton('แนบไฟล์')}
              </div>
            )}
          {validationShown && !assessment.attachmentIds.length && assessment.route !== 'SUBSTITUTE_RECEIPT' && !assessment.originalDocumentAvailable && <p id={`expense-evidence-files-error-${detail.id}`} role="alert" className="text-sm text-error-700">เลือกไฟล์ที่ใช้ประกอบรายการ</p>}
          </fieldset>
          {assessment.receiptProblem !== 'NONE' && <label className="block"><span className={FIELD_LABEL}>เหตุผลที่ใช้หลักฐานนี้</span>
            <textarea id={`expense-evidence-reason-${detail.id}`} aria-invalid={validationShown && assessment.route === 'ALTERNATIVE_EVIDENCE' && !assessment.reason.trim() || undefined} aria-label="เหตุผลที่ใช้หลักฐานนี้" className={inputClass} rows={2} maxLength={assessment.route === 'SUBSTITUTE_RECEIPT' ? 500 : 2000} disabled={busy} value={assessment.reason} onChange={event => setAssessment(value => ({ ...value, reason: event.target.value }))} />
            {validationShown && assessment.route === 'ALTERNATIVE_EVIDENCE' && !assessment.reason.trim() && <p role="alert" className="mt-1 text-sm text-error-700">บอกเหตุผลที่ใช้หลักฐานนี้</p>}
          </label>}
        </div>}
      </div>
        <div className="space-y-3">
          {/* The reason comes before the button it blocks, with the one thing to press on the same row. */}
          {!saveRef && !reviewComplete && !busy && reviewBlocker && (
            <Notice tone="warning" action={(receiptActionRequired && attachFileButton('แนบไฟล์ใบเสร็จ')) || undefined}>{reviewBlocker}</Notice>
          )}
          {!saveRef && (!dirty && !vatDirty && reviewSaved && !busy
            // Saved and unchanged: a sentence, not a button that looks dead.
            ? <p role="status" className="text-sm font-semibold text-brand-700">✓ {t('expenses.doc_review_saved', locale)}</p>
            : (
              <ActionGroup>
                {/* Keeping unfinished answers is the quiet way out; it is offered only while there is something unsaved. */}
                {dirty && <button type="button" className={quietButtonClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => run(() => saveDocumentReview(undefined, false), t('expenses.review_draft_saved', locale))}>{t('expenses.review_save_draft', locale)}</button>}
                <button type="button" className={btnClass} disabled={busy || !reviewComplete} aria-busy={Boolean(busy)} onClick={() => run(saveDocumentAndRight, t('expenses.doc_review_saved', locale), false)}>{t(busy ? 'expenses.saving' : 'expenses.doc_review_save', locale)}</button>
              </ActionGroup>
            ))}
          {classificationReviewState.showFinanceOverride && !checkBillBlocked && <button className={btnClass} disabled={busy || !canResolveClassification} aria-busy={Boolean(busy)} onClick={() => run(overrideClassification, 'ยืนยันการจัดประเภทรายการแล้ว')}>{t('expenses.non_expense_override_action', locale)}</button>}
          {classificationReviewState.showFinanceOverride && !checkBillBlocked && classificationConfirmBlocker && (
            <p className="text-sm font-medium text-warning-700">{t(classificationConfirmBlocker, locale)}</p>
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
        </div>
      </DocumentReviewContainer>
      )}
      {evidence && (
        <div className="space-y-3 rounded-xl border border-warning-100 bg-warning-50 p-4 text-sm" aria-label="ใบรับรองแทนใบเสร็จของรายการนี้">
          <p className="font-semibold text-gray-800">ใบรับรองแทนใบเสร็จ <span className="mangmee-unit">{evidence.documentNumber}</span></p>
          <p className="font-semibold text-warning-700">{paperAwaiting
            ? evidence.paperSubmission ? 'รอตรวจรับฉบับเซ็น' : 'รออัปโหลดฉบับเซ็นบนกระดาษ'
            : expenseSubstituteReceiptStatus(evidence)}</p>
          <p>{evidence.fundingSource === 'COMPANY' ? 'กิจการจ่ายเต็มจำนวน' : evidence.fundingSource === 'PERSONAL_ADVANCE' ? 'พนักงานสำรองจ่ายเต็มจำนวน' : 'เอกสารเดิมยังไม่ระบุเงินที่ใช้จ่าย'}</p>
          <p>{t('expenses.substitute_wizard.payer', locale)}: {certifierName || (paperAwaiting ? 'รอกรอกชื่อบนกระดาษ' : '—')}</p>
          {evidence.fundingSource === 'PERSONAL_ADVANCE' && <p className="text-sm text-gray-600">{detail.reimbursementProgress?.requestId ? `สถานะใบเบิก: ${expenseReimbursementProgressLabel(detail.reimbursementProgress)}` : "ใบรับรองนี้ยังไม่ใช่การจ่ายคืนเงินให้พนักงาน"}</p>}
          {documentDetails && <p className="text-gray-600">{evidence.status === 'SUPERSEDED' ? 'สร้างใบรับรองแทนใบเสร็จใหม่จากค่าใช้จ่ายนี้ได้'
            : canEditSubstituteReceipt(detail, evidence)
              ? evidence.status === 'PAYER_CERTIFIED' || evidence.wetSignedScanAttachmentId || evidence.paperSubmission
                ? 'แก้ข้อมูลแล้วใช้ใบรับรองแทนใบเสร็จฉบับล่าสุดและเซ็นใหม่' : 'แก้ข้อมูลแล้วใช้ใบรับรองแทนใบเสร็จฉบับล่าสุด'
              : 'จะแก้ข้อมูลในใบ ต้องยกเลิกใบนี้แล้วสร้างใบใหม่'}</p>}
          <Link className={documentDetails ? ghostClass : btnClass} href={evidence.status === 'SUPERSEDED'
            ? `/companies/${encodeURIComponent(companyId)}/expenses/substitute-receipts/${encodeURIComponent(evidence.id)}`
            : substituteAction.href} aria-disabled={busy || dirty} onClick={(event) => { if (busy || dirty) event.preventDefault(); }}>
            {documentDetails ? 'เปิดดูเอกสาร' : t(evidence.status === 'SUPERSEDED' ? 'expenses.substitute_hub.view_history' : substituteAction.labelKey, locale)}
          </Link>
        </div>
      )}
    </MangmeeCard>
  );
}
export function ExpenseDocumentFacts({ companyId, detail }: { companyId: string; detail: ExpenseDetail }) {
  const locale = useWorkspaceLocale();
  const [incomeTypes, setIncomeTypes] = useState<WhtIncomeCategoryOption[]>([]);
  useEffect(() => {
    if (!detail.whtCategoryCode) return;
    let active = true;
    void listExpenseWhtIncomeCategories(companyId).then(rows => { if (active) setIncomeTypes(rows); }).catch(() => {});
    return () => { active = false; };
  }, [companyId, detail.whtCategoryCode]);
  const lines = detail.lines.filter(line => !isCalculatedExpenseRounding(line));
  return <div data-expense-document-facts className="space-y-3">
    <dl className="divide-y divide-gray-100">
      <Fact label="ชื่อผู้ขาย">{detail.vendorNameSnapshot || 'ยังไม่ระบุ'}</Fact>
      <Fact label="เลขผู้เสียภาษีผู้ขาย">{detail.vendorTaxIdSnapshot}</Fact>
      <Fact label="ที่อยู่ผู้ขาย">{detail.vendorAddressSnapshot}</Fact>
      <Fact label="สาขาผู้ขาย">{detail.vendorBranchCodeSnapshot === '00000' ? 'สำนักงานใหญ่' : detail.vendorBranchCodeSnapshot}</Fact>
      <Fact label="เลขที่เอกสาร">{detail.vendorDocumentNumber}</Fact>
      <Fact label="วันที่เอกสาร">{expenseDateIsReadable(detail.aiVerificationSummaryJson) ? dateShort(detail.expenseDate) : 'ยังไม่ระบุ'}</Fact>
      <Fact label="หมายเหตุ">{detail.note}</Fact>
      {Number(detail.discountAmount) > 0 && <Fact label="ส่วนลด">{baht(detail.discountAmount)}</Fact>}
      {Number(detail.vatAmount) > 0 && <Fact label="VAT">{expenseValueLabel(EXPENSE_VAT_MODE_LABELS, detail.vatMode)} · {baht(detail.vatAmount)}</Fact>}
    </dl>
    {Number(detail.whtAmount) > 0 && <section aria-labelledby="expense-withholding-heading">
      <h3 id="expense-withholding-heading" tabIndex={-1} className="text-sm font-semibold text-gray-800">ภาษีหัก ณ ที่จ่าย</h3>
      <dl className="divide-y divide-gray-100">
        <Fact label="ผู้รับเงินเป็น">{detail.vendorEntityKindSnapshot ? expenseValueLabel(PAYEE_ENTITY_KIND_LABELS, detail.vendorEntityKindSnapshot) : null}</Fact>
        <Fact label="จ่ายค่าอะไร">{detail.whtCategoryCode ? incomeTypes.find(type => type.code === detail.whtCategoryCode)?.nameTh ?? t('expenses.wht_category_recorded', locale) : null}</Fact>
        <Fact label="ภาษีหัก ณ ที่จ่าย">{baht(detail.whtAmount)}{detail.whtRate && <> · {Number(detail.whtRate)}%</>}</Fact>
        <Fact label="ยอดหลังหักภาษี ณ ที่จ่าย">{baht(detail.netPayableAmount)}</Fact>
      </dl>
    </section>}
    {lines.length > 0 && <>
      <table className="hidden w-full text-sm sm:table">
        <thead><tr className="text-left text-gray-500"><th>รายการ</th><th className="text-right">จำนวน</th><th className="text-right">ราคาต่อหน่วย</th><th className="text-right">ส่วนลด</th><th className="text-right">รวม</th></tr></thead>
        <tbody>{lines.map(line => <tr key={line.id} className="border-t border-gray-100">
          <td className="py-2">{line.description}</td><td className="text-right tabular-nums">{Number(line.quantity)}</td>
          <td className="whitespace-nowrap text-right tabular-nums">{baht(line.unitPrice)}</td><td className="whitespace-nowrap text-right tabular-nums">{baht(line.discountAmount)}</td><td className="whitespace-nowrap text-right tabular-nums">{baht(line.lineTotalAmount)}</td>
        </tr>)}</tbody>
      </table>
      <ul className="divide-y divide-gray-100 sm:hidden">{lines.map(line => <li key={line.id} className="py-2 text-sm">
        <div className="flex items-start justify-between gap-3"><span>{line.description}</span><span className="whitespace-nowrap tabular-nums font-semibold">{baht(line.lineTotalAmount)}</span></div>
        <p className="text-gray-500">{Number(line.quantity)} × {baht(line.unitPrice)}{Number(line.discountAmount) > 0 && <> · ส่วนลด {baht(line.discountAmount)}</>}</p>
      </li>)}</ul>
    </>}
    {detail.totalsIdentity?.ok === false && <p role="status" className="text-sm text-warning-700">{t('expenses.totals_identity_warning', locale)}</p>}
  </div>;
}

type EditableReviewLineField = 'description' | 'quantity' | 'unitPrice' | 'discountAmount' | 'vatRate';

export function ExpenseReviewEditSection({ companyId, detail, isMutable, canReview, canConfirm, overpaymentCue, showSaveDraft = false, onSaved, saveRef, onBusyChange, onValidationChange, vatOverrideRef, onTotalsChange, totalsRetry = 0, skipUnchangedSave = false, permissions = [], onDirtyChange }: {
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
  overpaymentCue?: string | null;
  /** Explicit save is available only on the first review step; later steps use navigation saves. */
  showSaveDraft?: boolean;
  /** Back/Next in an existing certificate must preserve signed no-op revisions. */
  skipUnchangedSave?: boolean;
  onSaved: () => Promise<void>;
  /** The ถัดไป/chip navigation and the first-step draft button use the same save. */
  saveRef?: MutableRefObject<((explicitDraftSave?: boolean) => Promise<boolean>) | null>;
  onBusyChange?: (busy: boolean) => void;
  onValidationChange?: (errorCount: number, firstErrorMessage: string | null) => void;
  /** For the leave question of the page around this form: true while a field differs from what was last saved or loaded, false after a save or a reload. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Plan 13.11.B: the VAT card collects "ใช้ยอดตามเอกสาร"; the page's confirm button spends it. */
  vatOverrideRef?: MutableRefObject<ExpenseVatSourceOverrideInput | null>;
}) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const [values, setValues] = useState<ExpenseDraftReviewValues>(() => reviewValues(detail, isMutable));
  const receiptProblem = expenseEvidenceAssessment(detail)?.receiptProblem;
  const noReceipt = receiptProblem === 'NOT_AVAILABLE' || receiptProblem === 'LOST';
  const [sourceCategories, setSourceCategories] = useState<ExpenseCategorySummary[]>([]);
  const [sourceCategoryError, setSourceCategoryError] = useState(false);
  // WHT certificate system issuance plan §1.2: ACTIVE income categories for the dropdown below.
  // Mirrors accounts-payable's AccountsPayablePages.tsx — an empty catalog is a valid state (the
  // seeded categories are DRAFT until an accountant activates them), so a fetch failure must not
  // block reviewing or confirming an ordinary expense.
  const [whtCategories, setWhtCategories] = useState<WhtIncomeCategoryOption[]>([]);
  const [whtCategoriesState, setWhtCategoriesState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [withholdingEnabled, setWithholdingEnabled] = useState(() => expenseReviewWithholdsTax(reviewValues(detail), detail.whtAmount));
  // R4: a freshly chosen หัก shows no red. Leaving a value field or pressing ถัดไป reveals what is missing.
  const [whtReveal, setWhtReveal] = useState(true);
  const [validationRevealed, setValidationRevealed] = useState(false);
  const [focusInvalidAttempt, setFocusInvalidAttempt] = useState(0);
  useEffect(() => {
    if (!focusInvalidAttempt) return;
    const root = document.getElementById(`expense-review-fields-${detail.id}`);
    if (!root) return;
    const focusInvalid = () => {
      const target = root.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (!target) return false;
      focusExpenseField(target);
      return true;
    };
    if (focusInvalid()) return;
    const observer = new MutationObserver(() => { if (focusInvalid()) observer.disconnect(); });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-invalid'] });
    return () => observer.disconnect();
  }, [focusInvalidAttempt, detail.id]);
  // R2: an empty value is only a value being typed until the reviewer leaves the field.
  const [whtValueFocused, setWhtValueFocused] = useState(false);
  const whtBlockRef = useRef<HTMLFieldSetElement>(null);
  useEffect(() => {
    let active = true;
    setWhtCategoriesState('loading');
    void listExpenseWhtIncomeCategories(companyId).then((categories) => {
      if (active) { setWhtCategories(categories); setWhtCategoriesState('ready'); }
    }).catch(() => { if (active) { setWhtCategories([]); setWhtCategoriesState('error'); } });
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
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // "Saved" belongs to the step it was said on: it must not still be on screen after the person moved to another step.
  useEffect(() => { setInfo(null); }, [showSaveDraft]);
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
  const removedLineIndex = useRef<number | undefined>(undefined);
  const addedLineKind = useRef<ExpenseLineChargeKind | null | undefined>(undefined);
  // The stored date, not the edited one: a reviewer mid-edit must not have the tax fields vanish
  // under their cursor. `hasRecordedTax` then keeps them visible for a document that already
  // carries VAT, whatever the workspace mode says (spec §7.5).
  const capture = useExpenseCapturePolicy(companyId, detail.expenseDate ?? undefined);
  const showsTax = showsTaxCapture(capture.mode, hasRecordedTax(detail.lines));
  const aiGrandTotal = aiGrandTotalValue(detail.aiVerifiedFieldsJson);
  const aiSuggestion = useMemo(() => expenseAiSuggestion(detail.aiVerificationSummaryJson), [detail.aiVerificationSummaryJson]);
  const issues = useMemo(() => validateExpenseReview(values, { today: todayCivilDate(), aiGrandTotal, whtAmount: detail.whtAmount, sourceDocumentType: detail.sourceDocumentType, withholdingChosen: withholdingEnabled }), [values, aiGrandTotal, detail.whtAmount, detail.sourceDocumentType, withholdingEnabled]);
  const whtQuiet = withholdingEnabled && !whtReveal;
  const whtBlank = (values.whtInput?.value ?? '').trim() === '';
  const whtValueTyping = whtValueFocused && whtBlank;
  // Keep field order for the one way-out hint; Next reveals all missing answers.
  const whtMissing = withholdingEnabled
    ? ['vendorEntityKindSnapshot', 'whtCategoryCode', ...(whtBlank ? ['whtInput.value'] : [])]
      .filter((field) => issues.some((issue) => issue.field === field && issue.severity === 'error'))
    : [];
  const shownIssues = issues.filter((issue) => (!isMutable || validationRevealed || issue.severity !== 'error')
    && !(WHT_ISSUE_FIELDS.includes(issue.field) && (whtQuiet || (whtValueTyping && issue.field === 'whtInput.value'))));
  const vendorNameIssue = fieldIssue(shownIssues, 'vendorNameSnapshot');
  const vendorTaxIdIssue = fieldIssue(shownIssues, 'vendorTaxIdSnapshot');
  const vendorTaxIdDigits = taxIdDigits(values.vendorTaxIdSnapshot);
  const vendorTaxIdChecksumWarning = isMutable && vendorTaxIdDigits.length === 13 && !thaiTaxIdChecksumValid(vendorTaxIdDigits);
  const vendorAddressIssue = fieldIssue(shownIssues, 'vendorAddressSnapshot');
  const documentNumberIssue = fieldIssue(shownIssues, 'vendorDocumentNumber');
  const expenseDateIssue = fieldIssue(shownIssues, 'expenseDate');
  const linesIssue = fieldIssue(shownIssues, 'lines');
  const whtValueIssue = fieldIssue(shownIssues, 'whtInput.value') ?? fieldIssue(shownIssues, 'whtRate');
  const whtUnitIssue = fieldIssue(shownIssues, 'whtInput.inputType');
  const whtBaseIssue = fieldIssue(shownIssues, 'whtInput.baseAmount');
  const payeeEntityKindIssue = fieldIssue(shownIssues, 'vendorEntityKindSnapshot');
  const whtCategoryIssue = fieldIssue(shownIssues, 'whtCategoryCode');

  const documentWhtRate = expenseDocumentWhtRate(values.lines);
  const applicableWhtCategories = expenseWhtCategoriesForPayee(whtCategories, values.vendorEntityKindSnapshot);
  const whtInput: ExpenseWhtInput = values.whtInput ?? { inputType: 'RATE', value: expenseRateToPercent(documentWhtRate ?? '') };
  // R3: the way out is named once, beside that first missing field.
  const whtWayOut = (issue?: ExpenseFieldIssue) => isMutable && issue && issue.field === whtMissing[0]
    ? <span className="mt-1 block text-xs text-gray-600">{EXPENSE_WITHHOLDING_WORDS.wayOut(t('expenses.wht_no', locale))}</span> : null;
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
  const blockingIssueCount = shownIssues.filter((issue) => issue.severity === 'error').length
    + (vatSourceError ? 1 : 0) + sourceCategoryIncompleteIndexes.length;
  const previewIssue = issues.find(issue => issue.severity === 'error' && (issue.field.startsWith('whtInput.') || issue.field === 'whtRate'
    || /^lines\.\d+\.(quantity|unitPrice|discountAmount|vatRate|vatTreatment|chargeKind)$/.test(issue.field)));
  const previewBlocker = vatSourceError ?? (previewIssue ? expenseReviewMessage(previewIssue.messageKey, locale, isMutable, previewIssue.params) : null);
  // A record with no line saved and none typed has nothing to recalculate: asking the server anyway came
  // back as "คำนวณยอดล่าสุดไม่ได้" on a brand-new record, before the person had typed a thing.
  const nothingToTotal = values.lines.length === 0 && detail.lines.length === 0;
  const liveTotals = useExpenseReviewTotals(companyId, detail, values,
    isMutable && (canReview || !detail.sourceDraft) && !nothingToTotal, previewBlocker, totalsRetry, onTotalsChange, whtMissing.length > 0);
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
  const documentVatDiffers = snapshotSourceAmount !== null && vatSnapshot != null
    && Math.abs(Number(snapshotSourceAmount) - Number(vatSnapshot.calculation.vatAmount)) > 0.005;
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

  const reviewSnapshot = useRef({ id: detail.id, values: reviewValues(detail, isMutable), withholdingEnabled: expenseReviewWithholdsTax(reviewValues(detail), detail.whtAmount) });
  useEffect(() => {
    const incoming = { id: detail.id, values: reviewValues(detail, isMutable), withholdingEnabled: expenseReviewWithholdsTax(reviewValues(detail), detail.whtAmount) };
    const previous = reviewSnapshot.current;
    if (previous.id !== detail.id) setValidationRevealed(false);
    const keepInput = previous.id === detail.id && isMutable;
    const nextValues = keepInput ? mergeExpenseUnsavedFields(previous.values, incoming.values, values) : incoming.values;
    setValues(nextValues);
    if (!keepInput || withholdingEnabled === previous.withholdingEnabled) setWithholdingEnabled(expenseReviewWithholdsTax(reviewValues(detail), detail.whtAmount));
    if (!keepInput || JSON.stringify(nextValues) === JSON.stringify(incoming.values)) {
      setWhtReveal(true); setVatEditors({}); setVatSourceDirty(false); setTaxFactsDirty(false);
      setVatOverrideReason(''); setVatOverrideLineNumber(null);
    }
    reviewSnapshot.current = incoming;
  }, [detail.id, detail.updatedAt, isMutable]);
  useEffect(() => {
    if (!vatOverrideRef) return;
    const reason = vatOverrideReason.trim();
    // Owner decision 2026-08-28: whoever may confirm the expense may also accept the document total.
    // Gating this on canReview left everyone else staring at a refusal with no control to act on.
    vatOverrideRef.current = vatBlocked && canConfirm && reason !== '' && vatOverrideLineNumber !== null
      ? { reason, vatLineNumber: vatOverrideLineNumber, expectedUpdatedAt: detail.updatedAt }
      : null;
  }, [canConfirm, detail.updatedAt, vatBlocked, vatOverrideLineNumber, vatOverrideReason, vatOverrideRef]);
  useEffect(() => { onValidationChange?.(validationRevealed ? blockingIssueCount : 0, null); }, [validationRevealed, blockingIssueCount, onValidationChange]);
  // Typed and not yet saved: the form's values differ from what the server last gave. A save reloads the record, which makes them equal again.
  const formDirty = isMutable && JSON.stringify(values) !== JSON.stringify(reviewValues(detail));
  useEffect(() => { onDirtyChange?.(formDirty); }, [onDirtyChange, formDirty]);

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
    if (removedLineIndex.current !== undefined) {
      const index = Math.min(Math.max(0, removedLineIndex.current - 1), values.lines.length - 1);
      removedLineIndex.current = undefined;
      focusExpenseField(document.getElementById(index < 0 ? `expense-add-line-${detail.id}` : `expense-review-line-input-${detail.id}-${index}`));
      return;
    }
    if (addedLineKind.current === undefined) return;
    const kind = addedLineKind.current;
    addedLineKind.current = undefined;
    // The shared insertion rule adds the last product or charge; wait for that row to render.
    const index = values.lines.reduce((last, line, at) => (line.chargeKind ?? null) === kind ? at : last, -1);
    focusExpenseField(document.getElementById(`expense-review-line-input-${detail.id}-${index}`));
  }, [detail.id, values.lines.length]);

  const removeLine = (index: number) => {
    removedLineIndex.current = index;
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
      setValidationRevealed(true); setWhtReveal(true); setWhtValueFocused(false);
      setFocusInvalidAttempt(value => value + 1);
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
        });
      reviewSnapshot.current = { id: detail.id, values, withholdingEnabled };
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
    <div id={`expense-review-fields-${detail.id}`}><MangmeeCard className="space-y-4 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-800">{t('expenses.vendor_and_lines', locale)}</h3>
        {!isMutable && <span className="text-xs text-gray-400">{t('expenses.read_only', locale)}</span>}
      </div>
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
          <span className="mb-1 block text-sm font-medium text-gray-700"><AiFieldLabel label={t('expenses.vendor_name', locale)} field="vendorNameSnapshot" summary={detail.aiVerificationSummaryJson} /></span>
          <input id={`expense-vendor-name-${detail.id}`} readOnly={detail.substituteReceiptEvidence?.status === 'ISSUED'} className={validationInputClass(vendorNameIssue)} aria-invalid={vendorNameIssue?.severity === 'error' || undefined} placeholder={isMutable ? noReceipt ? 'ชื่อผู้รับเงิน' : 'ชื่อตามใบเสร็จ' : undefined} value={values.vendorNameSnapshot} onChange={(e) => setValues((v) => ({ ...v, vendorNameSnapshot: stripDisallowed(e.target.value) }))} disabled={!isMutable || busy} />
          <FieldIssueNote canEdit={isMutable} issue={vendorNameIssue} />
          <AiFieldMissingHint canEdit={isMutable} field="vendorNameSnapshot" summary={detail.aiVerificationSummaryJson} />
          {!vendorNameIssue && sourceMissingNote('vendorName')}
        </label>
        <div>
          <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <label htmlFor={`expense-vendor-tax-${detail.id}`}><AiFieldLabel label={t('expenses.vendor_tax_id', locale)} field="vendorTaxIdSnapshot" summary={detail.aiVerificationSummaryJson} /></label>
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_tax_id', locale)} />
          </span>
          {/* No maxLength: a full ID formats to exactly 17 characters, so the attribute blocked every
              insertion into a complete number — typing the missing leading 0 in front did nothing.
              taxIdDigits already caps the stored value at 13 digits, dropping the overflow. */}
          <input id={`expense-vendor-tax-${detail.id}`} className={validationInputClass(vendorTaxIdIssue)} aria-invalid={vendorTaxIdIssue?.severity === 'error' || undefined} aria-describedby={vendorTaxIdChecksumWarning ? `expense-vendor-tax-warning-${detail.id}` : undefined} inputMode="numeric" placeholder={isMutable ? '0-0000-00000-00-0' : undefined} value={formatTaxId(values.vendorTaxIdSnapshot)} onChange={(e) => setValues((v) => ({ ...v, vendorTaxIdSnapshot: taxIdDigits(e.target.value) }))} disabled={!isMutable || busy} />
          <FieldIssueNote canEdit={isMutable} issue={vendorTaxIdIssue} />
          {vendorTaxIdChecksumWarning && (
            <p id={`expense-vendor-tax-warning-${detail.id}`} className="mt-1 text-xs text-warning-700">{t('expenses.vendor_tax_id_checksum_warning', locale)}</p>
          )}
          <AiFieldMissingHint canEdit={isMutable} field="vendorTaxIdSnapshot" summary={detail.aiVerificationSummaryJson} />
        </div>
        {/* A6: สำนักงานใหญ่/สาขา plus the code the document prints — never a dropdown of registry
            branches, so there is no "no match" state to explain. `branchIsBranch` is local because
            "สาขา picked, code not typed yet" and "สำนักงานใหญ่" are the same stored value (''),
            exactly like the VAT editors' `custom` flag above. */}
        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.vendor_branch', locale)}</span>
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
          {isMutable && <p className={FIELD_HINT}>{t('expenses.vendor_branch_code_hint', locale)}</p>}
        </div>
        <label>
          <span className="mb-1 block text-sm font-medium text-gray-700"><AiFieldLabel label={t('expenses.document_number', locale)} field="vendorDocumentNumber" summary={detail.aiVerificationSummaryJson} /></span>
          <input id={`expense-document-number-${detail.id}`} className={validationInputClass(documentNumberIssue)} aria-invalid={documentNumberIssue?.severity === 'error' || undefined} value={values.vendorDocumentNumber} onChange={(e) => setValues((v) => ({ ...v, vendorDocumentNumber: stripDisallowed(e.target.value) }))} disabled={!isMutable || busy} />
          <FieldIssueNote canEdit={isMutable} issue={documentNumberIssue} />
          <AiFieldMissingHint canEdit={isMutable} field="vendorDocumentNumber" summary={detail.aiVerificationSummaryJson} />
        </label>
        {/* Vendor address spec §11.2: a full-width, 3-row textarea, the same AI badge as every
            other read field. No maxLength — §8 says an over-long address is refused with a way
            forward, never silently truncated, and maxLength would eat the tail of a paste in
            silence. The length rule lives in the validator, where the reviewer can see it. */}
        <label className="sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-gray-700"><AiFieldLabel label={t('expenses.vendor_address', locale)} field="vendorAddressSnapshot" summary={detail.aiVerificationSummaryJson} /></span>
          <textarea aria-label={t('expenses.vendor_address', locale)} className={cx(validationInputClass(vendorAddressIssue), 'resize-y')} rows={3}
            aria-invalid={vendorAddressIssue?.severity === 'error' || undefined} value={values.vendorAddressSnapshot}
            onChange={(e) => setValues((v) => ({ ...v, vendorAddressSnapshot: stripDisallowed(e.target.value) }))} disabled={!isMutable || busy} />
          <FieldIssueNote canEdit={isMutable} issue={vendorAddressIssue} />
          <AiFieldMissingHint canEdit={isMutable} field="vendorAddressSnapshot" summary={detail.aiVerificationSummaryJson} />
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
        <label>
          <span className="mb-1 block text-sm font-medium text-gray-700"><AiFieldLabel label={t('expenses.expense_date', locale)} field="expenseDate" summary={detail.aiVerificationSummaryJson} /></span>
          <ThemedDate id={`expense-date-${detail.id}`} aria-label={t('expenses.expense_date', locale)} className={validationInputClass(expenseDateIssue)} aria-invalid={expenseDateIssue?.severity === 'error' || undefined} value={values.expenseDate} onChange={(e) => setValues((v) => ({ ...v, expenseDate: e.target.value }))} disabled={!isMutable || busy} />
          {/* One line under the date: what is wrong, or that AI could not read it, or what date is meant. */}
          <FieldIssueNote canEdit={isMutable} issue={expenseDateIssue} />
          {!expenseDateIssue && <AiFieldMissingHint canEdit={isMutable} field="expenseDate" summary={detail.aiVerificationSummaryJson} />}
          {isMutable && !expenseDateIssue && !expenseAiFieldProvenance(detail.aiVerificationSummaryJson, 'expenseDate')?.missing && <p className={FIELD_HINT}>{noReceipt ? 'วันที่เกิดค่าใช้จ่าย' : 'วันที่บนใบเสร็จ ไม่ใช่วันที่จ่าย'}</p>}
          {!expenseDateIssue && sourceMissingNote('expenseDate')}
        </label>
        {values.businessPurpose !== undefined && (
          <label className="sm:col-span-2">
            <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.source_draft_business_purpose', locale)}</span>
            <textarea aria-label={t('expenses.source_draft_business_purpose', locale)} readOnly={detail.substituteReceiptEvidence?.status === 'ISSUED'} className={inputClass} rows={2} maxLength={500} value={values.businessPurpose}
              onChange={(event) => setValues((current) => ({ ...current, businessPurpose: stripDisallowed(event.target.value) }))}
              disabled={!isMutable || busy} />
          </label>
        )}
      </div>

      <div id={`expense-line-items-${detail.id}`} tabIndex={-1} className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <h4 className="font-semibold text-gray-800">{t('expenses.line_items', locale)}</h4>
        {isMutable && (
          <button id={`expense-add-line-${detail.id}`} type="button" className={ghostClass} disabled={busy} onClick={() => insertLine(null)}>{t('expenses.add_line', locale)}</button>
        )}
      </div>

      {values.lines.length === 0 && (
        <div>
          <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">{t('expenses.no_line_items', locale)}</p>
          <FieldIssueNote canEdit={isMutable} issue={linesIssue} />
        </div>
      )}
      {productEntries.map(({ line, index }) => {
        const taxAmounts = calculateManualExpenseTotals({ ...line, vatMode: values.vatMode });
        const descriptionIssue = fieldIssue(shownIssues, `lines.${index}.description`);
        const quantityIssue = fieldIssue(shownIssues, `lines.${index}.quantity`);
        const unitPriceIssue = fieldIssue(shownIssues, `lines.${index}.unitPrice`);
        const discountIssue = fieldIssue(shownIssues, `lines.${index}.discountAmount`);
        const vatRateIssue = fieldIssue(shownIssues, `lines.${index}.vatRate`);
        const vatPercent = expenseRatePercent(line.vatRate);
        // "custom, nothing typed yet" stores the same '' as "unset", so the flag has to be sticky.
        const showCustomRate = vatRatePreset(line.vatRate, line.vatTreatment) === 'custom' || vatEditors[index]?.custom === true;
        const linePreset = showCustomRate ? 'custom' : vatRatePreset(line.vatRate, line.vatTreatment);
        return (
        <div key={index} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span id={`expense-review-line-${detail.id}-${index}`} tabIndex={-1} className="text-xs font-semibold text-gray-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{t('expenses.line_number', locale)} {index + 1}</span>
            {isMutable && <button type="button" className={cx(tapTargetClass, 'flex h-8 w-8 items-center justify-center rounded-lg text-error-500 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50')} disabled={busy} onClick={() => removeLine(index)} title={t('expenses.delete', locale)} aria-label={`${t('expenses.delete_line_aria', locale)} ${index + 1}`}>{ICON.trash}</button>}
          </div>
          {/* Two to a row at every width: จำนวน and ราคาต่อหน่วย are short and are read together. */}
          <div className="grid grid-cols-2 gap-3">
            {/* A textarea, not an input: on a phone the single line clipped the description at the
                field edge (a seeded 33-character line needed 278px of a 264px box at 390 wide, and
                194px at 320), so the value being checked against the receipt could not be read in
                one look. Two rows and wrapping at every width — a one-line box would clip the same
                way on a narrow desktop window, and splitting the control by breakpoint would mean
                two DOM fields for one value. */}
            <label className="col-span-2">
              <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.line_description', locale)}</span>
              <textarea id={`expense-review-line-input-${detail.id}-${index}`} aria-label={t('expenses.line_description', locale)} className={cx(validationInputClass(descriptionIssue), 'resize-y')} rows={2} aria-invalid={descriptionIssue?.severity === 'error' || undefined} value={line.description} onChange={(e) => updateLine(index, 'description', stripDisallowed(e.target.value))} disabled={!isMutable || busy} />
              <FieldIssueNote canEdit={isMutable} issue={descriptionIssue} />
              {!descriptionIssue && (sourceMissingNote('description', line.sourceItemRef) ?? sourceMissingNote('review', line.sourceItemRef))}
            </label>
            {detail.sourceDraft && !line.chargeKind && (
              <label className="col-span-2">
                <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.category', locale)}</span>
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
              <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.line_quantity', locale)}</span>
              <input type="number" min="0" step="0.0001" className={validationInputClass(quantityIssue)} aria-invalid={quantityIssue?.severity === 'error' || undefined} value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} disabled={!isMutable || busy} />
              <FieldIssueNote canEdit={isMutable} issue={quantityIssue} />
              {!quantityIssue && sourceMissingNote('quantity', line.sourceItemRef)}
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.line_unit_price', locale)}</span>
              <input type="number" min="0" step="0.0001" className={validationInputClass(unitPriceIssue)} aria-invalid={unitPriceIssue?.severity === 'error' || undefined} value={line.unitPrice} onChange={(e) => updateLine(index, 'unitPrice', normalizeDecimalInput(e.target.value))} disabled={!isMutable || busy} />
              {overpaymentCue && <p data-testid="expense-overpayment-cue" className="mt-1 text-xs font-semibold text-error-700">{overpaymentCue}</p>}
              <FieldIssueNote canEdit={isMutable} issue={unitPriceIssue} />
              {!unitPriceIssue && sourceMissingNote('unitPrice', line.sourceItemRef)}
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.line_discount', locale)}</span>
              <input type="number" min="0" step="0.0001" className={validationInputClass(discountIssue)} aria-invalid={discountIssue?.severity === 'error' || undefined} value={line.discountAmount} onChange={(e) => updateLine(index, 'discountAmount', normalizeDecimalInput(e.target.value))} disabled={!isMutable || busy} />
              <FieldIssueNote canEdit={isMutable} issue={discountIssue} />
            </label>
            {/* Spec §19g decision 4: a rate, a preset, or the VAT amount the document prints — all
                three write the same stored decimal fraction. The bare 0–1 box asked reviewers to
                convert "11.78 VAT TTL" into 0.07 in their heads.
                The block takes the full row: as a half-width cell its printed-VAT sub-fields wrapped
                their labels onto two lines and left a column-tall hole beside ส่วนลด. */}
            {showsVatCard && <div className="col-span-2">
              <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <label htmlFor={`expense-vat-rate-${detail.id}-${index}`}>{t('expenses.line_vat_rate', locale)}</label>
                <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_rate', locale)} />
              </span>
              <ThemedSelect
                id={`expense-vat-rate-${detail.id}-${index}`}
                aria-label={t('expenses.line_vat_rate', locale)}
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
              <FieldIssueNote canEdit={isMutable} issue={vatRateIssue} />
              {showCustomRate && (
                <label className="mt-2 block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.line_vat_percent', locale)}</span>
                  <input type="number" min="0" max="99.9999" step="0.0001" className={inputClass}
                    value={expenseRateToPercent(line.vatRate)}
                    onChange={(e) => updateLine(index, 'vatRate', expensePercentToRate(e.target.value))}
                    disabled={!isMutable || busy} />
                </label>
              )}
              {vatPercent !== null && showCustomRate && <p className={FIELD_HINT}>{t('expenses.rate_percent_echo', locale).replace('{percent}', vatPercent)}</p>}
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
              allowNoTax={Number(taxAmounts.vat) === 0}
              value={line.taxCodeDefinitionId ?? ''}
              disabled={!isMutable || busy}
              labelAddon={<InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_tax_code', locale)} />}
              canConfigureTax={capture.canConfigureTax}
              hideWhenNothingToChoose
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
      {/* A locked record with no additional charge has nothing to say here: the heading and its empty line are not drawn. */}
      {(isMutable || chargeEntries.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <h4 className="font-semibold text-gray-800">{t(chargeEntries.some(({ line }) => line.chargeKind === 'ROUNDING') ? 'expenses.charges_and_adjustments_section' : 'expenses.charges_section', locale)}</h4>
          {isMutable && (
            <button type="button" className={ghostClass} disabled={busy} onClick={() => insertLine('SERVICE_CHARGE')}>{t('expenses.add_charge', locale)}</button>
          )}
        </div>
      )}

      {isMutable && chargeEntries.length === 0 && (
        <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-sm text-gray-500">{t('expenses.no_charges', locale)}</p>
      )}
      {chargeEntries.map(({ line, index }, chargeIndex) => {
        const chargeKind = line.chargeKind!;
        const amountIssue = fieldIssue(shownIssues, `lines.${index}.unitPrice`);
        const quantityIssue = fieldIssue(shownIssues, `lines.${index}.quantity`);
        const orderIssue = fieldIssue(shownIssues, `lines.${index}.chargeKind`);
        const vatRateIssue = fieldIssue(shownIssues, `lines.${index}.vatRate`);
        const showCustomRate = vatRatePreset(line.vatRate, line.vatTreatment) === 'custom' || vatEditors[index]?.custom === true;
        const linePreset = showCustomRate ? 'custom' : vatRatePreset(line.vatRate, line.vatTreatment);
        return (
        <div key={`charge-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span id={`expense-review-line-${detail.id}-${index}`} tabIndex={-1} className="text-xs font-semibold text-gray-600 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">{t('expenses.line_number', locale)} {productEntries.length + chargeIndex + 1}</span>
            {isMutable && <button type="button" className={cx(tapTargetClass, 'flex h-8 w-8 items-center justify-center rounded-lg text-error-500 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50')} disabled={busy} onClick={() => removeLine(index)} title={t('expenses.delete', locale)} aria-label={`${t('expenses.delete_charge_aria', locale)} ${index + 1}`}>{ICON.trash}</button>}
          </div>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor={`expense-charge-kind-${detail.id}-${index}`}>{t(chargeKind === 'ROUNDING' ? 'expenses.adjustment_kind' : 'expenses.charge_kind', locale)}</label>
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
              <FieldIssueNote canEdit={isMutable} issue={orderIssue} />
            </div>
            <label>
              <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.line_description', locale)}</span>
              <input id={`expense-review-line-input-${detail.id}-${index}`} type="text" className={inputClass} value={line.description} onChange={(e) => updateLine(index, 'description', stripDisallowed(e.target.value))} disabled={!isMutable || busy} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium text-gray-700">{t(chargeKind === 'ROUNDING' ? 'expenses.adjustment_amount' : 'expenses.charge_amount', locale)}</span>
              {/* No `min`: ปัดเศษ is the one kind a bill prints as a deduction, and the validator is
                  what refuses a minus sign on any other kind. */}
              <input type="number" step="0.0001" className={validationInputClass(amountIssue ?? quantityIssue)} aria-invalid={amountIssue?.severity === 'error' || undefined} value={line.unitPrice} onChange={(e) => updateLine(index, 'unitPrice', normalizeDecimalInput(e.target.value))} disabled={!isMutable || busy} />
              {overpaymentCue && <p data-testid="expense-overpayment-cue" className="mt-1 text-xs font-semibold text-error-700">{overpaymentCue}</p>}
              <FieldIssueNote canEdit={isMutable} issue={amountIssue ?? quantityIssue} />
              {chargeKind === 'ROUNDING' && <p className="mt-1 text-xs text-gray-500">{t('expenses.rounding_explanation', locale)}</p>}
            </label>
            {showsVatCard && <div>
              <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700">
                <label htmlFor={`expense-charge-vat-${detail.id}-${index}`}>{t('expenses.line_vat_rate', locale)}</label>
                <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_rate', locale)} />
              </span>
              <ThemedSelect
                id={`expense-charge-vat-${detail.id}-${index}`}
                aria-label={t('expenses.line_vat_rate', locale)}
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
              <FieldIssueNote canEdit={isMutable} issue={vatRateIssue} />
              {showCustomRate && (
                <label className="mt-2 block">
                  <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.line_vat_percent', locale)}</span>
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

      <div className="grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <label htmlFor={`expense-vat-mode-${detail.id}`}>{t('expenses.vat_mode', locale)}</label>
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_mode', locale)} />
            {/* Spec §19g decision 3: the mode never names a rate; the rate comes from the lines. */}
            {vatModeRequiresRate(values.vatMode) && (
              <span className="font-semibold text-gray-500">· {effectiveVatRateLabel(values.lines.filter((line) => !isCalculatedExpenseRounding(line)))}</span>
            )}
          </span>
          <ThemedSelect id={`expense-vat-mode-${detail.id}`} aria-label={t('expenses.vat_mode', locale)} className={inputClass} value={values.vatMode} onChange={(e) => { setVatSourceDirty(true); setValues((v) => ({ ...v, vatMode: e.target.value as ExpenseDraftReviewValues['vatMode'] })); }} disabled={!isMutable || busy}>
            {Object.entries(EXPENSE_VAT_MODE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </ThemedSelect>
        </div>
        {showsVatCard && (
          <div className="space-y-3 rounded-xl border border-brand-100 bg-brand-25 p-3 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-gray-800">ภาษีมูลค่าเพิ่ม (VAT)</p>
              {!vatSourceDirty && vatSnapshot && (
                <MangmeeBadge tone={['MATCHED', 'REVIEWER_ACCEPTED'].includes(vatSnapshot.reconciliation.status) ? 'brand' : ['MISMATCH', 'NEEDS_REVIEW', 'SOURCE_ONLY'].includes(vatSnapshot.reconciliation.status) ? 'danger' : 'slate'}>
                  {vatStatusLabel}
                </MangmeeBadge>
              )}
            </div>
            {capture.vatStatus === 'NOT_REGISTERED' && (
              <p className="rounded-lg bg-white px-3 py-2 text-sm text-gray-600">ร้านไม่ได้จด VAT: VAT ในใบนับเป็นต้นทุน ขอคืนไม่ได้</p>
            )}
            {capture.vatStatus === 'UNKNOWN' && <p className="text-sm">ร้านยังไม่ตอบเรื่อง VAT บันทึกรายจ่ายได้ตามเดิม · <>{capture.canAnswerVatStatus ? <Link href={`/companies/${companyId}/settings/profile#shop`} className="underline">ตั้งค่าร้าน › ข้อมูลร้าน</Link> : 'ให้เจ้าของกิจการหรือผู้ดูแลร้านตอบที่ตั้งค่าร้าน › ข้อมูลร้าน'}</></p>}
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">บนใบพิมพ์ VAT ไว้แบบไหน</span>
              <ThemedSelect
                className={inputClass}
                value={vatSourceMode}
                aria-label="บนใบพิมพ์ VAT ไว้แบบไหน"
                onChange={(event) => setVatSourceType(event.target.value as 'RATE' | 'AMOUNT' | 'BOTH' | 'NONE' | 'LINES')}
                disabled={!isMutable || busy}
              >
                <option value="NONE">ไม่ได้พิมพ์ไว้</option>
                <option value="RATE">เป็น %</option>
                <option value="AMOUNT">เป็นจำนวนเงิน</option>
                <option value="BOTH">ทั้ง % และจำนวนเงิน</option>
                <option value="LINES">แยกตามรายการ</option>
              </ThemedSelect>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(vatSource.inputType === 'RATE' || vatSource.inputType === 'BOTH') && (
                <label>
                  <span className="mb-1 block text-sm font-medium text-gray-700">อัตรา VAT จากเอกสาร (%)</span>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      max="99.9999"
                      step="0.0001"
                      className={cx(inputClass, '!pr-10')}
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
                  <span className="mb-1 block text-sm font-medium text-gray-700">VAT จากเอกสาร (บาท)</span>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      className={cx(inputClass, '!pr-14')}
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
                            <input type="number" min="0" max="99.9999" step="0.0001" className={cx(inputClass, '!pr-10')} aria-invalid={Boolean(expenseVatSourceValidationMessage({ inputType: 'RATE', vatRatePercent: sourceLine.vatRatePercent }, values.vatMode)) || undefined} value={sourceLine.vatRatePercent ?? ''} onChange={(event) => setVatLineSourceValue(index, 'vatRatePercent', event.target.value)} disabled={!isMutable || busy} />
                            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span>
                          </label>
                        )}
                        {(sourceLine.inputType === 'AMOUNT' || sourceLine.inputType === 'BOTH') && (
                          <label className="relative">
                            <span className="sr-only">VAT จากเอกสาร รายการ {index + 1}</span>
                            <input type="number" min="0" step="0.01" className={cx(inputClass, '!pr-14')} aria-invalid={Boolean(expenseVatSourceValidationMessage({ inputType: 'AMOUNT', vatAmount: sourceLine.vatAmount }, values.vatMode)) || undefined} value={sourceLine.vatAmount ?? ''} onChange={(event) => setVatLineSourceValue(index, 'vatAmount', event.target.value)} disabled={!isMutable || busy} />
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
              ? <p className="rounded-lg bg-white px-3 py-2 text-xs text-gray-500">{liveTotals?.status === 'error' ? 'ตรวจข้อมูลเพื่อคำนวณยอดล่าสุด' : 'กำลังคำนวณยอดล่าสุด…'}</p>
              : vatSnapshot && (
                <div className="rounded-lg bg-white px-3 py-2">
                  {/* A number is shown once. The comparison appears only when the paper's VAT was entered and is
                      another amount; the base and the total are in the money card and are not repeated here. */}
                  {documentVatDiffers ? <>
                    <MoneyRow label="VAT จากเอกสาร" value={snapshotSourceAmount ?? '0'} />
                    <MoneyRow label="VAT ที่ระบบคำนวณ" value={vatSnapshot.calculation.vatAmount} />
                    <MoneyRow label="VAT ที่ใช้บันทึก" value={liveTotals?.totals?.vatAmount ?? detail.vatAmount} />
                    {vatSnapshot.reconciliation.differenceAmount !== null && <MoneyRow label="ส่วนต่าง" value={vatSnapshot.reconciliation.differenceAmount} />}
                    <p className="mt-1 text-sm text-gray-500">ยอดที่ใช้: {vatSnapshot.reconciliation.acceptedSource === 'SOURCE_AMOUNT' ? 'ตามเอกสาร' : 'ระบบคำนวณ'}</p>
                  </> : <MoneyRow label="VAT ที่คำนวณได้" value={liveTotals?.totals?.vatAmount ?? detail.vatAmount} />}
                  {!collapsesVatBase && vatBaseGroups.map(([rate, amount]) => (
                    <MoneyRow key={rate} label={`ฐาน VAT ${Number(rate)}% (ใช้จริง)`} value={amount.toFixed(4)} />
                  ))}
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
                      <span className="mb-1 block text-sm font-medium text-gray-700">รายการที่รับส่วนต่าง VAT</span>
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
                      <span className="mb-1 block text-sm font-medium text-gray-700">เหตุผล (จำเป็น)</span>
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
      </div>

      <fieldset data-testid="expense-withholding" ref={whtBlockRef} tabIndex={-1} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3">
        <legend id="expense-withholding-heading" tabIndex={-1} className="px-1 text-sm font-semibold text-gray-800">{t('expenses.wht_choice', locale)}</legend>
        <ThemedSelect aria-label={t('expenses.wht_choice', locale)} aria-describedby={`expense-wht-choice-hint-${detail.id}`} value={withholdingEnabled ? 'YES' : 'NO'}
          onChange={(event) => {
            const enabled = event.target.value === 'YES';
            // R1: the only place the decision changes. R4: หัก starts clean — empty value, no category, no red.
            setWithholdingEnabled(enabled); setWhtReveal(!enabled); setTaxFactsDirty(true); setError(null);
            if (!enabled) setValues((current) => changeExpenseReviewWhtInput(current, { inputType: 'RATE', value: '' }));
            else setValues((current) => ({ ...current, whtInput: { inputType: 'RATE', value: '' } }));
          }} disabled={!isMutable || busy}>
          <option value="NO">{t('expenses.wht_no', locale)}</option>
          <option value="YES">{t('expenses.wht_yes', locale)}</option>
        </ThemedSelect>
        <p id={`expense-wht-choice-hint-${detail.id}`} className="mt-1 text-xs text-gray-500 [text-wrap:pretty]">{t('expenses.wht_choice_hint', locale)}</p>
        {withholdingEnabled && (
          <div className="mt-3 grid grid-cols-1 gap-3">
            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700">
                <label htmlFor={`expense-payee-entity-kind-${detail.id}`}>{t('expenses.payee_entity_kind', locale)}</label>
              </span>
              <ThemedSelect id={`expense-payee-entity-kind-${detail.id}`} aria-label={t('expenses.payee_entity_kind', locale)} aria-describedby={`expense-payee-kind-hint-${detail.id}`} className={validationInputClass(payeeEntityKindIssue)} aria-invalid={payeeEntityKindIssue?.severity === 'error' || undefined} value={values.vendorEntityKindSnapshot ?? ''} onChange={(e) => { setTaxFactsDirty(true); setValues((v) => changeExpensePayeeType(v, e.target.value as BuyerEntityKind | '', whtCategories)); }} disabled={!isMutable || busy}>
                {!detail.vendorEntityKindSnapshot && <option value="">{t('expenses.category_unspecified', locale)}</option>}
                {Object.entries(PAYEE_ENTITY_KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </ThemedSelect>
              <p id={`expense-payee-kind-hint-${detail.id}`} className="mt-1 text-xs text-gray-500 [text-wrap:pretty]">{t('expenses.payee_entity_kind_hint', locale)}</p>
              <FieldIssueNote canEdit={isMutable} issue={payeeEntityKindIssue} />
              {whtWayOut(payeeEntityKindIssue)}
            </div>
            <div>
              <span className="mb-1 block text-sm font-medium text-gray-700">
                <label htmlFor={`expense-wht-category-${detail.id}`}>{t('expenses.wht_income_category', locale)}</label>
              </span>
              <ThemedSelect id={`expense-wht-category-${detail.id}`} aria-label={t('expenses.wht_income_category', locale)} aria-describedby={isMutable ? `expense-wht-category-hint-${detail.id}` : undefined} className={validationInputClass(whtCategoryIssue)} aria-invalid={whtCategoryIssue?.severity === 'error' || undefined} value={!isMutable || applicableWhtCategories.some((item) => item.code === values.whtCategoryCode) ? values.whtCategoryCode ?? '' : ''} onChange={(e) => {
                const code = e.target.value;
                const picked = applicableWhtCategories.find((item) => item.code === code);
                if (!picked) return;
                const rate = String(Number(picked.defaultRate));
                setTaxFactsDirty(true);
                setValues((v) => ({ ...v, whtCategoryCode: code, whtRate: rate,
                  whtInput: { inputType: 'RATE', value: rate, ...(v.whtInput?.baseAmount !== undefined && { baseAmount: v.whtInput.baseAmount }) } }));
              }} disabled={!isMutable || busy}>
                <option value="">{t('expenses.category_unspecified', locale)}</option>
                {!isMutable && values.whtCategoryCode && !applicableWhtCategories.some((item) => item.code === values.whtCategoryCode) && <option value={values.whtCategoryCode}>{t('expenses.wht_category_recorded', locale)}</option>}
                {expenseWhtCategoryOptions(applicableWhtCategories).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </ThemedSelect>
              {isMutable && <p id={`expense-wht-category-hint-${detail.id}`} className="mt-1 text-xs text-gray-500">{whtFilingRouteHint(whtCategories.find(category => category.code === values.whtCategoryCode)) ?? t('expenses.wht_income_category_editable_hint', locale)}</p>}
              <FieldIssueNote canEdit={isMutable} issue={whtCategoryIssue} />
              {whtWayOut(whtCategoryIssue)}
            </div>
            {whtCategoriesState === 'loading' && <p className="text-sm text-gray-600">{t('expenses.wht_categories_loading', locale)}</p>}
            {whtCategoriesState === 'error' && <p role="status" className="text-sm text-warning-700">{t('expenses.wht_categories_failed', locale)}</p>}
            {whtCategoriesState === 'ready' && Boolean(values.vendorEntityKindSnapshot) && applicableWhtCategories.length === 0 && <p role="status" className="text-sm text-warning-700">{t('expenses.wht_categories_empty', locale)}</p>}
            <div className="grid grid-cols-1 gap-3">
              <label>
                <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.wht_input_unit', locale)}</span>
                <ThemedSelect
                  aria-label={t('expenses.wht_input_unit', locale)}
                  className={validationInputClass(whtUnitIssue)}
                  aria-invalid={whtUnitIssue?.severity === 'error' || undefined}
                  value={whtInput.inputType}
                  onChange={(event) => { setTaxFactsDirty(true); setValues((current) => ({ ...current, whtInput: { ...current.whtInput, inputType: event.target.value as ExpenseWhtInput['inputType'], value: '0' } })); }}
                  disabled={!isMutable || busy}
                >
                  <option value="RATE">{t('expenses.wht_unit_percent', locale)}</option>
                  <option value="AMOUNT">{t('expenses.wht_unit_baht', locale)}</option>
                </ThemedSelect>
                <FieldIssueNote canEdit={isMutable} issue={whtUnitIssue} />
              </label>
              <label>
                <span className="mb-1 block text-sm font-medium text-gray-700">{t(whtInput.inputType === 'AMOUNT' ? 'expenses.wht_value_baht' : 'expenses.wht_value_percent', locale)}</span>
                <input
                  id={`expense-wht-rate-${detail.id}`}
                  aria-describedby={isMutable && whtInput.inputType === 'RATE' ? `expense-wht-value-hint-${detail.id}` : undefined}
                  type="text"
                  inputMode="decimal"
                  className={validationInputClass(whtValueIssue)}
                  aria-invalid={whtValueIssue?.severity === 'error' || undefined}
                  value={whtInput.value}
                  onChange={(event) => {
                    // R1/R2: editing the value never touches the decision or the category; an empty field
                    // is only a field being typed in, and "-" or letters never enter it.
                    const value = sanitizeExpenseWhtTyping(event.target.value);
                    setTaxFactsDirty(true); setError(null);
                    setValues((current) => ({ ...current, whtInput: { inputType: whtInput.inputType, value,
                      ...(current.whtInput?.baseAmount !== undefined && { baseAmount: current.whtInput.baseAmount }) } }));
                  }}
                  onFocus={() => setWhtValueFocused(true)}
                  onBlur={() => {
                    setWhtValueFocused(false); setWhtReveal(true);
                    setValues((current) => current.whtInput
                      ? { ...current, whtInput: { ...current.whtInput, value: normalizeExpenseWhtValue(current.whtInput.value) } } : current);
                  }}
                  disabled={!isMutable || busy}
                />
                <FieldIssueNote canEdit={isMutable} issue={whtValueIssue} />
                {whtWayOut(whtValueIssue)}
                {isMutable && whtInput.inputType === 'RATE' && <span id={`expense-wht-value-hint-${detail.id}`} className="mt-1 block text-xs text-gray-500">{t('expenses.wht_rate_hint', locale)}</span>}
              </label>
            </div>
            {!values.whtInput && documentWhtRate === null && <p className="mt-1 text-xs text-warning-700">{t('expenses.wht_multiple_rates_hint', locale)}</p>}
            {(Number(whtInput.value) > 0 || whtInput.baseAmount !== undefined) && <label className="mt-3 block">
              <span className="mb-1 block text-sm font-medium text-gray-700">{t('expenses.wht_base', locale)}</span>
              <input type="number" inputMode="decimal" min="0" step="0.01"
                aria-invalid={Boolean(whtBaseIssue)}
                className={validationInputClass(whtBaseIssue)}
                aria-describedby={`expense-wht-base-hint-${detail.id}`} value={whtInput.baseAmount ?? ''} disabled={!isMutable || busy} onBlur={() => setWhtReveal(true)}
                onChange={(event) => { setTaxFactsDirty(true); const base = event.target.value;
                  setValues((current) => { const next = { ...whtInput, ...current.whtInput };
                    if (base === '') delete next.baseAmount; else next.baseAmount = base;
                    return { ...current, whtInput: next }; }); }} />
              <FieldIssueNote canEdit={isMutable} issue={whtBaseIssue} />
              <span id={`expense-wht-base-hint-${detail.id}`} className="mt-1 block text-xs text-gray-500">{t('expenses.wht_base_hint', locale)}</span>
            </label>}

            {liveTotals?.status === 'ready' && liveTotals.totals
              ? <MoneyRow label={t('expenses.wht', locale)} value={liveTotals.totals.whtAmount} />
              : !isMutable
                ? <MoneyRow label={t('expenses.wht', locale)} value={detail.whtAmount} />
                : <p className="text-sm text-gray-600">{whtMissing.length > 0 ? 'เลือกให้ครบเพื่อคำนวณยอดหัก' : t(liveTotals?.status === 'error' ? 'expenses.wht_calculation_pending' : 'expenses.wht_calculating', locale)}</p>}
          </div>
        )}
      </fieldset>


      {totalIssues.map((issue, index) => <FieldIssueNote canEdit={isMutable} key={`${issue.messageKey}-${index}`} issue={issue} />)}

      {isMutable && busy && <p className="text-center text-xs text-gray-500">{t('expenses.saving', locale)}</p>}
    </MangmeeCard></div>
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
const GRID = 'grid grid-cols-[minmax(180px,1.6fr)_minmax(150px,1fr)_minmax(100px,0.7fr)_minmax(140px,1fr)_44px] items-center gap-3';
const LIST_PAGE_SIZE = 10;

export function ExpenseListPage({ companyId, caps, userId, onSelect, freeExpenseDrafts = false }: { companyId: string; caps: ExpenseCapabilities; userId: string; onSelect: (id: string) => void; freeExpenseDrafts?: boolean }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialListState = readExpenseListState(searchParams, civilPeriodKey(todayCivilDate()));
  const restoringList = useRef(searchParams.has('month'));
  const listPath = `/companies/${companyId}/expenses`;
  const gridClass = freeExpenseDrafts ? 'grid grid-cols-[minmax(180px,1.6fr)_minmax(150px,1fr)_minmax(100px,0.7fr)_44px] items-center gap-3' : GRID;
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
  // The list URL owns the filters and page, including a detail → list return and a reload.
  const [chip, setChip] = useState(initialListState.chip);
  const activeChip = freeExpenseDrafts ? 'all' : chip;
  const branchLabel = useBranchScopeLabel();
  // The backlog of tax invoices without a seller address matters only to a shop that records VAT.
  const listCapture = useExpenseCapturePolicy(companyId);
  const showsVatBacklog = showsTaxCapture(listCapture.mode);
  const [query, setQuery] = useState(initialListState.query);
  const [gran, setGran] = useMenuFilterState<'day' | 'month'>('expenses.list.gran', () => 'month');
  const [month, setMonth] = useState(initialListState.month);
  const [day] = useMenuFilterState('expenses.list.day', () => todayCivilDate());
  const requestedDay = searchParams.get('day') ?? searchParams.get('date') ?? (requestedFrom === requestedTo ? requestedFrom : null);
  useEffect(() => {
    if (restoringList.current) return;
    if (isCivilDate(requestedDay)) setMonth(expenseListMonth(requestedDay, civilPeriodKey(todayCivilDate())));
    else if (gran === 'day') setMonth(expenseListMonth(day, civilPeriodKey(todayCivilDate())));
    if (gran === 'day') setGran('month');
  }, [requestedDay, gran, day, setMonth, setGran]);
  const [page, setPage] = useState(initialListState.page);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [softwareResult, setSoftwareResult] = useState<AccountingSoftwareExportResult | null>(null);
  const [exportFormat, setExportFormat] = useMenuFilterState<AccountingExportFormat>('expenses.export.format', () => 'accountant');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteRetentionLocked, setDeleteRetentionLocked] = useState(false);
  // EXP-UX-01: `?highlight=<expenseId>` is written by ส่งให้ตรวจ. Always the id, never "the newest
  // row" — with two people submitting at once, "newest" points at somebody else's document.
  const highlightId = searchParams.get('highlight') ?? '';
  const [highlightReadyId, setHighlightReadyId] = useState('');
  useEffect(() => {
    if (!highlightId || sourceView || restoringList.current) return;
    let active = true;
    // A just-submitted backdated document must open in its document month, where the list now lives.
    void getExpense(companyId, highlightId)
      .then((expense) => {
        if (!active) return;
        const documentDate = expenseDocumentDateStatus(expense.aiVerificationSummaryJson) !== 'unverified' ? expense.expenseDate.slice(0, 10) : civilDate(new Date(expense.uploadedAt));
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
    : periodRange(month);
  const loadVersion = useRef(0);
  useEffect(() => { if (sourceView && !searchParams.has('chip') && !searchParams.has('query')) { setChip('all'); setQuery(''); } }, [sourceView, requestedFrom, requestedTo, setChip, setQuery]);

  const load = useCallback(async () => {
    if (highlightId && !sourceView && !restoringList.current && highlightReadyId !== highlightId) return;
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
        if (res.data.length === 0 || nextPage >= 50) throw new Error('โหลดรายการไม่ครบ เลือกช่วงวันที่ให้สั้นลง แล้วลองอีกครั้ง');
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

  const sourceRows = useMemo(() => rows.filter((row) => freeExpenseDrafts ? isFreeExpenseListDraft(row.status) : sourceView === 'pending' ? isExpensePendingReview(row)
    : sourceView === 'unpaid' ? row.status === 'CONFIRMED' && ['UNPAID', 'PARTIALLY_PAID'].includes(row.paymentStatus) : true), [rows, sourceView, freeExpenseDrafts]);
  const kpi = useMemo(() => summarizeExpenseKpis(sourceRows, todayCivilDate()), [sourceRows]);

  const chipCounts = useMemo(() => ({
    all: sourceRows.length,
    pending: sourceRows.filter((r) => freeExpenseDrafts ? isFreeExpenseListDraft(r.status) : isExpensePendingReview(r)).length,
    confirmed: freeExpenseDrafts ? 0 : sourceRows.filter((r) => r.status === 'CONFIRMED').length,
    closed: freeExpenseDrafts ? 0 : sourceRows.filter((r) => isExpenseCancelled(r.status)).length,
  }), [sourceRows, freeExpenseDrafts]);

  // Owner 2026-10-15: the list is in date order, newest first; the date header turns it round.
  const [dateOrder, setDateOrder] = useState(initialListState.dateOrder);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const day = (r: ExpenseSummary) => (r.dateStatus === 'unverified' ? r.uploadedAt : r.expenseDate) ?? r.uploadedAt ?? '';
    return sourceRows.filter((r) => {
      if (!freeExpenseDrafts && activeChip === 'pending' && !isExpensePendingReview(r)) return false;
      if (activeChip === 'confirmed' && r.status !== 'CONFIRMED') return false;
      if (activeChip === 'closed' && !isExpenseCancelled(r.status)) return false;
      if (!q) return true;
      return `${r.expenseNumber ?? ''} ${r.vendorNameSnapshot ?? ''} ${r.vendorDocumentNumber ?? ''}`.toLowerCase().includes(q);
    }).sort((a, b) => (dateOrder === 'newest' ? -1 : 1) * String(day(a)).localeCompare(String(day(b))));
  }, [sourceRows, activeChip, query, dateOrder, freeExpenseDrafts]);

  const previousFilters = useRef<string | null>(null);
  useEffect(() => {
    // A branch deep-link is applied by the existing scope control before recording the initial filters.
    if (requestedBranchId && branchFilter && !branchFilter.locked && branchId !== requestedBranchId && branchFilter.branches.some(b => b.id === requestedBranchId)) return;
    const key = JSON.stringify([chip, query, month, branchId, dateOrder]);
    if (previousFilters.current !== null && previousFilters.current !== key) setPage(1);
    previousFilters.current = key; setExportNotice(null); setSoftwareResult(null); setExported(false);
  }, [chip, query, month, branchId, dateOrder, requestedBranchId, branchFilter]);
  const listQuery = new URLSearchParams(searchParams.toString());
  if (branchId) listQuery.set('branchId', branchId); else listQuery.delete('branchId');
  const listUrl = expenseListUrl(listPath, listQuery, { month, chip, query, dateOrder, page });
  // The address follows what the person changes, never the first settle after loading: a replace at that
  // moment raced a menu press made as the list appeared and pulled the person back to the list.
  const settledListUrl = useRef<string | null>(null);
  useEffect(() => {
    if (loading || highlightId && !sourceView && !restoringList.current && highlightReadyId !== highlightId) return;
    if (settledListUrl.current === null) { settledListUrl.current = listUrl; return; }
    if (settledListUrl.current === listUrl) return;
    settledListUrl.current = listUrl;
    if (`${listPath}?${searchParams}` !== listUrl) router.replace(listUrl, { scroll: false });
  }, [listUrl, listPath, searchParams, router, loading, highlightId, sourceView, highlightReadyId]);
  const openListRow = (id: string) => router.push(expenseDetailUrl(listPath, id, listUrl));

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  useEffect(() => { if (!loading) setPage((current) => Math.min(current, totalPages)); }, [totalPages, loading]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, page]);

  // Land on the row, not near it: a highlight the user still has to hunt for through a chip, a
  // search box or a page number is no confirmation at all. Old submit links reveal their row;
  // a saved list URL instead keeps its filters and page. Once per id, then the user's filtering wins.
  useEffect(() => {
    if (!highlightId || restoringList.current || focusedHighlight.current === highlightId) return;
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
    if (loading || categoryNamesLoading || !highlightId || scrolledToHighlight.current === highlightId) return;
    const node = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="expenses-row"][data-highlighted], [data-testid="expenses-card"][data-highlighted]'),
    ).find((el) => el.offsetParent !== null);
    if (!node) return;
    scrolledToHighlight.current = highlightId;
    scrollExpenseListRow(node, window.innerHeight);
  }, [highlightId, pagedRows, loading, categoryNamesLoading]);
  const confirmTarget = rows.find((row) => row.id === confirmId);
  const confirmLabel = confirmTarget && expenseDeleteTargetLabel(confirmTarget);

  const removeExpense = async () => {
    if (!confirmTarget) return;
    setDeleting(true); setDeleteError(null);
    try {
      await deleteExpense(companyId, confirmTarget.id);
      setConfirmId(null);
      await load();
      toast.success(confirmLabel ? `ลบรายจ่าย ${confirmLabel} แล้ว` : 'ลบรายจ่ายแล้ว');
    } catch (e) {
      setDeleteError(expenseDeleteErrorMessage(e, locale, confirmTarget.status));
      setDeleteRetentionLocked(['SUBSTITUTE_EVIDENCE_RETENTION_LOCKED', 'EXPENSE_HAS_LINKED_DATA'].includes(apiErrorCode(e) ?? ''));
    }
    finally { setDeleting(false); }
  };

  const exportExcel = async (forceAccountant = false) => {
    if (exporting || freeExpenseDrafts || !caps.canExportPackage) return;
    const version = loadVersion.current;
    setExporting(true); setExportError(null); setExportNotice(null); setExported(false); setSoftwareResult(null);
    try {
      if (exportFormat === 'purchase_journal' && !forceAccountant) {
        const result = await createAccountingSoftwareExport(companyId, { preset: 'purchase_journal', status: activeChip === 'closed' ? 'VOIDED' : activeChip === 'pending' ? 'NEEDS_REVIEW' : 'CONFIRMED', dateField: 'expenseDate', fromDate, toDate, ...(branchId ? { branchId } : {}) });
        if (version !== loadVersion.current) return;
        setSoftwareResult(result); downloadAccountingSoftwareExport(result); return;
      }
      const result = await createAccountantPackage(companyId, { dateField: 'expenseDate', fromDate, toDate, ...(branchId ? { branchId } : {}) });
      if (version !== loadVersion.current) return;
      if (result.rowCount + (result.paymentRowCount ?? 0) + (result.withholdingRowCount ?? 0) === 0) { setExportNotice('ไม่มีรายการตามที่เลือก'); return; }
      if (result.truncated) setExportNotice(`ส่งออก ${result.rowCount} จากทั้งหมด ${result.totalMatched} รายการ — แบ่งช่วงวันที่ให้สั้นลงเพื่อส่งออกให้ครบ`);
      downloadIndexXlsx(result, result.indexFileName);
      setExported(true); setTimeout(() => setExported(false), 3000);
    } catch (e) {
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setExportError(err(e));
    }
    finally { setExporting(false); }
  };

  // Four groups whose names do not overlap: everything, what still waits, what is confirmed, what was closed.
  const chips: Array<{ key: 'all' | 'pending' | 'confirmed' | 'closed'; label: string }> = [
    { key: 'all', label: t('expenses.chip_all', locale) }, { key: 'pending', label: t('expenses.chip_pending', locale) },
    { key: 'confirmed', label: t('expenses.chip_confirmed', locale) }, { key: 'closed', label: 'ยกเลิก/ปฏิเสธ' },
  ];
  // Owner 2026-10-15: the list's numbers in one card above it, as on the home page (no icons, no second copy below the list).
  const amount = (value: number) => value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const metricItems = [
    { key: 'total', label: t('expenses.kpi_total', locale), value: amount(kpi.total), unit: 'บาท', note: `${kpi.counted} ${t('expenses.kpi_total_sub', locale)}`, dot: 'bg-[#5aa95c]', color: 'text-[#3e8a4f]' },
    { key: 'outstanding', label: 'ค้างจ่าย', value: amount(kpi.outstanding), unit: 'บาท', note: kpi.overdueCount > 0 ? `เกินกำหนด ${baht(kpi.overdue)} · ${kpi.overdueCount} ใบ` : t('expenses.kpi_outstanding_sub', locale), dot: 'bg-gray-400' },
    { key: 'vat', label: t('expenses.kpi_vat', locale), value: amount(kpi.vat), unit: 'บาท', note: t('expenses.kpi_vat_sub', locale), dot: 'bg-sky-400' },
  ];
  const searched = query.trim();
  const emptyState = searched
    ? <EmptyState title={`ไม่พบ “${searched}”`} action={<button type="button" className={ghostClass} onClick={() => setQuery('')}>ล้างคำค้น</button>} />
    : activeChip !== 'all' || sourceView
      ? <EmptyState title="ไม่มีรายการในกลุ่มนี้" />
      : <EmptyState title="ยังไม่มีรายจ่ายในช่วงที่เลือก" action={caps.canUploadReceipts ? <Link className={btnClass} href={`/companies/${companyId}/expenses/upload`}>อัปโหลดใบเสร็จ</Link> : undefined} />;
  const openDelete = (id: string) => { setDeleteError(null); setDeleteRetentionLocked(false); setConfirmId(id); };
  const statusBadges = (e: ExpenseSummary) => {
    if (freeExpenseDrafts) return <MangmeeBadge tone="amber">ร่าง</MangmeeBadge>;
    const status = expenseListStatus(e);
    return <><MangmeeBadge tone={status.tone}>{status.label}</MangmeeBadge>{!isExpenseCancelled(e.status) && showListedInputVatRight(e) && e.inputVatClaimStatus === 'NEEDS_REVIEW' && <MangmeeBadge tone="amber">ภาษีซื้อรอตรวจสอบ</MangmeeBadge>}</>;
  };
  const recordedOnAnotherDay = (e: ExpenseSummary) => dateShort(e.uploadedAt) !== dateShort(e.expenseDate);
  const canExportHere = canExportExpenseList(freeExpenseDrafts, caps) && (!sourceView || sourceView === 'confirmed');

  return (
    <div className="space-y-4">
      {!freeExpenseDrafts && sourceView && (
        <Notice tone="info" action={<button type="button" className={ghostClass} onClick={() => router.replace(`/companies/${companyId}/expenses`)}>กลับไปดูรายการตามเดือน</button>}>
          {sourceView === 'confirmed' ? `รายการยืนยันแล้ว · วันที่เอกสาร ${dateShort(fromDate)} – ${dateShort(toDate)}`
            : sourceView === 'pending' ? `${t('expenses.chip_pending', locale)} · ทุกเดือน`
              : sourceView === 'addressMissing' ? (addressMissingRange?.fromDate && addressMissingRange?.toDate
                  ? `${t('expenses.view_vendor_address_missing', locale)} · วันที่เอกสาร ${dateShort(addressMissingRange.fromDate)} – ${dateShort(addressMissingRange.toDate)}`
                  : t('expenses.view_vendor_address_missing', locale))
                : 'ค้างจ่ายที่ยืนยันแล้ว · ทุกเดือน'}
        </Notice>
      )}
      {/* The month and seller/document search are the list's filters. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {!sourceView && <ThemedDate mode="month" aria-label={t('expenses.document_date', locale)} className={cx(inputClass, 'w-auto min-w-36 shrink-0 whitespace-nowrap')} value={month} onChange={(e) => setMonth(e.target.value)} />}
        <div className="relative w-full sm:w-72">
          <input className={cx(inputClass, 'mangmee-input-icon-end w-full')} type="search"
            aria-label={t('expenses.search_placeholder', locale)}
            placeholder={t('expenses.search_placeholder', locale)}
            value={query} onChange={(e) => setQuery(e.target.value)} />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
            {ICON.search}
          </span>
        </div>
        {/* Owner 2026-10-15: the export sits next to the search. */}
        {canExportHere && <button type="button" className={ghostClass} aria-haspopup="dialog" onClick={() => setExportOpen(true)}>{EXPORT_FOR_ACCOUNTANT}</button>}
      </div>
      {!freeExpenseDrafts && <Modal open={exportOpen} onClose={() => setExportOpen(false)} title={EXPORT_FOR_ACCOUNTANT} size="sm"
        footer={exportError ? <>
          <button type="button" className={ghostClass} onClick={() => setExportOpen(false)}>กลับไปรายการค่าใช้จ่าย</button>
          <button type="button" className={btnClass} onClick={() => exportExcel()} aria-disabled={exporting} aria-busy={exporting}>
            {exporting ? t('expenses.generating', locale) : t('expenses.export_excel', locale)}
          </button>
        </> : <button type="button" className={btnClass} onClick={() => exportExcel()} aria-disabled={exporting} aria-busy={exporting}>
          {exporting ? t('expenses.generating', locale) : t('expenses.export_excel', locale)}
        </button>}>
        <div className="space-y-4">
          {/* What will be in the file, in one line: how many, which dates, which branch. */}
          <p className="text-sm text-gray-700">รายการที่ยืนยันแล้ว {chipCounts.confirmed} รายการ ตามวันที่เอกสาร · <span className="mangmee-unit">{dateShort(fromDate)}</span> – <span className="mangmee-unit">{dateShort(toDate)}</span>{branchLabel ? ` · ${branchLabel}` : ''}</p>
          <AccountingExportFormatSelect value={exportFormat} disabled={exporting} onChange={value => { setExportFormat(value); setSoftwareResult(null); setExportNotice(null); setExportError(null); setExported(false); }} />
          {exportFormat === 'purchase_journal' && !['all', 'confirmed'].includes(activeChip) && <div className="space-y-2">{!exportError && <p className="text-sm">{t('expenses.export_confirmed_only', locale)}</p>}<ActionGroup align="start"><button type="button" className={ghostClass} onClick={() => { setChip('confirmed'); setExportError(null); }}>{t('expenses.export_view_confirmed', locale)}</button></ActionGroup></div>}
          {softwareResult && <AccountingExportFeedback result={softwareResult} busy={exporting} onFallback={() => void exportExcel(true)} onChangeDates={() => setExportOpen(false)} />}
          <EvidenceBundleDownload companyId={companyId} enabled={exportOpen} showCounts onReturnToExpenses={() => setExportOpen(false)}
            request={{ fromDate, toDate, dateField: 'expenseDate', ...(branchId ? { branchId } : {}) }} />
          {exportError && <ErrorBanner message={exportError} />}
          {exportNotice && <div className="space-y-2">
            <p role="status" className="text-sm font-semibold text-warning-700">{exportNotice}</p>
            {exportNotice === 'ไม่มีรายการตามที่เลือก' && <button type="button" className={ghostClass} onClick={() => setExportOpen(false)}>เปลี่ยนช่วงวันที่</button>}
          </div>}
          {exported && <p role="status" className="text-sm font-semibold text-brand-600">✓ {t('expenses.downloaded', locale)}</p>}
        </div>
      </Modal>}

      {error ? <ErrorState description={error} onRetry={() => void load()} /> : <>
      {/* The numbers of the rows below, once, in one card (owner 2026-10-15). */}
      {!freeExpenseDrafts && <section className="mangmee-card p-4 sm:px-6 sm:py-5" data-testid="expenses-summary">
        <MetricGrid columns={3} items={metricItems} className="gap-2.5" />
      </section>}

      <MangmeeCard className="p-4">
          {!freeExpenseDrafts && <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:max-w-3xl">
            {chips.map((c) => (
              <button key={c.key} type="button" aria-pressed={activeChip === c.key} onClick={() => setChip(c.key)}
                className="mangmee-home-tab min-h-10 min-w-0 gap-2">
                {c.label}
                <span className={cx('tabular-nums text-xs', activeChip === c.key ? 'text-white/85' : 'text-gray-500')}>{chipCounts[c.key]}</span>
              </button>
            ))}
          </div>}

          {loading || categoryNamesLoading ? <LoadingState label="กำลังโหลด..." />
            : filtered.length === 0 ? emptyState
              : <>
          <div className="hidden xl:block">
          <div className="overflow-x-auto" data-testid="expenses-grid">
            <div className="min-w-[900px]">
              <div className={cx(gridClass, 'mt-3 border-b border-gray-100 px-2 pb-2 text-[13px] font-bold text-gray-500')}>
                <div>ผู้ขาย</div><div><button type="button" className="inline-flex items-center gap-1 hover:text-gray-800" onClick={() => setDateOrder(order => order === 'newest' ? 'oldest' : 'newest')}
                  aria-label={dateOrder === 'newest' ? 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่' : 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า'}>วันที่ <span aria-hidden="true">{dateOrder === 'newest' ? '↓' : '↑'}</span></button></div>{!freeExpenseDrafts && <div className="text-right">{t('expenses.col_total', locale)}</div>}<div className="text-right">{t('expenses.col_status', locale)}</div><div className="text-right"><span className="sr-only">การทำงาน</span></div>
              </div>
              {pagedRows.map((e) => (
                      <div key={e.id} onClick={() => openListRow(e.id)} data-testid="expenses-row"
                        {...(e.id === highlightId ? { 'data-highlighted': 'true' } : {})}
                        className={cx(gridClass, 'cursor-pointer border-b border-gray-50 px-2 py-3 transition hover:bg-gray-50',
                          e.id === highlightId && 'rounded-xl ring-2 ring-brand-500 bg-brand-25')}>
                        <div className="min-w-0">
                          <div className="text-[15px] font-semibold text-gray-900 [overflow-wrap:anywhere]">{firstFilled(e.vendorNameSnapshot) ?? t('expenses.vendor_pending', locale)}</div>
                          <div className="mt-0.5 text-xs text-gray-500"><span className="mangmee-unit">{firstFilled(e.expenseNumber) ?? t('expenses.number_pending', locale)}</span></div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500"><span className="mangmee-unit">{e.dateStatus === 'unverified' ? 'ยังไม่ระบุ' : dateShort(e.expenseDate)}</span></div>
                          {/* The day it was recorded is a second fact only when it is another day. */}
                          {recordedOnAnotherDay(e) && <div className="mt-0.5 text-xs text-gray-500"><span className="font-semibold">{t('expenses.intake_date', locale)}:</span> <span className="mangmee-unit">{dateShort(e.uploadedAt)}</span></div>}
                          <div className="mt-1 flex flex-wrap gap-1">
                            <LateDocumentBadge expense={e} locale={locale} />
                            <DocumentDateBadge expense={e} />
                          </div>
                        </div>
        {!freeExpenseDrafts && <div className="text-right text-[15px] font-bold text-gray-900"><span className="mangmee-unit">{amountText(e.grandTotalAmount)}</span></div>}
                        <div className="flex flex-col items-end gap-1">{statusBadges(e)}</div>
                        {/* A press on the row opens it; the only control of its own is the one that does something else. */}
                        <div className="flex items-center justify-end gap-1.5">
                          {!freeExpenseDrafts && canCancelExpenseInsteadOfDelete(e, caps) && <IconBtn title="ยกเลิกรายการ" tone="danger" onClick={(event) => { event.stopPropagation(); openListRow(e.id); }}><CloseIcon aria-hidden="true" className="h-4 w-4" /></IconBtn>}
                          {!freeExpenseDrafts && canDeleteExpense(e, userId, caps) && (
                            <IconBtn title="ลบ" tone="danger" onClick={(event) => { event.stopPropagation(); openDelete(e.id); }}>{ICON.trash}</IconBtn>
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
                  onClick={() => openListRow(e.id)}
                  data-testid="expenses-row"
                  {...(e.id === highlightId ? { 'data-highlighted': 'true' } : {})}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0 text-[15px] font-semibold text-gray-900 [overflow-wrap:anywhere]">{firstFilled(e.vendorNameSnapshot) ?? t('expenses.vendor_pending', locale)}</span>
                    {!freeExpenseDrafts && <span className="mangmee-unit shrink-0 text-base font-bold text-gray-900">{amountText(e.grandTotalAmount)}</span>}
                  </span>
                  <span className="mt-1 block text-sm text-gray-500">
                    <span className="mangmee-unit font-mono">{firstFilled(e.expenseNumber) ?? t('expenses.number_pending', locale)}</span>
                    {' · '}<span className="mangmee-unit">{e.dateStatus === 'unverified' ? 'ยังไม่ระบุ' : dateShort(e.expenseDate)}</span>
                    {recordedOnAnotherDay(e) && <>{' · '}{t('expenses.intake_date', locale)} <span className="mangmee-unit">{dateShort(e.uploadedAt)}</span></>}
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-1.5">
                    {statusBadges(e)}
                    <LateDocumentBadge expense={e} locale={locale} />
                    <DocumentDateBadge expense={e} />
                  </span>
                </button>
                {!freeExpenseDrafts && canCancelExpenseInsteadOfDelete(e, caps) && <div className="flex justify-end border-t border-gray-100 px-2 py-1"><button type="button" className={quietButtonClass} onClick={() => openListRow(e.id)}>ยกเลิกรายการ</button></div>}
                {/* On a phone the bin of the wide table does not exist; a draft the person may delete says so here. */}
                {!freeExpenseDrafts && canDeleteExpense(e, userId, caps) && (
                  <div className="flex justify-end border-t border-gray-100 px-2 py-1">
                    <button type="button" className={quietButtonClass} onClick={() => openDelete(e.id)}>ลบรายจ่ายนี้</button>
                  </div>
                )}
              </MangmeeCard>
            ))}
          </div>
          </>}
          {!loading && filtered.length > 0 && (
            <div className="px-2 pt-4 text-sm text-gray-500">
              {totalPages > 1 && <Pagination prominent page={page} totalPages={totalPages} onPageChange={setPage} />}
            </div>
          )}
      </MangmeeCard>
      </>}

      {/* §11.4: the way into "ใบกำกับที่ยังไม่มีที่อยู่ผู้ขาย", an accountant's backlog across every period. It is a
          quiet link under the list and only for a shop that records VAT; it used to sit among the status tabs. */}
      {showsVatBacklog && !sourceView && (
        <button type="button" className={quietButtonClass} onClick={() => router.replace(`/companies/${companyId}/expenses?view=addressMissing`)}>
          {t('expenses.chip_vendor_address_missing', locale)}
        </button>
      )}



      {/* A11Y-01: the shared Modal owns the dialog role, focus trap, Escape and the labelled close
          button. The hand-rolled overlay this replaces had none of them. */}
      <Modal
        open={Boolean(confirmTarget)}
        size="sm"
        title={confirmTarget ? `ลบรายจ่าย ${[confirmLabel, baht(confirmTarget.grandTotalAmount)].filter(Boolean).join(' · ')}?` : 'ลบรายจ่ายนี้?'}
        closeLabel={t('expenses.close', locale)}
        onClose={() => { if (!deleting) setConfirmId(null); }}
        footer={(
          <>
            <button type="button" className={ghostClass} disabled={deleting} onClick={() => setConfirmId(null)}>ไม่ลบ</button>
            {deleteRetentionLocked
              ? <button type="button" className={btnClass} onClick={() => { setConfirmId(null); if (confirmTarget) onSelect(confirmTarget.id); }}>{confirmTarget?.status === 'REJECTED' || confirmTarget?.status === 'VOIDED' ? 'เปิดรายจ่าย' : 'เปิดรายจ่ายเพื่อยกเลิก'}</button>
              : <button type="button" className={dangerClass} disabled={deleting} aria-busy={Boolean(deleting)} onClick={() => void removeExpense()}>{deleting ? 'กำลังลบ…' : 'ลบรายจ่าย'}</button>}
          </>
        )}
      >
        <div className="space-y-3">
          {!deleteRetentionLocked && <p className="text-sm text-gray-600">ลบแล้วกู้คืนไม่ได้</p>}
          {deleteError && <ErrorBanner message={deleteError} />}
        </div>
      </Modal>

    </div>
  );
}
export function ManualExpensePanel({ companyId, branchId, canAttachReceipt, entryClosed, permissions, onSuccess }: { companyId: string; branchId?: string; canAttachReceipt: boolean; entryClosed: boolean; permissions: string[]; onSuccess: (expenseId: string) => void }) {
  const locale = useWorkspaceLocale();
  const [payee, setPayee] = useState<{ name: string; id?: string }>({ name: '' });
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
  const [missing, setMissing] = useState<{ index: number; field: 'description' | 'unitPrice' } | null>(null);
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
    event.preventDefault(); setError('');
    // The button is always live. A press with something missing says what, under the first empty field, and puts the cursor there.
    if (!draftSave.current.body) {
      const at = items.findIndex((item) => !item.description.trim() || !(Number(item.unitPrice) > 0));
      if (at >= 0) {
        const field = items[at]!.description.trim() ? 'unitPrice' : 'description';
        setMissing({ index: at, field });
        const box = document.getElementById(`manual-item-${at}-${field}`);
        focusExpenseField(box);
        return;
      }
    }
    setBusy(true);
    try {
      if (!draftSave.current.body) {
        if (!branchId) throw new Error(t('transaction.source_branch_required', locale));
        const forbidden = findForbiddenChars(payee.name + items.map((item) => item.description).join(''));
        if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
        if (!(totals.grandTotal > 0)) throw new Error(t('expenses.manual_total_required', locale));
        draftSave.current.key ||= crypto.randomUUID();
        draftSave.current.body = {
          idempotencyKey: draftSave.current.key,
          captureSource: 'WEB_MANUAL', expenseDate, branchId, vatMode,
          ...(payee.name.trim() && { vendorNameSnapshot: payee.name.trim() }),
          ...(payee.id && { vendorCounterpartyId: payee.id }),
          lines,
        };
      }
      let result: ExpenseSummary;
      try { result = await createExpenseDraft(companyId, draftSave.current.body); }
      catch (cause) {
        // A validation refusal has not committed. A network/5xx outcome is ambiguous:
        // retain that exact command until its retry recovers the original expense.
        if ([400, 422].includes((cause as { status?: number }).status ?? 0)) draftSave.current.body = undefined;
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

  // Keep quantity, price and discount separate so the preview rounds each component as the server does.
  const totals = lines.reduce((sum, line) => {
    const lineTotals = calculateManualExpenseTotals({ ...line, vatMode });
    return { subtotal: sum.subtotal + lineTotals.subtotal, vat: sum.vat + lineTotals.vat, grandTotal: sum.grandTotal + lineTotals.grandTotal };
  }, { subtotal: 0, vat: 0, grandTotal: 0 });
  const amountReady = totals.grandTotal > 0;
  // A section says its name; an icon tile beside it carried nothing.
  const sectionTitle = (title: DictionaryKey, helper?: DictionaryKey) => (
    <div className="min-w-0">
      <h3 className="font-semibold text-gray-800">{t(title, locale)}</h3>
      {helper && <p className={FIELD_HINT}>{t(helper, locale)}</p>}
    </div>
  );
  const req = <span aria-hidden="true" className="text-error-500"> *</span>;
  return <div className="min-w-0 space-y-4">
    {/* The company stopped showing this page while the form was open (spec §7.2): the form stays and
        can be saved. Once the draft is saved there is no entry in progress left to speak of. */}
    {entryClosed && !savedExpenseId && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium leading-6 text-amber-900">{t('expenses.manual_entry_closed_notice', locale)}</p>}
    {error && <ErrorBanner message={error} focus />}
    {error && draftSave.current.body && !savedExpenseId && <p role="status" className="text-sm text-gray-600">ยังยืนยันผลการบันทึกไม่ได้ กดบันทึกซ้ำเพื่อตรวจคำสั่งเดิม แล้วเปิดรายการที่บันทึกไว้เพื่อแก้ไขต่อ</p>}
    {/* One column that fills the page; the total and the save button end the form in the page's action bar. */}
    <form onSubmit={submit} noValidate className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
      <div className="min-w-0 space-y-4">
        <MangmeeCard className="space-y-3 p-4">
          {sectionTitle('expenses.manual_items_section')}
          {items.map((item, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-gray-200">
              <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2">
                <span className="text-sm font-bold text-gray-600">{t('expenses.manual_item_n', locale).replace('{n}', String(index + 1))}</span>
                <span className="flex items-center gap-1.5">
                  {items.length > 1 && <span className="mangmee-unit text-sm font-semibold text-gray-500">{baht(itemNet(item))}</span>}
                  {items.length > 1 && (
                    <button type="button" aria-label={t('expenses.manual_remove_item', locale)} disabled={busy} aria-busy={Boolean(busy)} onClick={() => setItems((current) => current.filter((_, i) => i !== index))} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-error-50 hover:text-error-600">
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M3.5 5.5h13m-9.5 0v-1a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v1m-6.5 0 .6 10a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4l.6-10M8.2 8.5v5m3.6-5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                </span>
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 p-3 sm:grid-cols-3">
                <label className="sm:col-span-3"><span className={FIELD_LABEL}>{t('expenses.manual_description', locale)}{req}</span><input id={`manual-item-${index}-description`} className={cx(inputClass, missing?.index === index && missing.field === 'description' && 'border-error-500 ring-1 ring-error-500')} aria-invalid={(missing?.index === index && missing.field === 'description') || undefined} value={item.description} onChange={(event) => { setItem(index, { description: stripDisallowed(event.target.value) }); setMissing(null); }} />
                  {missing?.index === index && missing.field === 'description' && <span className="mt-1 block text-sm text-error-500">กรอกรายละเอียด</span>}</label>
                {/* Price and quantity are short and are read together: side by side at every width. */}
                <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                  <label><span className={FIELD_LABEL}>{t('expenses.manual_unit_price', locale)}{req}</span><input id={`manual-item-${index}-unitPrice`} type="number" min="0" step="0.0001" className={cx(inputClass, missing?.index === index && missing.field === 'unitPrice' && 'border-error-500 ring-1 ring-error-500')} aria-invalid={(missing?.index === index && missing.field === 'unitPrice') || undefined} value={item.unitPrice} onChange={(event) => { setItem(index, { unitPrice: normalizeDecimalInput(event.target.value) }); setMissing(null); }} />
                    {missing?.index === index && missing.field === 'unitPrice' && <span className="mt-1 block text-sm text-error-500">กรอกราคา</span>}</label>
                  <label><span className={FIELD_LABEL}>{t('expenses.manual_quantity', locale)}{req}</span><input type="number" min="0" step="0.0001" className={inputClass} value={item.quantity} onChange={(event) => setItem(index, { quantity: event.target.value })} /></label>
                </div>
                <label><span className={FIELD_LABEL}>{t('expenses.line_discount', locale)}</span><input type="number" min="0" step="0.0001" className={inputClass} value={item.discountAmount} onChange={(event) => setItem(index, { discountAmount: normalizeDecimalInput(event.target.value) })} /></label>
              </div>
            </div>
          ))}
          <button type="button" disabled={busy} onClick={() => setItems((current) => [...current, { description: '', quantity: '1', unitPrice: '', discountAmount: '0' }])} className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-gray-200 px-3 py-2.5 text-sm font-bold text-brand-700 transition hover:border-brand-300 hover:bg-brand-25">
            <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M10 4.5v11m-5.5-5.5h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            {t('expenses.manual_add_item', locale)}
          </button>
          <details className="rounded-xl border border-gray-200 px-3" open={Number(serviceCharge || '0') > 0 || undefined}>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-gray-700">{t('expenses.manual_service_charge', locale)} (ถ้ามี)</summary>
            <label className="block pb-3">
              <span className="sr-only">{t('expenses.manual_service_charge', locale)}</span>
              <input type="number" min="0" step="0.01" className={inputClass} aria-describedby="expense-manual-service-charge-helper" value={serviceCharge} onChange={(event) => setServiceCharge(event.target.value)} />
              <p id="expense-manual-service-charge-helper" className={FIELD_HINT}>{t('expenses.manual_service_charge_helper', locale)}</p>
            </label>
          </details>
        </MangmeeCard>
        <MangmeeCard className="space-y-3 p-4">
          {sectionTitle('expenses.manual_document_section')}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
            <ExpensePayeeField companyId={companyId} value={payee} canRead={permissions.includes(COUNTERPARTY_READ_PERMISSION)} disabled={busy || !!savedExpenseId} onChange={setPayee} />
            <label><span className={FIELD_LABEL}>{t('expenses.manual_date', locale)}{req}</span><ThemedDate aria-label={t('expenses.manual_date', locale)} aria-describedby="expense-manual-date-helper" className={inputClass} value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /><span id="expense-manual-date-helper" className="mt-1 block text-sm text-gray-500">{t('expenses.manual_date_helper', locale)}</span></label>
            <div className="sm:col-span-2">
              <span className={FIELD_LABEL}>{t('expenses.manual_receipt', locale)}</span>
              {canAttachReceipt ? <>
                <ThemedFile className="flex-wrap [&>span:last-child]:max-w-full" file={receiptFile} accept={RECEIPT_UPLOAD_ACCEPT} aria-describedby={!receiptFile && !preparingReceipt ? 'expense-manual-receipt-helper' : undefined} disabled={busy || preparingReceipt || !!savedExpenseId} loading={Boolean(busy || preparingReceipt)} onChange={(file) => void selectReceiptFile(file)} />
                {preparingReceipt ? <p className={FIELD_HINT}>{t('expenses.upload_preparing', locale)}</p>
                  : !receiptFile && <p id="expense-manual-receipt-helper" className={FIELD_HINT}>{t('expenses.manual_receipt_helper', locale)}</p>}
              </> : <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">{t('expenses.manual_receipt_forbidden', locale)}</p>}
            </div>
          </div>
        </MangmeeCard>
        {showsTaxCapture(capture.mode) && <MangmeeCard className="space-y-3 p-4">
          {sectionTitle('expenses.manual_tax_section', 'expenses.manual_tax_helper')}
          <TransactionTaxLineSelector hideWhenNothingToChoose companyId={companyId} branchId={branchId} sourceType="expense.record" sourceId="new-manual-expense" sourceLineId="line-1" transactionContext="DOMESTIC_PURCHASE" direction="INPUT" documentDate={expenseDate} netAmount={String(totals.subtotal)} grossAmount={String(totals.grandTotal)} enteredTaxAmount={String(totals.vat)} value={taxCodeDefinitionId} canConfigureTax={capture.canConfigureTax} onChange={(id, definition) => { setTaxCodeDefinitionId(id); setTaxCodeName(definition ? `${definition.externalCode} · ${definition.displayName}` : ''); setExternalTaxCode(definition?.externalCode); setVatRate(definition ? taxDefinitionRateForSource(definition.rate, 'expense') : ''); if (!vatModeTouched) setVatMode(!definition || definition.calculationMethod === 'NONE' ? 'NO_VAT' : definition.calculationMethod === 'INCLUSIVE' ? 'VAT_INCLUDED' : 'VAT_EXCLUDED'); }} />
          <div>
            <span className="mb-1 flex items-center gap-1.5 text-sm font-medium text-gray-700">
              <label htmlFor="manual-expense-vat-mode">{t('expenses.vat_mode', locale)}</label>
              <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_mode', locale)} />
            </span>
            <ThemedSelect id="manual-expense-vat-mode" aria-label={t('expenses.vat_mode', locale)} className={inputClass} value={vatMode} onChange={(event) => { setVatMode(event.target.value as ExpenseDetail['vatMode']); setVatModeTouched(true); }}>
              {Object.entries(EXPENSE_VAT_MODE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </ThemedSelect>
          </div>
        </MangmeeCard>}
      </div>
      <FormActionBar summary={
        // A number is shown once: the lines are above; the make-up of the total appears only when there is VAT to tell apart.
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <p className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-gray-700">{t('expenses.manual_total', locale)}</span>
            <span className="mangmee-unit text-xl font-bold text-gray-900">{baht(totals.grandTotal)}</span>
          </p>
          {totals.vat > 0 && <p className="text-sm text-gray-600">{t('expenses.manual_before_tax', locale)} <span className="mangmee-unit font-medium">{baht(totals.subtotal)}</span> · {t('expenses.vat', locale)} <span className="mangmee-unit font-medium">{baht(totals.vat)}</span></p>}
          {showsTaxCapture(capture.mode) && <MangmeeBadge tone={taxCodeDefinitionId ? 'purple' : 'slate'}>{taxCodeName || t('expenses.manual_no_tax_code', locale)}</MangmeeBadge>}
        </div>
      }>
        {savedExpenseId
          ? <ActionGroup><button type="button" className={btnClass} onClick={() => onSuccess(savedExpenseId)}>{t('expenses.manual_open_saved', locale)}</button></ActionGroup>
          : (
            // `item.unitPrice` is truthy for "0", so a ฿0 draft used to save happily here and was
            // only refused much later, by จัดทำใบรับรองแทนใบเสร็จ. The rule belongs to this form.
            <ActionGroup>
              <button disabled={busy || preparingReceipt} aria-busy={Boolean(busy)} className={btnClass}>{busy ? t('expenses.manual_saving', locale) : t('expenses.manual_save_draft', locale)}</button>
            </ActionGroup>
          )}
      </FormActionBar>
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

export function ExpensesHubPage({ companyId, userId, permissions, tab = 'list', manualEntryOpen, readerIsOwner = false, freeExpenseDrafts = false }: {
  companyId: string; userId: string; permissions: string[]; tab?: ExpensesTab;
  freeExpenseDrafts?: boolean;
  /** `canOpenManualWeb` of the server session, from the list and the manual page. Left out, the permission decides. */
  manualEntryOpen?: boolean;
  /** The reader holds the OWNER role: whom the not-shown state of the manual page sends them to. */
  readerIsOwner?: boolean;
}) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const branchFilter = useBranchFilter();
  const branchId = branchFilter?.branchId ?? '';
  const createBranchId = useTransactionCreateBranchId();
  const [branchTouched, setBranchTouched] = useState(false);
  const toast = useToast();
  const caps = expenseCapabilities(expenseUiPermissions(permissions, freeExpenseDrafts));
  // The manual page's admission (spec §7.1): a state of this mounted page, taken from the prop the
  // server sent and never withdrawn — the server renders this hub whatever the setting says, so a
  // `router.refresh()` after the admin switches the menu off changes the prop and keeps the form.
  const canOpenManual = manualEntryOpen ?? caps.canCreate;
  const [manualAdmitted, setManualAdmitted] = useState(canOpenManual);
  const manualAdmittedNow = nextManualEntryAdmission(manualAdmitted, canOpenManual);
  if (manualAdmittedNow !== manualAdmitted) setManualAdmitted(manualAdmittedNow);
  const manualView = manualEntryView(manualAdmittedNow, canOpenManual);
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
  // Outside the branch field and its disabled fieldset below, so this state's own links are never
  // answered with the form's "choose a branch first".
  const manualNotEnabled = tab === 'manual' && !forbidden && manualView === 'not_enabled';
  // The categories page's one action sits beside its title; the panel owns the dialog it opens.
  const [categoryCreateOpen, setCategoryCreateOpen] = useState(false);

  return (
    <MangmeePage
      eyebrow={tab === 'list' || tab === 'upload' || tab === 'evidence' || tab === 'categories' ? undefined : t('expenses.eyebrow', locale)}
      className={tab === 'list' || tab === 'upload' || tab === 'evidence' || tab === 'categories' ? 'mangmee-flat' : undefined}
      title={t(meta.labelKey, locale)}
      actions={tab === 'categories' && !forbidden ? <button type="button" className={btnClass} onClick={() => setCategoryCreateOpen(true)}>เพิ่มหมวดหมู่</button> : undefined}
      // The description tells the reader what to fill in; with no form to fill, or no right to the page, it would be
      // untrue. The list needs none: its title says what it is.
      description={manualNotEnabled || forbidden || tab === 'list' || tab === 'evidence' || tab === 'categories' ? undefined : t(meta.descKey, locale)}
    >
      {forbidden ? (
        // A refusal carries its way out: one link back to a page this person can use.
        <StateBanner error="Forbidden" action={canAccessExpenseTab('list', caps) && tab !== 'list'
          ? <Link className={ghostClass} href={`/companies/${companyId}/expenses`}>{t('expenses.back_to_list', locale)}</Link>
          : <Link className={ghostClass} href={`/companies/${companyId}/dashboard`}>กลับไปแดชบอร์ด</Link>} />
      ) : manualNotEnabled ? <ManualExpenseEntryNotEnabled companyId={companyId} caps={caps} readerIsOwner={readerIsOwner} /> : (
        <>
          {tab === 'list' && <ExpenseListPage companyId={companyId} key={companyId} caps={caps} userId={userId} freeExpenseDrafts={freeExpenseDrafts} onSelect={openListExpense} />}
          {(tab === 'upload' || tab === 'manual') && <>
            {/* The branch field shares the edges of the cards under it. */}
            {tab === 'manual' && <TransactionBranchField fill value={createBranchId} invalid={!createBranchId && branchTouched} helpText={createBranchId ? null : t('transaction.source_branch_manual_required', locale)} />}
            {/* Owner report 2026-08-28: with several branches and the all-branches filter on, this panel is
                disabled — pressing อัปโหลด did nothing and said nothing. The field itself now reads as an
                error, and pressing the dead panel says why instead of leaving a standing banner on screen.
                A single-branch company defaults to its branch and never reaches this. */}
            <div onClickCapture={() => {
              if (createBranchId || tab !== 'manual') return;
              setBranchTouched(true);
              // Said in the words of the page the person is on: nothing is filled in on the upload page.
              toast.error('เลือกสาขาก่อน จึงจะกรอกได้');
              // Scroll only, never focus: focusing the control opens its picker, which reads as the
              // page acting for the user (Owner report 2026-08-29). The field's invalid styling and
              // the toast already say what to do. The tag now sits on the field wrapper — the
              // control itself is a ThemedSelect, not a <select>.
              const field = document.querySelector<HTMLElement>('[data-transaction-branch-select]');
              focusExpenseField(field);
            }}>
            <fieldset disabled={tab === 'manual' && !createBranchId} className={cx('min-w-0', tab === 'manual' && !createBranchId && 'pointer-events-none')}>
              {tab === 'upload' && <UploadPanel companyId={companyId} branchId={createBranchId} userId={userId} caps={caps} canManagePlan={!freeExpenseDrafts && permissions.includes('company.plan.manage')} freeExpenseDrafts={freeExpenseDrafts} onSuccess={(expenseId, notice) => { storeExtractionNotice(expenseId, notice); openListExpense(expenseId); }} onBatchSuccess={(created) => { for (const row of created) storeExtractionNotice(row.expenseId, row.notice); router.push(`/companies/${companyId}/expenses?highlight=${encodeURIComponent(created.at(-1)!.expenseId)}`); }} />}
              {tab === 'manual' && <ManualExpensePanel permissions={permissions} companyId={companyId} branchId={createBranchId} canAttachReceipt={caps.canUploadReceipts && permissions.includes('attachment.create')} entryClosed={manualView === 'form_closed'} onSuccess={openListExpense} />}
            </fieldset>
            </div>
          </>}
          {tab === 'categories' && <CategoryManagePanel companyId={companyId} key={companyId} freeExpenseDrafts={freeExpenseDrafts} createOpen={categoryCreateOpen} onCreateOpenChange={setCategoryCreateOpen} />}
          {tab === 'signatures' && <SignaturePanel companyId={companyId} {...(focusSignatureId ? { focusSignatureId } : {})} />}
          {tab === 'evidence' && <EvidencePanel companyId={companyId} key={companyId} freeExpenseDrafts={freeExpenseDrafts} canExport={caps.canExportPackage} canReadLedger={caps.canReadLedger} canPostLedger={caps.canPostLedger} canPostClaimPayments={caps.canPostLedger && permissions.includes('reimbursement.finance_review')} />}
        </>
      )}
    </MangmeePage>
  );
}
