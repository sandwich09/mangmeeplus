'use client';

// มั่งมี Flow A — กล่องข้อความ (CRM Inbox, item 15A Phase 2 web slice).
// 3 คอลัมน์: รายการแชท · หน้าต่างแชท · ข้อมูลลูกค้า/AI ตาม design handoff
// (design_handoff_mangmee/มั่งมี Flow A.dc.html); AI panel เป็น placeholder จนถึง Phase 4.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CrmConversationDetail,
  CrmConversationPriority,
  CrmConversationStatus,
  CrmConversationSummary,
  CrmCustomerDetail,
  CrmMessageSummary,
  CrmMessageTemplateSummary,
} from '@watchdog-bms/contracts';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { ForbiddenState } from '@/common/components/state';
import { useWorkspaceLocale } from '@/common/i18n/locale-context';
import { t } from '@/common/i18n/workspace-i18n.logic';
import type { SupportedLocale } from '@/common/i18n/workspace-dictionary';
import { getCrmCustomer } from '@/features/crm/crm.api';
import { lineIdentityText } from '@/features/crm/customers-prototype.model';
import {
  listConversations,
  getConversation,
  sendReply,
  addInternalNote,
  setConversationStatus,
  setConversationPriority,
  setConversationTags,
  assignConversation,
  markConversationRead,
  listMessageTemplates,
  createMessageTemplate,
  approveMessageTemplateForAi,
  archiveMessageTemplate,
  createDealFromConversation,
  createTaskFromConversation,
  createQuotationFromConversation,
} from './crm-inbox.api';
import {
  CONVERSATION_STATUS_META,
  INBOX_STATUS_ORDER,
  CONVERSATION_PRIORITY_META,
  INBOX_PRIORITY_ORDER,
  addConversationTag,
  conversationIsOverdue,
  slaCountdown,
  relativeTimeTh,
  avatarInitial,
  avatarColor,
  sendErrorMessage,
  messageContentUrl,
  stickerImageUrl,
  locationMapUrl,
  mediaErrorMessage,
  quickReplyQuery,
  filterTemplates,
} from './crm-inbox.logic';
import { useCloseOnOutsideClick } from '@/common/hooks/use-close-on-outside-click';

const PAGE_SIZE = 10;
const POLL_MS = 10_000;

type ChipKey = 'all' | 'overdue' | 'mine' | 'unassigned' | CrmConversationStatus;
type ComposerMode = 'reply' | 'note';
type SideTab = 'customer' | 'ai';

type Props = {
  companyId: string;
  userId: string;
  permissions: string[];
};

function StatusPill({ status, className = '' }: { status: CrmConversationStatus; className?: string }) {
  const meta = CONVERSATION_STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold ${className}`}
      style={{ color: meta.color, background: meta.bg }}
    >
      {meta.label}
    </span>
  );
}

function PriorityBadge({ priority, className = '' }: { priority: CrmConversationPriority; className?: string }) {
  const meta = CONVERSATION_PRIORITY_META[priority];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${className}`}
      style={{ color: meta.color, background: meta.bg }}
    >
      ⚑ {meta.label}
    </span>
  );
}

/** First-response SLA countdown: green → amber (≤15 นาที) → red (เกินกำหนด). */
const SLA_CHIP_STYLE = {
  ok: { color: '#067647', background: '#ECFDF3' },
  warning: { color: '#D97706', background: '#FEF3C7' },
  overdue: { color: '#DC2626', background: '#FEE2E2' },
} as const;

function SlaChip({ countdown }: { countdown: { state: 'ok' | 'warning' | 'overdue'; label: string } }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold" style={SLA_CHIP_STYLE[countdown.state]}>
      ⏱ {countdown.label}
    </span>
  );
}

