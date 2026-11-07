import Decimal from 'decimal.js';
/**
 * Pure domain logic for LINE AI message classification.
 * No NestJS, Prisma, HTTP, LINE SDK, AI provider, or storage imports.
 */
import { verifyLineAiValueCandidatesV2, mapThaiDigits, type LineAiIntent, type LineAiAgent, LINE_CHAT_ACTIONS } from '@watchdog-bms/contracts';
import { createHash } from 'node:crypto';
import { staffMenuCommand } from './line-staff-menu.logic';
// Thai and English mutation keywords that LINE must block
const MUTATION_KEYWORDS_TH = [
  'สั่งซื้อ', 'สั่งขาย', 'ชำระ', 'โอนเงิน', 'จ่ายเงิน', 'ลบ', 'แก้ไข',
  'อัปเดต', 'เพิ่ม', 'ตัดสต็อก', 'รับสินค้า', 'จัดส่ง', 'ยืนยัน',
  'อนุมัติ', 'ปฏิเสธ', 'ยกเลิก', 'บันทึก', 'ส่งออก', 'นำเข้า',
];
const MUTATION_KEYWORDS_EN = [
  'create', 'add', 'delete', 'remove', 'update', 'edit', 'approve',
  'reject', 'cancel', 'post', 'transfer', 'pay', 'purchase', 'sell',
  'order', 'dispatch', 'receive', 'adjust stock', 'export', 'import',
];

// Unsupported module keywords (roadmap items not yet implemented)
const UNSUPPORTED_KEYWORDS_TH = ['บัญชี', 'ภาษี', 'เงินเดือน', 'เจ้าหนี้', 'ลูกหนี้', 'ธนาคาร', 'งบดุล', 'กำไรขาดทุน'];
const UNSUPPORTED_KEYWORDS_EN = ['payroll', 'tax filing', 'crm', 'bank reconciliation'];
const LEDGER_KEYWORDS_EN = ['accounting', 'ledger', 'trial balance', 'balance sheet', 'profit and loss', 'p&l', 'financial'];

// Inventory-related keywords
const INVENTORY_KEYWORDS_TH = ['สินค้า', 'สต็อก', 'คลัง', 'ของคงเหลือ', 'เคลื่อนไหว', 'สต็อกต่ำ'];
const INVENTORY_KEYWORDS_EN = ['product', 'stock', 'inventory', 'warehouse', 'low stock', 'movement', 'balance'];

// Notification/alert keywords
const NOTIFICATION_KEYWORDS_TH = ['แจ้งเตือน', 'การแจ้งเตือน', 'เตือน', 'สรุปประจำวัน', 'รายงาน'];
const NOTIFICATION_KEYWORDS_EN = ['alert', 'notification', 'notify', 'daily summary', 'summary'];

function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/** Returns sha256 hex prefix (16 chars) of message text for safe storage. */
export function hashMessagePreview(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);
}

export type LineCompanyCommand =
  | { kind: 'list'; page?: number }
  | { kind: 'select'; value: string };

/** Parse explicit company-context commands. Shared by the webhook use case and
 *  the message buffer: a command must never be glued into a fragment batch,
 *  because `parseLineCompanyCommand` only matches at the start of a message. */
export function parseLineCompanyCommand(text: string): LineCompanyCommand | null {
  const trimmed = text.trim();
  const normalized = trimmed.replace(/\s+/g, ' ').toLowerCase();
  if (normalized === '/companies' || normalized === '/company' || normalized === 'เปลี่ยนบริษัท') return { kind: 'list' };
  const page = normalized.match(/^\/companies\s+page\s+(\d+)$/);
  if (page?.[1]) return { kind: 'list', page: Number(page[1]) };
  const match = trimmed.match(/^\/company\s+(.+)$/i);
  return match?.[1] ? { kind: 'select', value: match[1].trim() } : null;
}

/** A bare number is only a selection candidate. The webhook state machine decides whether
 * the immediately preceding turn actually asked the user to choose a company. */
export function parseBareCompanySelection(text: string): LineCompanyCommand | null {
  const value = mapThaiDigits(text.trim());
  return /^\d+$/.test(value) ? { kind: 'select', value } : null;
}

