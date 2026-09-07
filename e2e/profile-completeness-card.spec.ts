import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { gotoCompany } from './harness/e2e-utils';

const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

for (const width of [390, 1280]) {
  test(`profile completion actions open the real form and snooze per company at ${width}px`, async ({
    authedPage: page,
    companyId,
  }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await gotoCompany(page, companyId, '/dashboard');
    await page.evaluate((id) => {
      window.localStorage.removeItem(`watchdog.profileChecklistDismissed.${id}`);
      window.sessionStorage.removeItem(`watchdog.profileChecklist.${id}`);
    }, companyId);
    await page.reload();

    const card = page.getByRole('region', { name: 'ยังกรอกไม่ครบอีกนิดเดียวค่ะ', exact: true });
    const later = card.getByRole('button', { name: 'ไว้ก่อน', exact: true });
    const complete = card.getByRole('link', { name: 'กรอกข้อมูลให้ครบ', exact: true });
    await expect(card).toBeVisible();
    await expect(later).toBeVisible();
    await expect(complete).toBeVisible();

    const [laterBox, completeBox] = await Promise.all([later.boundingBox(), complete.boundingBox()]);
    expect(laterBox).not.toBeNull();
    expect(completeBox).not.toBeNull();
    expect(laterBox!.height).toBeGreaterThanOrEqual(48);
    expect(completeBox!.height).toBeGreaterThanOrEqual(48);
    expect(laterBox!.x).toBeLessThan(completeBox!.x);
    expect(Math.abs(laterBox!.y - completeBox!.y)).toBeLessThanOrEqual(1);
    const completeStyle = await complete.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { fontSize: Number.parseFloat(style.fontSize), fontWeight: Number(style.fontWeight) };
    });
    expect(completeStyle.fontSize).toBeGreaterThanOrEqual(16);
    expect(completeStyle.fontWeight).toBeGreaterThanOrEqual(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`profile-completeness-${width}.png`), fullPage: true });

    const freshIdentity = page.waitForResponse((response) =>
      response.request().method() === 'GET'
      && new URL(response.url()).pathname.endsWith(`/api/v1/companies/${companyId}/identity`),
    );
    await complete.click();
    await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/settings/profile#shop$`));
    expect((await freshIdentity).ok()).toBe(true);
    await expect(page.getByRole('heading', { name: 'ข้อมูลร้าน', exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', {
      name: 'ชื่อจดทะเบียน ชื่อตามหนังสือรับรอง ไม่ใช่ชื่อร้านที่ใช้เรียกกัน',
      exact: true,
    })).toBeVisible();

    await gotoCompany(page, companyId, '/dashboard');
    await card.getByRole('button', { name: 'ไว้ก่อน', exact: true }).click();
    await expect(card).toHaveCount(0);
    const dismissedAt = Date.now();
    const otherCompanyId = companyId === 'seed-local-company' ? 'seed-local-company-2' : 'seed-local-company';
    const stored = await page.evaluate(({ id, otherId }) => ({
      current: window.localStorage.getItem(`watchdog.profileChecklistDismissed.${id}`),
      other: window.localStorage.getItem(`watchdog.profileChecklistDismissed.${otherId}`),
    }), { id: companyId, otherId: otherCompanyId });
    expect(Number(stored.current)).toBeGreaterThanOrEqual(dismissedAt + DISMISS_MS - 5_000);
    expect(stored.other).toBeNull();

    await page.reload();
    await expect(card).toHaveCount(0);
    await expectNoClientError(page);
    expect(pageErrors).toEqual([]);
  });
}

test('a LINE owner corrects an unverified account email and adds an optional password without a username', async ({
  authedPage: page,
  companyId,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let account = {
    email: 'owner.typo@example.com',
    emailVerified: false,
    emailVerifiedAt: null,
    pendingEmail: null,
    pendingEmailExpiresAt: null,
    lineLinked: true,
    phoneNumber: null,
    hasPassword: false,
    username: null,
    emailDeliveryEnabled: false,
  };
  const emailBodies: Array<Record<string, unknown>> = [];
  const passwordBodies: Array<Record<string, unknown>> = [];

  await page.route('**/api/v1/auth/account/security', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(account) });
  });
  await page.route('**/api/v1/auth/me/email/unverified', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    emailBodies.push(body);
    if (body['newEmail'] === 'used@example.com') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'account_email_conflict', message: 'another account owns this email' }),
      });
      return;
    }
    account = { ...account, email: String(body['newEmail']).trim().toLowerCase() };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: account.email, emailVerified: false }),
    });
  });
  await page.route('**/api/v1/auth/me/password/set', async (route) => {
    passwordBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    account = { ...account, hasPassword: true };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ username: null }) });
  });

  await gotoCompany(page, companyId, '/settings/profile#account');
  await expect(page.getByRole('heading', { name: 'บัญชีของฉัน', exact: true })).toBeVisible();
  await expect(page.getByText('owner.typo@example.com', { exact: true })).toHaveCount(2);
  await expect(page.getByText('ยังไม่ยืนยัน', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'ชื่อผู้ใช้', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'แก้ไขอีเมลบัญชี', exact: true }).click();
  const email = page.getByRole('textbox', { name: 'อีเมลบัญชี', exact: true });
  await email.fill(' Corrected.Owner@example.com ');
  await page.getByRole('button', { name: 'บันทึกอีเมลบัญชี', exact: true }).click();
  await expect(page.getByText('corrected.owner@example.com', { exact: true })).toHaveCount(2);
  expect(emailBodies[0]).toEqual({
    newEmail: 'Corrected.Owner@example.com',
    expectedEmail: 'owner.typo@example.com',
  });

  await page.getByLabel(/รหัสผ่านใหม่/).fill('backup-password');
  await page.getByLabel('พิมพ์รหัสผ่านอีกครั้ง', { exact: true }).fill('backup-password');
  await page.getByRole('button', { name: 'ตั้งรหัสผ่านสำรอง', exact: true }).click();
  await expect(page.getByRole('link', { name: 'เปลี่ยนรหัสผ่าน', exact: true })).toBeVisible();
  expect(passwordBodies).toEqual([{ password: 'backup-password' }]);

  await page.getByRole('button', { name: 'แก้ไขอีเมลบัญชี', exact: true }).click();
  await email.fill('used@example.com');
  await page.getByLabel(/รหัสผ่านปัจจุบัน/).fill('backup-password');
  await page.getByRole('button', { name: 'บันทึกอีเมลบัญชี', exact: true }).click();
  await expect(page.getByText('อีเมลนี้มีบัญชีอื่นใช้อยู่แล้วค่ะ กรุณาใช้อีเมลอื่น อีเมลบัญชีของคุณยังไม่เปลี่ยน', { exact: true })).toBeVisible();
  expect(emailBodies[1]).toEqual({
    newEmail: 'used@example.com',
    expectedEmail: 'corrected.owner@example.com',
    currentPassword: 'backup-password',
  });
  await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await expect(page.getByText('corrected.owner@example.com', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'ไปหน้าเข้าสู่ระบบ', exact: true })).toHaveCount(0);
  await expect(page.getByText(/ยังเปิดส่งอีเมลยืนยันไม่ได้/)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('unverified-account-email-mobile.png'), fullPage: true });
  await expectNoClientError(page);
});
