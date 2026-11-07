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
  'Reply in the current user message language: English input gets polite, concise English without Thai particles; any Thai, including Thai-English mixed input, gets Thai. Account locale and saved style never override this. A supplied language preserves the language of a synthetic button turn.',
  'When replying in Thai, use feminine polite particles (ค่ะ/คะ/นะคะ) naturally and never the male ครับ; do not force a particle onto every line.',
  'Never claim a body, a personal life, or that you are human.',
  'Never claim that you saved, created, stored, submitted, approved or paid anything in model-written text (บันทึก/สร้าง/เก็บ…แล้ว). Only the server may acknowledge a successful write in this turn; asking for missing input must never start with a save acknowledgement.',
  'When referring to an unconfirmed expense, always say ร่าง or บันทึกร่าง, including past conversation references; never call a draft บันทึกค่าใช้จ่ายแล้ว or เพิ่งช่วยบันทึกค่าใช้จ่าย…ไปเมื่อกี้.',
  // Owner 2026-09-06: the UAT draft signed off with 🤖 — a robot icon is never her; a smile is, when earned.
  'Never use the robot emoji 🤖 or any robot/machine icon in a reply; a smiling or laughing emoticon (😊 😄 555) is welcome when the situation fits, never forced.',
  // tuning-3 (T-130/T-131/T-133): the model named the internal English term instead of the Thai
  // word a customer actually reads on the site — never system/module jargon such as "Sales/AR",
  // "Expense", or "Reimbursement"; say ค่าใช้จ่าย, การเบิกจ่าย, ขายและลูกหนี้ instead.
  'In Thai replies, use plain control names ค่าใช้จ่าย and ใบเบิก and everyday words for accounting ideas. Use paper names หัก ณ ที่จ่าย, VAT, ภ.ง.ด.3, ภ.ง.ด.53 and หนังสือรับรอง 50 ทวิ only when the user needs the paper.',
  // tuning-4 (batch5 A5; run 4: T-009-a's markdown table, T-052-a's markdown table): LINE renders
  // plain text only — Markdown syntax shows as literal asterisks, hashes and pipes to the customer.
  // tuning-6a (E2, run 5: 24/77 compose calls answered in plain prose instead of the required
  // {"answers":[…]} JSON): every prompt that carries this persona also requires a JSON envelope
  // around the customer-visible text, and this line's OLD "Reply in..." phrasing read as an
  // instruction about the whole model output — reworded to name the JSON wrapper explicitly and
  // scope the rule to the text inside it, so it can never be read as "skip the JSON."
  'Inside the customer-visible text you write (never the JSON wrapper around it): plain LINE text, no Markdown (no **bold**, no # headings, no tables, no code blocks); use short lines and "• " bullets for a list.',
  // tuning-4 (T-013-a: "ค่าใช้จ่ายที่จ่ายแล้ว (สถานะ PAID)"): the model quoted an internal status key.
  'Never show internal status keys; in English use plain English status words. In Thai never show English status glosses (PAID, UNPAID, NEEDS_REVIEW, "Draft", "Needs Review", "Confirmed"…) — use the Thai labels: จ่ายแล้ว, ยังไม่จ่าย, จ่ายบางส่วน, ร่าง, รอตรวจสอบ, ยืนยันแล้ว, ถูกปฏิเสธ, ยกเลิก.',
  // tuning-4 (T-009-a/T-052-a/T-107-b): the model wrote ISO dates and a CE year in Thai prose.
  'In English use day, short English month and CE year. In Thai write dates in Thai style with the Buddhist-era year (28 ก.ย. 2569, เดือนกันยายน 2569) — never an ISO date and never a CE year in Thai text.',
  // tuning-4 (run 4: knowledge answers averaged ~1,000 characters; 4 compose calls hit the 15s
  // timeout): a long answer is slower and reads worse in a chat bubble than a short direct one.
  // tuning-6a (E2, run 5): same JSON-wrapper confusion as the Markdown line above — "keep the whole
  // reply" read as a rule about the raw output, not the text field inside it.
  // tuning-7 (H5): run 6 composed answers were 450-1000 tokens, at ~16-20ms/token — the biggest
  // lever on full-path p95 (18.3s against a 15s target). Tighter numeric caps than tuning-4's, and a
  // list now names its own cutoff instead of silently truncating, so the customer knows more exists.
  'Inside the customer-visible text you write (never the JSON wrapper around it): be brief — answer directly in the first line, at most about 80 Thai words in about 6 short lines unless the user asks for more detail; a list stops at 8 bullets and says how many more there are and that the full list is on the link; a knowledge or definition question gets a one-sentence answer plus up to 3 short bullets; never drop a fact, limitation, scope line, or question to make room.',
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
export function sanitizeMangmeePersonaText(text: string, bareSelfReference = true): string {
  return fixMangmeeSelfReference(text.replace(/ครับ/gu, 'ค่ะ').replace(/ผม/gu, 'น้องมั่งมี'), bareSelfReference);
}

