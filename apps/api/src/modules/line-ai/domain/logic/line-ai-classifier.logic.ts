import Decimal from 'decimal.js';
/**
 * Pure domain logic for LINE AI message classification.
 * No NestJS, Prisma, HTTP, LINE SDK, AI provider, or storage imports.
 */
import { extractValueCandidates, isLineWorkflowPutOff, stripLineFieldParticles, verifyLineAiValueCandidatesV2, mapThaiDigits, type LineAiIntent, type LineAiAgent, LINE_CHAT_ACTIONS } from '@watchdog-bms/contracts';
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
  const value = stripLineFieldParticles(text);
  return !!value && !isLineWorkflowPutOff(text) && !(lineWorkflowCommand(text) && lineWorkflowPickerText(text, true).explicit) && value.length <= 2000 && !lineWorkflowPickerText(text).question && !/[?？\n]/u.test(value)
    && (field === 'claim'
      ? !/^(?:ขอ|ช่วย|สร้าง|เบิก|บันทึก|ดู|ยกเลิก|ไม่ทำ|เปลี่ยน|แก้|ทำข้อ|ทำรายการ|ให้ทำ|ติดต่อเจ้าหน้าที่)/u.test(value)
      : !staffMenuCommand(value) && !parseLineCompanyCommand(value)
        && !/^(?:ยกเลิก|ไม่ทำ|ไม่ทำแล้ว|cancel|บันทึกรายจ่าย|ทำใบเบิกให้หน่อย)$/iu.test(value)
        && !LINE_CHAT_ACTIONS.some(action => action.command && action.command.toLowerCase() === value.toLowerCase()))
    && !/(?:อะไร|ยังไง|อย่างไร|ไหม|มั้ย|เท่าไร|เท่าไหร่|ทำไม|หรอ|เหรอ|บ้าง|หรือเปล่า|รึเปล่า|ไหน|ใคร|เมื่อไร|เมื่อไหร่)\s*(?:คะ|ค่ะ|ครับ|นะ|จ๊ะ|จ้า)?$|^(?:ทำไม|ยังไง|อย่างไร|ใคร|ที่ไหน|เมื่อไร|เมื่อไหร่)|^(?:what|how|why|when|where|who|which|can|could|is|are|do|does)\b/iu.test(value);
}

/** A typed number names a record when it is the whole number, or its last part after a dash or slash
 *  ("0012" names "ทดสอบ-0012"); a shared prefix never does ("ทดสอบ-0012" does not name "ทดสอบ-00120"). */
export function lineDocumentNumberMatches(recordNumber: string, typed: string): boolean {
  const norm = (value: string) => mapThaiDigits(value).normalize('NFC').toLowerCase().replace(/\s+/gu, '');
  const record = norm(recordNumber), want = norm(typed);
  return !!want && (record === want || record.endsWith(want) && /[-/]$/u.test(record.slice(0, -want.length)));
}

