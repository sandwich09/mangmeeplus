'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { Modal } from '@/common/components/modal/Modal';
import { ThemedSteps } from '@/common/components/steps/ThemedSteps';
import { CoverLoader } from '@/common/components/state/CoverLoader';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { useToast } from '@/common/components/toast';
import { findForbiddenChars, REASON_MAX_LENGTH, sanitizeReasonInput } from '@/common/forms/sanitize';
import { downloadDocumentAsPdf } from '@/common/files/download-document-pdf';
import { ATTACHMENT_UPLOAD_ACCEPT } from '@/common/files/upload-file.logic';
import {
  acknowledgeOcrTotal, confirmDuplicate, confirmExpense, deleteExpense, dismissDuplicate, fetchAttachmentPreviewBlob, getExpense,
  markExpenseReady, markExpenseReadyAsReviewer, recordExpensePayment, rejectExpense,
  requestExpenseExtraction, runDuplicateCheck, uploadExpenseEvidenceFile, voidExpense,
} from './expenses.api';
import {
  AI_MISSING_FIELD_LABELS, AI_SUMMARY_STATUS_LABELS, ATTACHMENT_PURPOSE_LABELS, isWetSignedScanAttachment,
  CAPTURE_SOURCE_LABELS, EXPENSE_VAT_MODE_LABELS, PAYMENT_METHOD_LABELS, POSTING_STATUS_LABELS,
  SOURCE_DOCUMENT_TYPE_LABELS, TAX_EVIDENCE_STATUS_LABELS, deriveExpenseAuditChecks,
  deriveExpenseClassificationReviewState, deriveExpenseReviewSteps, expenseAiMissingFields, expenseCapabilities,
  expenseNeedsReceiptOrSubstitute, expenseSubstituteReceiptReady, expenseValueLabel,
  canRunExpenseDuplicateCheck, hasAiGrandTotalMismatch, hasUnresolvedDuplicateWarning, initialExpenseReviewStep, needsAiTotalAcknowledgement,
  MIME_TYPE_LABELS, canDeleteExpense, effectiveVatRateLabel, expenseDeleteErrorMessage, firstFilled, isBlockedCheckBillClassification,
  postingErrorText, vatModeRequiresRate, expensePaymentAttempt, classifyExpensePaymentFailure,
  expenseConfirmBlocker,
} from './expenses.model';
import type { ExpenseDetail, ExpenseReviewStepKey, ExpensePaymentAttempt, ExpensePaymentFailure } from './expenses.model';
import { todayCivilDate, isCivilDate, type BusinessDocumentClassification, type ExpenseVatSourceOverrideInput, type ExpensePaymentMethod } from '@watchdog-bms/contracts';
import {
  AiFieldLabel, AiFieldMissingHint, DOCUMENT_KIND_LABELS, DocumentReviewSection, ExpenseReviewEditSection,
  InlineSpinner, MoneyRow, STEP_HELPER_KEYS, STEP_LABEL_KEYS, expenseNoticeKey,
  extractionNotice, nonExpenseNotice,
} from './ExpensesPages';
import type { ExtractionNotice } from './ExpensesPages';
import {
  baht, btnClass, dangerClass, dateShort, err, ErrorBanner, ghostClass, ICON,
  InfoBanner, inputClass, StatusBadge, successBtn, successBtnStyle, TAX_TONE,
} from './ExpensesUi';
import { generateSourceJournal } from '../ledger/ledger.api';
import { hasRecordedTax, showsTaxCapture, useExpenseCapturePolicy } from './expense-capture-policy';

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

