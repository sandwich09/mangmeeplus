// LINE AI value normalizer – deterministic amount/date candidate extraction (item 10F).
//
// Annotation-only by design (ADR 0011): the user's text is NEVER rewritten. This module
// emits every defensible reading of money and date tokens as bounded candidates; the model
// SELECTS from them (never converts numerals or calendars itself) and membership guards on
// both sides enforce that selection. False-positive candidates are acceptable (they only
// widen the allowed set slightly); missing candidates are not, so recall wins over precision.
// Pure logic: no framework imports, clock injected via `todayIso`.

export type LineAiAmountCandidate = {
  /** Exact substring of the source text this reading came from. */
  span: string;
  /** Plain decimal string, e.g. "60" or "1234.50". */
  value: string;
  /** Adjacent currency token as written (e.g. "บาท", "฿", "$b"); absent when none. */
  currencyToken?: string;
  assumptions?: string[];
};

export type LineAiDateCandidate = {
  span: string;
  day: number;
  month: number;
  /** Buddhist-era year – the canonical interpretation/display convention for this channel. */
  yearBe: number;
  /** ISO-8601 CE date – the wire/storage format for tools and Prisma. */
  isoDate: string;
  assumptions: string[];
};

export const LINE_AI_PERIOD_KINDS = ['day', 'week', 'month', 'quarter', 'year', 'range', 'last_n_days'] as const;
export type LineAiPeriodKind = (typeof LINE_AI_PERIOD_KINDS)[number];

/** One defensible reading of a PERIOD the user named (period-resolution spec §3.1). Resolved by code
 *  from the text plus the injected `todayIso`; the model only SELECTS one of these, never computes a
 *  calendar itself (ADR 0011). Both bounds are inclusive ISO-8601 CE civil dates (Asia/Bangkok days). */
export type LineAiPeriodCandidate = {
  /** Exact substring of the source text this reading came from. */
  span: string;
  kind: LineAiPeriodKind;
  fromDate: string;
  toDate: string;
  /** 'YYYY-MM' — set only for `kind: 'month'`, for tools whose input is a period key. */
  monthKey?: string;
  source: 'relative' | 'explicit' | 'named_month';
  /** Thai display phrase naming the period WITH its dates, e.g. `เดือนที่แล้ว (1–31 ส.ค. 2569)`. */
  label: string;
  assumptions: string[];
};

export type LineAiValueCandidates = {
  amounts: LineAiAmountCandidate[];
  dates: LineAiDateCandidate[];
  /** Period readings (period-resolution spec §3.1). ADDITIVE and optional: a producer written before
   *  this field emits none, and a turn that names no period carries none — so existing payloads stay
   *  byte-identical and every reader must tolerate `undefined`. */
  periods?: LineAiPeriodCandidate[];
};

/** Re-bound the annotation at the Gateway/AgentCore wire. A malformed candidate must never become
 *  authority for a tool date; callers can re-extract from the unchanged message on rejection. */
export function parseLineAiValueCandidates(value: unknown, messageText: string): LineAiValueCandidates | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw['amounts']) || raw['amounts'].length > MAX_AMOUNT_CANDIDATES
    || !Array.isArray(raw['dates']) || raw['dates'].length > MAX_DATE_CANDIDATES
    || (raw['periods'] !== undefined && (!Array.isArray(raw['periods']) || raw['periods'].length > MAX_PERIOD_CANDIDATES))) return undefined;
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const span = (item: Record<string, unknown>): boolean =>
    typeof item['span'] === 'string' && item['span'].length > 0 && item['span'].length <= 160 && messageText.includes(item['span']);
  const assumptions = (item: Record<string, unknown>): boolean =>
    Array.isArray(item['assumptions']) && item['assumptions'].length <= 12
    && item['assumptions'].every((part: unknown) => typeof part === 'string' && part.length <= 64);
  const day = (date: unknown): date is string => {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const ms = Date.parse(`${date}T00:00:00Z`);
    return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
  };
  if (!raw['amounts'].every((item: unknown) => record(item) && span(item)
    && typeof item['value'] === 'string' && item['value'].length <= 64
    && /^\d+(?:\.\d+)?$/.test(item['value']) && Number.isFinite(Number(item['value']))
    && (item['currencyToken'] === undefined || typeof item['currencyToken'] === 'string' && item['currencyToken'].length <= 16)
    && (item['assumptions'] === undefined || assumptions(item)))) return undefined;
  if (!raw['dates'].every((item: unknown) => record(item) && span(item) && day(item['isoDate'])
    && item['day'] === Number(item['isoDate'].slice(8, 10))
    && item['month'] === Number(item['isoDate'].slice(5, 7))
    && item['yearBe'] === Number(item['isoDate'].slice(0, 4)) + 543
    && assumptions(item))) return undefined;
  if (Array.isArray(raw['periods']) && !raw['periods'].every((item: unknown) => record(item) && span(item)
    && (LINE_AI_PERIOD_KINDS as readonly unknown[]).includes(item['kind'])
    && day(item['fromDate']) && day(item['toDate']) && item['fromDate'] <= item['toDate']
    && (item['monthKey'] === undefined || item['kind'] === 'month' && item['monthKey'] === item['fromDate'].slice(0, 7))
    && ['relative', 'explicit', 'named_month'].includes(String(item['source']))
    && typeof item['label'] === 'string' && item['label'].length <= 200 && assumptions(item))) return undefined;
  return value as LineAiValueCandidates;
}

/** Assumption/ambiguity markers carried on candidates. Ambiguity markers make a candidate
 *  unusable for auto-capture (guards force discovery); the others are audit/display notes. */
export const VALUE_ASSUMPTIONS = {
  /** Year ≥ 2400 read as พ.ศ. (deterministic; recorded for the audit trail). */
  eraReadBe: 'era_read_be',
  /** Year implausible as พ.ศ. (e.g. 1994 → ค.ศ. 1451) resolved to ค.ศ. */
  eraResolvedCe: 'era_resolved_ce',
  /** Both parts ≤ 12; canonical วัน/เดือน order applied. */
  orderAssumedDayMonth: 'order_assumed_day_month',
  /** Two-digit year – materially different era readings survive → discovery required. */
  ambiguousTwoDigitYear: 'ambiguous_two_digit_year',
  /** A Thai month name/abbreviation anchors a two-digit year to พ.ศ. 25xx. */
  twoDigitYearResolvedThaiMonth: 'two_digit_year_resolved_thai_month',
  /** An English month name/abbreviation anchors a two-digit year to ค.ศ. 20xx. */
  twoDigitYearResolvedEnglishMonth: 'two_digit_year_resolved_english_month',
  /** A fully numeric date whose two-digit year has exactly one era reading a receipt could carry. */
  twoDigitYearResolvedPlausibleEra: 'two_digit_year_resolved_plausible_era',
  /** Month-year mention without a day; candidate is a period boundary, not a day date. */
  monthPeriodBoundary: 'month_period_boundary',
  /** Candidate is after the injected today – implausible for e.g. an expense date. */
  futureDate: 'future_date',
  /** Currency-like token not in the known list (e.g. "$b"). */
  unknownCurrencyToken: 'unknown_currency_token',
} as const;

const AMBIGUITY_MARKERS: ReadonlySet<string> = new Set([
  VALUE_ASSUMPTIONS.ambiguousTwoDigitYear,
]);

/** Markers that mean the reader INFERRED part of this date rather than reading it off the page:
 *  the วัน/เดือน order, and which era a two-digit year belongs to (spec §5.2). A date carrying one
 *  is usable and stays on the record — but every surface that shows it must say it was read, not
 *  stated, or the receipt mode would simply have replaced one confident wrong answer with another. */
const ASSUMED_READING_MARKERS: ReadonlySet<string> = new Set([
  VALUE_ASSUMPTIONS.orderAssumedDayMonth,
  VALUE_ASSUMPTIONS.twoDigitYearResolvedPlausibleEra,
]);

export function isAssumedDateReading(assumptions: readonly string[] | undefined): boolean {
  return (assumptions ?? []).some((assumption) => ASSUMED_READING_MARKERS.has(assumption));
}

/**
 * What the stored document date on an expense actually is (spec §5.2). The column is NOT NULL, so
 * "there is a value" says nothing — these four say everything a reader needs:
 *   `verified`    the page stated it plainly;
 *   `assumed`     read off the page, but the reader chose the วัน/เดือน order or the era;
 *   `unverified`  never read — the value is the upload-day placeholder;
 *   `implausible` read, but too far from today to be this receipt.
 * Only `unverified` and `implausible` mean review; `assumed` is a label, not a problem.
 */
export const EXPENSE_DOCUMENT_DATE_STATUSES = ['verified', 'assumed', 'unverified', 'implausible'] as const;
export type ExpenseDocumentDateStatus = (typeof EXPENSE_DOCUMENT_DATE_STATUSES)[number];

/**
 * Read the status off a stored `aiVerificationSummaryJson`. Shared by the API list mapper and every
 * web surface so they can never disagree about what a date is. Capture paths write `dateStatus`;
 * `missingFields` is the fallback for rows written before §5.2, and a row with neither is a legacy
 * draft nobody can say anything about — it reads `verified`, exactly as it did before.
 */
