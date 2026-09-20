'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  PARTNER_LINE_MESSAGE_MAX_LENGTH,
  type SupportRequestItemDto,
  type SupportRequestMessageDto,
} from '@watchdog-bms/contracts';
import { apiErrorMessage } from '@/common/api/api-error-message';
import { Modal } from '@/common/components/modal';
import { formatThaiDateTime } from '@/common/i18n/thai-date';
import { getSupportRequestThread, supportMessageContentUrl } from './support-requests.api';
import { ChipBadge } from './SupportChip';
import {
  supportClosedReasonTh,
  supportComposerHintTh,
  supportComposerMode,
  supportMediaErrorTh,
  supportPreviousReplyUncertain,
  supportReopenedChip,
  supportStatusChip,
} from './support-requests.logic';

/** Same cadence as the CRM inbox: fresh enough to see a customer write back while the window is open. */
const THREAD_POLL_MS = 10_000;

/** Non-text bubble content: the real picture/file when stored, an honest placeholder otherwise. */
function SupportMediaContent({ requestId, message }: { requestId: string; message: SupportRequestMessageDto }) {
  if (message.hasContent) {
    const url = supportMessageContentUrl(requestId, message.id);
    if (message.kind === 'IMAGE') {
      return (
        <a href={url} target="_blank" rel="noreferrer" title="เปิดรูปเต็ม">
          {/* eslint-disable-next-line @next/next/no-img-element -- streamed from our API, size unknown */}
          <img src={url} alt={message.fileName ?? 'รูปจากลูกค้า'} className="max-h-64 max-w-full rounded-lg" />
        </a>
      );
    }
    return (
      <a href={url} className="inline-flex items-center gap-1.5 underline">
        📎 {message.fileName ?? 'ดาวน์โหลดไฟล์'}
      </a>
    );
  }
  // Claimed but not stored (yet): a fetch still in flight, or one that failed and said why.
  return (
    <span className="text-gray-500">
      {message.mediaError ? `⚠️ ${supportMediaErrorTh(message.mediaError)}` : 'กำลังเก็บไฟล์…'}
    </span>
  );
}

