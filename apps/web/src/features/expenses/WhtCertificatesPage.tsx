'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { companyProfilePath, WHT_CERTIFICATE_HISTORY_EVENT_LABELS, type WhtCertificateHandoffPageDto } from '@watchdog-bms/contracts';
import { MangmeeBadge, MangmeeCard, MangmeePage, MetricGrid } from '@/common/components/mangmee';
import { CoverLoader, EmptyState, ErrorState, ForbiddenState, LoadingState } from '@/common/components/state';
import { SelectField } from '@/common/components/field';
import { quietButtonClass } from '@/common/components/button/button-classes';
import { Pagination } from '@/common/components/data-table/Pagination';
import { Notice } from '@/common/components/notice';
import { FilterTabs } from '@/common/components/tabs';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { formatThaiDate, formatThaiMonth } from '@/common/i18n/thai-date';
import { formatMessage } from '@/common/i18n/error-message.logic';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey, SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { useBranchFilter } from '../web-core-workspace/WorkspaceScope';
import { amountText, inputClass, ghostClass, err } from './ExpensesUi';
import { listWithholdingCertificates } from '../tax/tax.api';
import { certificateListQuery, certificateListState, certificateRowHref, certificateRowStatus } from './expense-wht-certificates.logic';
import { WHT_CERTIFICATE_TABS, WHT_CERTIFICATE_PAGE_SIZE, type WhtCertificateListState, type WhtCertificateRow, type WhtCertificateTab } from './expense-wht-certificates.model';
import styles from './WhtCertificatesPage.module.css';
import { ExpenseCertificateFile } from './ExpenseCertificateFile';

type RowProps = { row: WhtCertificateRow; companyId: string; permissions: string[]; locale: SupportedLocale; shopBanner?: boolean; systemCertificatesAvailable?: boolean;
  onOpen?: () => void };
function Status({ row, shopBanner, systemCertificatesAvailable = true }: Pick<RowProps, 'row' | 'shopBanner' | 'systemCertificatesAvailable'>) {
  if (!systemCertificatesAvailable && row.status === 'REQUIRED' && row.payments?.length !== 0) return <span>{t('expenses.certificate_card.record', 'th')}</span>;
  if (!certificateRowStatus(row, shopBanner)) return null;
  return <MangmeeBadge className={styles.badge} tone={row.status === 'SYSTEM_ISSUED' || certificateRowStatus(row, shopBanner) === 'พร้อมออก' ? 'brand' : row.status === 'REQUIRED' ? 'amber' : 'slate'}>{certificateRowStatus(row, shopBanner)}</MangmeeBadge>;
}
function paymentDate(row: WhtCertificateRow) {
  if (row.status === 'REQUIRED' && row.payments) {
    if (row.payments.length === 0) return 'ยังไม่จ่าย';
    if (row.payments.length > 1) return 'หลายการจ่าย';
    return formatThaiDate(row.payments[0].paidAt, '-');
  }
  return formatThaiDate(row.currentCertificate?.paymentDate ?? row.externalPaymentDate ?? row.prefill.paymentDate ?? row.documentDate, '-');
}
function formName(row: WhtCertificateRow) {
  return row.formType === 'PND2' ? 'ภ.ง.ด.2' : row.formType === 'PND3' ? 'ภ.ง.ด.3' : row.formType === 'PND53' ? 'ภ.ง.ด.53' : 'ยังไม่รู้แบบภาษี';
}
function CertificateDetails(props: Pick<RowProps, 'row' | 'companyId' | 'permissions' | 'locale'>) {
  const { row, locale } = props;
  const number = row.status === 'REQUIRED' ? null : row.status === 'EXTERNAL_LINKED' ? row.externalCertificateNumber ?? row.certificateNumber : row.currentCertificate?.number ?? row.certificateNumber;
  return <div className={styles.number}>
    <div className={styles.meta}>{number && <><span className={styles.unit}>{number}</span>{row.status === 'EXTERNAL_LINKED' && <MangmeeBadge tone="slate">{t('expenses.certificates.external', locale)}</MangmeeBadge>}{row.expenseNumber && ' · '}</>}<span className={styles.unit}>{row.expenseNumber}</span></div>
    {row.externalAttachmentId && <ExpenseCertificateFile companyId={props.companyId} handoffId={row.id} attachmentId={row.externalAttachmentId} />}
    {/* Owner 2026-10-15: no cancelled-certificate history in the list (rows keep one height); the expense page holds it. */}
    {row.matchedPreviousNumber && <p>{formatMessage(t('expenses.certificates.matched_previous', locale), { number: row.matchedPreviousNumber })}</p>}
    {row.status === 'CANCELLED' && row.cancellation && <p>
      {formatMessage(t('expenses.certificates.cancelled_at', locale), { date: formatThaiDate(row.cancellation.cancelledAt, '—') })} · {WHT_CERTIFICATE_HISTORY_EVENT_LABELS[row.cancellation.eventType].replace(/^ยกเลิก /, '')}{row.cancellation.reason && ` · ${row.cancellation.reason}`}
    </p>}
  </div>;
}
export function WhtCertificateCard(props: RowProps) {
  const { row, companyId, locale } = props;
  return <article data-testid="wht-certificate-card" role="link" tabIndex={0} aria-label={`เปิดรายจ่าย ${row.expenseNumber ?? row.payeeName}`} onClick={props.onOpen}
    onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); props.onOpen?.(); } }}><MangmeeCard className={styles.card}>
    <div className={styles.heading}><span className={styles.name}>{row.payeeName}</span><span className={styles.money}>{amountText(row.withheldAmount)} บาท</span></div>
    <div className={styles.facts}>
      <CertificateDetails row={row} companyId={companyId} permissions={props.permissions} locale={locale} />
      <div className={styles.meta}>{paymentDate(row)} · {formName(row)}</div>
      <Status row={row} shopBanner={props.shopBanner} systemCertificatesAvailable={props.systemCertificatesAvailable} />
    </div>
  </MangmeeCard></article>;
}

