import { test as base, expect } from '@playwright/test';
import { test as authedTest } from './harness/fixtures';
import {
  COMPANY_ID,
  SEED_USERS,
  ensureBrowserLegalAcceptance,
  expectNoClientError,
} from './harness/auth';

base.describe('LOGIN — auth & session', () => {
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
      await expect(page.getByRole('status')).toContainText('ยังไม่เปิดให้เข้าสู่ระบบด้วย LINE');
      await expect(lineButton).toBeDisabled();
      await expect(page.getByRole('button', { name: 'สแกน QR ด้วย LINE เพื่อเข้าสู่เว็บไซต์' })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'เข้าสู่ระบบด้วยรหัส OTP', exact: true })).toBeVisible();
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
    await authedPage.getByRole('button', { name: /เมนูผู้ใช้|User Menu/i }).click();
    await authedPage.getByRole('button', { name: /ออกจากระบบ|Sign out|Logout/i }).click();
    await authedPage.getByRole('dialog').getByRole('button', { name: /ออกจากระบบ|Sign out|Logout/i }).click();
    await expect(authedPage).toHaveURL(/\/login/);

    await authedPage.goto(`/companies/${companyId}/dashboard`);
    await expect(authedPage).toHaveURL(/\/login\?next=/);
  });
});