/** One bubble: customer on the left, staff on the right — the CRM inbox's convention. */
export function SupportMessageBubble({ requestId, message }: { requestId: string; message: SupportRequestMessageDto }) {
  const staff = message.direction === 'STAFF';
  const failed = message.deliveryStatus === 'FAILED';
  const pending = message.deliveryStatus === 'PENDING';
  return (
    <div className={`my-2 flex ${staff ? 'justify-end' : 'justify-start'}`} data-direction={message.direction}>
      <div className="min-w-0 max-w-[80%]">
        {staff && (
          <p className="mb-0.5 text-right text-[11px] text-gray-500">
            ทีมงาน{message.senderName ? ` · ${message.senderName}` : ''}
          </p>
        )}
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
            staff
              ? `${failed ? 'bg-red-400' : 'bg-brand-500'} rounded-br-sm text-white`
              : 'rounded-bl-sm border border-gray-200 bg-white text-gray-900'
          }`}
        >
          {message.kind === 'TEXT'
            ? message.text
            : <SupportMediaContent requestId={requestId} message={message} />}
        </div>
        <p className={`mt-1 text-[11px] text-gray-400 ${staff ? 'text-right' : ''}`}>
          {failed && <span className="font-semibold text-red-600">ส่งไม่สำเร็จ · </span>}
          {pending && <span className="font-medium text-yellow-700">ยังไม่ทราบผลส่ง · </span>}
          {!staff && message.kind !== 'TEXT' && (message.kind === 'IMAGE' ? 'รูปภาพ · ' : 'ไฟล์ · ')}
          {formatThaiDateTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

/**
 * The stream itself. Exported so a spec can RENDER a photo, a staff bubble and a pre-v3 case.
 *
 * A request raised before สัญญา v3 (or opened by an operator from the signup queue) has no thread
 * rows: it shows the row's own summaries and says so, rather than dressing two 200-character fields
 * up as a conversation that was never recorded.
 */
export function SupportThreadMessages({ request, messages }: {
  request: SupportRequestItemDto;
  messages: SupportRequestMessageDto[];
}) {
  if (messages.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 bg-white p-3 text-xs text-gray-600">
        <p className="font-medium text-gray-700">ยังไม่มีข้อความในแชทนี้ — เคสที่เปิดก่อนมีระบบแชท หรือเปิดโดยทีมงานจากคิวสมัคร จะมีเฉพาะข้อความสรุปจากแถวเคส</p>
        {request.lastMessageText && (
          <p className="mt-1.5 break-words">ลูกค้าล่าสุด: “{request.lastMessageText}”</p>
        )}
        {request.lastMediaAt && (
          <p className="mt-1">📷 ส่งรูปมาเมื่อ {formatThaiDateTime(request.lastMediaAt)} (ยังไม่ได้เก็บรูปในตอนนั้น)</p>
        )}
        {request.lastReplyText && (
          <p className="mt-1 break-words">
            ทีมงาน{request.lastReplyByDisplayName ? ` (${request.lastReplyByDisplayName})` : ''} ตอบล่าสุด: “{request.lastReplyText}”
          </p>
        )}
      </div>
    );
  }
  return <>{messages.map((message) => <SupportMessageBubble key={message.id} requestId={request.id} message={message} />)}</>;
}

/**
 * line-support-request-spec-th สัญญา v3 ข้อ 11 — one case as a chat, from the tap to the close.
 *
 * The page owns the row and every action on it (claim, reply, resolve…); this window owns only the
 * thread read and the composer. `item` is whatever the page currently knows, and every poll hands
 * the page the fresh row through `onThreadChanged`, so the header, the composer's gating and the
 * `actions` the page renders in the footer never disagree with the server.
 */
export function SupportThreadModal({
  item, refreshKey, composerRef, actions, sending, onClose, onSend, onThreadChanged,
}: {
  item: SupportRequestItemDto;
  /** Bumped by the page after every successful action, so the thread refetches at once. */
  refreshKey: number;
  /** The page focuses this from its own "ตอบใน LINE" button. */
  composerRef: RefObject<HTMLTextAreaElement | null>;
  /** The row's own buttons, rendered by the page so their handlers stay in one place. */
  actions: ReactNode;
  sending: boolean;
  onClose: () => void;
  /** Resolves true when the reply was accepted (the composer then clears). */
  onSend: (text: string) => Promise<boolean>;
  onThreadChanged: (request: SupportRequestItemDto) => void;
}) {
  const [messages, setMessages] = useState<SupportRequestMessageDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const readSeq = useRef(0);
  // The latest callback without re-running the poll effect on every page render.
  const changed = useRef(onThreadChanged);
  changed.current = onThreadChanged;

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const read = async () => {
      const seq = ++readSeq.current;
      try {
        const thread = await getSupportRequestThread(item.id, { signal: controller.signal });
        if (disposed || seq !== readSeq.current) return;
        setMessages(thread.messages);
        setError(null);
        changed.current(thread.request);
      } catch (err) {
        if (disposed || seq !== readSeq.current) return;
        setError(apiErrorMessage(err));
      }
    };
    void read();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void read();
    }, THREAD_POLL_MS);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [item.id, refreshKey]);

  // Newest message in view, the way a chat reads: on first load and whenever one arrives.
  const count = messages?.length ?? 0;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);

  const mode = supportComposerMode(item);
  const hint = supportComposerHintTh(mode, item.assigneeDisplayName);
  const uncertain = mode === 'compose' && supportPreviousReplyUncertain(item);
  const reopened = supportReopenedChip(item);
  const closedReason = supportClosedReasonTh(item.closedReason);

  const submit = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (await onSend(text)) setDraft('');
  };

  return (
    <Modal
      open
      size="lg"
      bodyScroll={false}
      bodyClassName="p-0"
      onClose={onClose}
      title={(
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span>แชทกับ {item.askerLabel}</span>
          {/* §3: the hash fragment, never a LINE id or a LINE display name. */}
          <span className="text-xs font-normal text-gray-400">รหัสผู้ขอ {item.askerRef}</span>
        </div>
      )}
      footer={actions}
    >
      <div className="border-b border-gray-200 bg-white px-4 py-3 text-xs text-gray-600 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <ChipBadge chip={supportStatusChip(item.status)} />
          {reopened && <ChipBadge chip={reopened} />}
          {closedReason && <span className="text-gray-400">{closedReason}</span>}
          {item.assignedAt && (
            <span className="font-medium text-gray-700">
              ผู้รับผิดชอบ: {item.assignedToMe ? 'คุณ' : item.assigneeDisplayName ?? 'ทีมงานเดิม'}
            </span>
          )}
        </div>
        {item.requestText && (
          <p className="mt-1.5 break-words"><span className="font-medium text-gray-700">คำถามตั้งต้น:</span> “{item.requestText}”</p>
        )}
        {/* สัญญา v2 ข้อ 5: the staff question comes from the signup relation, never dressed up as a bubble. */}
        {item.requestedInformation && (
          <div className="mt-1.5 rounded border border-blue-100 bg-blue-50 p-2 text-blue-800">
            <p className="font-medium">ข้อมูลที่ทีมงานขอเพิ่มเติม</p>
            <p className="mt-0.5 break-words">{item.requestedInformation}</p>
          </div>
        )}
        {item.resolutionNote && (
          <p className="mt-1.5 break-words text-gray-500">ผลที่บันทึก: {item.resolutionNote}</p>
        )}
        <p className="mt-1 text-gray-400">
          เริ่ม {formatThaiDateTime(item.requestedAt)}{item.closedAt ? ` · ปิดเคส ${formatThaiDateTime(item.closedAt)}` : ''}
        </p>
      </div>

      <div ref={listRef} className="min-h-40 flex-1 overflow-y-auto bg-gray-50 px-4 py-3 sm:min-h-[40vh] sm:px-5">
        {error && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        {messages === null
          ? (!error && <p className="py-8 text-center text-sm text-gray-400">กำลังโหลดแชท…</p>)
          : <SupportThreadMessages request={item} messages={messages} />}
      </div>

      <div className="border-t border-gray-200 bg-white px-4 py-3 sm:px-5">
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
        {mode === 'compose' && (
          <>
            {uncertain && (
              <p className="mb-2 rounded border border-yellow-200 bg-yellow-50 px-2 py-1.5 text-xs text-yellow-800">
                พ้นช่วงลองส่งเดิมอย่างปลอดภัยแล้ว ข้อความก่อนหน้าอาจถึงลูกค้า กรุณาตรวจก่อนเขียนข้อความใหม่ให้ชัดเจน
              </p>
            )}
            <label htmlFor="support-thread-composer" className="block text-xs font-medium text-gray-700">ข้อความถึงลูกค้า</label>
            <textarea
              id="support-thread-composer"
              ref={composerRef}
              value={draft}
              rows={3}
              maxLength={PARTNER_LINE_MESSAGE_MAX_LENGTH}
              placeholder="ถ้าต้องขอข้อมูลเพิ่ม กรุณาระบุข้อมูลที่ขาดทั้งหมด วิธีส่ง และสิ่งที่จะเกิดขึ้นต่อให้ครบในข้อความเดียว"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-400 focus:outline-none"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] text-gray-400">
                {draft.length}/{PARTNER_LINE_MESSAGE_MAX_LENGTH} · ส่งในนามทีมงาน · ⌘/Ctrl+Enter เพื่อส่ง
              </span>
              <button
                type="button"
                disabled={sending || !draft.trim()}
                aria-busy={sending}
                onClick={() => void submit()}
                className="min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40 md:min-h-0"
              >
                {sending ? 'กำลังส่ง…' : 'ส่งใน LINE'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
