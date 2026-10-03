'use client';

// CRM Inbox (กล่องข้อความ) — Mangmee visual shell wired to real CRM Inbox APIs.

import type React from 'react';
import { ThemedDate } from '@/common/components/field/ThemedDate';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';
import type {
  CrmConversationDetail,
  CrmConversationPriority,
  CrmConversationStatus,
  CrmConversationSummary,
  CrmCustomer360Summary,
  CrmCustomerDetail,
  CrmMessageSummary,
} from '@watchdog-bms/contracts';
import { formatThaiDate, formatThaiDateTime } from '@/common/i18n/thai-date';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { ForbiddenState } from '@/common/components/state';
import { cx } from '@/common/components/mangmee';
import { useToast } from '@/common/components/toast';
import { getCrmCustomer360 } from '@/features/crm/crm.api';
import { lineIdentityText } from '@/features/crm/customers-prototype.model';
import {
  addInternalNote,
  assignConversation,
  createDealFromConversation,
  createQuotationFromConversation,
  createTaskFromConversation,
  flagPaymentProof,
  getConversation,
  listConversations,
  markConversationRead,
  sendReply,
  setConversationAutoReply,
  setConversationPriority,
  setConversationStatus,
  setConversationTags,
} from './crm-inbox.api';
import {
  CONVERSATION_PRIORITY_META,
  CONVERSATION_STATUS_META,
  INBOX_PRIORITY_ORDER,
  INBOX_STATUS_ORDER,
  addConversationTag,
  avatarColor,
  avatarInitial,
  conversationIsOverdue,
  locationMapUrl,
  mediaErrorMessage,
  messageContentUrl,
  relativeTimeTh,
  sendErrorMessage,
  slaCountdown,
  stickerImageUrl,
} from './crm-inbox.logic';
import {
  INBOX_PAGE_SIZE,
  buildStatusChips,
  chipColor,
  chipFromSearch,
  chipListFilter,
  visibleMessages as visibleThreadMessages,
  type InboxChipId,
} from './inbox-prototype.model';
import { InboxAiPanel } from './InboxAiPanel';
import {
  useSalesRootAvailability,
  type SalesRootAvailabilityState,
} from '@/features/accounting-documents/sales-root-availability';

const POLL_MS = 10_000;

function inboxSendApiErrorMessage(error: unknown): string {
  const candidate = error as { code?: unknown; message?: unknown } | null | undefined;
  const diagnostic = typeof candidate?.code === 'string'
    ? candidate.code
    : typeof candidate?.message === 'string'
      ? candidate.message
      : '';
  if (/(text_too_long|channel_disabled|customer_unfollowed|invalid_access_token)/.test(diagnostic)) {
    return sendErrorMessage(diagnostic);
  }
  return apiErrorMessage(error);
}

type SvgProps = React.SVGProps<SVGSVGElement>;
type ComposerMode = 'reply' | 'note';
type SideTab = 'ai' | 'customer';

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

function SearchIcon(props: SvgProps) {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

function SparkIcon(props: SvgProps) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps} {...props}>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z" />
      <path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z" />
    </svg>
  );
}

function SendIcon(props: SvgProps) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps} {...props}>
      <path d="M4 12l16-8-6 16-2.5-6.5Z" />
      <path d="M11.5 13.5 20 4" />
    </svg>
  );
}

function BigChatIcon(props: SvgProps) {
  return (
    <svg width={40} height={40} viewBox="0 0 24 24" aria-hidden="true" {...strokeProps} {...props}>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
      <path d="M8 10h8M8 13h5" />
    </svg>
  );
}

