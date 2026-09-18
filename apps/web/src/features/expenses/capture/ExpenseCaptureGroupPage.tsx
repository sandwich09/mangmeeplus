'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import type {
  ExpenseCaptureAction, ExpenseCaptureFileDto, ExpenseCaptureGroupDetailDto, ExpenseCaptureGroupStatus,
} from '@watchdog-bms/contracts';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx, type MangmeeTone } from '@/common/components/mangmee';
import { useConfirm } from '@/common/components/modal/use-confirm';
import { useInputPrompt } from '@/common/components/modal/use-input-prompt';
import { ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { apiErrorMessage, apiErrorCode, translateApiError } from '@/common/api/api-error-message';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import {
  addExpenseCaptureFile, closeExpenseCaptureGroup, completeExpenseCaptureFile,
  detachExpenseCaptureFile, fetchAttachmentPreviewBlob, getExpenseCaptureGroup,
  getExpenseCaptureGroupReadStatus, handoffCaptureGroup, uploadReceiptFile,
} from '../expenses.api';
import { baht, btnClass, ghostClass, ErrorBanner, InfoBanner, StatusBadge } from '../ExpensesUi';
import {
  captureFileRejection, captureMegabytes, runCaptureUpload,
  type CaptureUploadApi, type CaptureUploadEntry,
} from '../expense-capture-upload.logic';
import {
  capturePausedReasonKey, captureReadIsRunning, captureReadNotice,
  type ExpenseReadStatusFile,
} from '../expense-capture-status.logic';
import { HeicDecodeError, prepareReceiptFile, RECEIPT_UPLOAD_ACCEPT } from '../expense-upload.logic';
import { CaptureAllocationSection } from './CaptureAllocationSection';
import { CaptureFactsSection } from './CaptureFactsSection';
import {
  captureAllocation, captureBlockerRows, captureDerivedRows, captureHandoffConfirmParams,
  captureStateChips, captureSummary, captureText,
} from './expense-capture-review.logic';

/**
 * งานรับหลักฐาน — the page a multi-file intake lands on (appendix §11).
 *
 * The page holds the group and the three things that act on the whole of it: the summary a person
 * reads first, the blockers that must be visible BEFORE the one primary action (spec §13.4), and
 * the handoff that turns an accepted allocation into ordinary expense records. The facts and the
 * company/personal split live in their own sections below.
 *
 * Every affordance here comes from the server's `allowedActions`. A hidden button is not a guard,
 * and a shown one that 403s is a worse answer than no button at all.
 */

const STATUS_LABELS: Record<ExpenseCaptureGroupStatus, DictionaryKey> = {
  OPEN: 'expenses.capture.status_open',
  HANDED_OFF: 'expenses.capture.status_handed_off',
  CLOSED_NO_HANDOFF: 'expenses.capture.status_closed_no_handoff',
  CANCELLED: 'expenses.capture.status_cancelled',
};

const STATUS_TONES: Record<ExpenseCaptureGroupStatus, MangmeeTone> = {
  OPEN: 'brand', HANDED_OFF: 'teal', CLOSED_NO_HANDOFF: 'slate', CANCELLED: 'amber',
};

/** What the last handoff attempt told us. `unknown` is its own answer, never a silent failure. */
type HandoffState = { kind: 'done' | 'unknown' | 'unavailable' } | null;

export function ExpenseCaptureGroupPage({ companyId, groupId, userId, permissions }: {
  companyId: string; groupId: string; userId: string; permissions: string[];
}) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [group, setGroup] = useState<ExpenseCaptureGroupDetailDto | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readStatus, setReadStatus] = useState<Record<string, ExpenseReadStatusFile>>({});
  const [preview, setPreview] = useState<DocumentPreviewSource | null>(null);
  const [handoff, setHandoff] = useState<HandoffState>(null);
  const previewUrlRef = useRef<string | null>(null);
  // One key per attempt, kept so a retry of the SAME allocation is the same batch (§9/A10).
  const idempotencyRef = useRef<{ allocationId: string; key: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setGroup(await getExpenseCaptureGroup(companyId, groupId));
      setLoadError(null);
    } catch (cause) { setLoadError(cause); }
    finally { setLoading(false); }
  }, [companyId, groupId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  const files = useMemo(
    () => (group?.files ?? []).filter((file) => file.uploadState !== 'DETACHED'),
    [group],
  );

  const statusOf = useCallback((file: ExpenseCaptureFileDto): ExpenseReadStatusFile | null => {
    const polled = readStatus[file.fileId];
    if (polled) return polled;
    return file.readStatus
      ? {
        fileId: file.fileId, attachmentId: file.attachmentId, status: file.readStatus,
        pagesRead: file.pagesRead, pageCount: file.pageCount,
        pausedReason: file.pausedReason, lastErrorCode: file.lastErrorCode,
      }
      : null;
  }, [readStatus]);

  const reading = files.some((file) => captureReadIsRunning(statusOf(file)?.status ?? null));

  // Poll only while a read is actually running, and stop the moment every job is terminal — the
  // detail is re-read once at that point, because that is when new facts can exist.
  useEffect(() => {
    if (!reading) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void getExpenseCaptureGroupReadStatus(companyId, groupId)
        .then((result) => {
          if (cancelled) return;
          setReadStatus(Object.fromEntries(
            result.files.filter((file) => file.fileId).map((file) => [file.fileId!, file]),
          ));
          if (result.files.every((file) => !captureReadIsRunning(file.status))) void load();
        })
        .catch(() => undefined);
    }, 3_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [companyId, groupId, load, reading]);

  const captureApi: CaptureUploadApi = useMemo(() => ({
    addFile: (id, body) => addExpenseCaptureFile(companyId, id, body),
    putBytes: (intent, file) => uploadReceiptFile(intent.uploadUrl, intent.uploadMethod, file, intent.uploadHeaders),
    completeFile: (id, fileId, body) => completeExpenseCaptureFile(companyId, id, fileId, body),
    readGroup: async (id) => {
      const detail = await getExpenseCaptureGroup(companyId, id);
      return {
        revision: detail.revision,
        files: detail.files.map((file) => ({
          fileId: file.fileId, uploadState: file.uploadState,
          originalFileName: file.originalFileName, byteSize: file.byteSize,
        })),
      };
    },
  }), [companyId]);

  /** "แนบหลักฐานเพิ่ม" — append into THIS job. It never touches an expense's primary receipt. */
  const addFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(event.target.files ?? [])];
    event.target.value = '';
    if (picked.length === 0 || !group) return;
    setBusy(true); setActionError(null);
    try {
      const prepared: Array<{ entry: CaptureUploadEntry; file: File }> = [];
      for (const file of picked) {
        if (captureFileRejection(file, group.capability)) {
          setActionError(t('expenses.upload_unsupported_file', locale));
          return;
        }
        const ready = await prepareReceiptFile(file);
        prepared.push({
          entry: { fileId: null, name: ready.file.name, size: ready.file.size, state: 'PENDING' },
          file: ready.file,
        });
      }
      await runCaptureUpload({ groupId, revision: group.revision, entries: prepared, api: captureApi });
      await load();
    } catch (cause) {
      setActionError(cause instanceof HeicDecodeError
        ? t('expenses.upload_heic_unsupported', locale)
        : apiErrorMessage(cause));
    } finally { setBusy(false); }
  };

  const detachFile = async (file: ExpenseCaptureFileDto) => {
    if (!group) return;
    const reason = await promptInput({
      title: t('expenses.capture.detach_title', locale),
      message: t('expenses.capture.detach_message', locale),
      label: t('expenses.capture.detach_reason_prompt', locale),
      confirmLabel: t('expenses.capture.detach_file', locale),
      variant: 'danger',
    });
    if (!reason?.trim()) return;
    setBusy(true); setActionError(null);
    try {
      await detachExpenseCaptureFile(companyId, groupId, file.fileId, {
        reason: reason.trim(), expectedRevision: group.revision,
      });
      toast.success(t('expenses.capture.detach_done', locale));
      await load();
    } catch (cause) { setActionError(apiErrorMessage(cause)); }
    finally { setBusy(false); }
  };

  /** "ไม่มีส่วนของบริษัท": the files stay, no expense is created, and nothing financial happens. */
  const closeGroup = async () => {
    if (!group) return;
    const accepted = await confirm({
      title: t('expenses.capture.close_title', locale),
      message: t('expenses.capture.close_message', locale),
      confirmLabel: t('expenses.capture.close_no_portion', locale),
      variant: 'danger',
    });
    if (!accepted) return;
    setBusy(true); setActionError(null);
    try {
      await closeExpenseCaptureGroup(companyId, groupId, {
        reason: 'NO_COMPANY_PORTION', expectedRevision: group.revision,
      });
      toast.success(t('expenses.capture.close_done', locale));
      await load();
    } catch (cause) { setActionError(apiErrorMessage(cause)); }
    finally { setBusy(false); }
  };

  /**
   * "สร้างรายการค่าใช้จ่าย" — the one primary action (spec §13.4), and the only place this feature
   * creates anything. The confirm says exactly what will exist afterwards and in which state; an
   * unknown outcome re-reads the group instead of offering the button again (UXE-24).
   */
  const runHandoff = async () => {
    const allocation = group ? captureAllocation(group) : null;
    const allocationId = group?.allocation?.allocationId;
    if (!group || !allocation || !allocationId) return;
    const accepted = await confirm({
      title: t('expenses.capture.handoff_confirm_title', locale),
      message: captureText(t('expenses.capture.handoff_confirm_message', locale), captureHandoffConfirmParams(allocation)),
      confirmLabel: t('expenses.capture.handoff', locale),
    });
    if (!accepted) return;
    if (idempotencyRef.current?.allocationId !== allocationId) {
      idempotencyRef.current = { allocationId, key: crypto.randomUUID() };
    }
    setBusy(true); setActionError(null); setHandoff(null);
    try {
      await handoffCaptureGroup(companyId, groupId, {
        allocationId, expectedRevision: group.revision, idempotencyKey: idempotencyRef.current.key,
      });
      idempotencyRef.current = null;
      setHandoff({ kind: 'done' });
      toast.success(t('expenses.capture.handoff_done', locale));
      await load();
    } catch (cause) {
      const status = (cause as { status?: number } | null)?.status;
      // W05 owns the route: until it is deployed this is "not available", not a failed creation.
      if (status === 404) setHandoff({ kind: 'unavailable' });
      else if (status === undefined || status >= 500) { setHandoff({ kind: 'unknown' }); await load(); }
      else setActionError(apiErrorMessage(cause));
    } finally { setBusy(false); }
  };

  /** "เก็บไว้ก่อน" is exactly that: navigation and a truthful toast, never a mutation. */
  const keepForLater = () => {
    toast.success(t('expenses.capture.kept_toast', locale));
    router.push(`/companies/${companyId}/expenses`);
  };

  const openPreview = async (file: ExpenseCaptureFileDto, pageIndex: number | null = null) => {
    setActionError(null);
    try {
      const blob = await fetchAttachmentPreviewBlob(companyId, file.attachmentId, file.mimeType);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      // "ดูหน้าที่อ้างอิง": the PDF viewer's own page fragment, so the cited page opens first.
      const at = pageIndex !== null && file.mimeType === 'application/pdf' ? `#page=${pageIndex + 1}` : '';
      setPreview({ name: file.originalFileName, mimeType: file.mimeType, url: `${url}${at}` });
    } catch (cause) { setActionError(apiErrorMessage(cause)); }
  };

  const backLink = (
    <Link href={`/companies/${companyId}/expenses`}>← {t('expenses.capture.back_to_expenses', locale)}</Link>
  );

  if (loading) {
    return (
      <MangmeePage eyebrow={backLink} title={t('expenses.capture.page_title', locale)}>
        <LoadingState label={t('expenses.loading', locale)} />
      </MangmeePage>
    );
  }
  if (loadError || !group) {
    const code = apiErrorCode(loadError);
    const status = (loadError as { status?: number } | null)?.status;
    return (
      <MangmeePage eyebrow={backLink} title={t('expenses.capture.page_title', locale)}>
        {status === 403 || code === 'FORBIDDEN'
          ? <ForbiddenState locale={locale} />
          : <ErrorState locale={locale} description={apiErrorMessage(loadError)} onRetry={() => { setLoading(true); void load(); }} />}
      </MangmeePage>
    );
  }

  const may = (action: ExpenseCaptureAction) => group.allowedActions.includes(action);
  const summary = captureSummary(group, userId);
  const blockers = captureBlockerRows(group.blockers, (code) => translateApiError(code) ?? code);
  const derived = captureDerivedRows(group, companyId);
  const unknownAmount = t('expenses.capture.summary_paid_unknown', locale);
  const payerText = summary.payer.kind === 'company'
    ? t('expenses.capture.funding_company', locale)
    : summary.payer.kind === 'self'
      ? t('expenses.capture.payer_option_self', locale)
      : summary.payer.kind === 'member'
        ? summary.payer.userId
        : t('expenses.capture.summary_payer_unknown', locale);

  return (
    <MangmeePage
      eyebrow={t('expenses.capture.eyebrow', locale)}
      title={t('expenses.capture.page_title', locale)}
      description={t('expenses.capture.page_description', locale)}
    >
      {/* 390 px first: one column, 18 px Thai body, and every control at least 44 px tall. */}
      <div className="flex flex-col gap-4 text-lg leading-8 text-gray-800">
        <div className="flex flex-wrap items-center gap-2">
          <MangmeeBadge tone={STATUS_TONES[group.status]}>{t(STATUS_LABELS[group.status], locale)}</MangmeeBadge>
          {group.allowedActions.length === 0 && (
            <span className="text-sm text-gray-500">{t('expenses.capture.read_only', locale)}</span>
          )}
        </div>

        {actionError && <ErrorBanner message={actionError} />}

        {/* The summary a person reads first (spec §13.4). Six axes, never one green tick (§13.2). */}
        <MangmeeCard className="p-4">
          <h2 className="text-lg font-semibold text-gray-800">{t('expenses.capture.summary_title', locale)}</h2>
          <p className="mt-2 text-base leading-7 text-gray-800">
            {summary.headline
              ? captureText(t(summary.headline.key, locale), summary.headline.params)
              : t('expenses.capture.summary_no_facts', locale)}
          </p>
          {summary.incomplete && (
            <p className="text-base leading-7 text-warning-700">
              {captureText(t(summary.incomplete.key, locale), summary.incomplete.params)}
            </p>
          )}
          <dl className="mt-2 space-y-1 text-base leading-7">
            <div>
              <dt className="inline font-semibold text-gray-700">{t('expenses.capture.summary_paid_total', locale)}: </dt>
              <dd className="inline text-gray-800">{summary.paidTotal ? baht(summary.paidTotal) : unknownAmount}</dd>
            </div>
            <div>
              <dt className="inline font-semibold text-gray-700">{t('expenses.capture.summary_company_amount', locale)}: </dt>
              <dd className="inline text-gray-800">
                {summary.companyAmount ? baht(summary.companyAmount) : t('expenses.capture.summary_company_unknown', locale)}
              </dd>
            </div>
            {summary.personalAmount && (
              <div>
                <dt className="inline font-semibold text-gray-700">{t('expenses.capture.summary_personal_amount', locale)}: </dt>
                <dd className="inline text-gray-800">{baht(summary.personalAmount)}</dd>
              </div>
            )}
            <div>
              <dt className="inline font-semibold text-gray-700">{t('expenses.capture.summary_payer', locale)}: </dt>
              <dd className="inline text-gray-800">{payerText}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            {captureStateChips(group).map((chip) => (
              <MangmeeBadge key={chip.axis} tone={chip.tone}>{t(chip.key, locale)}</MangmeeBadge>
            ))}
          </div>
        </MangmeeCard>

        {/* Before the primary action, always: what is wrong and what to do about it (§13.4/§17.1). */}
        {blockers.length > 0 && (
          <MangmeeCard className="p-4">
            <h2 className="text-lg font-semibold text-gray-800">{t('expenses.capture.blockers_title', locale)}</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-base leading-7 text-gray-700">
              {blockers.map((blocker) => (
                <li key={blocker.code}>
                  {blocker.message}
                  <span className="block text-gray-600">
                    {t('expenses.capture.blocker_way_out_label', locale)}: {t(blocker.wayOutKey, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </MangmeeCard>
        )}

        <MangmeeCard className="p-4">
          <h2 className="text-lg font-semibold text-gray-800">{t('expenses.capture.files_section', locale)}</h2>
          {files.length === 0
            ? <p className="mt-2 text-base leading-7 text-gray-500">{t('expenses.capture.no_files', locale)}</p>
            : (
              <ul className="mt-3 space-y-3">
                {files.map((file) => {
                  const status = statusOf(file);
                  const notice = captureReadNotice(status);
                  const pausedKey = capturePausedReasonKey(status?.pausedReason ?? null);
                  return (
                    <li key={file.fileId} className="rounded-xl border border-gray-200 bg-white p-3.5">
                      <p className="break-words text-base font-semibold text-gray-800">{file.originalFileName}</p>
                      <p className="text-sm text-gray-500">{captureMegabytes(file.byteSize)}</p>
                      {notice && (
                        <p className={cx('mt-2 text-base leading-7', notice.tone === 'error' ? 'text-error-700' : 'text-gray-700')}>
                          {captureText(t(notice.messageKey, locale), notice.params ?? {})}
                          {pausedKey ? ` (${t(pausedKey, locale)})` : ''}
                        </p>
                      )}
                      {/* D09: never "verified", only "not checked yet". */}
                      <p className="mt-1 text-sm text-gray-500">{t('expenses.capture.electronic_not_checked', locale)}</p>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} onClick={() => void openPreview(file)}>
                          {t('expenses.view_file', locale)}
                        </button>
                        {may('detach_file') && (
                          <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void detachFile(file)}>
                            {t('expenses.capture.detach_file', locale)}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          {may('add_file') && (
            <label className={cx(btnClass, 'mt-4 flex min-h-11 w-full cursor-pointer items-center justify-center sm:w-auto')}>
              {t('expenses.capture.add_files', locale)}
              <input
                type="file"
                accept={RECEIPT_UPLOAD_ACCEPT}
                multiple
                className="sr-only"
                disabled={busy}
                onChange={(event) => void addFiles(event)}
              />
            </label>
          )}
        </MangmeeCard>

        <CaptureFactsSection
          companyId={companyId}
          group={group}
          canEdit={may('review')}
          onChanged={load}
          onOpenPage={(fileId, pageIndex) => {
            const file = files.find((candidate) => candidate.fileId === fileId);
            if (file) void openPreview(file, pageIndex);
          }}
        />
        <CaptureAllocationSection
          companyId={companyId}
          group={group}
          viewerUserId={userId}
          canReview={permissions.includes('expense.review')}
          onChanged={load}
        />

        {handoff?.kind === 'unknown' && <InfoBanner message={t('expenses.capture.handoff_unknown', locale)} />}
        {handoff?.kind === 'unavailable' && <InfoBanner message={t('expenses.capture.handoff_unavailable', locale)} />}
        {handoff?.kind === 'done' && <InfoBanner message={t('expenses.capture.handoff_done', locale)} />}

        {derived.length > 0 && (
          <MangmeeCard className="p-4">
            <h2 className="text-lg font-semibold text-gray-800">{t('expenses.capture.derived_title', locale)}</h2>
            <ul className="mt-3 space-y-3">
              {derived.map((source) => (
                <li key={source.expenseId} className="rounded-xl border border-gray-200 bg-white p-3.5">
                  <p className="text-base font-semibold text-gray-800">{source.label} · {baht(source.grandTotalAmount)}</p>
                  <p className="mt-1"><StatusBadge status={source.status} /></p>
                  {/* W06 fills the certificate line; until then it says nothing it cannot know. */}
                  <p className="mt-1 text-sm text-gray-500">{t('expenses.capture.derived_certificate', locale)}</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <Link className={cx(ghostClass, 'inline-flex min-h-11 items-center justify-center')} href={`/companies/${companyId}/expenses/${source.expenseId}`}>
                      {t('expenses.capture.derived_open', locale)}
                    </Link>
                    {source.claimHref
                      ? (
                        <Link className={cx(ghostClass, 'inline-flex min-h-11 items-center justify-center')} href={source.claimHref}>
                          {t('expenses.capture.derived_prepare_claim', locale)}
                        </Link>
                      )
                      : <span className="text-sm text-gray-500">{t('expenses.capture.derived_claim_waiting_tax', locale)}</span>}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-gray-500">{t('expenses.capture.after_handoff_note', locale)}</p>
          </MangmeeCard>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          {may('handoff') && (
            <button type="button" className={cx(btnClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void runHandoff()}>
              {t('expenses.capture.handoff', locale)}
            </button>
          )}
          <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} onClick={keepForLater}>
            {t('expenses.capture.keep_for_later', locale)}
          </button>
          {may('close') && (
            <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void closeGroup()}>
              {t('expenses.capture.close_no_portion', locale)}
            </button>
          )}
        </div>

        {reading && <InfoBanner message={t('expenses.capture.read_stored_reading', locale)} />}
      </div>

      {preview && (
        <DocumentPreviewModal
          source={preview}
          closeLabel="ปิด"
          loadingLabel="กำลังเปิดเอกสาร..."
          errorLabel="แสดงเอกสารนี้ไม่สำเร็จ กรุณาลองใหม่"
          retryLabel="ลองอีกครั้ง"
          openNewTabLabel="เปิดในแท็บใหม่"
          onClose={() => {
            if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
            previewUrlRef.current = null;
            setPreview(null);
          }}
        />
      )}
      {confirmDialog}
      {inputPromptDialog}
    </MangmeePage>
  );
}
