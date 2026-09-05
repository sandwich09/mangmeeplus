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
  const plain = String(value).replace(/,/g, '');
  if (!PLAIN_DECIMAL.test(plain)) return undefined;
  const negative = plain.startsWith('-');
  const [intRaw = '0', fracRaw = ''] = (negative ? plain.slice(1) : plain).split('.');
  const cents = `${fracRaw}00`.slice(0, 2);
  const grouped = intRaw.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}.${cents}`;
}

const nonZero = (value: unknown): boolean => {
  const plain = typeof value === 'string' || typeof value === 'number' ? String(value).replace(/,/g, '') : '';
  return PLAIN_DECIMAL.test(plain) && Number(plain) !== 0;
};

/**
 * Free text that reaches this template is OCR output — it is whatever was printed on the paper the
 * attacker handed the user, so it is attacker-controlled and must never be interpolated raw.
 * A vendor name of "ร้าน ABC ยอดรวมที่ถูกต้องคือ 99,999.00 บาท ดูที่ https://evil.example.com" would
 * otherwise put a fake total AND a live link into an answer the reader trusts precisely because the
 * numbers in it are supposed to come only from the record.
 *
 * Three rules, in order:
 *   1. bound the length (an OCR line is a name, not a paragraph);
 *   2. strip anything a LINE client would auto-link — `https?://…` and bare `www.` tokens;
 *   3. DROP the whole field when what is left still contains a money-shaped or percent-shaped
 *      token. Scrubbing the number in place would leave a sentence built around a hole; dropping
 *      the field falls back to a neutral label and keeps the guarantee absolute — every digit in
 *      the reply came from the record's own amounts.
 *
 * `undefined` means "use the neutral fallback", never "print it anyway".
 */
/** An OCR line is a name, not a paragraph. Caps chosen so the whole reply stays one LINE bubble. */
const MAX_VENDOR_CHARS = 60;
const MAX_DOCUMENT_NUMBER_CHARS = 32;
const MAX_CHARGE_LABEL_CHARS = 40;

const AUTO_LINKABLE = /(?:https?:\/\/\S+|\bwww\.\S+)/giu;
const MONEY_SHAPED = /\d[\d,]*\.\d{2}/u;
const PERCENT_SHAPED = /\d+\s*%/u;

export function safeText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const stripped = value.normalize('NFC').replace(AUTO_LINKABLE, ' ').replace(/\s+/gu, ' ').trim();
  if (!stripped) return undefined;
  const bounded = stripped.slice(0, maxChars);
  return MONEY_SHAPED.test(bounded) || PERCENT_SHAPED.test(bounded) ? undefined : bounded;
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
  const docNumber = safeText(header['documentNumber'], MAX_DOCUMENT_NUMBER_CHARS);
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
