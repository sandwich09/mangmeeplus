'use client';

import Link from 'next/link';
import { E_WHT_WORDS, eWhtPaymentMethodAllowed } from '@watchdog-bms/contracts';
import { expenseEWhtPaymentWarning } from './expenses.model';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { SubstitutePaperDocumentPreview, SubstitutePaperSigningPanel } from './SubstitutePaperSigningPanel';
import { SubstituteSignerPositionField } from './SubstituteSignerPositionField';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS,
  THAI_SYSTEM_ROLE_NAMES,
  coerceCivilDate,
  isCheckBillClassification,
  substituteReceiptRequiresPaymentEvidence,
  type ExpensePaymentMethod,
  type SubstituteReceiptCandidate,
  type LineSubstituteReceiptPrefill,
  type SubstituteReceiptEvidenceSummary,
  type SubstituteReceiptPaperPreview,
  type SubstituteReceiptReasonCode,
  type SubstituteReceiptRuntimePolicy,
} from '@watchdog-bms/contracts';
import { useConfirm } from '@/common/components/modal/use-confirm';
import { Modal } from '@/common/components/modal/Modal';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { MoreActions } from '@/common/components/actions/MoreActions';
import { Pagination } from '@/common/components/data-table/Pagination';
import { quietButtonClass } from '@/common/components/button/button-classes';
import { ChoiceRow } from '@/common/components/field';
import { MetricGrid } from '@/common/components/mangmee/MetricGrid';
import { focusExpenseField } from './expense-focus.logic';
import { Notice } from '@/common/components/notice';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { EmptyState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey, SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { useBranchFilter } from '../web-core-workspace/WorkspaceScope';
import { TransactionBranchField, useTransactionCreateBranchId } from '../web-core-workspace/TransactionBranchField';
import {
  approveSubstituteReceipt,
  correctSubstituteDocument,
  certifySubstituteReceipt,
  completePersonalSignatureUpload,
  createExpenseDraft,
  downloadPaymentVoucherPdf,
  downloadSubstituteReceiptPdf,
  fetchAttachmentPreviewBlob,
  fetchSubstituteReceiptPdfBlob,
  generateSubstituteReceipt,
  amendSubstituteReceipt,
  getExpense,
  getSubstituteReceiptRuntimePolicy,
  initPersonalSignatureUpload,
  listExpenseCategories,
  listSubstituteReceiptHistory,
  listSubstituteReceiptPayers,
  loadLineSubstituteReceiptPrefill,
  previewSubstituteReceipt,
  previewIssuedSubstitutePaper,
  supersedeSubstituteReceipt,
  updateExpenseReviewFields,
  uploadExpenseEvidenceFile,
  uploadReceiptFile,
} from './expenses.api';
import {
  allowsDomesticInputTaxCode,
  buildExpenseDraftReviewPayload,
  clearExpenseTaxSelections,
  findOpaqueBounds,
  removeLightBackground,
} from './expenses.model';
import type { ExpenseCategorySummary, ExpenseDetail, ExpenseSummary } from './expenses.model';
import { ExpenseReviewEditSection, reviewValues } from './ExpensesPages';
import { expenseEvidenceAssessment } from '@watchdog-bms/contracts';
import {
  amountText,
  btnClass,
  dangerClass,
  dateShort,
  err,
  ErrorBanner,
  ghostClass,
  ICON,
  InfoBanner,
  inputClass,
} from './ExpensesUi';
import { ATTACHMENT_UPLOAD_ACCEPT, IMAGE_UPLOAD_ACCEPT, assertAllowedUploadFile, prepareAttachmentUpload } from '@/common/files/upload-file.logic';
import { findForbiddenChars, normalizeDecimalInput, stripDisallowed } from '@/common/forms/sanitize';
import {
  canClaimReimbursementFromSubstituteReceipt,
  canEditSubstituteReceipt,
  paymentMonthChanged,
  clearSubstituteWizardDraft,
  defaultSubstituteReceiptReason,
  evaluateDetailsReadiness,
  evaluateEvidenceReadiness,
  evaluateExpensePrerequisites,
  evaluateManualLinesReadiness,
  evaluateSigningReadiness,
  substituteReceiptIneligibleCause,
  isManualLineDecimal,
  manualLineAmount,
  manualLinesTotal,
  MAX_SUBSTITUTE_MANUAL_LINES,
  defaultCertifierId,
  mayApproveSubstituteReceipt,
  payeeTaxIdDigits,
  payerWrittenMissingReason,
  readSubstituteWizardDraft,
  resolveSubstituteTurn,
  resolveWizardEntryMode,
  resolveWizardSignatureSource,
  resolveWizardStep,
  substituteReceiptEvidenceRenderabilityIssue,
  substituteReceiptRenderabilityIssue,
  validatePayeeIdentity,
  wizardJourneyStage,
  currentSubstituteRevision,
  writeSubstituteWizardDraft,
  type ExpensePrerequisiteIssue,
  type PayeeIdentityIssue,
  type SubstituteReceiptIneligibleCause,
  type SubstituteReceiptEvidenceRenderabilityIssue,
  type SubstituteManualLineDraft,
  type SubstituteReceiptRenderabilityIssue,
  type SubstituteWizardDraftStep,
  type WizardEntryMode,
  type WizardJourneyStage,
  type WizardStep,
} from './substitute-receipt-wizard.model';
import { findEvidenceExpenseId, listSubstituteReceiptCandidates, uploadSubstituteReceiptEvidence } from './substitute-receipt.api';
import { SignaturePad } from './SignaturePad';
import { SubstituteReceiptCancelDialog } from './SubstituteReceiptCancelDialog';
import { SignatureThumb } from './ExpensesWorkspacePanels';

/** A chosen file the expense no longer lists (it was removed elsewhere): said where the file would be. */
const ATTACHMENT_MISSING_TEXT = 'ไม่พบข้อมูลไฟล์แนบ โหลดหน้านี้อีกครั้ง';
/** Hard ceiling on per-expense detail requests fired by one candidate scan. */
const RENDERABILITY_ISSUE_KEYS: Record<SubstituteReceiptRenderabilityIssue, DictionaryKey> = {
  too_many_lines: 'expenses.substitute_wizard.render_limit_lines',
  line_description_too_long: 'expenses.substitute_wizard.render_limit_description',
};
const EVIDENCE_RENDERABILITY_ISSUE_KEYS: Record<SubstituteReceiptEvidenceRenderabilityIssue, DictionaryKey> = {
  too_many_evidence: 'expenses.substitute_wizard.render_limit_evidence',
  evidence_filename_too_long: 'expenses.substitute_wizard.render_limit_filename',
};

function renderabilityIssueMessage(issue: SubstituteReceiptRenderabilityIssue, locale: SupportedLocale): string {
  const count = issue === 'too_many_lines'
    ? SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxExpenseLines
    : SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength;
  return t(RENDERABILITY_ISSUE_KEYS[issue], locale).replace('{count}', String(count));
}

function evidenceRenderabilityIssueMessage(
  issue: SubstituteReceiptEvidenceRenderabilityIssue,
  locale: SupportedLocale,
): string {
  const count = issue === 'too_many_evidence'
    ? SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments
    : SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceFileNameLength;
  return t(EVIDENCE_RENDERABILITY_ISSUE_KEYS[issue], locale).replace('{count}', String(count));
}

type ManualLineEditor = SubstituteManualLineDraft & { id: string };
type WizardPreviewSource = DocumentPreviewSource & { onViewed?: () => void };
const blankManualLine = (id: string): ManualLineEditor => ({
  id,
  description: '',
  expenseCategoryId: '',
  quantity: '1',
  unitPrice: '',
});
type ManualLineField = 'description' | 'expenseCategoryId' | 'quantity' | 'unitPrice';
const manualLineControlId = (lineId: string, field: ManualLineField) => `substitute-${lineId}-${field}`;
function invalidManualLineFields(line: ManualLineEditor): ManualLineField[] {
  const invalid: ManualLineField[] = [];
  const quantity = Number(line.quantity);
  const unitPrice = Number(line.unitPrice);
  if (!line.description.trim()
    || line.description.trim().length > SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength) invalid.push('description');
  if (!line.expenseCategoryId.trim()) invalid.push('expenseCategoryId');
  if (!isManualLineDecimal(line.quantity) || !Number.isFinite(quantity) || quantity <= 0) invalid.push('quantity');
  if (!isManualLineDecimal(line.unitPrice) || !Number.isFinite(unitPrice) || unitPrice <= 0 || manualLineAmount(line) <= 0) invalid.push('unitPrice');
  return invalid;
}
/** What one field of a quick-expense line still lacks, said under that field. */
function manualLineFieldError(line: ManualLineEditor, field: ManualLineField): string {
  if (field === 'description') {
    return line.description.trim()
      ? `รายละเอียดต้องไม่เกิน ${SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxLineDescriptionLength} ตัวอักษร`
      : 'กรอกรายละเอียดค่าใช้จ่าย';
  }
  if (field === 'expenseCategoryId') return 'เลือกหมวดหมู่';
  return field === 'quantity' ? 'จำนวนต้องมากกว่า 0' : 'ราคาต้องมากกว่า 0';
}
const todayIso = () => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
};

/** One sentence per cause, each naming where it is put right (thai-ux-standard 1.6): never the five suspects at once. */
const INELIGIBLE_CAUSE_TEXT: Record<SubstituteReceiptIneligibleCause, string> = {
  documentType: 'ค่าใช้จ่ายนี้เลือกประเภทเป็นใบรับรองไว้แล้ว เปิดค่าใช้จ่ายเพื่อตรวจประเภทเอกสาร',
  status: 'ค่าใช้จ่ายนี้ยืนยันหรือยกเลิกไปแล้ว จึงทำใบรับรองเพิ่มไม่ได้',
  currency: 'ค่าใช้จ่ายนี้ไม่ใช่เงินบาท จึงทำใบรับรองไม่ได้',
  amount: 'ยอดรวมยังเป็น 0 เปิดค่าใช้จ่ายแล้วใส่จำนวนและราคา',
  taxEvidence: 'ค่าใช้จ่ายนี้มีหลักฐานรายจ่ายที่ใช้ได้แล้ว เปิดค่าใช้จ่ายเพื่อตรวจคำตอบ',
  lines: 'ค่าใช้จ่ายนี้ยังไม่มีรายการ หรือมีรายการที่ไม่มีรายละเอียด เปิดค่าใช้จ่ายแล้วแก้',
  category: 'ยังไม่ได้เลือกหมวดหมู่ เปิดค่าใช้จ่ายแล้วเลือกหมวดหมู่ให้ทุกรายการ',
  classification: 'ระบบจัดเอกสารนี้ว่าไม่ใช่ค่าใช้จ่าย เปิดค่าใช้จ่ายแล้วตรวจประเภทเอกสาร',
};

/** Short names for the line under a blocked button; the notice above it says how to put the thing right. */
const PREREQUISITE_NAMES: Partial<Record<ExpensePrerequisiteIssue | SubstituteReceiptIneligibleCause, string>> = {
  reviewedCategory: 'หมวดหมู่ของรายการ', category: 'หมวดหมู่ของรายการ',
  reviewedAmount: 'ยอดรวมของค่าใช้จ่าย', amount: 'ยอดรวมของค่าใช้จ่าย',
};

const PREREQUISITE_KEYS: Record<ExpensePrerequisiteIssue, DictionaryKey> = {
  reviewedAmount: 'expenses.substitute_wizard.prerequisite_amount',
  reviewedCategory: 'expenses.substitute_wizard.prerequisite_category',
  renderability: 'expenses.substitute_wizard.render_limit_action_help',
};

function RequiredMark() {
  return <span className="ml-1 font-extrabold text-error-700" aria-hidden="true">*</span>;
}

/** Owner directive: an action is never disabled silently. Whatever still blocks the primary button
 *  of a step is named right under it, in the same words the readiness list uses. */
function BlockedReason({ labels, prefix, jumps = {} }: { labels: string[]; prefix: string; jumps?: Record<string, (() => void) | undefined> }) {
  if (labels.length === 0) return null;
  return (
    <p role="status" className="text-sm text-gray-600">
      <span className="font-bold text-warning-700">{prefix}</span>{' '}
      {labels.map((label, index) => {
        const jump = jumps[label];
        return (
          <span key={label}>
            {index > 0 && ' · '}
            {/* A link inside a sentence: it takes the person to the thing that is missing. */}
            {jump ? <button type="button" className="text-left font-semibold text-brand-700 underline underline-offset-2" onClick={jump}>{label}</button> : label}
          </span>
        );
      })}
    </p>
  );
}

const REASON_KEYS: Record<SubstituteReceiptReasonCode, DictionaryKey> = {
  PAYEE_CANNOT_ISSUE: 'expenses.substitute_wizard.reason_payee_cannot_issue',
  RECEIPT_UNAVAILABLE: 'expenses.substitute_wizard.reason_receipt_unavailable',
  RECEIPT_MATERIALLY_INCOMPLETE: 'expenses.substitute_wizard.reason_incomplete',
  OTHER: 'expenses.substitute_wizard.reason_other',
};

const PAYMENT_KEYS: Record<ExpensePaymentMethod, DictionaryKey> = {
  CASH: 'expenses.substitute_wizard.payment_cash',
  BANK_TRANSFER: 'expenses.substitute_wizard.payment_transfer',
  CARD: 'expenses.substitute_wizard.payment_card',
  CHEQUE: 'expenses.substitute_wizard.payment_cheque',
  OTHER: 'expenses.substitute_wizard.payment_other',
};

const JOURNEY_STAGE_KEYS: Record<WizardJourneyStage, DictionaryKey> = {
  expense: 'expenses.substitute_wizard.journey_expense',
  prepare: 'expenses.substitute_wizard.journey_prepare',
  sign: 'expenses.substitute_wizard.journey_sign',
  done: 'expenses.substitute_wizard.journey_done',
};
const JOURNEY_STAGES: WizardJourneyStage[] = ['expense', 'prepare', 'sign', 'done'];

const PAYEE_ISSUE_KEYS: Record<PayeeIdentityIssue, DictionaryKey> = {
  payee_name_required: 'expenses.substitute_wizard.payee_name_required',
  payee_name_too_long: 'expenses.substitute_wizard.payee_name_too_long',
  payee_address_too_long: 'expenses.substitute_wizard.payee_address_too_long',
  payee_tax_id_13: 'expenses.substitute_wizard.payee_tax_id_13',
};

/**
 * The chosen expense in one line (number, payee or first line, amount once); its lines open on
 * request. It stood as a card with an opened list on every screen of the wizard, which put the same
 * amount on screen three times for a one-line expense and pushed the work a screen down.
 */
