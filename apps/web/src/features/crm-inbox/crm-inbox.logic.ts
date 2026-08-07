// Pure helpers for the LINE OA settings + CRM inbox screens. Unit-tested; no React imports.

import type { CrmConversationPriority, CrmConversationStatus, CrmConversationSummary, MessagingChannelStatus } from '@watchdog-bms/contracts';

export type ChannelConnectForm = {
  displayName: string;
  lineChannelId: string;
  channelSecret: string;
  accessToken: string;
};

/** Thai-first validation for the connect wizard. Returns null when valid. */
export function validateConnectForm(form: ChannelConnectForm): string | null {
  if (!form.displayName.trim()) return 'กรุณาตั้งชื่อ LINE OA เช่น "ร้านของฉัน"';
  if (!/^\d{4,}$/.test(form.lineChannelId.trim())) return 'Channel ID ต้องเป็นตัวเลขจาก LINE Developers Console';
  if (form.channelSecret.trim().length < 8) return 'Channel Secret ไม่ถูกต้อง กรุณาคัดลอกจาก LINE Developers Console';
  if (form.accessToken.trim().length < 8) return 'Channel Access Token ไม่ถูกต้อง กรุณาออก token ใหม่แล้วคัดลอกมาวาง';
  return null;
}

export function channelStatusLabel(status: MessagingChannelStatus): { text: string; tone: 'green' | 'amber' | 'red' | 'gray' } {
  switch (status) {
    case 'ACTIVE': return { text: 'ใช้งานอยู่ — รับข้อความลูกค้าแล้ว', tone: 'green' };
    case 'CONNECTED': return { text: 'เชื่อมต่อแล้ว — รอข้อความแรกจากลูกค้า', tone: 'amber' };
    case 'PENDING_SETUP': return { text: 'ยังตั้งค่าไม่เสร็จ', tone: 'gray' };
    case 'ERROR': return { text: 'เชื่อมต่อมีปัญหา — กดทดสอบการเชื่อมต่อเพื่อดูรายละเอียด', tone: 'red' };
    case 'DISABLED': return { text: 'ปิดการใช้งาน', tone: 'gray' };
  }
}

/** Plain-Thai explanation for LINE connection error codes from the API. */
export function channelErrorMessage(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'invalid_access_token':
      return 'Access Token ไม่ถูกต้องหรือหมดอายุ — ออก token ใหม่จาก LINE Developers Console แล้วกด "เปลี่ยน Credential"';
    case 'line_api_unreachable':
      return 'ติดต่อเซิร์ฟเวอร์ LINE ไม่ได้ กรุณาลองใหม่อีกครั้ง';
    default:
      return `LINE ตอบกลับผิดปกติ (${code}) — ตรวจสอบการตั้งค่าใน LINE Developers Console`;
  }
}

/** Absolute webhook URL for the copy button; falls back to path when origin unknown. */
export function webhookDisplayUrl(channel: { webhookUrl?: string; webhookPath?: string }): string | null {
  return channel.webhookUrl ?? channel.webhookPath ?? null;
}

// ---- CRM Inbox (มั่งมี Flow A) ----

/** Status labels + colors straight from the Flow A design handoff. */
export const CONVERSATION_STATUS_META: Record<CrmConversationStatus, { label: string; color: string; bg: string }> = {
  NEW: { label: 'ใหม่', color: '#DC2626', bg: '#FEE2E2' },
  OPEN: { label: 'กำลังคุย', color: '#2563EB', bg: '#DBEAFE' },
  WAITING_INTERNAL: { label: 'รอทีมภายใน', color: '#D97706', bg: '#FEF3C7' },
  WAITING_CUSTOMER: { label: 'รอลูกค้า', color: '#7C3AED', bg: '#EDE9FE' },
  FOLLOW_UP: { label: 'ติดตาม', color: '#EA580C', bg: '#FFEDD5' },
  RESOLVED: { label: 'ปิดแล้ว', color: '#059669', bg: '#D1FAE5' },
  SPAM: { label: 'สแปม', color: '#667085', bg: '#F2F4F7' },
};

