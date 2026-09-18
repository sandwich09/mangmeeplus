'use client';

import { useMemo, useState } from 'react';
import type {
  CaptureFactsComponent, CaptureFactsDocument, CaptureFactsItem, CaptureFactsPatch,
  ExpenseCaptureGroupDetailDto,
} from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, cx } from '@/common/components/mangmee';
import { apiErrorCode, apiErrorMessage } from '@/common/api/api-error-message';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { postCaptureFacts } from '../expenses.api';
import { baht, btnClass, dateShort, ghostClass, ErrorBanner, inputClass } from '../ExpensesUi';
import {
  captureComponentRoleKey, captureFactsView, captureIssuerName, captureItemEventKey,
  capturePaymentNoticeKey, captureReconciliationChip,
} from './expense-capture-review.logic';

/**
 * "ข้อมูลที่อ่านได้จากหลักฐาน" — one card per document (appendix §11, spec §13.4).
 *
 * Two rules run through every line here:
 * - an amount nobody could read is "ไม่ทราบ", never 0 (spec §6 rule 9). `amount(value)` is the only
 *   place a missing number is turned into words, so no cell can quietly render ฿0.00 instead;
 * - editing is a correction of what the READER saw, so it goes through `POST …/facts` as a new
 *   observation and the page re-reads afterwards. Nothing here writes into the rendered facts.
 */

type FactsSectionProps = {
  companyId: string;
  group: ExpenseCaptureGroupDetailDto;
  /** `review` in `allowedActions`: §6 gives facts editing the same authority as the review. */
  canEdit: boolean;
  onChanged: () => Promise<void>;
  onOpenPage: (fileId: string, pageIndex: number | null) => void;
};

type ItemDraft = { description: string; quantity: string; unitPrice: string; amount: string };
type DocumentDraft = {
  issuerName: string; documentNumber: string; documentDate: string;
  documentTotal: string; buyerPayable: string; reportedPaid: string;
};

const value = (raw: string | undefined | null): string => (typeof raw === 'string' ? raw : '');
/** `''` means "unknown" in this form, and unknown is a value the server stores as `null`. */
const patched = (next: string, before: string | undefined): string | null | undefined => {
  const trimmed = next.trim();
  if (trimmed === value(before).trim()) return undefined;
  return trimmed === '' ? null : trimmed;
};

