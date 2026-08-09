const THAI_DATE_FORMATTER = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const THAI_TIME_FORMATTER = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const THAI_MONTH_FORMATTER = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  timeZone: 'Asia/Bangkok',
  month: 'short',
  year: 'numeric',
});

type DateValue = Date | string | number | null | undefined;

function parseDate(value: DateValue): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats every user-facing date consistently, e.g. 16 ก.ค. 2569. */
export function formatThaiDate(value: DateValue, fallback = '—'): string {
  const date = parseDate(value);
  return date ? THAI_DATE_FORMATTER.format(date) : fallback;
}

/** Keeps the shared date format and appends time for timestamp fields. */
export function formatThaiDateTime(value: DateValue, fallback = '—'): string {
  const date = parseDate(value);
  return date ? `${THAI_DATE_FORMATTER.format(date)} ${THAI_TIME_FORMATTER.format(date)} น.` : fallback;
}

/** Time-only fields, matching the time half of formatThaiDateTime, e.g. 16:04 น. */
export function formatThaiTime(value: DateValue, fallback = '—'): string {
  const date = parseDate(value);
  return date ? `${THAI_TIME_FORMATTER.format(date)} น.` : fallback;
}

/** Month-granular fields such as an accounting period key ("2026-07" → ก.ค. 2569). */
export function formatThaiMonth(value: DateValue, fallback = '—'): string {
  const date = parseDate(value);
  return date ? THAI_MONTH_FORMATTER.format(date) : fallback;
}
