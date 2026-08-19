'use client';

import { Fragment, useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent, type DragEvent, type FormEvent, type MutableRefObject, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { InfoTip } from '@/common/components/field/InfoTip';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { CoverLoader, LoadingState } from '@/common/components/state';
import {
  listExpenses, getExpense, initReceiptUpload, completeReceiptUpload,
  confirmExpense, rejectExpense, voidExpense, markExpenseReady, markExpenseReadyAsReviewer, recordExpensePayment, runDuplicateCheck, dismissDuplicate,
  uploadReceiptFile, updateExpenseDraft, generateSubstituteReceipt, listExpenseCategories,
  updateExpenseReviewFields, uploadExpenseEvidenceFile, previewSubstituteReceipt,
  approveSubstituteReceipt, certifySubstituteReceipt, completePersonalSignatureUpload, initPersonalSignatureUpload, listSubstituteReceiptPayers,
  createAccountantPackage, downloadIndexXlsx, downloadSubstituteReceiptPdf, fetchAttachmentPreviewBlob, fetchSubstituteReceiptPdfBlob, requestExpenseExtraction, overrideNonExpenseClassification,
  listSubstituteReceiptHistory, supersedeSubstituteReceipt,
  getSubstituteReceiptRuntimePolicy,
  createExpenseDraft, deleteExpense,
} from './expenses.api';
import {
  EXPENSE_VAT_MODE_LABELS, CAPTURE_SOURCE_LABELS, PAYMENT_METHOD_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, buildExpenseDraftReviewPayload,
  deriveExpenseClassificationReviewState, hasAiGrandTotalMismatch, hasUnresolvedDuplicateWarning,
  findOpaqueBounds, removeLightBackground, allowsDomesticInputTaxCode, clearExpenseTaxSelections,
  TAX_EVIDENCE_REASON_LABELS, AI_SUMMARY_STATUS_LABELS, AI_MISSING_FIELD_LABELS,
  ATTACHMENT_PURPOSE_LABELS, MIME_TYPE_LABELS, SUBSTITUTE_RECEIPT_STATUS_LABELS, expenseValueLabel,
  deriveExpenseAuditChecks, deriveExpenseReviewSteps, initialExpenseReviewStep, expenseSubstituteReceiptReady, expenseNeedsReceiptOrSubstitute, expenseCapabilities,
  calculateManualExpenseTotals, buildManualExpenseLines, canAccessExpenseTab, canDeleteExpense, expenseDeleteErrorMessage,
  expenseDeleteTargetLabel, firstFilled, isExpensePending, summarizeExpenseKpis,
  lateDocumentDays,
  POSTING_STATUS_LABELS, aiGrandTotalValue, expenseAiFieldProvenance, expenseRatePercent, expenseDocumentWhtRate,
  vatRatePreset, vatRatePresetValue, expensePercentToRate, expenseRateToPercent,
  vatRateFromPrintedAmount, effectiveVatRateLabel, vatModeRequiresRate,
  PAYEE_ENTITY_KIND_LABELS, AI_SUGGESTION_FIELD_LABELS, applyExpenseAiSuggestion, expenseAiSuggestion,
  formatTaxId, taxIdDigits,
} from './expenses.model';
import type { AiReviewField, ExpenseAiSuggestion, ExpenseSummary, ExpenseDetail, ExpenseDraftReviewValues, ExpenseCategorySummary, ExpenseReviewStepKey, ExpenseCapabilities, ExpensesTab, ManualExpenseItem } from './expenses.model';
import type { BusinessDocumentClassification, BuyerEntityKind, ExpenseExtractionResult, SubstituteReceiptEvidenceSummary, SubstituteReceiptRuntimePolicy } from '@watchdog-bms/contracts';
import { CategoryManagePanel, SignaturePanel, EvidencePanel, IconBtn } from './ExpensesWorkspacePanels';
import { useBranchFilter } from '../web-core-workspace/WorkspaceScope';
import { isBranchScope403 } from '../web-core-workspace/branch-scope-label.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale, DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { findForbiddenChars, REASON_MAX_LENGTH, sanitizeReasonInput, stripDisallowed } from '@/common/forms/sanitize';
import {
  ATTACHMENT_UPLOAD_ACCEPT,
  IMAGE_UPLOAD_ACCEPT,
  assertAllowedUploadFile,
  uploadErrorMessage,
} from '@/common/files/upload-file.logic';
import { TransactionTaxLineSelector } from '@/features/tax/TransactionTaxLineSelector';
import { taxDefinitionRateForSource } from '@/features/tax/transaction-tax.model';
import {
  classifyUploadFile, HeicDecodeError, MAX_PDF_EXTRACTION_BYTES, prepareReceiptFile, RECEIPT_UPLOAD_ACCEPT,
} from './expense-upload.logic';
import {
  err, baht, baht0, dateShort, inputClass, btnClass, ghostClass, dangerClass, successBtn, successBtnStyle,
  ICON, KPI, StatCard, StatusBadge, TAX_TONE, ErrorBanner, InfoBanner, StateBanner,
} from './ExpensesUi';
import { generateSourceJournal } from '../ledger/ledger.api';
import { validateExpenseReview, type ExpenseFieldIssue } from './expense-review-validation';
import { useMenuFilterState } from '../web-core-workspace/MenuFilterScope';
import { hasRecordedTax, showsTaxCapture, useExpenseCapturePolicy } from './expense-capture-policy';
import { mayApproveSubstituteReceipt } from './substitute-receipt-wizard.model';
import { civilPeriodKey, todayCivilDate } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';

// ── period control (day / month) ─────────────────────────────────────────────
type Gran = 'day' | 'month';
function periodRange(gran: Gran, month: string, day: string): { fromDate: string; toDate: string } {
  if (gran === 'day') return { fromDate: day, toDate: day };
  const [y, m] = month.split('-').map((n) => parseInt(n, 10));
  const last = new Date(y!, m!, 0).getDate();
  return { fromDate: `${month}-01`, toDate: `${month}-${String(last).padStart(2, '0')}` };
}

function LateDocumentBadge({ expense, locale }: { expense: ExpenseSummary; locale: SupportedLocale }) {
  const days = lateDocumentDays(expense);
  return days === null
    ? null
    : <MangmeeBadge tone="amber">{messageWithParams(t('expenses.late_document_days', locale), { days: String(days) })}</MangmeeBadge>;
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

export function AiFieldLabel({ label, field, summary }: { label: ReactNode; field: AiReviewField; summary: Record<string, unknown> | null }) {
  const locale = useWorkspaceLocale();
  const provenance = expenseAiFieldProvenance(summary, field);
  return (
    <>
      {label}
      {provenance?.recognized && <span className="ml-1 inline-flex rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700" title={t('expenses.ai_field_source', locale)}>🤖</span>}
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
  return { tone: 'error', message: t('expenses.extract_failed', locale) };
}

// ── Upload Panel (info strip + dropzone + LINE gradient card) ─────────────────
function UploadPanel({ companyId, branchId, onSuccess, onNoDocument }: { companyId: string; branchId?: string; onSuccess: (expenseId: string, notice: ExtractionNotice) => void; onNoDocument?: () => void }) {
  const locale = useWorkspaceLocale();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [expenseDate, setExpenseDate] = useState(todayCivilDate());
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileNotice, setFileNotice] = useState<string | null>(null);

  const selectFile = async (file: File | null) => {
    setSelectedFile(null); setFileName(''); setFileNotice(null); setError(null);
    if (!file) return;
    if (classifyUploadFile(file.name, file.type) === 'unsupported') {
      setError(t('expenses.upload_unsupported_file', locale));
      return;
    }
    setPreparing(true);
    try {
      const prepared = await prepareReceiptFile(file);
      setSelectedFile(prepared.file);
      setFileName(prepared.file.name);
      if (prepared.resized) setFileNotice(`${t('expenses.upload_resized', locale)} ${(prepared.file.size / 1024 / 1024).toFixed(2)} MB`);
      else if (classifyUploadFile(prepared.file.name, prepared.file.type) === 'pdf' && prepared.file.size > MAX_PDF_EXTRACTION_BYTES) {
        setFileNotice(t('expenses.upload_pdf_too_large', locale));
      }
    } catch (cause) {
      setError(cause instanceof HeicDecodeError ? t('expenses.upload_heic_unsupported', locale) : uploadErrorMessage(cause));
    } finally {
      setPreparing(false);
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    void selectFile(event.target.files?.[0] ?? null);
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
    const droppedFile = event.dataTransfer.files?.[0] ?? null;
    if (droppedFile) void selectFile(droppedFile);
  };

  const handleUpload = async () => {
    const file = selectedFile;
    if (!file) { setError(t('expenses.upload_select_file_error', locale)); return; }
    const forbidden = findForbiddenChars(note);
    if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
    setLoading(true); setError(null);
    try {
      const intent = await initReceiptUpload(companyId, { originalFileName: file.name, mimeType: file.type, byteSize: file.size, expenseDate, ...(branchId ? { branchId } : {}), note: note.trim() });
      await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders);
      await completeReceiptUpload(companyId, intent.expenseId, intent.attachmentId, { byteSize: file.size });
      setExtracting(true);
      let notice: ExtractionNotice;
      // A long extraction can outlive the response (proxy cut, dropped connection) AFTER the API
      // applied it; re-read before retrying so a finished extraction is not re-run — a re-run costs
      // AI spend and rewrites aiVerificationSummaryJson, wiping review acknowledgements.
      const recoveredNotice = async (): Promise<ExtractionNotice | null> => {
        const applied = await getExpense(companyId, intent.expenseId).catch(() => null);
        if (!applied?.aiVerificationSummaryJson) return null;
        return extractionNotice({ status: 'ok', fields: {
          vendorName: applied.vendorNameSnapshot ?? undefined,
          documentNumber: applied.vendorDocumentNumber ?? undefined,
          expenseDate: applied.expenseDate ?? undefined,
          grandTotalAmount: applied.grandTotalAmount ?? undefined,
        } }, locale);
      };
      try {
        let result: ExpenseExtractionResult | null = null;
        try {
          result = await requestExpenseExtraction(companyId, intent.expenseId);
        } catch { /* recovery-checked below, then retried once */ }
        if (!result || result.status === 'failed') {
          const recovered = await recoveredNotice();
          if (recovered) {
            notice = recovered;
          } else {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            result = await requestExpenseExtraction(companyId, intent.expenseId);
            notice = extractionNotice(result, locale);
          }
        } else {
          notice = extractionNotice(result, locale);
        }
      } catch (e) {
        notice = (await recoveredNotice())
          ?? { tone: 'error', message: `${t('expenses.upload_extract_failed_prefix', locale)} — ${err(e)} ${t('expenses.upload_extract_failed_suffix', locale)}` };
      }
      onSuccess(intent.expenseId, notice);
    } catch (e) { setError(err(e)); }
    finally { setLoading(false); setExtracting(false); }
  };

  const flow = [t('expenses.flow_upload', locale), t('expenses.flow_ai_read', locale), t('expenses.flow_confirm', locale)];
  const uploadPhase = preparing
    ? t('expenses.upload_phase_preparing', locale)
    : extracting
      ? t('expenses.upload_phase_extracting', locale)
      : loading ? t('expenses.upload_phase_uploading', locale) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-brand-100 bg-brand-25 p-4 text-center">
        <div className="text-left text-base font-bold text-gray-900">{t('expenses.upload_what_title', locale)}</div>
        <div className="mt-1 text-left text-sm leading-relaxed text-gray-600">{t('expenses.upload_what_desc', locale)}</div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-3">
          {flow.map((s, i) => (
            <span key={s} className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-2 rounded-xl border border-brand-100 bg-white px-3.5 py-2 text-sm font-semibold text-gray-700">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-xs font-extrabold text-white">{i + 1}</span>{s}
              </span>
              {/* Drawn, not the → glyph: the shaft length is exact and font-independent. */}
              {i < flow.length - 1 && (
                <svg aria-hidden="true" viewBox="0 0 36 12" className="hidden h-3 w-9 flex-shrink-0 text-brand-300 sm:block"
                  fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 6h33M30 2l4 4-4 4" />
                </svg>
              )}
            </span>
          ))}
        </div>
      </div>

      <MangmeeCard className="p-6">
        {error && <div className="mb-4"><ErrorBanner message={error} /></div>}
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
            <input type="file" accept={RECEIPT_UPLOAD_ACCEPT} className="sr-only" onChange={handleFileChange} />
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
          <input ref={fileRef} type="file" accept={RECEIPT_UPLOAD_ACCEPT} className="hidden" onChange={handleFileChange} />
        </label>
        {fileNotice && <div className="mt-3"><InfoBanner message={fileNotice} /></div>}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-semibold text-gray-600">{t('expenses.upload_receipt_date', locale)}</div>
            <ThemedDate className={inputClass} value={expenseDate} onChange={(e) => setExpenseDate(e.target.value)} />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-semibold text-gray-600">{t('expenses.upload_note', locale)}</div>
            <input className={inputClass} placeholder={t('expenses.upload_note_placeholder', locale)} value={note} onChange={(e) => setNote(stripDisallowed(e.target.value))} />
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px]" style={{ background: '#F4EBFF', color: '#7A5AF8' }}>{ICON.sparkle}</span>
          <p className="text-sm leading-relaxed text-gray-600">{t('expenses.upload_ai_strip_before', locale)}<b className="text-gray-800">{t('expenses.upload_ai_strip_bold', locale)}</b>{t('expenses.upload_ai_strip_after', locale)}</p>
        </div>
        <button className={cx(btnClass, 'mt-5 h-12 w-full text-base')} onClick={handleUpload} disabled={loading || preparing}>
          <span className="inline-flex items-center justify-center gap-2">
            {(preparing || loading || extracting) && <InlineSpinner />}
            {extracting ? t('expenses.ai_reading', locale) : preparing ? t('expenses.upload_preparing', locale) : loading ? t('expenses.uploading', locale) : t('expenses.upload_cta', locale)}
          </span>
        </button>
        {uploadPhase && <p className="mt-2 text-center text-sm font-semibold text-brand-700">{uploadPhase}</p>}
        {onNoDocument && (
          <button type="button" className="mt-3 w-full text-center text-sm font-semibold text-brand-600 hover:underline" onClick={onNoDocument}>
            {t('expenses.upload_no_document_link', locale)}
          </button>
        )}
      </MangmeeCard>
    </div>
  );
}

