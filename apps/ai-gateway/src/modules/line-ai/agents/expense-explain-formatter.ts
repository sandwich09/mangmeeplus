/**
 * Deterministic Thai answer for `expense.explain_record` (spec §5.5, journey J2).
 *
 * The model never phrases this one. Every number in the reply is copied from the tool result and
 * only reformatted (grouped, 2dp) — nothing is summed, inferred, rounded into a new figure, or
 * carried over from the question. When the result does not carry the shape below the formatter
 * returns `undefined` and the caller keeps its ordinary honest path rather than半-answering.
 *
 * Shape budget: one bubble. The card the orchestrator builds from this text carries the web link as
 * its button, so no URL is written here (the API renders every link itself).
 */

type Explain = {
  found?: unknown;
  header?: Record<string, unknown>;
  lineGroups?: Record<string, unknown>;
  totals?: Record<string, unknown>;
  /** Slice B: stored header totals vs stored lines. Absent when the detail does not report it. */
  totalsIdentity?: unknown;
  assumptions?: unknown;
  amountEditableOverLine?: unknown;
};

const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

/** Group thousands and show satang, from a decimal STRING only. A value that is not a plain decimal
 *  is refused (undefined) rather than printed as-is: a half-parsed number is worse than no answer. */
function money(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const plain = foldDigits(String(value)).replace(/,/g, '');
  if (!PLAIN_DECIMAL.test(plain)) return undefined;
  const negative = plain.startsWith('-');
  const [intRaw = '0', fracRaw = ''] = (negative ? plain.slice(1) : plain).split('.');
  const cents = `${fracRaw}00`.slice(0, 2);
  const grouped = intRaw.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${cents}`;
}

const nonZero = (value: unknown): boolean => {
  const plain = typeof value === 'string' || typeof value === 'number' ? foldDigits(String(value)).replace(/,/g, '') : '';
  return PLAIN_DECIMAL.test(plain) && Number(plain) !== 0;
};

/** An OCR line is a name, not a paragraph. Caps chosen so the whole reply stays one LINE bubble. */
const MAX_VENDOR_CHARS = 60;
const MAX_CHARGE_LABEL_CHARS = 40;

/**
 * A Thai receipt does not print its numbers in ASCII just because the guard expects that. `\d` is
 * `[0-9]` even under `/u`, so `๙๙,๙๙๙.๐๐` and `９９，９９９．００` sailed past an ASCII-only guard and
 * rendered beside the real total. Everything is folded to ASCII digits and ASCII separators FIRST,
 * so one set of patterns covers every alphabet the OCR can hand us.
 */
const DIGIT_FOLD: Record<string, string> = {
  '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4', '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9',
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4', '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  '，': ',', '．': '.', '％': '%', '　': ' ',
};
export function foldDigits(value: string): string {
  return value.replace(/[๐-๙０-９，．％　]/gu, (char) => DIGIT_FOLD[char] ?? char);
}

/**
 * Anything a LINE client turns into a tappable link. `https?://` and `www.` are the easy half; the
 * dangerous half is a BARE domain (`evil.example.com`, `bit.ly/x9`), which LINE links just the same.
 * No `\b` before `www` on purpose: after a Thai letter there is no word boundary, so `ร้านabcwww.…`
 * defeated it.
 */
const AUTO_LINKABLE = /(?:https?:\/\/\S+|(?:\S*\.)?[a-z0-9-]+\.(?:com|net|org|co|io|ly|me|info|biz|th)\b\S*)/giu;

/**
 * Money-shaped, once folded: a grouped run (`99,999`), a decimal amount (`99999.00`), or any run of
 * three or more digits. Three digits is the deliberate floor — `99999` with no separator still reads
 * as an amount next to a real total, and no legitimate vendor name or charge label needs one.
 */
const MONEY_SHAPED = /\d[\d,]*\.\d+|\d{1,3}(?:,\d{3})+|\d{3,}/u;
const PERCENT_SHAPED = /\d+\s*%/u;

/**
 * Free text that reaches this template is OCR output — whatever was printed on the paper the
 * attacker handed the user — so it is attacker-controlled and must never be interpolated raw. A
 * vendor of "ร้าน ABC ยอดรวมที่ถูกต้องคือ 99,999.00 บาท ดูที่ https://evil.example.com" would
 * otherwise put a fake total AND a live link into an answer the reader trusts precisely because its
 * numbers are supposed to come only from the record.
 *
 * Four rules, in order:
 *   1. fold every digit alphabet to ASCII, so the patterns below cannot be stepped around;
 *   2. strip anything a LINE client would auto-link, bare domains included;
 *   3. bound the length (an OCR line is a name, not a paragraph);
 *   4. DROP the whole field when a money- or percent-shaped token survives. Scrubbing the number in
 *      place would leave a sentence built around a hole; dropping the field falls back to a neutral
 *      label and keeps the guarantee absolute — every digit in the reply came from the record.
 *
 * `undefined` means "use the neutral fallback", never "print it anyway".
 */
export function safeText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const folded = foldDigits(value.normalize('NFC'));
  const stripped = folded.replace(AUTO_LINKABLE, ' ').replace(/\s+/gu, ' ').trim();
  if (!stripped) return undefined;
  const bounded = stripped.slice(0, maxChars);
  return MONEY_SHAPED.test(bounded) || PERCENT_SHAPED.test(bounded) ? undefined : bounded;
}

