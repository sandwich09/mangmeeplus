import { test, expect } from './harness/fixtures';
import type { AccountEmailOtpState } from '../apps/web/src/features/auth/account-email-otp.api';

function readyState(): AccountEmailOtpState {
  return { email: 'owner@example.com', emailVerified: true, emailRevision: 0, emailRequirement: 'READY',
    hasPassword: true, lineLinked: false, serverNow: new Date().toISOString(), challenge: null };
}
function pendingState(state: AccountEmailOtpState, cooldown = 60_000): AccountEmailOtpState {
  return { ...state, emailRequirement: 'CHANGE_PENDING', emailRevision: state.emailRevision + 1, serverNow: new Date().toISOString(),
    challenge: { id: `challenge-${state.emailRevision + 1}`, email: 'new@example.com', status: 'PENDING',
      retryAt: new Date(Date.now() + cooldown).toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(),
      attemptsRemaining: 5, deliveryStatus: 'ACCEPTED', delivered: false } };
}

for (const width of [1280, 390]) test(`ACCOUNT-EMAIL guards request and completes OTP at ${width}px`, async ({ authedPage: page, companyId }, info) => {
  await page.setViewportSize({ width, height: 900 });
  let state = readyState(), requests = 0;
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/auth/account/email/otp**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: state });
    if (request.url().endsWith('/request')) {
      requests++;
      expect(request.postDataJSON()).toMatchObject({ newEmail: 'new@example.com', currentPassword: 'local-test-only', expectedEmailRevision: 0 });
      await wait;
      state = pendingState(state);
      return route.fulfill({ json: state });
    }
    if (request.url().endsWith('/confirm')) {
      if (request.postDataJSON().code !== '012345') return route.fulfill({ status: 400, json: { code: 'EMAIL_OTP_INVALID', message: 'รหัสไม่ถูกต้อง กรุณาลองใหม่' } });
      state = { ...state, email: 'new@example.com', emailRevision: 2, emailRequirement: 'READY', challenge: { ...state.challenge!, status: 'USED' } };
      return route.fulfill({ json: state });
    }
    throw new Error(`Unexpected email mutation: ${request.url()}`);
  });
  await page.goto(`/companies/${companyId}/settings/profile#account`);
  const account = page.getByRole('region', { name: 'อีเมลบัญชีของฉัน', exact: true });
  await account.getByRole('button', { name: 'เปลี่ยนอีเมล', exact: true }).click();
  const email = account.getByLabel('อีเมลที่ต้องการยืนยัน', { exact: true });
  const password = account.getByLabel('รหัสผ่านปัจจุบัน', { exact: true });
  const send = account.getByRole('button', { name: 'ขอรหัสยืนยัน', exact: true });
  await expect(email).toHaveValue('');
  await email.fill('new@example.com');
  await expect(send).toBeDisabled();
  await email.press('Enter');
  expect(requests).toBe(0);
  await password.fill('local-test-only');
  await account.getByRole('button', { name: 'แสดงรหัสผ่าน', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await account.getByRole('button', { name: 'ซ่อนรหัสผ่าน', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await email.fill('OWNER@example.com');
  await expect(account.getByRole('status').filter({ hasText: 'อีเมลนี้ยืนยันแล้ว' })).toBeVisible();
  await expect(send).toBeDisabled();
  expect(requests).toBe(0);
  await email.fill('new@example.com');
  await send.click();
  await expect(account.getByRole('button', { name: 'กำลังดำเนินการ…', exact: true })).toBeDisabled();
  await account.locator('form').evaluate(form => (form as HTMLFormElement).requestSubmit());
  expect(requests).toBe(1);
  release();
  const code = account.getByLabel('รหัสยืนยัน 6 หลัก', { exact: true });
  await expect(code).toBeFocused();
  await expect(account.getByText('ขั้นตอน 2 จาก 2', { exact: false })).toBeVisible();
  await expect(account.getByRole('button', { name: /^ขอรหัสใหม่ได้ใน \d+ วินาที$/ })).toBeDisabled();
  await expect(send).toHaveCount(0);
  expect(requests).toBe(1);
  await code.fill('000000');
  await account.getByRole('button', { name: 'ยืนยันอีเมล', exact: true }).click();
  await expect(account.getByRole('alert')).toContainText('รหัสไม่ถูกต้อง');
  await expect(code).toHaveValue('000000');
  await code.fill('012345');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({ path: info.outputPath(`account-email-otp-${width}.png`), fullPage: true });
  await account.getByRole('button', { name: 'ยืนยันอีเมล', exact: true }).click();
  await expect(account.getByRole('status')).toContainText('ยืนยันอีเมลเรียบร้อยแล้ว');
  await expect(code).toHaveCount(0);
  await expect(account).toContainText('new@example.com');
  await expect(account.getByRole('button', { name: 'เปลี่ยนอีเมล', exact: true })).toBeVisible();
});

test('ACCOUNT-EMAIL preserves failed drafts and respects the server rate limit', async ({ authedPage: page, companyId }) => {
  let rateLimited = false, requests = 0;
  await page.route('**/api/v1/auth/account/email/otp**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: readyState() });
    requests++;
    return route.fulfill({ status: rateLimited ? 429 : 503, json: rateLimited
      ? { code: 'EMAIL_OTP_RATE_LIMITED', message: 'กรุณารอก่อนขอรหัสใหม่', retryAfterSeconds: 60 }
      : { message: 'ยังส่งรหัสไม่ได้ กรุณาลองใหม่ภายหลัง' } });
  });
  await page.goto(`/companies/${companyId}/settings/profile#account`);
  const account = page.getByRole('region', { name: 'อีเมลบัญชีของฉัน', exact: true });
  await account.getByRole('button', { name: 'เปลี่ยนอีเมล', exact: true }).click();
  const password = account.getByLabel('รหัสผ่านปัจจุบัน', { exact: true });
  const email = account.getByLabel('อีเมลที่ต้องการยืนยัน', { exact: true });
  await password.fill('local-test-only'); await email.fill('new@example.com');
  await account.getByRole('button', { name: 'ขอรหัสยืนยัน', exact: true }).click();
  await expect(account.getByRole('alert')).toBeVisible();
  await expect(password).toHaveValue('local-test-only'); await expect(email).toHaveValue('new@example.com');
  rateLimited = true;
  await account.getByRole('button', { name: 'ขอรหัสยืนยัน', exact: true }).click();
  await expect(account.getByRole('button', { name: /^ขอรหัสใหม่ได้ใน \d+ วินาที$/ })).toBeDisabled();
  expect(requests).toBe(2);
});

test('ACCOUNT-EMAIL resend recovers when server reauthentication has expired', async ({ authedPage: page, companyId }) => {
  let state = pendingState(readyState(), -1000), requests = 0;
  await page.route('**/api/v1/auth/account/email/otp**', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: state });
    expect(route.request().url()).toContain('/resend'); requests++;
    if (!route.request().postDataJSON().currentPassword) return route.fulfill({ status: 403, json: { code: 'EMAIL_REAUTH_REQUIRED', message: 'กรุณายืนยันรหัสผ่านปัจจุบัน' } });
    state = pendingState(state);
    return route.fulfill({ json: state });
  });
  await page.goto(`/companies/${companyId}/settings/profile#account`);
  const account = page.getByRole('region', { name: 'อีเมลบัญชีของฉัน', exact: true });
  const resend = account.getByRole('button', { name: 'ขอรหัสใหม่', exact: true });
  await resend.click();
  await expect(account.getByText('ยืนยันตัวตนอีกครั้งก่อนขอรหัสใหม่', { exact: true })).toBeVisible();
  await expect(resend).toBeDisabled();
  await account.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill('local-test-only');
  await resend.click();
  await expect(account.getByRole('button', { name: /^ขอรหัสใหม่ได้ใน \d+ วินาที$/ })).toBeDisabled();
  await expect(account.getByLabel('รหัสยืนยัน 6 หลัก', { exact: true })).toBeFocused();
  expect(requests).toBe(2);
});
