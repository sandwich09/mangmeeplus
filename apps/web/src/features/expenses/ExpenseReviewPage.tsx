'use client';

import { whtPaymentProgressText } from '@watchdog-bms/contracts';
import { expenseDisplayAttachments, expenseAttachmentTypeLabel } from './expenses.model';
import { deriveEvidenceRowFlags } from './evidence-audit.logic';
import { focusExpenseField } from './expense-focus.logic';
import { ThemedFile } from '@/common/components/field/ThemedFile';
import { RECEIPT_UPLOAD_ACCEPT } from './expense-upload.logic';
import { uploadExpensePaymentSlip } from './expenses.api';
import { InputVatDecisionHistory } from './ExpenseInputVatRight';
import { PaymentDateConfirmation } from './PaymentDateConfirmation';
import { inputVatRightLabel, showInputVatQuestion, INPUT_VAT_LEDGER_BEFORE_CONFIRM } from './expense-input-vat-right.logic';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { ExpenseDisbursementCancellation } from './ExpenseDisbursementCancellation';
import { whtPayeeAddress } from '@watchdog-bms/contracts';

import { normalizeExpensePaymentAmount, expenseOverpaidAmount, expenseOverpaymentRemedy, expenseReopenedMessage, EXPENSE_CORRECTION_WORDS, expenseCorrectionBlockerMessage, expenseReopenBlockerMessages, expenseReimbursementProgressLabel } from '@watchdog-bms/contracts';
import { expenseEvidenceAssessment, expenseEvidenceConfirmationError, expenseDateIsReadable, REIMBURSEMENT_DUPLICATE_CONFIRM_WARNING } from '@watchdog-bms/contracts';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExpenseReviewRequestDialog } from './ExpenseReviewRequestDialog';
import { ExpenseReviewSubmitActions } from './ExpenseReviewSubmitActions';
import { sendAndConfirmExpense } from './expense-one-pass-confirm';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { expenseListBackTarget } from './expense-list-navigation.logic';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { canEditSubstituteReceipt } from './substitute-receipt-wizard.model';
import { useConfirm } from '@/common/components/modal/use-confirm';
import { Modal } from '@/common/components/modal/Modal';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { Notice } from '@/common/components/notice';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { CoverLoader } from '@/common/components/state/CoverLoader';
import { apiErrorCode } from '@/common/api/api-error-message';
import { consumeStoredNoticeOnce } from './expense-notice.logic';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { MangmeeBadge, MangmeeCard, MangmeePage, MetricGrid, cx } from '@/common/components/mangmee';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { ExpenseHistoryModal } from './ExpenseHistoryModal';
import { useToast } from '@/common/components/toast';
import { findForbiddenChars, REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import { downloadDocumentAsPdf } from '@/common/files/download-document-pdf';
import { downloadArtifact } from '@/common/files/download-artifact';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import {
  acknowledgeOcrTotal, confirmDuplicate, confirmExpense, deleteExpense, dismissDuplicate,
  fetchAttachmentPreviewBlob, getExpense, getExpenseReviewers, getExpenseReadStatus,
  markExpenseReady, markExpenseReadyAsReviewer, recordExpensePayment, rejectExpense, reopenExpense, cancelExpensePayment,
  requestExpenseExtraction, removeExpenseReceipt, runDuplicateCheck, updateExpenseReviewFields, uploadExpenseEvidenceFile, voidExpense,
  listWhtHandoffs, issueSystemWhtCertificate, downloadSystemWhtCertificate, correctSystemWhtCertificate, issueSystemWhtReplacementCopy,
} from './expenses.api';
import {
  captureReadNoticeText, captureReadAgainAllowed, captureReadIsRunning, captureReadNotice, freeAllowanceNotice,
  type ExpenseReadStatusFile, type ExpenseReadStatusResult,
} from './expense-capture-status.logic';
import {
  AI_MISSING_FIELD_LABELS, AI_SUMMARY_STATUS_LABELS, ATTACHMENT_PURPOSE_LABELS, isWetSignedScanAttachment,
  PAYMENT_METHOD_LABELS, POSTING_STATUS_LABELS,
  expenseSourceDocumentLabel, expenseSubstituteReceiptStatus, TAX_EVIDENCE_STATUS_LABELS, deriveExpenseAuditChecks,
  deriveExpenseClassificationReviewState, deriveExpenseReviewSteps, expenseAiMissingFields, expenseCapabilities, expenseDataStepBlocker, expenseEvidenceStepBlocker, hasCurrentExpenseDocumentReview,
  expenseNeedsReceiptOrSubstitute, expenseSourceDraftViewState, expenseSubstituteReceiptAction, expenseValueLabel, expenseUiPermissions,
  canRunExpenseDuplicateCheck, hasAiGrandTotalMismatch, hasUnresolvedDuplicateWarning, initialExpenseReviewStep, needsAiTotalAcknowledgement,
  MIME_TYPE_LABELS, canDeleteExpense, claimExpenseRecordNote, expenseDeleteErrorMessage, firstFilled, isClaimExpenseRecord, shouldRereadReplacedReceipt, isBlockedCheckBillClassification,
  postingErrorText, vatModeRequiresRate, expensePaymentAttempt, classifyExpensePaymentFailure,
  expenseConfirmBlocker, expenseDocumentDateStatus, EXPENSE_DATE_STATUS_LABELS,
  expenseListStatus, canCorrectWhtCertificate, canIssueWhtReplacementCopy, canIssueExpenseWhtCertificate, expensePaymentFormState, expenseConfirmedLockMessage,
} from './expenses.model';
import type { ExpenseReviewTotalsState } from './useExpenseReviewTotals';
import type { ExpenseDetail, ExpenseReviewStepKey, ExpensePaymentAttempt, ExpensePaymentFailure } from './expenses.model';
import { INPUT_VAT_RIGHT_LABEL, canVoidExpenseFinancialState, isExpenseVoidReason, todayCivilDate, type BusinessDocumentClassification, type ExpenseVatSourceOverrideInput, type ExpensePaymentMethod, type RemoveExpenseReceiptInput, type WhtCertificateHandoffDto } from '@watchdog-bms/contracts';
import {
  AiFieldMissingHint, BuyerMatchBanner, DOCUMENT_KIND_LABELS, DocumentReviewSection, ExpenseDocumentFacts, ExpenseReviewEditSection,
  InlineSpinner, STEP_LABEL_KEYS, expenseNoticeKey,
  extractionNotice, nonExpenseNotice,
} from './ExpensesPages';
import type { ExtractionNotice } from './ExpensesPages';
import {
  baht, amountText, btnClass, dangerClass, dateShort, err, ErrorBanner, ghostClass, ICON,
  InfoBanner, inputClass,
  tapTargetClass,
} from './ExpensesUi';
import { ForeignCurrencyNotice } from './ForeignCurrencyNotice';
import { generateSourceJournal } from '../ledger/ledger.api';
import { hasRecordedTax, showsTaxCapture, useExpenseCapturePolicy } from './expense-capture-policy';
import { ExpenseSourceDraftCard } from './ExpenseSourceDraftCard';
import { ExpenseCertificateReopen, currentExpenseCertificate, expenseCertificateReopenedMessage } from './ExpenseCertificateReopen';
import { ExpenseCertificateVoidDialog } from './ExpenseCertificateVoidDialog';
import { ExpenseCertificateCard } from './ExpenseCertificateCard';
import { WhtIssueButton } from './WhtIssueButton';
import { ExpenseCertificateCorrectionFields } from './ExpenseCertificateCorrectionFields';
import { ExpenseCertificateHistory, ExpenseCertificateHistoryDisclosure, ExpenseCertificateHistoryNotice, ExpenseCancellationNotice } from './ExpenseCertificateHistory';
import { ExpenseCertificateCorrectionNote } from './ExpenseCertificateCorrectionNote';
import { ExpenseDisbursementOpenLink, ExpenseDisbursementDirectPayment, ExpenseDisbursementPaymentEntry, ExpenseDisbursementPaymentScope, ExpenseDisbursementPrepareEntry, ExpenseDisbursementReservation, ExpenseDisbursementVoidBlocker } from './ExpenseDisbursementVoucher';
import { expenseCertificateCorrectionValues, expenseCertificateCorrectionChanges, type ExpenseCertificateCorrectionValues } from './expense-certificate-correction.logic';
import {
  activePrimaryReceiptAttachmentId,
  availableExpenseSessionStorage,
  expenseExtractionResponseIsUnknown,
  readExpenseExtractionAttempt,
  requestExpenseExtractionWithRecovery,
  writeExpenseExtractionAttempt,
  type ExpenseExtractionAttempt,
} from './expense-upload.logic';

// The app shell owns the responsive header height through --app-header-h.
// The stepper row measures 72px; page chrome and viewers must clear both.
// e2e `VIS-03` asserts the stepper stays visible below the header, so drift here fails a test.
const STEPPER_REM = 4.5; // 72px
const VIEWER_BOTTOM_GAP_REM = 6; // clearance for the sticky action bar
const PAYMENT_SAVED_REFRESH_NOTICE = 'บันทึกการจ่ายแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ ตรวจประวัติการจ่าย หรือกด “ลองบันทึกรายการเดิมอีกครั้ง” เพื่อโหลดข้อมูล โดยไม่เพิ่มยอดจ่ายซ้ำ';
type ExpensePreviewSource = DocumentPreviewSource & { hideOpenNewTab?: boolean; onViewed?: () => void };
const isRemovableFilePurpose = (purpose: string): purpose is NonNullable<RemoveExpenseReceiptInput['purpose']> =>
  purpose === 'expense.receipt.primary' || purpose === 'expense.receipt.supporting'
  || purpose === 'expense.payment.evidence' || purpose === 'expense.review.evidence';

// 9700.00 reads as 9,700.00 while the box is not being typed in; anything that is not a plain number is shown as typed.
function groupedAmount(value: string) {
  if (!/^\d+(\.\d*)?$/.test(value)) return value;
  const [whole, ...rest] = value.split('.');
  return [whole!.replace(/\B(?=(\d{3})+$)/g, ','), ...rest].join('.');
}

// A number or code inside a sentence stays on one line.
function withUnit(text: string, part?: string | null) {
  const at = part ? text.indexOf(part) : -1;
  return at < 0 ? text : <>{text.slice(0, at)}<span className="mangmee-unit">{part}</span>{text.slice(at + part!.length)}</>;
}

export function ExpenseReviewPage({ companyId, expenseId, userId, permissions, freeExpenseDrafts = false, disbursementEntryOpen = false, systemCertificatesAvailable = true }: { companyId: string; expenseId: string; userId: string; permissions: string[]; canSelfApprove: boolean; freeExpenseDrafts?: boolean; systemCertificatesAvailable?: boolean; disbursementEntryOpen?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const listBack = searchParams?.get('back') ?? null;
  const sectionLanding = searchParams?.get('section');
  const uiPermissions = expenseUiPermissions(permissions, freeExpenseDrafts);
  const caps = expenseCapabilities(uiPermissions);
  const { canReview, canConfirm } = caps;
  const locale = useWorkspaceLocale();
  const onRefresh = () => undefined;
  const onGoJournal = () => router.push(`/companies/${companyId}/journal?sourceId=${encodeURIComponent(expenseId)}`);
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  const [reviewTotals, setReviewTotals] = useState<ExpenseReviewTotalsState | null>(null);
  const [totalsRetry, setTotalsRetry] = useState(0);
  // Called before the loading/error early returns — hooks cannot live behind them.
  const capture = useExpenseCapturePolicy(companyId, detail?.expenseDate ?? undefined);
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const unsavedRef = useRef(false);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (unsavedRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);
  const [receiptRemoving, setReceiptRemoving] = useState(false);
  const receiptRemovalPending = useRef(false);
  const [loading, setLoading] = useState(true);
  const sectionLanded = useRef<string | null>(null);
  useEffect(() => {
    if (!sectionLanding || loading || !detail || detail.id !== expenseId) return;
    const request = `${companyId}:${expenseId}:${sectionLanding}`;
    if (sectionLanded.current === request) return;
    sectionLanded.current = request;
    const headingId = sectionLanding === 'payment' ? 'expense-payment-heading'
      : sectionLanding === 'withholding' ? 'expense-withholding-heading'
        : sectionLanding === 'certificate' ? 'wht-certificate'
          : sectionLanding === 'checks' ? 'expense-checks-heading' : null;
    const heading = headingId ? document.getElementById(headingId) : null;
    // A hidden review step or an absent section is not a landing target. Never focus a field.
    if (heading && !heading.closest('.hidden, [hidden]')) {
      const land = () => focusExpenseField(heading.closest<HTMLElement>('section, fieldset') ?? heading, heading);
      land();
      // The receipt preview and late cards grow the page after the first frame (a phone pushes the section below the fold):
      // align twice more unless the person has started to scroll or type themselves.
      const timers = sectionLanding === 'checks' ? [] : [400, 1200].map(ms => setTimeout(land, ms));
      const stop = () => { timers.forEach(timer => clearTimeout(timer)); ['wheel', 'touchstart', 'keydown'].forEach(name => window.removeEventListener?.(name, stop)); };
      ['wheel', 'touchstart', 'keydown'].forEach(name => window.addEventListener?.(name, stop, { once: true, passive: true }));
      setTimeout(stop, 1300);
    }
    const next = new URLSearchParams(searchParams?.toString());
    next.delete('section');
    router.replace(`/companies/${companyId}/expenses/${expenseId}${next.size ? `?${next}` : ''}`, { scroll: false });
  }, [sectionLanding, loading, detail, companyId, expenseId, router, searchParams]);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [extractionLoading, setExtractionLoading] = useState(false);
  const extractionAttemptRef = useRef<ExpenseExtractionAttempt | null>(null);
  const extractionRequestRunningRef = useRef(false);
  const extractionRunIdRef = useRef(0);
  const [notice, setNotice] = useState<ExtractionNotice | null>(null);
  const noticeConsumedRef = useRef<string | null>(null);
  const [dataErrorCount, setDataErrorCount] = useState<number | null>(null);
  const [dataErrorMessage, setDataErrorMessage] = useState<string | null>(null);
  const onDataValidationChange = useCallback((count: number, message: string | null) => {
    setDataErrorCount(count); setDataErrorMessage(message);
  }, []);
  const reviewRequestPendingRef = useRef(false);
  const [reviewers, setReviewers] = useState<Array<{ userId: string; displayName: string }> | null>(null);
  const [requestedReviewer, setRequestedReviewer] = useState('');
  const [reviewRequestOpen, setReviewRequestOpen] = useState(false);
  const [reviewersError, setReviewersError] = useState<string | null>(null);
  const [reviewersRetry, setReviewersRetry] = useState(0);
  useEffect(() => {
    if (!detail || !['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION', 'REJECTED'].includes(detail.status) || !(canReview || (caps.canUpdate && detail.createdByUserId === userId))) return;
    let active = true; setReviewers(null); setReviewersError(null);
    void getExpenseReviewers(companyId, expenseId).then(people => { if (active) { setReviewers(people); setRequestedReviewer(previous => people.length === 1 ? people[0]!.userId : people.some(person => person.userId === previous) ? previous : ''); } }).catch(cause => { if (active) setReviewersError(err(cause)); });
    return () => { active = false; };
  }, [companyId, expenseId, detail?.id, reviewersRetry, canReview, caps.canUpdate, userId]);
  const [reason, setReason] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const correctionReasonRef = useRef<HTMLTextAreaElement>(null);
  const correctionCloseRef = useRef<HTMLButtonElement>(null);
  const rejectReasonRef = useRef<HTMLTextAreaElement>(null);
  const [ocrTotalReason, setOcrTotalReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [afterCorrectionFocus, setAfterCorrectionFocus] = useState<{ paymentId?: string } | null>(null);
  const dialogOpenerRef = useRef<HTMLElement | null>(null);
  const rememberDialogOpener = (button?: HTMLElement) => {
    const active = button ?? (typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null);
    dialogOpenerRef.current = active?.closest('details')?.querySelector<HTMLElement>('summary') ?? active;
  };
  const [correctionAction, setCorrectionAction] = useState<{ paymentId?: string } | null>(null);
  useEffect(() => {
    if (!correctionAction && !showReject) {
      const opener = dialogOpenerRef.current;
      dialogOpenerRef.current = null;
      if (!opener) return;
      const frame = window.requestAnimationFrame(() => opener.focus({ preventScroll: true }));
      return () => window.cancelAnimationFrame(frame);
    }
    const frame = window.requestAnimationFrame(() => {
      if (afterCorrectionFocus) return;
      const control = correctionAction ? correctionReasonRef.current ?? correctionCloseRef.current : rejectReasonRef.current;
      const heading = control?.closest('[role="dialog"]')?.querySelector<HTMLElement>('[data-expense-dialog-heading]');
      (window.matchMedia('(max-width: 639px), (pointer: coarse)').matches ? heading ?? control : control)?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [correctionAction, showReject, detail?.correctionCapabilities]);

  const [deleting, setDeleting] = useState(false);
  const [duplicateResolution, setDuplicateResolution] = useState<{ candidateId: string; action: 'dismiss' | 'confirm' } | null>(null);
  const [paidAmount, setPaidAmount] = useState('');
  const [amountFocused, setAmountFocused] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('BANK_TRANSFER');
  const [paidAt, setPaidAt] = useState<string>(() => todayCivilDate());
  const [paymentSlip, setPaymentSlip] = useState<File | null>(null);
  const [paymentSlipId, setPaymentSlipId] = useState<string | undefined>();
  const paymentAttemptRef = useRef<ExpensePaymentAttempt | null>(null);
  const paymentPendingRef = useRef(false);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const paymentNoticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!afterCorrectionFocus || correctionAction) return;
    if (afterCorrectionFocus.paymentId) {
      const scope = showReject ? document.querySelector('[role="dialog"]') : document;
      const history = scope?.querySelector<HTMLElement>('[data-testid="expense-payment-history"]');
      const row = history?.querySelector<HTMLElement>(`[data-payment-id="${afterCorrectionFocus.paymentId}"]`);
      focusExpenseField(row ?? history, history?.querySelector<HTMLElement>('[data-payment-history-heading]'));
    } else focusExpenseField(document.getElementById('expense-review-start'));
    setAfterCorrectionFocus(null);
  }, [afterCorrectionFocus, correctionAction, showReject]);
  const reviewStartRef = useRef<HTMLDivElement>(null);
  const [paymentFailure, setPaymentFailure] = useState<ExpensePaymentFailure | 'refresh_failed' | null>(null);
  const prefilledBalanceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!detail || paymentAttemptRef.current || paymentPendingRef.current) return;
    const key = `${detail.id}:${detail.outstandingAmount}`;
    if (prefilledBalanceRef.current === key) return;
    prefilledBalanceRef.current = key;
    setPaidAmount(expensePaymentFormState(detail.outstandingAmount, '', paidAt).prefill);
  }, [detail?.id, detail?.outstandingAmount, paidAt]);
  const [receiptUploading, setReceiptUploading] = useState(false);
  // §16.4 / §17.6: the file intents, the durable read job, and the two answers a conflict can give.
  const fileOperationRef = useRef<{ key: string; operationId: string } | null>(null);
  const [conflictReload, setConflictReload] = useState(false);
  const [readState, setReadState] = useState<ExpenseReadStatusFile | null>(null);
  const [freeAllowance, setFreeAllowance] = useState<ExpenseReadStatusResult['freeAllowance']>(undefined);
  const [preview, setPreview] = useState<ExpensePreviewSource | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSaving, setPreviewSaving] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  // guided stepper (editable drafts only): freely clickable step; initial value computed once per opened expense
  const [step, setStep] = useState<ExpenseReviewStepKey>('data');
  // Details-step edits are saved by navigation (ถัดไป/ย้อนกลับ/chips), not an in-section save button.
  const reviewSaveRef = useRef<((explicitDraftSave?: boolean) => Promise<boolean>) | null>(null);
  const evidenceSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  // Dirtiness still guards leaving for the separate certificate journey.
  const [evidenceDirty, setEvidenceDirty] = useState(false);
  const [dataDirty, setDataDirty] = useState(false);
  // Plan 13.11.B: the VAT card owns "ใช้ยอดตามเอกสาร" (it is where the numbers and the pointed line
  // are), but the decision only takes effect on this page's confirm. Null unless a reviewer has both
  // named the VAT line taking the difference and written a reason.
  const vatOverrideRef = useRef<ExpenseVatSourceOverrideInput | null>(null);
  const [stepSaving, setStepSaving] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);
  // A typed reason survives closing its window (✕, Escape, the safe button); it is cleared only when
  // another thing is asked about, or after the action went through.
  const reasonOwner = useRef('');
  const keepReasonFor = (owner: string) => { if (reasonOwner.current !== owner) setReason(''); reasonOwner.current = owner; };
  const openReject = (event?: { currentTarget?: HTMLElement }) => {
    rememberDialogOpener(event?.currentTarget);
    keepReasonFor('reject'); setError(null); setShowReject(true); setShowVoid(false); setDuplicateResolution(null);
  };
  const closeReject = () => {
    if (actionLoading) return;
    setShowReject(false);
  };
  const openVoid = () => { keepReasonFor('void'); setError(null); setShowVoid(true); setShowReject(false); setDuplicateResolution(null); };
  const closeVoid = () => { if (actionLoading) return; setShowVoid(false); setError(null); };
  const openDuplicate = (candidateId: string, action: 'dismiss' | 'confirm') => {
    keepReasonFor(`${candidateId}:${action}`); setError(null); setShowReject(false); setShowVoid(false); setDuplicateResolution({ candidateId, action });
  };
  const closeDuplicate = () => { if (actionLoading) return; setDuplicateResolution(null); setError(null); };
  // Navigation saves the current data or evidence before advancing; earlier steps stay reachable.
  const goToStep = async (key: ExpenseReviewStepKey) => {
    if (aiReading || stepSaving) return false;
    if (step === 'evidence' && key === 'review' && evidenceSaveRef.current) {
      setStepSaving(true);
      const saved = await evidenceSaveRef.current().finally(() => setStepSaving(false));
      if (!saved) return false;
    }
    // Skip a clean issued certificate, but never discard unsaved input by advancing past it.
    // The existing save reports a server refusal and keeps the person on the editable step.
    const substituteLocked = detail?.substituteReceiptEvidence?.status === 'ISSUED';
    if (step === 'data' && key !== 'data' && reviewSaveRef.current && (!substituteLocked || dataDirty)) {
      setStepSaving(true);
      const saved = await reviewSaveRef.current().finally(() => setStepSaving(false));
      if (!saved) return false; // stay on the step — the section shows the error
    }
    setStep(key);
    return true;
  };
  const stepInitRef = useRef<string | null>(null);
  // inline viewer (left pane): signed URLs cached per attachment, fetched lazily (they expire in 15 min)
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerUrls, setViewerUrls] = useState<Record<string, string>>({});
  const viewerUrlsRef = useRef<Record<string, string>>({});
  const [viewerError, setViewerError] = useState<string | null>(null);
  const viewerRetriedRef = useRef<Record<string, number>>({});
  const auditRef = useRef<HTMLDivElement>(null);
  const moneyRef = useRef<HTMLDivElement>(null);
  const vendorRef = useRef<HTMLDivElement>(null);
  const documentsRef = useRef<HTMLDivElement>(null);
  const paymentRef = useRef<HTMLDivElement>(null);
  const [reviewFocus, setReviewFocus] = useState<{ step: ExpenseReviewStepKey; id?: string } | null>(null);
  useEffect(() => {
    if (!reviewFocus || step !== reviewFocus.step) return;
    const target = reviewFocus.id ? document.getElementById(reviewFocus.id)
      : vendorRef.current?.querySelector<HTMLElement>('[data-testid="transaction-tax-selector"]') ?? vendorRef.current;
    const field = target?.matches('input, textarea, button, select') ? target
      : target?.querySelector<HTMLElement>('[aria-invalid="true"], input:not([type="hidden"]), textarea, button, select, a') ?? target;
    if (field) { focusExpenseField(field); setReviewFocus(null); }
  }, [reviewFocus, step]);

  const releasePreviewUrl = useCallback(() => {
    const url = previewUrlRef.current;
    previewUrlRef.current = null;
    if (url) URL.revokeObjectURL(url);
  }, []);

  const commitPreview = useCallback((requestId: number, source: ExpensePreviewSource) => {
    if (requestId !== previewRequestRef.current) {
      if (source.url.startsWith('blob:')) URL.revokeObjectURL(source.url);
      return false;
    }
    releasePreviewUrl();
    if (source.url.startsWith('blob:')) previewUrlRef.current = source.url;
    setPreviewError(null);
    setPreview({
      ...source,
      ...(source.onViewed ? {
        onViewed: () => {
          if (requestId !== previewRequestRef.current) return;
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
    setPreviewLoading(false);
  }, [releasePreviewUrl]);

  useEffect(() => {
    previewRequestRef.current += 1;
    releasePreviewUrl();
    setPreview(null);
    setPreviewLoading(false);
    setPreviewError(null);
    return () => {
      previewRequestRef.current += 1;
      releasePreviewUrl();
    };
  }, [companyId, expenseId, detail?.substituteReceiptEvidence?.id, detail?.substituteReceiptEvidence?.updatedAt, releasePreviewUrl]);

  const cacheViewerUrl = useCallback((attachmentId: string, url: string) => {
    const previous = viewerUrlsRef.current[attachmentId];
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    viewerUrlsRef.current = { ...viewerUrlsRef.current, [attachmentId]: url };
    setViewerUrls(viewerUrlsRef.current);
  }, []);

  const dropViewerUrl = useCallback((attachmentId: string) => {
    const current = viewerUrlsRef.current[attachmentId];
    if (current) URL.revokeObjectURL(current);
    const next = { ...viewerUrlsRef.current };
    delete next[attachmentId];
    viewerUrlsRef.current = next;
    setViewerUrls(next);
  }, []);

  const clearViewerUrls = useCallback(() => {
    Object.values(viewerUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    viewerUrlsRef.current = {};
    setViewerUrls({});
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setDetail(await getExpense(companyId, expenseId)); } catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, expenseId]);
  useEffect(() => { setCorrectionReason(''); void load(); }, [load]);

  /** One operation id per (intent, file, revision); a retry of the same thing reuses it verbatim. */
  const fileOperationId = (intent: 'replace' | 'append', file: File, revision: string): string => {
    const key = `${intent}:${revision}:${file.name}:${file.size}`;
    const current = fileOperationRef.current?.key === key
      ? fileOperationRef.current
      : { key, operationId: globalThis.crypto.randomUUID() };
    fileOperationRef.current = current;
    return current.operationId;
  };

  /** UXE-21/UXE-22: a conflict is answered with "open the latest data", never with a silent retry. */
  const setFileIntentError = (cause: unknown) => {
    const code = apiErrorCode(cause);
    setConflictReload(code === 'expense_revision_conflict' || code === 'expense_receipt_replace_conflict'
      || code === 'expense_receipt_replace_operation_conflict' || code === 'EXPENSE_UPDATE_CONFLICT');
    setError(err(cause, locale));
  };

  useEffect(() => {
    extractionRunIdRef.current += 1;
    extractionAttemptRef.current = null;
    extractionRequestRunningRef.current = false;
    setExtractionLoading(false);
  }, [companyId, expenseId]);

  // Appendix §3: a PDF is read by a durable job, so the page follows the job instead of waiting on a
  // request. Polling starts only for a record that HAS a file, stops the moment the job is terminal,
  // and never asks for another read.
  useEffect(() => {
    setReadState(null);
    setFreeAllowance(undefined);
    if (!detail?.primaryAttachmentId) return;
    let cancelled = false;
    const runId = extractionRunIdRef.current;
    void getExpenseReadStatus(companyId, expenseId)
      .then((result) => { if (!cancelled && runId === extractionRunIdRef.current) { setReadState(result.files[0] ?? null); setFreeAllowance(result.freeAllowance); } })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [companyId, expenseId, detail?.primaryAttachmentId]);

  const readRunning = captureReadIsRunning(readState?.status ?? null);
  useEffect(() => {
    if (!readRunning) return;
    let cancelled = false;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void getExpenseReadStatus(companyId, expenseId)
        .then(async (result) => {
          if (cancelled) return;
          const file = result.files[0] ?? null;
          setFreeAllowance(result.freeAllowance);
          // Keep the form locked until the applied full/partial result is on screen. If refreshing
          // fails, leave the running state intact so the next poll retries the read, never the OCR.
          if ((file?.status === 'DONE' || file?.status === 'PARTIAL') && file.applied !== false) {
            const refreshed = await getExpense(companyId, expenseId);
            if (cancelled) return;
            setDetail(refreshed);
          }
          setReadState(file);
        })
        .catch(() => undefined)
        .finally(() => { polling = false; });
    }, 3_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [companyId, expenseId, detail?.primaryAttachmentId, readRunning]);

  useEffect(() => {
    const stored = consumeStoredNoticeOnce<ExtractionNotice>(window.sessionStorage, expenseNoticeKey(expenseId), expenseId, noticeConsumedRef);
    if (stored !== undefined) setNotice(stored);
  }, [expenseId]);

  // Initial step = first not-done step when the modal opens (READY_FOR_CONFIRMATION → review).
  // Guarded per expenseId so in-modal refreshes never auto-jump the user to another step.
  useEffect(() => {
    if (!detail || detail.id !== expenseId || stepInitRef.current === expenseId) return;
    stepInitRef.current = expenseId;
    setStep(window.location?.hash === `#expense-input-vat-${detail.id}` ? 'evidence' : isBlockedCheckBillClassification(detail.aiVerificationSummaryJson) && !(detail.status === 'READY_FOR_CONFIRMATION' && canConfirm)
      ? 'evidence'
      : initialExpenseReviewStep(deriveExpenseReviewSteps(detail, canReview), detail.status, canConfirm));
  }, [detail, expenseId, canReview, canConfirm]);

  useEffect(() => {
    if (!paymentNotice || detail?.status === 'CONFIRMED') return;
    const frame = window.requestAnimationFrame(() => {
      focusExpenseField(paymentNoticeRef.current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [paymentNotice, detail?.status]);

  // Signed URL is fetched on click, not on panel open: it expires in 15 min.
  const openPreview = async (attachment: ExpenseDetail['attachments'][number]) => {
    const requestId = ++previewRequestRef.current;
    setPreviewLoading(true); setError(null);
    try {
      const blob = await fetchAttachmentPreviewBlob(companyId, attachment.id, attachment.mimeType);
      if (requestId !== previewRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      commitPreview(requestId, { name: attachment.originalFileName, mimeType: attachment.mimeType, url });
    } catch (e) {
      if (requestId === previewRequestRef.current) setError(err(e));
    } finally {
      if (requestId === previewRequestRef.current) setPreviewLoading(false);
    }
  };

  const refreshChangedDocument = async (cause: unknown, operation: 'payment' | 'correction' | 'other'): Promise<string | null> => {
    const failure = cause as { message?: unknown; details?: { message?: unknown } };
    const message = failure?.message ?? failure?.details?.message;
    const code = apiErrorCode(cause) ?? (typeof message === 'string' ? message : null);
    if (!['expense_payment_exceeds_outstanding', 'expense_payment_changed', 'expense_payment_not_confirmed', 'expense_payment_already_cancelled',
      'expense_correction_source_changed', 'expense_correction_blocked', 'expense_payment_correction_blocked',
      'expense_paid_exceeds_payable', 'expense_rejection_payments_recorded', 'expense_rejection_paid_balance', 'EXPENSE_UPDATE_CONFLICT'].includes(code ?? '')
      && !(code?.startsWith('expense_confirmation_') && code.endsWith('_changed'))) return null;
    try {
      const refreshed = await getExpense(companyId, expenseId);
      setDetail(refreshed); setConflictReload(false);
      paymentAttemptRef.current = null; setPaymentFailure(null);
      setPaidAmount(expensePaymentFormState(refreshed.outstandingAmount, '', paidAt).prefill);
      if (operation === 'payment' && refreshed.status !== 'CONFIRMED') return refreshed.correctionOpenedAt
        ? EXPENSE_CORRECTION_WORDS.paymentOnReopened : EXPENSE_CORRECTION_WORDS.paymentOnUnconfirmed;
      if (operation === 'correction' && correctionAction?.paymentId && refreshed.payments?.find(p => p.id === correctionAction.paymentId)?.status === 'VOIDED') return EXPENSE_CORRECTION_WORDS.paymentAlreadyCancelled;
      if (operation === 'correction' && !correctionAction?.paymentId && refreshed.correctionOpenedAt && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(refreshed.status)) return EXPENSE_CORRECTION_WORDS.alreadyReopened;
      return EXPENSE_CORRECTION_WORDS.sourceRefreshed;
    } catch { setConflictReload(true); return EXPENSE_CORRECTION_WORDS.sourceRefreshFailed; }
  };

  const doAction = async (fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(true); setError(null);
    try { await fn(); await load(); onRefresh(); if (successMessage) toast.success(successMessage); return true; }
    catch (e) { setError(await refreshChangedDocument(e, 'other') ?? err(e)); return false; }
    finally { setActionLoading(false); }
  };

  const [whtIssuing, setWhtIssuing] = useState(false);
  const [whtIssueError, setWhtIssueError] = useState<string | null>(null);
  const [whtLoading, setWhtLoading] = useState(false);
  // Read the durable handoff on every confirmed revision, including later visits.
  const [whtCertificatesComplete, setWhtCertificatesComplete] = useState<boolean | null>(null);
  const [whtHandoff, setWhtHandoff] = useState<WhtCertificateHandoffDto | null>(null);
  useEffect(() => {
    if (!detail || detail.status !== 'CONFIRMED' || !(Number(detail.whtAmount) > 0) || !permissions.some((permission) => ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link'].includes(permission))) {
      setWhtHandoff(null);
      return;
    }
    let cancelled = false;
    setWhtLoading(true); setWhtIssueError(null); setWhtHandoff(null);
    listWhtHandoffs(companyId, { sourcePaymentId: expenseId })
      .then((handoffs) => { if (!cancelled) setWhtHandoff(handoffs.find((handoff) => handoff.status !== 'CANCELLED') ?? null); })
      .catch((e) => { if (!cancelled) setWhtIssueError(err(e)); })
      .finally(() => { if (!cancelled) setWhtLoading(false); });
    return () => { cancelled = true; };
  }, [companyId, expenseId, detail?.status, detail?.whtAmount, detail?.updatedAt, permissions]);

  const [correctOpen, setCorrectOpen] = useState(false);
  const [correctBusy, setCorrectBusy] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [replaceBusy, setReplaceBusy] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [correctForm, setCorrectForm] = useState({
    incomeCategoryCode: '', incomeCategoryName: '', whtRate: '', grossAmount: '', withheldAmount: '',
    paymentDate: '', formType: 'PND53' as ExpenseCertificateCorrectionValues['formType'],
    payeeName: '', payeeTaxId: '', payeeAddress: '', payeeBranchCode: '', reason: '',
    opened: null as ExpenseCertificateCorrectionValues | null,
  });
  const openCorrectForm = () => {
    if (!whtHandoff) return;
    const values = expenseCertificateCorrectionValues(whtHandoff);
    setCorrectForm({ ...values, reason: '', opened: values });
    setCorrectError(null);
    setCorrectOpen(true);
  };

  const doCorrectWht = async () => {
    if (!whtHandoff || correctBusy || !correctForm.reason.trim()) return;
    const corrected = expenseCertificateCorrectionChanges(correctForm, correctForm.opened);
    if (!Object.keys(corrected).length) { setCorrectError('ยังไม่ได้แก้ไขข้อมูลใด'); return; }
    setCorrectBusy(true); setCorrectError(null);
    try {
      const result = await correctSystemWhtCertificate(companyId, whtHandoff.id, {
        corrected,
        reason: correctForm.reason.trim(),
      });
      downloadArtifact(result.pdfArtifact);
      setCorrectOpen(false);
      toast.success(t('expenses.certificate_card.corrected', locale).replace('{number}', result.certificateNumber));
      // Re-read the certificate (including its form type) before another correction can open.
      setWhtHandoff({ ...whtHandoff, status: 'SYSTEM_ISSUED', certificateId: result.id, certificateNumber: result.certificateNumber ?? null, certificateIssuedAt: result.issuedAt ?? null, currentCertificate: null, systemCorrectionOpen: false }); setWhtLoading(true); setWhtIssueError(null);
      try {
        const handoffs = await listWhtHandoffs(companyId, { sourcePaymentId: expenseId });
        setWhtHandoff(handoffs.find(handoff => handoff.id === whtHandoff.id) ?? null);
      } catch (cause) { setWhtIssueError(err(cause)); }
      finally { setWhtLoading(false); }
    } catch (e) {
      setCorrectError(err(e));
    } finally { setCorrectBusy(false); }
  };

  const doReplaceWht = async () => {
    if (!whtHandoff) return;
    setReplaceBusy(true); setReplaceError(null);
    try {
      const result = await issueSystemWhtReplacementCopy(companyId, whtHandoff.id);
      downloadArtifact(result.pdfArtifact);
      toast.success(t('expenses.certificates.replacement_toast', locale).replace('{number}', result.certificateNumber));
    } catch (e) {
      setReplaceError(err(e));
    } finally { setReplaceBusy(false); }
  };

  // After confirming, the result and the next presses are at the top of the page.
  const showConfirmedResult = () => { if (typeof window !== 'undefined') window.scrollTo({ top: 0 }); };
  const doConfirm = async () => {
    if (await doAction(() => confirmExpense(companyId, expenseId, vatOverrideRef.current ?? undefined), 'ยืนยันเอกสารแล้ว')) showConfirmedResult();
  };
  const confirmInOnePass = async () => {
    if (!canConfirm || !detail) return;
    if (await doAction(async () => {
      const confirmed = await sendAndConfirmExpense(
        () => canReview ? markExpenseReadyAsReviewer(companyId, expenseId) : markExpenseReady(companyId, expenseId),
        override => confirmExpense(companyId, expenseId, override),
        sent => setDetail(current => current ? { ...current, ...sent } : current),
        vatOverrideRef.current ?? undefined,
      );
      setDetail(current => current ? { ...current, ...confirmed } : current);
    }, 'ยืนยันเอกสารแล้ว')) showConfirmedResult();
  };

  const doIssueWhtCertificate = async (selectedHandoff = whtHandoff, paymentId?: string) => {
    const whtHandoff = selectedHandoff;
    if (!detail || !whtHandoff || !canIssueExpenseWhtCertificate(detail, whtHandoff, uiPermissions) || !!whtHandoff.payerMissing?.length || !whtPayeeAddress(whtHandoff.payeeAddress, whtHandoff.prefill.payeeSnapshot.address)) return;
    setWhtIssuing(true); setWhtIssueError(null);
    try {
      const result = await issueSystemWhtCertificate(companyId, whtHandoff.id, { paymentId });
      downloadArtifact(result.pdfArtifact);
      setWhtHandoff({ ...whtHandoff, status: 'SYSTEM_ISSUED', certificateId: result.id, certificateNumber: result.certificateNumber ?? null, certificateIssuedAt: result.issuedAt ?? null, currentCertificate: null, systemCorrectionOpen: false });
      await load();
      toast.success(result.certificateNumber ? t('expenses.certificates.issued_toast', locale).replace('{number}', result.certificateNumber) : 'ออกหนังสือรับรองแล้ว');
    } catch (e) { setWhtIssueError(err(e)); }
    finally { setWhtIssuing(false); }
  };

  const downloadWht = async (selectedHandoff = whtHandoff) => {
    const whtHandoff = selectedHandoff;
    if (!whtHandoff) return;
    setWhtIssuing(true); setWhtIssueError(null);
    try {
      const result = await downloadSystemWhtCertificate(companyId, whtHandoff.id);
      downloadArtifact(result.pdfArtifact);
      toast.success(`ดาวน์โหลดหนังสือรับรอง ${result.certificateNumber} แล้ว`);
    }
    catch (e) { setWhtIssueError(err(e)); }
    finally { setWhtIssuing(false); }
  };

  const editPayment = (change: () => void) => {
    if (paymentPendingRef.current) return;
    setPaymentFailure(null);
    if (paymentAttemptRef.current) {
      paymentAttemptRef.current = null;
      setPaymentNotice('คุณแก้ไขข้อมูลแล้ว การบันทึกครั้งถัดไปเป็นรายการจ่ายใหม่ ตรวจประวัติการจ่ายก่อนเพื่อไม่ให้จ่ายซ้ำ');
    }
    change();
  };

  const submitPayment = async () => {
    if (paymentPendingRef.current || actionLoading) return;
    if (conflictReload || paymentFailure === 'conflict') { focusExpenseField(document.getElementById('expense-payment-notice')); return; }
    const invalid = expensePaymentFormState(detail?.outstandingAmount ?? '0', paidAmount, paidAt).disabledReason;
    if (!paymentAttemptRef.current && invalid) {
      focusExpenseField(document.getElementById(expensePaymentFormState(detail?.outstandingAmount ?? '0', paidAmount, todayCivilDate()).disabledReason ? 'expense-payment-amount' : 'expense-payment-paid-at'));
      return;
    }
    if (!paymentAttemptRef.current && !detail?.correctionCapabilities?.canRecordPayment) return;
    paymentPendingRef.current = true;
    setActionLoading(true); setError(null);
    try {
      let slipAttachmentId = paymentSlipId;
      if (paymentSlip && !slipAttachmentId) {
        slipAttachmentId = await uploadExpensePaymentSlip(companyId, expenseId, paymentSlip);
        setPaymentSlipId(slipAttachmentId);
      }
      const attempt = expensePaymentAttempt(paymentAttemptRef.current, companyId, expenseId, { paidAmount, paymentMethod, paidAt, ...(slipAttachmentId ? { slipAttachmentId } : {}) });
      paymentAttemptRef.current = attempt;
      await recordExpensePayment(companyId, expenseId, attempt.payload);
      let refreshed: ExpenseDetail;
      try {
        // Shared load() catches GET failures internally; it cannot confirm fresh payment totals.
        refreshed = await getExpense(companyId, expenseId);
      } catch {
        setPaymentFailure('refresh_failed');
        setPaymentNotice(PAYMENT_SAVED_REFRESH_NOTICE);
        return;
      }
      setDetail(refreshed);
      setPaymentSlip(null); setPaymentSlipId(undefined);
      paymentAttemptRef.current = null;
      setPaidAmount(expensePaymentFormState(refreshed.outstandingAmount, '', paidAt).prefill); setPaymentFailure(null); setPaymentNotice(null);
      // A successful replay may report a source voided since the original payment.
      toast.success(refreshed.status === 'VOIDED' ? 'รายการนี้ถูกยกเลิกแล้ว ไม่มีการบันทึกจ่ายเพิ่ม' : `บันทึกจ่ายแล้ว ${baht(attempt.payload.paidAmount)}`);
    } catch (e) {
      if (paymentAttemptRef.current) {
        const failure = classifyExpensePaymentFailure(e, paymentFailure === 'uncertain' || paymentFailure === 'refresh_failed');
        if (paymentFailure === 'refresh_failed' && failure === 'uncertain') {
          // A refused retry cannot undo the POST we already know succeeded.
          setPaymentNotice(PAYMENT_SAVED_REFRESH_NOTICE);
          return;
        }
        setPaymentFailure(failure === 'definitive' ? null : failure);
        if (failure === 'definitive') {
          paymentAttemptRef.current = null;
          setPaymentNotice(null);
        } else {
          setPaymentNotice(failure === 'conflict'
            ? 'ข้อมูลรายการนี้ไม่ตรงกับการจ่ายที่บันทึกไว้ ตรวจประวัติการจ่ายก่อนแก้ไขเป็นรายการใหม่'
            : 'ยังยืนยันผลการบันทึกไม่ได้ กด “ลองบันทึกรายการเดิมอีกครั้ง” ได้โดยไม่เพิ่มยอดจ่ายซ้ำ หากจะเปลี่ยนข้อมูล ตรวจประวัติการจ่ายก่อน');
        }
      }
      setPaymentNotice(await refreshChangedDocument(e, 'payment') ?? err(e));
      return;
    } finally {
      paymentPendingRef.current = false;
      setActionLoading(false);
    }
    onRefresh();
  };

  // A named request remains here to show who received it; the existing restart action returns to the list.
  const markReady = async (successMessage = 'ส่งให้ตรวจแล้ว', reviewerId?: string) => {
    if (reviewRequestPendingRef.current) return;
    reviewRequestPendingRef.current = true;
    setActionLoading(true); setError(null);
    try {
      await (canReview ? markExpenseReadyAsReviewer(companyId, expenseId, reviewerId) : markExpenseReady(companyId, expenseId, reviewerId));
      if (reviewerId) { await load(); setReviewRequestOpen(false); setActionLoading(false); return; }
      onRefresh();
      router.replace(`/companies/${companyId}/expenses?highlight=${encodeURIComponent(expenseId)}`);
      toast.success(successMessage);
      // Left set on purpose: the navigation unmounts this page, and re-enabling the button would
      // let a second submit fire against an expense that already moved on.
    } catch (e) { setError(await refreshChangedDocument(e, 'other') ?? err(e)); setActionLoading(false); }
    finally { reviewRequestPendingRef.current = false; }
  };

  // Not doAction: the record is gone on success, so reloading it would 404. Leave `deleting` set —
  // the navigation unmounts this page, and re-enabling the button would point it at a dead id.
  const removeExpense = async () => {
    setDeleting(true); setError(null);
    try {
      await deleteExpense(companyId, expenseId);
      onRefresh();
      router.push(`/companies/${companyId}/expenses`);
    } catch (e) { setError(expenseDeleteErrorMessage(e, locale, detail?.status)); setDeleting(false); setShowDelete(false); }
  };

  // Manually-entered expenses start with no file; confirmation needs a receipt in
  // the primary slot (supporting evidence does not satisfy that rule).
  //
  // Owner report 2026-08-29 (UAT): เปลี่ยนไฟล์ใบเสร็จ swapped the file and left the draft showing
  // the OLD file's numbers — the upload page runs the AI read itself (ExpensesPages `handleUpload`
  // → requestExpenseExtraction) and this path never did. While the record is still a draft the new
  // primary now goes through the same read, so the fields the reviewer checks belong to the file on
  // screen. Past drafting the record keeps today's behaviour: an approver's numbers are not
  // rewritten under them. The server retires the file being replaced (CompleteReceiptUploadUseCase).
  const removeExpenseFile = async (attachment: ExpenseDetail['attachments'][number]) => {
    const purpose = attachment.purpose;
    if (!detail || receiptRemovalPending.current || !isRemovableFilePurpose(purpose)) return;
    const primary = purpose === 'expense.receipt.primary';
    receiptRemovalPending.current = true;
    setReceiptRemoving(true);
    try {
      const accepted = await confirm({
        title: locale === 'th' ? 'ลบไฟล์นี้ออกจากรายการ?' : 'Remove this file?',
        message: locale === 'th'
          ? `ลบไฟล์ “${attachment.originalFileName}” ออกจากรายการนี้โดยไม่ต้องอัปโหลดใหม่ รายการค่าใช้จ่ายและยอดที่บันทึกไว้จะยังอยู่${primary ? " ผลตรวจจากใบเสร็จเดิมจะถูกล้าง ตรวจข้อมูลและหลักฐานอีกครั้ง" : " ไฟล์อื่นในรายการจะยังอยู่"}`
          : `Remove “${attachment.originalFileName}” without uploading a replacement. Saved expense details and amounts remain.${primary ? " Receipt verification will be cleared; review the data and evidence again." : " Other files remain attached."}`,
        confirmLabel: locale === 'th' ? 'ลบไฟล์' : 'Remove file',
        cancelLabel: locale === 'th' ? 'ยกเลิก' : 'Cancel',
        variant: 'danger',
      });
      if (!accepted) return;
      setError(null);
      await removeExpenseReceipt(companyId, expenseId, attachment.id, { expectedUpdatedAt: detail.updatedAt, purpose });
      extractionRunIdRef.current += 1;
      extractionAttemptRef.current = null;
      extractionRequestRunningRef.current = false;
      writeExpenseExtractionAttempt(availableExpenseSessionStorage(window), companyId, expenseId, null);
      setNotice(null);
      setViewerIndex(0);
      await load();
      toast.success(locale === 'th' ? 'ลบไฟล์ออกจากรายการแล้ว' : 'File removed');
    } catch (error) { setError(err(error)); }
    finally { receiptRemovalPending.current = false; setReceiptRemoving(false); }
  };

  /**
   * "เปลี่ยนไฟล์ใบเสร็จนี้" = `replace` (spec §16.4). The server is told which revision and which
   * primary the user was looking at, so a record someone else changed meanwhile answers a conflict
   * instead of quietly taking this file; the operation id is minted per attempt and REUSED when the
   * same file is sent again, so a lost response resolves to the first result, not a second winner.
   */
  const attachPrimaryReceipt = async (file: File, branchId: string | null) => {
    if (!detail) return;
    const reread = shouldRereadReplacedReceipt({ status: detail.status, canExtract });
    const operationId = fileOperationId('replace', file, detail.updatedAt);
    setReceiptUploading(true); setError(null); setConflictReload(false);
    try {
      const attachmentId = await uploadExpenseEvidenceFile(companyId, expenseId, branchId, file, 'expense.receipt.primary', {
        intent: 'replace',
        expectedUpdatedAt: detail.updatedAt,
        ...(detail.primaryAttachmentId ? { expectedPrimaryAttachmentId: detail.primaryAttachmentId } : {}),
        operationId,
      });
      fileOperationRef.current = null;
      extractionRunIdRef.current += 1;
      extractionAttemptRef.current = null;
      extractionRequestRunningRef.current = false;
      writeExpenseExtractionAttempt(availableExpenseSessionStorage(window), companyId, expenseId, null);
      await load(); onRefresh();
      toast.success(t('expenses.receipt_attached', locale));
      if (reread) await extractAgain(attachmentId);
    } catch (e) { setFileIntentError(e); } finally { setReceiptUploading(false); }
  };

  /** "แนบหลักฐานเพิ่ม" = `append`: supporting evidence only, never the primary, never a retire. */
  const appendSupportingReceipt = async (file: File, branchId: string | null) => {
    if (!detail) return;
    const operationId = fileOperationId('append', file, detail.updatedAt);
    setReceiptUploading(true); setError(null); setConflictReload(false);
    try {
      await uploadExpenseEvidenceFile(companyId, expenseId, branchId, file, 'expense.receipt.supporting', {
        intent: 'append', expectedUpdatedAt: detail.updatedAt, operationId,
      });
      fileOperationRef.current = null;
      await load(); onRefresh();
      toast.success(t('expenses.receipt_attached', locale));
    } catch (e) { setFileIntentError(e); } finally { setReceiptUploading(false); }
  };

  const checkDuplicates = async () => {
    setActionLoading(true); setError(null);
    try {
      const { openCandidates } = await runDuplicateCheck(companyId, expenseId);
      await load(); onRefresh();
      if (openCandidates === 0) toast.success(t('expenses.dup_check_none', locale));
      else toast.warning(t('expenses.dup_check_found', locale).replace('{count}', String(openCandidates)));
    } catch (e) { setError(err(e)); }
    finally { setActionLoading(false); }
  };

  const extractAgain = async (attachmentIdOverride?: string) => {
    if (extractionRequestRunningRef.current || (receiptUploading && !attachmentIdOverride)) return;
    extractionRequestRunningRef.current = true;
    const runId = ++extractionRunIdRef.current;
    setExtractionLoading(true); setError(null);
    try {
      const attachmentId = attachmentIdOverride ?? activePrimaryReceiptAttachmentId(detail?.attachments ?? []);
      const storage = availableExpenseSessionStorage(window);
      const stored = readExpenseExtractionAttempt(storage, companyId, expenseId, attachmentId);
      const previous = extractionAttemptRef.current?.attachmentId === attachmentId
        ? extractionAttemptRef.current
        : stored;
      const attempt = previous?.attachmentId === attachmentId
        ? previous
        : { requestId: globalThis.crypto.randomUUID(), attachmentId };
      extractionAttemptRef.current = attempt;
      writeExpenseExtractionAttempt(storage, companyId, expenseId, attempt);
      const outcome = await requestExpenseExtractionWithRecovery({
        attempt,
        request: (requestId) => requestExpenseExtraction(companyId, expenseId, requestId),
        read: () => getExpense(companyId, expenseId),
        wait: () => new Promise((resolve) => setTimeout(resolve, 1500)),
        resume: previous !== null,
      });
      if (runId !== extractionRunIdRef.current) return;
      // The same attachment can start a durable job. Start polling even if the detail refresh fails.
      if (outcome.result.readJobId && attachmentId) {
        setReadState({
          fileId: null, attachmentId, status: outcome.result.readStatus ?? 'QUEUED',
          pagesRead: 0, pageCount: null, pausedReason: null, lastErrorCode: null,
        });
      }
      setNotice(extractionNotice(outcome.result, locale));
      if (outcome.recoveredDetail) setDetail(outcome.recoveredDetail);
      else {
        const refreshed = await getExpense(companyId, expenseId);
        if (runId !== extractionRunIdRef.current) return;
        setDetail(refreshed);
      }
      if (runId !== extractionRunIdRef.current) return;
      onRefresh();
      if (!outcome.pending) {
        extractionAttemptRef.current = null;
        writeExpenseExtractionAttempt(storage, companyId, expenseId, null);
      }
    } catch (e) {
      if (runId !== extractionRunIdRef.current) return;
      if (!expenseExtractionResponseIsUnknown(e)) {
        extractionAttemptRef.current = null;
        writeExpenseExtractionAttempt(availableExpenseSessionStorage(window), companyId, expenseId, null);
      }
      setError(err(e));
    }
    finally {
      if (runId === extractionRunIdRef.current) {
        extractionRequestRunningRef.current = false;
        setExtractionLoading(false);
      }
    }
  };

  useEffect(() => {
    setViewerIndex(0);
    clearViewerUrls();
  }, [clearViewerUrls, expenseId]);
  useEffect(() => () => {
    Object.values(viewerUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    viewerUrlsRef.current = {};
  }, []);

  const attachments = detail ? expenseDisplayAttachments(detail) : [];
  const safeViewerIndex = Math.min(viewerIndex, Math.max(0, attachments.length - 1));
  const activeAttachment = attachments[safeViewerIndex] ?? null;
  const activeAttachmentId = activeAttachment?.id ?? null;
  const activeViewerUrl = activeAttachmentId ? viewerUrls[activeAttachmentId] : undefined;

  useEffect(() => {
    if (!activeAttachmentId || viewerUrls[activeAttachmentId]) return;
    let cancelled = false;
    setViewerError(null);
    fetchAttachmentPreviewBlob(companyId, activeAttachmentId, activeAttachment!.mimeType)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        if (cancelled) URL.revokeObjectURL(url);
        else cacheViewerUrl(activeAttachmentId, url);
      })
      .catch((e) => { if (!cancelled) setViewerError(err(e)); });
    return () => { cancelled = true; };
  }, [activeAttachment, activeAttachmentId, cacheViewerUrl, companyId, viewerUrls]);

  // Signed URLs expire after 15 min: on a load error drop the cached URL so the effect refetches.
  // Rate-limited per attachment (not once-only) so a second expiry in a long session still recovers,
  // while a permanently broken file can't refetch in a tight loop.
  const retryViewerUrl = () => {
    if (!activeAttachmentId) return;
    const lastRetry = viewerRetriedRef.current[activeAttachmentId] ?? 0;
    if (Date.now() - lastRetry < 20000) return;
    viewerRetriedRef.current[activeAttachmentId] = Date.now();
    dropViewerUrl(activeAttachmentId);
  };
  // iframes never fire onError on HTTP errors, so PDFs need a manual reload path.
  const reloadViewerUrl = () => {
    if (!activeAttachmentId) return;
    viewerRetriedRef.current[activeAttachmentId] = Date.now();
    dropViewerUrl(activeAttachmentId);
  };

  // A real anchor, not a button: it navigates to another URL, so cmd/middle-click must open a tab
  // and assistive tech must announce a link rather than an action.
  // Both forms report their own unsaved changes (step 1 and step 2); a read-only page never does.
  const unsavedTyping = dataDirty || evidenceDirty;
  unsavedRef.current = unsavedTyping;
  const backTarget = expenseListBackTarget(`/companies/${companyId}/expenses`, listBack, expenseId);
  const backLink = <Link className="mangmee-btn mangmee-btn-secondary !min-h-9 !py-1.5" href={backTarget} onClick={(event) => {
    // Typed text is never lost without a word. (The shared leave question brings a CSS module, which the pinned rendered spec cannot load: this asks on the way back, and the browser asks before the tab closes.)
    if (!unsavedTyping) return;
    event.preventDefault();
    void confirm({ title: 'ยังไม่ได้บันทึกสิ่งที่แก้', message: 'ออกจากหน้านี้ สิ่งที่แก้ไว้จะหายไป', confirmLabel: 'ออกโดยไม่บันทึก', cancelLabel: 'อยู่ต่อ', variant: 'danger' })
      .then(leave => { if (leave) router.push(backTarget); });
  }}>กลับไปรายการ</Link>;

  if (loading && !detail) {
    return (
      <MangmeePage className="mangmee-flat" back={backLink} title={t('expenses.loading', locale)}>
        <MangmeeCard className="flex items-center justify-center gap-3 p-10 text-sm text-gray-500">
          <InlineSpinner /> {t('expenses.loading', locale)}
        </MangmeeCard>
      </MangmeePage>
    );
  }
  if (!detail) {
    return (
      <MangmeePage className="mangmee-flat" back={backLink} title={t('expenses.not_found', locale)}>
        <ErrorBanner message={error ?? t('expenses.not_found', locale)} />
      </MangmeePage>
    );
  }

  const claimedSource = Boolean(detail.reimbursementProgress?.requestId && detail.reimbursementProgress.status !== 'DRAFT');
  // A claim's own expense record ends with its claim: the API refuses to void, reject or delete it from here.
  const claimRecord = isClaimExpenseRecord(detail);
  const claimNote = claimExpenseRecordNote(detail);
  const canReject = caps.canReject && !claimRecord;
  const isCancelled = detail.status === 'VOIDED';
  // A cancelled draft is as finished as a cancelled document: same banner, nothing that still reads as work to do.
  const isDead = isCancelled || detail.status === 'REJECTED';
  const isMutable = !claimedSource && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status);
  // Backend: PATCH/mark-ready require expense.review OR (expense.update AND owner) — ownership alone is not enough.
  const isOwnRecord = detail.createdByUserId === userId;
  const canMutateDraft = !freeExpenseDrafts && isMutable && (canReview || (caps.canUpdate && isOwnRecord));
  // Extraction: expense.ocr.request OR expense.review OR (expense.receipt.upload on own record).
  const canExtract = !isCancelled && !claimedSource && (caps.canRequestOcr || (caps.canUploadReceipts && isOwnRecord));
  // Fixed correction marker: h-5 plus the stepper's gap-1.5 = 1.625rem.
  const viewerOffsetRem = (isMutable ? STEPPER_REM : 0) + (isMutable && detail.correctionOpenedAt ? 1.625 : 0);
  const viewerTop = `calc(var(--app-header-h) + ${viewerOffsetRem}rem)`;
  const isConfirmed = detail.status === 'CONFIRMED';
  const expenseCertificate = currentExpenseCertificate(whtHandoff, detail.correctionCapabilities?.certificateOnExpense, uiPermissions);
  const correctionCertificate = correctionAction && !correctionAction.paymentId ? expenseCertificate : null;
  const certificateVoidOpen = showVoid && Boolean(expenseCertificate);
  const correctionAllowed = correctionAction?.paymentId
    ? detail.correctionCapabilities?.payments.find(p => p.id === correctionAction.paymentId)?.canCancel === true
    : detail.correctionCapabilities?.canReopen === true;
  const hasRecordedPayments = detail.payments?.some(p => p.status === 'RECORDED') ?? false;
  const paymentForm = expensePaymentFormState(detail.outstandingAmount, paidAmount, paidAt, Boolean(paymentAttemptRef.current), undefined, hasRecordedPayments);
  // The model gives the reason; an amount over what is owed is said with the amount it is compared to.
  const paymentAmountError = expensePaymentFormState(detail.outstandingAmount, paidAmount, todayCivilDate(), Boolean(paymentAttemptRef.current)).disabledReason;
  const paymentAmountLimit = `ยอดที่จ่ายต้องไม่เกินยอดค้างจ่าย ${baht(detail.outstandingAmount)}`;
  const paymentReason = paymentAmountError && Number(paidAmount) > Number(paymentForm.prefill) ? paymentAmountLimit : paymentAmountError;
  const canCancelFinancialExpense = !claimedSource && !claimRecord && canVoidExpenseFinancialState(detail);
  const canGenerateJournal = isConfirmed && caps.canPostLedger && detail.pendingPostingSourceType !== null;
  const canViewJournal = isConfirmed && caps.canReadLedger && detail.journalEntryId !== null;
  const canCheckDuplicates = canReview && canRunExpenseDuplicateCheck(detail.status);
  const hasDuplicates = hasUnresolvedDuplicateWarning(detail.duplicateStatus);
  const isConfirmedDuplicate = detail.duplicateStatus === 'CONFIRMED_DUPLICATE';
  const sourceDraftView = expenseSourceDraftViewState(detail, freeExpenseDrafts ? false : canMutateDraft && canReview);
  const visibleSourceDraft = sourceDraftView.sourceDraft;
  const sourceDraftIncomplete = sourceDraftView.incomplete;
  const sourceOnlyDraft = freeExpenseDrafts || (sourceDraftView.sourceOnly && !(detail.status === 'READY_FOR_CONFIRMATION' && canConfirm));
  const financialTotalUnknown = sourceDraftView.financialTotalUnknown;
  const readySourceDraftMessage = detail.status === 'READY_FOR_CONFIRMATION' && sourceDraftIncomplete
    ? t(canReview ? 'expenses.source_draft_ready_reviewer_help' : 'expenses.source_draft_ready_waiting_help', locale)
    : undefined;
  const duplicateBlockMessage = t(isConfirmedDuplicate ? 'expenses.duplicate_confirmed_block' : 'expenses.duplicate_action_required', locale);
  const hasWht = Number(detail.whtAmount) > 0;
  // Spec §7.5: a document that already records VAT keeps showing it, whatever the workspace mode.
  const showsVat = showsTaxCapture(capture.mode, hasRecordedTax([{ vatAmount: detail.vatAmount }, ...detail.lines]));
  const hasPriceMismatch = hasAiGrandTotalMismatch(detail.aiVerifiedFieldsJson, detail.grandTotalAmount);
  const isZeroAmount = Number(detail.grandTotalAmount) === 0;
  const aiMap = detail.aiVerificationSummaryJson as Record<string, unknown> | null;
  const hasAiOutput = Boolean(detail.extractionId || Object.keys(detail.aiVerifiedFieldsJson ?? {}).length || typeof aiMap?.['status'] === 'string');
  // §17.2 mapping of the durable read job. DONE says nothing here — the filled fields are the
  // result — so only a running read or an ending that did NOT read everything speaks.
  const readNotice = readState && readState.status !== 'DONE' ? captureReadNotice(readState) : null;
  const readNoticeText = captureReadNoticeText(readState, locale);
  // Appendix §25: the reader found more than one document in this one file, and the ENGINE already
  // split them — the first onto this draft, each further one onto its own ordinary draft. There is
  // no group page and no button: the notice says what was created and links to it.
  //
  // The READ JOB is the authority whenever there is one, because the split ids come off the job
  // itself. A record with no job (the synchronous single-image lane) keeps its OCR classification,
  // which is all it has.
  const multiDocumentDetected = !freeExpenseDrafts && (readState
    ? readState.multiDocument === true
    : (aiMap?.['classification'] as { contentKind?: string } | undefined)?.contentKind === 'MULTI_DOCUMENT');
  const splitExpenseIds = readState?.splitExpenseIds ?? [];
  const autoSplitNotice = multiDocumentDetected && splitExpenseIds.length > 0
    ? t('expenses.capture.auto_split', locale).replace('{count}', String(readState?.documentCount ?? splitExpenseIds.length + 1))
    : null;
  /**
   * "อ่านเอกสารอีกครั้ง" is a deliberate intent on a file that has NOT just failed to be read
   * (§17.6). After a terminal failure — or under an error notice — the way forward is this form,
   * and offering a reread there is the loop the spec removed.
   */
  const readAgainAllowed = attachments.length > 0 && captureReadAgainAllowed({
    canExtract, readStatus: readState?.status ?? null, noticeTone: notice?.tone ?? null,
  });
  const classificationBlocked = deriveExpenseClassificationReviewState(aiMap, canReview).blocked;
  const checkBillBlocked = isBlockedCheckBillClassification(aiMap);
  const classificationBlockMessage = t(checkBillBlocked ? 'expenses.check_bill_workflow_blocked' : 'expenses.non_expense_workflow_blocked', locale);
  // An issued certificate locks the material fields server-side, so บันทึกการตรวจ would 409 there —
  // unsaved edits must not be able to strand such a record on step 2.
  const substituteLocked = detail.substituteReceiptEvidence?.status === 'ISSUED';
  // One truth for step 2: what disables ถัดไป is what is printed under it. See expenses.model.
  const evidenceStepBlocker = expenseEvidenceStepBlocker({
    checkBillBlocked, classificationBlocked, canReview, unsavedReview: evidenceDirty && !substituteLocked,
    reviewRequired: isMutable && canReview && !substituteLocked && !hasCurrentExpenseDocumentReview(detail),
  });
  // Owner 2026-09-01: while the AI read is in flight (a fresh read or the replace-file re-read),
  // the on-screen values are about to be overwritten — editing them or pressing ถัดไป races the
  // result. One flag covers both lanes and drives the field cover AND the footer buttons.
  const aiReading = extractionLoading || receiptUploading || readRunning;
  const evidenceError = expenseEvidenceConfirmationError(detail);
  const needsReceiptOrSubstitute = expenseNeedsReceiptOrSubstitute(detail);
  const substituteAction = expenseSubstituteReceiptAction(companyId, detail.id, detail.aiVerificationSummaryJson, detail.substituteReceiptEvidence);
  const canStartSubstitute = isMutable && canReview && hasCurrentExpenseDocumentReview(detail) && expenseEvidenceAssessment(detail)?.route === 'SUBSTITUTE_RECEIPT' && !evidenceDirty && !aiReading && !stepSaving;
  const canEditLinkedSubstitute = Boolean(canReview && detail.substituteReceiptEvidence && canEditSubstituteReceipt(detail, detail.substituteReceiptEvidence));
  const openSubstituteReceipt = async (editPayment = false) => {
    if (aiReading || stepSaving || evidenceDirty) return;
    if (!detail.substituteReceiptEvidence && !canStartSubstitute) return;
    if (detail.substituteReceiptEvidence?.status === 'SUPERSEDED') {
      router.push(`/companies/${encodeURIComponent(companyId)}/expenses/substitute-receipts/${encodeURIComponent(detail.substituteReceiptEvidence.id)}`);
      return;
    }
    if (step === 'data' && reviewSaveRef.current && !substituteLocked) {
      setStepSaving(true);
      const saved = await reviewSaveRef.current().finally(() => setStepSaving(false));
      if (!saved) return;
    }
    router.push(editPayment ? `${substituteAction.href}?edit=payment` : substituteAction.href);
  };
  const ocrTotalUnacknowledged = needsAiTotalAcknowledgement(detail);
  // Audit H-11: isZeroAmount only ever rendered a warning below and was missing from this gate, so
  // the button stayed live on a ฿0 expense. The API refuses it now; including it here means the
  // reviewer is told before the round trip, and the button no longer disagrees with the rule.
  const personalSubstitute = detail.substituteReceiptEvidence?.fundingSource === 'PERSONAL_ADVANCE';
  const currentPreview = reviewTotals?.revision === `${detail.id}:${detail.updatedAt}` ? reviewTotals : null;
  const previewTotals = currentPreview?.status === 'ready' ? currentPreview.totals : undefined;
  const money = previewTotals ?? detail;
  const overpaidAmount = expenseOverpaidAmount({ paidAmount: detail.paidAmount, netPayableAmount: money.netPayableAmount });
  const hasPaymentHistory = (detail.payments?.length ?? 0) > 0;
  const canCancelRecordedPayment = detail.correctionCapabilities?.payments.some(p => p.canCancel) ?? false;
  const overpaymentCue = overpaidAmount ? `${EXPENSE_CORRECTION_WORDS.overpaid} ${baht(overpaidAmount)}` : null;
  const overpaymentMessage = overpaymentCue ? `${overpaymentCue} ${expenseOverpaymentRemedy(hasRecordedPayments, canCancelRecordedPayment)}` : null;
  const detailsStepDone = deriveExpenseReviewSteps(detail, canReview).some(entry => entry.key === 'data' && entry.state === 'done');
  const confirmationChecksPass = detailsStepDone && !overpaidAmount && !personalSubstitute && canConfirm && !sourceDraftIncomplete && !hasDuplicates && !classificationBlocked && !evidenceError && !needsReceiptOrSubstitute && !ocrTotalUnacknowledged && !isZeroAmount;
  const canConfirmExpense = confirmationChecksPass && detail.status === 'READY_FOR_CONFIRMATION';
  // Owner requirement 2026-08-28: the reason used to live only in the button's `title`, i.e. a hover
  // tooltip — and expenses get reviewed on a phone, where nothing hovers. One helper decides it now,
  // both footers use it, and it is rendered as text under the button instead of hidden behind a cursor.
  const confirmBlocker = canConfirm && !confirmationChecksPass
    ? expenseConfirmBlocker({
      status: isMutable ? 'READY_FOR_CONFIRMATION' : detail.status, classificationBlocked, hasDuplicates, isConfirmedDuplicate, needsReceiptOrSubstitute,
      evidenceError, ocrTotalUnacknowledged, isZeroAmount, classificationBlockMessage,
    })
    : null;
  const receiptProblem = expenseEvidenceAssessment(detail)?.receiptProblem;
  const noReceipt = receiptProblem === 'NOT_AVAILABLE' || receiptProblem === 'LOST';
  const evidenceReviewText = hasCurrentExpenseDocumentReview(detail)
    ? t('expenses.confirm_needs_substitute', locale)
    : t(receiptProblem === 'NOT_AVAILABLE' || receiptProblem === 'LOST'
      ? 'expenses.confirm_needs_receipt_review' : 'expenses.confirm_needs_document_review', locale);
  const auditChecks = deriveExpenseAuditChecks(detail);
  const evidenceFailures = deriveEvidenceRowFlags({ ...detail, categoryName: detail.categoryName === undefined ? (detail.expenseCategoryId ? 'หมวดที่บันทึกไว้' : null) : detail.categoryName, sourceReimbursementRequestId: detail.sourceReimbursementRequestId ?? null })
    .filter(flag => flag.severity === 'warn');
  const dataCheck = !detailsStepDone ? auditChecks.find(check => ['vendor_name', 'document_date'].includes(check.key) && check.status === 'warn') : undefined;
  const confirmBlockedText = overpaymentMessage ?? (personalSubstitute ? 'ใบรับรองนี้ระบุว่าพนักงานจ่ายร้านแล้ว การคืนเงินต้องทำแยกตามขั้นตอนการเงิน'
    : dataCheck?.label ?? (sourceDraftIncomplete ? t('expenses.source_draft_blocks_progress', locale)
      : !detailsStepDone ? 'ตรวจรายการค่าใช้จ่ายให้ครบก่อนยืนยัน'
      : confirmBlocker ? (confirmBlocker.key === 'expenses.confirm_needs_document_review' ? evidenceReviewText : confirmBlocker.literal ?? t(confirmBlocker.key!, locale)) : null));
  const goToReviewField = async (targetStep: ExpenseReviewStepKey, id: string) => {
    if (await goToStep(targetStep)) setReviewFocus({ step: targetStep, id });
  };
  const auditFixAction = (key: string) => {
    if (key === 'receipt' && (canStartSubstitute || detail.substituteReceiptEvidence)) return (
      <button type="button" className={ghostClass} disabled={aiReading || stepSaving || evidenceDirty} aria-busy={Boolean(aiReading || stepSaving)} onClick={() => void openSubstituteReceipt()}>
        {detail.substituteReceiptEvidence ? 'เปิดใบรับรองแทนใบเสร็จ' : 'ทำใบรับรองแทนใบเสร็จ'}
      </button>
    );
    const targets: Record<string, readonly [ExpenseReviewStepKey, string, string]> = {
      vendor_name: ['data', `expense-vendor-name-${detail.id}`, 'เติมชื่อผู้ขาย'],
      vendor_tax_id: ['data', `expense-vendor-tax-${detail.id}`, 'ตรวจเลขผู้เสียภาษี'],
      document_number: ['data', `expense-document-number-${detail.id}`, 'เติมเลขที่เอกสาร'],
      document_date: ['data', `expense-date-${detail.id}`, 'ตรวจวันที่'],
      vat_check: ['data', `expense-vat-mode-${detail.id}`, 'ตรวจยอดภาษี'],
      data: ['data', `expense-review-fields-${detail.id}`, 'ตรวจข้อมูล'],
      amount: ['data', `expense-line-items-${detail.id}`, 'ตรวจรายการและยอดเงิน'],
      tax_evidence: ['evidence', `expense-tax-evidence-${detail.id}`, 'ตรวจหลักฐานรายจ่าย'],
      evidence: ['evidence', `expense-document-review-${detail.id}`, t('expenses.go_to_evidence', locale)],
      receipt: ['evidence', `expense-document-review-${detail.id}`, t('expenses.go_to_evidence', locale)],
      duplicate: ['review', `expense-duplicates-${detail.id}`, 'ตรวจรายการซ้ำ'],
      ocr: ['evidence', `expense-ocr-reason-${detail.id}`, 'ตรวจยอดเงิน'],
    };
    const target = targets[key];
    if (!target) return null;
    return <button type="button" className={ghostClass} disabled={aiReading || stepSaving} aria-busy={Boolean(aiReading || stepSaving)}
      onClick={() => void goToReviewField(target[0], target[1])}>{target[2]}</button>;
  };
  const confirmFixKey = overpaymentMessage ? 'amount' : personalSubstitute ? 'receipt' : dataCheck?.key ?? (sourceDraftIncomplete || !detailsStepDone || isZeroAmount ? 'amount'
    : evidenceError && detail.substituteReceiptEvidence ? 'receipt'
    : hasDuplicates ? 'duplicate' : ocrTotalUnacknowledged ? 'ocr' : 'evidence');
  const storedClassification = aiMap?.['classification'] && typeof aiMap['classification'] === 'object'
    ? aiMap['classification'] as Record<string, unknown>
    : null;
  const storedNonExpenseNotice = classificationBlocked
    && typeof storedClassification?.['contentKind'] === 'string'
    && typeof storedClassification?.['documentKind'] === 'string'
    ? nonExpenseNotice(storedClassification as Pick<BusinessDocumentClassification, 'contentKind' | 'documentKind'>, locale)
    : null;
  const storedResolution = aiMap?.['classificationResolution'] && typeof aiMap['classificationResolution'] === 'object'
    ? aiMap['classificationResolution'] as Record<string, unknown>
    : null;
  const storedClassificationOverrideNotice = aiMap?.['status'] === 'NOT_EXPENSE_DOCUMENT'
    && !classificationBlocked
    && typeof storedClassification?.['documentKind'] === 'string'
    && typeof storedResolution?.['reason'] === 'string'
    && typeof storedResolution?.['resolvedByUserId'] === 'string'
    && typeof storedResolution?.['resolvedAt'] === 'string'
    ? `${t('expenses.non_expense_override_recorded', locale)}: ${DOCUMENT_KIND_LABELS[locale][storedClassification['documentKind']] ?? 'เอกสารธุรกิจอื่น'} — ${storedResolution['reason']} · ${formatThaiDateTime(storedResolution['resolvedAt'])}`
    : null;
  const missingFields = Array.isArray(aiMap?.['missingFields'])
    ? aiMap.missingFields.filter((field): field is string => typeof field === 'string' && Boolean(AI_MISSING_FIELD_LABELS[field]))
    : [];
  const aiMissingDataFields = expenseAiMissingFields(aiMap, 'data');

  const auditPassCount = auditChecks.filter((check) => check.status === 'pass').length;
  const auditWarnCount = auditChecks.filter((check) => check.status === 'warn').length + (overpaymentMessage ? 1 : 0);
  const confirmBlockers = canMutateDraft && (classificationBlocked || (detail.status === 'READY_FOR_CONFIRMATION' && (isZeroAmount || hasDuplicates)));
  const warnNoteClass = 'rounded-xl border border-warning-100 bg-warning-50 px-3 py-2 text-xs font-semibold text-warning-700';
  // A confirmed expense is opened to pay it or to issue its certificate: those two cards come first, then the record.
  const actionsFirst = isConfirmed && !sourceOnlyDraft;
  const reservation = detail.correctionCapabilities?.disbursementReservation;
  const owed = Number(detail.outstandingAmount) > 0;
  const reopenBlockers = detail.correctionCapabilities?.reopenBlockers ?? [];
  // Someone who may not edit at all did not ask why the record is locked: say nothing about it.
  const lockShown = !detail.correctionCapabilities?.canReopen && !reopenBlockers.includes('permission_denied');
  const lockReasonCount = expenseReopenBlockerMessages(detail.correctionCapabilities, caps.canReadLedger).length;
  const certificateJumpShown = hasWht && (whtCertificatesComplete === false || whtHandoff?.status === 'REQUIRED');
  // The box names the document and opens it only when it also says why the record is locked; otherwise the payment card says it all, once.
  const reservationSaidAbove = isConfirmed && lockShown && reopenBlockers.includes('disbursement_reserved');
  const reservationLinkShown = reservationSaidAbove && Boolean(reservation?.voucherId) && reservation?.viewerMay !== 'none';
  const approverOnlyActions = !claimedSource && !canMutateDraft && detail.status === 'READY_FOR_CONFIRMATION' && (canConfirm || canReject) && (sourceOnlyDraft || !canConfirm);
  const canRestartReview = detail.status === 'REJECTED' && (canReview || (caps.canUpdate && isOwnRecord));
  const canDelete = canDeleteExpense(detail, userId, caps);
  const hasFooterActions = canMutateDraft || (isMutable && canConfirm && detail.status === 'READY_FOR_CONFIRMATION') || approverOnlyActions || isConfirmed || (canCancelFinancialExpense && caps.canVoid) || canRestartReview || canDelete;
  // Guided stepper only for editable drafts (canMutateDraft already implies status ∈ {DRAFT, NEEDS_REVIEW, READY_FOR_CONFIRMATION});
  // every other status/viewer keeps the continuous-scroll layout and footer untouched.
  const guided = (canMutateDraft || (isMutable && canConfirm && detail.status === 'READY_FOR_CONFIRMATION')) && !sourceOnlyDraft;
  const showOverpaymentActionNotice = !checkBillBlocked && (
    (guided && step === 'review' && (detail.status !== 'READY_FOR_CONFIRMATION' || canConfirm))
    || (approverOnlyActions && canConfirm)
  );
  // Beside ส่งให้ตรวจ the over-payment blocks nothing yet: say what is true there, not the block sentence.
  const overpaymentSendable = guided && detail.status !== 'READY_FOR_CONFIRMATION';
  const confirmationNoticeText = overpaymentMessage
    ? showOverpaymentActionNotice ? overpaymentSendable ? `${overpaymentCue} ${t('expenses.sendable_while_overpaid', locale)}` : overpaymentMessage : null
    : confirmBlockedText;
  const confirmBlockedNotice = confirmationNoticeText ? (
    <Notice tone="warning" className="w-full" action={auditFixAction(confirmFixKey)}>
      <p id={overpaymentMessage ? 'expense-review-overpayment' : undefined} role="status">
        {!overpaymentMessage && canConfirm && `${t('expenses.confirm_blocked_prefix', locale)} `}{confirmationNoticeText}
      </p>
    </Notice>
  ) : null;
  const overpaymentPaymentNotice = overpaymentMessage && (
    <p role="status" data-testid="expense-payment-overpayment" className="mb-3 text-sm text-error-700">{showOverpaymentActionNotice ? overpaymentCue : overpaymentMessage}</p>
  );
  const steps = guided ? deriveExpenseReviewSteps(detail, canReview) : [];
  const stepIndex = steps.findIndex((entry) => entry.key === step);
  // Validation explains what to fix; Next stays pressable and takes the person to that field.
  const validationBlockMessage = expenseDataStepBlocker({
    errorCount: dataErrorCount, firstErrorMessage: dataErrorMessage,
    countMessage: t('expenses.v_blocking_count', locale).replace('{count}', String(dataErrorCount ?? 0)),
  }) ?? undefined;

  const documentDateLabel = (visibleSourceDraft ? !visibleSourceDraft.header.expenseDate : !expenseDateIsReadable(detail.aiVerificationSummaryJson))
    ? t('expenses.source_draft_date_unknown', locale)
    : dateShort(visibleSourceDraft?.header.expenseDate ?? detail.expenseDate);
  // The title names the payee; its number and kind of paper sit underneath.
  // An expense with no seller name of its own is headed by the payee its certificate names, not by "waiting".
  const pageTitle = firstFilled(detail.vendorNameSnapshot, detail.substituteReceiptEvidence?.status !== 'SUPERSEDED' ? detail.substituteReceiptEvidence?.payeeName : null) ?? t('expenses.vendor_pending', locale);
  const pageMeta = (
    <span className="mt-1.5 flex w-full flex-wrap gap-2">
      <MangmeeBadge tone={expenseListStatus(detail).tone}>{expenseListStatus(detail).label}</MangmeeBadge>
      {detail.reimbursementProgress?.requestId && <Link className="text-sm font-semibold text-brand-700 underline" href={`/companies/${companyId}/reimbursements?tab=mine&focus=${detail.reimbursementProgress.requestId}`}>เปิดใบเบิกคืน</Link>}
      {detail.costSourceExpenseId && <Link className="text-sm font-semibold text-brand-700 underline" href={`/companies/${companyId}/expenses/${detail.costSourceExpenseId}`}>เปิดค่าใช้จ่ายต้นทาง</Link>}
      {claimRecord && <Link className="text-sm font-semibold text-brand-700 underline" href={`/companies/${companyId}/reimbursements/${detail.sourceReimbursementRequestId}`}>เปิดใบเบิก</Link>}
      {claimNote && <span className="w-full text-xs text-gray-500">{claimNote}</span>}
      {claimedSource && <span className="w-full text-xs text-gray-500">หลักฐานต้นทางของใบเบิก รายการนี้นับยอดครั้งเดียวร่วมกับรายการบัญชีจากใบเบิก การแก้ไขและจ่ายคืนให้ทำผ่านใบเบิก</span>}
      {!sourceOnlyDraft && (isMutable || isConfirmed && detail.inputVatClaimStatus === 'NEEDS_REVIEW') && showInputVatQuestion(detail) && <MangmeeBadge tone={detail.inputVatClaimStatus === 'NEEDS_REVIEW' ? 'amber' : 'slate'}>{detail.inputVatRight?.reasonCode === 'RECORDED_BEFORE_INPUT_VAT_DECISION' ? inputVatRightLabel(detail) : `${INPUT_VAT_RIGHT_LABEL}: ${inputVatRightLabel(detail)}`}</MangmeeBadge>}
    </span>
  );
  const pageDescription = (
    <span className="flex flex-wrap items-center gap-x-3">
      <span className="mangmee-unit tabular-nums font-semibold text-gray-700">{firstFilled(detail.expenseNumber) ?? 'ยังไม่มีเลขรายจ่าย'}</span>
      {isMutable && detail.expenseNumber && <button type="button" className={cx(tapTargetClass, 'rounded-lg text-sm font-semibold text-brand-700')} onClick={async () => {
        try { await navigator.clipboard.writeText(detail.expenseNumber!); toast.success('คัดลอกเลขรายจ่ายแล้ว'); }
        catch { setError('คัดลอกไม่สำเร็จ เลือกเลขรายจ่ายแล้วคัดลอกเอง'); }
      }}>คัดลอกเลขรายจ่าย</button>}
      {pageMeta}
      {/* A paper whose kind is not chosen yet has no name to show: its date alone. */}
      <span className="w-full">{detail.sourceDocumentType === 'NEEDS_REVIEW' ? documentDateLabel : `${expenseSourceDocumentLabel(detail)} · ${documentDateLabel}`}</span>
    </span>
  );

  // Guided review exposes cancellation on every step, then deletion for a cancelled record.
  // Existing permission checks and financial-void actions still apply.
  const certificateCardVisible = !freeExpenseDrafts && isConfirmed && hasWht && uiPermissions.some(permission => ['wht.certificate.read', 'wht.certificate.issue', 'wht.external_certificate.link', 'wht.certificate.correct'].includes(permission));
  const certificateIssueButton = systemCertificatesAvailable && canIssueExpenseWhtCertificate(detail, whtHandoff, uiPermissions) && !whtHandoff?.payerMissing?.length && !!whtPayeeAddress(whtHandoff?.payeeAddress, whtHandoff?.prefill.payeeSnapshot.address) && (
    <WhtIssueButton handoff={whtHandoff} busy={whtIssuing} unpaid={detail.paymentStatus !== 'PAID'} label={t('wht.print_certificate', locale)} onIssue={() => doIssueWhtCertificate()} />
  );
  const changeCorrectForm = (changed: Partial<typeof correctForm>) => {
    setCorrectError(null);
    setCorrectForm(form => ({ ...form, ...changed }));
  };
  const correctionHasChanges = Object.keys(expenseCertificateCorrectionChanges(correctForm, correctForm.opened)).length > 0;
  const issuedCertificateActions = certificateCardVisible && (
    <ExpenseCertificateCard systemCertificatesAvailable={systemCertificatesAvailable} key={`${companyId}-${expenseId}`} companyId={companyId} expenseId={expenseId} revision={detail.updatedAt} handoff={whtHandoff} permissions={uiPermissions} issueButton={certificateIssueButton} onIssuePayment={doIssueWhtCertificate} onDownload={handoff => void downloadWht(handoff)} busy={whtIssuing} error={whtIssueError} primaryHidden={correctOpen && whtHandoff?.status === 'SYSTEM_ISSUED'} onChanged={next => setWhtHandoff(next)} onCoverageChanged={setWhtCertificatesComplete} onClearError={() => setWhtIssueError(null)}>
      {systemCertificatesAvailable && whtHandoff && (canCorrectWhtCertificate(whtHandoff, uiPermissions) || canIssueWhtReplacementCopy(whtHandoff, uiPermissions)) && <>
            {!correctOpen && replaceError && <ErrorBanner message={replaceError} />}
            {/* The two rarer actions under the download are one group: one size, no rule between them. */}
            <ActionGroup align="start">
              {!correctOpen && canIssueWhtReplacementCopy(whtHandoff, uiPermissions) && (
                <button type="button" className={ghostClass} aria-busy={replaceBusy} disabled={replaceBusy} onClick={() => void doReplaceWht()}>
                  {t(replaceBusy ? 'expenses.certificates.replacement_busy' : 'expenses.certificates.replacement', locale)}
                </button>
              )}
              {canCorrectWhtCertificate(whtHandoff, uiPermissions) && (
                <button type="button" className={ghostClass} aria-expanded={correctOpen} onClick={() => (correctOpen ? setCorrectOpen(false) : openCorrectForm())}>
                  {correctOpen ? 'ปิด' : 'แก้ไขหนังสือรับรอง'}
                </button>
              )}
            </ActionGroup>
            {canCorrectWhtCertificate(whtHandoff, uiPermissions) && (
              <div>
                {correctOpen && (
                  <form className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void doCorrectWht(); }}>
                    <label className="block" htmlFor={`wht-correct-payment-date-${detail.id}`}>
                      <span className="text-xs text-gray-600">วันที่จ่าย</span>
                      <ThemedDate id={`wht-correct-payment-date-${detail.id}`} className={inputClass} value={correctForm.paymentDate} onChange={(e) => changeCorrectForm({ paymentDate: e.target.value })} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-payee-name-${detail.id}`}>
                      <span className="text-xs text-gray-600">ชื่อผู้รับเงิน</span>
                      <input id={`wht-correct-payee-name-${detail.id}`} className={inputClass} value={correctForm.payeeName} onChange={(e) => changeCorrectForm({ payeeName: e.target.value })} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-payee-branch-${detail.id}`}>
                      <span className="text-xs text-gray-600">{t('expenses.certificate_card.payee_branch', locale)}</span>
                      <input id={`wht-correct-payee-branch-${detail.id}`} className={inputClass} value={correctForm.payeeBranchCode} onChange={(e) => changeCorrectForm({ payeeBranchCode: e.target.value })} disabled={correctBusy} />
                    </label>
                    <label className="block sm:col-span-2" htmlFor={`wht-correct-payee-address-${detail.id}`}>
                      <span className="text-xs text-gray-600">ที่อยู่ผู้รับเงิน</span>
                      <textarea rows={4} id={`wht-correct-payee-address-${detail.id}`} className={inputClass} value={correctForm.payeeAddress} onChange={(e) => changeCorrectForm({ payeeAddress: e.target.value })} disabled={correctBusy} />
                    </label>
                    <label className="block sm:col-span-2" htmlFor={`wht-correct-reason-${detail.id}`}>
                      <span className="text-xs text-gray-600">เหตุผลที่แก้ไข (บังคับ)</span>
                      <input id={`wht-correct-reason-${detail.id}`} className={inputClass} value={correctForm.reason} onChange={(e) => changeCorrectForm({ reason: e.target.value })} disabled={correctBusy} placeholder="เช่น สะกดชื่อผู้รับเงินผิด" />
                    </label>
                    {correctError && <div className="sm:col-span-2"><ErrorBanner message={correctError} /></div>}
                    <div className="space-y-2 sm:col-span-2">
                      <p>{t('expenses.certificate_card.correction_reissue_hint', locale)}</p>
                      <button type="submit" className={cx(btnClass, 'w-full sm:w-auto')} aria-busy={correctBusy} disabled={correctBusy || !correctForm.reason.trim() || !correctionHasChanges}>
                        {t(correctBusy ? 'expenses.certificate_card.correction_reissue_busy' : 'expenses.certificate_card.correction_reissue', locale)}
                      </button>
                      {!correctBusy && (!correctForm.reason.trim() || !correctionHasChanges) && <p className="text-sm text-gray-600">{t(!correctForm.reason.trim() ? 'expenses.certificate_card.correction_need_reason' : 'expenses.certificate_card.correction_unchanged', locale)}</p>}
                    </div>
                    <ExpenseCertificateCorrectionFields values={correctForm} />
                    <ExpenseCertificateCorrectionNote busy={correctBusy || actionLoading} onReopen={detail.correctionCapabilities?.canReopen ? () => { rememberDialogOpener(); setCorrectOpen(false); setCorrectionError(null); setCorrectionAction({}); } : undefined} />
                  </form>
                )}
              </div>
            )}
      </>}
    </ExpenseCertificateCard>
  );
  const openDelete = () => { setShowDelete(true); setShowReject(false); setShowVoid(false); setDuplicateResolution(null); };
  const reviewBackButton = guided && stepIndex > 0 && <button type="button" className={ghostClass}
    disabled={aiReading || stepSaving || actionLoading} aria-busy={Boolean(aiReading || stepSaving || actionLoading)}
    onClick={() => void goToStep(steps[stepIndex - 1].key)}>{t('expenses.step_back', locale)}</button>;
  // The rare actions: the way back first, the red ones last. One entry is shown as itself, none draws nothing.
  const menuEntries = [
    <button key="history" type="button" className={ghostClass} onClick={() => setShowHistory(true)}>ดูประวัติ</button>,
    ...(guided || approverOnlyActions || canRestartReview || (canCancelFinancialExpense && caps.canVoid) ? [
    canEditLinkedSubstitute && <button key="substitute" type="button" className={ghostClass} disabled={aiReading || stepSaving || evidenceDirty} aria-busy={Boolean(stepSaving)} onClick={() => void openSubstituteReceipt(true)}>{stepSaving ? 'กำลังบันทึก…' : 'แก้ไขใบรับรองแทนใบเสร็จ'}</button>,
    canCheckDuplicates && <button key="duplicates" type="button" className={ghostClass} onClick={checkDuplicates} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{t('expenses.check_duplicate', locale)}</button>,
    canRestartReview && <button key="restart" type="button" className={ghostClass} onClick={() => void markReady('เริ่มตรวจใหม่แล้ว')} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{t('expenses.restart_review', locale)}</button>,
    canCancelFinancialExpense && canGenerateJournal && detail.pendingPostingSourceType && (
      <button key="journal" type="button" className={ghostClass} onClick={() => doAction(() => generateSourceJournal(companyId, detail.pendingPostingSourceType!, detail.pendingPostingSourceId!), 'สร้างสมุดรายวันแล้ว')} disabled={actionLoading || !detail.pendingPostingSourceId} aria-busy={Boolean(actionLoading)}>
        {detail.postingStatus === 'posting_error'
          ? 'แก้ไขแล้ว ลองลงบัญชีอีกครั้ง'
          : detail.pendingPostingSourceType === 'expense.payment'
            ? 'ลงบัญชีการจ่าย'
            : 'สร้างและผ่านรายการ JV'}
      </button>
    ),
    canCancelFinancialExpense && canViewJournal && <button key="view-journal" type="button" className={ghostClass} onClick={onGoJournal}>{detail.journalEntryNumber ? `ดู ${detail.journalEntryNumber} →` : t('expenses.view_journal', locale)}</button>,
    // Invalid drafts remain cancellable on every step.
    (guided || approverOnlyActions) && canReject && <button key="reject" type="button" className={dangerClass} onClick={openReject} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{t(showReject && actionLoading ? 'expenses.rejecting' : 'expenses.reject', locale)}</button>,
    canCancelFinancialExpense && caps.canVoid && <button key="void" type="button" className={dangerClass} onClick={openVoid} disabled={actionLoading} aria-busy={false}>{t('expenses.void_document', locale)}</button>,
  ] : []),
  ].filter(Boolean);
  // The result reuses the list's permission and draft-state gate for deletion.
  const deleteShown = canDelete;
  const certificateLineShown = !freeExpenseDrafts && systemCertificatesAvailable && !certificateCardVisible && isConfirmed && hasWht && whtHandoff?.status === 'SYSTEM_ISSUED';
  const reviewNoticeClass = 'text-sm font-medium text-warning-700';
  // A bar with nothing to press is not drawn.
  const certificateBlock = <div id={`expense-wht-${detail.id}`} tabIndex={-1} className="scroll-mt-24">{issuedCertificateActions}</div>;
  const secondaryActions = (menuEntries.length > 0 || deleteShown) && <>
      {/* Hand-made on purpose: the shared MoreActions brings a CSS module, and the pinned rendered spec loads this page without a loader for one. */}
      {menuEntries.length > 0 ? (
        <details className="relative shrink-0" onClick={event => { if ((event.target as HTMLElement).closest('button')) { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
          <summary className={cx(ghostClass, 'h-11 sm:h-10 cursor-pointer list-none')} style={{ width: '100%' }}>เพิ่มเติม</summary>
          <div className="absolute right-0 top-full z-20 mt-2 flex min-w-48 flex-col gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">{menuEntries}</div>
        </details>
      ) : menuEntries}
        {deleteShown && <button type="button" className={dangerClass} onClick={openDelete} disabled={actionLoading || deleting} aria-busy={deleting}>ลบรายจ่าย</button>}

  </>;
  const modalFooter = hasFooterActions && (guided || approverOnlyActions || certificateLineShown) ? (
    <fieldset disabled={aiReading} inert={aiReading} className="flex min-w-0 w-full flex-wrap items-center gap-2">
      <div className="flex min-w-0 w-full items-center justify-end gap-2">
        {guided && (
          <>
            {step === 'review' && (
              <>

                {detail.status !== 'READY_FOR_CONFIRMATION' && (
                  <>
                    <ExpenseReviewSubmitActions back={reviewBackButton} canConfirm={canConfirm} busy={actionLoading} disabled={classificationBlocked || !detailsStepDone}
                      confirmDisabled={!confirmationChecksPass} onConfirm={confirmInOnePass} canSend={reviewers === null || reviewers.length > 0} onSend={async () => { setError(null); setReviewRequestOpen(true); }}
                      title={classificationBlocked ? classificationBlockMessage ?? undefined : sourceDraftIncomplete ? t('expenses.source_draft_blocks_progress', locale) : !detailsStepDone ? t('expenses.submit_requires_details', locale) : confirmBlockedText ?? undefined} />
                  </>
                )}
                {detail.status === 'READY_FOR_CONFIRMATION' && (
                  <>
                    <ActionGroup>{reviewBackButton}
                    {canConfirm && <button type="button" className={btnClass} onClick={() => void doConfirm()} disabled={actionLoading || !canConfirmExpense} aria-busy={Boolean(actionLoading)} title={confirmBlockedText ?? undefined}>{t('expenses.confirm_and_post', locale)}</button>}
                    </ActionGroup>
                  </>
                )}
              </>
            )}
            {stepIndex < steps.length - 1 && <ActionGroup>
              {step === 'data' && canMutateDraft && !readySourceDraftMessage && <button type="button" className={ghostClass} disabled={aiReading || stepSaving || reviewSaving} aria-busy={Boolean(stepSaving || reviewSaving)} onClick={async () => {
                if (!reviewSaveRef.current || stepSaving || reviewSaving) return;
                setStepSaving(true);
                try { await reviewSaveRef.current(true); } finally { setStepSaving(false); }
              }}>{stepSaving || reviewSaving ? t('expenses.source_draft_saving', locale) : t('expenses.review_save_draft', locale)}</button>}
              {stepIndex > 0 && <button type="button" className={ghostClass} disabled={stepSaving} aria-busy={Boolean(stepSaving)} onClick={() => void goToStep(steps[stepIndex - 1].key)}>{t('expenses.step_back', locale)}</button>}
              <button type="button" className={btnClass} disabled={aiReading || stepSaving} aria-busy={Boolean(stepSaving)} aria-describedby={step === 'data' && validationBlockMessage ? `expense-review-block-${detail.id}` : step === 'evidence' && evidenceStepBlocker ? `expense-review-evidence-block-${detail.id}` : undefined} title={step === 'data' ? validationBlockMessage : undefined} onClick={() => void goToStep(steps[stepIndex + 1].key)}>{stepSaving ? t('expenses.saving', locale) : t('expenses.step_next', locale)}</button></ActionGroup>}
          </>
        )}
        {approverOnlyActions && (
          <>
            {canConfirm && <button type="button" className={btnClass} onClick={() => void doConfirm()} disabled={actionLoading || !canConfirmExpense} aria-busy={Boolean(actionLoading)} title={confirmBlockedText ?? undefined}>{t('expenses.confirm_and_post', locale)}</button>}
          </>
        )}
        {certificateLineShown && (
          <div className="flex min-w-0 items-center gap-2 text-xs text-green-900">
            <p className="hidden whitespace-nowrap sm:block">{EXPENSE_CORRECTION_WORDS.certificateIssued}</p>
            <button type="button" className="whitespace-nowrap font-semibold underline underline-offset-2" disabled={whtIssuing} aria-busy={whtIssuing} onClick={() => void downloadWht()}>{EXPENSE_CORRECTION_WORDS.downloadAgain}</button>
          </div>
        )}

      </div>
    </fieldset>
  ) : null;
  const checkBillSecondaryActions = checkBillBlocked && (canReject || canDelete) ? (
    <div className="px-4 pb-4" inert={aiReading}>
      <details className="rounded-xl border border-gray-200 bg-white p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-gray-700">
          {t('expenses.check_bill_more_actions', locale)}
        </summary>
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <p className="text-sm leading-6 text-gray-600">{t('expenses.check_bill_more_actions_help', locale)}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {canReject && <button className={dangerClass} onClick={openReject} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{t('expenses.reject', locale)}</button>}
            {canDelete && <button className={dangerClass} onClick={openDelete} disabled={actionLoading || deleting} aria-busy={deleting}>ลบรายจ่าย</button>}
          </div>
        </div>
      </details>
    </div>
  ) : null;

  // Existing section JSX moved into named blocks (internals unchanged) so guided mode can show
  // them per step while every non-guided status keeps the exact current continuous-scroll order.
  const noticesBlock = (
    <>
      {/* extraction/AI notices stay above the fold, like the old panel header banners.
          The info-tone one only restates what the AI strip and the form fields below already show,
          so it is kept for the no-summary case and dropped once a summary exists. */}
      {notice && (notice.tone === 'error' || notice.persistent || !aiMap) && (notice.tone === 'error' ? <ErrorBanner message={notice.message} /> : <InfoBanner message={notice.message} />)}
      {/* §17.6: the READ's own state, beside the file and persisted — not a toast that scrolls away.
          A terminal failure says the file is saved and points at this form; it offers no reread. */}
      {readNotice && (readNotice.tone === 'error'
        ? <ErrorBanner message={readNoticeText} />
        : <InfoBanner message={readNoticeText} />)}
      {freeExpenseDrafts && freeAllowanceNotice(freeAllowance, locale) && <InfoBanner message={freeAllowanceNotice(freeAllowance, locale)!} />}
      {/* §16.4: values read from the file that was replaced, until a person confirms them here. */}
      {aiMap?.['sourceStale'] === true && <InfoBanner message={t('expenses.capture.source_stale', locale)} />}
      {autoSplitNotice
        ? (
          <div className="space-y-2" data-capture-auto-split>
            <InfoBanner message={autoSplitNotice} />
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {splitExpenseIds.map((id, index) => (
                <li key={id}>
                  <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 underline" href={`/companies/${companyId}/expenses/${encodeURIComponent(id)}`}>
                    {t('expenses.capture.auto_split_link', locale).replace('{index}', String(index + 2))}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )
        : multiDocumentDetected && <InfoBanner message={t('expenses.capture.multi_document', locale)} />}
      {!notice && storedNonExpenseNotice && <InfoBanner message={storedNonExpenseNotice.message} />}
      {storedClassificationOverrideNotice && <InfoBanner message={storedClassificationOverrideNotice} />}
      {!freeExpenseDrafts && <ForeignCurrencyNotice summary={aiMap} />}
    </>
  );
  const postingCard = isConfirmed && caps.canReadLedger ? (
    <MangmeeCard className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">สถานะบัญชี</h3>
          <p className="mt-1 text-xs text-gray-500">
            {detail.postingStatus === 'posted'
              ? `ผ่านรายการแล้ว${detail.journalEntryNumber ? ` · ${detail.journalEntryNumber}` : ''}`
              : detail.postingStatus === 'posting_error'
                ? (postingErrorText(detail.postingError) || 'ลงบัญชีไม่สำเร็จ แก้ไขเงื่อนไขแล้วลองอีกครั้ง')
                : detail.postingStatus === 'not_required'
                  ? 'เอกสารนี้ไม่ต้องลงสมุดรายวัน'
                  : detail.postingStatus === 'reversed'
                    ? 'JV ของเอกสารนี้ถูกกลับรายการแล้ว'
                    : caps.canPostLedger
                      ? 'เอกสารยืนยันแล้ว รอผู้มีสิทธิ์สร้าง JV'
                      : 'ยืนยันเอกสารแล้ว ยังไม่มีรายการในสมุดรายวัน'}
          </p>
          {/* The whole form below is disabled at CONFIRMED, but nothing on the page said so —
              the fields just stopped responding. State the rule and the way out, once, here. */}

        </div>
        <MangmeeBadge tone={detail.postingStatus === 'posted' ? 'brand' : detail.postingStatus === 'posting_error' ? 'danger' : detail.postingStatus === 'pending' ? 'amber' : 'slate'}>
          {POSTING_STATUS_LABELS[detail.postingStatus]}
        </MangmeeBadge>
      </div>
    </MangmeeCard>
  ) : null;
  const auditCard = !freeExpenseDrafts && (isMutable || auditChecks.some(check => check.status === 'warn')) && (
    <div ref={auditRef} className="scroll-mt-24">
      <MangmeeCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={isMutable ? "expense-checks-heading" : undefined} tabIndex={-1} className="text-sm font-semibold text-gray-800">{t('expenses.audit_section_title', locale)}</h3>
          {isMutable && <span className="text-xs text-gray-500">{t('expenses.audit_summary_pass', locale)} {auditPassCount} {t('expenses.audit_summary_unit', locale)} · {t('expenses.audit_summary_warn', locale)} {auditWarnCount} {t('expenses.audit_summary_unit', locale)}</span>}
        </div>
        <div className="mt-2">
          {isMutable && <>
            <div className="flex flex-wrap items-center gap-2 text-sm"><p>หลักฐานรายจ่าย: {TAX_EVIDENCE_STATUS_LABELS[detail.taxEvidenceStatus]}</p>{detail.taxEvidenceStatus === 'NEEDS_REVIEW' && auditFixAction('tax_evidence')}</div>
            <InputVatDecisionHistory detail={detail} />
            {showInputVatQuestion(detail) && canReview && detail.inputVatClaimStatus === 'NEEDS_REVIEW' && !detail.inputVatRight?.fixed && <button type="button" className={ghostClass} onClick={() => void goToReviewField('evidence', `expense-input-vat-${detail.id}`)}>ตรวจ VAT สำหรับยื่นภาษี</button>}
          </>}
          {auditChecks.filter(check => isMutable ? check.key !== 'tax_evidence' : check.status === 'warn').map((check) => (
            <div key={check.key} className="flex flex-wrap items-start gap-2.5 py-1.5 text-sm">
              <span className={cx('mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
                check.status === 'pass' ? 'bg-brand-50 text-brand-600' : check.status === 'warn' ? 'bg-warning-50 text-warning-700' : 'bg-gray-100 text-gray-500')}>
                {check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : 'ℹ'}
              </span>
              {/* A basis for the words, so on a phone the way-out button drops under them instead of squeezing them. */}
              <div className="min-w-[12rem] flex-1">
                <div className={cx('font-medium', check.status === 'warn' ? 'text-warning-700' : 'text-gray-800')}>{check.label}</div>
                {check.detail && <div className="mt-0.5 text-sm text-gray-500">{check.detail}</div>}
              </div>
              {isMutable && check.status === 'warn' && auditFixAction(check.key)}
            </div>
          ))}
        </div>
      </MangmeeCard>
    </div>
  );
  const accountingChecksCard = !isMutable && evidenceFailures.length > 0 && (
    <section aria-labelledby="expense-checks-heading" className="scroll-mt-24" data-testid="expense-evidence-checks">
      <MangmeeCard className="p-4">
        <h3 id="expense-checks-heading" tabIndex={-1} className="text-sm font-semibold text-gray-800">สิ่งที่ต้องแก้</h3>
        <ul className="mt-2 divide-y divide-gray-100">{evidenceFailures.map(flag => <li key={flag.key} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
          <span className="min-w-0 flex-1 text-warning-700">{flag.label}</span>
          {detail.sourceReimbursementRequestId
            ? <Link className={ghostClass} href={`/companies/${companyId}/reimbursements/${detail.sourceReimbursementRequestId}`}>ดูใบเบิกต้นทาง</Link>
            : detail.correctionCapabilities?.canReopen
              ? <button type="button" className={ghostClass} disabled={actionLoading} aria-busy={actionLoading} onClick={event => { rememberDialogOpener(event.currentTarget); setCorrectionError(null); setCorrectionAction({}); }}>{flag.key === 'NO_CATEGORY' ? 'แก้หมวดหมู่' : flag.key === 'NO_VENDOR' ? 'แก้ชื่อผู้ขาย' : flag.key === 'NO_FILE' ? 'เพิ่มไฟล์หลักฐาน' : 'แก้หลักฐานรายจ่าย'}</button>
              : isDead ? <Link className={ghostClass} href={backTarget}>เลือกรายจ่ายที่ใช้แทน</Link>
                : <button type="button" className={ghostClass} onClick={() => focusExpenseField(document.getElementById('expense-evidence-lock'))}>ดูข้อจำกัดการแก้</button>}
        </li>)}</ul>
        {!detail.sourceReimbursementRequestId && !detail.correctionCapabilities?.canReopen && <p id="expense-evidence-lock" tabIndex={-1} className="mt-2 text-sm text-gray-600">{isDead ? 'เอกสารนี้ยกเลิกแล้ว กลับไปรายการเพื่อเลือกเอกสารที่ใช้แทน' : expenseConfirmedLockMessage(detail.correctionCapabilities, hasRecordedPayments)}</p>}
      </MangmeeCard>
    </section>
  );
  const calculationPending = currentPreview?.status === 'loading' && !currentPreview.withholdingIncomplete;
  const calculationError = currentPreview?.status === 'error' && !currentPreview.withholdingIncomplete;
  const moneyVatMode = currentPreview?.vatMode ?? detail.vatMode;
  const moneyHasVat = vatModeRequiresRate(moneyVatMode) || Number(money.vatAmount) > 0;
  const moneyHasWht = Number(money.whtAmount) > 0;
  const moneyCard = (
    <div ref={moneyRef} className="scroll-mt-24">
      <MangmeeCard className="p-4">
        <h3 className="text-sm font-semibold text-gray-800">{t('expenses.money_section_title', locale)}</h3>
        {(calculationPending || calculationError) && (
          <div role="status" aria-live="polite" className="mt-3 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
            {calculationPending ? 'กำลังคำนวณยอดล่าสุด…' : <>
              <p>{currentPreview?.blocked ? currentPreview.message : 'คำนวณยอดล่าสุดไม่ได้ ตรวจข้อมูลแล้วลองอีกครั้ง'}</p>
              {currentPreview?.blocked ? <button type="button" className={cx(ghostClass, 'mt-2')} onClick={() => {
                setStep('data');
                window.requestAnimationFrame(() => { void reviewSaveRef.current?.(); });
              }}>ตรวจข้อมูลที่ต้องแก้</button> : <button type="button" className={cx(ghostClass, 'mt-2')} onClick={() => setTotalsRetry((n) => n + 1)}>คำนวณอีกครั้ง</button>}
            </>}
          </div>
        )}
        {(calculationPending || calculationError) && <p className="mt-2 text-xs text-gray-500">ยอดที่บันทึกไว้</p>}
        {financialTotalUnknown && !previewTotals ? (
          <p role="status" className="mt-3 rounded-xl bg-warning-50 px-4 py-3 text-sm font-semibold text-warning-800">
            {t('expenses.source_draft_total_unknown', locale)}
          </p>
        ) : <>
          {/* §5.1: the rows below are the stored header, and the lines are stored separately. A record
              written before that rule — or by anything bypassing the draft use-cases — can have the
              two disagree, and printing the header alone would state a total its own lines contradict.
              Branch on `ok`: a subtotal-only drift has a correct grand total and so a zero gap. */}
          {detail.totalsIdentity?.ok === false && (
            <p className="mt-2 rounded-lg bg-warning-50 px-3 py-2 text-xs leading-relaxed text-warning-700">
              {t('expenses.totals_identity_warning', locale)}
            </p>
          )}
          <div className="mt-2" data-testid="expense-review-totals"><MetricGrid columns={2} items={[
            { key: 'total', label: 'ยอดรวม', value: amountText(money.grandTotalAmount), unit: 'บาท', dot: 'bg-slate-400', note: Number(detail.paidAmount) > 0 ? `${t('expenses.paid_prefix', locale)} ${baht(detail.paidAmount)}` : undefined },
            ...(moneyHasVat ? [{ key: 'vat', label: t('expenses.vat', locale), value: amountText(money.vatAmount), unit: 'บาท', dot: 'bg-slate-400' }] : []),
            ...(moneyHasWht ? [
              { key: 'wht', label: t('expenses.wht', locale), value: amountText(money.whtAmount), unit: 'บาท', dot: 'bg-slate-400' },
              { key: 'net', label: 'ยอดหลังหักภาษี ณ ที่จ่าย', value: amountText(money.netPayableAmount), unit: 'บาท', dot: 'bg-slate-400' },
            ] : []),
          ]} /><AiFieldMissingHint canEdit={canMutateDraft && !readySourceDraftMessage} field="total" summary={previewTotals ? null : aiMap} /></div>
        </>}
      </MangmeeCard>
    </div>
  );
  const vendorCard = (
    <div ref={vendorRef} className="scroll-mt-24" tabIndex={-1}>
      <ExpenseReviewEditSection companyId={companyId} detail={detail} permissions={uiPermissions} isMutable={canMutateDraft && !readySourceDraftMessage} canReview={canReview} canConfirm={canConfirm} overpaymentCue={overpaymentCue} showSaveDraft={step === 'data'} saveRef={reviewSaveRef} onBusyChange={setReviewSaving} vatOverrideRef={vatOverrideRef} onValidationChange={onDataValidationChange} onTotalsChange={setReviewTotals} totalsRetry={totalsRetry} onDirtyChange={setDataDirty} onSaved={async () => { setDetail(await getExpense(companyId, expenseId)); onRefresh(); }} />
    </div>
  );
  // Vendor-address Slice 2, review fix 1: on a tax-code invoice the way forward is the line's Tax
  // Code on step 1 — the same scroll-and-focus the ถัดไป blocker uses to reach an invalid field.
  const openReviewLines = async () => {
    if (await goToStep('data')) setReviewFocus({ step: 'data' });
  };
  const documentReviewCard = (
    <>
      {/* Vendor-address §8 Slice 2: sits with the document and tax-evidence decisions it informs. */}
      <BuyerMatchBanner companyId={companyId} detail={detail} editable={isMutable && !freeExpenseDrafts} claimed={claimedSource} permissions={uiPermissions} onSaved={load} onOpenLines={openReviewLines} />
      <DocumentReviewSection
        companyId={companyId}
        detail={detail}
        documentDetails={!isMutable ? <ExpenseDocumentFacts companyId={companyId} detail={detail} /> : undefined}
        isMutable={isMutable}
        canReview={canReview && !isDead}
        onSaved={async () => { setNotice(null); await load(); await onRefresh(); }}
        onAttachPrimaryReceipt={canMutateDraft ? (file) => attachPrimaryReceipt(file, detail.branchId) : undefined}
        receiptUploading={receiptUploading}
        onDirtyChange={setEvidenceDirty}
        saveRef={guided ? evidenceSaveRef : undefined}
        fixAction={isMutable ? auditFixAction : () => detail.correctionCapabilities?.canReopen
          ? <button type="button" className={ghostClass} onClick={event => { rememberDialogOpener(event.currentTarget); setCorrectionError(null); setCorrectionAction({}); }}>แก้ไขเอกสาร</button>
          : <span>ให้ผู้ดูแลรายจ่ายตรวจข้อมูลที่ถูกล็อก</span>}
        canAnswerVatStatus={capture.canAnswerVatStatus}
        canEditShopIdentity={uiPermissions.includes('company.legal_identity.manage')}
        canReadTaxPeriods={uiPermissions.includes('tax.period.read')}
      />
    </>
  );
  // A total that disagrees with its own receipt reaches the ledger only through a named decision:
  // Finance either edits the amount or records why the stored figure stands. Accepting is bound to
  // the figure on screen, so a later edit brings this card — and the confirm block — straight back.
  const priceMismatchWarning = hasPriceMismatch && (
    <div className="space-y-2 rounded-xl border border-warning-100 bg-warning-50 px-4 py-3 text-sm font-medium text-warning-700">
      <p>{t('expenses.price_mismatch_warning', locale)}</p>
      {!ocrTotalUnacknowledged ? (
        <p className="text-xs font-normal">{t('expenses.price_mismatch_acknowledged', locale).replace('{amount}', baht(detail.grandTotalAmount))}</p>
      ) : canReview && isMutable && (
        <div className="space-y-2">
          <textarea
            id={`expense-ocr-reason-${detail.id}`}
            className={inputClass}
            rows={2}
            maxLength={REASON_MAX_LENGTH}
            placeholder={t('expenses.price_mismatch_reason_placeholder', locale)}
            value={ocrTotalReason}
            onChange={(event) => setOcrTotalReason(sanitizeReasonInput(event.target.value))}
          />
          <button
            className={btnClass}
            disabled={actionLoading || !ocrTotalReason.trim()} aria-busy={Boolean(actionLoading)}
            onClick={() => void doAction(async () => {
              const forbidden = findForbiddenChars(ocrTotalReason);
              if (forbidden.length > 0) throw new Error(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' ')));
              await acknowledgeOcrTotal(companyId, detail.id, {
                expectedUpdatedAt: detail.updatedAt,
                acknowledged: true,
                acknowledgedTotalAmount: detail.grandTotalAmount,
                reason: ocrTotalReason.trim(),
              });
              setOcrTotalReason('');
            }, 'ยอมรับยอดแล้ว')}
          >
            {t('expenses.price_mismatch_accept', locale).replace('{amount}', baht(detail.grandTotalAmount))}
          </button>
        </div>
      )}
    </div>
  );
  const aiDataBox = isMutable && !isCancelled && hasAiOutput && aiMap && (
    <div className="space-y-2 rounded-xl border border-[#C7D7FE] bg-[#EEF4FF] p-3 text-xs text-[#3538CD]">
      <p className="font-semibold">{t('expenses.ai_data_title', locale)}</p>
      {typeof aiMap['status'] === 'string' && <p>{t('expenses.status_label', locale)}: {expenseValueLabel(AI_SUMMARY_STATUS_LABELS, aiMap['status'], 'ข้อมูลจาก AI')}</p>}
      {missingFields.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span>{t('expenses.missing_fields', locale)}:</span>
          {missingFields.map((field, index) => <span key={`${field}-${index}`} className="rounded-full border border-[#A4BCFD] bg-white px-2 py-0.5">{expenseValueLabel(AI_MISSING_FIELD_LABELS, field, 'ข้อมูลที่ต้องตรวจเพิ่ม')}</span>)}
        </div>
      )}
    </div>
  );
  // One AI line, not three. The old stack (extraction notice + titled prefill card + step helper)
  // repeated "AI read it, please check" three times above the fold and pushed the form off-screen.
  // What stays is the only part the reviewer acts on: which fields they must fill themselves.
  // Spec §5.1/§5.2: the server's own words for what it could not decide — an unread date, a
  // charge whose VAT nothing proved, a withholding base worth checking. These are the reasons
  // behind the flags in the banner below, and without them the reviewer sees a warning with no cause.
  const reviewReasonChips = (Array.isArray(aiMap?.['reviewReasons']) ? aiMap['reviewReasons'] : [])
    .filter((reason): reason is string => typeof reason === 'string')
    .slice(0, 4)
    .map((reason, index) => (
      <span key={`reason-${index}`} className="rounded-full border border-warning-100 bg-warning-50 px-2 py-0.5 font-medium text-warning-700">
        {reason}
      </span>
    ));
  const aiPrefillBanner = !isCancelled && hasAiOutput && aiMap && (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#C7D7FE] bg-[#EEF4FF] px-3 py-2.5 text-xs text-[#3538CD]">
      <p className="font-semibold">
        {t(aiMissingDataFields.length > 0 ? 'expenses.ai_prefill_partial' : 'expenses.ai_prefill_complete', locale)}
      </p>
      {aiMissingDataFields.map((field, index) => (
        <span key={`${field}-${index}`} className="rounded-full border border-warning-100 bg-warning-50 px-2 py-0.5 font-medium text-warning-700">
          {t('expenses.ai_must_fill', locale)}: {expenseValueLabel(AI_MISSING_FIELD_LABELS, field, 'ข้อมูลที่ต้องตรวจเพิ่ม')}
        </span>
      ))}
      {/* The rows on the page do not add up to the page's own total. The record still follows the
          printed total — that is what was paid — but showing both numbers is the whole point: a real
          cash bill whose rows read 1,040 was confirmed by a person at 7,040 and nobody ever saw the
          two side by side. This warns; it never blocks. */}
      {(aiMap?.['chargeReconciliation'] as { status?: string; itemsSumAmount?: string } | undefined)?.status === 'ITEMS_DID_NOT_RECONCILE' && (
        <span className="rounded-full border border-warning-100 bg-warning-50 px-2 py-0.5 font-medium text-warning-700">
          {t('expenses.ai_items_not_reconciled', locale)}
          {(aiMap?.['chargeReconciliation'] as { itemsSumAmount?: string } | undefined)?.itemsSumAmount
            ? ` (${(aiMap?.['chargeReconciliation'] as { itemsSumAmount?: string }).itemsSumAmount} / ${detail.grandTotalAmount})`
            : ''}
        </span>
      )}
      {(aiMap?.['chargeReconciliation'] as { status?: string } | undefined)?.status === 'FOLDED_INTO_SUMMARY_NEEDS_REVIEW' && (
        <span className="rounded-full border border-warning-100 bg-warning-50 px-2 py-0.5 font-medium text-warning-700">
          {t('expenses.ai_charges_folded', locale)}
        </span>
      )}
      {reviewReasonChips}
      {expenseDocumentDateStatus(aiMap) === 'assumed' && (
        <span className="rounded-full border border-[#A4BCFD] bg-white px-2 py-0.5 font-medium text-[#3538CD]">
          {EXPENSE_DATE_STATUS_LABELS.assumed}
        </span>
      )}
      {readAgainAllowed && (
        <button className={cx(ghostClass, 'ml-auto')} onClick={() => void extractAgain()} disabled={actionLoading || extractionLoading || receiptUploading} aria-busy={Boolean(actionLoading || extractionLoading)} data-loading-indicator>
          <span className="inline-flex items-center justify-center gap-2">
            {extractionLoading && <InlineSpinner />}
            {extractionLoading ? t('expenses.ai_reading', locale) : t('expenses.extract_again', locale)}
          </span>
        </button>
      )}
    </div>
  );
  const openDuplicateCandidates = detail.duplicateCandidates.filter((candidate) => candidate.status === 'OPEN');
  const confirmedDuplicateCandidates = detail.duplicateCandidates.filter((candidate) => candidate.status === 'CONFIRMED_DUPLICATE');
  // "Is this the same document?" is answerable from the number, payee, date and amount —
  // never from an id. Older rows (or ones outside the branch scope) still fall back to the id.
  const duplicateCandidateNumber = (candidate: ExpenseDetail['duplicateCandidates'][number]) => candidate.candidateExpenseNumber || candidate.candidateExpenseId.slice(-8);
  const duplicateCandidateFacts = (candidate: ExpenseDetail['duplicateCandidates'][number]) => [
    candidate.candidateVendorName,
    candidate.candidateExpenseDate ? dateShort(candidate.candidateExpenseDate) : null,
    candidate.candidateGrandTotalAmount ? baht(candidate.candidateGrandTotalAmount) : null,
  ].filter(Boolean).join(' · ');
  const duplicateCandidateLabel = (candidate: ExpenseDetail['duplicateCandidates'][number]) => [duplicateCandidateNumber(candidate), duplicateCandidateFacts(candidate)].filter(Boolean).join(' · ');
  // t() echoes the key when a code has no label yet, so an unmapped reason drops out silently
  // instead of printing `expenses.duplicate_reason_*` at the reviewer.
  const duplicateReasonText = (candidate: ExpenseDetail['duplicateCandidates'][number]) => candidate.reasonCodesJson
    .map((code) => t(`expenses.duplicate_reason_${code}` as DictionaryKey, locale))
    .filter((label) => !label.startsWith('expenses.duplicate_reason_'))
    .join(' · ');
  const duplicatesCard = hasDuplicates && (
    <MangmeeCard className="space-y-2 border-warning-100 bg-warning-50 p-4">
      <h3 className="text-sm font-semibold text-warning-700">⚠ {t(isConfirmedDuplicate ? 'expenses.duplicate_confirmed_title' : 'expenses.duplicate_warning_title', locale)}</h3>
      {detail.duplicateStatus === 'POSSIBLE_DUPLICATE' && openDuplicateCandidates.length === 0 && (
        <p className="text-xs text-warning-700">{t('expenses.duplicate_restricted', locale)}</p>
      )}
      {detail.duplicateStatus === 'CONFIRMED_DUPLICATE' && confirmedDuplicateCandidates.length === 0 && (
        <p className="text-xs text-warning-700">{t('expenses.duplicate_confirmed_restricted', locale)}</p>
      )}
      {confirmedDuplicateCandidates.map((candidate) => (
        <div key={candidate.id} className="flex flex-col items-start gap-1.5 rounded-lg bg-white px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span className="flex flex-col gap-0.5">
            <Link className="tabular-nums font-medium text-brand-700 underline" href={`/companies/${companyId}/expenses/${candidate.candidateExpenseId}`} target="_blank">
              {duplicateCandidateLabel(candidate)}
            </Link>
            {duplicateReasonText(candidate) && <span className="text-gray-500">{duplicateReasonText(candidate)}</span>}
          </span>
          <span className="font-semibold text-error-700">{t('expenses.duplicate_confirmed_title', locale)}</span>
        </div>
      ))}
      {openDuplicateCandidates.map((d) => (
        <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
          <span className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
            {/* Opens beside this record (a new tab), so the two can be compared before deciding. */}
            <Link className="tabular-nums font-medium text-brand-700 underline" href={`/companies/${companyId}/expenses/${d.candidateExpenseId}`} target="_blank">
              {duplicateCandidateLabel(d)}
            </Link>
            {duplicateReasonText(d) && <span className="text-gray-500">{duplicateReasonText(d)}</span>}
          </span>
          {!isCancelled && caps.canResolveDuplicates && <ActionGroup>
            <button type="button" className={ghostClass} onClick={() => openDuplicate(d.id, 'dismiss')} disabled={actionLoading} aria-busy={false}>{t('expenses.not_duplicate', locale)}</button>
            <button type="button" className={ghostClass} onClick={() => openDuplicate(d.id, 'confirm')} disabled={actionLoading} aria-busy={false}>{t('expenses.confirm_duplicate', locale)}</button>
          </ActionGroup>}
        </div>
      ))}
    </MangmeeCard>
  );
  const paymentHistory = (detail.payments?.length ?? 0) > 0 && (
    <div className="space-y-2 border-t border-gray-100 pt-3" data-testid="expense-payment-history">
      <h4 data-payment-history-heading tabIndex={-1} className="text-xs font-semibold text-gray-600">ประวัติการจ่าย</h4>
      {hasWht && Number(detail.paidAmount) >= Number(detail.netPayableAmount) + Number(detail.whtAmount) && <p className="text-warning-800">จ่ายเต็มยอดโดยยังไม่ได้หักภาษี ภาษียังต้องนำส่ง ตรวจรายการจ่ายแล้วแก้การบันทึกด้วยปุ่มยกเลิกรายการจ่ายนี้ หรือยกเลิกเอกสารแล้วบันทึกใหม่</p>}
      {detail.payments?.map((payment) => {
        const paymentCapability = detail.correctionCapabilities?.payments.find((item) => item.id === payment.id);
        const cancelled = payment.status === 'VOIDED';
        const slip = detail.attachments.find(file => file.id === payment.slipAttachmentId);
        return (
          <div key={payment.id} data-payment-id={payment.id} className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-lg border p-3 text-xs', cancelled ? 'border-gray-100 bg-gray-50 text-gray-400' : 'border-gray-200 text-gray-600')}>
            <span className={cancelled ? 'line-through' : undefined}>{payment.paidAtConfirmed === false ? 'ยังไม่ทราบวันที่จ่ายจริง' : dateShort(payment.paidAt)} · <span className="whitespace-nowrap">{PAYMENT_METHOD_LABELS[payment.paymentMethod ?? 'OTHER']}</span></span>
            <span className={cx('text-right tabular-nums font-semibold', cancelled ? 'line-through' : 'text-gray-800')}>{baht(payment.amount)}</span>
            {!freeExpenseDrafts && !cancelled && hasWht && payment.paidAtConfirmed === false && <div className="col-span-2"><PaymentDateConfirmation companyId={companyId} expenseId={expenseId} paymentId={payment.id} canRecord={uiPermissions.includes('expense.payment.record')} onSaved={load} /></div>}
            {cancelled && <div className="col-span-2 space-y-1"><MangmeeBadge tone="slate">ยกเลิกแล้ว</MangmeeBadge>{payment.cancellationReason && <p>{payment.cancellationReason}</p>}</div>}
            {!cancelled && caps.canReadLedger && <span className="col-span-2">{expenseValueLabel(POSTING_STATUS_LABELS, payment.postingStatus, 'รอตรวจสถานะบัญชี')}</span>}
            {!freeExpenseDrafts && <ExpenseDisbursementPaymentEntry companyId={companyId} expenseId={expenseId} payment={payment} permissions={uiPermissions} entryOpen={disbursementEntryOpen} renderActions={actions => <ActionGroup align="start" className="col-span-2 empty:hidden">
              {!isCancelled && !cancelled && paymentCapability?.canCancel && <button type="button" className={dangerClass} disabled={actionLoading || Boolean(paymentFailure)} aria-busy={actionLoading} onClick={event => { rememberDialogOpener(event.currentTarget); setCorrectionReason(''); setCorrectionError(null); setCorrectionAction({ paymentId: payment.id }); }}>{EXPENSE_CORRECTION_WORDS.cancelPayment}</button>}
              {slip && <button type="button" className={ghostClass} disabled={previewLoading} aria-busy={previewLoading} onClick={() => void openPreview(slip)}>ดูหลักฐานการจ่าย</button>}
              {actions}
            </ActionGroup>} />}
            {!cancelled && paymentCapability?.cancelBlocker && <p className="col-span-2">{expenseCorrectionBlockerMessage(paymentCapability.cancelBlocker, 'cancelPayment', detail.correctionCapabilities, caps.canReadLedger)}</p>}
          </div>
        );
      })}
    </div>
  );
  const paymentCard = (
    <div id="expense-payments" ref={paymentRef} className="scroll-mt-24">
      <MangmeeCard className="space-y-3 p-4">
        <h3 id="expense-payment-heading" tabIndex={-1} className="text-sm font-semibold text-gray-800">{t('expenses.payment_section_title', locale)}</h3>
        <ExpenseDisbursementReservation companyId={companyId} reservation={detail.correctionCapabilities?.disbursementReservation} brief={reservationSaidAbove} />
        {personalSubstitute && <p className="text-sm text-gray-600">{detail.reimbursementProgress?.requestId ? `สถานะใบเบิก: ${expenseReimbursementProgressLabel(detail.reimbursementProgress)} · ดูการจ่ายและประวัติจากใบเบิกคืน` : "พนักงานจ่ายร้านเต็มจำนวนแล้ว ยื่นใบเบิกเพื่อทำคืนเงิน"}</p>}
        {Boolean(detail.sourceReimbursementRequestId) && (
          <p className="text-sm text-gray-500">
            รายการนี้มาจากการเบิกคืนพนักงาน{detail.vendorDocumentNumber ? ` (ใบเบิก ${detail.vendorDocumentNumber})` : ''} — ระบบบันทึกการจ่ายให้อัตโนมัติเมื่อมีการบันทึกจ่ายใบเบิก
          </p>
        )}
        <ExpenseDisbursementDirectPayment reservation={detail.correctionCapabilities?.disbursementReservation}>
        {!isCancelled && (detail.correctionCapabilities?.canRecordPayment || Boolean(paymentAttemptRef.current)) && (
          <form id="expense-record-payment" noValidate onSubmit={(event) => { event.preventDefault(); void submitPayment(); }} className="space-y-3">
            <fieldset disabled={actionLoading} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm text-gray-700">
                <span>{t('expenses.payment_amount', locale)}</span>
                {/* Text with the number pad: commas may be typed or pasted and are dropped; the wheel and the arrow keys cannot change the amount. */}
                <input aria-invalid={Boolean(paymentAmountError)} aria-describedby="expense-payment-amount-error" id="expense-payment-amount" className={inputClass} type="text" inputMode="decimal" autoComplete="off" required placeholder="0.00" value={amountFocused ? paidAmount : groupedAmount(paidAmount)} onFocus={() => setAmountFocused(true)}
                  onChange={(e) => editPayment(() => setPaidAmount(e.target.value.replaceAll(',', '')))} onBlur={() => { setAmountFocused(false); setPaidAmount(normalizeExpensePaymentAmount(paidAmount.trim())); }} />
                {/* The message follows each keystroke, so it appears while the person types, never at the press:
                    no blank space is held for it (the owner saw the gap as a hole in the form). */}
                <span id="expense-payment-amount-error" role="status" className="block text-sm text-error-700 empty:hidden">{paymentReason}</span>
              </label>
              <label className="space-y-1 text-sm text-gray-700">
                <span>วิธีจ่ายเงิน</span>
                <ThemedSelect aria-label="วิธีจ่ายเงิน" className={inputClass} value={paymentMethod} disabled={actionLoading} onChange={(e) => editPayment(() => setPaymentMethod(e.target.value as ExpensePaymentMethod))}>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </ThemedSelect>
              </label>
              <div className="space-y-1 text-sm text-gray-700">
                <label htmlFor="expense-payment-paid-at">วันที่จ่ายเงินจริง</label>
                <ThemedDate id="expense-payment-paid-at" aria-describedby="expense-payment-date-error" name="paidAt" className={inputClass} value={paidAt} max={paymentForm.maxPaidAt} required disabled={actionLoading} onChange={(e) => editPayment(() => setPaidAt(e.target.value))} />
                <p id="expense-payment-date-error" role="status" className="text-sm text-error-700 empty:hidden">{!paymentAmountError ? paymentForm.disabledReason : null}</p>
              </div>
            </fieldset>
            <div className="space-y-1 text-sm text-gray-700">
              <span>แนบสลิป (ถ้ามี)</span>
              <ThemedFile file={paymentSlip} accept={RECEIPT_UPLOAD_ACCEPT} aria-label="แนบสลิป (ถ้ามี)"
                disabled={actionLoading} loading={actionLoading && Boolean(paymentSlip) && !paymentSlipId}
                onChange={file => editPayment(() => { setPaymentSlip(file); setPaymentSlipId(undefined); })} />
              <p className="text-sm text-gray-500">PDF หรือรูปภาพ ไม่เกิน 10 เมกะไบต์</p>
            </div>
          </form>
        )}
        </ExpenseDisbursementDirectPayment>
        {!freeExpenseDrafts && <ExpenseDisbursementPrepareEntry companyId={companyId} detail={detail} permissions={uiPermissions} entryOpen={disbursementEntryOpen} canRecordPayment={!isCancelled && (Boolean(detail.correctionCapabilities?.canRecordPayment) || Boolean(paymentAttemptRef.current))}>
          <ExpenseDisbursementDirectPayment reservation={detail.correctionCapabilities?.disbursementReservation}>
            {!isCancelled && (detail.correctionCapabilities?.canRecordPayment || Boolean(paymentAttemptRef.current)) && (<><ActionGroup align="start"><button type="submit" form="expense-record-payment" className={btnClass} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{actionLoading ? EXPENSE_CORRECTION_WORDS.saving : paymentFailure === 'conflict' ? 'ตรวจประวัติการจ่าย' : paymentFailure === 'uncertain' || paymentFailure === 'refresh_failed' ? 'ลองบันทึกรายการเดิมอีกครั้ง' : paymentForm.label}</button></ActionGroup>
              {!hasPaymentHistory && !detail.paidAt && Number(detail.paidAmount ?? 0) === 0 && <p className="text-sm text-gray-500">จ่ายแล้วพิมพ์ใบสำคัญจ่ายได้จากประวัติการจ่าย</p>}
            </>)}
          </ExpenseDisbursementDirectPayment>
        </ExpenseDisbursementPrepareEntry>}
        <ExpenseDisbursementDirectPayment reservation={detail.correctionCapabilities?.disbursementReservation}>
        {isConfirmed && detail.correctionCapabilities?.recordPaymentBlocker && detail.correctionCapabilities.recordPaymentBlocker !== 'no_balance' && (
          <p className="text-sm text-gray-600">{detail.correctionCapabilities.recordPaymentBlocker === 'permission_denied' ? 'คุณบันทึกจ่ายไม่ได้ ให้คนที่มีสิทธิ์จ่ายเงินของร้านบันทึกให้' : expenseCorrectionBlockerMessage(detail.correctionCapabilities.recordPaymentBlocker, 'recordPayment', detail.correctionCapabilities, caps.canReadLedger)}</p>
        )}
        </ExpenseDisbursementDirectPayment>
        {paymentNotice && isConfirmed && <p id="expense-payment-notice" tabIndex={-1} role="status" className="rounded-xl bg-warning-50 p-3 text-sm text-warning-800">{paymentNotice}</p>}
        {overpaymentPaymentNotice}
        <ExpenseDisbursementPaymentScope>{paymentHistory}</ExpenseDisbursementPaymentScope>
        {/* The date of a payment is on its row above; this line speaks only for a record paid without a row of its own. */}
        {detail.paidAt && !hasPaymentHistory && <p className="text-xs text-gray-500">{t('expenses.paid_at', locale)} <span className="mangmee-unit">{dateShort(detail.paidAt)}</span></p>}
        {detail.confirmedAt && <p className="text-xs text-gray-500">{t('expenses.confirmed_at', locale)} <span className="mangmee-unit">{formatThaiDateTime(detail.confirmedAt)}</span></p>}
      </MangmeeCard>
    </div>
  );

  // Shared by the desktop empty-viewer pane and the small-screen strip: the viewer
  // pane is lg-only, so mobile needs its own way into the primary-receipt slot.
  // The AI read that follows a replace runs inside `receiptUploading`, and the reading step is the
  // slow one (10–20s) — the label says which of the two is happening, since the step-1 cover loader
  // is not on screen when the replace is pressed from step 2 or 3.
  const uploadBusyLabel = t(extractionLoading ? 'expenses.ai_reading' : 'expenses.uploading', locale);
  const receiptFileInput = (label: string) => canMutateDraft && (
    <label className="cursor-pointer">
      <span className={cx(ghostClass, 'inline-flex')}>{receiptUploading ? uploadBusyLabel : label}</span>
      <input
        className="hidden"
        type="file"
        accept={ATTACHMENT_UPLOAD_ACCEPT}
        disabled={aiReading || receiptRemoving}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void attachPrimaryReceipt(file, detail.branchId);
        }}
      />
    </label>
  );
  const replaceReceiptControl = receiptFileInput(noReceipt ? 'แนบใบเสร็จ' : t('expenses.replace_receipt', locale));
  /** §16.4's second intent, side by side with the first so the two are told apart before clicking. */
  const appendEvidenceControl = canMutateDraft && (
    <label className="cursor-pointer">
      <span className={cx(ghostClass, 'inline-flex min-h-11')}>{receiptUploading ? uploadBusyLabel : t('expenses.capture.add_files', locale)}</span>
      <input
        className="hidden"
        type="file"
        accept={ATTACHMENT_UPLOAD_ACCEPT}
        disabled={aiReading || receiptRemoving}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void appendSupportingReceipt(file, detail.branchId);
        }}
      />
    </label>
  );
  const removeReceiptControl = (attachment: ExpenseDetail['attachments'][number] | undefined) =>
    attachment && isRemovableFilePurpose(attachment.purpose) && canMutateDraft
      && ['DRAFT', 'NEEDS_REVIEW'].includes(detail.status) && detail.paymentStatus === 'UNPAID' ? (
        <button type="button" className={cx(ghostClass, 'text-error-700')} disabled={receiptRemoving || aiReading || actionLoading || stepSaving} aria-busy={Boolean(aiReading || actionLoading || stepSaving)}
          aria-label={`${locale === 'th' ? 'ลบไฟล์' : 'Remove file'} ${attachment.originalFileName}`} title={locale === 'th' ? 'ลบไฟล์' : 'Remove file'}
          onClick={() => void removeExpenseFile(attachment)}>
          {ICON.trash}
        </button>
      ) : null;

  const attachReceiptControl = canMutateDraft && (
    <label className="cursor-pointer">
      <span className={cx(ghostClass, 'inline-flex')}>{receiptUploading ? uploadBusyLabel : t('expenses.attach_receipt', locale)}</span>
      <input
        className="hidden"
        type="file"
        accept={ATTACHMENT_UPLOAD_ACCEPT}
        disabled={aiReading || receiptRemoving}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void attachPrimaryReceipt(file, detail.branchId);
        }}
      />
    </label>
  );

  const previewMore = (attachment: typeof activeAttachment) => <details className="relative">
    <summary className={cx(ghostClass, 'w-full cursor-pointer list-none')}>ตัวเลือกไฟล์</summary>
    <div className="absolute right-0 top-full z-20 mt-2 flex min-w-48 flex-col gap-2 rounded-xl bg-white p-2 shadow-lg">
      {appendEvidenceControl}
      {removeReceiptControl(attachment)}
      <button type="button" className={ghostClass} onClick={reloadViewerUrl}>{t('expenses.viewer_reload', locale)}</button>
    </div>
  </details>;

  return (
    <ExpenseCertificateHistory companyId={companyId} expenseId={expenseId} revision={`${detail.updatedAt}:${whtHandoff?.certificateId ?? ''}`} canRead={permissions.some(permission => ['wht.certificate.read', 'wht.certificate.issue', 'wht.external_certificate.link', 'wht.certificate.correct'].includes(permission))} confirmed={isConfirmed}>
      {confirmDialog}
      {showHistory && <ExpenseHistoryModal key={`${companyId}:${expenseId}`} companyId={companyId} expenseId={expenseId} expenseNumber={firstFilled(detail.expenseNumber) ?? 'ยังไม่มีเลขรายจ่าย'} onClose={() => setShowHistory(false)} />}
      <MangmeePage className="mangmee-flat" back={backLink} title={pageTitle} description={pageDescription}
        actions={<fieldset className="w-full min-w-0 sm:w-auto" disabled={aiReading} inert={aiReading}><ActionGroup className={cx('!grid !grid-flow-col !auto-cols-fr', isConfirmed && detail.correctionCapabilities?.canReopen && secondaryActions ? 'sm:min-w-72' : 'sm:min-w-32')}>
          {isConfirmed && detail.correctionCapabilities?.canReopen && <button type="button" className={ghostClass} disabled={actionLoading} aria-busy={Boolean(actionLoading)} onClick={event => { rememberDialogOpener(event.currentTarget); setCorrectionError(null); setCorrectionAction({}); }}>{EXPENSE_CORRECTION_WORDS.reopen}</button>}
          {!checkBillBlocked && secondaryActions}
        </ActionGroup></fieldset>}>
        {!isMutable && <MangmeeCard className="p-4"><div data-testid="expense-detail-totals"><MetricGrid columns={2} items={[
          { key: 'total', label: 'ยอดรวม', value: amountText(detail.grandTotalAmount), unit: 'บาท', dot: 'bg-slate-400' },
          { key: 'payment', label: isDead ? isCancelled ? 'ยกเลิก' : 'ปฏิเสธ' : owed ? 'ค้างจ่าย' : 'จ่ายแล้ว',
            value: amountText(isDead || !owed ? detail.paidAmount : detail.outstandingAmount), unit: 'บาท', dot: 'bg-brand-500',
            note: overpaymentMessage ?? (isDead ? 'ยอดที่จ่ายไว้' : !owed && hasWht && whtCertificatesComplete !== null ? whtPaymentProgressText(systemCertificatesAvailable && !(whtCertificatesComplete && whtHandoff?.status === 'EXTERNAL_LINKED'), whtCertificatesComplete) : Number(detail.paidAmount) > 0 && owed ? `จ่ายแล้ว ${baht(detail.paidAmount)}` : undefined) },
        ]} /></div></MangmeeCard>}
        <ExpenseCertificateHistoryNotice placement="edit" />
        {detail.status === 'READY_FOR_CONFIRMATION' && detail.reviewRequest && <p role="status" className="text-sm">
          {detail.reviewRequest.requestedReviewerUserId === userId
            ? `${detail.reviewRequest.submittedByName} ส่งให้คุณตรวจ เมื่อ `
            : `ส่งให้ ${detail.reviewRequest.requestedReviewerName} ตรวจแล้ว เมื่อ `}
          <span className="mangmee-unit">{formatThaiDateTime(detail.reviewRequest.submittedAt)}</span>
        </p>}
        {error && !reviewRequestOpen && !showReject && !correctionAction && !showVoid && !duplicateResolution && <ErrorBanner message={error} />}
        {/* UXE-21: the record moved under this attempt. Nothing was changed, and the way on is the
            latest data — never a silent retry of a write whose target no longer exists. */}
        {(error || paymentNotice || correctionError) && conflictReload && (
          <button type="button" className={cx(ghostClass, 'min-h-11')} onClick={() => { void refreshChangedDocument({ code: 'EXPENSE_UPDATE_CONFLICT' }, 'other').then(message => { if (message !== EXPENSE_CORRECTION_WORDS.sourceRefreshFailed) { setError(null); setPaymentNotice(null); setCorrectionError(null); } }); }}>
            {t('expenses.capture.reload_latest', locale)}
          </button>
        )}
        {readySourceDraftMessage && canReview && (
          <button type="button" className={btnClass} disabled={actionLoading} aria-busy={Boolean(actionLoading)}
            onClick={() => { void doAction(() => updateExpenseReviewFields(companyId, expenseId, { expectedUpdatedAt: detail.updatedAt })).then((reopened) => { if (reopened) setStep('data'); }); }}>
            {t('expenses.source_draft_reopen', locale)}
          </button>
        )}
        {/* A11Y-01: while an action runs the only visible cue is the disabled buttons. Empty when
            idle, so nothing is announced on mount. */}
        <p role="status" aria-live="polite" className="sr-only">
          {actionLoading ? t('expenses.action_in_progress', locale) : ''}
        </p>

        {/* What is owed and what locks the record at the left; the buttons are one group at the right (stacked on a phone), the one that backs out first. */}
        {isConfirmed && (lockShown || certificateJumpShown || reservationLinkShown) && <div className="flex flex-wrap items-center justify-between gap-3 text-sm" data-testid="expense-correction-actions">
          <div className="min-w-0 flex-1 basis-72 space-y-1">
            {/* One reason is its own sentence; several get the lead line and a list. */}
            {lockShown && lockReasonCount !== 1 && <p className="text-sm text-gray-600">{expenseConfirmedLockMessage(detail.correctionCapabilities, hasPaymentHistory)}</p>}
            {lockShown && <ul className={cx('space-y-1 text-sm text-gray-600 empty:hidden', lockReasonCount > 1 && 'list-disc pl-5')}>{expenseReopenBlockerMessages(detail.correctionCapabilities, caps.canReadLedger).map(message => <li key={message}>{withUnit(message, reservation?.documentNumber)}</li>)}</ul>}
          </div>
          {(certificateJumpShown || reservationLinkShown) && <ActionGroup>
            {certificateJumpShown && <button type="button" className={ghostClass} onClick={() => focusExpenseField(document.getElementById(`expense-wht-${detail.id}`))}>ไปที่หนังสือรับรอง 50 ทวิ</button>}
            {!detail.correctionCapabilities?.canReopen && <ExpenseDisbursementOpenLink companyId={companyId} reservation={reservationSaidAbove ? reservation : undefined} primary named />}
          </ActionGroup>}
        </div>}
        {isDead && <ExpenseCancellationNotice voidedAt={isCancelled ? detail.voidedAt : detail.rejectedAt} reason={isCancelled ? detail.voidReason : detail.rejectReason} />}
        {paymentNotice && !isConfirmed && <div id="expense-payment-notice" ref={paymentNoticeRef} tabIndex={-1} className="w-full scroll-mt-[calc(var(--app-header-h)+1rem)]"><ErrorBanner message={paymentNotice} /></div>}
        {guided && <><div id="expense-review-start" tabIndex={-1} ref={reviewStartRef} className="scroll-mt-[var(--app-header-h)]" /><div data-expense-stepper className={cx('sticky z-10 flex gap-x-1.5 border-b border-gray-100 bg-white px-4 py-2.5',
          guided ? 'flex-wrap gap-y-1.5' : 'flex-nowrap overflow-x-auto')} style={{ top: 'var(--app-header-h)' }}>
          {isMutable && detail.correctionOpenedAt && <p role="status" className="h-5 w-full whitespace-nowrap text-xs font-semibold leading-5 text-warning-800">{EXPENSE_CORRECTION_WORDS.correcting}</p>}
          {guided ? (
            <ThemedSteps steps={steps.map((entry, index) => ({
              key: entry.key,
              onSelect: () => void goToStep(entry.key),
              disabled: aiReading || stepSaving,
              label: t(STEP_LABEL_KEYS[entry.key], locale),
              // Position decides the color (สรรพากร-style): green up to where the user
              // stands, gray past it — stepping back grays the steps ahead again.
              // Owner 2026-08-29: the stepper says ORDER and nothing else — never swap a
              // number for a warning icon (a ⚠ replacing "3" read as a broken stage, not
              // as "duplicates pending"). Issues speak where they live: the duplicate
              // chips/panel and the blocking banners. A finished step is the visible way back
              // (its circle and name are one button); forward goes through ถัดไป only.
              state: step === entry.key ? 'current'
                : index < stepIndex ? 'done' : 'upcoming',
            }))} onStepPress={(index) => void goToStep(steps[index].key)} />
          ) : null}
        </div></>}

        {((guided && step === 'review') || approverOnlyActions) && <>{confirmBlockedNotice}</>}
        {isMutable && detail.substituteReceiptEvidence && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 bg-brand-25 px-4 py-3 text-sm">
            <div>
              <p className="font-bold text-brand-800">ใบรับรองแทนใบเสร็จ {detail.substituteReceiptEvidence.documentNumber} · {expenseSubstituteReceiptStatus(detail.substituteReceiptEvidence)}</p>
              <p className="text-gray-600">{detail.substituteReceiptEvidence.status === 'SUPERSEDED' ? 'สร้างใบรับรองแทนใบเสร็จใหม่จากค่าใช้จ่ายนี้ได้'
                : canEditSubstituteReceipt(detail, detail.substituteReceiptEvidence)
                  ? detail.substituteReceiptEvidence.status === 'PAYER_CERTIFIED' || detail.substituteReceiptEvidence.wetSignedScanAttachmentId || detail.substituteReceiptEvidence.paperSubmission
                    ? 'แก้ข้อมูลแล้วใช้ใบรับรองแทนใบเสร็จฉบับล่าสุดและเซ็นใหม่' : 'แก้ข้อมูลแล้วใช้ใบรับรองแทนใบเสร็จฉบับล่าสุด'
                  : 'จะแก้ข้อมูลในใบ ต้องยกเลิกใบนี้แล้วสร้างใบใหม่'}</p>
              {evidenceDirty && <Notice tone="warning" action={<button type="button" className={ghostClass} disabled={aiReading || stepSaving} aria-busy={Boolean(aiReading || stepSaving)} onClick={() => void goToStep('evidence')}>ไปขั้นที่ 2</button>}>ไปขั้นที่ 2 แล้วกด “ถัดไป” ก่อนเปิดใบรับรองแทนใบเสร็จ</Notice>}
            </div>
            <button type="button" className={ghostClass} disabled={aiReading || stepSaving || evidenceDirty} aria-busy={Boolean(aiReading || stepSaving)} onClick={() => void openSubstituteReceipt()}>
              เปิดใบรับรองแทนใบเสร็จ
            </button>
          </div>
        )}
        {accountingChecksCard}
        {/* Two panes only when there is a file to look at: a record without one is a single column, not half a page of empty viewer. */}
        <div className={cx('grid min-h-0', attachments.length > 0 && (isMutable ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'))}>
            {/* left pane (lg+): inline document viewer. It stays in view while the right column scrolls: sticky under the page's own sticky rows, as tall as the window allows, with its own scroll. */}
            <div
              className={cx('hidden min-h-0 overflow-hidden rounded-xl bg-white shadow-sm', attachments.length > 0 && 'lg:sticky lg:flex lg:self-start lg:flex-col')}
              style={{ top: viewerTop, maxHeight: `calc(100dvh - var(--app-header-h) - ${viewerOffsetRem + VIEWER_BOTTOM_GAP_REM}rem)`, height: activeAttachment?.mimeType.startsWith('image/') ? undefined : `calc(100dvh - var(--app-header-h) - ${viewerOffsetRem + VIEWER_BOTTOM_GAP_REM}rem)` }}
            >
              {attachments.length === 0 ? null : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-white px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-800">{activeAttachment?.originalFileName}</div>
                      <div className="text-xs text-gray-500">{activeAttachment && isWetSignedScanAttachment(activeAttachment.id, detail.substituteReceiptEvidence)
                        ? t('expenses.attachment.wet_signed_scan', locale)
                        : activeAttachment?.isHistorical ? 'ประวัติเอกสารที่ยกเลิก/แทนที่' : expenseValueLabel(ATTACHMENT_PURPOSE_LABELS, activeAttachment?.purpose, 'เอกสารแนบ')} · {activeAttachment && expenseAttachmentTypeLabel(activeAttachment, detail.substituteReceiptEvidence)}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Owner 2026-08-28: "เผื่ออัพโหลดผิด". Re-uploading has always worked on the server —
                          the newest primary upload becomes the receipt — but the control was rendered only
                          while there were zero attachments, so a wrong file could never be corrected here. */}
                      {replaceReceiptControl}
                      {previewMore(activeAttachment)}
                      {attachments.length > 1 && (
                        <>
                          <button type="button" className={ghostClass} onClick={() => setViewerIndex(Math.max(0, safeViewerIndex - 1))} disabled={safeViewerIndex <= 0} aria-label={t('expenses.viewer_prev', locale)}>‹</button>
                          <span className="tabular-nums text-xs text-gray-500">{safeViewerIndex + 1}/{attachments.length}</span>
                          <button type="button" className={ghostClass} onClick={() => setViewerIndex(Math.min(attachments.length - 1, safeViewerIndex + 1))} disabled={safeViewerIndex >= attachments.length - 1} aria-label={t('expenses.viewer_next', locale)}>›</button>
                        </>
                      )}
                      {activeAttachment && <button type="button" className={ghostClass} onClick={() => void openPreview(activeAttachment)} disabled={previewLoading} aria-busy={Boolean(previewLoading)}>{previewLoading ? t('expenses.opening', locale) : t('expenses.viewer_fullscreen', locale)}</button>}
                    </div>
                  </div>
                  <div className={cx("min-h-0 overflow-auto", !activeAttachment?.mimeType.startsWith('image/') && 'flex-1')}>
                    {viewerError ? <ErrorBanner message={viewerError} />
                      : !activeViewerUrl ? <p className="py-10 text-center text-sm text-gray-500">{t('expenses.loading', locale)}</p>
                        : activeAttachment?.mimeType.startsWith('image/') ? <img src={activeViewerUrl} alt={activeAttachment.originalFileName} onError={retryViewerUrl} className="block h-auto w-full bg-white" />
                          : activeAttachment?.mimeType === 'application/pdf' ? <iframe src={activeViewerUrl} title={activeAttachment.originalFileName} onError={retryViewerUrl} className="h-full w-full rounded-lg border border-gray-200 bg-white" />
                            : (
                              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                                <span className="flex h-10 w-10 items-center justify-center rounded-[9px]" style={{ background: '#E0F2FE', color: '#0BA5EC' }}>{ICON.file}</span>
                                <p className="text-sm font-semibold text-gray-700">{activeAttachment?.originalFileName}</p>
                                <p className="text-xs text-gray-500">{expenseValueLabel(MIME_TYPE_LABELS, activeAttachment?.mimeType, 'ไฟล์เอกสาร')}</p>
                              </div>
                            )}
                  </div>
                </>
              )}
            </div>

            {/* right pane: one continuous scroll column */}
            <div className="flex min-h-0 min-w-0 flex-col">
              {attachments.length === 0 && attachReceiptControl && (
                <div className={cx('flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-5 py-3', checkBillBlocked && 'order-2')}>
                  <span className="text-sm text-gray-500">{t('expenses.viewer_empty', locale)}</span>
                  <span className="flex flex-wrap items-center gap-2">
                    {/* The way to a substitute receipt sat in the wide screen's empty viewer; it keeps its place on wide screens only. */}
                    {canStartSubstitute && needsReceiptOrSubstitute && <Link className={cx(ghostClass, 'hidden lg:inline-flex')} href={substituteAction.href} aria-disabled={aiReading || stepSaving || evidenceDirty} onClick={(event) => { event.preventDefault(); void openSubstituteReceipt(); }}>{t(substituteAction.labelKey, locale)}</Link>}
                    {attachReceiptControl}
                  </span>
                </div>
              )}
              {attachments.length > 0 && (
                <div data-testid="expense-attachment-list" className={cx('border-b border-gray-100 bg-gray-50 lg:hidden', checkBillBlocked && 'order-2')}>
                  {/* The phone is where receipts are actually reviewed, so the "wrong file" fix has to be
                      here too — the desktop viewer header alone would have left mobile with no way out. */}
                  {replaceReceiptControl && (
                    <div className="flex flex-wrap justify-end gap-2 border-b border-gray-100 px-5 py-2">
                      {replaceReceiptControl}
                    </div>
                  )}
                  {attachments.map((attachment) => (
                    <div key={`${attachment.id}:${attachment.purpose}`} className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3 last:border-b-0">
                      <div className="min-w-0 flex-1 basis-48">
                        <div className="text-sm font-semibold text-gray-800">{attachment.originalFileName}</div>
                        <div className="text-xs text-gray-500">{isWetSignedScanAttachment(attachment.id, detail.substituteReceiptEvidence)
                          ? t('expenses.attachment.wet_signed_scan', locale)
                          : attachment.isHistorical ? 'ประวัติเอกสารที่ยกเลิก/แทนที่' : expenseValueLabel(ATTACHMENT_PURPOSE_LABELS, attachment.purpose, 'เอกสารแนบ')} · {expenseAttachmentTypeLabel(attachment, detail.substituteReceiptEvidence)}</div>
                      </div>
                      <ActionGroup>
                        {previewMore(attachment)}
                        <button type="button" className={ghostClass} onClick={() => void openPreview(attachment)} disabled={previewLoading} aria-busy={Boolean(previewLoading)}>
                          {previewLoading ? t('expenses.opening', locale) : t('expenses.view_file', locale)}
                        </button>
                      </ActionGroup>
                    </div>
                  ))}
                </div>
              )}

              <div className={cx('relative', isMutable && 'p-4', checkBillBlocked && 'order-1')} data-testid="expense-review-form">
                {/* Keep the form mounted while toggling the cover; inert also locks custom selectors. */}
                <fieldset disabled={aiReading} inert={aiReading} aria-busy={aiReading} className="m-0 min-w-0 space-y-4 border-0 p-0">
                {sourceOnlyDraft ? (
                  <>
                    {noticesBlock}
                    {financialTotalUnknown && <p role="status" className="text-sm text-gray-600">{t('expenses.source_draft_total_unknown', locale)}</p>}
                    {visibleSourceDraft && <ExpenseSourceDraftCard
                      key={detail.id}
                      companyId={companyId}
                      expenseId={detail.id}
                      expectedUpdatedAt={detail.updatedAt}
                      sourceDraft={visibleSourceDraft}
                      locale={locale}
                      readOnlyMessage={readySourceDraftMessage}
                      onSaved={setDetail}
                    />}
                    {freeExpenseDrafts && !visibleSourceDraft && <InfoBanner message={t('expenses.source_draft_not_available', locale)} />}
                  </>
                ) : guided ? (
                  <>
                    <div className={cx('space-y-4', step === 'data' ? undefined : 'hidden')}>
                        <div className="space-y-4">
                          {noticesBlock}
                          {aiPrefillBanner}
                          {!hasAiOutput && step === 'data' && readAgainAllowed && (
                            <button className={ghostClass} onClick={() => void extractAgain()} disabled={actionLoading || extractionLoading || receiptUploading} aria-busy={Boolean(actionLoading || extractionLoading)} data-loading-indicator>
                              <span className="inline-flex items-center justify-center gap-2">
                                {extractionLoading && <InlineSpinner />}
                                {extractionLoading ? t('expenses.ai_reading', locale) : t('expenses.extract_again', locale)}
                              </span>
                            </button>
                          )}
                        </div>

                      {vendorCard}
                      {step === 'data' && moneyCard}
                    </div>
                    <div className={cx('space-y-4', step === 'evidence' ? undefined : 'hidden')}>
                      <div id={`expense-document-review-${detail.id}`} tabIndex={-1}>{documentReviewCard}</div>
                      {priceMismatchWarning}
                    </div>
                    <div className={cx('space-y-4', step === 'review' ? undefined : 'hidden')}>
                      {/* The same reasons again where the draft is checked: on a phone, step 1 and the file are out of sight. */}
                      {step === 'review' && !isCancelled && reviewReasonChips.length > 0 && (
                        <div data-review-reasons className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#C7D7FE] bg-[#EEF4FF] px-3 py-2.5 text-xs text-[#3538CD]">
                          <p className="font-semibold">{t('expenses.ai_data_title', locale)}</p>
                          {reviewReasonChips}
                        </div>
                      )}
                      {showInputVatQuestion(detail) && canReview && detail.inputVatRight?.postsToLedger && detail.inputVatClaimStatus === 'NEEDS_REVIEW' && !detail.inputVatRight.fixed && <Notice tone="info" action={<button type="button" className={ghostClass} onClick={() => void goToReviewField('evidence', `expense-input-vat-${detail.id}`)}>ตรวจ VAT สำหรับยื่นภาษี</button>}>{INPUT_VAT_LEDGER_BEFORE_CONFIRM}</Notice>}
                      {/* The last step asks the reviewer to look at the whole summary: the amounts are part of it. */}
                      {step === 'review' && moneyCard}
                      {auditCard}
                      <div id={`expense-duplicates-${detail.id}`} tabIndex={-1}>{duplicatesCard}</div>
                    </div>
                    {(paymentHistory || overpaymentMessage) && <MangmeeCard className="p-4">{overpaymentPaymentNotice}{paymentHistory}</MangmeeCard>}
                  </>
                ) : (
                  <>
                    {noticesBlock}
                    {actionsFirst && paymentCard}
                    {actionsFirst && certificateBlock}
                    {postingCard}
                    {!isDead && auditCard}
                    {isMutable && moneyCard}
                    {isMutable && vendorCard}
                    {/* tax evidence and documents (+ AI info, notices, duplicates — logic unchanged) */}
                    <div ref={documentsRef} className="scroll-mt-24 space-y-4">
                      <div id={`expense-document-review-${detail.id}`} tabIndex={-1}>{documentReviewCard}</div>
                      {priceMismatchWarning}
                      {aiDataBox}
                      <div id={`expense-duplicates-${detail.id}`} tabIndex={-1}>{duplicatesCard}</div>
                    </div>
                    {!actionsFirst && paymentCard}
                  </>
                )}
                {!actionsFirst && certificateBlock}
                </fieldset>
                {aiReading && (
                  <div className="absolute inset-0 z-10 bg-white/80">
                    {/* A long receipt form must not put its only spinner below the viewport. */}
                    <div className="sticky h-40 [&>div]:bg-transparent" style={{ top: viewerTop }}>
                      <CoverLoader active scope="section" label={t('expenses.ai_reading', locale)} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        {!freeExpenseDrafts && !certificateCardVisible && <ExpenseCertificateHistoryDisclosure />}
        {checkBillSecondaryActions}

        {!checkBillBlocked && <>
          {((guided && step === 'review') || approverOnlyActions) && <>
            {reviewers?.length === 0 && <p className="text-sm">ร้านนี้ยังไม่มีคนอื่นที่ยืนยันรายจ่ายได้</p>}
          </>}
          {guided && <>
            {/* Reasons stay in the page; the bottom bar holds only its actions. */}
            {step === 'data' && validationBlockMessage && (
              <div className="rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700">
                <p id={`expense-review-block-${detail.id}`} role="status">{validationBlockMessage}</p>
                <button type="button" className={cx(tapTargetClass, 'mt-1 rounded font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2')} onClick={() => {
                  const section = vendorRef.current;
                  const target = section?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? section;
                  focusExpenseField(target);
                }}>{t('expenses.v_fix_fields', locale)}</button>
              </div>
            )}
            {aiReading ? (
              <p role="status" className={reviewNoticeClass}>
                {t('expenses.ai_reading', locale)}
              </p>
            ) : step === 'evidence' && evidenceStepBlocker && (
              <p id={`expense-review-evidence-block-${detail.id}`} role="status" className={reviewNoticeClass}>
                {t(evidenceStepBlocker, locale)}
              </p>
            )}
          </>}
          {confirmBlockers && <div className="space-y-2 text-sm">
            {canMutateDraft && classificationBlocked && <p className={warnNoteClass}>{classificationBlockMessage}</p>}
            {canMutateDraft && detail.status === 'READY_FOR_CONFIRMATION' && isZeroAmount && <p className={warnNoteClass}>{t('expenses.zero_amount_warning', locale)}</p>}
            {canMutateDraft && detail.status === 'READY_FOR_CONFIRMATION' && hasDuplicates && <p className="font-semibold text-warning-700">{duplicateBlockMessage}</p>}
          </div>}
        </>}
        {!checkBillBlocked && modalFooter && <FormActionBar>{modalFooter}</FormActionBar>}
      </MangmeePage>

      <ExpenseReviewRequestDialog open={reviewRequestOpen} people={reviewers} selected={requestedReviewer} busy={actionLoading}
        error={error ?? reviewersError} onChoose={id => { setRequestedReviewer(id); setError(null); }} onClose={() => setReviewRequestOpen(false)}
        onSend={() => markReady('ส่งให้ตรวจแล้ว', requestedReviewer)} onRetry={() => { setError(null); setReviewersRetry(value => value + 1); }} />
      {/* Cancelling a document, deleting a record and deciding a duplicate each ask in a window that names the thing
          (thai-ux-standard §4): the bottom bar holds buttons, never a form. */}
      {showVoid && detail.correctionCapabilities?.disbursementReservation && detail.correctionCapabilities.disbursementReservation.status !== 'DRAFT' && <ExpenseDisbursementVoidBlocker dialog companyId={companyId} reservation={detail.correctionCapabilities.disbursementReservation} onClose={() => setShowVoid(false)}>{null}</ExpenseDisbursementVoidBlocker>}
      {showVoid && !certificateVoidOpen && (!detail.correctionCapabilities?.disbursementReservation || detail.correctionCapabilities.disbursementReservation.status === 'DRAFT') && (
        <ExpenseDisbursementCancellation companyId={companyId} expenseId={expenseId} payments={detail.payments}>{(warning, successMessage) => (
          <Modal open title={[t('expenses.void_document', locale), firstFilled(detail.expenseNumber)].filter(Boolean).join(' ')} size="sm" closeOnBackdrop={false} closeLabel={t('expenses.close', locale)} onClose={closeVoid}
            footer={<>
              <button type="button" className={ghostClass} disabled={actionLoading} aria-busy={false} onClick={closeVoid}>{t('expenses.disbursement.cancel_safe', 'th')}</button>
              <button type="submit" form="expense-void-form" className={dangerClass} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{t('expenses.void_document', locale)}</button>
            </>}>
            <form id="expense-void-form" noValidate className="space-y-3 text-sm leading-6 text-gray-700" onSubmit={(event) => {
              event.preventDefault();
              if (!isExpenseVoidReason(reason)) { setError('ใส่เหตุผลที่ยกเลิก อย่างน้อย 3 ตัวอักษร'); return; }
              const forbidden = findForbiddenChars(reason);
              if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
              // Close on success: an open window reads as "nothing happened" and a second press hits a cancelled record.
              void doAction(async () => {
                await voidExpense(companyId, expenseId, reason.trim());
                setShowVoid(false); setReason('');
              }, successMessage('ยกเลิกเอกสารแล้ว'));
            }}>
              <p>{[firstFilled(detail.vendorNameSnapshot), baht(detail.grandTotalAmount)].filter(Boolean).join(' · ')}</p>
              {warning}
              <p>ยกเลิกแล้วแก้ไขหรือบันทึกจ่ายเอกสารนี้ต่อไม่ได้</p>
              <label className="block">{t('expenses.void_reason', locale)}
                <textarea autoFocus className={cx(inputClass, 'mt-1')} rows={3} value={reason} maxLength={REASON_MAX_LENGTH} disabled={actionLoading} onChange={(e) => { setReason(sanitizeReasonInput(e.target.value)); setError(null); }} />
              </label>
              {error && <ErrorBanner message={error} />}
            </form>
          </Modal>
        )}</ExpenseDisbursementCancellation>
      )}
      <Modal open={showDelete} size="sm" closeLabel={t('expenses.close', locale)} onClose={() => { if (!deleting) setShowDelete(false); }}
        title={`ลบรายจ่าย ${[firstFilled(detail.expenseNumber), baht(detail.grandTotalAmount)].filter(Boolean).join(' · ')}?`}
        footer={<>
          <button type="button" className={ghostClass} disabled={deleting} onClick={() => setShowDelete(false)}>ไม่ลบ</button>
          <button type="button" className={dangerClass} disabled={deleting} aria-busy={Boolean(deleting)} onClick={() => void removeExpense()}>{deleting ? t('expenses.deleting', locale) : 'ลบรายจ่าย'}</button>
        </>}>
        <p className="text-sm text-gray-600">ลบแล้วกู้คืนไม่ได้</p>
      </Modal>
      {duplicateResolution && (() => {
        const candidate = detail.duplicateCandidates.find((row) => row.id === duplicateResolution.candidateId);
        const same = duplicateResolution.action === 'confirm';
        return (
          <Modal open title={`${same ? 'ซ้ำกับ' : 'ไม่ซ้ำกับ'} ${candidate ? duplicateCandidateNumber(candidate) : 'รายการนี้'}?`} size="sm" closeOnBackdrop={false} closeLabel={t('expenses.close', locale)} onClose={closeDuplicate}
            footer={<>
              <button type="button" className={ghostClass} disabled={actionLoading} aria-busy={false} onClick={closeDuplicate}>{t('expenses.close', locale)}</button>
              <button type="submit" form="expense-duplicate-form" className={btnClass} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{same ? 'บันทึกว่าซ้ำ' : 'บันทึกว่าไม่ซ้ำ'}</button>
            </>}>
            <form id="expense-duplicate-form" noValidate className="space-y-3 text-sm leading-6 text-gray-700" onSubmit={(event) => {
              event.preventDefault();
              const cleanReason = reason.trim();
              if (cleanReason.length < 3) { setError('ใส่เหตุผล อย่างน้อย 3 ตัวอักษร'); return; }
              const forbidden = findForbiddenChars(cleanReason);
              if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
              void doAction(async () => {
                if (same) await confirmDuplicate(companyId, expenseId, duplicateResolution.candidateId, cleanReason);
                else await dismissDuplicate(companyId, expenseId, duplicateResolution.candidateId, cleanReason);
                setDuplicateResolution(null); setReason('');
              }, same ? 'บันทึกว่าซ้ำแล้ว' : 'บันทึกว่าไม่ซ้ำแล้ว');
            }}>
              {candidate && <p>{duplicateCandidateFacts(candidate)}</p>}
              {same && detail.sourceReimbursementRequestId && (
                <p role="alert" className="text-amber-800">{REIMBURSEMENT_DUPLICATE_CONFIRM_WARNING}</p>
              )}
              <label className="block">{t('expenses.duplicate_resolution_reason', locale)}
                <textarea autoFocus className={cx(inputClass, 'mt-1')} rows={3} value={reason} maxLength={REASON_MAX_LENGTH} disabled={actionLoading} onChange={(e) => { setReason(sanitizeReasonInput(e.target.value)); setError(null); }} />
              </label>
              {error && <ErrorBanner message={error} />}
            </form>
          </Modal>
        );
      })()}
      {expenseCertificate && <ExpenseCertificateVoidDialog key={`${companyId}-${expenseId}`} open={certificateVoidOpen && !detail.correctionCapabilities?.disbursementReservation}
        companyId={companyId} expenseId={expenseId} certificate={expenseCertificate}
        payments={detail.payments} lockedTaxPeriods={detail.correctionCapabilities?.lockedTaxPeriods}
        onClose={() => { setShowVoid(false); setReason(''); }} onVoided={load} />}
      <ExpenseCertificateReopen certificate={correctionCertificate} busy={actionLoading} payments={correctionAction?.paymentId ? [] : detail.payments}>{(taxFilingAttested, certificateNotice, certificateFooter, certificateAttestation) => (
      <ExpenseDisbursementCancellation companyId={companyId} expenseId={expenseId} payments={correctionAction?.paymentId ? detail.payments : []} paymentId={correctionAction?.paymentId} certificate={detail.correctionCapabilities?.certificateOnExpense}>{(warning, successMessage) => (
      <Modal open={Boolean(correctionAction)} title={<span data-expense-dialog-heading role="heading" aria-level={2} tabIndex={-1}>{correctionAction?.paymentId ? EXPENSE_CORRECTION_WORDS.cancelPayment : EXPENSE_CORRECTION_WORDS.reopen}</span>}
        size="sm" closeOnBackdrop={!correctionCertificate} closeLabel={t('expenses.close', 'th')} onClose={() => { if (!actionLoading) setCorrectionAction(null); }}
        /* A typed reason is asked about before ✕ or Escape closes the window. */
        dirty={Boolean(correctionAction) && correctionAllowed && correctionReason.trim() !== '' && !actionLoading}
        footer={certificateFooter(<>
          <button ref={correctionCloseRef} type="button" className={cx(ghostClass, 'w-full sm:w-auto whitespace-nowrap')} disabled={actionLoading} onClick={() => setCorrectionAction(null)}>{correctionAction?.paymentId ? t('expenses.disbursement.cancel_safe', 'th') : correctionCertificate ? t('expenses.close', 'th') : t(correctionAllowed && !correctionAction?.paymentId ? 'expenses.cancel' : 'expenses.close', 'th')}</button>
          {/* Stays pressable: pressed without a reason it says what is missing (thai-ux-standard §2.9). */}
          {correctionAllowed && <button type="submit" form="expense-correction-form" className={cx(correctionAction?.paymentId || correctionCertificate ? dangerClass : btnClass, 'w-full sm:w-auto whitespace-nowrap')} disabled={actionLoading || conflictReload || Boolean(correctionCertificate && !taxFilingAttested)} aria-busy={actionLoading}>{actionLoading ? EXPENSE_CORRECTION_WORDS.saving : correctionAction?.paymentId ? EXPENSE_CORRECTION_WORDS.cancelPayment : correctionCertificate ? correctionCertificate.kind === 'EXTERNAL' ? 'ยกเลิกการบันทึกและแก้ไขเอกสาร' : 'ยกเลิกหนังสือรับรองและแก้ไขเอกสาร' : EXPENSE_CORRECTION_WORDS.reopenSubmit}</button>}
        </>)}>
        {correctionAllowed ? <form id="expense-correction-form" className="space-y-3" noValidate onSubmit={(event) => {
          event.preventDefault();
          if (correctionReason.trim().length < 3 || correctionReason.trim().length > REASON_MAX_LENGTH) { setCorrectionError(EXPENSE_CORRECTION_WORDS.reasonRequired); focusExpenseField(correctionReasonRef.current); return; }
          if (!correctionAction || !correctionAllowed || conflictReload || correctionReason.trim().length < 3 || findForbiddenChars(correctionReason).length || (correctionCertificate && !taxFilingAttested)) return;
          const paymentId = correctionAction.paymentId;
          setActionLoading(true); setCorrectionError(null);
          void (async () => {
            try {
              let cancelledCertificate;
              if (paymentId) await cancelExpensePayment(companyId, expenseId, paymentId, correctionReason.trim());
              else {
                const answer = await reopenExpense(companyId, expenseId, correctionReason.trim(), correctionCertificate ? true : undefined);
                cancelledCertificate = answer?.cancelledCertificate;
              }
              setDetail(await getExpense(companyId, expenseId));
              dialogOpenerRef.current = null;
              setCorrectionAction(null); setCorrectionReason('');
              paymentAttemptRef.current = null; setPaymentFailure(null); setPaymentNotice(null);
              if (!paymentId) setStep('data');
              setAfterCorrectionFocus({ paymentId });
              const cancelled = cancelledCertificate ?? correctionCertificate;
              toast.success(successMessage(paymentId ? EXPENSE_CORRECTION_WORDS.paymentCancelled : cancelled ? expenseCertificateReopenedMessage(cancelled) : expenseReopenedMessage(hasPaymentHistory)));
            } catch (cause) { setCorrectionError(correctionCertificate ? err(cause) : await refreshChangedDocument(cause, 'correction') ?? err(cause)); }
            finally { setActionLoading(false); }
          })();
        }}>
          {certificateNotice}
          {warning}
          {correctionAction?.paymentId ? (() => {
            const payment = detail.payments?.find(p => p.id === correctionAction.paymentId);
            return payment && <p className="text-sm text-gray-700">{baht(payment.amount)} · {payment.paidAtConfirmed === false ? 'ยังไม่ทราบวันที่จ่ายจริง' : dateShort(payment.paidAt)} · {PAYMENT_METHOD_LABELS[payment.paymentMethod ?? 'OTHER']}</p>;
          })() : !correctionCertificate && <>
            {/* The window names the document it is about: its number, payee and amount. */}
            <p className="text-sm font-semibold text-gray-900">{firstFilled(detail.expenseNumber) && <><span className="mangmee-unit">{detail.expenseNumber}</span> · </>}{firstFilled(detail.vendorNameSnapshot) && <>{detail.vendorNameSnapshot} · </>}<span className="mangmee-unit">{baht(detail.grandTotalAmount)}</span></p>
            <p className="text-sm text-gray-700">{EXPENSE_CORRECTION_WORDS.reopenDescription}{hasPaymentHistory ? ` ${EXPENSE_CORRECTION_WORDS.retainedPayments}` : ''}</p>
          </>}
          <label className="block text-sm" htmlFor="expense-correction-reason">{correctionAction?.paymentId ? EXPENSE_CORRECTION_WORDS.cancelReason : EXPENSE_CORRECTION_WORDS.reason}</label>
          <textarea ref={correctionReasonRef} aria-describedby="expense-correction-error" id="expense-correction-reason" className={inputClass} rows={3} value={correctionReason} required minLength={3} maxLength={REASON_MAX_LENGTH} disabled={actionLoading} onChange={(event) => { setCorrectionReason(sanitizeReasonInput(event.target.value)); setCorrectionError(null); }} />
          <p id="expense-correction-error" role="alert" className="min-h-6 text-sm text-error-700">{correctionError}</p>
          {certificateAttestation}
        </form> : <ErrorBanner message={correctionError ?? EXPENSE_CORRECTION_WORDS.unavailable} />}
      </Modal>
      )}</ExpenseDisbursementCancellation>
      )}</ExpenseCertificateReopen>
      <Modal
        open={showReject && !correctionAction}
        title={<span data-expense-dialog-heading role="heading" aria-level={2} tabIndex={-1}>{detail.correctionCapabilities?.canReject === true ? [EXPENSE_CORRECTION_WORDS.reject, firstFilled(detail.expenseNumber)].filter(Boolean).join(' ') : EXPENSE_CORRECTION_WORDS.reject}</span>}
        size="sm"
        closeLabel={t('expenses.close', locale)}
        closeOnBackdrop={false}
        onClose={closeReject}
        footer={detail.correctionCapabilities?.canReject === true ? (
          <>
            <button type="button" className={ghostClass} onClick={closeReject} disabled={actionLoading} aria-busy={false}>
              {t('expenses.reject_stay', locale)}
            </button>
            {/* Stays pressable: pressed without a reason it says what is missing (thai-ux-standard §2.9). */}
            <button type="button" className={dangerClass} onClick={() => {
              const cleanReason = reason.trim();
              if (!cleanReason) { setError('ใส่เหตุผลที่ยกเลิกก่อน'); focusExpenseField(rejectReasonRef.current); return; }
              const forbidden = findForbiddenChars(cleanReason);
              if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
              void doAction(async () => {
                await rejectExpense(companyId, expenseId, cleanReason);
                setShowReject(false); setReason('');
              }, t('expenses.reject_success', locale));
            }} disabled={actionLoading || detail.correctionCapabilities?.canReject !== true} aria-busy={Boolean(actionLoading)}>
              {actionLoading ? t('expenses.rejecting', locale) : EXPENSE_CORRECTION_WORDS.reject}
            </button>
          </>
        ) : <button type="button" className={ghostClass} onClick={closeReject}>{t('expenses.close', locale)}</button>}
      >
        <div className="space-y-3">
          {detail.correctionCapabilities?.canReject === true && <p className="text-sm leading-6 text-gray-600">{t('expenses.reject_confirm_description', locale)}</p>}
          {detail.correctionCapabilities?.canReject === undefined && <p role="status" className="text-sm text-gray-600">{EXPENSE_CORRECTION_WORDS.unavailable}</p>}
          {detail.correctionCapabilities?.rejectBlocker && <>
            <p role="status" className="text-sm text-gray-600">{expenseCorrectionBlockerMessage(detail.correctionCapabilities.rejectBlocker, 'reject', detail.correctionCapabilities)}</p>
          </>}
          {paymentHistory}
          {error && detail.correctionCapabilities?.canReject !== true && <ErrorBanner message={error} />}
          {detail.correctionCapabilities?.canReject === true && <><label className="block text-sm font-medium text-gray-700">
            {t('expenses.reject_reason', locale)}
            <textarea
              ref={rejectReasonRef} aria-describedby="expense-reject-error" className={cx(inputClass, 'mt-1 resize-y')}
              rows={3}
              required
              disabled={actionLoading}
              value={reason}
              onChange={(event) => { setReason(sanitizeReasonInput(event.target.value)); setError(null); }}
              maxLength={REASON_MAX_LENGTH}
              placeholder={t('expenses.reject_reason_placeholder', locale)}
            />
          </label><p id="expense-reject-error" role="alert" className="min-h-6 text-sm text-error-700">{error}</p></>}
        </div>
      </Modal>

      {/* full-screen preview remains transient while the expense review itself is a page */}
      {preview && <DocumentPreviewModal
          source={preview}
          printSurface
          closeLabel={t('expenses.close', locale)}
          loadingLabel={t('expenses.loading', locale)}
          errorLabel={t('expenses.substitute_wizard.document_not_ready', locale)}
          retryLabel={t('expenses.substitute_wizard.retry', locale)}
          openNewTabLabel={t('expenses.open_new_tab', locale)}
          onClose={closePreview}
          onViewed={preview.onViewed}
          hideOpenNewTab={preview.hideOpenNewTab}
          footer={preview.mimeType.startsWith('image/') ? (
            <>
              {previewError && <p className="mr-auto text-xs font-semibold text-error-700">{previewError}</p>}
              <button
                className={ghostClass}
                disabled={previewSaving} aria-busy={Boolean(previewSaving)}
                onClick={async () => {
                  setPreviewSaving(true); setPreviewError(null);
                  try { await downloadDocumentAsPdf(preview.url, preview.name.replace(/\.[^.]+$/, ''), { vector: preview.mimeType === 'image/svg+xml' }); }
                  catch (e) { setPreviewError(err(e)); }
                  finally { setPreviewSaving(false); }
                }}
              >
                {previewSaving ? 'กำลังสร้างไฟล์...' : 'ดาวน์โหลด PDF'}
              </button>
            </>
          ) : undefined}
        />}
    </ExpenseCertificateHistory>
  );
}