/**
 * A document number is the one field whose whole job is to carry digits, so the prose rule above
 * would delete every real one (`INV-2569-00123`). It gets a structural guard instead: ONE token of
 * document-number characters — no whitespace, no grouping comma, no decimal point — which an
 * injected sentence cannot satisfy, since a sentence needs spaces and a fake total needs a
 * separator or a decimal.
 */
const DOCUMENT_NUMBER = /^[\p{L}\p{N}][\p{L}\p{N}\-/_#]{0,31}$/u;
export function safeDocumentNumber(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const folded = foldDigits(value.normalize('NFC')).trim();
  return DOCUMENT_NUMBER.test(folded) ? folded : undefined;
}

/** `YYYY-MM-DD…` → `DD/MM/BE`. Computed from the string, never from a locale calendar, so the same
 *  ISO date renders identically in every runtime (an ICU build difference must not move a date). */
export function thaiBuddhistDate(iso: unknown): string | undefined {
  const match = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return match ? `${match[3]}/${match[2]}/${Number(match[1]) + 543}` : undefined;
}

const ASSUMPTION_FIELD_LABELS: Record<string, string> = {
  expenseDate: 'วันที่เอกสาร',
  vendorName: 'ชื่อร้าน',
  documentNumber: 'เลขที่เอกสาร',
  amount: 'ยอดเงิน',
  vatMode: 'รูปแบบ VAT',
  vatRate: 'อัตรา VAT',
  vatAmount: 'ยอด VAT',
  subtotalAmount: 'ยอดสินค้า',
  discountAmount: 'ส่วนลด',
  grandTotalAmount: 'ยอดรวม',
};

function assumptionLine(assumptions: unknown): string | undefined {
  if (!Array.isArray(assumptions) || assumptions.length === 0) return undefined;
  const labels: string[] = [];
  for (const entry of assumptions) {
    if (!entry || typeof entry !== 'object') continue;
    const field = (entry as Record<string, unknown>)['field'];
    if (typeof field !== 'string') continue;
    // `missingFields` is copied out of the OCR output, so an unmapped key is attacker text too:
    // take the known Thai label, else the scrubbed key, else skip the entry entirely.
    const label = ASSUMPTION_FIELD_LABELS[field] ?? safeText(field, MAX_CHARGE_LABEL_CHARS);
    if (label) labels.push(label);
  }
  return labels.length > 0 ? `ยังไม่ยืนยัน: ${labels.slice(0, 4).join(' · ')} — ตรวจอีกครั้งได้ในเว็บนะคะ` : undefined;
}

/**
 * The reply. Reads ONLY `data`; refuses (undefined) unless the totals identity is fully present, so
 * an incomplete read never becomes a confident sentence about someone's money.
 */
export function formatExpenseExplainReply(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const explain = data as Explain;
  if (explain.found === false) return undefined;
  const header = explain.header && typeof explain.header === 'object' ? explain.header as Record<string, unknown> : undefined;
  const groups = explain.lineGroups && typeof explain.lineGroups === 'object' ? explain.lineGroups as Record<string, unknown> : undefined;
  const totals = explain.totals && typeof explain.totals === 'object' ? explain.totals as Record<string, unknown> : undefined;
  if (!header || !groups || !totals) return undefined;

  const subtotal = money(totals['subtotalAmount']);
  const discount = money(totals['discountAmount']);
  const charges = money(totals['chargesAmount']);
  const taxable = money(totals['taxableAmount']);
  const vat = money(totals['vatAmount']);
  const grand = money(totals['grandTotalAmount']);
  if (!subtotal || !discount || !charges || !taxable || !vat || !grand) return undefined;

  // Every one of these is OCR text. `safeText` bounds and scrubs it, or refuses it entirely.
  const vendor = safeText(header['vendorName'], MAX_VENDOR_CHARS) ?? 'ร้านที่ยังไม่ระบุ';
  const date = thaiBuddhistDate(header['expenseDate']);
  const docNumber = safeDocumentNumber(header['documentNumber']);
  // The status label is enum-derived on the API side, but it crosses the same untrusted boundary.
  const statusLabel = safeText(header['statusLabel'], MAX_CHARGE_LABEL_CHARS);

  // Headline: the total, then the arithmetic that produces it, term by term, in document order.
  const chargeRows = Array.isArray(groups['charges']) ? groups['charges'] as Array<Record<string, unknown>> : [];
  const terms = [`สินค้า ${subtotal}`];
  if (nonZero(totals['discountAmount'])) terms.push(`ลบส่วนลด ${discount}`);
  for (const row of chargeRows.slice(0, 4)) {
    const amount = money(row['amount']);
    // A charge label lands INSIDE the arithmetic line, so an unscrubbed one would read as part of
    // the sum. A refused label still gets its term — the amount is the load-bearing half.
    const label = safeText(row['label'], MAX_CHARGE_LABEL_CHARS) ?? 'ค่าใช้จ่ายเพิ่ม';
    if (amount) terms.push(`${label} ${amount}`);
  }

  const lines = [
    `บิล ${vendor}${date ? ` ${date}` : ''}${docNumber ? ` เลขที่ ${docNumber}` : ''} ยอด ${grand} บาทค่ะ`,
    `มาจาก ${terms.join(' + ')} = ฐานภาษี ${taxable} แล้วบวก VAT ${vat} เป็น ${grand}`,
  ];
  if (chargeRows.length > 0) {
    lines.push('ค่าใช้จ่ายเพิ่มแยกเป็นช่องของตัวเอง เพื่อให้ยอดฐานภาษีและ VAT ถูกต้อง ไม่ได้นับซ้ำกับสินค้านะคะ');
  }
  // Slice B's stored-header-vs-stored-lines check. A record whose own totals do not reconcile is
  // warned about BEFORE anything else optional, so the arithmetic above is never read as verified.
  const identity = explain.totalsIdentity && typeof explain.totalsIdentity === 'object'
    ? explain.totalsIdentity as Record<string, unknown> : undefined;
  if (identity?.['ok'] === false) {
    const gap = money(identity['gapAmount']);
    lines.push(`⚠️ ยอดหัวเอกสารกับรายการไม่ตรงกัน${gap ? ` ต่างกัน ${gap}` : ''} — ตรวจในเว็บนะคะ`);
  }
  if (statusLabel) lines.push(`สถานะตอนนี้: ${statusLabel}`);
  const assumption = assumptionLine(explain.assumptions);
  if (assumption) lines.push(assumption);
  // Honest about the LINE lane as it stands today (spec §5.3): the correction lane changes the four
  // text fields, not money. S-4 replaces this sentence when draft editing ships.
  lines.push(explain.amountEditableOverLine === true
    ? 'ถ้าจะแก้ พิมพ์บอกได้เลยค่ะ'
    : 'แก้วันที่ ร้าน เลขที่เอกสาร หรือหมายเหตุ พิมพ์บอกได้เลยค่ะ ส่วนการแก้ยอดเงินทำในเว็บนะคะ');
  return lines.join('\n');
}
