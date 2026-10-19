'use client';
import { formatClaimMoney as formatMoney } from './ReimbursementDetailSections';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, MangmeePage, MetricGrid, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { EmptyState } from '@/common/components/state/EmptyState';
import { LoadingState } from '@/common/components/state/LoadingState';
import {
  loadHubPage, getReimbursement, getReimbursementHub,
  listApprovalQueue, approveReimbursement,
  listFinanceQueue, financeReviewReimbursement,
  getReimbursementPolicy, listReimbursementApproverOptions, updateReimbursementPolicy,
} from './reimbursements.api';
import {
  FINANCE_REVIEW_LABELS, POLICY_TAB_LABEL, REIMBURSEMENT_CREATE_UNAVAILABLE, REIMBURSEMENT_NO_ACCESS, SELF_APPROVAL_SWITCH_LABEL, SELF_APPROVAL_POLICY_NOTE,
  claimDeskText, claimStatusBadge,
} from './reimbursements.model';
import {
  amountText, dateShort, ICON, ErrorBanner,
  inputClass, btnClass, ghostClass,
} from '../expenses/ExpensesUi';
import {
  claimListBadge, claimQueueMetrics, sortClaimRows, matchesSearch, pageBounds,
  initialHubTab, claimHubQuery, claimHubFilter, parseHubTab, visibleHubTabs, withAssignedApprovalTab, reimbursementListScope, errorText, isStaleApprovalError, diffApprovalFields,
  policyDecisionPreview, approvalComparable, type HubTab,
  type HubFilter, approverPaymentWarning,
  NO_HUB_LIST, QUEUE_PAGE_SIZE, HUB_SEARCH_DELAY_MS, hubList, hubListKey, hubListStatusText, hubNextPage, withHubFailure, withHubPage, withHubRetry, type HubList,
  queueRowAwaitsDuplicateCheck, queueRowOffersFinanceReview, queueRowOffersPayment, quickPayBlockedNote, quickPayTarget, duplicateCanBeCleared,
  approvalRowOffers, financeQueueWords, rowHasFinanceReview, rowMayBeDuplicate,
} from './reimbursements.logic';
import {
  PaymentForm, StaleApprovalDialog, financeActionLabel, useClaimDocumentPreview,
} from './ReimbursementDetailSections';
import { isThirdPartyAcceptanceRefusal, claimNeedsPayoutAttestation } from './reimbursement-payout.logic';
import { ClaimPayoutCard } from './ReimbursementPayout';
import { roleDisplayName } from '../employee-access/role-picker.logic';
import { REIMBURSEMENT_DUPLICATE_BLOCK_LABEL, reimbursementDuplicateBlockText, type ReimbursementApproverRoleOption } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';
import { ActionGroup } from '@/common/components/actions/ActionGroup';
import { ChoiceRow } from '@/common/components/field/ChoiceRow';
import { Notice } from '@/common/components/notice';
import { FilterTabs } from '@/common/components/tabs';
import { MoreActions } from '@/common/components/actions/MoreActions';
import { Pagination } from '@/common/components/data-table/Pagination';
import type { ReactNode } from 'react';

/** The settings tab: a section's heading, and the label of a field in it (14 px, as on the claim form). */
const SETTINGS_HEADING_CLASS = 'text-base font-bold text-gray-900';
const SETTINGS_LABEL_CLASS = 'mb-1.5 block text-sm font-semibold text-gray-700';

/** Every banner in this feature goes through here, so API error codes never reach the user raw. */
function err(e: unknown) { return errorText(e); }

// The third tab has no fixed name: it is the finance queue or the pay queue by the company's policy (`financeQueueWords`).
type NamedHubTab = Exclude<HubTab, 'finance'>;
/** A tab is named for what its list holds: every claim the reader may see, then the ones that wait for them. */
const HUB_TAB_LABELS: Record<NamedHubTab, string> = {
  mine: 'ใบเบิกทั้งหมด', approvals: 'รออนุมัติ', policy: POLICY_TAB_LABEL,
};
/** A claim that has waited longer than the company's deadline, in the words of the notice the server sends for it. */
const OVERDUE_LABEL = 'เกินกำหนด';
/** The mark of a claim that may repeat another one, on a row of either queue. */
const MAY_BE_DUPLICATE_LABEL = reimbursementDuplicateBlockText();
/** The one button of a pay-queue row held as a possible duplicate: it opens the claim, where the receipts are compared. */
const CHECK_DUPLICATE_LABEL = 'ตรวจรายการซ้ำ';
/** The deadline itself: how long a claim may wait for its approval, and then for its payment. */
const DEADLINE_LABEL = 'กำหนดเวลาอนุมัติและจ่าย';
const approverRoleName = (option?: Pick<ReimbursementApproverRoleOption, 'key' | 'name'>) =>
  option ? roleDisplayName({ ...option, isSystem: false }) : '';
const shortDate = (iso?: string) => dateShort(iso);
function TablePager({ total, page, totalPages, onPage }: {
  from: number; to: number; total: number; page: number; totalPages: number; onPage: (page: number) => void;
}) {
  return total > 0 && totalPages > 1 ? <div className="pt-4"><Pagination prominent page={page} totalPages={totalPages} onPageChange={onPage} /></div> : null;
}

export function ClaimQueueMetrics({ metrics }: { metrics: ReturnType<typeof claimQueueMetrics> }) {
  return <MangmeeCard className="p-4"><MetricGrid columns={3} items={[
    { key: 'all', label: 'ใบเบิก', value: String(metrics.all.count), unit: 'รายการ', note: `ยอดรวม ${amountText(metrics.all.amount)} บาท`, dot: 'bg-gray-400' },
    { key: 'approval', label: 'รออนุมัติ', value: String(metrics.pendingApproval.count), unit: 'รายการ', note: `${amountText(metrics.pendingApproval.amount)} บาท`, dot: 'bg-amber-400' },
    { key: 'payment', label: 'รอจ่าย', value: String(metrics.pendingPayment.count), unit: 'รายการ', note: `${amountText(metrics.pendingPayment.amount)} บาท`, dot: 'bg-brand-500' },
  ]} /></MangmeeCard>;
}

