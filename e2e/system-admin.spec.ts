import { test, expect } from './harness/fixtures';
import { COMPANY_ID, SEED_USERS, expectNoClientError } from './harness/auth';
import { unique } from './harness/e2e-utils';

async function login(page: any, username: string, password: string) {
  await page.goto('/login');
  await page.locator('#login-identifier').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
  await expect(page).toHaveURL(/\/(companies|system)\//);
}

test.describe('SYS — system admin', () => {
  test('SYS-01 @smoke system partner list renders for system admin', async ({ page }) => {
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    await page.goto('/system/partners');
    await expect(page.getByRole('heading', { name: /Partner Companies/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Onboard New Partner/i })).toBeVisible();
    await expectNoClientError(page);
  });

  test('SYS-02 @p1 partner detail renders metadata and feature toggles', async ({ page }) => {
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    await page.goto(`/system/partners/${COMPANY_ID}`);
    await expect(page.getByText(/WatchDog Local Company|seed-local-company|Feature/i).first()).toBeVisible();
    await expect(page.getByText(/LINE|feature|module|สถานะ/i).first()).toBeVisible();
    await expectNoClientError(page);
  });

  test('SYS-03 @p1 onboarding form can start a draft onboarding', async ({ page }) => {
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    await page.goto('/system/company-onboardings/new');
    await expect(page.getByRole('heading', { name: /New Company Onboarding/i })).toBeVisible();
    // ThemedSelect renders an sr-only form input for its `name`, so bare input-index
    // selectors drift; the three text fields are the only visible mangmee-input inputs.
    const fields = page.locator('input.mangmee-input:visible');
    await fields.nth(0).fill(unique('E2E Partner'));
    await fields.nth(1).fill(unique('E2E Owner'));
    await fields.nth(2).fill(unique('e2e-owner').toLowerCase());
    // Required since the PDPA tenant tripwire: the form will not submit uncategorised.
    // RETAIL deliberately — the non-alerting path, so the e2e run does not page the dev team.
    // The category picker is a ThemedSelect (combobox + role="option" buttons), not a native
    // <select>, so it needs open-then-click instead of selectOption().
    await page.getByRole('combobox', { name: 'ประเภทธุรกิจ / Business Category' }).click();
    await page.getByRole('option', { name: 'ค้าปลีก (Retail)', exact: true }).click();
    await page.getByRole('button', { name: /Create Onboarding/i }).click();
    await expect(page.getByText(/Handoff Package|temporary password|Company/i).first()).toBeVisible();
  });

  test('SYS-05 @p1 seeded owner cannot reach system partner scope', async ({ authedPage }) => {
    await authedPage.goto('/system/partners');
    await expect(authedPage.getByText(/Access denied|ไม่มีสิทธิ์|not have permission/i).first()).toBeVisible();
  });
});
