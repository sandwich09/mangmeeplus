/**
 * Pure business logic for มั่งมี Flow A bookings (spec D8).
 * No Nest / Prisma imports. Business hours are evaluated in Asia/Bangkok regardless
 * of the server's local timezone — this is the one called-out timezone risk (see plan).
 */

const TIMEZONE = 'Asia/Bangkok';
const BUSINESS_START_MIN = 9 * 60; // 09:00
const BUSINESS_END_MIN = 20 * 60; // 20:00
const MIN_DURATION_MIN = 60; // 1h
const MAX_DURATION_MIN = 180; // 3h
const STEP_MIN = 30; // 0.5h increments

type ExistingBookingWindow = {
  startAt: Date;
  endAt: Date;
  status?: string;
};

export type BookingValidationError =
  | 'end_before_start'
  | 'duration_out_of_range'
  | 'duration_not_aligned'
  | 'start_in_past'
  | 'outside_business_hours';

function minutesOfDayInTz(d: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

/** Returns the first validation failure, or null when the booking window is acceptable. */
export function validateBookingWindow(startAt: Date, endAt: Date, now: Date): BookingValidationError | null {
  if (endAt.getTime() <= startAt.getTime()) return 'end_before_start';
  const durationMin = (endAt.getTime() - startAt.getTime()) / 60_000;
  if (durationMin < MIN_DURATION_MIN || durationMin > MAX_DURATION_MIN) return 'duration_out_of_range';
  if (durationMin % STEP_MIN !== 0) return 'duration_not_aligned';
  if (startAt.getTime() < now.getTime()) return 'start_in_past';

  const startMinutes = minutesOfDayInTz(startAt, TIMEZONE);
  const endMinutes = minutesOfDayInTz(endAt, TIMEZONE);
  // Max duration (3h) starting no later than 19:00 keeps endMinutes within the same
  // Bangkok calendar day (<=23:00), so no midnight-wrap handling is needed here.
  if (startMinutes < BUSINESS_START_MIN || startMinutes >= BUSINESS_END_MIN) return 'outside_business_hours';
  if (endMinutes > BUSINESS_END_MIN) return 'outside_business_hours';
  return null;
}

export function bookingsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

function bangkokDateParts(d: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  return {
    y: Number(parts.find((p) => p.type === 'year')!.value),
    m: Number(parts.find((p) => p.type === 'month')!.value),
    d: Number(parts.find((p) => p.type === 'day')!.value),
  };
}

function parseBangkokDateInput(dateInput: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return null;
  const [y, m, d] = dateInput.split('-').map(Number);
  const yy = y!, mm = m!, dd = d!;
  const normalized = new Date(Date.UTC(yy, mm - 1, dd));
  if (normalized.getUTCFullYear() !== yy || normalized.getUTCMonth() !== mm - 1 || normalized.getUTCDate() !== dd) return null;
  return { y: yy, m: mm, d: dd };
}

export function bookingDayRange(dateInput: string): { rangeStart: Date; rangeEnd: Date } | null {
  const parsed = parseBangkokDateInput(dateInput);
  if (!parsed) return null;
  const rangeStart = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, -7, 0, 0)); // 00:00 Bangkok, as UTC
  return { rangeStart, rangeEnd: new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000) };
}

/**
 * ISO week range [Sunday 00:00, next Sunday 00:00) in Asia/Bangkok, as UTC instants,
 * for the week containing `weekStartInput` (a "yyyy-mm-dd" calendar date) — or the
 * current Bangkok week when omitted. The week-grid mapper on the client converts
 * these UTC instants back to day/hour coordinates; this is the one place that decides
 * which calendar day a booking belongs to.
 */
