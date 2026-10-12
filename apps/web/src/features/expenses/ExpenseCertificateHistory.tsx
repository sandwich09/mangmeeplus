'use client';

import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react';
import { WHT_EXTERNAL_RECORD_WORDS, WHT_CERTIFICATE_HISTORY_EVENT_LABELS, type WhtCertificateHistoryDto } from '@watchdog-bms/contracts';
import { MangmeeCard } from '@/common/components/mangmee';
import { formatThaiDate, formatThaiTime } from '@/common/i18n/thai-date';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { getExpenseCertificateHistory } from './expenses.api';
import { err, ErrorBanner, ghostClass } from './ExpensesUi';

type HistoryState = { rows: WhtCertificateHistoryDto[]; loading: boolean; error: string | null };
const HistoryContext = createContext<(HistoryState & { confirmed: boolean; retry: () => void }) | null>(null);

export function ExpenseCertificateHistory({ companyId, expenseId, revision, canRead, confirmed, children }: {
  companyId: string; expenseId: string; revision: string; canRead: boolean; confirmed: boolean; children: ReactNode;
}) {
  const [state, setState] = useState<HistoryState>({ rows: [], loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!canRead) return;
    let cancelled = false;
    setState({ rows: [], loading: true, error: null });
    getExpenseCertificateHistory(companyId, expenseId)
      .then(rows => { if (!cancelled) setState({ rows: [...rows].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)), loading: false, error: null }); })
      .catch(cause => { if (!cancelled) setState({ rows: [], loading: false, error: err(cause) }); });
    return () => { cancelled = true; };
  }, [companyId, expenseId, revision, canRead, attempt]);
  return <HistoryContext.Provider value={canRead ? { ...state, confirmed, retry: () => setAttempt(value => value + 1) } : null}>{children}</HistoryContext.Provider>;
}

export function ExpenseCertificateHistoryNotice({ placement }: { placement: 'edit' | 'issue' }) {
  const history = useContext(HistoryContext);
  const newest = history?.rows[0];
  // External removal records cover both edit and void, and do not prove the external document was cancelled.
  if (!history || history.loading || history.error || !newest || !['CANCELLED_SOURCE_REOPENED', 'CANCELLED_SOURCE_VOIDED'].includes(newest.eventType) || newest.isExternal) return null;
  const number = newest.certificateNumber ? <><span className="inline-block max-w-full">เลขที่ <span className={newest.certificateNumber.length > 30 ? undefined : 'whitespace-nowrap'}>{newest.certificateNumber}</span></span>{' '}</> : null;
  if (placement === 'edit' && !history.confirmed) return <p role="status" className="text-sm leading-6 text-gray-700">ยกเลิกหนังสือรับรอง{number}แล้ว {newest.eventType === 'CANCELLED_SOURCE_REOPENED' ? 'แก้เสร็จให้ยืนยันและออกใบใหม่ ' : ''}ถ้าเคยส่งใบเดิมให้ผู้รับเงิน แจ้งว่าใบนั้นยกเลิก</p>;
  if (placement === 'issue' && history.confirmed && newest.eventType === 'CANCELLED_SOURCE_REOPENED') return <p className="w-full text-sm leading-6 text-gray-700">ใบเดิม{number}ยกเลิกแล้ว</p>;
  return null;
}

