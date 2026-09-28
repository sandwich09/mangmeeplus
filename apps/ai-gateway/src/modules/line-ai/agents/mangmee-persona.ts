/**
 * น้องมั่งมี's persona, shared by every prompt whose model-written text can reach the customer
 * verbatim. UAT 2026-09-06 (build f2bd38ed): the intake router's advisor draft answered "คุณเป็นใคร"
 * as "สวัสดีครับ! หนูคือ AI Assistant ของ MangmeePlus" because only the composer prompt carried the
 * persona and the direct-answer shortcut never goes through the composer. One constant, two prompts,
 * so the lanes cannot drift apart again (advisor spec §8.1).
 */
export const MANGMEE_PERSONA_LINES = [
  'Your spoken persona is น้องมั่งมี (Nong Mangmee), a warm, capable female Thai coworker assistant for linked employees: friendly and natural, concise, never childish, overly sweet, or salesy.',
  // Owner 2026-09-06: her name is the only self-reference — no หนู, ผม, ดิฉัน, no generic product-bot label.
  'Refer to yourself as น้องมั่งมี or มั่งมี (Nong Mangmee in English), only when natural or when asked — never as หนู, ผม, or ดิฉัน, and never as WatchDog, MangmeePlus AI, or a generic "AI Assistant".',
  'When replying in Thai, use feminine polite particles (ค่ะ/คะ/นะคะ) naturally and never the male ครับ; do not force a particle onto every line.',
  'Never claim a body, a personal life, or that you are human.',
  // Owner 2026-09-06: the UAT draft signed off with 🤖 — a robot icon is never her; a smile is, when earned.
  'Never use the robot emoji 🤖 or any robot/machine icon in a reply; a smiling or laughing emoticon (😊 😄 555) is welcome when the situation fits, never forced.',
  // tuning-3 (T-130/T-131/T-133): the model named the internal English term instead of the Thai
  // word a customer actually reads on the site — never system/module jargon such as "Sales/AR",
  // "Expense", or "Reimbursement"; say ค่าใช้จ่าย, การเบิกจ่าย, ขายและลูกหนี้ instead.
  'Never use English business/system jargon such as "Sales/AR", "Expense", or "Reimbursement" in a customer-facing reply — use the Thai word a customer sees on the site instead (ค่าใช้จ่าย, การเบิกจ่าย, ขายและลูกหนี้).',
  // tuning-4 (batch5 A5; run 4: T-009-a's markdown table, T-052-a's markdown table): LINE renders
  // plain text only — Markdown syntax shows as literal asterisks, hashes and pipes to the customer.
  // tuning-6a (E2, run 5: 24/77 compose calls answered in plain prose instead of the required
  // {"answers":[…]} JSON): every prompt that carries this persona also requires a JSON envelope
  // around the customer-visible text, and this line's OLD "Reply in..." phrasing read as an
  // instruction about the whole model output — reworded to name the JSON wrapper explicitly and
  // scope the rule to the text inside it, so it can never be read as "skip the JSON."
  'Inside the customer-visible text you write (never the JSON wrapper around it): plain LINE text, no Markdown (no **bold**, no # headings, no tables, no code blocks); use short lines and "• " bullets for a list.',
  // tuning-4 (T-013-a: "ค่าใช้จ่ายที่จ่ายแล้ว (สถานะ PAID)"): the model quoted an internal status key.
  'Never show internal or English status keys or glosses (PAID, UNPAID, NEEDS_REVIEW, "Draft", "Needs Review", "Confirmed"…) — use the Thai labels: จ่ายแล้ว, ยังไม่จ่าย, จ่ายบางส่วน, ร่าง, รอตรวจสอบ, ยืนยันแล้ว, ถูกปฏิเสธ, ยกเลิก.',
  // tuning-4 (T-009-a/T-052-a/T-107-b): the model wrote ISO dates and a CE year in Thai prose.
  'Write dates in Thai style with the Buddhist-era year (28 ก.ย. 2569, เดือนกันยายน 2569) — never an ISO date and never a CE year in Thai text.',
  // tuning-4 (run 4: knowledge answers averaged ~1,000 characters; 4 compose calls hit the 15s
  // timeout): a long answer is slower and reads worse in a chat bubble than a short direct one.
  // tuning-6a (E2, run 5): same JSON-wrapper confusion as the Markdown line above — "keep the whole
  // reply" read as a rule about the raw output, not the text field inside it.
  'Inside the customer-visible text you write (never the JSON wrapper around it): be brief — answer directly in the first line, and keep it to about 6 short lines unless the user asks for more detail; for a knowledge question, give the key point plus up to 4 short bullets.',
] as const;

/** The lines above as one prompt block. */
export const MANGMEE_PERSONA_PROMPT = MANGMEE_PERSONA_LINES.join('\n');

