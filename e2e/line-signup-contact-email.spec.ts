import { test, expect } from './harness/fixtures';

const emptyStatus = { progress: null, eligibleCompanies: [] };

function signupStatus(overrides: Record<string, unknown> = {}, eligibleCompanies: Record<string, unknown>[] = []) {
  return {
    progress: {
      requestId: 'line-e2e-1',
      submissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      version: 1,
      state: 'PENDING_REVIEW',
      companyName: 'ร้านทดสอบเปิดใหม่',
      phoneNumber: '0812345678',
      contactEmail: 'shop@example.test',
      intent: 'FIRST_SHOP',
      existingAccount: false,
      businessHours: true,
      canRetryIntake: false,
      canUpdateContactEmail: false,
      companyCreated: false,
      ...overrides,
    },
    eligibleCompanies,
  };
}

async function mockLineSdk(page: import('@playwright/test').Page, name = 'เจ้าของร้านทดสอบ') {
  await page.route('https://static.line-scdn.net/**', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `window.liff = {
      init: async function () {}, isLoggedIn: function () { return true; },
      getIDToken: function () { return 'local.synthetic.token'; },
      getDecodedIDToken: function () { return { name: '${name}', sub: 'U-e2e-owner', exp: Math.floor(Date.now()/1000)+3600 }; },
      closeWindow: function () {}, sendMessages: async function () {}
    };`,
  }));
}