// ── Document type / tax evidence review + substitute + signature fill ─────────
export function DocumentReviewSection({ companyId, detail, isMutable, canReview, canConfirm, userId, canSelfApprove, onSaved, onOpenFile }: { companyId: string; detail: ExpenseDetail; isMutable: boolean; canReview: boolean; canConfirm: boolean; userId: string; canSelfApprove: boolean; onSaved: () => Promise<void>; onOpenFile: (file: { name: string; mimeType: string; url: string; hideOpenNewTab?: boolean; onViewed?: () => void }) => void }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const [docType, setDocType] = useState(detail.sourceDocumentType);
  const [taxStatus, setTaxStatus] = useState(detail.taxEvidenceStatus);
  const [categoryId, setCategoryId] = useState<string>(detail.expenseCategoryId ?? '');
  const [categories, setCategories] = useState<ExpenseCategorySummary[]>([]);
  const [subReason, setSubReason] = useState(detail.missingReceiptReason ?? '');
  const [subPurpose, setSubPurpose] = useState(detail.note ?? '');
  const [subReasonCode, setSubReasonCode] = useState<'PAYEE_CANNOT_ISSUE' | 'RECEIPT_UNAVAILABLE' | 'RECEIPT_MATERIALLY_INCOMPLETE' | 'OTHER'>('PAYEE_CANNOT_ISSUE');
  const [payerId, setPayerId] = useState(userId);
  const [payerCandidates, setPayerCandidates] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [selectedSupportingIds, setSelectedSupportingIds] = useState<string[]>([]);
  const [selectedPaymentIds, setSelectedPaymentIds] = useState<string[]>([]);
  const [subPaymentMethod, setSubPaymentMethod] = useState(detail.paymentMethod ?? 'CASH');
  const [subPaymentDate, setSubPaymentDate] = useState(detail.paidAt?.slice(0, 10) ?? todayCivilDate());
  const [supportingUploadFile, setSupportingUploadFile] = useState<File | null>(null);
  const [paymentUploadFile, setPaymentUploadFile] = useState<File | null>(null);
  const [signerPosition, setSignerPosition] = useState('');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [cleanedSignatureFile, setCleanedSignatureFile] = useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<{ original: string; cleaned: string } | null>(null);
  const [previewChecksum, setPreviewChecksum] = useState<string | null>(null);
  const [certifiedPreviewed, setCertifiedPreviewed] = useState(false);
  const previewRequestRef = useRef(0);
  const previewScope = [
    companyId,
    detail.id,
    detail.substituteReceiptEvidence?.id ?? '',
    detail.substituteReceiptEvidence?.updatedAt ?? '',
  ].join('\u0000');
  const previewScopeRef = useRef(previewScope);
  previewScopeRef.current = previewScope;
  const [evidenceHistory, setEvidenceHistory] = useState<SubstituteReceiptEvidenceSummary[]>([]);
  const [evidenceHistoryLoading, setEvidenceHistoryLoading] = useState(canReview);
  const [supersedeReason, setSupersedeReason] = useState('');
  const [payerState, setPayerState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [substitutePolicy, setSubstitutePolicy] = useState<SubstituteReceiptRuntimePolicy | null>(null);
  const [substitutePolicyState, setSubstitutePolicyState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [classificationOverrideReason, setClassificationOverrideReason] = useState('');
  const [showSub, setShowSub] = useState(Boolean(detail.missingReceiptReason));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const assertAllowed = (...values: string[]) => {
    const forbidden = findForbiddenChars(values.join(''));
    if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
  };

  useEffect(() => {
    setDocType(detail.sourceDocumentType); setTaxStatus(detail.taxEvidenceStatus); setCategoryId(detail.expenseCategoryId ?? '');
  }, [detail.sourceDocumentType, detail.taxEvidenceStatus, detail.expenseCategoryId]);
  // Same server-truth sync: the substitute draft below is saved on blur, and this card is rendered
  // twice (evidence step + review step), so both instances must follow the stored values.
  useEffect(() => { setSubReason(detail.missingReceiptReason ?? ''); }, [detail.missingReceiptReason]);
  useEffect(() => { setSubPurpose(detail.note ?? ''); }, [detail.note]);
  useEffect(() => {
    void listExpenseCategories(companyId).then(setCategories).catch(() => setCategories([]));
    if (canReview) {
      setPayerState('loading');
      void listSubstituteReceiptPayers(companyId, detail.id).then((rows) => {
        setPayerCandidates(rows);
        setPayerId((current) => rows.some((row) => row.userId === current) ? current : (rows[0]?.userId ?? ''));
        setPayerState('loaded');
      }).catch(() => { setPayerCandidates([]); setPayerId(''); setPayerState('error'); });
    }
    if (canReview || canConfirm) {
      setSubstitutePolicyState('loading');
      void getSubstituteReceiptRuntimePolicy(companyId)
        .then((policy) => { setSubstitutePolicy(policy); setSubstitutePolicyState('loaded'); })
        .catch(() => { setSubstitutePolicy(null); setSubstitutePolicyState('error'); });
    }
  }, [canConfirm, canReview, companyId, detail.id]);
  useEffect(() => {
    if (!detail.substituteReceiptEvidence) {
      setSelectedSupportingIds(detail.attachments.filter((attachment) => attachment.status === 'ACTIVE' && attachment.purpose !== 'expense.review.evidence' && attachment.purpose !== 'expense.payment.evidence').map((attachment) => attachment.id));
      setSelectedPaymentIds(detail.attachments.filter((attachment) => attachment.status === 'ACTIVE' && attachment.purpose === 'expense.payment.evidence').map((attachment) => attachment.id));
    }
  }, [detail.attachments, detail.substituteReceiptEvidence]);
  useEffect(() => {
    previewRequestRef.current += 1;
    setPreviewChecksum(null);
    setCertifiedPreviewed(false);
    return () => { previewRequestRef.current += 1; };
  }, [companyId, detail.id, detail.substituteReceiptEvidence?.id, detail.substituteReceiptEvidence?.updatedAt]);
  useEffect(() => {
    if (!canReview) { setEvidenceHistoryLoading(false); return; }
    let cancelled = false;
    setEvidenceHistoryLoading(true);
    void listSubstituteReceiptHistory(companyId, detail.id)
      .then((items) => { if (!cancelled) setEvidenceHistory(items); })
      .catch(() => { if (!cancelled) setEvidenceHistory([]); })
      .finally(() => { if (!cancelled) setEvidenceHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [canReview, companyId, detail.id, detail.substituteReceiptEvidence?.updatedAt]);

  const run = async (fn: () => Promise<unknown>, doneText: string, refresh = true, inline = false) => {
    setBusy(true); setError(null); setInfo(null);
    try {
      const result = await fn();
      if (result === false) return;
      if (refresh) await onSaved();
      if (inline) setInfo(doneText); else toast.success(doneText);
    } catch (e) { setError(err(e)); } finally { setBusy(false); }
  };
  const isPreviewRequestCurrent = (requestId: number, requestScope: string) => (
    requestId === previewRequestRef.current && requestScope === previewScopeRef.current
  );
  const dirty = docType !== detail.sourceDocumentType || taxStatus !== detail.taxEvidenceStatus || categoryId !== (detail.expenseCategoryId ?? '');
  const classificationReviewState = deriveExpenseClassificationReviewState(detail.aiVerificationSummaryJson, canReview);
  const classificationBlocked = classificationReviewState.blocked;
  const canResolveClassification = classificationReviewState.showFinanceOverride && docType !== 'NEEDS_REVIEW' && classificationOverrideReason.trim().length > 0 && classificationOverrideReason.trim().length <= 500;
  const saveDocumentReview = (next?: { docType: ExpenseDetail['sourceDocumentType']; taxStatus: ExpenseDetail['taxEvidenceStatus'] }) => {
    const nextDocType = next?.docType ?? docType;
    const nextTaxStatus = next?.taxStatus ?? taxStatus;
    const disallowsTaxCode = !allowsDomesticInputTaxCode(nextDocType, nextTaxStatus);
    const currentReview = reviewValues(detail);
    const sanitizedReview = disallowsTaxCode
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
      ...(disallowsTaxCode && { inputVatClaimStatus: 'NON_CLAIMABLE' as const }),
      ...(categoryId ? { expenseCategoryId: categoryId } : {}),
    });
  };
  // The certificate is filled across visits (the payer signs later, often on another day), so the two
  // free-text fields save to the expense columns they already map to instead of dying with the page.
  // `run` reloads `detail`, which also keeps `expectedExpenseUpdatedAt` fresh for `prepareSubstitute`.
  const saveSubstituteDraft = (field: 'missingReceiptReason' | 'note', value: string, stored: string | null) => {
    const next = value.trim();
    if (next === (stored ?? '')) return;
    void run(() => updateExpenseReviewFields(companyId, detail.id, {
      expectedUpdatedAt: detail.updatedAt,
      ...(field === 'note' ? { note: next } : { missingReceiptReason: next }),
    }), 'บันทึกร่างใบรับรองแล้ว', true, true);
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
  const needsReceiptOrSubstitute = expenseNeedsReceiptOrSubstitute(detail);
  const selectSignatureFile = (file: File | null) => {
    setSignatureFile(file); setCleanedSignatureFile(null); setSignaturePreview(null);
  };
  const buildTransparentSignature = async () => {
    if (!signatureFile) throw new Error('กรุณาเลือกไฟล์ลายเซ็น PNG หรือ JPEG');
    assertAllowedUploadFile(signatureFile, 'image');
    const sourceUrl = URL.createObjectURL(signatureFile);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve(); image.onerror = () => reject(new Error('อ่านรูปลายเซ็นไม่สำเร็จ')); image.src = sourceUrl;
      });
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = image.naturalWidth; sourceCanvas.height = image.naturalHeight;
      const sourceContext = sourceCanvas.getContext('2d');
      if (!sourceContext) throw new Error('เบราว์เซอร์ไม่รองรับการลบพื้นหลัง');
      sourceContext.drawImage(image, 0, 0);
      const original = sourceCanvas.toDataURL('image/png');
      const cleaned = removeLightBackground(sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height));
      const bounds = findOpaqueBounds(cleaned);
      if (!bounds) throw new Error('ไม่พบเส้นลายเซ็นหลังลบพื้นหลัง กรุณาเลือกรูปที่คมชัดขึ้น');
      sourceContext.putImageData(cleaned, 0, 0);
      const padding = 8;
      const cropX = Math.max(0, bounds.x - padding); const cropY = Math.max(0, bounds.y - padding);
      const cropWidth = Math.min(sourceCanvas.width - cropX, bounds.width + padding * 2);
      const cropHeight = Math.min(sourceCanvas.height - cropY, bounds.height + padding * 2);
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = cropWidth; outputCanvas.height = cropHeight;
      const outputContext = outputCanvas.getContext('2d');
      if (!outputContext) throw new Error('เบราว์เซอร์ไม่รองรับการตัดขอบลายเซ็น');
      outputContext.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const blob = await new Promise<Blob | null>((resolve) => outputCanvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('สร้างไฟล์ลายเซ็นโปร่งใสไม่สำเร็จ');
      setCleanedSignatureFile(new File([blob], 'signature-transparent.png', { type: 'image/png' }));
      setSignaturePreview({ original, cleaned: outputCanvas.toDataURL('image/png') });
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  };
  const uploadPersonalSignature = async (): Promise<string> => {
    if (!evidence) throw new Error('ไม่พบเอกสารที่เตรียมไว้');
    if (!cleanedSignatureFile) throw new Error('กรุณาลบพื้นหลังและตรวจตัวอย่างลายเซ็นก่อน');
    const intent = await initPersonalSignatureUpload(companyId, detail.id, evidence.id, cleanedSignatureFile);
    await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, cleanedSignatureFile, intent.uploadHeaders);
    await completePersonalSignatureUpload(companyId, detail.id, evidence.id, intent.attachmentId, cleanedSignatureFile.size);
    return intent.attachmentId;
  };
  const prepareSubstitute = async () => {
    assertAllowed(subReason, subPurpose);
    if (!payerCandidates.some((payer) => payer.userId === payerId)) throw new Error('กรุณาเลือกผู้จ่ายเงินจริงจากรายชื่อสมาชิกที่โหลดสำเร็จ');
    await generateSubstituteReceipt(companyId, detail.id, {
      reasonCode: subReasonCode,
      missingReceiptReason: subReason,
      businessPurpose: subPurpose,
      payerUserId: payerId,
      supportingAttachmentIds: selectedSupportingIds,
      paymentEvidenceAttachmentIds: selectedPaymentIds,
      paymentDate: subPaymentDate,
      paymentMethod: subPaymentMethod as NonNullable<ExpenseDetail['paymentMethod']>,
      idempotencyKey: `sub-${detail.id}-${detail.updatedAt}-v${detail.substituteReceiptEvidence?.version ?? 0}`.slice(0, 128),
      expectedExpenseUpdatedAt: detail.updatedAt,
    });
    setShowSub(false);
  };
  const uploadEvidence = async (purpose: 'expense.receipt.supporting' | 'expense.payment.evidence') => {
    const file = purpose === 'expense.payment.evidence' ? paymentUploadFile : supportingUploadFile;
    if (!file) throw new Error('กรุณาเลือกไฟล์รูปภาพหรือ PDF');
    assertAllowedUploadFile(file);
    await uploadExpenseEvidenceFile(companyId, detail.id, detail.branchId, file, purpose);
    if (purpose === 'expense.payment.evidence') setPaymentUploadFile(null); else setSupportingUploadFile(null);
  };
  const previewPreparedSubstitute = async () => {
    assertAllowed(signerPosition);
    if (!evidence) throw new Error('ไม่พบเอกสารที่เตรียมไว้');
    const requestId = ++previewRequestRef.current;
    const requestScope = previewScopeRef.current;
    setPreviewChecksum(null);
    let result;
    try {
      result = await previewSubstituteReceipt(companyId, detail.id, evidence.id, { payerPosition: signerPosition });
    } catch (cause) {
      if (!isPreviewRequestCurrent(requestId, requestScope)) return false;
      throw cause;
    }
    if (!isPreviewRequestCurrent(requestId, requestScope)) return false;
    onOpenFile({
      name: `${evidence.documentNumber}-preview.svg`,
      mimeType: 'image/svg+xml',
      url: result.svgDataUrl,
      hideOpenNewTab: true,
      onViewed: () => {
        if (!isPreviewRequestCurrent(requestId, requestScope)) return;
        setPreviewChecksum(result.previewChecksumSha256);
      },
    });
    return true;
  };
  const certifySubstitute = async () => {
    assertAllowed(signerPosition);
    if (!evidence) throw new Error('ไม่พบเอกสารที่เตรียมไว้');
    if (!previewChecksum) throw new Error('กรุณาสร้างและตรวจตัวอย่างก่อนลงนาม');
    const signatureAttachmentId = await uploadPersonalSignature();
    await certifySubstituteReceipt(companyId, detail.id, evidence.id, {
      payerPosition: signerPosition,
      certificationAcknowledged: true,
      previewChecksumSha256: previewChecksum,
      signatureAttachmentId,
      expectedVersion: evidence.version,
      expectedEvidenceUpdatedAt: evidence.updatedAt,
    });
    setSignatureFile(null); setCleanedSignatureFile(null); setSignaturePreview(null); setSignerPosition(''); setPreviewChecksum(null);
  };
  const approveSubstitute = async () => {
    assertAllowed(signerPosition);
    if (!evidence) throw new Error('ไม่พบเอกสารที่รออนุมัติ');
    const signatureAttachmentId = await uploadPersonalSignature();
    await approveSubstituteReceipt(companyId, detail.id, evidence.id, {
      approverPosition: signerPosition,
      approvalAcknowledged: true,
      certifiedArtifactChecksumSha256: evidence.certifiedArtifactChecksumSha256 ?? '',
      signatureAttachmentId,
      expectedVersion: evidence.version,
      expectedEvidenceUpdatedAt: evidence.updatedAt,
    });
    setSignatureFile(null); setCleanedSignatureFile(null); setSignaturePreview(null); setSignerPosition(''); setCertifiedPreviewed(false);
  };
  const supersedeCurrentEvidence = async () => {
    assertAllowed(supersedeReason);
    if (!evidence) throw new Error('ไม่พบเอกสารปัจจุบัน');
    await supersedeSubstituteReceipt(companyId, detail.id, evidence.id, {
      reason: supersedeReason.trim(), expectedEvidenceUpdatedAt: evidence.updatedAt,
    });
    setSupersedeReason(''); setShowSub(true);
  };
  const openSubstituteArtifact = async (attachmentId: string | null, markCertifiedPreview = false) => {
    if (!attachmentId || !evidence) return;
    const requestId = ++previewRequestRef.current;
    const requestScope = previewScopeRef.current;
    if (markCertifiedPreview) setCertifiedPreviewed(false);
    try {
      const blob = markCertifiedPreview
        ? await fetchAttachmentPreviewBlob(companyId, attachmentId, 'image/svg+xml')
        : await fetchSubstituteReceiptPdfBlob(companyId, detail.id, evidence.id);
      if (!isPreviewRequestCurrent(requestId, requestScope)) return false;
      const url = URL.createObjectURL(blob);
      if (!isPreviewRequestCurrent(requestId, requestScope)) {
        URL.revokeObjectURL(url);
        return false;
      }
      onOpenFile({
        name: markCertifiedPreview ? `${evidence.documentNumber}-certified.svg` : `${evidence.documentNumber}.pdf`,
        mimeType: markCertifiedPreview ? 'image/svg+xml' : 'application/pdf',
        url,
        ...(markCertifiedPreview ? {
          hideOpenNewTab: true,
          onViewed: () => {
            if (!isPreviewRequestCurrent(requestId, requestScope)) return;
            setCertifiedPreviewed(true);
          },
        } : {}),
      });
      return true;
    } catch (cause) {
      if (!isPreviewRequestCurrent(requestId, requestScope)) return false;
      throw cause;
    }
  };
  const requiresPaymentEvidence = subPaymentMethod !== 'CASH'
    || substitutePolicy?.cashEvidencePolicy === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE';
  const canApproveEvidence = evidence ? mayApproveSubstituteReceipt({
    userId,
    payerUserId: evidence.payerUserId,
    canConfirm,
    canSelfApprove,
    approvalMode: substitutePolicy?.approvalMode,
  }) : false;

  return (
    <MangmeeCard className="space-y-3 p-4 text-sm">
      <h3 className="font-semibold text-gray-800">{t('expenses.doc_review_title', locale)}</h3>
      {error && <ErrorBanner message={error} />}
      {info && <InfoBanner message={info} />}
      {classificationBlocked && <InfoBanner message={t(classificationReviewState.showFinanceOverride ? 'expenses.non_expense_override_hint' : 'expenses.non_expense_waiting_finance', locale)} />}
      {needsReceiptOrSubstitute && isMutable && canReview && !classificationBlocked && (
        <div className="space-y-2 rounded-xl border border-warning-100 bg-warning-50 p-3">
          <p className="text-xs font-semibold text-warning-700">{t('expenses.no_receipt_banner', locale)}</p>
          <Link className={btnClass} href={`/companies/${companyId}/expenses/substitute-receipts/new?expenseId=${encodeURIComponent(detail.id)}`}>{t('expenses.no_receipt_start_substitute', locale)}</Link>
        </div>
      )}
      {classificationReviewState.showFinanceOverride && (
        <div>
          <div className="mb-1 text-xs font-medium text-gray-600">{t('expenses.non_expense_override_reason', locale)}</div>
          <textarea className={inputClass} rows={2} maxLength={500} value={classificationOverrideReason} onChange={(e) => setClassificationOverrideReason(stripDisallowed(e.target.value))} placeholder={t('expenses.non_expense_override_reason_placeholder', locale)} />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            {t('expenses.doc_type', locale)}
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_doc_type', locale)} />
          </div>
          <ThemedSelect className={inputClass} value={docType} onChange={(e) => setDocType(e.target.value as ExpenseDetail['sourceDocumentType'])} disabled={!isMutable || !canReview}>
            {Object.entries(SOURCE_DOCUMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </ThemedSelect>
        </div>
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            {t('expenses.tax_evidence_status', locale)}
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_tax_status', locale)} />
          </div>
          <ThemedSelect className={inputClass} value={taxStatus} onChange={(e) => setTaxStatus(e.target.value as ExpenseDetail['taxEvidenceStatus'])} disabled={!isMutable || !canReview}>
            {Object.entries(TAX_EVIDENCE_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </ThemedSelect>
          {detail.taxEvidenceReasonCode && <p className="mt-1 text-xs text-gray-400">{t('expenses.reason_label', locale)}: {expenseValueLabel(TAX_EVIDENCE_REASON_LABELS, detail.taxEvidenceReasonCode)}</p>}
        </div>
        <div>
          <div className="mb-1 text-xs font-medium text-gray-600">
            <AiFieldLabel label={t('expenses.category', locale)} field="category" summary={detail.aiVerificationSummaryJson} />
          </div>
          <ThemedSelect className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={!isMutable || !canReview}>
            <option value="">{t('expenses.category_unspecified', locale)}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </ThemedSelect>
          <AiFieldMissingHint field="category" summary={detail.aiVerificationSummaryJson} />
        </div>
      </div>
      {isMutable && canReview && (
        <div className="flex flex-wrap items-center gap-2">
          <button className={btnClass} disabled={busy || !dirty} onClick={() => run(saveDocumentReview, 'บันทึกการตรวจเอกสารเรียบร้อยแล้ว')}>{t('expenses.doc_review_save', locale)}</button>
          {classificationReviewState.showFinanceOverride && <button className={btnClass} disabled={busy || !canResolveClassification} onClick={() => run(overrideClassification, 'ยืนยันการจัดประเภทรายการเรียบร้อยแล้ว')}>{t('expenses.non_expense_override_action', locale)}</button>}
          {(!evidence || evidence.status === 'PREPARED') && (
            <>
              <button className={ghostClass} disabled={busy} onClick={() => setShowSub((v) => !v)}>{evidence ? 'จัดทำ version แก้ไข' : t('expenses.issue_substitute', locale)}</button>
              <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_substitute', locale)} />
            </>
          )}
        </div>
      )}
      {showSub && isMutable && canReview && (!evidence || evidence.status === 'PREPARED') && (
        <div className="space-y-2 rounded-xl border border-warning-100 bg-warning-50 p-3">
          <p className="text-xs text-warning-700">{t('expenses.substitute_hint', locale)}</p>
          <p className="text-xs font-semibold text-error-700">หากใบกำกับภาษีสูญหายและต้องการใช้ภาษีซื้อ ให้ขอใบแทนจากผู้ขาย เอกสารภายในนี้ใช้แทนไม่ได้</p>
          <ThemedSelect className={inputClass} value={subReasonCode} onChange={(event) => setSubReasonCode(event.target.value as typeof subReasonCode)}>
            <option value="PAYEE_CANNOT_ISSUE">ผู้รับเงินไม่สามารถออกใบเสร็จ</option>
            <option value="RECEIPT_UNAVAILABLE">ไม่ได้รับใบเสร็จ</option>
            <option value="RECEIPT_MATERIALLY_INCOMPLETE">หลักฐานไม่สมบูรณ์</option>
            <option value="OTHER">อื่น ๆ</option>
          </ThemedSelect>
          <textarea className={inputClass} maxLength={500} rows={2} placeholder={t('expenses.substitute_reason_placeholder', locale)} value={subReason} onChange={(e) => setSubReason(stripDisallowed(e.target.value))} onBlur={() => saveSubstituteDraft('missingReceiptReason', subReason, detail.missingReceiptReason)} />
          <textarea className={inputClass} maxLength={500} rows={2} placeholder="วัตถุประสงค์ทางธุรกิจ (จำเป็น)" value={subPurpose} onChange={(e) => setSubPurpose(stripDisallowed(e.target.value))} onBlur={() => saveSubstituteDraft('note', subPurpose, detail.note)} />
          <ThemedSelect className={inputClass} value={payerId} onChange={(event) => setPayerId(event.target.value)}>
            <option value="">เลือกพนักงานผู้จ่ายเงินจริง</option>
            {payerCandidates.map((payer) => <option key={payer.userId} value={payer.userId}>{payer.displayName}</option>)}
          </ThemedSelect>
          {payerState === 'loading' && <p className="text-xs text-gray-500">กำลังโหลดรายชื่อผู้จ่าย...</p>}
          {payerState === 'error' && <p className="text-xs font-semibold text-error-700">โหลดรายชื่อผู้จ่ายไม่สำเร็จ กรุณาลองใหม่ก่อนจัดทำเอกสาร</p>}
          {payerState === 'loaded' && payerCandidates.length === 0 && <p className="text-xs font-semibold text-error-700">ไม่พบสมาชิกที่มีสถานะใช้งานในสาขานี้</p>}
          {substitutePolicyState === 'loading' && <p className="text-xs text-gray-500">กำลังโหลดนโยบายบริษัท...</p>}
          {substitutePolicyState === 'error' && <p className="text-xs font-semibold text-error-700">โหลดนโยบายใบรับรองแทนใบเสร็จไม่สำเร็จ</p>}
          {substitutePolicyState === 'loaded' && !substitutePolicy?.ready && (
            <p className="text-xs font-semibold text-error-700">บริษัทเลือกโหมดกำหนดผู้อนุมัติไว้ แต่ยังไม่ได้เลือกผู้อนุมัติ · <a className="underline" href={`/companies/${companyId}/settings/substitute-receipt`}>ไปหน้าตั้งค่า</a></p>
          )}
          <ThemedSelect className={inputClass} value={subPaymentMethod} onChange={(event) => setSubPaymentMethod(event.target.value as typeof subPaymentMethod)}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </ThemedSelect>
          <ThemedDate className={inputClass} value={subPaymentDate} onChange={(event) => setSubPaymentDate(event.target.value)} />
          <div className="space-y-1 rounded-lg border border-warning-100 bg-white p-2 text-xs">
            <p className="font-semibold text-gray-700">1. เลือกหลักฐานต้นทาง/หลักฐานประกอบ</p>
            {detail.attachments.filter((attachment) => attachment.status === 'ACTIVE' && attachment.purpose !== 'expense.review.evidence' && attachment.purpose !== 'expense.payment.evidence').map((attachment) => (
              <label key={attachment.id} className="flex items-center gap-2">
                <input type="checkbox" checked={selectedSupportingIds.includes(attachment.id)} onChange={(event) => setSelectedSupportingIds((current) => event.target.checked ? [...new Set([...current, attachment.id])] : current.filter((id) => id !== attachment.id))} />
                <span>{attachment.originalFileName}</span>
              </label>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <ThemedFile file={supportingUploadFile} accept={ATTACHMENT_UPLOAD_ACCEPT} onChange={setSupportingUploadFile} />
              <button className={ghostClass} disabled={busy || !supportingUploadFile} onClick={() => run(() => uploadEvidence('expense.receipt.supporting'), 'เพิ่มหลักฐานประกอบเรียบร้อยแล้ว')}>เพิ่มหลักฐานประกอบ</button>
            </div>
          </div>
          <div className="space-y-1 rounded-lg border border-warning-100 bg-white p-2 text-xs">
              <p className="font-semibold text-gray-700">2. เลือกหลักฐานการจ่าย (ต้องเป็นคนละไฟล์กับหลักฐานต้นทาง){requiresPaymentEvidence ? ' · จำเป็นตามนโยบาย' : ' · ไม่บังคับ'}</p>
              {subPaymentMethod === 'CASH' && substitutePolicy?.cashEvidenceInstructions && <p className="text-gray-500">{substitutePolicy.cashEvidenceInstructions}</p>}
              {detail.attachments.filter((attachment) => attachment.status === 'ACTIVE' && attachment.purpose === 'expense.payment.evidence').map((attachment) => (
                <label key={attachment.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={selectedPaymentIds.includes(attachment.id)} onChange={(event) => setSelectedPaymentIds((current) => event.target.checked ? [...new Set([...current, attachment.id])] : current.filter((id) => id !== attachment.id))} />
                  <span>{attachment.originalFileName}</span>
                </label>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <ThemedFile file={paymentUploadFile} accept={ATTACHMENT_UPLOAD_ACCEPT} onChange={setPaymentUploadFile} />
                <button className={ghostClass} disabled={busy || !paymentUploadFile} onClick={() => run(() => uploadEvidence('expense.payment.evidence'), 'เพิ่มหลักฐานการจ่ายเรียบร้อยแล้ว')}>เพิ่มหลักฐานการจ่าย</button>
              </div>
            </div>
          <button className={btnClass} disabled={busy || payerState !== 'loaded' || substitutePolicyState !== 'loaded' || !substitutePolicy?.ready || !subReason.trim() || !subPurpose.trim() || !payerId || !subPaymentDate || selectedSupportingIds.length === 0 || (requiresPaymentEvidence && selectedPaymentIds.length === 0)} onClick={() => run(prepareSubstitute, evidence ? 'บันทึกใบรับรองฉบับแก้ไขเรียบร้อยแล้ว' : 'จัดทำใบรับรองเรียบร้อยแล้ว')}>{evidence ? 'บันทึกเป็น version แก้ไข' : t('expenses.substitute_confirm', locale)}</button>
        </div>
      )}
      {evidence && (
        <div className="space-y-2 rounded-xl border border-warning-100 bg-warning-50 p-3 text-xs text-warning-700">
          <p className="font-semibold">📄 ใบรับรองแทนใบเสร็จรับเงิน {evidence.documentNumber} · version {evidence.version} · {expenseValueLabel(SUBSTITUTE_RECEIPT_STATUS_LABELS, evidence.status)}</p>
          <p>ผู้จ่ายเงินจริง: {evidence.payerName} · เหตุผล: {evidence.missingReceiptReason}</p>
          <Link className={btnClass} href={`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(evidence.id)}`}>
            <span className="inline-flex items-center gap-2">
              {evidence.status === 'PREPARED' || evidence.status === 'PAYER_CERTIFIED' ? ICON.edit : ICON.eye}
              {t(evidence.status === 'PREPARED' || evidence.status === 'PAYER_CERTIFIED'
                ? 'expenses.substitute_hub.continue'
                : evidence.status === 'ISSUED' ? 'expenses.substitute_hub.open_document' : 'expenses.substitute_hub.view_history', locale)}
            </span>
          </Link>
          {evidence.status === 'PREPARED' && evidence.payerUserId !== userId && <p>รอผู้จ่ายเงินจริงเข้าสู่ระบบเพื่อลงนามรับรองด้วยตนเอง</p>}
          {evidence.status === 'PREPARED' && evidence.payerUserId === userId && (
            <div className="space-y-2 rounded-lg bg-white p-2">
              <p className="font-semibold">ผู้จ่ายเงินรับรองด้วยตนเอง</p>
              <input className={inputClass} maxLength={120} placeholder="ตำแหน่งตามจริงของผู้จ่าย เช่น เจ้าของกิจการ" value={signerPosition} onChange={(event) => { setSignerPosition(stripDisallowed(event.target.value)); setPreviewChecksum(null); }} />
              <p className="text-gray-500">ตำแหน่งในเอกสารเป็นข้อมูลที่ผู้ลงนามรับรองเอง ไม่ได้ดึงจากบทบาทหรือชื่อผู้ใช้ในระบบ</p>
              <button className={ghostClass} disabled={busy || !signerPosition.trim()} onClick={() => run(previewPreparedSubstitute, 'สร้างตัวอย่างสำหรับตรวจแล้ว', false, true)}>สร้างและตรวจตัวอย่างก่อนลงนาม</button>
              <ThemedFile file={signatureFile} accept={IMAGE_UPLOAD_ACCEPT} onChange={(file) => selectSignatureFile(file)} />
              <button className={ghostClass} disabled={busy || !signatureFile} onClick={() => run(buildTransparentSignature, 'ลบพื้นหลังสีอ่อนและเตรียมลายเซ็นโปร่งใสแล้ว', false, true)}>ลบพื้นหลังสีอ่อนและดูตัวอย่าง</button>
              {signaturePreview && (
                <div className="grid grid-cols-2 gap-2">
                  <div><p className="mb-1 text-gray-500">ต้นฉบับ</p><img src={signaturePreview.original} alt="ลายเซ็นต้นฉบับ" className="max-h-28 rounded-lg border bg-white" /></div>
                  <div><p className="mb-1 text-gray-500">ไฟล์ที่จะวางในเอกสาร</p><img src={signaturePreview.cleaned} alt="ลายเซ็นพื้นหลังโปร่งใส" className="max-h-28 rounded-lg border" style={{ backgroundImage: 'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)', backgroundSize: '16px 16px' }} /></div>
                </div>
              )}
              <p>ระบบจะฝัง PNG โปร่งใสที่ตรวจแล้วลงในใบรับรองฉบับนี้โดยตรง</p>
              <p>ข้าพเจ้าขอรับรองว่ารายจ่ายนี้ไม่อาจเรียกเก็บใบเสร็จจากผู้รับได้ และได้จ่ายไปในงานของบริษัทโดยแท้</p>
              <button className={btnClass} disabled={busy || !signerPosition.trim() || !previewChecksum || !cleanedSignatureFile} onClick={() => run(certifySubstitute, 'ลงนามรับรองเรียบร้อยแล้ว')}>ลงนามรับรองตัวอย่างที่ตรวจแล้ว</button>
            </div>
          )}
          {evidence.status === 'PAYER_CERTIFIED' && !canApproveEvidence && <p>ผู้จ่ายลงนามแล้ว รอผู้มีสิทธิอนุมัติ</p>}
          {evidence.status === 'PAYER_CERTIFIED' && canApproveEvidence && (
            <div className="space-y-2 rounded-lg bg-white p-2">
              <p className="font-semibold">อนุมัติโดยผู้มีอำนาจ</p>
              <button className={ghostClass} disabled={busy || !evidence.certifiedArtifactAttachmentId} onClick={() => run(() => openSubstituteArtifact(evidence.certifiedArtifactAttachmentId, true), 'เปิดฉบับที่ผู้จ่ายลงนามแล้ว', false, true)}>เปิดตรวจฉบับที่ผู้จ่ายลงนาม</button>
              <input className={inputClass} maxLength={120} placeholder="ตำแหน่งตามจริงของผู้อนุมัติ เช่น เจ้าของกิจการ" value={signerPosition} onChange={(event) => setSignerPosition(stripDisallowed(event.target.value))} />
              <p className="text-gray-500">ตำแหน่งในเอกสารเป็นข้อมูลที่ผู้ลงนามรับรองเอง ไม่ได้ดึงจากบทบาทหรือชื่อผู้ใช้ในระบบ</p>
              <ThemedFile file={signatureFile} accept={IMAGE_UPLOAD_ACCEPT} onChange={(file) => selectSignatureFile(file)} />
              <button className={ghostClass} disabled={busy || !signatureFile} onClick={() => run(buildTransparentSignature, 'ลบพื้นหลังสีอ่อนและเตรียมลายเซ็นโปร่งใสแล้ว', false, true)}>ลบพื้นหลังสีอ่อนและดูตัวอย่าง</button>
              {signaturePreview && (
                <div className="grid grid-cols-2 gap-2">
                  <div><p className="mb-1 text-gray-500">ต้นฉบับ</p><img src={signaturePreview.original} alt="ลายเซ็นต้นฉบับ" className="max-h-28 rounded-lg border bg-white" /></div>
                  <div><p className="mb-1 text-gray-500">ไฟล์ที่จะวางในเอกสาร</p><img src={signaturePreview.cleaned} alt="ลายเซ็นพื้นหลังโปร่งใส" className="max-h-28 rounded-lg border" style={{ backgroundImage: 'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)', backgroundSize: '16px 16px' }} /></div>
                </div>
              )}
              <p>ระบบจะฝัง PNG โปร่งใสที่ตรวจแล้วลงในใบรับรองฉบับนี้โดยตรง</p>
              <button className={btnClass} disabled={busy || !certifiedPreviewed || !signerPosition.trim() || !cleanedSignatureFile} onClick={() => run(approveSubstitute, 'อนุมัติและออกเอกสารเรียบร้อยแล้ว')}>อนุมัติฉบับที่ตรวจและออกเอกสาร</button>
            </div>
          )}
          {evidence.status === 'ISSUED' && (
            <div className="flex flex-wrap gap-2">
              <button className={btnClass} disabled={busy || !evidence.artifactAttachmentId} onClick={() => run(() => downloadSubstituteReceiptPdf(companyId, detail.id, evidence.id, evidence.documentNumber), t('expenses.downloaded', locale), false, true)}>
                <span className="inline-flex items-center gap-2">{ICON.download}{t('expenses.substitute.download_pdf', locale)}</span>
              </button>
              <button className={ghostClass} disabled={busy || !evidence.artifactAttachmentId} onClick={() => run(() => openSubstituteArtifact(evidence.artifactAttachmentId), 'เปิดเอกสารแล้ว', false, true)}>เปิดใบรับรองฉบับที่ออกแล้ว</button>
            </div>
          )}
          {canReview && isMutable && (
            <div className="space-y-2 rounded-lg border border-warning-100 bg-white p-2">
              <input className={inputClass} maxLength={500} value={supersedeReason} onChange={(event) => setSupersedeReason(stripDisallowed(event.target.value))} placeholder="เหตุผลที่ยกเลิกหรือจัดทำ version แก้ไข (เก็บใน audit trail)" />
              <button className={ghostClass} disabled={busy || !supersedeReason.trim()} onClick={() => run(supersedeCurrentEvidence, 'ยกเลิก version เดิมแล้ว สามารถจัดทำ version แก้ไขได้', true, true)}>ยกเลิก version นี้และเก็บประวัติ</button>
              {!supersedeReason.trim() && <p className="text-xs text-gray-500">กรอกเหตุผลด้านบนก่อน จึงจะกดยกเลิก version นี้ได้</p>}
            </div>
          )}
          {canReview && evidenceHistoryLoading && <p className="text-xs text-gray-500">กำลังโหลด...</p>}
          {canReview && !evidenceHistoryLoading && evidenceHistory.length > 1 && (
            <details className="rounded-lg bg-white p-2">
              <summary className="cursor-pointer font-semibold">ประวัติทุก version ({evidenceHistory.length})</summary>
              <ul className="mt-2 space-y-1">
                {evidenceHistory.map((item) => <li key={item.id}>version {item.version} · {expenseValueLabel(SUBSTITUTE_RECEIPT_STATUS_LABELS, item.status)}{item.supersedeReason ? ` · ${item.supersedeReason}` : ''}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </MangmeeCard>
  );
}

type EditableReviewLineField = 'description' | 'quantity' | 'unitPrice' | 'discountAmount' | 'vatRate';

export function reviewValues(detail: ExpenseDetail): ExpenseDraftReviewValues {
  return {
    vendorNameSnapshot: detail.vendorNameSnapshot ?? '',
    vendorTaxIdSnapshot: detail.vendorTaxIdSnapshot ?? '',
    vendorEntityKindSnapshot: detail.vendorEntityKindSnapshot ?? '',
    vendorDocumentNumber: detail.vendorDocumentNumber ?? '',
    expenseDate: detail.expenseDate.slice(0, 10),
    vatMode: detail.vatMode,
    lines: detail.lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      vatRate: line.vatRate ?? '',
      whtRate: line.whtRate,
      expenseCategoryId: line.expenseCategoryId,
      accountHintKey: line.accountHintKey,
      taxCategory: line.taxCategory,
      taxCodeDefinitionId: line.taxSnapshot?.taxCodeDefinitionId ?? null,
      externalTaxCode: line.taxSnapshot?.externalTaxCode ?? null,
      transactionContext: line.taxSnapshot?.taxContext ?? 'DOMESTIC_PURCHASE',
    })),
  };
}

export function ExpenseReviewEditSection({ companyId, detail, isMutable, canReview, onSaved, saveRef, onValidationChange }: {
  companyId: string;
  detail: ExpenseDetail;
  isMutable: boolean;
  canReview: boolean;
  onSaved: () => Promise<void>;
  /** The modal's ถัดไป/chip navigation triggers this save when leaving the details step — no in-section save button. */
  saveRef?: MutableRefObject<(() => Promise<boolean>) | null>;
  onValidationChange?: (errorCount: number) => void;
}) {
  const locale = useWorkspaceLocale();
  const [values, setValues] = useState<ExpenseDraftReviewValues>(() => reviewValues(detail));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // Keyed by line index. `custom` is needed because "custom, nothing typed yet" and "unset" are the
  // same stored value (''), so the preset cannot be derived from the rate alone. `printed` holds the
  // typed baht figure — only the derived rate is saved, but the input must stay editable.
  const [vatEditors, setVatEditors] = useState<Record<number, { custom?: boolean; printed?: string }>>({});
  // The stored date, not the edited one: a reviewer mid-edit must not have the tax fields vanish
  // under their cursor. `hasRecordedTax` then keeps them visible for a document that already
  // carries VAT, whatever the workspace mode says (spec §7.5).
  const capture = useExpenseCapturePolicy(companyId, detail.expenseDate ?? undefined);
  const showsTax = showsTaxCapture(capture.mode, hasRecordedTax(detail.lines));
  const aiGrandTotal = aiGrandTotalValue(detail.aiVerifiedFieldsJson);
  const aiSuggestion = useMemo(() => expenseAiSuggestion(detail.aiVerificationSummaryJson), [detail.aiVerificationSummaryJson]);
  const issues = useMemo(() => validateExpenseReview(values, { today: todayCivilDate(), aiGrandTotal, whtAmount: detail.whtAmount }), [values, aiGrandTotal, detail.whtAmount]);
  const blockingIssueCount = issues.filter((issue) => issue.severity === 'error').length;
  const vendorNameIssue = fieldIssue(issues, 'vendorNameSnapshot');
  const vendorTaxIdIssue = fieldIssue(issues, 'vendorTaxIdSnapshot');
  const documentNumberIssue = fieldIssue(issues, 'vendorDocumentNumber');
  const expenseDateIssue = fieldIssue(issues, 'expenseDate');
  const linesIssue = fieldIssue(issues, 'lines');
  const whtRateIssue = fieldIssue(issues, 'whtRate');
  const payeeEntityKindIssue = fieldIssue(issues, 'vendorEntityKindSnapshot');
  const totalIssues = issues.filter((issue) => issue.field === 'total');
  const documentWhtRate = expenseDocumentWhtRate(values.lines);
  const documentWhtPercent = expenseRatePercent(documentWhtRate ?? '');
  const withholdsTax = Number(detail.whtAmount) > 0 || values.lines.some((line) => Number(line.whtRate) > 0);

  useEffect(() => { setValues(reviewValues(detail)); setVatEditors({}); }, [detail.id, detail.updatedAt]);
  useEffect(() => { onValidationChange?.(blockingIssueCount); }, [blockingIssueCount, onValidationChange]);

  const updateLine = (index: number, field: EditableReviewLineField, value: string) => {
    setValues((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line),
    }));
  };

  const save = async (): Promise<boolean> => {
    setError(null); setInfo(null);
    if (blockingIssueCount > 0) {
      setError(t('expenses.v_blocking_count', locale).replace('{count}', String(blockingIssueCount)));
      return false;
    }
    setBusy(true);
    try {
      const forbidden = findForbiddenChars([
        values.vendorNameSnapshot, values.vendorTaxIdSnapshot, values.vendorDocumentNumber,
        ...values.lines.map((line) => line.description),
      ].join(''));
      if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
      const update = canReview ? updateExpenseReviewFields : updateExpenseDraft;
      const disallowsTaxCode = !allowsDomesticInputTaxCode(detail.sourceDocumentType, detail.taxEvidenceStatus);
      await update(companyId, detail.id, {
        expectedUpdatedAt: detail.updatedAt,
        ...buildExpenseDraftReviewPayload(disallowsTaxCode
          ? { ...values, lines: clearExpenseTaxSelections(values.lines) }
          : values),
        ...(disallowsTaxCode && { inputVatClaimStatus: 'NON_CLAIMABLE' as const }),
      });
      await onSaved();
      setInfo(t('expenses.review_saved', locale));
      return true;
    } catch (e) { setError(err(e)); return false; }
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
      {error && <ErrorBanner message={error} />}
      {info && <InfoBanner message={info} />}
      {aiSuggestion && isMutable && (
        <div className="space-y-2 rounded-xl border border-brand-100 bg-brand-25 p-3">
          <p className="text-xs font-semibold text-gray-700">{t('expenses.ai_suggestion_title', locale)}</p>
          <p className="text-xs text-gray-500">{t('expenses.ai_suggestion_hint', locale)}</p>
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
            {(Object.keys(aiSuggestion) as Array<keyof ExpenseAiSuggestion>).map((key) => (
              <div key={key} className="flex justify-between gap-2">
                <dt className="text-gray-500">{AI_SUGGESTION_FIELD_LABELS[key]}</dt>
                <dd className="font-medium text-gray-800">{aiSuggestion[key]}</dd>
              </div>
            ))}
          </dl>
          <button type="button" className={ghostClass} disabled={busy} onClick={() => setValues((v) => applyExpenseAiSuggestion(v, aiSuggestion))}>
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
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600"><AiFieldLabel label={t('expenses.document_number', locale)} field="vendorDocumentNumber" summary={detail.aiVerificationSummaryJson} /></span>
          <input className={validationInputClass(documentNumberIssue)} aria-invalid={documentNumberIssue?.severity === 'error' || undefined} value={values.vendorDocumentNumber} onChange={(e) => setValues((v) => ({ ...v, vendorDocumentNumber: stripDisallowed(e.target.value) }))} disabled={!isMutable || busy} />
          <FieldIssueNote issue={documentNumberIssue} />
          <AiFieldMissingHint field="vendorDocumentNumber" summary={detail.aiVerificationSummaryJson} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-gray-600"><AiFieldLabel label={t('expenses.expense_date', locale)} field="expenseDate" summary={detail.aiVerificationSummaryJson} /></span>
          <ThemedDate className={validationInputClass(expenseDateIssue)} aria-invalid={expenseDateIssue?.severity === 'error' || undefined} value={values.expenseDate} onChange={(e) => setValues((v) => ({ ...v, expenseDate: e.target.value }))} disabled={!isMutable || busy} />
          <FieldIssueNote issue={expenseDateIssue} />
          <AiFieldMissingHint field="expenseDate" summary={detail.aiVerificationSummaryJson} />
        </label>
        <div className="sm:col-span-2">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <label htmlFor={`expense-vat-mode-${detail.id}`}>{t('expenses.vat_mode', locale)}</label>
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_mode', locale)} />
            {/* Spec §19g decision 3: the mode never names a rate; the rate comes from the lines. */}
            {vatModeRequiresRate(values.vatMode) && (
              <span className="font-semibold text-gray-500">· {effectiveVatRateLabel(values.lines)}</span>
            )}
          </span>
          <ThemedSelect id={`expense-vat-mode-${detail.id}`} className={inputClass} value={values.vatMode} onChange={(e) => setValues((v) => ({ ...v, vatMode: e.target.value as ExpenseDraftReviewValues['vatMode'] }))} disabled={!isMutable || busy}>
            {Object.entries(EXPENSE_VAT_MODE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </ThemedSelect>
        </div>
        {/* RA-18: the payee's taxpayer class decides ภ.ง.ด.3 vs ภ.ง.ด.53, so it is only asked for when
            this document actually withholds tax, and confirmation blocks until it is picked — never
            guessed. The blank choice disappears once a class is stored because the update contract has
            no clear-to-null idiom for the vendor snapshot fields, so re-picking it would be a no-op. */}
        {withholdsTax && (
          <div className="sm:col-span-2">
            <span className="mb-1 block text-xs font-medium text-gray-600">
              <label htmlFor={`expense-payee-entity-kind-${detail.id}`}>{t('expenses.payee_entity_kind', locale)}</label>
            </span>
            <ThemedSelect id={`expense-payee-entity-kind-${detail.id}`} className={validationInputClass(payeeEntityKindIssue)} aria-invalid={payeeEntityKindIssue?.severity === 'error' || undefined} value={values.vendorEntityKindSnapshot ?? ''} onChange={(e) => setValues((v) => ({ ...v, vendorEntityKindSnapshot: e.target.value as BuyerEntityKind | '' }))} disabled={!isMutable || busy}>
              {!detail.vendorEntityKindSnapshot && <option value="">{t('expenses.category_unspecified', locale)}</option>}
              {Object.entries(PAYEE_ENTITY_KIND_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </ThemedSelect>
            <FieldIssueNote issue={payeeEntityKindIssue} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
        <h4 className="font-semibold text-gray-800">{t('expenses.line_items', locale)}</h4>
        {isMutable && (
          <button type="button" className={ghostClass} disabled={busy} onClick={() => setValues((v) => ({
            ...v,
            lines: [...v.lines, { description: '', quantity: '1', unitPrice: '0', discountAmount: '0', vatRate: '', whtRate: expenseDocumentWhtRate(v.lines) || null, expenseCategoryId: null, accountHintKey: null, taxCategory: null, taxCodeDefinitionId: null, externalTaxCode: null, transactionContext: 'DOMESTIC_PURCHASE' }],
          }))}>{t('expenses.add_line', locale)}</button>
        )}
      </div>

      {values.lines.length === 0 && (
        <div>
          <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-xs text-gray-500">{t('expenses.no_line_items', locale)}</p>
          <FieldIssueNote issue={linesIssue} />
        </div>
      )}
      {values.lines.map((line, index) => {
        const descriptionIssue = fieldIssue(issues, `lines.${index}.description`);
        const quantityIssue = fieldIssue(issues, `lines.${index}.quantity`);
        const unitPriceIssue = fieldIssue(issues, `lines.${index}.unitPrice`);
        const discountIssue = fieldIssue(issues, `lines.${index}.discountAmount`);
        const vatRateIssue = fieldIssue(issues, `lines.${index}.vatRate`);
        const vatPercent = expenseRatePercent(line.vatRate);
        // "custom, nothing typed yet" stores the same '' as "unset", so the flag has to be sticky.
        const showCustomRate = vatRatePreset(line.vatRate) === 'custom' || vatEditors[index]?.custom === true;
        return (
        <div key={index} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs font-semibold text-gray-600">{t('expenses.line_number', locale)} {index + 1}</span>
            {/* The printed-VAT drafts are keyed by line index, so removing a line would otherwise
                show the deleted line's typed amount under its successor. */}
            {isMutable && <button type="button" className="flex h-8 w-8 items-center justify-center rounded-lg text-error-500 transition hover:bg-error-50 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => { setVatEditors({}); setValues((v) => ({ ...v, lines: v.lines.filter((_, lineIndex) => lineIndex !== index) })); }} title={t('expenses.delete', locale)} aria-label={`${t('expenses.delete_line_aria', locale)} ${index + 1}`}>{ICON.trash}</button>}
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
              <textarea className={cx(validationInputClass(descriptionIssue), 'resize-y')} rows={2} aria-invalid={descriptionIssue?.severity === 'error' || undefined} value={line.description} onChange={(e) => updateLine(index, 'description', stripDisallowed(e.target.value))} disabled={!isMutable || busy} />
              <FieldIssueNote issue={descriptionIssue} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_quantity', locale)}</span>
              <input type="number" min="0" step="0.0001" className={validationInputClass(quantityIssue)} aria-invalid={quantityIssue?.severity === 'error' || undefined} value={line.quantity} onChange={(e) => updateLine(index, 'quantity', e.target.value)} disabled={!isMutable || busy} />
              <FieldIssueNote issue={quantityIssue} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_unit_price', locale)}</span>
              <input type="number" min="0" step="0.0001" className={validationInputClass(unitPriceIssue)} aria-invalid={unitPriceIssue?.severity === 'error' || undefined} value={line.unitPrice} onChange={(e) => updateLine(index, 'unitPrice', e.target.value)} disabled={!isMutable || busy} />
              <FieldIssueNote issue={unitPriceIssue} />
            </label>
            <label>
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_discount', locale)}</span>
              <input type="number" min="0" step="0.0001" className={validationInputClass(discountIssue)} aria-invalid={discountIssue?.severity === 'error' || undefined} value={line.discountAmount} onChange={(e) => updateLine(index, 'discountAmount', e.target.value)} disabled={!isMutable || busy} />
              <FieldIssueNote issue={discountIssue} />
            </label>
            {/* Spec §19g decision 4: a rate, a preset, or the VAT amount the document prints — all
                three write the same stored decimal fraction. The bare 0–1 box asked reviewers to
                convert "11.78 VAT TTL" into 0.07 in their heads.
                The block takes the full row: as a half-width cell its printed-VAT sub-fields wrapped
                their labels onto two lines and left a column-tall hole beside ส่วนลด. */}
            {showsTax && <div className="sm:col-span-2">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
                <label htmlFor={`expense-vat-rate-${detail.id}-${index}`}>{t('expenses.line_vat_rate', locale)}</label>
                <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_vat_rate', locale)} />
              </span>
              <ThemedSelect
                id={`expense-vat-rate-${detail.id}-${index}`}
                className={validationInputClass(vatRateIssue)}
                aria-invalid={vatRateIssue?.severity === 'error' || undefined}
                value={showCustomRate ? 'custom' : vatRatePreset(line.vatRate)}
                onChange={(e) => {
                  const preset = e.target.value;
                  setVatEditors((current) => ({ ...current, [index]: { ...current[index], custom: preset === 'custom' } }));
                  updateLine(index, 'vatRate', vatRatePresetValue(preset, line.vatRate));
                }}
                disabled={!isMutable || busy}
              >
                {!showCustomRate && line.vatRate.trim() === '' && <option value="unset">{t('expenses.vat_rate_preset_unset', locale)}</option>}
                <option value="standard">{t('expenses.vat_rate_preset_standard', locale)}</option>
                <option value="zero">{t('expenses.vat_rate_preset_zero', locale)}</option>
                <option value="custom">{t('expenses.vat_rate_preset_custom', locale)}</option>
              </ThemedSelect>
              <FieldIssueNote issue={vatRateIssue} />
              {showCustomRate && (
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_vat_percent', locale)}</span>
                    <input type="number" min="0" max="99.99" step="0.01" className={inputClass}
                      value={expenseRateToPercent(line.vatRate)}
                      onChange={(e) => updateLine(index, 'vatRate', expensePercentToRate(e.target.value))}
                      disabled={!isMutable || busy} />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_vat_amount', locale)}</span>
                    <input type="number" min="0" step="0.01" className={inputClass}
                      value={vatEditors[index]?.printed ?? ''}
                      onChange={(e) => {
                        const printed = e.target.value;
                        setVatEditors((current) => ({ ...current, [index]: { ...current[index], printed } }));
                        const derived = vatRateFromPrintedAmount({
                          afterDiscountAmount: Number(line.quantity || '0') * Number(line.unitPrice || '0') - Number(line.discountAmount || '0'),
                          printedVatAmount: printed,
                          vatMode: values.vatMode,
                        });
                        if (derived) updateLine(index, 'vatRate', derived);
                      }}
                      disabled={!isMutable || busy} />
                    <p className="mt-1 text-xs text-gray-500">{t('expenses.line_vat_amount_hint', locale)}</p>
                  </label>
                </div>
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
              netAmount={String(Math.max(0, Number(line.quantity || '0') * Number(line.unitPrice || '0') - Number(line.discountAmount || '0')))}
              grossAmount={String(Math.max(0, Number(line.quantity || '0') * Number(line.unitPrice || '0') - Number(line.discountAmount || '0')))}
              value={line.taxCodeDefinitionId ?? ''}
              disabled={!isMutable || busy}
              labelAddon={<InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_tax_code', locale)} />}
              canConfigureTax={capture.canConfigureTax}
              suggestedTaxCode={detail.categoryDefaultInputTaxCode ?? null}
              onChange={(id, definition) => setValues((current) => ({ ...current, lines: current.lines.map((item, lineIndex) => lineIndex === index ? { ...item, taxCodeDefinitionId: id || null, externalTaxCode: definition?.externalCode ?? null, vatRate: definition ? taxDefinitionRateForSource(definition.rate, 'expense') : '' } : item) }))}
            />
          </div> : <p className="mt-3 text-xs text-gray-500">รหัสภาษีซื้อในประเทศเลือกได้เมื่อเอกสารถูกจัดประเภทเป็นใบกำกับภาษีเท่านั้น</p>}
        </div>
        );
      })}

      {values.lines.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-600">
            <label htmlFor={`expense-wht-rate-${detail.id}`}>{t('expenses.document_wht_rate', locale)}</label>
            <InfoTip label={t('expenses.tip_open', locale)} text={t('expenses.tip_wht_rate', locale)} />
          </span>
          <input
            id={`expense-wht-rate-${detail.id}`}
            type="number"
            min="0"
            max="1"
            step="0.0001"
            className={validationInputClass(whtRateIssue)}
            aria-invalid={whtRateIssue?.severity === 'error' || undefined}
            value={documentWhtRate ?? ''}
            onChange={(event) => {
              const whtRate = event.target.value || null;
              setValues((current) => ({
                ...current,
                lines: current.lines.map((line) => ({ ...line, whtRate })),
              }));
            }}
            disabled={!isMutable || busy}
          />
          <FieldIssueNote issue={whtRateIssue} />
          {documentWhtRate === null && <p className="mt-1 text-xs text-warning-700">{t('expenses.wht_multiple_rates_hint', locale)}</p>}
          {documentWhtPercent !== null && <p className="mt-1 text-xs text-gray-500">{t('expenses.rate_percent_echo', locale).replace('{percent}', documentWhtPercent)}</p>}
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
// All four columns share the spare width. With fixed trailing columns the first one absorbed
// every extra pixel on wide screens (~66% of the table) and pushed the rest into a cluster on
// the right; the minimums keep them readable once the min-w track starts scrolling.
const GRID = 'grid grid-cols-[minmax(0,1.6fr)_minmax(140px,1fr)_minmax(130px,1fr)_minmax(170px,1fr)_minmax(84px,auto)] items-center gap-3';
const LIST_PAGE_SIZE = 10;

function ExpenseListPage({ companyId, caps, userId, onSelect }: { companyId: string; caps: ExpenseCapabilities; userId: string; onSelect: (id: string) => void }) {
  const locale = useWorkspaceLocale();
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
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [columnSet, setColumnSet] = useMenuFilterState<'summary' | 'full'>('expenses.list.columnSet', () => 'summary');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const branchFilter = useBranchFilter();
  const branchId = branchFilter?.branchId ?? '';
  const { fromDate, toDate } = periodRange(gran, month, day);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await listExpenses(companyId, {
        ...(branchId ? { branchId } : {}),
        uploadedFromDate: fromDate,
        uploadedToDate: toDate,
        pageSize: 200,
      });
      setRows(res.data);
    } catch (e) {
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setError(err(e));
    }
    finally { setLoading(false); }
    // `branchFilter` is deliberately absent: reportBranchForbidden is stable per companyId, which is here.
  }, [companyId, branchId, fromDate, toDate]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setCategoryNamesLoading(true);
    void listExpenseCategories(companyId)
      .then((cs) => setCatNames(Object.fromEntries(cs.map((c) => [c.id, c.name]))))
      .catch(() => {})
      .finally(() => setCategoryNamesLoading(false));
  }, [companyId]);

  const kpi = useMemo(() => summarizeExpenseKpis(rows, todayCivilDate()), [rows]);

  const chipCounts = useMemo(() => ({
    all: rows.length,
    draft: rows.filter((r) => r.status === 'DRAFT').length,
    pending: rows.filter((r) => isExpensePending(r.status)).length,
    confirmed: rows.filter((r) => r.status === 'CONFIRMED').length,
    rejected: rows.filter((r) => r.status === 'REJECTED').length,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (chip === 'draft' && r.status !== 'DRAFT') return false;
      if (chip === 'pending' && !isExpensePending(r.status)) return false;
      if (chip === 'confirmed' && r.status !== 'CONFIRMED') return false;
      if (chip === 'rejected' && r.status !== 'REJECTED') return false;
      if (!q) return true;
      return `${r.expenseNumber ?? ''} ${r.vendorNameSnapshot ?? ''} ${r.vendorDocumentNumber ?? ''}`.toLowerCase().includes(q);
    });
  }, [rows, chip, query]);

  useEffect(() => { setPage(1); setExportNotice(null); }, [chip, query, gran, month, day, branchId]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE));
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * LIST_PAGE_SIZE;
    return filtered.slice(start, start + LIST_PAGE_SIZE);
  }, [filtered, page]);
  const pageStart = filtered.length === 0 ? 0 : (page - 1) * LIST_PAGE_SIZE + 1;
  const pageEnd = Math.min(page * LIST_PAGE_SIZE, filtered.length);
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
    setExporting(true); setError(null); setExportNotice(null);
    try {
      const result = await createAccountantPackage(companyId, { dateField: 'expenseDate', fromDate, toDate, columnSet, ...(branchId ? { branchId } : {}) });
      // The package covers confirmed expenses only. Downloading an empty workbook reads as a broken
      // export; say which rows it would have contained instead.
      if (result.rowCount === 0) { toast.warning(t('expenses.export_empty', locale)); return; }
      if (result.truncated) setExportNotice(`ส่งออก ${result.rowCount} จากทั้งหมด ${result.totalMatched} รายการ — แบ่งช่วงวันที่ให้สั้นลงเพื่อส่งออกให้ครบ`);
      downloadIndexXlsx(result, `expense-index-${gran === 'month' ? month : day}.xlsx`);
      setExported(true); setTimeout(() => setExported(false), 3000);
    } catch (e) {
      if (isBranchScope403(e, branchId)) { branchFilter?.reportBranchForbidden(); return; }
      setError(err(e));
    }
    finally { setExporting(false); }
  };

  const chips: Array<{ key: typeof chip; label: string }> = [
    { key: 'all', label: t('expenses.chip_all', locale) }, { key: 'draft', label: t('expenses.chip_draft', locale) }, { key: 'pending', label: t('expenses.chip_pending', locale) }, { key: 'confirmed', label: t('expenses.chip_confirmed', locale) }, { key: 'rejected', label: t('expenses.chip_rejected', locale) },
  ];
  const cards = [
    { label: t('expenses.kpi_total', locale), value: baht0(kpi.total), sub: `${kpi.counted} ${t('expenses.kpi_total_sub', locale)}`, icon: ICON.receipt, ...KPI.amber },
    { label: t('expenses.kpi_pending', locale), value: `${kpi.pending} ${t('expenses.unit_document', locale)}`, sub: t('expenses.kpi_pending_sub', locale), icon: ICON.clock, ...KPI.sky },
    { label: t('expenses.kpi_outstanding', locale), value: baht0(kpi.outstanding), sub: t('expenses.kpi_outstanding_sub', locale), icon: ICON.wallet, ...KPI.purple },
    { label: t('expenses.kpi_overdue', locale), value: baht0(kpi.overdue), sub: `${kpi.overdueCount} ${t('expenses.kpi_overdue_sub', locale)}`, icon: ICON.alert, ...KPI.danger, danger: true },
    { label: t('expenses.kpi_vat', locale), value: baht0(kpi.vat), sub: t('expenses.kpi_vat_sub', locale), icon: ICON.doc, ...KPI.brand },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        {/* period control (finBar) */}
        <div className="w-full sm:w-auto">
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
          <p className="mt-1 text-xs text-gray-400">{t('expenses.intake_filter_desc', locale)}</p>
        </div>
        {/* export controls */}
        <div className="flex flex-col gap-1 lg:shrink-0 lg:items-end">
          <div className="flex flex-wrap items-center gap-2">
            {exportNotice && <span className="text-sm font-semibold text-warning-700">{exportNotice}</span>}
            {exported && <span className="text-sm font-semibold text-brand-600">✓ {t('expenses.downloaded', locale)}</span>}
            <ThemedSelect className={cx(inputClass, 'min-w-0 w-auto')} value={columnSet} onChange={(e) => setColumnSet(e.target.value as 'summary' | 'full')} aria-label={t('expenses.export_columns', locale)}>
              <option value="summary">{t('expenses.export_columns_summary', locale)}</option>
              <option value="full">{t('expenses.export_columns_full', locale)}</option>
            </ThemedSelect>
            <button className={btnClass} onClick={exportExcel} disabled={exporting}>{exporting ? t('expenses.generating', locale) : t('expenses.export_excel', locale)}</button>
          </div>
          <p className="text-xs text-gray-400">{t('expenses.export_desc', locale)}</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">{cards.map((c) => <StatCard key={c.label} {...c} />)}</div>

      {error && <ErrorBanner message={error} />}

      {/* full-width list; row click opens the detail popup */}
      <MangmeeCard className="p-4">
          <div className="flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible">
            {chips.map((c) => (
              <button key={c.key} onClick={() => setChip(c.key)}
                className={cx('inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border px-3.5 py-2 text-sm font-semibold transition',
                  chip === c.key ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200')}>
                {c.label}
                <span className={cx('tabular-nums inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-extrabold', chip === c.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500')}>{chipCounts[c.key]}</span>
              </button>
            ))}
            <div className="hidden flex-1 shrink-0 whitespace-nowrap sm:block" />
            <div className="relative w-full max-w-[19.2rem] shrink-0 whitespace-nowrap">
              <input className={cx(inputClass, 'w-full pr-10')} type="search"
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
          <div className="hidden md:block">
          <div className="overflow-x-auto" data-testid="expenses-grid">
            <div className="min-w-[760px]">
              <div className={cx(GRID, 'mt-3 border-b border-gray-100 px-2 pb-2 text-[13px] font-bold uppercase tracking-wide text-gray-400')}>
                <div>{t('expenses.col_vendor_category', locale)}</div><div>{t('expenses.col_date_source', locale)}</div><div className="text-right">{t('expenses.col_total', locale)}</div><div className="text-right">{t('expenses.col_status', locale)}</div><div className="text-right"><span className="sr-only">การทำงาน</span></div>
              </div>
              {loading ? <p className="py-8 text-center text-sm text-gray-500">{t('expenses.loading', locale)}</p>
                : filtered.length === 0 ? <p className="py-10 text-center text-sm text-gray-500">{t('expenses.empty_period', locale)}</p>
                  : pagedRows.map((e) => (
                      <div key={e.id} onClick={() => onSelect(e.id)} data-testid="expenses-row"
                        className={cx(GRID, 'cursor-pointer border-b border-gray-50 px-2 py-3 transition hover:bg-gray-50')}>
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold text-gray-900">{firstFilled(e.vendorNameSnapshot) ?? t('expenses.vendor_pending', locale)}</div>
                          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-400">
                            {e.expenseCategoryId && catNames[e.expenseCategoryId] && <span className="rounded-md bg-gray-100 px-1.5 py-0.5 font-semibold text-gray-600">{catNames[e.expenseCategoryId]}</span>}
                            <span className="tabular-nums truncate">{firstFilled(e.expenseNumber, e.vendorDocumentNumber) ?? '—'}</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500"><span className="font-semibold">{t('expenses.document_date', locale)}:</span> {dateShort(e.expenseDate)}</div>
                          <div className="mt-0.5 text-xs text-gray-500"><span className="font-semibold">{t('expenses.intake_date', locale)}:</span> {dateShort(e.uploadedAt)}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <LateDocumentBadge expense={e} locale={locale} />
                            <MangmeeBadge tone="slate">{expenseValueLabel(CAPTURE_SOURCE_LABELS, e.captureSource, 'ช่องทางอื่น')}</MangmeeBadge>
                          </div>
                        </div>
                        <div className="tabular-nums text-right text-[15px] font-bold text-gray-900">{baht(e.grandTotalAmount)}</div>
                        <div className="flex flex-col items-end gap-1"><StatusBadge status={e.status} /><StatusBadge status={e.paymentStatus} /></div>
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
          <div className="mt-3 space-y-3 md:hidden" data-testid="expenses-card-list">
            {pagedRows.map((e) => (
              <MangmeeCard key={e.id} className="overflow-hidden">
                <button
                  type="button"
                  className="block min-h-11 w-full p-4 text-left"
                  onClick={() => onSelect(e.id)}
                  data-testid="expenses-card"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="max-w-[45%] truncate font-mono text-xs text-gray-600">{firstFilled(e.expenseNumber, e.vendorDocumentNumber) ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{firstFilled(e.vendorNameSnapshot) ?? t('expenses.vendor_pending', locale)}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-500">
                    <div><span className="block font-semibold">{t('expenses.document_date', locale)}</span>{dateShort(e.expenseDate)}</div>
                    <div className="text-right"><span className="block font-semibold">{t('expenses.intake_date', locale)}</span>{dateShort(e.uploadedAt)}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <StatusBadge status={e.status} />
                    <LateDocumentBadge expense={e} locale={locale} />
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

      {confirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => { if (!deleting) setConfirmId(null); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <div className="text-base font-bold text-gray-900">{confirmLabel ? `ลบรายการ “${confirmLabel}” อย่างถาวร?` : 'ลบรายการนี้อย่างถาวร?'}</div>
            <p className="mt-1.5 text-sm leading-relaxed text-gray-500">รายการค่าใช้จ่ายนี้จะถูกลบอย่างถาวรพร้อมข้อมูลที่เกี่ยวข้อง และไม่สามารถย้อนกลับได้</p>
            {deleteError && <div className="mt-3"><ErrorBanner message={deleteError} /></div>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={ghostClass} disabled={deleting} onClick={() => setConfirmId(null)}>ยกเลิก</button>
              <button type="button" className={dangerClass} disabled={deleting} onClick={() => void removeExpense()}>{deleting ? 'กำลังลบ...' : 'ลบถาวร'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

function ManualExpensePanel({ companyId, branchId, onSuccess }: { companyId: string; branchId?: string; onSuccess: (expenseId: string) => void }) {
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
      const forbidden = findForbiddenChars(items.map((item) => item.description).join(''));
      if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
      const result = await createExpenseDraft(companyId, {
        captureSource: 'WEB_MANUAL', expenseDate, branchId, vatMode,
        inputVatClaimStatus: taxCodeDefinitionId ? 'NEEDS_REVIEW' : 'NON_CLAIMABLE',
        lines,
      });
      if (receiptFile) {
        try {
          // The receipt slot: only expense.receipt.primary satisfies the confirm rule.
          await uploadExpenseEvidenceFile(companyId, result.id, branchId ?? null, receiptFile, 'expense.receipt.primary');
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
  const amount = String(afterDiscount.reduce((sum, net) => sum + net, 0));
  const totals = lines.reduce((sum, line, index) => {
    const lineTotals = calculateManualExpenseTotals({ quantity: '1', unitPrice: afterDiscount[index]!, vatRate: line.vatRate, vatMode });
    return { subtotal: sum.subtotal + lineTotals.subtotal, vat: sum.vat + lineTotals.vat, grandTotal: sum.grandTotal + lineTotals.grandTotal };
  }, { subtotal: 0, vat: 0, grandTotal: 0 });
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
    {error && <ErrorBanner message={error} />}
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <MangmeeCard className="space-y-3 p-4">
          {sectionTitle(ICON.doc, 'expenses.manual_document_section', 'expenses.manual_document_helper')}
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_date', locale)}{req}</span><ThemedDate className={inputClass} value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
            <div className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_receipt', locale)}</span>
              <ThemedFile file={receiptFile} accept={RECEIPT_UPLOAD_ACCEPT} disabled={busy || preparingReceipt || !!savedExpenseId} onChange={(file) => void selectReceiptFile(file)} />
              {preparingReceipt ? <p className="mt-1 text-xs text-gray-500">{t('expenses.upload_preparing', locale)}</p>
                : !receiptFile && <p className="mt-1 text-xs text-gray-400">{t('expenses.manual_receipt_helper', locale)}</p>}
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
                    <button type="button" aria-label={t('expenses.manual_remove_item', locale)} disabled={busy} onClick={() => setItems((current) => current.filter((_, i) => i !== index))} className="flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 transition hover:bg-error-50 hover:text-error-600">
                      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4"><path d="M3.5 5.5h13m-9.5 0v-1a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5v1m-6.5 0 .6 10a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4l.6-10M8.2 8.5v5m3.6-5v5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </button>
                  )}
                </span>
              </div>
              <div className="grid gap-3 p-3 sm:grid-cols-3">
                <label className="sm:col-span-3"><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_description', locale)}{req}</span><input required className={inputClass} value={item.description} onChange={(event) => setItem(index, { description: stripDisallowed(event.target.value) })} /></label>
                <label><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_quantity', locale)}{req}</span><input required type="number" min="0" step="0.0001" className={inputClass} value={item.quantity} onChange={(event) => setItem(index, { quantity: event.target.value })} /></label>
                <label><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.manual_unit_price', locale)}{req}</span><input required type="number" min="0" step="0.01" className={inputClass} value={item.unitPrice} onChange={(event) => setItem(index, { unitPrice: event.target.value })} /></label>
                <label><span className="mb-1 block text-xs font-medium text-gray-600">{t('expenses.line_discount', locale)}</span><input type="number" min="0" step="0.01" className={inputClass} value={item.discountAmount} onChange={(event) => setItem(index, { discountAmount: event.target.value })} /></label>
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
          <TransactionTaxLineSelector companyId={companyId} branchId={branchId} sourceType="expense.record" sourceId="new-manual-expense" sourceLineId="line-1" transactionContext="DOMESTIC_PURCHASE" direction="INPUT" documentDate={expenseDate} netAmount={amount} grossAmount={amount} value={taxCodeDefinitionId} canConfigureTax={capture.canConfigureTax} onChange={(id, definition) => { setTaxCodeDefinitionId(id); setTaxCodeName(definition ? `${definition.externalCode} · ${definition.displayName}` : ''); setExternalTaxCode(definition?.externalCode); setVatRate(definition ? taxDefinitionRateForSource(definition.rate, 'expense') : ''); if (!vatModeTouched) setVatMode(!definition || definition.calculationMethod === 'NONE' ? 'NO_VAT' : definition.calculationMethod === 'INCLUSIVE' ? 'VAT_INCLUDED' : 'VAT_EXCLUDED'); }} />
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
          <MangmeeBadge tone={taxCodeDefinitionId ? 'purple' : 'slate'}>{taxCodeName || t('expenses.manual_no_tax_code', locale)}</MangmeeBadge>
          {savedExpenseId
            ? <button type="button" className={cx(btnClass, 'w-full')} onClick={() => onSuccess(savedExpenseId)}>{t('expenses.manual_open_saved', locale)}</button>
            : <button disabled={busy || preparingReceipt || !expenseDate || !items.every((item) => item.description.trim() && item.unitPrice)} className={cx(btnClass, 'w-full')}>{busy ? t('expenses.manual_saving', locale) : t('expenses.manual_save_draft', locale)}</button>}
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
  const caps = expenseCapabilities(permissions);

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
          {tab === 'upload' && <UploadPanel companyId={companyId} {...(branchId ? { branchId } : {})} {...(caps.canCreate ? { onNoDocument: () => router.push(`/companies/${companyId}/expenses/substitute-receipts/new`) } : {})} onSuccess={(expenseId, notice) => { storeExtractionNotice(expenseId, notice); openListExpense(expenseId); }} />}
          {tab === 'manual' && <ManualExpensePanel companyId={companyId} {...(branchId ? { branchId } : {})} onSuccess={openListExpense} />}
          {tab === 'categories' && <CategoryManagePanel companyId={companyId} />}
          {tab === 'signatures' && <SignaturePanel companyId={companyId} canApprove={caps.canApproveSignatures} />}
          {tab === 'evidence' && <EvidencePanel companyId={companyId} canExport={caps.canExportPackage} canReadLedger={caps.canReadLedger} canPostLedger={caps.canPostLedger} onOpenExpense={openListExpense} />}
        </>
      )}
    </MangmeePage>
  );
}
