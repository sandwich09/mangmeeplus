import { bangkokDayBounds } from './crm-daily-brief.logic';
import {
  bookingDayRange,
  formatBookingWhen,
  validateBookingWindow,
} from '../../../crm/domain/logic/crm-booking.logic';
import { normalizePhone } from '../../../crm/domain/logic/crm.logic';
import type { CrmAiCatalogItem } from '@watchdog-bms/contracts';

// Owner decision 2026-07-14 (answer-all): 5/day cut off real conversations after a
// handful of turns; 20 keeps a chatty customer served while the per-channel daily
// cap still bounds total spend.
export const PER_CONVERSATION_AUTO_REPLY_DAILY_CAP = 20;
export const CRM_AUTO_REPLY_AGENT = Symbol('CRM_AUTO_REPLY_AGENT');

export type CrmAutonomousOutboundReviewReason =
  | 'model_human_signal'
  | 'unapproved_url'
  | 'payment'
  | 'commitment'
  | 'pii';

export type CrmAutonomousOutboundPolicyDecision =
  | { action: 'allow' }
  | { action: 'review'; reason: CrmAutonomousOutboundReviewReason };

const URL_LIKE = /\b(?:(?:https?|hxxps?):\/\/|www\.|(?:[\p{L}\d-]+\.)+[\p{L}]{2,})(?:[^\s<>"']*)/giu;
const PAYMENT_RISK = /(?:ชำระเงิน|โอนเงิน|เลขบัญชี|พร้อมเพย์|สแกน\s*(?:คิวอาร์|qr)|ลิงก์ชำระ|ส่งเงิน|pay(?:ment)?\s*link|pay\s*now|bank\s*account|wire\s*transfer|send\s*money)/iu;
const COMMITMENT_RISK = /(?:รับประกัน|การันตี|ยืนยัน(?:ว่า|ให้)|สัญญาว่า|คืนเงิน|อนุมัติ(?:แล้ว|ให้)|ได้แน่นอน|จัดส่งภายใน|ส่งมอบภายใน|guarantee|promise|will\s+refund|refund\s+approved|has\s+been\s+approved|definitely|will\s+deliver\s+by)/iu;
const PII_RISK = /(?:[\w.+-]+@[\w-]+(?:\.[\w-]+)+|(?<!\d)(?:\+?66|0)\d{8,9}(?!\d)|(?<!\d)(?:\d[\s-]?){10,19}(?!\d)|เลขบัตร(?:ประชาชน|เครดิต)|บัตรประชาชน|หนังสือเดินทาง|passport|social\s*security|รหัส\s*(?:otp|pin)|\botp\b|\bpin\b|\bcvv\b|password|รหัสผ่าน)/iu;

export function evaluateCrmAutonomousOutboundPolicy(input: {
  draftText: string;
  allowedDomains?: readonly string[];
  modelNeedsHuman?: boolean;
}): CrmAutonomousOutboundPolicyDecision {
  if (input.modelNeedsHuman) return { action: 'review', reason: 'model_human_signal' };

  for (const token of input.draftText.match(URL_LIKE) ?? []) {
    const value = token.replace(/[),.;!?。，、]+$/u, '');
    if (/^hxxps?:/iu.test(value)) return { action: 'review', reason: 'unapproved_url' };
    try {
      const url = new URL(/^[a-z][a-z\d+.-]*:/iu.test(value) ? value : `https://${value}`);
      const host = url.hostname.toLowerCase().replace(/\.$/u, '');
      const allowed = (input.allowedDomains ?? []).some((entry) => {
        const pattern = entry.trim().toLowerCase().replace(/\.$/u, '');
        return pattern.startsWith('*.')
          ? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2)
          : host === pattern;
      });
      if (url.protocol !== 'https:' || !allowed) return { action: 'review', reason: 'unapproved_url' };
    } catch {
      return { action: 'review', reason: 'unapproved_url' };
    }
  }
  if (PAYMENT_RISK.test(input.draftText)) return { action: 'review', reason: 'payment' };
  if (COMMITMENT_RISK.test(input.draftText)) return { action: 'review', reason: 'commitment' };
  if (PII_RISK.test(input.draftText)) return { action: 'review', reason: 'pii' };
  return { action: 'allow' };
}

