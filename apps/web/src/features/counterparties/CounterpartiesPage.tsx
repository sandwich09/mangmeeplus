'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CoverLoader, EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { ICON, btnClass, err, ghostClass, inputClass } from '@/features/expenses/ExpensesUi';
import { CounterpartyAddressFields, CounterpartyIdentityFields } from './CounterpartyFields';
import { createCounterparty, listCounterparties } from './counterparties.api';
import {
  counterpartyAddressLine,
  counterpartyAddressMissing,
  counterpartyFormIssue,
  counterpartyFormValues,
  counterpartyHref,
  counterpartyPayload,
  counterpartyUsageBadges,
} from './counterparties.logic';
import {
  COUNTERPARTY_MANAGE_PERMISSION,
  COUNTERPARTY_PAGE_SIZE,
  COUNTERPARTY_READ_PERMISSION,
  type CounterpartyFormIssue,
  type CounterpartyFormValues,
  type CounterpartyListFilter,
  type CounterpartySummary,
} from './counterparties.model';

const FILTERS: Array<{ key: CounterpartyListFilter; labelKey: Parameters<typeof t>[0] }> = [
  { key: 'all', labelKey: 'counterparties.filter_all' },
  { key: 'bought', labelKey: 'counterparties.filter_bought' },
  { key: 'sold', labelKey: 'counterparties.filter_sold' },
  { key: 'addressMissing', labelKey: 'counterparties.filter_address_missing' },
];

function withParams(message: string, params: Record<string, string>): string {
  return Object.entries(params).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), message);
}

export function CounterpartiesPage({ companyId, permissions }: { companyId: string; permissions: readonly string[] }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const toast = useToast();
  const canRead = permissions.includes(COUNTERPARTY_READ_PERMISSION);
  const canManage = permissions.includes(COUNTERPARTY_MANAGE_PERMISSION);

  const [filter, setFilter] = useState<CounterpartyListFilter>('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<CounterpartySummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  // Typing must not fire a request per keystroke, and the request that does go out must be the one
  // the user stopped typing on.
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let active = true;
    setRows(null);
    setError(null);
    listCounterparties(companyId, { page, search, filter })
      .then((result) => { if (active) { setRows(result.data ?? []); setTotal(result.total ?? 0); } })
      .catch((cause) => { if (active) { setRows([]); setError(err(cause, locale)); } });
    return () => { active = false; };
  }, [companyId, page, search, filter, retry, locale]);

  const pages = Math.max(1, Math.ceil(total / COUNTERPARTY_PAGE_SIZE));

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

  return (
    <MangmeePage
      title={t('counterparties.title', locale)}
      description={t('counterparties.description', locale)}
      actions={canManage && (
        <button type="button" className={btnClass} onClick={() => setCreateOpen(true)}>
          {t('counterparties.add', locale)}
        </button>
      )}
    >
      <MangmeeCard className="space-y-4 p-4">
        <div className="relative">
          <input
            className={cx(inputClass, 'mangmee-input-icon-end w-full')}
            type="search"
            aria-label={t('counterparties.search_placeholder', locale)}
            placeholder={t('counterparties.search_placeholder', locale)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
            {ICON.search}
          </span>
        </div>
        <div className="mangmee-segmented w-full" role="group" aria-label={t('counterparties.title', locale)}>
          {FILTERS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={filter === option.key}
              className={cx('mangmee-tab shrink-0 whitespace-nowrap', filter === option.key && 'mangmee-tab-active')}
              onClick={() => { setFilter(option.key); setPage(1); }}
            >
              {t(option.labelKey, locale)}
            </button>
          ))}
        </div>

        {rows === null ? <LoadingState label={t('counterparties.loading', locale)} />
          : error ? <ErrorState title={t('counterparties.load_failed', locale)} description={error} onRetry={() => setRetry((value) => value + 1)} locale={locale} />
            : rows.length === 0 ? (
              <EmptyState
                title={t('counterparties.empty_title', locale)}
                description={search || filter !== 'all' ? t('counterparties.empty_filtered', locale) : t('counterparties.empty_description', locale)}
                locale={locale}
                action={canManage && filter === 'all' && !search
                  ? <button type="button" className={btnClass} onClick={() => setCreateOpen(true)}>{t('counterparties.add', locale)}</button>
                  : undefined}
              />
            ) : (
              <ul className="flex flex-col gap-2">
                {rows.map((row) => <CounterpartyRow key={row.id} companyId={companyId} row={row} />)}
              </ul>
            )}

        {rows !== null && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500">
            <span>{withParams(t('counterparties.total', locale), { count: String(total) })}</span>
            <div className="flex items-center gap-2">
              <button type="button" className={ghostClass} disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                {t('counterparties.prev_page', locale)}
              </button>
              <span>{withParams(t('counterparties.page_of', locale), { page: String(page), pages: String(pages) })}</span>
              <button type="button" className={ghostClass} disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))}>
                {t('counterparties.next_page', locale)}
              </button>
            </div>
          </div>
        )}
      </MangmeeCard>

      <CreateCounterpartyModal
        open={createOpen}
        companyId={companyId}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          toast.success(t('counterparties.created', locale));
          router.push(counterpartyHref(companyId, id));
        }}
      />
    </MangmeePage>
  );
}

