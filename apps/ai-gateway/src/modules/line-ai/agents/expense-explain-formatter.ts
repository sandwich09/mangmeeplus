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
import { normalizeScrubDigits, scrubRecordIdentifier, scrubRecordText } from '@watchdog-bms/contracts';

type Explain = {
  found?: unknown;
  header?: Record<string, unknown>;
  lineGroups?: Record<string, unknown>;
  totals?: Record<string, unknown>;
  /** Slice B: stored header totals vs stored lines. Absent when the detail does not report it. */
  totalsIdentity?: unknown;
  assumptions?: unknown;
  amountEditableOverLine?: unknown;
  editableOverLine?: unknown;
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
export function foldDigits(value: string): string {
  return normalizeScrubDigits(value);
}

/**
 * Money-shaped, once folded: a grouped run (`99,999`), a decimal amount (`99999.00`), or any run of
 * three or more digits. Retained here because two local money PREDICATES still use it; the text
 * scrubbing itself is `scrubRecordText`'s, in contracts, shared with the API.
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
 *   3. deal with any money- or percent-shaped token (see `policy` below);
 *   4. bound the length (an OCR line is a name, not a paragraph).
 *
 * `policy` is where the two kinds of field part company:
 *
 *   - `neutralise` (default, for real OCR prose like the vendor name): replace the number with `…`
 *     and KEEP the words. Thai shops number their branches — "ร้าน 7-Eleven สาขา 123", "โลตัส สาขา
 *     456", "ปตท. สาขา 088" — so dropping the field over a digit erased the shop's name from the
 *     answer on the most common receipts there are. The guarantee is about AMOUNTS, not words and
 *     not every digit: no amount-shaped run survives — grouped, decimal, or three-or-more digits.
 *     A one- or two-digit run DOES survive by design ("7-Eleven", "สาขา 2" are names), and nothing
 *     that short reads as a total beside a grouped figure like 1,789.04.
 *   - `drop` (for enum-derived labels: charge kind, status, assumption keys): those are generated
 *     from a fixed Thai vocabulary and never legitimately contain a number, so anything that does
 *     is not a label — the neutral fallback reads better than a sentence with a hole in it, and a
 *     charge label lands inside the arithmetic line where prose does not belong.
 *
 * `undefined` means "use the neutral fallback", never "print it anyway".
 */
export function safeText(value: unknown, maxChars: number, policy: 'neutralise' | 'drop' = 'neutralise'): string | undefined {
  if (typeof value !== 'string') return undefined;
  const scrubbed = scrubRecordText(value, maxChars, policy === 'drop' ? { onMoney: 'drop' } : {});
  // `''` is the shared helper's "nothing usable left"; this channel's callers want `undefined` so
  // they fall back to a neutral label rather than printing a hole.
  return scrubbed === '' ? undefined : scrubbed;
}

/**
 * A document number is the one field whose whole job is to carry digits, so the prose rule above
 * would delete every real one (`INV-2569-00123`). It gets a structural guard instead: ONE token of
 * document-number characters — no whitespace, no grouping comma, no decimal point — which an
 * injected sentence cannot satisfy, since a sentence needs spaces and a fake total needs a
 * separator or a decimal.
 */
export function safeDocumentNumber(value: unknown): string | undefined {
  return scrubRecordIdentifier(typeof value === 'string' ? value : null, 32) ?? undefined;
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
    const label = ASSUMPTION_FIELD_LABELS[field] ?? safeText(field, MAX_CHARGE_LABEL_CHARS, 'drop');
    if (label) labels.push(label);
  }
  return labels.length > 0 ? `ยังไม่ยืนยัน: ${labels.slice(0, 4).join(' · ')} — ตรวจอีกครั้งได้ในเว็บนะคะ` : undefined;
}

/**
 * The reply. Reads ONLY `data`; refuses (undefined) unless the totals identity is fully present, so
 * an incomplete read never becomes a confident sentence about someone's money.
 */
