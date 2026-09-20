import type { SupportRequestItemDto, SupportRequestMediaError, SupportRequestStatus } from '@watchdog-bms/contracts';

export type ChipTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';
export type Chip = { label: string; tone: ChipTone };

export type SupportQueueTab = 'OPEN' | 'ANSWERED' | 'CLOSED';

/** OPEN first: it is the only tab with anybody waiting in it. */
export const SUPPORT_QUEUE_TABS: ReadonlyArray<{ key: SupportQueueTab; label: string }> = [
  { key: 'OPEN', label: 'รอตอบ' },
  { key: 'ANSWERED', label: 'ตอบแล้ว' },
  { key: 'CLOSED', label: 'ปิดแล้ว' },
];

export function supportStatusChip(status: SupportRequestStatus): Chip {
  if (status === 'OPEN') return { label: 'รอตอบ', tone: 'warning' };
  if (status === 'ANSWERED') return { label: 'ตอบแล้ว', tone: 'success' };
  return { label: 'ปิดแล้ว', tone: 'neutral' };
}

/**
 * UAT 2026-09-06. A request that was answered and then written to again is OPEN like any other, and
 * looked like a brand new one — so an operator could not tell they were rejoining a conversation
 * already in progress. `answeredAt` survives the reopen precisely so this chip can say so.
 */
export function supportReopenedChip(
  item: Pick<SupportRequestItemDto, 'status' | 'reopenedCount'>,
): Chip | null {
  // The count is the whole claim — no floor. Flooring it at 1 made a row with an answer and no
  // reopen say "ลูกค้าตอบกลับ" about a customer who had not written back.
  if (item.status !== 'OPEN' || item.reopenedCount < 1) return null;
  // One reopen follows exactly one answer, so the count IS how many times we have replied.
  return { label: `ตอบแล้ว ${item.reopenedCount} ครั้ง · ลูกค้าตอบกลับ`, tone: 'info' };
}

export function supportClosedReasonTh(reason: string | undefined): string | null {
  if (reason === 'resolved') return 'แก้ไขสำเร็จและปิดเคสแล้ว';
  if (reason === 'admin') return 'ทีมงานให้ AI ทำงานต่อ';
  if (reason === 'customer_resumed') return 'ลูกค้าเรียก AI กลับเอง';
  if (reason === 'expired') return 'ครบ 24 ชั่วโมง';
  return null;
}

type WaitWindow = Pick<
  SupportRequestItemDto, 'status' | 'requestedAt' | 'lastMessageAt' | 'answeredAt' | 'closedAt'
>;

/** Equal to `requestedAt` until the customer writes again — see `lastMessageAt` in the contract. */
const waitStartedAt = (item: WaitWindow): string => item.lastMessageAt ?? item.requestedAt;

/**
 * The clock STOPS when somebody answered, or when the request closed. A settled row that keeps
 * counting reads as a customer still waiting, which is the one thing this column exists to say.
 * `answeredAt` wins over `closedAt`: being answered is when the waiting actually ended.
 *
 * An OPEN row is never settled, whatever `answeredAt` says: after a reopen it carries the previous
 * answer as history, and stopping there would have read "ใช้เวลา 30 นาที" over a customer who has
 * been waiting since (UAT 2026-09-06).
 *
 * And a settling stamp OLDER than the start is not this wait's end at all — it belongs to the
 * round trip before it. A reopened-then-closed row ended at its `closedAt`; taking the earlier
 * `answeredAt` made the duration negative, which printed as "ใช้เวลา —" over a real wait.
 */
const waitEndedAt = (item: WaitWindow): string | undefined => {
  if (item.status === 'OPEN') return undefined;
  const started = new Date(waitStartedAt(item)).getTime();
  const settled = (at: string | undefined) => (at && new Date(at).getTime() >= started ? at : undefined);
  // `answeredAt` still wins over `closedAt` when both are this wait's: being answered is when the
  // waiting actually ended, and the close that follows it is bookkeeping.
  return settled(item.answeredAt) ?? settled(item.closedAt);
};

export function waitedLabelTh(item: WaitWindow): string {
  return waitEndedAt(item) ? 'ใช้เวลา' : 'รอมานาน';
}

/**
 * How long, in the largest unit that is still honest. Minutes for the first hour, because
 * "0 ชั่วโมง" reads as "just now" for someone who has been waiting 50 minutes.
 */