export function expenseDocumentDateStatus(
  summary: Record<string, unknown> | null | undefined,
): ExpenseDocumentDateStatus {
  const stored = summary?.['dateStatus'];
  if (typeof stored === 'string' && (EXPENSE_DOCUMENT_DATE_STATUSES as readonly string[]).includes(stored)) {
    return stored as ExpenseDocumentDateStatus;
  }
  const missing = summary?.['missingFields'];
  return Array.isArray(missing) && missing.some((value) => value === 'expenseDate') ? 'unverified' : 'verified';
}

/** True when the date on the record came off the document — assumed counts, a placeholder does not. */
export function expenseDateIsReadable(summary: Record<string, unknown> | null | undefined): boolean {
  const status = expenseDocumentDateStatus(summary);
  return status === 'verified' || status === 'assumed';
}

/** True when the candidate needs discovery before any auto-capture use. */
export function isAmbiguousDateCandidate(candidate: LineAiDateCandidate): boolean {
  return candidate.assumptions.some((a) => AMBIGUITY_MARKERS.has(a));
}

/** True when the period reading is one of several materially different ones (an era nobody can pin
 *  down). Same markers as a date: such a period must never back a tool input on its own. */
export function isAmbiguousPeriodCandidate(candidate: Pick<LineAiPeriodCandidate, 'assumptions'>): boolean {
  return candidate.assumptions.some((a) => AMBIGUITY_MARKERS.has(a));
}

export const THAI_MONTH_ABBREVIATIONS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'] as const;

/** Canonical display convention: วัน เดือน(ไทยย่อ) ปี พ.ศ., e.g. "9 ธ.ค. 2537". */
export function formatThaiDate(candidate: Pick<LineAiDateCandidate, 'day' | 'month' | 'yearBe'>): string {
  return `${candidate.day} ${THAI_MONTH_ABBREVIATIONS[candidate.month - 1]} ${candidate.yearBe}`;
}

// ── Calendars ─────────────────────────────────────────────────────────────────

const BE_CE_OFFSET = 543;

/** Validates the CE calendar date and returns ISO YYYY-MM-DD, or null when invalid (e.g. 31 ก.พ.). */
export function toIsoDate(day: number, month: number, yearCe: number): string | null {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(yearCe)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(yearCe, month - 1, day));
  if (date.getUTCFullYear() !== yearCe || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

// ── Thai and English number words ────────────────────────────────────────────

const THAI_DIGIT_BASE = '๐'.charCodeAt(0);

/** Maps ๐-๙ to 0-9 one-to-one so spans keep their original indices. */
export function mapThaiDigits(text: string): string {
  return text.replace(/[๐-๙]/g, (ch) => String(ch.charCodeAt(0) - THAI_DIGIT_BASE));
}

type WordToken = { kind: 'unit'; value: number } | { kind: 'multiplier'; value: number };

// Longest-first so the scanner never splits a longer word into a shorter one.
const THAI_NUMBER_TOKENS: Array<[string, WordToken]> = [
  ['ล้าน', { kind: 'multiplier', value: 1_000_000 }],
  ['แสน', { kind: 'multiplier', value: 100_000 }],
  ['หมื่น', { kind: 'multiplier', value: 10_000 }],
  ['พัน', { kind: 'multiplier', value: 1_000 }],
  ['ร้อย', { kind: 'multiplier', value: 100 }],
  ['สิบ', { kind: 'multiplier', value: 10 }],
  ['ศูนย์', { kind: 'unit', value: 0 }],
  ['หนึ่ง', { kind: 'unit', value: 1 }],
  ['เอ็ด', { kind: 'unit', value: 1 }],
  ['สอง', { kind: 'unit', value: 2 }],
  ['ยี่', { kind: 'unit', value: 2 }],
  ['สาม', { kind: 'unit', value: 3 }],
  ['สี่', { kind: 'unit', value: 4 }],
  ['ห้า', { kind: 'unit', value: 5 }],
  ['หก', { kind: 'unit', value: 6 }],
  ['เจ็ด', { kind: 'unit', value: 7 }],
  ['แปด', { kind: 'unit', value: 8 }],
  ['เก้า', { kind: 'unit', value: 9 }],
];

const ENGLISH_NUMBER_WORDS: Record<string, WordToken> = {
  zero: { kind: 'unit', value: 0 },
  one: { kind: 'unit', value: 1 },
  two: { kind: 'unit', value: 2 },
  three: { kind: 'unit', value: 3 },
  four: { kind: 'unit', value: 4 },
  five: { kind: 'unit', value: 5 },
  six: { kind: 'unit', value: 6 },
  seven: { kind: 'unit', value: 7 },
  eight: { kind: 'unit', value: 8 },
  nine: { kind: 'unit', value: 9 },
  ten: { kind: 'unit', value: 10 },
  eleven: { kind: 'unit', value: 11 },
  twelve: { kind: 'unit', value: 12 },
  thirteen: { kind: 'unit', value: 13 },
  fourteen: { kind: 'unit', value: 14 },
  fifteen: { kind: 'unit', value: 15 },
  sixteen: { kind: 'unit', value: 16 },
  seventeen: { kind: 'unit', value: 17 },
  eighteen: { kind: 'unit', value: 18 },
  nineteen: { kind: 'unit', value: 19 },
  twenty: { kind: 'unit', value: 20 },
  thirty: { kind: 'unit', value: 30 },
  forty: { kind: 'unit', value: 40 },
  fifty: { kind: 'unit', value: 50 },
  sixty: { kind: 'unit', value: 60 },
  seventy: { kind: 'unit', value: 70 },
  eighty: { kind: 'unit', value: 80 },
  ninety: { kind: 'unit', value: 90 },
  hundred: { kind: 'multiplier', value: 100 },
  thousand: { kind: 'multiplier', value: 1_000 },
  million: { kind: 'multiplier', value: 1_000_000 },
};

/** Standard Thai/English composed-number evaluation: units accumulate into a pending
 *  figure, a multiplier scales it (implied 1 when bare, as in ร้อยยี่สิบ = 120). */
function evaluateWordTokens(tokens: WordToken[]): number | null {
  let total = 0;
  let pending = 0;
  let sawAny = false;
  for (const token of tokens) {
    sawAny = true;
    if (token.kind === 'unit') {
      pending += token.value;
      continue;
    }
    const figure = pending === 0 ? 1 : pending;
    if (token.value >= 1_000_000) {
      total = (total + figure) * token.value;
    } else {
      total += figure * token.value;
    }
    pending = 0;
  }
  if (!sawAny) return null;
  return total + pending;
}

// ── Currency tokens ──────────────────────────────────────────────────────────

const KNOWN_CURRENCY_TOKENS = ['บาท', 'บ.', '฿', 'thb', 'baht', 'สตางค์'];
// Currency-like but unrecognized: a $/currency-sign cluster such as "$b" or "usd$".
const UNKNOWN_CURRENCY_PATTERN = /^[a-z]{0,3}\$[a-z]{0,3}/;

function matchCurrencyToken(text: string, index: number): { token: string; known: boolean } | null {
  let at = index;
  if (text[at] === ' ') at += 1;
  const rest = text.slice(at, at + 12);
  for (const token of KNOWN_CURRENCY_TOKENS) {
    if (rest.startsWith(token)) return { token, known: true };
  }
  const unknown = rest.match(UNKNOWN_CURRENCY_PATTERN);
  if (unknown && unknown[0].includes('$')) return { token: unknown[0], known: false };
  return null;
}

// ── Month names ──────────────────────────────────────────────────────────────

const THAI_MONTHS: Array<[string, number]> = [
  ['มกราคม', 1], ['กุมภาพันธ์', 2], ['มีนาคม', 3], ['เมษายน', 4], ['พฤษภาคม', 5], ['มิถุนายน', 6],
  ['กรกฎาคม', 7], ['กรกฏาคม', 7], ['สิงหาคม', 8], ['กันยายน', 9], ['ตุลาคม', 10], ['พฤศจิกายน', 11], ['ธันวาคม', 12],
  ['ม.ค.', 1], ['ก.พ.', 2], ['มี.ค.', 3], ['เม.ย.', 4], ['พ.ค.', 5], ['มิ.ย.', 6],
  ['ก.ค.', 7], ['ส.ค.', 8], ['ก.ย.', 9], ['ต.ค.', 10], ['พ.ย.', 11], ['ธ.ค.', 12],
  // OCR commonly drops abbreviation punctuation; CLDR lenient parsing permits both forms.
  ['มค', 1], ['กพ', 2], ['มีค', 3], ['เมย', 4], ['พค', 5], ['มิย', 6],
  ['กค', 7], ['สค', 8], ['กย', 9], ['ตค', 10], ['พย', 11], ['ธค', 12],
];

const ENGLISH_MONTHS: Array<[string, number]> = [
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
  ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12],
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['jun', 6], ['jul', 7], ['aug', 8],
  ['sep', 9], ['oct', 10], ['nov', 11], ['dec', 12],
  ['jan.', 1], ['feb.', 2], ['mar.', 3], ['apr.', 4], ['may.', 5], ['jun.', 6],
  ['jul.', 7], ['aug.', 8], ['sep.', 9], ['oct.', 10], ['nov.', 11], ['dec.', 12],
];

