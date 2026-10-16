import { test as base, expect } from '@playwright/test';
import { test as authedTest } from './harness/fixtures';
import {
  COMPANY_ID,
  SEED_USERS,
  expectNoClientError,
} from './harness/auth';

base.describe('LOGIN — auth & session', () => {
  base('LOGIN-LINE preserves unavailable recovery and starts OAuth only after confirmed sign-out', async ({ page }) => {
    let refreshStatus = 503;
    const oauthRequests: string[] = [];
    await page.route('**/api/auth/refresh', route => route.fulfill({ status: refreshStatus, json: {} }));
    await page.route('**/api/auth/line-login/availability', route => route.fulfill({ json: { available: true } }));
    await page.route('**/api/auth/line-login/start?**', route => {
      oauthRequests.push(route.request().url());
      return route.fulfill({ contentType: 'text/html', body: 'OAuth boundary reached' });
    });
    await page.goto('/login?line=handoff-expired&next=%2Fcompanies%2Fline-test%2Fdashboard');
    await expect(page.locator('[data-platform-access="open"]')).toHaveCount(1);
    await expect(page.locator('[data-client-compatibility-notice="generic"][role="alert"]')).toBeVisible();
    const retry = page.getByRole('link', { name: 'ลองอีกครั้ง' });
    await expect(retry).toBeVisible();
    await expect(page).toHaveURL(/\/login\?line=handoff-expired&next=/);
    expect(oauthRequests).toEqual([]);
    refreshStatus = 401;
    await retry.click();
    await expect(page).toHaveURL(/\/api\/auth\/line-login\/start\?.*from=handoff-expired&auto=1/);
    expect(oauthRequests).toHaveLength(1);
    expect(new URL(oauthRequests[0]).searchParams.get('returnTo')).toBe('/companies/line-test/dashboard');
  });

  for (const width of [1280, 390]) {
    base(`LOGIN-LINE keeps availability clear and retries without losing input at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      let releaseCheck!: () => void;
      const pending = new Promise<void>(resolve => { releaseCheck = resolve; });
      let responseState: 'unavailable' | 'error' | 'available' = 'unavailable';
      await page.route('**/api/auth/line-login/availability', async route => {
        await pending;
        await route.fulfill({ status: responseState === 'error' ? 503 : 200, json: { available: responseState === 'available' } });
      });
      await page.goto('/login?recovered=1&next=%2Fcompanies%2Fline-test%2Fdashboard');
      const lineButton = page.getByRole('button', { name: 'เข้าสู่ระบบด้วย LINE', exact: true });
      await expect(lineButton).toBeVisible();
      await expect(lineButton).toBeDisabled();
      await expect(page.getByRole('status')).toContainText('กำลังตรวจสอบ');
      releaseCheck();
      // LINE sign-in that is switched off draws no button and no apology.
      await expect(lineButton).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'สแกน QR ด้วย LINE เพื่อเข้าสู่เว็บไซต์' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'ใช้รหัสยืนยันทางอีเมลแทนรหัสผ่าน', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`login-line-unavailable-${width}.png`), fullPage: true });

      responseState = 'error';
      await page.reload();
      await expect(page.getByRole('status')).toContainText('ตรวจสอบสถานะ LINE ไม่สำเร็จ');
      await expect(lineButton).toBeDisabled();
      await page.locator('#login-identifier').fill('unsaved-login');
      await page.locator('#login-password').fill('unsaved-password');
      responseState = 'available';
      await page.getByRole('button', { name: 'ลองตรวจสอบอีกครั้ง' }).click();
      await expect(lineButton).toBeEnabled();
      await expect(page.locator('#login-identifier')).toHaveValue('unsaved-login');
      await expect(page.locator('#login-password')).toHaveValue('unsaved-password');
      const qr = page.getByRole('button', { name: 'สแกน QR ด้วย LINE เพื่อเข้าสู่เว็บไซต์' });
      if (width >= 768) await expect(qr).toBeVisible();
      else await expect(qr).not.toBeVisible();
      // Stop at our BFF boundary; never contact the real LINE provider.
      await page.route('**/api/auth/line-login/start?**', route => route.fulfill({ contentType: 'text/html', body: 'OAuth boundary reached' }));
      await lineButton.click();
      await expect(page).toHaveURL(/\/api\/auth\/line-login\/start\?returnTo=%2Fcompanies%2Fline-test%2Fdashboard$/);
    });
  }

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
    const response = page.waitForResponse(response => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST');
    await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
    const signedIn = await response;
    // The page leaves /login at once, and the browser drops the answer's body with it: read only the status.
    expect(signedIn.ok(), `password sign-in failed (${signedIn.status()})`).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/legal-acceptance(?:\\?|$)|/companies/${COMPANY_ID}/dashboard(?:\\?|$)`));
    if (/\/legal-acceptance(?:\?|$)/.test(page.url())) {
      // A fresh seed reaches the first-use gate. Let its form own acceptance and refresh;
      // an API fixture accepting in parallel can race the mounted page's own refresh/redirect.
      await page.locator('input[name="termsAccepted"]').check();
      await page.locator('input[name="privacyAcknowledged"]').check();
      await page.locator('input[name="deletionAcknowledged"]').check();
      await page.getByRole('button', { name: 'ยืนยันและเริ่มใช้งาน', exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_ID}/dashboard(?:\\?|$)`));
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_ID}/dashboard(?:\\?|$)`));
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
    await authedPage.getByRole('button', { name: /เมนูผู้ใช้|User Menu/i }).click();
    // Signing out no longer asks first (2026-10-13, thai-ux-standard §4.1): the menu row signs out at once.
    await authedPage.getByRole('button', { name: /ออกจากระบบ|Sign out|Logout/i }).click();
    await expect(authedPage).toHaveURL(/\/login/);

    await authedPage.goto(`/companies/${companyId}/dashboard`);
    await expect(authedPage).toHaveURL(/\/login\?next=/);
  });
});
