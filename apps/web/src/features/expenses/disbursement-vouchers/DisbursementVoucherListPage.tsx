'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DISBURSEMENT_VOUCHER_WORDS } from '@watchdog-bms/contracts';
import { MangmeeCard, MangmeePage, MetricGrid, cx } from '@/common/components/mangmee';
import { Pagination } from '@/common/components/data-table/Pagination';
import { EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { quietButtonClass } from '@/common/components/button/button-classes';
import { IconBtn } from '../ExpensesWorkspacePanels';
import { DisbursementVoucherCommandDialog } from './DisbursementVoucherCommandDialog';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { t } from '@/common/i18n/workspace-i18n.logic';
import { amountText, ICON, btnClass, ghostClass, inputClass } from '../ExpensesUi';
import { getDisbursementVoucher, listDisbursementVouchers } from './disbursement-vouchers.api';
import { disbursementVoucherDocumentHref } from './disbursement-voucher-payment.logic';
import { DISBURSEMENT_VOUCHER_FILTERS, DISBURSEMENT_VOUCHER_PAGE_SIZE } from './disbursement-vouchers.constants';
import { canPrepareDisbursementVoucher, disbursementVoucherBadge, disbursementVoucherDateLine, disbursementVoucherListQuery } from './disbursement-vouchers.logic';
import type { DisbursementVoucherDetail, DisbursementVoucherFilter, DisbursementVoucherListPage as ListResult, DisbursementVoucherListRow } from './disbursement-vouchers.model';
import { DisbursementVoucherStatusBadge } from './DisbursementVoucherUi';
import styles from './disbursement-vouchers.module.css';

const GRID = 'grid grid-cols-[minmax(180px,1.6fr)_minmax(150px,1fr)_minmax(100px,0.7fr)_minmax(140px,1fr)_44px] items-center gap-3';

// The document link and delete action are siblings, so deleting never opens the document.
export function DisbursementVoucherCard({ companyId, row, onDelete, deleting }: { companyId: string; row: DisbursementVoucherListRow; onDelete: () => void; deleting: boolean }) {
  const date = disbursementVoucherDateLine(row);
  return (
    <MangmeeCard className="overflow-hidden">
      <Link href={disbursementVoucherDocumentHref(companyId, row)} aria-label={`เปิด ${row.payeeName} · ${row.documentNumber ?? t('expenses.disbursement.no_number', 'th')}`} className={cx(styles.cardLink, 'p-4')}>
        <div className={styles.cardHeader}>
          <span className={styles.payee}>{row.payeeName}</span>
          <span className={styles.cardAmount}>{amountText(row.amountInEffect ?? row.totalAmount)} <span className="text-sm font-normal">บาท</span></span>
        </div>
        <p className={cx(styles.muted, 'mt-1')}>
          <span className="mangmee-unit">{row.documentNumber ?? t('expenses.disbursement.no_number', 'th')}</span>
          {row.lineCount > 1 && <> · <span className="mangmee-unit">{t('expenses.disbursement.line_count', 'th').replace('{n}', String(row.lineCount))}</span></>}
          {date && <> · <span className="mangmee-unit">{date}</span></>}
        </p>
        <div className="mt-2"><DisbursementVoucherStatusBadge status={row.status} /></div>
        {row.origin === 'DIRECT_PAYMENT' && <p className={styles.muted}>{DISBURSEMENT_VOUCHER_WORDS.directPayment}</p>}
        {row.amountInEffect != null && <p className={styles.muted}>{t('expenses.disbursement.cancelled_amount_note', 'th')}</p>}
      </Link>
      {row.canDelete && <div className="flex justify-end border-t border-gray-100 px-2 py-1">
        <button type="button" className={quietButtonClass} disabled={deleting} aria-busy={deleting} onClick={onDelete}>ลบร่างใบเตรียมจ่ายนี้</button>
      </div>}
    </MangmeeCard>
  );
}

export function DisbursementVoucherListPage({ companyId, permissions, entryOpen }: { companyId: string; permissions: string[]; entryOpen: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { filter, page, q, order } = disbursementVoucherListQuery(new URLSearchParams(searchParams.toString()));
  const canRead = permissions.includes('expense.disbursement.read');
  const canPrepare = entryOpen && canPrepareDisbursementVoucher(permissions);
  const [result, setResult] = useState<ListResult | null>(null);
  const [unfilteredCount, setUnfilteredCount] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [searchText, setSearchText] = useState(q);
  const [deleteDetail, setDeleteDetail] = useState<DisbursementVoucherDetail | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<unknown>(null);
  const deleteTarget = useRef<string | null>(null);
  const openDelete = async (id: string) => {
    if (!entryOpen || deleteLoadingId) return;
    deleteTarget.current = id; setDeleteLoadingId(id); setDeleteError(null);
    try { setDeleteDetail(await getDisbursementVoucher(companyId, id, { suppressErrorToast: true })); }
    catch (failure) { setDeleteError(failure); }
    finally { setDeleteLoadingId(null); }
  };
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
    if (!canRead) return;
    let active = true;
    setLoading(true); setError(null);
    void listDisbursementVouchers(companyId, { status: filter === 'all' ? undefined : filter, q: q || undefined, page, pageSize: DISBURSEMENT_VOUCHER_PAGE_SIZE, order })
      .then(async (data) => {
        // Search counts describe its matches, so check the unfiltered list before saying no old records exist.
        const all = !entryOpen && q && Object.values(data.counts).every(count => count === 0)
          ? await listDisbursementVouchers(companyId, { page: 1, pageSize: 1 }) : data;
        if (active) { setResult(data); setUnfilteredCount(Object.values(all.counts).reduce((sum, count) => sum + count, 0)); }
      })
      .catch((failure: unknown) => { if (active) setError(failure); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [companyId, canRead, entryOpen, filter, page, q, order, retry]);

  const navigate = (nextFilter: DisbursementVoucherFilter, nextPage = 1, nextOrder = order) => {
    const params = new URLSearchParams(searchParams.toString());
    if (nextFilter === 'all') params.delete('status'); else params.set('status', nextFilter);
    if (nextOrder === 'newest') params.delete('order'); else params.set('order', nextOrder);
    if (nextPage === 1) params.delete('page'); else params.set('page', String(nextPage));
    router.push(`${listHref}${params.size ? `?${params}` : ''}`);
  };

  if (!canRead) return <ForbiddenState titleAs="h1" />;
  const counts = result?.counts;
  const allCount = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0;
  if (!entryOpen && !loading && !error && result && (unfilteredCount ?? allCount) === 0) return (
    <MangmeePage title={DISBURSEMENT_VOUCHER_WORDS.title} className={cx(styles.page, 'mangmee-flat')}>
      <MangmeeCard className={styles.section}>
        <EmptyState title={t('expenses.disbursement.hidden', 'th')} description={t('expenses.disbursement.hidden_help', 'th')}
          action={<Link href={`/companies/${companyId}/expenses`} className={ghostClass}>{t('expenses.disbursement.back_expenses', 'th')}</Link>} />
      </MangmeeCard>
    </MangmeePage>
  );
  const filterName = (value: DisbursementVoucherFilter) => value === 'all' ? t('expenses.disbursement.all', 'th') : disbursementVoucherBadge(value).label;

  return (
    <MangmeePage title={DISBURSEMENT_VOUCHER_WORDS.title} description={t('expenses.disbursement.description', 'th')}
      actions={canPrepare ? create : undefined} className={cx(styles.page, 'mangmee-flat')}>
      <div className={styles.stack}>
        {!entryOpen && <p role="status" className="text-sm text-gray-600">ปิดการทำใบเตรียมจ่ายใหม่แล้ว ดูใบเดิมได้</p>}
        {!loading && !error && result && <MangmeeCard className={styles.section}>
          <MetricGrid columns={2} items={[
            { key: 'approval', label: 'รออนุมัติ', value: result.sums?.PENDING_APPROVAL == null ? '—' : amountText(result.sums.PENDING_APPROVAL), unit: 'บาท', note: `${result.counts.PENDING_APPROVAL} ใบ`, dot: 'bg-amber-400' },
            { key: 'payment', label: 'รอจ่าย', value: result.sums?.APPROVED == null ? '—' : amountText(result.sums.APPROVED), unit: 'บาท', note: `${result.counts.APPROVED} ใบ`, dot: 'bg-brand-500' },
          ]} />
        </MangmeeCard>}
        {Boolean(deleteError) && <ErrorState description={apiErrorMessage(deleteError)} onRetry={() => { if (deleteTarget.current) void openDelete(deleteTarget.current); }} />}
        <MangmeeCard className={styles.section}>
          <input type="search" className={`${inputClass} mb-3`} value={searchText} placeholder="ค้นชื่อผู้รับเงินหรือเลขที่ใบ"
            onChange={(event) => setSearchText(event.target.value)} aria-label="ค้นชื่อผู้รับเงินหรือเลขที่ใบ" />
          <div role="group" aria-label={t('expenses.disbursement.filter_label', 'th')} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {DISBURSEMENT_VOUCHER_FILTERS.map(value => <button key={value} type="button" aria-pressed={filter === value}
              className="mangmee-home-tab min-w-0 gap-2" disabled={loading} aria-busy={loading} onClick={() => navigate(value)}>
              {filterName(value)}<span className={cx('tabular-nums text-xs', filter === value ? 'text-white/85' : 'text-gray-500')}>{counts ? value === 'all' ? allCount : counts[value] : '—'}</span>
            </button>)}
          </div>
        </MangmeeCard>
        {loading ? <LoadingState label={t('expenses.disbursement.loading_list', 'th')} />
          : error ? (error as { status?: number }).status === 403 ? <ForbiddenState /> : <ErrorState description={apiErrorMessage(error)} onRetry={() => setRetry((value) => value + 1)} />
            : result && result.data.length === 0 && q ? (() => {
              const otherFilter = filter === 'all' ? undefined : DISBURSEMENT_VOUCHER_FILTERS.slice(1).find((value): value is Exclude<DisbursementVoucherFilter, 'all'> => value !== 'all' && value !== filter && Boolean(counts?.[value]));
              const otherLabel = otherFilter ? filterName(otherFilter) : '';
              return otherFilter ? <MangmeeCard className={styles.section}>
                <p>ไม่พบในแท็บนี้ · พบ {counts?.[otherFilter]} ใบใน “{otherLabel}”</p>
                <button type="button" className={ghostClass} onClick={() => navigate(otherFilter)}>{t('expenses.disbursement.search_view', 'th')}</button>
              </MangmeeCard> : <EmptyState title="ไม่พบใบตามคำค้นนี้" description=""
                action={<button type="button" className={ghostClass} onClick={() => setSearchText('')}>{t('expenses.disbursement.search_clear', 'th')}</button>} />;
            })() : result && result.data.length === 0 ? (
              <EmptyState title={allCount > 0 || filter !== 'all' ? t('expenses.disbursement.empty_filter', 'th')
                : canPrepare ? t('expenses.disbursement.empty_prepare', 'th') : t('expenses.disbursement.empty_read', 'th')}
                description={allCount === 0 && filter === 'all' && canPrepare ? t('expenses.disbursement.empty_start', 'th') : ''}
                />
            ) : result ? (
              <div className={styles.list}>
                <div className={styles.phoneSort}><button type="button" className={quietButtonClass} onClick={() => navigate(filter, 1, order === 'newest' ? 'oldest' : 'newest')}>
                  เรียง: {order === 'newest' ? 'ใหม่ไปเก่า ↓' : 'เก่าไปใหม่ ↑'}
                </button></div>
                <div className={styles.cards} data-testid="disbursement-voucher-card-list">
                  {result.data.map((row) => <DisbursementVoucherCard key={row.id} companyId={companyId} row={{ ...row, canDelete: entryOpen && row.canDelete }} onDelete={() => openDelete(row.id)} deleting={deleteLoadingId === row.id} />)}
                </div>
                <div className={styles.table} data-testid="disbursement-voucher-table">
                  <div className="min-w-[900px]">
                    <div className={cx(GRID, 'mt-3 border-b border-gray-100 px-2 pb-2 text-[13px] font-bold text-gray-500')}>
                      <div>ผู้รับเงิน</div><div><button type="button" className="inline-flex items-center gap-1 hover:text-gray-800" onClick={() => navigate(filter, 1, order === 'newest' ? 'oldest' : 'newest')}
                        aria-label={order === 'newest' ? 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่' : 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า'}>วันที่ <span aria-hidden="true">{order === 'newest' ? '↓' : '↑'}</span></button></div>
                      <div className="text-right">ยอดเงิน <span className="font-normal">(บาท)</span></div><div className="text-right">สถานะ</div><div className="text-right"><span className="sr-only">ลบ</span></div>
                    </div>
                    {result.data.map((row) => (
                      <div key={row.id} role="link" tabIndex={0} aria-label={`เปิด ${row.payeeName} · ${row.documentNumber ?? t('expenses.disbursement.no_number', 'th')}`}
                        className={cx(GRID, 'cursor-pointer border-b border-gray-50 px-2 py-3 transition hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500')}
                        onClick={() => router.push(disbursementVoucherDocumentHref(companyId, row))}
                        onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); router.push(disbursementVoucherDocumentHref(companyId, row)); } }}>
                        <div className="min-w-0"><p className="text-[15px] font-semibold text-gray-900 [overflow-wrap:anywhere]">{row.payeeName}</p>
                          <p className={styles.muted}><span className="mangmee-unit">{row.documentNumber ?? t('expenses.disbursement.no_number', 'th')}</span>{row.lineCount > 1 && <> · {t('expenses.disbursement.line_count', 'th').replace('{n}', String(row.lineCount))}</>}</p>
                          {row.origin === 'DIRECT_PAYMENT' && <p className={styles.muted}>{DISBURSEMENT_VOUCHER_WORDS.directPayment}</p>}</div>
                        <div><span className="mangmee-unit text-xs text-gray-500">{disbursementVoucherDateLine(row)}</span></div><div className="text-right text-[15px] font-bold tabular-nums text-gray-900"><span className="mangmee-unit">{amountText(row.amountInEffect ?? row.totalAmount)}</span>
                          {row.amountInEffect != null && <p className={styles.muted}>{t('expenses.disbursement.cancelled_amount_note', 'th')}</p>}</div>
                        <div className="flex justify-end"><DisbursementVoucherStatusBadge status={row.status} /></div>
                        <div className="flex items-center justify-end gap-1.5">{entryOpen && row.canDelete && <IconBtn title="ลบร่างใบเตรียมจ่ายนี้" tone="danger" loading={deleteLoadingId === row.id}
                          onClick={event => { event.stopPropagation(); void openDelete(row.id); }}>{ICON.trash}</IconBtn>}</div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            ) : null}
        {!loading && !error && result && result.total > result.pageSize && (
          <div className={styles.pager}>
            <Pagination prominent page={result.page} totalPages={Math.max(1, Math.ceil(result.total / result.pageSize))} onPageChange={(next) => navigate(filter, next)} />
          </div>
        )}
      </div>
      {entryOpen && deleteDetail && <DisbursementVoucherCommandDialog companyId={companyId} detail={deleteDetail} kind="delete"
        onClose={() => setDeleteDetail(null)} onReload={async () => { setDeleteDetail(await getDisbursementVoucher(companyId, deleteDetail.header.id, { suppressErrorToast: true })); setRetry(value => value + 1); }}
        onDeleted={() => { setDeleteDetail(null); if (result?.data.length === 1 && page > 1) navigate(filter, page - 1); else setRetry(value => value + 1); }} />}
    </MangmeePage>
  );
}
