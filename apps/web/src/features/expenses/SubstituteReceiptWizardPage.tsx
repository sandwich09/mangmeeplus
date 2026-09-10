'use client';

import Link from 'next/link';
import { SubstitutePaperDocumentPreview, SubstitutePaperSigningPanel } from './SubstitutePaperSigningPanel';
import { SubstituteSignerPositionField } from './SubstituteSignerPositionField';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS,
  coerceCivilDate,
  isCheckBillClassification,
  substituteReceiptRequiresPaymentEvidence,
  type ExpensePaymentMethod,
  type LineSubstituteReceiptPrefill,
  type SubstituteReceiptEvidenceSummary,
  type SubstituteReceiptPaperPreview,
  type SubstituteReceiptReasonCode,
  type SubstituteReceiptRuntimePolicy,
} from '@watchdog-bms/contracts';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { LoadingState } from '@/common/components/state';
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
  downloadSubstituteReceiptFormPdf,
  downloadSubstituteReceiptPdf,
  fetchAttachmentPreviewBlob,
  fetchSubstituteReceiptPdfBlob,
  generateSubstituteReceipt,
  amendSubstituteReceipt,
  getExpense,
  getSubstituteReceiptRuntimePolicy,
  initPersonalSignatureUpload,
  listCompanySubstituteReceipts,
  listExpenseCategories,
  listExpenses,
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
  expenseNeedsReceiptOrSubstitute,
  findOpaqueBounds,
  removeLightBackground,
} from './expenses.model';
import type { ExpenseCategorySummary, ExpenseDetail, ExpenseSummary } from './expenses.model';
import { reviewValues } from './ExpensesPages';
import {
  baht,
  btnClass,
  dateShort,
  err,
  ErrorBanner,
  ghostClass,
  ICON,
  InfoBanner,
  inputClass,
} from './ExpensesUi';
import { ATTACHMENT_UPLOAD_ACCEPT, IMAGE_UPLOAD_ACCEPT, assertAllowedUploadFile } from '@/common/files/upload-file.logic';
import { findForbiddenChars, normalizeDecimalInput, stripDisallowed } from '@/common/forms/sanitize';
import {
  clearSubstituteWizardDraft,
  defaultSubstituteReceiptReason,
  evaluateDetailsReadiness,
  evaluateEvidenceReadiness,
  evaluateExpensePrerequisites,
  evaluateManualLinesReadiness,
  evaluateSigningReadiness,
  isSubstituteReceiptCandidateEligible,
  isSubstituteReceiptCandidateOtherwiseEligible,
  isManualLineDecimal,
  manualLineAmount,
  manualLinesTotal,
  MAX_SUBSTITUTE_MANUAL_LINES,
  mayApproveSubstituteReceipt,
  payeeTaxIdDigits,
  payerWrittenMissingReason,
  readSubstituteWizardDraft,
  resolveSubstituteTurn,
  resolveWizardEntryMode,
  resolveWizardSignatureSource,
  resolveWizardStep,
  sortAndPageCandidates,
  substituteReceiptEvidenceRenderabilityIssue,
  substituteReceiptRenderabilityIssue,
  validatePayeeIdentity,
  wizardJourneyStage,
  currentSubstituteRevision,
  writeSubstituteWizardDraft,
  type CandidateSortKey,
  type ExpensePrerequisiteIssue,
  type PayeeIdentityIssue,
  type SubstituteReceiptEvidenceRenderabilityIssue,
  type SubstituteManualLineDraft,
  type SubstituteReceiptRenderabilityIssue,
  type SubstituteWizardDraftStep,
  type WizardEntryMode,
  type WizardJourneyStage,
  type WizardStep,
} from './substitute-receipt-wizard.model';
import { SignaturePad } from './SignaturePad';
import { SignatureThumb } from './ExpensesWorkspacePanels';

const PAGE_SIZE = 200;
/** Hard ceiling on per-expense detail requests fired by one candidate scan. */
const MAX_CANDIDATE_DETAIL_LOOKUPS = 60;
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
const todayIso = () => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
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
function BlockedReason({ labels, prefix }: { labels: string[]; prefix: string }) {
  if (labels.length === 0) return null;
  return (
    <p className="text-xs font-medium leading-5 text-gray-500 sm:text-right">
      <span className="font-bold text-warning-700">{prefix}</span> {labels.join(' · ')}
    </p>
  );
}

function RequiredLegend({ label }: { label: string }) {
  return (
    <p className="text-xs font-medium text-gray-500">
      <span className="mr-1 font-extrabold text-error-700" aria-hidden="true">*</span>{label}
    </p>
  );
}

function ReadinessCard({
  title,
  description,
  completeLabel,
  incompleteLabel,
  items,
}: {
  title: ReactNode;
  description: ReactNode;
  completeLabel: string;
  incompleteLabel: (count: number) => string;
  items: Array<{ label: ReactNode; complete: boolean }>;
}) {
  const completed = items.filter((item) => item.complete).length;
  const missing = items.length - completed;
  const progress = items.length === 0 ? 0 : Math.round((completed / items.length) * 100);
  return (
    <MangmeeCard className="overflow-hidden border-brand-100 p-0 xl:sticky xl:top-4">
      <div className="border-b border-brand-100 bg-brand-25 p-4">
        <div className="flex items-center gap-2 font-bold text-gray-900">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm">{ICON.sparkle}</span>
          {title}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-gray-600">{description}</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
          <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className={cx('mt-2 text-xs font-bold', missing === 0 ? 'text-brand-700' : 'text-gray-600')}>
          {missing === 0 ? completeLabel : incompleteLabel(missing)}
        </p>
      </div>
      <ul className="space-y-1 p-3">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 rounded-xl px-2 py-2 text-sm">
            <span className={cx(
              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-extrabold',
              item.complete ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-400',
            )}>{item.complete ? '✓' : '·'}</span>
            <span className={item.complete ? 'font-medium text-gray-800' : 'text-gray-500'}>{item.label}</span>
          </li>
        ))}
      </ul>
    </MangmeeCard>
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

/** Statuses `validateEligibility` accepts server-side. Filtering summaries by these first is what keeps
 *  the candidate scan from fanning out one detail request per expense in the whole company. */
const SUBSTITUTE_ELIGIBLE_STATUSES: ReadonlySet<ExpenseSummary['status']> = new Set([
  'DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION',
]);

/** Candidate scan for step 1. Deliberately bounded: the list endpoint has no "needs a receipt" filter and
 *  the summary omits attachments, so deciding needs one detail call each. We look at the most recent page,
 *  keep only server-eligible statuses, and cap the detail fan-out — an older expense is reached by opening
 *  it from รายการค่าใช้จ่าย, which deep-links back into this wizard. */
async function listCandidateExpenses(companyId: string, branchId?: string): Promise<{
  details: ExpenseDetail[];
  scanned: number;
  truncated: boolean;
}> {
  const result = await listExpenses(companyId, {
    ...(branchId ? { branchId } : {}),
    page: 1,
    pageSize: PAGE_SIZE,
  });
  const eligible = result.data.filter((item) => SUBSTITUTE_ELIGIBLE_STATUSES.has(item.status));
  const inspected = eligible.slice(0, MAX_CANDIDATE_DETAIL_LOOKUPS);
  const rows = await Promise.allSettled(inspected.map((item) => getExpense(companyId, item.id)));
  return {
    details: rows.flatMap((row) => row.status === 'fulfilled' ? [row.value] : []),
    scanned: result.data.length,
    truncated: result.total > result.data.length || eligible.length > inspected.length,
  };
}

async function findEvidenceExpenseId(companyId: string, evidenceId: string): Promise<string | null> {
  let page = 1;
  let total = 0;
  do {
    const result = await listCompanySubstituteReceipts(companyId, { page, pageSize: PAGE_SIZE });
    total = result.total;
    const match = result.items.find((item) => item.evidenceId === evidenceId);
    if (match) return match.expenseId;
    page += 1;
  } while ((page - 1) * PAGE_SIZE < total);
  return null;
}

