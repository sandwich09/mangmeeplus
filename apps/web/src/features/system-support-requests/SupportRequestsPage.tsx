'use client';

import { useEffect, useRef, useState } from 'react';
import { PARTNER_LINE_MESSAGE_MAX_LENGTH } from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { useConfirm, useInputPrompt } from '@/common/components/modal';
import { useToast } from '@/common/components/toast';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import {
  listSupportRequests,
  claimSupportRequest,
  publishSupportOpenCount,
  reclaimSupportRequest,
  releaseSupportRequest,
  replySupportRequest,
  resolveSupportRequest,
  setSupportRequestAiActive,
  type SupportRequestItemDto,
} from './support-requests.api';
import { ChipBadge } from './SupportChip';
import { SupportThreadModal } from './SupportThreadModal';
import {
  SUPPORT_QUEUE_TABS,
  canManageAi,
  notifiedSummary,
  supportAnswerHref,
  supportAnswerLabel,
  supportClosedReasonTh,
  supportComposerMode,
  supportReferenceHref,
  supportReopenedChip,
  supportReplyChip,
  supportReplyWithinRetryWindow,
  supportStatusChip,
  waitedLabelTh,
  waitedForTh,
  type SupportQueueTab,
} from './support-requests.logic';

function SkeletonRow() {
  return (
    <tr>
      {[...Array(5)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 animate-pulse rounded bg-gray-100" />
        </td>
      ))}
    </tr>
  );
}

const rowActionClass =
  'min-h-11 rounded border px-3 py-1 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed md:min-h-0';

/**
 * The buttons one row offers. Exported so a spec can RENDER the gating rather than only read the
 * source — the page reaches its rows behind `useEffect`, and "which requests may still be acted
 * on" is exactly the rule a source assertion can agree with while the markup does something else.
 */
export function SupportRowActions({
  item, busy, onClaim, onRelease, onTakeover, onReply, onResolve, onToggleAi, onOpenThread, showReply = true,
}: {
  item: SupportRequestItemDto;
  busy: boolean;
  onClaim: () => void;
  onRelease: () => void;
  onTakeover: () => void;
  onReply: () => void;
  onResolve: () => void;
  onToggleAi: () => void;
  /** สัญญา v3 ข้อ 11: the chat behind this row. Absent inside the chat window itself. */
  onOpenThread?: () => void;
  /** The window hides the row's reply button while its own composer is the way to answer. */
  showReply?: boolean;
}) {
  const href = supportAnswerHref(item);
  const referenceHref = supportReferenceHref(item);
  const live = item.status !== 'CLOSED';
  return (
    <div className="flex flex-wrap gap-2">
      {/* Every row, CLOSED included: a settled case is still readable until the purge takes it. */}
      {onOpenThread && (
        <button
          type="button"
          onClick={onOpenThread}
          className={`${rowActionClass} border-brand-300 bg-white text-brand-700 hover:bg-brand-50`}
        >
          💬 เปิดแชท
        </button>
      )}
      {href && (
        <a
          href={href}
          className={`${rowActionClass} border-brand-200 bg-brand-50 text-brand-700 hover:bg-brand-100`}
        >
          {supportAnswerLabel(item)}
        </a>
      )}
      {/* Purchase without setup PR E (R-E5): the invoice/checkout this ask started from, when there is one. */}
      {referenceHref && (
        <a
          href={referenceHref}
          className={`${rowActionClass} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
        >
          เปิดรายการ
        </a>
      )}
      {live && !item.assignedAt && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onClaim}
          className={`${rowActionClass} border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100`}
        >
          {busy ? 'กำลังทำรายการ...' : 'รับเคส'}
        </button>
      )}
      {live && item.assignedAt && !item.assignedToMe && (
        <button
          type="button"
          disabled={busy || !item.assignedAt} aria-busy={Boolean(busy)}
          onClick={onTakeover}
          className={`${rowActionClass} border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100`}
        >
          {busy ? 'กำลังทำรายการ...' : 'รับช่วงต่อ'}
        </button>
      )}
      {live && item.assignedToMe && showReply && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onReply}
          className={`${rowActionClass} border-green-300 bg-green-50 text-green-700 hover:bg-green-100`}
        >
          {busy ? 'กำลังทำรายการ...' : supportReplyWithinRetryWindow(item) ? 'ลองส่งข้อความเดิม' : 'ตอบใน LINE'}
        </button>
      )}
      {live && item.assignedToMe && canManageAi(item.status) && item.assistantActive !== undefined && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onToggleAi}
          aria-label={item.assistantActive ? 'AI กำลังทำงาน กดเพื่อหยุด AI' : 'AI ไม่ได้ทำงาน กดเพื่อให้ AI ทำงาน'}
          title={item.assistantActive ? 'กดเพื่อหยุด AI' : 'กดเพื่อให้ AI ทำงาน'}
          className={`${rowActionClass} ${item.assistantActive
            ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
            : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'}`}
        >
          {busy ? 'กำลังทำรายการ...' : item.assistantActive ? 'AI กำลังทำงาน' : 'AI ไม่ได้ทำงาน'}
        </button>
      )}
      {live && item.assignedToMe && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onResolve}
          className={`${rowActionClass} border-green-300 bg-white text-green-700 hover:bg-green-50`}
        >
          {busy ? 'กำลังทำรายการ...' : 'แก้ไขสำเร็จและปิดเคส'}
        </button>
      )}
      {live && item.assignedToMe && (
        <button
          type="button"
          disabled={busy} aria-busy={Boolean(busy)}
          onClick={onRelease}
          className={`${rowActionClass} border-gray-300 bg-white text-gray-500 hover:bg-gray-50`}
        >
          {busy ? 'กำลังทำรายการ...' : 'ปล่อยเคส'}
        </button>
      )}
      {!href && !live && !onOpenThread && (
        <span className="text-xs text-gray-400">—</span>
      )}
    </div>
  );
}