export function CaptureFactsSection({ companyId, group, canEdit, onChanged, onOpenPage }: FactsSectionProps) {
  const locale = useWorkspaceLocale();
  const facts = captureFactsView(group);
  const [editing, setEditing] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, ItemDraft>>({});
  const [documentDraft, setDocumentDraft] = useState<DocumentDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const byDocument = useMemo(() => {
    const map = new Map<string, { items: CaptureFactsItem[]; components: CaptureFactsComponent[] }>();
    for (const doc of facts?.documents ?? []) map.set(doc.ref, { items: [], components: [] });
    for (const item of facts?.items ?? []) map.get(item.documentRef)?.items.push(item);
    for (const component of facts?.components ?? []) map.get(component.documentRef)?.components.push(component);
    return map;
  }, [facts]);

  if (!facts || facts.documents.length === 0) {
    return (
      <MangmeeCard className="p-4">
        <h2 className="text-lg font-semibold text-gray-800">{t('expenses.capture.facts_section', locale)}</h2>
        <p className="mt-2 text-base leading-7 text-gray-500">{t('expenses.capture.facts_none', locale)}</p>
      </MangmeeCard>
    );
  }

  const unknown = t('expenses.capture.unknown_value', locale);
  const amount = (raw: string | undefined | null) => (raw === undefined || raw === null || raw === '' ? unknown : baht(raw));
  /** The file's latest observation was a person's correction — §13.2 keeps the two provenances apart. */
  const editedByHuman = (fileId: string) => facts.files.some((file) => file.fileId === fileId && file.source === 'HUMAN');

  const startEdit = (doc: CaptureFactsDocument) => {
    const rows = byDocument.get(doc.ref)?.items ?? [];
    setItems(Object.fromEntries(rows.map((item) => [item.id, {
      description: value(item.description), quantity: value(item.quantity),
      unitPrice: value(item.unitPrice), amount: value(item.amount),
    }])));
    setDocumentDraft({
      issuerName: value(doc.issuer?.name), documentNumber: value(doc.documentNumber),
      documentDate: value(doc.documentDate).slice(0, 10),
      documentTotal: value(doc.state.documentTotal), buyerPayable: value(doc.state.buyerPayable),
      reportedPaid: value(doc.state.reportedPaid),
    });
    setError(null);
    setEditing(doc.ref);
  };

  const save = async (source: CaptureFactsDocument) => {
    if (!documentDraft) return;
    const rows = byDocument.get(source.ref)?.items ?? [];
    const patch: CaptureFactsPatch = {};
    const itemPatches = rows.flatMap((item) => {
      const draft = items[item.id];
      if (!draft) return [];
      const entry = {
        id: item.id,
        ...(draft.description.trim() !== value(item.description).trim() ? { description: draft.description.trim() } : {}),
        ...(patched(draft.quantity, item.quantity) !== undefined ? { quantity: patched(draft.quantity, item.quantity) } : {}),
        ...(patched(draft.unitPrice, item.unitPrice) !== undefined ? { unitPrice: patched(draft.unitPrice, item.unitPrice) } : {}),
        ...(patched(draft.amount, item.amount) !== undefined ? { amount: patched(draft.amount, item.amount) } : {}),
      };
      return Object.keys(entry).length > 1 ? [entry] : [];
    });
    if (itemPatches.length > 0) patch.items = itemPatches;
    const documentPatch = {
      ref: source.ref,
      ...(patched(documentDraft.issuerName, source.issuer?.name) !== undefined ? { issuerName: patched(documentDraft.issuerName, source.issuer?.name) } : {}),
      ...(patched(documentDraft.documentNumber, source.documentNumber) !== undefined ? { documentNumber: patched(documentDraft.documentNumber, source.documentNumber) } : {}),
      ...(patched(documentDraft.documentDate, value(source.documentDate).slice(0, 10)) !== undefined
        ? { documentDate: patched(documentDraft.documentDate, value(source.documentDate).slice(0, 10)) } : {}),
    };
    if (Object.keys(documentPatch).length > 1) patch.documents = [documentPatch];
    const totals = ([
      ['document_total', documentDraft.documentTotal, source.state.documentTotal],
      ['buyer_payable', documentDraft.buyerPayable, source.state.buyerPayable],
      ['reported_paid', documentDraft.reportedPaid, source.state.reportedPaid],
    ] as const).flatMap(([kind, next, before]) => {
      const change = patched(next, before);
      return change === undefined ? [] : [{ documentRef: source.ref, kind, amount: change }];
    });
    if (totals.length > 0) patch.totals = totals;

    setSaving(true); setError(null); setStale(false);
    try {
      await postCaptureFacts(companyId, group.groupId, {
        fileId: source.fileId, patch, expectedRevision: group.revision,
      });
      setEditing(null);
      // Re-read rather than patch what is on screen: the server re-assembles and re-reconciles.
      await onChanged();
    } catch (cause) {
      setError(apiErrorMessage(cause));
      // UXE-21: somebody changed this group while the form was open — the way out is the latest
      // data, not a second save of what is now the wrong revision.
      setStale(apiErrorCode(cause) === 'expense_capture_group_revision_conflict');
    } finally { setSaving(false); }
  };

  return (
    <MangmeeCard className="p-4">
      <h2 className="text-lg font-semibold text-gray-800">{t('expenses.capture.facts_section', locale)}</h2>
      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      {stale && (
        <button type="button" className={cx(ghostClass, 'mt-2 min-h-11 w-full sm:w-auto')} onClick={() => void onChanged()}>
          {t('expenses.capture.reload_latest', locale)}
        </button>
      )}
      <ul className="mt-3 space-y-4">
        {facts.documents.map((doc) => {
          const rows = byDocument.get(doc.ref) ?? { items: [], components: [] };
          const chip = captureReconciliationChip(doc.state);
          const isEditing = editing === doc.ref;
          return (
            <li key={doc.ref} className="rounded-xl border border-gray-200 bg-white p-3.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-semibold text-gray-900">
                  {captureIssuerName(doc) ?? t('expenses.capture.facts_issuer_unknown', locale)}
                </span>
                <MangmeeBadge tone={chip.tone}>{t(chip.key, locale)}</MangmeeBadge>
                {editedByHuman(doc.fileId) && (
                  <span className="text-sm text-gray-500">{t('expenses.capture.human_edited', locale)}</span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                {t('expenses.capture.facts_document_number', locale)}: {doc.documentNumber || unknown}
                {' · '}
                {t('expenses.capture.facts_document_date', locale)}: {doc.documentDate ? dateShort(doc.documentDate) : unknown}
              </p>
              <p className="mt-2 text-base leading-7 text-gray-700">
                {t('expenses.capture.total_document', locale)} {amount(doc.state.documentTotal)}
                {' · '}{t('expenses.capture.total_buyer_payable', locale)} {amount(doc.state.buyerPayable)}
                {' · '}{t('expenses.capture.total_reported_paid', locale)} {amount(doc.state.reportedPaid)}
              </p>
              <p className="mt-1 text-base leading-7 text-gray-700">{t(capturePaymentNoticeKey(doc.state), locale)}</p>

              {/* The table scrolls inside this box; the page itself never scrolls sideways. */}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-base">
                  <thead className="text-sm text-gray-500">
                    <tr>
                      <th className="py-1 pr-2 font-semibold">{t('expenses.capture.col_description', locale)}</th>
                      <th className="py-1 pr-2 font-semibold">{t('expenses.capture.col_qty', locale)}</th>
                      <th className="py-1 pr-2 font-semibold">{t('expenses.capture.col_unit_price', locale)}</th>
                      <th className="py-1 font-semibold">{t('expenses.capture.col_amount', locale)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.items.map((item) => {
                      const eventKey = captureItemEventKey(item.event);
                      const draft = items[item.id];
                      return (
                        <tr key={item.id} className="border-t border-gray-100 align-top">
                          <td className="py-2 pr-2">
                            {isEditing && draft
                              ? <input className={cx(inputClass, 'min-h-11 w-full')} aria-label={t('expenses.capture.col_description', locale)} value={draft.description} onChange={(event) => setItems((current) => ({ ...current, [item.id]: { ...draft, description: event.target.value } }))} />
                              : <span className="[overflow-wrap:anywhere]">{item.description || unknown}</span>}
                            {eventKey && <span className="ml-2"><MangmeeBadge tone="amber">{t(eventKey, locale)}</MangmeeBadge></span>}
                          </td>
                          <td className="py-2 pr-2">
                            {isEditing && draft
                              ? <input inputMode="decimal" className={cx(inputClass, 'min-h-11 w-20')} aria-label={t('expenses.capture.col_qty', locale)} value={draft.quantity} onChange={(event) => setItems((current) => ({ ...current, [item.id]: { ...draft, quantity: event.target.value } }))} />
                              : item.quantity || unknown}
                          </td>
                          <td className="py-2 pr-2 tabular-nums">
                            {isEditing && draft
                              ? <input inputMode="decimal" className={cx(inputClass, 'min-h-11 w-28')} aria-label={t('expenses.capture.col_unit_price', locale)} value={draft.unitPrice} onChange={(event) => setItems((current) => ({ ...current, [item.id]: { ...draft, unitPrice: event.target.value } }))} />
                              : amount(item.unitPrice)}
                          </td>
                          <td className="py-2 tabular-nums">
                            {isEditing && draft
                              ? <input inputMode="decimal" className={cx(inputClass, 'min-h-11 w-28')} aria-label={t('expenses.capture.col_amount', locale)} value={draft.amount} onChange={(event) => setItems((current) => ({ ...current, [item.id]: { ...draft, amount: event.target.value } }))} />
                              : amount(item.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {rows.components.length > 0 && (
                <ul className="mt-3 space-y-1 text-base leading-7 text-gray-700">
                  {rows.components.map((component) => (
                    <li key={component.id}>
                      {component.label || unknown} · {t(captureComponentRoleKey(component), locale)} · {amount(component.amount)}
                    </li>
                  ))}
                </ul>
              )}

              {isEditing && documentDraft && (
                <div className="mt-3 space-y-2">
                  <p className="text-sm text-gray-500">{t('expenses.capture.edit_facts_hint', locale)}</p>
                  <label className="block text-sm font-semibold text-gray-700">
                    {t('expenses.capture.facts_issuer', locale)}
                    <input className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={documentDraft.issuerName} onChange={(event) => setDocumentDraft({ ...documentDraft, issuerName: event.target.value })} />
                  </label>
                  <label className="block text-sm font-semibold text-gray-700">
                    {t('expenses.capture.facts_document_date', locale)}
                    <input type="date" className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={documentDraft.documentDate} onChange={(event) => setDocumentDraft({ ...documentDraft, documentDate: event.target.value })} />
                  </label>
                  <label className="block text-sm font-semibold text-gray-700">
                    {t('expenses.capture.total_document', locale)}
                    <input inputMode="decimal" className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={documentDraft.documentTotal} onChange={(event) => setDocumentDraft({ ...documentDraft, documentTotal: event.target.value })} />
                  </label>
                  <label className="block text-sm font-semibold text-gray-700">
                    {t('expenses.capture.total_buyer_payable', locale)}
                    <input inputMode="decimal" className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={documentDraft.buyerPayable} onChange={(event) => setDocumentDraft({ ...documentDraft, buyerPayable: event.target.value })} />
                  </label>
                  <label className="block text-sm font-semibold text-gray-700">
                    {t('expenses.capture.total_reported_paid', locale)}
                    <input inputMode="decimal" className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={documentDraft.reportedPaid} onChange={(event) => setDocumentDraft({ ...documentDraft, reportedPaid: event.target.value })} />
                  </label>
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} onClick={() => onOpenPage(doc.fileId, doc.pageIndexes?.[0] ?? null)}>
                  {t('expenses.capture.view_source_page', locale)}
                </button>
                {canEdit && !isEditing && (
                  <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} onClick={() => startEdit(doc)}>
                    {t('expenses.capture.edit_facts', locale)}
                  </button>
                )}
                {canEdit && isEditing && (
                  <>
                    <button type="button" className={cx(btnClass, 'min-h-11 w-full sm:w-auto')} disabled={saving} aria-busy={Boolean(saving)} onClick={() => void save(doc)}>
                      {t('expenses.capture.edit_facts_save', locale)}
                    </button>
                    <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} disabled={saving} onClick={() => { setEditing(null); setError(null); }}>
                      {t('expenses.capture.edit_facts_cancel', locale)}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </MangmeeCard>
  );
}
