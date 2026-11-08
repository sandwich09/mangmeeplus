import { verifyLineAiInputEvidence, validateLineAiSourceRefV2, type LineAiInputEvidenceV2, type LineAiSourceRefV2 } from './line-ai-input-evidence.js';

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
  candidateId?: string;
  source?: LineAiSourceRefV2;
  span: string;
  /** Plain decimal string, e.g. "60" or "1234.50". */
  value: string;
  /** Adjacent currency token as written (e.g. "บาท", "฿", "$b"); absent when none. */
  currencyToken?: string;
  assumptions?: string[];
};

export type LineAiDateCandidate = {
  candidateId?: string;
  source?: LineAiSourceRefV2;
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
export type LineAiPeriodSource = 'relative' | 'explicit' | 'named_month';
export type LineAiPeriodCandidate = {
  /** Exact substring of the source text this reading came from. */
  span: string;
  kind: LineAiPeriodKind;
  fromDate: string;
  toDate: string;
  /** 'YYYY-MM' — set only for `kind: 'month'`, for tools whose input is a period key. */
  monthKey?: string;
  candidateId?: string;
  source: LineAiPeriodSource | LineAiSourceRefV2;
  periodSource?: LineAiPeriodSource;
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
  if (raw['version'] === 2) return parseLineAiValueCandidatesV2(value, messageText);
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

/** Spoken short month names (UAT 2026-09-29: "ของเดือนสิงหาละ" read no period, so the follow-up could not be
 *  grounded). Chat-period use only, and only where the period rules below see a clear boundary — "กันยา" is also
 *  a given name and "ตุลา" starts ตุลาการ. Dates require a day AND year around these names. */
const THAI_SPOKEN_MONTHS: Array<[string, number]> = [
  ['มกรา', 1], ['กุมภา', 2], ['มีนา', 3], ['เมษา', 4], ['พฤษภา', 5], ['มิถุนา', 6],
  ['กรกฎา', 7], ['กรกฏา', 7], ['สิงหา', 8], ['กันยา', 9], ['ตุลา', 10], ['พฤศจิกา', 11], ['ธันวา', 12],
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
  .map(([name]) => name.replace(/\./g, '\\.?'))
  .sort((a, b) => b.length - a.length)
  .join('|');

function monthFromName(name: string): number | null {
  const lowered = name.toLowerCase().replace(/\./g, '');
  for (const [candidate, month] of [...THAI_MONTHS, ...ENGLISH_MONTHS, ...THAI_SPOKEN_MONTHS]) {
    if (candidate.replace(/\./g, '') === lowered) return month;
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
  if (THAI_MONTH_NAMES.has(monthName.toLowerCase()) || /[\u0E00-\u0E7F]/u.test(monthName)) {
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
  options: { documentContext?: LineAiDocumentContext; scan?: CandidateScan } = {},
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
    const candidate = { span, day, month, yearBe: reading.yearBe, isoDate, assumptions };
    options.scan?.observe('date', candidate, start, end);
    if (!options.scan && dates.some((d) => d.isoDate === isoDate && d.span === span)) return;
    dates.push(candidate);
    options.scan?.datePositions.set(candidate, { start, end });
  };

  const recordDateRange = (start: number, end: number): void => {
    dateRanges.push({ start, end });
  };

  // Spoken months are dates only between an explicit day and year; never match a name or
  // the prefix of a full month. Keep them out of month-first and month-period extraction.
  const spokenDatePattern = new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${THAI_SPOKEN_MONTHS.map(([name]) => name).join('|')})\\s+(?:ปี\\s*)?(\\d{4}|\\d{2})(?!\\d)`, 'gu');
  for (const match of mapped.matchAll(spokenDatePattern)) {
    const readings = resolveNamedMonthYearReadings(match[2], Number(match[3]), match[3].length);
    for (const reading of readings) pushDate(match.index, match.index + match[0].length, Number(match[1]), monthFromName(match[2])!, reading, []);
    recordDateRange(match.index, match.index + match[0].length);
  }

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
    // A day-first slip header (16 ก.ย. 69 14:10) is not month-first ก.ย. 69 14.
    // Do not reserve its span before the day-first pass can read the actual date.
    if (/(?:^|[^\d])(?:0?[1-9]|[12]\d|3[01])\s*$/.test(mapped.slice(0, start))) continue;
    const month = monthFromName(match[1]);
    if (!month) continue;
    const day = Number(match[2]);
    if (day < 1 || day > 31) continue;
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
    if (match[0].includes('/')) {
      day = first; month = second; // Owner: slash dates always use Thai day/month order.
      if (first <= 12 && second <= 12 && first !== second) orderAssumptions.push(VALUE_ASSUMPTIONS.orderAssumedDayMonth);
    } else if (first > 12 && second <= 12) {
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

  // A yearless Thai day/month is the latest occurrence on or before the injected Bangkok day.
  // Reserve even impossible dates so neither their digits nor their month become another value.
  const yearlessPatterns = [
    /(?<![\d/])(\d{1,2})\/(\d{1,2})(?![\d/])/gu,
    new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${THAI_MONTHS.map(([name]) => name.replace(/\./g, '\\.?')).sort((a, b) => b.length - a.length).join('|')})(?![ก-๙.]|\\s*(?:ปี\\s*)?['’]?\\d)`, 'gu'),
  ];
  for (const pattern of yearlessPatterns) for (const match of mapped.matchAll(pattern)) {
    const start = match.index, end = start + match[0].length;
    if (overlaps(dateRanges, start, end)) continue;
    recordDateRange(start, end);
    const day = Number(match[1]), month = monthFromName(match[2]) ?? Number(match[2]);
    if (!todayIso) continue;
    let date = dayOccurrence(day, month, Number(todayIso.slice(0, 4)), -1);
    if (date && date > todayIso) date = dayOccurrence(day, month, Number(date.slice(0, 4)) - 1, -1);
    if (date) {
      const yearCe = Number(date.slice(0, 4));
      pushDate(start, end, day, month, { yearCe, yearBe: yearCe + BE_CE_OFFSET,
        assumptions: [PERIOD_ASSUMPTIONS.yearAssumedLatest] }, []);
    }
  }

  // A spoken day in this month is a date, including an explicit "เดือนนี้" suffix.
  // A number followed by a currency token is money ("2 วัน 40 บาท"), and only 1–31 is a day.
  for (const match of mapped.matchAll(/วัน(?:ที่)?\s*(\d{1,2})(?!\d)(?!\s*(?:บาท|บ\.?(?=\s|$)|฿|thb|baht))(?:\s*เดือนนี้)?/giu)) {
    if (Number(match[1]) < 1 || Number(match[1]) > 31) continue;
    const start = match.index, end = start + match[0].length;
    if (overlaps(dateRanges, start, end)) continue;
    recordDateRange(start, end);
    if (todayIso && !/^\s*เดือน(?!นี้)/u.test(mapped.slice(end))) {
      const yearCe = Number(todayIso.slice(0, 4));
      pushDate(start, end, Number(match[1]), Number(todayIso.slice(5, 7)),
        { yearCe, yearBe: yearCe + BE_CE_OFFSET, assumptions: [] }, []);
    }
  }

  for (const match of mapped.matchAll(/(?:รอบ|ข้อ|(?:อัน|ใบ|รายการ|ร่าง)ที่)\s*\d+/gu)) recordDateRange(match.index, match.index + match[0].length);
  for (const match of mapped.matchAll(/(?:รอบ\s*(?:ที่\s*)?|(?:อัน|ใบ|รายการ|ร่าง)ที่\s*)/gu)) {
    const start = match.index + match[0].length;
    const end = /^\d+/u.exec(mapped.slice(start))?.[0].length ?? (mapped.startsWith('แรก', start) ? 3 : (scanThaiWordTokens(mapped, start)?.end ?? start) - start);
    if (end) recordDateRange(match.index, start + end);
  }

  // 6) Digit amounts (Thai digits already mapped). Tokens inside date spans are excluded so
  //    a year like 2537 can never legitimize an amount of 2537.
  for (const match of mapped.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(dateRanges, start, end)) continue;
    const raw = match[0].replace(/,/g, '');
    const value = options.scan ? canonicalDecimal(raw) : Number.parseFloat(raw);
    if (value === null || typeof value === 'number' && !Number.isFinite(value)) continue;
    pushAmount(amounts, text, mapped, start, end, value, options.scan);
  }

  // 7) Thai number words (no word boundaries in Thai – substring scan, longest token first).
  let cursor = 0;
  while (cursor < text.length) {
    const scanned = scanThaiWordTokens(text, cursor);
    if (!scanned) {
      cursor += 1;
      continue;
    }
    // A final digit after a large Thai magnitude names its next lower place (พันแปด = 1,800).
    const [magnitude, digit] = scanned.tokens.slice(-2);
    if (magnitude?.kind === 'multiplier' && magnitude.value >= 1_000
      && digit?.kind === 'unit' && digit.value > 0 && digit.value < 10) {
      scanned.tokens.push({ kind: 'multiplier', value: magnitude.value / 10 });
    }
    const value = options.scan ? evaluateWordTokensExact(scanned.tokens) : evaluateWordTokens(scanned.tokens);
    if (value !== null && BigInt(value) > 0n && !overlaps(dateRanges, cursor, scanned.end)) {
      pushAmount(amounts, text, mapped, cursor, scanned.end, value, options.scan);
    }
    cursor = scanned.end;
  }

  // 8) English number words (word-boundary based).
  const englishWordPattern = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million)(?:[\s-](?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million))*\b/gi;
  for (const match of text.matchAll(englishWordPattern)) {
    const tokens = match[0].toLowerCase().split(/[\s-]+/).map((w) => ENGLISH_NUMBER_WORDS[w]).filter((t): t is WordToken => !!t);
    const value = options.scan ? evaluateWordTokensExact(tokens) : evaluateWordTokens(tokens);
    if (value !== null && BigInt(value) > 0n && !overlaps(dateRanges, match.index, match.index + match[0].length)) {
      pushAmount(amounts, text, mapped, match.index, match.index + match[0].length, value, options.scan);
    }
  }

  // 9) Periods (spec §3.1). Computed HERE so every producer of value candidates gets them for free.
  //    A period is meaningless without a clock, so a caller that injects no `todayIso` gets none, and
  //    a turn that names no period carries no `periods` key at all — existing payloads are unchanged.
  const periods = todayIso ? resolvePeriodCandidates(text, todayIso, dates, options.scan, { dateRanges }) : [];

  return {
    amounts: options.scan ? amounts : amounts.slice(0, MAX_AMOUNT_CANDIDATES),
    dates: options.scan ? dates : dates.slice(0, MAX_DATE_CANDIDATES),
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

function pushAmount(into: LineAiAmountCandidate[], text: string, mapped: string, start: number, end: number, value: number | string, scan?: CandidateScan): void {
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
  scan?.observe('amount', candidate, start, end);
  if (!scan && into.some((a) => a.value === candidate.value && a.span === candidate.span)) return;
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
  /** Recent calendar windows exclude the unfinished current unit. */
  completeUnitsExcludeCurrent: 'complete_units_exclude_current',
  /** A month name, quarter or range written with no year: the most recent occurrence not in the future. */
  yearAssumedLatest: 'year_assumed_latest_past',
  /** A uniquely identifiable full Thai month name had one mistyped Unicode character. */
  monthNameTypoCorrected: 'month_name_typo_corrected',
} as const;

const MS_PER_CIVIL_DAY = 86_400_000;
const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_PERIOD_CANDIDATES = 12;
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

/** Calendar months in a whole-month period, including its explicitly clamped current month. */
export function calendarMonthsForPeriod(
  period: Pick<LineAiPeriodCandidate, 'fromDate' | 'toDate' | 'assumptions'>,
  todayIso: string,
): Array<{ monthKey: string; fromDate: string; toDate: string; label: string }> | null {
  const { fromDate, toDate } = period;
  const fromMs = civilMs(fromDate), toMs = civilMs(toDate);
  if (fromMs === null || toMs === null || isoOfMs(fromMs) !== fromDate || isoOfMs(toMs) !== toDate
    || !fromDate.endsWith('-01') || fromDate > toDate || toDate > todayIso) return null;
  const lastYear = Number(toDate.slice(0, 4)), lastMonth = Number(toDate.slice(5, 7));
  if (toDate !== monthBounds(lastYear, lastMonth).toDate
    && !(toDate === todayIso && period.assumptions.includes(PERIOD_ASSUMPTIONS.clampedToToday))) return null;
  const first = Number(fromDate.slice(0, 4)) * 12 + Number(fromDate.slice(5, 7)) - 1;
  const last = lastYear * 12 + lastMonth - 1;
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const cursor = first + index;
    const bounds = monthBounds(Math.floor(cursor / 12), cursor % 12 + 1);
    const end = bounds.toDate < toDate ? bounds.toDate : toDate;
    return { monthKey: bounds.fromDate.slice(0, 7), fromDate: bounds.fromDate, toDate: end,
      label: formatThaiPeriodRange(bounds.fromDate, end) };
  });
}