export function ClaimQueueRows({ rows, queue, detailHref, onOpenDetail, order, onOrder, action }: {
  rows: any[]; queue: string; detailHref: (id: string) => string; onOpenDetail: (id: string) => void;
  order: 'newest' | 'oldest'; onOrder: () => void; action?: (row: any, layout: 'cards' | 'table') => ReactNode;
}) {
  const badge = (row: any) => { const status = claimListBadge(row); return <MangmeeBadge tone={status.tone}>{status.label}</MangmeeBadge>; };
  const open = (row: any) => ({ role: 'link', tabIndex: 0, 'data-href': detailHref(row.id),
    'aria-label': `เปิดใบเบิก ${row.reason ?? ''} ${row.requestNo ?? ''}`.trim(),
    onClick: () => onOpenDetail(row.id),
    onKeyDown: (event: React.KeyboardEvent) => { if (event.key === 'Enter' && event.target === event.currentTarget) { event.preventDefault(); onOpenDetail(row.id); } },
  });
  const sort = <button type="button" onClick={onOrder} className="min-h-11 text-left" aria-label={order === 'newest' ? 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่' : 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า'}>วันที่ {order === 'newest' ? '↓' : '↑'}</button>;
  return <div className="min-w-0">
    <div className="sm:hidden text-sm text-gray-500">{sort}</div>
    <table className="hidden w-full table-fixed border-collapse sm:table" data-testid={`reimbursements-${queue}-table`}>
      <colgroup>{[32, 17, 14, 15, 22].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
      <thead className="border-b border-gray-100 text-left text-[13px] font-bold text-gray-500"><tr>
        <th className="px-2 pb-2">ใบเบิก</th><th className="px-2 pb-2">ผู้เบิก</th><th className="px-2 pb-2">{sort}</th><th className="px-2 pb-2 text-right">ยอดเงิน (บาท)</th><th className="px-2 pb-2 text-right">สถานะ</th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} {...open(row)} className="cursor-pointer border-b border-gray-50 transition-colors hover:bg-gray-50 focus-visible:outline-brand-500">
        <td className="break-words px-2 py-3"><div className="text-[15px] font-semibold text-gray-900">{row.reason}</div>{row.requestNo && <div className="mt-0.5 text-xs text-gray-500">{row.requestNo}</div>}</td>
        <td className="break-words px-2 py-3 text-sm text-gray-700">{row.requesterDisplayNameSnapshot}</td>
        <td className="px-2 py-3 text-xs text-gray-500">{row.incurredDate ? shortDate(row.incurredDate) : ''}</td>
        <td className="px-2 py-3 text-right text-[15px] font-bold tabular-nums text-gray-900">{amountText(row.amount)}</td>
        <td className="px-2 py-3 text-right"><div className="flex flex-wrap justify-end gap-2">{badge(row)}{action?.(row, 'table')}</div></td>
      </tr>)}</tbody>
    </table>
    <ul className="divide-y divide-gray-50 sm:hidden" data-testid={`reimbursements-${queue}-card-list`}>
      {rows.map(row => <li key={row.id} {...open(row)} className="cursor-pointer break-words py-3 hover:bg-gray-50" data-testid={`reimbursements-${queue}-card`}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"><div className="text-[15px] font-semibold text-gray-900">{row.reason}</div><span className="text-right text-[15px] font-bold tabular-nums">{amountText(row.amount)} บาท</span></div>
        <div className="mt-0.5 text-xs text-gray-500">{[row.requestNo, row.incurredDate ? shortDate(row.incurredDate) : '', row.requesterDisplayNameSnapshot].filter(Boolean).join(' · ')}</div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">{badge(row)}{action?.(row, 'cards')}</div>
      </li>)}
    </ul>
  </div>;
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <div className="relative min-w-0 w-full flex-1">
      <input className={cx(inputClass, 'mangmee-input-icon-end w-full')} type="search" aria-label="ค้นหา" placeholder={placeholder}
        value={value} onChange={e => onChange(e.target.value)} />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
        {ICON.search}
      </span>
    </div>
  );
}

