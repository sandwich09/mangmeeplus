'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DISBURSEMENT_VOUCHER_STATUS_LABELS, DISBURSEMENT_VOUCHER_WORDS } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { Pagination } from '@/common/components/data-table/Pagination';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { baht, btnClass, ghostClass, inputClass } from '../ExpensesUi';
import { listDisbursementVouchers } from './disbursement-vouchers.api';
import { disbursementVoucherDocumentHref } from './disbursement-voucher-payment.logic';
import { DISBURSEMENT_VOUCHER_FILTERS, DISBURSEMENT_VOUCHER_PAGE_SIZE } from './disbursement-vouchers.constants';
import { canPrepareDisbursementVoucher, disbursementVoucherDateLine, disbursementVoucherListQuery, disbursementVoucherPrimaryLabel } from './disbursement-vouchers.logic';
import type { DisbursementVoucherFilter, DisbursementVoucherListPage as ListResult, DisbursementVoucherListRow } from './disbursement-vouchers.model';
import { DisbursementVoucherStatusBadge } from './DisbursementVoucherUi';
import styles from './disbursement-vouchers.module.css';

export function DisbursementVoucherCard({ companyId, row }: { companyId: string; row: DisbursementVoucherListRow }) {
  const date = disbursementVoucherDateLine(row);
  const overdue = row.status !== 'PAID' && row.status !== 'CANCELLED' && date?.startsWith(t('expenses.disbursement.overdue', 'th').split('{n}')[0]!);
  return (
    <MangmeeCard className={cx(styles.section, styles.stack)}>
      <div className={styles.cardHeader}>
        <span className={styles.payee}>{row.payeeName}</span>
        <DisbursementVoucherStatusBadge status={row.status} />
      </div>
      <div className={styles.muted}>
        {row.documentNumber ? <>{t('expenses.disbursement.number', 'th').replace('{number}', '')}<span className="whitespace-nowrap">{row.documentNumber}</span></> : t('expenses.disbursement.no_number', 'th')}
        {row.origin === 'DIRECT_PAYMENT' && <p>{DISBURSEMENT_VOUCHER_WORDS.directPayment}</p>}
        {row.origin !== 'DIRECT_PAYMENT' && row.preparerName && <p>{t('expenses.disbursement.reservation_preparer', 'th').replace('{name}', row.preparerName)}</p>}
      </div>
      {date && <p className={cx(styles.date, overdue && styles.overdue)}>{date}</p>}
      <div className={styles.amount}>{baht(row.amountInEffect ?? row.totalAmount)}</div>
      {row.amountInEffect != null && <p className={styles.muted}>{t('expenses.disbursement.cancelled_amount_note', 'th')}</p>}
      <div className={styles.muted}>{t('expenses.disbursement.line_count', 'th').replace('{n}', String(row.lineCount))}</div>
      <Link href={disbursementVoucherDocumentHref(companyId, row)} className={cx(btnClass, styles.action)}>
        {disbursementVoucherPrimaryLabel(row)}
      </Link>
    </MangmeeCard>
  );
}

