'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ThemedSelect } from '@/common/components/field/ThemedSelect';
import { MangmeeBadge, MangmeeCard, MangmeePage, cx } from '@/common/components/mangmee';
import { Modal } from '@/common/components/modal';
import { EmptyState } from '@/common/components/state/EmptyState';
import { LoadingState } from '@/common/components/state/LoadingState';
import {
  loadHubPage, submitReimbursement, getReimbursement, getReimbursementFinanceStep,
  listApprovalQueue, approveReimbursement, rejectReimbursement,
  listFinanceQueue, financeReviewReimbursement,
  getReimbursementPolicy, listReimbursementApproverOptions, updateReimbursementPolicy,
} from './reimbursements.api';
import {
  FINANCE_REVIEW_LABELS, POLICY_TAB_LABEL, REIMBURSEMENT_CREATE_UNAVAILABLE, SELF_APPROVAL_SWITCH_LABEL, SELF_APPROVAL_POLICY_NOTE,
  claimDeskText, claimStatusBadge, currentDeskText, reimbursementOwnActions, reimbursementSubmitReadiness,
} from './reimbursements.model';
import {
  dateShort, ICON, KPI, StatCard, ErrorBanner,
  inputClass, btnClass, ghostClass, dangerClass, successBtn, successBtnStyle,
} from '../expenses/ExpensesUi';
import {
  summariseQueue, matchesSearch, pageBounds,
  formatMoney, parseHubTab, visibleHubTabs, withAssignedApprovalTab, reimbursementListScope, errorText, isStaleApprovalError, diffApprovalFields,
  policyDecisionPreview, approverNotReadyHelp, approvalComparable, categoryText, type HubTab,
  type HubFilter, approverPaymentWarning,
  NO_HUB_LIST, QUEUE_PAGE_SIZE, HUB_SEARCH_DELAY_MS, hubCardFilter, hubList, hubListKey, hubListStatusText, hubNextPage, withHubFailure, withHubPage, withHubRetry, type HubList,
  queueRowOffersFinanceReview, queueRowOffersPayment, quickPayBlockedNote, quickPayTarget,
  approvalRowOffers, financeQueueWords, rowHasFinanceReview, rowMayBeDuplicate,
} from './reimbursements.logic';
import {
  PaymentBadge, PaymentForm, RejectDialog, StaleApprovalDialog, StatusBadge, financeActionLabel, useClaimDocumentPreview,
} from './ReimbursementDetailSections';
import { claimNeedsPayoutAttestation, draftRowSubmitsFromItsPage, draftRowSubmitLabel } from './reimbursement-payout.logic';
import { ClaimPayoutCard } from './ReimbursementPayout';
import { roleDisplayName } from '../employee-access/role-picker.logic';
import { reimbursementDuplicateBlockNotice, type ReimbursementApproverRoleOption } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';

/** Every banner in this feature goes through here, so API error codes never reach the user raw. */
function err(e: unknown) { return errorText(e); }

// The third tab has no fixed name: it is the finance queue or the pay queue by the company's policy (`financeQueueWords`).
type NamedHubTab = Exclude<HubTab, 'finance'>;
const HUB_TAB_LABELS: Record<NamedHubTab, string> = {
  mine: 'รายการที่เกี่ยวข้อง', approvals: 'คิวอนุมัติ', policy: POLICY_TAB_LABEL,
};
const HUB_TAB_DESCRIPTIONS: Record<NamedHubTab, string> = {
  mine: 'ติดตามคำขอของคุณและเอกสารที่คุณเป็นผู้อนุมัติ ผู้ตรวจ ผู้จ่าย หรือผู้ลงนาม',
  approvals: 'ตรวจคำขอที่รอคุณอนุมัติ ดูรายการและใบเสร็จก่อนตัดสินใจ',
  policy: 'ตั้งเกณฑ์การอนุมัติ ใบเสร็จ และกำหนดเวลาของการเบิกจ่ายทั้งบริษัท',
};
/** A claim that has waited longer than the company's deadline, in the words of the notice the server sends for it. */
const OVERDUE_LABEL = 'เกินกำหนด';
/** The mark of a claim that may repeat another one, on a row of either queue. */
const MAY_BE_DUPLICATE_LABEL = 'อาจซ้ำ';
/** The deadline itself: how long a claim may wait for its approval, and then for its payment. */
const DEADLINE_LABEL = 'กำหนดเวลาอนุมัติและจ่าย';
const approverRoleName = (option?: Pick<ReimbursementApproverRoleOption, 'key' | 'name'>) =>
  option ? roleDisplayName({ ...option, isSystem: false }) : '';
const shortDate = (iso?: string) => dateShort(iso);
/*
 * A queue is a table where the card that holds it is wide enough for the table, and cards below that: the fix of
 * the claim lines (2026-10-01), by the card's own width. The side menu takes its share of the screen, so a 1280 px
 * screen leaves a 901 px card, where a table forced to 980 px scrolled sideways and hid its action column.
 * Each list names the width its table reads at (`@[…rem]:`), measured with nothing but free text wrapping.
 */
/** A queue's table: only a cell of free text wraps, so a number, an amount or a badge is never broken over lines. */
const QUEUE_TABLE_CLASS = 'mangmee-table [&_td]:whitespace-nowrap [&_th]:whitespace-nowrap';
/** A cell of free text (a name, a reason, a category): it wraps, inside a word if it must, and keeps room to be read. */
const FREE_TEXT_CELL = '!whitespace-normal [overflow-wrap:anywhere]';
/**
 * A queue's cards: one column on a phone, two once the card that holds them is as wide as two phones. The one column is
 * named (`grid-cols-1`), so it is as wide as the list and no wider: an unnamed column takes the width of its longest
 * line that does not wrap (a long reason, a desk of several names), and every card then runs past the screen's edge.
 */
const QUEUE_CARDS_CLASS = 'mt-3 grid grid-cols-1 gap-3 @[44rem]:grid-cols-2';
/** A claim never said whose desk it sits on. Terminal claims have none, and render nothing. */
function CurrentDeskLine({ row }: { row: { currentDesk?: { kind?: string; names?: string[] } } }) {
  const desk = claimDeskText(row);
  return desk ? <div className="mt-1 truncate text-xs text-gray-500" data-testid="reimbursement-current-desk">อยู่ที่ {desk}</div> : null;
}

function TablePager({ from, to, total, page, totalPages, onPage }: {
  from: number;
  to: number;
  total: number;
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-4 text-sm text-gray-500">
      <div className="tabular-nums">แสดง {from}-{to} จาก {total} รายการ</div>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" className={cx(ghostClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')}
            disabled={page <= 1} onClick={() => onPage(page - 1)}>ก่อนหน้า</button>
          <span className="tabular-nums rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700">{page} / {totalPages}</span>
          <button type="button" className={cx(ghostClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')}
            disabled={page >= totalPages} onClick={() => onPage(page + 1)}>ถัดไป</button>
        </div>
      )}
    </div>
  );
}