export function ReimbursementsHubPage({ companyId, userId, permissions, roles }: {
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roles: readonly string[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const permissionTabs = useMemo(() => visibleHubTabs(permissions, roles), [permissions, roles]);
  const hasApprovalPermission = permissionTabs.includes('approvals');
  const [assignedApprovalCompanyId, setAssignedApprovalCompanyId] = useState<string | null>(null);
  const [probedApprovalCompanyId, setProbedApprovalCompanyId] = useState<string | null>(null);
  const hasAssignedApprovalTask = hasApprovalPermission || assignedApprovalCompanyId === companyId;
  const assignmentProbeDone = hasApprovalPermission || probedApprovalCompanyId === companyId;
  const tabs = useMemo(
    () => withAssignedApprovalTab(permissionTabs, hasAssignedApprovalTask),
    [permissionTabs, hasAssignedApprovalTask],
  );
  const requestedTab = searchParams.get('tab');
  // Deep-link changes also select the queue when this hub is already mounted.
  const [tab, setTab] = useState<HubTab>(() => parseHubTab(requestedTab, tabs));
  // Rows open the claim's journey page: every claim view and action lives on that page.
  const detailHref = useCallback((id: string) => `/companies/${companyId}/reimbursements/${id}${claimHubQuery(tab, searchParams.get('filter'))}`, [companyId, tab, searchParams]);
  const openJourney = useCallback((id: string) => router.push(detailHref(id)), [detailHref, router]);
  // "บันทึกจ่าย" stays a quick action right on the finance row; it never needed the drawer.
  const [payFor, setPayFor] = useState<any | null>(null);
  // On a phone the payment form is never a dialog (spec §12.2, §21): the same press opens the claim's
  // own page with the form already open in its payment step card. Which it is comes from the layout
  // the press was made in (the queue's stacked rows or its table), so the dialog never opens over the
  // layout this page shows a phone.
  const recordPayment = useCallback((row: any, layout: 'cards' | 'table') => {
    const target = quickPayTarget(layout, companyId, row.id);
    if (target.kind === 'page') router.push(`${detailHref(row.id)}&pay=1`);
    else setPayFor(row);
  }, [companyId, detailHref, router]);
  const [refreshKey, setRefreshKey] = useState(0);

  // The first hub read supplies the finance-step label and counts only work this reader can take.
  const hasThirdTab = permissionTabs.includes('finance');
  const [queueRead, setQueueRead] = useState<{ companyId: string; approvals: number; finance?: number; listCounts?: Partial<Record<'mine' | 'approvals' | 'finance', number>> } | null>(null);
  const [policyRead, setPolicyRead] = useState<{ companyId: string | null; financeStep: boolean }>({ companyId: null, financeStep: true });
  const notePolicy = useCallback((policy: { financeReviewRequired?: boolean }) => {
    setPolicyRead({ companyId, financeStep: policy.financeReviewRequired === true });
  }, [companyId]);
  useEffect(() => {
    let current = true;
    void getReimbursementHub(companyId).then(answer => {
      if (!current) return;
      notePolicy(answer);
      setQueueRead({ companyId, ...answer.queueCounts, listCounts: answer.listCounts });
      if (answer.hasApprovalTasks) setAssignedApprovalCompanyId(companyId);
    }).catch(() => { if (current) notePolicy({ financeReviewRequired: true }); })
      .finally(() => { if (current) setProbedApprovalCompanyId(companyId); });
    return () => { current = false; };
  }, [companyId, notePolicy, refreshKey]);
  // Undefined: not told yet, and the tab is not named before it is known.
  const financeStep = !hasThirdTab ? true : policyRead.companyId === companyId ? policyRead.financeStep : undefined;
  const financeWords = financeStep === undefined ? undefined : financeQueueWords(financeStep);
  const tabLabel = (t: HubTab) => (t === 'finance' ? financeWords?.tab : HUB_TAB_LABELS[t]);

  // The work counts choose the opening tab once. A later count (the last claim of the queue paid or approved)
  // never moves the person off the list they are working in; only a tab they can no longer see does.
  const countsPickedFor = useRef<string | null>(null);
  useEffect(() => {
    const counted = queueRead?.companyId === companyId;
    if (!requestedTab && countsPickedFor.current === companyId) {
      setTab(current => (tabs.includes(current) ? current : parseHubTab('mine', tabs)));
      return;
    }
    setTab(initialHubTab(requestedTab, tabs, counted ? queueRead : { approvals: 0 }));
    if (counted) countsPickedFor.current = companyId;
  }, [companyId, requestedTab, tabs, queueRead?.companyId, queueRead?.approvals, queueRead?.finance]);
  const onQueueCount = useCallback((queue: 'mine' | 'approvals' | 'finance', count: number) => {
    setQueueRead(current => current?.companyId === companyId ? { ...current, listCounts: { ...current.listCounts, [queue]: count } } : current);
  }, [companyId]);
  const chooseTab = (next: HubTab) => {
    setTab(next);
    const query = new URLSearchParams(searchParams.toString());
    query.set('tab', next);
    router.replace(`/companies/${companyId}/reimbursements?${query.toString()}`, { scroll: false });
  };

  if (!assignmentProbeDone && tabs.length === 0) {
    return <LoadingState label="กำลังตรวจสอบงานอนุมัติของคุณ..." />;
  }

  if (tabs.length === 0) {
    return (
      <MangmeePage className="mangmee-flat" title="การเบิกจ่าย">
        <MangmeeCard className="p-6">
          <EmptyState title="บัญชีนี้ยังใช้การเบิกจ่ายไม่ได้" description={REIMBURSEMENT_NO_ACCESS}
            action={<Link href={`/companies/${companyId}/dashboard`} className={ghostClass}>กลับไปแดชบอร์ด</Link>} />
        </MangmeeCard>
      </MangmeePage>
    );
  }

  const canCreate = permissions.includes('reimbursement.create');
  // The lists a person works in. One list needs no tab bar: a bar with one tab is a control that does nothing.
  const workTabs = tabs.filter(t => t !== 'policy' && tabLabel(t));
  const queueProps = { companyId, refreshKey, onOpenDetail: openJourney, detailHref, permissions, onQueueCount };
  return (
    <MangmeePage
      className="mangmee-flat" title="การเบิกจ่าย"
      // Two equal cells side by side at every width (owner: buttons in a group are one size); the measured
      // ActionGroup stacked them on a wide screen because the menu's panel counted toward its width.
      actions={<div className="grid w-full auto-cols-fr grid-flow-col gap-3 sm:w-auto sm:min-w-80 [&>*]:min-w-0 [&>details>summary]:w-full [&>a]:w-full">
        {(canCreate || tabs.includes('policy')) && <MoreActions label="เพิ่มเติม" align="end" closeOnPress>
          {canCreate && <Link href={`/companies/${companyId}/reimbursements/payout-account`}>บัญชีรับเงินคืนของฉัน</Link>}
          {tabs.includes('policy') && <button type="button" onClick={() => chooseTab('policy')}>{HUB_TAB_LABELS.policy}</button>}
        </MoreActions>}
        {canCreate && tab === 'mine' && <Link href={`/companies/${companyId}/reimbursements/new`} className={btnClass}>+ สร้างใบเบิก</Link>}
      </div>}
    >
      {workTabs.length > 0 && <nav aria-label="งานเบิกจ่าย"><FilterTabs aria-label="งานเบิกจ่าย" value={tab} onChange={chooseTab}
        tabs={workTabs.map(t => ({ key: t, label: tabLabel(t)!, count: queueRead?.listCounts?.[t as 'mine' | 'approvals' | 'finance'] }))} /></nav>}
      {!canCreate && <Notice tone="info">{REIMBURSEMENT_CREATE_UNAVAILABLE}</Notice>}
      {tab === 'mine' && <MyRequests
        {...queueProps}
        userId={userId}
        canCreate={canCreate}
      />}
      {tab === 'approvals' && <ApprovalQueue {...queueProps} />}
      {tab === 'finance' && <FinanceQueue {...queueProps} userId={userId} financeStep={financeStep} onRecordPayment={recordPayment} />}
      {tab === 'policy' && <PolicySettings companyId={companyId} onPolicy={notePolicy} />}

      {payFor && <PaymentModal
        companyId={companyId}
        userId={userId}
        permissions={permissions}
        request={payFor}
        onClose={() => setPayFor(null)}
        onDone={() => {
          setPayFor(null);
          setRefreshKey(k => k + 1);
        }}
      />}
    </MangmeePage>
  );
}

type QueueProps = { companyId: string; refreshKey: number; onOpenDetail: (id: string) => void; detailHref: (id: string) => string; permissions: readonly string[]; onQueueCount: (queue: 'mine' | 'approvals' | 'finance', count: number) => void };

// ── Every claim the reader may see ────────────────────────────────────────────
function MyRequests({ companyId, refreshKey, onOpenDetail, detailHref, userId, permissions, canCreate, onQueueCount }: QueueProps & {
  userId: string;
  permissions: readonly string[];
  canCreate: boolean;
}) {
  // One list is held, a page at a time. Which list it is (company, scope, filter, reload) is part of what is
  // held, so rows that were loaded for another one are never shown, and an answer that arrives late is dropped.
  const [held, setHeld] = useState<HubList>(NO_HUB_LIST);
  const searchParams = useSearchParams();
  const router = useRouter();
  const statusFilter = claimHubFilter(searchParams.get('filter'));
  const setStatusFilter = (filter: HubFilter) => router.replace(`/companies/${companyId}/reimbursements${claimHubQuery('mine', filter)}`, { scroll: false });
  const [query, setQuery] = useState('');
  // The search the API is asked for: what was typed, once the typing has paused. Before, the search ran in the
  // browser over rows it first had to load, every page of the filter (30 calls for 3,000 claims).
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), HUB_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');

  const scope = reimbursementListScope(permissions);
  // Search and date order identify the server-paged set.
  const listKey = hubListKey(companyId, scope, statusFilter, refreshKey, 0, search, order);
  const list = hubList(held, listKey);
  const searching = search !== '';
  // Lazy: the first page of the filter and the search, then more only when the table page shown reaches past what is held.
  const nextPage = hubNextPage(list, page * QUEUE_PAGE_SIZE);
  useEffect(() => {
    if (nextPage === null) return;
    // The cleanup lets go of the request: another filter or search, a reload, another company or an unmount leaves its answer unused.
    return loadHubPage(companyId, { scope, filter: statusFilter, search, order, page: nextPage }, {
      onPage: (result) => { setHeld((current) => withHubPage(current, listKey, result)); if (!search) onQueueCount('mine', result.hub.counts.all); },
      onError: (e) => setHeld((current) => withHubFailure(current, listKey, err(e))),
    });
  }, [companyId, scope, statusFilter, search, order, listKey, nextPage, onQueueCount]);
  const loading = nextPage !== null;
  // The filter's counts are the server's, so they hold whatever part of the list is loaded: of the whole scope,
  // or with a search of what the search found. Either way the number on a filter is the rows it shows.
  const summary = list.summary;
  const rows = list.rows;

  // The server's total stands for the rows not loaded yet. A list that is complete counts the rows it holds.
  const shownTotal = list.nextPage === null ? rows.length : list.total;
  const bounds = useMemo(() => pageBounds(shownTotal, page), [shownTotal, page]);
  const pagedData = useMemo(() => rows.slice(bounds.start, bounds.end), [rows, bounds]);
  useEffect(() => { setPage(1); }, [search, statusFilter, order]);
  const statusChips: Array<{ key: HubFilter; label: string }> = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'draft', label: 'ร่าง' },
    { key: 'correction', label: 'ต้องแก้ไข' },
    { key: 'review', label: 'รออนุมัติ/ตรวจสอบ' },
    { key: 'payment', label: 'รอจ่าย' },
    { key: 'duplicate_blocked', label: REIMBURSEMENT_DUPLICATE_BLOCK_LABEL },
    { key: 'paid', label: 'จ่ายแล้ว' },
    { key: 'closed', label: 'ยกเลิก' },
  ];

  return (
    <div className="space-y-4">
      {list.failed !== undefined && (
        // A page that did not arrive is said as such, with a way to ask again: never as "ยังไม่มีใบเบิก".
        <div data-testid="reimbursements-mine-load-failed">
          <Notice tone="error" action={<button type="button" className={ghostClass} onClick={() => setHeld(withHubRetry)}>ลองอีกครั้ง</button>}>
            {rows.length > 0 ? `โหลดรายการได้ไม่ครบ รายการด้านล่างยังไม่ใช่ทั้งหมด · ${list.failed}` : `โหลดรายการไม่สำเร็จ · ${list.failed}`}
          </Notice>
        </div>
      )}
      {!summary ? loading && <LoadingState label="กำลังโหลด..." /> : (
        <><ClaimQueueMetrics metrics={{ all: { count: summary.counts.all, amount: summary.totalAmount },
          pendingApproval: summary.metrics?.pendingApproval ?? { count: 0, amount: '0' }, pendingPayment: summary.metrics?.pendingPayment ?? { count: 0, amount: '0' } }} />
        <MangmeeCard className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="w-full sm:w-56" data-testid="reimbursements-mine-filters">
              <ThemedSelect aria-label="สถานะ" className={inputClass} value={statusFilter} placeholder={`${statusChips.find(chip => chip.key === statusFilter)?.label} (${summary.counts[statusFilter]})`} onChange={event => setStatusFilter(event.target.value as HubFilter)}>
                {statusChips.filter(chip => chip.key === 'all' || summary.counts[chip.key] > 0).map(chip => <option key={chip.key} value={chip.key}>{chip.label} ({summary.counts[chip.key]})</option>)}
              </ThemedSelect>
            </div>
            {/* Short enough to read whole on a 390 px phone. */}
            <SearchBox value={query} onChange={setQuery} placeholder="ค้นหาเลขที่ เหตุผล ยอดเงิน" />
          </div>
          {(loading || searching) && (
            <div className="mt-3 text-sm text-gray-500 tabular-nums" role="status">
              {loading ? 'กำลังโหลดรายการ...' : hubListStatusText(shownTotal, summary.counts.all, statusFilter, searching)}
            </div>
          )}
          {pagedData.length === 0 ? (
            // Nothing to show yet is not "no claims": a page still on its way, or one that failed, says so itself.
            loading ? <LoadingState label="กำลังโหลด..." /> : list.failed === undefined && (
              <div className="mt-3">
                {/* With a search the counts are of what it found: none found is not a shop with no claims. */}
                {summary.counts.all === 0 && !searching ? (
                  <EmptyState title="ยังไม่มีใบเบิก"
                    description={canCreate ? 'จ่ายเงินแทนร้านไปก่อน? สร้างใบเบิกพร้อมใบเสร็จเพื่อขอเงินคืน' : REIMBURSEMENT_CREATE_UNAVAILABLE}
                    action={canCreate ? <Link href={`/companies/${companyId}/reimbursements/new`} className={ghostClass}>สร้างใบเบิก</Link> : undefined} />
                ) : <EmptyState title="ไม่พบใบเบิกที่ตรงกับตัวกรอง" description="ลองล้างคำค้นหรือเลือกสถานะอื่น" />}
              </div>
            )
          ) : (
          <ClaimQueueRows rows={pagedData} queue="mine" detailHref={detailHref} onOpenDetail={onOpenDetail} order={order} onOrder={() => setOrder(order === 'newest' ? 'oldest' : 'newest')} />
          )}
          <TablePager from={bounds.from} to={bounds.to} total={shownTotal}
            page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
        </MangmeeCard></>
      )}
    </div>
  );
}