export function formatExpenseExplainReply(data: unknown, lineDraftEditEnabled = true): string | undefined {
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
  // The vendor name is the one span of this sentence COPIED off the customer's paper, so it is
  // quoted. Without the guillemets an injected clause reads as น้องมั่งมี's own voice — the scrubber
  // can take the number and the link out of "ยอดจริง … บาท" but not the impression that the
  // assistant said it. Our own fallback wording is NOT quoted: that one really is our voice.
  const vendorRead = safeText(header['vendorName'], MAX_VENDOR_CHARS);
  const vendor = vendorRead ? `«${vendorRead}»` : 'ร้านที่ยังไม่ระบุ';
  const date = thaiBuddhistDate(header['expenseDate']);
  const docNumber = safeDocumentNumber(header['documentNumber']);
  // The status label is enum-derived on the API side, but it crosses the same untrusted boundary.
  const statusLabel = safeText(header['statusLabel'], MAX_CHARGE_LABEL_CHARS, 'drop');

  // Headline: the total, then the arithmetic that produces it, term by term, in document order.
  const chargeRows = Array.isArray(groups['charges']) ? groups['charges'] as Array<Record<string, unknown>> : [];
  const terms = [`สินค้า ${subtotal}`];
  if (nonZero(totals['discountAmount'])) terms.push(`ลบส่วนลด ${discount}`);
  for (const row of chargeRows.slice(0, 4)) {
    const amount = money(row['amount']);
    // A charge label lands INSIDE the arithmetic line, so an unscrubbed one would read as part of
    // the sum. A refused label still gets its term — the amount is the load-bearing half.
    const label = safeText(row['label'], MAX_CHARGE_LABEL_CHARS, 'drop') ?? 'ค่าใช้จ่ายเพิ่ม';
    if (amount) terms.push(`${label} ${amount}`);
  }

  const lines = [
    `บิล ${vendor}${date ? ` ${date}` : ''}${docNumber ? ` เลขที่ ${docNumber}` : ''} ยอด ${grand} บาทค่ะ`,
    `มาจาก ${terms.join(' + ')} = ยอดที่ใช้คิด VAT ${taxable} แล้วบวก VAT ${vat} เป็น ${grand}`,
  ];
  if (chargeRows.length > 0) {
    lines.push('ค่าใช้จ่ายเพิ่มแยกไว้เพื่อให้ตรวจกับบิลได้ค่ะ');
  }
  // Slice B's stored-header-vs-stored-lines check. A record whose own totals do not reconcile is
  // warned about BEFORE anything else optional, so the arithmetic above is never read as verified.
  const identity = explain.totalsIdentity && typeof explain.totalsIdentity === 'object'
    ? explain.totalsIdentity as Record<string, unknown> : undefined;
  if (identity?.['ok'] === false) {
    const gap = money(identity['gapAmount']);
    lines.push(`⚠️ ยอดหัวเอกสารกับรายการไม่ตรงกัน${gap ? ` ต่างกัน ${gap}` : ''} — ตรวจในเว็บนะคะ`);
  }
  if (statusLabel) lines.push(`สถานะตอนนี้: ${statusLabel}${header['status'] === 'READY_FOR_CONFIRMATION' ? ' (ยังไม่ยืนยัน)' : ''}`);
  const assumption = assumptionLine(explain.assumptions);
  if (assumption) lines.push(assumption);
  const editable = lineDraftEditEnabled && Array.isArray(explain.editableOverLine) && explain.editableOverLine.length > 0;
  lines.push(editable
    ? 'ถ้าจะแก้ผ่าน LINE ให้พิมพ์ฟิลด์กับค่าใหม่ ระบบจะแสดงตัวอย่างก่อน และจะบันทึกเมื่อกด “ยืนยัน” เท่านั้นค่ะ'
    : 'รายการนี้ยังแก้ผ่าน LINE ไม่ได้ค่ะ กรุณาเปิดรายการในเว็บเพื่อตรวจหรือแก้ไข');
  return lines.join('\n');
}
