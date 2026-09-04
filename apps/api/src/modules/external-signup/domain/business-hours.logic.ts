/**
 * P10-L §7: the "within a business day" promise the LIFF page and the LINE status card both quote,
 * and the clock the 60-minute admin reminder counts on. Asia/Bangkok is UTC+7 all year with no DST,
 * so a fixed offset is the whole timezone story — no library, no tz database.
 *
 * Pure: every answer is a function of `now` and the configured window.
 */

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Index by `Date.getUTCDay()`: 0 is Sunday. */
const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;
/** The order a human writes a range in — "MON-SAT" is Monday through Saturday, not a set. */
const WEEK_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export type BusinessHoursConfig = Readonly<{
  /** `MON-SAT`, inclusive, in Monday-first order. */
  days: string;
  /** `09:00-18:00`, start inclusive and end EXCLUSIVE: at 18:00 sharp the office is shut. */
  hours: string;
}>;

type ParsedWindow = { openDays: ReadonlySet<string>; startMinutes: number; endMinutes: number };

function parseMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

/** Throws on a malformed window rather than guessing one — the env schema already validated it. */
export function parseBusinessHours(config: BusinessHoursConfig): ParsedWindow {
  const [fromDay, toDay] = config.days.split('-');
  const from = WEEK_ORDER.indexOf(fromDay as typeof WEEK_ORDER[number]);
  const to = WEEK_ORDER.indexOf(toDay as typeof WEEK_ORDER[number]);
  if (from < 0 || to < 0) throw new Error('invalid_business_days');
  const openDays = new Set<string>();
  // A range that wraps the weekend (e.g. SAT-TUE) is legal and walks around the week.
  for (let step = 0; step <= (to - from + 7) % 7; step += 1) {
    openDays.add(WEEK_ORDER[(from + step) % 7]!);
  }

  const [fromHour, toHour] = config.hours.split('-');
  if (!fromHour || !toHour) throw new Error('invalid_business_hours');
  const startMinutes = parseMinutes(fromHour);
  const endMinutes = parseMinutes(toHour);
  if (!(startMinutes < endMinutes)) throw new Error('invalid_business_hours');
  return { openDays, startMinutes, endMinutes };
}

function bangkokParts(instant: Date): { dayName: string; minutes: number; midnightUtcMs: number } {
  const shifted = instant.getTime() + BANGKOK_OFFSET_MS;
  const local = new Date(shifted);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
  return {
    dayName: DAY_NAMES[local.getUTCDay()]!,
    minutes,
    // Bangkok midnight of the day `instant` falls on, expressed as a UTC instant.
    midnightUtcMs: Math.floor(shifted / DAY_MS) * DAY_MS - BANGKOK_OFFSET_MS,
  };
}

/** Bangkok midnight of the day `now` falls on. The boundary a per-day cap is counted from. */
export function bangkokDayStart(now: Date): Date {
  return new Date(bangkokParts(now).midnightUtcMs);
}

/** 'YYYY-MM-DD' on the Bangkok wall clock — the name of the day a per-day cap belongs to. */
export function bangkokDayKey(now: Date): string {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

export function isBusinessHours(now: Date, config: BusinessHoursConfig): boolean {
  const window = parseBusinessHours(config);
  const { dayName, minutes } = bangkokParts(now);
  return window.openDays.has(dayName) && minutes >= window.startMinutes && minutes < window.endMinutes;
}

/**
 * The instant the office next opens — or `now` itself when it is already open, so a caller can
 * write `max(nextBusinessStart(...), now)` without a special case. An application that arrives on
 * Sunday starts its reminder clock at Monday 09:00, which is what §3.3 promises.
 */
export function nextBusinessStart(now: Date, config: BusinessHoursConfig): Date {
  const window = parseBusinessHours(config);
  const { dayName, minutes, midnightUtcMs } = bangkokParts(now);
  if (window.openDays.has(dayName) && minutes >= window.startMinutes && minutes < window.endMinutes) return now;

  // Today counts only if the office has not opened yet; otherwise walk forward. Seven steps is the
  // whole week, and the window always has at least one open day, so this always terminates.
  const startToday = minutes < window.startMinutes && window.openDays.has(dayName);
  for (let offset = startToday ? 0 : 1; offset <= 7; offset += 1) {
    const candidateMidnight = midnightUtcMs + offset * DAY_MS;
    const candidateDay = DAY_NAMES[new Date(candidateMidnight + BANGKOK_OFFSET_MS).getUTCDay()]!;
    if (window.openDays.has(candidateDay)) return new Date(candidateMidnight + window.startMinutes * 60_000);
  }
  throw new Error('invalid_business_days');
}
