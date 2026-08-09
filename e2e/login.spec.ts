import { test as base, expect } from '@playwright/test';
import { test as authedTest } from './harness/fixtures';
import {
  COMPANY_ID,
  SEED_USERS,
  ensureBrowserLegalAcceptance,
  expectNoClientError,
} from './harness/auth';

base.describe('LOGIN — auth & session', () => {
  base('LOGIN-01 @smoke redirects workspace visitors to login', async ({ page }) => {
    await page.goto(`/companies/${COMPANY_ID}/dashboard`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await expect(page.locator('#login-identifier')).toBeVisible();
    await expect(page.locator('#login-password')).toBeVisible();
  });

  base('LOGIN-02 @smoke signs in seeded owner through form', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-identifier').fill(SEED_USERS.owner.username);
    await page.locator('#login-password').fill(SEED_USERS.owner.password);
    await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
    await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/)/);
    await ensureBrowserLegalAcceptance(page.context(), COMPANY_ID);
    await page.goto(`/companies/${COMPANY_ID}/dashboard`);
    await expect(page).toHaveURL(/\/companies\/[^/]+\/dashboard/);
    await expectNoClientError(page);
  });

  base('LOGIN-03 @p1 rejects bad owner password', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-identifier').fill(SEED_USERS.owner.username);
    await page.locator('#login-password').fill('wrong');
    await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('alert')).toBeVisible();
  });

  base('LOGIN-04 @p1 empty login does not create a session', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('#login-identifier')).toBeVisible();
  });
});

authedTest.describe('LOGIN — authenticated session controls', () => {
  authedTest('LOGIN-05 @p1 logout clears browser session', async ({ authedPage, companyId }) => {
    await authedPage.goto(`/companies/${companyId}/dashboard`);
    await authedPage.getByRole('button', { name: /ออกจากระบบ|Sign out|Logout/i }).first().click();
    await authedPage.getByRole('dialog').getByRole('button', { name: /ออกจากระบบ|Sign out|Logout/i }).click();
    await expect(authedPage).toHaveURL(/\/login/);

    await authedPage.goto(`/companies/${companyId}/dashboard`);
    await expect(authedPage).toHaveURL(/\/login\?next=/);
  });
});