export function bookingWeekRange(weekStartInput: string | undefined, now: Date = new Date()): { rangeStart: Date; rangeEnd: Date } {
  let y: number, m: number, d: number;
  if (weekStartInput && /^\d{4}-\d{2}-\d{2}$/.test(weekStartInput)) {
    const [yy, mm, dd] = weekStartInput.split('-').map(Number);
    y = yy!; m = mm!; d = dd!;
  } else {
    ({ y, m, d } = bangkokDateParts(now));
  }
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const rangeStart = new Date(Date.UTC(y, m - 1, d - dow, -7, 0, 0)); // Sunday 00:00 Bangkok, as a UTC instant
  const rangeEnd = new Date(rangeStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { rangeStart, rangeEnd };
}

export function isValidBookingDuration(durationMinutes: number): boolean {
  return Number.isInteger(durationMinutes)
    && durationMinutes >= MIN_DURATION_MIN
    && durationMinutes <= MAX_DURATION_MIN
    && durationMinutes % STEP_MIN === 0;
}

export function isSlotFree(startAt: Date, endAt: Date, existingBookings: readonly ExistingBookingWindow[], bufferMinutes = 0): boolean {
  const bufferMs = bufferMinutes * 60_000;
  return !existingBookings
    .filter((b) => b.status !== 'CANCELLED')
    .some((b) => bookingsOverlap(new Date(startAt.getTime() - bufferMs), new Date(endAt.getTime() + bufferMs), b.startAt, b.endAt));
}

export function computeFreeStartSlots(input: {
  date: string;
  durationMinutes: number;
  existingBookings: readonly ExistingBookingWindow[];
  now: Date;
  bufferMinutes: number;
}): string[] {
  const day = bookingDayRange(input.date);
  if (!day || !isValidBookingDuration(input.durationMinutes)) return [];

  const slots: string[] = [];
  // ponytail: staff/branch working hours are hardcoded 09:00-20:00 Asia/Bangkok until per-staff hours exist.
  for (let startMin = BUSINESS_START_MIN; startMin + input.durationMinutes <= BUSINESS_END_MIN; startMin += STEP_MIN) {
    const startAt = new Date(day.rangeStart.getTime() + startMin * 60_000);
    const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);
    if (startAt.getTime() >= input.now.getTime() && isSlotFree(startAt, endAt, input.existingBookings, input.bufferMinutes)) slots.push(startAt.toISOString());
  }
  return slots;
}

/** Human-readable Bangkok date-time for a reminder, e.g. "9 ก.ค. 2569 14:30". */
export function formatBookingWhen(startAt: Date, timeZone = TIMEZONE): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(startAt);
}

/** Customer-facing LINE reminder text for an upcoming appointment. */
export function bookingReminderText(serviceName: string, startAt: Date, timeZone = TIMEZONE): string {
  // CUST-12: the assistant cannot move or cancel a committed booking — a reschedule typed here
  // used to fall through to a fresh evaluation and create a SECOND real booking. Until the
  // reschedule flow exists, the reminder must not invite what the code cannot service; a message
  // sent anyway is caught by the handoff in the inbound path.
  return [`🔔 แจ้งเตือนนัดหมาย`, `บริการ: ${serviceName}`, `เวลา: ${formatBookingWhen(startAt, timeZone)} น.`, 'หากต้องการเลื่อนหรือยกเลิก กรุณาติดต่อเจ้าหน้าที่'].join('\n');
}

/**
 * CUST-12 containment: does this message ask to MOVE or CANCEL an existing appointment?
 *
 * Deliberately narrow and deterministic. This is a safety gate, not a routing decision: it only
 * has to recognise the wording that would otherwise reach autonomous booking and create a second
 * real appointment. Anything it misses behaves exactly as before, and anything it over-matches
 * costs one honest staff handoff rather than a wrong booking.
 *
 * ponytail: keyword set over the phrasings customers actually use; move to the model only if the
 * miss rate shows up once a real reschedule flow exists.
 */
const RESCHEDULE_MARKERS = ['เลื่อน', 'ขอเปลี่ยนเวลา', 'เปลี่ยนเวลา', 'เปลี่ยนวัน', 'ยกเลิกนัด', 'ยกเลิกการจอง', 'ขอยกเลิก', 'reschedule', 'postpone', 'cancel my booking', 'cancel the appointment'];

export function looksLikeRescheduleRequest(text: string | null | undefined): boolean {
  const value = (text ?? '').toLowerCase();
  if (!value.trim()) return false;
  return RESCHEDULE_MARKERS.some((marker) => value.includes(marker));
}
