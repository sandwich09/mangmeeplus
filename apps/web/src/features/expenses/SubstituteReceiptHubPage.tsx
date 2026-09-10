'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  SubstituteReceiptApprovalMode,
  SubstituteReceiptEvidenceStatus,
  SubstituteReceiptListResult,
  SubstituteReceiptListItem,
  SubstituteReceiptPaperPreview,
} from '@watchdog-bms/contracts';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { PopoverPanel } from '@/common/components/field/PopoverPanel';
import { Modal } from '@/common/components/modal/Modal';
import { useConfirm } from '@/common/components/modal/use-confirm';
import { useToast } from '@/common/components/toast';
import { sanitizeReasonInput } from '@/common/forms/sanitize';
import { LoadingState } from '@/common/components/state';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import {
  getSubstituteReceiptRuntimePolicy,
  listCompanySubstituteReceipts,
  previewIssuedSubstitutePaper,
  supersedeSubstituteReceipt,
} from './expenses.api';
import {
  baht0,
  btnClass,
  dateShort,
  dangerClass,
  err,
  ErrorBanner,
  ghostClass,
  ICON,
  inputClass,
  KPI,
  StatCard,
  StatusBadge,
} from './ExpensesUi';
import { buildSubstituteReceiptHubModel } from './substitute-receipt-hub.model';

const STATUS_LABEL_KEYS: Record<SubstituteReceiptEvidenceStatus, DictionaryKey> = {
  PREPARED: 'expenses.substitute_hub.status_prepared',
  PAYER_CERTIFIED: 'expenses.substitute_hub.status_payer_certified',
  ISSUED: 'expenses.substitute_hub.status_issued',
  SUPERSEDED: 'expenses.substitute_hub.status_superseded',
};

const STATUS_BADGES: Record<SubstituteReceiptEvidenceStatus, string> = {
  PREPARED: 'NEEDS_REVIEW',
  PAYER_CERTIFIED: 'READY_FOR_CONFIRMATION',
  ISSUED: 'CONFIRMED',
  SUPERSEDED: 'VOIDED',
};

type PreviewTarget = { item: SubstituteReceiptListItem; data: SubstituteReceiptPaperPreview };

const PRINT_ICON = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5"><path d="M7 8V3h10v5M7 17H4V9h16v8h-3M7 14h10v7H7zM17 11h1" /></svg>;