/** Shared cues for the delivered-card matcher and the permitted-list matcher. */
export function lineWorkflowPickerText(rawText: string, claim = false) {
  const text = mapThaiDigits(rawText.trim()).replace(/ใบเบก/gu, 'ใบเบิก');
  const ordinalMatch = /(?:(?:อัน|ใบ|รายการ|ร่าง)ที่|ข้อ)\s*(\d+|[ก-๙]+)/u.exec(text);
  const ordinalNumber = ordinalMatch && extractValueCandidates(ordinalMatch[1]!).amounts[0]?.value;
  const ordinal = /(?:อัน|ใบ|รายการ)แรก/u.test(text) ? 1 : ordinalNumber ? Number(ordinalNumber) : undefined;
  const namedRequester = claim ? stripLineFieldParticles(/(?:^|\s|ใบเบิก)ของ(.+?)(?=\s|ยอด|จำนวน|รอบ|สาขา|บาท|มีรอ|รอ(?:ฉัน|คุณ)|\d|[?？]|$)/u.exec(text)?.[1] ?? '') || undefined : undefined;
  const self = claim && /ของ(?:ฉัน|ผม(?:เอง)?|เรา|ตัวเอง|หนู|เค้า)(?=\s|ยอด|จำนวน|รอบ|สาขา|บาท|มีรอ|รอ|\d|[?？]|นะคะ|นะครับ|ค่ะ|ครับ|คะ|$)/u.test(text);
  const requester = self || namedRequester && /^(?:ฉัน|ผม(?:เอง)?|เรา|ตัวเอง|หนู|เค้า)$/u.test(namedRequester) ? 'ฉัน' : namedRequester;
  const documents = [...text.matchAll(/(?:บิล|ใบ|เอกสาร)?(?:เลขที่|เลขท้าย|ลงท้าย|เลข)\s*([A-Za-zก-๙]+[-/]\d[\d/-]*|[A-Za-z0-9][A-Za-z0-9/-]*)|[A-Za-zก-๙]+[-/]\d[\d/-]*/gu)].map(match => match[1] ?? match[0]);
  const questionText = text.replace(/(?:อะไร|ใคร|ที่ไหน)ก็ได้|เดี๋ยวบอก(?:ว่า)?ใบไหน|เดี๋ยวบอกใบที่จะทำ|บอกทีหลัง/gu, '');
  const questionTail = text.replace(/[.!?,…ๆ]+$/u, '').trim();
  // "A หรือ B" ending in a question particle asks; amount alternatives and "…ก็ได้" are statements.
  const alternativeQuestion = /หรือ/u.test(text) && /(?:คะ|จ๊ะ|ครับ|คับ|ฮะ|งับ)[าะ]*$/u.test(questionTail)
    && stripLineFieldParticles(questionTail) !== questionTail && !/\d[\d,.]*\s*(?:บาท|บ\.?)?\s*หรือ\s*\d/u.test(text)
    && !/ก็ได้/u.test(text) && !/^(?:เงินสด|โอน|บัตร|เช็ค)/u.test(text);
  const question = /สถานะ|ถึงไหนแล้ว|อยู่ขั้นไหน|ใครถืออยู่|ไหน\s*(?:คะ|ค่ะ|ครับ|จ้ะ|จ๊ะ|นะ|แล้ว)?[.!ๆ]*$/u.test(questionText) || alternativeQuestion || /[?？]|(?<!ผ้า)ไหม(?!้|พรม|ขัด)|มั้ย|ปะ(?=$|\s|คะ|ค่ะ|ครับ|นะ)|(?:หรือ|รึ|ไหม)เปล่า|(?<!น้ำ)เปล่า(?=\s*(?:คะ|ค่ะ|ครับ|จ๊ะ|จ้ะ|นะ)?\s*$)|รึยัง|หรือยัง|(?<!เ)กี่|เท่าไร|เท่าไหร่|ใคร|อะไร|ยังไง|อย่างไร|ทำไม|ที่ไหน|ตรงไหน|ช่องไหน|^(?:what|how|why|when|where|who|which|can|could|is|are|do|does)\b/iu
    .test((ordinal !== undefined || documents.length || /^(?:(?:ช่วย|ขอ)\s*)?(?:อนุมัติ|ส่ง|ยกเลิก|ลบ|บันทึก|ทำ|สร้าง|จ่าย|เลือก|เอา|ใช้)/u.test(text)) ? questionText.replace(/(?:หน่อย)?ได้(?:ไหม|มั้ย|ปะ)/gu, '') : questionText);
  const rounds = [...text.matchAll(/รอบ\s*(?:ที่\s*)?(\d+|แรก|[ก-๙]+)/gu)].flatMap(match => {
    const number = match[1] === 'แรก' ? '1' : extractValueCandidates(match[1]!).amounts[0]?.value;
    return number ? [number] : [];
  });
  const explicit = ordinal !== undefined || documents.length > 0 || rounds.length > 0 || /สาขา\s*\S+/u.test(text) || !!requester;
  const categoryWords = [...stripLineFieldParticles(text).matchAll(/ค่า(?:(?!รอบ|ของ|ยอด|จำนวน|ให้|หน่อย|ส่ง|อนุมัติ|ยกเลิก|สถานะ|ถึงไหน|อยู่ขั้น|ใคร)[ก-๙])+/gu)]
    .map(match => match[0]).filter(word => word !== 'ค่าใช้จ่าย');
  return { question, ordinal, requester, documents, rounds, explicit, categoryWords };
}

