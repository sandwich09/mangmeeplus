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
import { EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL, EXPENSE_PAYMENT_STATUS_LABELS, EXPENSE_STATUS_LABELS, PERIOD_ASSUMPTIONS, REIMBURSEMENT_DUPLICATE_BLOCK_LABEL, formatThaiPeriodRange, parseLineAiAnswerCardLayout } from '@watchdog-bms/contracts';
import type { LineAiAnswerCardLayout, LineAiAnswerCardRow, LineAiPeriodCandidate, LineAiWebLink, SourceRef, SpecialistOutput } from '@watchdog-bms/contracts';
import { preparedFamilyKey } from '../domain/logic/prepared-simple-read.logic';
import { aggregationIncomplete, appliedPeriod, expenseNameResolutionIssue, expenseNameResolutionReplyText, expensePeriodComparisonCard, REIMBURSEMENT_APPROVAL_NOT_PERMITTED, reimbursementApprovalNotPermittedReplyText } from '../domain/logic/business-read-result-semantics';
import { toolPermissionReplyText } from '../domain/logic/line-ai-scope-policy.logic';

export type PreparedFormatResult =
  /** `layout` is the same answer as the locked System OA card shows it (design lock spec): built from the
   *  very values `replyText` states, by the same family, so the card and the sentence cannot disagree. */
  | { kind: 'answer'; replyText: string; sourceRefs: SourceRef[]; webLinks: LineAiWebLink[]; layout?: LineAiAnswerCardLayout }
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
  /** `assumedYearNote` for that SAME selected candidate: said right after the period it qualifies. */
  periodNote?: string;
  /** Customer wording copied from the request when branch scope is explicit; never an ERP identifier. */
  branchLabel?: string;
  /** Thai calendar rendering for the as-of date, used only by the expense summary answer. */
  asOfLabel?: string;
  /** The reader's own message. It never changes a figure: it only tells a question about PAYING from a
   *  question about the record, which are two cards of the same permission-checked read. */
  messageText?: string;
  /** Display-only context for a truthful permitted alternative after a runtime denial. */
  permissions?: readonly string[];
};

export const isEnglish = (ctx: PreparedFormatContext): boolean =>
  ctx.language.toLowerCase().startsWith('en') || (!/[฀-๿]/.test(ctx.language) && ctx.locale.toLowerCase().startsWith('en'));

/** Group the source thousands like the ERP does; leaves a non-numeric string untouched. */
function groupThousands(value: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return value;
  const [intPart, frac] = value.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

function asOfLine(asOf: string | undefined, english: boolean, thaiLabel?: string): string {
  if (!asOf) return '';
  // The Bangkok civil day, not the instant's UTC date: between 00:00 and 07:00 the UTC slice said
  // yesterday (regression slice 2026-09-30, "ข้อมูล ณ 29 ก.ย." at 00:20 on the 30th).
  const day = asOfInZone(asOf, 'Asia/Bangkok')?.day ?? asOf.slice(0, 10);
  // C6 (batch 5c): always a Thai/English calendar date, never the bare ISO string — "ข้อมูล ณ 28 ก.ย.
  // 2569" / "Data as of 28 Sep 2026", always with the year. `thaiLabel` (expense-summary's own
  // full-month override, e.g. "28 กันยายน 2569") still wins when the caller supplies one.
  const label = !english && thaiLabel ? thaiLabel : thaiAbbrDate(day, english);
  return english ? `\nData as of ${label ?? day}` : `\nข้อมูล ณ ${label ?? day}`;
}

/** Pairs a from/to into one range phrase, each side rendered as a Thai/English calendar date when it is
 *  a day-precision ISO date. C6 (batch 5c): every call site here used to print the raw ISO string —
 *  `periodLabel` (checked before `periodLine` ever reaches this) was the only path that was already
 *  Thai, and only for a Thai answer. */
function rangePhrase(from: string | undefined, to: string | undefined, english: boolean): string | undefined {
  const label = (value: string) => thaiAbbrDate(value, english) ?? value;
  if (from && to) return from === to ? label(from) : `${label(from)} – ${label(to)}`;
  return from ? label(from) : to ? label(to) : undefined;
}

const THAI_FULL_MONTH_NAMES = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
function thaiIsoDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  return `${Number(value.slice(8, 10))} ${THAI_FULL_MONTH_NAMES[Number(value.slice(5, 7)) - 1]} ${Number(value.slice(0, 4)) + 543}`;
}