const MONTH_NAME_ALTERNATION = [...THAI_MONTHS, ...ENGLISH_MONTHS]
  .map(([name]) => name.replace(/\./g, '\\.'))
  .sort((a, b) => b.length - a.length)
  .join('|');

function monthFromName(name: string): number | null {
  const lowered = name.toLowerCase();
  for (const [candidate, month] of [...THAI_MONTHS, ...ENGLISH_MONTHS]) {
    if (candidate === lowered) return month;
  }
  return null;
}

const THAI_MONTH_NAMES = new Set(THAI_MONTHS.map(([name]) => name));

// ── Year / era resolution (spec §7 rules, in order) ──────────────────────────

type YearReading = { yearBe: number; yearCe: number; assumptions: string[] };

/** 4-digit years resolve deterministically-with-record; 2-digit years stay ambiguous
 *  (พ.ศ. 25xx vs ค.ศ. 20xx are materially different readings → discovery, never a guess). */
function resolveYearReadings(rawYear: number, digits: number): YearReading[] {
  if (digits === 4) {
    if (rawYear >= 2400 && rawYear <= 2700) {
      return [{ yearBe: rawYear, yearCe: rawYear - BE_CE_OFFSET, assumptions: [VALUE_ASSUMPTIONS.eraReadBe] }];
    }
    if (rawYear >= 1900 && rawYear < 2400) {
      return [{ yearBe: rawYear + BE_CE_OFFSET, yearCe: rawYear, assumptions: [VALUE_ASSUMPTIONS.eraResolvedCe] }];
    }
    return [];
  }
  if (digits === 2) {
    const be = 2500 + rawYear;
    const ce = 2000 + rawYear;
    return [
      { yearBe: be, yearCe: be - BE_CE_OFFSET, assumptions: [VALUE_ASSUMPTIONS.ambiguousTwoDigitYear] },
      { yearBe: ce + BE_CE_OFFSET, yearCe: ce, assumptions: [VALUE_ASSUMPTIONS.ambiguousTwoDigitYear] },
    ];
  }
  return [];
}

/** A receipt is evidence of something that already happened, and that alone separates the two era
 *  readings of a two-digit year: "69" is พ.ศ. 2569 (2026) because ค.ศ. 2069 is decades away, while
 *  "24" is ค.ศ. 2024 because พ.ศ. 2524 is 1981. The window is deliberately loose — it only has to
 *  tell those apart, never to judge a date as too old. When it does not leave exactly one reading,
 *  both survive and the date stays ambiguous, which is the answer for a date nobody can pin down. */
const PLAUSIBLE_EXPENSE_YEARS_BACK = 15;

/** `nearestWins` is the receipt rule (spec §5.2): a printed document always carries ONE date, so a
 *  window that leaves two readings picks the one nearest today rather than giving up — the
 *  `twoDigitYearResolvedPlausibleEra` flag still says the era was resolved, not read. Chat text
 *  keeps the 2026-08-28 decision: two surviving readings stay ambiguous and the person is asked. */
function plausibleEraReadings(readings: YearReading[], todayIso: string, nearestWins = false): YearReading[] {
  if (readings.length <= 1) return readings;
  const todayYear = Number(todayIso.slice(0, 4));
  if (!Number.isFinite(todayYear)) return readings;
  const plausible = readings.filter((r) => r.yearCe <= todayYear && r.yearCe >= todayYear - PLAUSIBLE_EXPENSE_YEARS_BACK);
  if (plausible.length === 1) return [{ ...plausible[0]!, assumptions: [VALUE_ASSUMPTIONS.twoDigitYearResolvedPlausibleEra] }];
  if (!nearestWins) return readings;
  const nearest = [...readings].sort((a, b) => Math.abs(a.yearCe - todayYear) - Math.abs(b.yearCe - todayYear))[0]!;
  return [{ ...nearest, assumptions: [VALUE_ASSUMPTIONS.twoDigitYearResolvedPlausibleEra] }];
}

function resolveNamedMonthYearReadings(monthName: string, rawYear: number, digits: number): YearReading[] {
  if (digits !== 2) return resolveYearReadings(rawYear, digits);
  if (THAI_MONTH_NAMES.has(monthName.toLowerCase())) {
    const yearBe = 2500 + rawYear;
    return [{
      yearBe,
      yearCe: yearBe - BE_CE_OFFSET,
      assumptions: [VALUE_ASSUMPTIONS.twoDigitYearResolvedThaiMonth],
    }];
  }
  const yearCe = 2000 + rawYear;
  return [{
    yearBe: yearCe + BE_CE_OFFSET,
    yearCe,
    assumptions: [VALUE_ASSUMPTIONS.twoDigitYearResolvedEnglishMonth],
  }];
}

// ── Extraction ────────────────────────────────────────────────────────────────

const MAX_AMOUNT_CANDIDATES = 20;
const MAX_DATE_CANDIDATES = 12;

// Word-form days 1–31 for labeled dates. Compounds MUST precede their prefixes in the
// alternation (สามสิบ before สาม) or the regex stops at the shorter reading.
const THAI_DAY_WORD_ALTERNATION = [
  'ยี่สิบ(?:เอ็ด|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?',
  'สามสิบ(?:เอ็ด)?',
  'สิบ(?:เอ็ด|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า)?',
  'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า',
].join('|');

type SpanRange = { start: number; end: number };

function overlaps(ranges: SpanRange[], start: number, end: number): boolean {
  return ranges.some((r) => start < r.end && end > r.start);
}

/** Which kind of text this is. `chat` (the default) is what a person typed: an order or era it
 *  cannot tell apart stays ambiguous and the person is asked (owner decision 2026-08-28). `receipt`
 *  is text printed on a document nobody can be asked about, where Thai practice is DD/MM and the
 *  date is necessarily in the past — so those two readings resolve, flagged as assumed. */
export type LineAiDocumentContext = 'receipt' | 'chat';

/** Extracts amount and date candidates from one LINE turn text. `todayIso` (Asia/Bangkok)
 *  is injected so future dates can be flagged; extraction itself never reads the clock. */