function ReceiptActions({ item, canReview, canContinue, busy, onEdit, onOpen, onCancel }: {
  item: SubstituteReceiptListItem; canReview: boolean; canContinue: boolean; busy: boolean;
  onEdit: () => void; onOpen: () => void; onCancel: () => void;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Focus only after the portal is placed; a hidden panel cannot receive focus.
    const panel = panelRef.current;
    const observer = new MutationObserver(() => focusPlacedPanel());
    const focusPlacedPanel = () => {
      if (!panel || getComputedStyle(panel).visibility === 'hidden') return;
      panel.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
      observer.disconnect();
    };
    if (panel) observer.observe(panel, { attributes: true, attributeFilter: ['style'] });
    focusPlacedPanel();
    const outside = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => { observer.disconnect(); document.removeEventListener('pointerdown', outside); };
  }, [open]);
  const close = () => { setOpen(false); anchorRef.current?.focus(); };
  const select = (action: () => void) => { close(); action(); };
  const choices = [
    { label: 'แก้ไข', icon: ICON.edit, action: onEdit, disabled: !canContinue || item.status === 'SUPERSEDED', reason: !canContinue ? 'ต้องเป็นผู้รับผิดชอบขั้นตอนนี้หรือมีสิทธิ์ตรวจสอบค่าใช้จ่าย' : 'เอกสารถูกยกเลิกหรือแทนที่แล้ว' },
    { label: 'ดู', icon: ICON.eye, action: onOpen },
    { label: 'ยกเลิกเอกสาร', icon: ICON.trash, action: onCancel, disabled: !canReview || !item.canCancel, reason: !canReview ? 'ต้องมีสิทธิ์ตรวจสอบค่าใช้จ่าย' : item.status === 'SUPERSEDED' ? 'เอกสารถูกยกเลิกหรือแทนที่แล้ว' : 'สถานะนี้ต้องดำเนินการผ่านขั้นตอนแก้ไขเอกสาร', danger: true },
  ];
  return <>
    <button ref={anchorRef} type="button" className={cx(ghostClass, 'h-11 w-11 p-2')} aria-label={`ดำเนินการ ${item.documentNumber}`} aria-haspopup="menu" aria-expanded={open} disabled={busy}
      onClick={() => setOpen(!open)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
    </button>
    <PopoverPanel open={open} anchorRef={anchorRef} panelRef={panelRef} height={220} role="menu" aria-label={`ดำเนินการ ${item.documentNumber}`}
      className="z-[100001] w-56 overflow-auto rounded-xl border border-gray-200 bg-white p-1.5 text-sm shadow-lg"
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); close(); }
        if (event.key === 'Tab') { close(); }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault();
          const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
          buttons[index]?.focus();
        }
      }}>
      {choices.map((choice) => <button key={choice.label} type="button" role="menuitem" disabled={choice.disabled} title={choice.disabled ? choice.reason : undefined}
        className={cx('flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left font-semibold outline-none hover:bg-gray-50 focus-visible:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40', choice.danger ? 'text-error-700' : 'text-gray-700')}
        onClick={() => select(choice.action)}>{choice.icon}{choice.label}</button>)}
    </PopoverPanel>
  </>;
}

