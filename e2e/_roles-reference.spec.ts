/**
 * Rig proof for the multi-role harness — the pattern every tennis-shop spec copies.
 *
 * This is NOT part of the 247-case catalogue. It proves three things before Codex writes
 * anything: all ten seeded QA roles can actually log in, the sidebar matrix in
 * harness/roles.ts matches what the app renders, and a denied route really bounces.
 *
 * If this file is red, the environment or the seed is wrong — fix that, not the tests.
 */
import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import {
  ALL_ROLES,
  expectRouteAccess,
  expectSidebarMatchesRole,
  expectSubMenuMatchesRole,
  href,
  type RoleKey,
} from './harness/roles';

test.describe('harness: multi-role auth', () => {
  test('every seeded QA role can obtain an API token @smoke', async ({ apiAs }) => {
    for (const role of ALL_ROLES) {
      const api = await apiAs(role);
      const res = await api.get('auth/me');
      expect(res.ok(), `auth/me as ${role} (${res.status()})`).toBe(true);
      const me = (await res.json()) as { roles?: string[]; permissions?: string[] };
      expect(me.permissions?.length, `${role} has permissions`).toBeGreaterThan(0);
    }
  });

  test('every seeded QA role can open a browser session @smoke', async ({ pageAs, companyId }) => {
    for (const role of ALL_ROLES) {
      const page = await pageAs(role);
      await page.goto(href(companyId, 'dashboard'));
      await expect(page.locator('aside nav'), `${role} sees the workspace shell`).toBeVisible();
      await expectNoClientError(page);
    }
  });
});

test.describe('harness: access matrix', () => {
  // Three roles that between them exercise every column shape: full access, the
  // read-only investor view, and the most restricted employee.
  for (const role of ['OWNER', 'SALES', 'STAFF'] as RoleKey[]) {
    test(`sidebar matches the matrix for ${role} @smoke`, async ({ pageAs, companyId }) => {
      const page = await pageAs(role);
      await page.goto(href(companyId, 'dashboard'));
      await expectSidebarMatchesRole(page, role);
    });
  }

  test('expenses sub-menu matches the matrix for FINANCE and MARKETING', async ({ pageAs, companyId }) => {
    for (const role of ['FINANCE', 'MARKETING'] as RoleKey[]) {
      const page = await pageAs(role);
      await page.goto(href(companyId, 'expenses'));
      await expectSubMenuMatchesRole(page, role, 'expenses');
    }
  });

  // ตั้งค่าบริษัท is gated on the hub's own key list (company settings + ledger/tax read keys),
  // not the union of every card — so MANAGER/FINANCE/ACCOUNTANT (tax.config.read) see it, while
  // roles holding only account.password.change / company.branch.read do not.
  test('ตั้งค่าบริษัท shows only for roles holding a hub key @smoke', async ({ pageAs, companyId }) => {
    for (const role of ALL_ROLES) {
      const page = await pageAs(role);
      await page.goto(href(companyId, 'dashboard'));
      const shouldSee = ['OWNER', 'COMPANY_VIEW', 'ADMIN', 'MANAGER', 'FINANCE', 'ACCOUNTANT'].includes(role);
      await expect(
        page.locator('aside nav').getByText('ตั้งค่าบริษัท', { exact: true }),
        `${role} ${shouldSee ? 'should see' : 'must NOT see'} ตั้งค่าบริษัท`,
      ).toHaveCount(shouldSee ? 1 : 0);
      // Everyone keeps their own account-security page — it hangs off the header user menu.
      await expectRouteAccess(page, companyId, 'settings', role);
    }
  });

  test('a denied route redirects to the dashboard @smoke', async ({ pageAs, companyId }) => {
    // STAFF has no booking permission, so /bookings must bounce.
    const staff = await pageAs('STAFF');
    await expectRouteAccess(staff, companyId, 'booking', 'STAFF');

    // ...and the same route is reachable for SALES, proving the assertion discriminates.
    const sales = await pageAs('SALES');
    await expectRouteAccess(sales, companyId, 'booking', 'SALES');
  });
});
