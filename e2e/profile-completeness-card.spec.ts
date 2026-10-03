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

    const card = page.getByRole('region', { name: 'ข้อมูลร้านยังไม่ครบ · เพิ่มภายหลังได้', exact: true });
    const later = card.getByRole('button', { name: 'ไว้ก่อน', exact: true });
    const complete = card.getByRole('link', { name: 'กรอกข้อมูลให้ครบ', exact: true });
    await expect(card).toBeVisible();
    await expect(later).not.toBeVisible();
    await card.locator('summary').click();
    await expect(later).toBeVisible();
    await expect(complete).toBeVisible();

    const [laterBox, completeBox] = await Promise.all([later.boundingBox(), complete.boundingBox()]);
    expect(laterBox).not.toBeNull();
    expect(completeBox).not.toBeNull();
    expect(laterBox!.height).toBeGreaterThanOrEqual(44);
    expect(completeBox!.height).toBeGreaterThanOrEqual(44);
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
    await card.locator('summary').click();
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

for (const width of [390, 1280]) test(`a LINE owner sets a backup password without a username and refreshes email guidance at ${width}px`, async ({
  authedPage: page,
  companyId,
}, info) => {
  await page.setViewportSize({ width, height: 900 });
  let account = {
    email: 'owner@example.com', emailVerified: false, emailVerifiedAt: null,
    pendingEmail: null, pendingEmailExpiresAt: null, lineLinked: true,
    phoneNumber: null, hasPassword: false, username: null, emailDeliveryEnabled: true,
  };
  let revision = 0;
  const passwordBodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/v1/auth/account/security', route => route.fulfill({ json: account }));
  await page.route('**/api/v1/auth/account/email/otp', route => route.fulfill({ json: {
    email: account.email, emailVerified: account.emailVerified, emailRevision: revision,
    emailRequirement: 'UNVERIFIED', hasPassword: account.hasPassword, emailLoginEnabled: false,
    lineLinked: true, serverNow: new Date().toISOString(), challenge: null,
  } }));
  await page.route('**/api/v1/auth/me/password/set', async route => {
    passwordBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    account = { ...account, hasPassword: true };
    revision++;
    await route.fulfill({ json: { username: null } });
  });

  await gotoCompany(page, companyId, '/settings/profile#account');
  const emailPanel = page.getByRole('region', { name: 'อีเมลบัญชีของฉัน', exact: true });
  const backupHint = emailPanel.getByText('หากต้องการใช้รหัสผ่านเข้าสู่ระบบ จัดการรหัสผ่านสำรองได้ในหน้าบัญชีของฉัน', { exact: true });
  await expect(backupHint).toBeVisible();
  await expect(emailPanel.getByText('ยังไม่ยืนยัน', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'ชื่อผู้ใช้', exact: true })).toHaveCount(0);
  await emailPanel.getByLabel('อีเมลที่ต้องการยืนยัน', { exact: true }).fill('draft@example.com');
  await page.locator('summary').filter({ hasText: 'รหัสผ่านสำรอง' }).click();
  await page.getByLabel('รหัสผ่านใหม่', { exact: false }).fill('backup-password');
  await page.getByLabel('พิมพ์รหัสผ่านอีกครั้ง', { exact: true }).fill('backup-password');
  // Fail if the update depends on a full navigation or the panel's 15-second poll.
  let navigations = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.getByRole('button', { name: 'ตั้งรหัสผ่านสำรอง', exact: true }).click();
  await expect(page.getByRole('link', { name: 'เปลี่ยนรหัสผ่าน', exact: true })).toBeVisible();
  await expect(backupHint).toHaveCount(0, { timeout: 5000 });
  await expect(emailPanel.getByLabel('อีเมลที่ต้องการยืนยัน', { exact: true })).toHaveValue('draft@example.com');
  await emailPanel.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(emailPanel.getByLabel('รหัสผ่านปัจจุบัน', { exact: true })).toBeVisible();
  expect(passwordBodies).toEqual([{ password: 'backup-password' }]);
  expect(navigations).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`account-password-refresh-${width}.png`), fullPage: true });
  await expectNoClientError(page);
});