export type CrmAutoReplyDecision =
  | { action: 'skip'; requestId: string; reason: string; turnClass?: string }
  // replySource distinguishes an AI-composed answer (authorType AI, aiDraftUsed)
  // from a deterministic template (greeting / staff-handoff ack — authorType
  // SYSTEM, still cap-consuming and counted as a response). Defaults to AI.
  | { action: 'send'; requestId: string; turnClass: string; draftText: string; replySource?: 'AI' | 'DETERMINISTIC' }
  | {
      action: 'book';
      requestId: string;
      turnClass: string;
      bookingInput: {
        branchId: string;
        customerId: string;
        serviceName: string;
        staffUserId: string;
        startAt: Date;
        endAt: Date;
        sourceConversationId?: string;
      };
      confirmText: string;
    };

export type CrmAutoReplyAgentPort = {
  evaluate(input: {
    channel: {
      id: string;
      companyId: string;
      displayName: string;
      status: string;
      autoReplyEnabled: boolean;
      autoReplyDailyCap: number;
      defaultBookingStaffUserId: string | null;
      defaultBookingBranchId: string | null;
    };
    conversation: {
      id: string;
      companyId: string;
      channelId: string;
      customerId: string;
      assignedToUserId: string | null;
      autoReplyEnabled: boolean;
      autoReplyCount: number;
      autoReplyCheckedAt: Date | null;
    };
    contentText: string | null;
    eventType: string;
    receivedAt: Date;
  }): Promise<CrmAutoReplyDecision>;
  classifyBookingConfirmation?(input: {
    companyId: string;
    conversationId: string;
    customerId: string;
  }): Promise<'CONFIRM' | 'UNCLEAR'>;
};

export function resolveConversationAutoReplyCount(
  current: { autoReplyCount: number; autoReplyCheckedAt: Date | null },
  now: Date,
): { countToday: number; isNewWindow: boolean } {
  const { dayStart } = bangkokDayBounds(now);
  if (!current.autoReplyCheckedAt || current.autoReplyCheckedAt.getTime() < dayStart.getTime()) {
    return { countToday: 0, isNewWindow: true };
  }
  return { countToday: current.autoReplyCount, isNewWindow: false };
}

// Whole-message greeting grammar. A greeting is deterministic (no model, no
// confidence gate) ONLY when, after erasing greeting cores + politeness +
// punctuation/emoji/whitespace, nothing substantive remains. "สวัสดี อยากถามราคา"
// leaves "อยากถามราคา" → not a greeting (the real question must reach the AI).
// Bare "ครับ"/"ค่ะ"/"โอเค" are not greetings (no greeting core present).
const GREETING_CORES_TH = ['สวัสดี', 'หวัดดี', 'สวัดดี'];
const GREETING_CORES_EN = /\b(?:hello+|hi+|hey+|good\s*(?:morning|afternoon|evening))\b/i;
const GREETING_CORES_EN_G = /\b(?:hello+|hi+|hey+|good\s*(?:morning|afternoon|evening))\b/gi;
const GREETING_POLITE_TH = ['ครับผม', 'นะคะ', 'นะครับ', 'ค่ะ', 'คะ', 'ค่า', 'ครับ', 'คับ', 'ขา', 'นะ', 'น่ะ', 'จ้ะ', 'จ้า', 'จ๊ะ', 'ฮะ', 'เลย', 'ตอนเช้า', 'ตอนบ่าย', 'ตอนเย็น', 'ตอนค่ำ'];
const GREETING_POLITE_EN_G = /\b(?:please|pls|na|krab|krub|ka|kub|there|everyone|all)\b/gi;

