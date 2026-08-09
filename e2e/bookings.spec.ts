import { test, expect } from './harness/fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { expectNoClientError } from './harness/auth';
import { gotoCompany, json, unique } from './harness/e2e-utils';

type Branch = { id: string; code: string; name: string };
type BranchPage = { items: Branch[] };
type Customer = { id: string };
// Customer identity management wrapped list items in a projection envelope.
type CustomerPage = { items: { projection: string; customer: Customer }[] };
type Booking = { id: string; customerId: string; status: string; customerName: string; serviceName: string; startAt: string; endAt: string };
type BookingPage = { items: Booking[] };
type CreateBookingPayload = { branchId: string; customerId: string; serviceName: string; startAt: string; endAt: string };
type BookingSlot = { startAt: string; endAt: string; date: string; time: string; range: string; hour: number };

const THAI_MONTHS_FULL = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** Drive the ThemedDate button+calendar picker (the field is no longer a fillable input).
 *  The calendar panel is PORTALED out of the dialog (PopoverPanel), so after clicking the
 *  trigger inside `scope`, every calendar interaction has to run page-wide. */
async function pickThemedDate(page: Page, scope: ReturnType<Page['getByRole']>, targetIso: string, fromIso: string) {
  const [ty, tm, td] = targetIso.split('-').map(Number);
  const [fy, fm] = fromIso.split('-').map(Number);
  await scope.getByLabel('วันที่').click();
  let steps = (ty * 12 + tm) - (fy * 12 + fm);
  while (steps !== 0) {
    await page.getByRole('button', { name: steps > 0 ? 'เดือนถัดไป' : 'เดือนก่อนหน้า' }).click();
    steps += steps > 0 ? -1 : 1;
  }
  // ThemedDate renders the calendar header year in Buddhist Era for the Thai workspace locale
  // (see apps/web/src/common/components/field/ThemedDate.tsx), not the Gregorian ISO year.
  const header = page.getByText(`${THAI_MONTHS_FULL[tm - 1]} ${ty + 543}`, { exact: true });
  await expect(header).toBeVisible();
  // Day numbers collide with unrelated buttons (e.g. the notification badge), so pick the day
  // inside the calendar panel that carries the header.
  const panel = header.locator('..').locator('..');
  await panel.getByRole('button', { name: String(td), exact: true }).click();
}

function nextWeekSlot(day: number, hour: number): BookingSlot {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  const today = new Date(Date.UTC(value('year'), value('month') - 1, value('day')));
  const target = new Date(today.getTime() + (7 - today.getUTCDay() + day) * 86_400_000);
  const date = target.toISOString().slice(0, 10);
  const time = `${String(hour).padStart(2, '0')}:00`;
  return {
    startAt: new Date(`${date}T${time}:00+07:00`).toISOString(),
    endAt: new Date(`${date}T${String(hour + 1).padStart(2, '0')}:00:00+07:00`).toISOString(),
    date,
    time,
    range: `${time}–${String(hour + 1).padStart(2, '0')}:00`,
    hour,
  };
}

async function findFreeNextWeekSlot(
  api: APIRequestContext,
  companyId: string,
  excludeBookingId?: string,
  differentHour?: number,
) {
  const page = await json<BookingPage>(await api.get(
    `companies/${companyId}/crm/bookings?weekStart=${nextWeekSlot(1, 9).date}`,
  ));
  // The API enforces the company booking buffer around existing bookings, so a
  // raw-overlap-free slot can still 409 — pad both sides by bufferMinutes.
  const settings = await json<{ bufferMinutes: number }>(await api.get(`companies/${companyId}/crm/bookings/settings`));
  const bufferMs = (settings.bufferMinutes ?? 0) * 60_000;
  for (let day = 1; day <= 6; day += 1) {
    for (let hour = 9; hour < 19; hour += 1) {
      if (hour === differentHour) continue;
      const slot = nextWeekSlot(day, hour);
      const overlaps = page.items.some((booking) => booking.id !== excludeBookingId
        && new Date(slot.startAt).getTime() < new Date(booking.endAt).getTime() + bufferMs
        && new Date(booking.startAt).getTime() - bufferMs < new Date(slot.endAt).getTime());
      if (!overlaps) return slot;
    }
  }
  throw new Error('No free one-hour slot remains in next week for booking E2E.');
}

