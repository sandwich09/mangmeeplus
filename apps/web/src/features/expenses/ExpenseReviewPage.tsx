'use client';

import { expenseOverpaidAmount, expenseOverpaymentRemedy, expenseReopenedMessage, EXPENSE_CORRECTION_WORDS, expenseCorrectionBlockerMessage, expenseReopenBlockerMessages, expenseReimbursementProgressLabel } from '@watchdog-bms/contracts';
import { expenseEvidenceAssessment, expenseEvidenceConfirmationError, expenseDateIsReadable } from '@watchdog-bms/contracts';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { canEditSubstituteReceipt } from './substitute-receipt-wizard.model';
import { useConfirm } from '@/common/components/modal/use-confirm';
import { Modal } from '@/common/components/modal/Modal';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { CoverLoader } from '@/common/components/state/CoverLoader';
import { apiErrorCode } from '@/common/api/api-error-message';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { useToast } from '@/common/components/toast';
import { findForbiddenChars, REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import { downloadDocumentAsPdf } from '@/common/files/download-document-pdf';
import { downloadArtifact } from '@/common/files/download-artifact';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import {
  acknowledgeOcrTotal, confirmDuplicate, confirmExpense, deleteExpense, dismissDuplicate,
  fetchAttachmentPreviewBlob, getExpense, getExpenseReadStatus,
  markExpenseReady, markExpenseReadyAsReviewer, recordExpensePayment, rejectExpense, reopenExpense, cancelExpensePayment,
  requestExpenseExtraction, removeExpenseReceipt, runDuplicateCheck, updateExpenseReviewFields, uploadExpenseEvidenceFile, voidExpense,
  listWhtHandoffs, issueSystemWhtCertificate, downloadSystemWhtCertificate, correctSystemWhtCertificate, issueSystemWhtReplacementCopy,
} from './expenses.api';
import {
  captureReadNoticeText, captureReadAgainAllowed, captureReadIsRunning, captureReadNotice,
  type ExpenseReadStatusFile,
} from './expense-capture-status.logic';
import {
  AI_MISSING_FIELD_LABELS, AI_SUMMARY_STATUS_LABELS, ATTACHMENT_PURPOSE_LABELS, isWetSignedScanAttachment,
  CAPTURE_SOURCE_LABELS, EXPENSE_VAT_MODE_LABELS, PAYMENT_METHOD_LABELS, POSTING_STATUS_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, deriveExpenseAuditChecks,
  deriveExpenseClassificationReviewState, deriveExpenseReviewSteps, expenseAiMissingFields, expenseCapabilities, expenseDataStepBlocker, expenseEvidenceStepBlocker, hasCurrentExpenseDocumentReview,
  expenseNeedsReceiptOrSubstitute, expenseSourceDraftViewState, expenseSubstituteReceiptAction, expenseValueLabel,
  canRunExpenseDuplicateCheck, hasAiGrandTotalMismatch, hasUnresolvedDuplicateWarning, initialExpenseReviewStep, needsAiTotalAcknowledgement,
  MIME_TYPE_LABELS, canDeleteExpense, claimExpenseRecordNote, effectiveVatRateLabel, expenseDeleteErrorMessage, firstFilled, isClaimExpenseRecord, shouldRereadReplacedReceipt, isBlockedCheckBillClassification,
  postingErrorText, vatModeRequiresRate, expensePaymentAttempt, classifyExpensePaymentFailure,
  expenseConfirmBlocker, expenseDocumentDateStatus, EXPENSE_DATE_STATUS_LABELS,
  canCorrectWhtCertificate, canIssueWhtReplacementCopy, canIssueExpenseWhtCertificate, expensePaymentFormState, expenseConfirmedLockMessage,
} from './expenses.model';
import type { ExpenseReviewTotalsState } from './useExpenseReviewTotals';
import type { ExpenseDetail, ExpenseReviewStepKey, ExpensePaymentAttempt, ExpensePaymentFailure } from './expenses.model';
import { canVoidExpenseFinancialState, isCalculatedExpenseRounding, todayCivilDate, type BusinessDocumentClassification, type ExpenseVatSourceOverrideInput, type ExpensePaymentMethod, type RemoveExpenseReceiptInput, type WhtCertificateHandoffDto } from '@watchdog-bms/contracts';
import {
  AiFieldLabel, AiFieldMissingHint, BuyerMatchBanner, DOCUMENT_KIND_LABELS, DocumentReviewSection, ExpenseReviewEditSection,
  InlineSpinner, MoneyRow, STEP_HELPER_KEYS, STEP_LABEL_KEYS, expenseNoticeKey,
  extractionNotice, nonExpenseNotice,
} from './ExpensesPages';
import type { ExtractionNotice } from './ExpensesPages';
import {
  baht, btnClass, dangerClass, dateShort, err, ErrorBanner, ghostClass, ICON,
  InfoBanner, inputClass, StatusBadge, successBtn, successBtnStyle, TAX_TONE,
} from './ExpensesUi';
import { ForeignCurrencyNotice } from './ForeignCurrencyNotice';
import { generateSourceJournal } from '../ledger/ledger.api';
import { hasRecordedTax, showsTaxCapture, useExpenseCapturePolicy } from './expense-capture-policy';
import { ExpenseSourceDraftCard } from './ExpenseSourceDraftCard';
import {
  activePrimaryReceiptAttachmentId,
  availableExpenseSessionStorage,
  expenseExtractionResponseIsUnknown,
  readExpenseExtractionAttempt,
  requestExpenseExtractionWithRecovery,
  writeExpenseExtractionAttempt,
  type ExpenseExtractionAttempt,
} from './expense-upload.logic';

// Sticky offsets, measured against the running app — do not guess these.
// AppHeader is `sticky top-0 z-[99999] h-[68px]`, so page-level sticky chrome must clear it or it
// pins underneath and silently disappears on scroll. The stepper row measures 72px.
// e2e `VIS-03` asserts the stepper stays visible below the header, so drift here fails a test.
const APP_HEADER_REM = 4.25; // 68px
const STEPPER_REM = 4.5; // 72px
const VIEWER_TOP_REM = APP_HEADER_REM + STEPPER_REM;
const VIEWER_BOTTOM_GAP_REM = 6; // clearance for the sticky action bar
const PAYMENT_SAVED_REFRESH_NOTICE = 'บันทึกการจ่ายแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ กรุณาตรวจประวัติการจ่าย หรือกด “ลองบันทึกรายการเดิมอีกครั้ง” เพื่อโหลดข้อมูล โดยไม่เพิ่มยอดจ่ายซ้ำ';
type ExpensePreviewSource = DocumentPreviewSource & { hideOpenNewTab?: boolean; onViewed?: () => void };
const isRemovableFilePurpose = (purpose: string): purpose is NonNullable<RemoveExpenseReceiptInput['purpose']> =>
  purpose === 'expense.receipt.primary' || purpose === 'expense.receipt.supporting'
  || purpose === 'expense.payment.evidence' || purpose === 'expense.review.evidence';

export function ExpenseReviewPage({ companyId, expenseId, userId, permissions }: { companyId: string; expenseId: string; userId: string; permissions: string[]; canSelfApprove: boolean }) {
  const router = useRouter();
  const caps = expenseCapabilities(permissions);
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
  const [receiptRemoving, setReceiptRemoving] = useState(false);
  const receiptRemovalPending = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [extractionLoading, setExtractionLoading] = useState(false);
  const extractionAttemptRef = useRef<ExpenseExtractionAttempt | null>(null);
  const extractionRequestRunningRef = useRef(false);
  const extractionRunIdRef = useRef(0);
  const [notice, setNotice] = useState<ExtractionNotice | null>(null);
  const [dataErrorCount, setDataErrorCount] = useState<number | null>(null);
  const [dataErrorMessage, setDataErrorMessage] = useState<string | null>(null);
  const onDataValidationChange = useCallback((count: number, message: string | null) => {
    setDataErrorCount(count); setDataErrorMessage(message);
  }, []);
  const [reason, setReason] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const correctionReasonRef = useRef<HTMLTextAreaElement>(null);
  const rejectReasonRef = useRef<HTMLTextAreaElement>(null);
  const [ocrTotalReason, setOcrTotalReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [correctionAction, setCorrectionAction] = useState<{ paymentId?: string } | null>(null);
  useEffect(() => {
    if (!correctionAction && !showReject) return;
    const frame = window.requestAnimationFrame(() => (correctionAction ? correctionReasonRef : rejectReasonRef).current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [correctionAction, showReject]);

  const [deleting, setDeleting] = useState(false);
  const [duplicateResolution, setDuplicateResolution] = useState<{ candidateId: string; action: 'dismiss' | 'confirm' } | null>(null);
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('BANK_TRANSFER');
  const [paidAt, setPaidAt] = useState<string>(() => todayCivilDate());
  const paymentAttemptRef = useRef<ExpensePaymentAttempt | null>(null);
  const paymentPendingRef = useRef(false);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
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
  const [preview, setPreview] = useState<ExpensePreviewSource | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewSaving, setPreviewSaving] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);
  // guided stepper (editable drafts only): freely clickable step; initial value computed once per opened expense
  const [step, setStep] = useState<ExpenseReviewStepKey>('data');
  // Details-step edits are saved by navigation (ถัดไป/ย้อนกลับ/chips), not an in-section save button.
  const reviewSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  // Evidence-step edits save only via the explicit บันทึกการตรวจ button (the save can cascade —
  // e.g. clearing tax codes), so navigation must not save them; ถัดไป disables until they are saved.
  // State, not a ref: the button has to re-render to go grey.
  const [evidenceDirty, setEvidenceDirty] = useState(false);
  // Plan 13.11.B: the VAT card owns "ใช้ยอดตามเอกสาร" (it is where the numbers and the pointed line
  // are), but the decision only takes effect on this page's confirm. Null unless a reviewer has both
  // named the VAT line taking the difference and written a reason.
  const vatOverrideRef = useRef<ExpenseVatSourceOverrideInput | null>(null);
  const [stepSaving, setStepSaving] = useState(false);
  const openReject = () => {
    setReason(''); setError(null); setShowReject(true); setShowVoid(false); setDuplicateResolution(null);
  };
  const closeReject = () => {
    if (actionLoading) return;
    setShowReject(false); setReason('');
  };
  // Navigation is linear — ถัดไป/ย้อนกลับ only, the stepper is display-only. ยกเลิกรายการ
  // therefore renders on every step: an invalid draft (ถัดไป disabled by validation) must
  // stay rejectable without faking data first.
  const goToStep = async (key: ExpenseReviewStepKey) => {
    if (aiReading || stepSaving) return;
    if (step === 'evidence' && key === 'review' && evidenceStepBlocker) return;
    // An issued substitute certificate locks material fields server-side
    // (409 substitute_evidence_locks_expense); saving on navigate would fail
    // silently and trap the user on step 1, and there is nothing to save.
    const substituteLocked = detail?.substituteReceiptEvidence?.status === 'ISSUED';
    if (step === 'data' && key !== 'data' && reviewSaveRef.current && !substituteLocked) {
      setStepSaving(true);
      const saved = await reviewSaveRef.current().finally(() => setStepSaving(false));
      if (!saved) return; // stay on the step — the section shows the error
    }
    setStep(key);
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
  useEffect(() => { void load(); }, [load]);

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
    if (!detail?.primaryAttachmentId) return;
    let cancelled = false;
    const runId = extractionRunIdRef.current;
    void getExpenseReadStatus(companyId, expenseId)
      .then((result) => { if (!cancelled && runId === extractionRunIdRef.current) setReadState(result.files[0] ?? null); })
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
    setNotice(null);
    try {
      const stored = window.sessionStorage.getItem(expenseNoticeKey(expenseId));
      window.sessionStorage.removeItem(expenseNoticeKey(expenseId));
      setNotice(stored ? JSON.parse(stored) as ExtractionNotice : null);
    } catch { /* storage may be disabled */ }
  }, [expenseId]);

  // Initial step = first not-done step when the modal opens (READY_FOR_CONFIRMATION → review).
  // Guarded per expenseId so in-modal refreshes never auto-jump the user to another step.
  useEffect(() => {
    if (!detail || detail.id !== expenseId || stepInitRef.current === expenseId) return;
    stepInitRef.current = expenseId;
    setStep(isBlockedCheckBillClassification(detail.aiVerificationSummaryJson)
      ? 'evidence'
      : initialExpenseReviewStep(deriveExpenseReviewSteps(detail, canReview), detail.status));
  }, [detail, expenseId, canReview]);

  useEffect(() => {
    if (!detail?.correctionOpenedAt || !['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status)) return;
    setStep('data');
    const frame = window.requestAnimationFrame(() => vendorRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' }));
    return () => window.cancelAnimationFrame(frame);
  }, [detail?.correctionOpenedAt]);

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
    if (!['expense_payment_exceeds_outstanding', 'expense_payment_changed', 'expense_payment_not_confirmed',
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
  const [whtHandoff, setWhtHandoff] = useState<WhtCertificateHandoffDto | null>(null);
  useEffect(() => {
    if (!detail || detail.status !== 'CONFIRMED' || !(Number(detail.whtAmount) > 0) || !permissions.some((permission) => ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct'].includes(permission))) {
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
    paymentDate: '', formType: 'PND53' as 'PND3' | 'PND53',
    payeeName: '', payeeTaxId: '', payeeAddress: '', payeeBranchCode: '', reason: '',
  });
  const openCorrectForm = () => {
    const prefill = whtHandoff?.prefill;
    setCorrectForm({
      incomeCategoryCode: prefill?.incomeCategoryCode ?? '', incomeCategoryName: prefill?.incomeCategoryName ?? '',
      whtRate: prefill?.whtRate ?? '', grossAmount: prefill?.grossAmount ?? '', withheldAmount: prefill?.withheldAmount ?? '',
      paymentDate: prefill?.paymentDate ? prefill.paymentDate.slice(0, 10) : '', formType: (prefill?.formType ?? 'PND53') as 'PND3' | 'PND53',
      payeeName: prefill?.payeeSnapshot?.name ?? '', payeeTaxId: prefill?.payeeSnapshot?.taxId ?? '',
      payeeAddress: prefill?.payeeSnapshot?.address ?? '', payeeBranchCode: prefill?.payeeSnapshot?.branchCode ?? '',
      reason: '',
    });
    setCorrectOpen(true);
  };

  const doCorrectWht = async () => {
    if (!whtHandoff) return;
    setCorrectBusy(true); setCorrectError(null);
    try {
      const result = await correctSystemWhtCertificate(companyId, whtHandoff.id, {
        corrected: {
          formType: correctForm.formType,
          incomeCategoryCode: correctForm.incomeCategoryCode || undefined,
          incomeCategoryName: correctForm.incomeCategoryName || undefined,
          whtRate: correctForm.whtRate || undefined,
          grossAmount: correctForm.grossAmount || undefined,
          withheldAmount: correctForm.withheldAmount || undefined,
          paymentDate: correctForm.paymentDate ? new Date(correctForm.paymentDate).toISOString() : undefined,
          payeeSnapshot: {
            name: correctForm.payeeName || undefined,
            taxId: correctForm.payeeTaxId || undefined,
            address: correctForm.payeeAddress || undefined,
            branchCode: correctForm.payeeBranchCode || undefined,
          },
        },
        reason: correctForm.reason.trim(),
      });
      downloadArtifact(result.pdfArtifact);
      setWhtHandoff((current) => current ? { ...current, certificateId: result.id } : null);
      setCorrectOpen(false);
      toast.success('แก้ไขหนังสือรับรองเรียบร้อยแล้ว');
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
      toast.success('ออกใบแทนเรียบร้อยแล้ว');
    } catch (e) {
      setReplaceError(err(e));
    } finally { setReplaceBusy(false); }
  };

  const doConfirm = async () => {
    await doAction(() => confirmExpense(companyId, expenseId, vatOverrideRef.current ?? undefined), 'ยืนยันเอกสารเรียบร้อยแล้ว');
  };

  const doIssueWhtCertificate = async () => {
    if (!detail || !whtHandoff || !canIssueExpenseWhtCertificate(detail, whtHandoff, permissions)) return;
    setWhtIssuing(true); setWhtIssueError(null);
    try {
      const result = await issueSystemWhtCertificate(companyId, whtHandoff.id);
      downloadArtifact(result.pdfArtifact);
      setWhtHandoff({ ...whtHandoff, status: 'SYSTEM_ISSUED', certificateId: result.id });
      await load();
      toast.success('ออกหนังสือรับรองหัก ณ ที่จ่ายในระบบเรียบร้อยแล้ว');
    } catch (e) { setWhtIssueError(err(e)); }
    finally { setWhtIssuing(false); }
  };

  const downloadWht = async () => {
    if (!whtHandoff) return;
    setWhtIssuing(true); setWhtIssueError(null);
    try { downloadArtifact((await downloadSystemWhtCertificate(companyId, whtHandoff.id)).pdfArtifact); }
    catch (e) { setWhtIssueError(err(e)); }
    finally { setWhtIssuing(false); }
  };

  const editPayment = (change: () => void) => {
    if (paymentPendingRef.current) return;
    setPaymentFailure(null);
    if (paymentAttemptRef.current) {
      paymentAttemptRef.current = null;
      setPaymentNotice('คุณแก้ไขข้อมูลแล้ว การบันทึกครั้งถัดไปเป็นรายการจ่ายใหม่ กรุณาตรวจประวัติการจ่ายก่อนเพื่อไม่ให้จ่ายซ้ำ');
    }
    change();
  };

  const submitPayment = async () => {
    // Synchronous guard also covers two clicks before React renders the disabled state.
    if (paymentPendingRef.current || actionLoading || conflictReload || paymentFailure === 'conflict' || (!paymentAttemptRef.current && (expensePaymentFormState(detail?.outstandingAmount ?? '0', paidAmount, paidAt).disabledReason || !detail?.correctionCapabilities?.canRecordPayment))) return;
    paymentPendingRef.current = true;
    setActionLoading(true); setError(null);
    try {
      const attempt = expensePaymentAttempt(paymentAttemptRef.current, companyId, expenseId, { paidAmount, paymentMethod, paidAt });
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
      paymentAttemptRef.current = null;
      setPaidAmount(expensePaymentFormState(refreshed.outstandingAmount, '', paidAt).prefill); setPaymentFailure(null); setPaymentNotice(null);
      // A successful replay may report a source voided since the original payment.
      toast.success(refreshed.status === 'VOIDED' ? 'รายการนี้ถูกยกเลิกแล้ว ไม่มีการบันทึกจ่ายเพิ่ม' : 'บันทึกการจ่ายเรียบร้อยแล้ว');
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
            ? 'ข้อมูลรายการนี้ไม่ตรงกับการจ่ายที่บันทึกไว้ กรุณาตรวจประวัติการจ่ายก่อนแก้ไขเป็นรายการใหม่'
            : 'ยังยืนยันผลการบันทึกไม่ได้ กด “ลองบันทึกรายการเดิมอีกครั้ง” ได้โดยไม่เพิ่มยอดจ่ายซ้ำ หากจะเปลี่ยนข้อมูล กรุณาตรวจประวัติการจ่ายก่อน');
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

  // EXP-UX-01 / plan 13.11.A: ส่งตรวจสอบ ends the job, so it must end on the list — staying on the
  // detail page left every user closing the page and re-checking by hand. `replace`, not `push`:
  // Back must not return to the stale pre-submit view. Only after the server confirms; a failure
  // keeps this page and everything typed into it (doAction's catch already does exactly that).
  const markReady = async (successMessage = 'ส่งตรวจเรียบร้อยแล้ว') => {
    setActionLoading(true); setError(null);
    try {
      await (canReview ? markExpenseReadyAsReviewer(companyId, expenseId) : markExpenseReady(companyId, expenseId));
      onRefresh();
      router.replace(`/companies/${companyId}/expenses?highlight=${encodeURIComponent(expenseId)}`);
      toast.success(successMessage);
      // Left set on purpose: the navigation unmounts this page, and re-enabling the button would
      // let a second submit fire against an expense that already moved on.
    } catch (e) { setError(await refreshChangedDocument(e, 'other') ?? err(e)); setActionLoading(false); }
  };

  // Not doAction: the record is gone on success, so reloading it would 404. Leave `deleting` set —
  // the navigation unmounts this page, and re-enabling the button would point it at a dead id.
  const removeExpense = async () => {
    setDeleting(true); setError(null);
    try {
      await deleteExpense(companyId, expenseId);
      onRefresh();
      router.push(`/companies/${companyId}/expenses`);
    } catch (e) { setError(expenseDeleteErrorMessage(e, locale)); setDeleting(false); setShowDelete(false); }
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
          ? `ลบไฟล์ “${attachment.originalFileName}” ออกจากรายการนี้โดยไม่ต้องอัปโหลดใหม่ รายการค่าใช้จ่ายและยอดที่บันทึกไว้จะยังอยู่${primary ? " ผลตรวจจากใบเสร็จเดิมจะถูกล้าง กรุณาตรวจข้อมูลและหลักฐานอีกครั้ง" : " ไฟล์อื่นในรายการจะยังอยู่"}`
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

  const attachments = detail?.attachments ?? [];
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
  const backLink = <Link href={`/companies/${companyId}/expenses`}>← {t('expenses.back_to_list', locale)}</Link>;

  if (loading && !detail) {
    return (
      <MangmeePage eyebrow={backLink} title={t('expenses.loading', locale)}>
        <MangmeeCard className="flex items-center justify-center gap-3 p-10 text-sm text-gray-500">
          <InlineSpinner /> {t('expenses.loading', locale)}
        </MangmeeCard>
      </MangmeePage>
    );
  }
  if (!detail) {
    return (
      <MangmeePage eyebrow={backLink} title={t('expenses.not_found', locale)}>
        <ErrorBanner message={error ?? t('expenses.not_found', locale)} />
      </MangmeePage>
    );
  }

  const claimedSource = Boolean(detail.reimbursementProgress?.requestId && detail.reimbursementProgress.status !== 'DRAFT');
  // A claim's own expense record ends with its claim: the API refuses to void, reject or delete it from here.
  const claimRecord = isClaimExpenseRecord(detail);
  const claimNote = claimExpenseRecordNote(detail);
  const canReject = caps.canReject && !claimRecord;
  const isMutable = !claimedSource && ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status);
  // Backend: PATCH/mark-ready require expense.review OR (expense.update AND owner) — ownership alone is not enough.
  const isOwnRecord = detail.createdByUserId === userId;
  const canMutateDraft = isMutable && (canReview || (caps.canUpdate && isOwnRecord));
  // Extraction: expense.ocr.request OR expense.review OR (expense.receipt.upload on own record).
  const canExtract = !claimedSource && (caps.canRequestOcr || (caps.canUploadReceipts && isOwnRecord));
  // Fixed correction marker: h-5 plus the stepper's gap-1.5 = 1.625rem.
  const viewerTopRem = VIEWER_TOP_REM + (isMutable && detail.correctionOpenedAt ? 1.625 : 0);
  const isConfirmed = detail.status === 'CONFIRMED';
  const correctionAllowed = correctionAction?.paymentId
    ? detail.correctionCapabilities?.payments.find(p => p.id === correctionAction.paymentId)?.canCancel === true
    : detail.correctionCapabilities?.canReopen === true;
  const paymentForm = expensePaymentFormState(detail.outstandingAmount, paidAmount, paidAt, Boolean(paymentAttemptRef.current));
  const canCancelFinancialExpense = !claimedSource && !claimRecord && canVoidExpenseFinancialState(detail);
  const canGenerateJournal = isConfirmed && caps.canPostLedger && detail.pendingPostingSourceType !== null;
  const canViewJournal = isConfirmed && caps.canReadLedger && detail.journalEntryId !== null;
  const canCheckDuplicates = canReview && canRunExpenseDuplicateCheck(detail.status);
  const hasDuplicates = hasUnresolvedDuplicateWarning(detail.duplicateStatus);
  const isConfirmedDuplicate = detail.duplicateStatus === 'CONFIRMED_DUPLICATE';
  const sourceDraftView = expenseSourceDraftViewState(detail, canMutateDraft && canReview);
  const visibleSourceDraft = sourceDraftView.sourceDraft;
  const sourceDraftIncomplete = sourceDraftView.incomplete;
  const sourceOnlyDraft = sourceDraftView.sourceOnly;
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
  const multiDocumentDetected = readState
    ? readState.multiDocument === true
    : (aiMap?.['classification'] as { contentKind?: string } | undefined)?.contentKind === 'MULTI_DOCUMENT';
  const splitExpenseIds = readState?.splitExpenseIds ?? [];
  const autoSplitNotice = multiDocumentDetected && splitExpenseIds.length > 0
    ? t('expenses.capture.auto_split', locale).replace('{count}', String(readState?.documentCount ?? splitExpenseIds.length + 1))
    : null;
  /**
   * "อ่านเอกสารอีกครั้ง" is a deliberate intent on a file that has NOT just failed to be read
   * (§17.6). After a terminal failure — or under an error notice — the way forward is this form,
   * and offering a reread there is the loop the spec removed.
   */
  const readAgainAllowed = captureReadAgainAllowed({
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
  const documentReviewSaveRequired = evidenceStepBlocker === 'expenses.doc_review_required_next'
    || evidenceStepBlocker === 'expenses.doc_review_unsaved_next';
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
  const hasRecordedPayments = detail.payments?.some(p => p.status === 'RECORDED') ?? false;
  const canCancelRecordedPayment = detail.correctionCapabilities?.payments.some(p => p.canCancel) ?? false;
  const overpaymentMessage = overpaidAmount ? `${EXPENSE_CORRECTION_WORDS.overpaid} ${baht(overpaidAmount)} ${expenseOverpaymentRemedy(hasRecordedPayments, canCancelRecordedPayment)}` : null;
  const canConfirmExpense = !overpaidAmount && !personalSubstitute && canConfirm && detail.status === 'READY_FOR_CONFIRMATION' && !sourceDraftIncomplete && !hasDuplicates && !classificationBlocked && !evidenceError && !needsReceiptOrSubstitute && !ocrTotalUnacknowledged && !isZeroAmount;
  // Owner requirement 2026-08-28: the reason used to live only in the button's `title`, i.e. a hover
  // tooltip — and expenses get reviewed on a phone, where nothing hovers. One helper decides it now,
  // both footers use it, and it is rendered as text under the button instead of hidden behind a cursor.
  const confirmBlocker = canConfirm && !canConfirmExpense
    ? expenseConfirmBlocker({
      status: detail.status, classificationBlocked, hasDuplicates, isConfirmedDuplicate, needsReceiptOrSubstitute,
      evidenceError, ocrTotalUnacknowledged, isZeroAmount, classificationBlockMessage,
    })
    : null;
  const confirmBlockedText = overpaymentMessage ?? (personalSubstitute ? 'ใบรับรองนี้ระบุว่าพนักงานจ่ายร้านแล้ว การคืนเงินต้องดำเนินการแยกตามขั้นตอนการเงิน' : sourceDraftIncomplete
    ? t('expenses.source_draft_blocks_progress', locale)
    : confirmBlocker ? (confirmBlocker.literal ?? t(confirmBlocker.key!, locale)) : null);
  const confirmBlockedNotice = confirmBlockedText ? (
    <p className="w-full text-center text-xs font-medium text-warning-700">
      {overpaymentMessage ? null : <>{t('expenses.confirm_blocked_prefix', locale)} {confirmBlockedText}</>}
    </p>
  ) : null;
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
    ? `${t('expenses.non_expense_override_recorded', locale)}: ${DOCUMENT_KIND_LABELS[locale][storedClassification['documentKind']] ?? 'เอกสารธุรกิจอื่น'} — ${storedResolution['reason']} · ${dateShort(storedResolution['resolvedAt'])}`
    : null;
  const missingFields = Array.isArray(aiMap?.['missingFields'])
    ? aiMap.missingFields.filter((field): field is string => typeof field === 'string')
    : [];
  const aiMissingDataFields = expenseAiMissingFields(aiMap, 'data');

  const auditChecks = deriveExpenseAuditChecks(detail);

  const auditPassCount = auditChecks.filter((check) => check.status === 'pass').length;
  const auditWarnCount = auditChecks.filter((check) => check.status === 'warn').length + (overpaymentMessage ? 1 : 0);
  const confirmBlockers = canMutateDraft && (classificationBlocked || (detail.status === 'READY_FOR_CONFIRMATION' && (isZeroAmount || hasDuplicates)));
  const warnNoteClass = 'rounded-xl border border-warning-100 bg-warning-50 px-3 py-2 text-xs font-semibold text-warning-700';
  const navChips: Array<{ key: DictionaryKey; ref: { current: HTMLDivElement | null } }> = [
    { key: 'expenses.nav_audit', ref: auditRef },
    { key: 'expenses.nav_money', ref: moneyRef },
    { key: 'expenses.nav_vendor', ref: vendorRef },
    { key: 'expenses.nav_documents', ref: documentsRef },
    { key: 'expenses.nav_payment', ref: paymentRef },
  ];
  const approverOnlyActions = !claimedSource && !canMutateDraft && detail.status === 'READY_FOR_CONFIRMATION' && (canConfirm || canReject);
  const canRestartReview = detail.status === 'REJECTED' && (canReview || (caps.canUpdate && isOwnRecord));
  const canDelete = canDeleteExpense(detail, userId, caps);
  const hasFooterActions = canMutateDraft || approverOnlyActions || isConfirmed || (canCancelFinancialExpense && caps.canVoid) || canRestartReview || canDelete;
  // Guided stepper only for editable drafts (canMutateDraft already implies status ∈ {DRAFT, NEEDS_REVIEW, READY_FOR_CONFIRMATION});
  // every other status/viewer keeps the continuous-scroll layout and footer untouched.
  const guided = canMutateDraft && !sourceOnlyDraft;
  const steps = guided ? deriveExpenseReviewSteps(detail, canReview) : [];
  const stepIndex = steps.findIndex((entry) => entry.key === step);
  const detailsStepDone = steps.some((entry) => entry.key === 'data' && entry.state === 'done');
  // One truth for step 1, the same rule step 2 already follows: what disables ถัดไป is what is
  // printed under it. See expenseDataStepBlocker — an unreported count must not grey the button out.
  const validationBlockMessage = expenseDataStepBlocker({
    errorCount: dataErrorCount, firstErrorMessage: dataErrorMessage,
    countMessage: t('expenses.v_blocking_count', locale).replace('{count}', String(dataErrorCount ?? 0)),
  }) ?? undefined;

  const pageTitle = (
    <span className="min-w-0">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="tabular-nums text-xs font-bold text-gray-400">{firstFilled(detail.expenseNumber) ?? 'ยังไม่มีเลขรายจ่าย'}</span>
        {detail.expenseNumber && <button type="button" className="min-h-11 rounded-lg px-2 text-xs font-semibold text-brand-700" onClick={async () => {
          try { await navigator.clipboard.writeText(detail.expenseNumber!); toast.success('คัดลอกเลขรายจ่ายแล้ว'); }
          catch { setError('คัดลอกไม่สำเร็จ กรุณาเลือกเลขรายจ่ายแล้วคัดลอกอีกครั้ง'); }
        }}>คัดลอกเลขรายจ่าย</button>}
        <span className="max-w-full truncate text-lg font-extrabold text-gray-900">{firstFilled(detail.vendorNameSnapshot) ?? t('expenses.vendor_pending', locale)}</span>
        <span className="text-xs font-normal text-gray-500">{expenseValueLabel(SOURCE_DOCUMENT_TYPE_LABELS, detail.sourceDocumentType, 'เอกสารค่าใช้จ่าย')} · {(visibleSourceDraft ? !visibleSourceDraft.header.expenseDate : !expenseDateIsReadable(detail.aiVerificationSummaryJson))
          ? t('expenses.source_draft_date_unknown', locale)
          : dateShort(visibleSourceDraft?.header.expenseDate ?? detail.expenseDate)}</span>
      </span>
    </span>
  );
  const pageMeta = (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {detail.reimbursementProgress ? <span className="text-sm text-success-700">{expenseReimbursementProgressLabel(detail.reimbursementProgress)}{detail.reimbursementProgress.requestNo ? ` · ${detail.reimbursementProgress.requestNo}` : ''}</span> : <StatusBadge status={detail.status} />}
      {detail.reimbursementProgress?.requestId && <Link className="text-sm font-semibold text-brand-700 underline" href={`/companies/${companyId}/reimbursements?tab=mine&focus=${detail.reimbursementProgress.requestId}`}>เปิดใบเบิกคืน</Link>}
      {detail.costSourceExpenseId && <Link className="text-sm font-semibold text-brand-700 underline" href={`/companies/${companyId}/expenses/${detail.costSourceExpenseId}`}>เปิดค่าใช้จ่ายต้นทาง</Link>}
      {claimRecord && <Link className="text-sm font-semibold text-brand-700 underline" href={`/companies/${companyId}/reimbursements/${detail.sourceReimbursementRequestId}`}>เปิดคำขอเบิก</Link>}
      {claimNote && <span className="w-full text-xs text-gray-500">{claimNote}</span>}
      {claimedSource && <span className="w-full text-xs text-gray-500">หลักฐานต้นทางของใบเบิก รายการนี้นับยอดครั้งเดียวร่วมกับรายการบัญชีจากใบเบิก การแก้ไขและจ่ายคืนให้ดำเนินการผ่านใบเบิก</span>}
      {!sourceOnlyDraft && <MangmeeBadge tone={TAX_TONE(detail.taxEvidenceStatus)}>{expenseValueLabel(TAX_EVIDENCE_STATUS_LABELS, detail.taxEvidenceStatus, 'รอตรวจหลักฐานภาษี')}</MangmeeBadge>}
      {/* the AI badge is gone: the AI strip on the data step already says it, in words */}
      <MangmeeBadge tone="slate">{expenseValueLabel(CAPTURE_SOURCE_LABELS, detail.captureSource, 'ช่องทางอื่น')}</MangmeeBadge>
    </div>
  );

  // Guided review exposes cancellation on every step, then deletion for a cancelled record.
  // Existing permission checks and financial-void actions still apply.
  const issuedCertificateActions = isConfirmed && hasWht && whtHandoff?.status === 'SYSTEM_ISSUED' && (canCorrectWhtCertificate(whtHandoff, permissions) || canIssueWhtReplacementCopy(whtHandoff, permissions)) && (
    <MangmeeCard className="p-4 text-sm text-gray-700">
            {canCorrectWhtCertificate(whtHandoff, permissions) && (
              <div className="mt-3 border-t border-green-200 pt-3">
                <button type="button" className={ghostClass} aria-expanded={correctOpen} onClick={() => (correctOpen ? setCorrectOpen(false) : openCorrectForm())}>
                  {correctOpen ? 'ปิดฟอร์มแก้ไข' : 'แก้ไขหนังสือรับรอง'}
                </button>
                {correctOpen && (
                  <form className="mt-2 grid gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void doCorrectWht(); }}>
                    <label className="block" htmlFor={`wht-correct-income-code-${detail.id}`}>
                      <span className="text-xs text-gray-600">รหัสประเภทเงินได้</span>
                      <input id={`wht-correct-income-code-${detail.id}`} className={inputClass} value={correctForm.incomeCategoryCode} onChange={(e) => setCorrectForm((f) => ({ ...f, incomeCategoryCode: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-income-name-${detail.id}`}>
                      <span className="text-xs text-gray-600">ชื่อประเภทเงินได้</span>
                      <input id={`wht-correct-income-name-${detail.id}`} className={inputClass} value={correctForm.incomeCategoryName} onChange={(e) => setCorrectForm((f) => ({ ...f, incomeCategoryName: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-form-type-${detail.id}`}>
                      <span className="text-xs text-gray-600">แบบ</span>
                      <ThemedSelect id={`wht-correct-form-type-${detail.id}`} className={inputClass} value={correctForm.formType} disabled={correctBusy} onChange={(e) => setCorrectForm((f) => ({ ...f, formType: e.target.value as 'PND3' | 'PND53' }))}>
                        <option value="PND3">ภ.ง.ด.3</option>
                        <option value="PND53">ภ.ง.ด.53</option>
                      </ThemedSelect>
                    </label>
                    <label className="block" htmlFor={`wht-correct-rate-${detail.id}`}>
                      <span className="text-xs text-gray-600">อัตราภาษี (%)</span>
                      <input id={`wht-correct-rate-${detail.id}`} className={inputClass} value={correctForm.whtRate} onChange={(e) => setCorrectForm((f) => ({ ...f, whtRate: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-gross-${detail.id}`}>
                      <span className="text-xs text-gray-600">จำนวนเงินที่จ่าย</span>
                      <input id={`wht-correct-gross-${detail.id}`} className={inputClass} value={correctForm.grossAmount} onChange={(e) => setCorrectForm((f) => ({ ...f, grossAmount: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-withheld-${detail.id}`}>
                      <span className="text-xs text-gray-600">ภาษีที่หักไว้</span>
                      <input id={`wht-correct-withheld-${detail.id}`} className={inputClass} value={correctForm.withheldAmount} onChange={(e) => setCorrectForm((f) => ({ ...f, withheldAmount: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-payment-date-${detail.id}`}>
                      <span className="text-xs text-gray-600">วันที่จ่าย</span>
                      <ThemedDate id={`wht-correct-payment-date-${detail.id}`} className={inputClass} value={correctForm.paymentDate} onChange={(e) => setCorrectForm((f) => ({ ...f, paymentDate: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-payee-name-${detail.id}`}>
                      <span className="text-xs text-gray-600">ชื่อผู้รับเงิน</span>
                      <input id={`wht-correct-payee-name-${detail.id}`} className={inputClass} value={correctForm.payeeName} onChange={(e) => setCorrectForm((f) => ({ ...f, payeeName: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-payee-taxid-${detail.id}`}>
                      <span className="text-xs text-gray-600">เลขประจำตัวผู้เสียภาษี (ผู้รับ)</span>
                      <input id={`wht-correct-payee-taxid-${detail.id}`} className={inputClass} value={correctForm.payeeTaxId} onChange={(e) => setCorrectForm((f) => ({ ...f, payeeTaxId: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block" htmlFor={`wht-correct-payee-branch-${detail.id}`}>
                      <span className="text-xs text-gray-600">สาขา</span>
                      <input id={`wht-correct-payee-branch-${detail.id}`} className={inputClass} value={correctForm.payeeBranchCode} onChange={(e) => setCorrectForm((f) => ({ ...f, payeeBranchCode: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block sm:col-span-2" htmlFor={`wht-correct-payee-address-${detail.id}`}>
                      <span className="text-xs text-gray-600">ที่อยู่ผู้รับเงิน</span>
                      <input id={`wht-correct-payee-address-${detail.id}`} className={inputClass} value={correctForm.payeeAddress} onChange={(e) => setCorrectForm((f) => ({ ...f, payeeAddress: e.target.value }))} disabled={correctBusy} />
                    </label>
                    <label className="block sm:col-span-2" htmlFor={`wht-correct-reason-${detail.id}`}>
                      <span className="text-xs text-gray-600">เหตุผลที่แก้ไข (บังคับ)</span>
                      <input id={`wht-correct-reason-${detail.id}`} className={inputClass} value={correctForm.reason} onChange={(e) => setCorrectForm((f) => ({ ...f, reason: e.target.value }))} disabled={correctBusy} placeholder="เช่น พิมพ์ยอดผิด แก้ที่อยู่ผู้รับเงิน" />
                    </label>
                    {correctError && <div className="sm:col-span-2"><ErrorBanner message={correctError} /></div>}
                    <div className="sm:col-span-2">
                      <button type="submit" className={btnClass} aria-busy={correctBusy} disabled={correctBusy || !correctForm.reason.trim()}>
                        {correctBusy ? 'กำลังแก้ไข...' : 'ยืนยันแก้ไข'}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}
            {canIssueWhtReplacementCopy(whtHandoff, permissions) && (
              <div className="mt-3 border-t border-green-200 pt-3">
                {replaceError && <div className="mb-2"><ErrorBanner message={replaceError} /></div>}
                <button type="button" className={ghostClass} aria-busy={replaceBusy} disabled={replaceBusy} onClick={() => void doReplaceWht()}>
                  {replaceBusy ? 'กำลังออกใบแทน...' : 'ออกใบแทน'}
                </button>
              </div>
            )}
    </MangmeeCard>
  );
  const modalFooter = hasFooterActions ? (
    <fieldset disabled={aiReading} inert={aiReading} className="flex min-w-0 w-full flex-wrap items-center gap-2 [&_button]:whitespace-nowrap [&_summary]:whitespace-nowrap">
      {/* Invalid drafts remain cancellable on every step through the secondary actions. */}
      {/* Cancellation preserves the record; deletion is offered only once that state is confirmed. */}
      {detail.status === 'REJECTED' && canDelete && <button type="button" className={dangerClass} onClick={() => { setShowDelete(true); setShowReject(false); setShowVoid(false); setDuplicateResolution(null); }} disabled={actionLoading || deleting} aria-busy={deleting}>{t('expenses.delete', locale)}</button>}
      {(guided || approverOnlyActions || canRestartReview || (canCancelFinancialExpense && caps.canVoid)) && <details className="relative shrink-0" onClick={event => { if ((event.target as HTMLElement).closest('button')) event.currentTarget.open = false; }} onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
        <summary className={cx(ghostClass, 'min-h-11 cursor-pointer list-none')}>เพิ่มเติม</summary>
        <div className="absolute bottom-full left-0 z-20 mb-2 flex min-w-48 flex-col gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
        {canCancelFinancialExpense && (
          <>
            {caps.canVoid && <button className={dangerClass} onClick={() => { setReason(''); setError(null); setShowVoid(true); setShowReject(false); setDuplicateResolution(null); }} disabled={actionLoading}>{t('expenses.void_document', locale)}</button>}
          </>
        )}

      {(guided || approverOnlyActions) && canReject && (
        <button type="button" className={dangerClass} onClick={openReject} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{t(showReject && actionLoading ? 'expenses.rejecting' : 'expenses.reject', locale)}</button>
      )}

        {canEditLinkedSubstitute && (
          <button type="button" className={cx(ghostClass, '!min-h-[44px] !text-base')} disabled={aiReading || stepSaving || evidenceDirty} aria-busy={Boolean(stepSaving)} onClick={() => void openSubstituteReceipt(true)}>
            {stepSaving ? 'กำลังบันทึก…' : 'แก้ไขใบแทนใบเสร็จ'}
          </button>
        )}

            {stepIndex > 0 && <button className={ghostClass} disabled={stepSaving} aria-busy={Boolean(stepSaving)} onClick={() => void goToStep(steps[stepIndex - 1].key)}>{t('expenses.step_back', locale)}</button>}

                {canCheckDuplicates && <button className={ghostClass} onClick={checkDuplicates} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{t('expenses.check_duplicate', locale)}</button>}
        {canRestartReview && <button className={ghostClass} onClick={() => void markReady('เริ่มตรวจใหม่เรียบร้อยแล้ว')} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>{t('expenses.restart_review', locale)}</button>}
        {canCancelFinancialExpense && (
          <>
            {canGenerateJournal && detail.pendingPostingSourceType && (
              <button className={btnClass} onClick={() => doAction(() => generateSourceJournal(companyId, detail.pendingPostingSourceType!, detail.pendingPostingSourceId!), 'สร้างสมุดรายวันเรียบร้อยแล้ว')} disabled={actionLoading || !detail.pendingPostingSourceId} aria-busy={Boolean(actionLoading)}>
                {detail.postingStatus === 'posting_error'
                  ? 'แก้ไขแล้ว ลองลงบัญชีอีกครั้ง'
                  : detail.pendingPostingSourceType === 'expense.payment'
                    ? 'ลงบัญชีการชำระ'
                    : 'สร้างและผ่านรายการ JV'}
              </button>
            )}
            {canViewJournal && <button className={btnClass} onClick={onGoJournal}>{detail.journalEntryNumber ? `ดู ${detail.journalEntryNumber} →` : t('expenses.view_journal', locale)}</button>}
          </>
        )}



      </div></details>}
      <div className={cx('ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2') }>
        {guided && (
          <>
            {step === 'data' && validationBlockMessage && (
              <div className="max-w-lg rounded-lg border border-warning-100 bg-warning-50 px-3 py-2 text-sm text-warning-700">
                <p id={`expense-review-block-${detail.id}`} role="status">{validationBlockMessage}</p>
                <button type="button" className="mt-1 rounded font-semibold underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => {
                  const section = vendorRef.current;
                  const target = section?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? section;
                  target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
                  target?.focus({ preventScroll: true });
                }}>{t('expenses.v_fix_fields', locale)}</button>
              </div>
            )}
            {step === 'review' && (
              <>

                {detail.status !== 'READY_FOR_CONFIRMATION' && (
                  <>
                    <button className={btnClass} onClick={() => void markReady()} disabled={actionLoading || classificationBlocked || !detailsStepDone} aria-busy={Boolean(actionLoading)} title={classificationBlocked ? classificationBlockMessage : sourceDraftIncomplete ? t('expenses.source_draft_blocks_progress', locale) : !detailsStepDone ? t('expenses.submit_requires_details', locale) : undefined}>{t('expenses.send_for_review', locale)}</button>
                    {sourceDraftIncomplete && <p role="status" className="max-w-lg text-sm font-medium text-warning-700">{t('expenses.source_draft_blocks_progress', locale)}</p>}
                  </>
                )}
                {detail.status === 'READY_FOR_CONFIRMATION' && (
                  <>
                    {canConfirm && <button className={successBtn} style={successBtnStyle} onClick={() => void doConfirm()} disabled={actionLoading || !canConfirmExpense} aria-busy={Boolean(actionLoading)} title={confirmBlockedText ?? undefined}>{t('expenses.confirm_and_post', locale)}</button>}
                    {confirmBlockedNotice}
                  </>
                )}
              </>
            )}
            {stepIndex < steps.length - 1 && <button className={btnClass} disabled={aiReading || stepSaving || (step === 'data' && validationBlockMessage !== undefined) || (step === 'evidence' && evidenceStepBlocker !== null)} aria-busy={Boolean(stepSaving)} aria-describedby={step === 'data' && validationBlockMessage ? `expense-review-block-${detail.id}` : step === 'evidence' && evidenceStepBlocker ? documentReviewSaveRequired ? `expense-document-review-hint-${detail.id}` : `expense-review-evidence-block-${detail.id}` : undefined} title={step === 'data' ? validationBlockMessage : undefined} onClick={() => void goToStep(steps[stepIndex + 1].key)}>{stepSaving && step === 'data' ? t('expenses.saving', locale) : t('expenses.step_next', locale)}</button>}
            {/* Save-review guidance lives beside that form (`expense-document-review-hint-*`, which the
                button's aria-describedby already names). On a phone that box can be scrolled away while
                the disabled ถัดไป stays in this sticky bar, so below `lg` the short sentence is repeated
                here as plain text — not a second live region — so a disabled button always says why. */}
            {aiReading ? (
              <p role="status" className="max-w-lg text-sm font-medium text-warning-700 sm:w-full sm:text-right">
                {t('expenses.ai_reading', locale)}
              </p>
            ) : step === 'evidence' && evidenceStepBlocker && (documentReviewSaveRequired ? (
              <p className="max-w-lg text-sm font-medium text-warning-700 sm:w-full sm:text-right lg:hidden">
                {t(evidenceStepBlocker, locale)}
              </p>
            ) : (
              <p id={`expense-review-evidence-block-${detail.id}`} role="status" className="max-w-lg rounded-xl border border-warning-100 bg-warning-50 p-3 text-sm font-medium text-warning-700 sm:w-full sm:text-right">
                {t(evidenceStepBlocker, locale)}
              </p>
            ))}
          </>
        )}
        {approverOnlyActions && (
          <>
            {canConfirm && <button className={successBtn} style={successBtnStyle} onClick={() => void doConfirm()} disabled={actionLoading || !canConfirmExpense} aria-busy={Boolean(actionLoading)} title={confirmBlockedText ?? undefined}>{t('expenses.confirm_and_post', locale)}</button>}
            {confirmBlockedNotice}
          </>
        )}
        {isConfirmed && hasWht && whtLoading && <p role="status" className="w-full text-sm text-gray-600">กำลังตรวจเอกสาร 50 ทวิ…</p>}
        {isConfirmed && hasWht && whtIssueError && <div className="w-full"><ErrorBanner message={whtIssueError} /></div>}
        {canIssueExpenseWhtCertificate(detail, whtHandoff, permissions) && (
          <button type="button" className={btnClass} disabled={whtIssuing} aria-busy={whtIssuing} onClick={() => void doIssueWhtCertificate()}>
            {whtIssuing ? 'กำลังพิมพ์เอกสาร…' : t('wht.print_certificate', locale)}
          </button>
        )}
        {isConfirmed && hasWht && whtHandoff?.status === 'SYSTEM_ISSUED' && (
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
            {canDelete && <button className={dangerClass} onClick={() => { setShowDelete(true); setShowReject(false); setShowVoid(false); setDuplicateResolution(null); }} disabled={actionLoading || deleting}>{t('expenses.delete', locale)}</button>}
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
      {notice && (notice.tone === 'error' ? <ErrorBanner message={notice.message} /> : !aiMap && <InfoBanner message={notice.message} />)}
      {/* §17.6: the READ's own state, beside the file and persisted — not a toast that scrolls away.
          A terminal failure says the file is saved and points at this form; it offers no reread. */}
      {readNotice && (readNotice.tone === 'error'
        ? <ErrorBanner message={readNoticeText} />
        : <InfoBanner message={readNoticeText} />)}
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
      <ForeignCurrencyNotice summary={aiMap} />
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
                ? (postingErrorText(detail.postingError) || 'ลงบัญชีไม่สำเร็จ กรุณาแก้ไขเงื่อนไขแล้วลองอีกครั้ง')
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
  const auditCard = (
    <div ref={auditRef} className="scroll-mt-24">
      <MangmeeCard className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-800">{t('expenses.audit_section_title', locale)}</h3>
          <span className="text-xs text-gray-500">{t('expenses.audit_summary_pass', locale)} {auditPassCount} {t('expenses.audit_summary_unit', locale)} · {t('expenses.audit_summary_warn', locale)} {auditWarnCount} {t('expenses.audit_summary_unit', locale)}</span>
        </div>
        <div className="mt-2">
          {auditChecks.map((check) => (
            <div key={check.key} className="flex items-start gap-2.5 py-1.5 text-sm">
              <span className={cx('mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
                check.status === 'pass' ? 'bg-brand-50 text-brand-600' : check.status === 'warn' ? 'bg-warning-50 text-warning-700' : 'bg-gray-100 text-gray-500')}>
                {check.status === 'pass' ? '✓' : check.status === 'warn' ? '⚠' : 'ℹ'}
              </span>
              <div className="min-w-0">
                <div className={cx('font-medium', check.status === 'warn' ? 'text-warning-700' : 'text-gray-800')}>{check.label}</div>
                {check.detail && <div className="mt-0.5 text-xs text-gray-500">{check.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      </MangmeeCard>
    </div>
  );
  const calculationPending = currentPreview?.status === 'loading';
  const calculationError = currentPreview?.status === 'error';
  const moneyVatMode = currentPreview?.vatMode ?? detail.vatMode;
  const moneyHasVat = vatModeRequiresRate(moneyVatMode) || Number(money.vatAmount) > 0;
  const moneyHasWht = Number(money.whtAmount) > 0;
  const sumLines = (predicate: (line: ExpenseDetail['lines'][number]) => boolean) => detail.lines
    .filter(predicate).reduce((sum, line) => sum + Number(line.lineSubtotalAmount), 0);
  const automaticAdjustment = previewTotals ? Number(previewTotals.calculatedAdjustmentAmount) : sumLines(isCalculatedExpenseRounding);
  const chargesTotal = previewTotals ? Number(previewTotals.chargesTotalAmount)
    : sumLines((line) => !!line.chargeKind && line.chargeKind !== 'ROUNDING');
  const printedRounding = previewTotals ? Number(previewTotals.printedRoundingAmount)
    : sumLines((line) => line.chargeKind === 'ROUNDING' && !isCalculatedExpenseRounding(line));
  // The invisible precision residual belongs to the displayed goods subtotal, not to services.
  // Stored rows retain the exact evidence and the API still verifies their financial identity.
  const displayedSubtotal = (Number(money.subtotalAmount) + automaticAdjustment).toFixed(2);
  const moneyCard = (
    <div ref={moneyRef} className="scroll-mt-24">
      <MangmeeCard className="p-4">
        <h3 className="text-sm font-semibold text-gray-800">{t('expenses.money_section_title', locale)}</h3>
        {calculationPending || calculationError ? (
          <div role="status" aria-live="polite" className="mt-3 rounded-xl bg-gray-50 p-4 text-sm text-gray-600">
            {calculationPending ? 'กำลังคำนวณยอดล่าสุด…' : <>
              <p>ยังแสดงยอดล่าสุดไม่ได้: {currentPreview?.message || 'กรุณาตรวจข้อมูลแล้วลองอีกครั้ง'}</p>
              <button type="button" className={cx(ghostClass, 'mt-2')} onClick={() => setTotalsRetry((n) => n + 1)}>คำนวณอีกครั้ง</button>
            </>}
          </div>
        ) : financialTotalUnknown && !previewTotals ? (
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
          <div className="mt-2">
          <MoneyRow label={t('expenses.subtotal', locale)} value={displayedSubtotal} />
          {Number(money.discountAmount) > 0 && <MoneyRow label={t('expenses.discount', locale)} value={money.discountAmount} negative />}
          {/* Spec §5.1: the goods subtotal no longer includes the additional charges, so the column
              only adds up if they are shown — between the discount and the tax base, which is the
              order the arithmetic runs in (subtotal − discount + charges = base). */}
          {chargesTotal !== 0 && <MoneyRow label={t('expenses.charges_section', locale)} value={chargesTotal.toFixed(2)} />}
          {printedRounding !== 0 && <MoneyRow label="ปัดเศษตามใบเสร็จ" value={printedRounding.toFixed(2)} />}
          {moneyHasVat && <MoneyRow label={t('expenses.taxable_base_ex_vat', locale)} value={money.taxableAmount} muted />}
          {/* Spec §19g decision 3: mode + the rate the lines actually carry, so "VAT ฿0.00" can no
              longer sit under a label that claims 7%. */}
          {moneyHasVat && <>
            <MoneyRow label={<AiFieldLabel label={`${t('expenses.vat', locale)} (${expenseValueLabel(EXPENSE_VAT_MODE_LABELS, moneyVatMode, 'รอตรวจ VAT')}${!previewTotals && vatModeRequiresRate(detail.vatMode) ? ` · ${effectiveVatRateLabel(detail.lines.filter((line) => !isCalculatedExpenseRounding(line)))}` : ''})`} field="vatAmount" summary={previewTotals ? null : aiMap} />} value={money.vatAmount} />
            <AiFieldMissingHint canEdit={canMutateDraft && !readySourceDraftMessage} field="vatAmount" summary={previewTotals ? null : aiMap} />
          </>}
          <div className="mt-1 flex flex-wrap items-center justify-between border-t border-dashed border-gray-200 py-3">
            <span className="text-sm font-semibold text-gray-700"><AiFieldLabel label={t('expenses.grand_total', locale)} field="total" summary={previewTotals ? null : aiMap} /></span>
            <span className="tabular-nums text-2xl font-black text-gray-900">{baht(money.grandTotalAmount)}</span>
          </div>
          <AiFieldMissingHint canEdit={canMutateDraft && !readySourceDraftMessage} field="total" summary={previewTotals ? null : aiMap} />
          {moneyHasWht && (
            <div className="flex flex-wrap items-center justify-between py-1.5 text-sm">
              <span className="text-gray-500">{t('expenses.wht', locale)}</span>
              <span className="tabular-nums font-semibold text-error-500">- {baht(money.whtAmount)}</span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
            <div>
              <div className="text-xs font-semibold text-brand-700">{t(moneyHasWht ? 'expenses.amount_due_after_wht' : 'expenses.amount_due', locale)}</div>
              <div className="mt-1">{overpaidAmount ? <MangmeeBadge tone="danger">{EXPENSE_CORRECTION_WORDS.overpaid}</MangmeeBadge> : detail.reimbursementProgress ? <span>{expenseReimbursementProgressLabel(detail.reimbursementProgress)}</span> : <StatusBadge status={detail.paymentStatus} />}</div>
            </div>
            <div className="text-right">
              <div className="tabular-nums text-2xl font-black text-brand-700">{baht(money.outstandingAmount)}</div>
              {Number(detail.paidAmount) > 0 && <div className="tabular-nums text-xs text-gray-500">{t('expenses.paid_prefix', locale)} {baht(detail.paidAmount)}</div>}
            </div>
          </div>
          </div>
        </>}
      </MangmeeCard>
    </div>
  );
  const vendorCard = (
    <div ref={vendorRef} className="scroll-mt-24" tabIndex={-1}>
      <ExpenseReviewEditSection companyId={companyId} detail={detail} permissions={permissions} isMutable={canMutateDraft && !readySourceDraftMessage} canReview={canReview} canConfirm={canConfirm} showSaveDraft={step === 'data'} saveRef={reviewSaveRef} vatOverrideRef={vatOverrideRef} onValidationChange={onDataValidationChange} onTotalsChange={setReviewTotals} totalsRetry={totalsRetry} onSaved={async () => { setDetail(await getExpense(companyId, expenseId)); onRefresh(); }} />
    </div>
  );
  // Vendor-address Slice 2, review fix 1: on a tax-code invoice the way forward is the line's Tax
  // Code on step 1 — the same scroll-and-focus the ถัดไป blocker uses to reach an invalid field.
  const openReviewLines = () => {
    void goToStep('data').then(() => window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const section = vendorRef.current;
      const target = section?.querySelector<HTMLElement>('[data-testid="transaction-tax-selector"]') ?? section;
      target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      target?.querySelector<HTMLElement>('[role="combobox"]')?.focus({ preventScroll: true });
    })));
  };
  const documentReviewCard = (
    <>
      {/* Vendor-address §8 Slice 2: sits with the document and tax-evidence decisions it informs. */}
      <BuyerMatchBanner companyId={companyId} detail={detail} editable={isMutable} claimed={claimedSource} permissions={permissions} onSaved={load} onOpenLines={openReviewLines} />
      <DocumentReviewSection
        companyId={companyId}
        detail={detail}
        isMutable={isMutable}
        canReview={canReview}
        onSaved={async () => { setNotice(null); await load(); await onRefresh(); }}
        onAttachPrimaryReceipt={canMutateDraft ? (file) => attachPrimaryReceipt(file, detail.branchId) : undefined}
        receiptUploading={receiptUploading}
        onDirtyChange={setEvidenceDirty}
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
            }, 'ยอมรับยอดเรียบร้อยแล้ว')}
          >
            {t('expenses.price_mismatch_accept', locale).replace('{amount}', baht(detail.grandTotalAmount))}
          </button>
        </div>
      )}
    </div>
  );
  const aiDataBox = aiMap && (
    <div className="space-y-2 rounded-xl border border-[#C7D7FE] bg-[#EEF4FF] p-3 text-xs text-[#3538CD]">
      <p className="font-semibold">{t('expenses.ai_data_title', locale)}</p>
      <p>{t('expenses.status_label', locale)}: {expenseValueLabel(AI_SUMMARY_STATUS_LABELS, typeof aiMap['status'] === 'string' ? aiMap['status'] : null, 'รอตรวจสอบข้อมูล')}</p>
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
  const aiPrefillBanner = aiMap && (
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
      {/* Spec §5.1/§5.2: the server's own words for what it could not decide — an unread date, a
          charge whose VAT nothing proved, a withholding base worth checking. These are the reasons
          behind the flags above, and without them the reviewer sees a warning with no cause. */}
      {(Array.isArray(aiMap?.['reviewReasons']) ? aiMap['reviewReasons'] : [])
        .filter((reason): reason is string => typeof reason === 'string')
        .slice(0, 4)
        .map((reason, index) => (
          <span key={`reason-${index}`} className="rounded-full border border-warning-100 bg-warning-50 px-2 py-0.5 font-medium text-warning-700">
            {reason}
          </span>
        ))}
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
  const duplicateCandidateLabel = (candidate: ExpenseDetail['duplicateCandidates'][number]) => [
    candidate.candidateExpenseNumber || candidate.candidateExpenseId.slice(-8),
    candidate.candidateVendorName,
    candidate.candidateExpenseDate ? dateShort(candidate.candidateExpenseDate) : null,
    candidate.candidateGrandTotalAmount ? baht(candidate.candidateGrandTotalAmount) : null,
  ].filter(Boolean).join(' · ');
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
              {duplicateCandidateLabel(candidate)} ({t('expenses.score_label', locale)} {candidate.score})
            </Link>
            {duplicateReasonText(candidate) && <span className="text-gray-500">{duplicateReasonText(candidate)}</span>}
          </span>
          <span className="font-semibold text-error-700">{t('expenses.duplicate_confirmed_title', locale)}</span>
        </div>
      ))}
      {openDuplicateCandidates.map((d, index) => (
        <div key={d.id} className="flex flex-col items-start gap-1.5 rounded-lg bg-white px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span className="flex flex-col gap-0.5">
            <Link className="tabular-nums font-medium text-brand-700 underline" href={`/companies/${companyId}/expenses/${d.candidateExpenseId}`} target="_blank">
              {t('expenses.item_label', locale)} {index + 1} · {duplicateCandidateLabel(d)} ({t('expenses.score_label', locale)} {d.score})
            </Link>
            {duplicateReasonText(d) && <span className="text-gray-500">{duplicateReasonText(d)}</span>}
          </span>
          {caps.canResolveDuplicates && <span className="flex gap-3">
            <button className="py-1 sm:py-0 font-semibold text-success-700 underline" onClick={() => { setReason(''); setShowReject(false); setShowVoid(false); setDuplicateResolution({ candidateId: d.id, action: 'confirm' }); }} disabled={actionLoading}>{t('expenses.confirm_duplicate', locale)}</button>
            <button className="py-1 sm:py-0 font-semibold text-warning-700 underline" onClick={() => { setReason(''); setShowReject(false); setShowVoid(false); setDuplicateResolution({ candidateId: d.id, action: 'dismiss' }); }} disabled={actionLoading}>{t('expenses.not_duplicate', locale)}</button>
          </span>}
        </div>
      ))}
    </MangmeeCard>
  );
  const paymentHistory = (detail.payments?.length ?? 0) > 0 && (
    <div className="space-y-2 border-t border-gray-100 pt-3" data-testid="expense-payment-history">
      <p className="text-xs font-semibold text-gray-600">ประวัติการจ่าย</p>
      {detail.payments?.map((payment) => {
        const paymentCapability = detail.correctionCapabilities?.payments.find((item) => item.id === payment.id);
        const cancelled = payment.status === 'VOIDED';
        return (
          <div key={payment.id} className={cx('grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 rounded-lg border p-3 text-xs', cancelled ? 'border-gray-100 bg-gray-50 text-gray-400' : 'border-gray-200 text-gray-600')}>
            <span className={cancelled ? 'line-through' : undefined}>{dateShort(payment.paidAt)} · {PAYMENT_METHOD_LABELS[payment.paymentMethod ?? 'OTHER']}</span>
            <span className={cx('text-right tabular-nums font-semibold', cancelled ? 'line-through' : 'text-gray-800')}>{baht(payment.amount)}</span>
            {cancelled && <div className="col-span-2 space-y-1"><MangmeeBadge tone="slate">ยกเลิกแล้ว</MangmeeBadge>{payment.cancellationReason && <p>{payment.cancellationReason}</p>}</div>}
            {!cancelled && caps.canReadLedger && <span className="col-span-2">{expenseValueLabel(POSTING_STATUS_LABELS, payment.postingStatus, 'รอตรวจสถานะบัญชี')}</span>}
            {!cancelled && paymentCapability?.canCancel && <button type="button" className={cx(ghostClass, 'col-span-2 justify-self-start whitespace-nowrap')} disabled={actionLoading || Boolean(paymentFailure)} aria-busy={actionLoading} onClick={() => { setCorrectionReason(''); setCorrectionError(null); setCorrectionAction({ paymentId: payment.id }); }}>{EXPENSE_CORRECTION_WORDS.cancelPayment}</button>}
            {!cancelled && paymentCapability?.cancelBlocker && <p className="col-span-2">{expenseCorrectionBlockerMessage(paymentCapability.cancelBlocker, 'cancelPayment', detail.correctionCapabilities, caps.canReadLedger)}</p>}
          </div>
        );
      })}
    </div>
  );
  const paymentCard = (
    <div ref={paymentRef} className="scroll-mt-24">
      <MangmeeCard className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-gray-800">{t('expenses.payment_section_title', locale)}</h3>
        {personalSubstitute && <p className="text-sm text-gray-600">{detail.reimbursementProgress?.requestId ? `สถานะใบเบิก: ${expenseReimbursementProgressLabel(detail.reimbursementProgress)} · ดูการจ่ายและประวัติจากใบเบิกคืน` : "พนักงานจ่ายร้านเต็มจำนวนแล้ว ยื่นใบเบิกเพื่อดำเนินการคืนเงิน"}</p>}
        {Boolean(detail.sourceReimbursementRequestId) && (
          <p className="text-sm text-gray-500">
            รายการนี้มาจากการเบิกคืนพนักงาน{detail.vendorDocumentNumber ? ` (ใบเบิก ${detail.vendorDocumentNumber})` : ''} — ระบบบันทึกการชำระให้อัตโนมัติเมื่อมีการบันทึกจ่ายใบเบิก
          </p>
        )}
        {(detail.correctionCapabilities?.canRecordPayment || Boolean(paymentAttemptRef.current)) && (
          <form onSubmit={(event) => { event.preventDefault(); void submitPayment(); }} className="space-y-3">
            <fieldset disabled={actionLoading} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm text-gray-700">
                <span>{t('expenses.payment_amount', locale)}</span>
                <input className={inputClass} type="number" inputMode="decimal" min="0.01" step="0.01" required placeholder="0.00" value={paidAmount} onChange={(e) => editPayment(() => setPaidAmount(e.target.value))} />
              </label>
              <label className="space-y-1 text-sm text-gray-700">
                <span>วิธีจ่ายเงิน</span>
                <ThemedSelect aria-label="วิธีจ่ายเงิน" className={inputClass} value={paymentMethod} disabled={actionLoading} onChange={(e) => editPayment(() => setPaymentMethod(e.target.value as ExpensePaymentMethod))}>
                  {Object.entries(PAYMENT_METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </ThemedSelect>
              </label>
              <div className="space-y-1 text-sm text-gray-700">
                <label htmlFor="expense-payment-paid-at">วันที่จ่ายเงินจริง</label>
                <ThemedDate id="expense-payment-paid-at" name="paidAt" className={inputClass} value={paidAt} max={paymentForm.maxPaidAt} required disabled={actionLoading} onChange={(e) => editPayment(() => setPaidAt(e.target.value))} />
              </div>
            </fieldset>
            <p className="text-sm text-gray-500">เลือกวันที่จ่ายเงินจริง แม้จะนำมาบันทึกภายหลัง · ยอดค้างจ่าย {baht(detail.outstandingAmount)}</p>
            {paymentForm.disabledReason && <p role="status" className="text-sm text-warning-700">{paymentForm.disabledReason}</p>}
            <button type="submit" className={cx(btnClass, 'w-full sm:w-auto')} disabled={actionLoading || conflictReload || paymentFailure === 'conflict' || Boolean(paymentForm.disabledReason)} aria-busy={Boolean(actionLoading)}>{actionLoading ? EXPENSE_CORRECTION_WORDS.saving : paymentFailure === 'conflict' ? 'กรุณาตรวจประวัติการจ่าย' : paymentFailure === 'uncertain' || paymentFailure === 'refresh_failed' ? 'ลองบันทึกรายการเดิมอีกครั้ง' : paymentForm.label}</button>
          </form>
        )}
        {isConfirmed && detail.correctionCapabilities?.recordPaymentBlocker && detail.correctionCapabilities.recordPaymentBlocker !== 'no_balance' && (
          <p className="text-sm text-gray-600">{expenseCorrectionBlockerMessage(detail.correctionCapabilities.recordPaymentBlocker, 'recordPayment', detail.correctionCapabilities, caps.canReadLedger)}</p>
        )}
        {paymentNotice && <p role="status" className="rounded-xl bg-warning-50 p-3 text-sm text-warning-800">{paymentNotice}</p>}
        {paymentHistory}
        {detail.status === 'VOIDED' && <p className="text-sm text-gray-400">{t('expenses.document_voided', locale)}{detail.voidReason ? ` — ${detail.voidReason}` : ''}</p>}
        {detail.paidAt && <p className="text-xs text-gray-400">{t('expenses.paid_at', locale)} {dateShort(detail.paidAt)}</p>}
        {detail.confirmedAt && <p className="text-xs text-gray-400">{t('expenses.confirmed_at', locale)} {dateShort(detail.confirmedAt)}</p>}
        {detail.rejectedAt && <p className="text-xs text-error-500">{t('expenses.rejected_at', locale)} {dateShort(detail.rejectedAt)}: {detail.rejectReason}</p>}
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
  const replaceReceiptControl = receiptFileInput(t('expenses.replace_receipt', locale));
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

  return (
    <>
      {confirmDialog}
      <MangmeePage eyebrow={backLink} title={pageTitle} meta={pageMeta}>
        {error && !showReject && !correctionAction && <ErrorBanner message={error} />}
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

        {isConfirmed && <div className="space-y-2 rounded-xl border border-gray-200 p-4" data-testid="expense-correction-actions">
          <p className="text-sm text-gray-600">{expenseConfirmedLockMessage(detail.correctionCapabilities, hasPaymentHistory)}</p>
          {!detail.correctionCapabilities?.canReopen && <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">{expenseReopenBlockerMessages(detail.correctionCapabilities, caps.canReadLedger).map(message => <li key={message}>{message}</li>)}</ul>}
          {detail.correctionCapabilities?.canReopen && <button type="button" className={cx(ghostClass, 'whitespace-nowrap')} disabled={actionLoading} onClick={() => { setCorrectionReason(''); setCorrectionError(null); setCorrectionAction({}); }}>{EXPENSE_CORRECTION_WORDS.reopen}</button>}
        </div>}
        {paymentNotice && !isConfirmed && <p role="status" className="text-sm text-warning-800">{paymentNotice}</p>}
        {!sourceOnlyDraft && <div className="sticky z-10 flex flex-wrap gap-1.5 border-b border-gray-100 bg-white px-4 py-2.5" style={{ top: `${APP_HEADER_REM}rem` }}>
          {isMutable && detail.correctionOpenedAt && <p role="status" className="h-5 w-full whitespace-nowrap text-xs font-semibold leading-5 text-warning-800">{EXPENSE_CORRECTION_WORDS.correcting}</p>}
          {guided ? (
            <ThemedSteps steps={steps.map((entry, index) => ({
              key: entry.key,
              label: t(STEP_LABEL_KEYS[entry.key], locale),
              // Position decides the color (สรรพากร-style): green up to where the user
              // stands, gray past it — stepping back grays the steps ahead again.
              // Owner 2026-08-29: the stepper says ORDER and nothing else — never swap a
              // number for a warning icon (a ⚠ replacing "3" read as a broken stage, not
              // as "duplicates pending"). Issues speak where they live: the duplicate
              // chips/panel and the blocking banners. Display-only on purpose: navigation
              // goes through ถัดไป/ย้อนกลับ.
              state: step === entry.key ? 'current'
                : index < stepIndex ? 'done' : 'upcoming',
            }))} />
          ) : navChips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => chip.ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-brand-200 hover:text-brand-700">
              {t(chip.key, locale)}
            </button>
          ))}
        </div>}
        {guided && (
          <div className="border-b border-gray-100 bg-brand-25 px-4 py-2.5 text-sm text-gray-700">
            <span className="font-bold text-brand-700">ขั้นที่ {stepIndex + 1}:</span>{' '}
            {t(STEP_HELPER_KEYS[step], locale)}
          </div>
        )}

        {detail.substituteReceiptEvidence && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 bg-brand-25 px-4 py-3 text-sm">
            <div>
              <p className="font-bold text-brand-800">ผูกกับใบแทน {detail.substituteReceiptEvidence.documentNumber}</p>
              <p className="text-gray-600">{canEditSubstituteReceipt(detail, detail.substituteReceiptEvidence) ? 'แก้ข้อมูลแล้วใช้ฟอร์มล่าสุด หากลงนามแล้วต้องลงนามอีกครั้ง' : 'หากต้องการแก้ข้อมูลในใบแทน ให้ตรวจขั้นตอนยกเลิกและรายการจ่ายที่เกี่ยวข้องก่อน'}</p>
              {evidenceDirty && <p className="text-warning-700">บันทึกการตรวจเอกสารก่อนกลับไปใบแทน</p>}
            </div>
            {!canEditLinkedSubstitute && <button type="button" className={ghostClass} disabled={aiReading || stepSaving || evidenceDirty} aria-busy={Boolean(stepSaving)} onClick={() => void openSubstituteReceipt()}>
              เปิดใบแทนใบเสร็จ
            </button>}
          </div>
        )}
        <div className="grid min-h-0 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
            {/* left pane (lg+): inline document viewer */}
            <div
              className="hidden min-h-0 border-r border-gray-100 bg-gray-50 lg:sticky lg:flex lg:self-start lg:flex-col"
              style={{ top: `${viewerTopRem}rem`, height: `calc(100dvh - ${viewerTopRem + VIEWER_BOTTOM_GAP_REM}rem)` }}
            >
              {attachments.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-gray-100 text-2xl">🧾</span>
                  <p className="text-sm text-gray-500">{t('expenses.viewer_empty', locale)}</p>
                  {attachReceiptControl}
                  {canStartSubstitute && needsReceiptOrSubstitute && (
                    <>
                      <Link className={ghostClass} href={substituteAction.href} aria-disabled={aiReading || stepSaving || evidenceDirty} onClick={(event) => { event.preventDefault(); void openSubstituteReceipt(); }}>{t(substituteAction.labelKey, locale)}</Link>
                      {evidenceDirty && <p className="text-xs text-warning-700">บันทึกการตรวจเอกสารก่อนดำเนินการใบรับรองแทนใบเสร็จ</p>}
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-white px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-800">{activeAttachment?.originalFileName}</div>
                      <div className="text-xs text-gray-500">{activeAttachment && isWetSignedScanAttachment(activeAttachment.id, detail.substituteReceiptEvidence)
                        ? t('expenses.attachment.wet_signed_scan', locale)
                        : activeAttachment?.isHistorical ? 'ประวัติเอกสารที่ยกเลิก/แทนที่' : expenseValueLabel(ATTACHMENT_PURPOSE_LABELS, activeAttachment?.purpose, 'เอกสารแนบ')}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Owner 2026-08-28: "เผื่ออัพโหลดผิด". Re-uploading has always worked on the server —
                          the newest primary upload becomes the receipt — but the control was rendered only
                          while there were zero attachments, so a wrong file could never be corrected here. */}
                      {replaceReceiptControl}
                      {appendEvidenceControl}
                      {removeReceiptControl(activeAttachment)}
                      {attachments.length > 1 && (
                        <>
                          <button type="button" className={ghostClass} onClick={() => setViewerIndex(Math.max(0, safeViewerIndex - 1))} disabled={safeViewerIndex <= 0} aria-label={t('expenses.viewer_prev', locale)}>‹</button>
                          <span className="tabular-nums text-xs text-gray-500">{safeViewerIndex + 1}/{attachments.length}</span>
                          <button type="button" className={ghostClass} onClick={() => setViewerIndex(Math.min(attachments.length - 1, safeViewerIndex + 1))} disabled={safeViewerIndex >= attachments.length - 1} aria-label={t('expenses.viewer_next', locale)}>›</button>
                        </>
                      )}
                      <button type="button" className={ghostClass} onClick={reloadViewerUrl} aria-label={t('expenses.viewer_reload', locale)} title={t('expenses.viewer_reload', locale)}>↻</button>
                      {activeAttachment && <button type="button" className={ghostClass} onClick={() => void openPreview(activeAttachment)} disabled={previewLoading} aria-busy={Boolean(previewLoading)}>{previewLoading ? t('expenses.opening', locale) : t('expenses.viewer_fullscreen', locale)}</button>}
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-3">
                    {viewerError ? <ErrorBanner message={viewerError} />
                      : !activeViewerUrl ? <p className="py-10 text-center text-sm text-gray-500">{t('expenses.loading', locale)}</p>
                        : activeAttachment?.mimeType.startsWith('image/') ? <img src={activeViewerUrl} alt={activeAttachment.originalFileName} onError={retryViewerUrl} className="mx-auto max-w-full rounded-lg bg-white" />
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
                <div className={cx('flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50 px-5 py-3 lg:hidden', checkBillBlocked && 'order-2')}>
                  <span className="text-sm text-gray-500">{t('expenses.viewer_empty', locale)}</span>
                  {attachReceiptControl}
                </div>
              )}
              {attachments.length > 0 && (
                <div className={cx('border-b border-gray-100 bg-gray-50 lg:hidden', checkBillBlocked && 'order-2')}>
                  {/* The phone is where receipts are actually reviewed, so the "wrong file" fix has to be
                      here too — the desktop viewer header alone would have left mobile with no way out. */}
                  {replaceReceiptControl && (
                    <div className="flex flex-wrap justify-end gap-2 border-b border-gray-100 px-5 py-2">
                      {replaceReceiptControl}
                      {appendEvidenceControl}
                    </div>
                  )}
                  {attachments.map((attachment) => (
                    <div key={`${attachment.id}:${attachment.purpose}`} className="flex items-center gap-2 border-b border-gray-100 pr-5 last:border-b-0">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-5 text-left hover:bg-gray-100 disabled:opacity-60"
                      onClick={() => void openPreview(attachment)}
                      disabled={previewLoading} aria-busy={Boolean(previewLoading)}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-[9px]" style={{ background: '#E0F2FE', color: '#0BA5EC' }}>{ICON.file}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-gray-800">{attachment.originalFileName}</div>
                        <div className="text-xs text-gray-500">{isWetSignedScanAttachment(attachment.id, detail.substituteReceiptEvidence)
                          ? t('expenses.attachment.wet_signed_scan', locale)
                          : attachment.isHistorical ? 'ประวัติเอกสารที่ยกเลิก/แทนที่' : expenseValueLabel(ATTACHMENT_PURPOSE_LABELS, attachment.purpose, 'เอกสารแนบ')} · {expenseValueLabel(MIME_TYPE_LABELS, attachment.mimeType, 'ไฟล์เอกสาร')}</div>
                      </div>
                      <span className="flex-shrink-0 text-xs font-semibold text-brand-600">{previewLoading ? t('expenses.opening', locale) : t('expenses.view_file', locale)}</span>
                    </button>

                    {removeReceiptControl(attachment)}
                    </div>
                  ))}
                </div>
              )}

              <div className={cx('relative p-4', checkBillBlocked && 'order-1')} data-testid="expense-review-form">
                {/* Keep the form mounted while toggling the cover; inert also locks custom selectors. */}
                <fieldset disabled={aiReading} inert={aiReading} aria-busy={aiReading} className="min-w-0 space-y-4">
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
                  </>
                ) : guided ? (
                  <>
                    <div className={cx('space-y-4', step === 'data' ? undefined : 'hidden')}>
                        <div className="space-y-4">
                          {noticesBlock}
                          {aiPrefillBanner}
                          {!aiMap && step === 'data' && readAgainAllowed && (
                            <button className={ghostClass} onClick={() => void extractAgain()} disabled={actionLoading || extractionLoading || receiptUploading} aria-busy={Boolean(actionLoading || extractionLoading)} data-loading-indicator>
                              <span className="inline-flex items-center justify-center gap-2">
                                {extractionLoading && <InlineSpinner />}
                                {extractionLoading ? t('expenses.ai_reading', locale) : t('expenses.extract_again', locale)}
                              </span>
                            </button>
                          )}
                        </div>

                      {vendorCard}
                      {moneyCard}
                    </div>
                    <div className={cx('space-y-4', step === 'evidence' ? undefined : 'hidden')}>
                      {documentReviewCard}
                      {priceMismatchWarning}
                    </div>
                    <div className={cx('space-y-4', step === 'review' ? undefined : 'hidden')}>
                      {auditCard}
                      {duplicatesCard}
                    </div>
                    {(paymentHistory || overpaymentMessage) && <MangmeeCard className="p-4">{overpaymentMessage && <p role="status" className="mb-3 text-sm text-error-700">{overpaymentMessage}</p>}{paymentHistory}</MangmeeCard>}
                  </>
                ) : (
                  <>
                    {noticesBlock}
                    {postingCard}
                    {auditCard}
                    {moneyCard}
                    {vendorCard}
                    {/* tax evidence and documents (+ AI info, notices, duplicates — logic unchanged) */}
                    <div ref={documentsRef} className="scroll-mt-24 space-y-4">
                      {documentReviewCard}
                      {priceMismatchWarning}
                      {aiDataBox}
                      {duplicatesCard}
                    </div>
                    {paymentCard}
                    {issuedCertificateActions}
                  </>
                )}
                </fieldset>
                {aiReading && (
                  <div className="absolute inset-0 z-10 bg-white/80">
                    {/* A long receipt form must not put its only spinner below the viewport. */}
                    <div className="sticky h-40 [&>div]:bg-transparent" style={{ top: `${viewerTopRem}rem` }}>
                      <CoverLoader active scope="section" label={t('expenses.ai_reading', locale)} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        {checkBillSecondaryActions}

        {((!checkBillBlocked && (modalFooter || confirmBlockers)) || showVoid || showDelete || duplicateResolution) && (
          <div className="mangmee-safe-bottom sticky bottom-0 z-10 border-t bg-white">
            {(showVoid || showDelete || duplicateResolution || confirmBlockers) && (
              <div className="space-y-2 px-4 py-3">
              {canMutateDraft && classificationBlocked && <p className={warnNoteClass}>{classificationBlockMessage}</p>}
              {canMutateDraft && detail.status === 'READY_FOR_CONFIRMATION' && isZeroAmount && <p className={warnNoteClass}>{t('expenses.zero_amount_warning', locale)}</p>}
              {canMutateDraft && detail.status === 'READY_FOR_CONFIRMATION' && hasDuplicates && <p className="text-xs font-semibold text-warning-700">{duplicateBlockMessage}</p>}
              {showVoid && (
                <>
                  <div className="text-sm font-medium text-gray-700">{t('expenses.void_reason', locale)}</div>
                  <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(sanitizeReasonInput(e.target.value))} maxLength={REASON_MAX_LENGTH} />
                  <div className="text-right text-xs text-gray-400 tabular-nums">{reason.length}/500</div>
                  <div className="flex gap-2">
                    <button className={successBtn} style={successBtnStyle} onClick={() => {
                      const forbidden = findForbiddenChars(reason);
                      if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
                      // Close the reason box on success like the duplicate branch below: leaving it open
                      // reads as "nothing happened" and a second click hits the already-rejected record.
                      void doAction(async () => {
                        await voidExpense(companyId, expenseId, reason.trim());
                        setShowVoid(false); setReason('');
                      }, 'ยกเลิกเอกสารเรียบร้อยแล้ว');
                    }} disabled={actionLoading || !reason.trim()} aria-busy={Boolean(actionLoading)}>{t('expenses.confirm', locale)}</button>
                    <button className={ghostClass} onClick={() => { setShowVoid(false); setReason(''); }}>{t('expenses.cancel', locale)}</button>
                  </div>
                </>
              )}
              {showDelete && (
                <>
                  <div className="text-sm font-medium text-gray-700">{t('expenses.delete_confirm_note', locale)}</div>
                  <div className="flex gap-2">
                    <button className={dangerClass} onClick={() => void removeExpense()} disabled={deleting} aria-busy={Boolean(deleting)}>{deleting ? t('expenses.deleting', locale) : t('expenses.delete_permanently', locale)}</button>
                    <button className={ghostClass} onClick={() => setShowDelete(false)} disabled={deleting}>{t('expenses.cancel', locale)}</button>
                  </div>
                </>
              )}
              {duplicateResolution && (
                <>
                  <div className="text-sm font-medium text-gray-700">{t('expenses.duplicate_resolution_reason', locale)}</div>
                  <textarea className={inputClass} rows={2} value={reason} onChange={(e) => setReason(sanitizeReasonInput(e.target.value))} maxLength={REASON_MAX_LENGTH} />
                  <div className="text-right text-xs text-gray-400 tabular-nums">{reason.length}/500</div>
                  <div className="flex gap-2">
                    <button className={successBtn} style={successBtnStyle} onClick={() => {
                      const cleanReason = reason.trim();
                      const forbidden = findForbiddenChars(cleanReason);
                      if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
                      void doAction(async () => {
                        if (duplicateResolution.action === 'confirm') await confirmDuplicate(companyId, expenseId, duplicateResolution.candidateId, cleanReason);
                        else await dismissDuplicate(companyId, expenseId, duplicateResolution.candidateId, cleanReason);
                        setDuplicateResolution(null); setReason('');
                      }, duplicateResolution.action === 'confirm' ? 'ยืนยันรายการซ้ำเรียบร้อยแล้ว' : 'ยืนยันว่าไม่ใช่รายการซ้ำเรียบร้อยแล้ว');
                    }} disabled={actionLoading || reason.trim().length < 3} aria-busy={Boolean(actionLoading)}>{t('expenses.confirm', locale)}</button>
                    <button className={ghostClass} onClick={() => { setDuplicateResolution(null); setReason(''); }}>{t('expenses.cancel', locale)}</button>
                  </div>
                </>
              )}
              </div>
            )}
            {!checkBillBlocked && modalFooter && <div className="px-4 py-3">{modalFooter}</div>}
          </div>
        )}
      </MangmeePage>

      <Modal open={Boolean(correctionAction)} title={correctionAction?.paymentId ? EXPENSE_CORRECTION_WORDS.cancelPayment : EXPENSE_CORRECTION_WORDS.reopen}
        size="sm" closeLabel={t('expenses.close', 'th')} onClose={() => { if (!actionLoading) setCorrectionAction(null); }}
        footer={<>
          <button type="button" className={cx(ghostClass, 'w-full sm:w-auto whitespace-nowrap')} disabled={actionLoading} onClick={() => setCorrectionAction(null)}>{t('expenses.cancel', 'th')}</button>
          {correctionAllowed && <button type="submit" form="expense-correction-form" className={cx(correctionAction?.paymentId ? dangerClass : btnClass, 'w-full sm:w-auto whitespace-nowrap')} disabled={actionLoading || conflictReload || correctionReason.trim().length < 3} aria-busy={actionLoading}>{actionLoading ? EXPENSE_CORRECTION_WORDS.saving : correctionAction?.paymentId ? EXPENSE_CORRECTION_WORDS.cancelPayment : EXPENSE_CORRECTION_WORDS.reopenSubmit}</button>}
        </>}>
        {correctionAllowed ? <form id="expense-correction-form" className="space-y-3" onSubmit={(event) => {
          event.preventDefault();
          if (!correctionAction || !correctionAllowed || conflictReload || correctionReason.trim().length < 3 || findForbiddenChars(correctionReason).length) return;
          const paymentId = correctionAction.paymentId;
          setActionLoading(true); setCorrectionError(null);
          void (async () => {
            try {
              if (paymentId) await cancelExpensePayment(companyId, expenseId, paymentId, correctionReason.trim());
              else await reopenExpense(companyId, expenseId, correctionReason.trim());
              setDetail(await getExpense(companyId, expenseId));
              setCorrectionAction(null); setCorrectionReason('');
              paymentAttemptRef.current = null; setPaymentFailure(null); setPaymentNotice(null);
              if (!paymentId) setStep('data');
              toast.success(paymentId ? EXPENSE_CORRECTION_WORDS.paymentCancelled : expenseReopenedMessage(hasPaymentHistory));
            } catch (cause) { setCorrectionError(await refreshChangedDocument(cause, 'correction') ?? err(cause)); }
            finally { setActionLoading(false); }
          })();
        }}>
          {correctionAction?.paymentId ? (() => {
            const payment = detail.payments?.find(p => p.id === correctionAction.paymentId);
            return payment && <p className="text-sm text-gray-700">{baht(payment.amount)} · {dateShort(payment.paidAt)} · {PAYMENT_METHOD_LABELS[payment.paymentMethod ?? 'OTHER']}</p>;
          })() : <p className="text-sm text-gray-700">{EXPENSE_CORRECTION_WORDS.reopenDescription}{hasPaymentHistory ? ` ${EXPENSE_CORRECTION_WORDS.retainedPayments}` : ''}</p>}
          {correctionError && <ErrorBanner message={correctionError} />}
          <label className="block text-sm" htmlFor="expense-correction-reason">{correctionAction?.paymentId ? EXPENSE_CORRECTION_WORDS.cancelReason : EXPENSE_CORRECTION_WORDS.reason}</label>
          <textarea ref={correctionReasonRef} autoFocus id="expense-correction-reason" className={inputClass} rows={3} value={correctionReason} required minLength={3} maxLength={REASON_MAX_LENGTH} disabled={actionLoading} onChange={(event) => setCorrectionReason(sanitizeReasonInput(event.target.value))} />
          {correctionReason.trim().length < 3 && <p className="text-sm text-gray-600">{EXPENSE_CORRECTION_WORDS.reasonRequired}</p>}
        </form> : <ErrorBanner message={correctionError ?? EXPENSE_CORRECTION_WORDS.unavailable} />}
      </Modal>
      <Modal
        open={showReject && !correctionAction}
        title={detail.correctionCapabilities?.canReject === true ? t('expenses.reject_confirm_title', locale) : EXPENSE_CORRECTION_WORDS.reject}
        size="sm"
        closeLabel={t('expenses.close', locale)}
        onClose={closeReject}
        footer={detail.correctionCapabilities?.canReject === true ? (
          <>
            <button type="button" className={cx(ghostClass, 'w-full sm:w-auto whitespace-nowrap')} onClick={closeReject} disabled={actionLoading} aria-busy={Boolean(actionLoading)}>
              {t('expenses.reject_stay', locale)}
            </button>
            <button type="button" className={cx(dangerClass, 'w-full sm:w-auto whitespace-nowrap')} onClick={() => {
              const cleanReason = reason.trim();
              const forbidden = findForbiddenChars(cleanReason);
              if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
              void doAction(async () => {
                await rejectExpense(companyId, expenseId, cleanReason);
                setShowReject(false); setReason('');
              }, t('expenses.reject_success', locale));
            }} disabled={actionLoading || !reason.trim() || detail.correctionCapabilities?.canReject !== true} aria-busy={Boolean(actionLoading)}>
              {actionLoading ? t('expenses.rejecting', locale) : EXPENSE_CORRECTION_WORDS.reject}
            </button>
          </>
        ) : <button type="button" className={cx(ghostClass, 'w-full sm:w-auto whitespace-nowrap')} onClick={closeReject}>{t('expenses.close', locale)}</button>}
      >
        <div className="space-y-3">
          {detail.correctionCapabilities?.canReject === true && <p className="text-sm leading-6 text-gray-600">{t('expenses.reject_confirm_description', locale)}</p>}
          {detail.correctionCapabilities?.canReject === undefined && <p role="status" className="text-sm text-gray-600">{EXPENSE_CORRECTION_WORDS.unavailable}</p>}
          {detail.correctionCapabilities?.rejectBlocker && <>
            <p role="status" className="text-sm text-gray-600">{expenseCorrectionBlockerMessage(detail.correctionCapabilities.rejectBlocker, 'reject', detail.correctionCapabilities)}</p>
          </>}
          {paymentHistory}
          {error && <ErrorBanner message={error} />}
          {detail.correctionCapabilities?.canReject === true && <><label className="block text-sm font-medium text-gray-700">
            {t('expenses.reject_reason', locale)} <span className="text-error-600" aria-hidden>*</span>
            <textarea
              ref={rejectReasonRef} autoFocus className={cx(inputClass, 'mt-1 min-h-28 resize-y')}
              rows={4}
              required
              disabled={actionLoading}
              value={reason}
              onChange={(event) => setReason(sanitizeReasonInput(event.target.value))}
              maxLength={REASON_MAX_LENGTH}
              placeholder={t('expenses.reject_reason_placeholder', locale)}
            />
          </label>
          <div className="text-right text-xs text-gray-400 tabular-nums">{reason.length}/{REASON_MAX_LENGTH}</div></>}
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
    </>
  );
}