export function waitedForTh(item: WaitWindow, now: Date = new Date()): string {
  const until = waitEndedAt(item);
  const end = until ? new Date(until).getTime() : now.getTime();
  const ms = end - new Date(waitStartedAt(item)).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'เมื่อสักครู่';
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมง`;
  return `${Math.floor(hours / 24)} วัน`;
}

/**
 * What actually reached a person. Owner 2026-09-05: operators are not LINE-linked, so `0` pushes is
 * the NORMAL reading and must not look like a fault — this page is the channel. The one reading
 * worth flagging is nothing at all, which is also what raises `support_unreachable` server-side.
 *
 * `notifyState` is read FIRST: the counters hold their defaults until the outbox drain runs, so
 * without it a request rendered the red chip for the seconds between the tap and the drain.
 */
export function notifiedSummary(
  item: Pick<SupportRequestItemDto, 'lineNotifiedCount' | 'emailSent' | 'notifyState'>,
): Chip {
  if (item.notifyState === 'queued') return { label: 'กำลังแจ้ง…', tone: 'info' };
  if (item.notifyState === 'unreachable') {
    return { label: 'แจ้งไม่สำเร็จ — เห็นที่หน้านี้เท่านั้น', tone: 'danger' };
  }
  const parts: string[] = [];
  if (item.emailSent) parts.push('อีเมลทีมงาน');
  if (item.lineNotifiedCount > 0) parts.push(`LINE ${item.lineNotifiedCount} คน`);
  return { label: parts.join(' · ') || 'แจ้งแล้ว', tone: 'neutral' };
}

/**
 * Where an operator goes to answer. A shop has a message box; an applicant has the queue.
 *
 * The shop link names the REQUEST, because the message box addresses the shop's OWNERs and the
 * person waiting is often an employee whose chat they cannot see. `asker` is the same hash fragment
 * this page prints (§3: never a LINE id, never a LINE display name), so the box can say who it is
 * answering in the words the operator just read.
 */
export function supportAnswerHref(item: SupportRequestItemDto): string | null {
  if (item.companyId) {
    return `/system/partners/${item.companyId}?support=${encodeURIComponent(item.id)}`
      + `&asker=${encodeURIComponent(item.askerRef)}`;
  }
  if (item.signupRequestId) return '/system/signup-requests';
  return null;
}

export function supportAnswerLabel(item: SupportRequestItemDto): string {
  return item.companyId ? 'เปิดหน้าร้าน' : 'เปิดคิวสมัคร';
}

export function supportReplyChip(
  status: SupportRequestItemDto['lastReplyDeliveryStatus'],
): Chip | null {
  if (status === 'SENT') return { label: 'ส่งข้อความล่าสุดแล้ว', tone: 'success' };
  if (status === 'PENDING') return { label: 'ยังไม่ทราบผลส่ง · ลองซ้ำได้', tone: 'warning' };
  if (status === 'FAILED') return { label: 'ส่งไม่สำเร็จ · ลองซ้ำได้', tone: 'danger' };
  return null;
}

export function supportReplyWithinRetryWindow(
  item: Pick<SupportRequestItemDto, 'replyFirstAttemptAt' | 'lastReplyDeliveryStatus'>,
  now = new Date(),
): boolean {
  if (!item.replyFirstAttemptAt || !['PENDING', 'FAILED'].includes(item.lastReplyDeliveryStatus ?? '')) return false;
  const age = now.getTime() - new Date(item.replyFirstAttemptAt).getTime();
  return Number.isFinite(age) && age >= 0 && age < 24 * 60 * 60 * 1000;
}

/** Resume changes only the assistant pause; the managed case remains open until explicit resolve. */
export const canResumeAi = (status: SupportRequestStatus) => status !== 'CLOSED';

// ── สัญญา v3: the chat window ──

/** Why a customer photo/file has no bytes to show. Codes are bounded server-side (§3). */
export function supportMediaErrorTh(code: SupportRequestMediaError | undefined): string {
  if (code === 'media_security_rejected') return 'ไฟล์ไม่ผ่านการตรวจสอบความปลอดภัย จึงไม่ได้เก็บไว้';
  if (code === 'media_scan_failed') return 'ตรวจสอบความปลอดภัยของไฟล์ไม่สำเร็จ จึงไม่ได้เก็บไว้';
  if (code === 'media_limit_reached') return 'เคสนี้เก็บไฟล์ครบจำนวนสูงสุดแล้ว จึงไม่ได้เก็บไฟล์นี้';
  return 'ดึงไฟล์จาก LINE ไม่สำเร็จ (ไฟล์หมดอายุหรือใหญ่เกินกำหนด)';
}

export type SupportComposerMode = 'compose' | 'retry' | 'claim' | 'other' | 'closed';

/**
 * What the bottom of the chat window offers. The composer is for NEW words, and the rules are the
 * row's own (สัญญา v2 ข้อ 3–4): only the owner of a live case may write, and while a send is still
 * unresolved inside its 24 h retry window the only honest button is "ลองส่งข้อความเดิม".
 */
export function supportComposerMode(
  item: Pick<SupportRequestItemDto, 'status' | 'assignedAt' | 'assignedToMe' | 'replyFirstAttemptAt' | 'lastReplyDeliveryStatus'>,
  now = new Date(),
): SupportComposerMode {
  if (item.status === 'CLOSED') return 'closed';
  if (!item.assignedAt) return 'claim';
  if (!item.assignedToMe) return 'other';
  return supportReplyWithinRetryWindow(item, now) ? 'retry' : 'compose';
}

export function supportComposerHintTh(mode: SupportComposerMode, assigneeDisplayName?: string): string | null {
  if (mode === 'claim') return 'รับเคสก่อน จึงจะตอบลูกค้าจากหน้าต่างนี้ได้';
  if (mode === 'other') return `เคสนี้อยู่กับ ${assigneeDisplayName ?? 'ทีมงานคนอื่น'} — รับช่วงต่อได้จากปุ่มด้านล่าง`;
  if (mode === 'retry') return 'ยังไม่ทราบผลส่งข้อความล่าสุด กด "ลองส่งข้อความเดิม" ก่อน จึงจะพิมพ์ข้อความใหม่ได้';
  if (mode === 'closed') return 'เคสปิดแล้ว อ่านประวัติได้ แต่ส่งข้อความไม่ได้';
  return null;
}

/**
 * The prompt used to warn about this case in its title; the composer says it above the box instead.
 * True when the previous send never resolved and its safe-retry window has passed.
 */
export function supportPreviousReplyUncertain(
  item: Pick<SupportRequestItemDto, 'replyOperationId' | 'replyFirstAttemptAt' | 'lastReplyDeliveryStatus'>,
  now = new Date(),
): boolean {
  return Boolean(
    item.replyOperationId
    && ['PENDING', 'FAILED'].includes(item.lastReplyDeliveryStatus ?? '')
    && !supportReplyWithinRetryWindow(item, now),
  );
}