/** Chip/menu order per the design; SPAM last — the API mutes it out of every other view. */
export const INBOX_STATUS_ORDER: CrmConversationStatus[] = [
  'NEW', 'OPEN', 'WAITING_INTERNAL', 'WAITING_CUSTOMER', 'FOLLOW_UP', 'RESOLVED', 'SPAM',
];

export const CONVERSATION_PRIORITY_META: Record<CrmConversationPriority, { label: string; color: string; bg: string }> = {
  LOW: { label: 'ต่ำ', color: '#667085', bg: '#F2F4F7' },
  NORMAL: { label: 'ปกติ', color: '#475467', bg: '#F2F4F7' },
  HIGH: { label: 'สูง', color: '#D97706', bg: '#FEF3C7' },
  URGENT: { label: 'ด่วน', color: '#DC2626', bg: '#FEE2E2' },
};

export const INBOX_PRIORITY_ORDER: CrmConversationPriority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

/**
 * Adds a tag locally with the same rules the API enforces (trim, dedupe
 * case-insensitive, ≤10 tags, ≤40 chars). Returns null when nothing changes.
 */
export function addConversationTag(tags: string[], raw: string): string[] | null {
  const tag = raw.trim();
  if (tag.length === 0 || tag.length > 40 || tags.length >= 10) return null;
  if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return null;
  return [...tags, tag];
}

/** Mirrors the API's first-response SLA rule (badge "⏱ เกิน 30 นาที"). */
export function conversationIsOverdue(
  c: Pick<CrmConversationSummary, 'status' | 'firstRespondedAt' | 'firstResponseDueAt'>,
  now: Date,
): boolean {
  if (c.status === 'RESOLVED' || c.status === 'SPAM') return false;
  if (c.firstRespondedAt) return false;
  return Boolean(c.firstResponseDueAt && new Date(c.firstResponseDueAt).getTime() < now.getTime());
}

/**
 * First-response SLA countdown for the list card. Fixed amber threshold
 * (≤ 15 min left — half the default 30-min SLA) instead of the spec's
 * %-remaining rule: the DTO doesn't carry the SLA window start, and a fixed
 * cutoff reads the same to staff ("ใกล้หมดเวลา").
 */
export function slaCountdown(
  c: Pick<CrmConversationSummary, 'status' | 'firstRespondedAt' | 'firstResponseDueAt'>,
  now: Date,
): { state: 'ok' | 'warning' | 'overdue'; label: string } | null {
  if (c.status === 'RESOLVED' || c.status === 'SPAM' || c.firstRespondedAt || !c.firstResponseDueAt) return null;
  const leftMs = new Date(c.firstResponseDueAt).getTime() - now.getTime();
  if (leftMs <= 0) {
    const over = Math.max(1, Math.floor(-leftMs / 60_000));
    return { state: 'overdue', label: over < 60 ? `เกิน ${over} นาที` : `เกิน ${Math.floor(over / 60)} ชม.` };
  }
  const leftMinutes = Math.ceil(leftMs / 60_000);
  const label = leftMinutes < 60 ? `เหลือ ${leftMinutes} นาที` : `เหลือ ${Math.floor(leftMinutes / 60)} ชม.`;
  return { state: leftMinutes <= 15 ? 'warning' : 'ok', label };
}

/** Mirrors the API's policy validation; returns a Thai error or null. */
export function validateInboxPolicyForm(form: {
  firstResponseMinutes: string;
  businessHoursEnabled: boolean;
  start: string;
  end: string;
}): string | null {
  const minutes = Number(form.firstResponseMinutes);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    return 'เวลาตอบกลับต้องเป็นจำนวนนาที 1–1440';
  }
  if (!form.businessHoursEnabled) return null;
  const hm = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!hm.test(form.start) || !hm.test(form.end)) return 'เวลาทำการต้องอยู่ในรูปแบบ HH:MM';
  if (form.end <= form.start) return 'เวลาปิดต้องอยู่หลังเวลาเปิด';
  return null;
}

