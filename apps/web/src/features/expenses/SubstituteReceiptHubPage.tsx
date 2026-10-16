'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { SubstituteReceiptListResult, SubstituteReceiptListItem } from '@watchdog-bms/contracts';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import { MangmeeBadge, MangmeeCard, MangmeePage, MetricGrid, type MangmeeTone } from '@/common/components/mangmee';
import { Pagination } from '@/common/components/data-table/Pagination';
import { FilterTabs } from '@/common/components/tabs';
import { Notice } from '@/common/components/notice';
import { CoverLoader, EmptyState, LoadingState } from '@/common/components/state';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { DictionaryKey } from '@/common/i18n/workspace-dictionary';
import { listCompanySubstituteReceipts } from './expenses.api';
import { listSubstituteReceiptCandidates } from './substitute-receipt.api';
import { amountText, btnClass, dateShort, err, ghostClass } from './ExpensesUi';
import { SUBSTITUTE_RECEIPT_HUB_PAGE_SIZE, SUBSTITUTE_RECEIPT_HUB_TABS, substituteReceiptHubListState, substituteReceiptHubListQuery,
  substituteReceiptHubStatus, type SubstituteReceiptHubStatus, type SubstituteReceiptHubListState } from './substitute-receipt-hub.model';
import styles from './WhtCertificatesPage.module.css';

/** One status word per row, from one map (thai-ux-standard 1.1): the certificate's own state, never the expense's badge beside it. */
const ROW_STATUS: Record<SubstituteReceiptHubStatus, { tone: MangmeeTone; key?: DictionaryKey; text?: string }> = {
  waitingSignature: { tone: 'amber', key: 'expenses.substitute_hub.status_prepared' },
  waitingPaper: { tone: 'amber', text: 'รอฉบับที่เซ็นบนกระดาษ' },
  waitingPaperReview: { tone: 'amber', text: 'รอตรวจรับฉบับกระดาษ' },
  waitingApproval: { tone: 'amber', key: 'expenses.substitute_hub.status_payer_certified' },
  issued: { tone: 'brand', key: 'expenses.substitute_hub.status_issued' },
  cancelled: { tone: 'slate', key: 'expenses.substitute_hub.status_superseded' },
};

