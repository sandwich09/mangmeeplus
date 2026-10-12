'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { WHT_CERTIFICATE_HISTORY_EVENT_LABELS, WHT_HANDOFF_MISSING_LABELS, type WhtCertificateHandoffPageDto } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, MangmeePage, type MangmeeTone } from '@/common/components/mangmee';
import { CoverLoader, EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { useToast } from '@/common/components/toast';
import { downloadArtifact } from '@/common/files/download-artifact';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { formatThaiDate } from '@/common/i18n/thai-date';
import { formatMessage } from '@/common/i18n/error-message.logic';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey, SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { useBranchFilter } from '../web-core-workspace/WorkspaceScope';
import { baht, btnClass, inputClass, ghostClass, err } from './ExpensesUi';
import { canIssueWhtReplacementCopy } from './expenses.model';
import { listWhtHandoffsPaged, issueSystemWhtCertificate, downloadSystemWhtCertificate, issueSystemWhtReplacementCopy } from './expenses.api';
import { certificateListQuery, certificateListState, certificatePrimaryAction, certificateTab } from './expense-wht-certificates.logic';
import { WHT_CERTIFICATE_TABS, WHT_CERTIFICATE_PAGE_SIZE, type WhtCertificateListState, type WhtCertificateRow, type WhtCertificateTab, type WhtCertificateCommand } from './expense-wht-certificates.model';
import { ExpensePreviousCertificate } from './ExpensePreviousCertificate';
import { WhtPayerIdentityNotice } from './WhtPayerIdentityNotice';
import { WhtPayeeAddressDialog } from './WhtPayeeAddressDialog';
import { WhtIssueButton } from './WhtIssueButton';
import styles from './WhtCertificatesPage.module.css';

type RowProps = { row: WhtCertificateRow; companyId: string; permissions: string[]; locale: SupportedLocale; busy: boolean; error?: string;
  onAddress: (row: WhtCertificateRow) => void;
  onAction: (row: WhtCertificateRow, action: WhtCertificateCommand) => void };
const tones: Record<WhtCertificateTab, MangmeeTone> = { pending: 'amber', system: 'brand', external: 'sky', cancelled: 'rose' };
function Status({ row, locale }: Pick<RowProps, 'row' | 'locale'>) {
  const incomplete = row.status === 'REQUIRED' && row.missing.length > 0;
  return <MangmeeBadge className={styles.badge} tone={incomplete ? 'amber' : tones[certificateTab(row)]}>
    {t(`expenses.certificates.${incomplete ? 'incomplete' : certificateTab(row)}`, locale)}</MangmeeBadge>;
}
function expenseHref(companyId: string, row: WhtCertificateRow) {
  return `/companies/${companyId}/expenses${row.expenseId ? `/${row.expenseId}` : ''}`;
}
function IssuedLine({ row, locale }: Pick<RowProps, 'row' | 'locale'>) {
  const number = row.certificateNumber ?? row.externalCertificateNumber;
  if (row.status === 'CANCELLED') return <div className="space-y-1">
    <div>{number && <><span className={styles.unit}>{formatMessage(t('expenses.certificates.number', locale), { number })}</span>{' · '}</>}<span className={styles.unit}>{formatMessage(t('expenses.certificates.cancelled_at', locale), { date: formatThaiDate(row.cancellation?.cancelledAt, '—') })}</span></div>
    {row.cancellation && <p className="break-words">{WHT_CERTIFICATE_HISTORY_EVENT_LABELS[row.cancellation.eventType].replace(/^ยกเลิก /, '')}{row.cancellation.reason && ` · ${row.cancellation.reason}`}</p>}
  </div>;
  // "เลขที่ …" and "ออกเมื่อ …" each stay whole: a number never breaks after its hyphen while it fits the line.
  return number ? <div>{formatMessage(t('expenses.certificates.issued', locale), { number,
    date: formatThaiDate(row.certificateIssuedAt ?? row.externalIssuedDate, '-') }).split(' · ')
    .map((part, index) => <Fragment key={index}>{index > 0 && ' · '}<span className={styles.unit}>{part}</span></Fragment>)}</div> : null;
}
function MatchedPreviousNumber({ row, locale }: Pick<RowProps, 'row' | 'locale'>) {
  if (!row.matchedPreviousNumber) return null;
  const current = row.status === 'SYSTEM_ISSUED' ? row.currentCertificate?.number ?? row.certificateNumber
    : row.status === 'EXTERNAL_LINKED' ? row.externalCertificateNumber : null;
  const line = (key: DictionaryKey, number: string) => {
    const [before, after] = t(key, locale).split('{number}');
    return <p><span className={styles.unit}>{before}<span className={number.length > 30 ? undefined : 'whitespace-nowrap'}>{number}</span></span>{after}</p>;
  };
  return <div className="space-y-1">
    {line('expenses.certificates.matched_previous', row.matchedPreviousNumber)}
    {current && line('expenses.certificates.current_number', current)}
  </div>;
}
/**
 * One control to the expense page per row. A row whose next step is ON the expense page (fix its data, record an own certificate)
 * gets the button and shows its expense number as plain words; every other row keeps the number as the link and gets no button.
 */
export function certificateRowOpensExpense(row: RowProps['row'], permissions: string[]) {
  const action = certificatePrimaryAction(row, permissions);
  return action === 'edit' || action === 'open' && (row.status === 'REQUIRED' || !row.expenseNumber);
}
function ExpenseNumber({ row, companyId, permissions, locale }: Pick<RowProps, 'row' | 'companyId' | 'permissions' | 'locale'>) {
  if (!row.expenseNumber) return null;
  const words = <span className={styles.unit}>{expenseNumberWords(t('expenses.certificates.expense', locale), row.expenseNumber)}</span>;
  return certificateRowOpensExpense(row, permissions) ? <div>{words}</div> : <Link className={styles.link} href={expenseHref(companyId, row)}>{words}</Link>;
}
function CertificateActions({ row, companyId, permissions, locale, busy, error, onAction, onAddress }: RowProps) {
  const action = certificatePrimaryAction(row, permissions);
  const href = expenseHref(companyId, row);
  // Order of presses: the shop's own details, then the payee address, then issue. A row never offers a press the server will refuse.
  const payerBlocked = action === 'issue' && !!row.payerMissing?.length;
  const addressBlocked = action === 'issue' && !payerBlocked && row.hasPayeeAddress === false;
  return <div>
    {row.status === 'REQUIRED' && row.missing.length > 0 && <div className={styles.reasons}>{row.missing.map(reason => <p key={reason}>{WHT_HANDOFF_MISSING_LABELS[reason]}</p>)}</div>}
    {action === 'issue' && row.hasPayeeAddress === false && <p className={styles.warning}>{t('expenses.certificate_card.no_address_warning', locale)}{!addressBlocked && <>{' '}<button type="button" className={styles.link} disabled={busy} aria-busy={busy} onClick={() => onAddress(row)}>{t('expenses.certificates.add_address', locale)}</button></>}</p>}
    {row.status === 'REQUIRED' && !!row.payerMissing?.length && <WhtPayerIdentityNotice companyId={companyId} missing={row.payerMissing} permissions={permissions} primary={payerBlocked} returnTo={row.expenseId ? `${expenseHref(companyId, row)}#wht-certificate` : undefined} />}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {payerBlocked ? (permissions.includes('company.legal_identity.manage') ? null
        : <Link data-primary-action="open" href={href} className={`${btnClass} ${styles.primary}`}>{t('expenses.certificates.open', locale)}</Link>)
      : addressBlocked ? <button type="button" data-primary-action="address" disabled={busy} aria-busy={busy} onClick={() => onAddress(row)} className={`${btnClass} ${styles.primary}`}>{t('expenses.certificates.add_address', locale)}</button>
      : action === 'issue' ? <WhtIssueButton handoff={row} busy={busy} className={`${btnClass} ${styles.primary}`} onIssue={() => onAction(row, 'issue')} />
      : action === 'download' ? <button type="button" data-primary-action={action} className={`${btnClass} ${styles.primary}`} disabled={busy} aria-busy={busy}
      onClick={() => onAction(row, action)}>{t(busy ? 'expenses.certificates.working' : 'expenses.certificates.download', locale)}</button>
      : !certificateRowOpensExpense(row, permissions) ? null
      : <Link data-primary-action={action} href={href} className={`${btnClass} ${styles.primary}`}>
        {t(action === 'edit' ? 'expenses.certificates.edit' : 'expenses.certificates.open', locale)}</Link>}
    {row.status === 'SYSTEM_ISSUED' && canIssueWhtReplacementCopy(row, permissions) && <button type="button" className={`${ghostClass} ${styles.secondary}`} disabled={busy} aria-busy={busy}
      onClick={() => onAction(row, 'replacement')}>{t('expenses.certificates.replacement', locale)}</button>}
    {row.status === 'SYSTEM_ISSUED' && !row.expenseNumber && <Link className={styles.link} href={href}>{t('expenses.certificates.open', locale)}</Link>}
  </div>;
}
function PaidAmounts({ row, locale }: Pick<RowProps, 'row' | 'locale'>) {
  return <div>{formatMessage(t('expenses.certificates.paid_withheld', locale), {
    amount: baht(row.currentCertificate?.grossAmount ?? row.prefill.grossAmount), wht: baht(row.withheldAmount),
  })}</div>;
}
/** The words may wrap before the number; the number itself never breaks. */
function expenseNumberWords(template: string, number: string) {
  const [before, after = ''] = template.split('{number}');
  return <>{before}<span className="whitespace-nowrap">{number}</span>{after}</>;
}

export function WhtCertificateCard(props: RowProps) {
  const { row, companyId, locale } = props;
  return <article data-testid="wht-certificate-card"><MangmeeCard className={styles.card}>
    <div className={styles.heading}><span className={styles.name} title={row.payeeName}>{row.payeeName}</span><Status row={row} locale={locale} /></div>
    <div className={styles.facts}>
      {row.expenseDescription && <p className={styles.description} title={row.expenseDescription}>{row.expenseDescription}</p>}
      <div>{t('expenses.certificates.tax_id', locale)} {row.payeeTaxId || '-'}</div>
      <ExpenseNumber row={row} companyId={companyId} permissions={props.permissions} locale={locale} />
      <div>{t('expenses.certificates.date', locale)} {formatThaiDate(row.documentDate, '-')}</div>
      <PaidAmounts row={row} locale={locale} />
      <IssuedLine row={row} locale={locale} />
      <MatchedPreviousNumber row={row} locale={locale} />
      {row.previousCertificate && <ExpensePreviousCertificate previous={row.previousCertificate} locale={locale} />}
    </div>
    <CertificateActions {...props} />
  </MangmeeCard></article>;
}

export function WhtCertificatesPage({ companyId, permissions }: { companyId: string; permissions: string[] }) {
  const locale = useWorkspaceLocale();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { tab, search, page } = certificateListState(params);
  const branchId = useBranchFilter()?.branchId || undefined;
  const canRead = permissions.includes('wht.certificate.issue');
  const [searchInput, setSearchInput] = useState(search);
  const [data, setData] = useState<WhtCertificateHandoffPageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [addressRow, setAddressRow] = useState<WhtCertificateRow | null>(null);
  const navigate = (state: WhtCertificateListState) => router.replace(`${pathname}?${certificateListQuery(new URLSearchParams(params.toString()), state)}`, { scroll: false });
  useEffect(() => { setSearchInput(search); }, [search]);
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => navigate({ tab, search: searchInput, page: 1 }), 300);
    return () => clearTimeout(timer);
    // The URL is the saved filter; back/forward restores the input above.
  }, [searchInput, search, tab, pathname, params, router]);
  useEffect(() => {
    if (!canRead) return;
    let current = true;
    setLoading(true); setError(null);
    void listWhtHandoffsPaged(companyId, { status: WHT_CERTIFICATE_TABS[tab], search, branchId, page, pageSize: WHT_CERTIFICATE_PAGE_SIZE })
      .then(result => {
        if (!current) return;
        const lastPage = Math.max(1, Math.ceil(result.total / WHT_CERTIFICATE_PAGE_SIZE));
        if (page > lastPage) navigate({ tab, search, page: lastPage });
        setData(result);
      })
      .catch(failure => { if (current) setError(err(failure, locale)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [companyId, canRead, tab, search, branchId, page, refresh, locale]);
  const perform = async (row: WhtCertificateRow, action: WhtCertificateCommand) => {
    if (busyId) return;
    setBusyId(row.id); setRowErrors(previous => ({ ...previous, [row.id]: '' }));
    try {
      const options = { suppressErrorToast: true };
      const result = action === 'issue' ? await issueSystemWhtCertificate(companyId, row.id, options)
        : action === 'replacement' ? await issueSystemWhtReplacementCopy(companyId, row.id, options)
          : await downloadSystemWhtCertificate(companyId, row.id, options);
      downloadArtifact(result.pdfArtifact);
      if (action !== 'download') {
        toast.success(formatMessage(t(action === 'issue' ? 'expenses.certificates.issued_toast' : 'expenses.certificates.replacement_toast', locale), { number: result.certificateNumber }));
        setRefresh(value => value + 1);
      }
    } catch (failure) { setRowErrors(previous => ({ ...previous, [row.id]: err(failure, locale) })); }
    finally { setBusyId(null); }
  };
  const rows = data?.rows ?? [];
  const otherTabs = search.trim() && rows.length === 0
    ? (Object.keys(WHT_CERTIFICATE_TABS) as WhtCertificateTab[]).filter(choice => choice !== tab && (data?.counts[WHT_CERTIFICATE_TABS[choice]] ?? 0) > 0) : [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / WHT_CERTIFICATE_PAGE_SIZE));
  const rowProps = (row: WhtCertificateRow): RowProps => ({ row, companyId, permissions, locale, busy: busyId === row.id, error: rowErrors[row.id], onAction: perform, onAddress: setAddressRow });
  const word = (key: DictionaryKey) => t(key, locale);
  return <MangmeePage title={word('expenses.certificates.title')} description={word('expenses.certificates.description')}>
    {!canRead ? <ForbiddenState locale={locale} /> : <MangmeeCard className={styles.card}><div className={styles.section}>
      <div className={styles.filters} aria-label={word('expenses.certificates.title')}>
        {(Object.keys(WHT_CERTIFICATE_TABS) as WhtCertificateTab[]).map(choice => <button key={choice} type="button" className={styles.filter}
          aria-pressed={tab === choice} disabled={loading || !!busyId} aria-busy={loading && tab === choice} onClick={() => navigate({ tab: choice, search: searchInput, page: 1 })}>
          {word(`expenses.certificates.${choice}`)} ({data?.counts[WHT_CERTIFICATE_TABS[choice]] ?? 0})</button>)}
      </div>
      <input type="search" className={`${inputClass} ${styles.search}`} aria-label={word('expenses.certificates.search')} placeholder={word('expenses.certificates.search_short')}
        value={searchInput} disabled={!!busyId} onChange={event => setSearchInput(event.target.value)} />
      <p className={styles.hint}>{word('expenses.certificates.search')}</p>
      <CoverLoader active={loading && !!data} label={word('expenses.certificates.loading')}>
        {loading && !data ? <LoadingState label={word('expenses.certificates.loading')} /> : error ? <ErrorState description={error} locale={locale} onRetry={() => setRefresh(value => value + 1)} />
          : rows.length === 0 && otherTabs.length > 0 ? <div className="space-y-3 py-6" role="status">
            {otherTabs.map(choice => <div key={choice} className="flex flex-wrap items-center gap-2">
              <p>{formatMessage(word('expenses.certificates.found_elsewhere'), { count: data!.counts[WHT_CERTIFICATE_TABS[choice]], tab: word(`expenses.certificates.${choice}`) })}</p>
              <button type="button" className={ghostClass} disabled={loading} aria-busy={loading}
                onClick={() => navigate({ tab: choice, search, page: 1 })}>{word('expenses.certificates.view')}</button>
            </div>)}
          </div> : rows.length === 0 ? <EmptyState locale={locale} title={word(search.trim() ? 'expenses.certificates.empty_search' : `expenses.certificates.empty_${tab}`)}
            description={!search.trim() && tab === 'pending' ? word('expenses.certificates.empty_hint') : ''} /> : <>
            <div className={styles.cards} data-testid="wht-certificate-card-list">{rows.map(row => <WhtCertificateCard key={row.id} {...rowProps(row)} />)}</div>
            <table className={`mangmee-table ${styles.table}`} data-testid="wht-certificate-table"><thead><tr>
              {(['payee', 'date', 'amount', 'certificate', 'actions'] as const).map(key => <th key={key}>{word(`expenses.certificates.${key}`)}</th>)}
            </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
              <td><div>{row.payeeName}</div>{row.expenseDescription && <p className={styles.description} title={row.expenseDescription}>{row.expenseDescription}</p>}<div>{row.payeeTaxId || '-'}</div><Status row={row} locale={locale} />
                <ExpenseNumber row={row} companyId={companyId} permissions={permissions} locale={locale} /></td>
              <td>{formatThaiDate(row.documentDate, '-')}</td><td><PaidAmounts row={row} locale={locale} /></td><td><IssuedLine row={row} locale={locale} /><MatchedPreviousNumber row={row} locale={locale} />{row.previousCertificate && <ExpensePreviousCertificate previous={row.previousCertificate} locale={locale} />}</td>
              <td><CertificateActions {...rowProps(row)} /></td>
            </tr>)}</tbody></table>
          </>}
        {total > 0 && <div className={styles.pager}>
          <span>{formatMessage(word('expenses.certificates.pager'), { from: (page - 1) * WHT_CERTIFICATE_PAGE_SIZE + 1, to: Math.min(page * WHT_CERTIFICATE_PAGE_SIZE, total), total })}</span>
          {totalPages > 1 && <div className={styles.pagerControls}>
            <button type="button" className={ghostClass} disabled={loading || !!busyId || page <= 1} aria-busy={loading} onClick={() => navigate({ tab, search, page: page - 1 })}>{word('expenses.certificates.previous')}</button>
            <span>{page} / {totalPages}</span>
            <button type="button" className={ghostClass} disabled={loading || !!busyId || page >= totalPages} aria-busy={loading} onClick={() => navigate({ tab, search, page: page + 1 })}>{word('expenses.certificates.next')}</button>
          </div>}
        </div>}
      </CoverLoader>
    </div></MangmeeCard>}
    {addressRow && <WhtPayeeAddressDialog key={`${companyId}:${addressRow.id}`} companyId={companyId} row={addressRow} locale={locale}
      onClose={() => setAddressRow(null)} onSaved={() => { setAddressRow(null); setRefresh(value => value + 1); }} />}
  </MangmeePage>;
}