// ── Claims that wait for the reader's approval ────────────────────────────────
function ApprovalQueue({ companyId, refreshKey, onOpenDetail, detailHref, onQueueCount }: QueueProps) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');
  const [staleReview, setStaleReview] = useState<{ row: any; detail: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const rows = await listApprovalQueue(companyId); setData(rows); onQueueCount('approvals', rows.length); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, onQueueCount]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const approveRow = async (r: any) => {
    // A claim paid by transfer is approved on its own page, where the approver sees and attests the account. So is
    // the new account of a correction round: a row shows nothing of what changed, so it never approves one in place.
    if (approvalRowOffers(r).onClaimPage) { onOpenDetail(r.id); return; }
    setBusy(r.id); setError(null);
    try {
      await approveReimbursement(companyId, r.id, undefined, r.approvalSnapshotHash);
      await load();
      toast.success('อนุมัติใบเบิกแล้ว');
    } catch (e) {
      // A claim edited after it was sent gets its dialog. A refusal of any other kind usually means the claim moved on
      // while this queue was open: cancelled, decided by someone else, sent back. Then reload, and restore the message
      // `load` cleared, so the approver reads what was refused above a queue that shows the claims as they are now.
      if (isStaleApprovalError(e)) {
        try {
          setStaleReview({ row: r, detail: await getReimbursement(companyId, r.id) });
        } catch (e2) { setError(err(e2)); }
      } else {
        const failure = err(e);
        await load();
        setError(failure);
        if (isThirdPartyAcceptanceRefusal(e)) { toast.error(failure); onOpenDetail(r.id); }
      }
    } finally { setBusy(null); }
  };
  const filteredData = useMemo(() => sortClaimRows(data.filter(r => matchesSearch([
    r.requestNo,
    r.requesterDisplayNameSnapshot,
    r.reason,
    r.lineCount ?? 1,
    r.amount,
    r.currency,
    r.ageHours,
    r.slaRisk ? OVERDUE_LABEL : '',
    rowMayBeDuplicate(r) ? MAY_BE_DUPLICATE_LABEL : '',
    claimDeskText(r),
  ], query)), order), [data, query, order]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query, order]);
  // One button a row, never the page's green one: "อนุมัติ" where the row can decide in place (a cash claim), else the
  // way to the claim's own page under the name of what is checked there. Refusing is done on that page, beside the
  // receipts. The server says what this viewer may do with the row, as on the claim page: never guessed from a role or a tab.
  const rowButton = (r: any) => approvalRowOffers(r).approveLabel && (
    <button type="button" className={ghostClass} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)}
      onClick={e => { e.stopPropagation(); void approveRow(r); }}>{approvalRowOffers(r).approveLabel}</button>
  );

  return (
    <div className="space-y-4">
      {/* The queue's own answer to a refused approval (the call raises no toast): brought into view, since the row that was
          pressed may be far below it on a phone. Not while the dialog of an edited claim is open: that dialog shows it. */}
      {error && <ErrorBanner message={error} focus={!staleReview} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <><ClaimQueueMetrics metrics={claimQueueMetrics(filteredData)} /><MangmeeCard className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {data.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder="ค้นหาเลขที่ ผู้เบิก เหตุผล ยอดเงิน" />}
          </div>
          {filteredData.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title={data.length === 0 ? 'ไม่มีใบเบิกรอคุณอนุมัติ' : 'ไม่พบใบเบิกที่ตรงกับคำค้น'}
                description={data.length === 0 ? 'ใบเบิกที่ส่งมาให้คุณอนุมัติจะอยู่ที่นี่' : 'ลองล้างคำค้น'}
              />
            </div>
          ) : (
          <ClaimQueueRows rows={pagedData} queue="approvals" detailHref={detailHref} onOpenDetail={onOpenDetail} order={order} onOrder={() => setOrder(order === 'newest' ? 'oldest' : 'newest')} action={rowButton} />
          )}
          <TablePager from={bounds.from} to={bounds.to} total={filteredData.length}
            page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
        </MangmeeCard></>
      )}
      {staleReview && <StaleApprovalDialog
        requestNo={staleReview.detail.requestNo ?? staleReview.row.requestNo}
        beforePayout={staleReview.row.payout} payout={staleReview.detail.payout}
        diff={diffApprovalFields(
          approvalComparable(staleReview.row, staleReview.row.lineCount ?? 1),
          approvalComparable(staleReview.detail, (staleReview.detail.lines ?? []).length),
        )}
        lines={staleReview.detail.lines ?? []}
        currency={staleReview.detail.currency}
        busy={busy === staleReview.row.id}
        error={error}
        onClose={() => setStaleReview(null)}
        // Sent again as a transfer claim since the list loaded: its account is checked on its own page.
        {...(claimNeedsPayoutAttestation(staleReview.detail) && { confirmLabel: 'เปิดใบเพื่อตรวจบัญชีรับเงิน' })}
        onConfirm={async () => {
          const review = staleReview;
          if (!review) return;
          if (claimNeedsPayoutAttestation(review.detail)) { setStaleReview(null); onOpenDetail(review.row.id); return; }
          setBusy(review.row.id); setError(null);
          try {
            await approveReimbursement(companyId, review.row.id, undefined, review.detail.approvalSnapshotHash);
            setStaleReview(null);
            await load();
            toast.success('อนุมัติใบเบิกแล้ว');
          } catch (e) { setError(err(e)); if (isThirdPartyAcceptanceRefusal(e)) { setStaleReview(null); await load(); toast.error(err(e)); onOpenDetail(review.row.id); } }
          finally { setBusy(null); }
        }}
      />}
    </div>
  );
}

