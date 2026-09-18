'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  CaptureExpenseDateChoice, CaptureFactsItem, CaptureTaxReviewEntry, EmployeeSummary,
  ExpenseCaptureBusinessUse, ExpenseCaptureFundingRoute, ExpenseCaptureGroupDetailDto,
} from '@watchdog-bms/contracts';
import { EXPENSE_VAT_MODE_LABELS, INPUT_VAT_CLAIM_STATUSES, TAX_EVIDENCE_STATUS_LABELS } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, cx } from '@/common/components/mangmee';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { apiErrorCode, apiErrorMessage, translateApiError } from '@/common/api/api-error-message';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { listEmployees, employeeShortName } from '@/features/employee-access/employee-access.api';
import { acceptCaptureAllocation, postCaptureReview } from '../expenses.api';
import { baht, btnClass, dateShort, ghostClass, inputClass, ErrorBanner, InfoBanner } from '../ExpensesUi';
import {
  captureAllocation, captureDateChoicePayload, captureDateOption, captureFactsView, captureIssuerName,
  capturePersonalFromAllocation, capturePersonalMax, captureProvenanceRows, captureScopeLabel,
  captureSelectionPayload, captureText, CAPTURE_CLAIM_STATUS_KEYS, CAPTURE_DATE_OPTION_KEYS,
  type CaptureDateOption,
} from './expense-capture-review.logic';

/**
 * "ส่วนของบริษัท" — the two questions, the split they produce and the acceptance (spec §3 steps
 * 4–6, appendix §7/§9).
 *
 * The page never decides an answer. `businessUse` and `fundingRoute` start at whatever the server
 * recorded — `UNKNOWN` means NOTHING is selected here, because a pre-ticked "ใช้สำหรับบริษัททั้งหมด"
 * is an answer the user never gave (spec §3 step 4), and the payer is never the uploader (step 5).
 *
 * Partial answers are the normal case: the button posts whatever has been answered, the server
 * stores it and returns the blockers for the rest. Nothing on this page is gated on completeness.
 */

type AllocationSectionProps = {
  companyId: string;
  group: ExpenseCaptureGroupDetailDto;
  viewerUserId: string;
  /** `expense.review`: the tax decision and naming somebody else as payer are a reviewer's (§6). */
  canReview: boolean;
  onChanged: () => Promise<void>;
};

type TaxDraft = Record<string, CaptureTaxReviewEntry>;
type DateDraft = Record<string, { option: CaptureDateOption; date: string }>;

