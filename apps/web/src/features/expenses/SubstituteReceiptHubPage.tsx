'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  SubstituteReceiptApprovalMode,
  SubstituteReceiptEvidenceStatus,
  SubstituteReceiptListResult,
} from '@watchdog-bms/contracts';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { DocumentPreviewModal, type DocumentPreviewSource } from '@/common/components/document-preview';
import { LoadingState } from '@/common/components/state';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import {
  downloadSubstituteReceiptPdf,
  fetchSubstituteReceiptPdfBlob,
  getSubstituteReceiptRuntimePolicy,
  listCompanySubstituteReceipts,
} from './expenses.api';
import {
  baht0,
  btnClass,
  dateShort,
  err,
  ErrorBanner,
  ICON,
  inputClass,
  KPI,
  StatCard,
  StatusBadge,
} from './ExpensesUi';
import { IconBtn } from './ExpensesWorkspacePanels';
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

type IssuedArtifactPreviewTarget = {
  expenseId: string;
  evidenceId: string;
  documentNumber: string;
};

export function SubstituteReceiptHubPage({
  companyId,
  userId,
  permissions,
  isOwner,
}: {
  companyId: string;
  userId: string;
  permissions: string[];
  isOwner: boolean;
}) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const canApprove = permissions.includes('expense.confirm');
  const [status, setStatus] = useState<SubstituteReceiptEvidenceStatus | ''>('');
  const [yearMonth, setYearMonth] = useState('');
  const [result, setResult] = useState<SubstituteReceiptListResult | null>(null);
  const [approvalMode, setApprovalMode] = useState<SubstituteReceiptApprovalMode>('OWNER_SELF');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentPreviewSource | null>(null);
  const [previewTarget, setPreviewTarget] = useState<IssuedArtifactPreviewTarget | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const previewRequestRef = useRef(0);
  const previewUrlRef = useRef<string | null>(null);

  const releasePreviewUrl = useCallback(() => {
    const url = previewUrlRef.current;
    previewUrlRef.current = null;
    if (url) URL.revokeObjectURL(url);
  }, []);

  const closePreview = useCallback(() => {
    previewRequestRef.current += 1;
    releasePreviewUrl();
    setPreview(null);
    setPreviewTarget(null);
    setPreviewLoadingId(null);
  }, [releasePreviewUrl]);

  useEffect(() => () => {
    previewRequestRef.current += 1;
    releasePreviewUrl();
  }, [releasePreviewUrl]);

  useEffect(() => {
    closePreview();
  }, [companyId, closePreview]);

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
  }, [canApprove, companyId, status, yearMonth]);

  const model = useMemo(() => buildSubstituteReceiptHubModel(result?.items ?? [], {
    userId,
    canApprove,
    isOwner,
    approvalMode,
    currentYearMonth: new Date().toISOString().slice(0, 7),
  }), [approvalMode, canApprove, isOwner, result?.items, userId]);

  const expenseHref = (expenseId: string) => (
    `/companies/${companyId}/expenses/${encodeURIComponent(expenseId)}`
  );
  const wizardHref = (evidenceId: string) => (
    `/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(evidenceId)}`
  );

  async function loadIssuedArtifactPreview(target: IssuedArtifactPreviewTarget) {
    const requestId = ++previewRequestRef.current;
    setPreviewLoadingId(target.evidenceId);
    setActionError(null);
    try {
      const blob = await fetchSubstituteReceiptPdfBlob(companyId, target.expenseId, target.evidenceId);
      if (requestId !== previewRequestRef.current) return;
      const url = URL.createObjectURL(blob);
      releasePreviewUrl();
      previewUrlRef.current = url;
      setPreviewTarget(target);
      setPreview({ name: `${target.documentNumber}.pdf`, mimeType: 'application/pdf', url });
    } catch (error) {
      if (requestId !== previewRequestRef.current) return;
      setActionError(err(error));
      throw error;
    } finally {
      if (requestId === previewRequestRef.current) {
        setPreviewLoadingId((current) => current === target.evidenceId ? null : current);
      }
    }
  }

  async function openIssuedArtifact(expenseId: string, evidenceId: string, documentNumber: string) {
    try {
      await loadIssuedArtifactPreview({ expenseId, evidenceId, documentNumber });
    } catch {
      // The current request already surfaced a localized error above the table.
    }
  }

  async function downloadIssuedArtifact(expenseId: string, evidenceId: string, documentNumber: string) {
    setActionError(null);
    try {
      await downloadSubstituteReceiptPdf(companyId, expenseId, evidenceId, documentNumber);
    } catch (error) {
      setActionError(err(error));
    }
  }

  const hasWaitingWork = model.waitingForSignature.length > 0 || model.waitingForApproval.length > 0;

  return (
    <>
      <MangmeePage
      title={t('expenses.substitute_hub.title', locale)}
      description={t('expenses.substitute_hub.description', locale)}
      actions={(
        <Link className={btnClass} href={`/companies/${companyId}/expenses/substitute-receipts/new`}>
          {t('expenses.substitute_hub.create', locale)}
        </Link>
      )}
    >
      {loading ? (
        <LoadingState label="กำลังโหลด..." />
      ) : loadError ? (
        <ErrorBanner message={loadError} />
      ) : result ? (
        <div className="space-y-5">
          {actionError && <ErrorBanner message={actionError} />}

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
            <div className="overflow-x-auto">
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
                      <td>{item.payeeName ?? t('expenses.substitute_hub.payee_missing', locale)}</td>
                      <td className="whitespace-nowrap text-right tabular-nums">{baht0(item.grandTotalAmount)}</td>
                      <td>
                        <div className="space-y-1">
                          <StatusBadge status={STATUS_BADGES[item.status]} />
                          <div className="text-xs text-gray-500">{t(STATUS_LABEL_KEYS[item.status], locale)}</div>
                        </div>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          {item.artifactAttachmentId && (item.status === 'ISSUED' || item.status === 'SUPERSEDED') && (
                            <IconBtn
                              title={t('expenses.substitute.download_pdf', locale)}
                              tone="primary"
                              onClick={() => void downloadIssuedArtifact(item.expenseId, item.evidenceId, item.documentNumber)}
                            >
                              {ICON.download}
                            </IconBtn>
                          )}
                          {item.artifactAttachmentId && (item.status === 'ISSUED' || item.status === 'SUPERSEDED') && (
                            <IconBtn
                              title={previewLoadingId === item.evidenceId
                                ? t('expenses.loading', locale)
                                : t('expenses.substitute_hub.open_document', locale)}
                              disabled={previewLoadingId === item.evidenceId}
                              onClick={() => void openIssuedArtifact(item.expenseId, item.evidenceId, item.documentNumber)}
                            >
                              {ICON.eye}
                            </IconBtn>
                          )}
                          {(item.status === 'PREPARED' || item.status === 'PAYER_CERTIFIED') && (
                            <IconBtn
                              title={t('expenses.substitute_hub.continue', locale)}
                              onClick={() => router.push(wizardHref(item.evidenceId))}
                            >
                              {ICON.edit}
                            </IconBtn>
                          )}
                          {item.status === 'SUPERSEDED' && (
                            <IconBtn
                              title={t('expenses.substitute_hub.view_history', locale)}
                              onClick={() => router.push(wizardHref(item.evidenceId))}
                            >
                              {ICON.eye}
                            </IconBtn>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </MangmeeCard>}
        </div>
      ) : null}
      </MangmeePage>
      {preview && <DocumentPreviewModal
        source={preview}
        closeLabel={t('expenses.close', locale)}
        loadingLabel={t('expenses.loading', locale)}
        errorLabel={t('expenses.substitute_wizard.document_not_ready', locale)}
        retryLabel={t('expenses.substitute_wizard.retry', locale)}
        openNewTabLabel={t('expenses.open_new_tab', locale)}
        onClose={closePreview}
        onRetry={previewTarget ? () => loadIssuedArtifactPreview(previewTarget) : undefined}
      />}
    </>
  );
}