// Real API-served page, CSP and signup script. Only the LINE SDK/identity and submission
// response are controlled; the real owner/contact persistence boundary is covered by the signup PG suite.
for (const width of [390, 1280]) {
  test(`LINE owner email preserves password-free signup and survives a refused submit at ${width}px`, async ({ page, urls }, info) => {
    expect(['localhost', '127.0.0.1']).toContain(new URL(urls.api).hostname);
    await page.setViewportSize({ width, height: 844 });
    await mockLineSdk(page);
    await page.route(`${urls.api}/public/line-signups/me`, (route) => route.fulfill({ json: emptyStatus }));
    const submissions: Record<string, any>[] = [];
    await page.route(`${urls.api}/public/line-signups`, async (route) => {
      submissions.push(route.request().postDataJSON());
      await route.fulfill(submissions.length === 1
        ? { status: 400, json: { message: 'line_signup_email_invalid' } }
        : { status: 202, json: signupStatus() });
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
    await expect(page.locator('#progress-view')).toBeVisible();
    await expect(page.locator('#progress-title')).toHaveText('รับคำขอแล้ว');
    await expect(page.locator('body')).not.toContainText('line-e2e-1');
    expect(submissions).toHaveLength(2);
    expect(submissions[1]?.contactEmail).toBe('shop+contact@example.test');
  });
}

test('a previously used owner email waits for review without showing an active-shop action', async ({ page, urls }, info) => {
  expect(['localhost', '127.0.0.1']).toContain(new URL(urls.api).hostname);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLineSdk(page, 'เจ้าของร้านเดิม');
  let statusReads = 0;
  await page.route(`${urls.api}/public/line-signups/me`, (route) => route.fulfill({
    json: statusReads++ === 0 ? emptyStatus : signupStatus({
      requestId: 'repeat-email-1', companyName: 'ร้านเดิมที่ต้องตรวจ',
    }),
  }));
  const submissions: Record<string, any>[] = [];
  await page.route(`${urls.api}/public/line-signups`, async (route) => {
    submissions.push(route.request().postDataJSON());
    await route.fulfill({
      status: 202,
      json: signupStatus({ requestId: 'repeat-email-1', companyName: 'ร้านเดิมที่ต้องตรวจ' }),
    });
  });

  const response = await page.goto(`${urls.api}/auth/line/link-page/signup`);
  expect(response?.ok()).toBe(true);
  await page.getByLabel('ชื่อร้าน', { exact: true }).fill('ร้านเดิมที่ต้องตรวจ');
  await page.getByLabel('เบอร์มือถือ', { exact: true }).fill('0812345678');
  const email = page.getByLabel('อีเมลเจ้าของร้าน', { exact: true });
  await email.fill('used-owner@example.test');
  await page.getByRole('button', { name: 'ยอมรับและเริ่มทดลองใช้ฟรี', exact: true }).click();

  await expect(page.locator('#progress-view')).toBeVisible();
  await expect(page.locator('#progress-text')).toContainText('ทีมงานกำลังตรวจสอบ');
  await expect(page.locator('body')).not.toContainText('repeat-email-1');
  await expect(page.locator('#contact-email-error')).toBeHidden();
  await expect(page.locator('#form-view')).toBeHidden();
  await expect(page.getByRole('button', { name: 'ปิด', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /เปิดหน้าเว็บ|เริ่มใช้งาน/ })).toHaveCount(0);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]?.contactEmail).toBe('used-owner@example.test');

  await page.reload();
  await expect(page.locator('#progress-view')).toBeVisible();
  await expect(page.locator('#progress-text')).toContainText('ทีมงานกำลังตรวจสอบ');
  await expect(page.locator('#form-view')).toBeHidden();
  await expect(page.getByRole('link', { name: /เปิดหน้าเว็บ|เริ่มใช้งาน/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('signup-duplicate-email-pending-390.png'), fullPage: true });
});

test('a completed response and reopen stay completed until the owner explicitly opens another shop', async ({ page, urls }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLineSdk(page);
  let current: ReturnType<typeof signupStatus> | typeof emptyStatus = emptyStatus;
  const submissions: Record<string, any>[] = [];
  await page.route(`${urls.api}/public/line-signups/me`, (route) => route.fulfill({ json: current }));
  await page.route(`${urls.api}/public/line-signups`, async (route) => {
    const body = route.request().postDataJSON() as Record<string, any>;
    submissions.push(body);
    current = submissions.length === 1
      ? signupStatus({
          submissionId: body.submissionId,
          state: 'COMPLETED',
          companyName: body.companyName,
          companyCreated: true,
          entryCompanyId: 'company-ready',
          resolution: 'NEW_SHOP',
        }, [{ companyId: 'company-ready', companyName: body.companyName, status: 'ACTIVE', canEnter: true }])
      : signupStatus({ submissionId: body.submissionId, intent: 'ADD_SHOP', companyName: body.companyName });
    await route.fulfill({ status: 202, json: current });
  });

  const response = await page.goto(`${urls.api}/auth/line/link-page/signup`);
  expect(response?.headers()['content-security-policy']).toContain("script-src 'self' https://static.line-scdn.net");
  await page.getByLabel('ชื่อร้าน', { exact: true }).fill('ร้านพร้อมใช้');
  await page.getByLabel('เบอร์มือถือ', { exact: true }).fill('0812345678');
  await page.getByLabel('อีเมลเจ้าของร้าน', { exact: true }).fill('ready@example.test');
  await page.getByRole('button', { name: 'ยอมรับและเริ่มทดลองใช้ฟรี', exact: true }).click();

  await expect(page.locator('#progress-title')).toHaveText('พร้อมเริ่มใช้งาน');
  await expect(page.getByRole('button', { name: 'เริ่มใช้งาน', exact: true })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('line-e2e-1');
  await expect(page.locator('#form-view')).toBeHidden();
  const completedLayout = await page.evaluate(() => ({ scrollY, scrollHeight: document.documentElement.scrollHeight, innerHeight }));
  expect(completedLayout.scrollY).toBe(0);
  expect(completedLayout.scrollHeight).toBeLessThanOrEqual(completedLayout.innerHeight + 1);
  await page.screenshot({ path: info.outputPath('signup-completed-390.png'), fullPage: true });
  await page.reload();
  await expect(page.locator('#progress-title')).toHaveText('พร้อมเริ่มใช้งาน');
  await expect(page.locator('#form-view')).toBeHidden();

  await page.getByRole('button', { name: 'เปิดร้านเพิ่ม', exact: true }).click();
  await expect(page.locator('#form-view')).toBeVisible();
  await page.getByLabel('ชื่อร้าน', { exact: true }).fill('ร้านที่สอง');
  await page.getByRole('button', { name: 'ยืนยันเปิดร้านเพิ่ม', exact: true }).click();
  await expect(page.locator('#progress-title')).toHaveText('รับคำขอแล้ว');
  const pendingLayout = await page.evaluate(() => ({ scrollY, scrollHeight: document.documentElement.scrollHeight, innerHeight }));
  expect(pendingLayout.scrollY).toBe(0);
  expect(pendingLayout.scrollHeight).toBeLessThanOrEqual(pendingLayout.innerHeight + 1);
  expect(submissions).toHaveLength(2);
  expect(submissions[0]?.intent).toBe('FIRST_SHOP');
  expect(submissions[1]?.intent).toBe('ADD_SHOP');
  expect(submissions[1]?.submissionId).not.toBe(submissions[0]?.submissionId);
  await page.screenshot({ path: info.outputPath('signup-completed-reopen-add-shop-390.png'), fullPage: true });
});

test('a saved intake can resume on a cleared device through the proof-bound retry', async ({ page, urls }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockLineSdk(page);
  const received = signupStatus({ state: 'RECEIVED', version: 7, canRetryIntake: true });
  let retriedBody: Record<string, unknown> | null = null;
  await page.route(`${urls.api}/public/line-signups/me`, (route) => route.fulfill({ json: received }));
  await page.route(`${urls.api}/public/line-signups/line-e2e-1/retry`, async (route) => {
    retriedBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, json: signupStatus({ state: 'PENDING_REVIEW', version: 8 }) });
  });

  await page.goto(`${urls.api}/auth/line/link-page/signup`);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await expect(page.getByRole('button', { name: 'ทำคำขอเดิมต่อ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ทำคำขอเดิมต่อ', exact: true }).click();

  expect(retriedBody).toEqual({ idToken: 'local.synthetic.token', version: 7 });
  await expect(page.locator('#progress-title')).toHaveText('รับคำขอแล้ว');
  await expect(page.locator('body')).not.toContainText('line-e2e-1');
});