export function CaptureAllocationSection({ companyId, group, viewerUserId, canReview, onChanged }: AllocationSectionProps) {
  const locale = useWorkspaceLocale();
  const facts = captureFactsView(group);
  const allocation = captureAllocation(group);
  const mayReview = group.allowedActions.includes('review');
  const mayAccept = group.allowedActions.includes('accept_allocation');

  const [businessUse, setBusinessUse] = useState<ExpenseCaptureBusinessUse>(group.businessUse);
  const [fundingRoute, setFundingRoute] = useState<ExpenseCaptureFundingRoute>(group.fundingRoute);
  const [payerUserId, setPayerUserId] = useState<string>(group.payerUserId ?? '');
  const [personal, setPersonal] = useState<Record<string, number>>(() => capturePersonalFromAllocation(group));
  const [tax, setTax] = useState<TaxDraft>({});
  const [dates, setDates] = useState<DateDraft>({});
  const [members, setMembers] = useState<EmployeeSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedCodes, setBlockedCodes] = useState<string[]>([]);
  const [stale, setStale] = useState(false);

  // After a mutation the server is the source of truth for every answer, so the draft is replaced.
  // Keyed on the revision, not on the object: a plain re-read (the read-status poll finishing) must
  // not wipe answers somebody is in the middle of giving.
  useEffect(() => {
    setBusinessUse(group.businessUse);
    setFundingRoute(group.fundingRoute);
    setPayerUserId(group.payerUserId ?? '');
    setPersonal(capturePersonalFromAllocation(group));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.revision]);

  // Only a reviewer may name somebody else, so only a reviewer needs the list (§6). A company
  // without employee-directory access still gets "ฉัน" and the server still checks membership.
  useEffect(() => {
    if (!canReview || fundingRoute !== 'EMPLOYEE' || members.length > 0) return;
    let cancelled = false;
    void listEmployees(companyId)
      .then((rows) => { if (!cancelled) setMembers(rows.filter((row) => row.status === 'ACTIVE')); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [canReview, companyId, fundingRoute, members.length]);

  const items = useMemo(
    () => (facts?.items ?? []).filter((item) => capturePersonalMax(item) > 0),
    [facts],
  );
  const itemsByDocument = useMemo(() => {
    const map = new Map<string, CaptureFactsItem[]>();
    for (const item of items) {
      const rows = map.get(item.documentRef) ?? [];
      rows.push(item);
      map.set(item.documentRef, rows);
    }
    return map;
  }, [items]);
  const documentLabel = useMemo(
    () => new Map((facts?.documents ?? []).map((document) => [document.ref, captureIssuerName(document)])),
    [facts],
  );

  if (!facts) return null;

  const scopes = allocation?.scopes ?? [];
  const taxOf = (scopeKey: string): CaptureTaxReviewEntry | null => {
    const stored = tax[scopeKey];
    if (stored) return stored;
    const scope = scopes.find((entry) => entry.scopeKey === scopeKey);
    return scope
      ? { vatMode: scope.vatMode, inputVatClaimStatus: scope.inputVatClaimStatus, taxEvidenceStatus: scope.taxEvidenceStatus }
      : null;
  };
  const dateOf = (scopeKey: string): { option: CaptureDateOption; date: string } => {
    const chosen = dates[scopeKey];
    if (chosen) return chosen;
    const scope = scopes.find((entry) => entry.scopeKey === scopeKey);
    return { option: scope ? captureDateOption(scope) : 'payment', date: scope?.expenseDate?.slice(0, 10) ?? '' };
  };

  const compute = async () => {
    setBusy(true); setError(null); setBlockedCodes([]); setStale(false);
    try {
      const expenseDateChoice: Record<string, CaptureExpenseDateChoice> = {};
      for (const [scopeKey, choice] of Object.entries(dates)) {
        const payload = captureDateChoicePayload(choice.option, choice.date || null);
        if (payload) expenseDateChoice[scopeKey] = payload;
      }
      await postCaptureReview(companyId, group.groupId, {
        businessUse,
        fundingRoute,
        selection: captureSelectionPayload(items, personal, businessUse),
        // COMPANY money has no payer to name; EMPLOYEE without a pick keeps whoever is recorded.
        ...(fundingRoute === 'COMPANY' ? { payerUserId: null } : payerUserId ? { payerUserId } : {}),
        // Untouched tax stays untouched: §7 forbids stamping a decision nobody made.
        ...(canReview && Object.keys(tax).length > 0 ? { taxReview: tax } : {}),
        ...(Object.keys(expenseDateChoice).length > 0 ? { expenseDateChoice } : {}),
        expectedRevision: group.revision,
      });
      await onChanged();
    } catch (cause) {
      setError(apiErrorMessage(cause));
      setStale(apiErrorCode(cause) === 'expense_capture_group_revision_conflict');
    } finally { setBusy(false); }
  };

  const accept = async () => {
    if (!group.allocation) return;
    setBusy(true); setError(null); setBlockedCodes([]); setStale(false);
    try {
      await acceptCaptureAllocation(companyId, group.groupId, group.allocation.allocationId, {
        expectedRevision: group.revision,
      });
      await onChanged();
    } catch (cause) {
      const code = apiErrorCode(cause);
      setError(apiErrorMessage(cause));
      setStale(code === 'expense_capture_group_revision_conflict' || code === 'expense_capture_allocation_stale'
        || code === 'expense_capture_allocation_not_current');
      const details = (cause as { details?: { blockers?: unknown } } | null)?.details;
      setBlockedCodes(Array.isArray(details?.blockers) ? details!.blockers.filter((entry): entry is string => typeof entry === 'string') : []);
    } finally { setBusy(false); }
  };

  const optionClass = (selected: boolean) => cx(
    'min-h-11 w-full rounded-xl border px-4 py-3 text-left text-lg',
    selected ? 'border-brand-500 bg-brand-25 font-semibold text-brand-800' : 'border-gray-200 bg-white text-gray-800',
  );

  return (
    <MangmeeCard className="p-4">
      <h2 className="text-lg font-semibold text-gray-800">{t('expenses.capture.allocation_section', locale)}</h2>
      {error && <div className="mt-3"><ErrorBanner message={error} /></div>}
      {blockedCodes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-base leading-7 text-gray-700">
          {blockedCodes.map((code) => <li key={code}>{translateApiError(code) ?? code}</li>)}
        </ul>
      )}
      {stale && (
        <button type="button" className={cx(ghostClass, 'mt-2 min-h-11 w-full sm:w-auto')} onClick={() => void onChanged()}>
          {t('expenses.capture.reload_latest', locale)}
        </button>
      )}

      {/* Question 1 — spec §3 step 4. No option is selected until the person selects one. */}
      <fieldset className="mt-4">
        <legend className="text-base font-semibold text-gray-800">{t('expenses.capture.question_business_use', locale)}</legend>
        <div className="mt-2 flex flex-col gap-2">
          <button type="button" disabled={!mayReview || busy} aria-pressed={businessUse === 'ALL_COMPANY'} className={optionClass(businessUse === 'ALL_COMPANY')} onClick={() => setBusinessUse('ALL_COMPANY')}>
            {t('expenses.capture.business_use_all', locale)}
          </button>
          <button type="button" disabled={!mayReview || busy} aria-pressed={businessUse === 'MIXED'} className={optionClass(businessUse === 'MIXED')} onClick={() => setBusinessUse('MIXED')}>
            {t('expenses.capture.business_use_mixed', locale)}
          </button>
        </div>
      </fieldset>

      {businessUse === 'MIXED' && (
        <div className="mt-4 space-y-3">
          <p className="text-base leading-7 text-gray-700">{t('expenses.capture.personal_intro', locale)}</p>
          {[...itemsByDocument.entries()].map(([documentRef, rows]) => (
            <div key={documentRef}>
              <p className="text-sm font-semibold text-gray-600">{documentLabel.get(documentRef) || documentRef}</p>
              <ul className="mt-1 space-y-2">
                {rows.map((item) => {
                  const max = capturePersonalMax(item);
                  const chosen = Math.min(personal[item.id] ?? 0, max);
                  const set = (next: number) => setPersonal((current) => ({ ...current, [item.id]: Math.min(Math.max(next, 0), max) }));
                  return (
                    <li key={item.id} className="rounded-xl border border-gray-200 bg-white p-3">
                      {/* The original row stays exactly as read; the stepper sits beside it. */}
                      <p className="text-base leading-7 text-gray-800 [overflow-wrap:anywhere]">{item.description}</p>
                      <p className="text-sm text-gray-500">
                        {item.quantity ?? '1'} × {item.unitPrice ? baht(item.unitPrice) : t('expenses.capture.unknown_value', locale)}
                        {' · '}{item.amount ? baht(item.amount) : t('expenses.capture.unknown_value', locale)}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-base text-gray-700">{t('expenses.capture.personal_qty_label', locale)}</span>
                        <button type="button" className={cx(ghostClass, 'min-h-11 w-11')} disabled={!mayReview || busy || chosen <= 0} aria-busy={Boolean(busy)} aria-label={t('expenses.capture.personal_less', locale)} onClick={() => set(chosen - 1)}>−</button>
                        <span className="min-w-8 text-center text-lg font-semibold tabular-nums text-gray-900">{chosen}</span>
                        <button type="button" className={cx(ghostClass, 'min-h-11 w-11')} disabled={!mayReview || busy || chosen >= max} aria-busy={Boolean(busy)} aria-label={t('expenses.capture.personal_more', locale)} onClick={() => set(chosen + 1)}>+</button>
                        <span className="text-sm text-gray-500">
                          {captureText(t('expenses.capture.company_qty_hint', locale), { company: String(max - chosen), quantity: String(max) })}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Question 2 — spec §3 step 5. */}
      <fieldset className="mt-4">
        <legend className="text-base font-semibold text-gray-800">{t('expenses.capture.question_payer', locale)}</legend>
        <div className="mt-2 flex flex-col gap-2">
          <button type="button" disabled={!mayReview || busy} aria-pressed={fundingRoute === 'COMPANY'} className={optionClass(fundingRoute === 'COMPANY')} onClick={() => { setFundingRoute('COMPANY'); setPayerUserId(''); }}>
            {t('expenses.capture.funding_company', locale)}
          </button>
          <button type="button" disabled={!mayReview || busy} aria-pressed={fundingRoute === 'EMPLOYEE'} className={optionClass(fundingRoute === 'EMPLOYEE')} onClick={() => { setFundingRoute('EMPLOYEE'); setPayerUserId((current) => current || viewerUserId); }}>
            {t('expenses.capture.funding_employee', locale)}
          </button>
        </div>
        {fundingRoute === 'EMPLOYEE' && (
          <label className="mt-2 block text-sm font-semibold text-gray-700">
            {t('expenses.capture.payer_select_label', locale)}
            <ThemedSelect className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={payerUserId} disabled={!mayReview || busy} onChange={(event) => setPayerUserId(event.target.value)}>
              <option value="">{t('expenses.capture.payer_pick_prompt', locale)}</option>
              <option value={viewerUserId}>{t('expenses.capture.payer_option_self', locale)}</option>
              {members.filter((member) => member.userId !== viewerUserId).map((member) => (
                <option key={member.userId} value={member.userId}>{employeeShortName(member)}</option>
              ))}
            </ThemedSelect>
            {!canReview && <span className="mt-1 block font-normal text-gray-500">{t('expenses.capture.payer_other_hint', locale)}</span>}
          </label>
        )}
      </fieldset>

      {/* Tax and the expense date, per shop — only a reviewer decides these (§6/§7, A42). */}
      {canReview && scopes.length > 0 && (
        <div className="mt-4 space-y-3">
          <h3 className="text-base font-semibold text-gray-800">{t('expenses.capture.tax_section', locale)}</h3>
          <p className="text-sm text-gray-500">{t('expenses.capture.tax_note', locale)}</p>
          {scopes.map((scope) => {
            const entry = taxOf(scope.scopeKey);
            const date = dateOf(scope.scopeKey);
            const setTaxField = (patch: Partial<CaptureTaxReviewEntry>) => setTax((current) => ({
              ...current,
              [scope.scopeKey]: { ...(entry as CaptureTaxReviewEntry), ...patch },
            }));
            return (
              <div key={scope.scopeKey} className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-base font-semibold text-gray-800">{captureScopeLabel(scope)}</p>
                <label className="mt-2 block text-sm font-semibold text-gray-700">
                  {t('expenses.capture.tax_vat_mode', locale)}
                  <ThemedSelect className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={entry?.vatMode ?? 'NEEDS_REVIEW'} disabled={busy} onChange={(event) => setTaxField({ vatMode: event.target.value as CaptureTaxReviewEntry['vatMode'] })}>
                    {Object.entries(EXPENSE_VAT_MODE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </ThemedSelect>
                </label>
                <label className="mt-2 block text-sm font-semibold text-gray-700">
                  {t('expenses.capture.tax_input_claim', locale)}
                  <ThemedSelect className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={entry?.inputVatClaimStatus ?? 'NEEDS_REVIEW'} disabled={busy} onChange={(event) => setTaxField({ inputVatClaimStatus: event.target.value as CaptureTaxReviewEntry['inputVatClaimStatus'] })}>
                    {INPUT_VAT_CLAIM_STATUSES.map((status) => (
                      <option key={status} value={status}>{t(CAPTURE_CLAIM_STATUS_KEYS[status]!, locale)}</option>
                    ))}
                  </ThemedSelect>
                </label>
                <label className="mt-2 block text-sm font-semibold text-gray-700">
                  {t('expenses.capture.tax_evidence', locale)}
                  <ThemedSelect className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={entry?.taxEvidenceStatus ?? 'NEEDS_REVIEW'} disabled={busy} onChange={(event) => setTaxField({ taxEvidenceStatus: event.target.value as CaptureTaxReviewEntry['taxEvidenceStatus'] })}>
                    {Object.entries(TAX_EVIDENCE_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </ThemedSelect>
                </label>
                <label className="mt-2 block text-sm font-semibold text-gray-700">
                  {t('expenses.capture.expense_date_label', locale)}
                  <ThemedSelect className={cx(inputClass, 'mt-1 min-h-11 w-full')} value={date.option} disabled={busy} onChange={(event) => setDates((current) => ({ ...current, [scope.scopeKey]: { ...date, option: event.target.value as CaptureDateOption } }))}>
                    {(Object.keys(CAPTURE_DATE_OPTION_KEYS) as CaptureDateOption[]).map((option) => (
                      <option key={option} value={option}>{t(CAPTURE_DATE_OPTION_KEYS[option], locale)}</option>
                    ))}
                  </ThemedSelect>
                </label>
                {date.option === 'custom' && (
                  <ThemedDate className={cx(inputClass, 'mt-2 min-h-11 w-full')} value={date.date} onChange={(event) => setDates((current) => ({ ...current, [scope.scopeKey]: { option: 'custom', date: event.target.value } }))} />
                )}
                <p className="mt-1 text-sm text-gray-500">
                  {t('expenses.capture.expense_date_current', locale)} {scope.expenseDate ? dateShort(scope.expenseDate) : t('expenses.capture.unknown_value', locale)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {mayReview && (
        <div className="mt-4">
          <button type="button" className={cx(btnClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void compute()}>
            {t('expenses.capture.compute', locale)}
          </button>
          <p className="mt-1 text-sm text-gray-500">{t('expenses.capture.compute_partial_hint', locale)}</p>
        </div>
      )}

      {allocation && (
        <div className="mt-4 space-y-3">
          <h3 className="text-base font-semibold text-gray-800">{t('expenses.capture.preview_title', locale)}</h3>
          {allocation.outcome === 'NO_COMPANY_PORTION' && (
            <InfoBanner message={t('expenses.capture.no_company_portion_result', locale)} />
          )}
          {allocation.scopes.map((scope) => (
            <div key={scope.scopeKey} className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-base leading-7 text-gray-800">
                {captureText(t('expenses.capture.scope_line', locale), {
                  issuer: captureScopeLabel(scope), company: baht(scope.companyAmount),
                  personal: baht(scope.personalAmount), paid: baht(scope.paidTotal),
                })}
              </p>
              <p className="mt-1">
                <MangmeeBadge tone={scope.claimReady ? 'brand' : 'amber'}>
                  {t(scope.claimReady ? 'expenses.capture.claim_ready' : 'expenses.capture.claim_waiting_tax', locale)}
                </MangmeeBadge>
              </p>
              <details className="mt-2">
                <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold text-brand-700">
                  {t('expenses.capture.provenance_toggle', locale)}
                </summary>
                <ul className="mt-1 space-y-1 text-base leading-7 text-gray-700">
                  {scope.lines.map((line) => (
                    <li key={line.itemId}>
                      <span className="font-semibold [overflow-wrap:anywhere]">{line.description}</span>
                      <ul className="ml-4 list-disc">
                        {captureProvenanceRows(line).map((row, index) => (
                          <li key={`${line.itemId}-${index}`}>
                            {row.kind === 'base' && `${t('expenses.capture.provenance_base', locale)} ${baht(row.amount)}`}
                            {row.kind === 'discount' && `${t('expenses.capture.provenance_discount', locale)} ${baht(row.amount)}${row.remainderAdjust ? ` (${t('expenses.capture.provenance_remainder', locale)})` : ''}`}
                            {row.kind === 'shipping' && `${t('expenses.capture.provenance_shipping', locale)} ${baht(row.amount)}`}
                            {row.kind === 'quantity' && captureText(t('expenses.capture.provenance_qty', locale), { company: row.company, quantity: row.quantity })
                              + (row.inferred ? ` (${t('expenses.capture.provenance_qty_inferred', locale)})` : '')}
                          </li>
                        ))}
                      </ul>
                      <p className="ml-4 text-sm text-gray-500">
                        {t('expenses.capture.provenance_line_total', locale)} {baht(line.totals.lineTotalAmount)}
                      </p>
                    </li>
                  ))}
                  {scope.charges.map((charge, index) => (
                    <li key={`charge-${index}`}>
                      {charge.description} · {baht(charge.totals.lineTotalAmount)}
                    </li>
                  ))}
                  <li className="text-sm text-gray-500">{t('expenses.capture.provenance_identity_ok', locale)} {baht(scope.totals.grandTotal)}</li>
                </ul>
              </details>
            </div>
          ))}
          {group.allocation?.status === 'ACCEPTED' && (
            <p><MangmeeBadge tone="brand">{t('expenses.capture.accepted_badge', locale)}</MangmeeBadge></p>
          )}
          {mayAccept && (
            <div>
              <button type="button" className={cx(btnClass, 'min-h-11 w-full sm:w-auto')} disabled={busy} aria-busy={Boolean(busy)} onClick={() => void accept()}>
                {t('expenses.capture.accept', locale)}
              </button>
              <p className="mt-1 text-sm text-gray-500">{t('expenses.capture.accept_hint', locale)}</p>
            </div>
          )}
        </div>
      )}
    </MangmeeCard>
  );
}
