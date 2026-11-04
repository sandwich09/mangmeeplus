/**
 * Absolute-date placeholders for a turn's `user` text (spec §7 R-U3: month names, Buddhist-era
 * years). A real customer types "สิงหาคม 2569", never a relative token — but the corpus must stay
 * valid on any future run date, so the literal words live nowhere in the JSON. A turn's `user`
 * text holds `{{placeholder}}` markers instead, and `renderUserText` fills them in at run time
 * from the same Bangkok "today" every other part of this harness uses (period.ts), identically in
 * preflight and real mode (both call this one function).
 */
import { todayCivilDate, DEFAULT_COMPANY_TIME_ZONE } from '../../packages/contracts/src/civil-date';

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];
const THAI_MONTHS_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** The same Bangkok month drives seeded periods and period-relative due-date gold. */
export function workflowMonthKey(now: Date, offset: number): string {
  const [year, month] = todayCivilDate(DEFAULT_COMPANY_TIME_ZONE, now).split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1 + offset, 1)).toISOString().slice(0, 7);
}

export const TEMPLATE_PLACEHOLDERS = [
  'this_month_th', 'last_month_th', 'this_month_abbr_th', 'last_month_abbr_th',
  'this_be_year', 'this_be_year_short', 'this_ce_year', 'last_month_be_year', 'today_day', 'today_iso',
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number];

const PLACEHOLDER_PATTERN = /\{\{(\w+)\}\}/g;
const KNOWN_PLACEHOLDERS = new Set<string>(TEMPLATE_PLACEHOLDERS);

/** Every `{{...}}` key referenced in `text`, whether or not it is a known placeholder — the
 * validator's job (types.ts) is to reject the ones that are not. */
export function referencedPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_PATTERN)].map((match) => match[1]!);
}

export function isKnownPlaceholder(key: string): key is TemplatePlaceholder {
  return KNOWN_PLACEHOLDERS.has(key);
}

function placeholderValues(now: Date): Record<TemplatePlaceholder, string> {
  const today = todayCivilDate(DEFAULT_COMPANY_TIME_ZONE, now); // "YYYY-MM-DD"
  const [ceYearStr, monthStr, dayStr] = today.split('-') as [string, string, string];
  const ceYear = Number(ceYearStr);
  const month = Number(monthStr); // 1-12
  // Crosses the calendar-year boundary correctly: December's "last month" of a January "this
  // month" is the PREVIOUS Gregorian year, so its Buddhist year is one less than this year's.
  const lastMonthIndex0 = month === 1 ? 11 : month - 2;
  const lastMonthCeYear = month === 1 ? ceYear - 1 : ceYear;
  const beYear = ceYear + 543;
  return {
    this_month_th: THAI_MONTHS_FULL[month - 1]!,
    last_month_th: THAI_MONTHS_FULL[lastMonthIndex0]!,
    this_month_abbr_th: THAI_MONTHS_ABBR[month - 1]!,
    last_month_abbr_th: THAI_MONTHS_ABBR[lastMonthIndex0]!,
    this_be_year: String(beYear),
    this_be_year_short: String(beYear).slice(-2),
    this_ce_year: String(ceYear),
    last_month_be_year: String(lastMonthCeYear + 543),
    today_day: String(Number(dayStr)),
    today_iso: today,
  };
}

/** Fills every `{{placeholder}}` in `text` from `now` (Asia/Bangkok). Throws on an unknown
 * placeholder — callers that already ran `validateCorpus` will never hit this; it exists so a
 * caller that renders ad hoc text still fails loudly instead of shipping a literal `{{...}}`. */
export function renderUserText(text: string, now: Date): string {
  const values = placeholderValues(now);
  return text.replace(PLACEHOLDER_PATTERN, (match, key: string) => {
    if (!isKnownPlaceholder(key)) throw new Error(`renderUserText: unknown placeholder {{${key}}}`);
    return values[key];
  });
}