function ReceiptPrintPreview({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  const [loaded, setLoaded] = useState<number[]>([]);
  const [failed, setFailed] = useState(false);
  const [pdfUrl, setPdfUrl] = useState('');
  const pages = target.data.pageImageDataUrls ?? [];
  useEffect(() => {
    let url = '';
    try {
      const prefix = 'data:application/pdf;base64,';
      if (!target.data.pdfDataUrl.startsWith(prefix)) throw new Error('Invalid PDF');
      const bytes = Uint8Array.from(atob(target.data.pdfDataUrl.slice(prefix.length)), (character) => character.charCodeAt(0));
      url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      setPdfUrl(url);
    } catch { setFailed(true); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [target.data.pdfDataUrl]);
  return <Modal open title={target.item.documentNumber} onClose={onClose} size="xl" printSurface
    bodyClassName="bg-gray-100 p-3 sm:p-5" footer={<>
      {failed && <span className="text-sm text-error-700">โหลดเอกสารไม่ครบ กรุณาปิดแล้วเปิดใหม่</span>}
      {pdfUrl && <a className={ghostClass} href={pdfUrl} download={`${target.item.documentNumber}.pdf`}>ดาวน์โหลด PDF</a>}
      <button type="button" className={btnClass} disabled={failed || !pages.length || loaded.length !== pages.length} onClick={() => window.print()}>{PRINT_ICON} พิมพ์</button>
    </>}>
    <p className="modal-print-hide mb-4 text-sm font-semibold text-gray-700">{target.item.status === 'PREPARED'
      ? target.item.paperSubmission ? 'ฉบับลงนามรอตรวจรับ' : target.item.signatureMode === 'PAPER' ? 'แบบฟอร์มสำหรับกรอกและลงนามบนกระดาษ' : 'ฉบับรอลงนาม'
      : target.item.status === 'PAYER_CERTIFIED' ? 'ฉบับลงนามแล้ว รออนุมัติ' : target.item.status === 'ISSUED' ? 'ฉบับสมบูรณ์' : 'ฉบับประวัติที่ยกเลิกหรือถูกแทนที่'}</p>
    {pages.map((page, index) => <div key={index} className="mb-4 last:mb-0 print:mb-0 print:break-after-page print:last:break-after-auto">
      {/* Generated page images preserve every page on paper, including uploaded scans. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={page} alt={`เอกสารหน้า ${index + 1}`} className="mx-auto block h-auto w-full max-w-[794px] bg-white" onLoad={() => setLoaded((current) => current.includes(index) ? current : [...current, index])} onError={() => setFailed(true)} />
    </div>)}
  </Modal>;
}

export function SubstituteReceiptHubPage({
  companyId,
  userId,
  permissions,
  canSelfApprove,
}: {
  companyId: string;
  userId: string;
  permissions: string[];
  canSelfApprove: boolean;
}) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const canReview = permissions.includes('expense.review');
  const canApprove = permissions.includes('expense.confirm');
  const [status, setStatus] = useState<SubstituteReceiptEvidenceStatus | ''>('');
  const [yearMonth, setYearMonth] = useState('');
  const [result, setResult] = useState<SubstituteReceiptListResult | null>(null);
  const [approvalMode, setApprovalMode] = useState<SubstituteReceiptApprovalMode>('OWNER_SELF');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const [cancelTarget, setCancelTarget] = useState<SubstituteReceiptListItem | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const cancelPendingRef = useRef(false);
  const cancelTriggerRef = useRef<HTMLElement | null>(null);
  const [refresh, setRefresh] = useState(0);
  const { confirm, confirmDialog } = useConfirm();
  const toast = useToast();
  const closePreview = useCallback(() => { previewRequestRef.current += 1; setPreview(null); setPreviewLoadingId(null); }, []);
  useEffect(() => { closePreview(); setCancelTarget(null); return () => { previewRequestRef.current += 1; }; }, [companyId, closePreview]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      listCompanySubstituteReceipts(companyId, {
        ...(status ? { status } : {}),
        ...(yearMonth ? { yearMonth } : {}),
        page: 1,
        pageSize: 200,
      }),
      canApprove ? getSubstituteReceiptRuntimePolicy(companyId) : Promise.resolve(null),
    ])
      .then(([nextResult, policy]) => {
        if (cancelled) return;
        setResult(nextResult);
        if (policy) setApprovalMode(policy.approvalMode);
      })
      .catch((error) => { if (!cancelled) setLoadError(err(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canApprove, companyId, status, yearMonth, refresh]);

  const model = useMemo(() => buildSubstituteReceiptHubModel(result?.items ?? [], {
    userId,
    canApprove,
    canSelfApprove,
    approvalMode,
    currentYearMonth: new Date().toISOString().slice(0, 7),
  }), [approvalMode, canApprove, canSelfApprove, result?.items, userId]);

  const wizardHref = (evidenceId: string) => `/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(evidenceId)}`;

  async function openDocument(item: SubstituteReceiptListItem) {
    const requestId = ++previewRequestRef.current;
    setPreviewLoadingId(item.evidenceId); setActionError(null);
    try {
      const data = await previewIssuedSubstitutePaper(companyId, item.expenseId, item.evidenceId);
      if (requestId === previewRequestRef.current) setPreview({ item, data });
    } catch (error) { if (requestId === previewRequestRef.current) setActionError(err(error)); }
    finally { if (requestId === previewRequestRef.current) setPreviewLoadingId(null); }
  }

  async function confirmCancellation() {
    if (!cancelTarget || !cancelReason.trim() || cancelPendingRef.current) return;
    const item = cancelTarget;
    const reason = cancelReason.trim();
    cancelPendingRef.current = true; setCancelling(true); setCancelTarget(null);
    try {
      if (!await confirm({ title: 'ยืนยันยกเลิกเอกสารอีกครั้ง',
        message: `ยืนยันยกเลิก ${item.documentNumber} ด้วยเหตุผล “${reason}” ใช่หรือไม่? เอกสารจะใช้เป็นฉบับปัจจุบันต่อไม่ได้ ประวัติและไฟล์เดิมยังเก็บอยู่`,
        confirmLabel: 'ยืนยันยกเลิกเอกสาร', cancelLabel: 'กลับไปโดยไม่ยกเลิก', variant: 'danger' })) return;
      setActionError(null);
      await supersedeSubstituteReceipt(companyId, item.expenseId, item.evidenceId, { reason, expectedEvidenceUpdatedAt: item.updatedAt });
      toast.success(`ยกเลิกเอกสาร ${item.documentNumber} แล้ว`);
      setRefresh((value) => value + 1);
    } catch (error) { setActionError(err(error)); }
    finally {
      cancelPendingRef.current = false; setCancelling(false);
      requestAnimationFrame(() => cancelTriggerRef.current?.focus());
    }
  }

  const actions = (item: SubstituteReceiptListItem) => <ReceiptActions item={item} canReview={canReview}
    canContinue={canReview || model.waitingForSignature.some((task) => task.evidenceId === item.evidenceId) || model.waitingForApproval.some((task) => task.evidenceId === item.evidenceId)} busy={cancelling || previewLoadingId !== null}
    onEdit={() => router.push(wizardHref(item.evidenceId))} onOpen={() => void openDocument(item)}
    onCancel={() => { cancelTriggerRef.current = document.activeElement as HTMLElement; setCancelReason(''); setCancelTarget(item); }} />;

  const hasWaitingWork = model.waitingForSignature.length > 0 || model.waitingForApproval.length > 0;

  return (
    <>
      <MangmeePage
      title={t('expenses.substitute_hub.title', locale)}
      description={t('expenses.substitute_hub.description', locale)}
      actions={canReview ? (
        <Link className={btnClass} href={`/companies/${companyId}/expenses/substitute-receipts/new`}>
          {t('expenses.substitute_hub.create', locale)}
        </Link>
      ) : undefined}
    >
      {loading ? (
        <LoadingState label="กำลังโหลด..." />
      ) : loadError ? (
        <ErrorBanner message={loadError} />
      ) : result ? (
        <div className="space-y-5">
          {actionError && <ErrorBanner message={actionError} />}
          {previewLoadingId && <p role="status" className="text-sm text-gray-600">กำลังเปิดเอกสาร...</p>}

          {hasWaitingWork && (
            <section>
              <h2 className="mb-3 text-sm font-bold text-gray-900">
                {t('expenses.substitute_hub.pending_title', locale)}
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {model.waitingForSignature.length > 0 && (
                  <Link href={wizardHref(model.waitingForSignature[0]!.evidenceId)} className="block">
                    <MangmeeCard className="border-brand-200 bg-brand-25 p-4 transition hover:border-brand-300">
                      <div className="font-bold text-brand-700">
                        {t('expenses.substitute_hub.waiting_signature', locale)
                          .replace('{count}', String(model.waitingForSignature.length))}
                      </div>
                    </MangmeeCard>
                  </Link>
                )}
                {model.waitingForApproval.length > 0 && (
                  <Link href={wizardHref(model.waitingForApproval[0]!.evidenceId)} className="block">
                    <MangmeeCard className="border-warning-200 bg-warning-50 p-4 transition hover:border-warning-300">
                      <div className="font-bold text-warning-700">
                        {t('expenses.substitute_hub.waiting_approval', locale)
                          .replace('{count}', String(model.waitingForApproval.length))}
                      </div>
                    </MangmeeCard>
                  </Link>
                )}
              </div>
            </section>
          )}

          {result.items.length > 0 && <section>
            {result.total > result.items.length && (
              <div className="mb-2 text-xs font-medium text-gray-500">
                {t('expenses.substitute_hub.loaded_scope', locale)}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard icon={ICON.doc} label={t('expenses.substitute_hub.kpi_issued', locale)} value={model.issuedThisMonthCount} {...KPI.brand} />
              <StatCard icon={ICON.wallet} label={t('expenses.substitute_hub.kpi_value', locale)} value={baht0(model.issuedThisMonthAmount)} {...KPI.sky} />
              <StatCard icon={ICON.clock} label={t('expenses.substitute_hub.kpi_pending', locale)} value={`${model.awaitingSignatureCount} / ${model.awaitingApprovalCount}`} {...KPI.amber} />
              <StatCard icon={ICON.trash} label={t('expenses.substitute_hub.kpi_cancelled', locale)} value={model.supersededCount} danger {...KPI.danger} />
            </div>
          </section>}

          <MangmeeCard className="p-4">
            <div className="flex flex-wrap gap-3">
              <label className="text-sm font-semibold text-gray-700">
                <span className="mb-1 block">{t('expenses.substitute_hub.filter_status', locale)}</span>
                <ThemedSelect
                  className={inputClass}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as SubstituteReceiptEvidenceStatus | '')}
                >
                  <option value="">{t('expenses.substitute_hub.filter_all', locale)}</option>
                  <option value="PREPARED">{t(STATUS_LABEL_KEYS.PREPARED, locale)}</option>
                  <option value="PAYER_CERTIFIED">{t(STATUS_LABEL_KEYS.PAYER_CERTIFIED, locale)}</option>
                  <option value="ISSUED">{t(STATUS_LABEL_KEYS.ISSUED, locale)}</option>
                  <option value="SUPERSEDED">{t(STATUS_LABEL_KEYS.SUPERSEDED, locale)}</option>
                </ThemedSelect>
              </label>
              <label className="text-sm font-semibold text-gray-700">
                <span className="mb-1 block">{t('expenses.substitute_hub.filter_month', locale)}</span>
                <ThemedDate
                  className={inputClass}
                  mode="month"
                  value={yearMonth}
                  onChange={(event) => setYearMonth(event.target.value)}
                />
              </label>
            </div>
          </MangmeeCard>

          {result.items.length === 0 ? (
            <MangmeeCard className="p-8 text-center">
              <h2 className="text-base font-bold text-gray-900">{t('expenses.substitute_hub.empty', locale)}</h2>
              <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-500">
                {t('expenses.substitute_hub.empty_description', locale)}
              </p>
            </MangmeeCard>
          ) : <MangmeeCard className="overflow-hidden">
            <div className="hidden overflow-x-auto md:block">
              <table className="mangmee-table min-w-full">
                <thead>
                  <tr>
                    <th>{t('expenses.substitute_hub.table_document', locale)}</th>
                    <th>{t('expenses.substitute_hub.table_payment_date', locale)}</th>
                    <th>{t('expenses.substitute_hub.table_payee', locale)}</th>
                    <th className="text-right">{t('expenses.substitute_hub.table_amount', locale)}</th>
                    <th>{t('expenses.substitute_hub.table_status', locale)}</th>
                    <th className="text-right">{t('expenses.substitute_hub.table_actions', locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.evidenceId}>
                      <td className="whitespace-nowrap font-semibold text-gray-900">{item.documentNumber}</td>
                      <td className="whitespace-nowrap">{dateShort(item.paymentDate ?? item.expenseDate)}</td>
                      <td>{item.payeeName ?? t('expenses.substitute_hub.payee_missing', locale)}<div className="mt-1 text-xs text-gray-500">{item.fundingSource === 'COMPANY' ? 'บริษัทจ่ายเต็มจำนวน' : item.fundingSource === 'PERSONAL_ADVANCE' ? 'พนักงานจ่ายเต็มจำนวน' : 'เอกสารเดิม: ยังไม่ระบุแหล่งเงิน'} · {item.payerName || (item.signatureMode === 'PAPER' ? 'กรอกผู้ลงนามบนกระดาษ' : '—')}</div></td>
                      <td className="whitespace-nowrap text-right tabular-nums">{baht0(item.grandTotalAmount)}</td>
                      <td>
                        <div className="space-y-1">
                          <StatusBadge status={STATUS_BADGES[item.status]} />
                          <div className="text-xs text-gray-500">{item.status === 'PREPARED' && item.signatureMode === 'PAPER' && !item.payerUserId ? item.paperSubmission ? 'รอตรวจรับฉบับลงนาม' : 'รอฉบับลงนามบนกระดาษ' : t(STATUS_LABEL_KEYS[item.status], locale)}</div>
                        </div>
                      </td>
                      <td>
                        <div className="flex justify-end">{actions(item)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Same actions on mobile, without a clipped table menu. */}
            <div className="space-y-3 p-3 md:hidden" data-testid="substitute-receipt-card-list">
              {result.items.map((item) => {
                return (
                  <MangmeeCard key={item.evidenceId} className="overflow-hidden p-0">
                    <div className="p-4" data-testid="substitute-receipt-card">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-gray-900">{item.documentNumber}</div>
                          <div className="mt-0.5 truncate text-sm text-gray-600">{item.payeeName ?? t('expenses.substitute_hub.payee_missing', locale)}</div><div className="mt-1 text-xs text-gray-500">{item.fundingSource === 'COMPANY' ? 'บริษัทจ่ายเต็มจำนวน' : item.fundingSource === 'PERSONAL_ADVANCE' ? 'พนักงานจ่ายเต็มจำนวน' : 'เอกสารเดิม: ยังไม่ระบุแหล่งเงิน'} · {item.payerName || (item.signatureMode === 'PAPER' ? 'กรอกผู้ลงนามบนกระดาษ' : '—')}</div>
                        </div>
                        <div className="shrink-0 text-right font-bold tabular-nums text-gray-900">{baht0(item.grandTotalAmount)}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <StatusBadge status={STATUS_BADGES[item.status]} />
                        <span className="text-xs text-gray-500">{item.status === 'PREPARED' && item.signatureMode === 'PAPER' && !item.payerUserId ? item.paperSubmission ? 'รอตรวจรับฉบับลงนาม' : 'รอฉบับลงนามบนกระดาษ' : t(STATUS_LABEL_KEYS[item.status], locale)}</span>
                      </div>
                      <div className="mt-2 text-xs text-gray-500">{dateShort(item.paymentDate ?? item.expenseDate)}</div>
                    </div>
                    <div className="flex justify-end border-t border-gray-100 p-3">{actions(item)}</div>
                  </MangmeeCard>
                );
              })}
            </div>

          </MangmeeCard>}
        </div>
      ) : null}
      </MangmeePage>
      {preview && <ReceiptPrintPreview key={`${preview.item.evidenceId}:${preview.data.previewChecksumSha256}`} target={preview} onClose={() => { closePreview(); setRefresh((value) => value + 1); }} />}
      <Modal open={cancelTarget !== null} title={`ยกเลิกเอกสาร ${cancelTarget?.documentNumber ?? ''}`} onClose={() => setCancelTarget(null)} size="sm"
        footer={<>
          <button type="button" className={ghostClass} onClick={() => setCancelTarget(null)}>กลับ</button>
          <button type="button" className={dangerClass} disabled={!cancelReason.trim() || cancelling} onClick={() => void confirmCancellation()}>ดำเนินการยกเลิก</button>
        </>}>
        <p className="mb-4 text-sm text-gray-600">เอกสารจะถูกยกเลิกและเก็บไว้ในประวัติ การยกเลิกเอกสารไม่ลบรายการค่าใช้จ่ายและไม่ย้อนรายการจ่ายเงิน</p>
        <label className="block text-sm font-semibold text-gray-700">เหตุผลที่ยกเลิก <span className="text-error-700">*</span>
          <textarea className={cx(inputClass, 'mt-2')} rows={3} maxLength={500} value={cancelReason} onChange={(event) => setCancelReason(sanitizeReasonInput(event.target.value))} />
        </label>
      </Modal>
      {confirmDialog}
    </>
  );
}