// Advisor S3 eval (2026-09-30/10-01): planner questions the customer reads verbatim still said "หนูมั่งมี" and
// "หนูช่วยดู…" although the persona bans หนู. "หนู" is also a rat ("กำจัดหนู", "ยาเบื่อหนู"), a child ("น้องหนู"), a
// shop name ("ร้านหนูนา"), a person's nickname or the customer's own self-reference, so only her own-voice forms are
// rewritten: her name, or "หนู" directly before a verb she uses about herself, never inside a quoted phrase — and the
// bare form only when the caller says nothing in the turn (the user's text, the conversation, a tool result) says หนู.
// ponytail: a closed verb list; add a verb when an eval shows a new self-reference form.
const SELF_REFERENCE_VERBS = ['ช่วย', 'จะ', 'สามารถ', 'ขอ', 'ยัง', 'ไม่', 'ได้', 'ดู', 'ดึง', 'เช็ค', 'เช็ก', 'ตรวจ', 'สรุป', 'หา',
  'แนะนำ', 'เข้าใจ', 'คิด', 'ทำ', 'บอก', 'อธิบาย', 'เตรียม', 'รบกวน', 'เอง', 'ก็'];
const SELF_REFERENCE = new RegExp(`หนูมั่งมี|(?<!เบื่อ|กำจัด|ดัก|จับ|ไล่|น้อง|ตัว|ลูก|มี|เจอ|เห็น)หนู(?=${SELF_REFERENCE_VERBS.join('|')})`, 'gu');
const QUOTED_PHRASE = /(“[^”]*”|"[^"]*")/u;

/** Her name is the only self-reference (persona line above): "หนู…" in her own voice becomes "น้องมั่งมี…". With `bare`
 *  false only "หนูมั่งมี" is rewritten, since a bare "หนู" may then be the user's or a name from the data. */
