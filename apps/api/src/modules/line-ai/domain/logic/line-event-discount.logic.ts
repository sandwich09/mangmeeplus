import type { BillingEventDiscountTicket, BillingEventDiscountView } from '@watchdog-bms/contracts';
import type { LineReplyMessage } from '../../infrastructure/line-reply.adapter';

/**
 * LINE "ฉันมีส่วนลดไหม" (sales-event spec §8.1 LINE: ถามส่วนลด, Owner UAT 2026-09-29). The holder's
 * ส่วนลดจากงาน, answered by code in the deterministic lane: every amount, date and state below comes
 * from the permission-checked billing read, never from a model.
 */
export type LineEventDiscountFacts = BillingEventDiscountView & { block: 'DEAL_ACTIVE' | 'EVENT_ALREADY_USED' | null };

const PRE = '(?:ก็|แล้ว)?(?:ตอนนี้)?(?:ฉัน|ผม|เรา|หนู|ร้าน(?:นี้|ฉัน|ผม|เรา|ของ(?:ฉัน|ผม|เรา))?)?(?:ยัง)?';
const NOUN = '(?:ส่วนลด|โค้ดส่วนลด|คูปอง(?:ส่วนลด)?|ตั๋วส่วนลด|บัตรส่วนลด)';
const QUAL = '(?:(?:ค่า|ของ|สำหรับ)?(?:มั่งมี(?:พลัส|plus)?|แพ็กเกจ|แอป|แอพ)|จาก(?:งาน|อีเวนต์|อีเว้นท์|อีเวนท์|event|เซลล์)\\S{0,40})?(?:ของ(?:ฉัน|ผม|เรา|หนู))?';
/** "มีส่วนลด" alone is a statement about a bill, so the มี/ได้ form must be a question. */
const HAVE = new RegExp(`^${PRE}(?:มี|ได้(?:รับ)?)${NOUN}${QUAL}(?:ไหม|หรือเปล่า|หรือไม่|อะไรบ้าง|บ้าง|อยู่ไหม|อยู่หรือเปล่า|กี่ใบ|เท่าไหร่|เท่าไร)$`, 'iu');
const TOPIC = new RegExp(`^${PRE}(?:ดู|เช็[คก]|ขอ|ถาม(?:เรื่อง)?|เรื่อง)?${NOUN}${QUAL}(?:ไง|ล่ะ|ใช้(?:ยังไง|อย่างไร|ได้ไหม|ตรงไหน)|อยู่(?:ไหน|ตรงไหน)|หายไปไหน|ดูตรงไหน)?$`, 'iu');
/** A discount the user puts on a receipt or bill stays with the receipt flow. */
const ON_A_BILL = /บิล|ใบเสร็จ|ใบกำกับ|รายการนี้|ยอดนี้/u;

/** Whole-string, like the public-policy answers: mixed requests and quotations are left alone. */
export function isMangmeeDiscountQuestion(messageText: string): boolean {
  if (!messageText.trim() || messageText.length > 80) return false;
  const text = messageText.normalize('NFC').replace(/\s+/gu, '').replace(/[?？!！.]+$/u, '')
    .replace(/(?:นะ)?(?:ครับผม|ครับ|ค่ะ|คะ|คับ|จ้า|จ๊ะ)$/u, '').replace(/[?？!！]+$/u, '')
    .replace(/แพ็คเกจ/gu, 'แพ็กเกจ').replace(/มั้ย|มั๊ย/gu, 'ไหม');
  return !ON_A_BILL.test(text) && (HAVE.test(text) || TOPIC.test(text));
}

const THAI_DATE = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric' });
const day = (iso: string) => THAI_DATE.format(new Date(iso));
/** Whole baht without decimals, satang with two, as LINE copy prints money. */
export const baht = (satang: number) => (satang / 100).toLocaleString('th-TH', { minimumFractionDigits: satang % 100 ? 2 : 0, maximumFractionDigits: 2 });
const usable = (ticket: BillingEventDiscountTicket) => ticket.state === 'AVAILABLE' && !ticket.batchSuspended;

function ticketLine(ticket: BillingEventDiscountTicket): string {
  const head = `• ส่วนลดจากงาน ${ticket.eventName} · ลด ${baht(ticket.discountSatang)} บาท`;
  if (usable(ticket)) return `${head} · ใช้ได้ถึง ${day(ticket.expiresAt)}`;
  if (ticket.state === 'EXPIRED') return `${head} · หมดอายุแล้ว (ใช้ได้ถึง ${day(ticket.expiresAt)})`;
  if (ticket.state === 'USED') return `${head} · ใช้ไปแล้ว`;
  if (ticket.state === 'IN_PAYMENT') return `${head} · อยู่ระหว่างชำระเงิน`;
  if (ticket.state === 'REVOKED') return `${head} · ถูกยกเลิกแล้ว`;
  return `${head} · งดใช้ชั่วคราว`;
}