/** What one matched span resolved to, before clamping/labelling. */
type PeriodReading = {
  kind: LineAiPeriodKind;
  fromDate: string;
  toDate: string;
  /** Thai word/phrase the user used ('' for a named month or an explicit range, whose label IS the range). */
  word: string;
  source: LineAiPeriodSource;
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
/** A dotted Thai abbreviation as people type it: "ส.ค.", "ส.ค" (no final dot) or "ส. ค." (space after the dot). */
function periodMonthNamePattern(name: string): string {
  const dotted = /^([\u0E00-\u0E7F]+)\.([\u0E00-\u0E7F]+)\.$/u.exec(name);
  return dotted ? `${dotted[1]}\\.\\s?${dotted[2]}\\.?` : name.replace(/\./g, '\\.');
}
const PERIOD_MONTH_ALTERNATION = [...PERIOD_MONTH_NAMES]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([name]) => periodMonthNamePattern(name))
  .join('|');
/** `may` is also an ordinary English word, so it names a month only when a year follows it. */
const PERIOD_MONTH_ALTERNATION_NO_YEAR = PERIOD_MONTH_NAMES
  .filter(([name]) => name !== 'may' && name !== 'may.')
  .sort((a, b) => b[0].length - a[0].length)
  .map(([name]) => periodMonthNamePattern(name))
  .join('|');
const PERIOD_SPOKEN_MONTH_ALTERNATION = THAI_SPOKEN_MONTHS.map(([name]) => name).sort((a, b) => b.length - a.length).join('|');
/** What completes a spoken name into its full name — left to the full-name rules, which also read its year. */
const FULL_MONTH_NAME_REST = '(?!คม|ยน|พันธ์)';