export function InboxPage({ companyId, userId, permissions }: Props) {
  const locale = useWorkspaceLocale();
  const canReply = permissions.includes('crm.inbox.reply');
  const canNote = permissions.includes('crm.inbox.note');
  const canAssign = permissions.includes('crm.inbox.assign');
  const canResolve = permissions.includes('crm.inbox.resolve');
  const canSeeCustomer = permissions.includes('crm.customer.read');
  const canUseTemplates = permissions.includes('crm.template.read');
  const canManageTemplates = permissions.includes('crm.template.manage');

  const [chip, setChip] = useState<ChipKey>('all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CrmConversationSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Partial<Record<CrmConversationStatus, number>>>({});
  const [overdueCount, setOverdueCount] = useState(0);
  const [mineCount, setMineCount] = useState(0);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CrmConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [customer, setCustomer] = useState<CrmCustomerDetail | null>(null);

  const [composerMode, setComposerMode] = useState<ComposerMode>('reply');
  const [composerText, setComposerText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<CrmMessageTemplateSummary[]>([]);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [templateForm, setTemplateForm] = useState({ title: '', bodyText: '' });
  const [templateError, setTemplateError] = useState<string | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<'status' | 'priority' | 'assign' | null>(null);
  const [sideTab, setSideTab] = useState<SideTab>('customer');
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const listAbort = useRef(0);

  useCloseOnOutsideClick(statusMenuRef, useCallback(() => setStatusMenuOpen(false), []));
  useCloseOnOutsideClick(priorityMenuRef, useCallback(() => setPriorityMenuOpen(false), []));

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!canUseTemplates) return;
    listMessageTemplates(companyId).then(setTemplates).catch(() => setTemplates([]));
  }, [companyId, canUseTemplates]);

  // "/" quick replies — only in reply mode, only while the text is a single line.
  const quickQuery = composerMode === 'reply' && canUseTemplates ? quickReplyQuery(composerText) : null;
  const quickSuggestions = useMemo(
    () => (quickQuery === null ? [] : filterTemplates(templates, quickQuery).slice(0, 6)),
    [quickQuery, templates],
  );

  const applyTemplate = useCallback((template: CrmMessageTemplateSummary) => {
    setComposerText(template.bodyText);
    setTemplatePickerOpen(false);
  }, []);

  const handleCreateTemplate = useCallback(async () => {
    if (templateBusy) return;
    setTemplateBusy(true); setTemplateError(null);
    try {
      await createMessageTemplate(companyId, { title: templateForm.title, bodyText: templateForm.bodyText });
      setTemplateForm({ title: '', bodyText: '' });
      setTemplates(await listMessageTemplates(companyId));
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : t('inbox.template_save_failed', locale));
    } finally {
      setTemplateBusy(false);
    }
  }, [companyId, templateForm, templateBusy, locale]);

  const handleArchiveTemplate = useCallback(async (templateId: string) => {
    if (templateBusy) return;
    setTemplateBusy(true); setTemplateError(null);
    try {
      await archiveMessageTemplate(companyId, templateId);
      setTemplates(await listMessageTemplates(companyId));
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : t('inbox.template_delete_failed', locale));
    } finally {
      setTemplateBusy(false);
    }
  }, [companyId, templateBusy, locale]);

  const handleApproveTemplateForAi = useCallback(async (templateId: string) => {
    if (templateBusy) return;
    setTemplateBusy(true); setTemplateError(null);
    try {
      await approveMessageTemplateForAi(companyId, templateId);
      setTemplates(await listMessageTemplates(companyId));
    } catch (e) {
      setTemplateError(e instanceof Error ? e.message : t('inbox.template_approve_failed', locale));
    } finally {
      setTemplateBusy(false);
    }
  }, [companyId, templateBusy, locale]);

  const loadList = useCallback(
    async (silent = false) => {
      const token = ++listAbort.current;
      if (!silent) setListLoading(true);
      try {
        const statusChip = INBOX_STATUS_ORDER.includes(chip as CrmConversationStatus)
          ? (chip as CrmConversationStatus)
          : undefined;
        const filter = {
          status: statusChip,
          overdue: chip === 'overdue' ? true : undefined,
          assignee: chip === 'mine' ? ('me' as const) : chip === 'unassigned' ? ('none' as const) : undefined,
          tag: tagFilter ?? undefined,
          search: debouncedSearch || undefined,
          page,
          pageSize: PAGE_SIZE,
        };
        const result = await listConversations(companyId, filter);
        if (token !== listAbort.current) return;
        setItems(result.items);
        setTotal(result.total);
        setStatusCounts(result.statusCounts ?? {});
        setOverdueCount(result.overdueCount ?? 0);
        setMineCount(result.mineCount ?? 0);
        setUnassignedCount(result.unassignedCount ?? 0);
        setListError(null);
        setForbidden(false);
      } catch (e) {
        if (token !== listAbort.current) return;
        // `authedApiFetch` throws a plain Error carrying `status`, never an `ApiError` — reading
        // the wrong shape meant this forbidden state never rendered.
        if ((e as { status?: number } | null)?.status === 403) setForbidden(true);
        else setListError(t('inbox.list_load_failed', locale));
      } finally {
        if (token === listAbort.current) setListLoading(false);
      }
    },
    [companyId, chip, tagFilter, debouncedSearch, page, locale],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // 10s poll (list + open thread + relative times); pauses while the tab is hidden.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      setNow(new Date());
      void loadList(true);
      if (selectedId) {
        getConversation(companyId, selectedId).then(setDetail).catch(() => undefined);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [companyId, loadList, selectedId]);

  // Deep link from Customer 360 (?conversation=<id>): open that thread once on mount.
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current) return;
    const id = new URLSearchParams(window.location.search).get('conversation');
    if (!id) return;
    deepLinkDone.current = true;
    setSelectedId(id);
    setMobileThreadOpen(true);
    setDetailLoading(true);
    getConversation(companyId, id)
      .then((d) => {
        setDetail(d);
        getCrmCustomer(companyId, d.customerId)
          .then((result) => setCustomer(result.projection === 'OPERATIONAL' ? result.customer : null))
          .catch(() => setCustomer(null));
      })
      .catch(() => setActionError(t('inbox.conversation_load_failed', locale)))
      .finally(() => setDetailLoading(false));
  }, [companyId, locale]);

  const openConversation = useCallback(
    (conversation: CrmConversationSummary) => {
      setSelectedId(conversation.id);
      setMobileThreadOpen(true);
      setStatusMenuOpen(false);
      setPriorityMenuOpen(false);
      setSendError(null);
      setActionError(null);
      setComposerMode('reply');
      setDetail(null);
      setCustomer(null);
      setDetailLoading(true);
      getConversation(companyId, conversation.id)
        .then(setDetail)
        .catch(() => setActionError(t('inbox.conversation_load_failed', locale)))
        .finally(() => setDetailLoading(false));
      if (conversation.unreadCount > 0) {
        setItems((prev) => prev.map((c) => (c.id === conversation.id ? { ...c, unreadCount: 0 } : c)));
        void markConversationRead(companyId, conversation.id).catch(() => undefined);
      }
      if (canSeeCustomer) {
        getCrmCustomer(companyId, conversation.customerId)
          .then((result) => setCustomer(result.projection === 'OPERATIONAL' ? result.customer : null))
          .catch(() => setCustomer(null));
      }
    },
    [companyId, canSeeCustomer, locale],
  );

  const applyConversationPatch = useCallback((summary: CrmConversationSummary) => {
    setDetail((prev) => (prev && prev.id === summary.id ? { ...prev, ...summary, messages: prev.messages } : prev));
    setItems((prev) => prev.map((c) => (c.id === summary.id ? { ...c, ...summary } : c)));
  }, []);

  const submitComposer = useCallback(async () => {
    if (!detail || sending) return;
    const text = composerText.trim();
    if (!text) return;
    setSending(true);
    setSendError(null);
    try {
      const result =
        composerMode === 'note'
          ? await addInternalNote(companyId, detail.id, text)
          : await sendReply(companyId, detail.id, text);
      setDetail((prev) =>
        prev && prev.id === result.conversation.id
          ? { ...prev, ...result.conversation, messages: [...prev.messages, result.message] }
          : prev,
      );
      setItems((prev) => prev.map((c) => (c.id === result.conversation.id ? { ...c, ...result.conversation } : c)));
      setComposerText('');
      if (result.message.deliveryStatus === 'FAILED') {
        setSendError(sendErrorMessage(result.message.deliveryError ?? ''));
      }
    } catch (e) {
      setSendError(sendErrorMessage((e as Error).message ?? ''));
    } finally {
      setSending(false);
    }
  }, [companyId, detail, composerMode, composerText, sending]);

  const changeStatus = useCallback(
    async (status: CrmConversationStatus) => {
      if (!detail || actionBusy) return;
      setStatusMenuOpen(false);
      setActionError(null);
      setActionBusy('status');
      try {
        const summary = await setConversationStatus(companyId, detail.id, status);
        applyConversationPatch(summary);
        // Status moves rows across chips (spam mutes out of the default list) — refresh now, not at the next poll.
        void loadList(true);
      } catch {
        setActionError(t('inbox.status_change_failed', locale));
      } finally {
        setActionBusy(null);
      }
    },
    [companyId, detail, actionBusy, applyConversationPatch, loadList, locale],
  );

  const changePriority = useCallback(
    async (priority: CrmConversationPriority) => {
      if (!detail || actionBusy) return;
      setPriorityMenuOpen(false);
      setActionError(null);
      setActionBusy('priority');
      try {
        const summary = await setConversationPriority(companyId, detail.id, priority);
        applyConversationPatch(summary);
      } catch {
        setActionError(t('inbox.priority_change_failed', locale));
      } finally {
        setActionBusy(null);
      }
    },
    [companyId, detail, actionBusy, applyConversationPatch, locale],
  );

  // Throws on failure — the sidebar tag editor shows its own inline error.
  const saveTags = useCallback(
    async (tags: string[]) => {
      if (!detail) return;
      const summary = await setConversationTags(companyId, detail.id, tags);
      applyConversationPatch(summary);
    },
    [companyId, detail, applyConversationPatch],
  );

  const assignToMe = useCallback(async () => {
    if (!detail || actionBusy) return;
    setActionError(null);
    setActionBusy('assign');
    try {
      const summary = await assignConversation(companyId, detail.id, detail.assignedToUserId === userId ? null : userId);
      applyConversationPatch(summary);
      // Assignment moves rows between ของฉัน/ยังไม่มีผู้รับ chips — refresh counts now.
      void loadList(true);
    } catch {
      setActionError(t('inbox.assign_failed', locale));
    } finally {
      setActionBusy(null);
    }
  }, [companyId, detail, actionBusy, userId, applyConversationPatch, loadList, locale]);

  // Chip definitions per Flow A: ทั้งหมด · ⏱ เกิน 30 นาที (เมื่อมี) · ของฉัน/ยังไม่มีผู้รับ · สถานะตามลำดับ
  const chips = useMemo(() => {
    // "ทั้งหมด" mirrors the default list, which mutes spam.
    const totalAll = INBOX_STATUS_ORDER.reduce((sum, st) => sum + (st === 'SPAM' ? 0 : statusCounts[st] ?? 0), 0);
    const defs: { key: ChipKey; label: string; count: number; color: string; bg: string }[] = [
      { key: 'all', label: t('inbox.chip_all', locale), count: totalAll, color: '#027A48', bg: '#D1FAE5' },
    ];
    if (overdueCount > 0) defs.push({ key: 'overdue', label: `⏱ ${t('inbox.chip_overdue', locale)}`, count: overdueCount, color: '#DC2626', bg: '#FEE2E2' });
    if (mineCount > 0) defs.push({ key: 'mine', label: `👤 ${t('inbox.chip_mine', locale)}`, count: mineCount, color: '#2563EB', bg: '#DBEAFE' });
    if (unassignedCount > 0) defs.push({ key: 'unassigned', label: t('inbox.chip_unassigned', locale), count: unassignedCount, color: '#B54708', bg: '#FEF0C7' });
    for (const st of INBOX_STATUS_ORDER) {
      const count = statusCounts[st] ?? 0;
      if (count === 0) continue;
      const meta = CONVERSATION_STATUS_META[st];
      defs.push({ key: st, label: meta.label, count, color: meta.color, bg: meta.bg });
    }
    return defs;
  }, [statusCounts, overdueCount, mineCount, unassignedCount, locale]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const visibleMessages = useMemo(() => {
    if (!detail) return [];
    // ตาม design: แท็บส่งหาลูกค้าไม่แสดงโน้ตภายใน — โน้ตเห็นเฉพาะแท็บโน้ต
    return composerMode === 'note' ? detail.messages : detail.messages.filter((m) => m.visibility !== 'INTERNAL_NOTE');
  }, [detail, composerMode]);

  // Every other string on this screen renders through `t(..., locale)`; the panel defaults to Thai,
  // so without this an English user hits a Thai-only page.
  if (forbidden) return <ForbiddenState locale={locale} />;

  return (
    <div className="flex flex-col">
      {/* status filter chips */}
      <div className="mb-3.5 flex w-full items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-x-visible">
        {chips.map((c) => {
          const active = chip === c.key;
          return (
            <button
              key={c.key}
              onClick={() => { setChip(c.key); setPage(1); }}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 py-2 text-[15px] font-semibold"
              style={{
                background: c.bg,
                color: c.color,
                border: `2px solid ${active ? c.color : 'transparent'}`,
                boxShadow: active ? `0 0 0 3px ${c.bg}` : 'none',
              }}
            >
              {c.label}
              <span className="rounded-xl bg-white px-2 text-[13px] font-extrabold" style={{ color: c.color }}>{c.count}</span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-[520px] gap-4" style={{ height: 'calc(100dvh - 220px)' }}>
        {/* COL 1 · conversation list */}
        <div className={`${mobileThreadOpen ? 'hidden md:flex' : 'flex'} w-full flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm md:w-[330px] md:flex-shrink-0`}>
          <div className="border-b border-gray-100 px-4 pb-3 pt-4">
            <div className="flex flex-wrap items-center justify-between">
              <div className="text-lg font-bold text-gray-900">{t('inbox.title', locale)}</div>
              <div className="rounded-full px-2.5 py-0.5 text-[12.5px] font-semibold" style={{ color: '#06C755', background: '#E4F9EC' }}>LINE OA</div>
            </div>
            <div className="mt-3 flex h-[38px] items-center gap-2 rounded-[9px] border border-gray-300 bg-white px-3">
              <span className="text-gray-400">🔍</span>
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder={t('inbox.search_placeholder', locale)}
                className="w-full border-none bg-transparent text-sm text-gray-800 outline-none"
              />
            </div>
            {tagFilter && (
              <button
                onClick={() => { setTagFilter(null); setPage(1); }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-200"
                title={t('inbox.clear_tag_filter', locale)}
              >
                🏷 {tagFilter} <span className="text-gray-400">✕</span>
              </button>
            )}
          </div>
          <div className="mt-1 flex-1 overflow-y-auto">
            {listLoading && items.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-gray-400">{t('inbox.loading', locale)}</div>
            )}
            {listError && <div className="mx-4 my-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{listError}</div>}
            {!listLoading && !listError && items.length === 0 && (
              <div className="px-5 py-10 text-center text-sm text-gray-400">{t('inbox.empty', locale)}</div>
            )}
            {items.map((c) => {
              const overdue = conversationIsOverdue(c, now);
              const countdown = slaCountdown(c, now);
              const selected = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  onClick={() => openConversation(c)}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${selected ? 'bg-brand-25' : 'hover:bg-gray-50'}`}
                  style={overdue ? { boxShadow: 'inset 3px 0 0 0 #DC2626' } : undefined}
                >
                  <div
                    className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
                    style={{ background: avatarColor(c.customerId) }}
                  >
                    {avatarInitial(c.customerDisplayName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className={`truncate text-[15px] ${c.unreadCount > 0 ? 'font-bold text-gray-900' : 'font-semibold text-gray-800'}`}>
                        {c.customerDisplayName ?? 'ลูกค้า LINE'}
                      </span>
                      <span className="flex-shrink-0 text-[11.5px] text-gray-400">{relativeTimeTh(c.lastMessageAt, now)}</span>
                    </div>
                    <div className={`mt-0.5 truncate text-[13.5px] ${c.unreadCount > 0 ? 'font-medium text-gray-700' : 'text-gray-500'}`}>
                      {c.lastMessagePreview ?? '—'}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <StatusPill status={c.status} />
                      {c.priority !== 'NORMAL' && <PriorityBadge priority={c.priority} />}
                      {countdown && <SlaChip countdown={countdown} />}
                      {c.unreadCount > 0 && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11.5px] font-bold text-white">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 truncate text-[11.5px] text-gray-400">
                      {c.assignedToDisplayName ? `• ${t('inbox.assigned_to', locale)} ${c.assignedToDisplayName}` : `• ${t('inbox.no_owner', locale)}`}
                    </div>
                    {c.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            onClick={(e) => { e.stopPropagation(); setTagFilter(tag); setPage(1); }}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:bg-gray-200"
                            title={`${t('inbox.filter_tag', locale)} ${tag}`}
                          >
                            🏷 {tag}
                          </span>
                        ))}
                        {c.tags.length > 3 && (
                          <span className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold text-gray-400">+{c.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {total > PAGE_SIZE && (
            <div className="flex items-center gap-1.5 border-t border-gray-100 px-3 py-2.5">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
              >
                ‹
              </button>
              <div className="flex flex-1 justify-center gap-1 overflow-x-auto">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={`flex h-[30px] min-w-[30px] items-center justify-center rounded-lg px-1.5 text-[13px] font-semibold ${n === page ? 'bg-brand-500 text-white' : 'border border-gray-200 bg-white text-gray-600'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          )}
        </div>

        {/* COL 2 · chat window */}
        {detail || detailLoading ? (
          <div className={`${mobileThreadOpen ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200 shadow-sm`} style={{ background: '#F7FAF8' }}>
            {detailLoading && <div className="flex flex-1 items-center justify-center text-sm text-gray-400">{t('inbox.loading_conversation', locale)}</div>}
            {detail && (
              <>
                <div className="flex items-center gap-3 border-b border-gray-100 bg-white px-4 py-3.5">
                  <button
                    onClick={() => setMobileThreadOpen(false)}
                    className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-lg bg-gray-100 text-xl text-gray-600 md:hidden"
                  >
                    ‹
                  </button>
                  <div
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ background: avatarColor(detail.customerId) }}
                  >
                    {avatarInitial(detail.customerDisplayName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-base font-bold text-gray-900">{detail.customerDisplayName ?? 'ลูกค้า LINE'}</div>
                    <div className="truncate text-[12.5px] text-gray-400">
                      LINE OA · {detail.assignedToDisplayName ? `${t('inbox.assigned_to', locale)} ${detail.assignedToDisplayName}` : t('inbox.no_owner', locale)}
                    </div>
                  </div>
                  {conversationIsOverdue(detail, now) && (
                    <span className="hidden rounded-full px-2.5 py-1 text-[11.5px] font-bold sm:inline-flex" style={{ color: '#DC2626', background: '#FEE2E2' }}>
                      {t('inbox.urgent_unanswered', locale)}
                    </span>
                  )}
                  {/* Full assign permission, or the spec's pickup model: reply-capable staff claim unassigned / release their own. */}
                  {(canAssign || (canReply && (!detail.assignedToUserId || detail.assignedToUserId === userId))) && (
                    <button
                      onClick={assignToMe}
                      disabled={actionBusy !== null}
                      className={`hidden whitespace-nowrap rounded-[9px] border px-3 py-1.5 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 sm:block ${detail.assignedToUserId === userId ? 'border-gray-300 text-gray-600 hover:bg-gray-50' : 'border-brand-200 bg-brand-25 text-brand-700 hover:bg-brand-50'}`}
                    >
                      {actionBusy === 'assign'
                        ? detail.assignedToUserId === userId ? 'กำลังเลิกดูแล...' : 'กำลังรับเรื่อง...'
                        : detail.assignedToUserId === userId ? t('inbox.release', locale) : t('inbox.claim', locale)}
                    </button>
                  )}
                  <div className="relative" ref={priorityMenuRef}>
                    <button
                      onClick={() => { if (!canResolve) return; setStatusMenuOpen(false); setPriorityMenuOpen((v) => !v); }}
                      disabled={actionBusy !== null}
                      className="flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ color: CONVERSATION_PRIORITY_META[detail.priority].color, background: CONVERSATION_PRIORITY_META[detail.priority].bg }}
                    >
                      {actionBusy === 'priority' ? 'กำลังบันทึก...' : <>⚑ {CONVERSATION_PRIORITY_META[detail.priority].label}{canResolve && <span>▾</span>}</>}
                    </button>
                    {priorityMenuOpen && (
                      <div className="absolute right-0 top-9 z-30 w-[190px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold tracking-wide text-gray-400">{t('inbox.priority_level', locale)}</div>
                        {INBOX_PRIORITY_ORDER.map((p) => (
                          <button
                            key={p}
                            onClick={() => changePriority(p)}
                            disabled={actionBusy !== null}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: CONVERSATION_PRIORITY_META[p].color }} />
                            <span className="flex-1">{CONVERSATION_PRIORITY_META[p].label}</span>
                            {detail.priority === p && <span className="font-extrabold text-brand-600">✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative" ref={statusMenuRef}>
                    <button
                      onClick={() => { if (!canResolve) return; setPriorityMenuOpen(false); setStatusMenuOpen((v) => !v); }}
                      disabled={actionBusy !== null}
                      className="flex items-center gap-1 rounded-full px-3 py-1 text-[12.5px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ color: CONVERSATION_STATUS_META[detail.status].color, background: CONVERSATION_STATUS_META[detail.status].bg }}
                    >
                      {actionBusy === 'status' ? 'กำลังบันทึก...' : <>{CONVERSATION_STATUS_META[detail.status].label}{canResolve && <span>▾</span>}</>}
                    </button>
                    {statusMenuOpen && (
                      <div className="absolute right-0 top-9 z-30 w-[190px] overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
                        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold tracking-wide text-gray-400">{t('inbox.change_status', locale)}</div>
                        {INBOX_STATUS_ORDER.map((st) => (
                          <button
                            key={st}
                            onClick={() => changeStatus(st)}
                            disabled={actionBusy !== null}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span className="h-2.5 w-2.5 rounded-full" style={{ background: CONVERSATION_STATUS_META[st].color }} />
                            <span className="flex-1">{CONVERSATION_STATUS_META[st].label}</span>
                            {detail.status === st && <span className="font-extrabold text-brand-600">✓</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {actionError && <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>}

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {visibleMessages.length === 0 && (
                    <div className="py-10 text-center text-sm text-gray-400">
                      {composerMode === 'note' ? t('inbox.no_messages_or_notes', locale) : t('inbox.no_messages', locale)}
                    </div>
                  )}
                  {visibleMessages.map((m) => (
                    <MessageBubble key={m.id} companyId={companyId} message={m} locale={locale} />
                  ))}
                </div>

                <div className="border-t border-gray-100 bg-white px-4 py-3">
                  {(canReply || canNote) ? (
                    <>
                      <div className="mb-2.5 flex gap-1 rounded-[9px] bg-gray-100 p-1">
                        {canReply && (
                          <button
                            onClick={() => setComposerMode('reply')}
                            className={`flex-1 rounded-[7px] px-3 py-1.5 text-[13.5px] font-semibold ${composerMode === 'reply' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
                          >
                            💬 {t('inbox.tab_reply', locale)}
                          </button>
                        )}
                        {canNote && (
                          <button
                            onClick={() => setComposerMode('note')}
                            className={`flex-1 rounded-[7px] px-3 py-1.5 text-[13.5px] font-semibold ${composerMode === 'note' ? 'bg-white text-amber-700 shadow-sm' : 'text-gray-500'}`}
                          >
                            🔒 {t('inbox.tab_note', locale)}
                          </button>
                        )}
                      </div>
                      {sendError && <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{sendError}</div>}
                      {quickSuggestions.length > 0 && (
                        <div className="mb-2 overflow-hidden rounded-xl border border-brand-200 bg-white shadow-sm">
                          <div className="border-b border-gray-100 px-3 py-1.5 text-[12px] font-semibold text-gray-400">{t('inbox.quick_reply_hint', locale)}</div>
                          {quickSuggestions.map((t) => (
                            <button
                              key={t.id}
                              onClick={() => applyTemplate(t)}
                              className="block w-full px-3 py-2 text-left hover:bg-brand-50"
                            >
                              <span className="text-[13.5px] font-semibold text-gray-800">{t.title}</span>
                              <span className="ml-2 text-[12.5px] text-gray-400">{t.bodyText.length > 60 ? `${t.bodyText.slice(0, 60)}…` : t.bodyText}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {templatePickerOpen && composerMode === 'reply' && (
                        <div className="mb-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
                          <div className="mb-2 flex flex-wrap items-center justify-between">
                            <span className="text-[13px] font-semibold text-gray-700">{t('inbox.templates_title', locale)}</span>
                            <button onClick={() => setTemplatePickerOpen(false)} className="text-[12.5px] text-gray-400 hover:text-gray-600">{t('inbox.close', locale)}</button>
                          </div>
                          {templateError && <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12.5px] text-red-700">{templateError}</div>}
                          {templates.length === 0 ? (
                            <div className="py-2 text-center text-[13px] text-gray-400">{t('inbox.no_templates', locale)}{canManageTemplates ? ` — ${t('inbox.create_first_template', locale)}` : ''}</div>
                          ) : (
                            <div className="max-h-44 space-y-1 overflow-y-auto">
                              {templates.map((tpl) => (
                                <div key={tpl.id} className="flex items-start gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 hover:bg-gray-50">
                                  <button onClick={() => applyTemplate(tpl)} className="min-w-0 flex-1 text-left">
                                    <div className="flex items-center gap-1.5 text-[13.5px] font-semibold text-gray-800">
                                      <span>{tpl.title}</span>
                                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tpl.aiApproved ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                                        {tpl.aiApproved ? t('inbox.template_ai_approved', locale) : t('inbox.template_ai_review_required', locale)}
                                      </span>
                                    </div>
                                    <div className="truncate text-[12.5px] text-gray-500">{tpl.bodyText}</div>
                                  </button>
                                  {canManageTemplates && (
                                    <div className="flex shrink-0 items-center gap-2">
                                      {!tpl.aiApproved && (
                                        <button
                                          onClick={() => void handleApproveTemplateForAi(tpl.id)}
                                          disabled={templateBusy}
                                          className="text-[12px] text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                                        >
                                          {t('inbox.template_approve_ai', locale)}
                                        </button>
                                      )}
                                      <button
                                        onClick={() => void handleArchiveTemplate(tpl.id)}
                                        disabled={templateBusy}
                                        className="text-[12px] text-gray-300 hover:text-red-500 disabled:opacity-50"
                                        title={t('inbox.archive_template', locale)}
                                      >
                                        {t('inbox.delete', locale)}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {canManageTemplates && (
                            <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2">
                              <input
                                value={templateForm.title}
                                onChange={(e) => setTemplateForm((f) => ({ ...f, title: e.target.value }))}
                                placeholder={t('inbox.template_title_placeholder', locale)}
                                className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-400"
                              />
                              <textarea
                                value={templateForm.bodyText}
                                onChange={(e) => setTemplateForm((f) => ({ ...f, bodyText: e.target.value }))}
                                placeholder={t('inbox.template_body_placeholder', locale)}
                                rows={2}
                                className="w-full resize-none rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-400"
                              />
                              <button
                                onClick={() => void handleCreateTemplate()}
                                disabled={templateBusy || !templateForm.title.trim() || !templateForm.bodyText.trim()}
                                className="rounded-lg bg-brand-500 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                              >
                                {templateBusy ? t('inbox.saving', locale) : `+ ${t('inbox.add_template', locale)}`}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className={`rounded-xl border px-3.5 py-2.5 ${composerMode === 'note' ? 'border-amber-200 bg-amber-50' : 'border-gray-300 bg-white'}`}>
                        <textarea
                          value={composerText}
                          onChange={(e) => setComposerText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              if (quickSuggestions.length > 0) {
                                applyTemplate(quickSuggestions[0]);
                                return;
                              }
                              void submitComposer();
                            }
                          }}
                          placeholder={composerMode === 'note' ? t('inbox.note_placeholder', locale) : t('inbox.reply_placeholder', locale)}
                          rows={2}
                          className="w-full resize-none border-none bg-transparent text-[15px] leading-relaxed text-gray-800 outline-none"
                        />
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            {composerMode === 'reply' && canUseTemplates && (
                              <button
                                onClick={() => setTemplatePickerOpen((v) => !v)}
                                className={`shrink-0 rounded-lg border px-2.5 py-1 text-[12.5px] font-semibold ${templatePickerOpen ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                              >
                                📋 {t('inbox.templates_button', locale)}
                              </button>
                            )}
                            <div className="truncate text-[12.5px] text-gray-400">
                              {composerMode === 'note'
                                ? <span style={{ color: '#B45309' }}>🔒 {t('inbox.note_hint', locale)}</span>
                                : t('inbox.enter_hint', locale)}
                            </div>
                          </div>
                          <button
                            onClick={() => void submitComposer()}
                            disabled={sending || composerText.trim() === ''}
                            className={`rounded-[9px] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${composerMode === 'note' ? 'bg-amber-600 hover:bg-amber-700' : 'bg-brand-500 hover:bg-brand-600'}`}
                          >
                            {sending ? t('inbox.sending', locale) : composerMode === 'note' ? t('inbox.save_note', locale) : t('inbox.send_message', locale)}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-center text-sm text-gray-400">
                      {t('inbox.read_only_notice', locale)}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="hidden min-w-0 flex-1 flex-col items-center justify-center rounded-2xl border border-gray-200 p-10 text-center shadow-sm md:flex" style={{ background: '#F7FAF8' }}>
            <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full text-4xl" style={{ background: '#E4F9EC', color: '#06C755' }}>💬</div>
            <div className="mt-5 text-xl font-bold text-gray-800">{t('inbox.empty_state_title', locale)}</div>
            <div className="mt-1.5 max-w-[340px] text-[15px] leading-relaxed text-gray-500">
              {t('inbox.empty_state_desc', locale)}
            </div>
            {overdueCount > 0 && (
              <button
                onClick={() => { setChip('overdue'); setPage(1); }}
                className="mt-5 inline-flex items-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-semibold text-white"
                style={{ background: '#DC2626' }}
              >
                ⏱ {t('inbox.view_overdue_prefix', locale)} {overdueCount} {t('inbox.view_overdue_suffix', locale)}
              </button>
            )}
          </div>
        )}

        {/* COL 3 · customer info / AI panel */}
        {detail && (
          <div className="hidden w-[340px] flex-shrink-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm xl:flex">
            <div className="mx-3 mt-3 flex gap-1 rounded-[9px] bg-gray-100 p-1">
              <button
                onClick={() => setSideTab('customer')}
                className={`flex-1 rounded-[7px] px-3 py-1.5 text-[13.5px] font-semibold ${sideTab === 'customer' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                👤 {t('inbox.tab_customer', locale)}
              </button>
              <button
                onClick={() => setSideTab('ai')}
                className={`flex-1 rounded-[7px] px-3 py-1.5 text-[13.5px] font-semibold ${sideTab === 'ai' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
              >
                ✨ {t('inbox.tab_ai', locale)}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {sideTab === 'customer' ? (
                <CustomerPanel
                  companyId={companyId}
                  detail={detail}
                  customer={customer}
                  canSeeCustomer={canSeeCustomer}
                  canTriage={canResolve}
                  permissions={permissions}
                  onSaveTags={saveTags}
                  now={now}
                  locale={locale}
                />
              ) : (
                <div className="rounded-[14px] border p-4" style={{ background: 'linear-gradient(160deg,#F4F3FF,#FCF4FF)', borderColor: '#E9D7FE' }}>
                  <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: '#6941C6' }}>✨ {t('inbox.ai_assist_title', locale)}</div>
                  <div className="mt-2 text-sm leading-relaxed text-gray-600">
                    {t('inbox.ai_assist_desc', locale)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Non-text bubble content: real media when stored, honest placeholder otherwise. */
function MediaContent({ companyId, message, locale }: { companyId: string; message: CrmMessageSummary; locale: SupportedLocale }) {
  const meta = message.contentMeta;

  if (message.messageType === 'STICKER' && meta?.stickerId) {
    // no loading="lazy": inside this overflow container Chrome never triggers the lazy load
    // eslint-disable-next-line @next/next/no-img-element -- LINE CDN, size unknown
    return <img src={stickerImageUrl(meta.stickerId)} alt={t('inbox.sticker_alt', locale)} className="h-28 w-28 object-contain" />;
  }

  if (message.messageType === 'LOCATION' && meta?.latitude !== undefined && meta?.longitude !== undefined) {
    return (
      <a href={locationMapUrl(meta.latitude, meta.longitude)} target="_blank" rel="noreferrer" className="underline">
        📍 {meta.address ?? t('inbox.open_location', locale)}
      </a>
    );
  }

  if (message.attachmentId) {
    const url = messageContentUrl(companyId, message.conversationId, message.id);
    if (message.messageType === 'IMAGE') {
      return (
        <a href={url} target="_blank" rel="noreferrer" title={t('inbox.open_full_image', locale)}>
          {/* eslint-disable-next-line @next/next/no-img-element -- streamed from our API */}
          <img src={url} alt={meta?.fileName ?? t('inbox.image_alt', locale)} className="max-h-64 max-w-full rounded-lg" />
        </a>
      );
    }
    return (
      <a href={url} className="inline-flex items-center gap-1.5 underline">
        📎 {meta?.fileName ?? t('inbox.download_attachment', locale)}
      </a>
    );
  }

  // Not stored (yet): distinguish a failed fetch from one still in flight.
  if (meta?.mediaError) return <span className="text-gray-500">⚠️ {mediaErrorMessage(meta.mediaError)}</span>;
  return <span className="text-gray-500">{t('inbox.loading_attachment', locale)}</span>;
}

function MessageBubble({ companyId, message, locale }: { companyId: string; message: CrmMessageSummary; locale: SupportedLocale }) {
  const time = message.sentAt ?? message.createdAt;
  const timeLabel = formatThaiDateTime(time);

  if (message.visibility === 'INTERNAL_NOTE') {
    return (
      <div className="my-2.5 flex justify-center">
        <div className="max-w-[80%] rounded-xl border px-3.5 py-2.5 text-sm" style={{ background: '#FEF9C3', borderColor: '#FDE68A', color: '#854D0E' }}>
          <div className="mb-0.5 text-[10.5px] font-bold tracking-wide" style={{ color: '#B45309' }}>🔒 {t('inbox.internal_note_label', locale)}</div>
          <div className="whitespace-pre-wrap">{message.contentText}</div>
          <div className="mt-1 text-[11px]" style={{ color: '#B45309' }}>{timeLabel}</div>
        </div>
      </div>
    );
  }

  const isOut = message.direction === 'OUTBOUND';
  const failed = message.deliveryStatus === 'FAILED';
  const isMedia = message.messageType !== 'TEXT' && message.direction === 'INBOUND';
  return (
    <div className={`my-2 flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className="min-w-0 max-w-[72%]">
        <div
          className="whitespace-pre-wrap rounded-[14px] px-3.5 py-2.5 text-[15px] leading-relaxed"
          style={
            isOut
              ? { background: failed ? '#FCA5A5' : 'var(--color-brand-500)', color: '#fff', borderBottomRightRadius: 4 }
              : { background: '#fff', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', borderBottomLeftRadius: 4 }
          }
        >
          {isMedia ? <MediaContent companyId={companyId} message={message} locale={locale} /> : (message.contentText ?? `[${message.messageType}]`)}
        </div>
        <div className={`mt-1 text-[11px] text-gray-400 ${isOut ? 'text-right' : ''}`}>
          {failed ? <span className="font-semibold text-red-600">{t('inbox.send_failed', locale)} · </span> : null}
          {(message.messageType === 'IMAGE' || message.messageType === 'FILE') && message.direction === 'INBOUND' ? `${t('inbox.attachment_label', locale)} · ` : ''}
          {timeLabel}
        </div>
      </div>
    </div>
  );
}

/** A3 revenue loop: turn the conversation into a deal / task / quotation draft. */
function QuickActions({ companyId, conversationId, customerName, permissions, locale }: { companyId: string; conversationId: string; customerName: string; permissions: string[]; locale: SupportedLocale }) {
  const canDeal = permissions.includes('crm.opportunity.create');
  const canTask = permissions.includes('crm.follow_up.create');
  const canQuote = permissions.includes('crm.quotation.link');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  if (!canDeal && !canTask && !canQuote) return null;

  const run = async (kind: string, fn: () => Promise<unknown>) => {
    setBusy(kind); setMsg(null);
    try { await fn(); setMsg(t('inbox.create_success', locale)); }
    catch (e) { setMsg(e instanceof Error ? e.message : t('inbox.create_failed', locale)); }
    finally { setBusy(null); }
  };

  const onDeal = () => {
    const title = window.prompt(t('inbox.deal_name_prompt', locale), `${t('inbox.deal_prefix', locale)} ${customerName}`);
    if (!title) return;
    void run('deal', () => createDealFromConversation(companyId, conversationId, { title }));
  };
  const onTask = () => {
    const title = window.prompt(t('inbox.follow_up_prompt', locale), `${t('inbox.follow_up_prefix', locale)} ${customerName}`);
    if (!title) return;
    const due = window.prompt(t('inbox.due_date_prompt', locale), new Date(Date.now() + 86400000).toISOString().slice(0, 10));
    if (!due) return;
    void run('task', () => createTaskFromConversation(companyId, conversationId, { title, dueAt: new Date(`${due}T09:00:00+07:00`).toISOString() }));
  };
  const onQuote = () => {
    const title = window.prompt(t('inbox.quotation_name_prompt', locale), `${t('inbox.quotation_prefix', locale)} ${customerName}`);
    if (!title) return;
    void run('quote', () => createQuotationFromConversation(companyId, conversationId, { title }));
  };

  return (
    <div className="mt-3.5">
      <div className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-400">{t('inbox.sales_section', locale)}</div>
      <div className="flex flex-wrap gap-1.5">
        {canDeal && <button onClick={onDeal} disabled={!!busy} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy === 'deal' ? '…' : `📊 ${t('inbox.create_deal', locale)}`}</button>}
        {canTask && <button onClick={onTask} disabled={!!busy} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy === 'task' ? '…' : `✅ ${t('inbox.create_task', locale)}`}</button>}
        {canQuote && <button onClick={onQuote} disabled={!!busy} className="rounded-full border border-gray-200 bg-white px-3 py-1 text-[12.5px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">{busy === 'quote' ? '…' : `📄 ${t('inbox.create_quotation', locale)}`}</button>}
      </div>
      {msg && <div className="mt-1.5 text-[12px] text-gray-500">{msg}</div>}
    </div>
  );
}

function CustomerPanel({
  companyId,
  detail,
  customer,
  canSeeCustomer,
  canTriage,
  permissions,
  onSaveTags,
  now,
  locale,
}: {
  companyId: string;
  detail: CrmConversationDetail;
  customer: CrmCustomerDetail | null;
  canSeeCustomer: boolean;
  canTriage: boolean;
  permissions: string[];
  onSaveTags: (tags: string[]) => Promise<void>;
  now: Date;
  locale: SupportedLocale;
}) {
  const [tagInput, setTagInput] = useState('');
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);

  const submitTags = async (tags: string[]) => {
    setTagBusy(true);
    setTagError(null);
    try {
      await onSaveTags(tags);
    } catch {
      setTagError(t('inbox.tag_save_failed', locale));
    } finally {
      setTagBusy(false);
    }
  };

  const handleAddTag = () => {
    const next = addConversationTag(detail.tags, tagInput);
    setTagInput('');
    if (next) void submitTags(next);
  };

  return (
    <div>
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white"
          style={{ background: avatarColor(detail.customerId) }}
        >
          {avatarInitial(detail.customerDisplayName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold text-gray-900">{detail.customerDisplayName ?? 'ลูกค้า LINE'}</div>
          <div className="truncate text-[12.5px] text-gray-400">
            {lineIdentityText(customer?.lineIdentities ?? [], t('inbox.customer_from_line', locale))}
          </div>
        </div>
        <StatusPill status={detail.status} />
      </div>

      <div className="mt-3.5 grid grid-cols-2 gap-2">
        <div className="rounded-[10px] bg-gray-50 p-2.5">
          <div className="text-[11px] text-gray-400">{t('inbox.awaiting_reply', locale)}</div>
          <div className="mt-0.5 text-sm font-bold text-gray-800">
            {detail.lastInboundAt ? relativeTimeTh(detail.lastInboundAt, now) : '—'}
          </div>
        </div>
        <div className="rounded-[10px] bg-gray-50 p-2.5">
          <div className="text-[11px] text-gray-400">{t('inbox.reopened', locale)}</div>
          <div className="mt-0.5 text-sm font-bold text-gray-800">{detail.reopenedCount} {t('inbox.times', locale)}</div>
        </div>
      </div>

      <QuickActions
        companyId={companyId}
        conversationId={detail.id}
        customerName={detail.customerDisplayName ?? 'ลูกค้า LINE'}
        permissions={permissions}
        locale={locale}
      />

      <div className="mt-3.5">
        <div className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-400">{t('inbox.tags', locale)}</div>
        <div className="flex flex-wrap gap-1.5">
          {detail.tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-[12.5px] font-semibold text-gray-700">
              🏷 {tag}
              {canTriage && (
                <button
                  onClick={() => void submitTags(detail.tags.filter((x) => x !== tag))}
                  disabled={tagBusy}
                  className="text-gray-400 hover:text-red-500 disabled:opacity-50"
                  title={`${t('inbox.remove_tag', locale)} ${tag}`}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          {detail.tags.length === 0 && !canTriage && <span className="text-[12.5px] text-gray-400">{t('inbox.no_tags', locale)}</span>}
        </div>
        {canTriage && (
          <div className="mt-2 flex gap-1.5">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
              placeholder={t('inbox.add_tag_placeholder', locale)}
              maxLength={40}
              className="w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-[13px] outline-none focus:border-brand-400"
            />
            <button
              onClick={handleAddTag}
              disabled={tagBusy || tagInput.trim() === ''}
              className="shrink-0 rounded-lg bg-brand-500 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {t('inbox.add', locale)}
            </button>
          </div>
        )}
        {tagError && <div className="mt-1.5 text-[12px] text-red-600">{tagError}</div>}
      </div>

      {customer && (
        <div className="mt-3 space-y-1.5 text-[13.5px] text-gray-600">
          {customer.primaryPhone && (
            <div><span className="text-gray-400">{t('inbox.phone_label', locale)} </span>{customer.primaryPhone}</div>
          )}
          {customer.primaryEmail && (
            <div><span className="text-gray-400">{t('inbox.email_label', locale)} </span>{customer.primaryEmail}</div>
          )}
          <div>
            <span className="text-gray-400">{t('inbox.customer_status_label', locale)} </span>
            {customer.status === 'ACTIVE' ? t('inbox.status_active', locale) : customer.status}
            {customer.source ? ` · ${t('inbox.source_from', locale)} ${customer.source}` : ''}
          </div>
          {customer.notes && (
            <div className="rounded-[10px] border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-600">{customer.notes}</div>
          )}
        </div>
      )}
      {!canSeeCustomer && (
        <div className="mt-3 rounded-[10px] border border-dashed border-gray-200 px-3 py-2.5 text-[12.5px] leading-relaxed text-gray-400">
          🔒 {t('inbox.no_customer_permission', locale)} (crm.customer.read)
        </div>
      )}

      {canSeeCustomer && (
        <a
          href={`/companies/${companyId}/crm/customers/${detail.customerId}`}
          className="mt-4 block rounded-[9px] border border-brand-200 bg-brand-25 px-3 py-2 text-center text-[13px] font-semibold text-brand-600 hover:bg-brand-50"
        >
          {t('inbox.open_customer_360', locale)} ›
        </a>
      )}
    </div>
  );
}