for (const width of [1280, 390]) {
  test(`PROFILE-FOCUS separates tasks and keeps unsaved input at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    await page.setViewportSize({ width, height: 900 });
    let commands = 0;
    await page.route('**/auth/account/email/otp**', async route => {
      if (route.request().method() !== 'GET') commands++;
      await route.fulfill({ json: { email: 'owner@example.com', emailVerified: true, emailRevision: 1, emailRequirement: 'READY', hasPassword: true, emailLoginEnabled: false, lineLinked: false, serverNow: new Date().toISOString(), challenge: null } });
    });
    await gotoCompany(page, companyId, '/settings/profile#account');
    await expect(page.getByRole('heading', { name: 'บัญชีของฉัน', exact: true })).toBeVisible();
    await expect(page.getByLabel('ชื่อจดทะเบียน', { exact: false })).toBeHidden();
    await expect(page.locator('input[type=password]:visible')).toHaveCount(0);
    await page.getByRole('button', { name: 'เปลี่ยนอีเมล', exact: true }).click();
    await page.getByLabel('อีเมลที่ต้องการยืนยัน', { exact: true }).fill('draft@example.com');
    await expect(page.getByRole('heading', { name: 'เข้าสู่ระบบด้วยรหัสทางอีเมล' })).toBeHidden();
    const sections = page.getByRole('navigation', { name: 'หมวดการตั้งค่า' });
    await sections.getByRole('button', { name: 'ข้อมูลร้าน', exact: true }).click();
    await page.getByLabel('ชื่อจดทะเบียน', { exact: false }).fill('ร่างข้อมูลร้าน ไม่บันทึก');
    await sections.getByRole('button', { name: 'บัญชีของฉัน', exact: true }).click();
    await expect(page.getByLabel('อีเมลที่ต้องการยืนยัน')).toHaveValue('draft@example.com');
    await page.getByRole('button', { name: 'ปิดการแก้ไข' }).click();
    await page.getByRole('button', { name: 'เปลี่ยนวิธีเข้าสู่ระบบ' }).click();
    await expect(page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true })).toBeVisible();
    await expect(page.getByLabel('อีเมลที่ต้องการยืนยัน')).toBeHidden();
    await expect(page.getByRole('button', { name: 'ยืนยันเปิดการเข้าด้วยอีเมล' })).toBeVisible();
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(page.locator('input[type=password]:visible')).toHaveCount(0);
    await expect(page.getByText(/รหัสยืนยันแบบใช้ครั้งเดียว 6 หลัก/)).toBeVisible();
    await page.locator('summary').filter({ hasText: 'เบอร์มือถือ' }).click();
    const phone = page.getByLabel('เบอร์มือถือ', { exact: false });
    await phone.fill('abc 099-999-9999 123');
    await expect(phone).toHaveValue('0999999999');
    await phone.pressSequentially('99a');
    await expect(phone).toHaveValue('0999999999');
    await page.locator('summary').filter({ hasText: 'เบอร์มือถือ' }).click();
    expect(commands).toBe(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: info.outputPath(`profile-focus-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await sections.getByRole('button', { name: 'ข้อมูลร้าน', exact: true }).click();
    await expect(page.getByLabel('ชื่อจดทะเบียน', { exact: false })).toHaveValue('ร่างข้อมูลร้าน ไม่บันทึก');
    const taxId = page.getByLabel('เลขผู้เสียภาษี', { exact: false });
    await taxId.fill('ภกแ 1234567890123456789');
    await expect(taxId).toHaveValue('1234567890123');
    await taxId.pressSequentially('44b');
    await expect(taxId).toHaveValue('1234567890123');
  });
}