// ── Claims that wait for their payment (and, with a finance step, for its review) ─────────────
function FinanceQueue({ companyId, refreshKey, onOpenDetail, detailHref, permissions, onRecordPayment, financeStep, onQueueCount }: QueueProps & {
  userId: string;
  /** `layout`: where the press was made, the table (a dialog opens) or the phone's stacked rows (the claim page opens). */
  onRecordPayment: (request: any, layout: 'cards' | 'table') => void;
  /** Whether the company has the finance-review step. Undefined while the page is still reading its policy. */
  financeStep: boolean | undefined;
}) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const rows = await listFinanceQueue(companyId); setData(rows); onQueueCount('finance', rows.length); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, onQueueCount]);
  useEffect(() => { load(); }, [load, refreshKey]);

  /**
   * อนุมัติจ่าย commits its decision before it projects the claim expenses, so a failed call
   * still changes the row (financeReviewStatus becomes อนุมัติจ่าย while the status stays
   * รอตรวจสอบการเงิน). Reload either way, then restore the message `load` cleared, so the
   * user sees both what went wrong and the row's real state — with its ดำเนินการต่อ button.
   */
  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setBusy(id); setError(null);
    let failure: string | null = null;
    try { await fn(); } catch (e) { failure = err(e); }
    await load();
    if (failure) setError(failure);
    else if (successMessage) toast.success(successMessage);
    setBusy(null);
  };
  // The policy is frozen on a claim when it is sent, so a claim sent while the company had the finance step still goes
  // through it, or went through it, after the company turned the step off. In a company with no such step the queue
  // speaks of a review only for that claim: its row says where its review stands, a claim that never had the step says
  // nothing of one.
  const financeLine = useCallback((r: any): string | undefined => (
    financeStep === true || rowHasFinanceReview(r) ? FINANCE_REVIEW_LABELS[r.financeReviewStatus] ?? '—' : undefined
  ), [financeStep]);
  const words = financeQueueWords(financeStep === true || data.some(queueRowOffersFinanceReview));
  const filteredData = useMemo(() => sortClaimRows(data.filter(r => matchesSearch([
    r.requestNo,
    r.requesterDisplayNameSnapshot,
    r.lineCount ?? 1,
    r.outstandingAmount,
    r.amount,
    r.currency,
    claimStatusBadge(r).label,
    financeLine(r),
    r.hasDuplicateBlocker ? reimbursementDuplicateBlockText(r.duplicateReasons) : '',
    claimDeskText(r),
  ], query)), order), [data, query, financeLine, order]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query, order]);
  // One button a row, never the page's green one: the finance decision where the row waits for it, else the payment.
  // A claim held as a possible duplicate is paid from no row: whoever may clear it gets the way to its page, where the
  // receipts and the button for it are.
  const rowButton = (r: any, layout: 'cards' | 'table') => {
    const blockedByDuplicate = duplicateCanBeCleared(r) && !permissions.includes('reimbursement.duplicate.resolve');
    if (queueRowOffersFinanceReview(r)) {
      return (
        <button type="button" className={ghostClass} disabled={busy === r.id || blockedByDuplicate} aria-busy={Boolean(busy === r.id)}
          title={blockedByDuplicate ? 'รายการนี้อาจซ้ำ ต้องให้ผู้มีสิทธิ์แก้รายการซ้ำตรวจสอบ' : undefined}
          onClick={e => { e.stopPropagation(); void action(r.id, () => financeReviewReimbursement(companyId, r.id, { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: duplicateCanBeCleared(r), duplicateResolutionReason: duplicateCanBeCleared(r) ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined }), r.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ทำขั้นตอนอนุมัติจ่ายต่อแล้ว' : 'อนุมัติจ่ายแล้ว'); }}>
          {financeActionLabel(r)}
        </button>
      );
    }
    if (queueRowAwaitsDuplicateCheck(r)) {
      return !blockedByDuplicate && (
        <button type="button" className={ghostClass} onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }}>{CHECK_DUPLICATE_LABEL}</button>
      );
    }
    return queueRowOffersPayment(r, permissions) && (
      <button type="button" className={ghostClass} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)}
        onClick={e => { e.stopPropagation(); onRecordPayment(r, layout); }}>จ่ายเงิน</button>
    );
  };

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {loading || financeStep === undefined ? <LoadingState label="กำลังโหลด..." /> : (
        <><ClaimQueueMetrics metrics={claimQueueMetrics(filteredData)} /><MangmeeCard className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            {data.length > 0 && <SearchBox value={query} onChange={setQuery} placeholder="ค้นหาเลขที่ ผู้เบิก ยอดเงิน" />}
          </div>
          {filteredData.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title={data.length === 0 ? words.emptyTitle : 'ไม่พบใบเบิกที่ตรงกับคำค้น'}
                description={data.length === 0 ? words.emptyDescription : 'ลองล้างคำค้น'}
              />
            </div>
          ) : (
          <ClaimQueueRows rows={pagedData} queue="finance" detailHref={detailHref} onOpenDetail={onOpenDetail} order={order} onOrder={() => setOrder(order === 'newest' ? 'oldest' : 'newest')} action={rowButton} />
          )}
          <TablePager from={bounds.from} to={bounds.to} total={filteredData.length}
            page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
        </MangmeeCard></>
      )}
    </div>
  );
}

