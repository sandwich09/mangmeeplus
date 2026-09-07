import { test, expect } from './harness/fixtures';

// Real API-served page, CSP and signup script. Only the LINE SDK/identity and submission
// response are controlled; the real owner/contact persistence boundary is covered by the signup PG suite.
for (const width of [390, 1280]) {
  test(`LINE owner email preserves password-free signup and survives a refused submit at ${width}px`, async ({ page, urls }, info) => {
    expect(['localhost', '127.0.0.1']).toContain(new URL(urls.api).hostname);
    await page.setViewportSize({ width, height: 844 });
    await page.route('https://static.line-scdn.net/**', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: `window.liff = {
        init: async function () {}, isLoggedIn: function () { return true; },
        getIDToken: function () { return 'local.synthetic.token'; },
        getDecodedIDToken: function () { return { name: 'เจ้าของร้านทดสอบ', exp: Math.floor(Date.now()/1000)+3600 }; },
        closeWindow: function () {}
      };`,
    }));
    await page.route(`${urls.api}/public/line-signups/me`, (route) => route.fulfill({ json: null }));
    const submissions: Record<string, any>[] = [];
    await page.route(`${urls.api}/public/line-signups`, async (route) => {
      submissions.push(route.request().postDataJSON());
      await route.fulfill(submissions.length === 1
        ? { status: 400, json: { message: 'line_signup_email_invalid' } }
        : { status: 202, json: { existingAccount: false, businessHours: true } });
    });

    const response = await page.goto(`${urls.api}/auth/line/link-page/signup`);
    expect(response?.ok()).toBe(true);
    expect(response?.headers()['content-security-policy']).toContain("script-src 'self' https://static.line-scdn.net");
    const submit = page.getByRole('button', { name: 'ยอมรับและเริ่มทดลองใช้ฟรี', exact: true });
    await expect(submit).toBeEnabled();
    await page.getByLabel('ชื่อร้าน', { exact: true }).fill('ร้านทดสอบเปิดใหม่');
    await page.getByLabel('เบอร์มือถือ', { exact: true }).fill('0812345678');
    const email = page.getByLabel('อีเมลเจ้าของร้าน', { exact: true });
    await expect(email).toHaveAttribute('type', 'email');
    await expect(email).toHaveAttribute('required', '');
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.locator('#contact-email-help')).toContainText('ไม่ต้องยืนยันอีเมลหรือตั้งรหัสผ่าน');
    await submit.click();
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#contact-email-error')).toBeVisible();
    expect(submissions).toHaveLength(0);

    await email.fill('not-an-email');
    await submit.click();
    await expect(email).toBeFocused();
    await expect(email).toHaveValue('not-an-email');
    expect(submissions).toHaveLength(0);

    await email.fill('SHOP+Contact@Example.test');
    await submit.click();
    await expect(page.locator('#contact-email-error')).toBeVisible();
    await expect(email).toBeFocused();
    await expect(email).toHaveValue('SHOP+Contact@Example.test');
    await expect(page.getByLabel('ชื่อร้าน', { exact: true })).toHaveValue('ร้านทดสอบเปิดใหม่');
    await expect(page.getByLabel('เบอร์มือถือ', { exact: true })).toHaveValue('0812345678');
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.contactEmail).toBe('shop+contact@example.test');
    expect(submissions[0]).not.toHaveProperty('password');
    expect(submissions[0]?.legal.displayChallenge).toMatch(/^[a-f0-9]{64}$/);
    await expect(page.getByText('ทดลองฟรี 30 วัน ให้ AI อ่านรูปได้ 15 ครั้ง', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`signup-contact-email-${width}.png`), fullPage: true });

    await submit.click();
    await expect(page.locator('#done-view')).toBeVisible();
    expect(submissions).toHaveLength(2);
    expect(submissions[1]?.contactEmail).toBe('shop+contact@example.test');
  });
}