function waitMinutesLabel(lastInboundAt: string | undefined, now: Date): string {
  if (!lastInboundAt) return '—';
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(lastInboundAt).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} นาที`;
  return `${Math.floor(minutes / 60)} ชม.`;
}

function timeLabel(iso: string | undefined): string {
  if (!iso) return '—';
  return formatThaiDateTime(iso);
}

function StatusPill({ status }: { status: CrmConversationStatus }) {
  const meta = CONVERSATION_STATUS_META[status];
  return (
    <span className="whitespace-nowrap" style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

function PriorityPill({ priority }: { priority: CrmConversationPriority }) {
  const meta = CONVERSATION_PRIORITY_META[priority];
  return (
    <span className="whitespace-nowrap" style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: meta.bg, color: meta.color }}>
      ⚑ {meta.label}
    </span>
  );
}

export function InboxPrototypePage({
  companyId,
  userId,
  permissions,
  initialConversationId,
}: {
  companyId: string;
  userId: string;
  permissions: string[];
  initialConversationId?: string;
}) {
  const toast = useToast();
  const canReply = permissions.includes('crm.inbox.reply');
  const canNote = permissions.includes('crm.inbox.note');
  const canAssign = permissions.includes('crm.inbox.assign');
  const canResolve = permissions.includes('crm.inbox.resolve');
  const canSeeCustomer = permissions.includes('crm.customer.read');
  const canCreateDeal = permissions.includes('crm.opportunity.create');
  const canCreateTask = permissions.includes('crm.follow_up.create');
  const canRequestQuotation = canCreateDeal
    && permissions.includes('crm.quotation.link')
    && (permissions.includes('accounting.quotation.create') || permissions.includes('accounting.document.create'));
  const quotationAvailability = useSalesRootAvailability(companyId, canRequestQuotation);
  const canQuote = canRequestQuotation && quotationAvailability.state === 'OPEN';

  const [statusFilter, setStatusFilter] = useState<InboxChipId>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CrmConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Partial<Record<CrmConversationStatus, number>>>({});
  const [overdueCount, setOverdueCount] = useState(0);
  const [unansweredCount, setUnansweredCount] = useState(0);
  const [mineCount, setMineCount] = useState(0);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [selId, setSelId] = useState(initialConversationId ?? '');
  const [detail, setDetail] = useState<CrmConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [customer, setCustomer] = useState<CrmCustomerDetail | null>(null);
  const [summary360, setSummary360] = useState<CrmCustomer360Summary | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [autoReplySaving, setAutoReplySaving] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);
  const quotationRequestRef = useRef<{ conversationId: string; key: string } | null>(null);
  useCloseOnOutsideClick(statusMenuRef, useCallback(() => setStatusMenuOpen(false), []));
  useCloseOnOutsideClick(priorityMenuRef, useCallback(() => setPriorityMenuOpen(false), []));

  const [composeText, setComposeText] = useState('');
  const [composeMode, setComposeMode] = useState<ComposerMode>('reply');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [side, setSide] = useState<SideTab>('ai');
  const [now, setNow] = useState(() => new Date());

  const listAbort = useRef(0);
  const detailAbort = useRef(0);
  const customerAbort = useRef(0);
  const selectedIdRef = useRef(selId);
  const deepLinkDone = useRef(false);
  const isNoteMode = composeMode === 'note';

  useEffect(() => {
    selectedIdRef.current = selId;
  }, [selId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!canReply && canNote) setComposeMode('note');
    if (!canNote && canReply) setComposeMode('reply');
  }, [canReply, canNote]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    setStatusFilter(chipFromSearch(window.location.search));
    const tag = params.get('tag');
    if (tag) setTagFilter(tag);
  }, []);

  const loadList = useCallback(
    async (silent = false) => {
      const token = ++listAbort.current;
      if (!silent) setListLoading(true);
      try {
        const result = await listConversations(companyId, {
          ...chipListFilter(statusFilter),
          tag: tagFilter ?? undefined,
          search: debouncedSearch || undefined,
          page,
          pageSize: INBOX_PAGE_SIZE,
        });
        if (token !== listAbort.current) return;
        setItems(result.items);
        setTotal(result.total);
        setStatusCounts(result.statusCounts ?? {});
        setOverdueCount(result.overdueCount ?? 0);
        setUnansweredCount(result.unansweredCount ?? 0);
        setMineCount(result.mineCount ?? 0);
        setUnassignedCount(result.unassignedCount ?? 0);
        setListError(null);
        setForbidden(false);
      } catch (e) {
        if (token !== listAbort.current) return;
        // `authedApiFetch` throws a plain Error carrying `status`, never an `ApiError` — reading
        // the wrong shape meant this forbidden state never rendered.
        if ((e as { status?: number } | null)?.status === 403) setForbidden(true);
        else setListError('โหลดรายการแชทไม่สำเร็จ กรุณาลองใหม่');
      } finally {
        if (token === listAbort.current) setListLoading(false);
      }
    },
    [companyId, statusFilter, tagFilter, debouncedSearch, page],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(
    async (conversationId: string, silent = false) => {
      const token = ++detailAbort.current;
      if (!silent) setDetailLoading(true);
      try {
        const next = await getConversation(companyId, conversationId);
        if (token !== detailAbort.current || selectedIdRef.current !== conversationId) return;
        setDetail(next);
      } catch {
        if (token !== detailAbort.current || selectedIdRef.current !== conversationId) return;
        if (!silent) setActionError('โหลดบทสนทนาไม่สำเร็จ');
      } finally {
        if (token === detailAbort.current && selectedIdRef.current === conversationId && !silent) setDetailLoading(false);
      }
    },
    [companyId],
  );

  useEffect(() => {
    if (deepLinkDone.current) return;
    const id = initialConversationId || (typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('conversation') ?? '');
    if (!id) return;
    deepLinkDone.current = true;
    selectedIdRef.current = id;
    setSelId(id);
    void loadDetail(id);
    // Assignment is unknown at deep-link time; only broad writers (assign
    // permission ≈ owner/admin/manager) can safely mark-read any conversation.
    if (canAssign) void markConversationRead(companyId, id).catch(() => undefined);
  }, [canAssign, companyId, initialConversationId, loadDetail]);

  useEffect(() => {
    if (!detail?.customerId || !canSeeCustomer) {
      customerAbort.current += 1;
      setCustomer(null);
      setSummary360(null);
      return;
    }
    const token = ++customerAbort.current;
    const conversationId = detail.id;
    getCrmCustomer360(companyId, detail.customerId)
      .then((next: CrmCustomer360Summary) => {
        if (token === customerAbort.current && selectedIdRef.current === conversationId) {
          setSummary360(next);
          setCustomer(next.customer);
        }
      })
      .catch(() => {
        if (token === customerAbort.current && selectedIdRef.current === conversationId) {
          setSummary360(null);
          setCustomer(null);
        }
      });
  }, [companyId, canSeeCustomer, detail?.id, detail?.customerId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      setNow(new Date());
      void loadList(true);
      if (selId) void loadDetail(selId, true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [loadList, loadDetail, selId]);

  const selectConversation = useCallback(
    (conversation: CrmConversationSummary) => {
      selectedIdRef.current = conversation.id;
      setSelId(conversation.id);
      setComposeText('');
      setComposeMode(canReply ? 'reply' : 'note');
      setStatusMenuOpen(false);
      setPriorityMenuOpen(false);
      setActionError(null);
      setSendError(null);
      setCustomer(null);
      setSummary360(null);
      setDetail(null);
      void loadDetail(conversation.id);
      // Mark-read is write-scoped server-side: broad writers (assign permission)
      // or own/unassigned conversations only — read-all roles must not fire it.
      const canMarkRead = canAssign || !conversation.assignedToUserId || conversation.assignedToUserId === userId;
      if (canReply && canMarkRead && conversation.unreadCount > 0) {
        setItems((prev) => prev.map((c) => (c.id === conversation.id ? { ...c, unreadCount: 0 } : c)));
        void markConversationRead(companyId, conversation.id).catch(() => undefined);
      }
    },
    [companyId, canAssign, canReply, loadDetail, userId],
  );

  const applyConversationPatch = useCallback((summary: CrmConversationSummary) => {
    setDetail((prev) => (prev && prev.id === summary.id ? { ...prev, ...summary, messages: prev.messages } : prev));
    setItems((prev) => prev.map((c) => (c.id === summary.id ? { ...c, ...summary } : c)));
  }, []);

  const submitComposer = useCallback(async () => {
    if (!detail || sending) return;
    const text = composeText.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      const result = composeMode === 'note'
        ? await addInternalNote(companyId, detail.id, text)
        : await sendReply(companyId, detail.id, text);
      setDetail((prev) =>
        prev && prev.id === result.conversation.id
          ? { ...prev, ...result.conversation, messages: [...prev.messages, result.message] }
          : prev,
      );
      setItems((prev) => prev.map((c) => (c.id === result.conversation.id ? { ...c, ...result.conversation } : c)));
      setComposeText('');
      if (result.message.deliveryStatus === 'FAILED') setSendError(sendErrorMessage(result.message.deliveryError ?? ''));
    } catch (e) {
      setSendError(inboxSendApiErrorMessage(e));
    } finally {
      setSending(false);
    }
  }, [companyId, composeMode, composeText, detail, sending]);

  const changeStatus = useCallback(
    async (status: CrmConversationStatus) => {
      if (!detail) return;
      setStatusMenuOpen(false);
      setActionError(null);
      try {
        const summary = await setConversationStatus(companyId, detail.id, status);
        applyConversationPatch(summary);
        toast.success('เปลี่ยนสถานะแชทเรียบร้อยแล้ว');
        void loadList(true);
      } catch {
        setActionError('เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่');
      }
    },
    [companyId, detail, applyConversationPatch, loadList, toast],
  );

  const changePriority = useCallback(
    async (priority: CrmConversationPriority) => {
      if (!detail) return;
      setPriorityMenuOpen(false);
      setActionError(null);
      try {
        applyConversationPatch(await setConversationPriority(companyId, detail.id, priority));
        toast.success('เปลี่ยนระดับความสำคัญเรียบร้อยแล้ว');
      } catch {
        setActionError('เปลี่ยนระดับความสำคัญไม่สำเร็จ กรุณาลองใหม่');
      }
    },
    [companyId, detail, applyConversationPatch, toast],
  );

  const changeAutoReply = useCallback(
    async (enabled: boolean) => {
      if (!detail || autoReplySaving) return;
      setAutoReplySaving(true);
      setActionError(null);
      try {
        applyConversationPatch(await setConversationAutoReply(companyId, detail.id, enabled));
        toast.success(enabled ? 'เปิดการตอบแชทด้วย AI เรียบร้อยแล้ว' : 'ปิดการตอบแชทด้วย AI เรียบร้อยแล้ว');
      } catch {
        setActionError('เปลี่ยนการตั้งค่า AI สำหรับแชทนี้ไม่สำเร็จ กรุณาลองใหม่');
      } finally {
        setAutoReplySaving(false);
      }
    },
    [companyId, detail, autoReplySaving, applyConversationPatch, toast],
  );

  const saveTags = useCallback(
    async (tags: string[]) => {
      if (!detail) return;
      applyConversationPatch(await setConversationTags(companyId, detail.id, tags));
      toast.success('บันทึกแท็กบทสนทนาเรียบร้อยแล้ว');
    },
    [companyId, detail, applyConversationPatch, toast],
  );

  const assignToMe = useCallback(async () => {
    if (!detail || assigning) return;
    setActionError(null);
    setAssigning(true);
    try {
      const nextAssignee = detail.assignedToUserId === userId ? null : userId;
      applyConversationPatch(await assignConversation(companyId, detail.id, nextAssignee));
      toast.success(nextAssignee ? 'รับเรื่องเรียบร้อยแล้ว' : 'เลิกดูแลเรียบร้อยแล้ว');
      void loadList(true);
    } catch {
      setActionError('มอบหมายไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setAssigning(false);
    }
  }, [companyId, detail, assigning, userId, applyConversationPatch, loadList, toast]);

  const refreshSummary = useCallback(async () => {
    if (!detail?.customerId || !canSeeCustomer) return;
    const conversationId = detail.id;
    try {
      const next: CrmCustomer360Summary = await getCrmCustomer360(companyId, detail.customerId);
      if (selectedIdRef.current === conversationId) {
        setSummary360(next);
        setCustomer(next.customer);
      }
    } catch {
      /* keep the last good summary on a transient refresh failure */
    }
  }, [companyId, detail, canSeeCustomer]);

  const createDeal = useCallback(
    async (title: string) => {
      if (!detail) return;
      await createDealFromConversation(companyId, detail.id, { title });
      toast.success('สร้างดีลเรียบร้อยแล้ว');
      await refreshSummary();
    },
    [companyId, detail, refreshSummary, toast],
  );

  const createTask = useCallback(
    async (title: string, dueAt: string) => {
      if (!detail) return;
      await createTaskFromConversation(companyId, detail.id, { title, dueAt });
      toast.success('สร้างงานติดตามเรียบร้อยแล้ว');
      await refreshSummary();
    },
    [companyId, detail, refreshSummary, toast],
  );

  const createQuotation = useCallback(async () => {
    if (!detail) return;
    const pending = quotationRequestRef.current?.conversationId === detail.id
      ? quotationRequestRef.current
      : { conversationId: detail.id, key: crypto.randomUUID() };
    quotationRequestRef.current = pending;
    // canonical endpoint resolves-or-creates the opportunity + drafts the quotation and links the conversation.
    await createQuotationFromConversation(companyId, detail.id, {
      title: `ใบเสนอราคา — ${customer?.displayName ?? detail.customerDisplayName ?? 'ลูกค้า'}`,
      idempotencyKey: pending.key,
    });
    quotationRequestRef.current = null;
    toast.success('สร้างใบเสนอราคาเรียบร้อยแล้ว');
    await refreshSummary();
  }, [companyId, detail, customer, refreshSummary, toast]);

  // Staff sends a document summary back to the customer via the existing reply path (no public customer link).
  const insertDocToComposer = useCallback((text: string) => {
    setComposeMode('reply');
    setComposeText(text);
  }, []);

  const chips = useMemo(
    () => buildStatusChips({ total, statusCounts, overdueCount, unansweredCount, mineCount, unassignedCount }),
    [total, statusCounts, overdueCount, unansweredCount, mineCount, unassignedCount],
  );
  const totalPages = Math.max(1, Math.ceil(total / INBOX_PAGE_SIZE));
  const messages = useMemo(() => visibleThreadMessages(detail?.messages ?? [], isNoteMode), [detail, isNoteMode]);

  if (forbidden) return <ForbiddenState />;

  return (
    <div className="mangmee-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-sm font-semibold text-gray-500">
          <span>มั่งมี</span>
          <span className="mx-2 text-gray-300">/</span>
          <span className="text-gray-700">กล่องข้อความ</span>
        </div>
        {/* MVP1-x: branch filter/chips arrive with branch-aware inbox API. */}
      </div>

      <div>
        <div className="mb-3.5 flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible">
          {chips.map((f) => {
            const active = statusFilter === f.id;
            const col = chipColor(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setStatusFilter(f.id);
                  setPage(1);
                }}
                className="flex shrink-0 cursor-pointer items-center whitespace-nowrap"
                style={{
                  gap: 7,
                  padding: '8px 14px',
                  borderRadius: 10,
                  fontSize: 16,
                  fontWeight: 600,
                  background: col.bg,
                  color: col.c,
                  border: `2px solid ${active ? col.c : 'transparent'}`,
                  boxShadow: active ? `0 0 0 3px ${col.bg}` : 'none',
                }}
              >
                {f.label}{' '}
                <span style={{ fontSize: 13, fontWeight: 800, padding: '1px 8px', borderRadius: 12, background: '#fff', color: col.c }}>
                  {f.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex min-h-0 gap-4 md:min-h-[520px]" style={{ height: 'calc(100dvh - 226px)' }}>
          <div className={cx('mangmee-card w-full flex-col overflow-hidden md:flex md:w-[340px] md:shrink-0', detail || detailLoading ? 'hidden' : 'flex')}>
            <div className="border-b border-gray-100" style={{ padding: '16px 16px 12px' }}>
              <div className="flex flex-wrap items-center justify-between">
                <div className="text-lg font-bold text-gray-900">กล่องข้อความ</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#06C755', background: '#E4F9EC', padding: '3px 9px', borderRadius: 20 }}>
                  LINE OA
                </div>
              </div>
              <div className="mt-3 flex h-[38px] items-center gap-2 rounded-[9px] border border-gray-300 bg-white px-3">
                <span className="flex shrink-0 text-gray-400">
                  <SearchIcon />
                </span>
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="ค้นหาชื่อลูกค้า / ข้อความ…"
                  className="flex-1 border-none bg-transparent text-sm text-gray-800 outline-none"
                />
              </div>
              {tagFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setTagFilter(null);
                    setPage(1);
                  }}
                  className="mt-2 rounded-full bg-gray-100 px-3 py-1 text-[12.5px] font-semibold text-gray-700"
                >
                  🏷 {tagFilter} <span className="text-gray-400">×</span>
                </button>
              )}
            </div>
            <div className="mt-2 flex-1 overflow-y-auto">
              {listLoading && items.length === 0 && (
                <div className="text-center text-sm text-gray-400" style={{ padding: '40px 20px' }}>
                  กำลังโหลด...
                </div>
              )}
              {listError && <div className="mx-4 my-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{listError}</div>}
              {!listLoading && !listError && items.length === 0 && (
                <div className="text-center text-sm text-gray-400" style={{ padding: '40px 20px' }}>
                  ไม่พบแชทที่ตรงกับตัวกรอง
                </div>
              )}
              {items.map((c) => {
                const overdue = conversationIsOverdue(c, now);
                const countdown = slaCountdown(c, now);
                const sel = c.id === selId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectConversation(c)}
                    className="flex w-full cursor-pointer border-b border-gray-100 text-left"
                    style={{
                      gap: 12,
                      padding: '13px 14px',
                      borderLeft: `3px solid ${overdue ? '#DC2626' : sel ? 'var(--color-brand-500)' : 'transparent'}`,
                      background: sel ? 'var(--color-brand-25)' : '#fff',
                    }}
                  >
                    <span
                      className="flex shrink-0 items-center justify-center rounded-full text-white"
                      style={{ width: 44, height: 44, fontSize: 15, fontWeight: 700, background: avatarColor(c.customerId) }}
                    >
                      {avatarInitial(c.customerDisplayName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate text-gray-900" style={{ fontSize: 15, fontWeight: c.unreadCount > 0 ? 700 : 600 }}>
                          {c.customerDisplayName ?? 'ลูกค้า LINE'}
                        </span>
                        <span className="shrink-0 text-gray-400" style={{ fontSize: 11.5 }}>
                          {relativeTimeTh(c.lastMessageAt, now)}
                        </span>
                      </span>
                      <span className={cx('mt-0.5 block truncate', c.unreadCount > 0 ? 'text-gray-700' : 'text-gray-400')} style={{ fontSize: 13.5 }}>
                        {c.lastMessagePreview ?? '—'}
                      </span>
                      <span className="mt-[7px] flex flex-wrap items-center gap-1.5">
                        <StatusPill status={c.status} />
                        {c.priority !== 'NORMAL' && <PriorityPill priority={c.priority} />}
                        {countdown && (
                          <span className="whitespace-nowrap" style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: countdown.state === 'overdue' ? '#FEE2E2' : '#FEF3C7', color: countdown.state === 'overdue' ? '#DC2626' : '#D97706' }}>
                            ⏱ {countdown.label}
                          </span>
                        )}
                        {!!c.unreadCount && (
                          <span className="ml-auto flex items-center justify-center rounded-[20px] bg-brand-500 text-white" style={{ minWidth: 20, height: 20, padding: '0 6px', fontSize: 11.5, fontWeight: 700 }}>
                            {c.unreadCount}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block truncate whitespace-nowrap text-gray-400" style={{ fontSize: 11.5 }}>
                        {c.assignedToDisplayName ? `• ${c.assignedToDisplayName}` : '• ยังไม่ assign'}
                      </span>
                      {c.tags.length > 0 && (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {c.tags.slice(0, 3).map((t) => (
                            <span
                              key={t}
                              onClick={(e) => {
                                e.stopPropagation();
                                setTagFilter(t);
                                setPage(1);
                              }}
                              className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600"
                            >
                              🏷 {t}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {total > INBOX_PAGE_SIZE && (
              <div className="flex items-center gap-1.5 border-t border-gray-100" style={{ padding: '10px 12px' }}>
                <button
                  type="button"
                  aria-label="หน้าก่อนหน้า"
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-white text-[15px] text-gray-600 disabled:bg-gray-50 disabled:text-gray-300"
                >
                  ‹
                </button>
                <div className="flex flex-1 justify-center gap-[5px] overflow-x-auto">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPage(n)}
                      className={cx(
                        'flex h-[30px] min-w-[30px] cursor-pointer items-center justify-center rounded-lg px-[7px] text-[13px] font-semibold',
                        n === page ? 'bg-brand-500 text-white' : 'border border-gray-200 bg-white text-gray-600',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  aria-label="หน้าถัดไป"
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="flex h-[30px] w-[30px] cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-white text-[15px] text-gray-600 disabled:bg-gray-50 disabled:text-gray-300"
                >
                  ›
                </button>
              </div>
            )}
          </div>

          {detail || detailLoading ? (
            <>
              <div className="mangmee-card mangmee-card-muted flex min-w-0 flex-1 flex-col overflow-hidden">
                {detailLoading && <div className="flex flex-1 items-center justify-center text-sm text-gray-400">กำลังโหลดบทสนทนา...</div>}
                {detail && (
                  <>
                    <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-white" style={{ padding: '14px 18px' }}>
                      <button
                        type="button"
                        aria-label="กลับไปที่รายการแชท"
                        onClick={() => {
                          selectedIdRef.current = '';
                          setDetail(null);
                          setSelId('');
                          setCustomer(null);
                          setStatusMenuOpen(false);
                          setPriorityMenuOpen(false);
                        }}
                        className="flex shrink-0 cursor-pointer items-center justify-center rounded-lg bg-gray-100 text-gray-600 md:hidden"
                        style={{ width: 34, height: 34, fontSize: 20 }}
                      >
                        ‹
                      </button>
                      <div
                        className="flex shrink-0 items-center justify-center rounded-full text-white"
                        style={{ width: 40, height: 40, fontSize: 15, fontWeight: 700, background: avatarColor(detail.customerId) }}
                      >
                        {avatarInitial(detail.customerDisplayName)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-gray-900" style={{ fontSize: 16, fontWeight: 700 }}>{detail.customerDisplayName ?? 'ลูกค้า LINE'}</div>
                        <div className="truncate text-gray-400" style={{ fontSize: 12.5 }}>
                          LINE OA · {detail.assignedToDisplayName ? `ดูแลโดย ${detail.assignedToDisplayName}` : 'ยังไม่มีผู้ดูแล'}
                        </div>
                      </div>
                      {(canReply || !detail.autoReplyEnabled) && (
                        <div className="order-last flex w-full shrink-0 items-center justify-end gap-2 sm:order-none sm:w-auto sm:flex-col sm:items-end sm:gap-1">
                          {canReply && (
                            <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-700">
                              <input
                                type="checkbox"
                                aria-label="AI ตอบแชทนี้"
                                checked={detail.autoReplyEnabled}
                                disabled={autoReplySaving}
                                onChange={(event) => void changeAutoReply(event.target.checked)}
                              />
                              {autoReplySaving ? 'กำลังบันทึก...' : 'AI ตอบแชทนี้'}
                            </label>
                          )}
                          {!detail.autoReplyEnabled && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                              AI ปิดอยู่ (แชทนี้) — พนักงานตอบเอง
                            </span>
                          )}
                        </div>
                      )}
                      {(canAssign || (canReply && (!detail.assignedToUserId || detail.assignedToUserId === userId))) && (
                        <button
                          type="button"
                          onClick={() => void assignToMe()}
                          disabled={assigning} aria-busy={Boolean(assigning)}
                          className="hidden shrink-0 cursor-pointer rounded-[9px] border px-3 py-1.5 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:block"
                          style={detail.assignedToUserId === userId ? { borderColor: '#D0D5DD', color: '#667085' } : { borderColor: '#ABEFC6', background: '#ECFDF3', color: '#039855' }}
                        >
                          {assigning
                            ? detail.assignedToUserId === userId ? 'กำลังเลิกดูแล...' : 'กำลังรับเรื่อง...'
                            : detail.assignedToUserId === userId ? 'เลิกดูแล' : 'รับเรื่อง'}
                        </button>
                      )}
                      <div className="relative" ref={priorityMenuRef}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!canResolve) return;
                            setStatusMenuOpen(false);
                            setPriorityMenuOpen((v) => !v);
                          }}
                          className="cursor-pointer"
                          style={{ ...statusPillStyle(CONVERSATION_PRIORITY_META[detail.priority]), fontSize: 12 }}
                        >
                          ⚑ {CONVERSATION_PRIORITY_META[detail.priority].label}{canResolve ? ' ▾' : ''}
                        </button>
                        {priorityMenuOpen && (
                          <Menu>
                            <div className="font-bold text-gray-400" style={{ fontSize: 11, letterSpacing: '.04em', padding: '6px 10px 4px' }}>
                              ระดับความสำคัญ
                            </div>
                            {INBOX_PRIORITY_ORDER.map((priority) => (
                              <MenuButton key={priority} active={detail.priority === priority} color={CONVERSATION_PRIORITY_META[priority].color} onClick={() => void changePriority(priority)}>
                                {CONVERSATION_PRIORITY_META[priority].label}
                              </MenuButton>
                            ))}
                          </Menu>
                        )}
                      </div>
                      <div className="relative" ref={statusMenuRef}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!canResolve) return;
                            setPriorityMenuOpen(false);
                            setStatusMenuOpen((v) => !v);
                          }}
                          className="cursor-pointer"
                          style={statusPillStyle(CONVERSATION_STATUS_META[detail.status])}
                        >
                          {CONVERSATION_STATUS_META[detail.status].label}{canResolve ? ' ▾' : ''}
                        </button>
                        {statusMenuOpen && (
                          <Menu>
                            <div className="font-bold text-gray-400" style={{ fontSize: 11, letterSpacing: '.04em', padding: '6px 10px 4px' }}>
                              เปลี่ยนสถานะแชท
                            </div>
                            {INBOX_STATUS_ORDER.map((st) => (
                              <MenuButton key={st} active={detail.status === st} color={CONVERSATION_STATUS_META[st].color} onClick={() => void changeStatus(st)}>
                                {CONVERSATION_STATUS_META[st].label}
                              </MenuButton>
                            ))}
                          </Menu>
                        )}
                      </div>
                    </div>

                    {actionError && <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}

                    <div className="flex-1 overflow-y-auto" style={{ padding: '16px 20px' }}>
                      {messages.length === 0 && (
                        <div className="py-10 text-center text-sm text-gray-400">
                          {isNoteMode ? 'ยังไม่มีข้อความหรือโน้ตในบทสนทนานี้' : 'ยังไม่มีข้อความในบทสนทนานี้'}
                        </div>
                      )}
                      {messages.map((message) => (
                        <MessageBubble key={message.id} companyId={companyId} message={message} canFlagProof={canReply} />
                      ))}
                    </div>

                    <div className="border-t border-gray-100 bg-white" style={{ padding: '12px 16px' }}>
                      {canReply || canNote ? (
                        <>
                          <div className="mb-2.5 flex gap-1 rounded-[9px] bg-gray-100 p-1">
                            {canReply && (
                              <button
                                type="button"
                                onClick={() => setComposeMode('reply')}
                                className={cx('flex-1 cursor-pointer rounded-lg p-2 text-center text-sm font-semibold', !isNoteMode ? 'bg-brand-500 text-white' : 'bg-transparent text-gray-500')}
                              >
                                💬 ส่งหาลูกค้า
                              </button>
                            )}
                            {canNote && (
                              <button
                                type="button"
                                onClick={() => setComposeMode('note')}
                                className={cx('flex-1 cursor-pointer rounded-lg p-2 text-center text-sm font-semibold', isNoteMode ? 'text-white' : 'bg-transparent text-gray-500')}
                                style={isNoteMode ? { background: '#F59E0B' } : undefined}
                              >
                                🔒 โน้ตภายใน
                              </button>
                            )}
                          </div>
                          {sendError && <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sendError}</div>}
                          <div
                            style={{
                              border: `1px solid ${isNoteMode ? '#FDE68A' : 'var(--color-gray-300)'}`,
                              borderRadius: 12,
                              background: isNoteMode ? '#FEFCE8' : '#fff',
                              padding: '10px 12px',
                            }}
                          >
                            <textarea
                              value={composeText}
                              onChange={(e) => setComposeText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                  e.preventDefault();
                                  void submitComposer();
                                }
                              }}
                              placeholder={isNoteMode ? 'เขียนโน้ตภายใน — ลูกค้าจะไม่เห็นข้อความนี้' : 'พิมข้อความถึงลูกค้า…'}
                              rows={2}
                              className="w-full resize-none border-none bg-transparent text-gray-800 outline-none"
                              style={{ fontSize: 15, lineHeight: 1.5, fontFamily: 'inherit' }}
                            />
                            <div className="mt-2 flex flex-wrap items-center justify-between">
                              {!isNoteMode ? (
                                <>
                                  {/* MVP1-x: AI reply draft insertion arrives with Phase 3 AI Assist. */}
                                  <div className="inline-flex items-center gap-1.5 text-gray-400" style={{ fontSize: 13, fontWeight: 600 }}>
                                    <SparkIcon /> AI Assist กำลังจะมา
                                  </div>
                                </>
                              ) : (
                                <div style={{ fontSize: 12.5, color: '#B45309' }}>🔒 โน้ตภายใน — ลูกค้าจะไม่เห็น</div>
                              )}
                              <button
                                type="button"
                                aria-label={isNoteMode ? 'บันทึกโน้ต' : 'ส่งข้อความ'}
                                onClick={() => void submitComposer()}
                                disabled={sending || composeText.trim() === ''} aria-busy={Boolean(sending)}
                                className="flex shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-white disabled:opacity-50"
                                style={{ width: 44, height: 40, background: isNoteMode ? '#F59E0B' : 'var(--color-brand-500)' }}
                              >
                                <SendIcon />
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-center text-sm text-gray-400">
                          บัญชีของคุณอ่านได้อย่างเดียว — ไม่มีสิทธิ์ส่งข้อความในกล่องนี้
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {detail && (
                <div className="mangmee-card hidden w-[360px] shrink-0 flex-col overflow-hidden lg:flex">
                  <div className="flex gap-1 rounded-[9px] bg-gray-100 p-1" style={{ margin: '12px 12px 0' }}>
                    <button
                      type="button"
                      onClick={() => setSide('ai')}
                      className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-center text-sm font-semibold"
                      style={{ padding: 9, ...(side === 'ai' ? { background: '#fff', color: '#7A5AF8', boxShadow: 'var(--shadow-theme-sm)' } : { color: 'var(--color-gray-500)' }) }}
                    >
                      <SparkIcon /> AI ช่วย
                    </button>
                    <button
                      type="button"
                      onClick={() => setSide('customer')}
                      className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg text-center text-sm font-semibold"
                      style={{ padding: 9, ...(side === 'customer' ? { background: '#fff', color: 'var(--color-brand-600)', boxShadow: 'var(--shadow-theme-sm)' } : { color: 'var(--color-gray-500)' }) }}
                    >
                      👤 ข้อมูลลูกค้า
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-4">
                    {side === 'ai' ? (
                      permissions.includes('crm.ai.assist') ? (
                        <InboxAiPanel
                          companyId={companyId}
                          conversationId={detail.id}
                          permissions={permissions}
                          setComposeText={setComposeText}
                        />
                      ) : (
                        <AiPlaceholder />
                      )
                    ) : (
                      <CustomerPanel
                        companyId={companyId}
                        detail={detail}
                        customer={customer}
                        summary360={summary360}
                        canSeeCustomer={canSeeCustomer}
                        canResolve={canResolve}
                        canCreateDeal={canCreateDeal}
                        canCreateTask={canCreateTask}
                        canRequestQuotation={canRequestQuotation}
                        canQuote={canQuote}
                        quotationAvailability={quotationAvailability}
                        onSaveTags={saveTags}
                        onCreateDeal={createDeal}
                        onCreateTask={createTask}
                        onCreateQuotation={createQuotation}
                        canSendDoc={canReply}
                        onInsertDoc={insertDocToComposer}
                        now={now}
                      />
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="mangmee-card mangmee-card-muted hidden flex-1 flex-col items-center justify-center p-10 text-center md:flex">
              <div className="flex items-center justify-center rounded-full" style={{ width: 88, height: 88, background: '#E4F9EC', color: '#06C755' }}>
                <BigChatIcon />
              </div>
              <div className="text-gray-800" style={{ fontSize: 20, fontWeight: 700, marginTop: 20 }}>เลือกกล่องข้อความเพื่อเริ่มแชท</div>
              <div className="text-gray-500" style={{ fontSize: 15, marginTop: 6, maxWidth: 340, lineHeight: 1.6 }}>
                เลือกรายชื่อจากด้านซ้ายเพื่อดูบทสนทนา ข้อมูลลูกค้า 360° และคำแนะนำจาก AI
              </div>
              {overdueCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('overdue');
                    setPage(1);
                  }}
                  className="inline-flex cursor-pointer items-center gap-2 text-white"
                  style={{ marginTop: 20, fontSize: 14, fontWeight: 600, background: '#DC2626', padding: '10px 18px', borderRadius: 10 }}
                >
                  ⏱ ดู {overdueCount} แชทด่วนที่รอตอบเกินกำหนด
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function statusPillStyle(meta: { color: string; bg: string }): React.CSSProperties {
  return { fontSize: 12, fontWeight: 700, padding: '3px 11px', borderRadius: 20, background: meta.bg, color: meta.color };
}

function Menu({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute right-0 z-30 overflow-hidden rounded-xl border border-gray-200 bg-white" style={{ top: 30, width: 190, padding: 6, boxShadow: 'var(--shadow-theme-md)' }}>
      {children}
    </div>
  );
}

function MenuButton({ children, active, color, onClick }: { children: React.ReactNode; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center text-left"
      style={{ gap: 9, padding: '9px 13px', fontSize: 14, fontWeight: 600, color, background: active ? '#F9FAFB' : '#fff' }}
    >
      <span className="shrink-0 rounded-full" style={{ width: 9, height: 9, background: color }} />
      <span className="flex-1">{children}</span>
      <span style={{ fontWeight: 800 }}>{active ? '✓' : ''}</span>
    </button>
  );
}

function MediaContent({ companyId, message }: { companyId: string; message: CrmMessageSummary }) {
  const meta = message.contentMeta;

  if (message.messageType === 'STICKER') {
    if (meta?.stickerId) {
      // eslint-disable-next-line @next/next/no-img-element -- LINE CDN, size unknown
      return <img src={stickerImageUrl(meta.stickerId)} alt="สติกเกอร์" className="h-28 w-28 object-contain" />;
    }
    return <span className="text-gray-500">[สติกเกอร์]</span>;
  }

  if (message.messageType === 'LOCATION') {
    if (meta?.latitude !== undefined && meta?.longitude !== undefined) {
      return (
        <a href={locationMapUrl(meta.latitude, meta.longitude)} target="_blank" rel="noreferrer" className="underline">
          📍 {meta.address ?? 'เปิดตำแหน่งในแผนที่'}
        </a>
      );
    }
    return <span>📍 {meta?.address ?? 'ตำแหน่งที่ตั้ง'}</span>;
  }

  if (message.attachmentId) {
    const url = messageContentUrl(companyId, message.conversationId, message.id);
    if (message.messageType === 'IMAGE') {
      return (
        <a href={url} target="_blank" rel="noreferrer" title="เปิดรูปเต็ม">
          {/* eslint-disable-next-line @next/next/no-img-element -- streamed from our API */}
          <img src={url} alt={meta?.fileName ?? 'รูปจากลูกค้า'} className="max-h-64 max-w-full rounded-lg" />
        </a>
      );
    }
    return (
      <a href={url} className="inline-flex items-center gap-1.5 underline">
        📎 {meta?.fileName ?? 'ดาวน์โหลดไฟล์แนบ'}
      </a>
    );
  }

  if (meta?.mediaError) return <span className="text-gray-500">⚠ {mediaErrorMessage(meta.mediaError)}</span>;
  return <span className="text-gray-500">{message.contentText ?? `[${message.messageType}]`}</span>;
}

function MessageBubble({ companyId, message, canFlagProof }: { companyId: string; message: CrmMessageSummary; canFlagProof: boolean }) {
  const isNote = message.visibility === 'INTERNAL_NOTE';
  const isOut = message.direction === 'OUTBOUND';
  const failed = message.deliveryStatus === 'FAILED';
  const pending = message.deliveryStatus === 'PENDING';
  const isMedia = message.messageType !== 'TEXT';
  const canMarkProof = canFlagProof && !isOut && (message.messageType === 'IMAGE' || message.messageType === 'FILE');
  const [proofBusy, setProofBusy] = useState(false);
  const [proofDone, setProofDone] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);

  const markProof = async () => {
    setProofBusy(true);
    setProofError(null);
    try {
      await flagPaymentProof(companyId, message.conversationId, message.id);
      setProofDone(true);
    } catch {
      setProofError('ทำเครื่องหมายไม่สำเร็จ');
    } finally {
      setProofBusy(false);
    }
  };

  if (isNote) {
    return (
      <div className="flex justify-center" style={{ margin: '10px 0' }}>
        <div style={{ maxWidth: '80%', background: '#FEF9C3', border: '1px solid #FDE68A', borderRadius: 12, padding: '9px 13px', fontSize: 14, color: '#854D0E' }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: '#B45309', marginBottom: 3, letterSpacing: '.03em' }}>
            🔒 โน้ตภายใน · ลูกค้าไม่เห็น
          </div>
          <div className="whitespace-pre-wrap">{message.contentText}</div>
          <div className="mt-1 text-[11px]" style={{ color: '#B45309' }}>{timeLabel(message.sentAt ?? message.createdAt)}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex" style={{ justifyContent: isOut ? 'flex-end' : 'flex-start', margin: '8px 0' }}>
      <div className="min-w-0" style={{ maxWidth: '72%' }}>
        <div
          className="whitespace-pre-wrap"
          style={{
            borderRadius: 14,
            padding: '10px 14px',
            fontSize: 15,
            lineHeight: 1.5,
            ...(isOut
              ? { background: failed ? '#FCA5A5' : 'var(--color-brand-500)', color: '#fff', borderBottomRightRadius: 4 }
              : { background: '#fff', border: '1px solid var(--color-gray-200)', color: 'var(--color-gray-800)', borderBottomLeftRadius: 4 }),
          }}
        >
          {isMedia ? <MediaContent companyId={companyId} message={message} /> : (message.contentText ?? '')}
        </div>
        <div className="text-gray-400" style={{ fontSize: 11, marginTop: 4, textAlign: isOut ? 'right' : undefined }} title={failed ? sendErrorMessage(message.deliveryError ?? '') : undefined}>
          {failed ? <span className="font-semibold text-red-600">ส่งไม่สำเร็จ · </span> : null}
          {pending ? <span>กำลังส่ง · </span> : null}
          {isOut && message.deliveryStatus === 'SENT' ? <span>ส่งแล้ว · </span> : null}
          {(message.messageType === 'IMAGE' || message.messageType === 'FILE') ? 'ไฟล์แนบ · ' : ''}
          {timeLabel(message.sentAt ?? message.createdAt)}
        </div>
        {canMarkProof &&
          (proofDone ? (
            <div className="mt-1 text-[11px] font-semibold text-green-600">✓ ทำเครื่องหมายเป็นหลักฐานการชำระแล้ว</div>
          ) : (
            <button type="button" onClick={() => void markProof()} disabled={proofBusy} aria-busy={Boolean(proofBusy)} className="mt-1 rounded-md border border-gray-200 px-2 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
              ทำเครื่องหมายหลักฐานการชำระ
            </button>
          ))}
        {proofError && <div className="mt-1 text-[11px] text-red-600">{proofError}</div>}
      </div>
    </div>
  );
}

function AiPlaceholder() {
  return (
    <div style={{ background: 'linear-gradient(160deg,#F4F3FF,#FCF4FF)', border: '1px solid #E9D7FE', borderRadius: 14, padding: '14px 15px' }}>
      <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: '#6941C6' }}>
        <SparkIcon /> AI Assist กำลังจะมา
      </div>
      <div className="mt-2 text-sm leading-relaxed text-gray-600">
        สรุปแชท ร่างคำตอบ และ insight จะเปิดใช้งานในเฟส AI Assist ถัดไป
      </div>
      {/* MVP1-x: AI auto-booking arrives with B10 after backend support exists. */}
    </div>
  );
}

function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 font-bold uppercase text-gray-400" style={{ fontSize: 11, letterSpacing: '.04em' }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function RedactNote() {
  return <div className="text-[12.5px] text-gray-400">🔒 ไม่มีสิทธิ์ดูส่วนนี้</div>;
}

function CustomerPanel({
  companyId,
  detail,
  customer,
  summary360,
  canSeeCustomer,
  canResolve,
  canCreateDeal,
  canCreateTask,
  canRequestQuotation,
  canQuote,
  quotationAvailability,
  onSaveTags,
  onCreateDeal,
  onCreateTask,
  onCreateQuotation,
  canSendDoc,
  onInsertDoc,
  now,
}: {
  companyId: string;
  detail: CrmConversationDetail;
  customer: CrmCustomerDetail | null;
  summary360: CrmCustomer360Summary | null;
  canSeeCustomer: boolean;
  canResolve: boolean;
  canCreateDeal: boolean;
  canCreateTask: boolean;
  canRequestQuotation: boolean;
  canQuote: boolean;
  quotationAvailability: { state: SalesRootAvailabilityState; retry: () => void };
  onSaveTags: (tags: string[]) => Promise<void>;
  onCreateDeal: (title: string) => Promise<void>;
  onCreateTask: (title: string, dueAt: string) => Promise<void>;
  onCreateQuotation: () => Promise<void>;
  canSendDoc: boolean;
  onInsertDoc: (text: string) => void;
  now: Date;
}) {
  const [tagInput, setTagInput] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);
  const [dealTitle, setDealTitle] = useState('');
  const [dealBusy, setDealBusy] = useState(false);
  const [dealError, setDealError] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const countdown = slaCountdown(detail, now);

  const submitTags = async (tags: string[]) => {
    setTagBusy(true);
    setTagError(null);
    try {
      await onSaveTags(tags);
    } catch {
      setTagError('บันทึกแท็กไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setTagBusy(false);
    }
  };

  const addTag = () => {
    const next = addConversationTag(detail.tags, tagInput);
    setTagInput('');
    if (next) void submitTags(next);
  };

  const submitDeal = async () => {
    const title = dealTitle.trim();
    if (!title) return;
    setDealBusy(true);
    setDealError(null);
    try {
      await onCreateDeal(title);
      setDealTitle('');
    } catch {
      setDealError('สร้างดีลไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setDealBusy(false);
    }
  };

  const submitTask = async () => {
    const title = taskTitle.trim();
    if (!title || !taskDue) return;
    setTaskBusy(true);
    setTaskError(null);
    try {
      await onCreateTask(title, new Date(`${taskDue}T09:00:00+07:00`).toISOString());
      setTaskTitle('');
      setTaskDue('');
    } catch {
      setTaskError('สร้างงานติดตามไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setTaskBusy(false);
    }
  };

  const submitQuote = async () => {
    setQuoteBusy(true);
    setQuoteError(null);
    try {
      await onCreateQuotation();
    } catch (error) {
      setQuoteError(apiErrorMessage(error));
    } finally {
      setQuoteBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center justify-center rounded-full text-white" style={{ width: 40, height: 40, fontSize: 15, fontWeight: 700, background: avatarColor(detail.customerId) }}>
          {avatarInitial(detail.customerDisplayName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-gray-900" style={{ fontSize: 16, fontWeight: 700 }}>{customer?.displayName ?? detail.customerDisplayName ?? 'ลูกค้า LINE'}</div>
          <div className="truncate text-gray-400" style={{ fontSize: 12.5 }}>
            {lineIdentityText(customer?.lineIdentities ?? [], 'ลูกค้าจาก LINE OA')}
          </div>
        </div>
        <StatusPill status={detail.status} />
      </div>

      <div className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-[10px] bg-gray-50 p-2.5">
          <div className="text-gray-400" style={{ fontSize: 11 }}>รอลูกค้า</div>
          <div className="text-gray-800" style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>{waitMinutesLabel(detail.lastInboundAt, now)}</div>
        </div>
        <div className="rounded-[10px] bg-gray-50 p-2.5">
          <div className="text-gray-400" style={{ fontSize: 11 }}>กำหนดตอบ</div>
          <div className="text-gray-800" style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>{detail.slaBreachedAt ? 'เกินกำหนด' : countdown?.label ?? '—'}</div>
        </div>
        <div className="rounded-[10px] bg-gray-50 p-2.5">
          <div className="text-gray-400" style={{ fontSize: 11 }}>เปิดใหม่</div>
          <div className="text-gray-800" style={{ fontSize: 14, fontWeight: 700, marginTop: 3 }}>{detail.reopenedCount} ครั้ง</div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 text-gray-600" style={{ fontSize: 13.5 }}>
        <span className="text-gray-400">โทร</span> {customer?.primaryPhone ?? '—'}
      </div>
      <div className="mt-1 flex items-center gap-2 text-gray-600" style={{ fontSize: 13.5 }}>
        <span className="text-gray-400">ความยินยอม</span> {customer?.consentStatus ?? '—'}
      </div>
      {customer?.primaryEmail && (
        <div className="mt-1 flex items-center gap-2 text-gray-600" style={{ fontSize: 13.5 }}>
          <span className="text-gray-400">อีเมล</span> {customer.primaryEmail}
        </div>
      )}
      {customer?.source && (
        <div className="mt-1 flex items-center gap-2 text-gray-600" style={{ fontSize: 13.5 }}>
          <span className="text-gray-400">ที่มา</span> {customer.source}
        </div>
      )}
      {customer?.notes && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-600">{customer.notes}</div>
      )}

      <div className="mt-4">
        <div className="mb-2 font-bold uppercase text-gray-400" style={{ fontSize: 11, letterSpacing: '.04em' }}>แท็กบทสนทนา</div>
        <div className="flex flex-wrap gap-1.5">
          {detail.tags.map((t) => (
            <span key={t} className="bg-brand-50 text-brand-700" style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 10px', borderRadius: 20 }}>
              {t}
              {canResolve && (
                <button type="button" onClick={() => void submitTags(detail.tags.filter((x) => x !== t))} disabled={tagBusy} aria-busy={Boolean(tagBusy)} className="ml-1 text-gray-400 hover:text-red-500">
                  ×
                </button>
              )}
            </span>
          ))}
          {detail.tags.length === 0 && <span className="text-[12.5px] text-gray-400">ยังไม่มีแท็ก</span>}
        </div>
        {canResolve && (
          <div className="mt-2 flex gap-1.5">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTag();
                }
              }}
              placeholder="เพิ่มแท็ก"
              maxLength={40}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-400"
            />
            <button type="button" onClick={addTag} disabled={tagBusy || tagInput.trim() === ''} aria-busy={Boolean(tagBusy)} className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
              เพิ่ม
            </button>
          </div>
        )}
        {tagError && <div className="mt-1.5 text-[12px] text-red-600">{tagError}</div>}
      </div>

      {summary360 && (
        <>
          <Sec title="ดีล">
            {summary360.deals === null ? (
              <RedactNote />
            ) : (
              <>
                <div className="text-[13px] text-gray-600">เปิดอยู่ {summary360.deals.openCount} · มูลค่ารวม {summary360.deals.openAmountTotal}</div>
                {summary360.deals.latest && <div className="mt-1 truncate text-[12.5px] text-gray-500">ล่าสุด: {summary360.deals.latest.title}</div>}
                {canCreateDeal && (
                  <div className="mt-2 flex gap-1.5">
                    <input
                      value={dealTitle}
                      onChange={(e) => setDealTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void submitDeal();
                        }
                      }}
                      placeholder="ชื่อดีลใหม่"
                      maxLength={120}
                      className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-400"
                    />
                    <button type="button" onClick={() => void submitDeal()} disabled={dealBusy || dealTitle.trim() === ''} aria-busy={Boolean(dealBusy)} className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
                      สร้าง
                    </button>
                  </div>
                )}
                {dealError && <div className="mt-1.5 text-[12px] text-red-600">{dealError}</div>}
              </>
            )}
          </Sec>

          <Sec title="งานติดตาม">
            {summary360.tasks === null ? (
              <RedactNote />
            ) : (
              <>
                <div className="text-[13px] text-gray-600">ค้างอยู่ {summary360.tasks.openCount}</div>
                {summary360.tasks.next && (
                  <div className="mt-1 truncate text-[12.5px] text-gray-500">ถัดไป: {summary360.tasks.next.title} · {formatThaiDate(summary360.tasks.next.dueAt)}</div>
                )}
                {canCreateTask && (
                  <div className="mt-2 space-y-1.5">
                    <input
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      placeholder="งานติดตามใหม่"
                      maxLength={120}
                      className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-400"
                    />
                    <div className="flex gap-1.5">
                      <ThemedDate value={taskDue} onChange={(e) => setTaskDue(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-400" />
                      <button type="button" onClick={() => void submitTask()} disabled={taskBusy || taskTitle.trim() === '' || !taskDue} aria-busy={Boolean(taskBusy)} className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50">
                        สร้าง
                      </button>
                    </div>
                  </div>
                )}
                {taskError && <div className="mt-1.5 text-[12px] text-red-600">{taskError}</div>}
              </>
            )}
          </Sec>

          <Sec title="ใบเสนอราคา">
            {canRequestQuotation && quotationAvailability.state !== 'OPEN' && (
              <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 p-3" role={quotationAvailability.state === 'LOADING' ? 'status' : 'alert'}>
                <div className="text-base font-semibold text-amber-950">
                  {quotationAvailability.state === 'LOADING' ? 'กำลังตรวจสอบว่าสร้างใบเสนอราคาได้หรือไม่...'
                    : quotationAvailability.state === 'CLOSED' ? 'ยังสร้างใบเสนอราคาใหม่ไม่ได้ชั่วคราว'
                      : 'ยังตรวจสอบความพร้อมของระบบไม่ได้'}
                </div>
                <div className="mt-1 text-base text-amber-900">แชท ดีล และใบเสนอราคาเดิมยังใช้งานได้ตามปกติ</div>
                {quotationAvailability.state === 'ERROR' && (
                  <button type="button" onClick={quotationAvailability.retry} className="mt-2 min-h-11 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-900">
                    ลองตรวจสอบอีกครั้ง
                  </button>
                )}
              </div>
            )}
            {summary360.quotations === null ? (
              <RedactNote />
            ) : summary360.quotations.length === 0 ? (
              <div className="text-[12.5px] text-gray-400">ยังไม่มีใบเสนอราคา</div>
            ) : (
              <div className="space-y-1">
                {summary360.quotations.slice(0, 3).map((q) => (
                  <div key={q.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-[12.5px] text-gray-600">
                      {q.accountingDocumentType}
                      {q.accountingDocumentNumber ? ` #${q.accountingDocumentNumber}` : ''} · {q.status}
                    </div>
                    {canSendDoc && (
                      <button
                        type="button"
                        onClick={() =>
                          onInsertDoc(
                            `เรียนลูกค้า ขอนำส่งใบเสนอราคา${q.accountingDocumentNumber ? ` เลขที่ ${q.accountingDocumentNumber}` : ''}${q.grandTotalAmount ? ` ยอดรวม ${q.grandTotalAmount} ${q.currency}` : ''} ครับ/ค่ะ`,
                          )
                        }
                        className="shrink-0 rounded-md border border-brand-200 px-2 py-1 text-[11px] font-semibold text-brand-600 hover:bg-brand-50"
                      >
                        ส่งให้ลูกค้า
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canQuote && (
              <button type="button" onClick={() => void submitQuote()} disabled={quoteBusy} aria-busy={Boolean(quoteBusy)} className="mt-2 w-full rounded-lg border border-brand-200 bg-brand-25 px-3 py-1.5 text-[12.5px] font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50">
                + สร้างใบเสนอราคา
              </button>
            )}
            {quoteError && <div className="mt-1.5 text-[12px] text-red-600">{quoteError}</div>}
          </Sec>

          <Sec title="การเงิน">
            {summary360.finance === null ? (
              <RedactNote />
            ) : summary360.finance.documents.length === 0 ? (
              <div className="text-[12.5px] text-gray-400">ยังไม่มีเอกสารการเงิน</div>
            ) : (
              <div className="space-y-1">
                {summary360.finance.documents.slice(0, 3).map((d) => (
                  <div key={d.id} className="truncate text-[12.5px] text-gray-600">
                    {d.documentType}
                    {d.documentNumber ? ` #${d.documentNumber}` : ''} · {d.status} · ค้าง {d.outstandingAmount} {d.currency}
                  </div>
                ))}
              </div>
            )}
          </Sec>
        </>
      )}

      {!canSeeCustomer && (
        <div className="mt-3 rounded-[10px] border border-dashed border-gray-200 px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-400">
          🔒 บัญชีของคุณไม่มีสิทธิ์ดูโปรไฟล์ลูกค้า (crm.customer.read)
        </div>
      )}

      {canSeeCustomer && (
        <Link
          href={`/companies/${companyId}/crm/customers/${detail.customerId}`}
          className="mt-4 block rounded-[9px] border border-brand-200 bg-brand-25 px-3 py-2 text-center text-[13px] font-semibold text-brand-600 hover:bg-brand-50"
        >
          ดูโปรไฟล์เต็ม ›
        </Link>
      )}

      {/* MVP1-x: purchases, LTV, course, appointment cards, and slip verification arrive with real Customer 360/payment-proof APIs. */}
    </>
  );
}