export function WhtCertificatesPage({ companyId, permissions, systemCertificatesAvailable = true }: { companyId: string; permissions: string[]; systemCertificatesAvailable?: boolean }) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const savedState = certificateListState(params);
  const { search, page, order } = savedState;
  const tab = !systemCertificatesAvailable && savedState.tab === 'system' ? 'pending' : savedState.tab;
  const visibleTabs = (Object.keys(WHT_CERTIFICATE_TABS) as WhtCertificateTab[]).filter(choice => systemCertificatesAvailable || choice !== 'system');
  const urlQuery = params.toString();
  const pendingQuery = useRef({ source: urlQuery, value: urlQuery });
  if (pendingQuery.current.source !== urlQuery) pendingQuery.current = { source: urlQuery, value: urlQuery };
  const replaceQuery = (next: URLSearchParams) => {
    pendingQuery.current.value = next.toString();
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const periodKey = params.get('periodKey') ?? '';
  const formType = params.get('formType') === 'PND2' ? 'PND2' : params.get('formType') === 'PND3' ? 'PND3' : params.get('formType') === 'PND53' ? 'PND53' : undefined;
  function filterMonthOrForm(key: string, value: string) {
    const next = new URLSearchParams(pendingQuery.current.value);
    if (value) next.set(key, value); else next.delete(key);
    next.set('page', '1'); replaceQuery(next);
  }
  const branchId = useBranchFilter()?.branchId || undefined;
  const canRead = permissions.some(permission => ['wht.certificate.read', 'wht.certificate.issue', 'wht.certificate.correct', 'wht.external_certificate.link'].includes(permission));
  const [searchInput, setSearchInput] = useState(search);
  const [data, setData] = useState<WhtCertificateHandoffPageDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  // A second press can arrive before the router commits the first filter change.
  const navigate = (change: Partial<WhtCertificateListState>) => {
    const latest = new URLSearchParams(pendingQuery.current.value);
    const next = { ...certificateListState(latest), ...change };
    if (!systemCertificatesAvailable && next.tab === 'system') next.tab = 'pending';
    replaceQuery(new URLSearchParams(certificateListQuery(latest, next)));
  };
  useEffect(() => { setSearchInput(search); }, [search]);
  useEffect(() => {
    if (searchInput === search) return;
    const timer = setTimeout(() => navigate({ search: searchInput, page: 1 }), 300);
    return () => clearTimeout(timer);
    // The URL is the saved filter; back/forward restores the input above.
  }, [searchInput, search, tab, order, pathname, params, router]);
  useEffect(() => {
    if (!canRead) return;
    let current = true;
    setLoading(true); setError(null);
    void listWithholdingCertificates(companyId, { periodKey: periodKey || undefined, formType, status: WHT_CERTIFICATE_TABS[tab], search, branchId, page, order, pageSize: WHT_CERTIFICATE_PAGE_SIZE })
      .then(result => {
        if (!current) return;
        const lastPage = Math.max(1, Math.ceil(result.total / WHT_CERTIFICATE_PAGE_SIZE));
        if (page > lastPage) navigate({ page: lastPage });
        setData(result);
      })
      .catch(failure => { if (current) setError(err(failure, locale)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [companyId, canRead, tab, search, branchId, page, order, refresh, locale, periodKey, formType]);
  const rows = data?.rows ?? [];
  const otherTabs = search.trim() && rows.length === 0
    ? visibleTabs.filter(choice => choice !== tab && (data?.counts[WHT_CERTIFICATE_TABS[choice]] ?? 0) > 0) : [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / WHT_CERTIFICATE_PAGE_SIZE));
  const returnTo = `${pathname}${params.size ? `?${params}` : ''}`;
  const openRow = (row: WhtCertificateRow) => router.push(certificateRowHref(companyId, systemCertificatesAvailable ? row : { ...row, missing: [], payerMissing: [], hasPayeeAddress: true }, permissions, returnTo));
  const rowProps = (row: WhtCertificateRow): RowProps => ({ row, companyId, permissions, locale, shopBanner, systemCertificatesAvailable, onOpen: () => openRow(row) });
  const word = (key: DictionaryKey) => t(key, locale);
  const tabLabel = (choice: WhtCertificateTab) => word(!systemCertificatesAvailable && choice !== 'system' ? `expenses.certificates.outside_${choice}` : `expenses.certificates.${choice}`);
  const waitingForShop = rows.filter(row => row.status === 'REQUIRED' && row.payerMissing?.length);
  const shopMissing = [...new Set(waitingForShop.flatMap(row => row.payerMissing ?? []))];
  const canFillShop = permissions.includes('company.legal_identity.manage');
  const shopBanner = systemCertificatesAvailable && canFillShop && shopMissing.length > 0;
  // A status column only when some row has something to say beyond the tab's name.
  const statusColumn = rows.some(row => systemCertificatesAvailable ? certificateRowStatus(row, shopBanner) : row.status === 'REQUIRED');
  // Return the former menu column's room to the payee; every tab totals 100%.
  const columnWidths = statusColumn ? [37, 11, 9, 13, 12, 18] : [49, 13, 10, 14, 14];
  const changeOrder = () => navigate({ page: 1, order: order === 'newest' ? 'oldest' : 'newest' });
  return <MangmeePage title={word('expenses.certificates.title')} description={word(systemCertificatesAvailable ? 'expenses.certificates.description' : 'expenses.certificates.outside_description')} className="mangmee-flat">
    {!canRead ? <ForbiddenState locale={locale} /> : <div className={styles.section}>
      <MangmeeCard className="mb-4 p-4"><MetricGrid columns={2} items={[
        { key: 'count', label: tabLabel(tab), value: data ? total.toLocaleString('th-TH') : '—', unit: 'ใบ', dot: 'bg-gray-400' },
        { key: 'withheld', label: 'ภาษีที่หักไว้', value: data?.sums ? amountText(data.sums.withheld) : '—', unit: 'บาท', dot: 'bg-brand-500' },
      ]} /></MangmeeCard>
      <MangmeeCard className="p-4">
      <FilterTabs className={styles.tabs} aria-label={word('expenses.certificates.title')} value={tab} onChange={choice => navigate({ tab: choice, search: searchInput, page: 1 })}
        tabs={visibleTabs.map(choice => ({ key: choice, label: tabLabel(choice), count: data?.counts[WHT_CERTIFICATE_TABS[choice]] ?? 0, disabled: loading }))} />
      {/* What can be searched is said once, inside the box (the full list of what matches is the box's spoken name). */}
      <div className="mb-4 grid grid-cols-1 items-end gap-4 lg:grid-cols-3">
        <SelectField id="certificate-month" label="เดือนที่จ่าย" value={periodKey} disabled={loading} onChange={e => filterMonthOrForm('periodKey', e.target.value)}>
          <option value="">ทุกเดือน</option>
          {(data?.months ?? []).map(month => <option key={month} value={month}>{formatThaiMonth(month)}</option>)}
        </SelectField>
        <SelectField id="certificate-form" label="แบบภาษี" value={formType ?? ''} disabled={loading} onChange={e => filterMonthOrForm('formType', e.target.value)}><option value="">ทั้งหมด</option><option value="PND2">ภ.ง.ด.2</option><option value="PND3">ภ.ง.ด.3</option><option value="PND53">ภ.ง.ด.53</option></SelectField>
      <input type="search" className={`${inputClass} ${styles.search}`} aria-label={word('expenses.certificates.search')} placeholder={word('expenses.certificates.search_short')}
        value={searchInput} onChange={event => setSearchInput(event.target.value)} />
      </div>
      <CoverLoader active={loading && !!data} label={word('expenses.certificates.loading')}>
        {loading && !data ? <LoadingState label={word('expenses.certificates.loading')} /> : error ? <ErrorState description={error} locale={locale} onRetry={() => setRefresh(value => value + 1)} />
          : rows.length === 0 && otherTabs.length > 0 ? <div className="space-y-3 py-6" role="status">
            {otherTabs.map(choice => <div key={choice} className="flex flex-wrap items-center gap-2">
              <p>{formatMessage(word('expenses.certificates.found_elsewhere'), { count: data!.counts[WHT_CERTIFICATE_TABS[choice]], tab: tabLabel(choice) })}</p>
              <button type="button" className={ghostClass} disabled={loading} aria-busy={loading}
                onClick={() => navigate({ tab: choice, page: 1 })}>{word('expenses.certificates.view')}</button>
            </div>)}
          </div> : rows.length === 0 ? <EmptyState locale={locale} title={word(search.trim() ? 'expenses.certificates.empty_search' : !systemCertificatesAvailable && tab === 'pending' ? 'expenses.certificates.outside_empty_pending' : `expenses.certificates.empty_${tab}`)}
            description={systemCertificatesAvailable && !search.trim() && tab === 'pending' ? word('expenses.certificates.empty_hint') : ''} /> : <>
            {shopBanner && <Notice tone="warning" className={styles.notice}
              action={<Link className={ghostClass} href={`${companyProfilePath(companyId)}?${new URLSearchParams({ returnTo })}`}>กรอกข้อมูลร้าน</Link>}>
              ข้อมูลร้านยังไม่ครบ ออกหนังสือรับรองไม่ได้
            </Notice>}
            <div className={styles.phoneSort}><button type="button" className={quietButtonClass} onClick={changeOrder}>
              เรียง: {order === 'newest' ? 'ใหม่ไปเก่า ↓' : 'เก่าไปใหม่ ↑'}
            </button></div>
            <div className={styles.cards} data-testid="wht-certificate-card-list">{rows.map(row => <WhtCertificateCard key={row.id} {...rowProps(row)} />)}</div>
            <table className={styles.table} data-testid="wht-certificate-table"><colgroup>{columnWidths.map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead><tr>
              <th>ผู้รับเงิน</th><th aria-sort={order === 'newest' ? 'descending' : 'ascending'}><button type="button" className="inline-flex items-center gap-1 hover:text-gray-800" onClick={changeOrder}
                aria-label={order === 'newest' ? 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่' : 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า'}>วันที่ <span aria-hidden="true">{order === 'newest' ? '↓' : '↑'}</span></button></th><th>แบบ</th><th className={styles.money}>ยอดจ่าย</th><th className={styles.money}>ภาษีหักไว้</th>{statusColumn && <th className={styles.status}>สถานะ</th>}
            </tr></thead><tbody>{rows.map(row => <tr key={row.id} role="link" tabIndex={0} aria-label={`เปิดรายจ่าย ${row.expenseNumber ?? row.payeeName}`} onClick={() => openRow(row)}
              onKeyDown={event => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); openRow(row); } }}>
              <td><div className={styles.name}>{row.payeeName}</div><CertificateDetails row={row} companyId={companyId} permissions={permissions} locale={locale} /></td>
              <td className={styles.date}><span className={styles.unit}>{paymentDate(row)}</span></td><td>{formName(row)}</td>
              <td className={styles.money}>{amountText(row.currentCertificate?.grossAmount ?? row.prefill.grossAmount)}</td><td className={styles.money}>{amountText(row.withheldAmount)}</td>
              {statusColumn && <td className={styles.status}><Status row={row} shopBanner={shopBanner} systemCertificatesAvailable={systemCertificatesAvailable} /></td>}
            </tr>)}</tbody></table>
          </>}
        {total > 0 && <div className={styles.pager}>
          {totalPages > 1 && <Pagination prominent page={page} totalPages={totalPages} disabled={loading} locale={locale} onPageChange={next => navigate({ page: next })} />}
        </div>}
      </CoverLoader>
      </MangmeeCard>
    </div>}
  </MangmeePage>;
}
