// Pure display logic for the real booking-calendar page ("การจองออนไลน์").
// Renders CrmBookingSummary rows (real API data) into the same week-grid shape the
// original design used. Grid math uses the browser's local time — acceptable since
// this app's userbase runs in Thailand (browser tz ~= Asia/Bangkok); the backend is
// the actual authority on business-hours validation regardless of client display.

import type { CrmBookingSummary, CrmCustomerOriginSource, CrmStaffBookingSource } from '@watchdog-bms/contracts';

export const BK_DAY_NAMES = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;
export const BK_TH_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
] as const;

export const BK_HOUR_START = 9;
export const BK_HOUR_END = 20;
export const BK_CELL_HEIGHT = 66;

export const BK_DURATION_OPTIONS = [1, 1.5, 2, 2.5, 3] as const;

export function customerOriginFromBookingSource(source: CrmStaffBookingSource): CrmCustomerOriginSource {
  if (source === 'STAFF') return 'MANUAL';
  if (source === 'WALK_IN' || source === 'PHONE' || source === 'WEB') return source;
  return 'OTHER';
}

/** LINE-sourced bookings are created by the AI auto-booking flow — show "Auto Book" instead of a staff name. */
export function bookingStaffDisplay(
  booking: Pick<CrmBookingSummary, 'source' | 'staffUserId'>,
  staffLabel: (staffUserId?: string) => string,
): string {
  return booking.source === 'LINE' ? 'Auto Book' : staffLabel(booking.staffUserId);
}