export function matchStandaloneGreeting(text: string): 'th' | 'en' | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  const hasTh = GREETING_CORES_TH.some((g) => raw.includes(g));
  const hasEn = GREETING_CORES_EN.test(raw);
  if (!hasTh && !hasEn) return null;
  let residual = raw.toLowerCase();
  for (const g of GREETING_CORES_TH) residual = residual.split(g).join(' ');
  for (const f of GREETING_POLITE_TH) residual = residual.split(f).join(' ');
  residual = residual.replace(GREETING_CORES_EN_G, ' ').replace(GREETING_POLITE_EN_G, ' ');
  // Only whitespace, punctuation, and symbols/emoji are harmless leftovers.
  if (residual.replace(/[\s\p{P}\p{S}]+/gu, '').length !== 0) return null;
  return hasTh ? 'th' : 'en';
}

export function formatGreetingReply(lang: 'th' | 'en'): string {
  return lang === 'en'
    ? 'Hello! 😊 How can we help you today?'
    : 'สวัสดีค่ะ 😊 มีอะไรให้เราช่วยดูแลไหมคะ?';
}

export function resolvePublishedService(
  catalog: readonly CrmAiCatalogItem[],
  catalogItemId: string | undefined,
): CrmAiCatalogItem | undefined {
  return catalogItemId ? catalog.find((item) => item.kind === 'SERVICE' && item.id === catalogItemId) : undefined;
}

export function withinCap(count: number, cap: number): boolean {
  return count < cap;
}

export function bangkokDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function resolveRequestedBookingWindow(
  extract: { date: string; timeHHmm?: string },
  now: Date,
  durationMinutes: number,
): { kind: 'window'; startAt: Date; endAt: Date } | { kind: 'needs_time' } | { kind: 'invalid' } {
  const day = bookingDayRange(extract.date);
  if (!day) return { kind: 'invalid' };
  if (!extract.timeHHmm) return { kind: 'needs_time' };

  const match = /^(\d{2}):(\d{2})$/.exec(extract.timeHHmm);
  if (!match) return { kind: 'invalid' };
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59 || minute % 30 !== 0) return { kind: 'invalid' };

  const startAt = new Date(day.rangeStart.getTime() + ((hour * 60) + minute) * 60_000);
  const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
  return validateBookingWindow(startAt, endAt, now) ? { kind: 'invalid' } : { kind: 'window', startAt, endAt };
}

export function formatBookingConfirm(
  serviceName: string,
  startAt: Date,
  endAt: Date,
  branchName?: string | null,
  customerName?: string | null,
  customerPhone?: string | null,
): string {
  const date = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(startAt);
  const start = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(startAt);
  const end = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(endAt);
  return [
    'ยืนยันการจองสำเร็จค่ะ ✅',
    `บริการ: ${serviceName}`,
    `วันที่: ${date}`,
    `เวลา: ${start}-${end} น.`,
    ...(branchName ? [`สาขา: ${branchName}`] : []),
    ...(customerName ? [`ชื่อผู้จอง: ${customerName}`] : []),
    ...(customerPhone ? [`เบอร์โทร: ${customerPhone}`] : []),
    'สถานะ: ยืนยันแล้ว',
  ].join('\n');
}

export type BookingContactField = 'name' | 'phone';

export function missingBookingContactFields(customer: {
  displayName?: string | null;
  primaryPhone?: string | null;
  source?: string | null;
  originSource?: string | null;
  createdByType?: string | null;
  updatedByUserId?: string | null;
}, options: { trustExistingName?: boolean } = {}): BookingContactField[] {
  const name = customer.displayName?.trim() ?? '';
  const hasPhone = Boolean(normalizePhone(customer.primaryPhone));
  const isSystemLineCustomer =
    (customer.source === 'LINE' || customer.originSource === 'LINE') &&
    customer.createdByType === 'SYSTEM' &&
    (!customer.updatedByUserId || customer.updatedByUserId === 'system');
  return [
    ...(!name || name === 'ลูกค้า LINE' || (!options.trustExistingName && !hasPhone && isSystemLineCustomer) ? ['name' as const] : []),
    ...(!hasPhone ? ['phone' as const] : []),
  ];
}