/** The tool timestamp is an instant; display the business date where this tenant operates. */
export function thaiExpenseAsOfLabel(asOf: string | undefined): string | undefined {
  if (!asOf) return undefined;
  const instant = new Date(asOf);
  if (!Number.isFinite(instant.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  const year = part('year'), month = part('month'), day = part('day');
  return year && month && day ? thaiIsoDate(`${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`) : undefined;
}

function thaiExpenseRange(data: Record<string, unknown> | undefined): string | undefined {
  const period = data?.['period'];
  if (!period || typeof period !== 'object' || Array.isArray(period)) return undefined;
  const range = period as Record<string, unknown>;
  const from = thaiIsoDate(typeof range['fromDate'] === 'string' ? range['fromDate'] : undefined);
  const to = thaiIsoDate(typeof range['toDate'] === 'string' ? range['toDate'] : undefined);
  return from && to ? from === to ? from : `${from} – ${to}` : undefined;
}

/**
 * The period this metric covers — stated so the answer is never period-ambiguous. It PREFERS the validated
 * proposed input (the period the user requested and the server re-validated), then falls back to the tool's
 * own echoed effective period. It NEVER fabricates: when neither names a period, it returns '' and the reply
 * simply omits the period line rather than asserting a default the tool may not have used.
 */
export function periodLine(
  proposedInput: Record<string, unknown> | undefined,
  data: Record<string, unknown> | undefined,
  english: boolean,
  periodLabel?: string,
  note = '',
): string {
  const phrase = periodPhrase(proposedInput, data, english, periodLabel);
  if (!phrase) return '';
  return english ? `\nPeriod: ${phrase}${note}` : `\nช่วง: ${phrase}${note}`;
}

/** The words of `periodLine` without its label: what the line says and what the card's row shows. */
function periodPhrase(
  proposedInput: Record<string, unknown> | undefined,
  data: Record<string, unknown> | undefined,
  english: boolean,
  periodLabel?: string,
): string | undefined {
  // The label already reads as Thai ("เดือนที่แล้ว (1–31 ส.ค. 2569)"), so it replaces the bare ISO
  // range for a Thai answer.
  if (!english && periodLabel) return periodLabel;
  const effective = appliedPeriod(data);
  const from = effective?.fromDate ?? (typeof proposedInput?.['fromDate'] === 'string' ? proposedInput['fromDate'] as string : undefined);
  const to = effective?.toDate ?? (typeof proposedInput?.['toDate'] === 'string' ? proposedInput['toDate'] as string : undefined);
  let phrase = rangePhrase(from, to, english);
  if (!phrase) {
    const echoed = data?.['period'];
    // A free-text echo (e.g. a period KEY like "2026-08") is not a day-precision date — render as-is.
    if (typeof echoed === 'string' && echoed.trim()) phrase = echoed;
    else if (echoed && typeof echoed === 'object') {
      const e = echoed as Record<string, unknown>;
      phrase = rangePhrase(
        typeof e['fromDate'] === 'string' ? e['fromDate'] as string : undefined,
        typeof e['toDate'] === 'string' ? e['toDate'] as string : undefined,
        english,
      );
    }
  }
  return phrase;
}

/**
 * Owner 2026-09-29 ("ดูรายจ่ายเดือนตุลา" on 29 Sep was answered with an empty ต.ค. 2568 and no word why): a month,
 * quarter or range written without a year resolves to its latest non-future occurrence (`year_assumed_latest_past`).
 * When that fell back to an EARLIER year than the as-of day's, the answer says the year was assumed, and — for a
 * month or quarter — that this year's one has not started yet. The flag is carried from the selected candidate,
 * never re-derived; a written year, a relative word, or a bare period read in the current year gets ''. The as-of
 * (never the process clock) is "today", like every other date this formatter prints.
 */
export function assumedYearNote(
  period: Pick<LineAiPeriodCandidate, 'kind' | 'fromDate' | 'assumptions'> | undefined,
  asOf: string | undefined,
  english: boolean,
): string {
  const today = asOfInZone(asOf, 'Asia/Bangkok')?.day;
  if (!today || !period?.assumptions.includes(PERIOD_ASSUMPTIONS.yearAssumedLatest)
    || period.fromDate.slice(0, 4) >= today.slice(0, 4)) return '';
  const month = Number(period.fromDate.slice(5, 7));
  const englishMonth = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  // A Thai quarter name carries its own trailing space: "ไตรมาส 4 ที่ผ่านมา", but "ตุลาคมที่ผ่านมา".
  const name = period.kind === 'month' ? (english ? englishMonth : THAI_FULL_MONTH_NAMES[month - 1])
    : period.kind === 'quarter' ? (english ? `Q${(month + 2) / 3}` : `ไตรมาส ${(month + 2) / 3} `) : undefined;
  const note = english ? ` (no year given, so this is the most recent ${name ?? 'such period'})`
    : ` (ไม่ได้ระบุปี จึงดู${name ?? 'ช่วง'}ที่ผ่านมาล่าสุด)`;
  const upcoming = name !== undefined && `${today.slice(0, 4)}${period.fromDate.slice(4)}` > today;
  return upcoming ? `${note}\n${english ? `This year's ${name} hasn't started yet.` : `${name}ปีนี้ยังไม่ถึงค่ะ`}` : note;
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

/** The specialist's permission-checked source reference and the deep link that is the answer's next
 *  action — taken from the fact the tool grounded, never invented here. `sourceText` is always ''
 *  (C6, batch 5c): apps/api's process-line-webhook (`formatLineReply`) and the Flex card
 *  (line-business-card.logic.ts) already append "แหล่งข้อมูล: <label>" from `sourceRefs` to every LINE
 *  answer that has one, so a "ที่มา:"/"Source:" line here made the customer read the source twice.
 *  Kept in the return shape — every caller below still interpolates it — so this is the one place
 *  that changed, not the ~15 reply templates. `english` stays a parameter for call-site parity. */
function groundedSource(sourceRef: SourceRef | undefined, english: boolean): { sourceRefs: SourceRef[]; webLinks: LineAiWebLink[]; sourceText: string } {
  void english;
  return {
    sourceRefs: sourceRef ? [sourceRef] : [],
    webLinks: sourceRef?.webPath ? [{ label: sourceRef.label, path: sourceRef.webPath }] : [],
    sourceText: '',
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
  // C6 (batch 5c): no "ที่มา:/Source:" line — see groundedSource's docstring above.
  const sourceText = '';

  const replyText = `${label}: ${amount}${countText}${periodLine(ctx.proposedInput, data, english, ctx.periodLabel, ctx.periodNote)}${sourceText}${asOfLine(output.asOf, english)}`;
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

/** Humanizes an UPPER_SNAKE enum key for an English answer (`CONFIRMED` → `Confirmed`). */
function humanizedEnum(key: string): string {
  return key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** Item 1 (spec R-A1 row 18): state the scope whenever it is not company-wide, so a STAFF/related
 *  reader with a correct own/related-only total is never left thinking it is the whole company's.
 *  Read from the tool's own TRUSTED `accessScope` echo (never inferred here) — set by the same
 *  permission logic that already narrows the query (`aiReadScope` in expense-draft.use-case.ts, and
 *  its reimbursement/daily-closing equivalents). */
function scopeLine(accessScope: unknown, english: boolean): string {
  if (accessScope === 'own') return english ? '\nScope: only your own records' : '\nขอบเขต: เฉพาะรายการของคุณ';
  if (accessScope === 'related') return english ? '\nScope: only records related to you' : '\nขอบเขต: เฉพาะรายการที่เกี่ยวข้องกับคุณ';
  return '';
}

/** The same scope as a card's note: a plain sentence, without the word "ขอบเขต" (design lock §9). */
function scopeNote(accessScope: unknown): string | undefined {
  return accessScope === 'own' ? 'แสดงเฉพาะรายการของคุณ' : accessScope === 'related' ? 'แสดงเฉพาะรายการที่เกี่ยวข้องกับคุณ' : undefined;
}

/** Spec R-A1's ตัวกรอง line — document/payment status, resolved category/vendor name, and branch —
 *  read off `queryApplied` (the tool's own TRUSTED echo of what it actually applied, never the model's
 *  raw proposed input). Shared by every `expense.list_recent`/`expense.get_breakdown`-shaped family
 *  (today: list_recent's single_metric and list; R-L4 adds get_breakdown's list) so they never phrase
 *  the same filters differently. `hasStatusFilter` is returned separately because only list_recent's
 *  single-metric basis line needs it — a status filter redefines what "pending"/"confirmed" mean, so
 *  that breakdown must hide instead of quietly disagreeing with the headline total. `scopeText` is
 *  item 1's own/related access-scope line (see `scopeLine`).
 *  Read-only reference: erp-tools.use-case.ts's expense.list_recent/get_breakdown handlers (~queryApplied). */
function expenseFilterLine(
  data: Record<string, unknown> | undefined,
  ctx: PreparedFormatContext,
  english: boolean,
): { filtersText: string; hasStatusFilter: boolean; scopeText: string; filterPhrases: string[]; accessScope: unknown } {
  const queryApplied = data?.['queryApplied'];
  const appliedFilters = queryApplied && typeof queryApplied === 'object' && !Array.isArray(queryApplied)
    ? queryApplied as Record<string, unknown> : undefined;
  const statusBasis = appliedFilters?.['statusBasis'];
  const documentStatus = typeof statusBasis === 'string' && statusBasis !== 'exclude_rejected_voided' ? statusBasis : undefined;
  const otherFiltersRaw = appliedFilters?.['filters'];
  const otherFilters = otherFiltersRaw && typeof otherFiltersRaw === 'object' && !Array.isArray(otherFiltersRaw)
    ? otherFiltersRaw as Record<string, unknown> : undefined;
  const stringFilter = (key: string): string | undefined => typeof otherFilters?.[key] === 'string' ? otherFilters[key] as string : undefined;
  const paymentStatus = stringFilter('paymentStatus');
  // Spec item 2(d): the resolved display name a categoryName/vendorName input matched to — never the
  // model's raw free-text guess — so the filter line always names the SAME category/vendor the numbers
  // above were actually computed from.
  const categoryName = stringFilter('categoryName');
  const vendorName = stringFilter('vendorName');
  const filterPhrases: string[] = [];
  const documentStatusLabel = documentStatus ? (EXPENSE_STATUS_LABELS as Record<string, string>)[documentStatus] : undefined;
  if (documentStatus && documentStatusLabel) filterPhrases.push(english ? `only ${humanizedEnum(documentStatus)}` : `เฉพาะที่${documentStatusLabel}`);
  const paymentStatusLabel = paymentStatus ? (EXPENSE_PAYMENT_STATUS_LABELS as Record<string, string>)[paymentStatus] : undefined;
  if (paymentStatus && paymentStatusLabel) filterPhrases.push(english ? `only ${humanizedEnum(paymentStatus)}` : `เฉพาะที่${paymentStatusLabel}`);
  if (categoryName) filterPhrases.push(english ? `category ${categoryName}` : `เฉพาะหมวด${categoryName}`);
  if (vendorName) filterPhrases.push(english ? `vendor ${vendorName}` : `เฉพาะร้าน${vendorName}`);
  if (ctx.branchLabel) filterPhrases.push(english ? `branch ${ctx.branchLabel}` : `เฉพาะสาขา${ctx.branchLabel}`);
  return {
    filtersText: filterPhrases.length ? (english ? `\nFilters: ${filterPhrases.join(', ')}` : `\nตัวกรอง: ${filterPhrases.join(', ')}`) : '',
    hasStatusFilter: documentStatus !== undefined || paymentStatus !== undefined,
    scopeText: scopeLine(appliedFilters?.['accessScope'], english),
    filterPhrases,
    accessScope: appliedFilters?.['accessScope'],
  };
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

  const label = english ? `${ctx.branchLabel ? `${ctx.branchLabel} — ` : ''}Expenses`
    : `${ctx.branchLabel ? `${ctx.branchLabel} — ` : ''}ค่าใช้จ่าย`;
  const amount = english ? `${moneyText(total)} THB` : `${moneyText(total)} บาท`;
  const countText = !countAvailable ? (english ? ' (record count unavailable)' : ' (ยังยืนยันจำนวนรายการไม่ได้)')
    : english ? ` (${plural(count, 'record')})` : ` (${groupThousands(String(count))} รายการ)`;
  const cancelledText = cancelled > 0
    ? (english ? `\nExcludes ${plural(cancelled, 'rejected or voided record')}`
      : `\nไม่รวมรายการที่ยกเลิกหรือถูกปฏิเสธ ${groupThousands(String(cancelled))} รายการ`)
    : '';
  // expense.list_recent narrows `summary` itself when documentStatus/paymentStatus is applied (the
  // basis text below is computed from the SAME narrowed set), so with documentStatus=CONFIRMED the old
  // unconditional basis line printed "pending 0.00 (draft 0.00)" even though a draft genuinely exists —
  // it was simply excluded by the filter, not absent.
  const { filtersText, hasStatusFilter, scopeText, filterPhrases, accessScope } = expenseFilterLine(data, ctx, english);

  const pendingAmount = totals['pendingAmount'];
  const confirmedAmount = totals['confirmedAmount'];
  const validBasisAmount = (value: unknown): value is string | number => typeof value === 'number'
    ? Number.isFinite(value)
    : typeof value === 'string' && PLAIN_DECIMAL.test(value.replace(/,/g, ''));
  const basisText = !hasStatusFilter && validBasisAmount(pendingAmount) && validBasisAmount(confirmedAmount)
    ? english
      ? `\nAmount basis: includes ${moneyText(pendingAmount)} THB not yet confirmed and ${moneyText(confirmedAmount)} THB confirmed`
      : `\nฐานยอด: รวมรายการที่ยังไม่ยืนยัน ${moneyText(pendingAmount)} บาท และรายการยืนยันแล้ว ${moneyText(confirmedAmount)} บาท`
    : '';

  const localizedAsOf = ctx.asOfLabel ?? thaiExpenseAsOfLabel(asOf);
  const asOfText = english ? asOfLine(asOf, true) : localizedAsOf ? asOfLine(asOf, false, localizedAsOf) : '';
  const periodLabel = ctx.periodLabel ?? (!english ? thaiExpenseRange(data) : undefined);
  const replyText = `${label}: ${amount}${countText}${filtersText}${scopeText}${basisText}${cancelledText}${periodLine(undefined, data, english, periodLabel, ctx.periodNote)}${sourceText}${asOfText}`;
  // The locked "สรุปค่าใช้จ่าย" card: every clause of the sentence above as a row or a note, nothing else.
  const heading = english ? undefined : expensePeriodHeading(data);
  const period = periodPhrase(undefined, data, false, periodLabel);
  const layout = heading && period ? cardLayout({
    context: 'expense_summary',
    header: ['สรุปค่าใช้จ่าย', heading],
    rows: [
      { label: 'ยอดรวม', value: amount, emphasis: 'total' },
      { label: 'จำนวนรายการ', value: countAvailable ? `${groupThousands(String(count))} รายการ` : 'ยังยืนยันจำนวนรายการไม่ได้' },
      ...(filterPhrases.length ? [{ label: 'ตัวกรอง', value: filterPhrases.join(', ') }] : []),
      { label: 'ช่วงวันที่', value: period },
      ...(sourceRef?.label ? [{ label: 'ที่มา', value: sourceRef.label }] : []),
      ...(localizedAsOf ? [{ label: 'ข้อมูล ณ', value: localizedAsOf }] : []),
    ],
    ...cardNotes([scopeNote(accessScope), basisText, cancelledText, periodNoteLine(ctx.periodNote)]),
    ...(webLinks[0] ? { linkLabel: 'ดูค่าใช้จ่ายในเว็บ' } : {}),
  }) : undefined;
  return { kind: 'answer', replyText, sourceRefs, webLinks, ...(layout ? { layout } : {}) };
}

/** A card's notes from the sentence's own optional clauses: each on one line, the empty ones dropped. */
function cardNotes(clauses: ReadonlyArray<string | undefined>): { notes?: string[] } {
  const notes = clauses.map((clause) => clause?.replace(/\s*\n\s*/gu, ' ').trim()).filter((clause): clause is string => !!clause);
  return notes.length ? { notes } : {};
}

/** Only a layout the receiver will accept leaves this file: one its own validator refuses (a value
 *  longer than a row holds, a link in a name) is no layout, and the answer is drawn as its sentence. */
function cardLayout(layout: LineAiAnswerCardLayout): LineAiAnswerCardLayout | undefined {
  return parseLineAiAnswerCardLayout(layout);
}

/** A comparison of periods on the locked "สรุปค่าใช้จ่าย" card: its rows are the computed comparison's
 *  own (business-read-result-semantics.ts). More rows than a card holds, or a name longer than a
 *  row's label, is no layout: the answer is then its sentences. */
export function expenseComparisonCardLayout(comparison: Parameters<typeof expensePeriodComparisonCard>[0], percent: boolean, linked: boolean): LineAiAnswerCardLayout | undefined {
  const card = expensePeriodComparisonCard(comparison, percent);
  return card && cardLayout({ context: 'expense_summary', header: card.header, rows: card.rows,
    ...(card.notes.length ? { notes: card.notes } : {}), ...(linked ? { linkLabel: 'ดูค่าใช้จ่ายในเว็บ' } : {}) });
}

/** The period as a card's row says it: the sentence's own words for the dates. A period the reader
 *  named reads "เดือนนี้ (1–5 ต.ค. 2569)" in the sentence — their word, then the dates — and the row
 *  shows those dates, which fit one line; any other phrase is shown as the sentence has it. */
function periodRowValue(phrase: string, data: Record<string, unknown> | undefined): string {
  const period = data?.['period'];
  const range = period && typeof period === 'object' && !Array.isArray(period) ? period as Record<string, unknown> : undefined;
  const dates = typeof range?.['fromDate'] === 'string' && typeof range['toDate'] === 'string' ? formatThaiPeriodRange(range['fromDate'], range['toDate']) : undefined;
  return dates && phrase.endsWith(`(${dates})`) ? dates : phrase;
}

/** The as-of day in the words `asOfLine` writes it ("5 ต.ค. 2569"), for the row beside that sentence. */
function asOfDayLabel(asOf: string | undefined): string | undefined {
  const day = asOfInZone(asOf, 'Asia/Bangkok')?.day;
  return day ? thaiAbbrDate(day, false) : undefined;
}

/** The year note is a bracket after the period in the sentence; alone in a card's note it needs none. */
const periodNoteLine = (note: string | undefined) => note?.replace(/^\s*\(([^)]*)\)/u, '$1');

/** The second header line of the summary card: the month, or the months, the tool's own period covers. */
function expensePeriodHeading(data: Record<string, unknown> | undefined): string | undefined {
  const period = data?.['period'];
  if (!period || typeof period !== 'object' || Array.isArray(period)) return undefined;
  const from = CIVIL_DATE.exec(String((period as Record<string, unknown>)['fromDate'] ?? ''));
  const to = CIVIL_DATE.exec(String((period as Record<string, unknown>)['toDate'] ?? ''));
  if (!from || !to) return undefined;
  const year = (match: RegExpExecArray) => Number(match[1]) + 543;
  if (from[0] === to[0]) return thaiAbbrDate(from[0], false);
  if (from[1] === to[1] && from[2] === to[2]) return `${THAI_FULL_MONTH_NAMES[Number(from[2]) - 1]} ${year(from)}`;
  const month = (match: RegExpExecArray) => THAI_MONTH_ABBR[Number(match[2]) - 1];
  return from[1] === to[1] ? `${month(from)} – ${month(to)} ${year(to)}` : `${month(from)} ${year(from)} – ${month(to)} ${year(to)}`;
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

/** R-A3: enough expense records to be useful in one LINE bubble; the rest are admitted by the
 *  "showing N of M" line, same convention as the document-type and breakdown-group caps below. */
const MAX_EXPENSE_LIST_LINES = 10;

/**
 * R-L4/R-A3 — `expense.list_recent` as a numbered list ("ค่าใช้จ่ายล่าสุด 10 รายการ"). States the
 * grounded total count (the SAME `total`/countedItems basis formatExpenseSummary uses — never
 * `items.length`, which the tool may page below it), then up to 10 numbered records (date, vendor,
 * amount, status), a "showing N of M" note when more exist, the same filter line as the single-metric
 * family, period, source, as-of and link.
 */
function formatExpenseListRecentList(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'expense.list_recent');
  const total = data?.['total'];
  const items = data?.['items'];
  if (!isCount(total) || !Array.isArray(items)) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };
  // Item 2: a "list" answer still states the FILTERED SET's own total amount, not only its items
  // (R-A1) — the same summary.totalAmount formatExpenseSummary already requires, so a mixed-currency
  // set (no single total) stays honestly unverified here too rather than a list with no aggregate.
  const summary = data?.['summary'];
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return { kind: 'unverified' };
  const totalAmount = (summary as Record<string, unknown>)['totalAmount'];
  if (!isMoney(totalAmount)) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const rows: Array<{ date: string; vendor: string; amount: string | number; status: string }> = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'unverified' };
    const item = raw as Record<string, unknown>;
    const date = item['expenseDate'];
    const amount = item['grandTotalAmount'];
    const status = item['status'];
    if (typeof date !== 'string' || !isMoney(amount) || typeof status !== 'string') return { kind: 'unverified' };
    const vendor = typeof item['vendorNameSnapshot'] === 'string' && item['vendorNameSnapshot']
      ? item['vendorNameSnapshot'] as string : (english ? 'Unknown vendor' : 'ไม่ระบุร้าน');
    rows.push({ date: date.slice(0, 10), vendor, amount, status });
  }

  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  const shown = rows.slice(0, MAX_EXPENSE_LIST_LINES);
  const statusLabel = (status: string): string => english ? humanizedEnum(status) : (EXPENSE_STATUS_LABELS as Record<string, string>)[status] ?? status;
  // C6 (batch 5c): list-item dates are short and year-free within the tool's own as-of year
  // ("16 ก.ย."), never the raw ISO string.
  const listYear = civilYear(output.asOf);
  const itemLines = shown.map((row, index) => {
    const dateLabel = thaiAbbrDate(row.date, english, listYear) ?? row.date;
    return english
      ? `\n${index + 1}. ${dateLabel} ${row.vendor} ${moneyText(row.amount)} THB (${statusLabel(row.status)})`
      : `\n${index + 1}. ${dateLabel} ${row.vendor} ${moneyText(row.amount)} บาท (${statusLabel(row.status)})`;
  }).join('');
  const moreText = total > shown.length
    ? (english ? `\nShowing ${shown.length} of ${plural(total, 'record')}` : `\nแสดง ${shown.length} จาก ${groupThousands(String(total))} รายการ`)
    : '';
  const { filtersText, scopeText, filterPhrases, accessScope } = expenseFilterLine(data, ctx, english);

  const headline = english
    ? `Expenses: ${moneyText(totalAmount)} THB (${plural(total, 'record')})`
    : `ค่าใช้จ่าย: ${moneyText(totalAmount)} บาท (${groupThousands(String(total))} รายการ)`;
  const periodLabel = ctx.periodLabel ?? (!english ? thaiExpenseRange(data) : undefined);
  const replyText = `${headline}${itemLines}${moreText}${filtersText}${scopeText}`
    + `${periodLine(ctx.proposedInput, data, english, periodLabel, ctx.periodNote)}${sourceText}${asOfLine(output.asOf, english)}`;
  // The same list on the locked card (owner 2026-10-05: "อยากได้เหมือน pattern อ่านใบเสร็จ"): the total
  // and the count, then each listed record as a row — its date, and what the sentence says of it.
  const heading = english ? undefined : expensePeriodHeading(data);
  const period = periodPhrase(ctx.proposedInput, data, false, periodLabel);
  const asOfDay = asOfDayLabel(output.asOf);
  const layout = heading && period ? cardLayout({
    context: 'expense_summary',
    header: ['รายการค่าใช้จ่าย', heading],
    rows: [
      { label: 'ยอดรวม', value: `${moneyText(totalAmount)} บาท`, emphasis: 'total' },
      { label: 'จำนวนรายการ', value: `${groupThousands(String(total))} รายการ` },
      ...shown.map((row) => ({ label: thaiAbbrDate(row.date, false, listYear) ?? row.date, value: `${row.vendor} · ${moneyText(row.amount)} บาท · ${statusLabel(row.status)}` })),
      ...(filterPhrases.length ? [{ label: 'ตัวกรอง', value: filterPhrases.join(', ') }] : []),
      { label: 'ช่วงวันที่', value: periodRowValue(period, data) },
      ...(asOfDay ? [{ label: 'ข้อมูล ณ', value: asOfDay }] : []),
    ],
    ...cardNotes([moreText, scopeNote(accessScope), periodNoteLine(ctx.periodNote)]),
    ...(webLinks[0] ? { linkLabel: 'ดูค่าใช้จ่ายในเว็บ' } : {}),
  }) : undefined;
  return { kind: 'answer', replyText, sourceRefs, webLinks, ...(layout ? { layout } : {}) };
}

/**
 * Item 3 (spec §3 row 8, "รายการที่ 3 คือร้านอะไรครับ") — `expense.get_detail` as one record's
 * identity, for an ordinal follow-up about a single already-shown expense. Unlike the summary/list
 * families this reads ONE permission-checked record, not a page of an aggregate, so it never checks
 * `aggregationIncomplete` — there is nothing here a page cap could understate. States the date (Thai
 * calendar), vendor (or the honest "unnamed vendor" label list_recent's own list already uses),
 * total amount, document/payment status in the SAME Thai labels expense.list_recent's filter line
 * uses, the category the tool names (when it does — erp-core-detail-tools.use-case.ts does not send
 * one today; kept optional so a future field is rendered rather than requiring a shape change here),
 * the access-scope line when not company-wide (same `scopeLine` convention as every other family),
 * source and link.
 */
function formatExpenseGetDetailSingleMetric(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'expense.get_detail');
  const expenseDate = data?.['expenseDate'];
  const amount = data?.['grandTotalAmount'];
  const status = data?.['status'];
  const paymentStatus = data?.['paymentStatus'];
  if (typeof expenseDate !== 'string' || typeof status !== 'string' || !status
    || typeof paymentStatus !== 'string' || !paymentStatus || !isMoney(amount)) return { kind: 'unverified' };
  const dateLabel = thaiIsoDate(expenseDate.slice(0, 10));
  if (!dateLabel) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const vendor = typeof data?.['vendorName'] === 'string' && data['vendorName']
    ? data['vendorName'] as string : (english ? 'Unknown vendor' : 'ไม่ระบุร้าน');
  const documentStatusLabel = english ? humanizedEnum(status) : (EXPENSE_STATUS_LABELS as Record<string, string>)[status] ?? status;
  const paymentStatusLabel = english ? humanizedEnum(paymentStatus) : (EXPENSE_PAYMENT_STATUS_LABELS as Record<string, string>)[paymentStatus] ?? paymentStatus;
  const category = data?.['categoryName'];
  const categoryText = typeof category === 'string' && category
    ? (english ? `\nCategory: ${category}` : `\nหมวด: ${category}`) : '';
  const scopeText = scopeLine(data?.['accessScope'], english);
  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  const text = (key: string) => typeof data?.[key] === 'string' && (data[key] as string).trim() ? (data[key] as string).trim() : undefined;
  const number = text('expenseNumber');
  // The locked record and payment cards have no "ข้อมูล ณ" row (the summary and open-work cards do):
  // the as-of stays in the sentence, which is the card's fallback and its notification text.
  const evidenceNotes = Array.isArray(data?.['evidenceNotes']) ? data['evidenceNotes'].filter((note): note is string => typeof note === 'string').slice(0, 2) : [];
  const evidenceText = evidenceNotes.length ? `\n${evidenceNotes.join('\n')}` : '';
  const imageMissing = data?.['documentImageMissing'] === true;
  if (imageMissing) for (const link of webLinks) link.label = english ? 'Send document photo' : 'ส่งรูปเอกสาร';
  const shared = {
    notes: cardNotes([scopeNote(data?.['accessScope']), ...evidenceNotes]),
    link: webLinks[0] ? { linkLabel: imageMissing ? 'ส่งรูปเอกสาร' : 'เปิดดูรายการในเว็บ' } : {},
  };

  // A question about PAYING a confirmed record is answered with what was paid, what is left, and —
  // where a payment was recorded — when and how (design lock context 7). Same read, same record.
  const payment = status === 'CONFIRMED' && asksAboutPayment(ctx.messageText) ? expensePaymentFacts(data, paymentStatus) : undefined;
  if (payment) {
    const { net, paid, outstanding, paidOn, methods } = payment;
    const evidence = [
      paidOn ? (english ? `Paid on ${paidOn.english}` : `วันที่ชำระ ${paidOn.thai}`) : undefined,
      methods ? (english ? `Method: ${methods.english}` : `วิธีชำระเงิน ${methods.thai}`) : undefined,
    ].filter((clause): clause is string => !!clause);
    const replyText = (english
      ? `Payment: ${vendor}, amount to pay ${net} THB\nPaid ${paid} THB · Outstanding ${outstanding} THB\nPayment status: ${paymentStatusLabel}${evidence.map((clause) => ` · ${clause}`).join('')}`
      : `การชำระเงิน: ${vendor} ยอดสุทธิที่ต้องจ่าย ${net} บาท\nจ่ายแล้ว ${paid} บาท · ยอดคงค้าง ${outstanding} บาท\nสถานะชำระเงิน: ${paymentStatusLabel}${evidence.map((clause) => ` · ${clause}`).join('')}`)
      + `${evidenceText}${scopeText}${sourceText}${asOfLine(output.asOf, english)}`;
    const layout = english ? undefined : cardLayout({
      context: 'payment',
      header: ['การชำระเงิน', paymentStatus === 'UNPAID' ? 'รอชำระเงิน' : paymentStatusLabel],
      banner: { tone: paymentStatus === 'PAID' ? 'ok' : 'pending', text: `${paymentStatusLabel} · ยอดคงค้าง ${outstanding} บาท` },
      rows: [
        ...(number ? [{ label: 'เลขรายการ', value: number }] : []),
        { label: 'ผู้รับเงิน', value: vendor },
        { label: 'ยอดสุทธิที่ต้องจ่าย', value: `${net} บาท`, emphasis: 'total' },
        { label: 'จ่ายแล้ว', value: `${paid} บาท` },
        { label: 'ยอดคงค้าง', value: `${outstanding} บาท` },
        ...(paidOn ? [{ label: 'วันที่ชำระ', value: paidOn.thai }] : []),
        ...(methods ? [{ label: 'วิธีชำระเงิน', value: methods.thai }] : []),
        { label: 'สถานะชำระเงิน', value: paymentStatusLabel, tone: paymentStatus === 'PAID' ? 'ok' : 'pending' },
      ],
      ...shared.notes, ...shared.link,
    });
    return { kind: 'answer', replyText, sourceRefs, webLinks, ...(layout ? { layout } : {}) };
  }

  // C6 (batch 5c): the English headline printed the raw ISO date while the Thai side already used
  // `dateLabel` — `expenseDate` already passed `thaiIsoDate`'s stricter real-calendar check above.
  const headline = english
    ? `Expense: ${vendor}, ${thaiAbbrDate(expenseDate.slice(0, 10), true) ?? expenseDate.slice(0, 10)}, ${moneyText(amount)} THB`
    : `ค่าใช้จ่าย: ${vendor} วันที่ ${dateLabel} ยอด ${moneyText(amount)} บาท`;
  // A rejected or voided record owes nothing: its second fact is why it was closed, when the record
  // says why, never a payment state that reads as money still due.
  const closed = status === 'REJECTED' || status === 'VOIDED';
  const reason = closed ? text(status === 'REJECTED' ? 'rejectReason' : 'voidReason') : undefined;
  const statusText = (english ? `\nDocument status: ${documentStatusLabel}` : `\nสถานะเอกสาร: ${documentStatusLabel}`)
    + (closed ? (reason ? (english ? ` · Reason: ${reason}` : ` · เหตุผล: ${reason}`) : '')
      : (english ? ` · Payment status: ${paymentStatusLabel}` : ` · สถานะการจ่าย: ${paymentStatusLabel}`));

  const replyText = `${headline}${statusText}${categoryText}${evidenceText}${scopeText}${sourceText}${asOfLine(output.asOf, english)}`;
  const item = expenseItemPhrase(data?.['lines']);
  const vat = data?.['vatAmount'];
  const layout = english ? undefined : cardLayout({
    context: 'expense_record',
    header: ['รายการค่าใช้จ่าย', status === 'REJECTED' ? 'ถูกปฏิเสธ' : status === 'VOIDED' ? 'ยกเลิกแล้ว' : documentStatusLabel],
    rows: [
      ...(number ? [{ label: 'เลขรายการ', value: number }] : []),
      ...(item ? [{ label: 'รายการ', value: item }] : []),
      { label: 'ผู้ขาย / ร้านค้า', value: vendor },
      { label: 'วันที่เอกสาร', value: dateLabel },
      ...(typeof category === 'string' && category ? [{ label: 'หมวดค่าใช้จ่าย', value: category }] : []),
      { label: 'ยอดรวม', value: `${moneyText(amount)} บาท`, emphasis: 'total' },
      ...(isMoney(vat) && moneyNumber(vat) !== 0 ? [{ label: 'VAT', value: `${moneyText(vat)} บาท` }] : []),
      { label: 'สถานะเอกสาร', value: documentStatusLabel, tone: status === 'CONFIRMED' ? 'ok' : closed ? 'closed' : 'pending' },
      ...(closed ? (reason ? [{ label: 'เหตุผล', value: reason }] : []) : [{ label: 'สถานะการจ่าย', value: paymentStatusLabel }]),
    ],
    ...shared.notes, ...shared.link,
  });
  return { kind: 'answer', replyText, sourceRefs, webLinks, ...(layout ? { layout } : {}) };
}

/** Does the reader ask about PAYING? "ค่าใช้จ่าย" and its kin carry the word จ่าย without asking it. */
function asksAboutPayment(messageText: string | undefined): boolean {
  return /ชำระ|จ่าย|ค้าง|\b(?:un)?paid\b|\bpay(?:ment|ments|s)?\b|\boutstanding\b|\bowe[ds]?\b/iu
    .test((messageText ?? '').replace(/ค่าใช้จ่าย|รายจ่าย|ใช้จ่าย|เบิกจ่าย/gu, ''));
}

/** Same words the web shows for a recorded payment's method (apps/web/src/features/expenses/
 *  expenses.model.ts PAYMENT_METHOD_LABELS) — one small local map, like the two above it in this file. */
const EXPENSE_PAYMENT_METHOD_TH: Record<string, string> = {
  CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', CARD: 'บัตรเครดิต', CHEQUE: 'เช็ค', OTHER: 'อื่นๆ',
};

/** The amounts of one record's payment, and — only where the record has a recorded payment that says
 *  so — the day of the latest and the ways paid. `undefined` when the tool sent no payment amounts:
 *  the caller then answers about the record, never about a payment it cannot state. */
function expensePaymentFacts(data: Record<string, unknown> | undefined, paymentStatus: string): {
  net: string; paid: string; outstanding: string;
  paidOn?: { thai: string; english: string }; methods?: { thai: string; english: string };
} | undefined {
  const net = data?.['netPayableAmount'], paid = data?.['paidAmount'], outstanding = data?.['outstandingAmount'];
  if (!['UNPAID', 'PARTIALLY_PAID', 'PAID'].includes(paymentStatus) || !isMoney(net) || !isMoney(paid) || !isMoney(outstanding)) return undefined;
  const payments = data?.['payments'];
  const recorded = payments && typeof payments === 'object' && !Array.isArray(payments) ? payments as Record<string, unknown> : undefined;
  const count = isCount(recorded?.['count']) ? recorded['count'] as number : 0;
  const lastPaidOn = typeof recorded?.['lastPaidOn'] === 'string' ? recorded['lastPaidOn'] as string : undefined;
  const day = count > 0 && lastPaidOn ? thaiIsoDate(lastPaidOn) : undefined;
  const keys = count > 0 && Array.isArray(recorded?.['methods']) ? recorded['methods'] as unknown[] : [];
  const named = keys.length > 0 && keys.every((key) => typeof key === 'string' && EXPENSE_PAYMENT_METHOD_TH[key]);
  return {
    net: moneyText(net), paid: moneyText(paid), outstanding: moneyText(outstanding),
    ...(day && lastPaidOn ? { paidOn: {
      thai: count > 1 ? `${day} (ครั้งล่าสุดจาก ${count} ครั้ง)` : day,
      english: `${thaiAbbrDate(lastPaidOn, true) ?? lastPaidOn}${count > 1 ? ` (latest of ${count})` : ''}`,
    } } : {}),
    ...(named ? { methods: {
      thai: (keys as string[]).map((key) => EXPENSE_PAYMENT_METHOD_TH[key]!).join(', '),
      english: (keys as string[]).map(humanizedEnum).join(', '),
    } } : {}),
  };
}

/** What the record is for: its first product line, and a word that there are more. Additional
 *  charges are their own rows on the web and never the record's name. */
function expenseItemPhrase(lines: unknown): string | undefined {
  const products = (Array.isArray(lines) ? lines : []).filter((line): line is Record<string, unknown> =>
    !!line && typeof line === 'object' && (line as Record<string, unknown>)['chargeKind'] == null
    && typeof (line as Record<string, unknown>)['description'] === 'string' && !!((line as Record<string, unknown>)['description'] as string).trim());
  const first = (products[0]?.['description'] as string | undefined)?.trim();
  return first ? `${first}${products.length > 1 ? ' และรายการอื่น' : ''}` : undefined;
}

/** R-A2: enough breakdown groups to stay readable in one bubble; the rest are folded into "อื่นๆ". */
const MAX_BREAKDOWN_GROUPS = 8;

/** The three axes `expense.get_breakdown` groups by; `groupBy` (spec item 3) is a pure PRESENTATION
 *  hint that picks which one leads the answer — the tool always computes and returns all three. */
const BREAKDOWN_AXES = {
  category: { dataKey: 'byCategory', nameKey: 'category', labelTh: 'หมวด', labelEn: 'category' },
  branch: { dataKey: 'byBranch', nameKey: 'branch', labelTh: 'สาขา', labelEn: 'branch' },
  vendor: { dataKey: 'byVendor', nameKey: 'vendor', labelTh: 'ร้าน', labelEn: 'vendor' },
} as const;
type BreakdownAxis = keyof typeof BREAKDOWN_AXES;

function moneyNumber(value: string | number): number {
  return typeof value === 'number' ? value : Number(value.replace(/,/g, ''));
}

/** M2 (tuning-8, T-057-a): `queryApplied.filters.groupBy` is the tool's own trusted echo of the
 *  grouping it actually used — the same source `expenseFilterLine` already reads other applied
 *  filters from. */
function appliedGroupBy(data: Record<string, unknown> | undefined): unknown {
  const queryApplied = data?.['queryApplied'];
  const filters = queryApplied && typeof queryApplied === 'object' && !Array.isArray(queryApplied)
    ? (queryApplied as Record<string, unknown>)['filters'] : undefined;
  return filters && typeof filters === 'object' && !Array.isArray(filters) ? (filters as Record<string, unknown>)['groupBy'] : undefined;
}

/**
 * R-L4/R-A2 — `expense.get_breakdown` as a grouped list ("แยกค่าใช้จ่ายตามหมวด"). `ctx.proposedInput`
 * carries the validated `groupBy` the fast lane actually sent (defaulting to category, same as the
 * tool's own default) — this only selects which of the tool's three ALREADY-COMPUTED axes leads the
 * answer, it never re-groups anything client-side. Groups sort by amount descending (no percentage
 * share: owner 2026-10-05); the top 8 are named, the rest are folded into one "อื่นๆ" row
 * (its amount/count are an exact sum of the tool's own per-group numbers, not an estimate), then the
 * overall total, filter line, period, source, as-of and link — the same order as spec R-A2.
 */
function formatExpenseBreakdownList(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'expense.get_breakdown');
  const totalCount = data?.['totalCount'];
  const totalAmount = data?.['totalAmount'];
  if (!isCount(totalCount) || !isMoney(totalAmount)) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  // M2 (tuning-8, T-057-a): the full path's deterministic fallback (semantic-turn-v2.ts's
  // deterministicReadFallback) calls this formatter with NO proposedInput at all — fall back to the
  // grouping the tool itself actually applied before defaulting to category, so a vendor/branch
  // breakdown never mislabels itself "แยกตามหมวด".
  const requestedAxis = ctx.proposedInput?.['groupBy'] ?? appliedGroupBy(data);
  const axisKey: BreakdownAxis = requestedAxis === 'branch' || requestedAxis === 'vendor' ? requestedAxis : 'category';
  const axis = BREAKDOWN_AXES[axisKey];
  const rawGroups = data?.[axis.dataKey];
  if (!Array.isArray(rawGroups)) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const groups: Array<{ name: string; amount: string | number; count: number }> = [];
  for (const raw of rawGroups) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'unverified' };
    const row = raw as Record<string, unknown>;
    const name = row[axis.nameKey];
    const amount = row['totalAmount'];
    const count = row['count'];
    if (typeof name !== 'string' || !name || !isMoney(amount) || !isCount(count)) return { kind: 'unverified' };
    groups.push({ name, amount, count });
  }
  groups.sort((a, b) => moneyNumber(b.amount) - moneyNumber(a.amount));

  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  const shown = groups.slice(0, MAX_BREAKDOWN_GROUPS);
  const rest = groups.slice(MAX_BREAKDOWN_GROUPS);
  const groupLine = (name: string, amount: number, count: number) => english
    ? `\n• ${name}: ${moneyText(amount)} THB (${plural(count, 'record')})`
    : `\n• ${name}: ${moneyText(amount)} บาท (${groupThousands(String(count))} รายการ)`;
  const groupLines = shown.map((g) => groupLine(g.name, moneyNumber(g.amount), g.count)).join('');
  const othersLine = rest.length > 0
    ? groupLine(
      `${english ? 'Other' : 'อื่นๆ'} (${rest.length})`,
      rest.reduce((sum, g) => sum + moneyNumber(g.amount), 0),
      rest.reduce((sum, g) => sum + g.count, 0),
    )
    : '';
  const totalText = english
    ? `\nTotal: ${moneyText(totalAmount)} THB (${plural(totalCount, 'record')})`
    : `\nรวมทั้งหมด: ${moneyText(totalAmount)} บาท (${groupThousands(String(totalCount))} รายการ)`;
  const { filtersText, scopeText, filterPhrases, accessScope } = expenseFilterLine(data, ctx, english);

  const axisLabel = english ? axis.labelEn : axis.labelTh;
  const headline = english ? `Expenses by ${axisLabel}` : `ค่าใช้จ่ายแยกตาม${axisLabel}`;
  const periodLabel = ctx.periodLabel ?? (!english ? thaiExpenseRange(data) : undefined);
  const replyText = `${headline}${groupLines}${othersLine}${totalText}${filtersText}${scopeText}`
    + `${periodLine(ctx.proposedInput, data, english, periodLabel, ctx.periodNote)}${sourceText}${asOfLine(output.asOf, english)}`;
  // The same summary on the locked card (owner 2026-10-05: "สรุปค่าใช้จ่ายเดือนนี้ อยากได้เหมือน pattern
  // อ่านใบเสร็จ"): the total and the count, what the rows are grouped by, then one row for each group
  // with its amount. No share (owner, same day: "เอา % ออกเถอะ งง ไม่สวยด้วย"), and the group's count
  // stays in the sentence only: an amount with a count beside it breaks across two lines of a row.
  const heading = english ? undefined : expensePeriodHeading(data);
  const period = periodPhrase(ctx.proposedInput, data, false, periodLabel);
  const asOfDay = asOfDayLabel(output.asOf);
  const sourceLabel = output.facts.find((fact) => fact.sourceRef)?.sourceRef?.label;
  const groupValue = (amount: number) => `${moneyText(amount)} บาท`;
  const layout = heading && period ? cardLayout({
    context: 'expense_summary',
    header: ['สรุปค่าใช้จ่าย', heading],
    rows: [
      { label: 'ยอดรวม', value: `${moneyText(totalAmount)} บาท`, emphasis: 'total' },
      { label: 'จำนวนรายการ', value: `${groupThousands(String(totalCount))} รายการ` },
      { label: 'แยกตาม', value: axis.labelTh },
      ...shown.map((g) => ({ label: g.name, value: groupValue(moneyNumber(g.amount)) })),
      ...(rest.length > 0 ? [{ label: `อื่นๆ (${rest.length})`, value: groupValue(rest.reduce((sum, g) => sum + moneyNumber(g.amount), 0)) }] : []),
      ...(filterPhrases.length ? [{ label: 'ตัวกรอง', value: filterPhrases.join(', ') }] : []),
      { label: 'ช่วงวันที่', value: periodRowValue(period, data) },
      ...(sourceLabel ? [{ label: 'ที่มา', value: sourceLabel }] : []),
      ...(asOfDay ? [{ label: 'ข้อมูล ณ', value: asOfDay }] : []),
    ],
    ...cardNotes([scopeNote(accessScope), periodNoteLine(ctx.periodNote)]),
    ...(webLinks[0] ? { linkLabel: 'ดูค่าใช้จ่ายในเว็บ' } : {}),
  }) : undefined;
  return { kind: 'answer', replyText, sourceRefs, webLinks, ...(layout ? { layout } : {}) };
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
  const replyText = `${headline}${typeLines}${moreText}${periodLine(ctx.proposedInput, data, english, ctx.periodLabel, ctx.periodNote)}${sourceText}${asOfLine(output.asOf, english)}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/** Thai month abbreviations, spelled out so the day phrase is identical in every runtime (a locale-driven
 *  month name would drift with the host's ICU build, and a compiled answer must not). */
const THAI_MONTH_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const EN_MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** C6 (batch 5c): every raw ISO date a formatter would otherwise print becomes day + abbreviated month,
 *  with the year added only when it differs from `referenceYear` — a LIST ITEM's own convention
 *  ("16 ก.ย." this year, "16 ก.ย. 2568" a year ago). `asOfLine` below always passes no reference, so its
 *  own date always carries the year. `referenceYear` is read from the tool's own as-of, never the
 *  gateway process's wall clock, so a compiled answer stays deterministic. */
function thaiAbbrDate(isoDay: string, english: boolean, referenceYear?: number): string | undefined {
  if (!CIVIL_DATE.test(isoDay)) return undefined;
  const [, year, month, day] = CIVIL_DATE.exec(isoDay)!;
  const showYear = referenceYear === undefined || Number(year) !== referenceYear;
  return english
    ? `${Number(day)} ${EN_MONTH_ABBR[Number(month) - 1]}${showYear ? ` ${year}` : ''}`
    : `${Number(day)} ${THAI_MONTH_ABBR[Number(month) - 1]}${showYear ? ` ${Number(year) + 543}` : ''}`;
}

/** The calendar year of an ISO instant/day, or undefined when unparsable — the "current year" reference
 *  for `thaiAbbrDate`'s list-item calls, taken from the tool's own as-of rather than wall-clock `now`. */
function civilYear(isoDayOrInstant: string | undefined): number | undefined {
  const day = isoDayOrInstant?.slice(0, 10);
  return day && CIVIL_DATE.test(day) ? Number(day.slice(0, 4)) : undefined;
}

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

/** One thing the day's checklist counts: its name, and how many (and how much) the tool reports. The
 *  sentence's bullets and a card's rows are both written from these, so they cannot say it differently. */
type DailyClosingEntry = { key: string; label: string; value: string };

/** `submittedToday`/`pendingReview`/`evidenceBlockers`/`duplicateRisks` are all `{count, items}` — a plain
 *  record count, no money. Hidden (C5, batch 5c) when the tool reports none, so "มีอะไรต้องทำบ้าง" lists
 *  only what actually needs doing today. */
function dailyClosingCountEntry(key: string, labelTh: string, labelEn: string, data: Record<string, unknown> | undefined, english: boolean): DailyClosingEntry | undefined {
  const group = data?.[key];
  const count = group && typeof group === 'object' && !Array.isArray(group) ? (group as Record<string, unknown>)['count'] : undefined;
  if (typeof count !== 'number' || count <= 0) return undefined;
  return { key, label: english ? labelEn : labelTh, value: english ? plural(count, 'record') : `${groupThousands(String(count))} รายการ` };
}

/** `dueEndOfDay`/`overdue`/`unscheduledOutstanding` are `{totals, items}`: `items.total` is the record
 *  count across EVERY currency (same convention `occurredToday` uses above — never sum `totals[].count`,
 *  which is only one currency's share), `totals` the per-currency amounts via `moneyGroupsText`. */
function dailyClosingMoneyEntry(key: string, labelTh: string, labelEn: string, data: Record<string, unknown> | undefined, english: boolean): DailyClosingEntry | undefined {
  const group = data?.[key];
  const record = group && typeof group === 'object' && !Array.isArray(group) ? group as Record<string, unknown> : undefined;
  const items = record?.['items'];
  const count = items && typeof items === 'object' && !Array.isArray(items) ? (items as Record<string, unknown>)['total'] : undefined;
  if (typeof count !== 'number' || count <= 0) return undefined;
  const totalsText = moneyGroupsText(record?.['totals'], english);
  if (!totalsText) return undefined;
  return { key, label: english ? labelEn : labelTh,
    value: english ? `${plural(count, 'record')}, total ${totalsText}` : `${groupThousands(String(count))} รายการ รวม ${totalsText}` };
}

/** C5: the to-do list, one entry per NON-EMPTY section, fixed order. Money entries are per currency
 *  (never summed, like `totals`/`paid`/`outstanding`); the evidence backlog is every OPEN blocker, not
 *  only today's, same as before this list existed.
 *  "วันนี้" is claimed only when this closing really is for today — `submittedToday`/`dueEndOfDay` are
 *  both scoped to the REPORTED day, which "ปิดยอดเมื่อวาน" backs to a past day, so the bare "today"
 *  wording would misstate which day these counts are for. */
function dailyClosingEntries(data: Record<string, unknown> | undefined, isToday: boolean, english: boolean): DailyClosingEntry[] {
  return [
    dailyClosingCountEntry('submittedToday', isToday ? 'ส่งเข้ามาวันนี้' : 'ส่งเข้ามาวันนั้น', isToday ? 'Submitted today:' : 'Submitted that day:', data, english),
    dailyClosingCountEntry('pendingReview', 'รอตรวจสอบ', 'Pending review:', data, english),
    dailyClosingMoneyEntry('dueEndOfDay', isToday ? 'ครบกำหนดจ่ายวันนี้' : 'ครบกำหนดจ่ายวันนั้น', isToday ? 'Due today:' : 'Due that day:', data, english),
    dailyClosingMoneyEntry('overdue', 'เกินกำหนดจ่าย', 'Overdue:', data, english),
    dailyClosingMoneyEntry('unscheduledOutstanding', 'ค้างจ่าย (ยังไม่กำหนดวันจ่าย)', 'Unpaid (no due date scheduled):', data, english),
    dailyClosingCountEntry('evidenceBlockers', 'รอตรวจหลักฐาน', 'Awaiting evidence review:', data, english),
    dailyClosingCountEntry('documentImagesToAdd', EXPENSE_DOCUMENT_IMAGE_MISSING_LABEL, 'Document image not attached:', data, english),
  ].filter((entry): entry is DailyClosingEntry => Boolean(entry));
}

/**
 * F3 — `expense.get_daily_closing` as one day's spend metric ("ค่าใช้จ่ายวันนี้"/"วันนี้มีอะไรต้องทำ
 * บ้าง"). Owner decision 2026-08-26 narrowed this question to the EXPENSE side only (no revenue tool
 * exists yet), so the answer never speaks of money in, profit, or a bank balance. From the tool's real
 * result it states the day, the occurred-today record count (`occurredToday.items.total`) and the
 * per-currency totals it returned (`occurredToday.totals` / `.paid` / `.outstanding` — 4-decimal strings,
 * one row per currency, never summed across currencies), source, as-of, and the REQUIRED source-honesty
 * line: these are entries recorded in the system, not bank movement (spec G5, §5-F3). "วันนี้" is claimed
 * only when the tool's own as-of day equals the day it answered for.
 *
 * C5 (batch 5c, T-102-a): "มีอะไรต้องทำบ้าง" is a TO-DO question, not just a spend total — the headline
 * alone buried 32 submissions and 12 pending reviews behind a lone evidence-backlog line. After the
 * headline, every NON-EMPTY one of submittedToday/pendingReview/dueEndOfDay/overdue/
 * unscheduledOutstanding/evidenceBlockers renders its own bullet, in that fixed order.
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
  const isToday = asOfHere?.day === day;
  const [, dayYear, month, dayOfMonth] = CIVIL_DATE.exec(day)!;
  // C6 (batch 5c): "Today (2026-08-26)"/"On 2026-08-25" were raw ISO dates in English; the Thai
  // fallback (no periodLabel) was too. "Today" stays year-free (own year as the reference omits it),
  // matching the Thai side; the named-day branch always keeps its year (spec §3.4's own "17 ก.ย. 2569"
  // example) since it is the one day being stated, not a list of many.
  const dayPhrase = isToday
    ? (english ? `Today (${thaiAbbrDate(day, true, Number(dayYear)) ?? day})` : `วันนี้ (${Number(dayOfMonth)} ${THAI_MONTH_ABBR[Number(month) - 1]})`)
    : (english ? `On ${thaiAbbrDate(day, true) ?? day}` : ctx.periodLabel ? ctx.periodLabel : `วันที่ ${thaiAbbrDate(day, false) ?? day}`);

  // Honest zero: a day with nothing recorded says so, and states no amount the tool did not return.
  // F5 (tuning-6b, T-102-a/T-017-a): "มีค่าใช้จ่าย 0 รายการ" reads as "nothing happened today" even
  // when submittedToday/pendingReview below are non-zero — this count is expenses DATED today, never
  // what was submitted today. State that explicitly on the zero case; keep the >0 shape unchanged.
  const headline = count === 0
    ? (english
      ? `${dayPhrase}: no expense records dated ${isToday ? 'today' : 'that day'}`
      : `${dayPhrase} ยังไม่มีรายการค่าใช้จ่ายที่ลงวันที่${isToday ? 'วันนี้' : 'วันนั้น'}`)
    : (english
      ? `${dayPhrase}: ${plural(count, 'expense record')}${totals ? `, total ${totals}` : ''}`
      : `${dayPhrase} มีค่าใช้จ่าย ${groupThousands(String(count))} รายการ${totals ? ` รวม ${totals}` : ''}`);
  const settledText = paid || outstanding
    ? (english
      ? `\n${[paid && `Paid ${paid}`, outstanding && `Unpaid ${outstanding}`].filter(Boolean).join(' · ')}`
      : `\n${[paid && `จ่ายแล้ว ${paid}`, outstanding && `ยังไม่ได้จ่าย ${outstanding}`].filter(Boolean).join(' · ')}`)
    : '';
  const checklist = dailyClosingEntries(data, isToday, english).map((entry) => `${entry.label} ${entry.value}`);
  const checklistText = checklist.length > 0 ? `\n${checklist.map((line) => `• ${line}`).join('\n')}` : '';

  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  // REQUIRED (spec G5, §5-F3): recorded entries, never bank movement. There is no bank feed (P18).
  const honestyText = english
    ? `\n(From entries recorded in the system${asOfHere ? `, up to ${asOfHere.time}` : ''} — not bank money in/out)`
    : `\n(จากรายการที่บันทึกในระบบ${asOfHere ? ` ถึง ${asOfHere.time}` : ''} — ไม่ใช่ยอดเงินเข้าออกธนาคาร)`;
  // Item 1: this tool has no `queryApplied` wrapper, so its own scope echo rides `data.accessScope`
  // directly (see erp-expense-daily-closing.use-case.ts's `accessClauses`).
  const scopeText = scopeLine(data?.['accessScope'], english);

  const replyText = `${headline}${settledText}${checklistText}${scopeText}${sourceText}${asOfLine(output.asOf, english)}${honestyText}`;
  // The same day on the locked card: what the day's records come to, then each thing on the checklist
  // a row, in the sentence's own words. The required honesty line is a note.
  const asOfDay = asOfDayLabel(output.asOf);
  const layout = english ? undefined : cardLayout({
    context: 'expense_summary',
    header: ['สรุปปิดร้าน', dayPhrase],
    rows: [
      ...(count > 0 && totals ? [{ label: 'ยอดรวม', value: totals, emphasis: 'total' as const }] : []),
      { label: 'จำนวนรายการ', value: count === 0 ? `ยังไม่มีรายการที่ลงวันที่${isToday ? 'วันนี้' : 'วันนั้น'}` : `${groupThousands(String(count))} รายการ` },
      ...(paid ? [{ label: 'จ่ายแล้ว', value: paid }] : []),
      ...(outstanding ? [{ label: 'ยังไม่ได้จ่าย', value: outstanding }] : []),
      ...dailyClosingEntries(data, isToday, false).map((entry) => ({ label: entry.label, value: entry.value })),
      ...(asOfDay ? [{ label: 'ข้อมูล ณ', value: asOfDay }] : []),
    ],
    ...cardNotes([scopeNote(data?.['accessScope']), honestyText.replace(/^\s*\((.*)\)\s*$/u, '$1')]),
    ...(webLinks[0] ? { linkLabel: 'ดูค่าใช้จ่ายในเว็บ' } : {}),
  });
  return { kind: 'answer', replyText, sourceRefs, webLinks, ...(layout ? { layout } : {}) };
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
    + `${periodLine(undefined, undefined, english, ctx.periodLabel, ctx.periodNote)}${sourceText}${asOfLine(output.asOf, english)}${certifyText}`;
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
  // C6 (batch 5c): "ณ 2026-08-25" was a raw ISO date; a stated cut-off day always carries its year.
  const asOfDateLabel = thaiAbbrDate(asOfDate, english) ?? asOfDate;
  const headline = english
    ? `Unpaid supplier bills as of ${asOfDateLabel}: ${moneyText(total)} THB (${plural(suppliers, 'supplier')})`
    : `ยอดค้างจ่ายเจ้าหนี้ ณ ${asOfDateLabel}: ${moneyText(total)} บาท (เจ้าหนี้ ${groupThousands(String(suppliers))} ราย)`;

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
  // C6 (batch 5c): "2026-08-01 – 2026-08-31" was raw ISO in both languages.
  const sinceLabel = thaiAbbrDate(since, english) ?? since;
  const untilLabel = closed ? thaiAbbrDate(until as string, english) ?? until : undefined;
  const window = english
    ? (closed ? `${sinceLabel} – ${untilLabel}` : `since ${sinceLabel}`)
    : (closed ? `${sinceLabel} – ${untilLabel}` : `ตั้งแต่ ${sinceLabel}`);
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
    + `${periodLine(undefined, undefined, english, ctx.periodLabel, ctx.periodNote)}${sourceText}${asOfLine(output.asOf, english)}`;
  return { kind: 'answer', replyText, sourceRefs, webLinks };
}

/** R-L4: enough pending-approval rows to be useful in one bubble — the tool itself already caps
 *  `items` at 10 (erp-reimbursement-tools.use-case.ts), this narrows the DISPLAY further to 5. */
const MAX_REIMBURSEMENT_APPROVAL_LINES = 5;

/**
 * R-L4 — `reimbursement.list_pending_approvals` as a numbered list ("เบิกจ่ายรออนุมัติมีอะไรบ้าง").
 * `total` is the tool's TRUE count (computed before its own page cap), so it is always safe to state;
 * `items` is capped at 10 by the tool, so summing only the shown rows would UNDERSTATE the real total
 * whenever more than 10 are pending — the same anti-fabrication rule `expense.list_recent`'s
 * `aggregationIncomplete` enforces elsewhere. A total amount is therefore only ever stated when nothing
 * was truncated (`total` does not exceed the rows actually returned) and every shown row shares one
 * currency; otherwise the count stands alone rather than risk an amount the tool never itself totalled.
 */
function formatReimbursementPendingApprovalsList(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'reimbursement.list_pending_approvals');
  const total = data?.['total'];
  const items = data?.['items'];
  if (!isCount(total) || !Array.isArray(items)) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const rows: Array<{ requester: string; date?: string; amount: string | number; currency: string; waitingOn?: string }> = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'unverified' };
    const item = raw as Record<string, unknown>;
    const amount = item['amount'];
    const currency = item['currency'];
    if (!isMoney(amount) || typeof currency !== 'string' || !currency) return { kind: 'unverified' };
    const requester = typeof item['requesterDisplayName'] === 'string' && item['requesterDisplayName']
      ? item['requesterDisplayName'] as string : (english ? 'Unknown requester' : 'ไม่ระบุผู้ขอ');
    const submittedAt = typeof item['submittedAt'] === 'string' ? item['submittedAt'].slice(0, 10) : undefined;
    rows.push({ requester, date: submittedAt, amount, currency, waitingOn: typeof item['waitingOn'] === 'string' ? item['waitingOn'] : undefined });
  }

  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  const moneyWithCurrency = (amount: string | number, currency: string) => `${moneyText(amount)} ${!english && currency === 'THB' ? 'บาท' : currency}`;
  const shown = rows.slice(0, MAX_REIMBURSEMENT_APPROVAL_LINES);
  // C6 (batch 5c): list-item dates are short and year-free within the tool's own as-of year.
  const listYear = civilYear(output.asOf);
  const itemLines = shown.map((row, index) => {
    const dateLabel = row.date ? thaiAbbrDate(row.date, english, listYear) ?? row.date : undefined;
    return `\n• ${row.requester}${dateLabel ? ` (${dateLabel})` : ''}: ${moneyWithCurrency(row.amount, row.currency)}${row.waitingOn ? ` · ${english ? 'waiting for' : 'รอ'} ${row.waitingOn}` : ''}`;
  }).join('');
  const moreText = total > shown.length
    ? (english ? `\nShowing ${shown.length} of ${plural(total, 'request')}` : `\nแสดง ${shown.length} จาก ${groupThousands(String(total))} รายการ`)
    : '';

  const sumGrounded = total <= items.length && rows.every((row) => row.currency === rows[0]?.currency);
  const totalText = sumGrounded && rows[0]
    ? (english
      ? `, totaling ${moneyWithCurrency(rows.reduce((sum, row) => sum + moneyNumber(row.amount), 0), rows[0].currency)}`
      : ` รวม ${moneyWithCurrency(rows.reduce((sum, row) => sum + moneyNumber(row.amount), 0), rows[0].currency)}`)
    : '';
  const scope = data?.['accessScope'];
  const subject = scope === 'company' ? (english ? 'Shop claims pending approval' : 'ใบเบิกของร้านที่รออนุมัติ')
    : scope === 'related' ? (english ? 'Related claims pending approval' : 'ใบเบิกที่เกี่ยวข้องกับคุณรออนุมัติ')
    : scope === 'own' ? (english ? 'Your claims pending approval' : 'ใบเบิกของคุณที่รออนุมัติ')
    : (english ? 'Pending approvals' : 'เบิกจ่ายรออนุมัติ');
  const headline = english
    ? `${subject}: ${plural(total, 'request')}${totalText}`
    : `${subject}: ${groupThousands(String(total))} รายการ${totalText}`;

  const replyText = `${headline}${itemLines}${moreText}${sourceText}${asOfLine(output.asOf, english)}`;
  // The same queue on the locked card (context 2): how many wait, their total where the sentence
  // states one, then each listed claim a row under its requester. What was checked is said in a note,
  // so "none" is never read as "nobody in the company is waiting".
  const asOfDay = asOfDayLabel(output.asOf);
  const layout = english ? undefined : cardLayout({
    context: 'open_work',
    header: ['เบิกจ่ายรออนุมัติ', total === 0 ? 'ไม่พบรายการ' : `พบ ${groupThousands(String(total))} รายการ`],
    rows: [
      ...(sumGrounded && rows[0] ? [{ label: 'ยอดรวม', value: moneyWithCurrency(rows.reduce((sum, row) => sum + moneyNumber(row.amount), 0), rows[0].currency), emphasis: 'total' as const }] : []),
      ...shown.map((row) => {
        const dateLabel = row.date ? thaiAbbrDate(row.date, false, listYear) ?? row.date : undefined;
        return { label: row.requester, value: `${moneyWithCurrency(row.amount, row.currency)}${dateLabel ? ` · ${dateLabel}` : ''}${row.waitingOn ? ` · รอ ${row.waitingOn}` : ''}` };
      }),
      ...(asOfDay ? [{ label: 'ข้อมูล ณ', value: asOfDay }] : []),
    ],
    ...cardNotes([moreText, data?.['accessScope'] === 'company' ? 'ใบเบิกของร้านที่รออนุมัติ' : data?.['accessScope'] === 'related' ? 'เฉพาะใบเบิกที่เกี่ยวข้องกับคุณ' : data?.['accessScope'] === 'own' ? 'เฉพาะใบเบิกของคุณ' : 'ตรวจเฉพาะใบเบิกที่รอคุณอนุมัติ']),
  });
  return { kind: 'answer', replyText, sourceRefs, webLinks, ...(layout ? { layout } : {}) };
}

/**
 * R-L4 — `reimbursement.get_summary` as one status metric ("มีใบเบิกรออนุมัติกี่ใบ"). The tool returns
 * 4 counts/amounts (ReimbursementAiSummary), never a single figure. C8 (batch 5c, T-143-a): leading
 * with the unpaid TOTAL read as "nothing owed" whenever every pending claim happened to still be
 * unapproved (a true 0.00 that said nothing about the 2 claims actually waiting) — the answer now
 * leads with the STATUS COUNTS a customer asks about, and only states the unpaid-approved amount once
 * unpaidApprovedCount says there is one; overdue stays hidden at zero, same as before. Every field is
 * read verbatim from the tool, nothing recomputed.
 */
function formatReimbursementGetSummarySingleMetric(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'reimbursement.get_summary');
  const pending = data?.['pendingApprovalCount'];
  const unpaidApproved = data?.['unpaidApprovedCount'];
  const overdue = data?.['overdueApprovalCount'];
  const totalUnpaid = data?.['totalUnpaidAmount'];
  const duplicateBlocked = data?.['duplicateBlockedCount'];
  if (!isCount(pending) || !isCount(unpaidApproved) || !isCount(overdue) || !isMoney(totalUnpaid)) return { kind: 'unverified' };
  if (duplicateBlocked !== undefined && !isCount(duplicateBlocked)) return { kind: 'unverified' };
  if (data && aggregationIncomplete(data)) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);
  const clauses = [
    english ? `${plural(pending, 'request')} pending approval` : `รออนุมัติ ${groupThousands(String(pending))} รายการ`,
    // The unpaid-approved amount only means something once at least one claim has reached that state.
    english
      ? `${plural(unpaidApproved, 'request')} approved, unpaid${unpaidApproved > 0 ? `, totaling ${moneyText(totalUnpaid)} THB` : ''}`
      : `อนุมัติแล้วรอจ่าย ${groupThousands(String(unpaidApproved))} รายการ${unpaidApproved > 0 ? ` รวม ${moneyText(totalUnpaid)} บาท` : ''}`,
    isCount(duplicateBlocked) && duplicateBlocked > 0 ? (english
      ? `${plural(duplicateBlocked, 'request')} blocked by duplicates`
      : `${REIMBURSEMENT_DUPLICATE_BLOCK_LABEL} ${groupThousands(String(duplicateBlocked))} รายการ`) : undefined,
    overdue > 0 ? (english ? `${plural(overdue, 'request')} overdue` : `เกินกำหนด ${groupThousands(String(overdue))} รายการ`) : undefined,
  ].filter((clause): clause is string => Boolean(clause));
  const headline = english ? `Reimbursements: ${clauses.join(' · ')}` : `ใบเบิก: ${clauses.join(' · ')}`;
  // Item 1: this tool has no `queryApplied` wrapper either, so its scope echo also rides
  // `data.accessScope` directly (see GetReimbursementAiSummaryUseCase's own own/related/company check).
  const scopeText = scopeLine(data?.['accessScope'], english);

  const replyText = `${headline}${scopeText}${sourceText}${asOfLine(output.asOf, english)}`;
  // The same counts on the locked card: one row for each state the sentence names, in its words.
  const asOfDay = asOfDayLabel(output.asOf);
  const layout = english || !asOfDay ? undefined : cardLayout({
    context: 'open_work',
    header: ['สรุปใบเบิก', `ณ ${asOfDay}`],
    rows: [
      { label: 'รออนุมัติ', value: `${groupThousands(String(pending))} รายการ` },
      { label: 'อนุมัติแล้วรอจ่าย', value: `${groupThousands(String(unpaidApproved))} รายการ${unpaidApproved > 0 ? ` รวม ${moneyText(totalUnpaid)} บาท` : ''}` },
      // The sentence counts claims a duplicate holds apart from those that can be paid (owner 2026-10-05:
      // "นับเฉพาะใบที่จ่ายได้จริง"); the card states the same split, in the same order.
      ...(isCount(duplicateBlocked) && duplicateBlocked > 0 ? [{ label: REIMBURSEMENT_DUPLICATE_BLOCK_LABEL, value: `${groupThousands(String(duplicateBlocked))} รายการ` }] : []),
      ...(overdue > 0 ? [{ label: 'เกินกำหนด', value: `${groupThousands(String(overdue))} รายการ` }] : []),
    ],
    ...cardNotes([scopeNote(data?.['accessScope'])]),
  });
  return { kind: 'answer', replyText, sourceRefs, webLinks, ...(layout ? { layout } : {}) };
}

/** Same Thai wording the web app already shows for these exact status values
 *  (apps/web/src/features/reimbursements/reimbursements.model.ts REQUEST_STATUS_LABELS) — kept as
 *  one small local map the same way ACCOUNTING_DOCUMENT_TYPE_TH above is: no cross-app import, only
 *  the one formatter that needs it. An unknown/legacy status keeps its raw key, never a guess. */
const REIMBURSEMENT_STATUS_TH: Record<string, string> = {
  DRAFT: 'ร่าง', PENDING_APPROVAL: 'รออนุมัติ', APPROVED: 'อนุมัติแล้ว', REJECTED: 'ปฏิเสธ',
  CANCELLED: 'ยกเลิก', FINANCE_REVIEW: 'รอตรวจสอบการเงิน', READY_FOR_PAYMENT: 'พร้อมจ่าย',
  PARTIALLY_PAID: 'จ่ายบางส่วน', PAID: 'จ่ายแล้ว', VOIDED: 'เพิกถอน',
};

/**
 * Item 3 (spec §3 row 8) — `reimbursement.get_detail` as one claim's identity, for an ordinal
 * follow-up about a single already-shown reimbursement. One permission-checked record, not a page
 * of an aggregate, so — like expense.get_detail's single-record family — this never checks
 * `aggregationIncomplete`. States the requester (or an honest "unnamed requester", the same label
 * list_pending_approvals already uses), incurred date (Thai calendar), amount, status in the SAME
 * wording the web app already uses for this exact value, source and link.
 */
function formatReimbursementGetDetailSingleMetric(output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  const data = sourceData(output, 'reimbursement.get_detail');
  const incurredDate = data?.['incurredDate'];
  const amount = data?.['amount'];
  const status = data?.['status'];
  if (typeof incurredDate !== 'string' || typeof status !== 'string' || !status || !isMoney(amount)) return { kind: 'unverified' };
  const dateLabel = thaiIsoDate(incurredDate.slice(0, 10));
  if (!dateLabel) return { kind: 'unverified' };

  const english = isEnglish(ctx);
  const requester = typeof data?.['requesterDisplayName'] === 'string' && data['requesterDisplayName']
    ? data['requesterDisplayName'] as string : (english ? 'Unknown requester' : 'ไม่ระบุผู้ขอ');
  const statusLabel = english ? humanizedEnum(status) : REIMBURSEMENT_STATUS_TH[status] ?? status;
  const { sourceRefs, webLinks, sourceText } = groundedSource(output.facts.find((fact) => fact.sourceRef)?.sourceRef, english);

  // C6 (batch 5c): the English headline printed the raw ISO date while the Thai side already used
  // `dateLabel` — `incurredDate` already passed `thaiIsoDate`'s stricter real-calendar check above.
  const headline = english
    ? `Reimbursement: ${requester}, ${thaiAbbrDate(incurredDate.slice(0, 10), true) ?? incurredDate.slice(0, 10)}, ${moneyText(amount)} THB`
    : `ใบเบิกจ่าย: ${requester} วันที่ ${dateLabel} ยอด ${moneyText(amount)} บาท`;
  const statusText = english ? `\nStatus: ${statusLabel}` : `\nสถานะ: ${statusLabel}`;

  const paymentBlock = data?.['duplicateBlocksPayment'] === true && typeof data['paymentBlockNotice'] === 'string'
    ? `\n${data['paymentBlockNotice']}` : '';
  const replyText = `${headline}${statusText}${paymentBlock}${sourceText}${asOfLine(output.asOf, english)}`;
  // The same claim on the locked record card (context 5): its number when it has one, who asked, the
  // day, the amount on the emphasised row and the state as a pill. A notice that payment is held is a note.
  const requestNo = typeof data?.['requestNo'] === 'string' && data['requestNo'].trim() ? data['requestNo'].trim() : undefined;
  const tone = status === 'PAID' || status === 'APPROVED' ? 'ok' as const
    : status === 'REJECTED' || status === 'CANCELLED' || status === 'VOIDED' ? 'closed' as const : 'pending' as const;
  const layout = english ? undefined : cardLayout({
    context: 'expense_record',
    header: ['ใบเบิกจ่าย', statusLabel],
    rows: [
      ...(requestNo ? [{ label: 'เลขที่ใบเบิก', value: requestNo }] : []),
      { label: 'ผู้ขอ', value: requester },
      { label: 'วันที่', value: dateLabel },
      { label: 'ยอดรวม', value: `${moneyText(amount)} บาท`, emphasis: 'total' },
      { label: 'สถานะ', value: statusLabel, tone },
    ],
    ...cardNotes([paymentBlock]),
    ...(webLinks[0] ? { linkLabel: 'เปิดดูใบเบิกในเว็บ' } : {}),
  });
  return { kind: 'answer', replyText, sourceRefs, webLinks, ...(layout ? { layout } : {}) };
}

/** The two reads the locked "งานค้าง" card (design lock context 2) is drawn from. */
export const OPEN_WORK_TOOLS: ReadonlySet<string> = new Set(['notifications.list_open_alerts', 'workflow.list_assigned_tasks']);
const OPEN_WORK_ROWS = 10;

/**
 * The open-work card of ONE successful read of the reader's own open notices or unfinished assigned
 * tasks: every item the tool returned, how many there are, when it was read, and in one short line
 * WHAT was checked — so "nothing found" is never read as "the company has no work" (the notice read is
 * one page of the reader's own notices; the task read is the reader's own open tasks).
 *
 * Built only from the tool's data. A result that is not this exact shape — a missing count, an item
 * without a title — has no layout, and the answer is drawn as its sentence. A read that was refused or
 * failed never reaches here: the caller passes successful results only.
 *
 * The claim rows and the button that opens the claim come from what the tool itself vouched for
 * (`kind`, `documentNo`, `opens`); nothing is read out of a title here.
 */
export function openWorkCardLayout(toolName: string, data: unknown, asOf: string | undefined): LineAiAnswerCardLayout | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const record = data as Record<string, unknown>;
  const tasks = toolName === 'workflow.list_assigned_tasks';
  if (!tasks && toolName !== 'notifications.list_open_alerts') return undefined;
  const count = record[tasks ? 'total' : 'count'];
  const raw = record['items'];
  if (!isCount(count) || !Array.isArray(raw) || raw.length > count) return undefined;
  const items: Array<Record<string, unknown> & { title: string }> = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || typeof (entry as Record<string, unknown>)['title'] !== 'string'
      || !((entry as Record<string, unknown>)['title'] as string).trim()) return undefined;
    items.push(entry as Record<string, unknown> & { title: string });
  }
  if (count > 0 && items.length === 0) return undefined;
  const shown = items.slice(0, OPEN_WORK_ROWS);
  // The notice read is a page: `hasMore` means the count is a floor, never the whole.
  const more = !tasks && record['hasMore'] === true;
  const found = count === 0 ? undefined : `พบ${more ? 'มากกว่า' : ''} ${groupThousands(String(count))} รายการ`;
  const asOfLabel = thaiExpenseAsOfLabel(asOf);
  const asOfRow: LineAiAnswerCardRow[] = asOfLabel ? [{ label: 'ข้อมูล ณ', value: asOfLabel }] : [];
  const partial = count > shown.length || more ? [`แสดง ${shown.length} รายการแรก ดูทั้งหมดได้ในเว็บ`] : [];
  if (tasks) {
    return cardLayout({
      context: 'open_work',
      header: ['งานที่มอบหมาย', found ?? 'ไม่พบงานค้าง'],
      rows: [...shown.map((item, index) => ({ label: `งานที่ ${index + 1}`, value: item.title.trim() })), ...asOfRow],
      notes: ['ตรวจเฉพาะงานที่มอบหมายให้คุณและยังไม่เสร็จ', ...partial],
      linkLabel: 'ดูงานของฉันในเว็บ',
    });
  }
  const claimNumbers = shown.map((item) => item['kind'] === 'claim_approval' && typeof item['documentNo'] === 'string' ? item['documentNo'].trim() : '');
  const claims = count > 0 && !partial.length && claimNumbers.every(Boolean);
  return cardLayout({
    context: 'open_work',
    header: claims ? ['ใบเบิกรออนุมัติ', found!] : ['การแจ้งเตือน', found ?? 'ไม่พบรายการ'],
    rows: [
      ...(claims
        ? [...claimNumbers.map((value) => ({ label: 'เลขที่ใบเบิก', value })), { label: 'ต้องทำ', value: 'ตรวจสอบและอนุมัติใบเบิก' }]
        : shown.map((item, index) => ({ label: `รายการที่ ${index + 1}`, value: item.title.trim() }))),
      ...asOfRow,
    ],
    notes: ['ตรวจเฉพาะแจ้งเตือนที่ยังไม่ปิด ตามสิทธิ์ของคุณ', ...partial],
    linkLabel: claims && record['opens'] === 'claim' ? 'เปิดใบเบิกเพื่ออนุมัติ' : 'ดูแจ้งเตือนในเว็บ',
  });
}

/** What an answer about the reader's own waiting work is read from (advisor Q2): the two queues waiting
 *  for the reader, the status of the reader's own claims that stands in for a queue they do not have,
 *  the day's checklist, and the two reads of context 2. */
export const BACKLOG_TOOLS: ReadonlySet<string> = new Set([
  'expense.list_substitute_receipts_to_sign', 'reimbursement.list_pending_approvals', 'reimbursement.get_summary',
  'expense.get_daily_closing', ...OPEN_WORK_TOOLS,
]);
const NOTHING_WAITING = 'ไม่มีค้าง';

/** What one read contributes to the card: a row for each kind of work that waits, or the one row that
 *  says this kind was read and has nothing; and the plain sentences its figures need beside them. */
type BacklogPart = { waiting: LineAiAnswerCardRow[]; none?: LineAiAnswerCardRow; notes?: string[] };

function backlogPart(toolName: string, data: Record<string, unknown>, asOf: string | undefined): BacklogPart | undefined {
  const count = (value: number) => `${groupThousands(String(value))} รายการ`;
  if (toolName === 'expense.list_substitute_receipts_to_sign') {
    // The words of the queue itself (substitute-receipt.use-case.ts), counted in ใบ like every other answer about it.
    const label = 'ใบรับรองแทนใบเสร็จ';
    const step = (key: string): Record<string, unknown> | null | undefined => data[key] === undefined ? null
      : data[key] && typeof data[key] === 'object' && !Array.isArray(data[key]) ? data[key] as Record<string, unknown> : undefined;
    const payer = step('asPayer'), approver = step('asApprover');
    if (payer === undefined || approver === undefined || (!payer && !approver)
      || (payer && !isCount(payer['count'])) || (approver && !isCount(approver['count']))) return undefined;
    const sheets = (value: number) => `${groupThousands(String(value))} ใบ`;
    const parts: string[] = [];
    if (payer && (payer['count'] as number) > 0) parts.push(`รอคุณลงลายมือชื่อในฐานะผู้จ่ายเงิน ${sheets(payer['count'] as number)}`);
    if (approver && (approver['count'] as number) > 0) {
      const steps = Array.isArray(approver['byStep']) ? approver['byStep'] as unknown[] : [];
      const named = steps.map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : undefined);
      // The tool's own split of the approver's pile, when it is whole; otherwise the pile as one figure.
      const split = named.length > 0 && named.every((entry) => typeof entry?.['stepLabel'] === 'string' && (entry['stepLabel'] as string).trim() && isCount(entry['count']))
        && named.reduce((sum, entry) => sum + (entry!['count'] as number), 0) === approver['count'];
      parts.push(split ? named.map((entry) => `${(entry!['stepLabel'] as string).trim()} ${sheets(entry!['count'] as number)}`).join(' · ')
        : `รอคุณอนุมัติ ${sheets(approver['count'] as number)}`);
    }
    if (parts.length) return { waiting: [{ label, value: parts.join(' · ') }] };
    // Read for one side only (a question that named it): "nothing" is said of that side alone.
    return { waiting: [], none: { label, value: payer && approver ? NOTHING_WAITING : payer ? 'ไม่มีที่รอคุณลงลายมือชื่อ' : 'ไม่มีที่รอคุณอนุมัติ' } };
  }
  if (toolName === 'reimbursement.list_pending_approvals') {
    const label = 'เบิกจ่ายรอคุณอนุมัติ';
    const total = data['total'], items = data['items'];
    if (!isCount(total) || !Array.isArray(items) || aggregationIncomplete(data)) return undefined;
    if (total === 0) return { waiting: [], none: { label, value: NOTHING_WAITING } };
    // An amount only when the tool returned every claim it counted, in one currency (the list family's own rule).
    const rows = items.map((item) => item && typeof item === 'object' && !Array.isArray(item) ? item as Record<string, unknown> : undefined);
    const summed = total <= rows.length && rows.length > 0 && rows.every((row) => isMoney(row?.['amount']) && typeof row['currency'] === 'string' && row['currency'] === rows[0]!['currency']);
    const sum = summed ? rows.reduce((value, row) => value + moneyNumber(row!['amount'] as string | number), 0) : undefined;
    const currency = summed ? rows[0]!['currency'] as string : undefined;
    return { waiting: [{ label, value: `${count(total)}${sum !== undefined ? ` รวม ${moneyText(sum)} ${currency === 'THB' ? 'บาท' : currency}` : ''}` }] };
  }
  if (toolName === 'reimbursement.get_summary') {
    const pending = data['pendingApprovalCount'], unpaid = data['unpaidApprovedCount'], overdue = data['overdueApprovalCount'], amount = data['totalUnpaidAmount'];
    const blocked = data['duplicateBlockedCount'];
    if (!isCount(pending) || !isCount(unpaid) || !isCount(overdue) || !isMoney(amount) || aggregationIncomplete(data)
      || (blocked !== undefined && !isCount(blocked))) return undefined;
    const waiting: LineAiAnswerCardRow[] = [
      ...(pending > 0 ? [{ label: 'ใบเบิกรออนุมัติ', value: count(pending) }] : []),
      ...(unpaid > 0 ? [{ label: 'ใบเบิกอนุมัติแล้วรอจ่าย', value: `${count(unpaid)} รวม ${moneyText(amount)} บาท` }] : []),
      // A claim a duplicate holds waits too, and is not among those that can be paid.
      ...(isCount(blocked) && blocked > 0 ? [{ label: `ใบเบิก${REIMBURSEMENT_DUPLICATE_BLOCK_LABEL}`, value: count(blocked) }] : []),
      ...(overdue > 0 ? [{ label: 'ใบเบิกเกินกำหนด', value: count(overdue) }] : []),
    ];
    const scope = scopeNote(data['accessScope']);
    return { waiting, ...(waiting.length ? {} : { none: { label: 'ใบเบิก', value: NOTHING_WAITING } }), ...(scope ? { notes: [`ส่วนใบเบิก${scope}`] } : {}) };
  }
  if (toolName === 'expense.get_daily_closing') {
    const day = data['date'];
    if (typeof day !== 'string' || !CIVIL_DATE.test(day) || aggregationIncomplete(data)) return undefined;
    const isToday = asOfInZone(asOf, data['timezone'])?.day === day;
    // The checklist's own entries and words; what was sent in that day is not work that waits, and a
    // possible duplicate is (the web's word for it).
    const dueDay = thaiAbbrDate(day, false) ?? day;
    const waiting = [
      ...dailyClosingEntries(data, isToday, false).filter((entry) => entry.key !== 'submittedToday'),
      dailyClosingCountEntry('duplicateRisks', 'อาจเป็นรายการซ้ำ', 'Possible duplicates:', data, false),
    ].filter((entry): entry is DailyClosingEntry => Boolean(entry))
      .map((entry) => ({ label: !isToday && entry.key === 'dueEndOfDay' ? `ครบกำหนดจ่าย ${dueDay}` : entry.label, value: entry.value }));
    const scope = scopeNote(data['accessScope']);
    const nothingDue = waiting.length > 0 && !dailyClosingMoneyEntry('dueEndOfDay', '-', '-', data, false) && !dailyClosingMoneyEntry('overdue', '-', '-', data, false);
    const notes = [
      ...(nothingDue ? [`ไม่มีรายการครบกำหนดจ่าย${isToday ? 'วันนี้' : ` ${dueDay} `}หรือเกินกำหนด`] : []),
      ...(scope ? [`ส่วนค่าใช้จ่าย${scope}`] : []),
    ];
    return { waiting, ...(waiting.length ? {} : { none: { label: 'รายการค่าใช้จ่าย', value: NOTHING_WAITING } }), ...(notes.length ? { notes } : {}) };
  }
  if (OPEN_WORK_TOOLS.has(toolName)) {
    const tasks = toolName === 'workflow.list_assigned_tasks';
    const label = tasks ? 'งานที่มอบหมาย' : 'การแจ้งเตือน';
    const found = data[tasks ? 'total' : 'count'];
    if (!isCount(found)) return undefined;
    if (found === 0) return { waiting: [], none: { label, value: NOTHING_WAITING } };
    // The notice read is one page: `hasMore` makes its count a floor.
    return { waiting: [{ label, value: `${!tasks && data['hasMore'] === true ? 'มากกว่า ' : ''}${count(found)}` }] };
  }
  return undefined;
}

/**
 * ONE row card for an answer made of several reads of what is waiting (design lock context 2; owner
 * 2026-10-05 on the wall of text "มีงานค้างอะไรบ้าง" got: "อ่านยากมาก"). Each kind of work is a row — how
 * many wait and, where the read totals it, how much; a kind that was read and has nothing says
 * "ไม่มีค้าง", so the reader sees it was checked. Kinds with work come first.
 *
 * Built only from the results given, which the caller has already checked are successful,
 * permission-checked reads — never from a sentence. A result that is not exactly its tool's shape, or
 * the same read twice, has no card, and the answer is drawn as its sentences.
 */
export function backlogCardLayout(results: ReadonlyArray<{ toolName: string; data?: unknown; asOf?: string }>): LineAiAnswerCardLayout | undefined {
  if (results.length === 0 || new Set(results.map((result) => result.toolName)).size !== results.length) return undefined;
  const parts: BacklogPart[] = [];
  for (const result of results) {
    const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data as Record<string, unknown> : undefined;
    const part = data && BACKLOG_TOOLS.has(result.toolName) ? backlogPart(result.toolName, data, result.asOf) : undefined;
    if (!part) return undefined;
    parts.push(part);
  }
  const day = asOfInZone(results[0]!.asOf, 'Asia/Bangkok')?.day;
  const asOfLabel = day ? thaiAbbrDate(day, false) : undefined;
  if (!asOfLabel) return undefined;
  const waiting = parts.flatMap((part) => part.waiting);
  return cardLayout({
    context: 'open_work',
    // With work waiting the header says the day it was read; with none it says so, and the day is a row.
    header: ['งานค้าง', waiting.length ? `ณ ${asOfLabel}` : 'ไม่พบงานค้าง'],
    rows: [...waiting, ...parts.flatMap((part) => part.none ? [part.none] : []), ...(waiting.length ? [] : [{ label: 'ข้อมูล ณ', value: asOfLabel }])],
    notes: [...parts.flatMap((part) => part.notes ?? []), 'ตรวจเฉพาะงานที่รอคุณและรายการที่คุณมีสิทธิ์ดู'],
  });
}

/**
 * Authoritative deterministic terminal copy for a prepared read that did NOT reach a verified success —
 * an unavailable/error/failed source, or a success the compiled formatter could not verify. It states an
 * honest outcome with NO fabricated facts, numbers, source, or completion, and instantiates no composer /
 * router / critic / model. `PERMISSION_DENIED` (a post-plan state change) gets the forbidden line, except
 * the one typed reimbursement-approval denial, which names the self-serve alternative instead.
 */
export function preparedTerminalReply(output: SpecialistOutput, ctx: PreparedFormatContext): string {
  const english = isEnglish(ctx);
  if (output.status === 'PERMISSION_DENIED' || output.toolCalls.some(call => call.errorCode === 'TOOL_INPUT_NOT_AUTHORIZED')) {
    if (output.toolCalls.some((call) => call.errorCode === REIMBURSEMENT_APPROVAL_NOT_PERMITTED)) {
      return reimbursementApprovalNotPermittedReplyText(english);
    }
    return toolPermissionReplyText(english ? 'en' : 'th', ctx.permissions);
  }
  // C4 (batch 5c, T-008-b/T-019-a/T-064-a): expense.list_recent/get_breakdown's own not-found/
  // ambiguous/out-of-scope branch/category/vendor result is a real, grounded answer from the tool's
  // catalog — no compiled formatter above claims it (none of their shapes match), so it fell through
  // to the generic "system read failure" line below. Give it the same honest reply the classic path
  // (orchestrator's `expenseBranchResolutionReply`) already gives, before that generic fallback.
  const nameIssue = expenseNameResolutionIssue([output]);
  if (nameIssue) return expenseNameResolutionReplyText(nameIssue, english);
  // Spec §8 "อ่านข้อมูลไม่ได้ ฝั่งระบบ": a system-side read failure, not a question — no "try again".
  return english
    ? "I can't fetch this data right now. You can view it on the Expenses page on the web."
    : 'ตอนนี้น้องมั่งมียังดึงข้อมูลส่วนนี้ไม่ได้ค่ะ ดูได้ที่หน้ารายจ่ายบนเว็บ';
}

/** Exact compiled registry: `${tool}::${answerShape}` → formatter. Add one verified family at a time. */
const COMPILED_FORMATTERS: ReadonlyMap<string, (output: SpecialistOutput, ctx: PreparedFormatContext) => PreparedFormatResult> =
  new Map([
    [preparedFamilyKey('sales.get_sales_summary', 'single_metric'), formatSalesSummarySingleMetric],
    [preparedFamilyKey('expense.list_recent', 'single_metric'), formatExpenseListRecentSingleMetric],
    [preparedFamilyKey('expense.list_recent', 'list'), formatExpenseListRecentList],
    [preparedFamilyKey('expense.get_detail', 'single_metric'), formatExpenseGetDetailSingleMetric],
    [preparedFamilyKey('expense.get_breakdown', 'list'), formatExpenseBreakdownList],
    [preparedFamilyKey('reimbursement.list_pending_approvals', 'list'), formatReimbursementPendingApprovalsList],
    [preparedFamilyKey('reimbursement.get_summary', 'single_metric'), formatReimbursementGetSummarySingleMetric],
    [preparedFamilyKey('reimbursement.get_detail', 'single_metric'), formatReimbursementGetDetailSingleMetric],
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

/**
 * The families LINE always serves (owner 2026-09-29: no capability switches). Spec R-L4 (mangmee-ai-expense-advisor
 * spec §5): only a family with a verified formatter, a fixed fixture and a passed blind pairwise eval belongs here, so
 * this is a deliberate subset of COMPILED_PREPARED_FAMILY_KEYS (tax/inventory/AP/CRM compile but are not approved).
 * Nothing reads it from the environment: a stale AgentCore env once narrowed it to four families (UAT 2026-09-29).
 */
export const APPROVED_PREPARED_FAMILY_KEYS: ReadonlySet<string> = activePreparedFamilies([
  'sales.get_sales_summary::single_metric', 'expense.list_recent::single_metric', 'accounting.get_summary::list',
  'expense.get_daily_closing::single_metric', 'expense.list_recent::list', 'expense.get_breakdown::list',
  'reimbursement.list_pending_approvals::list', 'reimbursement.get_summary::single_metric', 'expense.get_detail::single_metric',
  'reimbursement.get_detail::single_metric',
]);

/** Format via the compiled family, or `unverified` when the family/shape has no formatter. */
export function formatPreparedSimpleRead(familyKey: string, output: SpecialistOutput, ctx: PreparedFormatContext): PreparedFormatResult {
  return (COMPILED_FORMATTERS.get(familyKey) ?? (() => ({ kind: 'unverified' as const })))(output, ctx);
}