async function createBooking(api: APIRequestContext, companyId: string) {
  const branches = await json<BranchPage>(await api.get(`companies/${companyId}/branches?pageSize=100`));
  expect(branches.items.length).toBeGreaterThan(0);
  const customers = await json<CustomerPage>(await api.get(`companies/${companyId}/crm/customers?pageSize=1`));
  expect(customers.items.length).toBeGreaterThan(0);
  const slot = await findFreeNextWeekSlot(api, companyId);
  const data: CreateBookingPayload = {
    branchId: branches.items[0].id,
    customerId: customers.items[0].customer.id,
    serviceName: unique('E2E booking service'),
    startAt: slot.startAt,
    endAt: slot.endAt,
  };
  return json<Booking>(await api.post(`companies/${companyId}/crm/bookings`, {
    data,
  }));
}

async function getBooking(api: APIRequestContext, companyId: string, booking: Booking) {
  const page = await json<BookingPage>(await api.get(
    `companies/${companyId}/crm/bookings?weekStart=${booking.startAt.slice(0, 10)}`,
  ));
  const found = page.items.find((item) => item.id === booking.id);
  expect(found, `booking ${booking.id} returned by list GET`).toBeDefined();
  return found!;
}

/** On Saturday evening the page opens on NEXT week already (initialBookingWeekOffset moves
 *  past a finished Saturday), so week navigation must start from a known offset: the reset
 *  button reads "กลับมาวันนี้" only when the view is off the current week. */
async function resetToCurrentWeek(page: Page) {
  const reset = page.getByRole('button', { name: 'กลับมาวันนี้' });
  if (await reset.isVisible().catch(() => false)) await reset.click();
}