const bahtText = (value: number): string => `${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;

/** "1,500.00 บาท" or "—" when the booking has no recorded amount. */
export function bookingAmountText(value?: string): string {
  const amount = Number(value);
  return value != null && value !== '' && Number.isFinite(amount) ? bahtText(amount) : '—';
}

/** คงเหลือที่ต้องจ่าย = total − deposit (deposit defaults to 0); "—" until a total is recorded. */
export function bookingOutstandingText(depositAmount?: string, totalAmount?: string): string {
  const total = Number(totalAmount);
  if (totalAmount == null || totalAmount === '' || !Number.isFinite(total)) return '—';
  const deposit = Number(depositAmount);
  const paid = depositAmount != null && depositAmount !== '' && Number.isFinite(deposit) ? deposit : 0;
  return bahtText(Math.max(0, total - paid));
}

const STAFF_COLOR_PALETTE = ['#12B76A', '#2E90FA', '#F79009', '#7A5AF8', '#EC4899', '#06AED4'];
export function bookingStaffColor(staffKey: string): string {
  let hash = 0;
  for (const ch of staffKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return STAFF_COLOR_PALETTE[hash % STAFF_COLOR_PALETTE.length]!;
}

export function formatBookingHour(hour: number): string {
  return `${hour < 10 ? `0${hour}` : hour}:00`;
}

export const BK_HOUR_LABELS: string[] = Array.from(
  { length: BK_HOUR_END - BK_HOUR_START },
  (_, i) => formatBookingHour(BK_HOUR_START + i),
);

/** Move past a finished Saturday so the first calendar shown still has a bookable slot. */
export function initialBookingWeekOffset(now: Date): number {
  return now.getDay() === 6 && now.getHours() >= BK_HOUR_END - 1 ? 1 : 0;
}

/** Sunday that starts the week `weekOffset` weeks away from `today`'s week (local time). */
export function getWeekStart(today: Date, weekOffset: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() + weekOffset * 7);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** yyyy-mm-dd for the GET .../bookings?weekStart= query param. */
export function weekStartParam(today: Date, weekOffset: number): string {
  const d = getWeekStart(today, weekOffset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type BookedEntry = {
  booked: true;
  hour: number;
  dur: number;
  range: string;
  durText: string;
  custName: string;
  service: string;
  staffLabel: string;
  color: string;
  id: string;
  status: CrmBookingSummary['status'];
};

export type FreeEntry = {
  booked: false;
  hour: number;
  timeLabel: string;
  isPast: boolean;
};

export type BookingEntry = BookedEntry | FreeEntry;

export type BookingDayColumn = {
  day: number;
  dayName: string;
  dateNum: string;
  isToday: boolean;
  entries: BookingEntry[];
};

export function buildWeekColumns(
  bookings: CrmBookingSummary[],
  weekOffset: number,
  today: Date,
  staffLabel: (staffUserId?: string) => string,
): BookingDayColumn[] {
  const dow = today.getDay();
  const weekStart = getWeekStart(today, weekOffset);
  const columns: BookingDayColumn[] = [];

  for (let day = 0; day < 7; day += 1) {
    const date = addDays(weekStart, day);
    const startMap = new Map<number, CrmBookingSummary>();
    for (const b of bookings) {
      const start = new Date(b.startAt);
      if (start.getFullYear() === date.getFullYear() && start.getMonth() === date.getMonth() && start.getDate() === date.getDate()) {
        startMap.set(start.getHours(), b);
      }
    }
    const entries: BookingEntry[] = [];
    let hour = BK_HOUR_START;
    while (hour < BK_HOUR_END) {
      const booking = startMap.get(hour);
      if (booking) {
        const start = new Date(booking.startAt);
        const end = new Date(booking.endAt);
        const dur = Math.max(1, Math.round(((end.getTime() - start.getTime()) / 3_600_000) * 2) / 2);
        entries.push({
          booked: true,
          hour,
          dur,
          range: `${formatBookingHour(hour)}–${formatBookingHour(hour + dur)}`,
          durText: `${dur} ชม.`,
          custName: booking.customerName ?? 'ลูกค้า',
          service: booking.serviceName,
          staffLabel: bookingStaffDisplay(booking, staffLabel),
          color: bookingStaffColor(booking.staffUserId ?? booking.id),
          id: booking.id,
          status: booking.status,
        });
        hour += Math.ceil(dur);
      } else {
        const isPast =
          weekOffset < 0 ||
          (weekOffset === 0 && (day < dow || (day === dow && hour <= today.getHours())));
        entries.push({ booked: false, hour, timeLabel: formatBookingHour(hour), isPast });
        hour += 1;
      }
    }
    columns.push({
      day,
      dayName: BK_DAY_NAMES[day]!,
      dateNum: String(date.getDate()),
      isToday: weekOffset === 0 && day === dow,
      entries,
    });
  }
  return columns;
}

export function countTodayBookings(bookings: CrmBookingSummary[], today: Date): number {
  return bookings.filter((b) => {
    const start = new Date(b.startAt);
    return start.getFullYear() === today.getFullYear() && start.getMonth() === today.getMonth() && start.getDate() === today.getDate();
  }).length;
}

/** e.g. "5 ก.ค. – 11 ก.ค." */
export function getWeekLabel(today: Date, weekOffset: number): string {
  const start = getWeekStart(today, weekOffset);
  const end = addDays(start, 6);
  return `${start.getDate()} ${BK_TH_MONTHS[start.getMonth()]} – ${end.getDate()} ${BK_TH_MONTHS[end.getMonth()]}`;
}

export function getWeekTag(weekOffset: number): string {
  if (weekOffset === 0) return 'สัปดาห์นี้';
  if (weekOffset === 1) return 'สัปดาห์หน้า';
  if (weekOffset === -1) return 'สัปดาห์ที่แล้ว';
  return weekOffset > 0 ? `อีก ${weekOffset} สัปดาห์` : `${Math.abs(weekOffset)} สัปดาห์ก่อน`;
}

/** Modal subtitle parts, e.g. dayText "อา 5 ก.ค.", rangeText "13:00–15:00 · รวม 2 ชม." */
export function getCreateSubtitle(day: number, hour: number, dur: number, weekOffset: number, today: Date): { dayText: string; rangeText: string } {
  const weekStart = getWeekStart(today, weekOffset);
  const date = addDays(weekStart, day);
  return {
    dayText: `${BK_DAY_NAMES[day]} ${date.getDate()} ${BK_TH_MONTHS[weekStart.getMonth()]}`,
    rangeText: `${formatBookingHour(hour)}–${formatBookingHour(hour + dur)} · รวม ${dur} ชม.`,
  };
}

/** ISO instants for a slot at `day`/`hour` (local browser time) in the given week. */
export function slotToIsoRange(day: number, hour: number, dur: number, weekOffset: number, today: Date): { startAt: string; endAt: string } {
  const weekStart = getWeekStart(today, weekOffset);
  const date = addDays(weekStart, day);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0, 0);
  const end = new Date(start.getTime() + dur * 3_600_000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}