function DetailSummary({ detail, categories = [] }: { detail: ExpenseDetail; title?: ReactNode; categories?: ExpenseCategorySummary[] }) {
  const locale = useWorkspaceLocale();
  const categoryName = (categoryId: string | null) => categories.find((category) => category.id === categoryId)?.name
    ?? (categoryId ? t('expenses.substitute_wizard.category_recorded', locale) : t('expenses.substitute_wizard.not_specified', locale));
  const name = detail.vendorNameSnapshot || detail.lines[0]?.description || t('expenses.substitute_wizard.not_specified', locale);
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
      <p className="break-words font-semibold text-gray-900">
        {[detail.expenseNumber, name].filter(Boolean).join(' · ')} · <span className="mangmee-unit">{`${amountText(detail.grandTotalAmount)} บาท`}</span>
      </p>
      <details>
        <summary className="cursor-pointer py-1.5 text-sm font-semibold text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
          {t('expenses.substitute_wizard.view_all_items', locale).replace('{count}', String(detail.lines.length))}
        </summary>
        <ol className="divide-y divide-gray-100 border-t border-gray-100">
          {detail.lines.map((line) => (
            <li key={line.id} className="grid gap-1 py-2 text-sm text-gray-600 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3">
              <span className="min-w-0">
                <span className="font-medium text-gray-800">{line.description}</span>
                <span className="block text-gray-500">{categoryName(line.expenseCategoryId)}</span>
              </span>
              <span className="mangmee-unit">{t('expenses.substitute_wizard.line_calculation', locale)
                .replace('{quantity}', line.quantity)
                .replace('{unitPrice}', `${amountText(line.unitPrice)} บาท`)}</span>
              <span className="mangmee-unit font-semibold text-gray-900">{`${amountText(line.lineTotalAmount)} บาท`}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

function SignatureFields({
  signatureFile,
  signaturePreview,
  busy,
  savedSignatureAvailable,
  savedSignatureUsed,
  savedSignaturePreviewUrl,
  onSelect,
  onDrawChange,
  onClean,
  onDrawn,
}: {
  signatureFile: File | null;
  signaturePreview: { original: string; cleaned: string } | null;
  busy: boolean;
  /** R9: the signer has a saved ACTIVE signature, so signing here is the alternative, not the path.
   *  Kept separate from `savedSignatureUsed` so preparing a file never remounts these fields. */
  savedSignatureAvailable: boolean;
  /** R9: no file prepared yet, so the saved signature is what this certificate will carry. */
  savedSignatureUsed: boolean;
  /** A8: the image that saved signature actually is. Nobody should certify one they cannot see. */
  savedSignaturePreviewUrl?: string | null;
  onSelect: (file: File | null) => void;
  /** Unconfirmed pad strokes block submit the same way a chosen-but-unprocessed file does. */
  onDrawChange: (hasStrokes: boolean) => void;
  onClean: () => void;
  onDrawn: (file: File, preview: { original: string; cleaned: string }) => void;
}) {
  const locale = useWorkspaceLocale();
  const [method, setMethod] = useState<'draw' | 'upload'>('draw');
  const [replacingSignature, setReplacingSignature] = useState(false);
  const selectMethod = (next: 'draw' | 'upload') => {
    setMethod(next);
    onSelect(null);
    onDrawChange(false);
  };
  const fields = (
    <div className="space-y-3">
      <fieldset aria-required={!savedSignatureUsed}>
        <legend className="mb-2 text-sm font-semibold text-gray-700">
          {t('expenses.substitute_wizard.signature_method', locale)}
        </legend>
        <div className="grid grid-cols-2 rounded-xl bg-gray-100 p-1">
          {(['draw', 'upload'] as const).map((option) => (
            <label key={option} className={cx(
              'flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2 py-1 text-center text-sm font-semibold transition focus-within:ring-2 focus-within:ring-brand-500 sm:min-h-10',
              method === option ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600',
            )}>
              <input
                className="sr-only"
                type="radio"
                aria-label={t(option === 'draw' ? 'expenses.substitute_wizard.signature_method_draw' : 'expenses.substitute_wizard.signature_method_upload', locale)}
                name="signature-method"
                value={option}
                required={!savedSignatureUsed}
                checked={method === option}
                onChange={() => selectMethod(option)}
              />
              {t(option === 'draw'
                ? 'expenses.substitute_wizard.signature_method_draw'
                : 'expenses.substitute_wizard.signature_method_upload', locale)}
            </label>
          ))}
        </div>
      </fieldset>
      {method === 'draw' ? (
        // Once a drawing is taken the box gives way to the drawing itself (below), with a way to sign anew.
        !signaturePreview && <SignaturePad busy={busy} onChange={(hasStrokes) => { onSelect(null); onDrawChange(hasStrokes); }} onConfirm={onDrawn} />
      ) : (
        <>
          <div className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.signature_file', locale)}{!savedSignatureUsed && <RequiredMark />}</span>
            <ThemedFile file={signatureFile} aria-required={!savedSignatureUsed} accept={IMAGE_UPLOAD_ACCEPT} aria-label={t('expenses.substitute_wizard.signature_file', locale)} onChange={onSelect} />
          </div>
          <button type="button" className={ghostClass} disabled={busy || !signatureFile} aria-busy={Boolean(busy)} onClick={onClean}>
            {t('expenses.substitute_wizard.clean_signature', locale)}
          </button>
        </>
      )}
      {/* The signature that will be used, shown once: the drawing as it will sit on the paper. */}
      {signaturePreview && (
        <div>
          <p className="mb-1 text-sm text-gray-600">{t('expenses.substitute_wizard.signature_processed', locale)}</p>
          <img src={signaturePreview.cleaned} alt={t('expenses.substitute_wizard.signature_processed', locale)} className="max-h-32 rounded-lg border" style={{ backgroundImage: 'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)', backgroundSize: '16px 16px' }} />
          {method === 'draw' && (
            <ActionGroup align="start" className="mt-2">
              <button type="button" className={ghostClass} onClick={() => { if (busy) return; onSelect(null); onDrawChange(false); }}>เซ็นใหม่</button>
            </ActionGroup>
          )}
        </div>
      )}
    </div>
  );
  if (!savedSignatureAvailable) return fields;
  return (
    <div className="space-y-3">
      {savedSignatureUsed && !replacingSignature && (
        <>
          <p className="rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700">
            {t('expenses.substitute_wizard.saved_signature_used', locale)}
          </p>
          {/* A8: the signer was asked to certify with an image the screen never showed them. */}
          {savedSignaturePreviewUrl && (
            <SignatureThumb url={savedSignaturePreviewUrl} alt={t('expenses.substitute_wizard.saved_signature_used', locale)} />
          )}
        </>
      )}
      {/* Uncontrolled on purpose: the only way to prepare a file is to open this first. */}
      {/* Hide the saved preview when opening the editor, before a stroke can start.
          Removing it on pointer-down moves the canvas underneath the pointer. */}
      <details className="rounded-xl border border-gray-200 p-3" onToggle={event => setReplacingSignature(event.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-semibold text-gray-700">
          {t('expenses.substitute_wizard.saved_signature_replace', locale)}
        </summary>
        <div className="mt-3">{fields}</div>
      </details>
    </div>
  );
}

export function SubstituteReceiptWizardPage({
  companyId,
  userId,
  permissions,
  canSelfApprove,
  initialExpenseId,
  initialEntryMode,
  workflowId,
  evidenceId,
  initialEditPayment = false,
  viewOnly = false,
}: {
  companyId: string;
  userId: string;
  permissions: string[];
  canSelfApprove: boolean;
  initialExpenseId?: string;
  initialEntryMode?: WizardEntryMode;
  routeCheckBill?: boolean;
  workflowId?: string;
  evidenceId?: string;
  initialEditPayment?: boolean;
  viewOnly?: boolean;
}) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [confirmedPaymentMonth, setConfirmedPaymentMonth] = useState<string | null>(null);
  const branchFilter = useBranchFilter();
  const branchId = branchFilter?.branchId ?? '';
  const createBranchId = useTransactionCreateBranchId();
  const canReview = !viewOnly && permissions.includes('expense.review');
  const canStart = !viewOnly && permissions.some((key) => ['expense.review', 'expense.confirm', 'expense.read', 'expense.read_related', 'expense.read_own'].includes(key));
  const canFillShop = permissions.includes('company.setup.read') && permissions.includes('company.legal_identity.manage');
  const canConfirm = !viewOnly && permissions.includes('expense.confirm');
  const canCreate = !viewOnly && permissions.includes('expense.create');
  const shouldLoadCategories = permissions.includes('expense.read') || canCreate || canReview;
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const canPrepare = canReview || (canStart && detail?.createdByUserId === userId);
  const canUploadEvidence = canPrepare && (!canReview || permissions.includes('attachment.create'));
  const [receiptEvidence, setReceiptEvidence] = useState<SubstituteReceiptEvidenceSummary | null>(null);
  const [editingPrepared, setEditingPrepared] = useState(false);
  const isCancelled = receiptEvidence?.status === 'SUPERSEDED';
  // Spec §10/AC08: the done step's "สร้างใบเบิกจากใบนี้" entry point — a navigational link, not
  // an edit of this wizard, so it is not gated behind viewOnly like canReview/canConfirm/canCreate.
  const canClaimReimbursement = canClaimReimbursementFromSubstituteReceipt(receiptEvidence, permissions.includes('reimbursement.create')
    && (receiptEvidence?.payerUserId === userId || permissions.includes('reimbursement.finance_review')));
  const [history, setHistory] = useState<SubstituteReceiptEvidenceSummary[]>([]);
  const [policy, setPolicy] = useState<(SubstituteReceiptRuntimePolicy & { canCertifyAndApprove?: boolean }) | null>(null);
  const [activeStep, setActiveStep] = useState<WizardStep>('expense');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [linePrefill, setLinePrefill] = useState<LineSubstituteReceiptPrefill | null>(null);
  // URL/LINE flags are navigation hints. Reloaded server classification decides the route.
  const checkBillRoute = isCheckBillClassification(detail?.aiVerificationSummaryJson);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const sourceSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [candidates, setCandidates] = useState<SubstituteReceiptCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(!evidenceId);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidatesReloadKey, setCandidatesReloadKey] = useState(0);
  const [categories, setCategories] = useState<ExpenseCategorySummary[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(shouldLoadCategories);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoriesReloadKey, setCategoriesReloadKey] = useState(0);
  const [entryMode, setEntryMode] = useState<WizardEntryMode | null>(initialExpenseId ? 'existing' : initialEntryMode ?? null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidatePage, setCandidatePage] = useState(1);
  const [consent, setConsent] = useState(false);
  const [reasonCode, setReasonCode] = useState<SubstituteReceiptReasonCode>('PAYEE_CANNOT_ISSUE');
  const [missingReason, setMissingReason] = useState('');
  /** W06 §12.2: a suggestion from the reviewed facts. Offered, never typed for the payer. */
  const [missingReasonSuggestion, setMissingReasonSuggestion] = useState('');
  const [businessPurpose, setBusinessPurpose] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [payeeAddress, setPayeeAddress] = useState('');
  const [payeeTaxId, setPayeeTaxId] = useState('');
  const [payeeTouched, setPayeeTouched] = useState(false);
  const [payerId, setPayerId] = useState('');
  const [signingMethod, setSigningMethod] = useState<'' | 'DIGITAL' | 'PAPER'>('');
  const [payers, setPayers] = useState<Array<{ userId: string; displayName: string; isOwner?: boolean }>>([]);
  const [payersLoading, setPayersLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('BANK_TRANSFER');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [supportingIds, setSupportingIds] = useState<string[]>([]);
  const [paymentIds, setPaymentIds] = useState<string[]>([]);
  const [supportingFile, setSupportingFile] = useState<File | null>(null);
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [uploadingPurpose, setUploadingPurpose] = useState<string | null>(null);
  const [manualDate, setManualDate] = useState(todayIso());
  const [manualLines, setManualLines] = useState<ManualLineEditor[]>([blankManualLine('manual-line-1')]);
  const [manualValidationAttempted, setManualValidationAttempted] = useState(false);
  const [manualAnnouncement, setManualAnnouncement] = useState('');
  const [fundingSource, setFundingSource] = useState<'' | 'COMPANY' | 'PERSONAL_ADVANCE'>('');
  useEffect(() => {
    if (detail?.whtRemittance === 'E_WHT' && fundingSource === 'COMPANY' && !eWhtPaymentMethodAllowed(paymentMethod)) setPaymentMethod('BANK_TRANSFER');
  }, [detail?.whtRemittance, fundingSource, paymentMethod]);
  const [paidInFullAcknowledged, setPaidInFullAcknowledged] = useState(false);
  const [signerPosition, setSignerPosition] = useState('');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [cleanedSignatureFile, setCleanedSignatureFile] = useState<File | null>(null);
  const [signatureDrawn, setSignatureDrawn] = useState(false);
  const [signaturePreview, setSignaturePreview] = useState<{ original: string; cleaned: string } | null>(null);
  /** The approver's signature shown is the drawing this person made a moment ago as certifier. */
  const [signatureCarried, setSignatureCarried] = useState(false);
  const previewEvidenceRevisionRef = useRef<string | null>(null);
  const [previewChecksum, setPreviewChecksum] = useState<string | null>(null);
  const [certifiedPreviewed, setCertifiedPreviewed] = useState(false);
  const [certificationAcknowledged, setCertificationAcknowledged] = useState(false);
  const [approvalAcknowledged, setApprovalAcknowledged] = useState(false);
  const [preview, setPreview] = useState<WizardPreviewSource | null>(null);
  const [paperArtifactPreview, setPaperArtifactPreview] = useState<SubstituteReceiptPaperPreview | null>(null);
  const previewRequestRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const [supersedeReason, setSupersedeReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const candidateHeadingRef = useRef<HTMLHeadingElement>(null);
  const manualHeadingRef = useRef<HTMLHeadingElement>(null);
  const manualDateTriggerRef = useRef<HTMLButtonElement>(null);
  const manualLineSequenceRef = useRef(1);
  const manualLineDescriptionRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const manualLineCardRefs = useRef<Record<string, HTMLFieldSetElement | null>>({});
  const addManualLineRef = useRef<HTMLButtonElement>(null);
  const selectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocusTargetRef = useRef<'candidate' | 'manual' | 'selection' | 'details' | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const versionHistoryRef = useRef<HTMLDetailsElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const errorNoticeRef = useRef<HTMLDivElement>(null);
  /** Which expense's saved draft has already been applied — persistence starts only after that. */
  const [draftHydratedFor, setDraftHydratedFor] = useState<string | null>(null);
  // Route hydration and form defaults do not change which document the person opened.
  const previewScope = [companyId, detail?.id ?? '', receiptEvidence?.id ?? ''].join('\u0000');
  const previewRevision = [previewScope, receiptEvidence?.updatedAt ?? '', signerPosition].join('\u0000');
  const previewRevisionRef = useRef(previewRevision);
  previewRevisionRef.current = previewRevision;
  const previewScopeRef = useRef(previewScope);
  previewScopeRef.current = previewScope;

  const releasePreviewUrl = useCallback(() => {
    const url = previewUrlRef.current;
    previewUrlRef.current = null;
    if (url) URL.revokeObjectURL(url);
  }, []);

  const isPreviewRequestCurrent = (requestId: number, requestScope: string) => (
    requestId === previewRequestRef.current && requestScope === previewScopeRef.current
  );

  const commitPreview = useCallback((requestId: number, requestScope: string, source: WizardPreviewSource, requestRevision?: string) => {
    if (requestId !== previewRequestRef.current || requestScope !== previewScopeRef.current) {
      if (source.url.startsWith('blob:')) URL.revokeObjectURL(source.url);
      return false;
    }
    releasePreviewUrl();
    if (source.url.startsWith('blob:')) previewUrlRef.current = source.url;
    setPreview({
      ...source,
      ...(source.onViewed ? {
        onViewed: () => {
          if (requestId !== previewRequestRef.current || requestScope !== previewScopeRef.current) return;
          if (requestRevision !== previewRevisionRef.current) {
            setError('ข้อมูลเอกสารเปลี่ยนแล้ว ปิดเอกสารแล้วกดอ่านเอกสารอีกครั้งก่อนเซ็น');
            return;
          }
          source.onViewed?.();
        },
      } : {}),
    });
    return true;
  }, [releasePreviewUrl]);

  const closePreview = useCallback(() => {
    previewRequestRef.current += 1;
    releasePreviewUrl();
    setPreview(null);
    setPaperArtifactPreview(null);
  }, [releasePreviewUrl]);

  useEffect(() => {
    previewRequestRef.current += 1;
    releasePreviewUrl();
    setPreview(null);
    setPaperArtifactPreview(null);
    setPreviewChecksum(null);
    setCertifiedPreviewed(false);
    return () => {
      previewRequestRef.current += 1;
      releasePreviewUrl();
    };
  }, [companyId, detail?.id, receiptEvidence?.id, releasePreviewUrl]);

  // Updating signing facts invalidates consent to sign, not the open reader or its pending request.
  useEffect(() => {
    setPreviewChecksum(null);
    setCertifiedPreviewed(false);
  }, [previewRevision]);
  const payeeIdentityIssues = validatePayeeIdentity({
    payeeName,
    payeeAddress,
    payeeTaxId,
    vendorNameSnapshot: detail?.vendorNameSnapshot,
  });
  const candidatePagination = { rows: candidates, page: candidatePage, totalPages: Math.ceil(candidateTotal / 5) };
  const manualLinesReadiness = useMemo(() => evaluateManualLinesReadiness(manualLines), [manualLines]);
  const manualMissingCount = manualLinesReadiness.missingCount + (manualDate ? 0 : 1);
  const manualTotal = useMemo(() => manualLinesTotal(manualLines), [manualLines]);
  const selectedExpenseRenderabilityIssue = detail ? substituteReceiptRenderabilityIssue(detail) : null;
  // W2: the prepare blockers that live on the expense itself. Evaluated as soon as an expense is
  // chosen so they are visible before anything is typed, not one per failed จัดทำเอกสาร.
  const expensePrerequisites = detail ? evaluateExpensePrerequisites(detail) : null;
  const expenseIneligibleCause = receiptEvidence?.correctionOfEvidenceId || !detail ? null : substituteReceiptIneligibleCause(detail);
  const selectedPaymentCount = detail?.attachments.filter((attachment) => paymentIds.includes(attachment.id)
    && attachment.status === 'ACTIVE' && attachment.purpose === 'expense.payment.evidence'
    && !detail.attachments.some((source) => source.id === attachment.id && source.purpose !== 'expense.payment.evidence')
    && (attachment.mimeType.startsWith('image/') || attachment.mimeType === 'application/pdf')).length ?? 0;
  const selectedEvidenceAttachments = useMemo(() => {
    const selectedIds = new Set([...supportingIds, ...paymentIds]);
    return detail?.attachments.filter((attachment) => selectedIds.has(attachment.id)) ?? [];
  }, [detail, paymentIds, supportingIds]);
  const selectedEvidenceRenderabilityIssue = substituteReceiptEvidenceRenderabilityIssue(selectedEvidenceAttachments);

  const requestWorkflowFocus = (target: 'candidate' | 'manual' | 'selection' | 'details') => {
    pendingFocusTargetRef.current = target;
    setFocusRevision((current) => current + 1);
  };

  useEffect(() => {
    if (focusRevision === 0) return;
    const frame = window.requestAnimationFrame(() => {
      const target = {
        candidate: candidateHeadingRef.current,
        manual: manualHeadingRef.current,
        selection: selectionHeadingRef.current,
        details: detailsHeadingRef.current,
      }[pendingFocusTargetRef.current ?? 'selection'];
      pendingFocusTargetRef.current = null;
      if (!target) return;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
      target.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusRevision]);

  /** Takes the person to the thing a "still missing" item names. */
  const jumpTo = (element: HTMLElement | null) => {
    if (!element) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    element.focus({ preventScroll: true });
  };

  // A refusal is drawn beside the button that caused it; when that is off screen (a long form on a
  // phone) it is brought into view, so a press never looks as if nothing happened.
  useEffect(() => {
    if (!error) return;
    const frame = window.requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      errorNoticeRef.current?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error]);

  const assertAllowed = (...values: string[]) => {
    const forbidden = findForbiddenChars(values.join(''));
    if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
  };

  /** Last line of defence for the two expense-level blockers; the buttons are already gated on them,
   *  so reaching this means the expense changed under an open wizard. */
  const assertExpensePrerequisites = (target: ExpenseDetail) => {
    const cause = substituteReceiptIneligibleCause(target);
    if (cause) throw new Error(INELIGIBLE_CAUSE_TEXT[cause]);
    const issue = evaluateExpensePrerequisites(target).missing.find((candidate) => candidate !== 'renderability');
    if (issue) throw new Error(t(PREREQUISITE_KEYS[issue], locale));
  };

  const initializeDraft = useCallback((nextDetail: ExpenseDetail, cancelledEvidence?: SubstituteReceiptEvidenceSummary) => {
    setDraftHydratedFor(null);
    setDetail(nextDetail);
    const assessment = expenseEvidenceAssessment(nextDetail);
    setReasonCode(assessment?.receiptProblem === 'LOST' ? 'RECEIPT_UNAVAILABLE'
      : assessment?.receiptProblem === 'MATERIAL_INCOMPLETE' ? 'RECEIPT_MATERIALLY_INCOMPLETE' : defaultSubstituteReceiptReason(nextDetail.sourceDocumentType));
    setMissingReason(assessment?.route === 'SUBSTITUTE_RECEIPT' ? assessment.reason : payerWrittenMissingReason(nextDetail.missingReceiptReason));
    setBusinessPurpose(nextDetail.sourceDraft?.header.businessPurpose ?? nextDetail.note?.split(' · ').find(part => part.trim().startsWith('วัตถุประสงค์:'))?.trim().slice('วัตถุประสงค์:'.length).trim() ?? nextDetail.note ?? '');
    setPayeeName(nextDetail.vendorNameSnapshot ?? '');
    setPayeeAddress('');
    setPayeeTaxId(payeeTaxIdDigits(nextDetail.vendorTaxIdSnapshot ?? ''));
    setPaymentMethod(nextDetail.paymentMethod ?? 'BANK_TRANSFER');
    const previous = cancelledEvidence?.status === 'SUPERSEDED' ? cancelledEvidence : nextDetail.substituteReceiptEvidence?.status === 'SUPERSEDED' ? nextDetail.substituteReceiptEvidence : null;
    if (previous) {
      setPayeeName(previous.payeeName ?? nextDetail.vendorNameSnapshot ?? '');
      setPayeeTaxId(previous.payeeTaxId ?? ''); setPayeeAddress(previous.payeeAddress ?? '');
      setPaymentMethod(nextDetail.paymentMethod ?? previous.paymentMethod ?? 'BANK_TRANSFER');
    }
    setPaymentDate(coerceCivilDate(nextDetail.paidAt ?? previous?.paymentDate ?? todayIso()));
    setSupportingIds(nextDetail.attachments.filter((attachment) => (!assessment || assessment.attachmentIds.includes(attachment.id)) && attachment.status === 'ACTIVE'
      && attachment.purpose !== 'expense.review.evidence'
      && attachment.purpose !== 'expense.payment.evidence').map((attachment) => attachment.id));
    setPaymentIds(nextDetail.attachments.filter((attachment) => (!assessment || assessment.attachmentIds.includes(attachment.id)) && attachment.status === 'ACTIVE'
      && attachment.purpose === 'expense.payment.evidence').map((attachment) => attachment.id));
    setPayerId('');
    setFundingSource(''); setPaidInFullAcknowledged(false);
  }, [userId]);

  const loadCertificateFields = useCallback((target: SubstituteReceiptEvidenceSummary, expense: ExpenseDetail) => {
    setMissingReason(target.missingReceiptReason);
    setBusinessPurpose(target.businessPurpose);
    setPayeeName(target.payeeName ?? expense.vendorNameSnapshot ?? '');
    setPayeeAddress(target.payeeAddress ?? '');
    setPayeeTaxId(target.payeeTaxId ?? '');
    setReasonCode(target.reasonCode);
    setPayerId(target.payerUserId ?? '');
    setSigningMethod(target.signatureMode ?? 'DIGITAL');
    setFundingSource(target.fundingSource ?? '');
    setPaidInFullAcknowledged(Boolean(target.fundingSource));
    setPaymentMethod(target.paymentMethod ?? 'CASH');
    setPaymentDate((target.paymentDate ? coerceCivilDate(target.paymentDate) : todayIso()));
    setSupportingIds(target.supportingAttachmentIds);
    setPaymentIds(target.paymentEvidenceAttachmentIds);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const nextPolicy = await getSubstituteReceiptRuntimePolicy(companyId);
        if (cancelled) return;
        setPolicy(nextPolicy);
        if (evidenceId) {
          const expenseId = await findEvidenceExpenseId(companyId, evidenceId);
          if (!expenseId) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
          const [nextDetail, nextHistory] = await Promise.all([
            getExpense(companyId, expenseId),
            listSubstituteReceiptHistory(companyId, expenseId),
          ]);
          const requested = nextHistory.find((item) => item.id === evidenceId);
          const target = requested ? currentSubstituteRevision(nextHistory, requested) : undefined;
          if (!target) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
          if (cancelled) return;
          if (target.id !== evidenceId) router.replace(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(target.id)}${viewOnly ? '?mode=view' : initialEditPayment ? '?edit=payment' : ''}`);
          setDetail(nextDetail);
          setReceiptEvidence(target);
          setHistory(nextHistory);
          const editPayment = initialEditPayment && canReview && canEditSubstituteReceipt(nextDetail, target);
          setEditingPrepared(editPayment); setConfirmedPaymentMonth(null);
          setActiveStep(editPayment ? 'details' : resolveWizardStep(target));
          loadCertificateFields(target, nextDetail);
        } else if (initialExpenseId) {
          const [nextDetail, nextLinePrefill, previousHistory] = await Promise.all([
            getExpense(companyId, initialExpenseId),
            workflowId ? loadLineSubstituteReceiptPrefill(companyId, initialExpenseId, workflowId) : Promise.resolve(null),
            listSubstituteReceiptHistory(companyId, initialExpenseId),
          ]);
          if (cancelled) return;
          if (nextDetail.substituteReceiptEvidence && nextDetail.substituteReceiptEvidence.status !== 'SUPERSEDED') {
            router.replace(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(nextDetail.substituteReceiptEvidence.id)}`);
            return;
          }
          initializeDraft(nextDetail, previousHistory[0]);
          if (nextLinePrefill) {
            const values = nextLinePrefill.acceptedValues;
            if (values.reasonCode) setReasonCode(values.reasonCode);
            if (values.missingReceiptReason) setMissingReason(values.missingReceiptReason);
            if (values.businessPurpose) setBusinessPurpose(values.businessPurpose);
            if (values.payeeName) {
              setPayeeName(values.payeeName);
              if (values.payeeName.trim() !== nextDetail.vendorNameSnapshot?.trim()) setPayeeTaxId('');
            }
            if (values.payerUserId) setPayerId(values.payerUserId);
            if (values.fundingSource) setFundingSource(values.fundingSource);
            setPaidInFullAcknowledged(values.paidInFullAcknowledged === true);
            if (values.paymentMethod) setPaymentMethod(values.paymentMethod);
            if (values.paymentDate) setPaymentDate(values.paymentDate);
            setLinePrefill(nextLinePrefill);
          }
          setEntryMode('existing');
        }
      } catch (cause) {
        if (!cancelled) setError(err(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, evidenceId, initialExpenseId, initializeDraft, locale, router, workflowId, initialEditPayment, canReview, viewOnly, loadCertificateFields]);

  useEffect(() => {
    if (evidenceId) return;
    let cancelled = false;
    setCandidatesLoading(true);
    setCandidatesError(null);
    listSubstituteReceiptCandidates(companyId, { branchId: branchId || undefined, search: candidateQuery, page: candidatePage, pageSize: 5 })
      .then((result) => {
        if (cancelled) return;
        setCandidates(result.items);
        setCandidateTotal(result.total);
        if (candidatePage > Math.max(1, Math.ceil(result.total / 5))) setCandidatePage(Math.max(1, Math.ceil(result.total / 5)));
        setEntryMode((current) => !canReview ? 'existing' : current ?? resolveWizardEntryMode({ initialExpenseId, candidateCount: result.total }));
      })
      .catch((cause) => { if (!cancelled) setCandidatesError(err(cause)); })
      .finally(() => { if (!cancelled) setCandidatesLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, candidateQuery, candidatePage, canReview, candidatesReloadKey, companyId, evidenceId, initialExpenseId]);

  useEffect(() => {
    if (!shouldLoadCategories) { setCategoriesLoading(false); return; }
    let cancelled = false;
    setCategoriesLoading(true);
    setCategoriesError(null);
    void listExpenseCategories(companyId)
      .then((items) => { if (!cancelled) setCategories(items); })
      .catch(() => {
        if (!cancelled) {
          setCategories([]);
          setCategoriesError(t('expenses.substitute_wizard.category_load_error', locale));
        }
      })
      .finally(() => { if (!cancelled) setCategoriesLoading(false); });
    return () => { cancelled = true; };
  }, [categoriesReloadKey, companyId, locale, shouldLoadCategories]);

  useEffect(() => {
    if (!detail || !canPrepare || receiptEvidence) return;
    let cancelled = false;
    setPayersLoading(true);
    listSubstituteReceiptPayers(companyId, detail.id)
      .then((items) => {
        if (cancelled) return;
        setPayers(items);
        setPayerId((current) => items.some((item) => item.userId === current)
          ? current
          : defaultCertifierId(items, userId, policy?.approvalMode));
      })
      .catch((cause) => { if (!cancelled) setError(err(cause)); })
      .finally(() => { if (!cancelled) setPayersLoading(false); });
    return () => { cancelled = true; };
  }, [canPrepare, companyId, detail, receiptEvidence, userId, policy?.approvalMode]);

  useEffect(() => {
    if (!detail || !receiptEvidence || busy || editingPrepared) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const rows = await listSubstituteReceiptHistory(companyId, detail.id);
        if (cancelled) return;
        const requested = rows.find((item) => item.id === receiptEvidence.id);
        const current = requested ? currentSubstituteRevision(rows, requested) : undefined;
        if (!current || current.updatedAt === receiptEvidence.updatedAt) return;
        const fresh = await getExpense(companyId, detail.id);
        if (cancelled) return;
        setHistory(rows); setReceiptEvidence(current); setDetail(fresh); loadCertificateFields(current, fresh);
        setPreviewChecksum(null); setCertifiedPreviewed(false); setCertificationAcknowledged(false); setApprovalAcknowledged(false);
        setInfo(current.status === 'SUPERSEDED' ? t('expenses.substitute_wizard.superseded', locale) : 'เอกสารอัปเดตตามข้อมูลล่าสุดแล้ว อ่านเอกสารก่อนเซ็น');
        if (current.status === 'SUPERSEDED') setActiveStep('done');
        if (current.id !== receiptEvidence.id) { setActiveStep(resolveWizardStep(current)); router.replace(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(current.id)}${viewOnly ? '?mode=view' : ''}`); }
      } catch (cause) { if (!cancelled) setError(err(cause)); }
    };
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, [companyId, detail?.id, receiptEvidence?.id, receiptEvidence?.updatedAt, busy, editingPrepared, router, locale, loadCertificateFields, viewOnly]);

  // W1: only the pre-prepare steps need saving — once evidence exists the server status resumes the
  // wizard on its own, and a prepared certificate must never be re-seeded from stale typing.
  const draftScopeId = !evidenceId && detail && !receiptEvidence ? detail.id : null;
  const draftStep: SubstituteWizardDraftStep | null = activeStep === 'expense' || activeStep === 'details' || activeStep === 'evidence' || activeStep === 'method'
    ? activeStep
    : null;

  useEffect(() => {
    if (loading || !userId || !draftScopeId || draftHydratedFor === draftScopeId) return;
    const stored = readSubstituteWizardDraft(typeof window === 'undefined' ? null : window.sessionStorage, companyId, draftScopeId, userId);
    if (stored) {
      setActiveStep(stored.step);
      setSigningMethod(stored.signingMethod ?? '');
      setConsent(stored.consent);
      setReasonCode(stored.reasonCode);
      setMissingReason(stored.missingReason);
      setBusinessPurpose(stored.businessPurpose);
      setPayeeName(stored.payeeName);
      setPayeeAddress(stored.payeeAddress);
      setPayeeTaxId(stored.payeeTaxId);
      setFundingSource(stored.fundingSource ?? '');
      setPaidInFullAcknowledged(stored.paidInFullAcknowledged === true);
      if (stored.payerId) setPayerId(stored.payerId);
      setPaymentMethod(stored.paymentMethod);
      if (stored.paymentDate) setPaymentDate(stored.paymentDate);
      setSupportingIds(stored.supportingIds);
      setPaymentIds(stored.paymentIds);
      setInfo(t('expenses.substitute_wizard.draft_restored', locale));
    }
    setDraftHydratedFor(draftScopeId);
  }, [companyId, draftHydratedFor, draftScopeId, locale, userId, loading]);

  useEffect(() => {
    if (loading || !userId || !draftScopeId || !draftStep || draftHydratedFor !== draftScopeId || typeof window === 'undefined') return;
    writeSubstituteWizardDraft(window.sessionStorage, companyId, draftScopeId, userId, {
      step: draftStep, signingMethod,
      consent, reasonCode, missingReason, businessPurpose,
      payeeName, payeeAddress, payeeTaxId,
      payerId, fundingSource, paidInFullAcknowledged, paymentMethod, paymentDate,
      supportingIds, paymentIds,
    });
  }, [
    businessPurpose, companyId, consent, draftHydratedFor, draftScopeId, draftStep, missingReason, loading,
    paymentDate, paymentIds, paymentMethod, payeeAddress, payeeName, payeeTaxId, payerId, fundingSource, paidInFullAcknowledged,
    reasonCode, signingMethod, supportingIds, userId,
  ]);

  // The guard has to be a ref: `busy` state only reaches the disabled attribute after a re-render,
  // so a double click certified twice — the second call 409'd and the screen showed the stale-data
  // error next to the success banner of the write that had actually landed.
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setInfo(null);
    try { await action(); } catch (cause) {
      if ((cause as { code?: string })?.code === 'substitute_combined_signing_denied' || (cause as Error)?.message?.includes('substitute_combined_signing_denied')) {
        const latestPolicy = await getSubstituteReceiptRuntimePolicy(companyId).catch(() => null);
        if (latestPolicy) setPolicy(latestPolicy);
        setError('ยังไม่ได้ออกใบรับรอง เปิดหน้านี้ใหม่แล้วเซ็นตามขั้นตอนล่าสุด');
      } else setError(err(cause, locale));
    } finally { busyRef.current = false; setBusy(false); }
  };

  const selectExpense = async (nextDetail: ExpenseDetail, mode: WizardEntryMode = 'existing') => {
    const previousHistory = mode === 'existing' ? await listSubstituteReceiptHistory(companyId, nextDetail.id) : [];
    initializeDraft(nextDetail, previousHistory[0]);
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set('expenseId', nextDetail.id);
    window.history.replaceState(window.history.state, '', returnUrl);
    setEntryMode(mode);
    setReceiptEvidence(null);
    setHistory([]);
    setConsent(false);
    setActiveStep('expense');
    setInfo(null);
    setError(null);
    requestWorkflowFocus('selection');
  };

  const updateManualLine = (id: string, patch: Partial<SubstituteManualLineDraft>) => {
    setManualLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
  };

  const addManualLine = () => {
    if (manualLines.length >= MAX_SUBSTITUTE_MANUAL_LINES) return;
    manualLineSequenceRef.current += 1;
    const id = `manual-line-${manualLineSequenceRef.current}`;
    setManualLines((current) => [...current, blankManualLine(id)]);
    setManualAnnouncement(t('expenses.substitute_wizard.item_added', locale).replace('{number}', String(manualLines.length + 1)));
    window.requestAnimationFrame(() => manualLineDescriptionRefs.current[id]?.focus());
  };

  const removeManualLine = (id: string) => {
    const removedIndex = manualLines.findIndex((line) => line.id === id);
    if (removedIndex < 0) return;
    const nextFocusId = manualLines[removedIndex + 1]?.id ?? manualLines[removedIndex - 1]?.id;
    setManualLines((current) => current.length <= 1 ? current : current.filter((line) => line.id !== id));
    setManualAnnouncement(t('expenses.substitute_wizard.item_removed', locale).replace('{number}', String(removedIndex + 1)));
    window.requestAnimationFrame(() => {
      if (nextFocusId) manualLineCardRefs.current[nextFocusId]?.focus();
      else addManualLineRef.current?.focus();
    });
  };

  const moveManualLine = (index: number, direction: -1 | 1) => {
    const destination = index + direction;
    if (destination < 0 || destination >= manualLines.length) return;
    setManualLines((current) => {
      const reordered = [...current];
      [reordered[index], reordered[destination]] = [reordered[destination]!, reordered[index]!];
      return reordered;
    });
    setManualAnnouncement(t('expenses.substitute_wizard.item_moved', locale)
      .replace('{number}', String(index + 1))
      .replace('{position}', String(destination + 1)));
    const movedId = manualLines[index]?.id;
    window.requestAnimationFrame(() => { if (movedId) manualLineCardRefs.current[movedId]?.focus(); });
  };

  const createManualExpense = async () => {
    setManualValidationAttempted(true);
    if (!canReview) throw new Error(t('expenses.substitute_wizard.review_permission_required', locale));
    assertAllowed(...manualLines.map((line) => line.description));
    if (!createBranchId || !manualDate || !manualLinesReadiness.ready) {
      // Every missing thing is named under its own field; the first of them gets the focus.
      const invalidIndex = manualLinesReadiness.invalidLineIndexes[0];
      window.requestAnimationFrame(() => {
        if (!createBranchId) {
          document.querySelector<HTMLElement>('[data-transaction-branch-select] summary')?.focus();
          return;
        }
        if (!manualDate) {
          manualDateTriggerRef.current?.focus();
          return;
        }
        const invalidLine = invalidIndex === undefined ? undefined : manualLines[invalidIndex];
        const invalidField = invalidLine ? invalidManualLineFields(invalidLine)[0] : undefined;
        const invalidControl = invalidLine && invalidField
          ? document.getElementById(manualLineControlId(invalidLine.id, invalidField))
          : null;
        if (invalidControl instanceof HTMLElement) invalidControl.focus();
        else if (invalidLine) manualLineCardRefs.current[invalidLine.id]?.focus();
        else manualHeadingRef.current?.focus();
      });
      return;
    }
    const created = await createExpenseDraft(companyId, {
      captureSource: 'WEB_MANUAL',
      expenseDate: manualDate,
      branchId: createBranchId,
      vatMode: 'NO_VAT',
      lines: manualLines.map((line, index) => ({
        lineNumber: index + 1,
        description: line.description.trim(),
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: '0',
        vatRate: '0',
        expenseCategoryId: line.expenseCategoryId,
      })),
    });
    const nextDetail = await getExpense(companyId, created.id);
    await selectExpense(nextDetail, 'new');
    manualLineSequenceRef.current += 1;
    setManualLines([blankManualLine(`manual-line-${manualLineSequenceRef.current}`)]);
    setManualValidationAttempted(false);
    setManualAnnouncement('');
    setInfo(`บันทึกร่างค่าใช้จ่าย ${nextDetail.expenseNumber} แล้ว`);
  };

  const continueFromExpense = async () => {
    if (!detail || !consent) throw new Error(t('expenses.substitute_wizard.consent_required', locale));
    if (!canPrepare) throw new Error(t('expenses.substitute_wizard.review_permission_required', locale));
    const renderabilityIssue = substituteReceiptRenderabilityIssue(detail);
    if (renderabilityIssue) throw new Error(renderabilityIssueMessage(renderabilityIssue, locale));
    const continuingExisting = ['PREPARED', 'PAYER_CERTIFIED'].includes(detail.substituteReceiptEvidence?.status ?? '');
    const assessment = expenseEvidenceAssessment(detail);
    if (assessment?.route === 'SOURCE_DOCUMENT' && assessment.receiptProblem === 'NONE') throw new Error('รายการนี้บันทึกว่ามีใบเสร็จแล้ว เปิดค่าใช้จ่ายเพื่อตรวจสอบ');
    if (!continuingExisting) {
      const currentReview = reviewValues(detail);
      const sanitizedReview = canReview && currentReview.lines.some((line) => line.taxCodeDefinitionId || line.externalTaxCode)
        ? buildExpenseDraftReviewPayload({ ...currentReview, lines: clearExpenseTaxSelections(currentReview.lines) }) : {};
      await updateExpenseReviewFields(companyId, detail.id, {
        ...sanitizedReview,
        expectedUpdatedAt: detail.updatedAt, sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY',
        documentReviewAcknowledged: true, evidenceAssessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [], reason: '' },
      });
      setDetail(await getExpense(companyId, detail.id));
    }
    setActiveStep('details');
    requestWorkflowFocus('details');
  };

  const continueFromDetails = async () => {
    if (!detail) throw new Error(t('expenses.substitute_wizard.expense_required', locale));
    if (canReview && expenseIneligibleCause && sourceSaveRef.current && !await sourceSaveRef.current()) return;
    assertAllowed(payeeName, payeeAddress, missingReason, businessPurpose);
    const firstPayeeIssue = Object.values(payeeIdentityIssues)[0];
    if (firstPayeeIssue) throw new Error(t(PAYEE_ISSUE_KEYS[firstPayeeIssue], locale));
    if (!missingReason.trim() || !businessPurpose.trim() || !paymentDate || !fundingSource || !paidInFullAcknowledged) {
      throw new Error(t('expenses.substitute_wizard.details_required', locale));
    }

    if (recordedPaymentMismatch) throw new Error('กด “ใช้ข้อมูลการจ่ายที่บันทึกไว้” ก่อนไปต่อ');
    setActiveStep('evidence');
  };

  // `picked` is passed by the picker's own onChange, which fires before the staged-file state
  // has been applied — reading it from state there would upload the *previous* file, or none.
  const uploadEvidence = async (
    purpose: 'expense.receipt.supporting' | 'expense.payment.evidence',
    picked?: File,
  ) => {
    if (!detail) throw new Error(t('expenses.substitute_wizard.expense_required', locale));
    if (!canUploadEvidence) throw new Error(t('expenses.substitute_wizard.upload_forbidden', locale));
    const sourceFile = picked ?? (purpose === 'expense.payment.evidence' ? paymentFile : supportingFile);
    if (!sourceFile) throw new Error(t('expenses.substitute_wizard.file_required', locale));
    const file = await prepareAttachmentUpload(sourceFile);
    const pendingIssue = substituteReceiptEvidenceRenderabilityIssue([
      ...selectedEvidenceAttachments,
      { id: `pending-${purpose}`, originalFileName: file.name },
    ]);
    if (pendingIssue) throw new Error(evidenceRenderabilityIssueMessage(pendingIssue, locale));
    const attachmentId = canReview
      ? await uploadExpenseEvidenceFile(companyId, detail.id, detail.branchId, file, purpose)
      : await uploadSubstituteReceiptEvidence(companyId, detail.id, file, purpose);
    if (purpose === 'expense.payment.evidence') {
      setPaymentIds((current) => [...new Set([...current, attachmentId])]);
      setPaymentFile(null);
    } else {
      setSupportingIds((current) => [...new Set([...current, attachmentId])]);
      setSupportingFile(null);
    }
    setDetail(await getExpense(companyId, detail.id));
    setInfo(t('expenses.substitute_wizard.file_added', locale));
  };

  const downloadPaymentVoucher = async () => {
    if (!detail) throw new Error(t('expenses.substitute_wizard.expense_required', locale));
    await downloadPaymentVoucherPdf(companyId, detail.id, detail.expenseNumber, {
      ...(paymentDate ? { paymentDate } : {}),
      ...(payeeName.trim() ? { payeeName: payeeName.trim() } : {}),
      ...(payeeAddress.trim() ? { payeeAddress: payeeAddress.trim() } : {}),
      ...(payeeTaxId ? { payeeTaxId } : {}),
    });
  };

  const requiresPaymentEvidence = substituteReceiptRequiresPaymentEvidence(detail?.aiVerificationSummaryJson, paymentMethod, policy?.cashEvidencePolicy);

  const prepare = async () => {
    if (viewOnly || (receiptEvidence && !canEditPrepared)) return;
    if (!detail) throw new Error(t('expenses.substitute_wizard.expense_required', locale));
    assertExpensePrerequisites(detail);
    assertAllowed(payeeName, payeeAddress, missingReason, businessPurpose);
    const firstPayeeIssue = Object.values(payeeIdentityIssues)[0];
    if (firstPayeeIssue) throw new Error(t(PAYEE_ISSUE_KEYS[firstPayeeIssue], locale));
    if (!missingReason.trim() || !businessPurpose.trim() || !paymentDate || !signingMethod
      || (signingMethod === 'DIGITAL' && !editingPrepared && (!payerId || !payers.some((payer) => payer.userId === payerId)))) {
      throw new Error(t('expenses.substitute_wizard.details_required', locale));
    }
    if (!fundingSource || !paidInFullAcknowledged) throw new Error('เลือกเงินที่ใช้จ่าย แล้วติ๊กว่าจ่ายครบแล้ว');
    if (!policy?.ready) throw new Error(t('expenses.substitute_wizard.policy_not_ready', locale));
    if (selectedEvidenceRenderabilityIssue) {
      throw new Error(evidenceRenderabilityIssueMessage(selectedEvidenceRenderabilityIssue, locale));
    }
    if (requiresPaymentEvidence && selectedPaymentCount === 0) {
      throw new Error(t('expenses.substitute_wizard.evidence_required', locale));
    }
    if (editingPrepared && receiptEvidence) {
      const result = await amendSubstituteReceipt(companyId, detail.id, receiptEvidence.id, {
        reasonCode, missingReceiptReason: missingReason.trim(), businessPurpose: businessPurpose.trim(),
        payeeName: payeeName.trim(), payeeAddress: payeeAddress.trim(), payeeTaxId,
        supportingAttachmentIds: supportingIds, paymentEvidenceAttachmentIds: paymentIds,
        paymentDate, paymentMethod, expectedExpenseUpdatedAt: detail.updatedAt,
        expectedEvidenceUpdatedAt: receiptEvidence.updatedAt,
        keepDocumentNumberConfirmed: confirmedPaymentMonth === paymentDate.slice(0, 7),
      });
      if (result.updatedAt !== receiptEvidence.updatedAt || result.id !== receiptEvidence.id) {
        resetSignature(); setCertificationAcknowledged(false); setApprovalAcknowledged(false); closePreview();
      }
      setReceiptEvidence(result);
      setDetail(await getExpense(companyId, detail.id));
      setHistory(await listSubstituteReceiptHistory(companyId, detail.id));
      setEditingPrepared(false);
      setActiveStep(resolveWizardStep(result));
      setInfo(result.updatedAt === receiptEvidence.updatedAt
        ? `ไม่มีอะไรเปลี่ยน ใช้ใบ ${result.documentNumber} ต่อได้`
        : `บันทึกแล้ว เลขที่ ${result.documentNumber} คงเดิม อ่านเอกสารแล้วเซ็นใหม่`);
      router.replace(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(result.id)}`);
      return;
    }
    const result = await generateSubstituteReceipt(companyId, detail.id, {
      reasonCode,
      missingReceiptReason: missingReason.trim(),
      businessPurpose: businessPurpose.trim(),
      signatureMode: signingMethod,
      ...(signingMethod === 'DIGITAL' ? { payerUserId: payerId } : {}),
      fundingSource, paidInFullAcknowledged: true,
      ...(payeeName.trim() ? { payeeName: payeeName.trim() } : {}),
      ...(payeeAddress.trim() ? { payeeAddress: payeeAddress.trim() } : {}),
      ...(payeeTaxId ? { payeeTaxId } : {}),
      supportingAttachmentIds: supportingIds,
      paymentEvidenceAttachmentIds: paymentIds,
      paymentDate,
      paymentMethod,
      idempotencyKey: `sub-${detail.id}-${detail.updatedAt}-v${detail.substituteReceiptEvidence?.version ?? 0}`.slice(0, 128),
      expectedExpenseUpdatedAt: detail.updatedAt,
      ...(checkBillRoute ? { routeCheckBill: true as const } : {}),
      ...(workflowId ? { continuationId: workflowId } : {}),
    }, locale);
    setReceiptEvidence(result);
    setDetail((current) => current ? { ...current, substituteReceiptEvidence: result } : current);
    // The typed answers are now on the server: the local copy must not outlive them and rehydrate
    // a certificate that has already been prepared.
    if (typeof window !== 'undefined') clearSubstituteWizardDraft(window.sessionStorage, companyId, detail.id, userId);
    // /new is about to unmount: do not expose a reader that this navigation would close.
    setLoading(true);
    router.push(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(result.id)}`);
  };

  const selectSignatureFile = (file: File | null) => {
    setSignatureCarried(false);
    setSignatureFile(file);
    setCleanedSignatureFile(null);
    setSignaturePreview(null);
    setSignatureDrawn(false);
    setInfo(null);
  };

  const selectDrawnSignature = (file: File, nextPreview: { original: string; cleaned: string }) => {
    assertAllowedUploadFile(file, 'image');
    selectSignatureFile(file);
    setCleanedSignatureFile(file);
    setSignaturePreview(nextPreview);
  };

  const buildTransparentSignature = async () => {
    if (!signatureFile) throw new Error(t('expenses.substitute_wizard.signature_required', locale));
    const file = await prepareAttachmentUpload(signatureFile, 'image');
    const sourceUrl = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error(t('expenses.substitute_wizard.signature_read_failed', locale)));
        image.src = sourceUrl;
      });
      const sourceCanvas = document.createElement('canvas');
      sourceCanvas.width = image.naturalWidth;
      sourceCanvas.height = image.naturalHeight;
      const sourceContext = sourceCanvas.getContext('2d');
      if (!sourceContext) throw new Error(t('expenses.substitute_wizard.signature_unsupported', locale));
      sourceContext.drawImage(image, 0, 0);
      const original = sourceCanvas.toDataURL('image/png');
      const cleaned = removeLightBackground(sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height));
      const bounds = findOpaqueBounds(cleaned);
      if (!bounds) throw new Error(t('expenses.substitute_wizard.signature_empty', locale));
      sourceContext.putImageData(cleaned, 0, 0);
      const padding = 8;
      const cropX = Math.max(0, bounds.x - padding);
      const cropY = Math.max(0, bounds.y - padding);
      const cropWidth = Math.min(sourceCanvas.width - cropX, bounds.width + padding * 2);
      const cropHeight = Math.min(sourceCanvas.height - cropY, bounds.height + padding * 2);
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = cropWidth;
      outputCanvas.height = cropHeight;
      const outputContext = outputCanvas.getContext('2d');
      if (!outputContext) throw new Error(t('expenses.substitute_wizard.signature_unsupported', locale));
      outputContext.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      const blob = await new Promise<Blob | null>((resolve) => outputCanvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(t('expenses.substitute_wizard.signature_create_failed', locale));
      setCleanedSignatureFile(new File([blob], 'signature-transparent.png', { type: 'image/png' }));
      setSignaturePreview({ original, cleaned: outputCanvas.toDataURL('image/png') });
    } finally {
      URL.revokeObjectURL(sourceUrl);
    }
  };

  // R9: a saved ACTIVE personal signature covers every certificate; drawing or uploading one here
  // still wins for this certificate.
  const signatureSource = resolveWizardSignatureSource({
    hasReusableSignature: policy?.hasReusableSignature ?? false,
    chosenFile: Boolean(signatureFile) || signatureDrawn,
    preparedFile: Boolean(cleanedSignatureFile),
  });
  // R11: on the paper route the ink is already on the scanned form linked to this evidence, so
  // certification and approval are acknowledgements only — no signature image is asked for or used.
  const paperSignature = receiptEvidence?.signatureMode === 'PAPER';
  const combinedSigning = policy?.canCertifyAndApprove === true && canConfirm
    && receiptEvidence?.signatureMode === 'DIGITAL' && receiptEvidence.payerUserId === userId;

  const uploadPersonalSignature = async (): Promise<string> => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    if (!cleanedSignatureFile) throw new Error(t('expenses.substitute_wizard.signature_process_required', locale));
    const intent = await initPersonalSignatureUpload(companyId, detail.id, receiptEvidence.id, cleanedSignatureFile);
    await uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, cleanedSignatureFile, intent.uploadHeaders);
    await completePersonalSignatureUpload(companyId, detail.id, receiptEvidence.id, intent.attachmentId, cleanedSignatureFile.size);
    return intent.attachmentId;
  };

  const resetSignature = () => {
    setSignerPosition('');
    setSignatureFile(null);
    setCleanedSignatureFile(null);
    setSignaturePreview(null);
    setSignatureDrawn(false);
    setSignatureCarried(false);
    setPreviewChecksum(null);
    setCertifiedPreviewed(false);
  };

  const previewPrepared = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    assertAllowed(signerPosition);
    const requestId = ++previewRequestRef.current;
    const requestScope = previewScopeRef.current;
    const requestRevision = previewRevisionRef.current;
    setPreviewChecksum(null);
    let result;
    try {
      result = await previewSubstituteReceipt(companyId, detail.id, receiptEvidence.id, { payerPosition: signerPosition.trim() });
    } catch (cause) {
      if (!isPreviewRequestCurrent(requestId, requestScope)) return;
      throw new Error('เปิดเอกสารไม่สำเร็จ ลองอีกครั้ง');
    }
    if (!isPreviewRequestCurrent(requestId, requestScope)) return;
    previewEvidenceRevisionRef.current = result.expectedEvidenceUpdatedAt ?? receiptEvidence.updatedAt;
    commitPreview(requestId, requestScope, {
      name: `ใบรับรองแทนใบเสร็จ ${receiptEvidence.documentNumber}`,
      mimeType: 'image/svg+xml',
      url: result.svgDataUrl,
      onViewed: () => { if (isPreviewRequestCurrent(requestId, requestScope)) setPreviewChecksum(result.previewChecksumSha256); },
    }, requestRevision);
  };

  const [signingAttempted, setSigningAttempted] = useState(false);
  useEffect(() => { setSigningAttempted(false); }, [activeStep, receiptEvidence?.id]);
  const checkSigning = (previewed: boolean, acknowledged: boolean) => {
    const { missing } = evaluateSigningReadiness({ previewed, signatureReady: paperSignature || signatureSource !== 'none', acknowledged });
    setSigningAttempted(true);
    if (!missing.length) return true;
    requestAnimationFrame(() => focusExpenseField(document.getElementById(`substitute-sign-${missing[0]}`)));
    return false;
  };

  const certify = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    if (!checkSigning(Boolean(previewChecksum), certificationAcknowledged)) return;
    assertAllowed(signerPosition);
    if (!previewChecksum) throw new Error(t('expenses.substitute_wizard.preview_required', locale));
    if (!certificationAcknowledged) throw new Error(t('expenses.substitute_wizard.certification_ack_required', locale));
    const signature = signatureSource === 'evidence_upload' ? { signatureAttachmentId: await uploadPersonalSignature() } : {};
    const result = await certifySubstituteReceipt(companyId, detail.id, receiptEvidence.id, {
      payerPosition: signerPosition.trim(),
      certificationAcknowledged: true,
      ...(combinedSigning && { approvalAcknowledged: true }),
      previewChecksumSha256: previewChecksum,
      ...signature,
      expectedVersion: receiptEvidence.version,
      expectedEvidenceUpdatedAt: previewEvidenceRevisionRef.current ?? receiptEvidence.updatedAt,
    });
    setReceiptEvidence(result);
    setDetail((current) => current ? { ...current, substituteReceiptEvidence: result } : current);
    setHistory((current) => current.map((item) => item.id === result.id ? result : item));
    if (result.status === 'ISSUED') {
      resetSignature(); setCertificationAcknowledged(false); setActiveStep('done');
      setInfo('เซ็นและออกใบรับรองแล้ว');
      return;
    }
    // When the person who has just signed is also the one who approves, the drawing they made stays
    // ready for the second signature (they can still sign anew). What they read and ticked does not carry over.
    if (cleanedSignatureFile && signaturePreview && mayApproveSubstituteReceipt({ userId, payerUserId: result.payerUserId, canConfirm, canSelfApprove, approvalMode: policy?.approvalMode })) {
      setSignerPosition(''); setPreviewChecksum(null); setCertifiedPreviewed(false); setSignatureCarried(true);
    } else resetSignature();
    setCertificationAcknowledged(false);
    setActiveStep('approve');
    setInfo(t('expenses.substitute_wizard.certified', locale));
  };

  const openArtifact = async (attachmentId: string | null, certified = false) => {
    if (!attachmentId || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.document_not_ready', locale));
    const requestId = ++previewRequestRef.current;
    const requestScope = previewScopeRef.current;
    const requestRevision = previewRevisionRef.current;
    if (certified) setCertifiedPreviewed(false);
    let blob;
    try {
      blob = await fetchAttachmentPreviewBlob(companyId, attachmentId, 'image/svg+xml');
    } catch (cause) {
      if (!isPreviewRequestCurrent(requestId, requestScope)) return;
      throw cause;
    }
    if (!isPreviewRequestCurrent(requestId, requestScope)) return;
    const url = URL.createObjectURL(blob);
    commitPreview(requestId, requestScope, {
      name: certified
        ? `ใบรับรองแทนใบเสร็จ ${receiptEvidence.documentNumber} (เซ็นรับรองแล้ว)`
        : `ใบรับรองแทนใบเสร็จ ${receiptEvidence.documentNumber}`,
      mimeType: 'image/svg+xml',
      url,
      ...(certified ? { onViewed: () => { if (isPreviewRequestCurrent(requestId, requestScope)) setCertifiedPreviewed(true); } } : {}),
    }, requestRevision);
  };

  const openIssuedPdf = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.document_not_ready', locale));
    const requestId = ++previewRequestRef.current;
    const requestScope = previewScopeRef.current;
    if (receiptEvidence.signatureMode === 'PAPER') {
      const result = await previewIssuedSubstitutePaper(companyId, detail.id, receiptEvidence.id);
      if (!isPreviewRequestCurrent(requestId, requestScope)) return;
      setPaperArtifactPreview(result);
      return;
    }
    let blob;
    try {
      blob = await fetchSubstituteReceiptPdfBlob(companyId, detail.id, receiptEvidence.id);
    } catch (cause) {
      if (!isPreviewRequestCurrent(requestId, requestScope)) return;
      throw cause;
    }
    if (!isPreviewRequestCurrent(requestId, requestScope)) return;
    const url = URL.createObjectURL(blob);
    commitPreview(requestId, requestScope, {
      name: `ใบรับรองแทนใบเสร็จ ${receiptEvidence.documentNumber}`,
      mimeType: 'application/pdf',
      url,
    });
  };

  const openEvidenceAttachment = async (attachment: ExpenseDetail['attachments'][number]) => {
    const requestId = ++previewRequestRef.current;
    const requestScope = previewScopeRef.current;
    let blob;
    try {
      blob = await fetchAttachmentPreviewBlob(companyId, attachment.id, attachment.mimeType);
    } catch (cause) {
      if (!isPreviewRequestCurrent(requestId, requestScope)) return;
      throw cause;
    }
    if (!isPreviewRequestCurrent(requestId, requestScope)) return;
    const url = URL.createObjectURL(blob);
    commitPreview(requestId, requestScope, {
      name: attachment.originalFileName,
      mimeType: attachment.mimeType,
      url,
    });
  };

  const approve = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    if (!checkSigning(certifiedPreviewed, approvalAcknowledged)) return;
    assertAllowed(signerPosition);
    if (!certifiedPreviewed) throw new Error(t('expenses.substitute_wizard.certified_preview_required', locale));
    if (!approvalAcknowledged) throw new Error(t('expenses.substitute_wizard.approval_ack_required', locale));
    const signature = signatureSource === 'evidence_upload' ? { signatureAttachmentId: await uploadPersonalSignature() } : {};
    const result = await approveSubstituteReceipt(companyId, detail.id, receiptEvidence.id, {
      approverPosition: signerPosition.trim(),
      approvalAcknowledged: true,
      certifiedArtifactChecksumSha256: receiptEvidence.certifiedArtifactChecksumSha256 ?? '',
      ...signature,
      expectedVersion: receiptEvidence.version,
      expectedEvidenceUpdatedAt: receiptEvidence.updatedAt,
    });
    setReceiptEvidence(result);
    setDetail((current) => current ? { ...current, substituteReceiptEvidence: result } : current);
    setHistory((current) => current.map((item) => item.id === result.id ? result : item));
    resetSignature();
    setApprovalAcknowledged(false);
    setActiveStep('done');
    setInfo(t('expenses.substitute_wizard.approved', locale));
  };

  const supersede = async (reason: string) => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    assertAllowed(reason);
    if (!reason.trim()) throw new Error(t('expenses.substitute_wizard.supersede_reason_required', locale));
    const result = await supersedeSubstituteReceipt(companyId, detail.id, receiptEvidence.id, {
      reason: reason.trim(),
      expectedEvidenceUpdatedAt: receiptEvidence.updatedAt,
    });
    const nextHistory = await listSubstituteReceiptHistory(companyId, detail.id);
    setReceiptEvidence(result);
    setDetail((current) => current ? { ...current, substituteReceiptEvidence: result } : current);
    setHistory(nextHistory);
    setActiveStep('done');
    setInfo(null);
  };

  // Cancelling is asked once, in SubstituteReceiptCancelDialog; a failure stays in the dialog with the typed reason.
  const confirmCancelCertificate = async (reason: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setCancelError(null); setError(null);
    try { await supersede(reason); setCancelOpen(false); }
    catch (cause) { setCancelError(err(cause, locale)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const correctNames = async () => {
    if (!detail || !receiptEvidence || busyRef.current) return;
    if (!supersedeReason.trim()) { setCorrectionError('กรอกเหตุผลที่แก้'); return; }
    busyRef.current = true; setBusy(true); setCorrectionError(null);
    try {
      assertAllowed(supersedeReason);
      const next = await correctSubstituteDocument(companyId, detail.id, receiptEvidence.id, { reason: supersedeReason.trim(), expectedEvidenceUpdatedAt: receiptEvidence.updatedAt });
      setCorrectionOpen(false); setSupersedeReason('');
      setReceiptEvidence(next); setActiveStep('certify'); setSignerPosition('');
      router.push(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(next.id)}`);
    } catch (cause) { setCorrectionError(err(cause, locale)); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const copyWizardLink = async () => {
    if (copying) return;
    setCopying(true);
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setError(t('expenses.substitute_wizard.copy_failed', locale));
    } finally { setCopying(false); }
  };

  const mayApprove = receiptEvidence ? mayApproveSubstituteReceipt({
    userId,
    payerUserId: receiptEvidence.payerUserId,
    canConfirm,
    canSelfApprove,
    approvalMode: policy?.approvalMode,
  }) : false;
  const ownerSelfCollapse = Boolean(receiptEvidence
    && receiptEvidence.payerUserId === userId
    && mayApprove);
  const activeJourneyStage = wizardJourneyStage(activeStep);
  const activeJourneyIndex = JOURNEY_STAGES.indexOf(activeJourneyStage);
  // "Not yet" and "not yours" are different states: the payer and the approver are usually two
  // people, so the header says whose turn it is rather than leaving a dead button to explain it.
  const turn = receiptEvidence
    ? resolveSubstituteTurn({ status: receiptEvidence.status, payerUserId: receiptEvidence.payerUserId, userId, mayApprove })
    : null;
  const turnLabel = receiptEvidence?.status === 'PREPARED' && receiptEvidence.signatureMode === 'PAPER' && !receiptEvidence.payerUserId
    ? receiptEvidence.paperSubmission ? 'รอตรวจรับฉบับที่เซ็นแล้ว' : 'รอส่งฉบับที่เซ็นแล้ว'
    : !turn || turn.stage === 'done' ? null
    : turn.mine ? t('expenses.substitute_wizard.turn_mine', locale)
      : turn.waitingFor === 'payer'
        ? t('expenses.substitute_wizard.waiting_payer', locale).replace('{name}', receiptEvidence?.payerName ?? '')
        : (policy?.approvalMode === 'OWNER_SELF' ? 'รอเจ้าของกิจการตรวจและออกใบรับรอง' : 'รอผู้อนุมัติที่ร้านกำหนดตรวจและออกใบรับรอง');

  /** What the certificate says, read-only, for the person who waits for someone else's signature. */
  const renderReadOnlySummary = () => {
    if (!detail || !receiptEvidence) return null;
    const evidenceIds = [...receiptEvidence.supportingAttachmentIds, ...receiptEvidence.paymentEvidenceAttachmentIds];
    const fact = (label: string, value: ReactNode) => (
      <div className="min-w-0"><dt className="text-gray-500">{label}</dt><dd className="break-words font-semibold text-gray-900">{value}</dd></div>
    );
    return (
      <MangmeeCard className="space-y-4 p-4 text-sm sm:p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          {fact(t('expenses.substitute_wizard.payee_name', locale), receiptEvidence.payeeName ?? t('expenses.substitute_wizard.not_specified', locale))}
          {receiptEvidence.payeeAddress && fact(t('expenses.substitute_wizard.payee_address', locale), receiptEvidence.payeeAddress)}
          {receiptEvidence.payeeTaxId && fact(t('expenses.substitute_wizard.payee_tax_id', locale), <span className="mangmee-unit">{receiptEvidence.payeeTaxId}</span>)}
          {fact(t('expenses.substitute_wizard.missing_reason', locale), receiptEvidence.missingReceiptReason)}
          {fact(t('expenses.substitute_wizard.business_purpose', locale), receiptEvidence.businessPurpose)}
          {fact(t('expenses.substitute_wizard.payer', locale), receiptEvidence.payerName)}
          {fact(t('expenses.substitute_wizard.payment_method', locale), t(PAYMENT_KEYS[receiptEvidence.paymentMethod ?? 'CASH'], locale))}
          {fact(t('expenses.substitute_wizard.payment_date', locale), <span className="mangmee-unit">{dateShort(receiptEvidence.paymentDate)}</span>)}
        </dl>
        {evidenceIds.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <p className="text-gray-500">{t('expenses.substitute_wizard.step_evidence', locale)}</p>
            <ul>{evidenceIds.map((id) => {
              const attachment = detail.attachments.find((item) => item.id === id);
              return <li key={id} className="flex flex-wrap items-center gap-2">
                {attachment ? <>
                  <span className="min-w-0 flex-1 font-semibold text-gray-900 [overflow-wrap:anywhere]">{attachment.originalFileName}</span>
                  <button type="button" className={cx(quietButtonClass, 'shrink-0')} disabled={busy} aria-busy={Boolean(busy)}
                    aria-label={`${t('expenses.substitute_wizard.open_document', locale)} ${attachment.originalFileName}`}
                    onClick={() => void run(() => openEvidenceAttachment(attachment))}>
                    {t('expenses.substitute_wizard.open_document', locale)}
                  </button>
                </> : <span className="py-2.5 text-warning-700">{locale === 'th' ? ATTACHMENT_MISSING_TEXT : 'Attachment details unavailable. Reload this page.'}</span>}
              </li>;
            })}</ul>
          </div>
        )}
      </MangmeeCard>
    );
  };

  // The refusal of the last press, drawn once: beside the button of the step that caused it when the
  // step claims it (`placeError()`), else at the top of the page.
  const errorNotice = error ? (
    <div ref={errorNoticeRef} role="alert" aria-live="assertive" aria-atomic="true" className="scroll-mt-24">
      <ErrorBanner message={error} />
      {<button type="button" className={ghostClass} onClick={() => window.location.reload()}>ลองอีกครั้ง</button>}
      {error.includes('มีใบเสร็จแล้ว') && detail && <Link className={ghostClass} href={`/companies/${companyId}/expenses/${detail.id}`}>เปิดค่าใช้จ่าย</Link>}
      {error.includes('คำขอเบิก') && <Link className="mt-2 block text-sm font-semibold text-brand-700 underline" href={`/companies/${companyId}/reimbursements`}>เปิดรายการเบิกคืนเพื่อตรวจรายการที่เกี่ยวข้อง</Link>}
    </div>
  ) : null;
  let errorPlaced = false;
  const placeError = () => {
    if (!errorNotice || errorPlaced) return null;
    errorPlaced = true;
    return errorNotice;
  };

  // One readiness list per step, and the same labels are what the blocked primary button names —
  // a section can no longer read "ครบแล้ว พร้อมไปต่อ" while the server is still going to refuse.
  // Continuing saves the no-receipt review; the person only chooses the expense and acknowledges it here.
  const unrepairableCause = expenseIneligibleCause && !(canReview && ['category', 'amount', 'lines'].includes(expenseIneligibleCause)) ? expenseIneligibleCause : null;
  // What the notice of this step names and this person cannot put right in the wizard stops them here,
  // before they fill the next step in vain.
  const unrepairablePrerequisites = canReview ? [] : (expensePrerequisites?.missing ?? []).filter((issue) => issue !== 'renderability');
  const expenseStepReadinessItems = [
    ...unrepairablePrerequisites.map((issue) => ({ label: PREREQUISITE_NAMES[issue] ?? t(PREREQUISITE_KEYS[issue], locale), complete: false })),
    { label: t('expenses.substitute_wizard.readiness_tax_ack', locale), complete: consent },
    { label: t('expenses.substitute_wizard.readiness_permission', locale), complete: canPrepare },
  ];
  const expenseStepBlockers = expenseStepReadinessItems.filter((item) => !item.complete).map((item) => item.label);

  /** The two blockers the wizard cannot repair, each said once with the screen that can repair it. */
  const renderPrerequisiteCard = () => {
    const blocking = expensePrerequisites?.missing.filter((issue) => issue !== 'renderability') ?? [];
    if (!detail || blocking.length === 0) return null;
    return blocking.map((issue) => (
      <Notice key={issue} tone="warning" action={<Link className={ghostClass} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>{t('expenses.substitute_wizard.view_expense', locale)}</Link>}>
        {t(PREREQUISITE_KEYS[issue], locale)}{!canReview && ' ให้เจ้าของกิจการหรือผู้ตรวจค่าใช้จ่ายเติมข้อมูลนี้'}
      </Notice>
    ));
  };

  const errorLineClass = 'mt-1 block text-sm font-normal text-error-700';

  let wizardActions: ReactNode = null;
  const actionBar = (children: ReactNode) => { wizardActions = children; return null; };

  const renderExpenseStep = () => (
    <div className="space-y-4">
      {/* The one thing a person must know before starting: what this paper cannot be used for. */}
      {!detail && <Notice tone="warning">{t('expenses.substitute_wizard.tax_notice', locale)}</Notice>}

      {/* A real fork, asked as two plain choices. */}
      {!detail && canReview && (
        <fieldset className="min-w-0">
          <legend className="text-base font-semibold text-gray-900">{t('expenses.substitute_wizard.entry_question', locale)}</legend>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <ChoiceRow framed name="substitute-entry" value="existing" aria-label={t('expenses.substitute_wizard.entry_existing_title', locale)} checked={entryMode === 'existing'}
              onChange={() => { setEntryMode('existing'); requestWorkflowFocus('candidate'); }}
              label={t('expenses.substitute_wizard.entry_existing_title', locale)} description={t('expenses.substitute_wizard.entry_existing_help', locale)} />
            <ChoiceRow framed name="substitute-entry" value="new" aria-label={t('expenses.substitute_wizard.entry_new_title', locale)} checked={entryMode === 'new'}
              onChange={() => { setEntryMode('new'); requestWorkflowFocus('manual'); }}
              label={t('expenses.substitute_wizard.entry_new_title', locale)} description={t('expenses.substitute_wizard.entry_new_help', locale)} />
          </div>
        </fieldset>
      )}

      {!detail && entryMode === 'existing' && (
        <MangmeeCard className="space-y-4 p-4 sm:p-5">
          <div>
            <h2 ref={candidateHeadingRef} tabIndex={-1} className="scroll-mt-24 text-base font-semibold text-gray-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">{t('expenses.substitute_wizard.candidate_title', locale)}</h2>
            <p className="mt-1 text-sm text-gray-600">เลือกรายการที่จะทำใบรับรอง เรียงจากรายการล่าสุด</p>
          </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="relative block min-w-0 flex-1">
                    <span className="sr-only">{t('expenses.substitute_wizard.candidate_search', locale)}</span>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{ICON.search}</span>
                    <input className={cx(inputClass, 'mangmee-input-icon-end')} value={candidateQuery} placeholder={t('expenses.substitute_wizard.candidate_search', locale)} onChange={(event) => { setCandidateQuery(stripDisallowed(event.target.value)); setCandidatePage(1); }} />
                  </label>

                </div>
          {candidatesError ? (
            <Notice tone="error" action={<button type="button" className={ghostClass} onClick={() => setCandidatesReloadKey((current) => current + 1)}>{t('expenses.substitute_wizard.retry', locale)}</button>}>{candidatesError}</Notice>
          ) : candidatesLoading ? <LoadingState label={t('expenses.loading', locale)} />
            : candidates.length === 0 && !candidateQuery ? (
              <EmptyState title={t('expenses.substitute_wizard.candidate_empty', locale)} description={t('expenses.substitute_wizard.candidate_empty_help', locale)}
                action={canReview ? <button type="button" className={ghostClass} onClick={() => { setEntryMode('new'); requestWorkflowFocus('manual'); }}>{t('expenses.substitute_wizard.entry_new_action', locale)}</button> : <Link className={ghostClass} href={`/companies/${companyId}/expenses/substitute-receipts`}>{t('expenses.substitute_wizard.back_hub', locale)}</Link>} />
            ) : (
              <>
                {candidates.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-600">{t('expenses.substitute_wizard.candidate_search_empty', locale)}</p>
                ) : (
                  <div className="grid gap-2">
                    {candidatePagination.rows.map((item) => {
                      const name = item.vendorNameSnapshot || item.lines[0]?.description || t('expenses.substitute_wizard.not_specified', locale);
                      return (
                      // The row is the button: it says nothing more than what it holds.
                      <button key={item.id} type="button" disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(async () => selectExpense(await getExpense(companyId, item.id)))}
                        className={cx(ghostClass, 'w-full')} style={{ height: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'stretch', textAlign: 'left', whiteSpace: 'normal' }}>
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0 break-words font-semibold text-gray-900">{name}</span>
                          <span className="mangmee-unit shrink-0 font-semibold text-gray-900">{`${amountText(item.grandTotalAmount)} บาท`}</span>
                        </span>
                        <span className="mt-1 block text-sm text-gray-600">
                          {item.expenseNumber && <><span className="mangmee-unit">{item.expenseNumber}</span>{' · '}</>}<span className="mangmee-unit">{dateShort(item.expenseDate)}</span>
                          {item.lines.length > 1 && ` · ${t('expenses.substitute_wizard.item_count', locale).replace('{count}', String(item.lines.length))}`}
                        </span>
                        {item.lines.length > 1 && (
                          <span className="mt-1 block break-words text-sm text-gray-500">
                            {item.lines.slice(0, 2).map((line) => line.description).join(' · ')}
                            {item.lines.length > 2 ? ` · ${t('expenses.substitute_wizard.more_items', locale).replace('{count}', String(item.lines.length - 2))}` : ''}
                          </span>
                        )}
                      </button>
                      );
                    })}
                  </div>
                )}
                {candidatePagination.totalPages > 1 && (
                  <Pagination prominent page={candidatePagination.page} totalPages={candidatePagination.totalPages} onPageChange={setCandidatePage} locale={locale} />
                )}
              </>
            )}
        </MangmeeCard>
      )}

      {!detail && canReview && entryMode === 'new' && (
        <MangmeeCard className="space-y-4 p-4 sm:p-5">
          <h2 ref={manualHeadingRef} tabIndex={-1} className="scroll-mt-24 text-base font-semibold text-gray-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">{t('expenses.substitute_wizard.manual_title', locale)}</h2>
          {categoriesError && (
            <Notice tone="error" action={<button type="button" className={ghostClass} onClick={() => setCategoriesReloadKey((current) => current + 1)}>{t('expenses.substitute_wizard.retry', locale)}</button>}>{categoriesError}</Notice>
          )}
          {!categoriesLoading && !categoriesError && categories.length === 0 && (
            <Notice tone="warning" action={<Link className={ghostClass} href={`/companies/${companyId}/expenses/categories`}>{t('expenses.substitute_wizard.manage_categories', locale)}</Link>}>
              {t('expenses.substitute_wizard.category_empty', locale)}
            </Notice>
          )}
          {/* Fields in the order of the work: where, when, what, how much. Each says what it lacks under itself. */}
          <TransactionBranchField fill value={createBranchId} invalid={manualValidationAttempted && !createBranchId} />
          <label className="block text-sm font-semibold text-gray-700 sm:max-w-xs">
            <span className="mb-1 block">{t('expenses.substitute_wizard.shared_expense_date', locale)}<RequiredMark /></span>
            <ThemedDate
              triggerRef={manualDateTriggerRef}
              className={inputClass}
              value={manualDate}
              required
              aria-invalid={manualValidationAttempted && !manualDate}
              aria-describedby={manualValidationAttempted && !manualDate ? 'substitute-manual-date-error' : undefined}
              aria-label={t('expenses.substitute_wizard.shared_expense_date', locale)}
              onChange={(event) => setManualDate(event.target.value)}
            />
            {manualValidationAttempted && !manualDate && <span id="substitute-manual-date-error" role="alert" className={errorLineClass}>{t('expenses.substitute_wizard.date_required', locale)}</span>}
          </label>
          <section className="space-y-3" aria-label={t('expenses.substitute_wizard.items_title', locale)}>
            {manualLines.map((line, index) => {
              const invalidFields = manualValidationAttempted ? invalidManualLineFields(line) : [];
              const fieldError = (field: ManualLineField) => (invalidFields.includes(field) ? manualLineFieldError(line, field) : null);
              const errorId = (field: ManualLineField) => `${manualLineControlId(line.id, field)}-error`;
              const several = manualLines.length > 1;
              const itemName = t('expenses.substitute_wizard.item_n', locale).replace('{number}', String(index + 1));
              return (
              <fieldset
                key={line.id}
                ref={(node) => { manualLineCardRefs.current[line.id] = node; }}
                tabIndex={-1}
                aria-invalid={manualValidationAttempted && manualLinesReadiness.invalidLineIndexes.includes(index) || undefined}
                className={cx(
                  'min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                  // One line needs no frame and no number; from two lines each is told apart.
                  several && 'rounded-xl border border-gray-200 p-3',
                )}
              >
                <legend className="sr-only">{itemName}</legend>
                {several && (
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-gray-700">{itemName}</span>
                    <MoreActions label="เพิ่มเติม" align="end" closeOnPress>
                      <button type="button" className={ghostClass} disabled={index === 0 || busy} onClick={() => moveManualLine(index, -1)}>{t('expenses.substitute_wizard.move_item_up', locale)}</button>
                      <button type="button" className={ghostClass} disabled={index === manualLines.length - 1 || busy} onClick={() => moveManualLine(index, 1)}>{t('expenses.substitute_wizard.move_item_down', locale)}</button>
                      <button type="button" className={dangerClass} disabled={busy} onClick={() => removeManualLine(line.id)}>{t('expenses.substitute_wizard.remove_item', locale)}</button>
                    </MoreActions>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">{t('expenses.manual_description', locale)}<RequiredMark /></span>
                    <input id={manualLineControlId(line.id, 'description')} ref={(node) => { manualLineDescriptionRefs.current[line.id] = node; }} className={inputClass} required maxLength={200} value={line.description} aria-invalid={Boolean(fieldError('description')) || undefined} aria-describedby={fieldError('description') ? errorId('description') : undefined} placeholder={t('expenses.substitute_wizard.manual_description_placeholder', locale)} onChange={(event) => updateManualLine(line.id, { description: stripDisallowed(event.target.value) })} />
                    {fieldError('description') && <span id={errorId('description')} role="alert" className={errorLineClass}>{fieldError('description')}</span>}
                  </label>
                  <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
                    <span className="mb-1 block">{t('expenses.substitute_wizard.category', locale)}<RequiredMark /></span>
                    <ThemedSelect id={manualLineControlId(line.id, 'expenseCategoryId')} className={inputClass} value={line.expenseCategoryId} required aria-invalid={Boolean(fieldError('expenseCategoryId')) || undefined} aria-describedby={fieldError('expenseCategoryId') ? errorId('expenseCategoryId') : undefined} aria-label={`${itemName}: ${t('expenses.substitute_wizard.category', locale)}`} onChange={(event) => updateManualLine(line.id, { expenseCategoryId: event.target.value })} disabled={categoriesLoading}>
                      <option value="">{categoriesLoading ? t('expenses.loading', locale) : t('expenses.substitute_wizard.category_none', locale)}</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </ThemedSelect>
                    {fieldError('expenseCategoryId') && <span id={errorId('expenseCategoryId')} role="alert" className={errorLineClass}>{fieldError('expenseCategoryId')}</span>}
                  </label>
                  <label className="block text-sm font-semibold text-gray-700">
                    <span className="mb-1 block">{t('expenses.substitute_wizard.quantity', locale)}<RequiredMark /></span>
                    <input id={manualLineControlId(line.id, 'quantity')} className={cx(inputClass, 'text-right tabular-nums')} required type="number" inputMode="decimal" min="0.0001" step="0.0001" value={line.quantity} aria-invalid={Boolean(fieldError('quantity')) || undefined} aria-describedby={fieldError('quantity') ? errorId('quantity') : undefined} onChange={(event) => updateManualLine(line.id, { quantity: event.target.value })} />
                    {fieldError('quantity') && <span id={errorId('quantity')} role="alert" className={errorLineClass}>{fieldError('quantity')}</span>}
                  </label>
                  <label className="block text-sm font-semibold text-gray-700">
                    <span className="mb-1 block">{t('expenses.substitute_wizard.unit_price', locale)}<RequiredMark /></span>
                    <span className="relative block">
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-normal text-gray-500">บาท</span>
                      {/* Text with a decimal keypad: a number box drops a typed comma, and how differs by browser. */}
                      <input id={manualLineControlId(line.id, 'unitPrice')} className={cx(inputClass, '!pr-12 text-right tabular-nums')} required type="text" inputMode="decimal" autoComplete="off" value={line.unitPrice} aria-invalid={Boolean(fieldError('unitPrice')) || undefined} aria-describedby={fieldError('unitPrice') ? errorId('unitPrice') : undefined} placeholder="0.00" onChange={(event) => updateManualLine(line.id, { unitPrice: normalizeDecimalInput(event.target.value.replace(/[^\d.]/g, '')) })} />
                    </span>
                    {fieldError('unitPrice') && <span id={errorId('unitPrice')} role="alert" className={errorLineClass}>{fieldError('unitPrice')}</span>}
                  </label>
                </div>
                {/* Show a new amount from quantity or satang rounding; do not repeat an unchanged price. */}
                {(Number(line.quantity) !== 1 || manualLineAmount(line) !== Number(line.unitPrice)) && manualLineAmount(line) > 0 && (
                  <p className="mt-3 flex items-center justify-between gap-2 text-sm text-gray-700">
                    <span>{t('expenses.substitute_wizard.line_total', locale)}</span>
                    <span className="mangmee-unit font-semibold text-gray-900">{`${amountText(manualLineAmount(line))} บาท`}</span>
                  </p>
                )}
              </fieldset>
              );
            })}
            <p className="sr-only" aria-live="polite">{manualAnnouncement}</p>
            <ActionGroup align="start">
              <button ref={addManualLineRef} type="button" className={ghostClass} disabled={busy || manualLines.length >= MAX_SUBSTITUTE_MANUAL_LINES} onClick={addManualLine}>
                {t('expenses.substitute_wizard.add_item', locale)}
              </button>
            </ActionGroup>
            {manualLines.length > 1 && (
              <>
                <p className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-3 text-base font-semibold text-gray-900">
                  <span>{t('expenses.substitute_wizard.items_total_label', locale).replace('{count}', String(manualLines.length))}</span>
                  <span className="mangmee-unit">{`${amountText(manualTotal)} บาท`}</span>
                </p>
                <p className="text-sm text-gray-600">รวมใบเดียวได้เมื่อผู้รับเงิน วันที่จ่าย และเหตุผลเดียวกัน สูงสุด {MAX_SUBSTITUTE_MANUAL_LINES} รายการ</p>
              </>
            )}
          </section>
          <div className="space-y-3 border-t border-gray-100 pt-4">
            {!canCreate && <p className="text-sm text-warning-700">{t('expenses.manual_read_only', locale)}</p>}
            {placeError()}
            {actionBar(<ActionGroup>
              <button type="button" className={btnClass} disabled={!canCreate || busy || categoriesLoading || Boolean(categoriesError) || categories.length === 0} aria-busy={Boolean(busy || categoriesLoading)} onClick={() => void run(createManualExpense)}>
                {t('expenses.substitute_wizard.create_and_select', locale)}
              </button>
            </ActionGroup>)}
          </div>
        </MangmeeCard>
      )}

      {detail && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 ref={selectionHeadingRef} tabIndex={-1} className="scroll-mt-24 text-sm font-semibold text-gray-700 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">{t('expenses.substitute_wizard.selection_confirm_title', locale)}</h2>
            {!initialExpenseId && !evidenceId && (
              <button type="button" className={quietButtonClass} onClick={() => {
                setDetail(null); const returnUrl = new URL(window.location.href); returnUrl.searchParams.delete('expenseId'); window.history.replaceState(window.history.state, '', returnUrl);
                setConsent(false);
                setEntryMode('existing');
                requestWorkflowFocus('candidate');
              }}>{t('expenses.substitute_wizard.change_expense', locale)}</button>
            )}
          </div>
          {renderPrerequisiteCard()}
          <DetailSummary detail={detail} categories={categories} />
          {checkBillRoute && <Notice tone="warning">{t('expenses.check_bill_new_draft_note', locale)}</Notice>}
          {selectedExpenseRenderabilityIssue && (
            <Notice tone="warning" action={<Link className={ghostClass} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>{t('expenses.substitute_wizard.edit_expense_to_split', locale)}</Link>}>
              {renderabilityIssueMessage(selectedExpenseRenderabilityIssue, locale)}
            </Notice>
          )}
          {/* What this paper cannot be used for, said once more as the tick itself. */}
          <div>
            <ChoiceRow ref={consentRef} aria-label={t('expenses.substitute_wizard.consent_confirm', locale)} type="checkbox" framed required aria-required="true" checked={consent} onChange={(event) => setConsent(event.target.checked)}
              label={<>{t('expenses.substitute_wizard.consent_confirm', locale)}<RequiredMark /></>} />
            <details className="text-sm text-gray-600">
              <summary className="min-h-11 cursor-pointer py-2.5 font-semibold text-brand-700 underline underline-offset-2">{t('expenses.substitute_wizard.consent_more', locale)}</summary>
              <p className="pb-2">{t('expenses.substitute_wizard.consent_details', locale)}</p>
            </details>
          </div>
          <div className="space-y-3 border-t border-gray-100 pt-3">
            {placeError()}
            <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={expenseStepBlockers} jumps={{
              [t('expenses.substitute_wizard.readiness_tax_ack', locale)]: () => jumpTo(consentRef.current),
            }} />
            {actionBar(<ActionGroup>
              {expenseIneligibleCause && detail && <Link className={ghostClass} href={`/companies/${companyId}/expenses/${detail.id}`}>เปิดค่าใช้จ่าย</Link>}
              <button type="button" className={btnClass} disabled={busy || expenseStepBlockers.length > 0} aria-busy={Boolean(busy)} onClick={() => void run(continueFromExpense)}>{t('expenses.substitute_wizard.continue_to_details', locale)}</button>
            </ActionGroup>)}
          </div>
        </div>
      )}
    </div>
  );

  const companyPaymentRecorded = Boolean(detail && fundingSource === 'COMPANY' && Number(detail.paidAmount) > 0);
  const recordedPaymentMismatch = Boolean(companyPaymentRecorded && detail && (
    (detail.paidAt && coerceCivilDate(detail.paidAt) !== paymentDate)
    || (detail.paymentMethod && detail.paymentMethod !== paymentMethod)));
  const useRecordedPayment = () => {
    if (!detail) return;
    if (detail.paidAt) setPaymentDate(coerceCivilDate(detail.paidAt));
    if (detail.paymentMethod) setPaymentMethod(detail.paymentMethod);
  };
  const detailsReadiness = detail ? evaluateDetailsReadiness({
    payeeName,
    payeeAddress,
    payeeTaxId,
    vendorNameSnapshot: detail.vendorNameSnapshot,
    missingReason,
    businessPurpose,
    payerId,
    payerEligible: payers.some((payer) => payer.userId === payerId),
    requirePayer: false,
    paymentDate,
  }) : null;
  const detailsStepReadinessItems = detailsReadiness ? [
    { label: t('expenses.substitute_wizard.payee_name', locale), complete: !detailsReadiness.missing.includes('payeeName') },
    { label: t('expenses.substitute_wizard.missing_reason', locale), complete: !detailsReadiness.missing.includes('missingReason') },
    { label: t('expenses.substitute_wizard.business_purpose', locale), complete: !detailsReadiness.missing.includes('businessPurpose') },
    { label: [!fundingSource && 'เงินที่ใช้จ่าย', !paidInFullAcknowledged && 'ติ๊กว่าจ่ายครบ'].filter(Boolean).join(' และ'), complete: Boolean(fundingSource && paidInFullAcknowledged) },
    { label: t('expenses.substitute_wizard.payment_date', locale), complete: !detailsReadiness.missing.includes('paymentDate') },
    ...(recordedPaymentMismatch ? [{ label: 'กด “ใช้ข้อมูลการจ่ายที่บันทึกไว้”', complete: false }] : []),
    ...(payeeAddress.trim() ? [{ label: t('expenses.substitute_wizard.payee_address', locale), complete: !detailsReadiness.missing.includes('payeeAddress') }] : []),
    ...(payeeTaxId.trim() ? [{ label: t('expenses.substitute_wizard.payee_tax_id', locale), complete: !detailsReadiness.missing.includes('payeeTaxId') }] : []),
  ] : [];
  const detailsStepBlockers = [...(unrepairableCause ? [PREREQUISITE_NAMES[unrepairableCause] ?? INELIGIBLE_CAUSE_TEXT[unrepairableCause] + (canReview ? '' : ' ให้เจ้าของกิจการหรือผู้ตรวจค่าใช้จ่ายแก้ข้อมูลนี้')] : []), ...detailsStepReadinessItems.filter((item) => !item.complete).map((item) => item.label)];
  // An empty name is not an error until the person has been in the field; a name filled wrongly is one at once.
  const payeeNameIssue = payeeIdentityIssues.payeeName === 'payee_name_required' && !payeeTouched ? undefined : payeeIdentityIssues.payeeName;
  const optionalMark = <span className="font-normal text-gray-500">(ถ้ามี)</span>;
  const sectionHeadingClass = 'text-base font-semibold text-gray-900';

  // Three plain groups in the order of the paper: who was paid, why there is no receipt, how it was paid.
  const renderDetailsStep = (navigation = true) => detail && detailsReadiness && (
    <div className="space-y-4">
      <DetailSummary detail={detail} categories={categories} />
      <MangmeeCard className="p-4 sm:p-5">
        <fieldset disabled={factsDisabled || busy} className="min-w-0 space-y-6">
          <section className="space-y-3">
            <h2 ref={detailsHeadingRef} tabIndex={-1} className={cx(sectionHeadingClass, 'scroll-mt-24 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2')}>ผู้รับเงิน</h2>
            {detail.lines.length > 1 && <p className="text-sm text-gray-600">{t('expenses.substitute_wizard.multi_item_shared_details', locale)}</p>}
            <label className="block text-sm font-semibold text-gray-700">
              <span className="mb-1 block">{t('expenses.substitute_wizard.payee_name', locale)}<RequiredMark /></span>
              <input className={inputClass} required maxLength={201} value={payeeName} aria-invalid={Boolean(payeeNameIssue) || undefined} placeholder={t('expenses.substitute_wizard.payee_name_placeholder', locale)} onBlur={() => setPayeeTouched(true)} onChange={(event) => setPayeeName(stripDisallowed(event.target.value))} />
              {payeeNameIssue
                ? <span role="alert" className={errorLineClass}>{t(PAYEE_ISSUE_KEYS[payeeNameIssue], locale)}</span>
                : <span className="mt-1 block text-sm font-normal text-gray-500">คนหรือร้านที่รับเงินจริง</span>}
            </label>
            {detail.vendorNameSnapshot && payeeName.trim() !== detail.vendorNameSnapshot.trim() && (
              <ActionGroup align="start">
                <button type="button" className={ghostClass} onClick={() => {
                  setPayeeAddress('');
                  setPayeeName(detail.vendorNameSnapshot!);
                  setPayeeTaxId(payeeTaxIdDigits(detail.vendorTaxIdSnapshot ?? ''));
                }}>ใช้ชื่อผู้ขายจากค่าใช้จ่าย</button>
              </ActionGroup>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-gray-700">
                <span className="mb-1 block">{t('expenses.substitute_wizard.payee_address', locale)} {optionalMark}</span>
                <textarea className={inputClass} rows={2} maxLength={301} value={payeeAddress} aria-invalid={Boolean(payeeIdentityIssues.payeeAddress) || undefined} onChange={(event) => setPayeeAddress(stripDisallowed(event.target.value))} />
                {payeeIdentityIssues.payeeAddress && <span role="alert" className={errorLineClass}>{t(PAYEE_ISSUE_KEYS[payeeIdentityIssues.payeeAddress], locale)}</span>}
              </label>
              <label className="block text-sm font-semibold text-gray-700">
                <span className="mb-1 block">{t('expenses.substitute_wizard.payee_tax_id', locale)} {optionalMark}</span>
                <input className={inputClass} inputMode="numeric" value={payeeTaxId} aria-invalid={Boolean(payeeIdentityIssues.payeeTaxId) || undefined} onChange={(event) => setPayeeTaxId(payeeTaxIdDigits(event.target.value))} />
                {payeeTaxId.length > 0 && payeeTaxId.length !== 13 && (
                  <span role="alert" className={errorLineClass}>{t('expenses.substitute_wizard.payee_tax_id_count', locale).replace('{count}', String(payeeTaxId.length))}</span>
                )}
              </label>
            </div>
          </section>

          <section className="space-y-3 border-t border-gray-100 pt-5">
            {/* The kind of reason first (owner 2026-10-16): the words under it then read as its detail, and "เหตุผลอื่น" asks for them by name. */}
            <div className="space-y-2">
              <span className="block text-sm font-semibold text-gray-700">{t('expenses.substitute_wizard.reason_code', locale)}<RequiredMark /></span>
              <ThemedSelect className={inputClass} required wrapLabel disabled={factsDisabled || busy} value={reasonCode} aria-label={t('expenses.substitute_wizard.reason_code', locale)} onChange={(event) => setReasonCode(event.target.value as SubstituteReceiptReasonCode)}>
                {Object.entries(REASON_KEYS).map(([value, key]) => <option key={value} value={value}>{t(key, locale)}</option>)}
              </ThemedSelect>
              <p className="text-sm text-gray-600">{t('expenses.substitute_wizard.lost_receipt_notice', locale)}</p>
            </div>
            <label className="block text-sm font-semibold text-gray-700">
              <span className="mb-1 block">{reasonCode === 'OTHER' ? 'ระบุเหตุผลอื่น' : t('expenses.substitute_wizard.missing_reason', locale)}<RequiredMark /></span>
              <textarea className={inputClass} required rows={2} maxLength={500} value={missingReason} placeholder={t('expenses.substitute_wizard.missing_reason_placeholder', locale)} onChange={(event) => setMissingReason(stripDisallowed(event.target.value))} />
              {/* W06 §12.2: the facts SUGGEST a reason; the payer's own words are what is printed. */}
              {missingReasonSuggestion && !missingReason.trim() && (
                <span className="mt-2 block rounded-xl bg-gray-50 p-3 text-sm font-normal text-gray-600">
                  {t('expenses.substitute_wizard.missing_reason_suggested', locale)}: {missingReasonSuggestion}
                  <button type="button" className="ml-2 font-semibold text-brand-700 underline" disabled={factsDisabled || busy}
                    onClick={() => setMissingReason(missingReasonSuggestion)}>
                    {t('expenses.substitute_wizard.missing_reason_use_suggestion', locale)}
                  </button>
                </span>
              )}
            </label>
            <label className="block text-sm font-semibold text-gray-700">
              <span className="mb-1 block">{t('expenses.substitute_wizard.business_purpose', locale)}<RequiredMark /></span>
              <textarea className={inputClass} required rows={2} maxLength={500} value={businessPurpose} placeholder={t('expenses.substitute_wizard.business_purpose_placeholder', locale)} onChange={(event) => setBusinessPurpose(stripDisallowed(event.target.value))} />
            </label>
          </section>

          <section className="space-y-3 border-t border-gray-100 pt-5">
            <h2 className={sectionHeadingClass}>การจ่าย</h2>
            {companyPaymentRecorded && (
              <Notice tone="info" action={recordedPaymentMismatch
                ? <button type="button" className={ghostClass} onClick={useRecordedPayment}>ใช้ข้อมูลการจ่ายที่บันทึกไว้</button>
                : <Link className={ghostClass} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>{t('expenses.substitute_wizard.view_expense', locale)}</Link>}>
                ค่าใช้จ่ายนี้บันทึกว่าร้านจ่ายแล้วเมื่อ <span className="mangmee-unit">{dateShort(detail.paidAt)}</span> ({detail.paymentMethod ? t(PAYMENT_KEYS[detail.paymentMethod], locale) : 'ยังไม่ระบุวิธีจ่าย'}){' '}
                {recordedPaymentMismatch ? 'ซึ่งไม่ตรงกับที่กรอกด้านล่าง' : 'ใบรับรองใช้ข้อมูลการจ่ายนี้ ถ้าผิดให้แก้ที่ค่าใช้จ่ายก่อน'}
              </Notice>
            )}
            <fieldset className="min-w-0">
              <legend className="text-sm font-semibold text-gray-700">ใช้เงินของใครจ่าย<RequiredMark /></legend>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <ChoiceRow framed name="substitute-funding" value="COMPANY" aria-label="เงินของร้าน" checked={fundingSource === 'COMPANY'} disabled={Boolean(receiptEvidence) || factsDisabled || busy}
                  onChange={() => { setFundingSource('COMPANY'); setPaidInFullAcknowledged(false); }} label="เงินของร้าน" />
                <ChoiceRow framed name="substitute-funding" value="PERSONAL_ADVANCE" aria-label="พนักงานสำรองจ่าย" checked={fundingSource === 'PERSONAL_ADVANCE'} disabled={Boolean(receiptEvidence) || factsDisabled || busy}
                  onChange={() => { setFundingSource('PERSONAL_ADVANCE'); setPaidInFullAcknowledged(false); }} label="เงินส่วนตัวของพนักงาน" description="พนักงานสำรองจ่ายไปก่อน" />
              </div>
            </fieldset>
            {/* The make-up of the amount only when it differs from the amount already shown (thai-ux-standard 3.5). */}
            {Number(detail.whtAmount) !== 0 && (
              <p className="text-sm text-gray-600">
                ยอด <span className="mangmee-unit">{`${amountText(detail.grandTotalAmount)} บาท`}</span> · หัก ณ ที่จ่าย <span className="mangmee-unit">{`${amountText(detail.whtAmount)} บาท`}</span> · จ่ายผู้รับเงิน <span className="mangmee-unit">{`${amountText(detail.netPayableAmount)} บาท`}</span>
              </p>
            )}
            <ChoiceRow type="checkbox" framed required aria-required="true" aria-label={`จ่ายครบ ${amountText(detail.netPayableAmount)} บาท แล้ว ไม่ได้แบ่งจ่าย`} checked={paidInFullAcknowledged} disabled={Boolean(receiptEvidence) || factsDisabled || busy}
              onChange={(event) => setPaidInFullAcknowledged(event.target.checked)}
              label={<>จ่ายครบ <span className="mangmee-unit">{`${amountText(detail.netPayableAmount)} บาท`}</span> แล้ว ไม่ได้แบ่งจ่าย<RequiredMark /></>} />
            {/* The one consequence of issuing that touches money, said where the money is chosen. */}
            {fundingSource === 'COMPANY' && Number(detail.paidAmount) === 0 && (
              <Notice tone="info">เมื่อออกใบรับรอง ระบบจะบันทึกว่าร้านจ่าย <span className="mangmee-unit">{`${amountText(detail.netPayableAmount)} บาท`}</span> แล้ว</Notice>
            )}
            {fundingSource === 'COMPANY' && Number(detail.paidAmount) > 0 && Number(detail.outstandingAmount) > 0 && (
              <Notice tone="error" action={<Link className={ghostClass} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>{t('expenses.substitute_wizard.view_expense', locale)}</Link>}>
                ค่าใช้จ่ายนี้บันทึกจ่ายไว้บางส่วน หน้านี้ยังทำใบรับรองให้ไม่ได้
              </Notice>
            )}
            {fundingSource === 'PERSONAL_ADVANCE' && <p className="text-sm text-gray-600">ออกใบรับรองแล้วยังไม่ถือว่าร้านจ่ายเงินคืนพนักงาน</p>}
            {policy?.companyNameSource === 'DISPLAY_NAME' && (
              <Notice tone="warning" action={canFillShop ? <Link className={ghostClass} href={`/companies/${companyId}/settings/profile?returnTo=${encodeURIComponent(`/companies/${companyId}/expenses/substitute-receipts/new?expenseId=${detail.id}`)}#shop`}>กรอกข้อมูลร้าน</Link> : undefined}>
                ใบรับรองจะใช้ชื่อ “{policy.companyName}” เพราะยังไม่ได้กรอกชื่อจดทะเบียนของร้าน{!canFillShop && ' ให้เจ้าของกิจการหรือผู้ดูแลร้านกรอกข้อมูลร้านก่อน'}
              </Notice>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-gray-700">
                <span className="mb-1 block">{t('expenses.substitute_wizard.payment_method', locale)}<RequiredMark /></span>
                <ThemedSelect className={inputClass} required disabled={factsDisabled || busy || (companyPaymentRecorded && Boolean(detail.paymentMethod))} value={paymentMethod} aria-label={t('expenses.substitute_wizard.payment_method', locale)} onChange={(event) => setPaymentMethod(event.target.value as ExpensePaymentMethod)}>
                  {Object.entries(PAYMENT_KEYS).filter(([method]) => detail.whtRemittance !== 'E_WHT' || fundingSource !== 'COMPANY' || eWhtPaymentMethodAllowed(method)).map(([value, key]) => <option key={value} value={value}>{t(key, locale)}</option>)}
                </ThemedSelect>
              </label>
              <label className="block text-sm font-semibold text-gray-700">
                <span className="mb-1 block">{t('expenses.substitute_wizard.payment_date', locale)}<RequiredMark /></span>
                <ThemedDate className={inputClass} required disabled={factsDisabled || busy || (companyPaymentRecorded && Boolean(detail.paidAt))} value={paymentDate} aria-label={t('expenses.substitute_wizard.payment_date', locale)} onChange={(event) => void changePaymentDate(event.target.value)} />
                {fundingSource === 'COMPANY' && expenseEWhtPaymentWarning(detail.whtRemittance, detail.whtCategoryCode, detail.whtRate, paymentDate) && <span role="status" className="mt-1 block text-sm font-normal text-warning-700">{E_WHT_WORDS['W-P2']}</span>}
                <span className="mt-1 block text-sm font-normal text-gray-500">วันที่ในค่าใช้จ่าย: <span className="mangmee-unit">{dateShort(detail.expenseDate)}</span></span>
              </label>
            </div>
          </section>
        </fieldset>
      </MangmeeCard>
      {renderPrerequisiteCard()}
      {!receiptEvidence && canReview && expenseIneligibleCause && ['category', 'amount', 'lines'].includes(expenseIneligibleCause) && <ExpenseReviewEditSection
        companyId={companyId} detail={detail} permissions={permissions} isMutable={!busy} canReview canConfirm={false}
        skipUnchangedSave saveRef={sourceSaveRef} onSaved={async () => { setDetail(await getExpense(companyId, detail.id)); }} />}
      {navigation && actionBar(<div className="space-y-3">
        {placeError()}
        <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={detailsStepBlockers} />
        <ActionGroup>
          <button type="button" className={ghostClass} disabled={busy} onClick={() => { setActiveStep('expense'); requestWorkflowFocus('selection'); }}>{t('expenses.substitute_wizard.back', locale)}</button>
          <button type="button" className={btnClass} disabled={busy || detailsStepBlockers.length > 0} aria-busy={Boolean(busy)} onClick={() => void run(continueFromDetails)}>{t('expenses.substitute_wizard.continue_to_evidence', locale)}</button>
        </ActionGroup>
      </div>)}
    </div>
  );

  const renderAttachmentPicker = (
    purpose: 'expense.receipt.supporting' | 'expense.payment.evidence',
    titleKey: DictionaryKey,
    helpKey: DictionaryKey,
    required: boolean,
    ids: string[],
    setIds: (next: string[]) => void,
    file: File | null,
    setFile: (file: File | null) => void,
  ) => {
    const attachments = detail?.attachments.filter((attachment) => (!factsDisabled || ids.includes(attachment.id)) && attachment.status === 'ACTIVE'
      && (purpose === 'expense.payment.evidence'
        ? attachment.purpose === purpose && !detail?.attachments.some((source) => source.id === attachment.id && source.purpose !== purpose)
          && (attachment.mimeType.startsWith('image/') || attachment.mimeType === 'application/pdf')
        : attachment.purpose !== 'expense.payment.evidence' && attachment.purpose !== 'expense.review.evidence')) ?? [];
    const selectedCount = attachments.filter((attachment) => ids.includes(attachment.id)).length;
    return (
      <section className="space-y-3">
        <div>
          <h2 className={sectionHeadingClass}>{t(titleKey, locale)}{required ? <RequiredMark /> : <> {optionalMark}</>}</h2>
          <p className="mt-1 text-sm text-gray-600">{t(helpKey, locale)}</p>
        </div>
        {attachments.length > 0 && (
          <div>
            <p className="text-sm text-gray-600">
              {t('expenses.substitute_wizard.available_files', locale)}
              {selectedCount > 0 && ` · เลือกแล้ว ${t('expenses.substitute_wizard.file_count', locale).replace('{count}', String(selectedCount))}`}
            </p>
            {attachments.map((attachment) => (
              <div key={attachment.id} className="flex items-center gap-2">
                <ChoiceRow type="checkbox" className="min-w-0 flex-1" disabled={factsDisabled || busy} aria-label={attachment.originalFileName} checked={ids.includes(attachment.id)}
                  label={<span className="[overflow-wrap:anywhere]">{attachment.originalFileName}</span>}
                  onChange={(event) => {
                    const nextIds = event.target.checked
                      ? [...new Set([...ids, attachment.id])]
                      : ids.filter((id) => id !== attachment.id);
                    if (event.target.checked && detail) {
                      const otherIds = purpose === 'expense.payment.evidence' ? supportingIds : paymentIds;
                      const selected = new Set([...nextIds, ...otherIds]);
                      const issue = substituteReceiptEvidenceRenderabilityIssue(
                        detail.attachments.filter((item) => selected.has(item.id)),
                      );
                      if (issue) {
                        setError(evidenceRenderabilityIssueMessage(issue, locale));
                        return;
                      }
                    }
                    setError(null);
                    setIds(nextIds);
                  }} />
                <button
                  type="button"
                  className={cx(quietButtonClass, 'shrink-0')}
                  disabled={busy} aria-busy={Boolean(busy)}
                  aria-label={`${t('expenses.substitute_wizard.open_document', locale)} ${attachment.originalFileName}`}
                  onClick={() => void run(() => openEvidenceAttachment(attachment))}
                >
                  {t('expenses.substitute_wizard.open_document', locale)}
                </button>
              </div>
            ))}
          </div>
        )}
        {ids.some((id) => !attachments.some((attachment) => attachment.id === id)) && <p className="text-sm text-warning-700">{ATTACHMENT_MISSING_TEXT}</p>}
        {/* Picking a file uploads it. The picker renders the chosen name with a clear button
            and an upload glyph, so a staged-but-unsent file read as done — people filled both
            panels, saw the readiness card still short one item, and had no way to tell why.
            The staged file now only survives a failed upload, which is what the button retries.
            The "working" line belongs to the picker that is working, not to both. */}
        {canUploadEvidence && !factsDisabled ? (
          <>
            <ThemedFile
              file={file}
              accept={ATTACHMENT_UPLOAD_ACCEPT}
              hint={t('expenses.substitute_wizard.file_types', locale)}
              aria-label={t(titleKey, locale)}
              disabled={busy} loading={uploadingPurpose === purpose}
              onChange={(next) => {
                setFile(next);
                if (next) {
                  setUploadingPurpose(purpose);
                  void run(() => uploadEvidence(purpose, next)).finally(() => setUploadingPurpose(null));
                }
              }}
            />
            {file && (
              <ActionGroup align="start">
                <button type="button" className={ghostClass} disabled={busy} aria-busy={uploadingPurpose === purpose} onClick={() => {
                  setUploadingPurpose(purpose);
                  void run(() => uploadEvidence(purpose)).finally(() => setUploadingPurpose(null));
                }}>อัปโหลดไฟล์นี้อีกครั้ง</button>
              </ActionGroup>
            )}
          </>
        ) : !factsDisabled && <p className="text-sm text-gray-600">{t('expenses.substitute_wizard.upload_forbidden', locale)}</p>}
        {purpose === 'expense.payment.evidence' && paymentMethod === 'CASH' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 flex-1 basis-56 text-sm text-gray-600">{t('expenses.substitute_wizard.payment_voucher_help', locale)}</p>
            <ActionGroup>
              <button type="button" className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(downloadPaymentVoucher)}>
                {t('expenses.substitute_wizard.payment_voucher_action', locale)}
              </button>
            </ActionGroup>
          </div>
        )}
      </section>
    );
  };

  // evidenceNone is a LINE conversation answer ("no file exists"), not a wizard field: the apply
  // block above ignores it, so counting it would promise a prefilled field the form never shows.
  const prefilledFieldCount = linePrefill
    ? Object.keys(linePrefill.acceptedValues).filter((field) => field !== 'evidenceNone').length
    : 0;

  const evidenceReadiness = evaluateEvidenceReadiness({
    policyReady: Boolean(policy?.ready),
    paymentCount: selectedPaymentCount,
    requiresPaymentEvidence,
    renderabilityIssue: selectedEvidenceRenderabilityIssue,
  });
  // The expense-level blockers are repeated here because this is the step whose button calls the
  // endpoint that enforces them.
  const evidenceStepReadinessItems = [
    ...(expenseIneligibleCause ? [{ label: INELIGIBLE_CAUSE_TEXT[expenseIneligibleCause], complete: false }] : []),
    { label: t('expenses.substitute_wizard.readiness_reviewed_amount', locale), complete: !expensePrerequisites?.missing.includes('reviewedAmount') },
    { label: t('expenses.substitute_wizard.readiness_reviewed_category', locale), complete: !expensePrerequisites?.missing.includes('reviewedCategory') },
    { label: t('expenses.substitute_wizard.readiness_policy', locale), complete: !evidenceReadiness.missing.includes('policy') },
    { label: requiresPaymentEvidence ? t('expenses.substitute_wizard.payment_evidence_title', locale) : t('expenses.substitute_wizard.payment_evidence_optional_short', locale), complete: !evidenceReadiness.missing.includes('paymentEvidence') },
    { label: t('expenses.substitute_wizard.readiness_renderable', locale), complete: !evidenceReadiness.missing.includes('renderability') },
  ];
  const evidenceStepBlockers = evidenceStepReadinessItems.filter((item) => !item.complete).map((item) => item.label);

  // Both kinds of proof in one card, each under its own heading; neither is asked for unless the shop's rule says so.
  const renderEvidenceStep = (navigation = true) => detail && (
    <div className="space-y-4">
      {navigation && <DetailSummary detail={detail} categories={categories} />}
      <MangmeeCard className="space-y-5 p-4 sm:p-5">
        {renderAttachmentPicker(
          'expense.receipt.supporting',
          'expenses.substitute_wizard.supporting_title',
          'expenses.substitute_wizard.supporting_help',
          // R5: still asked for and still uploadable here, but zero attachments is a legal document.
          false,
          supportingIds,
          setSupportingIds,
          supportingFile,
          setSupportingFile,
        )}
        <div className="border-t border-gray-100 pt-5">
          {renderAttachmentPicker(
            'expense.payment.evidence',
            'expenses.substitute_wizard.payment_evidence_title',
            requiresPaymentEvidence ? 'expenses.substitute_wizard.payment_evidence_required' : 'expenses.substitute_wizard.payment_evidence_optional',
            requiresPaymentEvidence,
            paymentIds,
            setPaymentIds,
            paymentFile,
            setPaymentFile,
          )}
        </div>
        <p className="text-sm text-gray-500">
          {t('expenses.substitute_wizard.evidence_limit_help', locale)
            .replace('{count}', String(SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments))}
        </p>
      </MangmeeCard>
      {paymentMethod === 'CASH' && policy?.cashEvidenceInstructions && <Notice tone="info">{policy.cashEvidenceInstructions}</Notice>}
      {!policy?.ready && (
        <Notice tone="error" action={<Link className={ghostClass} href={`/companies/${companyId}/settings/substitute-receipt`}>ไปตั้งค่าใบรับรอง</Link>}>
          {t('expenses.substitute_wizard.policy_not_ready', locale)}
        </Notice>
      )}
      {selectedEvidenceRenderabilityIssue && (
        <Notice tone="error">{evidenceRenderabilityIssueMessage(selectedEvidenceRenderabilityIssue, locale)}</Notice>
      )}
      {renderPrerequisiteCard()}
      {navigation && actionBar(<div className="space-y-3">
        {placeError()}
        <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={evidenceStepBlockers} />
        <ActionGroup>
          <button type="button" className={ghostClass} disabled={busy} onClick={() => { setInfo(null); setError(null); setActiveStep('details'); }}>{t('expenses.substitute_wizard.back', locale)}</button>
          <button type="button" className={btnClass} disabled={busy || evidenceStepBlockers.length > 0} aria-busy={Boolean(busy)} onClick={() => { if (editingPrepared) void run(prepare); else { setInfo(null); setActiveStep('method'); } }}>{t('expenses.substitute_wizard.continue', locale)}</button>
        </ActionGroup>
      </div>)}
    </div>
  );

  // What the button of this screen still lacks, in the words of its two questions.
  const methodBlockers = [
    ...(!signingMethod ? ['เลือกวิธีเซ็น'] : []),
    ...(signingMethod === 'DIGITAL' && !payerId ? [t('expenses.substitute_wizard.select_payer', locale)] : []),
  ];

  const renderMethodStep = () => <MangmeeCard className="space-y-5 p-4 sm:p-5">
    <fieldset className="min-w-0">
      <legend className={sectionHeadingClass}>เลือกวิธีเซ็น</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <ChoiceRow framed name="signing-method" value="DIGITAL" aria-label="เซ็นออนไลน์" checked={signingMethod === 'DIGITAL'} onChange={() => setSigningMethod('DIGITAL')}
          label="เซ็นออนไลน์" description={policy?.approvalMode === 'OWNER_SELF' ? 'เจ้าของกิจการเซ็นรับรองและอนุมัติได้ในครั้งเดียวด้วยบัญชีของตัวเอง' : 'ผู้รับรองการจ่ายเซ็นก่อน แล้วผู้อนุมัติที่ร้านกำหนดเซ็นด้วยบัญชีของตัวเอง'} />
        <ChoiceRow framed name="signing-method" value="PAPER" aria-label="พิมพ์แล้วเซ็นบนกระดาษ" checked={signingMethod === 'PAPER'} onChange={() => setSigningMethod('PAPER')}
          label="พิมพ์แล้วเซ็นบนกระดาษ" description="พิมพ์แบบฟอร์มไปกรอกชื่อและเซ็น แล้วอัปโหลดกลับมา ใช้ได้กับคนที่ไม่มีบัญชี" />
      </div>
    </fieldset>
    {signingMethod === 'DIGITAL' && (
      <label className="block text-sm font-semibold text-gray-700">
        <span className="mb-1 block">{t('expenses.substitute_wizard.payer', locale)}<RequiredMark /></span>
        <ThemedSelect className={inputClass} required searchable wrapLabel value={payerId} aria-label={t('expenses.substitute_wizard.payer', locale)} onChange={(event) => setPayerId(event.target.value)} disabled={payersLoading}>
          <option value="">{payersLoading ? t('expenses.substitute_wizard.payers_loading', locale) : t('expenses.substitute_wizard.select_payer', locale)}</option>
          {payers.map((payer) => <option key={payer.userId} value={payer.userId}>{payer.displayName}</option>)}
        </ThemedSelect>
        <span className="mt-1 block text-sm font-normal text-gray-500">
          {payerId === userId ? 'คุณเซ็นด้วยบัญชีที่ใช้อยู่' : `${payers.find(payer => payer.userId === payerId)?.displayName || 'ผู้รับรองการจ่าย'} ต้องเซ็นด้วยบัญชีของตัวเอง`}
        </span>
      </label>
    )}
    {signingMethod === 'DIGITAL' && !payersLoading && payers.length === 0 && (
      <Notice tone="warning" action={<Link className={ghostClass} href={`/companies/${companyId}/settings/access-overview`}>ไปรายชื่อพนักงาน</Link>}>
        {t('expenses.substitute_wizard.payer_empty', locale)}
      </Notice>
    )}
    {signingMethod === 'PAPER' && fundingSource === 'PERSONAL_ADVANCE' && (
      <Notice tone="warning">ใบที่เซ็นบนกระดาษใช้ทำใบเบิกในระบบไม่ได้ ถ้าจะเบิกคืน เลือกเซ็นออนไลน์และเลือกพนักงานที่สำรองจ่าย</Notice>
    )}
    {signingMethod === 'PAPER' && !canReview && <Notice tone="info">คุณพิมพ์และส่งฉบับที่เซ็นแล้วไม่ได้ ให้ผู้ตรวจค่าใช้จ่ายเปิดใบนี้ทำต่อ</Notice>}
    {/* This press gives the certificate its number. What goes on it is shown right above the button, and the button says what it does. */}
    <div className="space-y-3 border-t border-gray-100 pt-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-gray-500">{t('expenses.substitute_hub.table_payee', locale)}</dt><dd className="break-words font-semibold text-gray-900">{payeeName.trim() || t('expenses.substitute_wizard.not_specified', locale)}</dd></div>
        <div><dt className="text-gray-500">{t('expenses.substitute_hub.table_amount', locale)}</dt><dd className="mangmee-unit font-semibold text-gray-900">{detail ? `${amountText(detail.grandTotalAmount)} บาท` : ''}</dd></div>
        <div><dt className="text-gray-500">{t('expenses.substitute_hub.table_payment_date', locale)}</dt><dd className="mangmee-unit font-semibold text-gray-900">{dateShort(paymentDate)}</dd></div>
      </dl>
      <p className="text-sm text-gray-600">สร้างแล้วจะเปลี่ยนวิธีเซ็นไม่ได้ ต้องยกเลิกใบแล้วสร้างใหม่</p>
      {placeError()}
      <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={methodBlockers} />
      {actionBar(<ActionGroup>
        <button type="button" className={ghostClass} disabled={busy} onClick={() => { setInfo(null); setError(null); setActiveStep('evidence'); }}>{t('expenses.substitute_wizard.back', locale)}</button>
        <button type="button" className={btnClass} disabled={busy || methodBlockers.length > 0 || (signingMethod === 'DIGITAL' && payersLoading)} aria-busy={Boolean(busy)} onClick={() => void run(prepare)}>
          {signingMethod === 'PAPER' ? canReview ? 'สร้างใบรับรองและไปพิมพ์' : 'สร้างใบรับรองให้ผู้ตรวจทำต่อ' : 'สร้างใบรับรองและไปเซ็น'}
        </button>
      </ActionGroup>)}
    </div>
  </MangmeeCard>;

  /** The way back from a signing screen sits in that screen's own button group, not on a row of its own. */
  const signBack = () => (
    <button type="button" className={ghostClass} disabled={busy} onClick={() => navigatePreparedStep('evidence')}>{t('expenses.substitute_wizard.back', locale)}</button>
  );
  const signActions = (action: ReactNode) => (
    actionBar(<div role="navigation" aria-label="การนำทางขั้นตอนเซ็น">
      <ActionGroup>
        {signBack()}
        {action}
      </ActionGroup>
    </div>)
  );

  // Whose turn it is, said once, with the one thing the reader can do about it: send the link.
  // The way back to the earlier steps is the stepper itself (its finished steps are pressable).
  const renderWaiting = (message: string) => (
    <div className="space-y-4">
      <Notice tone="warning" action={<button type="button" className={ghostClass} disabled={copying} aria-busy={copying} onClick={() => void copyWizardLink()}>{copied ? t('expenses.substitute_wizard.link_copied', locale) : `คัดลอกลิงก์ส่งให้${receiptEvidence?.status === 'PREPARED' ? receiptEvidence.payerName : policy?.approvalMode === 'OWNER_SELF' ? 'เจ้าของกิจการ' : 'ผู้อนุมัติที่ร้านกำหนด'}`}</button>}>
        {message}
      </Notice>
      {detail && <DetailSummary detail={detail} categories={categories} />}
      {renderReadOnlySummary()}
    </div>
  );

  const renderCertifyStep = () => {
    if (!receiptEvidence) return null;
    if (receiptEvidence.signatureMode === 'PAPER' && !receiptEvidence.payerUserId) return <SubstitutePaperSigningPanel key={receiptEvidence.id}
      companyId={companyId} evidence={receiptEvidence} canPrepare={canReview} canAccept={mayApprove && policy?.canApproveForCompany !== false}
      allowSamePerson={policy?.approvalMode === 'OWNER_SELF' && canSelfApprove} backAction={signBack()}
      onChange={(updated) => { setReceiptEvidence(updated); setActiveStep(resolveWizardStep(updated)); void getExpense(companyId, updated.expenseId).then(setDetail); }} />;
    if (viewOnly || receiptEvidence.payerUserId !== userId) {
      return renderWaiting(t('expenses.substitute_wizard.waiting_payer', locale).replace('{name}', receiptEvidence.payerName));
    }
    const signingReadiness = evaluateSigningReadiness({
      previewed: Boolean(previewChecksum),
      signatureReady: paperSignature || signatureSource !== 'none',
      acknowledged: certificationAcknowledged,
    });
    const certifyItems = [
      { label: t('expenses.substitute_wizard.preview_document', locale), complete: !signingReadiness.missing.includes('preview') },
      ...(paperSignature ? [] : [{ label: t('expenses.substitute_wizard.signature_title', locale), complete: !signingReadiness.missing.includes('signature') }]),
      { label: t('expenses.substitute_wizard.acknowledgement_short', locale), complete: !signingReadiness.missing.includes('acknowledgement') },
    ];
    const certifyBlockers = certifyItems.filter((item) => !item.complete).map((item) => item.label);
    return (
      <div className="space-y-4">
        {detail && <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} categories={categories} />}
        <div className="space-y-4">
          <div className="space-y-4">
            <MangmeeCard className="space-y-5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">{combinedSigning ? 'เซ็นและออกใบรับรอง' : t('expenses.substitute_wizard.certify_title', locale)}</h2>
                </div>
              </div>
              <div id="substitute-sign-preview" className="space-y-2">
                <button type="button" className={ghostClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(previewPrepared)}>
                  <span className="inline-flex items-center gap-2">{ICON.eye}{t('expenses.substitute_wizard.preview_document', locale)}</span>
                </button>
                {previewChecksum && <MangmeeBadge tone="brand">{t('expenses.substitute_wizard.reviewed_badge', locale)}</MangmeeBadge>}
                {signingAttempted && !previewChecksum && <p role="alert" className={errorLineClass}>{t('expenses.substitute_wizard.preview_required', locale)}</p>}
              </div>
              <div id="substitute-sign-signature">
                <p className="mb-3 text-sm font-semibold text-gray-700">{t('expenses.substitute_wizard.signature_title', locale)}{!paperSignature && <RequiredMark />}</p>
                {paperSignature
                  ? <p className="text-sm text-gray-600">{t('expenses.substitute_wizard.paper_signature_notice', locale)}</p>
                  : <SignatureFields key="certify" signatureFile={signatureFile} signaturePreview={signaturePreview} busy={busy} savedSignatureAvailable={policy?.hasReusableSignature ?? false} savedSignatureUsed={signatureSource === 'signature_library'} savedSignaturePreviewUrl={policy?.reusableSignaturePreviewUrl ?? null} onSelect={selectSignatureFile} onDrawChange={setSignatureDrawn} onClean={() => void run(buildTransparentSignature)} onDrawn={selectDrawnSignature} />}
                {signingAttempted && !paperSignature && signatureSource === 'none' && <p role="alert" className={errorLineClass}>เซ็นหรือเลือกไฟล์ลายเซ็นให้พร้อมก่อน</p>}
              </div>
              <label className="block text-sm font-semibold text-gray-700">
                <span className="mb-1 flex items-center gap-2">{t('expenses.substitute_wizard.payer_position', locale)}</span>
                <SubstituteSignerPositionField className={inputClass} value={signerPosition} jobTitle={policy?.signerJobTitle} onChange={(value) => { setSignerPosition(stripDisallowed(value)); setPreviewChecksum(null); setCertifiedPreviewed(false); }} />
                <span className="mt-1 block text-sm font-normal text-gray-500">{t('expenses.substitute_wizard.position_help', locale)}</span>
              </label>
              <div id="substitute-sign-acknowledgement"><ChoiceRow type="checkbox" framed required aria-required="true" aria-labelledby="substitute-certify-label" checked={certificationAcknowledged} onChange={(event) => setCertificationAcknowledged(event.target.checked)}
                label={<span id="substitute-certify-label">{combinedSigning ? 'รับรองว่าจ่ายจริงเพื่อร้านและใช้ใบเสร็จประกอบไม่ได้ ตรวจเอกสารและหลักฐานแล้ว และอนุมัติให้ออกใบรับรอง' : t('expenses.substitute_wizard.certify_acknowledgement', locale)}<RequiredMark /></span>} />
                {signingAttempted && !certificationAcknowledged && <p role="alert" className={errorLineClass}>{t('expenses.substitute_wizard.certification_ack_required', locale)}</p>}</div>
              <div className="space-y-3 border-t border-gray-100 pt-4">
                <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={certifyBlockers} />
                {signActions(<button type="button" className={btnClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(certify)}>{combinedSigning ? 'เซ็นและออกใบรับรอง' : t('expenses.substitute_wizard.certify_action', locale)}</button>)}
              </div>
            </MangmeeCard>
          </div>
        </div>
      </div>
    );
  };

  const renderApproveStep = () => {
    if (!receiptEvidence) return null;
    if (!mayApprove) return renderWaiting((policy?.approvalMode === 'OWNER_SELF' ? 'รอเจ้าของกิจการตรวจและออกใบรับรอง' : 'รอผู้อนุมัติที่ร้านกำหนดตรวจและออกใบรับรอง'));
    const approvalReadiness = evaluateSigningReadiness({
      previewed: certifiedPreviewed,
      signatureReady: paperSignature || signatureSource !== 'none',
      acknowledged: approvalAcknowledged,
    });
    const approveItems = [
      { label: t('expenses.substitute_wizard.open_certified', locale), complete: !approvalReadiness.missing.includes('preview') },
      ...(paperSignature ? [] : [{ label: t('expenses.substitute_wizard.signature_title', locale), complete: !approvalReadiness.missing.includes('signature') }]),
      { label: t('expenses.substitute_wizard.acknowledgement_short', locale), complete: !approvalReadiness.missing.includes('acknowledgement') },
    ];
    const approveBlockers = approveItems.filter((item) => !item.complete).map((item) => item.label);
    return (
      <div className="space-y-4">
        {detail && <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} categories={categories} />}
        <div className="space-y-4">
          <MangmeeCard className="space-y-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">{t('expenses.substitute_wizard.approve_title', locale)}</h2>
              </div>
            </div>
            <div id="substitute-sign-preview">
              <div className="flex flex-wrap items-center gap-3">
              <button type="button" className={ghostClass} disabled={busy || !receiptEvidence.certifiedArtifactAttachmentId} aria-busy={Boolean(busy)} onClick={() => void run(() => openArtifact(receiptEvidence.certifiedArtifactAttachmentId, true))}>
                <span className="inline-flex items-center gap-2">{ICON.eye}{t('expenses.substitute_wizard.open_certified', locale)}</span>
              </button>
              {certifiedPreviewed && <MangmeeBadge tone="brand">{t('expenses.substitute_wizard.reviewed_badge', locale)}</MangmeeBadge>}
              </div>
              {signingAttempted && !certifiedPreviewed && <p role="alert" className={errorLineClass}>{t('expenses.substitute_wizard.certified_preview_required', locale)}</p>}
              {!receiptEvidence.certifiedArtifactAttachmentId && (
                <p className="mt-2 text-sm text-warning-700">{t('expenses.substitute_wizard.document_not_ready', locale)}</p>
              )}
            </div>
            <div id="substitute-sign-signature">
              <p className="mb-3 text-sm font-semibold text-gray-700">{t('expenses.substitute_wizard.signature_title', locale)}{!paperSignature && <RequiredMark />}</p>
              {signatureCarried && !paperSignature && <p className="mb-2 text-sm text-gray-600">ใช้ลายเซ็นเดียวกับที่เพิ่งเซ็นรับรอง</p>}
              {paperSignature
                ? <p className="text-sm text-gray-600">{t('expenses.substitute_wizard.paper_signature_notice', locale)}</p>
                : <SignatureFields key="approve" signatureFile={signatureFile} signaturePreview={signaturePreview} busy={busy} savedSignatureAvailable={policy?.hasReusableSignature ?? false} savedSignatureUsed={signatureSource === 'signature_library'} savedSignaturePreviewUrl={policy?.reusableSignaturePreviewUrl ?? null} onSelect={selectSignatureFile} onDrawChange={setSignatureDrawn} onClean={() => void run(buildTransparentSignature)} onDrawn={selectDrawnSignature} />}
                {signingAttempted && !paperSignature && signatureSource === 'none' && <p role="alert" className={errorLineClass}>เซ็นหรือเลือกไฟล์ลายเซ็นให้พร้อมก่อน</p>}
            </div>
            <label className="block text-sm font-semibold text-gray-700">
              <span className="mb-1 flex items-center gap-2">{t('expenses.substitute_wizard.approver_position', locale)}</span>
              {/* Same rule as the payer step: editing the position invalidates the reviewed badge. */}
              <SubstituteSignerPositionField className={inputClass} value={signerPosition} jobTitle={policy?.signerJobTitle} onChange={(value) => { setSignerPosition(stripDisallowed(value)); setPreviewChecksum(null); setCertifiedPreviewed(false); }} />
              <span className="mt-1 block text-sm font-normal text-gray-500">{t('expenses.substitute_wizard.position_help', locale)}</span>
            </label>
            <div id="substitute-sign-acknowledgement"><ChoiceRow type="checkbox" framed required aria-required="true" aria-label={t('expenses.substitute_wizard.approve_acknowledgement', locale)} checked={approvalAcknowledged} onChange={(event) => setApprovalAcknowledged(event.target.checked)}
              label={<>{t('expenses.substitute_wizard.approve_acknowledgement', locale)}<RequiredMark /></>} />
                {signingAttempted && !approvalAcknowledged && <p role="alert" className={errorLineClass}>{t('expenses.substitute_wizard.approval_ack_required', locale)}</p>}</div>
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={approveBlockers} />
              {signActions(<button type="button" className={btnClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void run(approve)}>{t('expenses.substitute_wizard.approve_action', locale)}</button>)}
            </div>
          </MangmeeCard>
        </div>
      </div>
    );
  };

  const expenseHref = detail ? `/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}` : '';
  const canCorrectNames = canReview && receiptEvidence?.status === 'ISSUED' && detail?.status !== 'VOIDED';
  const canCancelHere = Boolean(canReview && receiptEvidence && detail && receiptEvidence.status !== 'SUPERSEDED' && (['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status) || Boolean(receiptEvidence.correctionOfEvidenceId && receiptEvidence.status !== 'ISSUED')));
  const expenseAwaitsConfirmation = Boolean(detail && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status));

  // A cancelled certificate is not a success: no tick, no "done" title, no next steps of an issued
  // one. It says it was cancelled and why, and offers the one thing people come here for next.
  const renderCancelledCertificate = () => {
    if (!receiptEvidence || !detail) return null;
    const current = detail.substituteReceiptEvidence;
    const liveSuccessor = current && current.id !== receiptEvidence.id && current.status !== 'SUPERSEDED' ? current : null;
    return (
      <MangmeeCard className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-lg font-bold text-gray-500">✕</span>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">{t('expenses.substitute_hub.status_superseded', locale)}</h2>
            {receiptEvidence.supersedeReason && <p className="mt-1 text-sm text-gray-600">เหตุผล: {receiptEvidence.supersedeReason}</p>}
          </div>
        </div>
        <ActionGroup align="start">
          <Link className={ghostClass} href={expenseHref}>{t('expenses.substitute_wizard.view_expense', locale)}</Link>
          {liveSuccessor
            ? <Link className={btnClass} href={`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(liveSuccessor.id)}`}>เปิดใบรับรองฉบับปัจจุบัน</Link>
            : permissions.includes('expense.review') && expenseAwaitsConfirmation && (
              <Link className={btnClass} href={`/companies/${companyId}/expenses/substitute-receipts/new?expenseId=${encodeURIComponent(detail.id)}`}>สร้างใบรับรองใหม่จากค่าใช้จ่ายนี้</Link>
            )}
        </ActionGroup>
      </MangmeeCard>
    );
  };

  const renderIssuedCertificate = () => {
    if (!receiptEvidence || !detail) return null;
    const personalAdvance = receiptEvidence.fundingSource === 'PERSONAL_ADVANCE';
    // Download is the header action; the expense and claim remain the next steps below.
    const nextIsConfirm = !personalAdvance && expenseAwaitsConfirmation;
    return (
      <div className="space-y-4">
        {nextIsConfirm && (
          <Notice tone="success" action={<Link className={ghostClass} href={expenseHref}>{t('expenses.substitute_wizard.back_to_expense', locale)}</Link>}>
            {t('expenses.substitute_wizard.done_next_confirm', locale)}
          </Notice>
        )}
        {(!receiptEvidence.artifactAttachmentId || personalAdvance) && <MangmeeCard className="space-y-4 p-5">
          {!receiptEvidence.artifactAttachmentId && <Notice tone="warning">{t('expenses.substitute_wizard.document_not_ready', locale)}</Notice>}
          {personalAdvance && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
              <p className="min-w-0 flex-1 text-sm text-gray-700">{canClaimReimbursement
                ? receiptEvidence.payerUserId === userId
                  ? 'ใบรับรองระบุว่าคุณจ่ายเต็มจำนวนด้วยเงินส่วนตัว ทำใบเบิกต่อได้เลย ยอดและใบรับรองจะติดไปด้วย'
                  : `ใบรับรองระบุว่า ${receiptEvidence.payerName} จ่ายเต็มจำนวนด้วยเงินส่วนตัว ทำใบเบิกให้ผู้จ่ายได้ ยอดและใบรับรองจะติดไปด้วย`
                : 'ใบรับรองระบุว่าพนักงานจ่ายเต็มจำนวนแล้ว การออกใบรับรองยังไม่ถือว่าร้านจ่ายคืนให้พนักงาน'}</p>
              {canClaimReimbursement && (
                <Link className={ghostClass} href={`/companies/${companyId}/reimbursements/new?expenseId=${encodeURIComponent(detail.id)}&requesterUserId=${encodeURIComponent(receiptEvidence.payerUserId!)}`}>
                  สร้างใบเบิกจากใบนี้
                </Link>
              )}
            </div>
          )}

        </MangmeeCard>}
      </div>
    );
  };

  const renderDoneStep = () => (receiptEvidence?.status === 'ISSUED' ? renderIssuedCertificate() : renderCancelledCertificate());

  // A prepared/certified version may also need correction before anyone can safely sign it.
  // Keep the existing permission, source-state and reason guards on every wizard stage.
  const renderVersionHistory = () => {
    if (!receiptEvidence || !detail) return null;
    return (
      <div className="space-y-3">
        <details ref={versionHistoryRef} className="rounded-2xl border border-gray-200 bg-white p-4">
          <summary className="cursor-pointer font-bold text-gray-900">{t('expenses.substitute_wizard.history_title', locale)}</summary>
          <ul className="mt-4 space-y-2 text-sm text-gray-600">
            {history.map((item) => (
              <li key={item.id} className="rounded-lg bg-gray-50 px-3 py-2">
                {t('expenses.substitute_wizard.version', locale).replace('{version}', String(item.version))} · <span className="mangmee-unit">{item.documentNumber}</span> · {t(item.status === 'ISSUED' ? 'expenses.substitute_hub.status_issued' : item.status === 'SUPERSEDED' ? 'expenses.substitute_hub.status_superseded' : item.status === 'PAYER_CERTIFIED' ? 'expenses.substitute_hub.status_payer_certified' : 'expenses.substitute_hub.status_prepared', locale)}
                {item.supersedeReason ? ` · ${item.supersedeReason}` : ''}
              </li>
            ))}
          </ul>
        </details>
        {canReview && receiptEvidence.status !== 'SUPERSEDED' && !canCancelHere && (
          <p className="text-sm text-gray-500">ยกเลิกใบนี้จากหน้านี้ไม่ได้ เปิดค่าใช้จ่ายเพื่อดูรายการจ่ายหรือใบเบิกที่ต้องจัดการก่อน</p>
        )}
      </div>
    );
  };

  const canEditPrepared = Boolean(canReview && detail && receiptEvidence && canEditSubstituteReceipt(detail, receiptEvidence));
  const preparedFactsNeedReview = Boolean(detail && receiptEvidence && !receiptEvidence.correctionOfEvidenceId
    && ['PREPARED', 'PAYER_CERTIFIED'].includes(receiptEvidence.status)
    && (!receiptEvidence.payeeName?.trim() || !receiptEvidence.businessPurpose.trim() || !receiptEvidence.missingReceiptReason.trim()
      || !receiptEvidence.paymentDate || !receiptEvidence.paymentMethod
      || (receiptEvidence.fundingSource === 'COMPANY' && Number(detail.paidAmount) > 0 && (
        (detail.paidAt && coerceCivilDate(detail.paidAt) !== (receiptEvidence.paymentDate ? coerceCivilDate(receiptEvidence.paymentDate) : null))
        || (detail.paymentMethod && detail.paymentMethod !== receiptEvidence.paymentMethod)))));
  const changePaymentDate = async (nextDate: string) => {
    if (editingPrepared && receiptEvidence && paymentMonthChanged(paymentDate || coerceCivilDate(receiptEvidence.paymentDate ?? ''), nextDate)) {
      const accepted = await confirm({
        title: 'เปลี่ยนวันที่จ่ายข้ามเดือน',
        message: <><span className="block">วันที่จ่ายเงิน: <strong>{dateShort(paymentDate || receiptEvidence.paymentDate)} → {dateShort(nextDate)}</strong></span><span className="mt-2 block">เลขเอกสารคงเดิม: <strong>{receiptEvidence.documentNumber}</strong></span></>,
        confirmLabel: 'เปลี่ยนวันที่จ่าย', cancelLabel: 'ไม่เปลี่ยน', variant: 'primary',
      });
      if (!accepted) return;
      setConfirmedPaymentMonth(nextDate.slice(0, 7));
    }
    setPaymentDate(nextDate);
  };
  const reviewingPreparedStep = Boolean(receiptEvidence && ['expense', 'details', 'evidence'].includes(activeStep));
  const factsDisabled = viewOnly || Boolean(receiptEvidence && !canEditPrepared) || !canPrepare;
  const navigatePreparedStep = (step: WizardStep) => {
    if (busy) return;
    if (canEditPrepared && ['expense', 'details', 'evidence'].includes(step)) setEditingPrepared(true);
    setActiveStep(step === 'evidence' ? 'details' : step);
    setError(null);
  };
  const returnToSigning = () => {
    if (!receiptEvidence) return;
    if (editingPrepared && canEditPrepared) { void run(prepare); return; }
    setEditingPrepared(false);
    setActiveStep(resolveWizardStep(receiptEvidence));
  };
  const refreshAfterSourceSave = async () => {
    if (!detail || !receiptEvidence) return;
    const [fresh, rows] = await Promise.all([getExpense(companyId, detail.id), listSubstituteReceiptHistory(companyId, detail.id)]);
    const previous = rows.find((row) => row.id === receiptEvidence.id);
    const current = previous ? currentSubstituteRevision(rows, previous) : undefined;
    if (!current) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    // A later source save wins for shared facts; retain unsaved certificate-only edits.
    if (current.businessPurpose !== receiptEvidence.businessPurpose) setBusinessPurpose(current.businessPurpose);
    if (current.missingReceiptReason !== receiptEvidence.missingReceiptReason) setMissingReason(current.missingReceiptReason);
    setDetail(fresh); setHistory(rows); setReceiptEvidence(current);
    if (current.updatedAt !== receiptEvidence.updatedAt) {
      resetSignature(); setCertificationAcknowledged(false); setApprovalAcknowledged(false); closePreview();
    }
    if (current.status === 'SUPERSEDED') { setEditingPrepared(false); setActiveStep('done'); }
  };
  const continuePreparedSource = async () => {
    if (factsDisabled) { navigatePreparedStep('details'); return; }
    if (!sourceSaveRef.current || !await sourceSaveRef.current()) return;
    navigatePreparedStep('details');
  };
  let content: ReactNode = null;
  if (receiptEvidence && activeStep === 'expense' && detail) content = <ExpenseReviewEditSection
    key={`${detail.id}-${detail.updatedAt}`} companyId={companyId} detail={detail} permissions={permissions}
    isMutable={canEditPrepared && !busy} canReview={canReview} canConfirm={false}
    skipUnchangedSave saveRef={sourceSaveRef} onSaved={refreshAfterSourceSave} />;
  else if (receiptEvidence && (activeStep === 'details' || activeStep === 'evidence')) content = <div className="space-y-4">
    {renderDetailsStep(false)}
    {renderEvidenceStep(false)}
  </div>;
  else if (isCancelled) content = renderDoneStep();
  else if (activeStep === 'expense') content = renderExpenseStep();
  else if (activeStep === 'details') content = renderDetailsStep();
  else if (activeStep === 'evidence') content = renderEvidenceStep();
  else if (activeStep === 'method') content = renderMethodStep();
  else if (activeStep === 'certify') content = renderCertifyStep();
  else if (activeStep === 'approve') content = renderApproveStep();
  else content = renderDoneStep();

  // Making a certificate needs the right to review expenses. Without it there is nothing to do on this
  // page: say so, with the way back, instead of a whole form that refuses in the middle.
  if (!evidenceId && !canStart) {
    return (
      <ForbiddenState
        titleAs="h1"
        title="คุณยังสร้างใบรับรองแทนใบเสร็จเองไม่ได้"
        description={`ให้${THAI_SYSTEM_ROLE_NAMES.OWNER}หรือคนที่ตรวจค่าใช้จ่ายสร้างให้`}
        helpText=""
        action={<Link className={ghostClass} href={`/companies/${companyId}/expenses/substitute-receipts`}>{t('expenses.substitute_wizard.back_hub', locale)}</Link>}
      />
    );
  }

  // A certificate that could not be opened (not found, or not this person's to see): say so under its
  // own page with the way back, never the "create" screens.
  if (evidenceId && !loading && !receiptEvidence) {
    return (
      <MangmeePage
        back={<Link className={cx(ghostClass, 'min-h-9')} href={`/companies/${companyId}/expenses/substitute-receipts`}>กลับไปรายการ</Link>}
        title={t('expenses.substitute_hub.title', locale)}
      >
        <Notice tone="error" action={<button type="button" className={ghostClass} onClick={() => window.location.reload()}>ลองอีกครั้ง</button>}>{error ?? t('expenses.substitute_wizard.evidence_not_found', locale)}</Notice>
      </MangmeePage>
    );
  }

  return (
    <>
      <MangmeePage
        back={<Link className={cx(ghostClass, 'min-h-9')} href={`/companies/${companyId}/expenses/substitute-receipts`}>กลับไปรายการ</Link>}
        title={receiptEvidence ? <>ใบรับรองแทนใบเสร็จ <span className="mangmee-unit">{receiptEvidence.documentNumber}</span></> : t('expenses.substitute_wizard.title', locale)}
        className="mangmee-flat"
        meta={receiptEvidence && <MangmeeBadge tone={receiptEvidence.status === 'ISSUED' ? 'brand' : receiptEvidence.status === 'SUPERSEDED' ? 'slate' : 'amber'}>{t(receiptEvidence.status === 'ISSUED' ? 'expenses.substitute_hub.status_issued' : receiptEvidence.status === 'SUPERSEDED' ? 'expenses.substitute_hub.status_superseded' : receiptEvidence.status === 'PAYER_CERTIFIED' ? 'expenses.substitute_hub.status_payer_certified' : 'expenses.substitute_hub.status_prepared', locale)}</MangmeeBadge>}
        actions={receiptEvidence && detail && <ActionGroup>
          <MoreActions label="เพิ่มเติม" align="end" closeOnPress busy={busy}>
            {receiptEvidence.status === 'ISSUED' && receiptEvidence.artifactAttachmentId && <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => void run(openIssuedPdf)}>เปิดดูเอกสาร</button>}
            <Link className={ghostClass} href={expenseHref}>เปิดค่าใช้จ่าย</Link>
            {canCorrectNames && <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => { setCorrectionError(null); setCorrectionOpen(true); }}>แก้ชื่อร้านหรือตำแหน่งผู้เซ็น</button>}
            {canCancelHere && <button type="button" className={dangerClass} disabled={busy} aria-busy={busy} onClick={() => { setCancelError(null); setCancelOpen(true); }}>ยกเลิกใบรับรองนี้</button>}
          </MoreActions>
          {receiptEvidence.status === 'ISSUED' && receiptEvidence.artifactAttachmentId && <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={() => void run(() => downloadSubstituteReceiptPdf(companyId, detail.id, receiptEvidence.id, receiptEvidence.documentNumber))}>ดาวน์โหลด PDF</button>}
        </ActionGroup>}
      >
        {loading ? (
          <LoadingState label={t('expenses.loading', locale)} />
        ) : (
          <div className="space-y-4">
            {!errorPlaced && errorNotice}
            {info && activeStep !== 'done' && <InfoBanner message={info} />}
            {preparedFactsNeedReview && !editingPrepared && (
              <Notice tone="warning" action={canEditPrepared
                ? <button type="button" className={ghostClass} onClick={() => navigatePreparedStep('details')}>กรอกให้ครบ</button>
                : undefined}>
                {canEditPrepared
                  ? 'ข้อมูลใบรับรองยังไม่ครบ กรอกให้ครบก่อนเซ็น ไม่ต้องยกเลิกใบ'
                  : 'ข้อมูลใบรับรองไม่ครบหรือไม่ตรงกับการจ่ายที่บันทึกไว้ ให้คนที่ตรวจค่าใช้จ่ายได้แก้ใบนี้'}
              </Notice>
            )}
            {linePrefill && <InfoBanner message={locale === 'th'
              ? `โหลดข้อมูลที่ยืนยันผ่าน LINE แล้ว ${prefilledFieldCount} ช่อง${linePrefill.acceptedValues.itemDescription || linePrefill.acceptedValues.amount || linePrefill.acceptedValues.expenseCategoryId ? ' · รายการ ยอด และหมวดเป็นข้อมูลเสนอ ต้องตรวจและแก้รายการค่าใช้จ่ายในเว็บก่อน' : ''}`
              : `Loaded ${prefilledFieldCount} accepted LINE fields${linePrefill.acceptedValues.itemDescription || linePrefill.acceptedValues.amount || linePrefill.acceptedValues.expenseCategoryId ? '; review proposed item, amount, and category values against the expense before preparing' : ''}`} />}
            <div>
              <ThemedSteps
                aria-label={t('expenses.substitute_wizard.journey_label', locale)}
                steps={JOURNEY_STAGES.map((stage, index) => ({
                  key: stage,
                  label: t(JOURNEY_STAGE_KEYS[stage], locale),
                  // A cancelled certificate did not reach "done": its last step stays grey.
                  state: isCancelled && stage === 'done' ? 'upcoming' : index === activeJourneyIndex ? 'current' : index < activeJourneyIndex ? 'done' : 'upcoming',
                  ...(receiptEvidence && stage !== 'done' ? {
                    onSelect: () => stage === 'sign' ? returnToSigning() : navigatePreparedStep(stage === 'expense' ? 'expense' : 'details'),
                    disabled: busy || (editingPrepared && reviewingPreparedStep),
                  } : {}),
                }))}
              />
              {/* On a signing screen the screen itself says whose turn it is. */}
              {turnLabel && activeJourneyStage !== 'sign' && (
                <p className={cx('mt-2 text-center text-sm font-semibold', turn?.mine ? 'text-brand-700' : 'text-warning-700')}>
                  {t('expenses.substitute_wizard.turn_label', locale)}: {turnLabel}
                </p>
              )}
            </div>
            {reviewingPreparedStep && <p className="text-sm text-gray-600">
              {factsDisabled ? (isCancelled ? 'ใบนี้ยกเลิกแล้ว ดูได้อย่างเดียว' : 'ดูได้อย่างเดียว แก้ไขไม่ได้')
                : 'แก้แล้วกด “ถัดไป” เพื่อบันทึก เลขที่ใบคงเดิม ถ้าแก้ข้อมูลที่เซ็นแล้ว ต้องเซ็นใหม่'}
            </p>}
            {receiptEvidence && detail && <MangmeeCard className="space-y-5 p-4 sm:p-5">
              <MetricGrid items={[{ key: 'amount', label: 'จำนวนเงิน', value: amountText(detail.grandTotalAmount), unit: 'บาท', dot: 'bg-brand-500' }]} />
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-gray-500">ผู้รับเงิน</dt><dd className="break-words font-semibold">{receiptEvidence.payeeName || t('expenses.substitute_hub.payee_missing', locale)}</dd></div>
                <div><dt className="text-gray-500">วันที่จ่าย</dt><dd className="mangmee-unit font-semibold">{dateShort(receiptEvidence.paymentDate)}</dd></div>
                <div><dt className="text-gray-500">จ่ายจาก</dt><dd className="font-semibold">{receiptEvidence.fundingSource === 'PERSONAL_ADVANCE' ? 'พนักงานสำรองจ่าย' : receiptEvidence.fundingSource === 'COMPANY' ? 'เงินของร้าน' : 'ยังไม่ระบุ'}</dd></div>
                <div><dt className="text-gray-500">ค่าใช้จ่าย</dt><dd><Link className="text-brand-700 underline underline-offset-2" href={expenseHref}>{detail.expenseNumber}</Link></dd></div>
              </dl>
            </MangmeeCard>}
            <div className={wizardActions ? 'pb-8' : undefined}>{content}</div>
            {reviewingPreparedStep && (
              <div className="space-y-2">
              {!factsDisabled && activeStep !== 'expense' && <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={[...detailsStepBlockers, ...evidenceStepBlockers]} />}
              {actionBar(<div role="navigation" aria-label="การนำทางข้อมูลใบรับรอง">
                <ActionGroup>
                {activeStep !== 'expense' && <button type="button" className={ghostClass} disabled={busy} onClick={() => navigatePreparedStep('expense')}>{t('expenses.substitute_wizard.back', locale)}</button>}
                <button type="button" className={btnClass} disabled={busy || (!factsDisabled && activeStep !== 'expense' && (detailsStepBlockers.length > 0 || evidenceStepBlockers.length > 0))} aria-busy={Boolean(busy)}
                  onClick={() => activeStep === 'expense' ? void run(continuePreparedSource) : returnToSigning()}>{t('expenses.substitute_wizard.continue', locale)}</button>
                </ActionGroup>
              </div>)}
              </div>
            )}
            {!editingPrepared && renderVersionHistory()}
          </div>
        )}
        {wizardActions && <FormActionBar><div role="navigation" aria-label="การนำทางใบรับรอง">{wizardActions}</div></FormActionBar>}
      </MangmeePage>
      {paperArtifactPreview && receiptEvidence && <SubstitutePaperDocumentPreview
        key={paperArtifactPreview.previewChecksumSha256} documentNumber={receiptEvidence.documentNumber}
        preview={paperArtifactPreview} onClose={closePreview} />}
      {receiptEvidence && <SubstituteReceiptCancelDialog open={cancelOpen} documentNumber={receiptEvidence.documentNumber} busy={busy} error={cancelError}
        onClose={() => { setCancelOpen(false); setCancelError(null); }} onConfirm={(reason) => void confirmCancelCertificate(reason)} />}
      {receiptEvidence && (
        <Modal open={correctionOpen} title={`แก้ชื่อร้านหรือตำแหน่งผู้เซ็น ${receiptEvidence.documentNumber}`} size="sm" dirty={supersedeReason.trim() !== '' && !busy}
          onClose={() => { if (!busy) { setCorrectionOpen(false); setCorrectionError(null); setSupersedeReason(''); } }}
          footer={<>
            <button type="button" className={ghostClass} disabled={busy} onClick={() => { setCorrectionOpen(false); setCorrectionError(null); setSupersedeReason(''); }}>ไม่แก้</button>
            <button type="button" className={btnClass} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void correctNames()}>แก้และเซ็นใหม่</button>
          </>}>
          <p className="mb-4 text-sm text-gray-600">ยอดจ่ายและการจ่ายที่บันทึกไว้คงเดิม ผู้เซ็นเดิมต้องอ่านและเซ็นใบที่แก้อีกครั้ง</p>
          {correctionError && <div className="mb-3"><ErrorBanner message={correctionError} /></div>}
          <label className="block text-sm font-semibold text-gray-700">เหตุผลที่แก้ <span className="text-error-700" aria-hidden="true">*</span>
            <textarea className={cx(inputClass, 'mt-2')} rows={3} maxLength={500} value={supersedeReason} onChange={(event) => setSupersedeReason(stripDisallowed(event.target.value))} />
          </label>
        </Modal>
      )}
      {confirmDialog}
      {preview && <DocumentPreviewModal
        source={preview}
        closeLabel={t('expenses.close', locale)}
        loadingLabel={t('expenses.loading', locale)}
        errorLabel={t('expenses.substitute_wizard.document_not_ready', locale)}
        retryLabel={t('expenses.substitute_wizard.retry', locale)}
        openNewTabLabel={t('expenses.open_new_tab', locale)}
        onClose={closePreview}
        onViewed={preview.onViewed}
      />}
    </>
  );
}
