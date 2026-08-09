// Civil dates for the tax-identity surfaces (spec §12.1, normative).
//
// A civil date is a calendar day with no time and no offset: the day printed on a
// ภ.พ.20, the `effectiveFrom` of a VAT fact, the `documentDate` a fence compares against.
// Two traps this module exists to close, both of which shift a Thai company's day by one:
//
//  1. `new Date('2026-08-04')` parses as UTC midnight, but `new Date(2026, 7, 4)` parses as
//     LOCAL midnight. Writing the latter into a Prisma `@db.Date` column from a machine in
//     Asia/Bangkok stores 2026-08-03T17:00Z, which reads back as 2026-08-03.
//  2. Deriving "today" from `new Date().toISOString()` gives the UTC day. Between 00:00 and
//     07:00 Bangkok time that is still yesterday, so a same-day `effectiveFrom` would be
//     rejected as future-dated for seven hours every night.
//
// Everything on the wire is `YYYY-MM-DD`; everything in a `@db.Date` column is UTC midnight;
// everything user-facing ("today", the day of a timestamp) is rendered in the company timezone.
export type CivilDate = string;

/** Fallback for companies with no `timezone` set. Every tenant is Thai today. */
export const DEFAULT_COMPANY_TIME_ZONE = 'Asia/Bangkok';

/**
 * Exported so HTTP DTOs validate a calendar day against the SAME definition the domain uses
 * (audit H-23). The supported Gregorian range ends at 2100; contemporary Buddhist-era input
 * must be converted before it crosses the wire instead of being stored as a far-future CE date.
 */
export const CIVIL_DATE_PATTERN = /^(?:[01]\d{3}|20\d{2}|2100)-\d{2}-\d{2}$/;

/**
 * A value that should have been a calendar day was not one. Subclasses TypeError so existing
 * callers and tests that expect a TypeError still hold; the distinct class exists so the API's
 * exception filter can answer 400 instead of 500 — this is client input, not a server fault.
 */
export class InvalidCivilDateError extends TypeError {
  constructor(value: unknown) {
    super(`invalid civil date: ${JSON.stringify(value)}`);
    this.name = 'InvalidCivilDateError';
  }
}

const MS_PER_DAY = 86_400_000;

// Intl.DateTimeFormat construction is the expensive part; the set of company timezones is tiny.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  formatters.set(timeZone, created);
  return created;
}

/**
 * True only for a real calendar day in `YYYY-MM-DD`. Rejects `2026-02-30` and `2026-8-4`:
 * the pattern alone would accept the first, and `Date` would silently roll it to March 2.
 */
export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== 'string' || !CIVIL_DATE_PATTERN.test(value)) return false;
  const asUtc = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(asUtc.getTime()) && asUtc.toISOString().slice(0, 10) === value;
}

/** Wire value -> the `Date` to store in a `@db.Date` column (UTC midnight, never local). */
export function civilDateToUtcDate(value: CivilDate): Date {
  if (!isCivilDate(value)) throw new InvalidCivilDateError(value);
  return new Date(`${value}T00:00:00.000Z`);
}

/** `@db.Date` column value -> wire value. Reads the UTC day, which is how Prisma stores it. */
export function utcDateToCivilDate(value: Date): CivilDate {
  if (Number.isNaN(value.getTime())) throw new TypeError('invalid Date');
  return value.toISOString().slice(0, 10);
}

/**
 * The calendar day an instant falls on, as seen from the company. This is the only correct
 * way to turn a `DateTime` column (`documentDate`, `createdAt`, `now()`) into a civil date —
 * spec §12.1 requires the fence to compare `civilDate(documentDate, tz)`, not the raw timestamp.
 */
export function civilDate(instant: Date, timeZone: string = DEFAULT_COMPANY_TIME_ZONE): CivilDate {
  if (Number.isNaN(instant.getTime())) throw new TypeError('invalid Date');
  const parts = formatterFor(timeZone).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const value = `${part('year')}-${part('month')}-${part('day')}`;
  if (!isCivilDate(value)) throw new InvalidCivilDateError(value);
  return value;
}

/** "Today" for monotonic (§4.3(2)) and horizon (§5.3(5)) rules — the company's day, not UTC's. */
export function todayCivilDate(timeZone: string = DEFAULT_COMPANY_TIME_ZONE, now: Date = new Date()): CivilDate {
  return civilDate(now, timeZone);
}

/**
 * Day arithmetic for `F <= today + 365` (§5.3(5)). Done in UTC on purpose: UTC has no DST, so
 * adding 86_400_000 ms is always exactly one calendar day, which is not true of a local clock.
 */
export function addCivilDays(value: CivilDate, days: number): CivilDate {
  if (!Number.isInteger(days)) throw new TypeError(`days must be an integer: ${days}`);
  return utcDateToCivilDate(new Date(civilDateToUtcDate(value).getTime() + days * MS_PER_DAY));
}

// ponytail: no compareCivilDates helper — `YYYY-MM-DD` is fixed-width, so plain string
// `<`/`>`/`===` already order civil dates chronologically.

/** The `YYYY-MM` a civil date falls in. Named because ten call sites otherwise repeat the slice. */
export function civilPeriodKey(value: CivilDate): string {
  return value.slice(0, 7);
}

/**
 * An inclusive civil-date range as the half-open UTC instant range a `DateTime` column needs.
 *
 * Most date columns here are plain `DateTime`, not `@db.Date`, and rows really do carry a time —
 * a LINE receipt is stamped when it arrives, `paidAt` and `createdAt` are instants by definition.
 * `lte: <last day at midnight>` therefore matched only rows sitting exactly on midnight and hid
 * every other row on the range's final day. Measured on seed data: a vendor-bill filter for one
 * day returned 0 of 13. The upper bound must be the NEXT midnight, compared with `lt`.
 *
 * Inputs are sliced to 10 characters so a caller passing a full ISO string cannot stretch the
 * range by a day.
 */
export function civilDayRangeToUtc(
  from?: string,
  to?: string,
): { gte?: Date; lt?: Date } {
  return {
    ...(from ? { gte: civilDateToUtcDate(from.slice(0, 10)) } : {}),
    ...(to ? { lt: civilDateToUtcDate(addCivilDays(to.slice(0, 10), 1)) } : {}),
  };
}

/**
 * A `Date` upper bound for a range whose end is already a `Date` — the period-close guard passes
 * `AccountingPeriod.endDate` straight through. Same rule as `civilDayRangeToUtc`: next midnight,
 * used with `lt`.
 */
export function exclusiveEndOfDay(value: Date): Date {
  return civilDateToUtcDate(addCivilDays(utcDateToCivilDate(value), 1));
}

/**
 * An instant or a civil date, as the company's civil date. For write boundaries that accept
 * either, so a caller sending a timestamp cannot put a time into a date column.
 *
 * Note this reads an instant in the COMPANY's zone, not UTC: `2026-08-05T19:00:00Z` is 02:00 on
 * the 6th in Bangkok and yields `2026-08-06`. Slicing the ISO string would have answered the 5th.
 */
export function coerceCivilDate(
  value: string | Date,
  timeZone: string = DEFAULT_COMPANY_TIME_ZONE,
): CivilDate {
  if (typeof value === 'string' && !value.includes('T')) {
    if (!isCivilDate(value)) throw new InvalidCivilDateError(value);
    return value;
  }
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new InvalidCivilDateError(value);
  return civilDate(instant, timeZone);
}
