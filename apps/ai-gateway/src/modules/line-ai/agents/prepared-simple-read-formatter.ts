/**
 * Compiled deterministic formatters for the Phase-4 prepared simple-read lane (spec §6.2, plan Phase 5).
 *
 * This is the EXACT `${tool}::${answerShape}` allowlist of families that have a verified, model-free
 * grounded formatter. It is the source of truth for which reads may skip the model answer layer; the
 * operator env allowlist (`LINE_AI_DETERMINISTIC_RESPONSE_FAMILIES`) can only NARROW this set, never add
 * an arbitrary family. With the env empty (default) `activePreparedFamilies` is empty and no read is
 * eligible, so the whole lane is dormant.
 *
 * A formatter reads ONLY the specialist's already-grounded output (facts + bounded toolData + as-of) and
 * returns a deterministic Thai/English answer with source reference, as-of state, and link — or
 * `unverified` when the output does not match the family's exact shape, so the caller falls back to an
 * honest terminal without claiming success. No provider, no tool re-invocation.
 */
import type { LineAiWebLink, SourceRef, SpecialistOutput } from '@watchdog-bms/contracts';
import { preparedFamilyKey } from '../domain/logic/prepared-simple-read.logic';

export type PreparedFormatResult =
  | { kind: 'answer'; replyText: string; sourceRefs: SourceRef[]; webLinks: LineAiWebLink[] }
  /** The output did not match this family's verified shape — do not claim success; caller stays honest. */
  | { kind: 'unverified' };

export type PreparedFormatContext = {
  language: string;
  locale: string;
  /** The VALIDATED proposed tool input (post-sanitizer, exact-equality checked). Its fromDate/toDate name
   *  the requested period so the answer is never period-ambiguous. Never authorization — DATA only. */
  proposedInput?: Record<string, unknown>;
  /** Period-resolution spec §3.4: the Thai label of the period candidate the validated input SELECTED
   *  — the user's own words plus the dates, e.g. `เดือนที่แล้ว (1–31 ส.ค. 2569)`. Set only when the
   *  input matched a candidate exactly, so it can never name a window the tool did not read. */
  periodLabel?: string;
};

const isEnglish = (ctx: PreparedFormatContext): boolean =>
  ctx.language.toLowerCase().startsWith('en') || (!/[฀-๿]/.test(ctx.language) && ctx.locale.toLowerCase().startsWith('en'));