export function ExpenseCertificateHistoryDisclosure({ label, plain = false }: { label?: string; plain?: boolean } = {}) {
  const history = useContext(HistoryContext);
  if (!history) return null;
  if (history.loading) return <p role="status" className="text-sm text-gray-600">{t('expenses.loading', 'th')}</p>;
  if (history.error) return <div className="space-y-2"><ErrorBanner message={history.error} /><button type="button" className={ghostClass} onClick={history.retry}>{t('expenses.substitute_wizard.retry', 'th')}</button></div>;
  if (!history.rows.length) return null;
  const groups = new Map<string, WhtCertificateHistoryDto[]>();
  for (const row of history.rows) {
    const day = formatThaiDate(row.occurredAt);
    groups.set(day, [...(groups.get(day) ?? []), row]);
  }
  const disclosure = <details>
      <summary className="min-h-11 cursor-pointer text-sm font-semibold leading-6 text-gray-800">{label ?? `ประวัติหนังสือรับรองหัก ณ ที่จ่าย (${history.rows.length} รายการ)`}</summary>
      <div className="space-y-4 pt-3">{[...groups].map(([day, rows]) => <section key={day} className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-800">{day}</h3>
        <ul className="space-y-2 text-sm leading-6 text-gray-700">{rows.map((row, index) => {
          const previous = row.previousExternalRecord;
          const referenceChanged = !previous || (previous.externalEvidenceRef ?? '') !== (row.evidenceRef ?? '');
          const noteChanged = !previous || (previous.note ?? '') !== (row.note ?? '');
          const oldValues = previous ? [
            previous.number && previous.number !== row.certificateNumber && <span className="inline-block max-w-full">{t('expenses.certificate_card.previous_number', 'th')}{' '}<span className={previous.number.length > 30 ? undefined : 'whitespace-nowrap'}>{previous.number}</span></span>,
            previous.issuedDate && previous.issuedDate.slice(0, 10) !== row.certificateDate?.slice(0, 10) && `${t('expenses.certificate_card.history_date', 'th')} ${formatThaiDate(previous.issuedDate)}`,
            previous.externalEvidenceRef && referenceChanged && `${t('expenses.certificate_card.history_reference', 'th')} ${previous.externalEvidenceRef}`,
            previous.note && noteChanged && `${t('expenses.certificate_card.history_note', 'th')} ${previous.note}`,
          ].filter(Boolean) : [];
          return <li key={`${row.occurredAt}-${index}`} className="break-words">
          {/* A certificate number stays on one line: the browser otherwise breaks it after a hyphen ("WHT-" / "2026-00003"). */}
          {[
            formatThaiTime(row.occurredAt), row.actorDisplayName ?? '—', row.removedManually ? WHT_EXTERNAL_RECORD_WORDS.removedManually : WHT_CERTIFICATE_HISTORY_EVENT_LABELS[row.eventType],
            row.eventType === 'EXTERNAL_RECORD_REMOVED' && !row.removedManually && t('expenses.certificate_card.removed_with_expense', 'th'),
            row.certificateNumber && <span className="inline-block max-w-full">เลขที่ <span className={row.certificateNumber.length > 30 ? undefined : 'whitespace-nowrap'}>{row.certificateNumber}</span></span>,
            row.eventType === 'CORRECTED' && row.relatedCertificateNumber && <span className="inline-block max-w-full">ใบใหม่เลขที่ <span className={row.relatedCertificateNumber.length > 30 ? undefined : 'whitespace-nowrap'}>{row.relatedCertificateNumber}</span></span>,
            row.reason && `เหตุผล: ${row.reason}`,
          ].filter(Boolean).map((part, position) => <Fragment key={position}>{position > 0 && ' · '}{part}</Fragment>)}
          {oldValues.length > 0 && <p className="whitespace-pre-wrap break-words">
            {t('expenses.certificate_card.history_old', 'th')}{' '}
            {oldValues.map((part, position) => <Fragment key={position}>{position > 0 && ' · '}{part}</Fragment>)}
          </p>}
          {row.evidenceRef && referenceChanged && <p className="whitespace-pre-wrap break-words">เลขอ้างอิง: {row.evidenceRef}</p>}
          {row.note && noteChanged && <p className="whitespace-pre-wrap break-words">หมายเหตุ: {row.note}</p>}
        </li>; })}</ul>
      </section>)}</div>
    </details>;
  return plain ? disclosure : <MangmeeCard className="p-4">{disclosure}</MangmeeCard>;
}

export function ExpenseCertificateExternalRecordNotice() {
  const history = useContext(HistoryContext);
  const newest = history?.rows[0];
  if (!history?.confirmed || history.loading || history.error || newest?.eventType !== 'EXTERNAL_RECORD_REMOVED' || newest.removedManually) return null;
  const [before, after] = t('expenses.certificate_card.external_removed', 'th').split('เลขที่ {number}');
  return <p role="status" className="text-sm leading-6 text-gray-700">{before}<span className="inline-block max-w-full">เลขที่ <span className={(newest.certificateNumber?.length ?? 0) > 30 ? undefined : 'whitespace-nowrap'}>{newest.certificateNumber ?? '—'}</span></span>{after}</p>;
}

export function useExpenseCertificateHistoryRefresh() {
  return useContext(HistoryContext)?.retry;
}

export function ExpenseCancellationNotice({ voidedAt, reason }: { voidedAt?: string | null; reason?: string | null }) {
  const history = useContext(HistoryContext);
  const certificate = history?.rows.find(row => row.eventType === 'CANCELLED_SOURCE_VOIDED' && !row.isExternal);
  return <div role="status" data-testid="expense-cancellation-notice" className="space-y-1 rounded-xl border border-error-200 bg-error-50 p-4 text-sm text-error-800">
    <p className="font-semibold">รายจ่ายนี้ถูกยกเลิกแล้ว{voidedAt ? ` · ${formatThaiDate(voidedAt)}` : ''}</p>
    {reason && <p className="break-words">เหตุผล: {reason}</p>}
    {certificate && !history?.loading && !history?.error && <p className="break-words">{certificate.certificateNumber ? `หนังสือรับรองเลขที่ ${certificate.certificateNumber} ถูกยกเลิกด้วย` : 'หนังสือรับรองถูกยกเลิกด้วย'}</p>}
  </div>;
}
