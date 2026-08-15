/**
 * BSC — branch scope visibility (plan §9a, spec §8).
 *
 * The coverage that would have caught D1/D2/D3: the header selector states the selection, the
 * data behind it moves with it, and a company-wide page refuses to follow it.
 *
 * Every asserted string is the app's own, not a guess:
 *   'เลือกสาขา'      WorkspaceScope.tsx:164 (selector trigger aria-label)
 *   'ทุกสาขา (รวม)'  workspace-dictionary.ts:185  branch.scope.all
 *   'ทั้งบริษัท'      workspace-dictionary.ts:186  branch.scope.company_wide
 *   ' (สำนักงานใหญ่)' workspace-dictionary.ts:187  branch.suffix.head_office, appended by
 *                    branchDisplayName() (branch-scope-label.logic.ts:17) for type HEAD_OFFICE
 * Branch names come from the API at runtime rather than the seed file, so a renamed seed row
 * fails as a data mismatch instead of as a stale literal.
 */
import { test, expect } from './harness/fixtures';
import type { APIRequestContext, Page } from '@playwright/test';
import { gotoCompany, json } from './harness/e2e-utils';

type Branch = { id: string; code: string; name: string; type: string };
type BranchPage = { items: Branch[] };
type Booking = { id: string; branchId: string; customerName?: string; serviceName: string; startAt: string; status: string };
type BookingPage = { items: Booking[] };

const ALL_BRANCHES = 'ทุกสาขา (รวม)';
const COMPANY_WIDE = 'ทั้งบริษัท';
const HEAD_OFFICE = 'Head Office (สำนักงานใหญ่)'; // seed.ts:2826 name + head_office suffix
const SIAM_CODE = 'SIAM'; // seed.ts:79 — Room45 Eyes Lashes · สยาม

// The week grid only lays out these hours (bookings.model.ts:15-16 BK_HOUR_START/BK_HOUR_END, walked
// at :139-141), so a booking outside them is fetched and counted but has no card to find. Grid math
// is browser-LOCAL time by design (bookings.model.ts:3-5), which is why the finder below reads
// getHours() rather than forcing a timezone: the runner and the browser share one clock.
const GRID_HOUR_START = 9;
const GRID_HOUR_END = 20;

const selector = (page: Page) => page.getByRole('button', { name: 'เลือกสาขา' });
const main = (page: Page) => page.locator('#workspace-main'); // WorkspaceShell.tsx:68 — page body only, never the header
/** branch-scope-label.logic.ts:17 — the suffix is workspace-dictionary.ts:187, head office only. */
const displayName = (branch: Branch) => `${branch.name}${branch.type === 'HEAD_OFFICE' ? ' (สำนักงานใหญ่)' : ''}`;

/** Open the header selector, choose an option by its rendered name, and confirm the trigger now says so. */
async function pickBranch(page: Page, name: string) {
  await selector(page).click();
  // Dropdown options are labelled by branchDisplayName(); the selected one carries a ' ✓' suffix,
  // so `exact` also guarantees we never re-click the branch that is already active.
  await page.getByRole('button', { name, exact: true }).click();
  await expect(selector(page)).toHaveText(name);
}

async function activeBranches(api: APIRequestContext, companyId: string) {
  const page = await json<BranchPage>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  const byCode = (code: string) => {
    const found = page.items.find((b) => b.code === code);
    expect(found, `seeded ACTIVE branch ${code}`).toBeDefined();
    return found!;
  };
  return { byCode, all: page.items };
}

/** Sunday-start week key for the list query — mirrors weekStartParam/getWeekStart (bookings.model.ts:74-86).
 *  The API brackets the same Sunday→Sunday span in Bangkok (crm-booking.logic.ts:95-97), so the week
 *  queried here is exactly the week that grid offset renders. */