/**
 * Everything below the tabs: the error banner OR the table, never both.
 *
 * Extracted from the page so that "an error replaces the table" is a RENDER assertion rather than
 * a regex over the source. It used to be neither — the table rendered unconditionally under the
 * banner, so a first-load 403 told an operator "ไม่มีคำขอในกลุ่มนี้", which is the one thing a
 * permission error does not know. Having the decision in one function is what makes rendering with
 * `error` set provably unable to produce a table.
 */
export function SupportInboxBody({
  error, loading, loadingMore, items, busyId, totalCount, nextCursor,
  onRetry, onLoadMore, onClaim, onRelease, onTakeover, onReply, onResolve, onToggleAi, onOpenThread,
}: {
  error: string | null;
  loading: boolean;
  loadingMore: boolean;
  items: SupportRequestItemDto[];
  busyId: string | null;
  totalCount: number;
  nextCursor: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  onClaim: (item: SupportRequestItemDto) => void;
  onRelease: (item: SupportRequestItemDto) => void;
  onTakeover: (item: SupportRequestItemDto) => void;
  onReply: (item: SupportRequestItemDto) => void;
  onResolve: (item: SupportRequestItemDto) => void;
  onToggleAi: (item: SupportRequestItemDto) => void;
  onOpenThread?: (item: SupportRequestItemDto) => void;
}) {
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
        <button type="button" className="ml-3 underline" onClick={onRetry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="md:overflow-x-auto">
        <table className="block w-full text-left text-sm md:table md:min-w-full md:divide-y md:divide-gray-200">
          <thead className="hidden bg-gray-50 text-xs font-medium uppercase text-gray-500 md:table-header-group">
            <tr>
              <th className="px-4 py-3">ผู้ขอ</th>
              <th className="px-4 py-3">รอมานาน</th>
              {/* Not "ข้อความล่าสุด" any more: the cell carries the QUESTION as well as the newest
                  message, which is the point of splitting them. */}
              <th className="px-4 py-3">ข้อความ</th>
              <th className="px-4 py-3">แจ้งทีมงาน</th>
              <th className="px-4 py-3">การทำงาน</th>
            </tr>
          </thead>
          <tbody className="block divide-y divide-gray-100 text-gray-700 md:table-row-group">
            {loading ? (
              [...Array(4)].map((_, i) => <SkeletonRow key={i} />)
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-gray-400">
                  ไม่มีคำขอในกลุ่มนี้
                </td>
              </tr>
            ) : items.map((item) => {
              const closedReason = supportClosedReasonTh(item.closedReason);
              // A request the customer wrote back to is OPEN like any other; without this it reads
              // as a first ask, and the operator answers a conversation already in progress blind.
              const reopened = supportReopenedChip(item);
              const replyState = supportReplyChip(item.lastReplyDeliveryStatus);
              // What they ASKED, and where the thread has got to. One column used to hold both, so
              // a nudge ("มีอัปเดตไหมคะ") left the operator with no idea what was being asked. Rows
              // raised before the split have only the newest message, which is then the question.
              const question = item.requestText ?? item.lastMessageText;
              const latest = item.lastMessageText && item.lastMessageText !== question
                ? item.lastMessageText
                : null;
              return (
                <tr key={item.id} className="block p-4 align-top hover:bg-gray-50 md:table-row md:p-0">
                  {/* Bounded for the same reason the message cell is: the applicant label
                      ("ผู้ที่ยังไม่ได้เปิดร้าน (มีคำขอสมัคร: …)") carries a shop name an operator
                      did not choose the length of. */}
                  <td className="block px-0 py-2 md:table-cell md:max-w-[14rem] md:px-4 md:py-3">
                    <p className="break-words font-medium text-gray-900">{item.askerLabel}</p>
                    {/* §3 PDPA: a fragment of the hash, so two rows can be matched to one person
                        without a LINE id ever reaching this page. */}
                    <p className="mt-0.5 text-xs text-gray-400">รหัสผู้ขอ {item.askerRef}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <ChipBadge chip={supportStatusChip(item.status)} />
                      {reopened && <ChipBadge chip={reopened} />}
                      {closedReason && <span className="text-xs text-gray-400">{closedReason}</span>}
                    </div>
                    {item.answeredByDisplayName && (
                      <p className="mt-0.5 text-xs text-gray-500">ตอบโดย {item.answeredByDisplayName}</p>
                    )}
                    {item.assignedAt && (
                      <p className="mt-1 text-xs font-medium text-gray-600">
                        ผู้รับผิดชอบ: {item.assignedToMe ? 'คุณ' : item.assigneeDisplayName ?? 'ทีมงานเดิม'}
                      </p>
                    )}
                    {item.assignmentNote && (
                      <p className="mt-0.5 line-clamp-2 break-words text-xs text-gray-500" title={item.assignmentNote}>
                        เหตุผลรับช่วงต่อ: {item.assignmentNote}
                      </p>
                    )}
                  </td>
                  <td className="block border-t border-gray-100 px-0 py-2 text-xs text-gray-600 md:table-cell md:border-0 md:px-4 md:py-3">
                    {/* The clock stops when somebody answered or the request closed: a settled
                        row that keeps counting reads as a customer still waiting. */}
                    <p className="text-gray-500">{waitedLabelTh(item)}</p>
                    <p className="font-medium text-gray-900">{waitedForTh(item)}</p>
                    {/* The stamp the duration above is measured from, so the two cannot disagree:
                        the ask for a request nobody has written to since, and the newest customer
                        message once they have. */}
                    <p className="mt-0.5 text-gray-500">{formatThaiDateTime(item.lastMessageAt)}</p>
                  </td>
                  {/* 200 characters of Thai in an unconstrained cell pushed the action column off
                      a 390px screen. Bounded, clamped and breakable; the full text is on the title
                      attribute for anyone who needs it.

                      NO `block` here: Tailwind emits `.block{display:block}` after
                      `.line-clamp-2`, so it overrides the `-webkit-box` the clamp needs and the
                      cell renders all 200 characters (352px tall at 390px, measured). Every other
                      `line-clamp-2` in this repo omits it for the same reason. */}
                  <td className="block border-t border-gray-100 px-0 py-2 text-xs text-gray-600 md:table-cell md:max-w-[16rem] md:border-0 md:px-4 md:py-3">
                    <p className="mb-1 font-medium text-gray-500 md:hidden">ข้อความลูกค้า</p>
                    {question ? (
                      <p className="break-words md:line-clamp-2" title={question}>
                        “{question}”
                      </p>
                    ) : null}
                    {/* Only when it has moved on: on a request nobody has followed up the two are
                        the same sentence, and printing it twice reads as two messages. */}
                    {latest && (
                      <p className="mt-1 break-words text-gray-500 md:line-clamp-2" title={latest}>
                        ล่าสุด: “{latest}”
                      </p>
                    )}
                    {/* §3 keeps the bytes out of the record, so this is the whole of what a photo
                        leaves behind — beside the words, never in place of them. */}
                    {item.lastMediaAt && <span className="mt-1 text-gray-500">📷 ส่งรูปมา</span>}
                    {!question && !item.lastMediaAt && '—'}
                    {item.lastReplyText && (
                      <div className="mt-2 border-t border-gray-100 pt-2">
                        <p className="font-medium text-gray-500">
                          ทีมงาน{item.lastReplyByDisplayName ? ` (${item.lastReplyByDisplayName})` : ''} ถามล่าสุด
                        </p>
                        <p className="mt-0.5 break-words md:line-clamp-2" title={item.lastReplyText}>“{item.lastReplyText}”</p>
                        {replyState && <div className="mt-1"><ChipBadge chip={replyState} /></div>}
                      </div>
                    )}
                    {item.requestedInformation && (
                      <div className="mt-2 rounded border border-blue-100 bg-blue-50 p-2 text-blue-800">
                        <p className="font-medium">ข้อมูลที่ทีมงานขอเพิ่มเติม</p>
                        <p className="mt-0.5 break-words">{item.requestedInformation}</p>
                      </div>
                    )}
                    {item.resolutionNote && (
                      <p className="mt-2 break-words text-gray-500">ผลที่บันทึก: {item.resolutionNote}</p>
                    )}
                  </td>
                  <td className="block border-t border-gray-100 px-0 py-2 md:table-cell md:border-0 md:px-4 md:py-3">
                    <p className="mb-1 text-xs font-medium text-gray-500 md:hidden">การแจ้งทีมงาน</p>
                    <ChipBadge chip={notifiedSummary(item)} />
                  </td>
                  <td className="block border-t border-gray-100 px-0 py-2 md:table-cell md:border-0 md:px-4 md:py-3">
                    <p className="mb-1 text-xs font-medium text-gray-500 md:hidden">จัดการเคส</p>
                    <SupportRowActions
                      item={item}
                      busy={busyId === item.id}
                      onClaim={() => onClaim(item)}
                      onRelease={() => onRelease(item)}
                      onTakeover={() => onTakeover(item)}
                      onReply={() => onReply(item)}
                      onResolve={() => onResolve(item)}
                      onToggleAi={() => onToggleAi(item)}
                      {...(onOpenThread ? { onOpenThread: () => onOpenThread(item) } : {})}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!loading && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-500">
          <span>แสดง {items.length} จาก {totalCount} เคส</span>
          {nextCursor && (
            <button
              type="button"
              disabled={loadingMore}
              onClick={onLoadMore}
              className={`${rowActionClass} border-gray-300 bg-white text-gray-700 hover:bg-gray-50`}
            >
              {loadingMore ? 'กำลังโหลด...' : 'โหลดเคสเก่าถัดไป'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * line-support-request-spec-th §2.3 — "คำขอคุยกับเจ้าหน้าที่".
 *
 * Owner 2026-09-05: no operator has LINE linked, so this page is the PRIMARY channel, not a
 * secondary view of one. A request appears here the moment a customer taps, whether or not any
 * notification went anywhere — which is why `notifiedSummary` reads as information and only the
 * "nothing reached anybody" case is coloured as a fault.
 */
export default function SupportRequestsPage() {
  const toast = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const { promptInput, inputPromptDialog } = useInputPrompt();
  const [items, setItems] = useState<SupportRequestItemDto[]>([]);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<SupportQueueTab>('OPEN');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * สัญญา v3 ข้อ 11: the case whose chat is open. The window's every poll hands back the fresh row
   * (`handleThreadChanged`), so this is never staler than the server; `threadRefreshKey` makes the
   * window refetch the moment an action here succeeds.
   */
  const [threadItem, setThreadItem] = useState<SupportRequestItemDto | null>(null);
  const [threadRefreshKey, setThreadRefreshKey] = useState(0);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  /**
   * Which read is allowed to write state. Tab switches and post-action reloads overlap, and without
   * this the slower of two in-flight reads wins — showing the previous tab's rows under the new
   * tab's heading. A counter rather than only an AbortController because an abort is best-effort:
   * a response already in flight still resolves, and this is what makes it harmless.
   */
  const readSeq = useRef(0);
  const inFlight = useRef<AbortController | null>(null);

  const load = async (next: SupportQueueTab = tab, cursor?: string, append = false) => {
    const seq = ++readSeq.current;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    if (append) setLoadingMore(true);
    else {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await listSupportRequests(next, cursor, { signal: controller.signal });
      if (seq !== readSeq.current) return;
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setOpenCount(result.openCount);
      setTotalCount(result.totalCount);
      setNextCursor(result.nextCursor);
      // One number, one source: the nav badge above this page reads what we just read.
      publishSupportOpenCount(result.openCount);
    } catch (err) {
      if (seq !== readSeq.current) return;
      const e = err as Error & { status?: number };
      // Cleared, not left standing: rows under a permission error read as "the queue is empty",
      // and rows from the previous tab under a failed switch read as this tab's contents.
      const message = e.status === 403 ? 'คุณไม่มีสิทธิ์ดูคำขอคุยกับเจ้าหน้าที่' : apiErrorMessage(err);
      if (append) toast.error(message);
      else {
        setItems([]);
        setError(message);
      }
    } finally {
      if (seq === readSeq.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    void load('OPEN');
    return () => inFlight.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectTab = (next: SupportQueueTab) => {
    setTab(next);
    void load(next);
  };

  const patchRow = (id: string, patch: Partial<SupportRequestItemDto>) => {
    setItems((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    setThreadItem((current) => current && current.id === id ? { ...current, ...patch } : current);
  };

  const handleThreadChanged = (request: SupportRequestItemDto) => {
    setThreadItem(request);
    // A status that no longer matches this tab (the customer wrote back while the window was
    // open) means the row and the badge both moved: reload rather than paint it under the wrong
    // heading. Otherwise the fresh row replaces the stale one in place.
    if (request.status !== tab) {
      void load();
      return;
    }
    setItems((current) => current.map((row) => row.id === request.id ? request : row));
  };

  const mutate = async (item: SupportRequestItemDto, action: () => Promise<unknown>, success: string) => {
    setBusyId(item.id);
    try {
      await action();
      toast.success(success);
      setThreadRefreshKey((key) => key + 1);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleClaim = (item: SupportRequestItemDto) =>
    mutate(item, () => claimSupportRequest(item.id), 'รับผิดชอบเคสนี้แล้ว');

  const handleRelease = async (item: SupportRequestItemDto) => {
    if (!await confirm({
      title: 'ปล่อยเคส',
      message: 'เคสจะกลับไปรอทีมงานคนอื่นรับผิดชอบ และยังไม่ถือว่าแก้ไขสำเร็จ',
      confirmLabel: 'ปล่อยเคส',
      variant: 'primary',
    })) return;
    await mutate(item, () => releaseSupportRequest(item.id), 'ปล่อยเคสแล้ว');
  };

  const handleTakeover = async (item: SupportRequestItemDto) => {
    if (!item.assignedAt) {
      toast.error('ข้อมูลผู้รับผิดชอบเปลี่ยนแล้ว กรุณาโหลดใหม่');
      return;
    }
    const reason = await promptInput({
      title: 'รับช่วงต่อจากผู้รับผิดชอบเดิม',
      message: `เคสนี้อยู่กับ ${item.assigneeDisplayName ?? 'ทีมงานคนอื่น'} กรุณาระบุเหตุผลเพื่อให้ประวัติตรวจสอบได้`,
      label: 'เหตุผลที่รับช่วงต่อ',
      placeholder: 'เช่น ผู้รับผิดชอบเดิมลางาน และลูกค้ากำลังรอคำตอบ',
      confirmLabel: 'รับช่วงต่อ',
      variant: 'primary',
    });
    if (!reason) return;
    await mutate(
      item,
      () => reclaimSupportRequest(item.id, item.assignedAt!, reason),
      'รับช่วงต่อเคสนี้แล้ว',
    );
  };

  /**
   * A retry of an unresolved send is confirmed and resent as before. NEW words come from the chat
   * window's composer (สัญญา v3 ข้อ 11): the row's "ตอบใน LINE" opens the window, and only the window
   * hands a sentence back here. Resolves true when the reply was accepted, so the composer clears.
   */
  const handleReply = async (item: SupportRequestItemDto, composed?: string): Promise<boolean> => {
    const retrySame = Boolean(
      item.replyOperationId && item.lastReplyText && supportReplyWithinRetryWindow(item),
    );
    let text = item.lastReplyText ?? '';
    let operationId = item.replyOperationId ?? crypto.randomUUID();
    if (retrySame) {
      const retry = await confirm({
        title: 'ลองส่งข้อความเดิมอีกครั้ง',
        message: `ระบบจะใช้รหัสส่งเดิมเพื่อป้องกันข้อความซ้ำ และส่งข้อความเดิมนี้เท่านั้น: “${item.lastReplyText}”`,
        confirmLabel: 'ลองส่งข้อความเดิม',
        variant: 'primary',
      });
      if (!retry) return false;
    } else {
      if (composed === undefined) {
        setThreadItem(item);
        // After the window has mounted: the caret goes where the reply is typed.
        setTimeout(() => composerRef.current?.focus(), 50);
        return false;
      }
      text = composed.trim();
      if (!text) return false;
      if (text.length > PARTNER_LINE_MESSAGE_MAX_LENGTH) {
        toast.error(`ข้อความยาวเกิน ${PARTNER_LINE_MESSAGE_MAX_LENGTH} ตัวอักษร กรุณาย่อแล้วลองใหม่`);
        return false;
      }
      operationId = crypto.randomUUID();
    }
    patchRow(item.id, {
      replyOperationId: operationId,
      replyFirstAttemptAt: retrySame ? item.replyFirstAttemptAt : new Date().toISOString(),
      lastReplyText: text,
      lastReplyDeliveryStatus: 'PENDING',
      lastReplyError: undefined,
    });
    setBusyId(item.id);
    try {
      const result = await replySupportRequest(item.id, {
        text,
        operationId,
        previousReplyOperationId: item.replyOperationId ?? null,
      });
      if (result.deliveryStatus === 'SENT') {
        toast.success(result.newerCustomerMessage
          ? 'ส่งข้อความแล้ว แต่ลูกค้าส่งข้อความใหม่เข้ามา เคสจึงยังรอตอบ'
          : 'ส่งข้อความถึงลูกค้าแล้ว');
      } else {
        toast.error('ยังยืนยันไม่ได้ว่าส่งข้อความถึงลูกค้า กรุณาลองส่งข้อความเดิมอีกครั้ง');
      }
      setThreadRefreshKey((key) => key + 1);
      await load();
      return true;
    } catch (err) {
      toast.error(apiErrorMessage(err));
      setThreadRefreshKey((key) => key + 1);
      await load();
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const handleResolve = async (item: SupportRequestItemDto) => {
    const note = await promptInput({
      title: 'แก้ไขสำเร็จและปิดเคส',
      message: 'ใช้เมื่อได้ผลลัพธ์จริงแล้วเท่านั้น การส่งข้อความหรือให้ AI ทำงานต่ออย่างเดียวยังไม่ใช่การแก้ไขสำเร็จ',
      label: 'ผลที่แก้ไขให้ลูกค้า',
      placeholder: 'เช่น ลูกค้าส่งข้อมูลครบ ทีมงานเปิดร้านและยืนยันว่าเข้าใช้งานได้แล้ว',
      confirmLabel: 'บันทึกและปิดเคส',
      variant: 'primary',
    });
    if (!note) return;
    await mutate(item, () => resolveSupportRequest(item.id, note), 'บันทึกว่าแก้ไขสำเร็จและปิดเคสแล้ว');
  };

  const handleToggleAi = async (item: SupportRequestItemDto) => {
    if (item.assistantActive === undefined) return;
    const nextActive = !item.assistantActive;
    const ok = await confirm({
      title: nextActive ? 'ให้ AI ทำงาน' : 'หยุด AI',
      message: nextActive
        ? `น้องมั่งมีจะกลับมาตอบในแชทของ ${item.askerLabel} เคสนี้ยังอยู่กับทีมงานจนกว่าจะบันทึกว่าแก้ไขสำเร็จ`
        : `น้องมั่งมีจะหยุดตอบในแชทของ ${item.askerLabel} ข้อความและรูปใหม่จะส่งให้ทีมงานโดยไม่เข้า AI`,
      confirmLabel: nextActive ? 'ให้ AI ทำงาน' : 'หยุด AI',
      variant: nextActive ? 'primary' : 'danger',
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      const result = await setSupportRequestAiActive(item.id, nextActive);
      patchRow(item.id, { assistantActive: result.assistantActive ?? nextActive });
      toast.success(nextActive ? 'AI กลับมาทำงานแล้ว เคสยังไม่ถูกปิด' : 'หยุด AI แล้ว ข้อความใหม่จะส่งให้ทีมงาน');
      setThreadRefreshKey((key) => key + 1);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-dvh bg-gray-50 p-6">
      {confirmDialog}
      {inputPromptDialog}
      {threadItem && (
        <SupportThreadModal
          item={threadItem}
          refreshKey={threadRefreshKey}
          composerRef={composerRef}
          sending={busyId === threadItem.id}
          onClose={() => setThreadItem(null)}
          onSend={(text) => handleReply(threadItem, text)}
          onThreadChanged={handleThreadChanged}
          actions={(
            <SupportRowActions
              item={threadItem}
              busy={busyId === threadItem.id}
              // The composer is the way to answer; the row's button stays only as the retry.
              showReply={supportComposerMode(threadItem) === 'retry'}
              onClaim={() => void handleClaim(threadItem)}
              onRelease={() => void handleRelease(threadItem)}
              onTakeover={() => void handleTakeover(threadItem)}
              onReply={() => void handleReply(threadItem)}
              onResolve={() => void handleResolve(threadItem)}
              onToggleAi={() => void handleToggleAi(threadItem)}
            />
          )}
        />
      )}

      <div className="mx-auto max-w-6xl space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">คำขอคุยกับเจ้าหน้าที่</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            ลูกค้าที่กด ติดต่อเจ้าหน้าที่ ใน LINE จะขึ้นที่นี่ทันที กด เปิดแชท เพื่อดูทุกข้อความและรูปที่ลูกค้าส่งมา
            รับเคสแล้วตอบกลับใน LINE ได้จากแชทนั้น รวมถึงผู้สมัครที่ยังไม่มีร้าน โดยไม่เปิดเผย LINE ID
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {SUPPORT_QUEUE_TABS.map((t) => {
            const active = tab === t.key;
            // Only the OPEN total is known without loading that tab; the others show no count
            // rather than a confident zero.
            const count = t.key === 'OPEN' ? openCount : null;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => selectTab(t.key)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'border-brand-200 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-500 hover:text-gray-900'
                }`}
              >
                {t.label}
                {count !== null && <span className="ml-1.5 text-xs text-gray-400">{count}</span>}
              </button>
            );
          })}
        </div>

        <SupportInboxBody
          error={error}
          loading={loading}
          loadingMore={loadingMore}
          items={items}
          busyId={busyId}
          totalCount={totalCount}
          nextCursor={nextCursor}
          onRetry={() => void load()}
          onLoadMore={() => nextCursor && void load(tab, nextCursor, true)}
          onClaim={(item) => void handleClaim(item)}
          onRelease={(item) => void handleRelease(item)}
          onTakeover={(item) => void handleTakeover(item)}
          onReply={(item) => void handleReply(item)}
          onResolve={(item) => void handleResolve(item)}
          onToggleAi={(item) => void handleToggleAi(item)}
          onOpenThread={(item) => setThreadItem(item)}
        />
      </div>
    </div>
  );
}