export function formatBookingContactQuestion(fields: readonly BookingContactField[]): string {
  if (fields.includes('name') && fields.includes('phone')) {
    return 'ก่อนสรุปการจอง รบกวนแจ้งชื่อผู้จองและเบอร์โทรติดต่อค่ะ';
  }
  if (fields.includes('name')) return 'ก่อนสรุปการจอง รบกวนแจ้งชื่อผู้จองค่ะ';
  return 'ก่อนสรุปการจอง รบกวนแจ้งเบอร์โทรติดต่อค่ะ';
}

export function extractBookingContactReply(
  text: string,
  expected: readonly BookingContactField[],
): { displayName?: string; primaryPhone?: string } {
  const raw = text.trim();
  const result: { displayName?: string; primaryPhone?: string } = {};
  const phoneMatch = expected.includes('phone')
    ? raw.match(/(?:\+?66|0)[0-9\s()-]{7,16}[0-9]/)
    : null;
  if (phoneMatch) {
    const normalized = normalizePhone(phoneMatch[0]);
    if (normalized && normalized.length >= 8 && normalized.length <= 15) {
      result.primaryPhone = phoneMatch[0].replace(/\s+/g, '').trim();
    }
  }
  if (expected.includes('name')) {
    const candidate = raw
      .replace(phoneMatch?.[0] ?? '', ' ')
      .replace(/(?:ชื่อ(?:ผู้จอง)?|name|เบอร์(?:โทร(?:ศัพท์)?)?|โทร)\s*[:：]?\s*/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      candidate.length >= 2 &&
      candidate.length <= 80 &&
      /^[\p{L}\p{M} .'-]+$/u.test(candidate) &&
      !/(?:อะไร|ไหม|มั้ย|กี่|เมื่อไหร่|ขาย|จอง|เวลา|ราคา|บริการ|สนาม|how|what|when|where)/iu.test(candidate) &&
      !/^(?:ยืนยัน|ตกลง|โอเค|okay|ok|confirm|ยกเลิก|cancel|ครับ|ค่ะ|คะ)$/iu.test(candidate)
    ) {
      result.displayName = candidate;
    }
  }
  return result;
}

export function formatBookingReviewQuestion(
  serviceName: string,
  startAt: Date,
  endAt: Date,
  branchName: string,
  customerName: string,
  customerPhone: string,
): string {
  const date = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(startAt);
  const time = (value: Date) => new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
  return [
    'กรุณาตรวจสอบข้อมูลการจองค่ะ',
    `บริการ: ${serviceName}`,
    `วันที่: ${date}`,
    `เวลา: ${time(startAt)}-${time(endAt)} น.`,
    `สถานที่/สาขา: ${branchName}`,
    `ชื่อผู้จอง: ${customerName}`,
    `เบอร์โทร: ${customerPhone}`,
    'หากข้อมูลถูกต้อง พิมพ์ "ยืนยัน" เพื่อจอง หรือ "ยกเลิก" ค่ะ',
  ].join('\n');
}

export function formatSlotProposal(freeStartTimes: string[], _now: Date, requestedSlotUnavailable = false): string {
  const times = freeStartTimes.slice(0, 5).map((t) => formatBookingWhen(new Date(t)));
  if (times.length === 0) return 'วันที่เลือกไม่มีช่วงเวลาว่างที่จองได้ค่ะ 🙏 แจ้งวันอื่นที่สะดวกได้เลยค่ะ';
  const count = freeStartTimes.length;
  const heading = requestedSlotUnavailable
    ? 'ช่วงเวลาที่ขอมายังไม่ว่างค่ะ 🙏 เวลาว่างที่จองได้'
    : 'เวลาว่างที่จองได้';
  const rangeLabel = count > times.length ? `${times.length} ช่วงแรกจาก ${count} ช่วง` : `${count} ช่วง`;
  // ponytail: deterministic template; no extra AI call for slot proposal copy.
  return `${heading} (${rangeLabel}): ${times.join(', ')} น. สนใจช่วงไหนแจ้งได้เลยค่ะ`;
}

/** LINE renders markdown markers literally; remove presentation-only markers. */
export function normalizeLinePlainText(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .trim();
}