export function ReimbursementsHubPage({ companyId, userId, permissions, roles }: {
  companyId: string;
  userId: string;
  permissions: readonly string[];
  roles: readonly string[];
}) {
  const toast = useToast();
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
  // Rows (and the row-level "ยกเลิก" button) open the claim's journey page — the detail drawer
  // was retired in Phase 6, so every claim view and action lives on that page now.
  const openJourney = useCallback((id: string) => router.push(`/companies/${companyId}/reimbursements/${id}`), [companyId, router]);
  // "บันทึกจ่าย" stays a quick action right on the finance row; it never needed the drawer.
  const [payFor, setPayFor] = useState<any | null>(null);
  // On a phone the payment form is never a dialog (spec §12.2, §21): the same press opens the claim's
  // own page with the form already open in its payment step card. Which it is comes from the layout
  // the press was made in (the queue's cards or its table), so the dialog never opens over the
  // layout this page shows a phone.
  const recordPayment = useCallback((row: any, layout: 'cards' | 'table') => {
    const target = quickPayTarget(layout, companyId, row.id);
    if (target.kind === 'page') router.push(target.href);
    else setPayFor(row);
  }, [companyId, router]);
  const [refreshKey, setRefreshKey] = useState(0);

  // A finance desk exists only where the company turned the finance-review step on, so the tab that holds the claims
  // waiting for payment is named by the company's own policy. A session that may read the policy reads it there (the
  // policy endpoint asks for a policy right). One that may not, an accountant say, is told that one fact by the claims
  // list answer, which carries it for whoever may list claims: such a session read "คิวการเงิน" in a shop with no finance step.
  const hasThirdTab = permissionTabs.includes('finance');
  const canReadPolicy = permissions.includes('reimbursement.policy.read') || permissions.includes('reimbursement.policy.manage');
  const listScope = reimbursementListScope(permissions);
  const [policyRead, setPolicyRead] = useState<{ companyId: string | null; financeStep: boolean }>({ companyId: null, financeStep: true });
  const notePolicy = useCallback((policy: { financeReviewRequired?: boolean }) => {
    setPolicyRead({ companyId, financeStep: policy.financeReviewRequired === true });
  }, [companyId]);
  useEffect(() => {
    if (!hasThirdTab) return;
    let current = true;
    void (canReadPolicy ? getReimbursementPolicy(companyId) : getReimbursementFinanceStep(companyId, listScope))
      .then((policy) => { if (current) notePolicy(policy); })
      // Not told (the read failed, or the session may list no claims): the finance wording, for the right it holds.
      .catch(() => { if (current) notePolicy({ financeReviewRequired: true }); });
    return () => { current = false; };
  }, [companyId, hasThirdTab, canReadPolicy, listScope, notePolicy]);
  // Undefined: not told yet, and the tab is not named before it is known.
  const financeStep = !hasThirdTab ? true : policyRead.companyId === companyId ? policyRead.financeStep : undefined;
  const financeWords = financeStep === undefined ? undefined : financeQueueWords(financeStep);
  const tabLabel = (t: HubTab) => (t === 'finance' ? financeWords?.tab : HUB_TAB_LABELS[t]);

  // Roles can change after submission. Permission-based navigation alone would strand the exact
  // assignee, so ask the server whether this session still owns a frozen task. The queue endpoint
  // returns only exact assignments. Once found, keep the tab for this page session so completing
  // the last task does not make the success state disappear underneath the user.
  useEffect(() => {
    if (hasApprovalPermission) return;
    let current = true;
    void listApprovalQueue(companyId)
      .then((rows) => { if (current && rows.length > 0) setAssignedApprovalCompanyId(companyId); })
      .catch(() => { /* The normal no-access state remains; do not surface a background probe. */ })
      .finally(() => { if (current) setProbedApprovalCompanyId(companyId); });
    return () => { current = false; };
  }, [companyId, hasApprovalPermission]);

  useEffect(() => {
    setTab(parseHubTab(requestedTab, tabs));
  }, [companyId, requestedTab, tabs]);

  if (!assignmentProbeDone && tabs.length === 0) {
    return <LoadingState label="กำลังตรวจสอบงานอนุมัติของคุณ..." />;
  }

  if (tabs.length === 0) {
    return (
      <MangmeePage eyebrow="การเบิกจ่าย" title="การเบิกจ่ายและอนุมัติ" description="จัดการคำขอเบิกค่าใช้จ่ายและการอนุมัติ">
        <MangmeeCard className="p-6">
          <EmptyState title="ไม่มีสิทธิ์เข้าถึง" description="บัญชีนี้ยังไม่มีสิทธิ์ใช้งานหน้าการเบิกจ่าย" />
        </MangmeeCard>
      </MangmeePage>
    );
  }

  const queueProps = { companyId, refreshKey, onOpenDetail: openJourney, permissions };
  return (
    <MangmeePage
      eyebrow="การเบิกจ่าย"
      title="การเบิกจ่ายและอนุมัติ"
      description={tab === 'finance' ? financeWords?.description : HUB_TAB_DESCRIPTIONS[tab]}
      // Beside the page actions on every tab: whoever can file a claim sets where it is paid back.
      meta={permissions.includes('reimbursement.create') ? (
        <Link href={`/companies/${companyId}/reimbursements/payout-account`} className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')}>บัญชีรับเงินคืนของฉัน</Link>
      ) : undefined}
      actions={permissions.includes('reimbursement.create') && tab === 'mine' ? (
        <Link href={`/companies/${companyId}/reimbursements/new`} className={cx(btnClass, 'min-h-11 w-full sm:w-auto')}>+ สร้างคำขอเบิก</Link>
      ) : undefined}
    >
      <nav aria-label="งานเบิกจ่าย" className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200">
        <div className="flex max-w-full gap-1 overflow-x-auto">
          {tabs.filter(t => t !== 'policy' && tabLabel(t)).map(t => (
            <button type="button" key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
              className={cx('min-h-12 shrink-0 border-b-2 px-4 py-3 text-base font-semibold', tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-brand-700')}>
              {tabLabel(t)}
            </button>
          ))}
        </div>
        {tabs.includes('policy') && <button type="button" onClick={() => setTab('policy')} aria-pressed={tab === 'policy'} className={cx('min-h-11 rounded-lg px-3 py-2 text-sm font-semibold', tab === 'policy' ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100')}>{HUB_TAB_LABELS.policy}</button>}
      </nav>
      {!permissions.includes('reimbursement.create') && <div role="status" className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">{REIMBURSEMENT_CREATE_UNAVAILABLE}</div>}
      {tab === 'mine' && <MyRequests
        {...queueProps}
        userId={userId}
        canCreate={permissions.includes('reimbursement.create')}
      />}
      {tab === 'approvals' && <ApprovalQueue {...queueProps} />}
      {tab === 'finance' && <FinanceQueue {...queueProps} financeStep={financeStep} onRecordPayment={recordPayment} />}
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

type QueueProps = { companyId: string; refreshKey: number; onOpenDetail: (id: string) => void; permissions: readonly string[] };

// ── My Requests ───────────────────────────────────────────────────────────────
function MyRequests({ companyId, refreshKey, onOpenDetail, userId, permissions, canCreate }: QueueProps & {
  userId: string;
  permissions: readonly string[];
  canCreate: boolean;
}) {
  const toast = useToast();
  // One list is held, a page at a time. Which list it is (company, scope, filter, reload) is part of what is
  // held, so rows that were loaded for another one are never shown, and an answer that arrives late is dropped.
  const [held, setHeld] = useState<HubList>(NO_HUB_LIST);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<HubFilter>('all');
  const [query, setQuery] = useState('');
  // The search the API is asked for: what was typed, once the typing has paused. Before, the search ran in the
  // browser over rows it first had to load, every page of the filter (30 calls for 3,000 claims).
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), HUB_SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const [page, setPage] = useState(1);

  const scope = reimbursementListScope(permissions);
  // The search goes last: it is the one part a person types, and nothing follows it that it could be mistaken for.
  const listKey = hubListKey(companyId, scope, statusFilter, refreshKey, reload, search);
  const list = hubList(held, listKey);
  const searching = search !== '';
  // Lazy: the first page of the filter and the search, then more only when the table page shown reaches past what is held.
  const nextPage = hubNextPage(list, page * QUEUE_PAGE_SIZE);
  useEffect(() => {
    if (nextPage === null) return;
    // The cleanup lets go of the request: another filter or search, a reload, another company or an unmount leaves its answer unused.
    return loadHubPage(companyId, { scope, filter: statusFilter, search, page: nextPage }, {
      onPage: (result) => setHeld((current) => withHubPage(current, listKey, result)),
      onError: (e) => setHeld((current) => withHubFailure(current, listKey, err(e))),
    });
  }, [companyId, scope, statusFilter, search, listKey, nextPage]);
  const loading = nextPage !== null;
  // The cards and chips are the server's counts, so they hold whatever part of the list is loaded: of the whole scope,
  // or with a search of what the search found. Either way the number on a card is the rows its filter shows.
  const summary = list.summary;
  const rows = list.rows;

  // Only the row "ส่งอนุมัติ" uses this; a refusal for want of an approver says who can fix it.
  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setBusy(id); setError(null);
    try { await fn(); setReload(n => n + 1); if (successMessage) toast.success(successMessage); } catch (e) { setError(approverNotReadyHelp(e, permissions)?.text ?? err(e)); } finally { setBusy(null); }
  };
  // A draft paid into an account (the requester's default, or one typed into the claim) is sent from
  // its own page: a row shows no account, and nobody sends a claim to an account they were not shown.
  const submitRow = (r: any) => (draftRowSubmitsFromItsPage(r)
    ? onOpenDetail(r.id)
    : void action(r.id, () => submitReimbursement(companyId, r.id), 'ส่งขออนุมัติเรียบร้อยแล้ว'));

  // The server's total stands for the rows not loaded yet. A list that is complete counts the rows it holds.
  const shownTotal = list.nextPage === null ? rows.length : list.total;
  const bounds = useMemo(() => pageBounds(shownTotal, page), [shownTotal, page]);
  const pagedData = useMemo(() => rows.slice(bounds.start, bounds.end), [rows, bounds]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);
  const statusChips: Array<{ key: HubFilter; label: string }> = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'draft', label: 'ร่าง' },
    { key: 'review', label: 'รออนุมัติ/ตรวจสอบ' },
    { key: 'payment', label: 'รอจ่าย' },
    { key: 'paid', label: 'จ่ายแล้ว' },
    { key: 'closed', label: 'ปฏิเสธ/ยกเลิก' },
  ];
  // Each card is the same filter as its chip; tapping the open one goes back to ทั้งหมด.
  const statusCards = summary ? [
    { key: 'draft', icon: ICON.edit, label: 'ร่างรอส่ง', value: summary.counts.draft, tone: KPI.amber },
    { key: 'review', icon: ICON.clock, label: 'รออนุมัติ/ตรวจสอบ', value: summary.counts.review, tone: KPI.purple },
    { key: 'payment', icon: ICON.wallet, label: 'รอจ่ายเงินคืน', value: summary.counts.payment, tone: KPI.sky },
    { key: 'all', icon: ICON.doc, label: 'ยอดรวมที่ขอเบิก', value: formatMoney(summary.totalAmount, 'THB'), tone: KPI.brand },
  ] as const : [];

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {list.failed !== undefined && (
        // A page that did not arrive is said as such, with a way to ask again: never as "ยังไม่มีคำขอเบิก".
        <div className="space-y-2" data-testid="reimbursements-mine-load-failed">
          <ErrorBanner message={rows.length > 0
            ? `โหลดรายการได้ไม่ครบ รายการด้านล่างยังไม่ใช่ทั้งหมด · ${list.failed}`
            : `โหลดรายการไม่สำเร็จ · ${list.failed}`} />
          <button type="button" className={cx(ghostClass, 'min-h-11 w-full sm:w-auto')} onClick={() => setHeld(withHubRetry)}>ลองอีกครั้ง</button>
        </div>
      )}
      {!summary ? loading && <LoadingState label="กำลังโหลด..." /> : (
        <>
          {summary.blockedDraftCount > 0 && (
            <ErrorBanner message={`มีคำขอร่าง ${summary.blockedDraftCount} รายการที่ยังส่งไม่ได้ตามนโยบายใบเสร็จ กรุณาเปิดรายละเอียดเพื่อแนบใบเสร็จหรือแก้ไขคำขอ`} />
          )}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="reimbursements-mine-summary">
            {statusCards.map(card => (
              <button key={card.key} type="button" aria-pressed={statusFilter === card.key}
                onClick={() => setStatusFilter(hubCardFilter(statusFilter, card.key))}
                className={cx('h-full w-full min-w-0 rounded-2xl text-left', card.key !== 'all' && statusFilter === card.key && 'ring-2 ring-brand-500 ring-offset-2')}>
                <StatCard icon={card.icon} label={card.label} value={card.value} {...card.tone} />
              </button>
            ))}
          </div>
          <MangmeeCard className="p-4">
            {/* Three rows of two on a phone, two rows of three from sm. A label too long for a 390 px chip wraps
                at its slash, never inside a Thai word (measured: "รออนุมัติ/ตรวจสอบ" needs 143 px of the 132 there). */}
            <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3" data-testid="reimbursements-mine-filters">
              {statusChips.map(chip => (
                <button key={chip.key} type="button" aria-pressed={statusFilter === chip.key} onClick={() => setStatusFilter(chip.key)}
                  className={cx('inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-center text-sm font-semibold transition sm:min-h-0',
                    statusFilter === chip.key ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-gray-200 bg-white text-gray-600 hover:border-brand-200')}>
                  <span className="min-w-0">{chip.label.split('/').map((part, index, parts) => (
                    <span key={part} className="whitespace-nowrap">{part}{index < parts.length - 1 && '/'}</span>
                  ))}</span>
                  <span className={cx('tabular-nums inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-extrabold', statusFilter === chip.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500')}>{summary.counts[chip.key]}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500 tabular-nums" role="status">
                {loading ? 'กำลังโหลดรายการ...' : hubListStatusText(shownTotal, summary.counts.all, statusFilter, searching)}
              </div>
              <div className="relative w-full sm:max-w-96">
                {/* Short enough to read whole on a 390 px phone (254 px of the 266 the field leaves at its 16 px font). */}
                <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                  placeholder="ค้นหาเลขที่ ผู้เบิก เหตุผล หมวด ยอดเงิน"
                  value={query} onChange={e => setQuery(e.target.value)} />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
                  {ICON.search}
                </span>
              </div>
            </div>
            {pagedData.length === 0 ? (
              // Nothing to show yet is not "no claims": a page still on its way, or one that failed, says so itself.
              loading ? <LoadingState label="กำลังโหลด..." /> : list.failed === undefined && (
                <div className="mt-3">
                  {/* With a search the counts are of what it found: none found is not a shop with no claims. */}
                  <EmptyState
                    title={summary.counts.all === 0 && !searching ? 'ยังไม่มีคำขอเบิก' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                    description={summary.counts.all === 0 && !searching
                      ? canCreate ? 'กด "สร้างคำขอเบิก" เพื่อเริ่มคำขอแรกของคุณ' : REIMBURSEMENT_CREATE_UNAVAILABLE
                      : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                  />
                </div>
              )
            ) : (
            <div className="[container-type:inline-size]">
            <div className="hidden @[80rem]:block" data-testid="reimbursements-mine-table">
            <div className="mt-3 overflow-x-auto">
                <table className={QUEUE_TABLE_CLASS}>
                  <thead>
                    <tr><th className="!text-center">เลขที่</th><th className="!text-center">ผู้เบิก</th><th className="!text-center">เหตุผล</th><th className="!text-center">หมวด</th><th className="!text-center">จำนวนรายการ</th><th className="!text-center">จำนวน</th><th className="!text-center">สถานะ</th><th className="!text-center">การจ่าย</th><th className="!text-center">การกระทำ</th></tr>
                  </thead>
                  <tbody>
                    {pagedData.map((r: any) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                        <td className="font-mono text-xs">{r.requestNo ?? '—'}</td>
                        <td className={cx(FREE_TEXT_CELL, 'min-w-24')}>{r.requesterDisplayNameSnapshot ?? '—'}</td>
                        <td className={cx(FREE_TEXT_CELL, 'min-w-40')}>{r.reason}</td>
                        <td className={cx(FREE_TEXT_CELL, 'min-w-20 text-gray-500')}>{categoryText(r.categoryLabelSnapshot)}</td>
                        <td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>
                        <td className="text-right tabular-nums">{formatMoney(r.amount, r.currency)}</td>
                        <td><StatusBadge claim={r} /></td>
                        <td><PaymentBadge status={r.paymentStatus} /></td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button type="button" aria-label="ดูรายละเอียด" title="ดูรายละเอียด"
                              className={cx(ghostClass, '!min-h-9 !w-9 !px-0 !py-0')}
                              onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }}>
                              <span className="[&>svg]:h-4 [&>svg]:w-4">{ICON.eye}</span>
                            </button>
                            {reimbursementOwnActions(r, userId, permissions).canSubmit && <button
                              className={cx(btnClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')}
                              title={reimbursementSubmitReadiness(r).message}
                              onClick={e => { e.stopPropagation(); submitRow(r); }}
                              disabled={busy === r.id || reimbursementSubmitReadiness(r).blocked} aria-busy={Boolean(busy === r.id)}
                            >{draftRowSubmitLabel(r)}</button>}
                            {/* Cancelling now opens the journey page (Phase 6): its own "ยกเลิกคำขอ" action carries the confirm dialog. */}
                            {reimbursementOwnActions(r, userId, permissions).canCancel && <button className={cx(ghostClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)}>ยกเลิก</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            </div>
            </div>
            <div className={cx(QUEUE_CARDS_CLASS, '@[80rem]:hidden')} data-testid="reimbursements-mine-card-list">
              {pagedData.map((r: any) => (
                <MangmeeCard key={r.id} className="relative p-4">
                  <Link
                    href={`/companies/${companyId}/reimbursements/${r.id}`}
                    aria-label={`ดูรายละเอียด ${r.requestNo ?? '—'}`}
                    className="absolute inset-0 z-10 rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand-500"
                    data-testid="reimbursements-mine-card"
                  />
                  <div className="pointer-events-none relative z-20">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="max-w-[45%] truncate font-mono text-xs text-gray-600">{r.requestNo ?? '—'}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{r.reason}</span>
                    </div>
                    <div className="mt-1 truncate text-xs text-gray-500">ผู้เบิก: {r.requesterDisplayNameSnapshot ?? '—'}</div>
                    <CurrentDeskLine row={r} />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <StatusBadge claim={r} />
                      <span className="shrink-0 text-xs text-gray-500">{shortDate(r.incurredDate)}</span>
                    </div>
                    <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{formatMoney(r.amount, r.currency)}</div>
                  </div>
                  {(reimbursementOwnActions(r, userId, permissions).canSubmit || reimbursementOwnActions(r, userId, permissions).canCancel) && (
                    <div className="relative z-20 mt-4 space-y-2 border-t border-gray-100 pt-3">
                      {reimbursementOwnActions(r, userId, permissions).canSubmit && <button
                        className={cx(btnClass, 'min-h-11 w-full')}
                        title={reimbursementSubmitReadiness(r).message}
                        onClick={() => submitRow(r)}
                        disabled={busy === r.id || reimbursementSubmitReadiness(r).blocked} aria-busy={Boolean(busy === r.id)}
                      >{draftRowSubmitLabel(r)}</button>}
                      {reimbursementOwnActions(r, userId, permissions).canCancel && <button className={cx(ghostClass, 'min-h-11 w-full')} onClick={() => onOpenDetail(r.id)} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)}>ยกเลิก</button>}
                    </div>
                  )}
                </MangmeeCard>
              ))}
            </div>
            </div>
            )}
            <TablePager from={bounds.from} to={bounds.to} total={shownTotal}
              page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
          </MangmeeCard>
        </>
      )}
    </div>
  );
}

// ── Approval Queue ────────────────────────────────────────────────────────────
function ApprovalQueue({ companyId, refreshKey, onOpenDetail, permissions }: QueueProps) {
  const toast = useToast();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [rejectFor, setRejectFor] = useState<any | null>(null);
  const [staleReview, setStaleReview] = useState<{ row: any; detail: any } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await listApprovalQueue(companyId)); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
  useEffect(() => { load(); }, [load, refreshKey]);

  /**
   * A refused approval or rejection usually means the claim moved on while this queue was open: cancelled, decided by
   * someone else, sent back. Reload either way, then restore the message `load` cleared, so the approver reads what
   * was refused above a queue that shows the claims as they are now.
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
  const approveRow = async (r: any) => {
    // A claim paid by transfer is approved on its own page, where the approver sees and attests the account. So is
    // the new account of a correction round: a row shows nothing of what changed, so it never approves one in place.
    if (approvalRowOffers(r).onClaimPage) { onOpenDetail(r.id); return; }
    setBusy(r.id); setError(null);
    try {
      await approveReimbursement(companyId, r.id, undefined, r.approvalSnapshotHash);
      await load();
      toast.success('อนุมัติคำขอเรียบร้อยแล้ว');
    } catch (e) {
      if (isStaleApprovalError(e)) {
        try {
          setStaleReview({ row: r, detail: await getReimbursement(companyId, r.id) });
        } catch (e2) { setError(err(e2)); }
      } else {
        const failure = err(e);
        await load();
        setError(failure);
      }
    } finally { setBusy(null); }
  };
  const summary = useMemo(() => summariseQueue(data), [data]);
  const filteredData = useMemo(() => data.filter(r => matchesSearch([
    r.requestNo,
    r.requesterDisplayNameSnapshot,
    r.reason,
    r.lineCount ?? 1,
    r.amount,
    r.currency,
    r.ageHours,
    r.slaRisk ? OVERDUE_LABEL : '',
    rowMayBeDuplicate(r) ? MAY_BE_DUPLICATE_LABEL : '',
    currentDeskText(r.currentDesk),
  ], query)), [data, query]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query]);

  return (
    <div className="space-y-4">
      {/* The queue's own answer to a refused approval (the call raises no toast): brought into view, since the row that was
          pressed may be far below it on a phone. Not while the dialog of an edited claim is open: that dialog shows it. */}
      {error && <ErrorBanner message={error} focus={!staleReview} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard icon={ICON.clock} label="รอคุณอนุมัติ" value={summary.count} {...KPI.amber} />
            <StatCard icon={ICON.wallet} label="ยอดรวมที่รออนุมัติ" value={formatMoney(summary.totalAmount, 'THB')} {...KPI.purple} />
            <StatCard icon={ICON.alert} label={OVERDUE_LABEL} value={summary.flagged} danger={summary.flagged > 0} {...KPI.danger} />
          </div>
          <MangmeeCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500 tabular-nums">
                {query.trim() ? `พบ ${filteredData.length} จาก ${data.length} รายการ` : `ทั้งหมด ${data.length} รายการ`}
              </div>
              <div className="relative w-full sm:max-w-96">
                <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                  placeholder="ค้นหาเลขที่ ผู้เบิก เหตุผล ยอดเงิน"
                  value={query} onChange={e => setQuery(e.target.value)} />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
                  {ICON.search}
                </span>
              </div>
            </div>
            {filteredData.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title={data.length === 0 ? 'ไม่มีรายการรออนุมัติ' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                  description={data.length === 0 ? 'คำขอที่รอคุณอนุมัติจะแสดงที่นี่' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                />
              </div>
            ) : (
            <div className="[container-type:inline-size]">
            <div className="hidden @[70rem]:block" data-testid="reimbursements-approvals-table">
            <div className="mt-3 overflow-x-auto">
                <table className={QUEUE_TABLE_CLASS}>
                  <thead>
                    <tr><th className="!text-center">เลขที่</th><th className="!text-center">ผู้เบิก</th><th className="!text-center">เหตุผล</th><th className="!text-center">จำนวนรายการ</th><th className="!text-center">จำนวน</th><th className="!text-center">อายุ</th><th className="!text-center">การกระทำ</th></tr>
                  </thead>
                  <tbody>
                    {pagedData.map((r: any) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                        <td className="font-mono text-xs">{r.requestNo ?? '—'}</td>
                        <td className={cx(FREE_TEXT_CELL, 'min-w-24')}>{r.requesterDisplayNameSnapshot}</td>
                        <td className={cx(FREE_TEXT_CELL, 'min-w-40')}>{r.reason}</td>
                        <td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>
                        <td className="text-right tabular-nums">{formatMoney(r.amount, r.currency)}</td>
                        <td className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className="tabular-nums">{r.ageHours} ชม.</span>
                            {r.slaRisk && <MangmeeBadge tone="danger">{OVERDUE_LABEL}</MangmeeBadge>}
                            {/* Said here, before the approver decides: the claim page said it only after the row was opened. */}
                            {rowMayBeDuplicate(r) && <MangmeeBadge tone="amber">{MAY_BE_DUPLICATE_LABEL}</MangmeeBadge>}
                            {/* The table has no status column: a row of a correction round says what it waits for here. */}
                            {r.payoutCorrectionPhase && <StatusBadge claim={r} />}
                          </div>
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            {/* Approvers should read the line breakdown before deciding. */}
                            <button type="button" aria-label="ดูรายละเอียด" title="ดูรายละเอียด"
                              className={cx(ghostClass, '!min-h-9 !w-9 !px-0 !py-0')}
                              onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }}>
                              <span className="[&>svg]:h-4 [&>svg]:w-4">{ICON.eye}</span>
                            </button>
                            {/* The server says what this viewer may do with the row, as on the claim page: never guessed from a role or a tab. */}
                            {approvalRowOffers(r).approveLabel && <button className={cx(successBtn, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} style={successBtnStyle} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)} onClick={e => { e.stopPropagation(); approveRow(r); }}>{approvalRowOffers(r).approveLabel}</button>}
                            {approvalRowOffers(r).reject && <button className={cx(dangerClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} disabled={busy === r.id} onClick={e => { e.stopPropagation(); setRejectFor(r); }}>ปฏิเสธ</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            </div>
            </div>
            <div className={cx(QUEUE_CARDS_CLASS, '@[70rem]:hidden')} data-testid="reimbursements-approvals-card-list">
              {pagedData.map((r: any) => (
                <MangmeeCard key={r.id} className="p-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="max-w-[45%] truncate font-mono text-xs text-gray-600">{r.requestNo ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{r.requesterDisplayNameSnapshot}</span>
                  </div>
                  {/* The table's reason column: the card is what a laptop with the side menu open shows too. */}
                  <div className="mt-1 line-clamp-2 text-sm text-gray-700 [overflow-wrap:anywhere]">{r.reason}</div>
                  <CurrentDeskLine row={r} />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge claim={r} />
                      {r.slaRisk && <MangmeeBadge tone="danger">{OVERDUE_LABEL}</MangmeeBadge>}
                      {rowMayBeDuplicate(r) && <MangmeeBadge tone="amber">{MAY_BE_DUPLICATE_LABEL}</MangmeeBadge>}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">{r.ageHours} ชม.</span>
                  </div>
                  <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{formatMoney(r.amount, r.currency)}</div>
                  <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                    <Link href={`/companies/${companyId}/reimbursements/${r.id}`} className={cx(ghostClass, 'min-h-11 w-full')} data-testid="reimbursements-approvals-card">ดูรายละเอียด</Link>
                    {approvalRowOffers(r).approveLabel && <button className={cx(successBtn, 'min-h-11 w-full')} style={successBtnStyle} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)} onClick={() => approveRow(r)}>{approvalRowOffers(r).approveLabel}</button>}
                    {approvalRowOffers(r).reject && <button className={cx(dangerClass, 'min-h-11 w-full')} disabled={busy === r.id} onClick={() => setRejectFor(r)}>ปฏิเสธ</button>}
                  </div>
                </MangmeeCard>
              ))}
            </div>
            </div>
            )}
            <TablePager from={bounds.from} to={bounds.to} total={filteredData.length}
              page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
          </MangmeeCard>
        </>
      )}
      {rejectFor && <RejectDialog
        requestNo={rejectFor.requestNo}
        busy={busy === rejectFor.id}
        onClose={() => setRejectFor(null)}
        onConfirm={async reason => {
          await action(rejectFor.id, () => rejectReimbursement(companyId, rejectFor.id, reason), 'ปฏิเสธคำขอเรียบร้อยแล้ว');
          setRejectFor(null);
        }}
      />}
      {staleReview && <StaleApprovalDialog
        requestNo={staleReview.detail.requestNo ?? staleReview.row.requestNo}
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
            toast.success('อนุมัติคำขอเรียบร้อยแล้ว');
          } catch (e) { setError(err(e)); }
          finally { setBusy(null); }
        }}
      />}
    </div>
  );
}

// ── Finance Queue ─────────────────────────────────────────────────────────────
function FinanceQueue({ companyId, refreshKey, onOpenDetail, permissions, onRecordPayment, financeStep }: QueueProps & {
  /** `layout`: where the press was made, the table (a dialog opens) or the phone cards (the claim page opens). */
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

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await listFinanceQueue(companyId)); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
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
  const summary = useMemo(() => summariseQueue(data), [data]);
  // The policy is frozen on a claim when it is sent, so a claim sent while the company had the finance step still goes
  // through it, or went through it, after the company turned the step off. In a company with no such step the queue
  // speaks of a review only for that claim: its row says where its review stands, a claim that never had the step says
  // nothing of one, and the count names a review only while a claim in the queue still waits for one.
  const financeLine = useCallback((r: any): string | undefined => (
    financeStep === true || rowHasFinanceReview(r) ? FINANCE_REVIEW_LABELS[r.financeReviewStatus] ?? '—' : undefined
  ), [financeStep]);
  const withReview = financeStep === true || data.some(rowHasFinanceReview);
  const words = financeQueueWords(financeStep === true || data.some(queueRowOffersFinanceReview));
  const filteredData = useMemo(() => data.filter(r => matchesSearch([
    r.requestNo,
    r.requesterDisplayNameSnapshot,
    r.lineCount ?? 1,
    r.outstandingAmount,
    r.amount,
    r.currency,
    claimStatusBadge(r).label,
    financeLine(r),
    r.hasDuplicateBlocker ? MAY_BE_DUPLICATE_LABEL : '',
    currentDeskText(r.currentDesk),
  ], query)), [data, query, financeLine]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query]);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {loading || financeStep === undefined ? <LoadingState label="กำลังโหลด..." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard icon={ICON.clock} label={words.waiting} value={summary.count} {...KPI.sky} />
            <StatCard icon={ICON.wallet} label="ยอดคงค้างรวม" value={formatMoney(summary.outstandingAmount, 'THB')} {...KPI.purple} />
            <StatCard icon={ICON.alert} label="พบรายการที่อาจซ้ำ" value={summary.flagged} danger={summary.flagged > 0} {...KPI.danger} />
          </div>
          <MangmeeCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500 tabular-nums">
                {query.trim() ? `พบ ${filteredData.length} จาก ${data.length} รายการ` : `ทั้งหมด ${data.length} รายการ`}
              </div>
              <div className="relative w-full sm:max-w-96">
                <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                  placeholder="ค้นหาเลขที่ ผู้เบิก ยอดเงิน สถานะ"
                  value={query} onChange={e => setQuery(e.target.value)} />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
                  {ICON.search}
                </span>
              </div>
            </div>
            {filteredData.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title={data.length === 0 ? words.emptyTitle : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                  description={data.length === 0 ? words.emptyDescription : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                />
              </div>
            ) : (
            <div className="[container-type:inline-size]">
            <div className="hidden @[58rem]:block" data-testid="reimbursements-finance-table">
            <div className="mt-3 overflow-x-auto">
                <table className={QUEUE_TABLE_CLASS}>
                  <thead>
                    <tr><th className="!text-center">เลขที่</th><th className="!text-center">ผู้เบิก</th><th className="!text-center">จำนวนรายการ</th><th className="!text-center">จำนวน</th><th className="!text-center">สถานะ</th>{withReview && <th className="!text-center">ตรวจการเงิน</th>}<th className="!text-center">การกระทำ</th></tr>
                  </thead>
                  <tbody>
                    {pagedData.map((r: any) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                        <td className="font-mono text-xs">{r.requestNo ?? '—'}</td>
                        <td className={cx(FREE_TEXT_CELL, 'min-w-24')}>{r.requesterDisplayNameSnapshot}</td>
                        <td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>
                        <td className="text-right tabular-nums">{formatMoney(r.outstandingAmount)} / {formatMoney(r.amount, r.currency)}</td>
                        <td><div className="flex flex-wrap items-center gap-2"><StatusBadge claim={r} />{(r.hasDuplicateBlocker || r.duplicateReasons?.includes('EXPENSE_CONFIRMATION')) && <><MangmeeBadge tone="amber">{MAY_BE_DUPLICATE_LABEL}</MangmeeBadge><span className="text-xs text-amber-800">{reimbursementDuplicateBlockNotice(r.duplicateReasons, r.status === 'FINANCE_REVIEW')}</span></>}</div></td>
                        {withReview && <td className="text-xs text-gray-500">{financeLine(r) ?? '—'}</td>}
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button type="button" aria-label="ดูรายละเอียด" title="ดูรายละเอียด"
                              className={cx(ghostClass, '!min-h-9 !w-9 !px-0 !py-0')}
                              onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }}>
                              <span className="[&>svg]:h-4 [&>svg]:w-4">{ICON.eye}</span>
                            </button>
                            {queueRowOffersFinanceReview(r) && <button className={cx(successBtn, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} style={successBtnStyle} disabled={busy === r.id || (r.hasDuplicateBlocker && !permissions.includes('reimbursement.duplicate.resolve'))} aria-busy={Boolean(busy === r.id)} title={r.hasDuplicateBlocker && !permissions.includes('reimbursement.duplicate.resolve') ? 'รายการนี้อาจซ้ำ ต้องให้ผู้มีสิทธิ์แก้รายการซ้ำตรวจสอบ' : undefined} onClick={e => { e.stopPropagation(); action(r.id, () => financeReviewReimbursement(companyId, r.id, { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: r.hasDuplicateBlocker, duplicateResolutionReason: r.hasDuplicateBlocker ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined }), r.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการคำขอจ่ายต่อเรียบร้อยแล้ว' : 'อนุมัติจ่ายเรียบร้อยแล้ว'); }}>{financeActionLabel(r)}</button>}
                            {queueRowOffersPayment(r, permissions) && <button className={cx(btnClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)} onClick={e => { e.stopPropagation(); onRecordPayment(r, 'table'); }}>บันทึกจ่าย</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            </div>
            </div>
            <div className={cx(QUEUE_CARDS_CLASS, '@[58rem]:hidden')} data-testid="reimbursements-finance-card-list">
              {pagedData.map((r: any) => (
                <MangmeeCard key={r.id} className="p-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="max-w-[45%] truncate font-mono text-xs text-gray-600">{r.requestNo ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{r.requesterDisplayNameSnapshot}</span>
                  </div>
                  <CurrentDeskLine row={r} />
                  {financeLine(r) && <div className="mt-1 truncate text-xs text-gray-500">ตรวจการเงิน: {financeLine(r)}</div>}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge claim={r} />
                      {(r.hasDuplicateBlocker || r.duplicateReasons?.includes('EXPENSE_CONFIRMATION')) && <><MangmeeBadge tone="amber">{MAY_BE_DUPLICATE_LABEL}</MangmeeBadge><span className="text-xs text-amber-800">{reimbursementDuplicateBlockNotice(r.duplicateReasons, r.status === 'FINANCE_REVIEW')}</span></>}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">{r.ageHours} ชม.</span>
                  </div>
                  <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{formatMoney(r.outstandingAmount)} / {formatMoney(r.amount, r.currency)}</div>
                  <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                    <Link href={`/companies/${companyId}/reimbursements/${r.id}`} className={cx(ghostClass, 'min-h-11 w-full')} data-testid="reimbursements-finance-card">ดูรายละเอียด</Link>
                    {queueRowOffersFinanceReview(r) && <button className={cx(successBtn, 'min-h-11 w-full')} style={successBtnStyle} disabled={busy === r.id || (r.hasDuplicateBlocker && !permissions.includes('reimbursement.duplicate.resolve'))} aria-busy={Boolean(busy === r.id)} title={r.hasDuplicateBlocker && !permissions.includes('reimbursement.duplicate.resolve') ? 'รายการนี้อาจซ้ำ ต้องให้ผู้มีสิทธิ์แก้รายการซ้ำตรวจสอบ' : undefined} onClick={() => action(r.id, () => financeReviewReimbursement(companyId, r.id, { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: r.hasDuplicateBlocker, duplicateResolutionReason: r.hasDuplicateBlocker ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined }), r.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการคำขอจ่ายต่อเรียบร้อยแล้ว' : 'อนุมัติจ่ายเรียบร้อยแล้ว')}>{financeActionLabel(r)}</button>}
                    {queueRowOffersPayment(r, permissions) && <button className={cx(btnClass, 'min-h-11 w-full')} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)} onClick={() => onRecordPayment(r, 'cards')}>บันทึกจ่าย</button>}
                  </div>
                </MangmeeCard>
              ))}
            </div>
            </div>
            )}
            <TablePager from={bounds.from} to={bounds.to} total={filteredData.length}
              page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
          </MangmeeCard>
        </>
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
    <Modal open title={`บันทึกการจ่ายเงิน — ${request.requestNo}`} size="sm" closeLabel="ยกเลิก" onClose={onClose}>
      {claim ? (
        blocked ? (
          <div className="space-y-3">
            <ErrorBanner message={blocked} />
            <div className="flex justify-end">
              <Link href={`${claimPath}/${request.id}`} className={btnClass}>เปิดหน้าใบเบิก</Link>
            </div>
          </div>
        ) : (
        <div className="space-y-3">
          {/* The same box the claim page shows at its payment step: where to transfer, with show and copy. */}
          <ClaimPayoutCard companyId={companyId} detail={claim} userId={userId} payoutAccountHref={`${claimPath}/payout-account`} payStep />
          <PaymentForm companyId={companyId} request={claim} onCancel={onClose} onDone={onDone}
            onOpenFile={(choice) => void openSlipChoice(claim.id, choice)} />
          {openFileError && <ErrorBanner message={`เปิดไฟล์ไม่สำเร็จ · ${openFileError}`} />}
        </div>
        )
      ) : failed ? (
        <div className="space-y-3">
          <ErrorBanner message={`เปิดใบเบิกไม่สำเร็จ จึงยังบันทึกจ่ายจากหน้านี้ไม่ได้ · ${failed}`} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className={ghostClass} onClick={() => setAttempt((n) => n + 1)}>ลองอีกครั้ง</button>
            <Link href={`${claimPath}/${request.id}?pay=1`} className={btnClass}>เปิดหน้าใบเบิก</Link>
          </div>
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
      toast.success('บันทึกนโยบายเบิกจ่ายแล้ว'); await load();
    } catch (e2) {
      setPolicyChanged((e2 as { code?: unknown })?.code === 'reimbursement_policy_changed'
        || (e2 instanceof Error && e2.message.includes('reimbursement_policy_changed')));
      setError(err(e2));
    } finally { setBusy(false); }
  };

  if (loading) return <LoadingState label="กำลังโหลด..." />;
  if (!form) return <ErrorBanner message={error ?? 'โหลดนโยบายไม่สำเร็จ'} />;

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

  return (
    <form onSubmit={save} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid gap-4 xl:grid-cols-2">
        <MangmeeCard className="p-4 xl:col-span-2">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: KPI.sky.bg, color: KPI.sky.color }}>{ICON.doc}</span>
            <div>
              <h3 className="text-sm font-bold text-gray-900">การอนุมัติใบเบิก</h3>
              <p className="mt-1 text-xs text-gray-500">เลือกผู้รับผิดชอบและตั้งค่าเกณฑ์การอนุมัติของบริษัท</p>
            </div>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200 sm:col-span-2">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">เปิดรับใบเบิกใหม่</span>
                <span className="mt-0.5 block text-xs text-gray-500">เมื่อปิด ใบร่างจะส่งไม่ได้ แต่ใบเบิกที่ส่งแล้วจะทำงานต่อจนจบ</span>
              </span>
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={form.status === 'ACTIVE'} onChange={e => setForm((f: any) => ({ ...f, status: e.target.checked ? 'ACTIVE' : 'INACTIVE' }))} />
            </label>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">ต้องอนุมัติเมื่อยอดตั้งแต่ (บาท)</label>
              <input className={inputClass} type="number" min="0" step="0.01" required value={form.approvalRequiredFromAmount} onChange={e => setForm((f: any) => ({ ...f, approvalRequiredFromAmount: e.target.value }))} />
            </div>
            <fieldset className="min-w-0">
              <legend className="mb-1.5 block text-xs font-semibold text-gray-600">ส่งใบเบิกให้ใครอนุมัติ?</legend>
              <p className="mb-2 text-xs text-gray-500">เลือกได้หลายบทบาท ทุกคนในบทบาทที่เลือกอนุมัติได้ ระบบใช้ผลจากคนแรกที่อนุมัติหรือปฏิเสธ</p>
              <div className="space-y-2">
                {roleOptions.map((option) => (
                  <label key={option.key} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 transition hover:border-brand-200">
                    <span className="min-w-0">{approverRoleName(option)}{option.selectable ? '' : ' — ยังไม่พร้อมใช้งาน'}</span>
                    <input type="checkbox" className="h-4 w-4 shrink-0" checked={selectedRoles.includes(option.key)} onChange={() => toggleRole(option.key)} />
                  </label>
                ))}
              </div>
              {readyOptions.length === 0 ? (
                <p className="mt-1 text-xs text-error-600">ยังไม่มีบทบาทที่พร้อมอนุมัติ กรุณาให้ผู้ดูแลเพิ่มสิทธิ์และพนักงานในหน้าบทบาทและสิทธิ์</p>
              ) : rolesNotReady ? (
                <p className="mt-1 text-xs text-error-600">บางบทบาทที่เลือกยังไม่มีคนพร้อมอนุมัติ กรุณาเอาออกหรือเลือกบทบาทอื่น</p>
              ) : !roleBasedRoute && !approverChanged ? (
                <p className="mt-1 text-xs text-warning-700">การตั้งค่าเดิมระบุผู้อนุมัติเป็นรายบุคคล หากต้องการเปลี่ยนเส้นทางให้เลือกบทบาทใหม่</p>
              ) : selectedRoles.length === 0 ? (
                <p className="mt-1 text-xs text-gray-500">เลือกอย่างน้อย 1 บทบาท</p>
              ) : null}
              {!ownerRoute && <p className="mt-1 text-xs text-gray-500">ถ้ายังไม่มีคนในบทบาทที่เลือก เจ้าของกิจการเป็นผู้อนุมัติ</p>}
              {paymentWarning && <p role="status" className="mt-1 text-xs text-warning-700" data-testid="reimbursement-approver-payment-warning">{paymentWarning}</p>}
            </fieldset>
            <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200 sm:col-span-2">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">{SELF_APPROVAL_SWITCH_LABEL}</span>
                <span className="mt-0.5 block text-xs text-gray-500">{SELF_APPROVAL_POLICY_NOTE}</span>
              </span>
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={!!form.allowSelfApproval} onChange={e => setForm((f: any) => ({ ...f, allowSelfApproval: e.target.checked }))} />
            </label>
            <div className="space-y-2 rounded-xl bg-sky-50 px-3 py-3 text-xs text-sky-900 sm:col-span-2">
              {policyDecisionPreview({
                approvalRequiredFromAmount: form.approvalRequiredFromAmount,
                approverLabel: roleLabel,
                ownerRoute,
                financeReviewRequired: !!form.financeReviewRequired,
              }).map(line => (
                <p key={line.title}><span className="block font-semibold">{line.title}</span>{line.path}</p>
              ))}
            </div>
          </div>
        </MangmeeCard>

        <MangmeeCard className="p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: KPI.amber.bg, color: KPI.amber.color }}>{ICON.receipt}</span>
            <div>
              <h3 className="text-sm font-bold text-gray-900">ใบเสร็จและรายการซ้ำ</h3>
              <p className="mt-1 text-xs text-gray-500">ควบคุมหลักฐานประกอบและวิธีจัดการรายการที่อาจซ้ำ</p>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">ต้องมีใบเสร็จ</span>
                <span className="mt-0.5 block text-xs text-gray-500">ทุกรายการต้องแนบใบเสร็จก่อนส่งอนุมัติ</span>
              </span>
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={!!form.requireReceipt} onChange={e => setForm((f: any) => ({ ...f, requireReceipt: e.target.checked }))} />
            </label>
            <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">อนุญาตไม่มีใบเสร็จได้หากระบุเหตุผล</span>
                <span className="mt-0.5 block text-xs text-gray-500">ผู้เบิกกรอกเหตุผลแทนใบเสร็จได้ในบางกรณี</span>
              </span>
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={!!form.allowMissingReceiptWithReason} onChange={e => setForm((f: any) => ({ ...f, allowMissingReceiptWithReason: e.target.checked }))} />
            </label>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">นโยบายรายการซ้ำ</label>
              <ThemedSelect className={inputClass} value={form.duplicatePolicy} onChange={e => setForm((f: any) => ({ ...f, duplicatePolicy: e.target.value }))}>
                <option value="WARN">เตือน</option>
                <option value="BLOCK_SUBMIT">ระงับการส่ง</option>
                <option value="BLOCK_PAYMENT">ระงับการจ่าย</option>
              </ThemedSelect>
            </div>
          </div>
        </MangmeeCard>

        <MangmeeCard className="p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px]" style={{ background: KPI.purple.bg, color: KPI.purple.color }}>{ICON.wallet}</span>
            <div>
              <h3 className="text-sm font-bold text-gray-900">การเงินและกำหนดเวลา</h3>
              <p className="mt-1 text-xs text-gray-500">กำหนดขั้นตอนตรวจสอบก่อนจ่ายและเวลาที่คาดหวัง</p>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            <label className="flex items-start justify-between gap-4 rounded-xl border border-gray-200 px-3 py-3 transition hover:border-brand-200">
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-gray-800">ตรวจการเงินก่อนจ่าย</span>
                <span className="mt-0.5 block text-xs text-gray-500">เปิดเมื่อมีฝ่ายการเงินแยกจากผู้อนุมัติ ผู้อนุมัติจึงส่งต่อให้การเงินตรวจก่อนจ่าย</span>
              </span>
              <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={!!form.financeReviewRequired} onChange={e => setForm((f: any) => ({ ...f, financeReviewRequired: e.target.checked }))} />
            </label>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">{`${DEADLINE_LABEL} (ชั่วโมง)`}</label>
              <input className={inputClass} type="number" min="0" max="8760" step="1" value={form.slaHours ?? ''} onChange={e => setForm((f: any) => ({ ...f, slaHours: e.target.value }))} />
            </div>
          </div>
        </MangmeeCard>
      </div>

      <aside>
        <MangmeeCard className="sticky top-4 h-fit p-4">
          <h3 className="text-sm font-bold text-gray-900">สรุปนโยบาย</h3>
          <dl className="mt-4 divide-y divide-gray-100">
            <div className="flex items-center justify-between gap-3 py-3 first:pt-0">
              <dt className="text-xs text-gray-500">รับใบเบิกใหม่</dt>
              <dd><MangmeeBadge tone={form.status === 'ACTIVE' ? 'brand' : 'slate'}>{form.status === 'ACTIVE' ? 'เปิด' : 'ปิด'}</MangmeeBadge></dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-xs text-gray-500">ต้องอนุมัติเมื่อยอด</dt>
              <dd className="text-sm font-semibold text-gray-800">ตั้งแต่ {formatMoney(form.approvalRequiredFromAmount)} บาท</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-xs text-gray-500">ส่งให้อนุมัติ</dt>
              <dd className="text-right text-sm font-semibold text-gray-800">{roleLabel || (!roleBasedRoute && !approverChanged ? 'ผู้อนุมัติเดิมรายบุคคล' : 'ยังไม่ได้เลือก')}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-xs text-gray-500">ใบเสร็จ</dt>
              <dd><MangmeeBadge tone={form.requireReceipt ? 'brand' : 'slate'}>{form.requireReceipt ? 'จำเป็น' : 'ไม่บังคับ'}</MangmeeBadge></dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <dt className="text-xs text-gray-500">ตรวจการเงินก่อนจ่าย</dt>
              <dd><MangmeeBadge tone={form.financeReviewRequired ? 'brand' : 'slate'}>{form.financeReviewRequired ? 'เปิด' : 'ปิด'}</MangmeeBadge></dd>
            </div>
            <div className="flex items-center justify-between gap-3 py-3 last:pb-0">
              <dt className="text-xs text-gray-500">{DEADLINE_LABEL}</dt>
              <dd className="text-sm font-semibold text-gray-800">{form.slaHours === '' || form.slaHours == null ? 'ไม่กำหนด' : `${form.slaHours} ชั่วโมง`}</dd>
            </div>
          </dl>
          <div className="mt-4 space-y-3">
            {error && <ErrorBanner message={error} />}
            {policyChanged && <button type="button" className={cx(ghostClass, 'w-full')} onClick={() => void load()}>โหลดค่าล่าสุด</button>}
            <button type="submit" className={cx(btnClass, 'w-full')} disabled={busy || !routeReady} aria-busy={Boolean(busy)}>{busy ? 'กำลังบันทึก...' : 'บันทึกนโยบาย'}</button>
          </div>
        </MangmeeCard>
      </aside>
    </form>
  );
}