/** Explicit action language is also used before admission and when a person changes jobs. */
export function lineWorkflowCommand(rawText: string): import('@watchdog-bms/contracts').LineWorkflowId | undefined {
  if (lineWorkflowPickerText(rawText).question || /^(?:(?:ขอ|ช่วย|รบกวน)\s*)*(?:วิธี|อธิบาย|สอน)|^explain\b/iu.test(rawText.trim())) return;
  const text = rawText.replace(/อนุมัด/gu, 'อนุมัติ').replace(/ปฎิเสธ|ปฏิเสธ/gu, 'ไม่อนุมัติ').replace(/ใบเบก/gu, 'ใบเบิก')
    .replace(/\bapprove\s*(?:claim|ใบเบิก)/giu, 'อนุมัติใบเบิก').replace(/\bcancel\s*(?:claim|ใบเบิก)/giu, 'ยกเลิกใบเบิก')
    .replace(/\breject\s*(?:claim|ใบเบิก)/giu, 'ไม่อนุมัติใบเบิก').replace(/\bsubmit\s*(?:claim|ใบเบิก)/giu, 'ส่งใบเบิกอนุมัติ')
    .replace(/\bpay\s*(?:claim|ใบเบิก)/giu, 'จ่ายคืนใบเบิก').replace(/\s+(?=ใบเบิก)/gu, '').trim().replace(/^(?:หมายถึง|ขอทำอย่างเดียวก่อน)[\s,]*/u, '').replace(/^(?:(?:ช่วย|ขอ)\s*)+/u, '');
  // "อย่าลบร่าง", "ไม่ต้องยกเลิกใบเบิก": a negated verb never starts that job.
  if (/(?:อย่า|ไม่ต้อง|ห้าม)\s*(?:ลบ|ยกเลิก|ยืนยัน|อนุมัติ|ส่ง|จ่าย|บันทึก|สร้าง|ทำ)/u.test(text)) return;
  if (/ส่ง(?:ใบเบิก.*อนุมัติ|อนุมัติใบเบิก)|ใบเบิก.*(?<!ที่|ถูก)ส่ง(?:ให้|เข้า(?:คิว)?)?อนุมัติ/u.test(text)) return 'reimbursement_submit';
  if (/ใบเตรียมจ่าย/u.test(text) && (/^(?:สร้าง|ทำ)ใบเตรียมจ่าย/u.test(text) || lineVoucherWorkflowAction(text))) return 'payment_voucher';
  if (/^(?:ออก|ทำ)(?:(?:หนังสือรับรอง)?(?:หัก\s*ณ\s*ที่จ่าย)?\s*50\s*ทวิ|หนังสือรับรองหัก\s*ณ\s*ที่จ่าย)/u.test(text)) return 'wht_certificate';
  return ([
    ['reimbursement_reject', /ไม่อนุมัติใบเบิก|ใบเบิก.*(?<!ที่|ถูก|โดน)ไม่อนุมัติ(?!แล้ว)/u], ['approvals', /(?<!ไม่)อนุมัติใบเบิก|ใบเบิก.*(?<!ไม่|รอ|ที่|ผ่าน|ได้รับ|ถูก)อนุมัติ(?!แล้ว)/u],
    ['reimbursement_submit', /ส่งใบเบิก.*อนุมัติ/u], ['reimbursement_cancel', /(?:ยกเลิก|ถอน|ดึงกลับ)ใบเบิก|ใบเบิก.*(?<!ที่|ถูก|โดน)(?:ยกเลิก|ถอน|ดึงกลับ)(?!แล้ว|ไป)/u],
    ['expense_confirm', /ยืนยัน(?:บิล|รายการ|รายจ่าย|ค่าใช้จ่าย)/u], ['expense_submit', /ส่ง(?:ตรวจ(?:บิล|รายจ่าย|ค่าใช้จ่าย)|(?:บิล|รายจ่าย|ค่าใช้จ่าย).*ให้ตรวจ)/u],
    ['expense_delete', /ลบ(?:ร่าง|บิล|รายจ่าย|ค่าใช้จ่าย)/u], ['expense_void', /^ยกเลิก(?:บิล|รายการ|รายจ่าย|ค่าใช้จ่าย)/u],
    ['reimbursement_pay', /^(?:บันทึกจ่ายคืน|จ่ายคืนใบเบิก|โอนคืน(?:ผู้เบิก|ใบเบิก))|ใบเบิก.*(?<!ที่|ถูก|ได้รับเงิน)(?:จ่ายคืน|โอนคืน)(?!แล้ว)/u], ['expense_pay', /^(?:บันทึกจ่าย|จ่ายเงิน)/u],
    ['payment_voucher', /^(?:สร้าง|ทำ)ใบเตรียมจ่าย/u], ['substitute_receipt', /^(?:ทำ|สร้าง|เตรียม)?ใบรับรองแทนใบเสร็จ/u],
  ] as Array<[import('@watchdog-bms/contracts').LineWorkflowId, RegExp]>).find(([, pattern]) => pattern.test(text))?.[0];
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
  const thb = verified.amounts.filter(item => item.currencyToken && /^(?:บาท|บ\.?|฿|THB|baht)$/iu.test(item.currencyToken));
  const amounts = thb.length === 1 && !/หรือ/u.test(evidence.parts.map(part => part.rawText).join(' ')) ? thb : verified.amounts.filter(item => !item.currencyToken || /^(?:บาท|บ\.?|฿|THB|baht)$/iu.test(item.currencyToken));
  const dates = [...verified.dates.map(item => ({ ...item, value: item.isoDate })),
    ...verified.periods.filter(item => item.kind === 'day' && item.fromDate === item.toDate).map(item => ({ ...item, value: item.fromDate }))];
  if (dates.length > 1) return null;
  const values: import('@watchdog-bms/contracts').LineReimbursementProposedClaimLineV1 = {};
  if (amounts.length === 1) values.amount = { value: amounts[0]!.value,
    proof: { kind: 'USER_TEXT', candidateId: amounts[0]!.candidateId, refs: [amounts[0]!.source] } };
  if (dates.length === 1) values.incurredDate = { value: dates[0]!.value,
    proof: { kind: 'USER_TEXT', candidateId: dates[0]!.candidateId, refs: [dates[0]!.source] } };
  const descriptions: Array<{ value: string; proof: import('@watchdog-bms/contracts').LineReimbursementFieldProofV1 }> = [];
  const amountDescriptions: Array<{ amount: string; description: NonNullable<typeof values.description> }> = [];
  for (const part of evidence.parts) {
    const spans = [...verified.amounts, ...verified.dates, ...verified.periods].map(item => item.source)
      .filter(source => source.partId === part.partId).sort((a, b) => a.startUtf16 - b.startUtf16);
    let start = 0;
    for (const span of [...spans, { startUtf16: part.rawText.length, endUtf16: part.rawText.length }]) {
      const raw = part.rawText.slice(start, span.startUtf16);
      const value = stripLineFieldParticles(raw.replace(/^(?:บาท|บ\.?(?=\s|กับ|และ|$)|฿|THB|baht|[\s\p{P}])+/iu, '').replace(/^(?:(?:ขอ)?(?:สร้าง|ทำ)?ใบเบิก|ขอเบิก|เบิก|กับ|และ)\s*/u, ''));
      const amount = amounts.find(amount => amount.source.partId === part.partId && amount.source.startUtf16 === span.startUtf16);
      if (Array.from(value).length >= 2 && value !== 'หรือ') {
        const offset = start + raw.indexOf(value);
        descriptions.push({ value, proof: { kind: 'USER_TEXT', refs: [{ partId: part.partId, rawSha256: part.rawSha256,
          startUtf16: offset, endUtf16: offset + value.length }] } });
        if (amount) amountDescriptions.push({ amount: amount.value, description: descriptions.at(-1)! });
      } else if (amount && value === 'หรือ' && amountDescriptions.length) {
        amountDescriptions.push({ amount: amount.value, description: amountDescriptions.at(-1)!.description });
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
  return { values, question, amountDescriptions, amountChoices: amounts.length > 1 ? amounts.slice(0, 4).map(item => ({ label: `${Number(item.value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`, text: item.span })) : [] };
}

/** Keep bounded claim searches aligned with the same user locators as the picker. */
export function lineClaimTargetSearch(text: string, amounts: Array<{ value: string }>): string | undefined {
  const parsed = lineWorkflowPickerText(text, true);
  if (parsed.documents.length === 1) return parsed.documents[0];
  if (!(parsed.rounds.length && (parsed.categoryWords.length || parsed.requester || amounts.length === 1)
    || amounts.length === 1 && parsed.requester)) return;
  return [amounts.length === 1 ? amounts[0]!.value : '', parsed.requester && parsed.requester !== 'ฉัน' ? parsed.requester : '',
    ...parsed.categoryWords, ...parsed.rounds.map(round => `รอบ ${round}`)].filter(Boolean).join(' ');
}

/** Match only user locators against the already-permitted claim rows. */
export function matchLineClaimTargets<T>(text: string, rows: T[], amounts: Array<{ value: string; span: string; currencyToken?: string }>, userId: string): T[] {
  const parsed = lineWorkflowPickerText(text, true), normalize = (s: string) => mapThaiDigits(s).toLowerCase().replace(/\s+/gu, '');
  const withoutDocuments = parsed.documents.reduce((raw, document) => raw.replaceAll(document, ''), mapThaiDigits(text));
  const money = amounts.filter(a => a.currencyToken ? /^(?:บาท|บ\.?|฿|THB|baht)$/iu.test(a.currencyToken)
    : withoutDocuments.includes(mapThaiDigits(a.span)) && !new RegExp(`(?:รอบ|สาขา|ใบที่|รายการที่|อันที่)\\s*${a.span}(?!\\d)`, 'u').test(text));
  const words = (r: any) => [r.title, r.reason, r.categoryLabelSnapshot, r.requesterDisplayNameSnapshot, r.note, r.internalMemo, ...(r.lines ?? []).map((l: any) => l.description)].filter(Boolean).join(' ');
  let rest = text;
  for (const a of money) rest = rest.replace(a.span, '');
  rest = rest.replace(/รอบ\s*\d+|ของ\S+|(?:อัน|ใบ|รายการ)ที่\s*\d+|บาท|บ\.?(?=\s|$)|ยอด|จำนวนเงิน|ค่ะ|ครับ|คะ|ใบเบิก|ร่าง/gu, '').trim();
  const terms = rest.split(/\s+/u).filter(s => s.length >= 3);
  if (!parsed.explicit && !money.length && (!terms.length || /แก้|เปลี่ยน/u.test(text))) return [];
  const ordinalRows = parsed.requester && /(?:ใบ|อัน|รายการ)แรก/u.test(text)
    ? rows.filter(candidate => parsed.requester === 'ฉัน' ? (candidate as any).requesterUserId === userId
      : normalize((candidate as any).requesterDisplayNameSnapshot ?? '').includes(normalize(parsed.requester!))) : rows;
  return rows.filter((row, index) => {
    const r = row as any, corpus = words(r);
    const ordinalIndex = ordinalRows === rows ? index : ordinalRows.indexOf(row);
    return (parsed.ordinal === undefined || parsed.ordinal === ordinalIndex + 1)
      && (!parsed.requester || (parsed.requester === 'ฉัน' ? r.requesterUserId === userId : normalize(r.requesterDisplayNameSnapshot ?? '').includes(normalize(parsed.requester))))
      && parsed.categoryWords.every(word => normalize(corpus).includes(normalize(word)))
      && parsed.rounds.every(round => [...mapThaiDigits(corpus).matchAll(/รอบ\s*(\d+)/gu)].some(m => m[1] === round))
      && parsed.documents.every(d => lineDocumentNumberMatches(r.requestNo ?? '', d))
      && money.length <= 1 && (!money.length || (!r.currency || r.currency === 'THB') && new Decimal(r.amount ?? 0).eq(money[0]!.value))
      && (parsed.explicit || money.length === 1 || terms.every(term => normalize(corpus).includes(normalize(term))));
  });
}

export function lineVoucherWorkflowAction(text: string): 'VOUCHER_SUBMIT' | 'VOUCHER_APPROVE' | 'VOUCHER_PAY' | undefined {
  if (!/ใบเตรียมจ่าย/u.test(text)) return;
  // Verbs start a word: "ใบเตรียมจ่ายที่อนุมัติแล้ว" or "…ที่จ่ายแล้ว" describes a voucher, it asks for no step.
  const verb = ` ${text.replace(/ใบเตรียมจ่าย/gu, ' ')}`;
  return /\s(?:บันทึก)?จ่าย|\bpay\b/iu.test(verb) ? 'VOUCHER_PAY'
    : /\sส่ง\S*(?:\s.*)?อนุมัติ|\bsubmit\b/iu.test(verb) ? 'VOUCHER_SUBMIT'
      : /\s(?:ขอ)?อนุมัติ|\bapprove\b/iu.test(verb) ? 'VOUCHER_APPROVE' : undefined;
}