function weekStartParam(base: Date, weekOffset: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - base.getDay() + weekOffset * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Fixture = { booking: Booking; hour: number; branch: Branch; weekOffset: number };

/**
 * Choose a booking the grid will really render, rather than trusting one named seed row to stay put:
 * seeded bookings are anchored to seed time (seed.ts dateAt()) and drift out of both the visible week
 * AND the visible hours as real time passes. Requirements, each one a way the card could go missing:
 *  - BOOKED, with a customerName — the card is located by that text (BookingsPrototypePage.tsx:115)
 *  - inside the rendered hour window, in local time
 *  - on a branch that is ACTIVE, so the header selector can actually be switched to it
 *  - the day's FIRST in-window booking: an earlier one on the same day swallows the hours it spans
 *    (bookings.model.ts:159) and one in the same hour overwrites it in the map (:135)
 *  - the only booking of that customer name in the week, or the "count 0" flip would find the other one
 */
async function findRenderableBooking(api: APIRequestContext, companyId: string, branches: Branch[]): Promise<Fixture | null> {
  const today = new Date();
  const offsets = [0];
  for (let n = 1; n <= 8; n += 1) offsets.push(n, -n); // nearest weeks first: fewer nav clicks
  const at = (b: Booking) => { const d = new Date(b.startAt); return { day: d.toDateString(), hour: d.getHours() }; };

  for (const weekOffset of offsets) {
    const week = await json<BookingPage>(await api.get(
      `companies/${companyId}/crm/bookings?weekStart=${weekStartParam(today, weekOffset)}`,
    ));
    const found = week.items.find((booking) => {
      const { day, hour } = at(booking);
      if (booking.status !== 'BOOKED' || !booking.customerName) return false;
      if (hour < GRID_HOUR_START || hour >= GRID_HOUR_END) return false;
      if (!branches.some((b) => b.id === booking.branchId)) return false;
      return week.items.every((other) => {
        if (other.id === booking.id) return true;
        if (other.customerName === booking.customerName) return false;
        const o = at(other);
        if (o.day !== day) return true;
        return o.hour < GRID_HOUR_START || o.hour >= GRID_HOUR_END || o.hour > hour;
      });
    });
    if (found) {
      return {
        booking: found,
        hour: at(found).hour,
        branch: branches.find((b) => b.id === found.branchId)!,
        weekOffset,
      };
    }
  }
  return null;
}

test.describe('BSC — branch scope visibility', () => {
  test('BSC-01 @p1 the selector states the selection and keeps it across a reload', async ({ authedPage, api, companyId }) => {
    const siamName = displayName((await activeBranches(api, companyId)).byCode(SIAM_CODE));
    await gotoCompany(authedPage, companyId, '/bookings');

    // A fresh browser context has no watchdog.branchFilter.<companyId> key (WorkspaceScope.tsx:42),
    // so the page always opens on all branches — no UI reset step needed.
    await expect(selector(authedPage)).toHaveText(ALL_BRANCHES);

    await pickBranch(authedPage, siamName);

    await authedPage.reload();
    await expect(selector(authedPage), 'selection survives a reload via localStorage').toHaveText(siamName);
  });

  test('BSC-02 @p1 switching branch changes the bookings the week view renders', async ({ authedPage, api, companyId }) => {
    const { all } = await activeBranches(api, companyId);
    const fixture = await findRenderableBooking(api, companyId, all);
    expect(
      fixture,
      `no seeded booking inside the rendered grid window (${GRID_HOUR_START}:00–${GRID_HOUR_END - 1}:00 local, `
        + 'bookings.model.ts:15-16) in any week ±8 — reseed or fix seed dateAt()',
    ).not.toBeNull();
    const { booking, branch, hour, weekOffset } = fixture!;
    const other = all.find((b) => b.id !== branch.id);
    expect(other, 'a second ACTIVE branch to flip to').toBeDefined();
    // Which row the finder settled on is the first question when this test goes red, so say it.
    console.log(`BSC-02 fixture: ${booking.id} "${booking.customerName}" · ${branch.code} · ${hour}:00 local · week ${weekOffset >= 0 ? '+' : ''}${weekOffset}`);

    await gotoCompany(authedPage, companyId, '/bookings');
    // On a Saturday evening the page opens on next week already (initialBookingWeekOffset), so
    // start counting from a known offset.
    const reset = authedPage.getByRole('button', { name: 'กลับมาวันนี้' });
    if (await reset.isVisible().catch(() => false)) await reset.click();
    const nav = authedPage.getByRole('button', { name: weekOffset >= 0 ? 'สัปดาห์ถัดไป' : 'สัปดาห์ก่อนหน้า' });
    for (let i = 0; i < Math.abs(weekOffset); i += 1) await nav.click();

    // The booking card renders the customer name in its own element (BookingsPrototypePage.tsx:115).
    const card = main(authedPage).getByText(booking.customerName!, { exact: true });
    // The page's own "สาขาที่กำลังดู" chip (BookingsPrototypePage.tsx:478) is asserted beside the
    // rows it captions — it used to fall back to branches[0] and name one branch above all-branch
    // data, so the label and the data are pinned together or not at all.
    const viewingChip = (label: string) => main(authedPage).getByText(label, { exact: true });
    await expect(card.first(), 'all branches shows the booking').toBeVisible();
    await expect(viewingChip(ALL_BRANCHES), 'all-branch rows are captioned as such').toBeVisible();

    await pickBranch(authedPage, displayName(other!));
    await expect(card, `${other!.code} must not show a ${branch.code} booking`).toHaveCount(0);
    await expect(viewingChip(displayName(other!))).toBeVisible();

    await pickBranch(authedPage, displayName(branch));
    await expect(card.first(), `${branch.code} shows it again`).toBeVisible();
    await expect(viewingChip(displayName(branch))).toBeVisible();
  });

  test('BSC-03 @p1 the dashboard chip, subtitle and query follow the selection', async ({ authedPage, api, companyId }) => {
    const siamName = displayName((await activeBranches(api, companyId)).byCode(SIAM_CODE));
    await gotoCompany(authedPage, companyId, '/dashboard');

    const chip = (label: string) => main(authedPage).getByText(label, { exact: true }); // DashboardPages.tsx:265-268
    const subtitle = main(authedPage).locator('p').filter({ hasText: 'ภาพรวมธุรกิจ' }); // DashboardPages.tsx:277
    await expect(chip(ALL_BRANCHES)).toBeVisible();

    // Risk 7 in the plan: a chip that follows the selector while the fetch does not is the original
    // bug wearing a new label. Pin the request, not just the caption.
    const branchLoad = authedPage.waitForResponse((res) => res.url().includes('/dashboard?') && res.url().includes('branchId='));
    await pickBranch(authedPage, siamName);
    expect((await branchLoad).status(), 'dashboard refetched, scoped to the branch').toBe(200);

    await expect(chip(siamName)).toBeVisible();
    await expect(subtitle).toContainText(siamName);
    await expect(main(authedPage).getByText('โหลดข้อมูลแดชบอร์ดไม่สำเร็จ')).toHaveCount(0);
  });

  test('BSC-04 @p1 a company-wide page states its own scope, not the selected branch', async ({ authedPage, api, companyId }) => {
    const siamName = displayName((await activeBranches(api, companyId)).byCode(SIAM_CODE));
    await gotoCompany(authedPage, companyId, '/bookings');
    await pickBranch(authedPage, siamName);

    await gotoCompany(authedPage, companyId, '/settings/permissions');
    await expect(selector(authedPage), 'the selection itself survives the navigation').toHaveText(siamName);
    // PermissionMatrixPrototypePage.tsx:243 — company-wide by nature (spec R2).
    await expect(main(authedPage).getByText(COMPANY_WIDE, { exact: true })).toBeVisible();
    await expect(main(authedPage).getByText(siamName, { exact: true })).toHaveCount(0);
  });

  test('BSC-05 @p2 head office keeps its suffix from the dropdown to the trigger', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/bookings');
    // pickBranch clicks the option by that exact name and asserts the trigger repeats it, which
    // pins branchDisplayName() on both ends.
    await pickBranch(authedPage, HEAD_OFFICE);
  });
});