// Exported for the QA spec, which renders the dialog with its claim already read.
export function PaymentModal({ companyId, userId, permissions, request, onClose, onDone }: { companyId: string; userId: string; permissions: readonly string[]; request: any; onClose: () => void; onDone: () => void }) {
  // The queue row carries no attachments and nothing about where to pay. The claim does: the account
  // to transfer into, the version the payer confirms and the files that can be the slip. The form
  // seeds its own state from what it is given when it mounts, so it mounts once, when that read has
  // settled, and never on the bare row: recording a transfer for an account nobody was shown is what
  // this step exists to prevent. A read that fails says so, with the claim's own page as the way on.
  const [claim, setClaim] = useState<any | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The files listed under "เลือกจากไฟล์ที่แนบไว้ในใบนี้" are opened before one is chosen, as on the claim's own page
  // (upgrade test 2026-10-02: here the list had no way to look, and a signed PDF and a slip were chosen between blind).
  // The viewer is a sibling of this dialog: closing the file leaves the form as it was.
  const [openFileError, setOpenFileError] = useState<string | null>(null);
  const paymentSaving = useRef(false);
  const { openSlipChoice, previewModals } = useClaimDocumentPreview(companyId, setOpenFileError);
  useEffect(() => {
    let active = true;
    setFailed(null);
    getReimbursement(companyId, request.id)
      .then((detail) => { if (active) setClaim(detail); })
      .catch((e) => { if (active) setFailed(err(e)); });
    return () => { active = false; };
  }, [companyId, request, attempt]);
  const claimPath = `/companies/${companyId}/reimbursements`;
  // The row can be older than the claim (cancelled meanwhile, paid by someone else, moved off its payment
  // step). The form is shown only where the claim's own page would show it; otherwise this says why.
  const blocked = claim ? quickPayBlockedNote(claim, permissions, userId) : null;
  return (
    <>
    <Modal open title={`บันทึกจ่าย ${request.requestNo ?? ''}`.trim()} size="sm" closeLabel="ปิด" closeOnBackdrop={false} onClose={() => { if (!paymentSaving.current) onClose(); }}>
      {claim ? (
        blocked ? (
          <div className="space-y-3">
            <ErrorBanner message={blocked} />
            <ActionGroup>
              <Link href={`${claimPath}/${request.id}`} className={btnClass}>เปิดหน้าใบเบิก</Link>
            </ActionGroup>
          </div>
        ) : (
        <div className="space-y-3">
          {/* What the claim page shows at its payment step: where to transfer, with show and copy. The dialog is its
              frame here (`plain`): no card inside the dialog, a line between it and the form. */}
          <ClaimPayoutCard companyId={companyId} detail={claim} userId={userId} payoutAccountHref={`${claimPath}/payout-account`} plain payStep />
          <PaymentForm companyId={companyId} request={claim} onCancel={onClose} onDone={onDone} onClaimChanged={() => onDone()}
            onBusyChange={saving => { paymentSaving.current = saving; }}
            onOpenFile={(choice) => void openSlipChoice(claim.id, choice)} />
          {openFileError && <ErrorBanner message={`เปิดไฟล์ไม่สำเร็จ · ${openFileError}`} />}
        </div>
        )
      ) : failed ? (
        <div className="space-y-3">
          <ErrorBanner message={`เปิดใบเบิกไม่สำเร็จ จึงยังบันทึกจ่ายจากหน้านี้ไม่ได้ · ${failed}`} />
          <ActionGroup>
            <button type="button" className={ghostClass} onClick={() => setAttempt((n) => n + 1)}>ลองอีกครั้ง</button>
            <Link href={`${claimPath}/${request.id}?pay=1`} className={btnClass}>เปิดหน้าใบเบิก</Link>
          </ActionGroup>
        </div>
      ) : <LoadingState label="กำลังเปิดใบเบิก..." />}
    </Modal>
    {previewModals}
    </>
  );
}