export function extractValueCandidates(
  text: string,
  todayIso?: string,
  options: { documentContext?: LineAiDocumentContext } = {},
): LineAiValueCandidates {
  const receiptMode = options.documentContext === 'receipt';
  const mapped = mapThaiDigits(text);
  const dateRanges: SpanRange[] = [];
  const dates: LineAiDateCandidate[] = [];
  const amounts: LineAiAmountCandidate[] = [];

  const pushDate = (
    start: number,
    end: number,
    day: number,
    month: number,
    reading: YearReading,
    extraAssumptions: string[],
  ): void => {
    const isoDate = toIsoDate(day, month, reading.yearCe);
    if (!isoDate) return;
    const assumptions = [...extraAssumptions, ...reading.assumptions];
    if (todayIso && isoDate > todayIso) assumptions.push(VALUE_ASSUMPTIONS.futureDate);
    const span = text.slice(start, end);
    if (dates.some((d) => d.isoDate === isoDate && d.span === span)) return;
    dates.push({ span, day, month, yearBe: reading.yearBe, isoDate, assumptions });
  };

  const recordDateRange = (start: number, end: number): void => {
    dateRanges.push({ start, end });
  };

  // 1) Labeled slots: วันที่ <day> [เดือน <month>] [ปี <year>] — labels lock the reading.
  //    Day may be digits or a Thai number word (e.g. "วันที่เก้า เดือน11ปี2537").
  const labeledPattern = new RegExp(
    `วันที่\\s*(\\d{1,2}|${THAI_DAY_WORD_ALTERNATION})` +
    `\\s*(?:เดือน\\s*(\\d{1,2}|${MONTH_NAME_ALTERNATION})|\\s(${MONTH_NAME_ALTERNATION}))` +
    `\\s*(?:ปี)?\\s*(\\d{2,4})`,
    'giu',
  );
  for (const match of mapped.matchAll(labeledPattern)) {
    const start = match.index;
    const end = start + match[0].length;
    const dayRaw = match[1];
    const day = /^\d+$/.test(dayRaw) ? Number(dayRaw) : evaluateWordTokens(scanThaiWordTokens(dayRaw, 0)?.tokens ?? []) ?? -1;
    const monthRaw = match[2] ?? match[3] ?? '';
    const month = /^\d+$/.test(monthRaw) ? Number(monthRaw) : monthFromName(monthRaw) ?? -1;
    const yearRaw = match[4];
    if (day < 1 || month < 1) continue;
    const readings = /^\d+$/.test(monthRaw)
      ? resolveYearReadings(Number(yearRaw), yearRaw.length === 2 ? 2 : 4)
      : resolveNamedMonthYearReadings(monthRaw, Number(yearRaw), yearRaw.length === 2 ? 2 : 4);
    for (const reading of readings) {
      pushDate(start, end, day, month, reading, []);
    }
    recordDateRange(start, end);
  }

  // 2) Month-first named dates: Aug 23 26 / Aug. 23, '26 / สค 23 69.
  //    Run before month-year periods so "Aug 23 26" cannot be truncated to period "Aug 23".
  const monthFirstPattern = new RegExp(
    `(${MONTH_NAME_ALTERNATION})\\s*(\\d{1,2})(?:st|nd|rd|th)?` +
    `(?:\\s*[,/\\-.]\\s*|\\s+)(?:ปี\\s*)?['’]?(\\d{2,4})`,
    'giu',
  );
  for (const match of mapped.matchAll(monthFirstPattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(dateRanges, start, end)) continue;
    const month = monthFromName(match[1]);
    if (!month) continue;
    const day = Number(match[2]);
    const yearRaw = match[3];
    const readings = resolveNamedMonthYearReadings(match[1], Number(yearRaw), yearRaw.length === 2 ? 2 : 4);
    for (const reading of readings) pushDate(start, end, day, month, reading, []);
    recordDateRange(start, end);
  }

  // 3) Day-first month-name dates and month-year periods (no day).
  const monthNamePattern = new RegExp(`(\\d{1,2})?(?:st|nd|rd|th)?\\s*(${MONTH_NAME_ALTERNATION})\\s*(?:ปี\\s*)?['’]?(\\d{2,4})`, 'giu');
  for (const match of mapped.matchAll(monthNamePattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(dateRanges, start, end)) continue;
    const month = monthFromName(match[2]);
    if (!month) continue;
    const yearRaw = match[3];
    const readings = resolveNamedMonthYearReadings(match[2], Number(yearRaw), yearRaw.length === 2 ? 2 : 4);
    if (match[1]) {
      const day = Number(match[1]);
      for (const reading of readings) pushDate(start, end, day, month, reading, []);
    } else {
      // Month-year period: emit first/last day boundaries for period tools; guards must
      // never accept these as a day-level expense date.
      for (const reading of readings) {
        pushDate(start, end, 1, month, reading, [VALUE_ASSUMPTIONS.monthPeriodBoundary]);
        const lastDay = new Date(Date.UTC(reading.yearCe, month, 0)).getUTCDate();
        pushDate(start, end, lastDay, month, reading, [VALUE_ASSUMPTIONS.monthPeriodBoundary]);
      }
    }
    recordDateRange(start, end);
  }

  // 4) ISO form YYYY-MM-DD (also catches BE-written ISO like 2537-12-09).
  for (const match of mapped.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(dateRanges, start, end)) continue;
    const day = Number(match[3]);
    const month = Number(match[2]);
    for (const reading of resolveYearReadings(Number(match[1]), 4)) {
      pushDate(start, end, day, month, reading, []);
    }
    recordDateRange(start, end);
  }

  // 5) Separator dates D/M/Y (canonical order default; day > 12 locks; 2-digit year → discovery).
  for (const match of mapped.matchAll(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(dateRanges, start, end)) continue;
    const first = Number(match[1]);
    const second = Number(match[2]);
    const yearRaw = match[3];
    if (yearRaw.length === 3) continue;
    let day: number;
    let month: number;
    const orderAssumptions: string[] = [];
    if (first > 12 && second <= 12) {
      day = first; month = second; // day > 12 locks D/M
    } else if (second > 12 && first <= 12) {
      day = second; month = first; // month cannot exceed 12 → the other part is the day
    } else if (first <= 12 && second <= 12) {
      day = first; month = second; // canonical วัน/เดือน default
      if (first !== second) orderAssumptions.push(VALUE_ASSUMPTIONS.orderAssumedDayMonth);
    } else {
      continue;
    }
    const yearReadings = resolveYearReadings(Number(yearRaw), yearRaw.length === 2 ? 2 : 4);
    // Only when the วัน/เดือน order is already certain. A date whose own order cannot be told apart
    // (7-6-69) stays out of reach on purpose — owner decision 2026-08-28: leave it blank and let the
    // person who was there type it, rather than pick one of two readings and look confident.
    // A RECEIPT has nobody to ask, and Thai receipts print DD/MM: the order above already applied
    // that convention with `orderAssumedDayMonth`, so refusing the era on top of it only threw the
    // whole printed date away (UAT 2026-09-03: a bill printing 03/09/69 recorded no date at all).
    const eraResolved = todayIso && (receiptMode || orderAssumptions.length === 0)
      ? plausibleEraReadings(yearReadings, todayIso, receiptMode)
      : yearReadings;
    for (const reading of eraResolved) {
      pushDate(start, end, day, month, reading, orderAssumptions);
    }
    recordDateRange(start, end);
  }

  // 6) Digit amounts (Thai digits already mapped). Tokens inside date spans are excluded so
  //    a year like 2537 can never legitimize an amount of 2537.
  for (const match of mapped.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(dateRanges, start, end)) continue;
    const value = Number.parseFloat(match[0].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    pushAmount(amounts, text, mapped, start, end, value);
  }

  // 7) Thai number words (no word boundaries in Thai – substring scan, longest token first).
  let cursor = 0;
  while (cursor < text.length) {
    const scanned = scanThaiWordTokens(text, cursor);
    if (!scanned) {
      cursor += 1;
      continue;
    }
    const value = evaluateWordTokens(scanned.tokens);
    if (value !== null && value > 0) {
      pushAmount(amounts, text, mapped, cursor, scanned.end, value);
    }
    cursor = scanned.end;
  }

  // 8) English number words (word-boundary based).
  const englishWordPattern = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(?:[\s-](?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million))*\b/gi;
  for (const match of text.matchAll(englishWordPattern)) {
    const tokens = match[0].toLowerCase().split(/[\s-]+/).map((w) => ENGLISH_NUMBER_WORDS[w]).filter((t): t is WordToken => !!t);
    const value = evaluateWordTokens(tokens);
    if (value !== null && value > 0) {
      pushAmount(amounts, text, mapped, match.index, match.index + match[0].length, value);
    }
  }

  // 9) Periods (spec §3.1). Computed HERE so every producer of value candidates gets them for free.
  //    A period is meaningless without a clock, so a caller that injects no `todayIso` gets none, and
  //    a turn that names no period carries no `periods` key at all — existing payloads are unchanged.
  const periods = todayIso ? resolvePeriodCandidates(text, todayIso, dates) : [];

  return {
    amounts: amounts.slice(0, MAX_AMOUNT_CANDIDATES),
    dates: dates.slice(0, MAX_DATE_CANDIDATES),
    ...(periods.length > 0 ? { periods } : {}),
  };
}

function scanThaiWordTokens(text: string, from: number): { tokens: WordToken[]; end: number } | null {
  let at = from;
  const tokens: WordToken[] = [];
  while (at < text.length) {
    const hit = THAI_NUMBER_TOKENS.find(([word]) => text.startsWith(word, at));
    if (!hit) break;
    tokens.push(hit[1]);
    at += hit[0].length;
  }
  return tokens.length > 0 ? { tokens, end: at } : null;
}

function pushAmount(into: LineAiAmountCandidate[], text: string, mapped: string, start: number, end: number, value: number): void {
  const span = text.slice(start, end);
  const currency = matchCurrencyToken(mapped, end);
  const assumptions: string[] = [];
  if (currency && !currency.known) assumptions.push(VALUE_ASSUMPTIONS.unknownCurrencyToken);
  const candidate: LineAiAmountCandidate = {
    span,
    value: String(value),
    ...(currency ? { currencyToken: currency.token } : {}),
    ...(assumptions.length > 0 ? { assumptions } : {}),
  };
  if (into.some((a) => a.value === candidate.value && a.span === candidate.span)) return;
  into.push(candidate);
}

// ── Period resolution (period-resolution spec §3.1) ──────────────────────────
//
// Owner decision 2026-09-18: the default period is the CURRENT MONTH, and when the user states a
// period — explicit dates, a month name, or a relative word — the answer must follow that period and
// say which one it used. The calendar is therefore resolved HERE, by code, from the text plus the
// injected `todayIso`; the model only selects one of the candidates below (ADR 0011). Nothing in this
// section reads the clock, and a future period deliberately yields NO candidate: there is no data.

/** Period-level assumption markers. The ambiguity markers from `VALUE_ASSUMPTIONS` are reused as-is,
 *  so an unpinnable era disables a period exactly as it disables a date. */
export const PERIOD_ASSUMPTIONS = {
  /** A week is Monday–Sunday in Asia/Bangkok (there is no other week in this product). */
  weekMondaySunday: 'week_monday_sunday',
  /** A four-digit year ≥ 2400 read as พ.ศ. */
  yearReadBe: 'year_read_be',
  /** "วันก่อน" is ambiguous in Thai ("the other day"); read as yesterday and recorded as such. */
  dayBeforeReadAsYesterday: 'day_before_read_as_yesterday',
  /** A current period (this week/month/quarter/year) ends TODAY, not on its calendar last day —
   *  the same window every period-scoped tool defaults to, so no answer asks for future data. */
  clampedToToday: 'period_clamped_to_today',
  /** "7 วันล่าสุด" counts today as one of the N days. */
  lastNDaysIncludeToday: 'last_n_days_include_today',
  /** A month name, quarter or range written with no year: the most recent occurrence not in the future. */
  yearAssumedLatest: 'year_assumed_latest_past',
  /** A uniquely identifiable full Thai month name had one mistyped Unicode character. */
  monthNameTypoCorrected: 'month_name_typo_corrected',
} as const;

