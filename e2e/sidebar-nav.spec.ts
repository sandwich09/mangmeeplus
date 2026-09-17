import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { gotoCompany } from './harness/e2e-utils';
import { openSubmenuLabels } from './harness/roles';

// A route must light up exactly one sidebar row. Regression guard for the case where
// /settings/line-oa lit up both "เชื่อมต่อ LINE OA" and its parent "ตั้งค่าบริษัท",
// because the active module resolved to the shortest matching href instead of the
// most specific one.
const ACTIVE_TOP = 'aside a.menu-item[data-active="true"], aside button.menu-item[data-active="true"]';
const ACTIVE_SUB = 'aside a.menu-dropdown-item-active';

async function activeRows(page: import('@playwright/test').Page) {
  return {
    top: await page.locator(ACTIVE_TOP).allTextContents(),
    sub: await page.locator(ACTIVE_SUB).allTextContents(),
  };
}

test.describe('NAV — sidebar active state', () => {
  test('NAV-01 @p1 clicking เชื่อมต่อ LINE OA highlights only that row', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/dashboard');

    // Click the sub-item the way a user does, rather than deep-linking to it.
    const lineOa = authedPage.locator('aside a[href$="/settings/line-oa"]');
    await lineOa.scrollIntoViewIfNeeded();
    await lineOa.click();
    await authedPage.waitForURL('**/settings/line-oa');
    await expectNoClientError(authedPage);

    const { top, sub } = await activeRows(authedPage);
    expect(top, 'parent ตั้งค่าบริษัท must not light up too').toEqual([]);
    expect(sub.length, 'exactly one sub-item active').toBe(1);
    expect(sub[0]).toContain('LINE OA');
  });

  test('NAV-02 @p1 settings index highlights ภาพรวมการตั้งค่า alone', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/settings');
    await expectNoClientError(authedPage);

    const { top, sub } = await activeRows(authedPage);
    expect(top, 'parent ตั้งค่าบริษัท stays dark').toEqual([]);
    expect(sub.length, 'exactly one sub-item active').toBe(1);
    expect(sub[0]).toContain('ภาพรวมการตั้งค่า');
  });

  test('NAV-03 @p2 every settings route highlights exactly one row', async ({ authedPage, companyId }) => {
    for (const route of [
      '/settings/permissions',
      '/settings/employees',
      '/settings/access-overview',
      '/settings/po-approval',
      '/settings/discount-policy',
      '/settings/branches',
    ]) {
      await gotoCompany(authedPage, companyId, route);
      const { top, sub } = await activeRows(authedPage);
      expect(top.length + sub.length, `exactly one active row on ${route}`).toBe(1);
    }
  });

  test('NAV-04 @p1 active submenu parent can still collapse and expand', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/settings/line-oa');

    const parent = authedPage.locator('aside li:has(a[href$="/settings/line-oa"]) > button.menu-item');
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
    await parent.click();
    await expect(parent).toHaveAttribute('aria-expanded', 'false');
    await parent.click();
    await expect(parent).toHaveAttribute('aria-expanded', 'true');
  });

  // Regression guard for BUG-1: the route-sync effect also depended on `openSubmenu` and
  // re-asserted the active parent whenever they differed, so on any page whose module has
  // children the user could neither collapse that parent nor open a different one.
  test('NAV-05 @p1 the accordion obeys the user on a page whose module has children', async ({ authedPage, companyId }) => {
    const nav = authedPage.locator('aside nav');
    await gotoCompany(authedPage, companyId, '/expenses');

    // A deep link still opens the parent of the page you landed on.
    await expect.poll(() => openSubmenuLabels(authedPage)).toContain('ค่าใช้จ่ายและใบเสร็จ');

    await nav.getByRole('button', { name: 'ค่าใช้จ่ายและใบเสร็จ' }).click();
    await expect.poll(() => openSubmenuLabels(authedPage), { message: 'user can collapse it' }).toEqual([]);

    await nav.getByRole('button', { name: 'พนักงานและสิทธิ์' }).click();
    await expect.poll(() => openSubmenuLabels(authedPage), { message: 'user can open another' }).toEqual(['พนักงานและสิทธิ์']);

    await nav.getByRole('button', { name: 'พนักงานและสิทธิ์' }).click();
    await expect.poll(() => openSubmenuLabels(authedPage)).toEqual([]);

    // Navigating to a sub-item still re-opens its parent — the behaviour the effect exists for.
    await gotoCompany(authedPage, companyId, '/expenses/categories');
    await expect.poll(() => openSubmenuLabels(authedPage)).toContain('ค่าใช้จ่ายและใบเสร็จ');
  });
});


test('NAV-BILLING owner package link belongs to company settings', async ({ authedPage: page, companyId }) => {
  await gotoCompany(page, companyId, '/settings/branches');
  const parent = page.locator('aside li').filter({ has: page.locator('a[href$="/billing"]') });
  await expect(parent.locator('button.menu-item')).toHaveText(/ตั้งค่าบริษัท/);
  const billing = page.locator('aside a[href$="/billing"]');
  await expect(billing).toHaveCount(1);
  await expect(billing).toHaveClass(/menu-dropdown-item/);
  await billing.click();
  await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/billing$`));
  await expectNoClientError(page);
});