export function SubstituteReceiptHubPage({ companyId, permissions }: {
  companyId: string; userId: string; permissions: string[]; canSelfApprove: boolean;
}) {
  const locale = useWorkspaceLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { status, yearMonth, page, order } = substituteReceiptHubListState(params);
  const canReview = permissions.includes('expense.review');
  const [hasOwnCandidate, setHasOwnCandidate] = useState(false);
  const [result, setResult] = useState<SubstituteReceiptListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const navigate = (next: SubstituteReceiptHubListState) => router.replace(`${pathname}?${substituteReceiptHubListQuery(new URLSearchParams(params.toString()), next)}`, { scroll: false });
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setLoadError(null);
    Promise.all([
      listCompanySubstituteReceipts(companyId, { status: status || undefined, yearMonth: yearMonth || undefined, page, order, pageSize: SUBSTITUTE_RECEIPT_HUB_PAGE_SIZE }),
      canReview ? Promise.resolve(null) : listSubstituteReceiptCandidates(companyId, { pageSize: 1 }),
    ]).then(([nextResult, candidates]) => {
      if (cancelled) return;
      setResult(nextResult); setHasOwnCandidate(Boolean(candidates?.total));
      const lastPage = Math.max(1, Math.ceil(nextResult.total / SUBSTITUTE_RECEIPT_HUB_PAGE_SIZE));
      if (page > lastPage) navigate({ status, yearMonth, order, page: lastPage });
    }).catch(error => { if (!cancelled) setLoadError(err(error)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canReview, companyId, status, yearMonth, page, order, refresh]);

  const wizardHref = (evidenceId: string) => `/companies/${companyId}/expenses/substitute-receipts/${encodeURIComponent(evidenceId)}`;
  const createHref = `/companies/${companyId}/expenses/substitute-receipts/new`;
  const openRow = (item: SubstituteReceiptListItem) => router.push(wizardHref(item.evidenceId));
  const rowProps = (item: SubstituteReceiptListItem) => ({
    role: 'link', tabIndex: 0, 'aria-label': `เปิดใบรับรอง ${item.documentNumber} ${payeeName(item)}`,
    onClick: () => openRow(item),
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); openRow(item); }
    },
  });
  const payeeName = (item: SubstituteReceiptListItem) => item.payeeName?.trim() || t('expenses.substitute_hub.payee_missing', locale);
  const statusBadge = (item: SubstituteReceiptListItem) => {
    const look = ROW_STATUS[substituteReceiptHubStatus(item)];
    return <MangmeeBadge className={styles.badge} tone={look.tone}>{look.key ? t(look.key, locale) : look.text}</MangmeeBadge>;
  };
  const fundingText = (item: SubstituteReceiptListItem) => item.fundingSource === 'COMPANY' ? 'เงินของร้าน' : item.fundingSource === 'PERSONAL_ADVANCE' ? 'พนักงานสำรองจ่าย' : '';
  const items = result?.items ?? [];
  const filtered = Boolean(status || yearMonth);
  const totalPages = Math.max(1, Math.ceil((result?.total ?? 0) / SUBSTITUTE_RECEIPT_HUB_PAGE_SIZE));
  const changeOrder = () => navigate({ status, yearMonth, page: 1, order: order === 'newest' ? 'oldest' : 'newest' });
  const signature = result?.attention.signature;
  const approval = result?.attention.approval;
  return <MangmeePage className="mangmee-flat" title={t('expenses.substitute_hub.title', locale)}
    actions={canReview || (hasOwnCandidate && items.length > 0) ? <Link className={btnClass} href={createHref}>{t('expenses.substitute_hub.create', locale)}</Link> : undefined}>
    <div className={styles.section}>
      <MangmeeCard className="mb-4 p-4"><MetricGrid columns={2} items={[
        { key: 'count', label: 'ใบรับรอง', value: result ? result.total.toLocaleString('th-TH') : '—', unit: 'ใบ', dot: 'bg-gray-400' },
        { key: 'total', label: 'ยอดรวม', value: result ? amountText(result.sums.total) : '—', unit: 'บาท', dot: 'bg-brand-500' },
      ]} /></MangmeeCard>
      {!!signature?.count && signature.evidenceId && <Notice tone="warning" className="mb-4" action={<Link className={ghostClass} href={wizardHref(signature.evidenceId)}>เซ็น</Link>}>
        {t('expenses.substitute_hub.waiting_signature', locale).replace('{count}', String(signature.count))}
      </Notice>}
      {!!approval?.count && approval.evidenceId && <Notice tone="warning" className="mb-4" action={<Link className={ghostClass} href={wizardHref(approval.evidenceId)}>อนุมัติ</Link>}>
        {t('expenses.substitute_hub.waiting_approval', locale).replace('{count}', String(approval.count))}
      </Notice>}
      <MangmeeCard className="p-4">
        <FilterTabs className={styles.tabs} aria-label="สถานะใบรับรอง" value={status} onChange={choice => navigate({ status: choice, yearMonth, order, page: 1 })}
          tabs={SUBSTITUTE_RECEIPT_HUB_TABS.map(tab => ({ key: tab.key, label: tab.label, disabled: loading,
            count: tab.key ? result?.counts[tab.key] ?? 0 : Object.values(result?.counts ?? {}).reduce((sum, count) => sum + count, 0) }))} />
        {/* The same filter row as the 50 ทวิ list: one third of a wide screen, the whole width on a phone. */}
        <div className="mb-4 grid grid-cols-1 items-end gap-4 lg:grid-cols-3">
          <label className="block text-sm font-semibold text-gray-700">
            <span className="mb-1 block">{t('expenses.substitute_hub.filter_month', locale)}</span>
            <ThemedDate className="mangmee-input" mode="month" value={yearMonth} onChange={event => navigate({ status, order, page: 1, yearMonth: event.target.value })} />
          </label>
        </div>
        {loadError ? <Notice tone="error" action={<button type="button" className={ghostClass} onClick={() => setRefresh(value => value + 1)}>ลองอีกครั้ง</button>}>{loadError}</Notice>
          : loading && !result ? <LoadingState label="กำลังโหลด..." /> : <CoverLoader active={loading} scope="section">
            {items.length === 0 ? filtered ? <EmptyState title="ไม่พบใบรับรองตามตัวกรองนี้" description="" action={<button type="button" className={ghostClass} onClick={() => navigate({ status: '', yearMonth: '', order, page: 1 })}>ล้างตัวกรอง</button>} />
              : canReview ? <EmptyState title={t('expenses.substitute_hub.empty', locale)} description={t('expenses.substitute_hub.empty_description', locale)} />
                : <EmptyState title="ยังไม่มีใบรับรองของค่าใช้จ่ายที่คุณบันทึก" description={hasOwnCandidate ? 'สร้างจากค่าใช้จ่ายที่คุณบันทึกและไม่มีใบเสร็จ' : 'ยังไม่มีค่าใช้จ่ายของคุณที่ต้องสร้างใบรับรอง'}
                  action={hasOwnCandidate ? <Link className={btnClass} href={createHref}>สร้างใบรับรองแทนใบเสร็จ</Link> : <Link className={ghostClass} href={`/companies/${companyId}/expenses`}>กลับไปรายการค่าใช้จ่าย</Link>} />
              : <>
                <button type="button" className={`${styles.phoneSort} mb-3 text-sm text-gray-600 hover:text-gray-900`} onClick={changeOrder}>เรียง: {order === 'newest' ? 'ใหม่ไปเก่า ↓' : 'เก่าไปใหม่ ↑'}</button>
                <table className={styles.table}>
                  <colgroup>{[34, 16, 20, 15, 15].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                  <thead><tr><th>ผู้รับเงิน</th><th aria-sort={order === 'newest' ? 'descending' : 'ascending'}><button type="button" className="inline-flex items-center gap-1 hover:text-gray-800" onClick={changeOrder}
                    aria-label={order === 'newest' ? 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่' : 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า'}>วันที่จ่าย <span aria-hidden="true">{order === 'newest' ? '↓' : '↑'}</span></button></th><th>เงินของ</th><th className={styles.money}>จำนวนเงิน</th><th className={styles.status}>สถานะ</th></tr></thead>
                  <tbody>{items.map(item => <tr key={item.evidenceId} {...rowProps(item)}>
                    <td><div className={styles.name}>{payeeName(item)}</div><div className={styles.number}>{item.documentNumber}</div></td>
                    <td className={styles.date}>{dateShort(item.paymentDate ?? item.expenseDate)}</td>
                    <td>{fundingText(item)}</td><td className={styles.money}>{amountText(item.grandTotalAmount)}</td><td className={styles.status}>{statusBadge(item)}</td>
                  </tr>)}</tbody>
                </table>
                <ul className={styles.cards} data-testid="substitute-receipt-card-list">{items.map(item => <li key={item.evidenceId} data-testid="substitute-receipt-card" {...rowProps(item)}>
                  <MangmeeCard className={styles.card}><div className={styles.heading}><span className={styles.name}>{payeeName(item)}</span><span className={styles.money}>{amountText(item.grandTotalAmount)} บาท</span></div>
                    <div className={styles.number}>{item.documentNumber} · {dateShort(item.paymentDate ?? item.expenseDate)}{fundingText(item) && ` · ${fundingText(item)}`}</div>
                    <div className="mt-3 text-right">{statusBadge(item)}</div>
                  </MangmeeCard>
                </li>)}</ul>
              </>}
            {totalPages > 1 && <div className={styles.pager}><Pagination prominent page={page} totalPages={totalPages} disabled={loading} locale={locale} onPageChange={next => navigate({ status, yearMonth, order, page: next })} /></div>}
          </CoverLoader>}
      </MangmeeCard>
    </div>
  </MangmeePage>;
}