const MS_PER_CIVIL_DAY = 86_400_000;
const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_PERIOD_CANDIDATES = 8;
const MAX_RELATIVE_DAYS = 366;
const MAX_RELATIVE_MONTHS = 24;
const MAX_RELATIVE_WEEKS = 52;

/** Civil-date arithmetic in UTC on purpose: UTC has no DST, so one day is always 86_400_000 ms. */
function civilMs(iso: string): number | null {
  const parts = CIVIL_DATE_PATTERN.exec(iso);
  if (!parts) return null;
  const ms = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return Number.isFinite(ms) ? ms : null;
}
function isoOfMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function shiftDays(iso: string, days: number): string {
  const ms = civilMs(iso);
  return ms === null ? iso : isoOfMs(ms + days * MS_PER_CIVIL_DAY);
}
function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
function lastDayOfMonth(yearCe: number, month: number): number {
  return new Date(Date.UTC(yearCe, month, 0)).getUTCDate();
}
function monthBounds(yearCe: number, month: number): { fromDate: string; toDate: string } {
  return {
    fromDate: `${String(yearCe).padStart(4, '0')}-${pad2(month)}-01`,
    toDate: `${String(yearCe).padStart(4, '0')}-${pad2(month)}-${pad2(lastDayOfMonth(yearCe, month))}`,
  };
}
/** Monday of the ISO week containing `iso` (spec §3.1: week = Monday–Sunday, Bangkok). */
function mondayOf(iso: string): string {
  const ms = civilMs(iso);
  if (ms === null) return iso;
  const back = (new Date(ms).getUTCDay() + 6) % 7;
  return isoOfMs(ms - back * MS_PER_CIVIL_DAY);
}

/**
 * Thai date-range phrase for an answer, e.g. `17 ก.ย. 2569`, `1–31 ส.ค. 2569`,
 * `25 ส.ค. – 5 ก.ย. 2569`, `1 ม.ค. 2568 – 31 ธ.ค. 2568`. Years are พ.ศ. (the channel convention,
 * ADR 0011); an unparseable bound falls back to the raw ISO strings rather than inventing a day.
 */
export function formatThaiPeriodRange(fromDate: string, toDate: string): string {
  const from = CIVIL_DATE_PATTERN.exec(fromDate);
  const to = CIVIL_DATE_PATTERN.exec(toDate);
  if (!from || !to) return fromDate === toDate ? fromDate : `${fromDate} – ${toDate}`;
  const [fromYear, fromMonth, fromDay] = [Number(from[1]) + BE_CE_OFFSET, Number(from[2]), Number(from[3])];
  const [toYear, toMonth, toDay] = [Number(to[1]) + BE_CE_OFFSET, Number(to[2]), Number(to[3])];
  const fromAbbr = THAI_MONTH_ABBREVIATIONS[fromMonth - 1];
  const toAbbr = THAI_MONTH_ABBREVIATIONS[toMonth - 1];
  if (fromDate === toDate) return `${fromDay} ${fromAbbr} ${fromYear}`;
  if (fromYear === toYear && fromMonth === toMonth) return `${fromDay}–${toDay} ${toAbbr} ${toYear}`;
  if (fromYear === toYear) return `${fromDay} ${fromAbbr} – ${toDay} ${toAbbr} ${toYear}`;
  return `${fromDay} ${fromAbbr} ${fromYear} – ${toDay} ${toAbbr} ${toYear}`;
}

/** What one matched span resolved to, before clamping/labelling. */
type PeriodReading = {
  kind: LineAiPeriodKind;
  fromDate: string;
  toDate: string;
  /** Thai word/phrase the user used ('' for a named month or an explicit range, whose label IS the range). */
  word: string;
  source: LineAiPeriodCandidate['source'];
  assumptions: string[];
  monthKey?: string;
};

/**
 * Month names usable as a PERIOD. Deliberately NOT the punctuation-dropped OCR abbreviations from
 * `THAI_MONTHS` (มค/กพ/มีค/…): Thai has no word spaces, so `มีค` is a substring of the extremely
 * common `มีค่าใช้จ่าย` and every such question would have produced a spurious March period. Those
 * forms exist for receipt text, which never reaches this resolver.
 */
const PERIOD_MONTH_NAMES: Array<[string, number]> = [
  ...THAI_MONTHS.filter(([name]) => name.includes('.') || name.length > 4),
  ...ENGLISH_MONTHS,
];
// Punctuation-free Thai abbreviations are allowed only after เดือน or at a token boundary. The
// generic month-name regex must not see them: มีค inside มีค่าใช้จ่าย is not March.
const PERIOD_SHORT_MONTH_NAMES = THAI_MONTHS.filter(([name]) => !name.includes('.') && name.length <= 3);
const PERIOD_SHORT_MONTH_ALTERNATION = PERIOD_SHORT_MONTH_NAMES.map(([name]) => name).sort((a, b) => b.length - a.length).join('|');
const PERIOD_MONTH_ALTERNATION = PERIOD_MONTH_NAMES
  .map(([name]) => name.replace(/\./g, '\\.'))
  .sort((a, b) => b.length - a.length)
  .join('|');
/** `may` is also an ordinary English word, so it names a month only when a year follows it. */
const PERIOD_MONTH_ALTERNATION_NO_YEAR = PERIOD_MONTH_NAMES
  .filter(([name]) => name !== 'may' && name !== 'may.')
  .map(([name]) => name.replace(/\./g, '\\.'))
  .sort((a, b) => b.length - a.length)
  .join('|');

function periodMonthFromName(name: string): number | null {
  const lowered = name.toLowerCase();
  for (const [candidate, month] of [...PERIOD_MONTH_NAMES, ...PERIOD_SHORT_MONTH_NAMES]) if (candidate === lowered) return month;
  return null;
}

// ponytail: one edit on a full month name only; short aliases and uncertain matches need clarification.
const FULL_THAI_MONTH_NAMES = THAI_MONTHS.filter(([name]) => name.length > 4 && !name.includes('.'));
function oneEditApart(left: string, right: string): boolean {
  const a = [...left];
  const b = [...right];
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    if (++edits > 1) return false;
    if (a.length >= b.length) i += 1;
    if (a.length <= b.length) j += 1;
  }
  return edits + Number(i < a.length || j < b.length) === 1;
}

function correctedThaiMonthName(token: string): string | null {
  const matches = FULL_THAI_MONTH_NAMES.filter(([name]) => oneEditApart(token, name));
  return new Set(matches.map(([, month]) => month)).size === 1 ? matches[0]![0] : null;
}

/** An explicit `เดือน...` whose month cannot be resolved must never silently use the current month. */
export function unresolvedMonthName(text: string, periods: LineAiPeriodCandidate[]): string | null {
  const coveredAt = (index: number): boolean => periods.some((period) => {
    let start = text.indexOf(period.span);
    while (start >= 0) {
      if (start <= index && index < start + period.span.length) return true;
      start = text.indexOf(period.span, start + 1);
    }
    return false;
  });
  for (const match of text.matchAll(/เดือน\s*([ก-๙]+)/gu)) {
    const token = match[1]!.split('และ', 1)[0]!;
    const before = text.slice(Math.max(0, (match.index ?? 0) - 4), match.index);
    if (/(?:ต้น|กลาง|ปลาย|สิ้น)$/u.test(before)
      || /^(?:นี้|หน้า|ถัดไป|ก่อน|ที่แล้ว|ปัจจุบัน|ละ)/u.test(token) || token.length < 2) continue;
    const tokenStart = (match.index ?? 0) + match[0].indexOf(match[1]!);
    if (!coveredAt(tokenStart)) return token.slice(0, 32);
    let cursor = tokenStart + token.length;
    for (;;) {
      const next = /^\s*และ\s*([ก-๙]+)/u.exec(text.slice(cursor));
      if (!next) break;
      const nextToken = next[1]!.split('และ', 1)[0]!;
      const nextStart = cursor + next[0].indexOf(next[1]!);
      if (!nextToken.startsWith('เดือน') && (
        nextToken.length <= 3 && PERIOD_SHORT_MONTH_NAMES.some(([name]) => name[0] === nextToken[0])
        || nextToken.length > 3 && FULL_THAI_MONTH_NAMES.some(([name]) => name.slice(0, 2) === nextToken.slice(0, 2))
      ) && !coveredAt(nextStart)) return nextToken.slice(0, 32);
      cursor = nextStart + nextToken.length;
    }
  }
  // A separated full month-like word can also be a typo without the word เดือน before it.
  for (const match of text.matchAll(/(?:^|[\s,(]|และ\s*)([ก-๙]{5,14}?)(?=$|\s|และ|[),/.!?]|ปี\s*\d)/gu)) {
    const token = match[1]!;
    const start = (match.index ?? 0) + match[0].lastIndexOf(token);
    if (FULL_THAI_MONTH_NAMES.some(([name]) => name.slice(0, 3) === token.slice(0, 3))
      && !coveredAt(start)) return token;
  }
  return null;
}