export function fixMangmeeSelfReference(text: string, bare = true): string {
  const pattern = bare ? SELF_REFERENCE : /หนูมั่งมี/gu;
  return text.split(QUOTED_PHRASE).map((part, index) => (index % 2 ? part : part.replace(pattern, 'น้องมั่งมี'))).join('');
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
// Advisor S1 eval (2026-10-01): "รายการรอตรวจสอบ (pendingReview) รวม 6 รายการ" — a tool field name glossed in
// parentheses. A parenthesized camelCase identifier is never customer wording.
const FIELD_GLOSS_PATTERN = /\((?:[a-z]+(?:[A-Z][a-z0-9]*)+)\)/gu;

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

// Round 10 (2026-09-30, NAT04 turn 1): the model copied a tool's web path into its prose — "ดูรายละเอียดเพิ่มเติมได้ที่
// /companies/<company id>/expenses" — so the customer read an app path and the company id. Composed prose names the page in
// plain Thai instead; the links the server appends itself (the เปิดดู buttons) are added after this runs and never pass here.
const APP_PAGE_TH: Record<string, string> = { expenses: 'หน้าค่าใช้จ่ายบนเว็บ', reimbursements: 'หน้าใบเบิกบนเว็บ', billing: 'หน้าแพ็กเกจบนเว็บ',
  // Advisor S1: the substitute-receipt hub (where one signs and approves) and the saved-signature page.
  'expenses/substitute-receipts': 'หน้าใบรับรองแทนใบเสร็จบนเว็บ', 'expenses/signatures': 'หน้าลายเซ็นของฉันบนเว็บ' };
// Advisor S2a eval 2026-09-30: "(renewal: none)", "(projectedShortfall = 0)" — a tool data field the model quoted
// in brackets. A web address in brackets is left alone.
const DATA_FIELD_PARENTHETICAL = /\s*\(\s*[a-z][A-Za-z0-9_.]*\s*(?:=|:(?!\/\/))[^()\n]*\)/gu;
const APP_MARKDOWN_LINK = /\[([^\]\n]+)\]\((?:https?:\/\/[^\s/)]+)?\/companies\/[^\s)]*\)/gu;
// The second segment counts only when it ends there (never the start of an id such as "/cmun9ll0j").
const APP_PATH = /(?:https?:\/\/[^\s/]+)?\/companies\/[^\s/?#)]+(?:\/([A-Za-z-]+)(?:\/([A-Za-z-]+)(?![\w-]))?)?(?:[/?#][^\s)]*)?/gu;

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
// Owner plain-Thai rule (advisor eval r10 "จะ reset ใหม่ 1 พ.ย.", final-assembly P-31 "หรือ margin ใดๆ"): two English
// business words kept reaching customers in Thai replies although ANSWER_PROMPT names both. Thai MODEL-COMPOSED text
// only, whole words only, never inside quotes, inline code or a web address — and a word the turn itself carries (the
// user's text, a tool result: a shop called "Margin", a "reset fee" category) may be a name, so it is left alone
// everywhere in the reply. ponytail: two words; add one only when an eval shows it.
const THAI_FOR_ENGLISH_WORD: ReadonlyArray<readonly [word: string, thai: string, after: string]> = [
  // r10 P-01 "ยังเหลือ margin อีก 12 ใบ": before a count of receipts the word means room to spare, not profit.
  ['margin', 'เผื่อ', '(?= ?(?:อีก ?)?\\d[\\d,]* ?ใบ)'],
  ['margin', 'กำไรส่วนต่าง', ''],
  ['reset', 'เริ่มนับใหม่', '(?: ?ใหม่)?'], // "reset ใหม่" is one "เริ่มนับใหม่"
];
const UNTRANSLATED_SPAN = String.raw`“[^”\n]*”|"[^"\n]*"|‘[^’\n]*’|` + '`[^`\\n]*`' + String.raw`|(?:https?:\/\/|www\.)\S+`;

/** `turnWords` is everything the turn supplied as text: the user's message, its context and the tool results. */
export function thaiForEnglishBusinessWords(text: string, turnWords: string): string {
  if (!/[\u0E00-\u0E7F]/u.test(text)) return text;
  let result = text;
  for (const [word, thai, after] of THAI_FOR_ENGLISH_WORD) {
    if (new RegExp(`(?<![A-Za-z])${word}(?![A-Za-z])`, 'iu').test(turnWords)) continue;
    // A single space on either side goes with the English word when Thai follows or precedes it: Thai writes no space there.
    const pattern = new RegExp(`(${UNTRANSLATED_SPAN})|(?:(?<=[\\u0E00-\\u0E7F]) )?(?<![A-Za-z0-9_@#./:-])${word}(?![A-Za-z0-9_@/:-]|\\.[A-Za-z0-9])${after}(?: (?=[\\u0E00-\\u0E7F]))?`, 'giu');
    result = result.replace(pattern, (_match: string, untranslated?: string) => untranslated ?? thai);
  }
  return result;
}

export function sanitizeMangmeeComposedText(text: string, bareSelfReference = true, turnWords?: string, language: 'th' | 'en' = 'th'): string {
  let result = sanitizeMangmeePersonaText(text, bareSelfReference)
    .replace(/```[a-zA-Z]*\n?/gu, '').replace(/```/gu, '')
    .replace(/^[ \t]*#{1,6}[ \t]*/gmu, '')
    .replace(/\*\*/gu, '').replace(/__/gu, '')
    .replace(/(?<![\p{L}\p{N}])([*_])([^\n*_]+)\1(?![\p{L}\p{N}])/gu, '$2');
  result = result.split('\n')
    .filter((line) => !isTableSeparatorRow(line))
    .map((line) => (isTableRow(line) ? tableRowToBullet(line) : line))
    .join('\n');
  result = result
    .replace(STATUS_GLOSS_PATTERN, language === 'en' ? '$&' : '')
    .replace(FIELD_GLOSS_PATTERN, '')
    .replace(STATUS_ENUM_PATTERN, (token) => language === 'en' ? token.toLowerCase().replace(/_/gu, ' ') : STATUS_ENUM_TH[token]!)
    .replace(CE_YEAR_AFTER_THAI_MONTH, (_match, month: string, spacing: string, year: string) => `${month}${spacing}${Number(year) + 543}`)
    .replace(APP_MARKDOWN_LINK, '$1')
    .replace(APP_PATH, (_match, page?: string, subpage?: string) => language === 'en' ? 'the company web app' : APP_PAGE_TH[`${page}/${subpage}`] ?? APP_PAGE_TH[page ?? ''] ?? 'หน้าเว็บของบริษัท')
    .replace(DATA_FIELD_PARENTHETICAL, '');
  result = result.split('\n').map((line) => line.replace(/[ \t]{2,}/gu, ' ').trim()).join('\n').trim();
  return turnWords === undefined || language === 'en' ? result : thaiForEnglishBusinessWords(result, turnWords);
}

// ─── Advisor S0 (R1 integrated G run 2026-10-01): the shape of a "general" answer, held in code ──────────────────
// The prompt alone did not hold three rules for an answer that reads no company data (spec §2.1 ก ง ฉ): a film list
// and a recipe ran to 7 and 11 lines (G-06, G-15), business-knowledge answers closed with the line that leads back
// to the shop (G-04, G-11, G-23), and six answers gave an agency's website from memory. MODEL-COMPOSED text only.
const LIST_MARKER = /^(?:[•·▪◦*-]|\d+[.)])\s+/u;
// Her closing offer of help with the shop, in the words the model uses for it; only ever the answer's last line.
const SHOP_LINE = /^(?:ถ้า|หาก)(?=[^\n]*(?:ร้าน|รายจ่าย|ค่าใช้จ่าย|ใบเบิก))[^\n]{0,60}ให้(?:น้องมั่งมี|มั่งมี)?ช่วย[^\n]{0,40}$|^if there(?:'s| is) anything about [^\n]{0,60} i can help with[^\n]{0,30}$/iu;
// "(rd.go.th)", "ที่ www.sso.go.th", "https://…": an agency is named; its address is never written from memory.
const WEB_ADDRESS = new RegExp([
  String.raw`\s*\((?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:th|com|org|net)(?:\/[^\s)]*)?\)`,
  String.raw`(?:\s*(?:ที่|ทาง|ผ่าน))?\s*(?:https?:\/\/|www\.)[^\s)]+`,
  String.raw`(?:\s*(?:ที่|ทาง|ผ่าน))?\s*(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:go\.th|or\.th|co\.th|ac\.th|in\.th|com|org|net)\b(?:\/[^\s)]*)?`,
].join('|'), 'giu');
const NON_BUSINESS_CHARS = 300;

/** The one line back to the shop (spec §2.1 ง, plan S0 G-06): it names only what this user can do here. */
export function steerBackLine(permissions: readonly string[], english: boolean): string {
  const has = (prefix: string) => permissions.some((permission) => permission.startsWith(prefix));
  const subject = has('expense.') ? (english ? 'the shop or its expenses' : 'ร้านหรือรายจ่าย')
    : has('reimbursement.') ? (english ? 'the shop or a reimbursement claim' : 'ร้านหรือใบเบิก') : (english ? 'the shop' : 'ร้าน');
  return english ? `If there is anything about ${subject} I can help with, just tell me.` : `ถ้ามีเรื่อง${subject}ให้ช่วย บอกได้เลยค่ะ`;
}

/** True when the composer closed its answer with its own line back to the shop. */
export function closesWithShopLine(text: string): boolean {
  return SHOP_LINE.test(text.trimEnd().split('\n').pop()!.trim());
}

export function shortLineKnowledgeText(text: string, limit = 350): string {
  const lines = text.split('\n');
  const content = lines.filter(line => line.trim());
  const points = content.length <= 3 ? text.trim() : content.slice(0, 3).join('\n');
  const graphemes = [...new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(points)];
  if (graphemes.length <= limit) return points;
  const prefix = graphemes.slice(0, Math.max(0, limit - 1)).map(part => part.segment).join('');
  const words = [...new Intl.Segmenter('th', { granularity: 'word' }).segment(prefix)];
  return words.slice(0, -1).map(part => part.segment).join('').trimEnd() + '…';
}


/**
 * A general answer never keeps the composer's own shop line or a web address. A non-business one is also cut to two
 * short lines with no list, whatever was asked for, and then gets the shop line from code.
 * ponytail: the cut keeps the first two lines that are not a list's heading, within 300 characters; a model that
 * follows the two-line rule is never cut, so this only bounds the shape of one that did not.
 */

export function shapeGeneralAnswer(text: string, nonBusiness: boolean, permissions: readonly string[], english: boolean): string {
  const lines = text.replace(WEB_ADDRESS, '').split('\n').map((line) => line.replace(/[ \t]{2,}/gu, ' ').trim());
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  if (lines.length && SHOP_LINE.test(lines[lines.length - 1]!)) lines.pop();
  if (!nonBusiness) return lines.join('\n').trim();
  const content = lines.filter(Boolean);
  // A line right before a list item is that list's heading or lead-in ("วัตถุดิบหลัก"); the items carry the answer.
  const kept = content.filter((line, index) => LIST_MARKER.test(line) || !LIST_MARKER.test(content[index + 1] ?? ''));
  const short = (kept.length ? kept : content).slice(0, 2).map((line) => line.replace(LIST_MARKER, '')).join('\n');
  const body = short.length <= NON_BUSINESS_CHARS ? short
    : `${short.slice(0, NON_BUSINESS_CHARS).replace(/\s+\S*$/u, '').replace(/[\s—–,:;(-]+$/u, '')}…`;
  return `${body}\n\n${steerBackLine(permissions, english)}`;
}
