import { expect, test } from '@playwright/test';

const IOS_15_LINE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_8 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/13.20.0';
const IOS_16_4 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Version/16.4 Safari/604.1';

test.describe('generic client compatibility notice', () => {
  test.use({ userAgent: IOS_15_LINE, viewport: { width: 320, height: 568 } });

  test('redirects before session recovery and keeps the server notice actionable', async ({ page }) => {
    let refreshRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/api/auth/refresh')) refreshRequests += 1;
    });

    const response = await page.goto('/login');

    await expect(page).toHaveURL(/\/unsupported-browser\?next=%2Flogin$/);
    await expect(page.locator('[data-client-compatibility-notice="generic"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ไม่สามารถเปิด Mangmee Plus ได้' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ลองใหม่ / Try again' })).toHaveAttribute('href', '/login');
    await expect(page.getByRole('link', { name: 'ติดต่อเจ้าหน้าที่ / Contact support' })).toHaveAttribute(
      'href',
      'mailto:contact@mangmeeplus.com',
    );
    await expect(page.locator('body')).not.toContainText(/Legacy|iPhone|15_8/i);
    // Next dev rewrites dynamic-page caching to no-cache; the proxy unit and production-build curl
    // assert the stricter private/no-store header shipped by the release artifact.
    expect(response?.headers()['cache-control']).toMatch(/no-store|no-cache/);
    expect(refreshRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test.describe('generic notice without JavaScript', () => {
  test.use({ userAgent: IOS_15_LINE, javaScriptEnabled: false });

  test('is complete in the initial server HTML', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'ไม่สามารถเปิด Mangmee Plus ได้' })).toBeVisible();
    await expect(page.getByText('Mangmee Plus could not be opened.', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ลองใหม่ / Try again' })).toBeVisible();
  });
});

test.describe('supported client', () => {
  test.use({ userAgent: IOS_16_4 });

  test('keeps the normal login journey free of compatibility UI', async ({ page }) => {
    await page.goto('/login?recovered=1');
    await expect(page.locator('#login-identifier')).toBeVisible();
    await expect(page.locator('[data-client-compatibility-notice="generic"]')).toHaveCount(0);
  });
});