// ── Policy Settings ───────────────────────────────────────────────────────────
// Exported for the QA spec, which renders the form with a policy already loaded.
export function PolicySettings({ companyId, onPolicy }: {
  companyId: string;
  /** The policy as it was just read, also after a save: the hub names its third tab by it. */
  onPolicy?: (policy: { financeReviewRequired?: boolean }) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<any | null>(null);
  const [approverOptions, setApproverOptions] = useState<ReimbursementApproverRoleOption[]>([]);
  const [approverChanged, setApproverChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [policyChanged, setPolicyChanged] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setPolicyChanged(false);
    try {
      const [policy, options] = await Promise.all([
        getReimbursementPolicy(companyId),
        listReimbursementApproverOptions(companyId),
      ]);
      // A role that no longer exists can be neither ticked nor unticked: drop it, and let the next
      // save store the shorter list.
      const roles = (policy.defaultApproverRoles ?? []).filter((key) => options.some((option) => option.key === key));
      setForm({ ...policy, defaultApproverRoles: roles }); setApproverOptions(options);
      onPolicy?.(policy);
      setApproverChanged(roles.length !== (policy.defaultApproverRoles ?? []).length);
    }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, onPolicy]);
  useEffect(() => { load(); }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await updateReimbursementPolicy(companyId, {
        ...(form.id !== 'default' && { expectedUpdatedAt: form.updatedAt }),
        approvalRequiredFromAmount: form.approvalRequiredFromAmount,
        ...(approverChanged && { defaultApproverRoles: form.defaultApproverRoles }),
        allowSelfApproval: form.allowSelfApproval,
        requireReceipt: form.requireReceipt,
        allowMissingReceiptWithReason: form.allowMissingReceiptWithReason,
        duplicatePolicy: form.duplicatePolicy,
        financeReviewRequired: form.financeReviewRequired,
        slaHours: form.slaHours === '' || form.slaHours == null ? null : Number(form.slaHours),
        status: form.status,
      });
      // Every claim keeps the settings it was sent with: said here, once, and not on each claim page.
      toast.success('บันทึกการตั้งค่าแล้ว ใช้กับใบเบิกที่ส่งหลังจากนี้'); await load();
    } catch (e2) {
      setPolicyChanged((e2 as { code?: unknown })?.code === 'reimbursement_policy_changed'
        || (e2 instanceof Error && e2.message.includes('reimbursement_policy_changed')));
      setError(err(e2));
    } finally { setBusy(false); }
  };

  if (loading) return <LoadingState label="กำลังโหลด..." />;
  // A failed read is not a dead end: the same read can be tried again from here.
  if (!form) return <Notice tone="error" action={<button type="button" className={ghostClass} onClick={() => void load()}>ลองอีกครั้ง</button>}>{error ?? 'โหลดการตั้งค่าไม่สำเร็จ'}</Notice>;

  const roleBasedRoute = ['MANAGER_ROLE', 'OWNER_ROLE', 'CUSTOM_ROLE'].includes(form.approverMode);
  // A legacy person-based route ticks nothing until a role is picked.
  const selectedRoles: string[] = roleBasedRoute || approverChanged ? form.defaultApproverRoles ?? [] : [];
  const selectedOptions = approverOptions.filter((option) => selectedRoles.includes(option.key));
  const roleOptions = approverOptions.filter((option) => option.selectable || selectedRoles.includes(option.key));
  const readyOptions = approverOptions.filter((option) => option.selectable);
  const rolesNotReady = selectedOptions.some((option) => !option.selectable);
  const routeReady = !(roleBasedRoute || approverChanged)
    || (selectedRoles.length > 0 && (form.status !== 'ACTIVE' || !rolesNotReady));
  const roleLabel = selectedOptions.map(approverRoleName).join(' หรือ ');
  const paymentWarning = approverPaymentWarning(
    selectedOptions.map((option) => ({ label: approverRoleName(option), selectable: option.selectable, canRecordPayment: option.canRecordPayment })),
    !!form.financeReviewRequired,
  );
  const ownerRoute = selectedRoles.includes('OWNER');
  const toggleRole = (key: string) => {
    setApproverChanged(true);
    setForm((f: any) => ({
      ...f,
      defaultApproverRoles: selectedRoles.includes(key) ? selectedRoles.filter((role) => role !== key) : [...selectedRoles, key],
    }));
  };

  // Why the save button cannot be pressed, said beside it: the list that causes it is a screen above on a phone.
  const notReadyReason = routeReady ? null
    : selectedRoles.length === 0 ? 'เลือกบทบาทผู้อนุมัติอย่างน้อย 1 บทบาทก่อนบันทึก' : 'เอาบทบาทที่ยังไม่มีคนพร้อมอนุมัติออกก่อนบันทึก';
  // A setting that is on or off is one row: a tick, its name, one line of what it does. Rows are parted by a line; no
  // box inside the card, no icon tile, no sentence under a heading that only says the heading again.
  const set = (patch: Record<string, unknown>) => setForm((f: any) => ({ ...f, ...patch }));
  return (
    <form onSubmit={save} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <div className="space-y-4">
        <MangmeeCard className="p-4 sm:p-5">
          <h2 className={SETTINGS_HEADING_CLASS}>การอนุมัติใบเบิก</h2>
          <div className="mt-1 divide-y divide-gray-100">
            <ChoiceRow type="checkbox" label="เปิดรับใบเบิกใหม่" description="เมื่อปิด ร่างจะส่งไม่ได้ ใบเบิกที่ส่งแล้วทำต่อจนจบ"
              checked={form.status === 'ACTIVE'} onChange={e => set({ status: e.target.checked ? 'ACTIVE' : 'INACTIVE' })} />
            <div className="py-3">
              <label className={SETTINGS_LABEL_CLASS} htmlFor="reimbursement-approval-from">ต้องอนุมัติเมื่อยอดตั้งแต่ (บาท)</label>
              <input id="reimbursement-approval-from" className={cx(inputClass, 'sm:max-w-60')} type="number" min="0" step="0.01" required value={form.approvalRequiredFromAmount} onChange={e => set({ approvalRequiredFromAmount: e.target.value })} />
            </div>
            {/* The row's own padding is on this box: a legend is drawn on its fieldset's top edge, above any padding of the fieldset. */}
            <div className="py-3">
            <fieldset className="min-w-0">
              <legend className={SETTINGS_LABEL_CLASS}>ส่งใบเบิกให้ใครอนุมัติ</legend>
              <p className="text-sm text-gray-500">เลือกได้หลายบทบาท ใช้ผลของคนแรกที่อนุมัติหรือส่งกลับให้แก้</p>
              <div className="mt-1">
                {roleOptions.map((option) => (
                  <ChoiceRow type="checkbox" key={option.key} label={`${approverRoleName(option)}${option.selectable ? '' : ' (ยังไม่พร้อมใช้งาน)'}`}
                    checked={selectedRoles.includes(option.key)} onChange={() => toggleRole(option.key)} />
                ))}
              </div>
              {readyOptions.length === 0 ? (
                <p className="mt-1 text-sm text-error-600">ยังไม่มีบทบาทที่พร้อมอนุมัติ ให้ผู้ดูแลเพิ่มสิทธิ์และพนักงานในหน้าบทบาทและสิทธิ์</p>
              ) : rolesNotReady ? (
                <p className="mt-1 text-sm text-error-600">บางบทบาทที่เลือกยังไม่มีคนพร้อมอนุมัติ เอาออกหรือเลือกบทบาทอื่น</p>
              ) : !roleBasedRoute && !approverChanged ? (
                <p className="mt-1 text-sm text-warning-700">การตั้งค่าเดิมระบุผู้อนุมัติเป็นรายบุคคล หากต้องการเปลี่ยนเส้นทางให้เลือกบทบาทใหม่</p>
              ) : selectedRoles.length === 0 ? (
                <p className="mt-1 text-sm text-gray-500">เลือกอย่างน้อย 1 บทบาท</p>
              ) : null}
              {!ownerRoute && <p className="mt-1 text-sm text-gray-500">ถ้ายังไม่มีคนในบทบาทที่เลือก เจ้าของกิจการเป็นผู้อนุมัติ</p>}
              {paymentWarning && <p role="status" className="mt-1 text-sm text-warning-700" data-testid="reimbursement-approver-payment-warning">{paymentWarning}</p>}
            </fieldset>
            </div>
            <ChoiceRow type="checkbox" label={SELF_APPROVAL_SWITCH_LABEL} description={SELF_APPROVAL_POLICY_NOTE}
              checked={!!form.allowSelfApproval} onChange={e => set({ allowSelfApproval: e.target.checked })} />
          </div>
        </MangmeeCard>

        <MangmeeCard className="p-4 sm:p-5">
          <h2 className={SETTINGS_HEADING_CLASS}>ใบเสร็จ</h2>
          <div className="mt-1 divide-y divide-gray-100">
            <ChoiceRow type="checkbox" label="ต้องมีใบเสร็จ" description="ทุกรายการต้องแนบใบเสร็จก่อนส่งอนุมัติ"
              checked={!!form.requireReceipt} onChange={e => set({ requireReceipt: e.target.checked })} />
            <ChoiceRow type="checkbox" label="ไม่มีใบเสร็จได้ถ้ากรอกเหตุผล" description="ผู้เบิกกรอกเหตุผลแทนใบเสร็จของรายการนั้น"
              checked={!!form.allowMissingReceiptWithReason} onChange={e => set({ allowMissingReceiptWithReason: e.target.checked })} />
            <div className="py-3">
              <label className={SETTINGS_LABEL_CLASS}>ถ้าใบเสร็จอาจซ้ำกับใบอื่น</label>
              <ThemedSelect aria-label="ถ้าใบเสร็จอาจซ้ำกับใบอื่น" className={cx(inputClass, 'sm:max-w-80')} value={form.duplicatePolicy} onChange={e => set({ duplicatePolicy: e.target.value })}>
                <option value="WARN">เตือนอย่างเดียว</option>
                <option value="BLOCK_SUBMIT">ห้ามส่งอนุมัติ</option>
                <option value="BLOCK_PAYMENT">ห้ามจ่ายจนกว่าจะตรวจ</option>
              </ThemedSelect>
            </div>
          </div>
        </MangmeeCard>

        <MangmeeCard className="p-4 sm:p-5">
          <h2 className={SETTINGS_HEADING_CLASS}>การเงินและกำหนดเวลา</h2>
          <div className="mt-1 divide-y divide-gray-100">
            <ChoiceRow type="checkbox" label="ตรวจการเงินก่อนจ่าย" description="เปิดเมื่อมีฝ่ายการเงินแยกจากผู้อนุมัติ ผู้อนุมัติส่งต่อให้การเงินตรวจก่อนจ่าย"
              checked={!!form.financeReviewRequired} onChange={e => set({ financeReviewRequired: e.target.checked })} />
            <div className="py-3">
              <label className={SETTINGS_LABEL_CLASS} htmlFor="reimbursement-deadline-hours">{`${DEADLINE_LABEL} (ชั่วโมง)`}</label>
              <input id="reimbursement-deadline-hours" className={cx(inputClass, 'sm:max-w-60')} type="number" min="0" max="8760" step="1" value={form.slaHours ?? ''} onChange={e => set({ slaHours: e.target.value })} />
              <p className="mt-1 text-sm text-gray-500">เว้นว่างไว้ถ้าไม่กำหนด</p>
            </div>
          </div>
        </MangmeeCard>
      </div>

      {/* What the settings above add up to (the path a claim takes), then the one button. Beside the form on a wide
          screen and in view while it scrolls; after the last field on a phone. It replaced a list that repeated the form. */}
      <MangmeeCard className="space-y-3 p-4 sm:p-5 lg:sticky lg:top-4">
        <h2 className={SETTINGS_HEADING_CLASS}>ใบเบิกจะเดินตามนี้</h2>
        <dl className="space-y-2 text-sm" data-testid="reimbursement-route-preview">
          {policyDecisionPreview({
            approvalRequiredFromAmount: form.approvalRequiredFromAmount,
            approverLabel: roleLabel,
            ownerRoute,
            financeReviewRequired: !!form.financeReviewRequired,
          }).map(line => (
            <div key={line.title}><dt className="font-semibold text-gray-900">{line.title}</dt><dd className="text-gray-600">{line.path}</dd></div>
          ))}
        </dl>
        {error && <ErrorBanner message={error} />}
        {notReadyReason && <p className="text-sm text-gray-500">{notReadyReason}</p>}
        <ActionGroup>
          {policyChanged && <button type="button" className={ghostClass} onClick={() => void load()}>โหลดค่าล่าสุด</button>}
          <button type="submit" className={btnClass} disabled={busy || !routeReady} aria-busy={Boolean(busy)}>บันทึกการตั้งค่า</button>
        </ActionGroup>
      </MangmeeCard>
    </form>
  );
}