const HOW_TO_GET = 'รับส่วนลดได้โดยสแกน QR จากพนักงานขายของมั่งมีในงานอีเวนต์ค่ะ';

/** `canUse` = this shop may take the discount at its next package payment, so the card carries the package button. */
export function lineEventDiscountAnswer(facts: LineEventDiscountFacts): { text: string; canUse: boolean } {
  // A reward-only ticket (credit, SD-F) is not a price discount and is not built yet.
  const tickets = facts.tickets.filter((ticket) => ticket.discountSatang > 0).slice(0, 5);
  if (!tickets.length) return { text: `ตอนนี้ยังไม่มีส่วนลดจากงานค่ะ\n${HOW_TO_GET}`, canUse: false };
  const lines = tickets.map(ticketLine);
  if (!tickets.some(usable)) return { text: ['ตอนนี้ไม่มีส่วนลดจากงานที่ใช้ได้ค่ะ', ...lines, HOW_TO_GET].join('\n'), canUse: false };
  if (facts.path === 'DISCOUNT' && !facts.block) {
    // Owner 2026-09-29: several held discounts → the buyer picks one per payment. SD-O13: automatic renewal discounts its first bill only.
    const pick = tickets.filter(usable).length > 1 ? 'เลือกได้ตอนจ่ายว่าจะใช้ส่วนลดไหน (ครั้งละ 1 ส่วนลด) หรือไม่ใช้' : 'เลือกใช้หรือไม่ใช้ได้ตอนจ่าย';
    return { text: ['คุณมีส่วนลดจากงานค่ะ', ...lines, `ลดตอนจ่ายค่าแพ็กเกจด้วยบัตรหรือ PromptPay ${pick} งานเดียวกันใช้ได้ร้านละครั้ง`,
      'ถ้าเลือกตัดบัตรอัตโนมัติหรือสแกนบิล QR ทุกงวด ลดเฉพาะบิลแรก รอบต่อไปคิดราคาเต็มค่ะ'].join('\n'), canUse: true };
  }
  // SD-O12: EVENT_ALREADY_USED = every ticket still usable is from an event this shop already used, so name those events.
  const spent = [...new Set(tickets.filter(usable).map((ticket) => ticket.eventName))].join(', ');
  const why = facts.block === 'EVENT_ALREADY_USED' ? `ร้านนี้ใช้ส่วนลดจากงาน ${spent} ไปแล้ว (งานเดียวกันใช้ได้ร้านละครั้ง) ค่ะ`
    : facts.block === 'DEAL_ACTIVE' ? 'ร้านนี้มีดีลพิเศษอยู่แล้ว จึงใช้ส่วนลดจากงานกับราคาดีลไม่ได้ค่ะ'
    // A running automatic renewal: its rounds are never discounted (SD-O13 discounts only the first bill of a new package).
    : facts.path === 'CREDIT' ? 'ร้านนี้ต่ออายุแบบตัดเงินอัตโนมัติ ส่วนลดจากงานยังใช้กับรอบตัดเงินอัตโนมัติไม่ได้ค่ะ'
    : 'ข้อมูลการชำระเงินเดิมของร้านนี้ต้องให้ทีมงานตรวจก่อน จึงยังใช้ส่วนลดจากงานไม่ได้ค่ะ';
  return { text: ['คุณมีส่วนลดจากงานค่ะ', ...lines, why].join('\n'), canUse: false };
}

/** Someone who cannot choose the shop's package (the read is owner/plan-manager only). */
export const EVENT_DISCOUNT_MEMBER_REPLY = 'ส่วนลดจากงานใช้ตอนซื้อแพ็กเกจของร้าน เจ้าของร้านหรือผู้มีสิทธิ์จัดการแพ็กเกจสอบถามในแชทนี้ได้เลยค่ะ';

/** The answer as one card; the package page button (one-tap handoff) only when the shop can use it now. */
export function buildEventDiscountCard(facts: LineEventDiscountFacts, packageUrl?: string): LineReplyMessage {
  const { text, canUse } = lineEventDiscountAnswer(facts);
  return {
    type: 'flex',
    altText: text.slice(0, 400),
    canonicalText: text,
    contents: {
      type: 'bubble', size: 'mega',
      body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: [
        { type: 'text', text: '🎟️ ส่วนลดจากงาน', weight: 'bold', size: 'md', color: '#101828', wrap: true },
        { type: 'text', text, size: 'sm', color: '#475467', wrap: true },
      ] },
      ...(canUse && packageUrl ? { footer: { type: 'box', layout: 'vertical', contents: [
        { type: 'button', style: 'primary', color: '#22C55E', action: { type: 'uri', label: 'เลือกแพ็กเกจ', uri: packageUrl } },
      ] } } : {}),
    },
  };
}