/** Fuzzy qualifiers the spec puts OUT of scope: "ต้นเดือน", "ปลายเดือนนี้", "กลางปี", "สิ้นเดือน".
 *  A relative word carrying one of them is not a period this resolver can pin down, so it is skipped
 *  rather than widened to the whole month/year. */
const FUZZY_QUALIFIER = /(?:ต้น|ปลาย|กลาง|สิ้น)$/u;
function fuzzyQualified(text: string, start: number): boolean {
  return FUZZY_QUALIFIER.test(text.slice(Math.max(0, start - 6), start));
}

/** Year readings for a period, plus the `year_read_be` marker the spec names. */
function periodYearReadings(rawYear: number, digits: number): YearReading[] {
  return resolveYearReadings(rawYear, digits).map((reading) => reading.assumptions.includes(VALUE_ASSUMPTIONS.eraReadBe)
    ? { ...reading, assumptions: [...reading.assumptions, PERIOD_ASSUMPTIONS.yearReadBe] }
    : reading);
}

function quarterBounds(yearCe: number, quarter: number): { fromDate: string; toDate: string } {
  const firstMonth = quarter * 3 - 2;
  return { fromDate: monthBounds(yearCe, firstMonth).fromDate, toDate: monthBounds(yearCe, firstMonth + 2).toDate };
}

type PeriodRule = {
  pattern: RegExp;
  /** Thai relative words only: skip a match a fuzzy qualifier precedes. */
  fuzzyGuard?: boolean;
  build: (match: RegExpExecArray | RegExpMatchArray, todayIso: string) => PeriodReading[];
};

const singleDay = (iso: string, word: string, assumptions: string[] = []): PeriodReading[] =>
  [{ kind: 'day', fromDate: iso, toDate: iso, word, source: 'relative', assumptions }];

/** Ordered most-specific first; an earlier rule's span blocks any later overlapping match, exactly
 *  like the date extractor above (so "3 วันก่อน" is never also read as "วันก่อน"). */
