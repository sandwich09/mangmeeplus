'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { FormActionBar } from '@/common/components/actions/FormActionBar';
import { expenseDetailUrl } from '@/features/expenses/expense-list-navigation.logic';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { BackLink } from '@/common/components/app-shell/BackLink';
import { useUnsavedNavigation } from '@/common/components/unsaved-navigation/use-unsaved-navigation';
import { SwitchField } from '@/common/components/field';
import { MangmeeBadge, MangmeeCard, MangmeePage } from '@/common/components/mangmee';
import { Notice } from '@/common/components/notice';
import { CoverLoader, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { formatThaiDate } from '@/common/i18n/thai-date';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { ApiError } from '@/common/models/api-error.model';
import { amountText, btnClass, err, ghostClass } from '@/features/expenses/ExpensesUi';
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
  const canReadRegistry = permissions.includes(COUNTERPARTY_READ_PERMISSION)
    || permissions.includes(COUNTERPARTY_MANAGE_PERMISSION);

  const [detail, setDetail] = useState<CounterpartyDetail | null>(null);
  const [values, setValues] = useState<CounterpartyFormValues>(() => counterpartyFormValues(null));
  const [issue, setIssue] = useState<CounterpartyFormIssue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [saveError, setSaveError] = useState<{ message: string; stale: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [reload, setReload] = useState(0);

  // Only a different counterparty empties the screen. A re-read after a save keeps the page on
  // show under the cover loader, so "บันทึกข้อมูลคู่ค้าแล้ว" is not replaced by a spinner the
  // moment it appears.
  useEffect(() => { setDetail(null); }, [companyId, counterpartyId]);

  // Always asked, never pre-gated on `accounting.counterparty.read`: whoever added the row may open
  // it too (owner 2026-09-25), and only the server knows who that was. Its 403 is the refusal.
  useEffect(() => {
    let active = true;
    setLoadError(null);
    setForbidden(false);
    setRefreshing(true);
    getCounterparty(companyId, counterpartyId)
      .then((result) => {
        if (!active) return;
        setDetail(result);
        setValues(counterpartyFormValues(result));
        setIssue(null);
      })
      .catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && (cause.kind === 'forbidden' || (!canReadRegistry && cause.kind === 'not_found'))) setForbidden(true);
        else setLoadError(err(cause, locale));
      })
      .finally(() => { if (active) setRefreshing(false); });
    return () => { active = false; };
  }, [canReadRegistry, companyId, counterpartyId, reload, locale]);

  const dirty = detail !== null && JSON.stringify(values) !== JSON.stringify(counterpartyFormValues(detail));
  // Two choices only: the shared dialog's third button is named for a draft, and this page has none.
  const navigation = useUnsavedNavigation({ dirty, canSave: false, saving: busy, error: null, onSave: async () => false,
    title: 'ยังไม่ได้บันทึกสิ่งที่แก้', description: 'ถ้าออกตอนนี้ สิ่งที่แก้ไว้จะหาย กด “อยู่ต่อ” แล้วกด “บันทึก” เพื่อเก็บไว้' });

  const change = useCallback((next: Partial<CounterpartyFormValues>) => {
    setValues((current) => ({ ...current, ...next }));
    setIssue(null);
  }, []);

  if (forbidden) {
    return (
      <MangmeePage className="mangmee-flat" title={t('counterparties.title', locale)}>
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

  // The list needs `accounting.counterparty.read`; someone who only added this row would land on a refusal.
  const backLink = canReadRegistry
    ? <BackLink href={`/companies/${encodeURIComponent(companyId)}/counterparties`} label={t('counterparties.back_to_list', locale)} />
    : undefined;

  if (loadError || !detail) {
    return (
      <MangmeePage className="mangmee-flat" title={t('counterparties.title', locale)} back={backLink}>
        <MangmeeCard className="p-4">
          {loadError
            ? <ErrorState title={t('counterparties.load_failed', locale)} description={loadError} onRetry={() => setReload((value) => value + 1)} locale={locale} />
            : <LoadingState label={t('counterparties.loading', locale)} />}
        </MangmeeCard>
      </MangmeePage>
    );
  }

  // The server decides (`canEdit`); the permission is only the fallback for an older API.
  const canManage = detail.canEdit ?? permissions.includes(COUNTERPARTY_MANAGE_PERMISSION);
  const address = counterpartyAddress(detail.billingAddressJson);

  const save = async (): Promise<boolean> => {
    const found = counterpartyFormIssue(values);
    if (found) { setIssue(found); return false; }
    setBusy(true);
    setSaveError(null);
    try {
      await updateCounterparty(companyId, counterpartyId, {
        ...counterpartyPayload(values),
        // §11.1: the version this screen loaded. A mismatch answers `counterparty_conflict`
        // instead of overwriting someone else's edit.
        expectedUpdatedAt: detail.updatedAt,
      });
      setReload((value) => value + 1);
      toast.success(t('counterparties.saved', locale));
      return true;
    } catch (cause) {
      setSaveError({ message: err(cause, locale), stale: isConflict(cause) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const promote = async (addressText: string) => {
    setBusy(true);
    setSaveError(null);
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

  // Order of the work: what can be typed (who, where, how to reach them), then the save button, then what the system keeps for reading.
  return (
    <MangmeePage
      className="mangmee-flat"
      back={backLink}
      title={detail.displayName}
      description={<UsageBadges detail={detail} locale={locale} />}
    >
      <CoverLoader active={busy || refreshing} scope="page" label={t('counterparties.saving', locale)}>
        <div className="flex flex-col gap-4">
          {!canManage && <Notice tone="info">{t('counterparties.read_only', locale)}</Notice>}
          {/* A refusal with its way out on the same row: reading the latest version again. */}
          {saveError && (
            <Notice tone="error" action={saveError.stale ? (
              <button type="button" className={ghostClass} onClick={() => setReload((value) => value + 1)}>
                {t('state.error.retry', locale)}
              </button>
            ) : undefined}>
              {saveError.message}
            </Notice>
          )}

          <MangmeeCard className="space-y-4 p-4">
            <h2 className="font-semibold text-gray-800">{t('counterparties.section_identity', locale)}</h2>
            <CounterpartyIdentityFields values={values} onChange={change} disabled={!canManage || busy} issue={issue} allowUnspecifiedEntityKind={!detail.entityKind} />
            {detail.vatStatus && detail.vatStatus !== 'UNKNOWN' && <p className="text-xs text-gray-500">
              {t('counterparties.vat_status', locale)}: {t(VAT_STATUS_KEYS[detail.vatStatus], locale)}
            </p>}
          </MangmeeCard>

          <MangmeeCard className="space-y-4 p-4">
            <h2 className="font-semibold text-gray-800">{t('counterparties.section_address', locale)}</h2>
            <CounterpartyAddressFields values={values} onChange={change} disabled={!canManage || busy} issue={issue} hint={counterpartyAddressHint(address, detail)} />
            {/* The lock is saved with the address it guards, so it sits with it, before the save button. */}
            <SwitchField
              label={t('counterparties.lock_primary', locale)}
              name="counterparty-address-locked"
              hint="ที่อยู่จากใบใหม่จะไม่มาทับ"
              checked={values.locked}
              disabled={!canManage || busy}
              onChange={(event) => change({ locked: event.target.checked })}
            />
          </MangmeeCard>

          <MangmeeCard className="space-y-4 p-4">
            <h2 className="font-semibold text-gray-800">{t('counterparties.section_contact', locale)}</h2>
            <CounterpartyContactFields values={values} onChange={change} disabled={!canManage || busy} />
          </MangmeeCard>

          <AddressHistoryCard
            address={address}
            values={values}
            canManage={canManage}
            busy={busy}
            locale={locale}
            onPromote={(text) => void promote(text)}
          />

          {/* Absent for a viewer who only added the row; an empty list still shows its empty line. */}
          {detail.recentExpenses !== undefined && <RecentExpensesCard companyId={companyId} detail={detail} locale={locale} />}

          {/* The save bar closes the page like every other form: it stays at the bottom of the screen while the
              person scrolls, and comes to rest after the last card instead of covering the history in the middle. */}
          {canManage && (
            <FormActionBar><ActionGroup>
              <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={() => void save()}>
                {busy ? t('counterparties.saving', locale) : t('counterparties.save', locale)}
              </button>
            </ActionGroup></FormActionBar>
          )}
        </div>
      </CoverLoader>
      {navigation.dialog}
    </MangmeePage>
  );
}

/** A5: what the documents say, in place of the customer/vendor picker this screen no longer has. */
function UsageBadges({ detail, locale }: { detail: CounterpartyDetail; locale: SupportedLocale }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      {counterpartyUsageBadges(detail).map((badge) => (
        <MangmeeBadge key={badge.messageKey} tone={badge.tone}>{withParams(t(badge.messageKey, locale), badge.params)}</MangmeeBadge>
      ))}
      {counterpartyAddressMissing(detail) && (
        <MangmeeBadge tone="amber">{t('counterparties.badge_address_missing', locale)}</MangmeeBadge>
      )}
    </span>
  );
}

export function counterpartyAddressHint(address: CounterpartyAddressView, detail: CounterpartyDetail): string {
  const source = address.provenance;
  const document = detail.recentExpenses?.find(expense => expense.id === source?.expenseId);
  return `พิมพ์ตามที่ใบระบุ${source?.expenseId && address.addressText ? ` · ${document ? 'มาจากใบวันที่' : 'มาจากใบที่บันทึกวันที่'} ${formatThaiDate(document?.expenseDate ?? source.at)}` : ''}`;
}

/**
 * §11.1/§7: the ONLY place a person decides about a primary address. The expense review page shows
 * one information line and no control at all (A4), so this card is where the lock and the swap live.
 */
function AddressHistoryCard({ address, values, canManage, busy, locale, onPromote }: {
  address: CounterpartyAddressView;
  values: CounterpartyFormValues;
  canManage: boolean;
  busy: boolean;
  locale: SupportedLocale;
  onPromote: (addressText: string) => void;
}) {
  return (
    <MangmeeCard className="space-y-3 p-4">
      <h2 className="font-semibold text-gray-800">{t('counterparties.section_history', locale)}</h2>
      {/* Flat rows with a rule between them (no card inside the card). An address with its button on one row: the words at the left, the action at the right. */}
      <ul className="divide-y divide-gray-100 border-t border-gray-100">
        {values.addressText.trim() && (
          <li className="flex flex-col items-start gap-1 py-3">
            <MangmeeBadge tone="brand">{t('counterparties.history_primary', locale)}</MangmeeBadge>
            <p className="break-words text-sm text-gray-700">{address.addressText || values.addressText}</p>
          </li>
        )}
        {address.seenOnDocuments.length === 0 ? (
          <li className="py-3 text-sm text-gray-500">{t('counterparties.history_empty', locale)}</li>
        ) : address.seenOnDocuments.map((entry) => (
          <li key={`${entry.expenseId}-${entry.at}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
            <div className="min-w-0 flex-1 basis-64">
              <p className="break-words text-sm text-gray-700">{entry.addressText}</p>
              <span className="mangmee-unit text-xs text-gray-500">{formatThaiDate(entry.at)}</span>
            </div>
            {canManage && (
              <button type="button" className={ghostClass} disabled={busy} aria-busy={busy} onClick={() => onPromote(entry.addressText)}>
                {busy ? t('counterparties.history_promoting', locale) : t('counterparties.history_use_primary', locale)}
              </button>
            )}
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
        <ul className="divide-y divide-gray-100 border-t border-gray-100">
          {expenses.map((expense) => (
            <li key={expense.id}>
              <Link
                href={expenseDetailUrl(`/companies/${encodeURIComponent(companyId)}/expenses`, expense.id, `/companies/${encodeURIComponent(companyId)}/counterparties/${encodeURIComponent(detail.id)}`)}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-1 py-3 text-sm transition-colors hover:bg-gray-50"
              >
                {/* The paper's own number when it has one, and always its date: a number alone does not say when. */}
                <span className="min-w-0 break-words text-gray-700">
                  {expense.expenseNumber && <><span className="mangmee-unit">{expense.expenseNumber}</span> · </>}{expense.vendorDocumentNumber && <><span className="mangmee-unit">{expense.vendorDocumentNumber}</span> · </>}<span className="mangmee-unit">{formatThaiDate(expense.expenseDate)}</span>
                </span>
                <span className="mangmee-unit font-semibold text-gray-800">{amountText(expense.grandTotalAmount)} บาท</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MangmeeCard>
  );
}
