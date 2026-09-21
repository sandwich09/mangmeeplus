'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SwitchField } from '@/common/components/field';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { CoverLoader, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { formatThaiDate } from '@/common/i18n/thai-date';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { ApiError } from '@/common/models/api-error.model';
import { baht, btnClass, err, ghostClass } from '@/features/expenses/ExpensesUi';
import { CounterpartyAddressFields, CounterpartyContactFields, CounterpartyIdentityFields } from './CounterpartyFields';
import { getCounterparty, promoteSeenAddress, updateCounterparty } from './counterparties.api';
import {
  counterpartyAddress,
  counterpartyAddressMissing,
  counterpartyFormIssue,
  counterpartyFormValues,
  counterpartyPayload,
  counterpartyUsageBadges,
} from './counterparties.logic';
import {
  COUNTERPARTY_MANAGE_PERMISSION,
  COUNTERPARTY_READ_PERMISSION,
  type CounterpartyAddressView,
  type CounterpartyDetail,
  type CounterpartyFormIssue,
  type CounterpartyFormValues,
} from './counterparties.model';

const PROVENANCE_SOURCE_KEYS = {
  MANUAL: 'counterparties.provenance_source_manual',
  EXPENSE_AUTO: 'counterparties.provenance_source_expense_auto',
  RD_LOOKUP: 'counterparties.provenance_source_rd_lookup',
  OCR: 'counterparties.provenance_source_ocr',
  PROCUREMENT: 'counterparties.provenance_source_procurement',
} as const;

const VAT_STATUS_KEYS = {
  VAT_REGISTERED: 'counterparties.vat_registered',
  NOT_REGISTERED: 'counterparties.vat_not_registered',
  UNKNOWN: 'counterparties.vat_unknown',
} as const;

function withParams(message: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), message);
}

/** §11.1 "conflict เมื่อมีคนแก้พร้อมกัน": the refusal has to carry the reload, not just the word. */
function isConflict(cause: unknown): boolean {
  return cause instanceof ApiError && (cause.code ?? '').startsWith('counterparty_conflict');
}

