import type { SupportRequestItemDto, SupportRequestStatus } from '@watchdog-bms/contracts';

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

export function supportClosedReasonTh(reason: string | undefined): string | null {
  if (reason === 'admin') return 'ทีมงานให้ AI ทำงานต่อ';
  if (reason === 'customer_resumed') return 'ลูกค้าเรียก AI กลับเอง';
  if (reason === 'expired') return 'ครบ 24 ชั่วโมง';
  return null;
}

/**
 * How long this person has been waiting, in the largest unit that is still honest. Minutes for the
 * first hour, because "0 ชั่วโมง" reads as "just now" for someone who has been waiting 50 minutes.
 */
export function waitedForTh(requestedAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(requestedAt).getTime();
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
 */
export function notifiedSummary(item: Pick<SupportRequestItemDto, 'lineNotifiedCount' | 'emailSent'>): Chip {
  const parts: string[] = [];
  if (item.emailSent) parts.push('อีเมลทีมงาน');
  if (item.lineNotifiedCount > 0) parts.push(`LINE ${item.lineNotifiedCount} คน`);
  if (parts.length === 0) return { label: 'แจ้งไม่สำเร็จ — เห็นที่หน้านี้เท่านั้น', tone: 'danger' };
  return { label: parts.join(' · '), tone: 'neutral' };
}

/** Where an operator goes to answer. A shop has a message box; an applicant has the queue. */
export function supportAnswerHref(item: SupportRequestItemDto): string | null {
  if (item.companyId) return `/system/partners/${item.companyId}`;
  if (item.signupRequestId) return '/system/signup-requests';
  return null;
}

export function supportAnswerLabel(item: SupportRequestItemDto): string {
  return item.companyId ? 'เปิดหน้าร้าน' : 'เปิดคิวสมัคร';
}

/** Both buttons act on a request that is still live; a closed one has nothing left to do. */
export const canMarkAnswered = (status: SupportRequestStatus) => status === 'OPEN';
export const canResumeAi = (status: SupportRequestStatus) => status !== 'CLOSED';