export function DisbursementVoucherListPage({ companyId, permissions, entryOpen }: { companyId: string; permissions: string[]; entryOpen: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { filter, page, q } = disbursementVoucherListQuery(new URLSearchParams(searchParams.toString()));
  const canRead = permissions.includes('expense.disbursement.read');
  const canPrepare = canPrepareDisbursementVoucher(permissions);
  const [result, setResult] = useState<ListResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [searchText, setSearchText] = useState(q);
  const listHref = `/companies/${companyId}/expenses/disbursement-vouchers`;
  const create = <Link href={`${listHref}/new`} className={cx(btnClass, styles.action)}>{t('expenses.disbursement.create', 'th')}</Link>;

  useEffect(() => setSearchText(q), [q]);
  useEffect(() => {
    if (searchText.trim() === q) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      const value = searchText.trim();
      if (value) params.set('q', value); else params.delete('q');
      params.delete('page');
      router.replace(`${listHref}${params.size ? `?${params}` : ''}`, { scroll: false });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchText, q, searchParams, router, listHref]);

  useEffect(() => {
    if (!canRead || !entryOpen) return;
    let active = true;
    setLoading(true); setError(null);
    void listDisbursementVouchers(companyId, { status: filter === 'all' ? undefined : filter, q: q || undefined, page, pageSize: DISBURSEMENT_VOUCHER_PAGE_SIZE })
      .then((data) => { if (active) setResult(data); })
      .catch((failure: unknown) => { if (active) setError(failure); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, canRead, entryOpen, filter, page, q, retry]);

  const navigate = (nextFilter: DisbursementVoucherFilter, nextPage = 1) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFilter === 'all') params.delete('status'); else params.set('status', nextFilter);
    if (nextPage === 1) params.delete('page'); else params.set('page', String(nextPage));
    router.push(`${listHref}${params.size ? `?${params}` : ''}`);
  };

  if (!canRead) return <ForbiddenState />;
  if (!entryOpen) return (
    <MangmeePage title={DISBURSEMENT_VOUCHER_WORDS.title} className={styles.page}>
      <MangmeeCard className={styles.section}>
        <EmptyState title={t('expenses.disbursement.hidden', 'th')} description={t('expenses.disbursement.hidden_help', 'th')}
          action={<Link href={`/companies/${companyId}/expenses`} className={ghostClass}>{t('expenses.disbursement.back_expenses', 'th')}</Link>} />
      </MangmeeCard>
    </MangmeePage>
  );
  const counts = result?.counts;
  const allCount = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0;

  return (
    <MangmeePage title={DISBURSEMENT_VOUCHER_WORDS.title} description={t('expenses.disbursement.description', 'th')}
      actions={canPrepare && (!result || result.data.length > 0) ? create : undefined} className={styles.page}>
      <div className={styles.stack}>
        <MangmeeCard className={styles.section}>
          <input type="search" className={`${inputClass} mb-3`} value={searchText} placeholder="ค้นชื่อผู้รับเงินหรือเลขที่ใบ"
            onChange={(event) => setSearchText(event.target.value)} aria-label="ค้นชื่อผู้รับเงินหรือเลขที่ใบ" />
          <div className={styles.filters}>
            {DISBURSEMENT_VOUCHER_FILTERS.map((value) => (
              <button key={value} type="button" className={styles.filter} aria-pressed={filter === value} disabled={loading} aria-busy={loading && filter === value} onClick={() => navigate(value)}>
                <span>{value === 'all' ? t('expenses.disbursement.all', 'th') : value === 'APPROVED' ? t('expenses.disbursement.awaiting_payment', 'th') : DISBURSEMENT_VOUCHER_STATUS_LABELS[value]}</span>
                <span className={styles.count}>{counts ? value === 'all' ? allCount : counts[value] : '—'}</span>
              </button>
            ))}
          </div>
        </MangmeeCard>
        {loading ? <LoadingState label={t('expenses.disbursement.loading_list', 'th')} />
          : error ? (error as { status?: number }).status === 403 ? <ForbiddenState /> : <ErrorState description={apiErrorMessage(error)} onRetry={() => setRetry((value) => value + 1)} />
            : result && result.data.length === 0 && q ? (() => {
              const otherFilter = filter === 'all' ? undefined : DISBURSEMENT_VOUCHER_FILTERS.slice(1).find((value): value is Exclude<DisbursementVoucherFilter, 'all'> => value !== 'all' && value !== filter && Boolean(counts?.[value]));
              const otherLabel = otherFilter === 'APPROVED' ? t('expenses.disbursement.awaiting_payment', 'th')
                : otherFilter ? DISBURSEMENT_VOUCHER_STATUS_LABELS[otherFilter] : '';
              return otherFilter ? <MangmeeCard className={styles.section}>
                <p>ไม่พบในแท็บนี้ · พบ {counts?.[otherFilter]} ใบใน “{otherLabel}”</p>
                <button type="button" className={ghostClass} onClick={() => navigate(otherFilter)}>{t('expenses.disbursement.search_view', 'th')}</button>
              </MangmeeCard> : <EmptyState title="ไม่พบใบตามคำค้นนี้" description="" />;
            })() : result && result.data.length === 0 ? (
              <EmptyState title={allCount > 0 || filter !== 'all' ? t('expenses.disbursement.empty_filter', 'th')
                : canPrepare ? t('expenses.disbursement.empty_prepare', 'th') : t('expenses.disbursement.empty_read', 'th')}
                description={allCount === 0 && filter === 'all' && canPrepare ? t('expenses.disbursement.empty_start', 'th') : ''}
                action={allCount === 0 && filter === 'all' && canPrepare ? create : undefined} />
            ) : result ? (
              <div className={styles.list}>
                <div className={styles.cards} data-testid="disbursement-voucher-card-list">
                  {result.data.map((row) => <DisbursementVoucherCard key={row.id} companyId={companyId} row={row} />)}
                </div>
                <div className={styles.table} data-testid="disbursement-voucher-table">
                  <table className="mangmee-table">
                    <thead><tr><th>{t('expenses.disbursement.number', 'th').replace('{number}', '')}</th><th>{t('expenses.substitute_hub.table_payee', 'th')}</th><th>{t('expenses.disbursement.planned_date', 'th')}</th><th>{t('expenses.disbursement.net', 'th')}</th><th>{t('expenses.col_status', 'th')}</th><th>{t('expenses.disbursement.view', 'th')}</th></tr></thead>
                    <tbody>{result.data.map((row) => (
                      <tr key={row.id}>
                        <td><span className="whitespace-nowrap">{row.documentNumber ?? t('expenses.disbursement.no_number', 'th')}</span>{row.origin === 'DIRECT_PAYMENT' && <p className={styles.muted}>{DISBURSEMENT_VOUCHER_WORDS.directPayment}</p>}<p className={styles.muted}>{t('expenses.disbursement.line_count', 'th').replace('{n}', String(row.lineCount))}</p></td>
                        <td>{row.payeeName}</td><td>{disbursementVoucherDateLine(row)}</td><td className={styles.count}>{baht(row.amountInEffect ?? row.totalAmount)}
                          {row.amountInEffect != null && <p className={styles.muted}>{t('expenses.disbursement.cancelled_amount_note', 'th')}</p>}</td>
                        <td><DisbursementVoucherStatusBadge status={row.status} /></td>
                        <td><Link href={disbursementVoucherDocumentHref(companyId, row)} className={cx(btnClass, styles.action)}>{disbursementVoucherPrimaryLabel(row)}</Link></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>

              </div>
            ) : null}
        {!loading && !error && result && result.total > 0 && (
          <div className={styles.pager}>
            {result.data.length > 0 && <p className={styles.muted}>{t('expenses.disbursement.page_range', 'th').replace('{from}', String((result.page - 1) * result.pageSize + 1)).replace('{to}', String(Math.min(result.page * result.pageSize, result.total))).replace('{total}', String(result.total))}</p>}
            <Pagination prominent page={result.page} totalPages={Math.max(1, Math.ceil(result.total / result.pageSize))} onPageChange={(next) => navigate(filter, next)} />
          </div>
        )}
      </div>
    </MangmeePage>
  );
}