async function openNextWeekBooking(page: Page, companyId: string, booking: Booking) {
  await gotoCompany(page, companyId, '/bookings');
  await resetToCurrentWeek(page);
  await page.getByRole('button', { name: /สัปดาห์ถัดไป|next week/i }).click();
  const card = page.getByText(booking.serviceName, { exact: true }).first().locator('..');
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'จัดการนัดหมาย' }).click();
  const dialog = page.getByRole('dialog', { name: 'จัดการนัดหมาย' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('BOOK — bookings', () => {
  test('BOOK-01 @smoke booking week view renders seeded bookings', async ({ authedPage, api, companyId }) => {
    // The seed fixture books คุณเบล's รีทัชขนตา relative to whenever the DB was last seeded
    // (apps/api/prisma/seed.ts dateAt() anchors to `new Date()` at seed time), not to "today" --
    // it drifts out of the default "this week" view as real time passes. Look up her actual
    // appointment via Customer 360 (not week-bucketed) and jump the week view there, instead of
    // assuming the fixture always lands in the week the page opens to.
    const customers = await json<CustomerPage>(await api.get(
      `companies/${companyId}/crm/customers?scope=all&search=${encodeURIComponent('คุณเบล')}&pageSize=1`,
    ));
    expect(customers.items.length, 'seed customer คุณเบล').toBeGreaterThan(0);
    const seededBookings = await json<BookingPage>(await api.get(
      `companies/${companyId}/crm/bookings/by-customer/${customers.items[0].customer.id}`,
    ));
    const target = seededBookings.items.find((b) => /รีทัช/.test(b.serviceName));
    expect(target, 'seed fixture booking for คุณเบล').toBeDefined();

    await gotoCompany(authedPage, companyId, '/bookings');
    await resetToCurrentWeek(authedPage);
    const targetDate = new Date(target!.startAt);
    const targetSunday = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate() - targetDate.getDay());
    const now = new Date();
    const todaySunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const weeksAway = Math.round((targetSunday.getTime() - todaySunday.getTime()) / (7 * 86_400_000));
    const navButton = authedPage.getByRole('button', { name: weeksAway >= 0 ? /สัปดาห์ถัดไป|next week/i : /สัปดาห์ก่อนหน้า|previous week/i });
    for (let i = 0; i < Math.abs(weeksAway); i += 1) await navButton.click();

    await expect(authedPage.getByRole('heading', { name: /การจองออนไลน์|Online Booking/i })).toBeVisible();
    await expect(authedPage.getByText(/คุณเบล|คุณจอย|รีทัช|เติมขนตา/).first()).toBeVisible();
  });

  test('BOOK-02 @p1 week navigation reflows without client error', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/bookings');
    await authedPage.getByRole('button', { name: /สัปดาห์ถัดไป|next week/i }).click();
    await expectNoClientError(authedPage);
    await authedPage.getByRole('button', { name: /สัปดาห์ก่อนหน้า|previous week/i }).click();
    await expect(authedPage.getByRole('heading', { name: /การจองออนไลน์|Online Booking/i })).toBeVisible();
  });

  test('BOOK-03 @p1 cancels only a throwaway booking', async ({ authedPage, api, companyId }) => {
    const booking = await createBooking(api, companyId);
    const cancelled = await json<Booking>(await api.post(`companies/${companyId}/crm/bookings/${booking.id}/cancel`, { data: {} }));
    expect(cancelled.status).toBe('CANCELLED');

    await gotoCompany(authedPage, companyId, '/bookings');
    await expect(authedPage.getByRole('heading', { name: /การจองออนไลน์|Online Booking/i })).toBeVisible();
  });

  test('BOOK-04 @p1 reschedules a throwaway booking and refreshes the week view', async ({ authedPage, api, companyId }) => {
    const booking = await createBooking(api, companyId);
    const originalHour = Number(new Intl.DateTimeFormat('en', {
      timeZone: 'Asia/Bangkok', hour: '2-digit', hourCycle: 'h23',
    }).format(new Date(booking.startAt)));
    const target = await findFreeNextWeekSlot(api, companyId, booking.id, originalHour);
    const dialog = await openNextWeekBooking(authedPage, companyId, booking);
    await dialog.getByRole('button', { name: 'เลื่อนนัด' }).click();

    const rescheduleDialog = authedPage.getByRole('dialog', { name: 'เลื่อนนัด' });
    const bookingDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(booking.startAt));
    await pickThemedDate(authedPage, rescheduleDialog, target.date, bookingDate);
    await rescheduleDialog.getByLabel('เวลา').fill(target.time);
    await rescheduleDialog.getByRole('button', { name: 'บันทึกการเลื่อนนัด' }).click();
    await expect(rescheduleDialog).toBeHidden();

    const card = authedPage.getByText(booking.serviceName, { exact: true }).first().locator('..');
    await expect(card.getByText(target.range, { exact: true })).toBeVisible();
    const updated = await getBooking(api, companyId, booking);
    expect(updated.startAt).toBe(target.startAt);
    expect(updated.endAt).toBe(target.endAt);
  });

  test('BOOK-05 @p1 marks a throwaway booking done', async ({ authedPage, api, companyId }) => {
    const booking = await createBooking(api, companyId);
    const dialog = await openNextWeekBooking(authedPage, companyId, booking);
    await dialog.getByRole('button', { name: 'เสร็จสิ้น' }).click();
    // Confirmation is the app's useConfirm modal (title ยืนยัน), not a native window.confirm.
    await authedPage.getByRole('dialog', { name: 'ยืนยัน' }).getByRole('button', { name: 'ยืนยัน', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await getBooking(api, companyId, booking)).status).toBe('DONE');
  });

  test('BOOK-06 @p1 marks a throwaway booking no-show', async ({ authedPage, api, companyId }) => {
    const booking = await createBooking(api, companyId);
    const dialog = await openNextWeekBooking(authedPage, companyId, booking);
    await dialog.getByRole('button', { name: 'ไม่มาตามนัด' }).click();
    // Confirmation is the app's useConfirm modal (title ยืนยัน), not a native window.confirm.
    await authedPage.getByRole('dialog', { name: 'ยืนยัน' }).getByRole('button', { name: 'ยืนยัน', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await getBooking(api, companyId, booking)).status).toBe('NO_SHOW');
  });
});