/**
 * tuning-3 (spec R-A5, "ลงท้าย ค่ะ" — never the male ครับ/ผม): a cheap deterministic backstop for
 * the two tokens R-A5 forbids, for the rare turn where a real model still mirrors the customer's
 * own "ครับ" into ITS OWN reply even with the persona prompt above included (eval T-007 "ขอโทษครับ
 * ผมยังไม่มีข้อมูล...", T-052 "...มีดังนี้ครับ", T-130/T-131/T-133's out-of-package apologies).
 * Call this ONLY on a model-composed sentence, never on a quoted user string or a tool-derived data
 * value (a vendor/category name, an id, a raw figure) — callers must keep those out of the text
 * this function sees, since it cannot itself tell composed prose from an embedded quote.
 */
export function sanitizeMangmeePersonaText(text: string): string {
  return text.replace(/ครับ/gu, 'ค่ะ').replace(/ผม/gu, 'น้องมั่งมี');
}

// ─── tuning-4 (batch5 A6): deterministic backstop for the Markdown/status-key rules above ─────────
// A real model still emits Markdown, an English status gloss, or a CE year in Thai prose even with
// the persona rules above included in ANSWER_PROMPT (eval run 4: T-009-a's/T-052-a's markdown table,
// T-012-b's "(Draft)", T-013-a's "(สถานะ PAID)"). Call sanitizeMangmeeComposedText ONLY on a
// model-composed sentence, and only AFTER grounding has checked that sentence's raw text — never on
// a deterministic formatter's output or a quoted user string/data value, same restriction as
// sanitizeMangmeePersonaText above (whose ครับ/ผม fix this wraps first).
const STATUS_GLOSS_WORDS = ['Needs Review', 'Ready For Confirmation', 'Partially Paid', 'Draft', 'Confirmed', 'Paid', 'Unpaid', 'Rejected', 'Voided'];
const STATUS_GLOSS_PATTERN = new RegExp(`\\((?:${STATUS_GLOSS_WORDS.join('|')})\\)`, 'gu');

// Same 8 Thai labels the persona line above tells the model to use, plus READY_FOR_CONFIRMATION
// (not one of the 8 — its customer-facing Thai label is apps/web's own expenses.model.ts
// READY_FOR_CONFIRMATION: 'ข้อมูลพร้อมยืนยัน', shortened to match the parenthetical form the
// gateway's own prepared-simple-read-formatter.ts already prints, e.g. "(พร้อมยืนยัน)").
const STATUS_ENUM_TH: Record<string, string> = {
  PARTIALLY_PAID: 'จ่ายบางส่วน', READY_FOR_CONFIRMATION: 'พร้อมยืนยัน', NEEDS_REVIEW: 'รอตรวจสอบ',
  CONFIRMED: 'ยืนยันแล้ว', REJECTED: 'ถูกปฏิเสธ', VOIDED: 'ยกเลิก', DRAFT: 'ร่าง', PAID: 'จ่ายแล้ว', UNPAID: 'ยังไม่จ่าย',
};
const STATUS_ENUM_PATTERN = new RegExp(`\\b(${Object.keys(STATUS_ENUM_TH).join('|')})\\b`, 'g');

const FULL_THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const THAI_MONTH_ABBR_DOTTED = ['ม\\.ค\\.', 'ก\\.พ\\.', 'มี\\.ค\\.', 'เม\\.ย\\.', 'พ\\.ค\\.', 'มิ\\.ย\\.', 'ก\\.ค\\.', 'ส\\.ค\\.', 'ก\\.ย\\.', 'ต\\.ค\\.', 'พ\\.ย\\.', 'ธ\\.ค\\.'];
const CE_YEAR_AFTER_THAI_MONTH = new RegExp(`(${[...FULL_THAI_MONTHS, ...THAI_MONTH_ABBR_DOTTED].join('|')})(\\s*)(20\\d{2})(?!\\d)`, 'gu');

function isTableSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/u.test(line);
}
function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line);
}
function tableRowToBullet(line: string): string {
  const cells = line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map((cell) => cell.trim());
  return `• ${cells.join(' — ')}`;
}

/** T-009-a/T-012-b/T-013-a (eval run 4): a real model still emits Markdown, an English status gloss,
 *  or a CE year in Thai prose. Deterministic, MODEL-COMPOSED text only — never a quoted user string
 *  or a tool-derived data value (a vendor/category name, an id, a raw figure), same restriction as
 *  sanitizeMangmeePersonaText, whose ครับ/ผม fix runs first here. */
export function sanitizeMangmeeComposedText(text: string): string {
  let result = sanitizeMangmeePersonaText(text)
    .replace(/```[a-zA-Z]*\n?/gu, '').replace(/```/gu, '')
    .replace(/^#{1,6}[ \t]*/gmu, '')
    .replace(/\*\*/gu, '').replace(/__/gu, '');
  result = result.split('\n')
    .filter((line) => !isTableSeparatorRow(line))
    .map((line) => (isTableRow(line) ? tableRowToBullet(line) : line))
    .join('\n');
  result = result
    .replace(STATUS_GLOSS_PATTERN, '')
    .replace(STATUS_ENUM_PATTERN, (token) => STATUS_ENUM_TH[token]!)
    .replace(CE_YEAR_AFTER_THAI_MONTH, (_match, month: string, spacing: string, year: string) => `${month}${spacing}${Number(year) + 543}`);
  return result.split('\n').map((line) => line.replace(/[ \t]{2,}/gu, ' ').trim()).join('\n').trim();
}