export function ExpenseReviewPage({ companyId, expenseId, userId, permissions, canSelfApprove }: { companyId: string; expenseId: string; userId: string; permissions: string[]; canSelfApprove: boolean }) {
  const router = useRouter();
  const caps = expenseCapabilities(permissions);
  const { canReview, canConfirm } = caps;
  const locale = useWorkspaceLocale();
  const onRefresh = () => undefined;
  const onGoJournal = () => router.push(`/companies/${companyId}/journal?sourceId=${encodeURIComponent(expenseId)}`);
  const [detail, setDetail] = useState<ExpenseDetail | null>(null);
  // Called before the loading/error early returns — hooks cannot live behind them.
  const capture = useExpenseCapturePolicy(companyId, detail?.expenseDate ?? undefined);
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [extractionLoading, setExtractionLoading] = useState(false);
  const [notice, setNotice] = useState<ExtractionNotice | null>(null);
  const [dataErrorCount, setDataErrorCount] = useState<number | null>(null);
  const [dataErrorMessage, setDataErrorMessage] = useState<string | null>(null);
  const onDataValidationChange = useCallback((count: number, message: string | null) => {
    setDataErrorCount(count); setDataErrorMessage(message);
  }, []);
  const [reason, setReason] = useState('');
  const [ocrTotalReason, setOcrTotalReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [showVoid, setShowVoid] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicateResolution, setDuplicateResolution] = useState<{ candidateId: string; action: 'dismiss' | 'confirm' } | null>(null);
  const [paidAmount, setPaidAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('BANK_TRANSFER');
  const [paidAt, setPaidAt] = useState<string>(() => todayCivilDate());
  const paymentAttemptRef = useRef<ExpensePaymentAttempt | null>(null);
  const paymentPendingRef = useRef(false);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
  const [paymentFailure, setPaymentFailure] = useState<ExpensePaymentFailure | 'refresh_failed' | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
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
  // e.g. clearing tax codes), so navigation must not save them; it must refuse to skip past them.
  const evidenceDirtyRef = useRef(false);
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
    // An issued substitute certificate locks material fields server-side
    // (409 substitute_evidence_locks_expense); saving on navigate would fail
    // silently and trap the user on step 1, and there is nothing to save.
    const substituteLocked = detail?.substituteReceiptEvidence?.status === 'ISSUED';
    if (step === 'data' && key !== 'data' && reviewSaveRef.current && !substituteLocked) {
      setStepSaving(true);
      const saved = await reviewSaveRef.current().finally(() => setStepSaving(false));
      if (!saved) return; // stay on the step — the section shows the error
    }
    // ถัดไป past unsaved evidence edits would submit stale values while everything reads green —
    // stay and name the button. Going back keeps the edits (sections hide, not unmount).
    if (step === 'evidence' && key === 'review' && !substituteLocked && evidenceDirtyRef.current) {
      toast.warning(t('expenses.doc_review_unsaved_next', locale));
      return;
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

  const showPreview = useCallback((source: ExpensePreviewSource) => {
    const requestId = ++previewRequestRef.current;
    setPreviewLoading(false);
    commitPreview(requestId, source);
  }, [commitPreview]);

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

  const doAction = async (fn: () => Promise<unknown>, successMessage?: string) => {
    setActionLoading(true); setError(null);
    try { await fn(); await load(); onRefresh(); if (successMessage) toast.success(successMessage); } catch (e) { setError(err(e)); } finally { setActionLoading(false); }
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
    if (paymentPendingRef.current || actionLoading || paymentFailure === 'conflict' || !paidAmount || !isCivilDate(paidAt)) return;
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
      setPaidAmount(''); setPaymentFailure(null); setPaymentNotice(null);
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
      setError(err(e));
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
    } catch (e) { setError(err(e)); setActionLoading(false); }
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
  const attachPrimaryReceipt = async (file: File, branchId: string | null) => {
    setReceiptUploading(true); setError(null);
    try {
      await uploadExpenseEvidenceFile(companyId, expenseId, branchId, file, 'expense.receipt.primary');
      await load(); onRefresh();
      toast.success(t('expenses.receipt_attached', locale));
    } catch (e) { setError(err(e)); } finally { setReceiptUploading(false); }
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

  const extractAgain = async () => {
    setExtractionLoading(true); setError(null);
    try {
      setNotice(extractionNotice(await requestExpenseExtraction(companyId, expenseId), locale));
      await load();
      onRefresh();
    } catch (e) { setError(err(e)); }
    finally { setExtractionLoading(false); }
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

  const isMutable = ['DRAFT', 'NEEDS_REVIEW', 'READY_FOR_CONFIRMATION'].includes(detail.status);
  // Backend: PATCH/mark-ready require expense.review OR (expense.update AND owner) — ownership alone is not enough.
  const isOwnRecord = detail.createdByUserId === userId;
  const canMutateDraft = isMutable && (canReview || (caps.canUpdate && isOwnRecord));
  // Extraction: expense.ocr.request OR expense.review OR (expense.receipt.upload on own record).
  const canExtract = caps.canRequestOcr || (caps.canUploadReceipts && isOwnRecord);
  const isConfirmed = detail.status === 'CONFIRMED';
  const canGenerateJournal = isConfirmed && caps.canPostLedger && detail.pendingPostingSourceType !== null;
  const canViewJournal = isConfirmed && caps.canReadLedger && detail.journalEntryId !== null;
  const canCheckDuplicates = canReview && canRunExpenseDuplicateCheck(detail.status);
  const hasDuplicates = hasUnresolvedDuplicateWarning(detail.duplicateStatus);
  const hasWht = Number(detail.whtAmount) > 0;
  // Spec §7.5: a document that already records VAT keeps showing it, whatever the workspace mode.
  const showsVat = showsTaxCapture(capture.mode, hasRecordedTax([{ vatAmount: detail.vatAmount }, ...detail.lines]));
  const hasPriceMismatch = hasAiGrandTotalMismatch(detail.aiVerifiedFieldsJson, detail.grandTotalAmount);
  const isZeroAmount = Number(detail.grandTotalAmount) === 0;
  const aiMap = detail.aiVerificationSummaryJson as Record<string, unknown> | null;
  const classificationBlocked = deriveExpenseClassificationReviewState(aiMap, canReview).blocked;
  const checkBillBlocked = isBlockedCheckBillClassification(aiMap);
  const classificationBlockMessage = t(checkBillBlocked ? 'expenses.check_bill_workflow_blocked' : 'expenses.non_expense_workflow_blocked', locale);
  const substituteReady = expenseSubstituteReceiptReady(detail);
  const needsReceiptOrSubstitute = expenseNeedsReceiptOrSubstitute(detail);
  const ocrTotalUnacknowledged = needsAiTotalAcknowledgement(detail);
  // Audit H-11: isZeroAmount only ever rendered a warning below and was missing from this gate, so
  // the button stayed live on a ฿0 expense. The API refuses it now; including it here means the
  // reviewer is told before the round trip, and the button no longer disagrees with the rule.
  const canConfirmExpense = canConfirm && detail.status === 'READY_FOR_CONFIRMATION' && !hasDuplicates && !classificationBlocked && substituteReady && !needsReceiptOrSubstitute && !ocrTotalUnacknowledged && !isZeroAmount;
  // Owner requirement 2026-08-28: the reason used to live only in the button's `title`, i.e. a hover
  // tooltip — and expenses get reviewed on a phone, where nothing hovers. One helper decides it now,
  // both footers use it, and it is rendered as text under the button instead of hidden behind a cursor.
  const confirmBlocker = canConfirm && !canConfirmExpense
    ? expenseConfirmBlocker({
      status: detail.status, classificationBlocked, hasDuplicates, needsReceiptOrSubstitute,
      substituteReady, ocrTotalUnacknowledged, isZeroAmount, classificationBlockMessage,
    })
    : null;
  const confirmBlockedText = confirmBlocker
    ? (confirmBlocker.literal ?? t(confirmBlocker.key!, locale))
    : null;
  const confirmBlockedNotice = confirmBlockedText ? (
    <p className="w-full text-center text-xs font-medium text-warning-700">
      {t('expenses.confirm_blocked_prefix', locale)} {confirmBlockedText}
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
  const auditWarnCount = auditChecks.filter((check) => check.status === 'warn').length;
  const confirmBlockers = canMutateDraft && (classificationBlocked || (detail.status === 'READY_FOR_CONFIRMATION' && (isZeroAmount || hasDuplicates)));
  const warnNoteClass = 'rounded-xl border border-warning-100 bg-warning-50 px-3 py-2 text-xs font-semibold text-warning-700';
  const navChips: Array<{ key: DictionaryKey; ref: { current: HTMLDivElement | null } }> = [
    { key: 'expenses.nav_audit', ref: auditRef },
    { key: 'expenses.nav_money', ref: moneyRef },
    { key: 'expenses.nav_vendor', ref: vendorRef },
    { key: 'expenses.nav_documents', ref: documentsRef },
    { key: 'expenses.nav_payment', ref: paymentRef },
  ];
  const approverOnlyActions = !canMutateDraft && detail.status === 'READY_FOR_CONFIRMATION' && (canConfirm || caps.canReject);
  const canRestartReview = detail.status === 'REJECTED' && (canReview || (caps.canUpdate && isOwnRecord));
  const canDelete = canDeleteExpense(detail, userId, caps);
  const hasFooterActions = canMutateDraft || approverOnlyActions || isConfirmed || canRestartReview || canDelete;
  // Guided stepper only for editable drafts (canMutateDraft already implies status ∈ {DRAFT, NEEDS_REVIEW, READY_FOR_CONFIRMATION});
  // every other status/viewer keeps the continuous-scroll layout and footer untouched.
  const guided = canMutateDraft;
  const steps = guided ? deriveExpenseReviewSteps(detail, canReview) : [];
  const stepIndex = steps.findIndex((entry) => entry.key === step);
  const detailsStepDone = steps.some((entry) => entry.key === 'data' && entry.state === 'done');
  const validationBlockMessage = dataErrorCount && dataErrorCount > 0
    ? dataErrorMessage ?? t('expenses.v_blocking_count', locale).replace('{count}', String(dataErrorCount))
    : undefined;

  const pageTitle = (
    <span className="min-w-0">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="tabular-nums text-xs font-bold text-gray-400">{firstFilled(detail.expenseNumber) ?? t('expenses.draft_label', locale)}</span>
        <span className="max-w-full truncate text-lg font-extrabold text-gray-900">{firstFilled(detail.vendorNameSnapshot) ?? t('expenses.vendor_pending', locale)}</span>
        <span className="text-xs font-normal text-gray-500">{expenseValueLabel(SOURCE_DOCUMENT_TYPE_LABELS, detail.sourceDocumentType, 'เอกสารค่าใช้จ่าย')} · {dateShort(detail.expenseDate)}</span>
      </span>
    </span>
  );
  const pageMeta = (
    <div className="mt-1.5 flex flex-wrap gap-2">
      <StatusBadge status={detail.status} />
      <MangmeeBadge tone={TAX_TONE(detail.taxEvidenceStatus)}>{expenseValueLabel(TAX_EVIDENCE_STATUS_LABELS, detail.taxEvidenceStatus, 'รอตรวจหลักฐานภาษี')}</MangmeeBadge>
      {/* the 🤖 AI badge is gone: the AI strip on the data step already says it, in words */}
      <MangmeeBadge tone="slate">{expenseValueLabel(CAPTURE_SOURCE_LABELS, detail.captureSource, 'ช่องทางอื่น')}</MangmeeBadge>
    </div>
  );

  // Status actions relocated from the old panel: enable/disable conditions, permission gates,
  // tooltips and doAction flows are unchanged — only the placement moved to the modal footer.
  // Guided mode shows each step's action plus back/next; terminal actions live on the final review step.
  const modalFooter = hasFooterActions ? (
    <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Every step, not just review: the stepper is display-only, so a draft whose
            validation errors disable ถัดไป must still be rejectable without faking data. */}
        {guided && caps.canReject && (
          <button className={dangerClass} onClick={openReject} disabled={actionLoading}>{t('expenses.reject', locale)}</button>
        )}
        {/* Pure approver (expense.confirm/reject without review/update): READY_FOR_CONFIRMATION actions outside guided mode. */}
        {approverOnlyActions && (
          <>
            {caps.canReject && <button className={dangerClass} onClick={openReject} disabled={actionLoading}>{t('expenses.reject', locale)}</button>}
          </>
        )}
        {isConfirmed && (
          <>
            {caps.canVoid && <button className={dangerClass} onClick={() => { setReason(''); setError(null); setShowVoid(true); setShowReject(false); setDuplicateResolution(null); }} disabled={actionLoading}>{t('expenses.void_document', locale)}</button>}
          </>
        )}
        {canDelete && <button className={dangerClass} onClick={() => { setShowDelete(true); setShowReject(false); setShowVoid(false); setDuplicateResolution(null); }} disabled={actionLoading || deleting}>{t('expenses.delete', locale)}</button>}
      </div>
      <div className="flex flex-col gap-2 sm:ml-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {guided && (
          <>
            {step === 'data' && validationBlockMessage && (
              <div className="max-w-lg text-sm text-error-600">
                <p id={`expense-review-block-${detail.id}`} role="status">{validationBlockMessage}</p>
                <button type="button" className="mt-1 font-semibold underline underline-offset-2" onClick={() => {
                  const section = vendorRef.current;
                  const target = section?.querySelector<HTMLElement>('[aria-invalid="true"]') ?? section;
                  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  target?.focus({ preventScroll: true });
                }}>{t('expenses.v_fix_fields', locale)}</button>
              </div>
            )}
            {stepIndex > 0 && <button className={ghostClass} disabled={stepSaving} onClick={() => void goToStep(steps[stepIndex - 1].key)}>{t('expenses.step_back', locale)}</button>}
            {step === 'review' && (
              <>
                {canCheckDuplicates && <button className={ghostClass} onClick={checkDuplicates} disabled={actionLoading}>{t('expenses.check_duplicate', locale)}</button>}
                {detail.status !== 'READY_FOR_CONFIRMATION' && (
                  <>
                    <button className={btnClass} onClick={() => void markReady()} disabled={actionLoading || classificationBlocked || !detailsStepDone} title={classificationBlocked ? classificationBlockMessage : !detailsStepDone ? t('expenses.submit_requires_details', locale) : undefined}>{t('expenses.send_for_review', locale)}</button>
                  </>
                )}
                {detail.status === 'READY_FOR_CONFIRMATION' && (
                  <>
                    {canConfirm && <button className={successBtn} style={successBtnStyle} onClick={() => doAction(() => confirmExpense(companyId, expenseId, vatOverrideRef.current ?? undefined), 'ยืนยันเอกสารเรียบร้อยแล้ว')} disabled={actionLoading || !canConfirmExpense} title={confirmBlockedText ?? undefined}>{t('expenses.confirm_and_post', locale)}</button>}
                    {confirmBlockedNotice}
                  </>
                )}
              </>
            )}
            {stepIndex < steps.length - 1 && <button className={btnClass} disabled={stepSaving || (step === 'data' && dataErrorCount !== 0) || (step === 'evidence' && checkBillBlocked)} aria-describedby={step === 'data' && validationBlockMessage ? `expense-review-block-${detail.id}` : undefined} title={step === 'data' ? validationBlockMessage : step === 'evidence' && checkBillBlocked ? classificationBlockMessage : undefined} onClick={() => void goToStep(steps[stepIndex + 1].key)}>{stepSaving && step === 'data' ? t('expenses.saving', locale) : t('expenses.step_next', locale)}</button>}
          </>
        )}
        {approverOnlyActions && (
          <>
            {canConfirm && <button className={successBtn} style={successBtnStyle} onClick={() => doAction(() => confirmExpense(companyId, expenseId, vatOverrideRef.current ?? undefined), 'ยืนยันเอกสารเรียบร้อยแล้ว')} disabled={actionLoading || !canConfirmExpense} title={confirmBlockedText ?? undefined}>{t('expenses.confirm_and_post', locale)}</button>}
            {confirmBlockedNotice}
          </>
        )}
        {isConfirmed && (
          <>
            {canGenerateJournal && detail.pendingPostingSourceType && (
              <button className={btnClass} onClick={() => doAction(() => generateSourceJournal(companyId, detail.pendingPostingSourceType!, detail.pendingPostingSourceId!), 'สร้างสมุดรายวันเรียบร้อยแล้ว')} disabled={actionLoading || !detail.pendingPostingSourceId}>
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
        {canRestartReview && <button className={ghostClass} onClick={() => void markReady('เริ่มตรวจใหม่เรียบร้อยแล้ว')} disabled={actionLoading}>{t('expenses.restart_review', locale)}</button>}
      </div>
    </div>
  ) : null;
  const checkBillSecondaryActions = checkBillBlocked && (caps.canReject || canDelete) ? (
    <div className="px-4 pb-4">
      <details className="rounded-xl border border-gray-200 bg-white p-3">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-gray-700">
          {t('expenses.check_bill_more_actions', locale)}
        </summary>
        <div className="space-y-3 border-t border-gray-100 pt-3">
          <p className="text-sm leading-6 text-gray-600">{t('expenses.check_bill_more_actions_help', locale)}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {caps.canReject && <button className={dangerClass} onClick={openReject} disabled={actionLoading}>{t('expenses.reject', locale)}</button>}
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
      {!notice && storedNonExpenseNotice && <InfoBanner message={storedNonExpenseNotice.message} />}
      {storedClassificationOverrideNotice && <InfoBanner message={storedClassificationOverrideNotice} />}
    </>
  );
  const postingCard = isConfirmed ? (
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
          <p className="mt-1 text-xs font-semibold text-gray-600">เอกสารยืนยันแล้ว แก้ไขข้อมูลไม่ได้ · หากข้อมูลไม่ถูกต้อง ให้ยกเลิกเอกสารแล้วบันทึกใหม่</p>
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
  const moneyCard = (
    <div ref={moneyRef} className="scroll-mt-24">
      <MangmeeCard className="p-4">
        <h3 className="text-sm font-semibold text-gray-800">{t('expenses.money_section_title', locale)}</h3>
        <div className="mt-2">
          <MoneyRow label={t('expenses.subtotal', locale)} value={detail.subtotalAmount} />
          {Number(detail.discountAmount) > 0 && <MoneyRow label={t('expenses.discount', locale)} value={detail.discountAmount} negative />}
          {showsVat && <MoneyRow label={t('expenses.taxable_base_ex_vat', locale)} value={detail.taxableAmount} muted />}
          {/* Spec §19g decision 3: mode + the rate the lines actually carry, so "VAT ฿0.00" can no
              longer sit under a label that claims 7%. */}
          {showsVat && <>
            <MoneyRow label={<AiFieldLabel label={`${t('expenses.vat', locale)} (${expenseValueLabel(EXPENSE_VAT_MODE_LABELS, detail.vatMode, 'รอตรวจ VAT')}${vatModeRequiresRate(detail.vatMode) ? ` · ${effectiveVatRateLabel(detail.lines)}` : ''})`} field="vatAmount" summary={aiMap} />} value={detail.vatAmount} />
            <AiFieldMissingHint field="vatAmount" summary={aiMap} />
          </>}
          <div className="mt-1 flex flex-wrap items-center justify-between border-t border-dashed border-gray-200 py-3">
            <span className="text-sm font-semibold text-gray-700"><AiFieldLabel label={t('expenses.grand_total', locale)} field="total" summary={aiMap} /></span>
            <span className="tabular-nums text-2xl font-black text-gray-900">{baht(detail.grandTotalAmount)}</span>
          </div>
          <AiFieldMissingHint field="total" summary={aiMap} />
          {hasWht && (
            <div className="flex flex-wrap items-center justify-between py-1.5 text-sm">
              <span className="text-gray-500">{t('expenses.wht', locale)}</span>
              <span className="tabular-nums font-semibold text-error-500">- {baht(detail.whtAmount)}</span>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-between rounded-xl bg-brand-50 px-4 py-3">
            <div>
              <div className="text-xs font-semibold text-brand-700">{t(hasWht ? 'expenses.amount_due_after_wht' : 'expenses.amount_due', locale)}</div>
              <div className="mt-1"><StatusBadge status={detail.paymentStatus} /></div>
            </div>
            <div className="text-right">
              <div className="tabular-nums text-2xl font-black text-brand-700">{baht(detail.outstandingAmount)}</div>
              {Number(detail.paidAmount) > 0 && <div className="tabular-nums text-xs text-gray-500">{t('expenses.paid_prefix', locale)} {baht(detail.paidAmount)}</div>}
            </div>
          </div>
        </div>
      </MangmeeCard>
    </div>
  );
  const vendorCard = (
    <div ref={vendorRef} className="scroll-mt-24" tabIndex={-1}>
      <ExpenseReviewEditSection companyId={companyId} detail={detail} isMutable={canMutateDraft} canReview={canReview} canConfirm={canConfirm} saveRef={reviewSaveRef} vatOverrideRef={vatOverrideRef} onValidationChange={onDataValidationChange} onSaved={async () => { setDetail(await getExpense(companyId, expenseId)); onRefresh(); }} />
    </div>
  );
  const documentReviewCard = (
    <DocumentReviewSection
      companyId={companyId}
      detail={detail}
      isMutable={isMutable}
      canReview={canReview}
      canConfirm={canConfirm}
      userId={userId}
      canSelfApprove={canSelfApprove}
      onSaved={async () => { setNotice(null); await load(); await onRefresh(); }}
      onOpenFile={showPreview}
      onAttachPrimaryReceipt={canMutateDraft ? (file) => attachPrimaryReceipt(file, detail.branchId) : undefined}
      receiptUploading={receiptUploading}
      dirtyRef={evidenceDirtyRef}
    />
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
            disabled={actionLoading || !ocrTotalReason.trim()}
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
      <p className="font-semibold">🤖 {t('expenses.ai_data_title', locale)}</p>
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
        🤖 {t(aiMissingDataFields.length > 0 ? 'expenses.ai_prefill_partial' : 'expenses.ai_prefill_complete', locale)}
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
      {canExtract && (
        <button className={cx(ghostClass, 'ml-auto')} onClick={() => void extractAgain()} disabled={actionLoading || extractionLoading}>
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
      <h3 className="text-sm font-semibold text-warning-700">⚠ {t('expenses.duplicate_warning_title', locale)}</h3>
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
          <span className="font-semibold text-error-700">{t('expenses.confirm_duplicate', locale)}</span>
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
  const paymentCard = (
    <div ref={paymentRef} className="scroll-mt-24">
      <MangmeeCard className="space-y-3 p-4">
        <h3 className="text-sm font-semibold text-gray-800">{t('expenses.payment_section_title', locale)}</h3>
        {Boolean(detail.sourceReimbursementRequestId) && (
          <p className="text-sm text-gray-500">
            รายการนี้มาจากการเบิกคืนพนักงาน{detail.vendorDocumentNumber ? ` (ใบเบิก ${detail.vendorDocumentNumber})` : ''} — ระบบบันทึกการชำระให้อัตโนมัติเมื่อการเงินบันทึกจ่ายใบเบิก
          </p>
        )}
        {isConfirmed && caps.canRecordPayment && Number(detail.outstandingAmount) > 0 && !detail.sourceReimbursementRequestId && (
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
                <ThemedDate id="expense-payment-paid-at" name="paidAt" className={inputClass} value={paidAt} required disabled={actionLoading} onChange={(e) => editPayment(() => setPaidAt(e.target.value))} />
              </div>
            </fieldset>
            <p className="text-sm text-gray-500">เลือกวันที่จ่ายเงินจริง แม้จะนำมาบันทึกภายหลัง · ยอดค้างจ่าย {baht(detail.outstandingAmount)}</p>
            {paymentNotice && <p role="status" className="rounded-xl bg-warning-50 p-3 text-sm text-warning-800">{paymentNotice}</p>}
            <button type="submit" className={cx(btnClass, 'w-full sm:w-auto')} disabled={actionLoading || paymentFailure === 'conflict' || !paidAmount || !isCivilDate(paidAt)}>{actionLoading ? 'กำลังบันทึก…' : paymentFailure === 'conflict' ? 'กรุณาตรวจประวัติการจ่าย' : paymentFailure === 'uncertain' || paymentFailure === 'refresh_failed' ? 'ลองบันทึกรายการเดิมอีกครั้ง' : t('expenses.record_payment', locale)}</button>
          </form>
        )}
        {(detail.payments?.length ?? 0) > 0 && (
          <div className="space-y-2 border-t border-gray-100 pt-3">
            <p className="text-xs font-semibold text-gray-600">ประวัติการจ่าย</p>
            {detail.payments?.map((payment) => (
              <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-600">
                <span>{dateShort(payment.paidAt)} · {PAYMENT_METHOD_LABELS[payment.paymentMethod ?? 'OTHER']}</span>
                <span className="tabular-nums font-semibold text-gray-800">{baht(payment.amount)}</span>
                <span>{payment.status === 'VOIDED' ? 'ยกเลิกแล้ว' : payment.postingStatus === 'posted' ? 'ลงบัญชีแล้ว' : payment.postingStatus === 'posting_error' ? 'ลงบัญชีไม่สำเร็จ' : 'รอลงบัญชี'}</span>
              </div>
            ))}
          </div>
        )}
        {detail.status === 'VOIDED' && <p className="text-sm text-gray-400">{t('expenses.document_voided', locale)}{detail.voidReason ? ` — ${detail.voidReason}` : ''}</p>}
        {detail.paidAt && <p className="text-xs text-gray-400">{t('expenses.paid_at', locale)} {dateShort(detail.paidAt)}</p>}
        {detail.confirmedAt && <p className="text-xs text-gray-400">{t('expenses.confirmed_at', locale)} {dateShort(detail.confirmedAt)}</p>}
        {detail.rejectedAt && <p className="text-xs text-error-500">{t('expenses.rejected_at', locale)} {dateShort(detail.rejectedAt)}: {detail.rejectReason}</p>}
      </MangmeeCard>
    </div>
  );

  // Shared by the desktop empty-viewer pane and the small-screen strip: the viewer
  // pane is lg-only, so mobile needs its own way into the primary-receipt slot.
  const receiptFileInput = (label: string) => canMutateDraft && (
    <label className="cursor-pointer">
      <span className={cx(ghostClass, 'inline-flex')}>{receiptUploading ? t('expenses.uploading', locale) : label}</span>
      <input
        className="hidden"
        type="file"
        accept={ATTACHMENT_UPLOAD_ACCEPT}
        disabled={receiptUploading}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void attachPrimaryReceipt(file, detail.branchId);
        }}
      />
    </label>
  );
  const replaceReceiptControl = receiptFileInput(t('expenses.replace_receipt', locale));
  const attachReceiptControl = canMutateDraft && (
    <label className="cursor-pointer">
      <span className={cx(ghostClass, 'inline-flex')}>{receiptUploading ? t('expenses.uploading', locale) : t('expenses.attach_receipt', locale)}</span>
      <input
        className="hidden"
        type="file"
        accept={ATTACHMENT_UPLOAD_ACCEPT}
        disabled={receiptUploading}
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
      <MangmeePage eyebrow={backLink} title={pageTitle} meta={pageMeta}>
        {error && <ErrorBanner message={error} />}
        {/* A11Y-01: while an action runs the only visible cue is the disabled buttons. Empty when
            idle, so nothing is announced on mount. */}
        <p role="status" aria-live="polite" className="sr-only">
          {actionLoading ? t('expenses.action_in_progress', locale) : ''}
        </p>

        <div className="sticky z-10 flex flex-wrap gap-1.5 border-b border-gray-100 bg-white px-4 py-2.5" style={{ top: `${APP_HEADER_REM}rem` }}>
          {guided ? (
            <ThemedSteps steps={steps.map((entry, index) => ({
              key: entry.key,
              label: t(STEP_LABEL_KEYS[entry.key], locale),
              // Position decides the color (สรรพากร-style): green up to where the user
              // stands, gray past it — stepping back grays the steps ahead again. A
              // flagged step keeps its warning look unless it is the one being worked on.
              // Display-only on purpose: navigation goes through ถัดไป/ย้อนกลับ.
              state: step === entry.key ? 'current'
                : entry.state === 'attention' ? 'attention'
                  : index < stepIndex ? 'done' : 'upcoming',
            }))} />
          ) : navChips.map((chip) => (
            <button key={chip.key} type="button" onClick={() => chip.ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 transition hover:border-brand-200 hover:text-brand-700">
              {t(chip.key, locale)}
            </button>
          ))}
        </div>
        {guided && (
          <div className="border-b border-gray-100 bg-brand-25 px-4 py-2.5 text-sm text-gray-700">
            <span className="font-bold text-brand-700">ขั้นที่ {stepIndex + 1}:</span>{' '}
            {t(STEP_HELPER_KEYS[step], locale)}
          </div>
        )}

        <div className="grid min-h-0 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)]">
            {/* left pane (lg+): inline document viewer */}
            <div
              className="hidden min-h-0 border-r border-gray-100 bg-gray-50 lg:sticky lg:flex lg:self-start lg:flex-col"
              style={{ top: `${VIEWER_TOP_REM}rem`, height: `calc(100dvh - ${VIEWER_TOP_REM + VIEWER_BOTTOM_GAP_REM}rem)` }}
            >
              {attachments.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-[14px] bg-gray-100 text-2xl">🧾</span>
                  <p className="text-sm text-gray-500">{t('expenses.viewer_empty', locale)}</p>
                  {attachReceiptControl}
                  {isMutable && canReview && needsReceiptOrSubstitute && (
                    <Link className={ghostClass} href={`/companies/${companyId}/expenses/substitute-receipts/new?expenseId=${encodeURIComponent(detail.id)}`}>{t('expenses.no_receipt_start_substitute', locale)}</Link>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2 border-b border-gray-100 bg-white px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-800">{activeAttachment?.originalFileName}</div>
                      <div className="text-xs text-gray-500">{activeAttachment && isWetSignedScanAttachment(activeAttachment.id, detail.substituteReceiptEvidence)
                        ? t('expenses.attachment.wet_signed_scan', locale)
                        : expenseValueLabel(ATTACHMENT_PURPOSE_LABELS, activeAttachment?.purpose, 'เอกสารแนบ')}</div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {/* Owner 2026-08-28: "เผื่ออัพโหลดผิด". Re-uploading has always worked on the server —
                          the newest primary upload becomes the receipt — but the control was rendered only
                          while there were zero attachments, so a wrong file could never be corrected here. */}
                      {replaceReceiptControl}
                      {attachments.length > 1 && (
                        <>
                          <button type="button" className={ghostClass} onClick={() => setViewerIndex(Math.max(0, safeViewerIndex - 1))} disabled={safeViewerIndex <= 0} aria-label={t('expenses.viewer_prev', locale)}>‹</button>
                          <span className="tabular-nums text-xs text-gray-500">{safeViewerIndex + 1}/{attachments.length}</span>
                          <button type="button" className={ghostClass} onClick={() => setViewerIndex(Math.min(attachments.length - 1, safeViewerIndex + 1))} disabled={safeViewerIndex >= attachments.length - 1} aria-label={t('expenses.viewer_next', locale)}>›</button>
                        </>
                      )}
                      <button type="button" className={ghostClass} onClick={reloadViewerUrl} aria-label={t('expenses.viewer_reload', locale)} title={t('expenses.viewer_reload', locale)}>↻</button>
                      {activeAttachment && <button type="button" className={ghostClass} onClick={() => void openPreview(activeAttachment)} disabled={previewLoading}>{previewLoading ? t('expenses.opening', locale) : t('expenses.viewer_fullscreen', locale)}</button>}
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
                    <div className="flex justify-end border-b border-gray-100 px-5 py-2">{replaceReceiptControl}</div>
                  )}
                  {attachments.map((attachment) => (
                    <button
                      key={attachment.id}
                      type="button"
                      className="flex w-full items-center gap-3 border-b border-gray-100 px-5 py-3 text-left last:border-b-0 hover:bg-gray-100 disabled:opacity-60"
                      onClick={() => void openPreview(attachment)}
                      disabled={previewLoading}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-[9px]" style={{ background: '#E0F2FE', color: '#0BA5EC' }}>{ICON.file}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-gray-800">{attachment.originalFileName}</div>
                        <div className="text-xs text-gray-500">{isWetSignedScanAttachment(attachment.id, detail.substituteReceiptEvidence)
                          ? t('expenses.attachment.wet_signed_scan', locale)
                          : expenseValueLabel(ATTACHMENT_PURPOSE_LABELS, attachment.purpose, 'เอกสารแนบ')} · {expenseValueLabel(MIME_TYPE_LABELS, attachment.mimeType, 'ไฟล์เอกสาร')}</div>
                      </div>
                      <span className="flex-shrink-0 text-xs font-semibold text-brand-600">{previewLoading ? t('expenses.opening', locale) : t('expenses.view_file', locale)}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className={cx('space-y-4 p-4', checkBillBlocked && 'order-1')}>
                {guided ? (
                  <>
                    <div className={cx('space-y-4', step === 'data' ? undefined : 'hidden')}>
                      <CoverLoader active={extractionLoading} scope="section" label={t('expenses.ai_reading', locale)}>
                        <div className="space-y-4">
                          {noticesBlock}
                          {aiPrefillBanner}
                          {!aiMap && step === 'data' && canExtract && (
                            <button className={ghostClass} onClick={() => void extractAgain()} disabled={actionLoading || extractionLoading}>
                              <span className="inline-flex items-center justify-center gap-2">
                                {extractionLoading && <InlineSpinner />}
                                {extractionLoading ? t('expenses.ai_reading', locale) : t('expenses.extract_again', locale)}
                              </span>
                            </button>
                          )}
                        </div>
                      </CoverLoader>
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
                  </>
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
              {canMutateDraft && detail.status === 'READY_FOR_CONFIRMATION' && hasDuplicates && <p className="text-xs font-semibold text-warning-700">{t('expenses.duplicate_action_required', locale)}</p>}
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
                    }} disabled={actionLoading || !reason.trim()}>{t('expenses.confirm', locale)}</button>
                    <button className={ghostClass} onClick={() => { setShowVoid(false); setReason(''); }}>{t('expenses.cancel', locale)}</button>
                  </div>
                </>
              )}
              {showDelete && (
                <>
                  <div className="text-sm font-medium text-gray-700">{t('expenses.delete_confirm_note', locale)}</div>
                  <div className="flex gap-2">
                    <button className={dangerClass} onClick={() => void removeExpense()} disabled={deleting}>{deleting ? t('expenses.deleting', locale) : t('expenses.delete_permanently', locale)}</button>
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
                    }} disabled={actionLoading || reason.trim().length < 3}>{t('expenses.confirm', locale)}</button>
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

      <Modal
        open={showReject}
        title={t('expenses.reject_confirm_title', locale)}
        size="sm"
        closeLabel={t('expenses.close', locale)}
        onClose={closeReject}
        footer={(
          <>
            <button type="button" className={cx(ghostClass, 'flex-1 sm:flex-none')} onClick={closeReject} disabled={actionLoading}>
              {t('expenses.reject_stay', locale)}
            </button>
            <button type="button" className={cx(dangerClass, 'flex-1 sm:flex-none')} onClick={() => {
              const cleanReason = reason.trim();
              const forbidden = findForbiddenChars(cleanReason);
              if (forbidden.length > 0) { setError(t('common.forbidden_chars', locale).replace('{chars}', forbidden.join(' '))); return; }
              void doAction(async () => {
                await rejectExpense(companyId, expenseId, cleanReason);
                setShowReject(false); setReason('');
              }, t('expenses.reject_success', locale));
            }} disabled={actionLoading || !reason.trim()}>
              {t('expenses.confirm', locale)}
            </button>
          </>
        )}
      >
        <div className="space-y-3">
          <p className="text-sm leading-6 text-gray-600">{t('expenses.reject_confirm_description', locale)}</p>
          {error && <ErrorBanner message={error} />}
          <label className="block text-sm font-medium text-gray-700">
            {t('expenses.reject_reason', locale)} <span className="text-error-600" aria-hidden>*</span>
            <textarea
              className={cx(inputClass, 'mt-1 min-h-28 resize-y')}
              rows={4}
              required
              value={reason}
              onChange={(event) => setReason(sanitizeReasonInput(event.target.value))}
              maxLength={REASON_MAX_LENGTH}
              placeholder={t('expenses.reject_reason_placeholder', locale)}
            />
          </label>
          <div className="text-right text-xs text-gray-400 tabular-nums">{reason.length}/{REASON_MAX_LENGTH}</div>
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
                disabled={previewSaving}
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