export function CounterpartyDetailPage({ companyId, counterpartyId, permissions }: {
  companyId: string;
  counterpartyId: string;
  permissions: readonly string[];
}) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const canRead = permissions.includes(COUNTERPARTY_READ_PERMISSION);
  const canManage = permissions.includes(COUNTERPARTY_MANAGE_PERMISSION);

  const [detail, setDetail] = useState<CounterpartyDetail | null>(null);
  const [values, setValues] = useState<CounterpartyFormValues>(() => counterpartyFormValues(null));
  const [issue, setIssue] = useState<CounterpartyFormIssue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ message: string; stale: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);

  // Only a different counterparty empties the screen. A re-read after a save keeps the page on
  // show under the cover loader, so "บันทึกข้อมูลคู่ค้าแล้ว" is not replaced by a spinner the
  // moment it appears.
  useEffect(() => { setDetail(null); }, [companyId, counterpartyId]);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    setLoadError(null);
    setRefreshing(true);
    getCounterparty(companyId, counterpartyId)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setValues(counterpartyFormValues(result));
        setIssue(null);
      })
      .catch((cause) => { if (active) setLoadError(err(cause, locale)); })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [canRead, companyId, counterpartyId, reload, locale]);

  const change = useCallback((next: Partial<CounterpartyFormValues>) => {
    setValues((current) => ({ ...current, ...next }));
    setIssue(null);
    setSaved(false);
  }, []);

  if (!canRead) {
    return (
      <MangmeePage title={t('counterparties.title', locale)}>
        <MangmeeCard className="p-4">
          <ForbiddenState
            title={t('counterparties.forbidden', locale)}
            description={t('counterparties.forbidden_help', locale)}
            helpText={t('counterparties.forbidden_help', locale)}
            locale={locale}
          />
        </MangmeeCard>
      </MangmeePage>
    );
  }

  const backLink = (
    <Link href={`/companies/${encodeURIComponent(companyId)}/counterparties`} className="mangmee-btn mangmee-btn-secondary">
      {t('counterparties.back_to_list', locale)}
    </Link>
  );

  if (loadError || !detail) {
    return (
      <MangmeePage title={t('counterparties.title', locale)} actions={backLink}>
        <MangmeeCard className="p-4">
          {loadError
            ? <ErrorState title={t('counterparties.load_failed', locale)} description={loadError} onRetry={() => setReload((value) => value + 1)} locale={locale} />
            : <LoadingState label={t('counterparties.loading', locale)} />}
        </MangmeeCard>
      </MangmeePage>
    );
  }

  const address = counterpartyAddress(detail.billingAddressJson);

  const save = async () => {
    const found = counterpartyFormIssue(values);
    if (found) { setIssue(found); setSaved(false); return; }
    setBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      await updateCounterparty(companyId, counterpartyId, {
        ...counterpartyPayload(values),
        // §11.1: the version this screen loaded. A mismatch answers `counterparty_conflict`
        // instead of overwriting someone else's edit.
        expectedUpdatedAt: detail.updatedAt,
      });
      setReload((value) => value + 1);
      setSaved(true);
      toast.success(t('counterparties.saved', locale));
    } catch (cause) {
      setSaveError({ message: err(cause, locale), stale: isConflict(cause) });
    } finally {
      setBusy(false);
    }
  };

  const promote = async (addressText: string) => {
    setBusy(true);
    setSaveError(null);
    setSaved(false);
    try {
      // §11.1/§15: same conflict handling as `save()` below — a stale token answers
      // `counterparty_conflict`, which the shared catch block turns into the reload prompt.
      await promoteSeenAddress(companyId, counterpartyId, addressText, detail.updatedAt);
      setReload((value) => value + 1);
      toast.success(t('counterparties.history_promoted', locale));
    } catch (cause) {
      setSaveError({ message: err(cause, locale), stale: isConflict(cause) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <MangmeePage
      eyebrow={t('counterparties.title', locale)}
      title={detail.displayName}
      actions={backLink}
      meta={<UsageBadges detail={detail} locale={locale} />}
    >
      <CoverLoader active={busy || refreshing} scope="page" label={t('counterparties.saving', locale)}>
        <div className="flex flex-col gap-4">
          {!canManage && (
            <p className="mangmee-card-muted rounded-xl p-3 text-sm text-gray-600">{t('counterparties.read_only', locale)}</p>
          )}
          {saveError && (
            <div role="alert" className="rounded-xl border border-error-500/20 bg-error-50 p-3 text-sm font-semibold text-error-700">
              <p>{saveError.message}</p>
              {saveError.stale && (
                <button type="button" className={cx(ghostClass, 'mt-2')} onClick={() => setReload((value) => value + 1)}>
                  {t('state.error.retry', locale)}
                </button>
              )}
            </div>
          )}
          {saved && !saveError && (
            <p role="status" className="rounded-xl border border-brand-100 bg-brand-25 p-3 text-sm font-semibold text-brand-700">
              {t('counterparties.saved', locale)}
            </p>
          )}

          <MangmeeCard className="space-y-4 p-4">
            <h2 className="font-semibold text-gray-800">{t('counterparties.section_identity', locale)}</h2>
            <CounterpartyIdentityFields values={values} onChange={change} disabled={!canManage || busy} issue={issue} allowUnspecifiedEntityKind={!detail.entityKind} />
            <p className="text-xs text-gray-500">
              {t('counterparties.vat_status', locale)}: {t(VAT_STATUS_KEYS[detail.vatStatus ?? 'UNKNOWN'], locale)}
            </p>
          </MangmeeCard>

          <MangmeeCard className="space-y-4 p-4">
            <h2 className="font-semibold text-gray-800">{t('counterparties.section_address', locale)}</h2>
            <CounterpartyAddressFields values={values} onChange={change} disabled={!canManage || busy} issue={issue} />
            <ProvenanceLine address={address} detail={detail} locale={locale} />
          </MangmeeCard>

          <AddressHistoryCard
            address={address}
            values={values}
            onChange={change}
            canManage={canManage}
            busy={busy}
            locale={locale}
            onPromote={(text) => void promote(text)}
          />

          <MangmeeCard className="space-y-4 p-4">
            <h2 className="font-semibold text-gray-800">{t('counterparties.section_contact', locale)}</h2>
            <CounterpartyContactFields values={values} onChange={change} disabled={!canManage || busy} />
          </MangmeeCard>

          <RecentExpensesCard companyId={companyId} detail={detail} locale={locale} />

          {canManage && (
            <div className="mangmee-safe-bottom flex justify-end">
              <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={() => void save()}>
                {busy ? t('counterparties.saving', locale) : t('counterparties.save', locale)}
              </button>
            </div>
          )}
        </div>
      </CoverLoader>
    </MangmeePage>
  );
}

/** A5: what the documents say, in place of the customer/vendor picker this screen no longer has. */
function UsageBadges({ detail, locale }: { detail: CounterpartyDetail; locale: SupportedLocale }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {counterpartyUsageBadges(detail).map((badge) => (
        <MangmeeBadge key={badge.messageKey} tone={badge.tone}>{withParams(t(badge.messageKey, locale), badge.params)}</MangmeeBadge>
      ))}
      {counterpartyAddressMissing(detail) && (
        <MangmeeBadge tone="amber">{t('counterparties.badge_address_missing', locale)}</MangmeeBadge>
      )}
    </div>
  );
}

/**
 * §11.1 "บรรทัดที่มา". `provenance.userId` is an id, not a name, and this screen has no directory
 * to resolve it with — printing a raw id would be noise, so the line names the source, the date
 * and, when the document is one of the five recent ones, its number.
 */
function ProvenanceLine({ address, detail, locale }: { address: CounterpartyAddressView; detail: CounterpartyDetail; locale: SupportedLocale }) {
  if (!address.provenance || !address.addressText) return null;
  const document = detail.recentExpenses?.find((expense) => expense.id === address.provenance?.expenseId);
  const line = withParams(t('counterparties.provenance_line', locale), {
    source: t(PROVENANCE_SOURCE_KEYS[address.provenance.source] ?? PROVENANCE_SOURCE_KEYS.MANUAL, locale),
    date: formatThaiDate(address.provenance.at),
  });
  return (
    <p className="text-xs text-gray-500">
      {line}
      {document?.vendorDocumentNumber
        ? ` · ${withParams(t('counterparties.provenance_document', locale), { document: document.vendorDocumentNumber })}`
        : ''}
    </p>
  );
}

/**
 * §11.1/§7: the ONLY place a person decides about a primary address. The expense review page shows
 * one information line and no control at all (A4), so this card is where the lock and the swap live.
 */
function AddressHistoryCard({ address, values, onChange, canManage, busy, locale, onPromote }: {
  address: CounterpartyAddressView;
  values: CounterpartyFormValues;
  onChange: (next: Partial<CounterpartyFormValues>) => void;
  canManage: boolean;
  busy: boolean;
  locale: SupportedLocale;
  onPromote: (addressText: string) => void;
}) {
  return (
    <MangmeeCard className="space-y-4 p-4">
      <div className="flex flex-col gap-3">
        <h2 className="font-semibold text-gray-800">{t('counterparties.section_history', locale)}</h2>
        <SwitchField
          label={t('counterparties.lock_primary', locale)}
          name="counterparty-address-locked"
          hint={t('counterparties.lock_primary_hint', locale)}
          checked={values.locked}
          disabled={!canManage || busy}
          onChange={(event) => onChange({ locked: event.target.checked })}
        />
      </div>
      <ul className="flex flex-col gap-2">
        {values.addressText.trim() && (
          <li className="mangmee-card-muted flex flex-col gap-2 rounded-xl p-3">
            <MangmeeBadge tone="brand">{t('counterparties.history_primary', locale)}</MangmeeBadge>
            <p className="break-words text-sm text-gray-700">{address.addressText || values.addressText}</p>
          </li>
        )}
        {address.seenOnDocuments.length === 0 ? (
          <li className="text-sm text-gray-500">{t('counterparties.history_empty', locale)}</li>
        ) : address.seenOnDocuments.map((entry) => (
          <li key={`${entry.expenseId}-${entry.at}`} className="mangmee-card-muted flex flex-col gap-2 rounded-xl p-3">
            <p className="break-words text-sm text-gray-700">{entry.addressText}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-gray-400">{formatThaiDate(entry.at)}</span>
              {canManage && (
                <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => onPromote(entry.addressText)}>
                  {busy ? t('counterparties.history_promoting', locale) : t('counterparties.history_use_primary', locale)}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </MangmeeCard>
  );
}

function RecentExpensesCard({ companyId, detail, locale }: { companyId: string; detail: CounterpartyDetail; locale: SupportedLocale }) {
  const expenses = detail.recentExpenses ?? [];
  return (
    <MangmeeCard className="space-y-3 p-4">
      <h2 className="font-semibold text-gray-800">{t('counterparties.section_recent_expenses', locale)}</h2>
      {expenses.length === 0 ? (
        <p className="text-sm text-gray-500">{t('counterparties.recent_expenses_empty', locale)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {expenses.map((expense) => (
            <li key={expense.id}>
              <Link
                href={`/companies/${encodeURIComponent(companyId)}/expenses/${encodeURIComponent(expense.id)}`}
                className="mangmee-card-muted flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-xl p-3 text-sm transition-colors hover:border-brand-200"
              >
                <span className="min-w-0 break-words text-gray-700">
                  {expense.vendorDocumentNumber || formatThaiDate(expense.expenseDate)}
                </span>
                <span className="font-semibold text-gray-800">{baht(expense.grandTotalAmount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MangmeeCard>
  );
}