function CounterpartyRow({ companyId, row }: { companyId: string; row: CounterpartySummary }) {
  const locale = useWorkspaceLocale();
  const address = counterpartyAddressLine(row.billingAddressJson);
  const branchCode = (row.branchCode ?? '').trim();
  const branchLabel = branchCode && branchCode !== '00000'
    ? withParams(t('counterparties.branch_with_code', locale), { code: branchCode })
    : t('counterparties.head_office', locale);

  return (
    <li>
      <Link
        href={counterpartyHref(companyId, row.id)}
        className="mangmee-card-muted flex min-h-11 flex-col gap-1 rounded-xl p-3 transition-colors hover:border-brand-200"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 break-words font-semibold text-gray-800">{row.displayName}</span>
          {counterpartyUsageBadges(row).map((badge) => (
            <MangmeeBadge key={badge.messageKey} tone={badge.tone}>{withParams(t(badge.messageKey, locale), badge.params)}</MangmeeBadge>
          ))}
          {counterpartyAddressMissing(row) && (
            <MangmeeBadge tone="amber">{t('counterparties.badge_address_missing', locale)}</MangmeeBadge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          {row.taxId && <span>{row.taxId}</span>}
          <span>{branchLabel}</span>
        </div>
        <p className="line-clamp-2 break-words text-xs text-gray-500">
          {address || t('counterparties.no_address', locale)}
        </p>
      </Link>
    </li>
  );
}

/**
 * §11.1 "เพิ่มคู่ค้า". Identity plus address only: everything else on the detail page is either
 * server-owned (`type`, usage) or something a person adds later, and a longer form here would be
 * a wall between the user and a row they can already edit.
 */
function CreateCounterpartyModal({ open, companyId, onClose, onCreated }: {
  open: boolean;
  companyId: string;
  onClose: () => void;
  onCreated: (counterpartyId: string) => void;
}) {
  const locale = useWorkspaceLocale();
  const [values, setValues] = useState<CounterpartyFormValues>(() => counterpartyFormValues(null));
  const [issue, setIssue] = useState<CounterpartyFormIssue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setValues(counterpartyFormValues(null)); setIssue(null); setError(null); }
  }, [open]);

  const change = useCallback((next: Partial<CounterpartyFormValues>) => {
    setValues((current) => ({ ...current, ...next }));
    setIssue(null);
  }, []);

  const submit = async () => {
    const found = counterpartyFormIssue(values);
    if (found) { setIssue(found); return; }
    setBusy(true);
    setError(null);
    try {
      // `locked` belongs to the address a person maintains later, not to a brand new row.
      const { locked: _locked, ...body } = counterpartyPayload(values);
      const created = await createCounterparty(companyId, body);
      onCreated(created.id);
      onClose();
    } catch (cause) {
      setError(err(cause, locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={t('counterparties.create_title', locale)}
      size="md"
      footer={(
        <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={() => void submit()}>
          {busy ? t('counterparties.saving', locale) : t('counterparties.create_submit', locale)}
        </button>
      )}
    >
      <CoverLoader active={busy} scope="modal" label={t('counterparties.saving', locale)}>
        <div className="space-y-4">
          <p className="text-sm text-gray-500">{t('counterparties.create_hint', locale)}</p>
          {error && <p role="alert" className="rounded-xl border border-error-500/20 bg-error-50 p-3 text-sm font-semibold text-error-700">{error}</p>}
          <CounterpartyIdentityFields values={values} onChange={change} disabled={busy} issue={issue} allowUnspecifiedEntityKind />
          <CounterpartyAddressFields values={values} onChange={change} disabled={busy} issue={issue} />
        </div>
      </CoverLoader>
    </Modal>
  );
}