/** Group the source thousands like the ERP does; leaves a non-numeric string untouched. */
function groupThousands(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const [intPart, frac] = value.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

function asOfLine(asOf: string | undefined, english: boolean): string {
  if (!asOf) return '';
  const day = asOf.slice(0, 10);
  return english ? `\nData as of ${day}` : `\nข้อมูล ณ ${day}`;
}

function rangePhrase(from: string | undefined, to: string | undefined): string | undefined {
  if (from && to) return from === to ? from : `${from} – ${to}`;
  return from ?? to;
}

/**
 * The period this metric covers — stated so the answer is never period-ambiguous. It PREFERS the validated
 * proposed input (the period the user requested and the server re-validated), then falls back to the tool's
 * own echoed effective period. It NEVER fabricates: when neither names a period, it returns '' and the reply
 * simply omits the period line rather than asserting a default the tool may not have used.
 */
function periodLine(
  proposedInput: Record<string, unknown> | undefined,
  data: Record<string, unknown> | undefined,
  english: boolean,
  periodLabel?: string,
): string {
  // The label already reads as Thai ("เดือนที่แล้ว (1–31 ส.ค. 2569)"), so it replaces the bare ISO
  // range for a Thai answer; an English answer keeps the ISO dates it has always printed.
  if (!english && periodLabel) return `\nช่วง: ${periodLabel}`;
  const from = typeof proposedInput?.['fromDate'] === 'string' ? proposedInput['fromDate'] as string : undefined;
  const to = typeof proposedInput?.['toDate'] === 'string' ? proposedInput['toDate'] as string : undefined;
  let phrase = rangePhrase(from, to);
  if (!phrase) {
    const echoed = data?.['period'];
    if (typeof echoed === 'string' && echoed.trim()) phrase = echoed;
    else if (echoed && typeof echoed === 'object') {
      const e = echoed as Record<string, unknown>;
      phrase = rangePhrase(
        typeof e['fromDate'] === 'string' ? e['fromDate'] as string : undefined,
        typeof e['toDate'] === 'string' ? e['toDate'] as string : undefined,
      );
    }
  }
  if (!phrase) return '';
  return english ? `\nPeriod: ${phrase}` : `\nช่วง: ${phrase}`;
}

function sourceData(output: SpecialistOutput, tool: string): Record<string, unknown> | undefined {
  const entry = output.toolData?.find((d) => d.tool === tool);
  return entry && entry.data && typeof entry.data === 'object' && !Array.isArray(entry.data)
    ? (entry.data as Record<string, unknown>)
    : undefined;
}

/**
 * A read tool may admit that its aggregation did not cover the whole period (a page cap, a partial
 * roll-up). Those numbers UNDERSTATE the period, so a family that sees such a flag returns
 * `unverified` and the lane answers with the honest terminal instead of a wrong total. Matched on the
 * key's shape so a flag a tool adds later (`truncated`, `partial`, `capped`, …) still trips this.
 */
const INCOMPLETE_AGGREGATION_KEY = /truncat|partial|capped|incomplete/i;
function aggregationIncomplete(data: Record<string, unknown>): boolean {
  return Object.entries(data).some(([key, value]) => INCOMPLETE_AGGREGATION_KEY.test(key) && Boolean(value));
}

/** Exact 2dp half-up rounding on a plain decimal string — pure string math, no binary float
 *  anywhere (PR #238 R3): Number('90071992547409.93').toFixed(2) === '90071992547409.94', so a
 *  string that survived the whole pipeline exactly must not be handed to Number at the very last
 *  render step. The carry loop is manual because the integer part may exceed 2^53. */
function roundDecimalString2(raw: string): string {
  const negative = raw.startsWith('-');
  const [intRaw = '0', fracRaw = ''] = (negative ? raw.slice(1) : raw).split('.');
  let intPart = intRaw.replace(/^0+(?=\d)/, '');
  let cents = (fracRaw + '00').slice(0, 2);
  if (fracRaw.length > 2 && fracRaw.charCodeAt(2) >= 53 /* '5' */) {
    const bumped = String(Number(cents) + 1).padStart(2, '0'); // two digits — safe integer math
    if (bumped.length > 2) {
      cents = '00';
      const digits = intPart.split('');
      let index = digits.length - 1;
      for (;;) {
        if (index < 0) { digits.unshift('1'); break; }
        if (digits[index] === '9') { digits[index] = '0'; index -= 1; continue; }
        digits[index] = String(Number(digits[index]) + 1); break;
      }
      intPart = digits.join('');
    } else {
      cents = bumped;
    }
  }
  return `${negative ? '-' : ''}${intPart}.${cents}`;
}

const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

/** Money reaches these families in three shapes — a JS number carrying binary-float noise (33.33 + 66.67
 *  → 100.00000000000001), a Decimal string ('2450.0000' or an exact 2dp aggregate), or an
 *  already-grouped string — so all of them render at one satang precision (owner answer template
 *  2026-08-26). A decimal STRING is rounded and grouped without ever touching binary floating point,
 *  so an exact aggregate beyond 2^53/100 renders unchanged; a value that is not a number at all is
 *  shown exactly as the tool sent it rather than guessed at. */
function moneyText(value: string | number): string {
  if (typeof value === 'string') {
    const plain = value.replace(/,/g, '');
    if (PLAIN_DECIMAL.test(plain)) return groupThousands(roundDecimalString2(plain));
    return groupThousands(String(value));
  }
  if (!Number.isFinite(value)) return groupThousands(String(value));
  return groupThousands(value.toFixed(2));
}

/** Grouped count + its English noun, singular for exactly one (Thai counts need no such agreement). */
function plural(count: number, word: string): string {
  return `${groupThousands(String(count))} ${word}${count === 1 ? '' : 's'}`;
}

/** A count a family may state: a safe non-negative integer the tool itself totalled — never a float,
 *  never a string, so a re-typed or partially-parsed field is refused instead of rendered. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** A money value `moneyText` can render EXACTLY: a finite JS number or a plain decimal string. Anything
 *  else (null, an object, a formatted phrase) means the family did not get the number it promises. */
function isMoney(value: unknown): value is string | number {
  return typeof value === 'number'
    ? Number.isFinite(value)
    : typeof value === 'string' && PLAIN_DECIMAL.test(value.replace(/,/g, ''));
}

/** The specialist's permission-checked source: its reference, the `Source:` line, and the deep link that
 *  is the answer's next action. Taken from the fact the tool grounded — never invented here. */
function groundedSource(sourceRef: SourceRef | undefined, english: boolean): { sourceRefs: SourceRef[]; webLinks: LineAiWebLink[]; sourceText: string } {
  return {
    sourceRefs: sourceRef ? [sourceRef] : [],
    webLinks: sourceRef?.webPath ? [{ label: sourceRef.label, path: sourceRef.webPath }] : [],
    sourceText: sourceRef ? (english ? `\nSource: ${sourceRef.label}` : `\nที่มา: ${sourceRef.label}`) : '',
  };
}

/**
 * sales.get_sales_summary as a single revenue metric. Renders the total (grouped, honestly showing zero
 * as an explicit-empty period) plus the optional transaction count, with the specialist's permission-
 * checked source reference, the tool as-of, and the source link. Returns `unverified` if the total is
 * absent so the lane emits an honest terminal instead of a fabricated number.
 */
function formatSalesSummarySingleMetric(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'sales.get_sales_summary');
  const total = data?.['totalSales'];
  if (total === undefined || total === null || (typeof total !== 'string' && typeof total !== 'number')) {
    return { kind: 'unverified' };
  }
  const english = isEnglish(ctx);
  const totalText = groupThousands(String(total));
  const basisIsCash = data?.['basis'] === 'recorded_received_payments';
  const count = data?.['transactionCount'];
  const hasCount = typeof count === 'number' || typeof count === 'string';

  const sourceRef = output.facts.find((fact) => fact.sourceRef)?.sourceRef;
  const sourceRefs = sourceRef ? [sourceRef] : [];
  const webLinks: LineAiWebLink[] = sourceRef?.webPath ? [{ label: sourceRef.label, path: sourceRef.webPath }] : [];

  const label = english ? (basisIsCash ? 'Actual received' : 'Sales') : (basisIsCash ? 'ยอดรับเงินจริง' : 'ยอดขาย');
  const amount = english ? `${totalText} THB` : `${totalText} บาท`;
  const countText = hasCount
    ? (english ? ` (${String(count)} transactions)` : ` (${String(count)} รายการ)`)
    : '';
  const sourceText = sourceRef
    ? (english ? `\nSource: ${sourceRef.label}` : `\nที่มา: ${sourceRef.label}`)
    : '';

  const replyText = `${label}: ${amount}${countText}${periodLine(ctx.proposedInput, data, english, ctx.periodLabel)}${sourceText}${asOfLine(output.asOf, english)}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/**
 * F1 — `expense.list_recent` as a single spend metric ("สรุปค่าใช้จ่าย", current month by default).
 * The tool returns `summary.totalAmount` (the money headline), `total` (the COUNTED record basis —
 * rejected/voided documents are already excluded, `summary.cancelledCount` says how many), the effective
 * `period`, and up to five raw records. The answer states the one grounded total with its record count,
 * the excluded-cancelled condition, source, as-of and the expenses link — the records themselves are
 * never dumped into the bubble. `truncated` (the tool's page cap) means the total understates the period,
 * so the family returns `unverified` rather than answering with a number that is too small.
 */
function formatExpenseListRecentSingleMetric(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  return formatExpenseSummary(sourceData(output, 'expense.list_recent'), ctx,
    output.facts.find((fact) => fact.sourceRef)?.sourceRef, output.asOf);
}

/** Shared by prepared and full replies; the tool's effective period and count are authoritative. */
export function formatExpenseSummary(
  data: Record<string, unknown> | undefined,
  ctx: PreparedFormatContext,
  sourceRef?: SourceRef,
  asOf?: string,
): PreparedFormatResult {
  const summary = data?.['summary'];
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return { kind: 'unverified' };
  const totals = summary as Record<string, unknown>;
  const total = totals['totalAmount'];
  if (typeof total !== 'number' && typeof total !== 'string') return { kind: 'unverified' };
  if (typeof total === 'number' ? !Number.isFinite(total)
    : !PLAIN_DECIMAL.test(total.replace(/,/g, ''))) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const count = data?.['total'];
  const countAvailable = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  const cancelled = typeof totals['cancelledCount'] === 'number' ? totals['cancelledCount'] as number : 0;
  const { sourceRefs, webLinks, sourceText } = groundedSource(sourceRef, english);

  const label = english ? 'Expenses' : 'ค่าใช้จ่าย';
  const amount = english ? `${moneyText(total)} THB` : `${moneyText(total)} บาท`;
  const countText = !countAvailable ? (english ? ' (record count unavailable)' : ' (ยังยืนยันจำนวนรายการไม่ได้)')
    : english ? ` (${plural(count, 'record')})` : ` (${groupThousands(String(count))} รายการ)`;
  const cancelledText = cancelled > 0
    ? (english ? `\nExcludes ${plural(cancelled, 'rejected or voided record')}`
      : `\nไม่รวมรายการที่ยกเลิกหรือถูกปฏิเสธ ${groupThousands(String(cancelled))} รายการ`)
    : '';

  const replyText = `${label}: ${amount}${countText}${cancelledText}${periodLine(undefined, data, english, ctx.periodLabel)}${sourceText}${asOfLine(asOf, english)}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/** Plain labels for the accounting document types the ERP issues; an unknown/legacy type keeps its raw
 *  key (never a guessed label, never dropped — dropping a type would make the lines disagree with the
 *  total). English humanizes the key itself so a second label map cannot drift from this one. */
const ACCOUNTING_DOCUMENT_TYPE_TH: Record<string, string> = {
  QUOTATION: 'ใบเสนอราคา', INVOICE: 'ใบแจ้งหนี้', BILLING_NOTE: 'ใบวางบิล', RECEIPT: 'ใบเสร็จรับเงิน',
  TAX_INVOICE: 'ใบกำกับภาษี', CREDIT_NOTE: 'ใบลดหนี้', DEBIT_NOTE: 'ใบเพิ่มหนี้',
};
function documentTypeLabel(type: string, english: boolean): string {
  if (english) return type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');
  return ACCOUNTING_DOCUMENT_TYPE_TH[type] ?? type;
}

/** Enough document types to be useful in one LINE bubble; the rest are admitted by the "of N types" line. */
const MAX_DOCUMENT_TYPE_LINES = 5;

/**
 * F2 — `accounting.get_summary` as a per-document-type list ("สรุปรายการเดือนนี้"). The tool returns
 * `total` (the period's document count) and `byType[type] = { count, totalAmount }`; the answer states the
 * overall count, then count + amount per type (most documents first), the period, source, as-of and link.
 * There is NO overall amount in the tool result, so none is printed — the formatter never adds up money
 * the tool did not total. Verification repeats the spec's G1 self-check on this side of the boundary:
 * Σ `byType.count` must equal `total`, else the roll-up covered only part of the period. The tool now
 * refuses that case itself (`unavailable` + `SUMMARY_COUNT_MISMATCH` / `SUMMARY_PERIOD_TOO_LARGE`, which
 * never reaches a formatter), so this is defense in depth: a partial roll-up from any tool version yields
 * `unverified` and the lane answers with the honest terminal instead of numbers that do not add up.
 */
function formatAccountingSummaryList(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'accounting.get_summary');
  const total = data?.['total'];
  const byType = data?.['byType'];
  if (typeof total !== 'number' || !byType || typeof byType !== 'object' || Array.isArray(byType)) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  const rows: Array<{ type: string; count: number; amount: string | number }> = [];
  for (const [type, value] of Object.entries(byType as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'unverified' };
    const entry = value as Record<string, unknown>;
    const amount = entry['totalAmount'];
    if (typeof entry['count'] !== 'number' || (typeof amount !== 'number' && typeof amount !== 'string')) return { kind: 'unverified' };
    rows.push({ type, count: entry['count'], amount });
  }
  // Spec G1 self-check: a per-type roll-up that does not account for every counted document is partial.
  if (rows.reduce((sum, row) => sum + row.count, 0) !== total) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  rows.sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
  const shown = rows.slice(0, MAX_DOCUMENT_TYPE_LINES);
  const typeLines = shown.map((row) => {
    const label = documentTypeLabel(row.type, english);
    return english
      ? `\n• ${label} ${plural(row.count, 'record')}, ${moneyText(row.amount)} THB`
      : `\n• ${label} ${groupThousands(String(row.count))} รายการ ${moneyText(row.amount)} บาท`;
  }).join('');
  const moreText = rows.length > shown.length
    ? (english ? `\nShowing ${shown.length} of ${rows.length} types` : `\nแสดง ${shown.length} จาก ${rows.length} ประเภท`)
    : '';

  const headline = english
    ? `Accounting documents: ${plural(total, 'record')}`
    : `เอกสารบัญชี: ${groupThousands(String(total))} รายการ`;
  const replyText = `${headline}${typeLines}${moreText}${periodLine(ctx.proposedInput, data, english, ctx.periodLabel)}${sourceText}${asOfLine(output.asOf, english)}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/** Thai month abbreviations, spelled out so the day phrase is identical in every runtime (a locale-driven
 *  month name would drift with the host's ICU build, and a compiled answer must not). */
const THAI_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The tool's as-of instant read in the tool's OWN timezone: the civil day it lands on (so the answer can
 *  say "today" only when the data really is today) and the wall-clock time the numbers stop at. Returns
 *  undefined for a missing/unparseable as-of or an unusable timezone — the answer then omits the claim. */
function asOfInZone(asOf: string | undefined, timeZone: unknown): { day: string; time: string } | undefined {
  if (!asOf || typeof timeZone !== 'string') return undefined;
  const at = new Date(asOf);
  if (Number.isNaN(at.getTime())) return undefined;
  try {
    return {
      day: at.toLocaleDateString('en-CA', { timeZone }),
      time: at.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' }),
    };
  } catch {
    return undefined;
  }
}

/** Per-currency money rows (`{currency, count, total}`) rendered as one grounded amount each. Currencies
 *  are NEVER added together; `undefined` means the rows are malformed, `''` that the tool reported none. */
function moneyGroupsText(value: unknown, english: boolean): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const parts: string[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
    const group = row as Record<string, unknown>;
    const total = group['total'];
    const currency = group['currency'];
    if (typeof currency !== 'string' || (typeof total !== 'string' && typeof total !== 'number')) return undefined;
    parts.push(`${moneyText(total)} ${!english && currency === 'THB' ? 'บาท' : currency}`);
  }
  return parts.join(' · ');
}

/**
 * F3 — `expense.get_daily_closing` as one day's spend metric ("ค่าใช้จ่ายวันนี้"). Owner decision
 * 2026-08-26 narrowed this question to the EXPENSE side only (no revenue tool exists yet), so the answer
 * never speaks of money in, profit, or a bank balance. From the tool's real result it states the day, the
 * occurred-today record count (`occurredToday.items.total`) and the per-currency totals it returned
 * (`occurredToday.totals` / `.paid` / `.outstanding` — 4-decimal strings, one row per currency, never
 * summed across currencies), the open evidence backlog, source, as-of, and the REQUIRED source-honesty
 * line: these are entries recorded in the system, not bank movement (spec G5, §5-F3). "วันนี้" is claimed
 * only when the tool's own as-of day equals the day it answered for.
 */
function formatExpenseDailyClosingSingleMetric(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'expense.get_daily_closing');
  const day = data?.['date'];
  if (typeof day !== 'string' || !CIVIL_DATE.test(day)) return { kind: 'unverified' };
  // The validated proposed input names the day the user asked for; it must be the day the tool answered.
  const requested = ctx.proposedInput?.['date'];
  if (typeof requested === 'string' && requested !== day) return { kind: 'unverified' };
  const occurred = data?.['occurredToday'];
  if (!occurred || typeof occurred !== 'object' || Array.isArray(occurred)) return { kind: 'unverified' };
  const today = occurred as Record<string, unknown>;
  const items = today['items'];
  const count = items && typeof items === 'object' && !Array.isArray(items)
    ? (items as Record<string, unknown>)['total'] : undefined;
  if (typeof count !== 'number') return { kind: 'unverified' };
  const english = isEnglish(ctx);
  const totals = moneyGroupsText(today['totals'], english);
  const paid = moneyGroupsText(today['paid'], english);
  const outstanding = moneyGroupsText(today['outstanding'], english);
  if (totals === undefined || paid === undefined || outstanding === undefined) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  const asOfHere = asOfInZone(output.asOf, data?.['timezone']);
  const [, , month, dayOfMonth] = CIVIL_DATE.exec(day)!;
  const dayPhrase = asOfHere?.day === day
    ? (english ? `Today (${day})` : `วันนี้ (${Number(dayOfMonth)} ${THAI_MONTH_ABBR[Number(month) - 1]})`)
    // Spec §3.4: "ปิดยอดเมื่อวาน" answers for "เมื่อวาน (17 ก.ย. 2569)", not a bare ISO day.
    : (english ? `On ${day}` : ctx.periodLabel ? ctx.periodLabel : `วันที่ ${day}`);

  // Honest zero: a day with nothing recorded says so, and states no amount the tool did not return.
  const headline = english
    ? `${dayPhrase}: ${plural(count, 'expense record')}${totals ? `, total ${totals}` : ''}`
    : `${dayPhrase} มีค่าใช้จ่าย ${groupThousands(String(count))} รายการ${totals ? ` รวม ${totals}` : ''}`;
  const settledText = paid || outstanding
    ? (english
      ? `\n${[paid && `Paid ${paid}`, outstanding && `Unpaid ${outstanding}`].filter(Boolean).join(' · ')}`
      : `\n${[paid && `จ่ายแล้ว ${paid}`, outstanding && `ยังไม่ได้จ่าย ${outstanding}`].filter(Boolean).join(' · ')}`)
    : '';
  // The evidence backlog the tool returns is every OPEN blocker, not only today's, so it is stated as a
  // total rather than implied to belong to this day.
  const blockers = data?.['evidenceBlockers'];
  const blockerCount = blockers && typeof blockers === 'object' && !Array.isArray(blockers)
    ? (blockers as Record<string, unknown>)['count'] : undefined;
  const blockerText = typeof blockerCount === 'number' && blockerCount > 0
    ? (english ? `\n${plural(blockerCount, 'record')} awaiting evidence review in total`
      : `\nรอตรวจหลักฐานทั้งหมด ${groupThousands(String(blockerCount))} รายการ`)
    : '';

  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  // REQUIRED (spec G5, §5-F3): recorded entries, never bank movement. There is no bank feed (P18).
  const honestyText = english
    ? `\n(From entries recorded in the system${asOfHere ? `, up to ${asOfHere.time}` : ''} — not bank money in/out)`
    : `\n(จากรายการที่บันทึกในระบบ${asOfHere ? ` ถึง ${asOfHere.time}` : ''} — ไม่ใช่ยอดเงินเข้าออกธนาคาร)`;

  const replyText = `${headline}${settledText}${blockerText}${sourceText}${asOfLine(output.asOf, english)}${honestyText}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/**
 * F4 — `tax.get_vat_summary` as one filing metric ("VAT เดือนนี้ต้องยื่นเท่าไหร่"). From the tool's real
 * result it states the period key the tool actually read, the net amount with the SIDE it falls on (a
 * net below zero is input-heavy, never printed as a negative "ต้องนำส่ง"), both sides with the ACTIVE
 * event count behind them, the raw period status uninterpreted (so an already-FILED period cannot read
 * as "still to pay"), source, as-of, and the REQUIRED not-certified line — this is a read summary, not a
 * filed return, and the tool carries the same disclaimer. The currency must be stated by the tool: the
 * unit is never assumed. The tool's no-data branch returns a message instead of amounts, so it yields
 * `unverified` and the lane answers with the honest terminal rather than a zero nobody computed.
 */
function formatTaxVatSummarySingleMetric(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'tax.get_vat_summary');
  const periodKey = data?.['periodKey'];
  const currency = data?.['currency'];
  const net = data?.['netVat'];
  const vatOutput = data?.['vatOutput'];
  const vatInput = data?.['vatInput'];
  const events = data?.['eventCount'];
  if (typeof periodKey !== 'string' || !periodKey.trim()) return { kind: 'unverified' };
  if (typeof currency !== 'string' || !currency.trim()) return { kind: 'unverified' };
  if (!isMoney(net) || !isMoney(vatOutput) || !isMoney(vatInput) || !isCount(events)) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const unit = !english && currency === 'THB' ? 'บาท' : currency;
  const negative = typeof net === 'number' ? net < 0 : net.trim().startsWith('-');
  const magnitude = typeof net === 'number' ? Math.abs(net) : net.trim().replace(/^-/, '');
  const amount = `${moneyText(magnitude)} ${unit}`;
  const headline = english
    ? `VAT ${periodKey}: ${negative ? `input VAT exceeds output VAT by ${amount}` : `${amount} to remit`}`
    : `VAT งวด ${periodKey}: ${negative ? `ภาษีซื้อมากกว่าภาษีขาย ${amount}` : `ต้องนำส่ง ${amount}`}`;
  const sidesText = english
    ? `\nOutput VAT ${moneyText(vatOutput)} ${unit} · Input VAT ${moneyText(vatInput)} ${unit} (${plural(events, 'record')})`
    : `\nภาษีขาย ${moneyText(vatOutput)} ${unit} · ภาษีซื้อ ${moneyText(vatInput)} ${unit} (${groupThousands(String(events))} รายการ)`;
  const status = data?.['status'];
  const statusText = typeof status === 'string' && status.trim()
    ? (english ? `\nPeriod status: ${status}` : `\nสถานะงวด: ${status}`)
    : '';
  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  const certifyText = english
    ? '\n(Not certified by an accountant — check before filing)'
    : '\n(ยังไม่ผ่านการรับรองจากนักบัญชี กรุณาตรวจสอบก่อนยื่นแบบ)';

  const replyText = `${headline}${sidesText}${statusText}`
    + `${periodLine(undefined, undefined, english, ctx.periodLabel)}${sourceText}${asOfLine(output.asOf, english)}${certifyText}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/**
 * F5 — `inventory.list_low_stock` as the at-or-below-reorder-point list ("สินค้าอะไรใกล้หมดบ้าง"). The
 * tool returns the COMPLETE `count` of items at or below their reorder point plus a bounded ten-row
 * preview whose rows carry ids, quantities and location ids only — no product name, sku or unit. So the
 * answer states the grounded count with the low-stock report as source and link and names NO product: a
 * name is not in this result to state, and a bubble of product ids would say nothing a shop owner can use.
 */
function formatInventoryLowStockList(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'inventory.list_low_stock');
  const count = data?.['count'];
  if (!isCount(count)) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  const headline = english
    ? `Low stock: ${plural(count, 'item')} at or below the reorder point`
    : `สินค้าใกล้หมด (ถึงหรือต่ำกว่าจุดสั่งซื้อ): ${groupThousands(String(count))} รายการ`;

  const replyText = `${headline}${sourceText}${asOfLine(output.asOf, english)}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/**
 * F6 — `procurement.get_ap_outstanding` as one unpaid-supplier metric ("ยอดค้างจ่ายซัพพลายเออร์เท่าไหร่").
 * The tool returns its own aging cut-off day, the complete outstanding total (no page cap upstream) and
 * the number of suppliers behind it; the answer states the total for that stated day with the supplier
 * count, source, as-of and link. The top-supplier preview is NOT printed: its `supplier` field is the
 * supplier id, not a display name (`ap-reporting.use-case.ts`), so naming one would put an id in the bubble.
 */
function formatApOutstandingSingleMetric(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'procurement.get_ap_outstanding');
  const asOfDate = data?.['asOfDate'];
  const total = data?.['totalOutstanding'];
  const suppliers = data?.['supplierCount'];
  if (typeof asOfDate !== 'string' || !CIVIL_DATE.test(asOfDate)) return { kind: 'unverified' };
  if (!isMoney(total) || !isCount(suppliers)) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  const headline = english
    ? `Unpaid supplier bills as of ${asOfDate}: ${moneyText(total)} THB (${plural(suppliers, 'supplier')})`
    : `ยอดค้างจ่ายเจ้าหนี้ ณ ${asOfDate}: ${moneyText(total)} บาท (เจ้าหนี้ ${groupThousands(String(suppliers))} ราย)`;

  const replyText = `${headline}${sourceText}${asOfLine(output.asOf, english)}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/**
 * F7 — `crm.get_customer_summary` as this period's new-customer read ("เดือนนี้มีลูกค้าใหม่กี่ราย"). The
 * tool returns the day the new-customer window starts (the validated `newSince`, or the current month by
 * default) with the new / total / active counts and the two basis flags for `total`. The answer states
 * the new count for that stated day, the total with its active share, and the tool's OWN basis for that
 * total — printed because the number means different things with and without archived and merged records.
 * No customer name, id or contact ever reaches the bubble: this result carries counts only.
 */
function formatCrmCustomerSummaryList(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'crm.get_customer_summary');
  const since = data?.['newCustomersSince'];
  const until = data?.['newCustomersUntil'];
  const created = data?.['newCustomers'];
  const total = data?.['total'];
  const active = data?.['active'];
  if (typeof since !== 'string' || !CIVIL_DATE.test(since)) return { kind: 'unverified' };
  if (!isCount(created) || !isCount(total) || !isCount(active)) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  // The window is CLOSED since the tool gained `newUntil` (spec §3.3), so the answer states both ends
  // rather than implying "…until now"; a tool version that sends no end keeps the old open phrasing.
  const closed = typeof until === 'string' && CIVIL_DATE.test(until);
  const window = english
    ? (closed ? `${since} – ${until}` : `since ${since}`)
    : (closed ? `${since} – ${until}` : `ตั้งแต่ ${since}`);
  const headline = english
    ? `New customers ${window}: ${plural(created, 'customer')}`
    : `ลูกค้าใหม่${closed ? ' ' : ''}${window}: ${groupThousands(String(created))} ราย`;
  const totalText = english
    ? `\nTotal ${plural(total, 'customer')} (${groupThousands(String(active))} active)`
    : `\nลูกค้าทั้งหมด ${groupThousands(String(total))} ราย (ใช้งานอยู่ ${groupThousands(String(active))} ราย)`;
  const includesArchived = data?.['totalIncludesArchived'];
  const excludesMerged = data?.['totalExcludesMerged'];
  const basis = [
    includesArchived === true ? (english ? 'includes archived' : 'นับรวมลูกค้าที่เก็บเข้าคลัง')
      : includesArchived === false ? (english ? 'excludes archived' : 'ไม่รวมลูกค้าที่เก็บเข้าคลัง') : undefined,
    excludesMerged === true ? (english ? 'excludes merged records' : 'ไม่รวมรายการที่ถูกรวมบัญชี')
      : excludesMerged === false ? (english ? 'includes merged records' : 'นับรวมรายการที่ถูกรวมบัญชี') : undefined,
  ].filter(Boolean);
  const basisText = basis.length > 0
    ? (english ? `\n(Total: ${basis.join(' · ')})` : `\n(ยอดรวม: ${basis.join(' · ')})`)
    : '';

  const replyText = `${headline}${totalText}${basisText}`
    + `${periodLine(undefined, undefined, english, ctx.periodLabel)}${sourceText}${asOfLine(output.asOf, english)}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/**
 * Authoritative deterministic terminal copy for a prepared read that did NOT reach a verified success —
 * an unavailable/error/failed source, or a success the compiled formatter could not verify. It states an
 * honest outcome with NO fabricated facts, numbers, source, or completion, and instantiates no composer /
 * router / critic / model. `PERMISSION_DENIED` (a post-plan state change) gets the forbidden line.
 */
export function preparedTerminalReply(output: SpecialistOutput, ctx: PreparedFormatContext): string {
  const english = isEnglish(ctx);
  if (output.status === 'PERMISSION_DENIED') {
    return english ? '🔒 You do not have permission to view this information.' : '🔒 คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้ค่ะ';
  }
  return english
    ? '⏳ This information is not available right now. Please check the web app.'
    : '⏳ ตอนนี้ยังดึงข้อมูลส่วนนี้ไม่ได้ กรุณาตรวจสอบในเว็บแอปนะคะ';
}

/** Exact compiled registry: `${tool}::${answerShape}` → formatter. Add one verified family at a time. */
const COMPILED_FORMATTERS: ReadonlyMap<string, (output: SpecialistOutput, ctx: PreparedFormatContext) => PreparedFormatResult> =
  new Map([
    [preparedFamilyKey('sales.get_sales_summary', 'single_metric'), formatSalesSummarySingleMetric],
    [preparedFamilyKey('expense.list_recent', 'single_metric'), formatExpenseListRecentSingleMetric],
    [preparedFamilyKey('accounting.get_summary', 'list'), formatAccountingSummaryList],
    [preparedFamilyKey('expense.get_daily_closing', 'single_metric'), formatExpenseDailyClosingSingleMetric],
    [preparedFamilyKey('tax.get_vat_summary', 'single_metric'), formatTaxVatSummarySingleMetric],
    [preparedFamilyKey('inventory.list_low_stock', 'list'), formatInventoryLowStockList],
    // `answerShape` is untrusted advice that selects a renderer and nothing else, and both read shapes of
    // these two questions have the SAME verified deterministic answer ("ยอดค้างจ่ายเท่าไหร่" vs "เจ้าหนี้ราย
    // ไหนค้าง", "ลูกค้าใหม่กี่ราย" vs "ลูกค้าใหม่มีใครบ้าง"). Registering both keys therefore adds no new
    // copy and no new authority; it only stops the lane from missing because the router advised the other
    // shape (spec §6.2 already lists AP as single_metric OR list).
    [preparedFamilyKey('procurement.get_ap_outstanding', 'single_metric'), formatApOutstandingSingleMetric],
    [preparedFamilyKey('procurement.get_ap_outstanding', 'list'), formatApOutstandingSingleMetric],
    [preparedFamilyKey('crm.get_customer_summary', 'single_metric'), formatCrmCustomerSummaryList],
    [preparedFamilyKey('crm.get_customer_summary', 'list'), formatCrmCustomerSummaryList],
  ]);

/** The exact set of families that have a compiled formatter (before operator narrowing). */
export const COMPILED_PREPARED_FAMILY_KEYS: ReadonlySet<string> = new Set(COMPILED_FORMATTERS.keys());

/**
 * Active families = the compiled registry NARROWED by the operator allowlist. An allowlist entry that
 * is not a compiled family is ignored (it can never activate an arbitrary family); an empty allowlist
 * (default) yields the empty set, so the lane is off.
 */
export function activePreparedFamilies(allowlist: readonly string[]): ReadonlySet<string> {
  const allowed = new Set(allowlist);
  return new Set([...COMPILED_PREPARED_FAMILY_KEYS].filter((key) => allowed.has(key)));
}

/** Format via the compiled family, or `unverified` when the family/shape has no formatter. */
export function formatPreparedSimpleRead(familyKey: string, output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  return (COMPILED_FORMATTERS.get(familyKey) ?? (() => ({ kind: 'unverified' as const })))(output, ctx);
}
