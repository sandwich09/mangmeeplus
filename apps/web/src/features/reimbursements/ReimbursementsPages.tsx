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
  listAllReimbursements, submitReimbursement, getReimbursement,
  listApprovalQueue, approveReimbursement, rejectReimbursement,
  listFinanceQueue, financeReviewReimbursement,
  getReimbursementPolicy, listReimbursementApproverOptions, updateReimbursementPolicy,
} from './reimbursements.api';
import {
  REQUEST_STATUS_LABELS, PAYMENT_STATUS_LABELS,
  FINANCE_REVIEW_LABELS, REIMBURSEMENT_CREATE_UNAVAILABLE,
  currentDeskText, reimbursementOwnActions, reimbursementSubmitReadiness,
} from './reimbursements.model';
import {
  baht0, dateShort, ICON, KPI, StatCard, ErrorBanner,
  inputClass, btnClass, ghostClass, dangerClass, successBtn, successBtnStyle,
} from '../expenses/ExpensesUi';
import {
  summariseQueue, matchesSearch, pageBounds,
  formatMoney, parseHubTab, visibleHubTabs, withAssignedApprovalTab, reimbursementListScope, errorText, isStaleApprovalError, diffApprovalFields,
  policyDecisionPreview, approverNotReadyHelp, approvalComparable, categoryText, type HubTab,
  hubFilterCounts, hubRows, type HubFilter, approverPaymentWarning,
} from './reimbursements.logic';
import {
  PaymentBadge, PaymentForm, RejectDialog, StaleApprovalDialog, StatusBadge, financeActionLabel,
} from './ReimbursementDetailSections';
import { type ReimbursementApproverRoleOption } from '@watchdog-bms/contracts';
import { useToast } from '@/common/components/toast';

/** Every banner in this feature goes through here, so API error codes never reach the user raw. */
function err(e: unknown) { return errorText(e); }

