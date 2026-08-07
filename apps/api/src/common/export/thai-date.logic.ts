/**
 * Thai-Buddhist rendering for dates inside generated spreadsheets, e.g. 28 ก.ค. 2569.
 *
 * The time zone is pinned to Asia/Bangkok on purpose: the same UTC timestamp otherwise renders
 * as a different calendar day depending on the server's TZ (verified — 2026-07-28T23:59:00Z is
 * "29 ก.ค." in Bangkok but "28 ก.ค." on a UTC host).
 */
const THAI_EXPORT_DATE = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Bangkok',
});

/** Strict ISO date or date-time. `2026-07` (a period key) deliberately does NOT match. */
const ISO_DATE_LIKE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function isIsoDateLike(value: unknown): boolean {
  return typeof value === 'string' && ISO_DATE_LIKE.test(value);
}

/**
 * Returns the Thai-formatted date, or the input unchanged when it is not a parseable ISO date —
 * so period keys, ids and free text pass through untouched.
 */
export function formatThaiExportDate(value: unknown): string {
  if (!isIsoDateLike(value)) return value == null ? '' : String(value);
  const date = new Date(value as string);
  return Number.isNaN(date.getTime()) ? String(value) : THAI_EXPORT_DATE.format(date);
}