const PERIOD_RULES: PeriodRule[] = [
  // ── single days ───────────────────────────────────────────────────────────
  { pattern: /เมื่อวานซืน/gu, build: (_m, today) => singleDay(shiftDays(today, -2), 'เมื่อวานซืน') },
  { pattern: /day\s*before\s*yesterday/gi, build: (_m, today) => singleDay(shiftDays(today, -2), 'เมื่อวานซืน') },
  // ── N last days (before the N-days-ago day rule: "3 วันที่ผ่านมา" is a window, not one day) ──
  {
    pattern: /(\d{1,3})\s*วัน(?:ที่ผ่านมา|ล่าสุด|ย้อนหลัง)/gu,
    build: (m, today) => lastNDays(Number(m[1]), today),
  },
  {
    pattern: /(?:last|past)\s*(\d{1,3})\s*days?/gi,
    build: (m, today) => lastNDays(Number(m[1]), today),
  },
  // ── N days ago (one day) ─────────────────────────────────────────────────
  {
    pattern: /(\d{1,3})\s*วัน(?:ก่อน|ที่แล้ว)/gu,
    build: (m, today) => {
      const n = Number(m[1]);
      return n >= 1 && n <= MAX_RELATIVE_DAYS ? singleDay(shiftDays(today, -n), `${n} วันก่อน`) : [];
    },
  },
  {
    pattern: /(\d{1,3})\s*days?\s*ago/gi,
    build: (m, today) => {
      const n = Number(m[1]);
      return n >= 1 && n <= MAX_RELATIVE_DAYS ? singleDay(shiftDays(today, -n), `${n} วันก่อน`) : [];
    },
  },
  { pattern: /เมื่อวานนี้|เมื่อวาน/gu, build: (_m, today) => singleDay(shiftDays(today, -1), 'เมื่อวาน') },
  { pattern: /yesterday/gi, build: (_m, today) => singleDay(shiftDays(today, -1), 'เมื่อวาน') },
  // Owner list 2026-09-18: "วันก่อน" must be interpreted, and yesterday is the only reading a read
  // can act on — recorded as an assumption so an answer can say it was read, not stated.
  {
    pattern: /วันก่อน/gu,
    build: (_m, today) => singleDay(shiftDays(today, -1), 'วันก่อน', [PERIOD_ASSUMPTIONS.dayBeforeReadAsYesterday]),
  },
  { pattern: /วันนี้/gu, fuzzyGuard: true, build: (_m, today) => singleDay(today, 'วันนี้') },
  { pattern: /\btoday\b/gi, build: (_m, today) => singleDay(today, 'วันนี้') },
  // ── weeks (Monday–Sunday) ────────────────────────────────────────────────
  {
    pattern: /(\d{1,2})\s*(?:สัปดาห์|อาทิตย์)(?:ที่แล้ว|ก่อน)/gu,
    build: (m, today) => weeksAgo(Number(m[1]), today, `${Number(m[1])} สัปดาห์ที่แล้ว`),
  },
  {
    pattern: /(\d{1,2})\s*weeks?\s*ago/gi,
    build: (m, today) => weeksAgo(Number(m[1]), today, `${Number(m[1])} สัปดาห์ที่แล้ว`),
  },
  {
    pattern: /(?:สัปดาห์|อาทิตย์)(?:ที่แล้ว|ก่อน)/gu,
    fuzzyGuard: true,
    build: (_m, today) => weeksAgo(1, today, 'สัปดาห์ที่แล้ว'),
  },
  { pattern: /last\s*week/gi, build: (_m, today) => weeksAgo(1, today, 'สัปดาห์ที่แล้ว') },
  { pattern: /(?:สัปดาห์|อาทิตย์)นี้/gu, fuzzyGuard: true, build: (_m, today) => weeksAgo(0, today, 'สัปดาห์นี้') },
  { pattern: /this\s*week/gi, build: (_m, today) => weeksAgo(0, today, 'สัปดาห์นี้') },
  // ── months ───────────────────────────────────────────────────────────────
  {
    pattern: /(\d{1,2})\s*เดือน(?:ที่แล้ว|ก่อน)/gu,
    build: (m, today) => monthsAgo(Number(m[1]), today, `${Number(m[1])} เดือนที่แล้ว`),
  },
  {
    pattern: /(\d{1,2})\s*months?\s*ago/gi,
    build: (m, today) => monthsAgo(Number(m[1]), today, `${Number(m[1])} เดือนที่แล้ว`),
  },
  { pattern: /เดือน(?:ที่แล้ว|ก่อน)/gu, fuzzyGuard: true, build: (_m, today) => monthsAgo(1, today, 'เดือนที่แล้ว') },
  { pattern: /(?:last|previous)\s*month/gi, build: (_m, today) => monthsAgo(1, today, 'เดือนที่แล้ว') },
  { pattern: /เดือนนี้/gu, fuzzyGuard: true, build: (_m, today) => monthsAgo(0, today, 'เดือนนี้') },
  { pattern: /this\s*month/gi, build: (_m, today) => monthsAgo(0, today, 'เดือนนี้') },
  // ── quarters (calendar, never fiscal) ────────────────────────────────────
  {
    pattern: /(?:ไตรมาส\s*(?:ที่\s*)?|\bq)([1-4])(?:\s*[/\-]\s*|\s*(?:ปี|year)\s*|\s+)?(\d{2,4})?/giu,
    build: (m, today) => namedQuarter(Number(m[1]), m[2], today),
  },
  { pattern: /ไตรมาส(?:ที่แล้ว|ก่อน)/gu, fuzzyGuard: true, build: (_m, today) => quartersAgo(1, today, 'ไตรมาสที่แล้ว') },
  { pattern: /last\s*quarter/gi, build: (_m, today) => quartersAgo(1, today, 'ไตรมาสที่แล้ว') },
  { pattern: /ไตรมาสนี้/gu, fuzzyGuard: true, build: (_m, today) => quartersAgo(0, today, 'ไตรมาสนี้') },
  { pattern: /this\s*quarter/gi, build: (_m, today) => quartersAgo(0, today, 'ไตรมาสนี้') },
  // ── explicit ranges (before named months, so "1–15 ก.ย. 68" is a range, not the whole month) ──
  {
    // 1–15 ก.ย. [68] · ตั้งแต่ 1 ถึง 15 กันยายน [2568] · from 1 to 15 Sep [2025]
    pattern: new RegExp(`(\\d{1,2})\\s*(?:-|–|—|~|ถึง|to)\\s*(\\d{1,2})\\s*(${PERIOD_MONTH_ALTERNATION})\\s*(?:ปี\\s*)?['’]?(\\d{2,4})?`, 'giu'),
    build: (m, today) => namedMonthDayRange(m[1]!, m[2]!, m[3]!, m[4], today),
  },
  {
    // 1/9–15/9/68 · 1.9 ถึง 15.9.2568
    pattern: /(\d{1,2})[/.-](\d{1,2})\s*(?:-|–|—|~|ถึง|to)\s*(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/gu,
    build: (m, today) => numericDayRange(m[1]!, m[2]!, m[3]!, m[4]!, m[5], today),
  },
  // ── named months (± พ.ศ./ค.ศ./two-digit year, else the latest non-future occurrence) ──
  {
    pattern: new RegExp(`เดือน\\s*(${PERIOD_SHORT_MONTH_ALTERNATION})\\s*(?:ปี\\s*)?['’]?(\\d{2,4})?(?=$|\\s|และ|[),/])`, 'giu'),
    build: (m, today) => namedMonth(m[1]!, m[2], today),
  },
  {
    pattern: new RegExp(`(?:^|\\s|[,(]|และ\\s*)(${PERIOD_SHORT_MONTH_ALTERNATION})\\s*(?:ปี\\s*)?['’]?(\\d{2,4})?(?=$|\\s|และ|[),/])`, 'giu'),
    build: (m, today) => namedMonth(m[1]!, m[2], today),
  },
  {
    pattern: new RegExp(`(${PERIOD_MONTH_ALTERNATION})\\s*(?:ปี\\s*)?['’]?(\\d{2,4})`, 'giu'),
    build: (m, today) => namedMonth(m[1]!, m[2], today),
  },
  {
    pattern: new RegExp(`(${PERIOD_MONTH_ALTERNATION_NO_YEAR})`, 'giu'),
    build: (m, today) => namedMonth(m[1]!, undefined, today),
  },
  // ── years (calendar) ─────────────────────────────────────────────────────
  { pattern: /ปี(?:ที่แล้ว|ก่อน)/gu, fuzzyGuard: true, build: (_m, today) => yearsAgo(1, today, 'ปีที่แล้ว') },
  { pattern: /last\s*year/gi, build: (_m, today) => yearsAgo(1, today, 'ปีที่แล้ว') },
  { pattern: /ปีนี้/gu, fuzzyGuard: true, build: (_m, today) => yearsAgo(0, today, 'ปีนี้') },
  { pattern: /this\s*year/gi, build: (_m, today) => yearsAgo(0, today, 'ปีนี้') },
  { pattern: /(?:ปี|year)\s*['’]?(\d{2,4})/gi, build: (m) => namedYear(m[1]!) },
];

function lastNDays(n: number, todayIso: string): PeriodReading[] {
  if (!(n >= 1 && n <= MAX_RELATIVE_DAYS)) return [];
  return [{
    kind: 'last_n_days',
    fromDate: shiftDays(todayIso, -(n - 1)),
    toDate: todayIso,
    word: `${n} วันล่าสุด`,
    source: 'relative',
    assumptions: [PERIOD_ASSUMPTIONS.lastNDaysIncludeToday],
  }];
}

function weeksAgo(n: number, todayIso: string, word: string): PeriodReading[] {
  if (!(n >= 0 && n <= MAX_RELATIVE_WEEKS)) return [];
  const monday = shiftDays(mondayOf(todayIso), -7 * n);
  return [{
    kind: 'week',
    fromDate: monday,
    toDate: shiftDays(monday, 6),
    word,
    source: 'relative',
    assumptions: [PERIOD_ASSUMPTIONS.weekMondaySunday],
  }];
}

function monthsAgo(n: number, todayIso: string, word: string): PeriodReading[] {
  if (!(n >= 0 && n <= MAX_RELATIVE_MONTHS)) return [];
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  const zeroBased = year * 12 + (month - 1) - n;
  return [monthReading(Math.floor(zeroBased / 12), (zeroBased % 12) + 1, word, 'relative', [])];
}

function monthReading(
  yearCe: number,
  month: number,
  word: string,
  source: LineAiPeriodCandidate['source'],
  assumptions: string[],
): PeriodReading {
  const bounds = monthBounds(yearCe, month);
  return { kind: 'month', ...bounds, monthKey: bounds.fromDate.slice(0, 7), word, source, assumptions };
}

function quartersAgo(n: number, todayIso: string, word: string): PeriodReading[] {
  const year = Number(todayIso.slice(0, 4));
  const quarter = Math.floor((Number(todayIso.slice(5, 7)) - 1) / 3) + 1;
  const zeroBased = year * 4 + (quarter - 1) - n;
  const targetYear = Math.floor(zeroBased / 4);
  return [{ kind: 'quarter', ...quarterBounds(targetYear, (zeroBased % 4) + 1), word, source: 'relative', assumptions: [] }];
}

function yearsAgo(n: number, todayIso: string, word: string): PeriodReading[] {
  const year = Number(todayIso.slice(0, 4)) - n;
  return [{
    kind: 'year',
    fromDate: `${year}-01-01`,
    toDate: `${year}-12-31`,
    word,
    source: 'relative',
    assumptions: [],
  }];
}

function namedYear(rawYear: string): PeriodReading[] {
  return periodYearReadings(Number(rawYear), rawYear.length === 2 ? 2 : 4).map((reading) => ({
    kind: 'year' as const,
    fromDate: `${reading.yearCe}-01-01`,
    toDate: `${reading.yearCe}-12-31`,
    word: `ปี ${reading.yearBe}`,
    source: 'explicit' as const,
    assumptions: reading.assumptions,
  }));
}

function namedQuarter(quarter: number, rawYear: string | undefined, todayIso: string): PeriodReading[] {
  if (!rawYear) {
    // No year written: the most recent occurrence of that quarter that is not in the future.
    const year = Number(todayIso.slice(0, 4));
    const currentQuarter = Math.floor((Number(todayIso.slice(5, 7)) - 1) / 3) + 1;
    const yearCe = quarter <= currentQuarter ? year : year - 1;
    return [{
      kind: 'quarter',
      ...quarterBounds(yearCe, quarter),
      word: `ไตรมาส ${quarter}/${yearCe + BE_CE_OFFSET}`,
      source: 'explicit',
      assumptions: [PERIOD_ASSUMPTIONS.yearAssumedLatest],
    }];
  }
  return periodYearReadings(Number(rawYear), rawYear.length === 2 ? 2 : 4).map((reading) => ({
    kind: 'quarter' as const,
    ...quarterBounds(reading.yearCe, quarter),
    word: `ไตรมาส ${quarter}/${reading.yearBe}`,
    source: 'explicit' as const,
    assumptions: reading.assumptions,
  }));
}

/** The year a bare month name means: its most recent occurrence that is not in the future. */
function latestNonFutureYear(month: number, todayIso: string): number {
  const year = Number(todayIso.slice(0, 4));
  return month <= Number(todayIso.slice(5, 7)) ? year : year - 1;
}

function namedMonth(monthName: string, rawYear: string | undefined, todayIso: string): PeriodReading[] {
  const month = periodMonthFromName(monthName);
  if (!month) return [];
  if (!rawYear) {
    return [monthReading(latestNonFutureYear(month, todayIso), month, '', 'named_month',
      [PERIOD_ASSUMPTIONS.yearAssumedLatest])];
  }
  return resolveNamedMonthYearReadings(monthName, Number(rawYear), rawYear.length === 2 ? 2 : 4)
    .map((reading) => monthReading(reading.yearCe, month, '', 'named_month',
      reading.assumptions.includes(VALUE_ASSUMPTIONS.eraReadBe)
        ? [...reading.assumptions, PERIOD_ASSUMPTIONS.yearReadBe]
        : reading.assumptions));
}

function rangeReading(fromDate: string, toDate: string, assumptions: string[]): PeriodReading[] {
  if (fromDate > toDate) return [];
  return [{ kind: 'range', fromDate, toDate, word: '', source: 'explicit', assumptions }];
}

/** `1–15 ก.ย. [68]` — both days share the month (and year) written once at the end. */
function namedMonthDayRange(
  firstDay: string,
  lastDay: string,
  monthName: string,
  rawYear: string | undefined,
  todayIso: string,
): PeriodReading[] {
  const month = periodMonthFromName(monthName);
  if (!month) return [];
  const readings = rawYear
    ? resolveNamedMonthYearReadings(monthName, Number(rawYear), rawYear.length === 2 ? 2 : 4)
      .map((reading) => ({ yearCe: reading.yearCe, assumptions: reading.assumptions }))
    : [{ yearCe: latestNonFutureYear(month, todayIso), assumptions: [PERIOD_ASSUMPTIONS.yearAssumedLatest] }];
  return readings.flatMap((reading) => {
    const from = toIsoDate(Number(firstDay), month, reading.yearCe);
    const to = toIsoDate(Number(lastDay), month, reading.yearCe);
    return from && to ? rangeReading(from, to, reading.assumptions) : [];
  });
}

/** `1/9–15/9/68` — two numeric day/month pairs with an optional trailing year. The วัน/เดือน order
 *  follows the normalizer's existing rule: a part > 12 locks it, otherwise the canonical D/M is
 *  assumed and recorded. Without a written year the range takes the latest non-future one. */
function numericDayRange(
  firstA: string,
  firstB: string,
  secondA: string,
  secondB: string,
  rawYear: string | undefined,
  todayIso: string,
): PeriodReading[] {
  const pairs: Array<[number, number]> = [[Number(firstA), Number(firstB)], [Number(secondA), Number(secondB)]];
  if (pairs.some(([a, b]) => a > 12 && b > 12)) return [];
  // One end of a written range settles the order for BOTH: `1/9–15/9/68` reads 15 as a day, and the
  // two ends of one range are never written in opposite orders. Only when NEITHER end locks it does
  // the canonical วัน/เดือน default apply, and then it is recorded as an assumption.
  const dayFirstLocked = pairs.some(([a]) => a > 12);
  const monthFirstLocked = pairs.some(([, b]) => b > 12);
  if (dayFirstLocked && monthFirstLocked) return [];
  const read = ([a, b]: [number, number]) => (monthFirstLocked ? { day: b, month: a } : { day: a, month: b });
  const start = read(pairs[0]!);
  const end = read(pairs[1]!);
  const orderAssumptions = !dayFirstLocked && !monthFirstLocked && pairs.some(([a, b]) => a !== b)
    ? [VALUE_ASSUMPTIONS.orderAssumedDayMonth] : [];
  const yearReadings = rawYear ? periodYearReadings(Number(rawYear), rawYear.length === 2 ? 2 : 4) : [];
  const readings = rawYear
    // Same rule as a single numeric date: the era of a two-digit year resolves by plausibility ONLY
    // when the วัน/เดือน order is already certain; otherwise both readings survive and stay ambiguous.
    ? (orderAssumptions.length === 0 ? plausibleEraReadings(yearReadings, todayIso) : yearReadings)
      .map((reading) => ({ yearCe: reading.yearCe, assumptions: reading.assumptions }))
    : [{
        yearCe: latestNonFutureYear(end.month, todayIso),
        assumptions: [PERIOD_ASSUMPTIONS.yearAssumedLatest],
      }];
  return readings.flatMap((reading) => {
    const from = toIsoDate(start.day, start.month, reading.yearCe);
    const to = toIsoDate(end.day, end.month, reading.yearCe);
    return from && to ? rangeReading(from, to, [...orderAssumptions, ...reading.assumptions]) : [];
  });
}

/** `1/9/68 ถึง 15/9/68` and `2026-09-01 – 2026-09-15`: two unambiguous DATE candidates the extractor
 *  already read, separated by a range marker in the source text (spec §3.1 "ใช้ date candidate เดิม
 *  2 ตัวที่ไม่กำกวม"). Month-period boundaries are excluded — those are not stated days. */
const RANGE_MARKER = /^\s*(?:-|–|—|~|ถึง|to)\s*$/u;
function dateCandidateRanges(text: string, dates: LineAiDateCandidate[]): Array<{ span: string; reading: PeriodReading }> {
  const usable = dates.filter((date) => !isAmbiguousDateCandidate(date)
    && !date.assumptions.includes(VALUE_ASSUMPTIONS.monthPeriodBoundary));
  const out: Array<{ span: string; reading: PeriodReading }> = [];
  for (let i = 0; i + 1 < usable.length; i += 1) {
    const left = usable[i]!;
    const right = usable[i + 1]!;
    const leftStart = text.indexOf(left.span);
    if (leftStart < 0) continue;
    const gapStart = leftStart + left.span.length;
    const gapEnd = text.indexOf(right.span, gapStart);
    if (gapEnd < 0 || !RANGE_MARKER.test(text.slice(gapStart, gapEnd))) continue;
    const [from, to] = left.isoDate <= right.isoDate ? [left.isoDate, right.isoDate] : [right.isoDate, left.isoDate];
    const span = text.slice(leftStart, gapEnd + right.span.length);
    for (const reading of rangeReading(from, to, [...new Set([...left.assumptions, ...right.assumptions])])) {
      out.push({ span, reading });
    }
  }
  return out;
}

/**
 * Every period reading the text supports, given the injected Bangkok civil date. Recall wins over
 * precision (ADR 0011): these are only the values a tool input may SELECT, never an answer — but a
 * period whose bounds are entirely in the future is dropped (no data exists) and a current period
 * ends today, exactly like the default window every period-scoped tool computes for itself.
 */
export function resolvePeriodCandidates(
  text: string,
  todayIso: string,
  dates: LineAiDateCandidate[] = [],
): LineAiPeriodCandidate[] {
  if (!CIVIL_DATE_PATTERN.test(todayIso)) return [];
  const mapped = mapThaiDigits(text);
  const used: SpanRange[] = [];
  const out: LineAiPeriodCandidate[] = [];

  const push = (span: string, reading: PeriodReading): void => {
    if (reading.fromDate > todayIso) return; // wholly future: there is nothing to read
    const clamped = reading.toDate > todayIso;
    const toDate = clamped ? todayIso : reading.toDate;
    const assumptions = clamped ? [...reading.assumptions, PERIOD_ASSUMPTIONS.clampedToToday] : reading.assumptions;
    const range = formatThaiPeriodRange(reading.fromDate, toDate);
    const candidate: LineAiPeriodCandidate = {
      span,
      kind: reading.kind,
      fromDate: reading.fromDate,
      toDate,
      ...(reading.monthKey ? { monthKey: reading.monthKey } : {}),
      source: reading.source,
      label: reading.assumptions.includes(PERIOD_ASSUMPTIONS.monthNameTypoCorrected)
        ? `ตีความ "${span}" เป็น ${range}` : reading.word ? `${reading.word} (${range})` : range,
      assumptions,
    };
    if (out.some((existing) => existing.kind === candidate.kind
      && existing.fromDate === candidate.fromDate
      && existing.toDate === candidate.toDate
      && existing.span === candidate.span)) return;
    out.push(candidate);
  };

  for (const rule of PERIOD_RULES) {
    for (const match of mapped.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (overlaps(used, start, end)) continue;
      if (rule.fuzzyGuard && fuzzyQualified(mapped, start)) continue;
      // The span is consumed even when the rule produced nothing: a phrase this resolver RECOGNISED
      // but could not pin down (e.g. "25 เดือนที่แล้ว", past the N ceiling) must not then be re-read
      // by a looser rule as plain "เดือนที่แล้ว". No candidate means the tool's default period, and
      // the answer says which period that was.
      used.push({ start, end });
      for (const reading of rule.build(match, todayIso)) push(text.slice(start, end), reading);
    }
  }
  // Recover a clear, one-character typo in a full Thai month name. The original span remains on
  // the candidate for wire validation and audit; the correction is only a date interpretation.
  const typoPattern = /(?:เดือน\s*|^|[\s,(]|และ\s*)([ก-๙]{5,14}?)(?=$|\s|และ|[),/.!?]|ปี\s*\d)/gu;
  for (const match of mapped.matchAll(typoPattern)) {
    const token = match[1]!;
    const start = (match.index ?? 0) + match[0].lastIndexOf(token);
    const nameEnd = start + token.length;
    if (overlaps(used, start, nameEnd)) continue;
    const corrected = correctedThaiMonthName(token);
    if (!corrected) continue;
    const year = /^\s*(?:ปี\s*)?['’]?(\d{2,4})(?=$|\s|และ|[),/])/u.exec(mapped.slice(nameEnd));
    const end = nameEnd + (year?.[0].length ?? 0);
    used.push({ start, end });
    for (const reading of namedMonth(corrected, year?.[1], todayIso)) {
      push(text.slice(start, end), {
        ...reading, assumptions: [...reading.assumptions, PERIOD_ASSUMPTIONS.monthNameTypoCorrected],
      });
    }
  }
  for (const found of dateCandidateRanges(text, dates)) push(found.span, found.reading);

  return out.sort((a, b) => text.indexOf(a.span) - text.indexOf(b.span)).slice(0, MAX_PERIOD_CANDIDATES);
}

// ── Discovery helpers ─────────────────────────────────────────────────────────

const MAX_CLARIFY_LENGTH = 200;

/** Deterministic clarify text naming the concrete readings of one ambiguous span,
 *  e.g. `วันที่ "9/11/37" หมายถึง 9 พ.ย. 2537 หรือ 9 พ.ย. 2580?`. Bounded; Thai display
 *  convention per ADR 0011. Guardrail copy only – the model still owns semantics. */
export function formatDateClarifyQuestion(candidates: LineAiDateCandidate[]): string | null {
  const ambiguous = candidates.filter(isAmbiguousDateCandidate);
  if (ambiguous.length === 0) return null;
  const span = ambiguous[0].span;
  const options = ambiguous
    .filter((c) => c.span === span)
    .map((c) => formatThaiDate(c));
  const unique = [...new Set(options)];
  if (unique.length < 2) return null;
  return `วันที่ "${span}" หมายถึง ${unique.join(' หรือ ')}?`.slice(0, MAX_CLARIFY_LENGTH);
}
