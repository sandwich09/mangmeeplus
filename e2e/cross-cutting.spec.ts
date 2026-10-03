import { test, expect } from './harness/fixtures';
import {
  COMPANY_ID,
  SEED_USERS,
  ensureBrowserLegalAcceptance,
  expectNoClientError,
} from './harness/auth';
import { expectMainReady, gotoCompany } from './harness/e2e-utils';

const readyRoutes = [
  '/dashboard',
  '/inbox',
  '/bookings',
  '/inventory',
  '/procurement',
  '/workflow',
  '/ai-suggestions',
  '/expenses',
  '/journal',
  '/accounts-payable',
  '/reimbursements',
  '/banking',
  '/reports',
  '/notifications',
  '/settings',
  '/settings/employees',
];

async function login(page: any, username: string, password: string, next = `/companies/${COMPANY_ID}/dashboard`) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.locator('#login-identifier').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
  await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/)/);
  await ensureBrowserLegalAcceptance(page.context(), COMPANY_ID);
  // A fresh account lands on the legal-acceptance page, which moves on to `next` by itself once the acceptance
  // above is recorded: this navigation can race it and be aborted (net::ERR_ABORTED). Either way the page has
  // to end up at `next`.
  await page.goto(next).catch((error: Error) => { if (!/ERR_ABORTED/.test(error.message)) throw error; });
  await page.waitForURL((url: URL) => `${url.pathname}${url.search}` === next);
}

test.describe('XC — cross-cutting', () => {
  test('XC-01 @smoke ready route sweep renders main content without client errors', async ({ authedPage, companyId }) => {
    for (const route of readyRoutes) {
      await gotoCompany(authedPage, companyId, route);
      await expectMainReady(authedPage);
    }
  });

  // Quarantined, not deleted (e2e/HANDOFF.md §2.7). The authenticated workspace is Thai-only
  // by product decision: WorkspaceLayout pins `locale = 'th'` and renders no language control,
  // so useLocale()/the watchdog.workspace.locale key are only exercised by the pre-auth pages.
  // Blocking dependency: a decision to ship a bilingual workspace. The spec stays as written so
  // it is ready the day that lands.
  test.fixme('XC-02 @p1 workspace language control switches and persists locale', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/dashboard');
    await authedPage.getByRole('button', { name: /^(ภาษา|Language)$/i }).click();
    await expect(authedPage.getByRole('link', { name: /Dashboard/i }).first()).toBeVisible();
    await authedPage.reload();
    await expect(authedPage.getByRole('link', { name: /Dashboard/i }).first()).toBeVisible();
    expect(await authedPage.evaluate(() => window.localStorage.getItem('watchdog.workspace.locale'))).toBe('en');
  });

  test('XC-03 @p1 companyView cannot reach the manage-only permissions screen', async ({ page }) => {
    await login(page, SEED_USERS.companyView.username, SEED_USERS.companyView.password, `/companies/${COMPANY_ID}/settings/permissions`);
    // access.role.manage is required to SEE the page. Since 0e1a81d8b a denied page is refused in place, inside
    // the shell with a way back, instead of bouncing to the dashboard (SET-09 checks the same for qa.company).
    await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_ID}/settings/permissions$`));
    await expect(page.getByText('ไม่มีสิทธิ์เข้าถึง', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: /สิทธิ์การใช้งาน|Permissions/i })).toHaveCount(0);
  });

  test('XC-04 @p1 bogus company id is handled gracefully', async ({ authedPage }) => {
    await authedPage.goto('/companies/not-a-company/dashboard');
    // The API resolves an unknown company id to 403 (no active membership), which the
    // workspace layout renders as CompanyAccessUnavailable ("ไม่สามารถเข้าถึงบริษัทนี้ได้" /
    // "This company is unavailable") rather than a generic not-found/forbidden string.
    await expect(authedPage.getByText(/ไม่พบหน้านี้|not found|This page could not be found|ไม่มีสิทธิ์|Forbidden|ไม่สามารถเข้าถึงบริษัทนี้ได้|company is unavailable/i).first()).toBeVisible();
  });

  test('XC-05 @p1 logged-out deep route preserves next target through login', async ({ page }) => {
    const target = `/companies/${COMPANY_ID}/reports`;
    await page.goto(target);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    await page.locator('#login-identifier').fill(SEED_USERS.owner.username);
    await page.locator('#login-password').fill(SEED_USERS.owner.password);
    await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
    await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/)/);
    await ensureBrowserLegalAcceptance(page.context(), COMPANY_ID);
    await page.goto(target);
    await expect(page).toHaveURL(new RegExp(target));
    await expectNoClientError(page);
  });
});

// Date-input contract — docs/specs/date-time-correctness-spec.md §10.
// The civil-date helpers throw from inside repositories, where a Nest exception would not belong,
// so AllExceptionsFilter translates InvalidCivilDateError to 400. Without that translation the
// remediation turned every malformed date into a 500. This is also stricter than what it
// replaced: `2026-02-30` used to be accepted and silently queried as 2 March.
test('XC-20 @p1 a malformed date filter is a client error, not a server error', async ({ api, companyId }) => {
  for (const bad of ['garbage', '2026-02-30', '2026-8-4']) {
    for (const path of [
      `companies/${companyId}/accounts-payable/vendor-bills?fromDate=${bad}&toDate=${bad}`,
      `companies/${companyId}/expenses?fromDate=${bad}&toDate=${bad}`,
    ]) {
      const res = await api.get(path);
      expect(res.status(), `${path} must answer 4xx, never 5xx`).toBe(400);
    }
  }

  // An absent filter is not a malformed one.
  const empty = await api.get(`companies/${companyId}/expenses?fromDate=&toDate=`);
  expect(empty.status()).toBe(200);
});