const HUB_TAB_LABELS: Record<HubTab, string> = {
  mine: 'รายการที่เกี่ยวข้อง', approvals: 'คิวอนุมัติ', finance: 'คิวการเงิน', policy: 'ตั้งค่านโยบาย',
};
const HUB_TAB_DESCRIPTIONS: Record<HubTab, string> = {
  mine: 'ติดตามคำขอของคุณและเอกสารที่คุณเป็นผู้อนุมัติ ผู้ตรวจ ผู้จ่าย หรือผู้ลงนาม',
  approvals: 'ตรวจคำขอที่รอคุณอนุมัติ ดูรายการและใบเสร็จก่อนตัดสินใจ',
  finance: 'ตรวจสอบคำขอที่อนุมัติแล้ว และบันทึกการจ่ายเงิน',
  policy: 'กำหนดเกณฑ์การอนุมัติ ใบเสร็จ และ SLA ของการเบิกจ่ายทั้งบริษัท',
};
const APPROVER_ROLE_LABELS: Record<string, string> = {
  OWNER: 'เจ้าของกิจการ', ADMIN: 'แอดมิน', MANAGER: 'ผู้จัดการ', FINANCE: 'การเงิน',
  ACCOUNTANT: 'บัญชี', HR: 'ฝ่ายบุคคล', SALES: 'ฝ่ายขาย', INVENTORY: 'คลังสินค้า',
  MARKETING: 'การตลาด', STAFF: 'พนักงาน', AUDITOR_READONLY: 'ผู้ตรวจสอบ',
};
const STANDARD_ROLE_NAMES: Record<string, string> = {
  OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', FINANCE: 'Finance', ACCOUNTANT: 'Accountant',
  HR: 'HR', SALES: 'Sales', INVENTORY: 'Inventory', MARKETING: 'Marketing', STAFF: 'Staff',
  AUDITOR_READONLY: 'Auditor (Read-only)',
};
const approverRoleName = (option?: Pick<ReimbursementApproverRoleOption, 'key' | 'name'>) => {
  if (!option) return '';
  return option.name === STANDARD_ROLE_NAMES[option.key] ? (APPROVER_ROLE_LABELS[option.key] ?? option.name) : option.name;
};
const shortDate = (iso?: string) => dateShort(iso);
/** A claim never said whose desk it sits on. Terminal claims have none, and render nothing. */
function CurrentDeskLine({ row }: { row: { currentDesk?: { kind?: string; names?: string[] } } }) {
  const desk = currentDeskText(row.currentDesk);
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
  const [refreshKey, setRefreshKey] = useState(0);

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
      description={HUB_TAB_DESCRIPTIONS[tab]}
      actions={permissions.includes('reimbursement.create') && tab === 'mine' ? (
        <Link href={`/companies/${companyId}/reimbursements/new`} className={cx(btnClass, 'min-h-11 w-full sm:w-auto')}>+ สร้างคำขอเบิก</Link>
      ) : undefined}
    >
      <nav aria-label="งานเบิกจ่าย" className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200">
        <div className="flex max-w-full gap-1 overflow-x-auto">
          {tabs.filter(t => t !== 'policy').map(t => (
            <button type="button" key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
              className={cx('min-h-12 shrink-0 border-b-2 px-4 py-3 text-base font-semibold', tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-600 hover:text-brand-700')}>
              {HUB_TAB_LABELS[t]}
            </button>
          ))}
        </div>
        {tabs.includes('policy') && <button type="button" onClick={() => setTab('policy')} aria-pressed={tab === 'policy'} className={cx('min-h-11 rounded-lg px-3 py-2 text-sm font-semibold', tab === 'policy' ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-100')}>ตั้งค่านโยบาย</button>}
      </nav>
      {!permissions.includes('reimbursement.create') && <div role="status" className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">{REIMBURSEMENT_CREATE_UNAVAILABLE}</div>}
      {tab === 'mine' && <MyRequests
        {...queueProps}
        userId={userId}
        canCreate={permissions.includes('reimbursement.create')}
      />}
      {tab === 'approvals' && <ApprovalQueue {...queueProps} />}
      {tab === 'finance' && <FinanceQueue {...queueProps} onRecordPayment={setPayFor} />}
      {tab === 'policy' && <PolicySettings companyId={companyId} />}

      {payFor && <PaymentModal
        companyId={companyId}
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
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<HubFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await listAllReimbursements(companyId, { scope: reimbursementListScope(permissions) })); }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId, permissions]);
  useEffect(() => { load(); }, [load, refreshKey]);

  // Only the row "ส่งอนุมัติ" uses this; a refusal for want of an approver says who can fix it.
  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setBusy(id); setError(null);
    try { await fn(); await load(); if (successMessage) toast.success(successMessage); } catch (e) { setError(approverNotReadyHelp(e, permissions)?.text ?? err(e)); } finally { setBusy(null); }
  };

  const summary = useMemo(() => summariseQueue(data), [data]);
  const blockedDraftCount = useMemo(
    () => data.filter(row => reimbursementSubmitReadiness(row).blocked).length,
    [data],
  );
  // The cards, the chips and the list all go through hubRows, so a count always equals the rows its filter shows.
  const statusCounts = useMemo(() => hubFilterCounts(data), [data]);
  const filteredData = useMemo(() => {
    return hubRows(data, statusFilter).filter(r => {
      return matchesSearch([
        r.requestNo,
        r.requesterDisplayNameSnapshot,
        r.reason,
        r.categoryLabelSnapshot ?? r.categoryKey,
        r.lineCount ?? 1,
        r.amount,
        r.currency,
        REQUEST_STATUS_LABELS[r.status] ?? r.status,
        PAYMENT_STATUS_LABELS[r.paymentStatus] ?? r.paymentStatus,
        currentDeskText(r.currentDesk),
      ], query);
    });
  }, [data, statusFilter, query]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query, statusFilter]);
  const statusChips: Array<{ key: HubFilter; label: string }> = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'draft', label: 'ร่าง' },
    { key: 'review', label: 'รออนุมัติ/ตรวจสอบ' },
    { key: 'payment', label: 'รอจ่าย' },
    { key: 'paid', label: 'จ่ายแล้ว' },
    { key: 'closed', label: 'ปฏิเสธ/ยกเลิก' },
  ];
  // Each card is the same filter as its chip; tapping the open one goes back to ทั้งหมด.
  const statusCards = [
    { key: 'draft', icon: ICON.edit, label: 'ร่างรอส่ง', value: statusCounts.draft, tone: KPI.amber },
    { key: 'review', icon: ICON.clock, label: 'รออนุมัติ/ตรวจสอบ', value: statusCounts.review, tone: KPI.purple },
    { key: 'payment', icon: ICON.wallet, label: 'รอจ่ายเงินคืน', value: statusCounts.payment, tone: KPI.sky },
    { key: 'all', icon: ICON.doc, label: 'ยอดรวมที่ขอเบิก', value: baht0(summary.totalAmount), tone: KPI.brand },
  ] as const;

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <>
          {blockedDraftCount > 0 && (
            <ErrorBanner message={`มีคำขอร่าง ${blockedDraftCount} รายการที่ยังส่งไม่ได้ตามนโยบายใบเสร็จ กรุณาเปิดรายละเอียดเพื่อแนบใบเสร็จหรือแก้ไขคำขอ`} />
          )}
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" data-testid="reimbursements-mine-cards">
            {statusCards.map(card => (
              <button key={card.key} type="button" aria-pressed={statusFilter === card.key}
                onClick={() => setStatusFilter(statusFilter === card.key ? 'all' : card.key)}
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
                  <span className={cx('tabular-nums inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-extrabold', statusFilter === chip.key ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-500')}>{statusCounts[chip.key]}</span>
                </button>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500 tabular-nums">
                {query.trim() || statusFilter !== 'all' ? `พบ ${filteredData.length} จาก ${data.length} รายการ` : `ทั้งหมด ${data.length} รายการ`}
              </div>
              <div className="relative w-full sm:max-w-96">
                <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                  placeholder="ค้นหาทุกข้อมูลในตาราง เช่น เลขที่ ผู้ขอ จำนวนเงิน สถานะ"
                  value={query} onChange={e => setQuery(e.target.value)} />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
                  {ICON.search}
                </span>
              </div>
            </div>
            {filteredData.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title={data.length === 0 ? 'ยังไม่มีคำขอเบิก' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                  description={data.length === 0
                    ? canCreate ? 'กด "สร้างคำขอเบิก" เพื่อเริ่มคำขอแรกของคุณ' : REIMBURSEMENT_CREATE_UNAVAILABLE
                    : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                />
              </div>
            ) : (
              <>
            <div className="hidden md:block" data-testid="reimbursements-mine-table">
            <div className="mt-3 overflow-x-auto">
              <div className="min-w-[980px]">
                <table className="mangmee-table">
                  <thead>
                    <tr><th className="!text-center">เลขที่</th><th className="!text-center">ผู้ขอ</th><th className="!text-center">เหตุผล</th><th className="!text-center">หมวด</th><th className="!text-center">จำนวนรายการ</th><th className="!text-center">จำนวน</th><th className="!text-center">สถานะ</th><th className="!text-center">การจ่าย</th><th className="!text-center">การกระทำ</th></tr>
                  </thead>
                  <tbody>
                    {filteredData.length === 0 ? (
                      <tr><td colSpan={9}>
                        <EmptyState
                          title={data.length === 0 ? 'ยังไม่มีคำขอเบิก' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                          description={data.length === 0 ? 'กด "สร้างคำขอเบิก" เพื่อเริ่มคำขอแรกของคุณ' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                        />
                      </td></tr>
                    ) : pagedData.map((r: any) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                        <td className="font-mono text-xs">{r.requestNo ?? '—'}</td>
                        <td>{r.requesterDisplayNameSnapshot ?? '—'}</td>
                        <td>{r.reason}</td>
                        <td className="text-gray-500">{categoryText(r.categoryLabelSnapshot)}</td>
                        <td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>
                        <td className="text-right tabular-nums">{formatMoney(r.amount, r.currency)}</td>
                        <td><StatusBadge status={r.status} /></td>
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
                              onClick={e => { e.stopPropagation(); action(r.id, () => submitReimbursement(companyId, r.id), 'ส่งขออนุมัติเรียบร้อยแล้ว'); }}
                              disabled={busy === r.id || reimbursementSubmitReadiness(r).blocked} aria-busy={Boolean(busy === r.id)}
                            >ส่งอนุมัติ</button>}
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
            </div>
            <div className="mt-3 space-y-3 md:hidden" data-testid="reimbursements-mine-card-list">
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
                    <div className="mt-1 truncate text-xs text-gray-500">ผู้ขอ: {r.requesterDisplayNameSnapshot ?? '—'}</div>
                    <CurrentDeskLine row={r} />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <StatusBadge status={r.status} />
                      <span className="shrink-0 text-xs text-gray-500">{shortDate(r.incurredDate)}</span>
                    </div>
                    <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{formatMoney(r.amount, r.currency)}</div>
                  </div>
                  {(reimbursementOwnActions(r, userId, permissions).canSubmit || reimbursementOwnActions(r, userId, permissions).canCancel) && (
                    <div className="relative z-20 mt-4 space-y-2 border-t border-gray-100 pt-3">
                      {reimbursementOwnActions(r, userId, permissions).canSubmit && <button
                        className={cx(btnClass, 'min-h-11 w-full')}
                        title={reimbursementSubmitReadiness(r).message}
                        onClick={() => action(r.id, () => submitReimbursement(companyId, r.id), 'ส่งขออนุมัติเรียบร้อยแล้ว')}
                        disabled={busy === r.id || reimbursementSubmitReadiness(r).blocked} aria-busy={Boolean(busy === r.id)}
                      >ส่งอนุมัติ</button>}
                      {reimbursementOwnActions(r, userId, permissions).canCancel && <button className={cx(ghostClass, 'min-h-11 w-full')} onClick={() => onOpenDetail(r.id)} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)}>ยกเลิก</button>}
                    </div>
                  )}
                </MangmeeCard>
              ))}
            </div>
            </>
            )}
            <TablePager from={bounds.from} to={bounds.to} total={filteredData.length}
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

  const action = async (id: string, fn: () => Promise<unknown>, successMessage?: string) => {
    setBusy(id); setError(null);
    try { await fn(); await load(); if (successMessage) toast.success(successMessage); } catch (e) { setError(err(e)); } finally { setBusy(null); }
  };
  const approveRow = async (r: any) => {
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
      } else { setError(err(e)); }
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
    r.slaRisk ? 'เกิน SLA' : '',
    currentDeskText(r.currentDesk),
  ], query)), [data, query]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query]);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard icon={ICON.clock} label="รอคุณอนุมัติ" value={summary.count} {...KPI.amber} />
            <StatCard icon={ICON.wallet} label="ยอดรวมที่รออนุมัติ" value={baht0(summary.totalAmount)} {...KPI.purple} />
            <StatCard icon={ICON.alert} label="เกิน SLA" value={summary.flagged} danger={summary.flagged > 0} {...KPI.danger} />
          </div>
          <MangmeeCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500 tabular-nums">
                {query.trim() ? `พบ ${filteredData.length} จาก ${data.length} รายการ` : `ทั้งหมด ${data.length} รายการ`}
              </div>
              <div className="relative w-full sm:max-w-96">
                <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                  placeholder="ค้นหาทุกข้อมูลในตาราง เช่น เลขที่ ผู้ขอ จำนวนเงิน สถานะ"
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
              <>
            <div className="hidden md:block" data-testid="reimbursements-approvals-table">
            <div className="mt-3 overflow-x-auto">
              <div className="min-w-[980px]">
                <table className="mangmee-table">
                  <thead>
                    <tr><th className="!text-center">เลขที่</th><th className="!text-center">ผู้ขอ</th><th className="!text-center">เหตุผล</th><th className="!text-center">จำนวนรายการ</th><th className="!text-center">จำนวน</th><th className="!text-center">อายุ</th><th className="!text-center">การกระทำ</th></tr>
                  </thead>
                  <tbody>
                    {filteredData.length === 0 ? (
                      <tr><td colSpan={7}>
                        <EmptyState
                          title={data.length === 0 ? 'ไม่มีรายการรออนุมัติ' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                          description={data.length === 0 ? 'คำขอที่รอคุณอนุมัติจะแสดงที่นี่' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                        />
                      </td></tr>
                    ) : pagedData.map((r: any) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                        <td className="font-mono text-xs">{r.requestNo ?? '—'}</td>
                        <td>{r.requesterDisplayNameSnapshot}</td>
                        <td>{r.reason}</td>
                        <td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>
                        <td className="text-right tabular-nums">{formatMoney(r.amount, r.currency)}</td>
                        <td className="text-right">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className="tabular-nums">{r.ageHours} ชม.</span>
                            {r.slaRisk && <MangmeeBadge tone="danger">เกิน SLA</MangmeeBadge>}
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
                            <button className={cx(successBtn, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} style={successBtnStyle} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)} onClick={e => { e.stopPropagation(); approveRow(r); }}>อนุมัติ</button>
                            <button className={cx(dangerClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} disabled={busy === r.id} onClick={e => { e.stopPropagation(); setRejectFor(r); }}>ปฏิเสธ</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </div>
            <div className="mt-3 space-y-3 md:hidden" data-testid="reimbursements-approvals-card-list">
              {pagedData.map((r: any) => (
                <MangmeeCard key={r.id} className="p-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="max-w-[45%] truncate font-mono text-xs text-gray-600">{r.requestNo ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{r.requesterDisplayNameSnapshot}</span>
                  </div>
                  <CurrentDeskLine row={r} />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.slaRisk && <MangmeeBadge tone="danger">เกิน SLA</MangmeeBadge>}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">{r.ageHours} ชม.</span>
                  </div>
                  <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{formatMoney(r.amount, r.currency)}</div>
                  <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                    <Link href={`/companies/${companyId}/reimbursements/${r.id}`} className={cx(ghostClass, 'min-h-11 w-full')} data-testid="reimbursements-approvals-card">ดูรายละเอียด</Link>
                    <button className={cx(successBtn, 'min-h-11 w-full')} style={successBtnStyle} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)} onClick={() => approveRow(r)}>อนุมัติ</button>
                    <button className={cx(dangerClass, 'min-h-11 w-full')} disabled={busy === r.id} onClick={() => setRejectFor(r)}>ปฏิเสธ</button>
                  </div>
                </MangmeeCard>
              ))}
            </div>
            </>
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
        onConfirm={async () => {
          const review = staleReview;
          if (!review) return;
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
function FinanceQueue({ companyId, refreshKey, onOpenDetail, permissions, onRecordPayment }: QueueProps & { onRecordPayment: (request: any) => void }) {
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
  const filteredData = useMemo(() => data.filter(r => matchesSearch([
    r.requestNo,
    r.requesterDisplayNameSnapshot,
    r.lineCount ?? 1,
    r.outstandingAmount,
    r.amount,
    r.currency,
    REQUEST_STATUS_LABELS[r.status] ?? r.status,
    FINANCE_REVIEW_LABELS[r.financeReviewStatus] ?? r.financeReviewStatus,
    r.hasDuplicateBlocker ? 'อาจซ้ำ' : '',
    currentDeskText(r.currentDesk),
  ], query)), [data, query]);
  const bounds = useMemo(() => pageBounds(filteredData.length, page), [filteredData.length, page]);
  const pagedData = useMemo(() => filteredData.slice(bounds.start, bounds.end), [filteredData, bounds]);
  useEffect(() => { setPage(1); }, [query]);

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} />}
      {loading ? <LoadingState label="กำลังโหลด..." /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatCard icon={ICON.clock} label="รอตรวจ/รอจ่าย" value={summary.count} {...KPI.sky} />
            <StatCard icon={ICON.wallet} label="ยอดคงค้างรวม" value={baht0(summary.outstandingAmount)} {...KPI.purple} />
            <StatCard icon={ICON.alert} label="พบรายการที่อาจซ้ำ" value={summary.flagged} danger={summary.flagged > 0} {...KPI.danger} />
          </div>
          <MangmeeCard className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-gray-500 tabular-nums">
                {query.trim() ? `พบ ${filteredData.length} จาก ${data.length} รายการ` : `ทั้งหมด ${data.length} รายการ`}
              </div>
              <div className="relative w-full sm:max-w-96">
                <input className={cx(inputClass, 'mangmee-input-icon-end w-full truncate')} type="search"
                  placeholder="ค้นหาทุกข้อมูลในตาราง เช่น เลขที่ ผู้ขอ จำนวนเงิน สถานะ"
                  value={query} onChange={e => setQuery(e.target.value)} />
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-400 [&>svg]:h-4 [&>svg]:w-4">
                  {ICON.search}
                </span>
              </div>
            </div>
            {filteredData.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title={data.length === 0 ? 'ไม่มีรายการรอการเงิน' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                  description={data.length === 0 ? 'คำขอที่ผ่านการอนุมัติแล้วจะแสดงที่นี่' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                />
              </div>
            ) : (
              <>
            <div className="hidden md:block" data-testid="reimbursements-finance-table">
            <div className="mt-3 overflow-x-auto">
              <div className="min-w-[980px]">
                <table className="mangmee-table">
                  <thead>
                    <tr><th className="!text-center">เลขที่</th><th className="!text-center">ผู้ขอ</th><th className="!text-center">จำนวนรายการ</th><th className="!text-center">จำนวน</th><th className="!text-center">สถานะ</th><th className="!text-center">ตรวจการเงิน</th><th className="!text-center">การกระทำ</th></tr>
                  </thead>
                  <tbody>
                    {filteredData.length === 0 ? (
                      <tr><td colSpan={7}>
                        <EmptyState
                          title={data.length === 0 ? 'ไม่มีรายการรอการเงิน' : 'ไม่พบรายการที่ตรงกับตัวกรอง'}
                          description={data.length === 0 ? 'คำขอที่ผ่านการอนุมัติแล้วจะแสดงที่นี่' : 'ลองล้างคำค้นหรือเลือกสถานะอื่น'}
                        />
                      </td></tr>
                    ) : pagedData.map((r: any) => (
                      <tr key={r.id} className="cursor-pointer" onClick={() => onOpenDetail(r.id)}>
                        <td className="font-mono text-xs">{r.requestNo ?? '—'}</td>
                        <td>{r.requesterDisplayNameSnapshot}</td>
                        <td className="text-right tabular-nums text-gray-500">{r.lineCount ?? 1} รายการ</td>
                        <td className="text-right tabular-nums">{formatMoney(r.outstandingAmount)} / {formatMoney(r.amount, r.currency)}</td>
                        <td><div className="flex flex-wrap items-center gap-2"><StatusBadge status={r.status} />{r.hasDuplicateBlocker && <MangmeeBadge tone="amber">อาจซ้ำ</MangmeeBadge>}</div></td>
                        <td className="text-xs text-gray-500">{FINANCE_REVIEW_LABELS[r.financeReviewStatus] ?? '—'}</td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                            <button type="button" aria-label="ดูรายละเอียด" title="ดูรายละเอียด"
                              className={cx(ghostClass, '!min-h-9 !w-9 !px-0 !py-0')}
                              onClick={e => { e.stopPropagation(); onOpenDetail(r.id); }}>
                              <span className="[&>svg]:h-4 [&>svg]:w-4">{ICON.eye}</span>
                            </button>
                            {r.status === 'FINANCE_REVIEW' && <button className={cx(successBtn, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} style={successBtnStyle} disabled={busy === r.id || (r.hasDuplicateBlocker && !permissions.includes('reimbursement.duplicate.resolve'))} aria-busy={Boolean(busy === r.id)} title={r.hasDuplicateBlocker && !permissions.includes('reimbursement.duplicate.resolve') ? 'รายการนี้อาจซ้ำ ต้องให้ผู้มีสิทธิ์แก้รายการซ้ำตรวจสอบ' : undefined} onClick={e => { e.stopPropagation(); action(r.id, () => financeReviewReimbursement(companyId, r.id, { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: r.hasDuplicateBlocker, duplicateResolutionReason: r.hasDuplicateBlocker ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined }), r.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการคำขอจ่ายต่อเรียบร้อยแล้ว' : 'อนุมัติจ่ายเรียบร้อยแล้ว'); }}>{financeActionLabel(r)}</button>}
                            {(r.status === 'READY_FOR_PAYMENT' && permissions.includes('reimbursement.payment.record')) && <button className={cx(btnClass, 'min-h-11 !px-3 !py-1.5 !text-xs sm:!min-h-9')} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)} onClick={e => { e.stopPropagation(); onRecordPayment(r); }}>บันทึกจ่าย</button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </div>
            <div className="mt-3 space-y-3 md:hidden" data-testid="reimbursements-finance-card-list">
              {pagedData.map((r: any) => (
                <MangmeeCard key={r.id} className="p-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="max-w-[45%] truncate font-mono text-xs text-gray-600">{r.requestNo ?? '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{r.requesterDisplayNameSnapshot}</span>
                  </div>
                  <CurrentDeskLine row={r} />
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <StatusBadge status={r.status} />
                      {r.hasDuplicateBlocker && <MangmeeBadge tone="amber">อาจซ้ำ</MangmeeBadge>}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-gray-500">{r.ageHours} ชม.</span>
                  </div>
                  <div className="mt-3 text-right text-lg font-bold tabular-nums text-gray-900">{formatMoney(r.outstandingAmount)} / {formatMoney(r.amount, r.currency)}</div>
                  <div className="mt-4 space-y-2 border-t border-gray-100 pt-3">
                    <Link href={`/companies/${companyId}/reimbursements/${r.id}`} className={cx(ghostClass, 'min-h-11 w-full')} data-testid="reimbursements-finance-card">ดูรายละเอียด</Link>
                    {r.status === 'FINANCE_REVIEW' && <button className={cx(successBtn, 'min-h-11 w-full')} style={successBtnStyle} disabled={busy === r.id || (r.hasDuplicateBlocker && !permissions.includes('reimbursement.duplicate.resolve'))} aria-busy={Boolean(busy === r.id)} title={r.hasDuplicateBlocker && !permissions.includes('reimbursement.duplicate.resolve') ? 'รายการนี้อาจซ้ำ ต้องให้ผู้มีสิทธิ์แก้รายการซ้ำตรวจสอบ' : undefined} onClick={() => action(r.id, () => financeReviewReimbursement(companyId, r.id, { decision: 'APPROVED_FOR_PAYMENT', resolveDuplicate: r.hasDuplicateBlocker, duplicateResolutionReason: r.hasDuplicateBlocker ? 'ตรวจสอบแล้วไม่ซ้ำ' : undefined }), r.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? 'ดำเนินการคำขอจ่ายต่อเรียบร้อยแล้ว' : 'อนุมัติจ่ายเรียบร้อยแล้ว')}>{financeActionLabel(r)}</button>}
                    {r.status === 'READY_FOR_PAYMENT' && permissions.includes('reimbursement.payment.record') && <button className={cx(btnClass, 'min-h-11 w-full')} disabled={busy === r.id} aria-busy={Boolean(busy === r.id)} onClick={() => onRecordPayment(r)}>บันทึกจ่าย</button>}
                  </div>
                </MangmeeCard>
              ))}
            </div>
            </>
            )}
            <TablePager from={bounds.from} to={bounds.to} total={filteredData.length}
              page={bounds.page} totalPages={bounds.totalPages} onPage={setPage} />
          </MangmeeCard>
        </>
      )}
    </div>
  );
}

function PaymentModal({ companyId, request, onClose, onDone }: { companyId: string; request: any; onClose: () => void; onDone: () => void }) {
  return (
    <Modal open title={`บันทึกการจ่ายเงิน — ${request.requestNo}`} size="sm" closeLabel="ยกเลิก" onClose={onClose}>
      <PaymentForm companyId={companyId} request={request} onCancel={onClose} onDone={onDone} />
    </Modal>
  );
}

// ── Policy Settings ───────────────────────────────────────────────────────────
// Exported for the QA spec, which renders the form with a policy already loaded.
export function PolicySettings({ companyId }: { companyId: string }) {
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
      setApproverChanged(roles.length !== (policy.defaultApproverRoles ?? []).length);
    }
    catch (e) { setError(err(e)); } finally { setLoading(false); }
  }, [companyId]);
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
    selectedOptions.map((option) => ({ label: approverRoleName(option), canRecordPayment: option.canRecordPayment })),
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
                  <label key={option.key} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 transition hover:border-brand-200">
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
                <span className="block text-sm font-semibold text-gray-800">ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้</span>
                <span className="mt-0.5 block text-xs text-gray-500">เมื่อเปิด ผู้อนุมัติที่ได้รับมอบหมายสามารถอนุมัติใบเบิกที่ตัวเองสร้างได้</span>
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
                <span className="mt-0.5 block text-xs text-gray-500">ผู้ขอกรอกเหตุผลแทนใบเสร็จได้ในบางกรณี</span>
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
              <h3 className="text-sm font-bold text-gray-900">การเงินและ SLA</h3>
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
              <label className="mb-1.5 block text-xs font-semibold text-gray-600">SLA (ชั่วโมง)</label>
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
              <dd className="text-sm font-semibold text-gray-800">≥ {formatMoney(form.approvalRequiredFromAmount)} บาท</dd>
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
              <dt className="text-xs text-gray-500">SLA</dt>
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
