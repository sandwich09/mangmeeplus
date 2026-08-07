'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  ExpensePaymentMethod,
  SubstituteReceiptEvidenceSummary,
  SubstituteReceiptReasonCode,
  SubstituteReceiptRuntimePolicy,
} from '@watchdog-bms/contracts';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { useBranchFilter } from '../web-core-workspace/WorkspaceScope';
import {
  approveSubstituteReceipt,
  certifySubstituteReceipt,
  completePersonalSignatureUpload,
  createExpenseDraft,
  downloadPaymentVoucherPdf,
  downloadSubstituteReceiptPdf,
  generateSubstituteReceipt,
  getAttachmentDownloadUrl,
  getExpense,
  getSubstituteReceiptRuntimePolicy,
  initPersonalSignatureUpload,
  listCompanySubstituteReceipts,
  listExpenseCategories,
  listExpenses,
  listSubstituteReceiptHistory,
  listSubstituteReceiptPayers,
  previewSubstituteReceipt,
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
import { findForbiddenChars, stripDisallowed } from '@/common/forms/sanitize';
import {
  mayApproveSubstituteReceipt,
  payeeTaxIdDigits,
  resolveWizardStep,
  validatePayeeIdentity,
  type PayeeIdentityIssue,
  type WizardStep,
} from './substitute-receipt-wizard.model';
import { SignaturePad } from './SignaturePad';

const PAGE_SIZE = 200;
/** Hard ceiling on per-expense detail requests fired by one candidate scan. */
const MAX_CANDIDATE_DETAIL_LOOKUPS = 60;
const todayIso = () => new Date().toISOString().slice(0, 10);

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

const STEP_KEYS: Record<WizardStep, DictionaryKey> = {
  expense: 'expenses.substitute_wizard.step_expense',
  details: 'expenses.substitute_wizard.step_details',
  evidence: 'expenses.substitute_wizard.step_evidence',
  certify: 'expenses.substitute_wizard.step_certify',
  approve: 'expenses.substitute_wizard.step_approve',
  done: 'expenses.substitute_wizard.step_done',
};

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

function DetailSummary({ detail, title }: { detail: ExpenseDetail; title: ReactNode }) {
  const locale = useWorkspaceLocale();
  return (
    <MangmeeCard className="p-4">
      <div className="text-sm font-bold text-gray-900">{title}</div>
      <div className="mt-3 grid gap-2 text-sm text-gray-600 sm:grid-cols-3">
        <div>{detail.vendorNameSnapshot || detail.lines[0]?.description || t('expenses.substitute_wizard.not_specified', locale)}</div>
        <div>{dateShort(detail.expenseDate)}</div>
        <div className="font-bold tabular-nums text-gray-900 sm:text-right">{baht(detail.grandTotalAmount)}</div>
      </div>
    </MangmeeCard>
  );
}

function SignatureFields({
  signatureFile,
  signaturePreview,
  busy,
  onSelect,
  onClean,
  onDrawn,
}: {
  signatureFile: File | null;
  signaturePreview: { original: string; cleaned: string } | null;
  busy: boolean;
  onSelect: (file: File | null) => void;
  onClean: () => void;
  onDrawn: (file: File, preview: { original: string; cleaned: string }) => void;
}) {
  const locale = useWorkspaceLocale();
  const [method, setMethod] = useState<'draw' | 'upload'>('draw');
  const selectMethod = (next: 'draw' | 'upload') => {
    setMethod(next);
    onSelect(null);
  };
  return (
    <div className="space-y-3">
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-gray-700">
          {t('expenses.substitute_wizard.signature_method', locale)}
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
        <SignaturePad busy={busy} onChange={() => onSelect(null)} onConfirm={onDrawn} />
      ) : (
        <>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.signature_file', locale)}</span>
            <input className={inputClass} type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={(event) => onSelect(event.target.files?.[0] ?? null)} />
          </label>
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
}

export function SubstituteReceiptWizardPage({
  companyId,
  userId,
  permissions,
  isOwner,
  initialExpenseId,
  evidenceId,
}: {
  companyId: string;
  userId: string;
  permissions: string[];
  isOwner: boolean;
  initialExpenseId?: string;
  evidenceId?: string;
}) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const branchFilter = useBranchFilter();
  const branchId = branchFilter?.branchId ?? '';
  const canReview = permissions.includes('expense.review');
  const canConfirm = permissions.includes('expense.confirm');
  const canCreate = permissions.includes('expense.create');
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [receiptEvidence, setReceiptEvidence] = useState<SubstituteReceiptEvidenceSummary | null>(null);
  const [history, setHistory] = useState<SubstituteReceiptEvidenceSummary[]>([]);
  const [policy, setPolicy] = useState<SubstituteReceiptRuntimePolicy | null>(null);
  const [activeStep, setActiveStep] = useState<WizardStep>('expense');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [candidates, setCandidates] = useState<ExpenseDetail[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(!evidenceId);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [candidatesTruncated, setCandidatesTruncated] = useState(false);
  const [categories, setCategories] = useState<ExpenseCategorySummary[]>([]);
  const [consent, setConsent] = useState(false);
  const [presetsApplied, setPresetsApplied] = useState(false);
  const [reasonCode, setReasonCode] = useState<SubstituteReceiptReasonCode>('PAYEE_CANNOT_ISSUE');
  const [missingReason, setMissingReason] = useState('');
  const [businessPurpose, setBusinessPurpose] = useState('');
  const [payeeName, setPayeeName] = useState('');
  const [payeeAddress, setPayeeAddress] = useState('');
  const [payeeTaxId, setPayeeTaxId] = useState('');
  const [payerId, setPayerId] = useState(userId);
  const [payers, setPayers] = useState<Array<{ userId: string; displayName: string }>>([]);
  const [payersLoading, setPayersLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('CASH');
  const [paymentDate, setPaymentDate] = useState(todayIso());
  const [supportingIds, setSupportingIds] = useState<string[]>([]);
  const [paymentIds, setPaymentIds] = useState<string[]>([]);
  const [supportingFile, setSupportingFile] = useState<File | null>(null);
  const [paymentFile, setPaymentFile] = useState<File | null>(null);
  const [manualDate, setManualDate] = useState(todayIso());
  const [manualDescription, setManualDescription] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualCategoryId, setManualCategoryId] = useState('');
  const [signerPosition, setSignerPosition] = useState('');
  const [signatureFile, setSignatureFile] = useState<File | null>(null);
  const [cleanedSignatureFile, setCleanedSignatureFile] = useState<File | null>(null);
  const [signaturePreview, setSignaturePreview] = useState<{ original: string; cleaned: string } | null>(null);
  const [previewChecksum, setPreviewChecksum] = useState<string | null>(null);
  const [certifiedPreviewed, setCertifiedPreviewed] = useState(false);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [supersedeReason, setSupersedeReason] = useState('');
  const payeeIdentityIssues = validatePayeeIdentity({
    payeeName,
    payeeAddress,
    payeeTaxId,
    vendorNameSnapshot: detail?.vendorNameSnapshot,
  });

  const assertAllowed = (...values: string[]) => {
    const forbidden = findForbiddenChars(values.join(''));
    if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
  };

  const initializeDraft = useCallback((nextDetail: ExpenseDetail) => {
    setDetail(nextDetail);
    setMissingReason(nextDetail.missingReceiptReason ?? '');
    setBusinessPurpose(nextDetail.note ?? '');
    setPayeeName(nextDetail.vendorNameSnapshot ?? '');
    setPayeeAddress('');
    setPayeeTaxId('');
    setPaymentMethod(nextDetail.paymentMethod ?? 'CASH');
    setPaymentDate(nextDetail.paidAt?.slice(0, 10) ?? todayIso());
    setSupportingIds(nextDetail.attachments.filter((attachment) => attachment.status === 'ACTIVE'
      && attachment.purpose !== 'expense.review.evidence'
      && attachment.purpose !== 'expense.payment.evidence').map((attachment) => attachment.id));
    setPaymentIds(nextDetail.attachments.filter((attachment) => attachment.status === 'ACTIVE'
      && attachment.purpose === 'expense.payment.evidence').map((attachment) => attachment.id));
    setPayerId(userId);
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
          const target = nextHistory.find((item) => item.id === evidenceId);
          if (!target) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
          if (cancelled) return;
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
          setPayerId(target.payerUserId);
          setPaymentMethod(target.paymentMethod ?? 'CASH');
          setPaymentDate(target.paymentDate?.slice(0, 10) ?? todayIso());
          setSupportingIds(target.supportingAttachmentIds);
          setPaymentIds(target.paymentEvidenceAttachmentIds);
        } else if (initialExpenseId) {
          const nextDetail = await getExpense(companyId, initialExpenseId);
          if (cancelled) return;
          if (nextDetail.substituteReceiptEvidence && nextDetail.substituteReceiptEvidence.status !== 'SUPERSEDED') {
            router.replace(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(nextDetail.substituteReceiptEvidence.id)}`);
            return;
          }
          initializeDraft(nextDetail);
        }
      } catch (cause) {
        if (!cancelled) setError(err(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, evidenceId, initialExpenseId, initializeDraft, locale, router]);

  useEffect(() => {
    if (evidenceId) return;
    let cancelled = false;
    setCandidatesLoading(true);
    setCandidatesError(null);
    listCandidateExpenses(companyId, branchId || undefined)
      .then(({ details, truncated }) => {
        if (cancelled) return;
        setCandidates(details.filter(expenseNeedsReceiptOrSubstitute));
        setCandidatesTruncated(truncated);
      })
      .catch((cause) => { if (!cancelled) setCandidatesError(err(cause)); })
      .finally(() => { if (!cancelled) setCandidatesLoading(false); });
    return () => { cancelled = true; };
  }, [branchId, companyId, evidenceId]);

  useEffect(() => {
    if (!canCreate) return;
    void listExpenseCategories(companyId).then(setCategories).catch(() => setCategories([]));
  }, [canCreate, companyId]);

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
          : (items.find((item) => item.userId === userId)?.userId ?? items[0]?.userId ?? ''));
      })
      .catch((cause) => { if (!cancelled) setError(err(cause)); })
      .finally(() => { if (!cancelled) setPayersLoading(false); });
    return () => { cancelled = true; };
  }, [canReview, companyId, detail, receiptEvidence, userId]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try { await action(); } catch (cause) { setError(err(cause)); } finally { setBusy(false); }
  };

  const selectExpense = (nextDetail: ExpenseDetail) => {
    initializeDraft(nextDetail);
    setReceiptEvidence(null);
    setHistory([]);
    setConsent(false);
    setPresetsApplied(false);
    setActiveStep('expense');
    setInfo(null);
    setError(null);
  };

  const createManualExpense = async () => {
    assertAllowed(manualDescription);
    if (!manualDate || !manualDescription.trim() || Number(manualAmount) <= 0 || !manualCategoryId) {
      throw new Error(t('expenses.substitute_wizard.manual_required', locale));
    }
    const created = await createExpenseDraft(companyId, {
      captureSource: 'WEB_MANUAL',
      expenseDate: manualDate,
      ...(branchId ? { branchId } : {}),
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NEEDS_REVIEW',
      lines: [{
        lineNumber: 1,
        description: manualDescription.trim(),
        quantity: '1',
        unitPrice: manualAmount,
        discountAmount: '0',
        vatRate: '0',
        ...(manualCategoryId ? { expenseCategoryId: manualCategoryId } : {}),
      }],
    });
    const nextDetail = await getExpense(companyId, created.id);
    selectExpense(nextDetail);
    setManualDescription('');
    setManualAmount('');
    setManualCategoryId('');
    setInfo(t('expenses.substitute_wizard.manual_created', locale));
  };

  const continueFromExpense = async () => {
    if (!detail || !consent) throw new Error(t('expenses.substitute_wizard.consent_required', locale));
    if (!canReview) throw new Error(t('expenses.substitute_wizard.review_permission_required', locale));
    const nextDocType = detail.sourceDocumentType === 'NEEDS_REVIEW' ? 'EXPENSE_NOTE_TEXT' as const : detail.sourceDocumentType;
    const nextTaxStatus = detail.taxEvidenceStatus === 'NEEDS_REVIEW' ? 'SUPPORTING_ONLY' as const : detail.taxEvidenceStatus;
    if (nextDocType !== detail.sourceDocumentType || nextTaxStatus !== detail.taxEvidenceStatus) {
      const disallowsTaxCode = !allowsDomesticInputTaxCode(nextDocType, nextTaxStatus);
      const currentReview = reviewValues(detail);
      await updateExpenseReviewFields(companyId, detail.id, {
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
    setPresetsApplied(true);
    setActiveStep('details');
  };

  const continueFromDetails = async () => {
    if (!detail) throw new Error(t('expenses.substitute_wizard.expense_required', locale));
    assertAllowed(payeeName, payeeAddress, missingReason, businessPurpose);
    const firstPayeeIssue = Object.values(payeeIdentityIssues)[0];
    if (firstPayeeIssue) throw new Error(t(PAYEE_ISSUE_KEYS[firstPayeeIssue], locale));
    if (!missingReason.trim() || !businessPurpose.trim() || !payerId || !paymentDate) {
      throw new Error(t('expenses.substitute_wizard.details_required', locale));
    }
    if (!payers.some((payer) => payer.userId === payerId)) {
      throw new Error(t('expenses.substitute_wizard.payer_required', locale));
    }
    await updateExpenseReviewFields(companyId, detail.id, {
      missingReceiptReason: missingReason.trim(),
      note: businessPurpose.trim(),
    });
    setDetail(await getExpense(companyId, detail.id));
    setActiveStep('evidence');
  };

  const uploadEvidence = async (purpose: 'expense.receipt.supporting' | 'expense.payment.evidence') => {
    if (!detail) throw new Error(t('expenses.substitute_wizard.expense_required', locale));
    const file = purpose === 'expense.payment.evidence' ? paymentFile : supportingFile;
    if (!file) throw new Error(t('expenses.substitute_wizard.file_required', locale));
    assertAllowedUploadFile(file);
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

  const requiresPaymentEvidence = paymentMethod !== 'CASH'
    || policy?.cashEvidencePolicy === 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE';

  const prepare = async () => {
    if (!detail) throw new Error(t('expenses.substitute_wizard.expense_required', locale));
    assertAllowed(payeeName, payeeAddress, missingReason, businessPurpose);
    const firstPayeeIssue = Object.values(payeeIdentityIssues)[0];
    if (firstPayeeIssue) throw new Error(t(PAYEE_ISSUE_KEYS[firstPayeeIssue], locale));
    if (!missingReason.trim() || !businessPurpose.trim() || !payerId || !paymentDate
      || !payers.some((payer) => payer.userId === payerId)) {
      throw new Error(t('expenses.substitute_wizard.details_required', locale));
    }
    if (!policy?.ready) throw new Error(t('expenses.substitute_wizard.policy_not_ready', locale));
    if (supportingIds.length === 0 || (requiresPaymentEvidence && paymentIds.length === 0)) {
      throw new Error(t('expenses.substitute_wizard.evidence_required', locale));
    }
    const result = await generateSubstituteReceipt(companyId, detail.id, {
      reasonCode,
      missingReceiptReason: missingReason.trim(),
      businessPurpose: businessPurpose.trim(),
      payerUserId: payerId,
      ...(payeeName.trim() ? { payeeName: payeeName.trim() } : {}),
      ...(payeeAddress.trim() ? { payeeAddress: payeeAddress.trim() } : {}),
      ...(payeeTaxId ? { payeeTaxId } : {}),
      supportingAttachmentIds: supportingIds,
      paymentEvidenceAttachmentIds: paymentIds,
      paymentDate,
      paymentMethod,
      idempotencyKey: `sub-${detail.id}-${detail.updatedAt}-v${detail.substituteReceiptEvidence?.version ?? 0}`.slice(0, 128),
      expectedExpenseUpdatedAt: detail.updatedAt,
    });
    setReceiptEvidence(result);
    setDetail((current) => current ? { ...current, substituteReceiptEvidence: result } : current);
    setActiveStep('certify');
    router.push(`/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(result.id)}`);
  };

  const selectSignatureFile = (file: File | null) => {
    setSignatureFile(file);
    setCleanedSignatureFile(null);
    setSignaturePreview(null);
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
    setPreviewChecksum(null);
    setCertifiedPreviewed(false);
  };

  const previewPrepared = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    assertAllowed(signerPosition);
    if (!signerPosition.trim()) throw new Error(t('expenses.substitute_wizard.position_required', locale));
    const result = await previewSubstituteReceipt(companyId, detail.id, receiptEvidence.id, { payerPosition: signerPosition.trim() });
    setPreviewChecksum(result.previewChecksumSha256);
    setPreview({ name: `${receiptEvidence.documentNumber} · ${t('expenses.substitute_wizard.preview_document', locale)}`, url: result.svgDataUrl });
  };

  const certify = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    assertAllowed(signerPosition);
    if (!previewChecksum) throw new Error(t('expenses.substitute_wizard.preview_required', locale));
    const signatureAttachmentId = await uploadPersonalSignature();
    const result = await certifySubstituteReceipt(companyId, detail.id, receiptEvidence.id, {
      payerPosition: signerPosition.trim(),
      certificationAcknowledged: true,
      previewChecksumSha256: previewChecksum,
      signatureAttachmentId,
      expectedVersion: receiptEvidence.version,
      expectedEvidenceUpdatedAt: receiptEvidence.updatedAt,
    });
    setReceiptEvidence(result);
    setDetail((current) => current ? { ...current, substituteReceiptEvidence: result } : current);
    setHistory((current) => current.map((item) => item.id === result.id ? result : item));
    resetSignature();
    setActiveStep('approve');
    setInfo(t('expenses.substitute_wizard.certified', locale));
  };

  const openArtifact = async (attachmentId: string | null, certified = false) => {
    if (!attachmentId || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.document_not_ready', locale));
    const { downloadUrl } = await getAttachmentDownloadUrl(companyId, attachmentId);
    setPreview({
      name: certified
        ? `${receiptEvidence.documentNumber} · ${t('expenses.substitute_wizard.open_certified', locale)}`
        : receiptEvidence.documentNumber,
      url: downloadUrl,
    });
    if (certified) setCertifiedPreviewed(true);
  };

  const approve = async () => {
    if (!detail || !receiptEvidence) throw new Error(t('expenses.substitute_wizard.evidence_not_found', locale));
    assertAllowed(signerPosition);
    if (!certifiedPreviewed) throw new Error(t('expenses.substitute_wizard.certified_preview_required', locale));
    const signatureAttachmentId = await uploadPersonalSignature();
    const result = await approveSubstituteReceipt(companyId, detail.id, receiptEvidence.id, {
      approverPosition: signerPosition.trim(),
      approvalAcknowledged: true,
      certifiedArtifactChecksumSha256: receiptEvidence.certifiedArtifactChecksumSha256 ?? '',
      signatureAttachmentId,
      expectedVersion: receiptEvidence.version,
      expectedEvidenceUpdatedAt: receiptEvidence.updatedAt,
    });
    setReceiptEvidence(result);
    setDetail((current) => current ? { ...current, substituteReceiptEvidence: result } : current);
    setHistory((current) => current.map((item) => item.id === result.id ? result : item));
    resetSignature();
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
    isOwner,
    approvalMode: policy?.approvalMode,
  }) : false;
  const ownerSelfCollapse = Boolean(receiptEvidence
    && receiptEvidence.payerUserId === userId
    && mayApprove);
  const resolvedStep = resolveWizardStep(receiptEvidence);
  const activeDisplayStep = ownerSelfCollapse && activeStep === 'approve' ? 'certify' : activeStep;
  const visibleSteps = useMemo(() => ownerSelfCollapse
    ? (['expense', 'details', 'evidence', 'certify', 'done'] as WizardStep[])
    : (['expense', 'details', 'evidence', 'certify', 'approve', 'done'] as WizardStep[]), [ownerSelfCollapse]);

  const navigateStep = (step: WizardStep) => {
    if (!receiptEvidence) {
      if (step === 'expense' || (detail && presetsApplied && (step === 'details' || step === 'evidence'))) setActiveStep(step);
      return;
    }
    if (step === 'expense' || step === 'details' || step === 'evidence' || step === resolvedStep
      || (ownerSelfCollapse && step === 'certify' && resolvedStep === 'approve')) {
      setActiveStep(ownerSelfCollapse && step === 'certify' && resolvedStep === 'approve' ? 'approve' : step);
    }
  };

  const renderReadOnlySummary = (step: WizardStep) => {
    if (!detail || !receiptEvidence) return null;
    if (step === 'expense') return <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} />;
    if (step === 'details') {
      return (
        <MangmeeCard className="space-y-2 p-4 text-sm text-gray-600">
          <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.step_details', locale)}</h2>
          <p>{t('expenses.substitute_wizard.payee_name', locale)}: {receiptEvidence.payeeName ?? t('expenses.substitute_wizard.not_specified', locale)}</p>
          {receiptEvidence.payeeAddress && <p>{t('expenses.substitute_wizard.payee_address', locale)}: {receiptEvidence.payeeAddress}</p>}
          {receiptEvidence.payeeTaxId && <p>{t('expenses.substitute_wizard.payee_tax_id', locale)}: {receiptEvidence.payeeTaxId}</p>}
          <p>{t(REASON_KEYS[receiptEvidence.reasonCode], locale)} · {receiptEvidence.missingReceiptReason}</p>
          <p>{receiptEvidence.businessPurpose}</p>
          <p>{receiptEvidence.payerName} · {t(PAYMENT_KEYS[receiptEvidence.paymentMethod ?? 'CASH'], locale)} · {dateShort(receiptEvidence.paymentDate)}</p>
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

  const renderExpenseStep = () => (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <MangmeeCard className="space-y-3 p-4">
          <div>
            <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.candidate_title', locale)}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('expenses.substitute_wizard.candidate_help', locale)}</p>
          </div>
          {candidatesError && <ErrorBanner message={candidatesError} />}
          {candidatesLoading ? <p className="text-sm text-gray-500">{t('expenses.loading', locale)}</p>
            : candidates.length === 0 ? <p className="text-sm text-gray-500">{t('expenses.substitute_wizard.candidate_empty', locale)}</p>
              : <div className="max-h-96 space-y-2 overflow-y-auto">
                {candidates.map((item) => (
                  <button key={item.id} type="button" onClick={() => selectExpense(item)}
                    className={cx('w-full rounded-xl border p-3 text-left transition', detail?.id === item.id ? 'border-brand-400 bg-brand-25' : 'border-gray-200 hover:border-brand-200')}>
                    <div className="font-semibold text-gray-900">{item.vendorNameSnapshot || item.lines[0]?.description || t('expenses.substitute_wizard.not_specified', locale)}</div>
                    <div className="mt-1 flex justify-between gap-3 text-xs text-gray-500"><span>{dateShort(item.expenseDate)}</span><span className="font-bold tabular-nums text-gray-800">{baht(item.grandTotalAmount)}</span></div>
                  </button>
                ))}
              </div>}
          {!candidatesLoading && candidatesTruncated && (
            <p className="text-xs text-gray-500">{t('expenses.substitute_wizard.candidate_truncated', locale)}</p>
          )}
        </MangmeeCard>

        <MangmeeCard className="space-y-3 p-4">
          <div>
            <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.manual_title', locale)}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('expenses.substitute_wizard.manual_help', locale)}</p>
          </div>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.manual_date', locale)}</span>
            <ThemedDate className={inputClass} value={manualDate} onChange={(event) => setManualDate(event.target.value)} />
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.manual_description', locale)}</span>
            <input className={inputClass} value={manualDescription} onChange={(event) => setManualDescription(stripDisallowed(event.target.value))} />
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.amount', locale)}</span>
            <input className={inputClass} type="number" min="0" step="0.01" value={manualAmount} onChange={(event) => setManualAmount(event.target.value)} />
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.category', locale)}</span>
            <ThemedSelect className={inputClass} value={manualCategoryId} onChange={(event) => setManualCategoryId(event.target.value)}>
              <option value="">{t('expenses.substitute_wizard.category_none', locale)}</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </ThemedSelect>
          </label>
          <button type="button" className={btnClass} disabled={!canCreate || busy || !manualDate || !manualDescription.trim() || Number(manualAmount) <= 0 || !manualCategoryId} onClick={() => void run(createManualExpense)}>
            {t('expenses.substitute_wizard.create_expense', locale)}
          </button>
          {!canCreate && <p className="text-xs text-warning-700">{t('expenses.manual_read_only', locale)}</p>}
        </MangmeeCard>
      </div>

      {detail && (
        <div className="space-y-3">
          <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} />
          <MangmeeCard className="border-warning-100 bg-warning-50 p-4">
            <p className="text-sm font-semibold leading-relaxed text-warning-700">{t('expenses.substitute_wizard.consent_text', locale)}</p>
            <label className="mt-3 flex items-start gap-2 text-sm font-semibold text-gray-800">
              <input className="mt-1" type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
              <span>{t('expenses.substitute_wizard.consent_confirm', locale)}</span>
            </label>
          </MangmeeCard>
          <div className="flex justify-end">
            <button type="button" className={btnClass} disabled={busy || !consent || !canReview} onClick={() => void run(continueFromExpense)}>{t('expenses.substitute_wizard.continue', locale)}</button>
          </div>
        </div>
      )}
    </div>
  );

  const renderDetailsStep = () => detail && (
    <div className="space-y-4">
      <DetailSummary detail={detail} title={t('expenses.substitute_wizard.selected_expense', locale)} />
      <MangmeeCard className="space-y-4 p-4">
        <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.details_title', locale)}</h2>
        <div className="grid gap-4 border-b border-gray-200 pb-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
            <span className="mb-1 block">{t('expenses.substitute_wizard.payee_name', locale)}{!detail.vendorNameSnapshot?.trim() ? ' *' : ''}</span>
            <input className={inputClass} maxLength={201} value={payeeName} aria-invalid={Boolean(payeeIdentityIssues.payeeName) || undefined} onChange={(event) => setPayeeName(stripDisallowed(event.target.value))} />
            {payeeIdentityIssues.payeeName && <p className="mt-1 text-xs text-error-700">{t(PAYEE_ISSUE_KEYS[payeeIdentityIssues.payeeName], locale)}</p>}
          </label>
          <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
            <span className="mb-1 block">{t('expenses.substitute_wizard.payee_address', locale)}</span>
            <textarea className={inputClass} rows={2} maxLength={301} value={payeeAddress} aria-invalid={Boolean(payeeIdentityIssues.payeeAddress) || undefined} onChange={(event) => setPayeeAddress(stripDisallowed(event.target.value))} />
            {payeeIdentityIssues.payeeAddress && <p className="mt-1 text-xs text-error-700">{t(PAYEE_ISSUE_KEYS[payeeIdentityIssues.payeeAddress], locale)}</p>}
          </label>
          <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
            <span className="mb-1 block">{t('expenses.substitute_wizard.payee_tax_id', locale)}</span>
            <input className={inputClass} inputMode="numeric" placeholder="0-0000-00000-00-0" value={payeeTaxId} aria-invalid={Boolean(payeeIdentityIssues.payeeTaxId) || undefined} onChange={(event) => setPayeeTaxId(payeeTaxIdDigits(event.target.value))} />
            <p className="mt-1 text-xs text-gray-500">{t('expenses.substitute_wizard.payee_tax_id_help', locale)}</p>
            {payeeTaxId.length > 0 && payeeTaxId.length !== 13 && (
              <p className="mt-1 text-xs text-error-700">{t('expenses.substitute_wizard.payee_tax_id_count', locale).replace('{count}', String(payeeTaxId.length))}</p>
            )}
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.reason_code', locale)}</span>
            <ThemedSelect className={inputClass} value={reasonCode} onChange={(event) => setReasonCode(event.target.value as SubstituteReceiptReasonCode)}>
              {Object.entries(REASON_KEYS).map(([value, key]) => <option key={value} value={value}>{t(key, locale)}</option>)}
            </ThemedSelect>
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.payer', locale)}</span>
            <ThemedSelect className={inputClass} value={payerId} onChange={(event) => setPayerId(event.target.value)} disabled={payersLoading}>
              <option value="">{t('expenses.substitute_wizard.select_payer', locale)}</option>
              {payers.map((payer) => <option key={payer.userId} value={payer.userId}>{payer.displayName}</option>)}
            </ThemedSelect>
            {payersLoading && <p className="mt-1 text-xs text-gray-500">{t('expenses.substitute_wizard.payers_loading', locale)}</p>}
          </label>
          <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
            <span className="mb-1 block">{t('expenses.substitute_wizard.missing_reason', locale)}</span>
            <textarea className={inputClass} rows={3} maxLength={500} value={missingReason} onChange={(event) => setMissingReason(stripDisallowed(event.target.value))} />
          </label>
          <label className="block text-sm font-semibold text-gray-700 sm:col-span-2">
            <span className="mb-1 block">{t('expenses.substitute_wizard.business_purpose', locale)}</span>
            <textarea className={inputClass} rows={3} maxLength={500} value={businessPurpose} onChange={(event) => setBusinessPurpose(stripDisallowed(event.target.value))} />
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.payment_method', locale)}</span>
            <ThemedSelect className={inputClass} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as ExpensePaymentMethod)}>
              {Object.entries(PAYMENT_KEYS).map(([value, key]) => <option key={value} value={value}>{t(key, locale)}</option>)}
            </ThemedSelect>
          </label>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.payment_date', locale)}</span>
            <ThemedDate className={inputClass} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
          </label>
        </div>
      </MangmeeCard>
      <div className="flex justify-between gap-3">
        <button type="button" className={ghostClass} disabled={busy} onClick={() => setActiveStep('expense')}>{t('expenses.substitute_wizard.back', locale)}</button>
        <button type="button" className={btnClass} disabled={busy || payersLoading || Object.keys(payeeIdentityIssues).length > 0 || !missingReason.trim() || !businessPurpose.trim() || !payerId || !paymentDate} onClick={() => void run(continueFromDetails)}>{t('expenses.substitute_wizard.continue', locale)}</button>
      </div>
    </div>
  );

  const renderAttachmentPicker = (
    purpose: 'expense.receipt.supporting' | 'expense.payment.evidence',
    titleKey: DictionaryKey,
    helpKey: DictionaryKey,
    ids: string[],
    setIds: (next: string[]) => void,
    file: File | null,
    setFile: (file: File | null) => void,
  ) => {
    const attachments = detail?.attachments.filter((attachment) => attachment.status === 'ACTIVE'
      && (purpose === 'expense.payment.evidence'
        ? attachment.purpose === purpose
        : attachment.purpose !== 'expense.payment.evidence' && attachment.purpose !== 'expense.review.evidence')) ?? [];
    return (
      <MangmeeCard className="space-y-3 p-4">
        <div>
          <h2 className="font-bold text-gray-900">{t(titleKey, locale)}</h2>
          <p className="mt-1 text-sm text-gray-500">{t(helpKey, locale)}</p>
        </div>
        {attachments.map((attachment) => (
          <label key={attachment.id} className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={ids.includes(attachment.id)} onChange={(event) => setIds(event.target.checked ? [...new Set([...ids, attachment.id])] : ids.filter((id) => id !== attachment.id))} />
            <span>{attachment.originalFileName}</span>
          </label>
        ))}
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-200 bg-brand-25 p-4 text-center">
          <span className="text-sm font-semibold text-brand-700">{t('expenses.substitute_wizard.choose_file', locale)}</span>
          <span className="mt-1 text-xs text-gray-500">{file?.name ?? t('expenses.substitute_wizard.file_types', locale)}</span>
          <input className="hidden" type="file" accept={ATTACHMENT_UPLOAD_ACCEPT} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <button type="button" className={ghostClass} disabled={busy || !file} onClick={() => void run(() => uploadEvidence(purpose))}>{t('expenses.substitute_wizard.add_file', locale)}</button>
        {purpose === 'expense.payment.evidence' && paymentMethod === 'CASH' && (
          <div className="border-t border-gray-100 pt-3">
            <p className="text-sm text-gray-500">{t('expenses.substitute_wizard.payment_voucher_help', locale)}</p>
            <button type="button" className={cx(ghostClass, 'mt-3')} disabled={busy} onClick={() => void run(downloadPaymentVoucher)}>
              <span className="inline-flex items-center gap-2">{ICON.download}{t('expenses.substitute_wizard.payment_voucher_action', locale)}</span>
            </button>
          </div>
        )}
      </MangmeeCard>
    );
  };

  const renderEvidenceStep = () => detail && (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {renderAttachmentPicker(
          'expense.receipt.supporting',
          'expenses.substitute_wizard.supporting_title',
          'expenses.substitute_wizard.supporting_help',
          supportingIds,
          setSupportingIds,
          supportingFile,
          setSupportingFile,
        )}
        {renderAttachmentPicker(
          'expense.payment.evidence',
          'expenses.substitute_wizard.payment_evidence_title',
          requiresPaymentEvidence ? 'expenses.substitute_wizard.payment_evidence_required' : 'expenses.substitute_wizard.payment_evidence_optional',
          paymentIds,
          setPaymentIds,
          paymentFile,
          setPaymentFile,
        )}
      </div>
      {paymentMethod === 'CASH' && policy?.cashEvidenceInstructions && (
        <MangmeeCard className="p-4 text-sm text-gray-600">{policy.cashEvidenceInstructions}</MangmeeCard>
      )}
      {!policy?.ready && <ErrorBanner message={t('expenses.substitute_wizard.policy_not_ready', locale)} />}
      <div className="flex justify-between gap-3">
        <button type="button" className={ghostClass} disabled={busy} onClick={() => setActiveStep('details')}>{t('expenses.substitute_wizard.back', locale)}</button>
        <button type="button" className={btnClass} disabled={busy || !policy?.ready || !missingReason.trim() || !businessPurpose.trim() || !payerId || !paymentDate || supportingIds.length === 0 || (requiresPaymentEvidence && paymentIds.length === 0)} onClick={() => void run(prepare)}>{t('expenses.substitute_wizard.prepare', locale)}</button>
      </div>
    </div>
  );

  const renderWaiting = (message: string) => (
    <MangmeeCard className="border-warning-100 bg-warning-50 p-5">
      <h2 className="font-bold text-warning-700">{message}</h2>
      <p className="mt-2 text-sm text-gray-600">{t('expenses.substitute_wizard.waiting_help', locale)}</p>
      <button type="button" className={cx(ghostClass, 'mt-4')} onClick={() => void copyWizardLink()}>{copied ? t('expenses.substitute_wizard.link_copied', locale) : t('expenses.substitute_wizard.copy_link', locale)}</button>
    </MangmeeCard>
  );

  const renderCertifyStep = () => {
    if (!receiptEvidence) return null;
    if (receiptEvidence.payerUserId !== userId) {
      return renderWaiting(t('expenses.substitute_wizard.waiting_payer', locale).replace('{name}', receiptEvidence.payerName));
    }
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
        <MangmeeCard className="space-y-4 p-4">
          <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.certify_title', locale)}</h2>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.payer_position', locale)}</span>
            <input className={inputClass} maxLength={120} value={signerPosition} onChange={(event) => { setSignerPosition(stripDisallowed(event.target.value)); setPreviewChecksum(null); }} />
            <span className="mt-1 block text-xs font-normal text-gray-500">{t('expenses.substitute_wizard.position_help', locale)}</span>
          </label>
          <button type="button" className={ghostClass} disabled={busy || !signerPosition.trim()} onClick={() => void run(previewPrepared)}>
            <span className="inline-flex items-center gap-2">{ICON.eye}{t('expenses.substitute_wizard.preview_document', locale)}</span>
          </button>
          <SignatureFields key="certify" signatureFile={signatureFile} signaturePreview={signaturePreview} busy={busy} onSelect={selectSignatureFile} onClean={() => void run(buildTransparentSignature)} onDrawn={selectDrawnSignature} />
          <p className="text-sm text-gray-600">{t('expenses.substitute_wizard.certify_acknowledgement', locale)}</p>
          <button type="button" className={btnClass} disabled={busy || !signerPosition.trim() || !previewChecksum || !cleanedSignatureFile} onClick={() => void run(certify)}>{t('expenses.substitute_wizard.certify_action', locale)}</button>
        </MangmeeCard>
      </div>
    );
  };

  const renderApproveStep = () => {
    if (!receiptEvidence) return null;
    if (!mayApprove) return renderWaiting(t('expenses.substitute_wizard.waiting_approver', locale));
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
        <MangmeeCard className="space-y-4 p-4">
          <h2 className="font-bold text-gray-900">{t('expenses.substitute_wizard.approve_title', locale)}</h2>
          <button type="button" className={ghostClass} disabled={busy || !receiptEvidence.certifiedArtifactAttachmentId} onClick={() => void run(() => openArtifact(receiptEvidence.certifiedArtifactAttachmentId, true))}>
            <span className="inline-flex items-center gap-2">{ICON.eye}{t('expenses.substitute_wizard.open_certified', locale)}</span>
          </button>
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_wizard.approver_position', locale)}</span>
            <input className={inputClass} maxLength={120} value={signerPosition} onChange={(event) => setSignerPosition(stripDisallowed(event.target.value))} />
            <span className="mt-1 block text-xs font-normal text-gray-500">{t('expenses.substitute_wizard.position_help', locale)}</span>
          </label>
          <SignatureFields key="approve" signatureFile={signatureFile} signaturePreview={signaturePreview} busy={busy} onSelect={selectSignatureFile} onClean={() => void run(buildTransparentSignature)} onDrawn={selectDrawnSignature} />
          <button type="button" className={btnClass} disabled={busy || !certifiedPreviewed || !signerPosition.trim() || !cleanedSignatureFile} onClick={() => void run(approve)}>{t('expenses.substitute_wizard.approve_action', locale)}</button>
        </MangmeeCard>
      </div>
    );
  };

  const renderDoneStep = () => receiptEvidence && detail && (
    <div className="space-y-4">
      <MangmeeCard className="p-6 text-center">
        <MangmeeBadge tone={receiptEvidence.status === 'ISSUED' ? 'brand' : 'slate'}>
          {t(receiptEvidence.status === 'ISSUED' ? 'expenses.substitute_hub.status_issued' : 'expenses.substitute_hub.status_superseded', locale)}
        </MangmeeBadge>
        <h2 className="mt-4 text-xl font-bold text-gray-900">{t('expenses.substitute_wizard.done_title', locale)}</h2>
        <p className="mt-2 font-mono text-lg font-bold text-gray-800">{receiptEvidence.documentNumber}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          {receiptEvidence.artifactAttachmentId && (
            <button type="button" className={btnClass} disabled={busy} onClick={() => void run(() => downloadSubstituteReceiptPdf(companyId, detail.id, receiptEvidence.id, receiptEvidence.documentNumber))}>
              <span className="inline-flex items-center gap-2">{ICON.download}{t('expenses.substitute.download_pdf', locale)}</span>
            </button>
          )}
          {receiptEvidence.artifactAttachmentId && (
            <button type="button" className={ghostClass} disabled={busy} onClick={() => void run(() => openArtifact(receiptEvidence.artifactAttachmentId))}>
              <span className="inline-flex items-center gap-2">{ICON.eye}{t('expenses.substitute_wizard.open_document', locale)}</span>
            </button>
          )}
          <Link className={btnClass} href={`/companies/${companyId}/expenses/${encodeURIComponent(detail.id)}`}>{t('expenses.substitute_wizard.back_to_expense', locale)}</Link>
        </div>
      </MangmeeCard>
      <details className="rounded-2xl border border-gray-200 bg-white p-4">
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
          {canReview && receiptEvidence.status !== 'SUPERSEDED' && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status) && (
            <div className="space-y-2 border-t border-gray-100 pt-3">
              <label className="block text-sm font-semibold text-gray-700">
                <span className="mb-1 block">{t('expenses.substitute_wizard.supersede_reason', locale)}</span>
                <textarea className={inputClass} rows={3} maxLength={500} value={supersedeReason} onChange={(event) => setSupersedeReason(stripDisallowed(event.target.value))} />
              </label>
              <button type="button" className={ghostClass} disabled={busy || !supersedeReason.trim()} onClick={() => void run(supersede)}>{t('expenses.substitute_wizard.supersede_action', locale)}</button>
            </div>
          )}
          {canReview && receiptEvidence.status === 'SUPERSEDED' && (
            <button type="button" className={btnClass} onClick={() => {
              const previousPayerId = receiptEvidence.payerUserId;
              initializeDraft(detail);
              setPayerId(previousPayerId);
              setReceiptEvidence(null);
              setConsent(true);
              setPresetsApplied(true);
              setActiveStep('details');
            }}>{t('expenses.substitute_wizard.create_revision', locale)}</button>
          )}
        </div>
      </details>
    </div>
  );

  let content: ReactNode = null;
  if (receiptEvidence && (activeStep === 'expense' || activeStep === 'details' || activeStep === 'evidence')) content = renderReadOnlySummary(activeStep);
  else if (activeStep === 'expense') content = renderExpenseStep();
  else if (activeStep === 'details') content = renderDetailsStep();
  else if (activeStep === 'evidence') content = renderEvidenceStep();
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
          <MangmeeCard className="p-8 text-center text-sm text-gray-500">{t('expenses.loading', locale)}</MangmeeCard>
        ) : (
          <div className="space-y-4">
            {error && <ErrorBanner message={error} />}
            {info && <InfoBanner message={info} />}
            <MangmeeCard className="overflow-x-auto p-4">
              <div className="flex min-w-[680px] items-start">
                {visibleSteps.map((step, index) => {
                  const active = activeDisplayStep === step;
                  const labelKey = ownerSelfCollapse && step === 'certify'
                    ? 'expenses.substitute_wizard.step_combined'
                    : STEP_KEYS[step];
                  return (
                    <div key={step} className="flex flex-1 items-start">
                      <button type="button" onClick={() => navigateStep(step)} className="group flex min-w-24 flex-col items-center gap-1 text-center">
                        <span className={cx('flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold', active ? 'border-brand-500 bg-brand-500 text-white' : 'border-gray-300 bg-white text-gray-500')}>{index + 1}</span>
                        <span className={cx('text-xs', active ? 'font-bold text-brand-700' : 'font-medium text-gray-500')}>{t(labelKey, locale)}</span>
                      </button>
                      {index < visibleSteps.length - 1 && <div className="mt-4 h-0.5 flex-1 bg-gray-200" />}
                    </div>
                  );
                })}
              </div>
            </MangmeeCard>
            {content}
          </div>
        )}
      </MangmeePage>
      {preview && (
        <Modal open title={preview.name} size="lg" closeLabel={t('expenses.close', locale)} onClose={() => setPreview(null)}>
          <img src={preview.url} alt={preview.name} className="mx-auto max-h-[75vh] w-auto rounded-lg" />
        </Modal>
      )}
    </>
  );
}