function periodMonthFromName(name: string): number | null {
  const typed = name.toLowerCase().replace(/\s+/gu, '');
  // "กค." — the abbreviation typed with only its final dot (owner on LINE UAT 2026-10-05: "เทียบค่าใช้จ่าย กค. สค. กย."
  // was asked which period it meant). It is the undotted abbreviation; "ก.ค." keeps its own entry.
  const compact = /^[\u0E00-\u0E7F]+\.$/u.test(typed) ? typed.slice(0, -1) : typed;
  const lowered = /^[\u0E00-\u0E7F]+\.[\u0E00-\u0E7F]+$/u.test(compact) ? `${compact}.` : compact;
  for (const [candidate, month] of [...PERIOD_MONTH_NAMES, ...PERIOD_SHORT_MONTH_NAMES, ...THAI_SPOKEN_MONTHS]) if (candidate === lowered) return month;
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

function looksLikeThaiMonth(token: string): boolean {
  return token.length <= 3
    ? PERIOD_SHORT_MONTH_NAMES.some(([name]) => name[0] === token[0] && oneEditApart(token, name))
    : FULL_THAI_MONTH_NAMES.some(([name]) => name.slice(0, 3) === token.slice(0, 3) || oneEditApart(token, name));
}

/** Only an unresolved month-like token or an out-of-range month number needs a month question. */
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
    if (looksLikeThaiMonth(token) && !coveredAt(tokenStart)) return token.slice(0, 32);
    let cursor = tokenStart + token.length;
    for (;;) {
      const next = /^\s*และ\s*([ก-๙]+)/u.exec(text.slice(cursor));
      if (!next) break;
      const nextToken = next[1]!.split('และ', 1)[0]!;
      const nextStart = cursor + next[0].indexOf(next[1]!);
      if (!nextToken.startsWith('เดือน') && looksLikeThaiMonth(nextToken) && !coveredAt(nextStart)) return nextToken.slice(0, 32);
      cursor = nextStart + nextToken.length;
    }
  }
  for (const match of text.matchAll(/(?:เดือน|\bmonth\b)\s*([0-9๐-๙]{1,4})(?![0-9๐-๙])/giu)) {
    const start = (match.index ?? 0) + match[0].lastIndexOf(match[1]!);
    // A month number no candidate covers: out of 1–12, or a month that has not come yet (spec §4.3:
    // "เดือน 12 ปี 2569" asked in September is answered by naming it, never by reading this month).
    // A count is not a month: "3 เดือนล่าสุด" and "เดือน 8-10" are covered by their own candidates.
    if (!coveredAt(start)) return match[1]!;
  }
  // A separated full month-like word can also be a typo without the word เดือน before it.
  for (const match of text.matchAll(/(?:^|[\s,(]|และ\s*)([ก-๙]{5,14}?)(?=$|\s|และ|[),/.!?]|ปี\s*\d)/gu)) {
    const token = match[1]!;
    const start = (match.index ?? 0) + match[0].lastIndexOf(token);
    if (looksLikeThaiMonth(token) && !coveredAt(start)) return token;
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
function periodYearReadings(rawYear: number, digits: number, todayIso: string): YearReading[] {
  const readings = plausibleEraReadings(resolveYearReadings(rawYear, digits), todayIso)
    .filter(reading => !reading.assumptions.includes(VALUE_ASSUMPTIONS.ambiguousTwoDigitYear));
  return readings.map((reading) => reading.assumptions.includes(VALUE_ASSUMPTIONS.eraReadBe)
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
  /** A recognized day range must not also be joined from record DATE candidates. */
  blocksDateRanges?: boolean;
  /** null leaves an invalid month range to the existing individual-month rules. */
  build: (match: RegExpExecArray | RegExpMatchArray, todayIso: string) => PeriodReading[] | null;
};

const singleDay = (iso: string, word: string, assumptions: string[] = []): PeriodReading[] =>
  [{ kind: 'day', fromDate: iso, toDate: iso, word, source: 'relative', assumptions }];

// Consume complete count tokens so estimates cannot fall back to their last number.
const PERIOD_COUNT_PATTERN = `(?:[-+]?\\d+(?:[.,]\\d+)*|(?:${THAI_NUMBER_TOKENS.map(([word]) => word).join('|')})+)`;
function periodCount(raw: string | undefined): number {
  if (raw === undefined) return 1;
  if (/^\d+$/u.test(raw)) return Number(raw);
  if (!new RegExp(`^(?:${THAI_DAY_WORD_ALTERNATION})$`, 'u').test(raw)) return NaN;
  const scanned = scanThaiWordTokens(raw, 0);
  return scanned ? evaluateWordTokens(scanned.tokens) ?? NaN : NaN;
}

function completeUnits(n: number, unit: string, today: string, suffix: string): PeriodReading[] {
  if (!(n >= 1 && n <= MAX_RELATIVE_MONTHS)) return [];
  const kind = /month|เดือน/i.test(unit) ? 'month' : /week|สัปดาห์|อาทิตย์|วีค/i.test(unit) ? 'week'
    : /quarter|ไตรมาส/i.test(unit) ? 'quarter' : 'year';
  const thaiUnit = { month: 'เดือน', week: 'สัปดาห์', quarter: 'ไตรมาส', year: 'ปี' }[kind];
  const word = `${n} ${thaiUnit}${suffix}`;
  const latest = kind === 'week' ? weeksAgo(1, today, word)[0]! : kind === 'month' ? monthsAgo(1, today, word)[0]!
    : kind === 'quarter' ? quartersAgo(1, today, word)[0]! : yearsAgo(1, today, word)[0]!;
  const earliest = kind === 'week' ? weeksAgo(n, today, word)[0]! : kind === 'month' ? monthsAgo(n, today, word)[0]!
    : kind === 'quarter' ? quartersAgo(n, today, word)[0]! : yearsAgo(n, today, word)[0]!;
  return [{ ...latest, kind: n === 1 ? kind : 'range', fromDate: earliest.fromDate,
    ...(n > 1 ? { monthKey: undefined } : {}),
    assumptions: [...latest.assumptions, PERIOD_ASSUMPTIONS.completeUnitsExcludeCurrent] }];
}

const PERIOD_ALL_MONTH_ALTERNATION = `${PERIOD_MONTH_ALTERNATION}|(?:${PERIOD_SHORT_MONTH_ALTERNATION})\\.?|${PERIOD_SPOKEN_MONTH_ALTERNATION}`;
const PERIOD_RANGE_CONNECTOR = 'จนถึง|ถึง|ยัน|-|–|—|~|to|until|through';
const MONTH_RANGE_ENDPOINT = `(${PERIOD_ALL_MONTH_ALTERNATION}|\\d{1,2})(?:\\s*(?:ปี\\s*|year\\s*)?['’]?(\\d{2,4})(?!\\d))?`;
const PERIOD_MONTH_CONTEXT = 'ตั้งแต่|จาก|ช่วง|ระหว่าง|แล้ว|ของ|รายจ่าย|ค่าใช้จ่าย|ยอดขาย|ยอด';
/** What may follow an undotted abbreviation ("กค", "กค."): never a Thai letter that would make it another word. */
const PERIOD_SHORT_MONTH_END = '(?=$|\\s|และ|กับ|เทียบ|นี้|[),/!?\\-–]|ค่ะ|คะ|ครับ|นะ|ล่ะ|ละ)';
const PERIOD_MONTH_LEAD = `(?:^|[\\s,(]|เดือน\\s*|${PERIOD_MONTH_CONTEXT})`;

const MONTH_LIST_NEXT = new RegExp(`^\\.?\\s*(?:${PERIOD_RANGE_CONNECTOR})\\s*(?:เดือน\\s*)?(?:${PERIOD_ALL_MONTH_ALTERNATION})`, 'iu');
const MONTH_LIST_BEFORE = new RegExp(`(?:${PERIOD_ALL_MONTH_ALTERNATION})\\.?\\s*(?:${PERIOD_RANGE_CONNECTOR})\\s*$`, 'iu');

function monthRange(m: RegExpMatchArray, today: string): PeriodReading[] | null {
  if ((m[5] === 'กับ' || m[5] === 'และ') && m[1] !== 'ระหว่าง') return null;
  // "ก.ค.-ส.ค.-ก.ย.": a third month joined on makes it a list of months, each read by its own rule.
  const input = m.input ?? '', at = m.index ?? 0;
  if (MONTH_LIST_NEXT.test(input.slice(at + m[0].length)) || MONTH_LIST_BEFORE.test(input.slice(0, at + (m[0].length - m[0].trimStart().length)))) return null;
  const month = (name: string) => periodMonthFromName(name) ?? (/^\d+$/u.test(name) ? Number(name) : 0);
  const first = month(m[3]!), last = month(m[7]!);
  // A bare numeric pair is not a month range (it can be a day range or an amount).
  if ((/^\d/u.test(m[3]!) && !m[2]) || (/^\d/u.test(m[7]!) && !m[6] && !/^\d/u.test(m[3]!))
    || first < 1 || first > 12 || last < 1 || last > 12) return null;
  if ((/^may\.?$/i.test(m[3]!) && !m[2] && !m[4]) || (/^may\.?$/i.test(m[7]!) && !m[6] && !m[8])) return null;
  const leftYear = m[4] ? namedPeriodYearReadings(m[3]!, m[4], today)[0] : undefined;
  const rightYear = m[8] ? namedPeriodYearReadings(m[7]!, m[8], today)[0] : undefined;
  if ((m[4] && !leftYear) || (m[8] && !rightYear)) return [];
  const fromYear = leftYear?.yearCe ?? (rightYear ? rightYear.yearCe - Number(first > last) : latestNonFutureYear(first, today));
  const toYear = rightYear?.yearCe ?? fromYear + Number(last < first);
  const monthCount = (toYear - fromYear) * 12 + last - first + 1;
  if (monthCount < 1 || monthCount > MAX_RELATIVE_MONTHS) return null;
  const assumptions = leftYear || rightYear ? [...new Set([...(leftYear?.assumptions ?? []), ...(rightYear?.assumptions ?? [])])]
    : [PERIOD_ASSUMPTIONS.yearAssumedLatest];
  return rangeReading(monthBounds(fromYear, first).fromDate, monthBounds(toYear, last).toDate, assumptions);
}

const NAMED_DAY_ENDPOINT = `(?:วันที่\\s*)?(\\d{1,2})(?!\\d)\\s*(เดือน\\s*|month\\s*)?(${PERIOD_ALL_MONTH_ALTERNATION}|\\d{1,2})(?:\\s*(?:ปี\\s*|year\\s*)?['’]?(\\d{4}|\\d{2})(?!\\d))?`;
const DAY_RANGE_LEAD = `(?:^|[\\s,(]|(?=วันที่|${PERIOD_MONTH_CONTEXT}))(?:from|${PERIOD_MONTH_CONTEXT})?\\s*`;
const FULL_NUMERIC_DAY = '(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4}|\\d{2})(?!\\d)';

// February 29 has a calendar occurrence only in a leap year; impossible month-days never do.
function dayOccurrence(day: number, month: number, yearCe: number, direction: -1 | 1): string | null {
  if (month < 1 || month > 12 || day < 1 || day > lastDayOfMonth(2000, month)) return null;
  let date = toIsoDate(day, month, yearCe);
  while (!date && yearCe >= 100 && yearCe <= 9999) date = toIsoDate(day, month, yearCe += direction);
  return date;
}

function namedDayBounds(day: string, prefix: string | undefined, name: string, rawYear: string | undefined, today: string): {
  month: number; yearCe: number; date: string; assumptions: string[];
} | null {
  const month = periodMonthFromName(name) ?? (prefix && /^\d+$/u.test(name) ? Number(name) : 0);
  const year = rawYear ? namedPeriodYearReadings(name, rawYear, today)[0] : undefined;
  if (rawYear && !year) return null;
  let yearCe = year?.yearCe ?? latestNonFutureYear(month, today);
  let date = rawYear ? toIsoDate(Number(day), month, yearCe) : dayOccurrence(Number(day), month, yearCe, -1);
  if (!rawYear && date && date > today) date = dayOccurrence(Number(day), month, yearCe - 1, -1);
  return date ? { month, yearCe: Number(date.slice(0, 4)), date, assumptions: year?.assumptions ?? [PERIOD_ASSUMPTIONS.yearAssumedLatest] } : null;
}

function namedDayRange(m: RegExpMatchArray, today: string): PeriodReading[] | null {
  const first = namedDayBounds(m[1]!, m[2], m[3]!, m[4], today);
  const last = namedDayBounds(m[5]!, m[6], m[7]!, m[8], today);
  if (!first || !last) return null;
  const wraps = last.month < first.month || last.month === first.month && Number(m[5]) < Number(m[1]);
  const fromYear = m[4] ? first.yearCe : m[8] ? last.yearCe - Number(wraps) : first.yearCe;
  const from = m[4] ? first.date : dayOccurrence(Number(m[1]), first.month, fromYear, -1);
  const to = m[8] ? last.date : from ? dayOccurrence(Number(m[5]), last.month,
    Number(from.slice(0, 4)) + Number(wraps), 1) : null;
  if (!from || !to || from > to) return null;
  const assumptions = m[4] || m[8]
    ? [...new Set([...(m[4] ? first.assumptions : []), ...(m[8] ? last.assumptions : [])])]
    : [PERIOD_ASSUMPTIONS.yearAssumedLatest];
  return rangeReading(from, to, assumptions);
}

const DAY_RANGE_RULES: PeriodRule[] = [
  {
    pattern: new RegExp(`ระหว่าง\\s*${NAMED_DAY_ENDPOINT}\\s*(?:กับ|และ)\\s*${NAMED_DAY_ENDPOINT}(?=$|\\s|[),.!?]|ค่ะ|ครับ|ให้|บ้าง)`, 'giu'),
    blocksDateRanges: true,
    build: namedDayRange,
  },
  {
    pattern: new RegExp(`${DAY_RANGE_LEAD}${NAMED_DAY_ENDPOINT}\\s*(?:${PERIOD_RANGE_CONNECTOR})\\s*${NAMED_DAY_ENDPOINT}(?=$|\\s|[),.!?]|ค่ะ|ครับ|ให้|บ้าง)`, 'giu'),
    blocksDateRanges: true,
    build: namedDayRange,
  },
  {
    pattern: new RegExp(`${DAY_RANGE_LEAD}${NAMED_DAY_ENDPOINT}\\s*(?:ถึง|จนถึง|ยัน|to|until)\\s*(?:วันนี้|ตอนนี้|ปัจจุบัน|today\\b|now\\b)`, 'giu'),
    blocksDateRanges: true,
    build: (m, today) => {
      const first = namedDayBounds(m[1]!, m[2], m[3]!, m[4], today);
      return first ? rangeReading(first.date, today, first.assumptions) : null;
    },
  },
  {
    pattern: new RegExp(`(?<!\\d)${FULL_NUMERIC_DAY}\\s*(?:${PERIOD_RANGE_CONNECTOR})\\s*${FULL_NUMERIC_DAY}`, 'giu'),
    blocksDateRanges: true,
    build: (m, today) => numericDayRange(m[1]!, m[2]!, m[4]!, m[5]!, m[6], today, m[3]),
  },
];

// These longer phrases must own their spans before singular units or numbered months can match.
const EVERYDAY_PERIOD_RULES: PeriodRule[] = [
  {
    pattern: new RegExp(`(?:^|[\\s,(]|(?=${PERIOD_MONTH_CONTEXT}|เดือน))(?:(from|${PERIOD_MONTH_CONTEXT})\\s*)?(เดือน\\s*|month\\s*)?${MONTH_RANGE_ENDPOINT}\\s*(${PERIOD_RANGE_CONNECTOR}|กับ|และ)\\s*(เดือน\\s*|month\\s*)?${MONTH_RANGE_ENDPOINT}(?=$|\\s|[),.!?]|ค่ะ|ครับ|ให้|บ้าง)`, 'giu'),
    build: monthRange,
  },
  {
    pattern: new RegExp(`${PERIOD_MONTH_LEAD}(${PERIOD_ALL_MONTH_ALTERNATION})\\s*(ปี(?:ที่แล้ว|ก่อน|นี้)|ที่ผ่านมา)`, 'giu'),
    build: (m, today) => {
      if (m[2] === 'ที่ผ่านมา') return namedMonth(m[1]!, undefined, today);
      const month = periodMonthFromName(m[1]!);
      const year = Number(today.slice(0, 4)) - Number(m[2] !== 'ปีนี้');
      return month ? [monthReading(year, month, '', 'named_month', [])] : [];
    },
  },
  { pattern: /ครึ่งปี(ที่ผ่านมา|ย้อนหลัง|ล่าสุด)/gu, build: (m, today) => completeUnits(6, 'เดือน', today, m[1]!) },
  {
    pattern: /(?:ตั้งแต่ต้นเดือน(?:นี้)?(?:\s*ถึง(?:วันนี้|ตอนนี้|ปัจจุบัน))?|ต้นเดือนนี้\s*ถึง(?:วันนี้|ตอนนี้|ปัจจุบัน))(?!(?:นี้|ที่แล้ว|ก่อน|หน้า)|\s*(?:\d|ถึง))/gu,
    build: (_m, today) => monthsAgo(0, today, 'เดือนนี้'),
  },
  {
    pattern: /(?:ตั้งแต่ต้นปี(?:นี้)?(?:\s*ถึง(?:วันนี้|ตอนนี้|ปัจจุบัน))?|ต้นปี(?:นี้)?\s*ถึง(?:วันนี้|ตอนนี้|ปัจจุบัน)|\byear\s+to\s+date\b|\bytd\b)(?!(?:นี้|ที่แล้ว|ก่อน|หน้า)|\s*(?:\d|ถึง))/giu,
    build: (_m, today) => yearsAgo(0, today, 'ปีนี้'),
  },
  {
    pattern: new RegExp(`วันที่\\s*(\\d{1,2})\\s*(?:-|–|—|~|ถึง)\\s*(\\d{1,2})(?!\\d)(?:\\s*เดือน(นี้|ที่แล้ว|ที่ผ่านมา|ล่าสุด|ย้อนหลัง|ก่อนหน้า(?:นี้)?|ก่อน)|(?!\\s*(?:[/\\d]|เดือน|${PERIOD_ALL_MONTH_ALTERNATION})))`, 'giu'),
    build: (m, today) => {
      const base = monthsAgo(m[3] && m[3] !== 'นี้' ? 1 : 0, today, '')[0]!;
      const year = Number(base.fromDate.slice(0, 4)), month = Number(base.fromDate.slice(5, 7));
      const from = toIsoDate(Number(m[1]), month, year), to = toIsoDate(Number(m[2]), month, year);
      return from && to ? rangeReading(from, to, []) : [];
    },
  },
  {
    pattern: new RegExp(`(?<!เสาร์)(?:(${PERIOD_COUNT_PATTERN})\\s*)?(เดือน|สัปดาห์|อาทิตย์|วีค|ไตรมาส|ปี)\\s*(ที่ผ่านมา|ล่าสุด|ย้อนหลัง|ก่อนหน้า(?:นี้)?|หลัง(?:สุด)?)`, 'gu'),
    fuzzyGuard: true,
    build: (m, today) => m[2] !== 'เดือน' && /^(?:ก่อนหน้า|หลัง)/u.test(m[3]!) ? null
      : completeUnits(periodCount(m[1]), m[2]!, today, m[3]!),
  },
  {
    pattern: new RegExp(`ย้อนหลัง\\s*(${PERIOD_COUNT_PATTERN})\\s*(เดือน|สัปดาห์|อาทิตย์|วีค|ไตรมาส|ปี)`, 'gu'),
    build: (m, today) => completeUnits(periodCount(m[1]), m[2]!, today, 'ย้อนหลัง'),
  },
  {
    pattern: /\b(?:last|past|previous)\s+(\d+)\s+(months?|weeks?|quarters?|years?)\b/gi,
    build: (m, today) => completeUnits(Number(m[1]), m[2]!, today, 'ล่าสุด'),
  },
  // Consume an approximate/unsupported count before "this unit" instead of reading only its suffix.
  { pattern: new RegExp(`${PERIOD_COUNT_PATTERN}\\s*(?:เดือน|สัปดาห์|อาทิตย์|วีค|ปี|ไตรมาส)นี้`, 'gu'),
    // ภ.ง.ด.53 เดือนนี้: 53 names the form, not a count of months.
    build: m => /(?:ภ\.?\s*ง\.?\s*ด\.?|pnd)\s*$/iu.test((m.input ?? '').slice(0, m.index ?? 0)) ? null : [] },
];

/** Ordered most-specific first; an earlier rule's span blocks any later overlapping match, exactly
 *  like the date extractor above (so "3 วันก่อน" is never also read as "วันก่อน"). */
// "ตั้งแต่ <วัน เดือน>" or "ตั้งแต่เดือน <เดือน>" with no end named means up to today (controller, 2026-10-05:
// read as the whole month, "ตั้งแต่ 15 ก.ย." silently answered for 1–30 ก.ย.). After every range rule, so a
// range that names its end keeps its span; before the single-month rules, which would read only the month.
const SINCE_TAIL = '(?:\\s*(?:จนถึง|ถึง|ยัน)\\s*(?:วันนี้|ตอนนี้|ปัจจุบัน))?(?=$|\\s|[),.!?]|ค่ะ|ครับ|ให้|บ้าง|เป็นต้นมา|มา)';
const SINCE_RULES: PeriodRule[] = [
  {
    pattern: new RegExp(`(?:ตั้งแต่|นับจาก|\\bsince\\b)\\s*${NAMED_DAY_ENDPOINT}${SINCE_TAIL}`, 'giu'),
    blocksDateRanges: true,
    build: (m, today) => {
      const first = namedDayBounds(m[1]!, m[2], m[3]!, m[4], today);
      return first ? rangeReading(first.date, today, first.assumptions) : null;
    },
  },
  {
    pattern: new RegExp(`(?:ตั้งแต่|นับจาก|\\bsince\\b)\\s*(?:เดือน\\s*|month\\s*)?(${PERIOD_ALL_MONTH_ALTERNATION})(?:\\s*(?:ปี\\s*|year\\s*)?['’]?(\\d{4}|\\d{2})(?!\\d))?${SINCE_TAIL}`, 'giu'),
    build: (m, today) => {
      // `may` is also an ordinary English word: it names a month here only with its year.
      if (/^may\.?$/i.test(m[1]!) && !m[2]) return null;
      const month = namedMonth(m[1]!, m[2], today)[0];
      return month && month.fromDate <= today ? rangeReading(month.fromDate, today, month.assumptions) : null;
    },
  },
];

const PERIOD_RULES: PeriodRule[] = [
  ...DAY_RANGE_RULES,
  ...EVERYDAY_PERIOD_RULES,
  ...SINCE_RULES,
  // ── single days ───────────────────────────────────────────────────────────
  { pattern: /(?:เมื่อ)?วานซืน/gu, build: (_m, today) => singleDay(shiftDays(today, -2), 'เมื่อวานซืน') },
  { pattern: /day\s*before\s*yesterday/gi, build: (_m, today) => singleDay(shiftDays(today, -2), 'เมื่อวานซืน') },
  // ── N last days (before the N-days-ago day rule: "3 วันที่ผ่านมา" is a window, not one day) ──
  {
    pattern: new RegExp(`(${PERIOD_COUNT_PATTERN})\\s*วัน(?:ที่ผ่านมา|ล่าสุด|ย้อนหลัง)`, 'gu'),
    build: (m, today) => lastNDays(periodCount(m[1]), today),
  },
  {
    pattern: /(?:last|past)\s*(\d{1,3})\s*days?/gi,
    build: (m, today) => lastNDays(periodCount(m[1]), today),
  },
  // ── N days ago (one day) ─────────────────────────────────────────────────
  {
    pattern: new RegExp(`(${PERIOD_COUNT_PATTERN})\\s*วัน(?:ก่อน|ที่แล้ว)`, 'gu'),
    build: (m, today) => {
      const n = periodCount(m[1]);
      return n >= 1 && n <= MAX_RELATIVE_DAYS ? singleDay(shiftDays(today, -n), `${n} วันก่อน`) : [];
    },
  },
  {
    pattern: /(\d{1,3})\s*days?\s*ago/gi,
    build: (m, today) => {
      const n = periodCount(m[1]);
      return n >= 1 && n <= MAX_RELATIVE_DAYS ? singleDay(shiftDays(today, -n), `${n} วันก่อน`) : [];
    },
  },
  { pattern: /เมื่อวาน(?:นี้)?(?:ตอน|ช่วง)?(?:เช้า|กลางวัน|บ่าย|เย็น|ค่ำ|คืน)?|เมื่อคืน(?:นี้)?/gu, build: (_m, today) => singleDay(shiftDays(today, -1), 'เมื่อวาน') },
  { pattern: /\byesterday(?:\s+(?:morning|afternoon|evening|night))?\b|\blast\s+night\b/gi, build: (_m, today) => singleDay(shiftDays(today, -1), 'เมื่อวาน') },
  // Owner list 2026-09-18: "วันก่อน" must be interpreted, and yesterday is the only reading a read
  // can act on — recorded as an assumption so an answer can say it was read, not stated.
  {
    pattern: /วันก่อน/gu,
    build: (_m, today) => singleDay(shiftDays(today, -1), 'วันก่อน', [PERIOD_ASSUMPTIONS.dayBeforeReadAsYesterday]),
  },
  { pattern: /วัน(?:นี้|นี่)(?:ตอน|ช่วง)?(?:เช้า|กลางวัน|บ่าย|เย็น|ค่ำ|คืน)?|เมื่อ(?:เช้า|กลางวัน|บ่าย|เย็น|ค่ำ)|ตะกี้|เมื่อกี้|คืนนี้/gu, fuzzyGuard: true, build: (_m, today) => singleDay(today, 'วันนี้') },
  { pattern: /\btoday\b/gi, build: (_m, today) => singleDay(today, 'วันนี้') },
  { pattern: /\bthis\s+(?:morning|afternoon|evening)\b|\bjust\s+now\b|\btonight\b/gi, build: (_m, today) => singleDay(today, 'วันนี้') },
  // ── weeks (Monday–Sunday) ────────────────────────────────────────────────
  {
    pattern: new RegExp(`(${PERIOD_COUNT_PATTERN})\\s*(?:สัปดาห์|อาทิตย์|วีค)(?:ที่แล้ว|ก่อน)`, 'gu'),
    build: (m, today) => weeksAgo(periodCount(m[1]), today, `${periodCount(m[1])} สัปดาห์ที่แล้ว`),
  },
  {
    pattern: /(\d{1,2})\s*weeks?\s*ago/gi,
    build: (m, today) => weeksAgo(periodCount(m[1]), today, `${periodCount(m[1])} สัปดาห์ที่แล้ว`),
  },
  {
    pattern: /(?:สัปดาห์|อาทิตย์|วีค)(?:ที่แล้ว|ก่อน)/gu,
    fuzzyGuard: true,
    build: (_m, today) => weeksAgo(1, today, 'สัปดาห์ที่แล้ว'),
  },
  { pattern: /last\s*week/gi, build: (_m, today) => weeksAgo(1, today, 'สัปดาห์ที่แล้ว') },
  { pattern: /(?:สัปดาห์|อาทิตย์|วีค)นี้/gu, fuzzyGuard: true, build: (_m, today) => weeksAgo(0, today, 'สัปดาห์นี้') },
  { pattern: /this\s*week/gi, build: (_m, today) => weeksAgo(0, today, 'สัปดาห์นี้') },
  // ── months ───────────────────────────────────────────────────────────────
  {
    pattern: new RegExp(`(${PERIOD_COUNT_PATTERN})\\s*เดือน(?:ที่แล้ว|ก่อน)`, 'gu'),
    build: (m, today) => monthsAgo(periodCount(m[1]), today, `${periodCount(m[1])} เดือนที่แล้ว`),
  },
  {
    pattern: /(\d{1,2})\s*months?\s*ago/gi,
    build: (m, today) => monthsAgo(periodCount(m[1]), today, `${periodCount(m[1])} เดือนที่แล้ว`),
  },
  { pattern: /(?:เดือน|ด\.\s*)(?:ที่แล้ว|ก่อน)/gu, fuzzyGuard: true, build: (_m, today) => monthsAgo(1, today, 'เดือนที่แล้ว') },
  { pattern: /(?:last|previous)\s*month|\b(?:the\s+)?month\s+before\b/gi, build: (_m, today) => monthsAgo(1, today, 'เดือนที่แล้ว') },
  { pattern: /(?:เดือน|ด\.\s*)นี้/gu, fuzzyGuard: true, build: (_m, today) => monthsAgo(0, today, 'เดือนนี้') },
  { pattern: /this\s*month/gi, build: (_m, today) => monthsAgo(0, today, 'เดือนนี้') },
  {
    pattern: /(?:เดือน|\bmonth\b)\s*(\d{1,2}(?:(?:\s*,\s*|\s*(?:และ|and)\s*|\s+)\d{1,2})+)(?!\d)(?:\s*(?:ปี|year)\s*['’]?(\d{2,4})|\s+(\d{4}))?(?=$|\s|[),/.!?])/giu,
    build: (m, today) => {
      const months = m[1]!.match(/\d{1,2}/g)?.map(Number) ?? [];
      if (months.some((month) => month < 1 || month > 12)) return [];
      const english = /\bmonth\b/i.test(m[0]);
      return months.flatMap((month) => numberedMonth(month, m[2] ?? m[3], today, english));
    },
  },
  {
    pattern: /(เดือน|\bmonth\b)\s*(\d{1,2})(?!\d)(?:\s*(?:ปี|year)\s*['’]?(\d{2,4})|\s+(\d{4}))?(?=$|\s|และ|[),/.!?])/giu,
    build: (m, today) => numberedMonth(Number(m[2]), m[3] ?? m[4], today, /^month$/i.test(m[1]!)),
  },
  // ── quarters (calendar, never fiscal) ────────────────────────────────────
  {
    // "ไตรมาสสาม", "ไตรมาสแรก": the quarter counted in words.
    pattern: /ไตรมาส\s*(?:ที่\s*)?(หนึ่ง|แรก|สอง|สาม|สี่)(?:\s*(?:ปี\s*)?['’]?(\d{2,4})(?!\d))?/gu,
    build: (m, today) => namedQuarter(['หนึ่ง', 'สอง', 'สาม', 'สี่'].indexOf(m[1] === 'แรก' ? 'หนึ่ง' : m[1]!) + 1, m[2], today),
  },
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
    pattern: new RegExp(`เดือน\\s*(${PERIOD_SHORT_MONTH_ALTERNATION})\\.?\\s*(?:ปี\\s*)?['’]?(\\d{2,4})?${PERIOD_SHORT_MONTH_END}`, 'giu'),
    build: (m, today) => namedMonth(m[1]!, m[2], today),
  },
  {
    pattern: new RegExp(`(?:^|\\s|[,(/\\-–]|และ\\s*|กับ\\s*|เทียบ\\s*|สรุป|${PERIOD_MONTH_CONTEXT})(${PERIOD_SHORT_MONTH_ALTERNATION})\\.?\\s*(?:ปี\\s*)?['’]?(\\d{2,4})?${PERIOD_SHORT_MONTH_END}`, 'giu'),
    build: (m, today) => namedMonth(m[1]!, m[2], today),
  },
  {
    pattern: new RegExp(`(${PERIOD_MONTH_ALTERNATION})\\s*(?:ปี\\s*)?['’]?(\\d{2,4})`, 'giu'),
    build: (m, today) => namedMonth(m[1]!, m[2], today),
  },
  {
    pattern: /(?:เดือน|\bmonth\b)\s*(may\.?)(?=$|\s|และ|[),/.!?])/giu,
    build: (m, today) => namedMonth(m[1]!, undefined, today),
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
  // "เดือนมกราปี 2568": a year written straight after a spoken month name is that month's year, read by the
  // spoken-month rules below — never a whole-year period of its own.
  // "พ.ศ. 2568", "ปี ค.ศ. 2025": the era is stated, so nothing is assumed about it.
  {
    pattern: /(?:ปี\s*)?(พ\.?\s?ศ\.?|ค\.?\s?ศ\.?)\s*(\d{4})(?!\d)/gu,
    build: (m, today) => {
      const year = Number(m[2]), yearBe = m[1]!.startsWith('พ') ? year : year + BE_CE_OFFSET;
      return yearBe >= 2400 && yearBe <= 2700 ? namedYear(String(yearBe), today) : [];
    },
  },
  { pattern: new RegExp(`(?<!(?:${PERIOD_SPOKEN_MONTH_ALTERNATION})\\s*)(?:ปี|year)\\s*['’]?(\\d{2,4})`, 'giu'), build: (m, today) => namedYear(m[1]!, today) },  // "ทั้งปี" with no year named is this year (a named or relative year was read by the rules above).
  { pattern: /(?<!(?:ปีนี้|ปีที่แล้ว|ปีก่อน|\d)\s*)ทั้งปี(?!\s*(?:['’]?\d|พ\.?\s?ศ|ค\.?\s?ศ))/gu, build: (_m, today) => yearsAgo(0, today, 'ปีนี้') },
];

/**
 * Spoken month names (THAI_SPOKEN_MONTHS), applied AFTER the full-name typo pass so "เดือนสิงหาคาม 2568" stays the
 * corrected full name with its year. After เดือน any word may follow — Thai writes no spaces, so "เดือนสิงหาละ" and
 * "เดือนสิงหาจ่ายไปเท่าไหร่" are the normal shape — but never the rest of the full name. Without เดือน only between
 * clear boundaries ("แล้วสิงหาล่ะ", "ของสิงหา", "สิงหา 69"), so a given name or a longer word that merely starts like
 * one (น้องกันยา, ตุลาการ) never becomes a month.
 */
const SPOKEN_MONTH_PERIOD_RULES: PeriodRule[] = [
  {
    pattern: new RegExp(`เดือน\\s*(${PERIOD_SPOKEN_MONTH_ALTERNATION})${FULL_MONTH_NAME_REST}(?:\\s*(?:ปี\\s*)?['’]?(\\d{2,4}))?(?!\\d)`, 'giu'),
    build: (m, today) => namedMonth(m[1]!, m[2], today),
  },
  {
    // NAT-09 ("ช่วยสรุปรายจ่ายสิงหาให้หน่อย"): a money noun right before the name and ให้ right after it are
    // boundaries too — a name or a longer word (ค่าจ้างคุณกันยา, รายจ่ายตุลาการ) still never matches.
    pattern: new RegExp(`(?:^|\\s|[,(]|และ\\s*|แล้ว|ของ|รายจ่าย|ค่าใช้จ่าย|ยอดขาย|ยอด|เทียบ|สรุป|(?<=(?:${PERIOD_ALL_MONTH_ALTERNATION})\\s*)กับ\\s*)(${PERIOD_SPOKEN_MONTH_ALTERNATION})${FULL_MONTH_NAME_REST}(?:\\s*(?:ปี\\s*)?['’]?(\\d{2,4}))?(?=$|\\s|และ|กับ|เทียบ|[),/.!?]|ล่ะ|ละ|นะ|คะ|ค่ะ|ครับ|บ้าง|หน่อย|ให้)`, 'giu'),
    build: (m, today) => namedMonth(m[1]!, m[2], today),
  },
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
  source: LineAiPeriodSource,
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

function namedYear(rawYear: string, todayIso: string): PeriodReading[] {
  return periodYearReadings(Number(rawYear), rawYear.length === 2 ? 2 : 4, todayIso).map((reading) => ({
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
  return periodYearReadings(Number(rawYear), rawYear.length === 2 ? 2 : 4, todayIso).map((reading) => ({
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

function namedPeriodYearReadings(monthName: string, rawYear: string, todayIso: string): YearReading[] {
  const readings = periodYearReadings(Number(rawYear), rawYear.length, todayIso);
  if (rawYear.length !== 2) return readings;
  const named = resolveNamedMonthYearReadings(monthName, Number(rawYear), 2)[0];
  return readings.map(reading => named?.yearCe === reading.yearCe ? named : reading);
}

function namedMonth(monthName: string, rawYear: string | undefined, todayIso: string): PeriodReading[] {
  const month = periodMonthFromName(monthName);
  if (!month) return [];
  if (!rawYear) {
    return [monthReading(latestNonFutureYear(month, todayIso), month, '', 'named_month',
      [PERIOD_ASSUMPTIONS.yearAssumedLatest])];
  }
  return namedPeriodYearReadings(monthName, rawYear, todayIso)
    .map((reading) => monthReading(reading.yearCe, month, '', 'named_month', reading.assumptions));
}

function numberedMonth(month: number, rawYear: string | undefined, todayIso: string, english: boolean): PeriodReading[] {
  if (month < 1 || month > 12) return [];
  const name = (english ? ENGLISH_MONTHS : FULL_THAI_MONTH_NAMES).find(([, value]) => value === month)?.[0];
  return name ? namedMonth(name, rawYear, todayIso) : [];
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
    ? namedPeriodYearReadings(monthName, rawYear, todayIso)
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
  firstRawYear?: string,
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
  const yearReadings = rawYear ? periodYearReadings(Number(rawYear), rawYear.length === 2 ? 2 : 4, todayIso) : [];
  const readings = rawYear
    ? yearReadings
      .map((reading) => ({ yearCe: reading.yearCe, assumptions: reading.assumptions }))
    : [{
        yearCe: latestNonFutureYear(end.month, todayIso),
        assumptions: [PERIOD_ASSUMPTIONS.yearAssumedLatest],
      }];
  return readings.flatMap((reading) => {
    const firstYears = firstRawYear ? periodYearReadings(Number(firstRawYear), firstRawYear.length, todayIso)
      : [{ yearCe: reading.yearCe, assumptions: [] }];
    return firstYears.flatMap((first) => {
      const from = toIsoDate(start.day, start.month, first.yearCe);
      const to = toIsoDate(end.day, end.month, reading.yearCe);
      return from && to ? rangeReading(from, to,
        [...new Set([...orderAssumptions, ...first.assumptions, ...reading.assumptions])]) : [];
    });
  });
}

/** `1/9/68 ถึง 15/9/68` and `2026-09-01 – 2026-09-15`: two unambiguous DATE candidates the extractor
 *  already read, separated by a range marker in the source text (spec §3.1 "ใช้ date candidate เดิม
 *  2 ตัวที่ไม่กำกวม"). Month-period boundaries are excluded — those are not stated days. */
const RANGE_MARKER = /^\s*(?:-|–|—|~|ถึง|to)\s*$/u;
function dateCandidateRanges(text: string, dates: LineAiDateCandidate[], scan?: CandidateScan): Array<{ span: string; reading: PeriodReading; start: number; end: number }> {
  const usable = dates.filter((date) => !isAmbiguousDateCandidate(date)
    && !date.assumptions.includes(VALUE_ASSUMPTIONS.monthPeriodBoundary)).sort((a, b) => (scan?.datePositions.get(a)?.start ?? 0) - (scan?.datePositions.get(b)?.start ?? 0));
  const out: Array<{ span: string; reading: PeriodReading; start: number; end: number }> = [];
  for (let i = 0; i + 1 < usable.length; i += 1) {
    const left = usable[i]!;
    const right = usable[i + 1]!;
    const leftStart = scan?.datePositions.get(left)?.start ?? text.indexOf(left.span);
    if (leftStart < 0) continue;
    const gapStart = leftStart + left.span.length;
    const gapEnd = scan?.datePositions.get(right)?.start ?? text.indexOf(right.span, gapStart);
    if (gapEnd < 0 || !RANGE_MARKER.test(text.slice(gapStart, gapEnd))) continue;
    const [from, to] = left.isoDate <= right.isoDate ? [left.isoDate, right.isoDate] : [right.isoDate, left.isoDate];
    const span = text.slice(leftStart, gapEnd + right.span.length);
    for (const reading of rangeReading(from, to, [...new Set([...left.assumptions, ...right.assumptions])])) {
      out.push({ span, reading, start: leftStart, end: gapEnd + right.span.length });
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
  scan?: CandidateScan,
  options: { allowFuture?: boolean; dateRanges?: SpanRange[] } = {},
): LineAiPeriodCandidate[] {
  if (!CIVIL_DATE_PATTERN.test(todayIso)) return [];
  const mapped = mapThaiDigits(text);
  const used: SpanRange[] = [];
  const dayRangeSpans: SpanRange[] = [];
  const out: LineAiPeriodCandidate[] = [];

  const push = (span: string, reading: PeriodReading, start: number, end: number): void => {
    // A day owns its month token, including an invalid day; month-only reads and ranges stay intact.
    if (reading.kind === 'month' && options.dateRanges?.some(range => start >= range.start && end <= range.end)
      && !dates.some(date => date.assumptions.includes(VALUE_ASSUMPTIONS.monthPeriodBoundary)
        && (scan?.datePositions.get(date)?.start ?? text.indexOf(date.span)) <= start
        && (scan?.datePositions.get(date)?.end ?? text.indexOf(date.span) + date.span.length) >= end)) return;
    if (!options.allowFuture && reading.fromDate > todayIso) return; // ordinary reads have no future data
    const clamped = !options.allowFuture && reading.toDate > todayIso;
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
    scan?.observe('period', candidate, start, end);
    if (!scan && out.some((existing) => existing.kind === candidate.kind
      && existing.fromDate === candidate.fromDate
      && existing.toDate === candidate.toDate
      && existing.span === candidate.span)) return;
    out.push(candidate);
  };

  const applyRules = (rules: readonly PeriodRule[]): void => { for (const rule of rules) {
    for (const match of mapped.matchAll(rule.pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (overlaps(used, start, end)) continue;
      if (rule.fuzzyGuard && fuzzyQualified(mapped, start)) continue;
      // The span is consumed even when the rule produced nothing: a phrase this resolver RECOGNISED
      // but could not pin down (e.g. "25 เดือนที่แล้ว", past the N ceiling) must not then be re-read
      // by a looser rule as plain "เดือนที่แล้ว". No candidate means the tool's default period, and
      // the answer says which period that was.
      const readings = rule.build(match, todayIso);
      if (rule.blocksDateRanges) dayRangeSpans.push({ start, end });
      if (readings === null) continue;
      used.push({ start, end });
      for (const reading of readings) push(text.slice(start, end), reading, start, end);
    }
  } };
  applyRules(PERIOD_RULES);
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
      }, start, end);
    }
  }
  applyRules(SPOKEN_MONTH_PERIOD_RULES);
  for (const found of dateCandidateRanges(text, dates, scan)) {
    if (!overlaps(dayRangeSpans, found.start, found.end)) push(found.span, found.reading, found.start, found.end);
  }

  return scan ? out : out.sort((a, b) => text.indexOf(a.span) - text.indexOf(b.span)).slice(0, MAX_PERIOD_CANDIDATES);
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

/** V2 annotates complete original inputs; it never promotes a legacy truncated candidate list. */
export type LineAiValueCandidatesV2 = {
  version: 2;
  inputDigest: string;
  extractorVersion: 'value-v2';
  todayIso: string;
  completeness: 'complete' | 'overflow';
  counts: { amounts: number; dates: number; periods: number };
  amounts: Array<LineAiAmountCandidate & { candidateId: string; source: LineAiSourceRefV2 }>;
  dates: Array<LineAiDateCandidate & { candidateId: string; source: LineAiSourceRefV2 }>;
  periods: Array<LineAiPeriodCandidate & { candidateId: string; source: LineAiSourceRefV2; periodSource: LineAiPeriodSource }>;
};

export const LINE_AI_VALUE_CANDIDATES_V2_LIMITS = { amounts: 128, dates: 64, periods: 32, utf8Bytes: 49_152 } as const;
type CandidateKind = 'amount' | 'date' | 'period';
type ValueCandidate = LineAiAmountCandidate | LineAiDateCandidate | LineAiPeriodCandidate;
type CandidateScan = {
  observe(kind: CandidateKind, candidate: ValueCandidate, start: number, end: number): void;
  datePositions: WeakMap<LineAiDateCandidate, SpanRange>;
};

function canonicalDecimal(value: string): string | null {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return null;
  const [integer, decimal] = value.split('.');
  const whole = integer!.replace(/^0+(?=\d)/u, '');
  const fraction = decimal?.replace(/0+$/u, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Money words use integer arithmetic even beyond Number.MAX_SAFE_INTEGER. */
function evaluateWordTokensExact(tokens: WordToken[]): string | null {
  let total = 0n, pending = 0n;
  for (const token of tokens) {
    const value = BigInt(token.value);
    if (token.kind === 'unit') { pending += value; continue; }
    const figure = pending === 0n ? 1n : pending;
    total = value >= 1_000_000n ? (total + figure) * value : total + figure * value;
    pending = 0n;
  }
  return tokens.length ? String(total + pending) : null;
}

function candidateCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(candidateCanonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${candidateCanonicalJson(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

async function candidateHash(value: string): Promise<string> {
  const bytes = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalReading(kind: CandidateKind, candidate: ValueCandidate): string {
  if (kind === 'amount') return (candidate as LineAiAmountCandidate).value;
  if (kind === 'date') return (candidate as LineAiDateCandidate).isoDate;
  const period = candidate as LineAiPeriodCandidate;
  return candidateCanonicalJson([period.kind, period.fromDate, period.toDate, period.monthKey ?? null]);
}

/** Full scan with original UTF-16 coordinates, followed by all-or-nothing bounded encoding. */
export async function extractValueCandidatesV2(input: LineAiInputEvidenceV2, todayIso: string): Promise<LineAiValueCandidatesV2 | undefined> {
  const evidence = await verifyLineAiInputEvidence(input, input.parts.map(part => part.rawText).join('\n'));
  if (!evidence || !/^\d{4}-\d{2}-\d{2}$/u.test(todayIso)
    || toIsoDate(Number(todayIso.slice(8)), Number(todayIso.slice(5, 7)), Number(todayIso.slice(0, 4))) !== todayIso) return undefined;
  const found: Array<{ kind: CandidateKind; candidate: ValueCandidate; part: number; source: LineAiSourceRefV2; reading: string; tuple: string }> = [];
  for (const [partIndex, part] of evidence.parts.entries()) {
    extractValueCandidates(part.rawText, todayIso, { scan: {
      datePositions: new WeakMap(),
      observe(kind, candidate, start, end) {
        const source = { partId: part.partId, startUtf16: start, endUtf16: end, rawSha256: part.rawSha256 };
        const reading = canonicalReading(kind, candidate);
        const tuple = candidateCanonicalJson([evidence.joinedSha256, kind, part.partId, start, end, reading, 'value-v2']);
        found.push({ kind, candidate, part: partIndex, source, reading, tuple });
      },
    } });
  }
  found.sort((a, b) => a.part - b.part || a.source.startUtf16 - b.source.startUtf16 || a.source.endUtf16 - b.source.endUtf16
    || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (a.reading < b.reading ? -1 : a.reading > b.reading ? 1 : 0));
  const unique = found.filter((item, index) => index === 0 || item.tuple !== found[index - 1]!.tuple);
  const counts = { amounts: unique.filter(item => item.kind === 'amount').length, dates: unique.filter(item => item.kind === 'date').length,
    periods: unique.filter(item => item.kind === 'period').length };
  const result: LineAiValueCandidatesV2 = { version: 2, inputDigest: evidence.joinedSha256, extractorVersion: 'value-v2', todayIso,
    completeness: 'complete', counts, amounts: [], dates: [], periods: [] };
  const overflow = () => ({ ...result, completeness: 'overflow' as const, amounts: [], dates: [], periods: [] });
  if (counts.amounts > 128 || counts.dates > 64 || counts.periods > 32 || unique.some(item => item.candidate.span.length > 160)) return overflow();
  for (const item of unique) {
    const candidateId = await candidateHash(item.tuple);
    if (item.kind === 'amount') result.amounts.push({ ...item.candidate as LineAiAmountCandidate, candidateId, source: item.source });
    else if (item.kind === 'date') result.dates.push({ ...item.candidate as LineAiDateCandidate, candidateId, source: item.source });
    else {
      const period = item.candidate as LineAiPeriodCandidate;
      result.periods.push({ ...period, periodSource: period.source as LineAiPeriodSource, candidateId, source: item.source });
    }
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > LINE_AI_VALUE_CANDIDATES_V2_LIMITS.utf8Bytes) return overflow();
  // Reuse existing canonical field rules, including max decimal length, rather than loosen v2.
  if (!parseLineAiValueCandidatesV2(result, evidence.parts.map(part => part.rawText).join('\n'), evidence)) return overflow();
  return result;
}

/** Structural parse only; every receiver must additionally re-extract through the async verifier. */
export function parseLineAiValueCandidatesV2(value: unknown, messageText: string, evidence?: LineAiInputEvidenceV2): LineAiValueCandidatesV2 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const allowed = ['version', 'inputDigest', 'extractorVersion', 'todayIso', 'completeness', 'counts', 'amounts', 'dates', 'periods'];
  if (Object.keys(raw).some(key => !allowed.includes(key)) || allowed.some(key => !(key in raw)) || raw['version'] !== 2
    || raw['extractorVersion'] !== 'value-v2' || typeof raw['inputDigest'] !== 'string' || !/^[0-9a-f]{64}$/u.test(raw['inputDigest'])
    || typeof raw['todayIso'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(raw['todayIso'])
    || toIsoDate(Number(raw['todayIso'].slice(8)), Number(raw['todayIso'].slice(5, 7)), Number(raw['todayIso'].slice(0, 4))) !== raw['todayIso']
    || !['complete', 'overflow'].includes(String(raw['completeness'])) || !raw['counts'] || typeof raw['counts'] !== 'object'
    || Array.isArray(raw['counts']) || new TextEncoder().encode(JSON.stringify(value)).byteLength > 49_152) return undefined;
  const counts = raw['counts'] as Record<string, unknown>;
  if (Object.keys(counts).length !== 3 || !['amounts', 'dates', 'periods'].every(key => Number.isSafeInteger(counts[key]) && Number(counts[key]) >= 0 && Number(counts[key]) <= 48_000)) return undefined;
  const ids = new Set<string>();
  for (const key of ['amounts', 'dates', 'periods'] as const) {
    const items = raw[key];
    if (!Array.isArray(items) || items.length > LINE_AI_VALUE_CANDIDATES_V2_LIMITS[key]
      || (raw['completeness'] === 'overflow' ? items.length !== 0 : items.length !== counts[key])) return undefined;
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.candidateId !== 'string'
        || !/^[0-9a-f]{64}$/u.test(item.candidateId) || ids.has(item.candidateId) || !item.source || typeof item.source !== 'object'
        || Array.isArray(item.source)) return undefined;
      ids.add(item.candidateId);
      const source = item.source as Record<string, unknown>;
      if (Object.keys(source).length !== 4 || typeof source['partId'] !== 'string' || !/^[\x21-\x7e]{1,128}$/u.test(source['partId'])
        || !Number.isSafeInteger(source['startUtf16']) || !Number.isSafeInteger(source['endUtf16']) || Number(source['startUtf16']) < 0
        || Number(source['endUtf16']) <= Number(source['startUtf16']) || Number(source['endUtf16']) > 12_000
        || typeof source['rawSha256'] !== 'string' || !/^[0-9a-f]{64}$/u.test(source['rawSha256'])
        || evidence && validateLineAiSourceRefV2(source, evidence) !== item.span) return undefined;
      const legacy = { ...item, ...(key === 'periods' ? { source: item.periodSource } : {}) };
      if (!parseLineAiValueCandidates({ amounts: key === 'amounts' ? [legacy] : [], dates: key === 'dates' ? [legacy] : [],
        periods: key === 'periods' ? [legacy] : [] }, messageText)) return undefined;
      const keys = key === 'amounts' ? ['span', 'value', 'currencyToken', 'assumptions', 'candidateId', 'source']
        : key === 'dates' ? ['span', 'day', 'month', 'yearBe', 'isoDate', 'assumptions', 'candidateId', 'source']
          : ['span', 'kind', 'fromDate', 'toDate', 'monthKey', 'periodSource', 'source', 'label', 'assumptions', 'candidateId'];
      if (Object.keys(item).some(field => !keys.includes(field))) return undefined;
    }
  }
  if (evidence && raw['inputDigest'] !== evidence.joinedSha256) return undefined;
  return value as LineAiValueCandidatesV2;
}

/** Reject missing readings, shifted duplicate spans, tampered values and false overflow claims. */
export async function verifyLineAiValueCandidatesV2(value: unknown, evidence: LineAiInputEvidenceV2): Promise<LineAiValueCandidatesV2 | undefined> {
  const parsed = parseLineAiValueCandidatesV2(value, evidence.parts.map(part => part.rawText).join('\n'), evidence);
  if (!parsed) return undefined;
  const extracted = await extractValueCandidatesV2(evidence, parsed.todayIso);
  return extracted && candidateCanonicalJson(extracted) === candidateCanonicalJson(parsed) ? parsed : undefined;
}