/** Normalize LINE text message: trim, collapse whitespace, lowercase. */
export function normalizeLineText(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Classify LINE message intent without accepting user-provided authorization. */
export function classifyIntent(normalizedText: string): LineAiIntent {
  if (matchesAny(normalizedText, [...MUTATION_KEYWORDS_TH, ...MUTATION_KEYWORDS_EN])) {
    return 'mutation_request';
  }
  if (matchesAny(normalizedText, LEDGER_KEYWORDS_EN)) {
    return 'read_summary';
  }
  if (matchesAny(normalizedText, [...UNSUPPORTED_KEYWORDS_TH, ...UNSUPPORTED_KEYWORDS_EN])) {
    return 'unsupported_module';
  }
  if (matchesAny(normalizedText, [...INVENTORY_KEYWORDS_TH, ...INVENTORY_KEYWORDS_EN])) {
    return 'read_detail';
  }
  if (matchesAny(normalizedText, [...NOTIFICATION_KEYWORDS_TH, ...NOTIFICATION_KEYWORDS_EN])) {
    return 'read_summary';
  }
  return 'read_summary';
}

/** Choose agent based on intent and text. */
export function chooseAgent(intent: LineAiIntent, normalizedText: string): LineAiAgent {
  if (intent === 'unsupported_module') return 'general';
  if (matchesAny(normalizedText, LEDGER_KEYWORDS_EN)) return 'cfo';
  if (matchesAny(normalizedText, [...INVENTORY_KEYWORDS_TH, ...INVENTORY_KEYWORDS_EN])) return 'inventory';
  if (matchesAny(normalizedText, [...NOTIFICATION_KEYWORDS_TH, ...NOTIFICATION_KEYWORDS_EN])) return 'notifications';
  return 'general';
}

/** Pending fields own plain answers; questions and new commands keep their normal route. */
export function isPendingFieldAnswer(text: string, field: 'claim' | 'reason' | 'payee'): boolean {
  const value = text.trim();
  return !!value && value.length <= 2000 && !lineWorkflowPickerText(value).question && !/[?？\n]/u.test(value)
    && (field === 'claim'
      ? !/^(?:ขอ|ช่วย|สร้าง|เบิก|บันทึก|ดู|ยกเลิก|ไม่ทำ|เปลี่ยน|แก้|ทำข้อ|ทำรายการ|ให้ทำ|ติดต่อเจ้าหน้าที่)/u.test(value)
      : !staffMenuCommand(value) && !parseLineCompanyCommand(value)
        && !/^(?:ยกเลิก|ไม่ทำ|ไม่ทำแล้ว|cancel|บันทึกรายจ่าย|ทำใบเบิกให้หน่อย)$/iu.test(value)
        && !LINE_CHAT_ACTIONS.some(action => action.command && action.command.toLowerCase() === value.toLowerCase()))
    && !/(?:อะไร|ยังไง|อย่างไร|ไหม|มั้ย|เท่าไร|เท่าไหร่|ทำไม|หรอ|เหรอ|บ้าง|หรือเปล่า|รึเปล่า|ไหน|ใคร|เมื่อไร|เมื่อไหร่)\s*(?:คะ|ค่ะ|ครับ|นะ|จ๊ะ|จ้า)?$|^(?:ทำไม|ยังไง|อย่างไร|ใคร|ที่ไหน|เมื่อไร|เมื่อไหร่)|^(?:what|how|why|when|where|who|which|can|could|is|are|do|does)\b/iu.test(value);
}

/** Shared cues for the delivered-card matcher and the permitted-list matcher. */
export function lineWorkflowPickerText(rawText: string, claim = false) {
  const text = mapThaiDigits(rawText.trim());
  const ordinalMatch = /(?:อัน|ใบ|รายการ|ร่าง)ที่\s*(\d+)/u.exec(text);
  const ordinal = /(?:อัน|ใบ|รายการ)แรก/u.test(text) ? 1 : ordinalMatch ? Number(ordinalMatch[1]) : undefined;
  const requester = claim ? /(?:^|\s|ใบเบิก)ของ(.+?)(?=\s|ยอด|จำนวน|รอบ|สาขา|บาท|มีรอ|รอ(?:ฉัน|คุณ)|\d|[?？]|$)/u.exec(text)?.[1]?.trim().replace(/(?:นะคะ|นะครับ|ค่ะ|ครับ|คะ)$/u, '').trim() : undefined;
  const documents = [...text.matchAll(/(?:บิล|ใบ|เอกสาร)?เลขที่\s*([^\s,]+)|[A-Za-zก-๙]+[-/]\d[\d/-]*/gu)].map(match => match[1] ?? match[0]);
  const questionText = text.replace(/(?:อะไร|ใคร|ที่ไหน)ก็ได้/gu, '');
  const question = /[?？]|(?<!ผ้า)ไหม(?!้|พรม|ขัด)|มั้ย|ปะ(?=$|\s|คะ|ค่ะ|ครับ|นะ)|(?:หรือ|รึ|ไหม)เปล่า|(?<!น้ำ)เปล่า(?=\s*(?:คะ|ค่ะ|ครับ|จ๊ะ|จ้ะ|นะ)?\s*$)|รึยัง|หรือยัง|(?<!เ)กี่|เท่าไร|เท่าไหร่|ใคร|อะไร|ยังไง|อย่างไร|ทำไม|ที่ไหน|^(?:what|how|why|when|where|who|which|can|could|is|are|do|does)\b/iu
    .test((ordinal !== undefined || documents.length || /^(?:(?:ช่วย|ขอ)\s*)?(?:อนุมัติ|ส่ง|ยกเลิก|ลบ|บันทึก|ทำ|สร้าง|จ่าย|เลือก|เอา|ใช้)/u.test(text)) ? questionText.replace(/(?:หน่อย)?ได้(?:ไหม|มั้ย|ปะ)/gu, '') : questionText);
  const rounds = [...text.matchAll(/รอบ\s*(\d+)/gu)].map(match => match[1]!);
  const explicit = ordinal !== undefined || documents.length > 0 || rounds.length > 0 || /สาขา\s*\S+/u.test(text) || !!requester;
  return { question, ordinal, requester, documents, rounds, explicit };
}

/** Counts and lists remain advisor reads unless the person also asks to act. */
export function isLineWorkflowCountRead(text: string): boolean {
  return /กี่|เท่าไร|เท่าไหร่|รวม[^\n]*เท่า|อะไรบ้าง|ใครบ้าง/u.test(text)
    && !/(?:^|และ|แล้ว|[,;\n])\s*(?:(?:ตอนนี้|ช่วย|ขอให้|ขอ|รบกวน|ให้)\s*)*(?:อนุมัติ|ไม่อนุมัติ|ส่ง(?:ตรวจ|อนุมัติ|ใบเบิก)|บันทึกจ่าย|จ่าย|ยกเลิก|ลบ|สร้าง|ทำใบ|เปิดใบเบิก|ออกหนังสือ)(?!ไป|มา|แล้ว)/u.test(text);
}

export const MANUAL_CLAIM_AMOUNT_QUESTION = 'ยอดเท่าไรคะ';
export const MANUAL_CLAIM_AMOUNTS_QUESTION = 'รายการนี้ยอดเท่าไรคะ';
export const MANUAL_CLAIM_DESCRIPTION_QUESTION = 'เป็นค่าอะไรคะ';

/** Extract only exact user spans and the API's verified money/date candidates. */
export async function parseManualClaimLine(
  evidence: import('@watchdog-bms/contracts').LineAiInputEvidenceV2,
  candidates: import('@watchdog-bms/contracts').LineAiValueCandidatesV2,
  descriptionSpan?: string,
) {
  const verified = await verifyLineAiValueCandidatesV2(candidates, evidence);
  if (!verified || verified.completeness !== 'complete') return null;
  const amounts = verified.amounts.filter(item => !item.currencyToken || /^(?:บาท|บ\.?|฿|THB|baht)$/iu.test(item.currencyToken));
  const dates = [...verified.dates.map(item => ({ ...item, value: item.isoDate })),
    ...verified.periods.filter(item => item.kind === 'day' && item.fromDate === item.toDate).map(item => ({ ...item, value: item.fromDate }))];
  if (dates.length > 1) return null;
  const values: import('@watchdog-bms/contracts').LineReimbursementProposedClaimLineV1 = {};
  if (amounts.length === 1) values.amount = { value: amounts[0]!.value,
    proof: { kind: 'USER_TEXT', candidateId: amounts[0]!.candidateId, refs: [amounts[0]!.source] } };
  if (dates.length === 1) values.incurredDate = { value: dates[0]!.value,
    proof: { kind: 'USER_TEXT', candidateId: dates[0]!.candidateId, refs: [dates[0]!.source] } };
  const descriptions: Array<{ value: string; proof: import('@watchdog-bms/contracts').LineReimbursementFieldProofV1 }> = [];
  for (const part of evidence.parts) {
    const spans = [...verified.amounts, ...verified.dates, ...verified.periods].map(item => item.source)
      .filter(source => source.partId === part.partId).sort((a, b) => a.startUtf16 - b.startUtf16);
    let start = 0;
    for (const span of [...spans, { startUtf16: part.rawText.length, endUtf16: part.rawText.length }]) {
      const raw = part.rawText.slice(start, span.startUtf16);
      const value = raw.replace(/^(?:(?:บาท|ค่ะ|คะ|ครับ|นะ)|[\s\p{P}])+/u, '')
        .replace(/(?:(?:บาท|ค่ะ|คะ|ครับ|นะ)|[\s\p{P}])+$/u, '');
      if (Array.from(value).length >= 2) {
        const offset = start + raw.indexOf(value);
        descriptions.push({ value, proof: { kind: 'USER_TEXT', refs: [{ partId: part.partId, rawSha256: part.rawSha256,
          startUtf16: offset, endUtf16: offset + value.length }] } });
      }
      start = Math.max(start, span.endUtf16);
    }
  }
  descriptions.sort((a, b) => b.value.length - a.value.length);
  if (descriptionSpan !== undefined) {
    const match = descriptions.find(candidate => descriptionSpan && candidate.value.includes(descriptionSpan));
    descriptions.length = 0;
    const ref = match?.proof.kind === 'USER_TEXT' ? match.proof.refs?.[0] : undefined;
    if (match && ref && Array.from(descriptionSpan).length >= 2) {
      const start = ref.startUtf16 + match.value.indexOf(descriptionSpan);
      descriptions.push({ value: descriptionSpan, proof: { kind: 'USER_TEXT', refs: [{ ...ref,
        startUtf16: start, endUtf16: start + descriptionSpan.length }] } });
    }
  }
  if (descriptions[0]) values.description = descriptions[0];
  const question = amounts.length > 1 ? MANUAL_CLAIM_AMOUNTS_QUESTION : !values.amount ? MANUAL_CLAIM_AMOUNT_QUESTION
    : !values.description ? MANUAL_CLAIM_DESCRIPTION_QUESTION : undefined;
  return { values, question, amountChoices: amounts.length > 1 ? amounts.slice(0, 4).map(item => ({ label: `${Number(item.value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`, text: item.span })) : [] };
}

/** Match only user locators against the already-permitted claim rows. */
export function matchLineClaimTargets<T>(text: string, rows: T[], amounts: Array<{ value: string; span: string; currencyToken?: string }>, userId: string): T[] {
  const parsed = lineWorkflowPickerText(text, true), normalize = (s: string) => mapThaiDigits(s).toLowerCase().replace(/\s+/gu, '');
  const money = amounts.filter(a => a.currencyToken ? /^(?:บาท|บ\.?|฿|THB|baht)$/iu.test(a.currencyToken)
    : !new RegExp(`(?:รอบ|สาขา|ใบที่|รายการที่|อันที่)\\s*${a.span}(?!\\d)`, 'u').test(text));
  const words = (r: any) => [r.title, r.reason, r.categoryLabelSnapshot, r.requesterDisplayNameSnapshot, r.note, r.internalMemo, ...(r.lines ?? []).map((l: any) => l.description)].filter(Boolean).join(' ');
  let rest = text;
  for (const a of money) rest = rest.replace(a.span, '');
  rest = rest.replace(/รอบ\s*\d+|ของ\S+|(?:อัน|ใบ|รายการ)ที่\s*\d+|บาท|บ\.?(?=\s|$)|ยอด|จำนวนเงิน|ค่ะ|ครับ|คะ|ใบเบิก|ร่าง/gu, '').trim();
  const terms = rest.split(/\s+/u).filter(s => s.length >= 3);
  if (!parsed.explicit && !money.length && (!terms.length || /แก้|เปลี่ยน/u.test(text))) return [];
  return rows.filter((row, index) => {
    const r = row as any, corpus = words(r);
    return (parsed.ordinal === undefined || parsed.ordinal === index + 1)
      && (!parsed.requester || (parsed.requester === 'ฉัน' ? r.requesterUserId === userId : normalize(r.requesterDisplayNameSnapshot ?? '').includes(normalize(parsed.requester))))
      && parsed.rounds.every(round => [...mapThaiDigits(corpus).matchAll(/รอบ\s*(\d+)/gu)].some(m => m[1] === round))
      && parsed.documents.every(d => normalize(r.requestNo ?? '').includes(normalize(d)))
      && money.length <= 1 && (!money.length || (!r.currency || r.currency === 'THB') && new Decimal(r.amount ?? 0).eq(money[0]!.value))
      && (parsed.explicit || money.length === 1 || terms.every(term => normalize(corpus).includes(normalize(term))));
  });
}
