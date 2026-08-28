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

export type LineAiValueCandidates = {
  amounts: LineAiAmountCandidate[];
  dates: LineAiDateCandidate[];
};

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

/** True when the candidate needs discovery before any auto-capture use. */
export function isAmbiguousDateCandidate(candidate: LineAiDateCandidate): boolean {
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
  ['กรกฎาคม', 7], ['สิงหาคม', 8], ['กันยายน', 9], ['ตุลาคม', 10], ['พฤศจิกายน', 11], ['ธันวาคม', 12],
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

function plausibleEraReadings(readings: YearReading[], todayIso: string): YearReading[] {
  if (readings.length <= 1) return readings;
  const todayYear = Number(todayIso.slice(0, 4));
  if (!Number.isFinite(todayYear)) return readings;
  const plausible = readings.filter((r) => r.yearCe <= todayYear && r.yearCe >= todayYear - PLAUSIBLE_EXPENSE_YEARS_BACK);
  if (plausible.length !== 1) return readings;
  return [{ ...plausible[0]!, assumptions: [VALUE_ASSUMPTIONS.twoDigitYearResolvedPlausibleEra] }];
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

/** Extracts amount and date candidates from one LINE turn text. `todayIso` (Asia/Bangkok)
 *  is injected so future dates can be flagged; extraction itself never reads the clock. */
export function extractValueCandidates(text: string, todayIso?: string): LineAiValueCandidates {
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
    const eraResolved = todayIso && orderAssumptions.length === 0
      ? plausibleEraReadings(yearReadings, todayIso)
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

  return {
    amounts: amounts.slice(0, MAX_AMOUNT_CANDIDATES),
    dates: dates.slice(0, MAX_DATE_CANDIDATES),
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