function DetailSummary({ detail, title, categories = [] }: { detail: ExpenseDetail; title: ReactNode; categories?: ExpenseCategorySummary[] }) {
  const locale = useWorkspaceLocale();
  const renderabilityIssue = substituteReceiptRenderabilityIssue(detail);
  const categoryName = (categoryId: string | null) => categories.find((category) => category.id === categoryId)?.name
    ?? (categoryId ? t('expenses.substitute_wizard.category_recorded', locale) : t('expenses.substitute_wizard.not_specified', locale));
  return (
    <MangmeeCard className="border-brand-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-gray-900">{title}</div>
        <MangmeeBadge tone="brand">{detail.expenseNumber}</MangmeeBadge>
      </div>
      <div className="mt-3 grid gap-3 rounded-xl bg-gray-50 p-3 text-sm text-gray-600 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <div className="min-w-0">
          <div className="font-semibold text-gray-800">{detail.vendorNameSnapshot || detail.lines[0]?.description || t('expenses.substitute_wizard.not_specified', locale)}</div>
          <div className="mt-0.5 text-xs text-gray-500">{t('expenses.substitute_wizard.item_count', locale).replace('{count}', String(detail.lines.length))}</div>
        </div>
        <div>{dateShort(detail.expenseDate)}</div>
        <div className="text-lg font-extrabold tabular-nums text-gray-900 sm:text-right">{baht(detail.grandTotalAmount)}</div>
      </div>
      <details className="mt-2 rounded-xl border border-gray-100 bg-white" open>
          <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            {t('expenses.substitute_wizard.view_all_items', locale).replace('{count}', String(detail.lines.length))}
          </summary>
          <ol className="divide-y divide-gray-100 border-t border-gray-100 px-3">
            {detail.lines.map((line) => (
              <li key={line.id} className="grid gap-1 py-2 text-xs text-gray-600 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(7rem,auto)_auto_auto] sm:items-center sm:gap-3">
                <span className="font-bold text-gray-400">#{line.lineNumber}</span>
                <span className="min-w-0 font-medium text-gray-800">{line.description}</span>
                <span className="text-gray-500">{categoryName(line.expenseCategoryId)}</span>
                <span>{t('expenses.substitute_wizard.line_calculation', locale)
                  .replace('{quantity}', line.quantity)
                  .replace('{unitPrice}', baht(line.unitPrice))}</span>
                <span className="font-bold tabular-nums text-gray-900">{baht(line.lineTotalAmount)}</span>
              </li>
            ))}
          </ol>
      </details>
      {renderabilityIssue && (
        <p className="mt-2 rounded-xl border border-warning-100 bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-700">
          {renderabilityIssueMessage(renderabilityIssue, locale)}
        </p>
      )}
    </MangmeeCard>
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
          {t('expenses.substitute_wizard.signature_method', locale)}{!savedSignatureUsed && <RequiredMark />}
        </legend>
        <div className="grid rounded-xl bg-gray-100 p-1 sm:grid-cols-2">
          {(['draw', 'upload'] as const).map((option) => (
            <label key={option} className={cx(
              'cursor-pointer rounded-lg px-3 py-2 text-center text-sm font-semibold transition focus-within:ring-2 focus-within:ring-brand-500',
              method === option ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600',
            )}>
              <input
                className="sr-only"
                type="radio"
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
        <SignaturePad busy={busy} onChange={(hasStrokes) => { onSelect(null); onDrawChange(hasStrokes); }} onConfirm={onDrawn} />
      ) : (
        <>
          <div className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.signature_file', locale)}{!savedSignatureUsed && <RequiredMark />}</span>
            <ThemedFile file={signatureFile} aria-required={!savedSignatureUsed} accept={IMAGE_UPLOAD_ACCEPT} aria-label={t('expenses.substitute_wizard.signature_file', locale)} onChange={onSelect} />
          </div>
          <button type="button" className={ghostClass} disabled={busy || !signatureFile} onClick={onClean}>
            {t('expenses.substitute_wizard.clean_signature', locale)}
          </button>
        </>
      )}
      {signaturePreview && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-gray-500">{t('expenses.substitute_wizard.signature_original', locale)}</p>
            <img src={signaturePreview.original} alt={t('expenses.substitute_wizard.signature_original', locale)} className="max-h-32 rounded-lg border bg-white" />
          </div>
          <div>
            <p className="mb-1 text-xs text-gray-500">{t('expenses.substitute_wizard.signature_processed', locale)}</p>
            <img src={signaturePreview.cleaned} alt={t('expenses.substitute_wizard.signature_processed', locale)} className="max-h-32 rounded-lg border" style={{ backgroundImage: 'repeating-conic-gradient(#f3f4f6 0% 25%, white 0% 50%)', backgroundSize: '16px 16px' }} />
          </div>
        </div>
      )}
      <p className="text-xs text-gray-500">{t('expenses.substitute_wizard.signature_help', locale)}</p>
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
          <p className="text-xs text-gray-500">{t('expenses.substitute_wizard.saved_signature_help', locale)}</p>
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
}) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const branchFilter = useBranchFilter();
  const branchId = branchFilter?.branchId ?? '';
  const createBranchId = useTransactionCreateBranchId();
  const canReview = permissions.includes('expense.review');
  const canUploadEvidence = canReview && permissions.includes('attachment.create');
  const canConfirm = permissions.includes('expense.confirm');
  const canCreate = permissions.includes('expense.create');
  const shouldLoadCategories = canCreate || canReview;
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [receiptEvidence, setReceiptEvidence] = useState<SubstituteReceiptEvidenceSummary | null>(null);
  const [editingPrepared, setEditingPrepared] = useState(false);
  const [history, setHistory] = useState<SubstituteReceiptEvidenceSummary[]>([]);
  const [policy, setPolicy] = useState<SubstituteReceiptRuntimePolicy | null>(null);
  const [activeStep, setActiveStep] = useState<WizardStep>('expense');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [linePrefill, setLinePrefill] = useState<LineSubstituteReceiptPrefill | null>(null);
  // URL/LINE flags are navigation hints. Reloaded server classification decides the route.
  const checkBillRoute = isCheckBillClassification(detail?.aiVerificationSummaryJson);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [candidates, setCandidates] = useState<ExpenseDetail[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(!evidenceId);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesTruncated, setCandidatesTruncated] = useState(false);
  const [candidatesReloadKey, setCandidatesReloadKey] = useState(0);
  const [categories, setCategories] = useState<ExpenseCategorySummary[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(shouldLoadCategories);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [categoriesReloadKey, setCategoriesReloadKey] = useState(0);
  const [entryMode, setEntryMode] = useState<WizardEntryMode | null>(initialExpenseId ? 'existing' : initialEntryMode ?? null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [candidateSort, setCandidateSort] = useState<CandidateSortKey>('date_desc');
  const [candidatePage, setCandidatePage] = useState(1);
  const [consent, setConsent] = useState(false);
  const [reasonCode, setReasonCode] = useState<SubstituteReceiptReasonCode>('PAYEE_CANNOT_ISSUE');
  const [missingReason, setMissingReason] = useState('');
  const [businessPurpose, setBusinessPurpose] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [payeeAddress, setPayeeAddress] = useState('');
  const [payeeTaxId, setPayeeTaxId] = useState('');
  const [payerId, setPayerId] = useState('');
  const [signingMethod, setSigningMethod] = useState<'' | 'DIGITAL' | 'PAPER'>('');
  const [payers, setPayers] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [payersLoading, setPayersLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('CASH');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [supportingIds, setSupportingIds] = useState<string[]>([]);
  const [paymentIds, setPaymentIds] = useState<string[]>([]);
  const [supportingFile, setSupportingFile] = useState<File | null>(null);
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [manualDate, setManualDate] = useState(todayIso());
  const [manualLines, setManualLines] = useState<ManualLineEditor[]>([blankManualLine('manual-line-1')]);
  const [manualValidationAttempted, setManualValidationAttempted] = useState(false);
  const [manualAnnouncement, setManualAnnouncement] = useState('');
  const [fundingSource, setFundingSource] = useState<'' | 'COMPANY' | 'PERSONAL_ADVANCE'>('');
  const [paidInFullAcknowledged, setPaidInFullAcknowledged] = useState(false);
  const [signerPosition, setSignerPosition] = useState('');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [cleanedSignatureFile, setCleanedSignatureFile] = useState<File | null>(null);
  const [signatureDrawn, setSignatureDrawn] = useState(false);
  const [signaturePreview, setSignaturePreview] = useState<{ original: string; cleaned: string } | null>(null);
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
  const [supersedeReason, setSupersedeReason] = useState('');
  const candidateHeadingRef = useRef<HTMLHeadingElement>(null);
  const manualHeadingRef = useRef<HTMLHeadingElement>(null);
  const manualDateTriggerRef = useRef<HTMLButtonElement>(null);
  const manualLineSequenceRef = useRef(1);
  const manualLineDescriptionRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const manualLineCardRefs = useRef<Record<string, HTMLFieldSetElement | null>>({});
  const addManualLineRef = useRef<HTMLButtonElement>(null);
  const selectionHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailsHeadingRef = useRef<HTMLHeadingElement>(null);
  const existingRouteRef = useRef<HTMLButtonElement>(null);
  const newRouteRef = useRef<HTMLButtonElement>(null);
  const pendingFocusTargetRef = useRef<'candidate' | 'manual' | 'selection' | 'details' | null>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const versionHistoryRef = useRef<HTMLDetailsElement>(null);
  const supersedeReasonRef = useRef<HTMLTextAreaElement>(null);
  /** Which expense's saved draft has already been applied — persistence starts only after that. */
  const [draftHydratedFor, setDraftHydratedFor] = useState<string | null>(null);
  const previewScope = [
    companyId,
    initialExpenseId ?? '',
    evidenceId ?? '',
    detail?.id ?? '',
    receiptEvidence?.id ?? '',
    receiptEvidence?.updatedAt ?? '',
    signerPosition, fundingSource, payerId,
  ].join('\u0000');
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

  const commitPreview = useCallback((requestId: number, requestScope: string, source: WizardPreviewSource) => {
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
  }, [companyId, detail?.id, evidenceId, initialExpenseId, receiptEvidence?.id, receiptEvidence?.updatedAt, releasePreviewUrl]);
  const payeeIdentityIssues = validatePayeeIdentity({
    payeeName,
    payeeAddress,
    payeeTaxId,
    vendorNameSnapshot: detail?.vendorNameSnapshot,
  });
  const filteredCandidates = useMemo(() => {
    const query = candidateQuery.trim().toLocaleLowerCase(locale === 'th' ? 'th-TH' : 'en-US');
    if (!query) return candidates;
    return candidates.filter((item) => [
      item.expenseNumber,
      item.vendorNameSnapshot,
      ...item.lines.map((line) => line.description),
    ].some((value) => value?.toLocaleLowerCase(locale === 'th' ? 'th-TH' : 'en-US').includes(query)));
  }, [candidateQuery, candidates, locale]);
  const candidatePagination = useMemo(
    () => sortAndPageCandidates(filteredCandidates, candidateSort, candidatePage),
    [filteredCandidates, candidateSort, candidatePage],
  );
  const manualLinesReadiness = useMemo(() => evaluateManualLinesReadiness(manualLines), [manualLines]);
  const manualMissingCount = manualLinesReadiness.missingCount + (manualDate ? 0 : 1);
  const manualTotal = useMemo(() => manualLinesTotal(manualLines), [manualLines]);
  const selectedExpenseRenderabilityIssue = detail ? substituteReceiptRenderabilityIssue(detail) : null;
  // W2: the prepare blockers that live on the expense itself. Evaluated as soon as an expense is
  // chosen so they are visible before anything is typed, not one per failed จัดทำเอกสาร.
  const expensePrerequisites = detail ? evaluateExpensePrerequisites(detail) : null;
  const expenseIneligible = receiptEvidence?.correctionOfEvidenceId ? false : detail ? !isSubstituteReceiptCandidateOtherwiseEligible(detail) : false;
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

  const handleEntryModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: WizardEntryMode) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const next: WizardEntryMode = forward
      ? (current === 'existing' ? 'new' : 'existing')
      : (current === 'new' ? 'existing' : 'new');
    setEntryMode(next);
    (next === 'existing' ? existingRouteRef : newRouteRef).current?.focus();
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

  const assertAllowed = (...values: string[]) => {
    const forbidden = findForbiddenChars(values.join(''));
    if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
  };

  /** Last line of defence for the two expense-level blockers; the buttons are already gated on them,
   *  so reaching this means the expense changed under an open wizard. */
  const assertExpensePrerequisites = (target: ExpenseDetail) => {
    if (!isSubstituteReceiptCandidateOtherwiseEligible(target)) throw new Error(t('expenses.substitute_wizard.expense_ineligible', locale));
    const issue = evaluateExpensePrerequisites(target).missing.find((candidate) => candidate !== 'renderability');
    if (issue) throw new Error(t(PREREQUISITE_KEYS[issue], locale));
  };

  const initializeDraft = useCallback((nextDetail: ExpenseDetail) => {
    setDetail(nextDetail);
    setReasonCode(defaultSubstituteReceiptReason(nextDetail.sourceDocumentType));
    setMissingReason(payerWrittenMissingReason(nextDetail.missingReceiptReason));
    setBusinessPurpose(nextDetail.sourceDraft?.header.businessPurpose ?? nextDetail.note?.split(' · ').find(part => part.trim().startsWith('วัตถุประสงค์:'))?.trim().slice('วัตถุประสงค์:'.length).trim() ?? nextDetail.note ?? '');
    setPayeeName(nextDetail.vendorNameSnapshot ?? '');
    setPayeeAddress('');
    setPayeeTaxId(payeeTaxIdDigits(nextDetail.vendorTaxIdSnapshot ?? ''));
    setPaymentMethod(nextDetail.paymentMethod ?? 'CASH');
    setPaymentDate((nextDetail.paidAt ? coerceCivilDate(nextDetail.paidAt) : todayIso()));
    setSupportingIds(nextDetail.attachments.filter((attachment) => attachment.status === 'ACTIVE'
      && attachment.purpose !== 'expense.review.evidence'
      && attachment.purpose !== 'expense.payment.evidence').map((attachment) => attachment.id));
    setPaymentIds(nextDetail.attachments.filter((attachment) => attachment.status === 'ACTIVE'
      && attachment.purpose === 'expense.payment.evidence').map((attachment) => attachment.id));
    setPayerId('');
    setFundingSource(''); setPaidInFullAcknowledged(false);
  }, [userId]);

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
          if (target.id !== evidenceId) router.replace(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(target.id)}`);
          setDetail(nextDetail);
          setReceiptEvidence(target);
          setHistory(nextHistory);
          setActiveStep(resolveWizardStep(target));
          setMissingReason(target.missingReceiptReason);
          setBusinessPurpose(target.businessPurpose);
          setPayeeName(target.payeeName ?? nextDetail.vendorNameSnapshot ?? '');
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
        } else if (initialExpenseId) {
          const [nextDetail, nextLinePrefill] = await Promise.all([
            getExpense(companyId, initialExpenseId),
            workflowId ? loadLineSubstituteReceiptPrefill(companyId, initialExpenseId, workflowId) : Promise.resolve(null),
          ]);
          if (cancelled) return;
          if (nextDetail.substituteReceiptEvidence && nextDetail.substituteReceiptEvidence.status !== 'SUPERSEDED') {
            router.replace(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(nextDetail.substituteReceiptEvidence.id)}`);
            return;
          }
          initializeDraft(nextDetail);
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
  }, [companyId, evidenceId, initialExpenseId, initializeDraft, locale, router, workflowId]);

  useEffect(() => {
    if (evidenceId) return;
    let cancelled = false;
    setCandidatesLoading(true);
    setCandidatesError(null);
    listCandidateExpenses(companyId, branchId || undefined)
      .then(({ details, truncated }) => {
        if (cancelled) return;
        const nextCandidates = details.filter((item) => (expenseNeedsReceiptOrSubstitute(item)
          || (isCheckBillClassification(item.aiVerificationSummaryJson) && (!item.substituteReceiptEvidence || item.substituteReceiptEvidence.status === 'SUPERSEDED')))
          && isSubstituteReceiptCandidateOtherwiseEligible(item));
        setCandidates(nextCandidates);
        setEntryMode((current) => current ?? resolveWizardEntryMode({
          initialExpenseId,
          candidateCount: nextCandidates.length,
        }));
        setCandidatesTruncated(truncated);
      })
      .catch((cause) => { if (!cancelled) setCandidatesError(err(cause)); })
      .finally(() => { if (!cancelled) setCandidatesLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, candidatesReloadKey, companyId, evidenceId, initialExpenseId]);

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
    if (!detail || !canReview || receiptEvidence) return;
    let cancelled = false;
    setPayersLoading(true);
    listSubstituteReceiptPayers(companyId, detail.id)
      .then((items) => {
        if (cancelled) return;
        setPayers(items);
        setPayerId((current) => items.some((item) => item.userId === current)
          ? current
          : '');
      })
      .catch((cause) => { if (!cancelled) setError(err(cause)); })
      .finally(() => { if (!cancelled) setPayersLoading(false); });
    return () => { cancelled = true; };
  }, [canReview, companyId, detail, receiptEvidence, userId]);

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
        setHistory(rows); setReceiptEvidence(current); setDetail(fresh);
        setPreviewChecksum(null); setCertifiedPreviewed(false); setCertificationAcknowledged(false); setApprovalAcknowledged(false);
        setInfo('เอกสารอัปเดตตามข้อมูลล่าสุดแล้ว กรุณาตรวจเอกสารก่อนลงนาม');
        if (current.id !== receiptEvidence.id) { setActiveStep(resolveWizardStep(current)); router.replace(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(current.id)}`); }
      } catch (cause) { if (!cancelled) setError(err(cause)); }
    };
    window.addEventListener('focus', refresh);
    return () => { cancelled = true; window.removeEventListener('focus', refresh); };
  }, [companyId, detail?.id, receiptEvidence?.id, receiptEvidence?.updatedAt, busy, editingPrepared, router]);

  // W1: only the pre-prepare steps need saving — once evidence exists the server status resumes the
  // wizard on its own, and a prepared certificate must never be re-seeded from stale typing.
  const draftScopeId = !evidenceId && detail && !receiptEvidence ? detail.id : null;
  const draftStep: SubstituteWizardDraftStep | null = activeStep === 'expense' || activeStep === 'details' || activeStep === 'evidence'
    ? activeStep
    : null;

  useEffect(() => {
    if (!draftScopeId || draftHydratedFor === draftScopeId) return;
    const stored = readSubstituteWizardDraft(typeof window === 'undefined' ? null : window.sessionStorage, companyId, draftScopeId, userId);
    if (stored) {
      setActiveStep(stored.step);
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
  }, [companyId, draftHydratedFor, draftScopeId, locale, userId]);

  useEffect(() => {
    if (!draftScopeId || !draftStep || draftHydratedFor !== draftScopeId || typeof window === 'undefined') return;
    writeSubstituteWizardDraft(window.sessionStorage, companyId, draftScopeId, userId, {
      step: draftStep,
      consent, reasonCode, missingReason, businessPurpose,
      payeeName, payeeAddress, payeeTaxId,
      payerId, fundingSource, paidInFullAcknowledged, paymentMethod, paymentDate,
      supportingIds, paymentIds,
    });
  }, [
    businessPurpose, companyId, consent, draftHydratedFor, draftScopeId, draftStep, missingReason,
    paymentDate, paymentIds, paymentMethod, payeeAddress, payeeName, payeeTaxId, payerId, fundingSource, paidInFullAcknowledged,
    reasonCode, supportingIds, userId,
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
    try { await action(); } catch (cause) { setError(err(cause, locale)); } finally { busyRef.current = false; setBusy(false); }
  };

  const selectExpense = (nextDetail: ExpenseDetail, mode: WizardEntryMode = 'existing') => {
    initializeDraft(nextDetail);
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
    if (!createBranchId) throw new Error(t('transaction.source_branch_required', locale));
    setManualValidationAttempted(true);
    assertAllowed(...manualLines.map((line) => line.description));
    if (!canReview) throw new Error(t('expenses.substitute_wizard.review_permission_required', locale));
    if (!manualDate || !manualLinesReadiness.ready) {
      const invalidIndex = manualLinesReadiness.invalidLineIndexes[0];
      window.requestAnimationFrame(() => {
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
      throw new Error(t('expenses.substitute_wizard.manual_required', locale));
    }
    const created = await createExpenseDraft(companyId, {
      captureSource: 'WEB_MANUAL',
      expenseDate: manualDate,
      branchId: createBranchId,
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NEEDS_REVIEW',
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
    selectExpense(nextDetail, 'new');
    manualLineSequenceRef.current += 1;
    setManualLines([blankManualLine(`manual-line-${manualLineSequenceRef.current}`)]);
    setManualValidationAttempted(false);
    setManualAnnouncement('');
    setInfo(t('expenses.substitute_wizard.manual_created', locale));
  };

  const continueFromExpense = async () => {
    if (!detail || !consent) throw new Error(t('expenses.substitute_wizard.consent_required', locale));
    if (!canReview) throw new Error(t('expenses.substitute_wizard.review_permission_required', locale));
    const renderabilityIssue = substituteReceiptRenderabilityIssue(detail);
    if (renderabilityIssue) throw new Error(renderabilityIssueMessage(renderabilityIssue, locale));
    assertExpensePrerequisites(detail);
    const nextDocType = !checkBillRoute && detail.sourceDocumentType === 'NEEDS_REVIEW' ? 'EXPENSE_NOTE_TEXT' as const : detail.sourceDocumentType;
    const nextTaxStatus = !checkBillRoute && detail.taxEvidenceStatus === 'NEEDS_REVIEW' ? 'SUPPORTING_ONLY' as const : detail.taxEvidenceStatus;
    if (nextDocType !== detail.sourceDocumentType || nextTaxStatus !== detail.taxEvidenceStatus) {
      const disallowsTaxCode = !allowsDomesticInputTaxCode(nextDocType, nextTaxStatus);
      const currentReview = reviewValues(detail);
      await updateExpenseReviewFields(companyId, detail.id, {
        expectedUpdatedAt: detail.updatedAt,
        ...(disallowsTaxCode ? buildExpenseDraftReviewPayload({
          ...currentReview,
          lines: clearExpenseTaxSelections(currentReview.lines),
        }) : {}),
        sourceDocumentType: nextDocType,
        taxEvidenceStatus: nextTaxStatus,
        ...(disallowsTaxCode && { inputVatClaimStatus: 'NON_CLAIMABLE' as const }),
      });
      setDetail(await getExpense(companyId, detail.id));
    }
    setActiveStep('details');
    requestWorkflowFocus('details');
  };

  const continueFromDetails = async () => {
    if (!detail) throw new Error(t('expenses.substitute_wizard.expense_required', locale));
    assertAllowed(payeeName, payeeAddress, missingReason, businessPurpose);
    const firstPayeeIssue = Object.values(payeeIdentityIssues)[0];
    if (firstPayeeIssue) throw new Error(t(PAYEE_ISSUE_KEYS[firstPayeeIssue], locale));
    if (!missingReason.trim() || !businessPurpose.trim() || !paymentDate || !fundingSource || !paidInFullAcknowledged) {
      throw new Error(t('expenses.substitute_wizard.details_required', locale));
    }

    if (recordedPaymentMismatch) throw new Error('เลือกใช้ข้อมูลการจ่ายที่บันทึกไว้ก่อนดำเนินการต่อ');
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
    const file = picked ?? (purpose === 'expense.payment.evidence' ? paymentFile : supportingFile);
    if (!file) throw new Error(t('expenses.substitute_wizard.file_required', locale));
    assertAllowedUploadFile(file);
    const pendingIssue = substituteReceiptEvidenceRenderabilityIssue([
      ...selectedEvidenceAttachments,
      { id: `pending-${purpose}`, originalFileName: file.name },
    ]);
    if (pendingIssue) throw new Error(evidenceRenderabilityIssueMessage(pendingIssue, locale));
    const attachmentId = await uploadExpenseEvidenceFile(companyId, detail.id, detail.branchId, file, purpose);
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
    if (!detail) throw new Error(t('expenses.substitute_wizard.expense_required', locale));
    assertExpensePrerequisites(detail);
    assertAllowed(payeeName, payeeAddress, missingReason, businessPurpose);
    const firstPayeeIssue = Object.values(payeeIdentityIssues)[0];
    if (firstPayeeIssue) throw new Error(t(PAYEE_ISSUE_KEYS[firstPayeeIssue], locale));
    if (!missingReason.trim() || !businessPurpose.trim() || !paymentDate || !signingMethod
      || (signingMethod === 'DIGITAL' && !editingPrepared && (!payerId || !payers.some((payer) => payer.userId === payerId)))) {
      throw new Error(t('expenses.substitute_wizard.details_required', locale));
    }
    if (!fundingSource || !paidInFullAcknowledged) throw new Error('เลือกเงินที่ใช้ชำระและยืนยันว่าจ่ายเต็มจำนวนแล้ว');
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
      });
      setReceiptEvidence(result);
      setDetail(await getExpense(companyId, detail.id));
      setHistory(await listSubstituteReceiptHistory(companyId, detail.id));
      setEditingPrepared(false);
      setActiveStep(resolveWizardStep(result));
      setInfo(result.updatedAt === receiptEvidence.updatedAt
        ? `ข้อมูลตรงกับฉบับปัจจุบันแล้ว ใช้เอกสาร ${result.documentNumber} ต่อได้`
        : `บันทึกข้อมูลแล้ว เลขเอกสาร ${result.documentNumber} · ดาวน์โหลดฟอร์มล่าสุดเพื่อตรวจและลงนาม`);
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
    setActiveStep('certify');
    router.push(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(result.id)}`);
  };

  const selectSignatureFile = (file: File | null) => {
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
    setInfo(t('expenses.substitute_wizard.signature_ready', locale));
  };

  const buildTransparentSignature = async () => {
    if (!signatureFile) throw new Error(t('expenses.substitute_wizard.signature_required', locale));
    assertAllowedUploadFile(signatureFile, 'image');
    const sourceUrl = URL.createObjectURL(signatureFile);
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
      setInfo(t('expenses.substitute_wizard.signature_ready', locale));
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
    setPreviewChecksum(null);
    setCertifiedPreviewed(false);
  };

  const previewPrepared = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    assertAllowed(signerPosition);
    const requestId = ++previewRequestRef.current;
    const requestScope = previewScopeRef.current;
    setPreviewChecksum(null);
    let result;
    try {
      result = await previewSubstituteReceipt(companyId, detail.id, receiptEvidence.id, { payerPosition: signerPosition.trim() });
    } catch (cause) {
      if (!isPreviewRequestCurrent(requestId, requestScope)) return;
      throw cause;
    }
    if (!isPreviewRequestCurrent(requestId, requestScope)) return;
    previewEvidenceRevisionRef.current = result.expectedEvidenceUpdatedAt ?? receiptEvidence.updatedAt;
    commitPreview(requestId, requestScope, {
      name: `${receiptEvidence.documentNumber} · ${t('expenses.substitute_wizard.preview_document', locale)}`,
      mimeType: 'image/svg+xml',
      url: result.svgDataUrl,
      onViewed: () => { if (isPreviewRequestCurrent(requestId, requestScope)) setPreviewChecksum(result.previewChecksumSha256); },
    });
  };

  const certify = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    assertAllowed(signerPosition);
    if (!previewChecksum) throw new Error(t('expenses.substitute_wizard.preview_required', locale));
    if (!certificationAcknowledged) throw new Error(t('expenses.substitute_wizard.certification_ack_required', locale));
    const signature = signatureSource === 'evidence_upload' ? { signatureAttachmentId: await uploadPersonalSignature() } : {};
    const result = await certifySubstituteReceipt(companyId, detail.id, receiptEvidence.id, {
      payerPosition: signerPosition.trim(),
      certificationAcknowledged: true,
      previewChecksumSha256: previewChecksum,
      ...signature,
      expectedVersion: receiptEvidence.version,
      expectedEvidenceUpdatedAt: previewEvidenceRevisionRef.current ?? receiptEvidence.updatedAt,
    });
    setReceiptEvidence(result);
    setDetail((current) => current ? { ...current, substituteReceiptEvidence: result } : current);
    setHistory((current) => current.map((item) => item.id === result.id ? result : item));
    resetSignature();
    setCertificationAcknowledged(false);
    setActiveStep('approve');
    setInfo(t('expenses.substitute_wizard.certified', locale));
  };

  const openArtifact = async (attachmentId: string | null, certified = false) => {
    if (!attachmentId || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.document_not_ready', locale));
    const requestId = ++previewRequestRef.current;
    const requestScope = previewScopeRef.current;
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
        ? `${receiptEvidence.documentNumber} · ${t('expenses.substitute_wizard.open_certified', locale)}`
        : receiptEvidence.documentNumber,
      mimeType: 'image/svg+xml',
      url,
      ...(certified ? { onViewed: () => { if (isPreviewRequestCurrent(requestId, requestScope)) setCertifiedPreviewed(true); } } : {}),
    });
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
      name: `${receiptEvidence.documentNumber}.pdf`,
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

  const supersede = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    assertAllowed(supersedeReason);
    if (!supersedeReason.trim()) throw new Error(t('expenses.substitute_wizard.supersede_reason_required', locale));
    const result = await supersedeSubstituteReceipt(companyId, detail.id, receiptEvidence.id, {
      reason: supersedeReason.trim(),
      expectedEvidenceUpdatedAt: receiptEvidence.updatedAt,
    });
    const nextHistory = await listSubstituteReceiptHistory(companyId, detail.id);
    setReceiptEvidence(result);
    setDetail((current) => current ? { ...current, substituteReceiptEvidence: result } : current);
    setHistory(nextHistory);
    setSupersedeReason('');
    setActiveStep('done');
    setInfo(t('expenses.substitute_wizard.superseded', locale));
  };

  const copyWizardLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setError(t('expenses.substitute_wizard.copy_failed', locale));
    }
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
    ? receiptEvidence.paperSubmission ? 'รอตรวจรับฉบับลงนาม' : 'รออัปโหลดฉบับลงนาม'
    : !turn || turn.stage === 'done' ? null
    : turn.mine ? t('expenses.substitute_wizard.turn_mine', locale)
      : turn.waitingFor === 'payer'
        ? t('expenses.substitute_wizard.waiting_payer', locale).replace('{name}', receiptEvidence?.payerName ?? '')
        : t('expenses.substitute_wizard.waiting_approver', locale);

  const renderReadOnlySummary = (step: WizardStep) => {
    if (!detail || !receiptEvidence) return null;
    if (step === 'expense') return <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} categories={categories} />;
    if (step === 'details') {
      return (
        <MangmeeCard className="space-y-2 p-4 text-sm text-gray-600">
          <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.step_details', locale)}</h2>
          <p>ผู้ขายในค่าใช้จ่าย: {detail.vendorNameSnapshot || 'ยังไม่ระบุ'}</p>
          <p>{t('expenses.substitute_wizard.payee_name', locale)}: {receiptEvidence.payeeName ?? t('expenses.substitute_wizard.not_specified', locale)}</p>
          {receiptEvidence.payeeAddress && <p>{t('expenses.substitute_wizard.payee_address', locale)}: {receiptEvidence.payeeAddress}</p>}
          {receiptEvidence.payeeTaxId && <p>{t('expenses.substitute_wizard.payee_tax_id', locale)}: {receiptEvidence.payeeTaxId}</p>}
          <p>{t(REASON_KEYS[receiptEvidence.reasonCode], locale)} · {receiptEvidence.missingReceiptReason}</p>
          <p>{receiptEvidence.businessPurpose}</p>
          <p>{t('expenses.substitute_wizard.payer', locale)}: {receiptEvidence.payerName} · {t(PAYMENT_KEYS[receiptEvidence.paymentMethod ?? 'CASH'], locale)} · {dateShort(receiptEvidence.paymentDate)}</p>
        </MangmeeCard>
      );
    }
    return (
      <MangmeeCard className="space-y-2 p-4 text-sm text-gray-600">
        <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.step_evidence', locale)}</h2>
        <p>{t('expenses.substitute_wizard.supporting_files', locale).replace('{count}', String(receiptEvidence.supportingAttachmentIds.length))}</p>
        <p>{t('expenses.substitute_wizard.payment_files', locale).replace('{count}', String(receiptEvidence.paymentEvidenceAttachmentIds.length))}</p>
      </MangmeeCard>
    );
  };

  // One readiness list per step, and the same labels are what the blocked primary button names —
  // a section can no longer read "ครบแล้ว พร้อมไปต่อ" while the server is still going to refuse.
  const expenseStepReadinessItems = [
    ...(expenseIneligible ? [{ label: t('expenses.substitute_wizard.expense_ineligible', locale), complete: false }] : []),
    { label: t('expenses.substitute_wizard.readiness_expense', locale), complete: !selectedExpenseRenderabilityIssue },
    { label: t('expenses.substitute_wizard.readiness_reviewed_amount', locale), complete: !expensePrerequisites?.missing.includes('reviewedAmount') },
    { label: t('expenses.substitute_wizard.readiness_reviewed_category', locale), complete: !expensePrerequisites?.missing.includes('reviewedCategory') },
    { label: t('expenses.substitute_wizard.readiness_tax_ack', locale), complete: consent },
    { label: t('expenses.substitute_wizard.readiness_permission', locale), complete: canReview },
  ];
  const expenseStepBlockers = expenseStepReadinessItems.filter((item) => !item.complete).map((item) => item.label);

  /** The two blockers the wizard cannot repair, named with the screen that can repair them. The
   *  renderability limit keeps its own banner below, which already carries the "split it" wording. */
  const renderPrerequisiteCard = () => {
    const blocking = expensePrerequisites?.missing.filter((issue) => issue !== 'renderability') ?? [];
    if (!detail || blocking.length === 0) return null;
    return (
      <MangmeeCard className="border-warning-200 bg-warning-50 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-warning-700">{ICON.alert}</span>
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-sm font-extrabold text-warning-700">{t('expenses.substitute_wizard.prerequisite_title', locale)}</p>
            <ul className="list-disc space-y-1 pl-4 text-sm leading-6 text-warning-700">
              {blocking.map((issue) => <li key={issue}>{t(PREREQUISITE_KEYS[issue], locale)}</li>)}
            </ul>
            <div className="flex flex-col items-stretch gap-2 pt-1 sm:flex-row sm:items-center">
              <Link className={cx(btnClass, 'w-full text-center sm:w-auto')} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>
                {t('expenses.substitute_wizard.prerequisite_open_expense', locale)}
              </Link>
              <p className="text-sm font-medium leading-6 text-warning-700 sm:min-w-0 sm:flex-1">
                {t('expenses.substitute_wizard.prerequisite_return_hint', locale)}
              </p>
            </div>
          </div>
        </div>
      </MangmeeCard>
    );
  };

  const renderExpenseStep = () => (
    <div className="space-y-4">
      {/* The guide collapses to one line so the entry form below is the page's focus;
          the full conditions stay one click away and the tax notice stays visible. */}
      {!detail && <MangmeeCard className="overflow-hidden p-0">
        <details className="group">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
            <MangmeeBadge tone="brand">{t('expenses.substitute_wizard.guide_badge', locale)}</MangmeeBadge>
            <h2 className="min-w-0 flex-1 text-sm font-extrabold tracking-tight text-gray-900 sm:text-base">{t('expenses.substitute_wizard.guide_title', locale)}</h2>
            <span className="flex shrink-0 items-center gap-1 text-xs font-bold text-brand-700">
              {t('expenses.substitute_wizard.guide_toggle', locale)}
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4 transition-transform group-open:rotate-180">
                <path d="m5.5 8 4.5 4.5L14.5 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </summary>
          <div className="space-y-3 border-t border-gray-100 px-4 pb-4 pt-3">
            <p className="text-sm leading-5 text-gray-600">{t('expenses.substitute_wizard.guide_description', locale)}</p>
            <ol className="grid gap-1.5 md:grid-cols-3">
              {([
                ['1', 'expenses.substitute_wizard.guide_actual_expense'],
                ['2', 'expenses.substitute_wizard.guide_no_receipt'],
                ['3', 'expenses.substitute_wizard.guide_has_evidence'],
              ] as const).map(([number, key]) => (
                <li key={key} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs font-semibold leading-4 text-gray-700">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-extrabold text-brand-700">{number}</span>
                  <span className="min-w-0">{t(key, locale)}</span>
                </li>
              ))}
            </ol>
            <p className="text-xs font-medium leading-5 text-gray-500">{t('expenses.substitute_wizard.guide_lost_receipt', locale)}</p>
          </div>
        </details>
        <div className="flex items-start gap-2 border-t border-warning-100 bg-warning-50 px-4 py-2.5 text-xs font-semibold leading-5 text-warning-700">
          <span aria-hidden="true">⚠</span>
          {t('expenses.substitute_wizard.tax_notice', locale)}
        </div>
      </MangmeeCard>}

      {!detail && (
        <MangmeeCard className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-gray-900">{t('expenses.substitute_wizard.entry_question', locale)}<RequiredMark /></h2>
              <p className="mt-0.5 text-xs leading-5 text-gray-500 sm:text-sm">{t('expenses.substitute_wizard.entry_help', locale)}</p>
            </div>
            <RequiredLegend label={t('expenses.substitute_wizard.required_legend', locale)} />
          </div>
          {!canReview && <ErrorBanner message={t('expenses.substitute_wizard.review_permission_required', locale)} />}
          <div className="grid gap-2 md:grid-cols-2" role="radiogroup" aria-required="true" aria-label={t('expenses.substitute_wizard.entry_question', locale)}>
            <button
              ref={existingRouteRef}
              type="button"
              role="radio"
              aria-checked={entryMode === 'existing'}
              tabIndex={entryMode === 'new' ? -1 : 0}
              disabled={!canReview}
              onClick={() => { setEntryMode('existing'); requestWorkflowFocus('candidate'); }}
              onKeyDown={(event) => handleEntryModeKeyDown(event, 'existing')}
              className={cx(
                'cursor-pointer rounded-xl border-2 p-3 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                entryMode === 'existing' ? 'border-brand-500 bg-brand-25 shadow-md' : 'border-gray-200 bg-white hover:-translate-y-px hover:border-brand-300 hover:shadow-md',
                !canReview && 'cursor-not-allowed opacity-60',
              )}
            >
              <span className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-brand-700">{ICON.search}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-extrabold text-gray-900">{t('expenses.substitute_wizard.entry_existing_title', locale)}</span>
                    <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-bold text-brand-700">{t('expenses.substitute_wizard.recommended', locale)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-500">{t('expenses.substitute_wizard.entry_existing_help', locale)}</span>
                </span>
                <span aria-hidden="true" className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition', entryMode === 'existing' ? 'border-brand-500 bg-brand-500' : 'border-gray-300 bg-white')}>
                  {entryMode === 'existing' && <span className="h-2 w-2 rounded-full bg-white" />}
                </span>
              </span>
            </button>
            <button
              ref={newRouteRef}
              type="button"
              role="radio"
              aria-checked={entryMode === 'new'}
              tabIndex={entryMode === 'new' ? 0 : -1}
              disabled={!canReview}
              onClick={() => { setEntryMode('new'); requestWorkflowFocus('manual'); }}
              onKeyDown={(event) => handleEntryModeKeyDown(event, 'new')}
              className={cx(
                'cursor-pointer rounded-xl border-2 p-3 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                entryMode === 'new' ? 'border-brand-500 bg-brand-25 shadow-md' : 'border-gray-200 bg-white hover:-translate-y-px hover:border-brand-300 hover:shadow-md',
                !canReview && 'cursor-not-allowed opacity-60',
              )}
            >
              <span className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">{ICON.edit}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-extrabold text-gray-900">{t('expenses.substitute_wizard.entry_new_title', locale)}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-500">{t('expenses.substitute_wizard.entry_new_help', locale)}</span>
                </span>
                <span aria-hidden="true" className={cx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition', entryMode === 'new' ? 'border-brand-500 bg-brand-500' : 'border-gray-300 bg-white')}>
                  {entryMode === 'new' && <span className="h-2 w-2 rounded-full bg-white" />}
                </span>
              </span>
            </button>
          </div>
        </MangmeeCard>
      )}

      {!detail && entryMode === 'existing' && (
        <MangmeeCard className="space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 ref={candidateHeadingRef} tabIndex={-1} className="scroll-mt-24 font-bold text-gray-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">{t('expenses.substitute_wizard.candidate_title', locale)}<RequiredMark /></h2>
              <p className="mt-1 text-sm text-gray-500">{t('expenses.substitute_wizard.candidate_help', locale)}</p>
            </div>
            {!candidatesLoading && <MangmeeBadge tone="slate">{t('expenses.substitute_wizard.candidate_count', locale).replace('{count}', String(filteredCandidates.length))}</MangmeeBadge>}
          </div>
          {candidatesError ? (
            <div className="space-y-2">
              <ErrorBanner message={candidatesError} />
              <button type="button" className={ghostClass} onClick={() => setCandidatesReloadKey((current) => current + 1)}>{t('expenses.substitute_wizard.retry', locale)}</button>
            </div>
          ) : candidatesLoading ? <LoadingState label={t('expenses.loading', locale)} />
            : candidates.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-gray-400 shadow-sm">{ICON.receipt}</span>
                <h3 className="mt-3 font-bold text-gray-900">{t('expenses.substitute_wizard.candidate_empty', locale)}</h3>
                <p className="mx-auto mt-1 max-w-xl text-sm leading-6 text-gray-500">{t('expenses.substitute_wizard.candidate_empty_help', locale)}</p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" className={btnClass} onClick={() => { setEntryMode('new'); requestWorkflowFocus('manual'); }}>{t('expenses.substitute_wizard.entry_new_action', locale)}</button>
                  <Link className={ghostClass} href={`/companies/${companyId}/expenses`}>{t('expenses.substitute_wizard.open_expenses', locale)}</Link>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <label className="relative block min-w-0 flex-1">
                    <span className="sr-only">{t('expenses.substitute_wizard.candidate_search', locale)}</span>
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{ICON.search}</span>
                    <input className={cx(inputClass, 'mangmee-input-icon-end')} value={candidateQuery} placeholder={t('expenses.substitute_wizard.candidate_search', locale)} onChange={(event) => { setCandidateQuery(stripDisallowed(event.target.value)); setCandidatePage(1); }} />
                  </label>
                  <ThemedSelect aria-label={t('expenses.substitute_wizard.candidate_sort_label', locale)} className={cx(inputClass, 'sm:w-52')} value={candidateSort} onChange={(event) => { setCandidateSort(event.target.value as CandidateSortKey); setCandidatePage(1); }}>
                    <option value="date_desc">{t('expenses.substitute_wizard.candidate_sort_date_desc', locale)}</option>
                    <option value="date_asc">{t('expenses.substitute_wizard.candidate_sort_date_asc', locale)}</option>
                    <option value="amount_desc">{t('expenses.substitute_wizard.candidate_sort_amount_desc', locale)}</option>
                    <option value="amount_asc">{t('expenses.substitute_wizard.candidate_sort_amount_asc', locale)}</option>
                  </ThemedSelect>
                </div>
                {filteredCandidates.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-500">{t('expenses.substitute_wizard.candidate_search_empty', locale)}</p>
                ) : (
                  <div className="grid gap-2">
                    {candidatePagination.rows.map((item) => {
                      const candidateEligible = isSubstituteReceiptCandidateEligible(item);
                      const renderabilityIssue = substituteReceiptRenderabilityIssue(item);
                      return (
                      <button key={item.id} type="button" disabled={!canReview} onClick={() => selectExpense(item)}
                        aria-label={`${t('expenses.substitute_wizard.select_action', locale)}: ${item.vendorNameSnapshot || item.lines[0]?.description || t('expenses.substitute_wizard.not_specified', locale)}, ${t('expenses.substitute_wizard.item_count', locale).replace('{count}', String(item.lines.length))}, ${item.expenseNumber}, ${baht(item.grandTotalAmount)}`}
                        className={cx(
                          'group rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                          candidateEligible
                            ? 'border-gray-200 hover:border-brand-300 hover:bg-brand-25'
                            : 'border-warning-200 bg-warning-50 hover:border-warning-300',
                        )}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-gray-900">{item.vendorNameSnapshot || item.lines[0]?.description || t('expenses.substitute_wizard.not_specified', locale)}</p>
                            <p className="mt-1 text-xs font-medium text-gray-400">{item.expenseNumber} · {t('expenses.substitute_wizard.item_count', locale).replace('{count}', String(item.lines.length))}</p>
                          </div>
                          <span className="shrink-0 text-base font-extrabold tabular-nums text-gray-900">{baht(item.grandTotalAmount)}</span>
                        </div>
                        {item.lines.length > 1 && (
                          <p className="mt-2 truncate text-xs text-gray-500">
                            {item.lines.slice(0, 2).map((line) => line.description).join(' · ')}
                            {item.lines.length > 2 ? ` · ${t('expenses.substitute_wizard.more_items', locale).replace('{count}', String(item.lines.length - 2))}` : ''}
                          </p>
                        )}
                        {renderabilityIssue && (
                          <p className="mt-2 rounded-lg bg-white px-2 py-1.5 text-xs font-semibold leading-5 text-warning-700">
                            {renderabilityIssueMessage(renderabilityIssue, locale)}
                          </p>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500">
                          <span>{dateShort(item.expenseDate)}</span>
                          <span className="font-bold text-brand-700 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-visible:opacity-100">{t('expenses.substitute_wizard.select_action', locale)} →</span>
                        </div>
                      </button>
                      );
                    })}
                  </div>
                )}
                {candidatePagination.totalPages > 1 && (
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button type="button" className={ghostClass} disabled={candidatePagination.page <= 1} onClick={() => setCandidatePage(candidatePagination.page - 1)}>‹ {t('expenses.previous', locale)}</button>
                    <span className="text-xs font-semibold tabular-nums text-gray-500">
                      {t('expenses.substitute_wizard.candidate_page_of', locale).replace('{page}', String(candidatePagination.page)).replace('{total}', String(candidatePagination.totalPages))}
                    </span>
                    <button type="button" className={ghostClass} disabled={candidatePagination.page >= candidatePagination.totalPages} onClick={() => setCandidatePage(candidatePagination.page + 1)}>{t('expenses.next', locale)} ›</button>
                  </div>
                )}
              </>
            )}
          {!candidatesError && !candidatesLoading && candidatesTruncated && (
            <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-500">{t('expenses.substitute_wizard.candidate_truncated', locale)}</p>
          )}
        </MangmeeCard>
      )}

      {!detail && entryMode === 'new' && (
        <MangmeeCard className="space-y-4 p-5">
          <TransactionBranchField value={createBranchId} />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 ref={manualHeadingRef} tabIndex={-1} className="scroll-mt-24 font-bold text-gray-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">{t('expenses.substitute_wizard.manual_title', locale)}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('expenses.substitute_wizard.manual_help', locale)}</p>
            </div>
            <RequiredLegend label={t('expenses.substitute_wizard.required_legend', locale)} />
          </div>
          <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-700">
            <strong>{t('expenses.substitute_wizard.manual_notice_title', locale)}</strong> {t('expenses.substitute_wizard.manual_notice', locale)}
          </div>
          {categoriesError && (
            <div className="space-y-2">
              <ErrorBanner message={categoriesError} />
              <button type="button" className={ghostClass} onClick={() => setCategoriesReloadKey((current) => current + 1)}>{t('expenses.substitute_wizard.retry', locale)}</button>
            </div>
          )}
          {!categoriesLoading && !categoriesError && categories.length === 0 && (
            <div className="rounded-xl border border-warning-100 bg-warning-50 p-4 text-sm leading-6 text-warning-700">
              <p>{t('expenses.substitute_wizard.category_empty', locale)}</p>
              <Link className={cx(ghostClass, 'mt-3 inline-flex')} href={`/companies/${companyId}/expenses/categories`}>{t('expenses.substitute_wizard.manage_categories', locale)}</Link>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,0.65fr)] sm:items-end">
            <label className="block text-sm font-semibold text-gray-700">
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
              {manualValidationAttempted && !manualDate && <span id="substitute-manual-date-error" className="mt-1 block text-xs text-error-700">{t('expenses.substitute_wizard.date_required', locale)}</span>}
            </label>
            <div className="rounded-xl border border-brand-100 bg-brand-25 px-3 py-2 text-xs leading-5 text-brand-800">
              <strong>{t('expenses.substitute_wizard.multi_item_rule_title', locale)}</strong> {t('expenses.substitute_wizard.multi_item_rule', locale)}
            </div>
          </div>
          <section className="space-y-3" aria-labelledby="substitute-manual-items-title">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 id="substitute-manual-items-title" className="text-sm font-extrabold text-gray-900">{t('expenses.substitute_wizard.items_title', locale)}<RequiredMark /></h3>
                <p className="mt-0.5 text-xs text-gray-500">{t('expenses.substitute_wizard.items_help', locale)}</p>
              </div>
              <MangmeeBadge tone="slate">{t('expenses.substitute_wizard.item_count', locale).replace('{count}', String(manualLines.length))}</MangmeeBadge>
            </div>
            {manualLines.map((line, index) => {
              const invalidFields = manualValidationAttempted ? invalidManualLineFields(line) : [];
              const lineErrorId = `substitute-${line.id}-error`;
              const isInvalid = (field: ManualLineField) => invalidFields.includes(field);
              return (
              <fieldset
                key={line.id}
                ref={(node) => { manualLineCardRefs.current[line.id] = node; }}
                tabIndex={-1}
                aria-invalid={manualValidationAttempted && manualLinesReadiness.invalidLineIndexes.includes(index) || undefined}
                className={cx(
                  'overflow-hidden rounded-xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
                  manualValidationAttempted && manualLinesReadiness.invalidLineIndexes.includes(index) ? 'border-error-500' : 'border-gray-200',
                )}
              >
                <legend className="sr-only">{t('expenses.substitute_wizard.item_n', locale).replace('{number}', String(index + 1))}</legend>
                <div className="flex min-h-11 items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-3 py-1.5">
                  <span className="text-xs font-extrabold text-gray-700">{t('expenses.substitute_wizard.item_n', locale).replace('{number}', String(index + 1))}</span>
                  <div className="flex items-center gap-1">
                    {manualLines.length > 1 && (
                      <>
                        <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white hover:text-brand-700 disabled:opacity-30" disabled={index === 0 || busy} aria-label={`${t('expenses.substitute_wizard.move_item_up', locale)}: ${t('expenses.substitute_wizard.item_n', locale).replace('{number}', String(index + 1))}`} onClick={() => moveManualLine(index, -1)}>↑</button>
                        <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 transition hover:bg-white hover:text-brand-700 disabled:opacity-30" disabled={index === manualLines.length - 1 || busy} aria-label={`${t('expenses.substitute_wizard.move_item_down', locale)}: ${t('expenses.substitute_wizard.item_n', locale).replace('{number}', String(index + 1))}`} onClick={() => moveManualLine(index, 1)}>↓</button>
                        <button type="button" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 transition hover:bg-error-50 hover:text-error-700" disabled={busy} aria-label={`${t('expenses.substitute_wizard.remove_item', locale)}: ${t('expenses.substitute_wizard.item_n', locale).replace('{number}', String(index + 1))}`} onClick={() => removeManualLine(line.id)}>×</button>
                      </>
                    )}
                  </div>
                </div>
                <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-12">
                  <label className="block text-sm font-semibold text-gray-700 sm:col-span-2 lg:col-span-7">
                    <span className="mb-1 block">{t('expenses.manual_description', locale)}<RequiredMark /></span>
                    <input id={manualLineControlId(line.id, 'description')} ref={(node) => { manualLineDescriptionRefs.current[line.id] = node; }} className={inputClass} required maxLength={200} value={line.description} aria-invalid={isInvalid('description') || undefined} aria-describedby={isInvalid('description') ? lineErrorId : undefined} placeholder={t('expenses.substitute_wizard.manual_description_placeholder', locale)} onChange={(event) => updateManualLine(line.id, { description: stripDisallowed(event.target.value) })} />
                  </label>
                  <label className="block text-sm font-semibold text-gray-700 sm:col-span-2 lg:col-span-5">
                    <span className="mb-1 block">{t('expenses.substitute_wizard.category', locale)}<RequiredMark /></span>
                    <ThemedSelect id={manualLineControlId(line.id, 'expenseCategoryId')} className={inputClass} value={line.expenseCategoryId} required aria-invalid={isInvalid('expenseCategoryId') || undefined} aria-describedby={isInvalid('expenseCategoryId') ? lineErrorId : undefined} aria-label={`${t('expenses.substitute_wizard.item_n', locale).replace('{number}', String(index + 1))}: ${t('expenses.substitute_wizard.category', locale)}`} onChange={(event) => updateManualLine(line.id, { expenseCategoryId: event.target.value })} disabled={categoriesLoading}>
                      <option value="">{categoriesLoading ? t('expenses.loading', locale) : t('expenses.substitute_wizard.category_none', locale)}</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </ThemedSelect>
                  </label>
                  <label className="block text-sm font-semibold text-gray-700 lg:col-span-3">
                    <span className="mb-1 block">{t('expenses.substitute_wizard.quantity', locale)}<RequiredMark /></span>
                    <input id={manualLineControlId(line.id, 'quantity')} className={cx(inputClass, 'text-right tabular-nums')} required type="number" inputMode="decimal" min="0.0001" step="0.0001" value={line.quantity} aria-invalid={isInvalid('quantity') || undefined} aria-describedby={isInvalid('quantity') ? lineErrorId : undefined} onChange={(event) => updateManualLine(line.id, { quantity: event.target.value })} />
                  </label>
                  <label className="block text-sm font-semibold text-gray-700 lg:col-span-4">
                    <span className="mb-1 block">{t('expenses.substitute_wizard.unit_price', locale)}<RequiredMark /></span>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-500">฿</span>
                      <input id={manualLineControlId(line.id, 'unitPrice')} className={cx(inputClass, 'pl-8 text-right tabular-nums')} required type="number" inputMode="decimal" min="0.0001" step="0.0001" value={line.unitPrice} aria-invalid={isInvalid('unitPrice') || undefined} aria-describedby={isInvalid('unitPrice') ? lineErrorId : undefined} placeholder="0.00" onChange={(event) => updateManualLine(line.id, { unitPrice: normalizeDecimalInput(event.target.value) })} />
                    </div>
                  </label>
                  <div className="rounded-xl bg-gray-50 px-3 py-2 lg:col-span-5 lg:self-end">
                    <span className="block text-xs font-medium text-gray-500">{t('expenses.substitute_wizard.line_total', locale)}</span>
                    <span className="mt-0.5 block text-right text-base font-extrabold tabular-nums text-gray-900">{baht(manualLineAmount(line))}</span>
                  </div>
                </div>
                {manualValidationAttempted && manualLinesReadiness.invalidLineIndexes.includes(index) && (
                  <p id={lineErrorId} className="border-t border-error-50 bg-error-50 px-3 py-2 text-xs font-medium text-error-700">{t('expenses.substitute_wizard.item_incomplete', locale)}</p>
                )}
              </fieldset>
              );
            })}
            <p className="sr-only" aria-live="polite">{manualAnnouncement}</p>
            <button ref={addManualLineRef} type="button" className="flex min-h-11 w-full items-center justify-center rounded-xl border-2 border-dashed border-brand-200 px-3 py-2 text-sm font-bold text-brand-700 transition hover:border-brand-400 hover:bg-brand-25 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400" disabled={busy || manualLines.length >= MAX_SUBSTITUTE_MANUAL_LINES} onClick={addManualLine}>
              + {t('expenses.substitute_wizard.add_item', locale)}
            </button>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-gray-900 px-4 py-3 text-white">
              <span className="text-sm font-semibold">{t('expenses.substitute_wizard.items_total_label', locale).replace('{count}', String(manualLines.length))}</span>
              <span className="text-xl font-extrabold tabular-nums">{baht(manualTotal)}</span>
            </div>
            <p className="text-xs leading-5 text-gray-500">{t('expenses.substitute_wizard.item_limit_help', locale).replace('{count}', String(MAX_SUBSTITUTE_MANUAL_LINES))}</p>
          </section>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
            {!canCreate && <p className="text-xs text-warning-700">{t('expenses.manual_read_only', locale)}</p>}
            {canCreate && manualMissingCount > 0 && <p className="text-xs font-medium text-gray-500">{t('expenses.substitute_wizard.manual_missing', locale).replace('{count}', String(manualMissingCount))}</p>}
            <button type="button" className={cx(btnClass, 'ml-auto')} disabled={!createBranchId || !canCreate || !canReview || busy || categoriesLoading || Boolean(categoriesError) || categories.length === 0} onClick={() => void run(createManualExpense)}>
              {t('expenses.substitute_wizard.create_and_select', locale)}
            </button>
          </div>
        </MangmeeCard>
      )}

      {detail && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 ref={selectionHeadingRef} tabIndex={-1} className="scroll-mt-24 text-sm font-bold text-gray-700 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">{t('expenses.substitute_wizard.selection_confirm_title', locale)}</h2>
              {!initialExpenseId && !evidenceId && (
                <button type="button" className="text-sm font-bold text-brand-700 hover:text-brand-800" onClick={() => {
                  setDetail(null);
                  setConsent(false);
                  setEntryMode('existing');
                  requestWorkflowFocus('candidate');
                }}>{t('expenses.substitute_wizard.change_expense', locale)}</button>
              )}
            </div>
            {renderPrerequisiteCard()}
            <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} categories={categories} />
            {checkBillRoute && <p className="rounded-xl bg-warning-50 p-3 text-sm leading-6 text-warning-800">{t('expenses.check_bill_new_draft_note', locale)}</p>}
            {selectedExpenseRenderabilityIssue && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-200 bg-warning-50 px-3 py-2">
                <p className="text-xs font-semibold leading-5 text-warning-700">
                  {t('expenses.substitute_wizard.render_limit_action_help', locale)}
                </p>
                <Link className={ghostClass} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>
                  {t('expenses.substitute_wizard.edit_expense_to_split', locale)}
                </Link>
              </div>
            )}
            <MangmeeCard className="border-warning-100 bg-warning-50 p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 text-warning-700">{ICON.alert}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold leading-7 text-warning-800">{t('expenses.substitute_wizard.consent_text', locale)}</p>
                  <details className="mt-2 text-sm text-warning-700">
                    <summary className="min-h-11 cursor-pointer py-2 font-semibold underline underline-offset-2">{t('expenses.substitute_wizard.consent_more', locale)}</summary>
                    <p className="pb-2 leading-6">{t('expenses.substitute_wizard.consent_details', locale)}</p>
                  </details>
                  <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-xl border border-warning-200 bg-white p-3 text-sm font-semibold leading-6 text-gray-800">
                    <input className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]" type="checkbox" required aria-required="true" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                    <span>{t('expenses.substitute_wizard.consent_confirm', locale)}<RequiredMark /></span>
                  </label>
                </div>
              </div>
            </MangmeeCard>
            <div className="flex flex-col items-stretch gap-2 border-t border-gray-100 pt-3 sm:flex-row-reverse sm:items-center sm:justify-start">
              <button type="button" className={cx(btnClass, 'w-full sm:w-auto')} disabled={busy || expenseStepBlockers.length > 0} onClick={() => void run(continueFromExpense)}>{t('expenses.substitute_wizard.continue_to_details', locale)}</button>
              <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={expenseStepBlockers} />
            </div>
          </div>
          <ReadinessCard
            title={t('expenses.substitute_wizard.readiness_title', locale)}
            description={t('expenses.substitute_wizard.readiness_description', locale)}
            completeLabel={t('expenses.substitute_wizard.readiness_ready', locale)}
            incompleteLabel={(count) => t('expenses.substitute_wizard.readiness_missing', locale).replace('{count}', String(count))}
            items={expenseStepReadinessItems}
          />
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
    { label: 'เงินที่ใช้ชำระและยืนยันการจ่ายเต็มจำนวน', complete: Boolean(fundingSource && paidInFullAcknowledged) },
    { label: t('expenses.substitute_wizard.payment_date', locale), complete: !detailsReadiness.missing.includes('paymentDate') },
    ...(recordedPaymentMismatch ? [{ label: 'เลือกใช้ข้อมูลการจ่ายที่บันทึกไว้', complete: false }] : []),
    ...(payeeAddress.trim() ? [{ label: t('expenses.substitute_wizard.payee_address', locale), complete: !detailsReadiness.missing.includes('payeeAddress') }] : []),
    ...(payeeTaxId.trim() ? [{ label: t('expenses.substitute_wizard.payee_tax_id', locale), complete: !detailsReadiness.missing.includes('payeeTaxId') }] : []),
  ] : [];
  const detailsStepBlockers = detailsStepReadinessItems.filter((item) => !item.complete).map((item) => item.label);

  const renderDetailsStep = () => detail && detailsReadiness && (
    <div className="space-y-4">
      <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} categories={categories} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <MangmeeCard className="space-y-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 ref={detailsHeadingRef} tabIndex={-1} className="scroll-mt-24 text-lg font-extrabold text-gray-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">{t('expenses.substitute_wizard.details_title', locale)}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('expenses.substitute_wizard.details_help', locale)}</p>
              </div>
              <RequiredLegend label={t('expenses.substitute_wizard.required_legend', locale)} />
            </div>

            {detail.lines.length > 1 && (
              <p className="rounded-xl border border-brand-100 bg-brand-25 px-3 py-2 text-sm leading-6 text-brand-800">
                {t('expenses.substitute_wizard.multi_item_shared_details', locale)}
              </p>
            )}

            <section className="space-y-4 rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-100 text-sm font-extrabold text-brand-700">1</span>
                <div>
                  <h3 className="font-bold text-gray-900">{t('expenses.substitute_wizard.section_payee', locale)}</h3>
                  <p className="text-xs text-gray-500">{t('expenses.substitute_wizard.section_payee_help', locale)}</p>
                  <p className="mt-2 text-sm text-gray-600">ผู้ขายในค่าใช้จ่าย: {detail.vendorNameSnapshot || 'ยังไม่ระบุ'} · <Link className="underline" href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>แก้ไขข้อมูลผู้ขาย</Link></p>
                  <p className="mt-1 text-xs text-gray-500">ช่องด้านล่างระบุผู้รับเงินจริง ซึ่งอาจเป็นคนละคนกับผู้ขาย การแก้ผู้รับเงินจะใช้กับใบแทนและแบบฟอร์มลงนาม</p>
                  {detail.vendorNameSnapshot && <button type="button" className={`${ghostClass} mt-2`} onClick={() => {
                    if (payeeName.trim() !== detail.vendorNameSnapshot!.trim()) setPayeeAddress('');
                    setPayeeName(detail.vendorNameSnapshot!);
                    setPayeeTaxId(payeeTaxIdDigits(detail.vendorTaxIdSnapshot ?? ''));
                  }}>ใช้ข้อมูลผู้ขายจากค่าใช้จ่าย</button>}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
                  <span className="mb-1 block">{t('expenses.substitute_wizard.payee_name', locale)}<RequiredMark /></span>
                  <input className={inputClass} required maxLength={201} value={payeeName} aria-invalid={Boolean(payeeIdentityIssues.payeeName) || undefined} placeholder={t('expenses.substitute_wizard.payee_name_placeholder', locale)} onChange={(event) => setPayeeName(stripDisallowed(event.target.value))} />
                  {payeeIdentityIssues.payeeName && <p className="mt-1 text-xs text-error-700">{t(PAYEE_ISSUE_KEYS[payeeIdentityIssues.payeeName], locale)}</p>}
                </label>
                <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
                  <span className="mb-1 flex flex-wrap items-center gap-2">{t('expenses.substitute_wizard.payee_address', locale)}<span className="text-xs font-normal text-gray-400">{t('expenses.substitute_wizard.optional_recommended', locale)}</span></span>
                  <textarea className={inputClass} rows={2} maxLength={301} value={payeeAddress} aria-invalid={Boolean(payeeIdentityIssues.payeeAddress) || undefined} onChange={(event) => setPayeeAddress(stripDisallowed(event.target.value))} />
                  {payeeIdentityIssues.payeeAddress && <p className="mt-1 text-xs text-error-700">{t(PAYEE_ISSUE_KEYS[payeeIdentityIssues.payeeAddress], locale)}</p>}
                </label>
                <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
                  <span className="mb-1 flex flex-wrap items-center gap-2">{t('expenses.substitute_wizard.payee_tax_id', locale)}<span className="text-xs font-normal text-gray-400">{t('expenses.substitute_wizard.optional_recommended', locale)}</span></span>
                  <input className={inputClass} inputMode="numeric" placeholder="0-0000-00000-00-0" value={payeeTaxId} aria-invalid={Boolean(payeeIdentityIssues.payeeTaxId) || undefined} onChange={(event) => setPayeeTaxId(payeeTaxIdDigits(event.target.value))} />
                  <p className="mt-1 text-xs font-normal text-gray-500">{t('expenses.substitute_wizard.payee_tax_id_help', locale)}</p>
                  {payeeTaxId.length > 0 && payeeTaxId.length !== 13 && (
                    <p className="mt-1 text-xs text-error-700">{t('expenses.substitute_wizard.payee_tax_id_count', locale).replace('{count}', String(payeeTaxId.length))}</p>
                  )}
                </label>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning-100 text-sm font-extrabold text-warning-700">2</span>
                <div>
                  <h3 className="font-bold text-gray-900">{t('expenses.substitute_wizard.section_reason', locale)}</h3>
                  <p className="text-xs text-gray-500">{t('expenses.substitute_wizard.section_reason_help', locale)}</p>
                </div>
              </div>
              <div className="rounded-xl bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-700">{t('expenses.substitute_wizard.lost_receipt_notice', locale)}</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
                  <span className="mb-1 block">{t('expenses.substitute_wizard.reason_code', locale)}<RequiredMark /></span>
                  <ThemedSelect className={inputClass} required value={reasonCode} aria-label={t('expenses.substitute_wizard.reason_code', locale)} onChange={(event) => setReasonCode(event.target.value as SubstituteReceiptReasonCode)}>
                    {Object.entries(REASON_KEYS).map(([value, key]) => <option key={value} value={value}>{t(key, locale)}</option>)}
                  </ThemedSelect>
                </label>
                <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
                  <span className="mb-1 block">{t('expenses.substitute_wizard.missing_reason', locale)}<RequiredMark /></span>
                  <textarea className={inputClass} required rows={3} maxLength={500} value={missingReason} placeholder={t('expenses.substitute_wizard.missing_reason_placeholder', locale)} onChange={(event) => setMissingReason(stripDisallowed(event.target.value))} />
                  <span className="mt-1 block text-xs font-normal text-gray-500">{t('expenses.substitute_wizard.missing_reason_help', locale)}</span>
                </label>
                <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
                  <span className="mb-1 block">{t('expenses.substitute_wizard.business_purpose', locale)}<RequiredMark /></span>
                  <textarea className={inputClass} required rows={3} maxLength={500} value={businessPurpose} placeholder={t('expenses.substitute_wizard.business_purpose_placeholder', locale)} onChange={(event) => setBusinessPurpose(stripDisallowed(event.target.value))} />
                  <span className="mt-1 block text-xs font-normal text-gray-500">{t('expenses.substitute_wizard.business_purpose_help', locale)}</span>
                </label>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sm font-extrabold text-sky-600">3</span>
                <div>
                  <h3 className="font-bold text-gray-900">{t('expenses.substitute_wizard.section_payment', locale)}</h3>
                  <p className="text-xs text-gray-500">{t('expenses.substitute_wizard.section_payment_help', locale)}</p>
                </div>
              </div>
              <p className="text-sm text-gray-600">วันที่ค่าใช้จ่าย: {dateShort(detail.expenseDate)} · วันที่จ่ายเงินจริงด้านล่างอาจเป็นคนละวัน</p>
              {companyPaymentRecorded && <div className="space-y-2 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">
                <p>รายการนี้บันทึกการจ่ายของบริษัทแล้ว: {dateShort(detail.paidAt)} · {detail.paymentMethod ? t(PAYMENT_KEYS[detail.paymentMethod], locale) : 'ยังไม่ระบุวิธีจ่าย'} ใบแทนใช้ข้อมูลการจ่ายเดียวกัน</p>
                {recordedPaymentMismatch && <button type="button" className={ghostClass} onClick={useRecordedPayment}>ใช้ข้อมูลการจ่ายที่บันทึกไว้</button>}
                <p>หากการจ่ายเดิมผิด ให้ผู้มีสิทธิ์ตรวจแก้รายการจ่ายก่อนลงนาม <Link className="underline" href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>เปิดรายการค่าใช้จ่ายและการจ่าย</Link></p>
              </div>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
<div className="space-y-3 sm:col-span-2">
                  <label className="block text-sm font-semibold">ใช้เงินของใครชำระรายการนี้?
                    <ThemedSelect className={inputClass} required disabled={editingPrepared} aria-label="ใช้เงินของใครชำระรายการนี้?" value={fundingSource} onChange={(event) => { setFundingSource(event.target.value as typeof fundingSource); setPaidInFullAcknowledged(false); }}>
                      <option value="">เลือกเงินที่ใช้ชำระ</option>
                      <option value="COMPANY">เงินของ{policy?.companyName ?? 'บริษัท'} — จ่ายเต็มจำนวน</option>
                      <option value="PERSONAL_ADVANCE">เงินส่วนตัวของพนักงาน — สำรองจ่ายเต็มจำนวน</option>
                    </ThemedSelect>
                  </label>
                  <p className="text-sm text-gray-600">บริษัทในเอกสาร: {policy?.companyName ?? 'กำลังโหลดชื่อบริษัท'} <button type="button" className="underline" onClick={() => window.location.reload()}>โหลดข้อมูลล่าสุด</button></p>
                  {policy?.companyNameSource === 'DISPLAY_NAME' && <p className="text-xs text-warning-700">ยังไม่มีชื่อจดทะเบียนที่บันทึกไว้ กรุณาตรวจข้อมูลบริษัทก่อนลงนาม</p>}
                  {detail && <p className="text-sm text-gray-600">ยอดรวม {Number(detail.grandTotalAmount).toLocaleString('th-TH')} บาท · หัก ณ ที่จ่าย {Number(detail.whtAmount).toLocaleString('th-TH')} บาท · สุทธิจ่ายร้าน {Number(detail.netPayableAmount).toLocaleString('th-TH')} บาท{fundingSource === 'COMPANY' && (Number(detail.paidAmount) === 0 ? ' — เมื่อออกใบรับรองจะบันทึกการจ่ายเต็มยอดครั้งแรก' : Number(detail.outstandingAmount) <= 0 ? ' — บริษัทบันทึกจ่ายเต็มแล้ว จะไม่เพิ่มการจ่ายซ้ำ' : ' — มีการบันทึกจ่ายบางส่วนแล้ว ไม่รองรับในขั้นตอนนี้')}</p>}
                  <label className="flex cursor-pointer items-start gap-3 text-sm leading-6"><input className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]" type="checkbox" disabled={editingPrepared} checked={paidInFullAcknowledged} onChange={event => setPaidInFullAcknowledged(event.target.checked)} /><span>ยืนยันว่าใช้เงินที่เลือกชำระเต็มจำนวนแล้ว ไม่มีการแบ่งจ่าย</span></label>
                  {fundingSource === 'PERSONAL_ADVANCE' && <p className="text-sm text-gray-600">การออกใบรับรองยังไม่บันทึกว่าบริษัทจ่ายคืนให้พนักงาน</p>}
                </div>

                <label className="block text-sm font-semibold text-gray-700">
                  <span className="mb-1 block">{t('expenses.substitute_wizard.payment_method', locale)}<RequiredMark /></span>
                  <ThemedSelect className={inputClass} required disabled={companyPaymentRecorded && Boolean(detail.paymentMethod)} value={paymentMethod} aria-label={t('expenses.substitute_wizard.payment_method', locale)} onChange={(event) => setPaymentMethod(event.target.value as ExpensePaymentMethod)}>
                    {Object.entries(PAYMENT_KEYS).map(([value, key]) => <option key={value} value={value}>{t(key, locale)}</option>)}
                  </ThemedSelect>
                </label>
                <label className="block text-sm font-semibold text-gray-700">
                  <span className="mb-1 block">{t('expenses.substitute_wizard.payment_date', locale)}<RequiredMark /></span>
                  <ThemedDate className={inputClass} required disabled={companyPaymentRecorded && Boolean(detail.paidAt)} value={paymentDate} aria-label={t('expenses.substitute_wizard.payment_date', locale)} onChange={(event) => setPaymentDate(event.target.value)} />
                </label>
              </div>
            </section>
          </MangmeeCard>
          {renderPrerequisiteCard()}
          <div className="flex flex-col gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className={ghostClass} disabled={busy} onClick={() => { if (editingPrepared) cancelPreparedEdit(); else { setActiveStep('expense'); requestWorkflowFocus('selection'); } }}>{t('expenses.substitute_wizard.back', locale)}</button>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row-reverse sm:items-center">
              <button type="button" className={btnClass} disabled={busy || detailsStepBlockers.length > 0} onClick={() => void run(continueFromDetails)}>{t('expenses.substitute_wizard.continue_to_evidence', locale)}</button>
              <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={detailsStepBlockers} />
            </div>
          </div>
        </div>
        <ReadinessCard
          title={t('expenses.substitute_wizard.readiness_title', locale)}
          description={t('expenses.substitute_wizard.readiness_description', locale)}
          completeLabel={t('expenses.substitute_wizard.readiness_ready', locale)}
          incompleteLabel={(count) => t('expenses.substitute_wizard.readiness_missing', locale).replace('{count}', String(count))}
          items={detailsStepReadinessItems}
        />
      </div>
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
    const attachments = detail?.attachments.filter((attachment) => attachment.status === 'ACTIVE'
      && (purpose === 'expense.payment.evidence'
        ? attachment.purpose === purpose && !detail?.attachments.some((source) => source.id === attachment.id && source.purpose !== purpose)
          && (attachment.mimeType.startsWith('image/') || attachment.mimeType === 'application/pdf')
        : attachment.purpose !== 'expense.payment.evidence' && attachment.purpose !== 'expense.review.evidence')) ?? [];
    const selectedCount = attachments.filter((attachment) => ids.includes(attachment.id)).length;
    return (
      <MangmeeCard className={cx('space-y-4 p-5', required ? 'border-brand-100' : 'border-gray-200')}>
        <div className="flex items-start justify-between gap-3">
          <div>
          <h2 className="font-bold text-gray-900">{t(titleKey, locale)}{required && <RequiredMark />}</h2>
          <p className="mt-1 text-sm text-gray-500">{t(helpKey, locale)}</p>
          </div>
          <MangmeeBadge tone={selectedCount > 0 ? 'brand' : required ? 'amber' : 'slate'}>
            {selectedCount > 0
              ? t('expenses.substitute_wizard.file_count', locale).replace('{count}', String(selectedCount))
              : t(required ? 'expenses.substitute_wizard.required_badge' : 'expenses.substitute_wizard.optional_badge', locale)}
          </MangmeeBadge>
        </div>
        {attachments.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">{t('expenses.substitute_wizard.available_files', locale)}</p>
            {attachments.map((attachment) => (
              <div key={attachment.id} className={cx(
                'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition',
                ids.includes(attachment.id) ? 'border-brand-200 bg-brand-25 text-gray-800' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
              )}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 leading-6">
                  <input className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]" type="checkbox" checked={ids.includes(attachment.id)} onChange={(event) => {
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
                  <span className="text-brand-700">{ICON.file}</span>
                  <span className="min-w-0 flex-1 truncate">{attachment.originalFileName}</span>
                  {ids.includes(attachment.id) && <span className="text-xs font-bold text-brand-700">✓</span>}
                </label>
                <button
                  type="button"
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  disabled={busy}
                  onClick={() => void run(() => openEvidenceAttachment(attachment))}
                >
                  {ICON.eye}<span>{t('expenses.substitute_wizard.open_document', locale)}</span>
                </button>
              </div>
            ))}
          </div>
        )}
        {/* Picking a file uploads it. The picker renders the chosen name with a clear button
            and an upload glyph, so a staged-but-unsent file read as done — people filled both
            panels, saw the readiness card still short one item, and had no way to tell why.
            The staged file now only survives a failed upload, which is what the button retries. */}
        {canUploadEvidence ? <div className="rounded-xl border border-dashed border-brand-200 bg-brand-25 p-3">
          <ThemedFile
            file={file}
            accept={ATTACHMENT_UPLOAD_ACCEPT}
            placeholder={t('expenses.substitute_wizard.file_types', locale)}
            aria-label={t(titleKey, locale)}
            disabled={busy}
            onChange={(next) => {
              setFile(next);
              if (next) void run(() => uploadEvidence(purpose, next));
            }}
          />
          {file && (
            <button type="button" className={cx(ghostClass, 'mt-3 w-full justify-center')} disabled={busy} onClick={() => void run(() => uploadEvidence(purpose))}>{t('expenses.substitute_wizard.add_file', locale)}</button>
          )}
        </div> : <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">{t('expenses.substitute_wizard.upload_forbidden', locale)}</p>}
        {purpose === 'expense.payment.evidence' && paymentMethod === 'CASH' && (
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-sm text-gray-500">{t('expenses.substitute_wizard.payment_voucher_help', locale)}</p>
            <button type="button" className={cx(ghostClass, 'mt-3')} disabled={busy} onClick={() => void run(downloadPaymentVoucher)}>
              <span className="inline-flex items-center gap-2">{ICON.download}{t('expenses.substitute_wizard.payment_voucher_action', locale)}</span>
            </button>
          </div>
        )}
      </MangmeeCard>
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
    ...(expenseIneligible ? [{ label: t('expenses.substitute_wizard.expense_ineligible', locale), complete: false }] : []),
    { label: t('expenses.substitute_wizard.readiness_reviewed_amount', locale), complete: !expensePrerequisites?.missing.includes('reviewedAmount') },
    { label: t('expenses.substitute_wizard.readiness_reviewed_category', locale), complete: !expensePrerequisites?.missing.includes('reviewedCategory') },
    { label: t('expenses.substitute_wizard.readiness_policy', locale), complete: !evidenceReadiness.missing.includes('policy') },
    { label: requiresPaymentEvidence ? t('expenses.substitute_wizard.payment_evidence_title', locale) : t('expenses.substitute_wizard.payment_evidence_optional_short', locale), complete: !evidenceReadiness.missing.includes('paymentEvidence') },
    { label: t('expenses.substitute_wizard.readiness_renderable', locale), complete: !evidenceReadiness.missing.includes('renderability') },
  ];
  const evidenceStepBlockers = evidenceStepReadinessItems.filter((item) => !item.complete).map((item) => item.label);

  const renderEvidenceStep = () => detail && (
    <div className="space-y-4">
      <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} categories={categories} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <MangmeeCard className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-gray-900">{t('expenses.substitute_wizard.evidence_page_title', locale)}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('expenses.substitute_wizard.evidence_page_help', locale)}</p>
              </div>
              <RequiredLegend label={t('expenses.substitute_wizard.required_legend', locale)} />
            </div>
          </MangmeeCard>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
          {paymentMethod === 'CASH' && policy?.cashEvidenceInstructions && (
            <MangmeeCard className="p-4 text-sm leading-6 text-gray-600">{policy.cashEvidenceInstructions}</MangmeeCard>
          )}
          {!policy?.ready && <ErrorBanner message={t('expenses.substitute_wizard.policy_not_ready', locale)} />}
          {selectedEvidenceRenderabilityIssue && (
            <ErrorBanner message={evidenceRenderabilityIssueMessage(selectedEvidenceRenderabilityIssue, locale)} />
          )}
          <p className="rounded-xl bg-gray-50 px-3 py-2 text-xs leading-5 text-gray-500">
            {t('expenses.substitute_wizard.evidence_limit_help', locale)
              .replace('{count}', String(SUBSTITUTE_RECEIPT_RENDERABILITY_LIMITS.maxEvidenceAttachments))}
          </p>
          {renderPrerequisiteCard()}
          <div className="flex flex-col gap-3 border-t border-gray-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" className={ghostClass} disabled={busy} onClick={() => setActiveStep('details')}>{t('expenses.substitute_wizard.back', locale)}</button>
            <div className="flex flex-col items-stretch gap-2 sm:flex-row-reverse sm:items-center">
              <button type="button" className={btnClass} disabled={busy || evidenceStepBlockers.length > 0} onClick={() => editingPrepared ? void run(prepare) : setActiveStep('method')}>{editingPrepared ? 'บันทึกและกลับไปลงนาม' : 'ถัดไป: เลือกวิธีลงนาม'}</button>
              <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={evidenceStepBlockers} />
            </div>
          </div>
          <p className="text-xs font-medium leading-5 text-gray-500 sm:text-right">{editingPrepared ? 'เลขเอกสารใช้เดือนที่จ่ายเงิน หากแก้ข้อมูลให้ใช้ฟอร์มล่าสุดลงนาม' : 'เลือกลงนามออนไลน์ หรือพิมพ์ให้กรอกและเซ็นบนกระดาษ'}</p>
        </div>
        <ReadinessCard
          title={t('expenses.substitute_wizard.readiness_title', locale)}
          description={t('expenses.substitute_wizard.evidence_readiness_description', locale)}
          completeLabel={t('expenses.substitute_wizard.readiness_ready', locale)}
          incompleteLabel={(count) => t('expenses.substitute_wizard.readiness_missing', locale).replace('{count}', String(count))}
          items={evidenceStepReadinessItems}
        />
      </div>
    </div>
  );

  const renderMethodStep = () => <MangmeeCard className="space-y-5 p-5">
    <h2 className="text-xl font-bold">เลือกวิธีลงนาม</h2>
    <p className="text-sm text-gray-600">ข้อมูลและหลักฐานพร้อมแล้ว เลือกวิธีที่ผู้รับรองการจ่ายและผู้อนุมัติจะใช้กับเอกสารฉบับนี้</p>
    <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">วิธีลงนาม</legend>
      <label className={cx('cursor-pointer rounded-2xl border p-4', signingMethod === 'DIGITAL' ? 'border-brand-500 bg-brand-50' : 'border-gray-200')}>
        <input type="radio" name="signing-method" value="DIGITAL" checked={signingMethod === 'DIGITAL'} onChange={() => setSigningMethod('DIGITAL')} /> <span className="font-bold">ลงนามออนไลน์</span>
        <span className="mt-2 block text-sm">ผู้รับรองและผู้อนุมัติเข้าบัญชีของตนเองเพื่อตรวจและลงนาม</span>
      </label>
      <label className={cx('cursor-pointer rounded-2xl border p-4', signingMethod === 'PAPER' ? 'border-brand-500 bg-brand-50' : 'border-gray-200')}>
        <input type="radio" name="signing-method" value="PAPER" checked={signingMethod === 'PAPER'} onChange={() => setSigningMethod('PAPER')} /> <span className="font-bold">พิมพ์และเซ็นบนกระดาษ</span>
        <span className="mt-2 block text-sm">เว้นชื่อ ตำแหน่ง และลายเซ็นให้กรอกเอง รองรับคนไม่มีบัญชี จากนั้นอัปโหลดฉบับลงนามครบเพื่อตรวจรับ</span>
      </label>
    </fieldset>
    {signingMethod === 'DIGITAL' && <div>                <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
                  <span className="mb-1 block">{t('expenses.substitute_wizard.payer', locale)}<RequiredMark /></span>
                  <ThemedSelect className={inputClass} required value={payerId} aria-label={t('expenses.substitute_wizard.payer', locale)} onChange={(event) => setPayerId(event.target.value)} disabled={payersLoading}>
                    <option value="">{t('expenses.substitute_wizard.select_payer', locale)}</option>
                    {payers.map((payer) => <option key={payer.userId} value={payer.userId}>{payer.displayName}</option>)}
                  </ThemedSelect>
                  <span className="mt-1 block text-xs font-normal text-gray-500">{t('expenses.substitute_wizard.payer_help', locale)}</span>
                  {fundingSource && <span className="mt-1 block text-xs font-normal text-gray-500">{t(fundingSource === 'COMPANY' ? 'expenses.substitute_wizard.company_payer_help' : 'expenses.substitute_wizard.personal_payer_help', locale)}</span>}
                  {payersLoading && <p className="mt-1 text-xs text-gray-500">{t('expenses.substitute_wizard.payers_loading', locale)}</p>}
                  {!payersLoading && payers.length === 0 && <p className="mt-2 rounded-xl border border-warning-100 bg-warning-50 px-3 py-2 text-xs font-normal leading-5 text-warning-700">{t('expenses.substitute_wizard.payer_empty', locale)}</p>}
                </label></div>}
    {signingMethod === 'PAPER' && <p className="rounded-xl bg-sky-50 p-4 text-sm leading-6">กรอกชื่อและเซ็นทั้งผู้รับรองการจ่ายและผู้อนุมัติบนกระดาษให้ครบ ผู้จัดทำอัปโหลดแทนได้ ผู้มีสิทธิ์ของบริษัทจะตรวจรับอีกครั้งก่อนเป็นเอกสารฉบับสมบูรณ์</p>}
    <div className="flex flex-wrap gap-3"><button type="button" className={ghostClass} disabled={busy} onClick={() => setActiveStep('evidence')}>ย้อนกลับ: หลักฐาน</button>
      <button type="button" className={btnClass} disabled={busy || !signingMethod || (signingMethod === 'DIGITAL' && (!payerId || payersLoading))} onClick={() => void run(prepare)}>{!signingMethod ? 'เลือกวิธีลงนามก่อน' : signingMethod === 'PAPER' ? 'เตรียมแบบฟอร์มสำหรับเซ็นบนกระดาษ' : 'เริ่มลงนามออนไลน์'}</button></div>
    <p className="text-xs text-gray-500">เมื่อเริ่มแล้ว ข้อมูลและวิธีลงนามจะถูกผูกกับเวอร์ชันนี้ หากต้องเปลี่ยนให้ยกเลิกและจัดทำเวอร์ชันใหม่</p>
  </MangmeeCard>;

  const renderWaiting = (message: string) => (
    <div className="space-y-4">
      <MangmeeCard className="border-warning-100 bg-warning-50 p-5">
        <h2 className="font-bold text-warning-700">{message}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('expenses.substitute_wizard.waiting_help', locale)}</p>
        <button type="button" className={cx(ghostClass, 'mt-4')} onClick={() => void copyWizardLink()}>{copied ? t('expenses.substitute_wizard.link_copied', locale) : t('expenses.substitute_wizard.copy_link', locale)}</button>
      </MangmeeCard>
      {detail && <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} categories={categories} />}
      {receiptEvidence && (
        <div className="grid gap-4 lg:grid-cols-2">
          {renderReadOnlySummary('details')}
          {renderReadOnlySummary('evidence')}
        </div>
      )}
    </div>
  );

  const renderCertifyStep = () => {
    if (!receiptEvidence) return null;
    if (receiptEvidence.signatureMode === 'PAPER' && !receiptEvidence.payerUserId) return <SubstitutePaperSigningPanel key={receiptEvidence.id}
      companyId={companyId} evidence={receiptEvidence} canPrepare={canReview} canAccept={mayApprove && policy?.canApproveForCompany !== false}
      allowSamePerson={policy?.approvalMode === 'OWNER_SELF' && canSelfApprove}
      onChange={(updated) => { setReceiptEvidence(updated); setActiveStep(resolveWizardStep(updated)); void getExpense(companyId, updated.expenseId).then(setDetail); }} />;
    if (receiptEvidence.payerUserId !== userId) {
      return renderWaiting(t('expenses.substitute_wizard.waiting_payer', locale).replace('{name}', receiptEvidence.payerName));
    }
    const signingReadiness = evaluateSigningReadiness({
      previewed: Boolean(previewChecksum),
      signatureReady: paperSignature || signatureSource !== 'none',
      acknowledged: certificationAcknowledged,
    });
    const certifyItems = [
      ...(paperSignature ? [] : [{ label: t('expenses.substitute_wizard.signature_title', locale), complete: !signingReadiness.missing.includes('signature') }]),
      { label: t('expenses.substitute_wizard.preview_document', locale), complete: !signingReadiness.missing.includes('preview') },
      { label: t('expenses.substitute_wizard.acknowledgement_short', locale), complete: !signingReadiness.missing.includes('acknowledgement') },
    ];
    const certifyBlockers = certifyItems.filter((item) => !item.complete).map((item) => item.label);
    return (
      <div className="space-y-4">
        {ownerSelfCollapse && (
          <MangmeeCard className="p-4">
            <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.combined_title', locale)}</h2>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-brand-50 px-3 py-2 font-semibold text-brand-700">{t('expenses.substitute_wizard.combined_sign', locale)}</div>
              <div className="rounded-lg bg-gray-50 px-3 py-2 font-semibold text-gray-500">{t('expenses.substitute_wizard.combined_approve', locale)}</div>
            </div>
          </MangmeeCard>
        )}
        {detail && <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} categories={categories} />}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <MangmeeCard className="space-y-5 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-gray-900">{t('expenses.substitute_wizard.certify_title', locale)}</h2>
                  <p className="mt-1 text-sm text-gray-500">{t('expenses.substitute_wizard.certify_help', locale)}</p>
                </div>
                <RequiredLegend label={t('expenses.substitute_wizard.required_legend', locale)} />
              </div>
              <label className="block rounded-2xl border border-gray-200 p-4 text-sm font-semibold text-gray-700">
                <span className="mb-1 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-xs font-extrabold text-brand-700">1</span>{t('expenses.substitute_wizard.payer_position', locale)}</span>
                <SubstituteSignerPositionField className={inputClass} value={signerPosition} jobTitle={policy?.signerJobTitle} onChange={(value) => { setSignerPosition(stripDisallowed(value)); setPreviewChecksum(null); setCertifiedPreviewed(false); }} />
                <span className="mt-1 block text-xs font-normal text-gray-500">{t('expenses.substitute_wizard.position_help', locale)}</span>
              </label>
              <div className="rounded-2xl border border-gray-200 p-4">
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-xs font-extrabold text-brand-700">2</span>{t('expenses.substitute_wizard.signature_title', locale)}{!paperSignature && <RequiredMark />}</p>
                {paperSignature
                  ? <p className="text-sm leading-6 text-gray-600">{t('expenses.substitute_wizard.paper_signature_notice', locale)}</p>
                  : <SignatureFields key="certify" signatureFile={signatureFile} signaturePreview={signaturePreview} busy={busy} savedSignatureAvailable={policy?.hasReusableSignature ?? false} savedSignatureUsed={signatureSource === 'signature_library'} savedSignaturePreviewUrl={policy?.reusableSignaturePreviewUrl ?? null} onSelect={selectSignatureFile} onDrawChange={setSignatureDrawn} onClean={() => void run(buildTransparentSignature)} onDrawn={selectDrawnSignature} />}
              </div>
              <div className="rounded-2xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold text-gray-700"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-xs font-extrabold text-brand-700">3</span>{t('expenses.substitute_wizard.preview_document', locale)}<RequiredMark /></p>
                  {previewChecksum && <MangmeeBadge tone="brand">{t('expenses.substitute_wizard.reviewed_badge', locale)}</MangmeeBadge>}
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-500">{t('expenses.substitute_wizard.preview_help', locale)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={previewChecksum ? ghostClass : btnClass} disabled={busy} onClick={() => void run(previewPrepared)}>
                    <span className="inline-flex items-center gap-2">{ICON.eye}{t('expenses.substitute_wizard.preview_document', locale)}</span>
                  </button>
                  {/* R8: the printable route out of this step — same document, both signature boxes
                      blank, UNSIGNED watermark. Not a preview and not the issued certificate. */}
                  <button type="button" className={ghostClass} disabled={busy} onClick={() => void run(() => downloadSubstituteReceiptFormPdf(companyId, receiptEvidence.expenseId, receiptEvidence.id, receiptEvidence.documentNumber))}>
                    <span className="inline-flex items-center gap-2">{ICON.download}{t('expenses.substitute_wizard.download_form', locale)}</span>
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-gray-500">{t('expenses.substitute_wizard.download_form_help', locale)}</p>
              </div>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm font-semibold leading-6 text-gray-800">
                <input className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]" type="checkbox" required aria-required="true" checked={certificationAcknowledged} onChange={(event) => setCertificationAcknowledged(event.target.checked)} />
                <span>{t('expenses.substitute_wizard.certify_acknowledgement', locale)}<RequiredMark /></span>
              </label>
              <div className="flex flex-col items-stretch gap-2 border-t border-gray-100 pt-4 sm:flex-row-reverse sm:items-center sm:justify-start">
                <button type="button" className={btnClass} disabled={busy || certifyBlockers.length > 0} onClick={() => void run(certify)}>{t('expenses.substitute_wizard.certify_action', locale)}</button>
                <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={certifyBlockers} />
              </div>
              <p className="text-xs font-medium leading-5 text-gray-500 sm:text-right">{t('expenses.substitute_wizard.next_step_approve', locale)}</p>
            </MangmeeCard>
          </div>
          <ReadinessCard
            title={t('expenses.substitute_wizard.readiness_title', locale)}
            description={t('expenses.substitute_wizard.signing_readiness_description', locale)}
            completeLabel={t('expenses.substitute_wizard.readiness_ready', locale)}
            incompleteLabel={(count) => t('expenses.substitute_wizard.readiness_missing', locale).replace('{count}', String(count))}
            items={certifyItems}
          />
        </div>
      </div>
    );
  };

  const renderApproveStep = () => {
    if (!receiptEvidence) return null;
    if (!mayApprove) return renderWaiting(t('expenses.substitute_wizard.waiting_approver', locale));
    const approvalReadiness = evaluateSigningReadiness({
      previewed: certifiedPreviewed,
      signatureReady: paperSignature || signatureSource !== 'none',
      acknowledged: approvalAcknowledged,
    });
    const approveItems = [
      ...(paperSignature ? [] : [{ label: t('expenses.substitute_wizard.signature_title', locale), complete: !approvalReadiness.missing.includes('signature') }]),
      { label: t('expenses.substitute_wizard.open_certified', locale), complete: !approvalReadiness.missing.includes('preview') },
      { label: t('expenses.substitute_wizard.acknowledgement_short', locale), complete: !approvalReadiness.missing.includes('acknowledgement') },
    ];
    const approveBlockers = approveItems.filter((item) => !item.complete).map((item) => item.label);
    return (
      <div className="space-y-4">
        {ownerSelfCollapse && (
          <MangmeeCard className="p-4">
            <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.combined_title', locale)}</h2>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-lg bg-brand-50 px-3 py-2 font-semibold text-brand-700">{t('expenses.substitute_wizard.combined_sign_done', locale)}</div>
              <div className="rounded-lg bg-brand-50 px-3 py-2 font-semibold text-brand-700">{t('expenses.substitute_wizard.combined_approve', locale)}</div>
            </div>
          </MangmeeCard>
        )}
        {detail && <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} categories={categories} />}
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <MangmeeCard className="space-y-5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-extrabold text-gray-900">{t('expenses.substitute_wizard.approve_title', locale)}</h2>
                <p className="mt-1 text-sm text-gray-500">{t('expenses.substitute_wizard.approve_help', locale)}</p>
              </div>
              <RequiredLegend label={t('expenses.substitute_wizard.required_legend', locale)} />
            </div>
            <label className="block rounded-2xl border border-gray-200 p-4 text-sm font-semibold text-gray-700">
              <span className="mb-1 flex items-center gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-xs font-extrabold text-brand-700">1</span>{t('expenses.substitute_wizard.approver_position', locale)}</span>
              {/* Same rule as the payer step: editing the position invalidates the reviewed badge. */}
              <SubstituteSignerPositionField className={inputClass} value={signerPosition} jobTitle={policy?.signerJobTitle} onChange={(value) => { setSignerPosition(stripDisallowed(value)); setPreviewChecksum(null); setCertifiedPreviewed(false); }} />
              <span className="mt-1 block text-xs font-normal text-gray-500">{t('expenses.substitute_wizard.position_help', locale)}</span>
            </label>
            <div className="rounded-2xl border border-gray-200 p-4">
              <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-xs font-extrabold text-brand-700">2</span>{t('expenses.substitute_wizard.signature_title', locale)}{!paperSignature && <RequiredMark />}</p>
              {paperSignature
                ? <p className="text-sm leading-6 text-gray-600">{t('expenses.substitute_wizard.paper_signature_notice', locale)}</p>
                : <SignatureFields key="approve" signatureFile={signatureFile} signaturePreview={signaturePreview} busy={busy} savedSignatureAvailable={policy?.hasReusableSignature ?? false} savedSignatureUsed={signatureSource === 'signature_library'} savedSignaturePreviewUrl={policy?.reusableSignaturePreviewUrl ?? null} onSelect={selectSignatureFile} onDrawChange={setSignatureDrawn} onClean={() => void run(buildTransparentSignature)} onDrawn={selectDrawnSignature} />}
            </div>
            <div className="rounded-2xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-gray-700"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-100 text-xs font-extrabold text-brand-700">3</span>{t('expenses.substitute_wizard.open_certified', locale)}<RequiredMark /></p>
                {certifiedPreviewed && <MangmeeBadge tone="brand">{t('expenses.substitute_wizard.reviewed_badge', locale)}</MangmeeBadge>}
              </div>
              <button type="button" className={cx(certifiedPreviewed ? ghostClass : btnClass, 'mt-3')} disabled={busy || !receiptEvidence.certifiedArtifactAttachmentId} onClick={() => void run(() => openArtifact(receiptEvidence.certifiedArtifactAttachmentId, true))}>
                <span className="inline-flex items-center gap-2">{ICON.eye}{t('expenses.substitute_wizard.open_certified', locale)}</span>
              </button>
              {!receiptEvidence.certifiedArtifactAttachmentId && (
                <p className="mt-2 text-xs font-semibold leading-5 text-warning-700">{t('expenses.substitute_wizard.document_not_ready', locale)}</p>
              )}
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-warning-100 bg-warning-50 p-4 text-sm font-semibold leading-6 text-gray-800">
              <input className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-600)]" type="checkbox" required aria-required="true" checked={approvalAcknowledged} onChange={(event) => setApprovalAcknowledged(event.target.checked)} />
              <span>{t('expenses.substitute_wizard.approve_acknowledgement', locale)}<RequiredMark /></span>
            </label>
            <div className="flex flex-col items-stretch gap-2 border-t border-gray-100 pt-4 sm:flex-row-reverse sm:items-center sm:justify-start">
              <button type="button" className={btnClass} disabled={busy || approveBlockers.length > 0} onClick={() => void run(approve)}>{t('expenses.substitute_wizard.approve_action', locale)}</button>
              <BlockedReason prefix={t('expenses.substitute_wizard.blocked_prefix', locale)} labels={approveBlockers} />
            </div>
          </MangmeeCard>
          <ReadinessCard
            title={t('expenses.substitute_wizard.readiness_title', locale)}
            description={t('expenses.substitute_wizard.approval_readiness_description', locale)}
            completeLabel={t('expenses.substitute_wizard.readiness_ready', locale)}
            incompleteLabel={(count) => t('expenses.substitute_wizard.readiness_missing', locale).replace('{count}', String(count))}
            items={approveItems}
          />
        </div>
      </div>
    );
  };

  const renderDoneStep = () => receiptEvidence && detail && (
    <div className="space-y-4">
      <MangmeeCard className="overflow-hidden border-brand-100 p-0 text-center">
        <div className="bg-brand-25 px-5 py-8 sm:px-8">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600 text-3xl font-extrabold text-white shadow-lg">✓</span>
          <MangmeeBadge className="mt-4" tone={receiptEvidence.status === 'ISSUED' ? 'brand' : 'slate'}>
            {t(receiptEvidence.status === 'ISSUED' ? 'expenses.substitute_hub.status_issued' : 'expenses.substitute_hub.status_superseded', locale)}
          </MangmeeBadge>
          <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-gray-900">{t(receiptEvidence.status === 'ISSUED' ? 'expenses.substitute_wizard.done_title' : 'expenses.substitute_hub.status_superseded', locale)}</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">{receiptEvidence.status === 'ISSUED' && receiptEvidence.fundingSource === 'PERSONAL_ADVANCE' ? 'จัดเก็บใบรับรองพร้อมลายมือชื่อแล้ว เอกสารระบุว่าพนักงานใช้เงินส่วนตัวจ่ายเต็มจำนวน' : t(receiptEvidence.status === 'ISSUED' ? 'expenses.substitute_wizard.done_help' : 'expenses.substitute_wizard.superseded', locale)}</p>
          <p className="mx-auto mt-4 w-fit rounded-xl border border-brand-100 bg-white px-4 py-2 font-mono text-lg font-extrabold text-gray-900 shadow-sm">{receiptEvidence.documentNumber}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            {receiptEvidence.artifactAttachmentId && (
              <button type="button" className={btnClass} disabled={busy} onClick={() => void run(() => downloadSubstituteReceiptPdf(companyId, detail.id, receiptEvidence.id, receiptEvidence.documentNumber))}>
                <span className="inline-flex items-center gap-2">{ICON.download}{t('expenses.substitute.download_pdf', locale)}</span>
              </button>
            )}
            {receiptEvidence.artifactAttachmentId && (
              <button type="button" className={ghostClass} disabled={busy} onClick={() => void run(openIssuedPdf)}>
                <span className="inline-flex items-center gap-2">{ICON.eye}{t('expenses.substitute_wizard.open_document', locale)}</span>
              </button>
            )}
            <Link className={ghostClass} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>{t(receiptEvidence.status === 'ISSUED' && receiptEvidence.fundingSource !== 'PERSONAL_ADVANCE' ? 'expenses.substitute_wizard.back_to_expense' : 'expenses.substitute_wizard.view_expense', locale)}</Link>
          </div>
          {/* The issued file is offered only once it exists; when it does not, say so rather than
              leaving the row of actions one button short with no explanation. */}
          {receiptEvidence.status === 'ISSUED' && !receiptEvidence.artifactAttachmentId && (
            <p className="mt-4 text-sm font-semibold leading-6 text-warning-700">{t('expenses.substitute_wizard.document_not_ready', locale)}</p>
          )}
        </div>
        {receiptEvidence.status === 'ISSUED' && receiptEvidence.fundingSource === 'PERSONAL_ADVANCE' && <div className="border-t border-gray-100 p-5"><p className="text-sm">ใบรับรองระบุว่าพนักงานจ่ายร้านเต็มจำนวนแล้ว การออกใบรับรองยังไม่ถือว่าบริษัทจ่ายคืนให้พนักงาน</p></div>}
        {receiptEvidence.status === 'ISSUED' && receiptEvidence.fundingSource !== 'PERSONAL_ADVANCE' && <div className="grid gap-px border-t border-gray-100 bg-gray-100 text-left sm:grid-cols-3">
          {([
            ['1', 'expenses.substitute_wizard.done_next_store'],
            ['2', 'expenses.substitute_wizard.done_next_confirm'],
            ['3', 'expenses.substitute_wizard.done_next_retain'],
          ] as const).map(([number, key]) => (
            <div key={key} className="flex items-start gap-3 bg-white p-4 text-sm leading-5 text-gray-600">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-100 text-xs font-extrabold text-brand-700">{number}</span>
              {t(key, locale)}
            </div>
          ))}
        </div>}
      </MangmeeCard>
    </div>
  );

  // A prepared/certified version may also need correction before anyone can safely sign it.
  // Keep the existing permission, source-state and reason guards on every wizard stage.
  const canChangePayer = canReview && receiptEvidence && !receiptEvidence.correctionOfEvidenceId
    && ['PREPARED', 'PAYER_CERTIFIED'].includes(receiptEvidence.status)
    && detail && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status);
  const renderVersionHistory = () => receiptEvidence && detail && (
      <details ref={versionHistoryRef} className="rounded-2xl border border-gray-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-gray-900">{t('expenses.substitute_wizard.history_title', locale)}</summary>
        <div className="mt-4 space-y-3">
          <ul className="space-y-2 text-sm text-gray-600">
            {history.map((item) => (
              <li key={item.id} className="rounded-lg bg-gray-50 px-3 py-2">
                {t('expenses.substitute_wizard.version', locale).replace('{version}', String(item.version))} · {item.documentNumber} · {t(item.status === 'ISSUED' ? 'expenses.substitute_hub.status_issued' : item.status === 'SUPERSEDED' ? 'expenses.substitute_hub.status_superseded' : item.status === 'PAYER_CERTIFIED' ? 'expenses.substitute_hub.status_payer_certified' : 'expenses.substitute_hub.status_prepared', locale)}
                {item.supersedeReason ? ` · ${item.supersedeReason}` : ''}
              </li>
            ))}
          </ul>
          {canReview && receiptEvidence.status === 'ISSUED' && detail.status !== 'VOIDED' && <div className="space-y-2 border-t border-gray-100 pt-3">
            <label className="block text-sm font-semibold">เหตุผลแก้ชื่อบริษัทหรือตำแหน่ง
              <textarea className={inputClass} maxLength={500} value={supersedeReason} onChange={event => setSupersedeReason(stripDisallowed(event.target.value))} />
            </label>
            <p className="text-xs text-gray-600">คงเอกสารเดิม ยอดจ่าย และบัญชีไว้ ผู้ลงนามเดิมตรวจและลงนามฉบับแก้อีกครั้ง</p>
            <button type="button" className={ghostClass} disabled={busy || !supersedeReason.trim()} onClick={() => void run(async () => {
              const next = await correctSubstituteDocument(companyId, detail.id, receiptEvidence.id, { reason: supersedeReason.trim(), expectedEvidenceUpdatedAt: receiptEvidence.updatedAt });
              setReceiptEvidence(next); setActiveStep('certify'); setSignerPosition('');
              router.push(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(next.id)}`);
            })}>แก้เฉพาะชื่อ/ตำแหน่ง</button>
          </div>}
          {canReview && receiptEvidence.status !== 'SUPERSEDED' && (['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status) || (receiptEvidence.correctionOfEvidenceId && receiptEvidence.status !== 'ISSUED')) && (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              {canChangePayer && <p className="text-sm text-gray-600">{receiptEvidence.signatureMode === 'PAPER' && !receiptEvidence.payerUserId ? 'แก้ข้อมูลและหลักฐานได้ด้วยปุ่มแก้ไขข้อมูลใบแทน ส่วนการเปลี่ยนวิธีลงนามใช้การยกเลิกเวอร์ชันนี้ก่อน' : t('expenses.substitute_wizard.change_payer_help', locale)}</p>}
              <label className="block text-sm font-semibold text-gray-700">
                <span className="mb-1 block">{t('expenses.substitute_wizard.supersede_reason', locale)}<RequiredMark /></span>
                <textarea ref={supersedeReasonRef} className={inputClass} required rows={3} maxLength={500} value={supersedeReason} onChange={(event) => setSupersedeReason(stripDisallowed(event.target.value))} />
              </label>
              <button type="button" className={ghostClass} disabled={busy || !supersedeReason.trim()} onClick={() => void run(supersede)}>{t('expenses.substitute_wizard.supersede_action', locale)}</button>
            </div>
          )}
          {canReview && receiptEvidence.status === 'SUPERSEDED' && (
            <button type="button" className={btnClass} onClick={() => {
              setPayerId('');
              setPaidInFullAcknowledged(false);
              setReceiptEvidence(null);
              setConsent(true);
              setActiveStep('details');
              requestWorkflowFocus('details');
            }}>{t('expenses.substitute_wizard.create_revision', locale)}</button>
          )}
        </div>
      </details>
  );

  const canEditPrepared = Boolean(canReview && detail && receiptEvidence && !receiptEvidence.correctionOfEvidenceId
    && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status)
    && ['PREPARED', 'PAYER_CERTIFIED'].includes(receiptEvidence.status));
  const preparedFactsNeedReview = Boolean(detail && receiptEvidence && !receiptEvidence.correctionOfEvidenceId
    && ['PREPARED', 'PAYER_CERTIFIED'].includes(receiptEvidence.status)
    && (!receiptEvidence.payeeName?.trim() || !receiptEvidence.businessPurpose.trim() || !receiptEvidence.missingReceiptReason.trim()
      || !receiptEvidence.paymentDate || !receiptEvidence.paymentMethod
      || (receiptEvidence.fundingSource === 'COMPANY' && Number(detail.paidAmount) > 0 && (
        (detail.paidAt && coerceCivilDate(detail.paidAt) !== (receiptEvidence.paymentDate ? coerceCivilDate(receiptEvidence.paymentDate) : null))
        || (detail.paymentMethod && detail.paymentMethod !== receiptEvidence.paymentMethod)))));
  const startPreparedEdit = () => {
    if (!canEditPrepared || !receiptEvidence || busy) return;
    setReasonCode(receiptEvidence.reasonCode); setMissingReason(receiptEvidence.missingReceiptReason);
    setBusinessPurpose(receiptEvidence.businessPurpose); setPayeeName(receiptEvidence.payeeName ?? '');
    setPayeeAddress(receiptEvidence.payeeAddress ?? ''); setPayeeTaxId(receiptEvidence.payeeTaxId ?? '');
    setPaymentDate((receiptEvidence.paymentDate ? coerceCivilDate(receiptEvidence.paymentDate) : '')); setPaymentMethod(receiptEvidence.paymentMethod ?? 'CASH');
    setSupportingIds(receiptEvidence.supportingAttachmentIds); setPaymentIds(receiptEvidence.paymentEvidenceAttachmentIds);
    setEditingPrepared(true); setActiveStep('details'); setError(null); setInfo(null);
    requestWorkflowFocus('details');
  };
  const cancelPreparedEdit = () => {
    setEditingPrepared(false);
    if (receiptEvidence) setActiveStep(resolveWizardStep(receiptEvidence));
    setError(null);
  };

  const reviewingPreparedStep = Boolean(receiptEvidence && !editingPrepared && ['expense', 'details', 'evidence'].includes(activeStep));
  const navigatePreparedStep = (step: WizardStep) => {
    if (busy) return;
    setActiveStep(step);
    setError(null);
  };
  const returnToSigning = () => { if (receiptEvidence) navigatePreparedStep(resolveWizardStep(receiptEvidence)); };
  const showRevisionAction = () => {
    if (versionHistoryRef.current) versionHistoryRef.current.open = true;
    supersedeReasonRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    supersedeReasonRef.current?.focus({ preventScroll: true });
  };

  let content: ReactNode = null;
  if (receiptEvidence && !editingPrepared && (activeStep === 'expense' || activeStep === 'details' || activeStep === 'evidence')) content = renderReadOnlySummary(activeStep);
  else if (activeStep === 'expense') content = renderExpenseStep();
  else if (activeStep === 'details') content = renderDetailsStep();
  else if (activeStep === 'evidence') content = renderEvidenceStep();
  else if (activeStep === 'method') content = renderMethodStep();
  else if (activeStep === 'certify') content = renderCertifyStep();
  else if (activeStep === 'approve') content = renderApproveStep();
  else content = renderDoneStep();

  return (
    <>
      <MangmeePage
        eyebrow={<Link href={`/companies/${companyId}/expenses/substitute-receipts`}>{t('expenses.substitute_wizard.back_hub', locale)}</Link>}
        title={t('expenses.substitute_wizard.title', locale)}
        description={t('expenses.substitute_wizard.description', locale)}
      >
        {loading ? (
          <LoadingState label={t('expenses.loading', locale)} />
        ) : (
          <div className="space-y-4">
            {error && <div role="alert" aria-live="assertive" aria-atomic="true"><ErrorBanner message={error} /></div>}
            {info && <InfoBanner message={info} />}
            {preparedFactsNeedReview && !editingPrepared && <div role="alert" className="space-y-2 rounded-xl border border-warning-200 bg-warning-50 p-4 text-warning-800">
              <p>ข้อมูลใบแทนยังไม่ครบหรือไม่ตรงกับการจ่ายที่บันทึกไว้ แก้ข้อมูลก่อนลงนามได้โดยไม่ต้องยกเลิกเอกสาร</p>
              {canEditPrepared ? <button type="button" className={ghostClass} onClick={startPreparedEdit}>แก้ไขข้อมูลใบแทน</button>
                : <p>ให้ผู้มีสิทธิ์ตรวจค่าใช้จ่ายเปิดแก้ไขข้อมูลใบแทนนี้</p>}
            </div>}
            {linePrefill && <InfoBanner message={locale === 'th'
              ? `โหลดข้อมูลที่ยืนยันผ่าน LINE แล้ว ${prefilledFieldCount} ช่อง${linePrefill.acceptedValues.itemDescription || linePrefill.acceptedValues.amount || linePrefill.acceptedValues.expenseCategoryId ? ' · รายการ ยอด และหมวดเป็นข้อมูลเสนอ ต้องตรวจและแก้รายการค่าใช้จ่ายในเว็บก่อน' : ''}`
              : `Loaded ${prefilledFieldCount} accepted LINE fields${linePrefill.acceptedValues.itemDescription || linePrefill.acceptedValues.amount || linePrefill.acceptedValues.expenseCategoryId ? '; review proposed item, amount, and category values against the expense before preparing' : ''}`} />}
            <MangmeeCard className="p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">{t('expenses.substitute_wizard.journey_label', locale)}</p>
                  <p className="mt-1 text-sm text-gray-500">{t('expenses.substitute_wizard.journey_progress', locale)
                    .replace('{current}', String(activeJourneyIndex + 1))
                    .replace('{total}', String(JOURNEY_STAGES.length))}</p>
                </div>
                <div className="flex flex-col items-start gap-1 sm:items-end">
                  <MangmeeBadge tone="brand">{t(JOURNEY_STAGE_KEYS[activeJourneyStage], locale)}</MangmeeBadge>
                  {turnLabel && (
                    <p className={cx('text-xs font-bold leading-5', turn?.mine ? 'text-brand-700' : 'text-warning-700')}>
                      {t('expenses.substitute_wizard.turn_label', locale)}: {turnLabel}
                    </p>
                  )}
                </div>
              </div>
              <ThemedSteps
                aria-label={t('expenses.substitute_wizard.journey_label', locale)}
                steps={JOURNEY_STAGES.map((stage, index) => ({
                  key: stage,
                  label: t(JOURNEY_STAGE_KEYS[stage], locale),
                  state: index === activeJourneyIndex ? 'current' : index < activeJourneyIndex ? 'done' : 'upcoming',
                  ...(receiptEvidence && !editingPrepared && stage !== 'done' ? {
                    onSelect: () => stage === 'sign' ? returnToSigning() : navigatePreparedStep(stage === 'expense' ? 'expense' : 'details'),
                    disabled: busy,
                  } : {}),
                }))}
              />
            </MangmeeCard>
            {receiptEvidence && receiptEvidence.payerUserId && ['PREPARED', 'PAYER_CERTIFIED'].includes(receiptEvidence.status) && (
              <MangmeeCard className="space-y-2 p-4">
                <p className="font-bold text-gray-900">{t('expenses.substitute_wizard.payer', locale)}: {receiptEvidence.payerName}</p>
                <p className="text-sm text-gray-600">{t('expenses.substitute_wizard.payer_help', locale)}</p>
                {canChangePayer && <button type="button" className={ghostClass} disabled={busy} onClick={() => {
                  if (versionHistoryRef.current) versionHistoryRef.current.open = true;
                  supersedeReasonRef.current?.scrollIntoView({ block: 'center' });
                  supersedeReasonRef.current?.focus({ preventScroll: true });
                }}>{t('expenses.substitute_wizard.change_payer', locale)}</button>}
              </MangmeeCard>
            )}
            {receiptEvidence && activeJourneyStage === 'sign' && (
              <div className="flex flex-wrap gap-2"><button type="button" className={ghostClass} disabled={busy} onClick={() => navigatePreparedStep('evidence')}>ย้อนกลับ: ข้อมูลและหลักฐาน</button>
                {canEditPrepared && <><button type="button" className={btnClass} disabled={busy} onClick={startPreparedEdit}>แก้ไขข้อมูลใบแทน</button>
                  <Link className={ghostClass} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail!.id)}`}>แก้รายการและวันที่ค่าใช้จ่าย</Link></>}
              </div>
            )}
            {editingPrepared && receiptEvidence && <MangmeeCard className="space-y-2 border-warning-200 bg-warning-50 p-4">
              <p className="font-bold">แก้ไขข้อมูลใบแทน · {receiptEvidence.documentNumber}</p>
              <p className="text-sm">แก้วันในเดือนเดิมใช้เลขเดิม เปลี่ยนเดือนที่จ่ายเงินจะใช้เลขของเดือนนั้น หากเปลี่ยนกลับจะใช้เลขที่เคยจองไว้ให้เอกสารนี้ ดาวน์โหลดฟอร์มล่าสุดเพื่อลงนาม ฉบับเก่าเก็บไว้ในประวัติ</p>
              <button type="button" className={ghostClass} disabled={busy} onClick={cancelPreparedEdit}>ยกเลิกการแก้ไข</button>
            </MangmeeCard>}
            {content}
            {reviewingPreparedStep && (
              <MangmeeCard className="space-y-3 p-4">
                <p className="text-sm text-gray-600">ย้อนดูข้อมูลได้โดยไม่กระทบการลงนาม หากบันทึกแก้ไขที่หน้ารายการค่าใช้จ่าย เอกสารจะอัปเดตตามข้อมูลล่าสุด เลขเอกสารอ้างอิงเดือนที่จ่ายเงิน และต้องตรวจและลงนามใหม่</p>
                <div className="flex flex-wrap gap-2">
                  {activeStep !== 'expense' && <button type="button" className={ghostClass} disabled={busy} onClick={() => navigatePreparedStep(activeStep === 'evidence' ? 'details' : 'expense')}>ย้อนกลับ</button>}
                  {activeStep !== 'evidence' && <button type="button" className={ghostClass} disabled={busy} onClick={() => navigatePreparedStep(activeStep === 'expense' ? 'details' : 'evidence')}>ถัดไป: {activeStep === 'expense' ? 'ข้อมูล' : 'หลักฐาน'}</button>}
                  <button type="button" className={btnClass} disabled={busy} onClick={returnToSigning}>กลับไปลงนามและอนุมัติ</button>
                  {canReview && detail && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status) && <Link className={ghostClass} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>แก้ไขข้อมูลค่าใช้จ่าย</Link>}
                  {canEditPrepared && <button type="button" className={ghostClass} disabled={busy} onClick={startPreparedEdit}>แก้ไขข้อมูลใบแทน</button>}
                  {canChangePayer && <button type="button" className={ghostClass} disabled={busy} onClick={showRevisionAction}>เปลี่ยนวิธีลงนาม</button>}
                </div>
              </MangmeeCard>
            )}
            {!editingPrepared && renderVersionHistory()}
          </div>
        )}
      </MangmeePage>
      {paperArtifactPreview && receiptEvidence && <SubstitutePaperDocumentPreview
        key={paperArtifactPreview.previewChecksumSha256} documentNumber={receiptEvidence.documentNumber}
        preview={paperArtifactPreview} onClose={closePreview} />}
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
