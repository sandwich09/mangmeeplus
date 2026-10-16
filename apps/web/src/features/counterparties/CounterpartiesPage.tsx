'use client';

import type { AccountingCounterpartyListCounts } from '@watchdog-bms/contracts';
import { FilterTabs } from '@/common/components/tabs/FilterTabs';
import listStyles from '@/features/expenses/WhtCertificatesPage.module.css';
import styles from './CounterpartiesPage.module.css';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CoverLoader, EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { Notice } from '@/common/components/notice';
import { Pagination } from '@/common/components/data-table/Pagination';
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
  const [counts, setCounts] = useState<AccountingCounterpartyListCounts | undefined>();
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
      .then((result) => { if (active) { setRows(result.data ?? []); setTotal(result.total ?? 0); setCounts(result.counts); } })
      .catch((cause) => { if (active) { setRows([]); setError(err(cause, locale)); } });
    return () => { active = false; };
  }, [companyId, page, search, filter, retry, locale]);

  const pages = Math.max(1, Math.ceil(total / COUNTERPARTY_PAGE_SIZE));

  if (!canRead) {
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

  return (
    <MangmeePage
      className="mangmee-flat"
      title={t('counterparties.title', locale)}
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
        <FilterTabs aria-label={t('counterparties.title', locale)} value={filter}
          onChange={(next) => { setFilter(next); setPage(1); }}
          tabs={FILTERS.map(option => ({ key: option.key, label: t(option.labelKey, locale), count: counts?.[option.key] }))} />

        {rows === null ? <LoadingState label={t('counterparties.loading', locale)} />
          : error ? <ErrorState title={t('counterparties.load_failed', locale)} description={error} onRetry={() => setRetry((value) => value + 1)} locale={locale} />
            : rows.length === 0 ? (
              // An empty search is not an empty book: it says so and offers the way out.
              <EmptyState
                title={t(search || filter !== 'all' ? 'counterparties.empty_search_title' : 'counterparties.empty_title', locale)}
                description={search || filter !== 'all' ? t('counterparties.empty_filtered', locale) : t('counterparties.empty_description', locale)}
                locale={locale}
                action={search || filter !== 'all'
                  ? <button type="button" className={ghostClass} onClick={() => { setQuery(''); setFilter('all'); setPage(1); }}>{t('counterparties.clear_search', locale)}</button>
                  : canManage ? <button type="button" className={btnClass} onClick={() => setCreateOpen(true)}>{t('counterparties.add', locale)}</button>
                  : undefined}
              />
            ) : (
              <>
                <table className={`${listStyles.table} ${styles.table}`}>
                  <colgroup><col style={{ width: '44%' }} /><col style={{ width: '53%' }} /><col style={{ width: '3%' }} /></colgroup>
                  <thead><tr><th>คู่ค้า</th><th>ที่อยู่</th><th aria-hidden="true" /></tr></thead>
                  <tbody>{rows.map(row => <CounterpartyRow key={row.id} companyId={companyId} row={row} />)}</tbody>
                </table>
                <div className="sm:hidden">{rows.map(row => <CounterpartyRow key={row.id} companyId={companyId} row={row} phone />)}</div>
              </>
            )}

        {rows !== null && rows.length > 0 && (
          <div>{pages > 1 && <Pagination prominent page={page} totalPages={pages} locale={locale} onPageChange={setPage} />}</div>
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

// The kind of counterparty at a glance (owner 2026-10-16): a building for a company, a person for an individual,
// a plain shop front when the kind is not known yet.
const KIND_ICON: Record<string, string> = {
  JURISTIC: 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16|M15 9h4a1 1 0 0 1 1 1v11|M3 21h18|M8 8h3M8 12h3M8 16h3',
  INDIVIDUAL: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z|M4 21a8 8 0 0 1 16 0',
  UNKNOWN: 'M4 10v10h16V10|M3 10l2-6h14l2 6Z|M10 20v-5h4v5',
};
function KindAvatar({ kind }: { kind?: string | null }) {
  const juristic = kind === 'JURISTIC';
  return <span aria-hidden="true" className={cx(styles.avatar, juristic && styles.avatarCompany)}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {KIND_ICON[kind === 'JURISTIC' || kind === 'INDIVIDUAL' ? kind : 'UNKNOWN'].split('|').map(d => <path key={d} d={d} />)}
    </svg>
  </span>;
}

export function CounterpartyRow({ companyId, row, phone = false }: { companyId: string; row: CounterpartySummary; phone?: boolean }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const address = counterpartyAddressLine(row.billingAddressJson);
  const href = counterpartyHref(companyId, row.id);
  const press = { role: 'link', tabIndex: 0, 'aria-label': `เปิดคู่ค้า ${row.displayName}`, onClick: () => router.push(href),
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); router.push(href); } } };
  // Under the name, one grey line: the registered name when it differs, then the tax id (or, without one, the kind).
  const kind = row.entityKind === 'JURISTIC' ? t('counterparties.entity_kind_juristic', locale) : row.entityKind === 'INDIVIDUAL' ? t('counterparties.entity_kind_individual', locale) : '';
  const legal = row.legalName?.trim() && row.legalName.trim() !== row.displayName.trim() ? row.legalName.trim() : '';
  const sub = [legal, row.taxId || kind].filter(Boolean).join(' · ');
  const who = <div className={styles.who}>
    <KindAvatar kind={row.entityKind} />
    <div className="min-w-0"><div className={listStyles.name}>{row.displayName}</div>{sub && <div className={listStyles.number}>{sub}</div>}</div>
  </div>;
  // What is missing is said where it would be: no status column, no badge on most of the rows.
  const where = counterpartyAddressMissing(row) || !address
    ? <span className={styles.missing}>{t('counterparties.badge_address_missing', locale)}</span>
    : <span className={styles.address} title={address}>{address}</span>;
  const chevron = <span aria-hidden="true" className={styles.chevron}>›</span>;
  return phone ? <article {...press} className={styles.card}>
    {who}{chevron}<div className={styles.cardWhere}>{where}</div>
  </article> : <tr {...press}>
    <td>{who}</td><td>{where}</td><td className={styles.chevronCell}>{chevron}</td>
  </tr>;
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
      dirty={JSON.stringify(values) !== JSON.stringify(counterpartyFormValues(null))}
      footer={(
        // The two outcomes, the one that backs out first.
        <>
          <button type="button" className={ghostClass} disabled={busy} onClick={onClose}>{t('common.cancel', locale)}</button>
          <button type="button" className={btnClass} disabled={busy} aria-busy={busy} onClick={() => void submit()}>
            {busy ? t('counterparties.saving', locale) : t('counterparties.create_submit', locale)}
          </button>
        </>
      )}
    >
      <CoverLoader active={busy} scope="modal" label={t('counterparties.saving', locale)}>
        <div className="space-y-4">
          {error && <Notice tone="error">{error}</Notice>}
          <CounterpartyIdentityFields values={values} onChange={change} disabled={busy} issue={issue} allowUnspecifiedEntityKind />
          <CounterpartyAddressFields values={values} onChange={change} disabled={busy} issue={issue} />
        </div>
      </CoverLoader>
    </Modal>
  );
}