/** Compact Thai relative time for the conversation list ("5 นาที", "3 ชม.", "2 วัน"). */
export function relativeTimeTh(iso: string | undefined, now: Date): string {
  if (!iso) return '';
  const diffMs = now.getTime() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) return 'เมื่อครู่';
  if (minutes < 60) return `${minutes} นาที`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชม.`;
  return `${Math.floor(hours / 24)} วัน`;
}

/** Avatar initial: first character of the display name (Thai-safe). */
export function avatarInitial(name: string | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  // Skip the common "คุณ" honorific so initials distinguish customers.
  const bare = trimmed.startsWith('คุณ') && trimmed.length > 3 ? trimmed.slice(3).trim() : trimmed;
  return Array.from(bare)[0]?.toUpperCase() ?? '?';
}

const AVATAR_PALETTE = ['#12B76A', '#2563EB', '#7C3AED', '#DD2590', '#EA580C', '#06AED4', '#B54708', '#3538CD'];

/** Stable per-customer avatar color. */
export function avatarColor(customerId: string): string {
  let hash = 0;
  for (const ch of customerId) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

/** Same-origin URL for stored media — <img>/<a> use it directly (cookie session). */
export function messageContentUrl(companyId: string, conversationId: string, messageId: string): string {
  return `/api/v1/companies/${companyId}/crm/conversations/${conversationId}/messages/${messageId}/content`;
}

/** Finance-only URL; the API verifies the payment-proof purpose link. */
export function paymentProofContentUrl(companyId: string, conversationId: string, messageId: string): string {
  return `/api/v1/companies/${companyId}/crm/payment-proofs/${conversationId}/messages/${messageId}/content`;
}

/** LINE's public sticker CDN render for a stickerId. */
export function stickerImageUrl(stickerId: string): string {
  return `https://stickershop.line-scdn.net/stickershop/v1/sticker/${encodeURIComponent(stickerId)}/android/sticker.png`;
}

/** Map link for LOCATION messages. */
export function locationMapUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${latitude},${longitude}`;
}

/** Plain-Thai note when inbound media could not be stored. */
export function mediaErrorMessage(code: string): string {
  if (code === 'content_too_large') return 'ไฟล์แนบใหญ่เกินกำหนด จึงไม่ได้บันทึกไว้';
  if (code === 'media_type_unsupported') return 'ยังไม่รองรับวิดีโอ/ข้อความเสียง';
  return 'ดึงไฟล์แนบจาก LINE ไม่สำเร็จ (ไฟล์อาจหมดอายุแล้ว)';
}

/**
 * "/" at the start of the reply composer activates quick replies.
 * Returns the filter text after the slash, or null when quick replies are off
 * (no leading slash, or the user already typed a multi-line message).
 */
export function quickReplyQuery(text: string): string | null {
  if (!text.startsWith('/')) return null;
  if (text.includes('\n')) return null;
  return text.slice(1);
}

/** Filter templates by title/category/body, case-insensitive; empty query returns all. */
export function filterTemplates<T extends { title: string; bodyText: string; category?: string }>(
  templates: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return templates;
  return templates.filter(
    (t) =>
      t.title.toLowerCase().includes(q) ||
      (t.category?.toLowerCase().includes(q) ?? false) ||
      t.bodyText.toLowerCase().includes(q),
  );
}

/** Plain-Thai reason for send failures surfaced by the API. */
export function sendErrorMessage(raw: string): string {
  if (raw.includes('text_too_long')) return 'ข้อความยาวเกินไป (สูงสุด 5,000 ตัวอักษร)';
  if (raw.includes('channel_disabled')) return 'LINE OA ของบริษัทถูกปิดใช้งาน — เปิดใช้งานที่ตั้งค่า LINE OA ก่อนส่งข้อความ';
  if (raw.includes('customer_unfollowed')) return 'ลูกค้าเลิกติดตาม LINE OA แล้ว จึงไม่สามารถส่งข้อความได้';
  if (raw.includes('invalid_access_token')) return 'Access Token ของ LINE OA ใช้ไม่ได้ — ตรวจสอบที่ตั้งค่า LINE OA';
  return 'ส่งข้อความไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}
