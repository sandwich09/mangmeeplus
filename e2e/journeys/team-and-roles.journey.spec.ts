/**
 * Owner gives a new employee only receipt-entry work, then adds shop settings and finally disables
 * the membership. All mutations are screen presses; the final API reads check what was saved.
 * The plain shop has the four QA members, starter entitlements, manual entry and no plan-term seat cap
 * (seed.ts -> seedPlainShop). Every new identity is disposable and unique across reruns.
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect } from '../harness/fixtures';
import { watchScreenFit } from '../harness/screen-fit';
import { json, unique } from '../harness/e2e-utils';
import { QA_ACCOUNTS } from '../harness/roles';
import { AFTER_PRESS, FIRST_SIGHT, cardWith, expectInSight, pressMenu } from './journey-kit';

type Role = { id: string; key: string; name: string; status: string; isSystem: boolean; permissionKeys: string[]; activeEmployeeCount?: number };
type Pack = { key: string; isCore?: boolean; permissionKeys: string[] };
type Employee = {
  id: string; displayName: string; email: string; status: string; mustChangePassword: boolean;
  roles: Array<{ id: string; name: string }>; defaultBranchId: string;
};
const shop = 'seed-local-plain-shop';
const heading = (page: Page, name: string) => page.locator('main').getByRole('heading', { level: 1, name, exact: true });
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text }).first();

async function signIn(page: Page, username: string, password: string) {
  await expect(page.getByRole('heading', { level: 1, name: 'เข้าสู่ระบบ', exact: true })).toBeVisible(FIRST_SIGHT);
  await page.getByLabel('ชื่อผู้ใช้ หรือ อีเมล', { exact: true }).fill(username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
}

test('@journey an owner creates an expense-entry role and member, grants shop settings, then switches the member off', async ({ pageAs, browser, urls, apiAs }, info) => {
  test.setTimeout(300_000);
  const roleName = unique('ผู้บันทึกใบเสร็จทดสอบ');
  const firstName = unique('สมาชิกทดสอบ');
  const lastName = 'สิทธิ์ร้าน';
  const displayName = `${firstName} ${lastName}`;
  const username = unique('journey.team');
  const email = `${username}@example.com`;
  // Synthetic identity with a valid check digit; never a person's real identity or password.
  const identityBase = String(randomInt(100_000_000_000, 1_000_000_000_000));
  const checksum = (11 - [...identityBase].reduce((sum, digit, index) => sum + Number(digit) * (13 - index), 0) % 11) % 10;
  const newPassword = `Team@${randomBytes(12).toString('hex')}`;
  let temporaryPassword = '';

  const owner = await pageAs('OWNER');
  owner.setDefaultTimeout(30_000);
  await owner.setViewportSize({ width: 1556, height: 1000 });
  const main = owner.locator('main');
  await owner.goto(`/companies/${shop}/dashboard`, FIRST_SIGHT);
  await expect(heading(owner, 'รายจ่ายของร้าน')).toBeVisible(FIRST_SIGHT);

  await test.step('failed staff, role and permission reads show retry instead of empty data', async () => {
    for (const [pagePath, endpoint, title, empty] of [
      ['access-overview', 'employees', 'โหลดรายชื่อพนักงานไม่สำเร็จ', 'ยังไม่มีพนักงานในร้านนี้'],
      ['permissions', 'roles', 'โหลดบทบาทไม่สำเร็จ', 'ยังไม่มีบทบาทในร้านนี้'],
      ['permissions', 'access/matrix', 'โหลดตารางสิทธิ์ไม่สำเร็จ', 'ไม่ได้เปิดสิทธิ์'],
    ]) {
      // Fail every read until ลองอีกครั้ง is pressed: a dev server may read twice on mount, so `times: 1` raced the screen.
      let failing = true;
      const pattern = `**/companies/${shop}/settings/${endpoint}`;
      await owner.route(pattern, route => failing ? route.fulfill({ status: 503,
        contentType: 'application/json', body: JSON.stringify({ message: 'Unavailable' }) }) : route.fallback());
      await owner.goto(`/companies/${shop}/settings/${pagePath}`, FIRST_SIGHT);
      await expect(main.getByText(title, { exact: true })).toBeVisible(AFTER_PRESS);
      await expect(main.getByText(empty, { exact: true })).toHaveCount(0);
      if (endpoint === 'access/matrix') await expect(main.getByTestId('role-permission-matrix')).toHaveCount(0);
      failing = false;
      await main.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
      await expect(main.getByText(title, { exact: true })).toHaveCount(0, AFTER_PRESS);
      await expect(main.getByRole('searchbox', { name: pagePath === 'access-overview' ? 'ค้นหาพนักงาน' : 'ค้นหาบทบาท', exact: true })).toBeVisible(AFTER_PRESS);
      if (endpoint === 'access/matrix') await expect(main.getByTestId('role-permission-matrix')).toBeVisible(AFTER_PRESS);
      await owner.unroute(pattern);
    }
  });

  await test.step('obsolete role links show the list; the owner count includes the owner account', async () => {
    const api = await apiAs('OWNER');
    const roles = await json<Role[]>(await api.get(`companies/${shop}/settings/roles`, { headers: { 'X-Company-Id': shop } }));
    const ownerRole = roles.find(role => role.key === 'OWNER')!;
    expect(ownerRole.activeEmployeeCount).toBeGreaterThan(0);
    for (const width of [390, 1280, 1556]) {
      await owner.setViewportSize({ width, height: 1000 });
      await owner.goto(`/companies/${shop}/settings/permissions?role=missing-old-role`, FIRST_SIGHT);
      await expect(main.getByText('ไม่พบบทบาทนี้แล้ว', { exact: true })).toBeVisible(AFTER_PRESS);
      await expect(main.getByRole('searchbox', { name: 'ค้นหาบทบาท', exact: true })).toBeVisible();
      await expect(main.getByTestId('role-permission-matrix')).toHaveCount(0);
      const ownerRow = cardWith(owner, 'บทบาททั้งหมด').getByRole('button').filter({ has: owner.getByText('เจ้าของกิจการ', { exact: true }) });
      await expect(ownerRow).toContainText(`${ownerRole.activeEmployeeCount} คน`);
      await ownerRow.click();
      await expect(main.getByRole('heading', { name: 'เจ้าของกิจการ', exact: true })).toBeVisible(AFTER_PRESS);
      await expect(main.getByText('ไม่พบบทบาทนี้แล้ว', { exact: true })).toHaveCount(0);
      await expect(main.getByTestId('role-permission-matrix')).toBeVisible();
    }
  });

  await test.step('manager cannot switch a people-manager off; a shared account explains its own reset and shop email', async () => {
    const manager = await pageAs('MANAGER');
    await manager.goto(`/companies/${shop}/settings/access-overview?person=seed-plain-profile-manager`, FIRST_SIGHT);
    await expect(heading(manager, 'รายชื่อพนักงาน')).toBeVisible(FIRST_SIGHT);
    await expect(manager.getByTestId('employee-detail-card')).toContainText(QA_ACCOUNTS.MANAGER.displayName, AFTER_PRESS);
    await expect(manager.getByRole('switch', { name: 'ใช้งาน / ปิดใช้งาน', exact: true })).toHaveCount(0);

    await owner.goto(`/companies/${shop}/settings/access-overview?person=seed-plain-profile-manager`, FIRST_SIGHT);
    await expect(main.getByTestId('employee-detail-card')).toContainText(QA_ACCOUNTS.MANAGER.displayName, AFTER_PRESS);
    await expect(main.getByRole('button', { name: 'รีเซ็ตรหัสผ่าน', exact: true })).toHaveCount(0);
    await expect(main.getByText('บัญชีนี้ใช้กับหลายร้าน ให้เจ้าของบัญชีตั้งรหัสผ่านเอง', { exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: 'เปิดหน้าตั้งรหัสผ่าน', exact: true })).toHaveAttribute('href', '/forgot-password');
    await main.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
    await expect(main.getByLabel('อีเมลสำหรับร้านนี้ *', { exact: true })).toBeVisible(AFTER_PRESS);
    await expect(main.getByText('ใช้ติดต่อในร้านนี้ ใช้เข้าสู่ระบบไม่ได้', { exact: true })).toBeVisible();
    await main.getByRole('link', { name: 'กลับไปรายชื่อพนักงาน', exact: true }).click();
  });

  await test.step('owner: พนักงานและสิทธิ์ → บทบาทและสิทธิ์ → เพิ่มบทบาท, only บันทึกค่าใช้จ่ายของฉัน', async () => {
    await pressMenu(owner, 'บทบาทและสิทธิ์', 'พนักงานและสิทธิ์');
    await expect(heading(owner, 'บทบาทและสิทธิ์')).toBeVisible(FIRST_SIGHT);
    await main.getByRole('button', { name: 'เพิ่มบทบาท', exact: true }).click();
    const editor = main.locator('form').filter({ has: owner.getByRole('heading', { name: 'เพิ่มบทบาท', exact: true }) });
    await expect(editor.getByText('เลือกสิ่งที่บทบาทนี้ทำได้เพิ่ม', { exact: true })).toBeVisible();
    await editor.getByRole('textbox', { name: /^ชื่อบทบาท/ }).fill(roleName);
    const capture = editor.getByRole('checkbox', { name: 'บันทึกค่าใช้จ่ายของฉัน', exact: true });
    await expect(editor.getByRole('checkbox', { name: 'on', exact: true })).toHaveCount(0);
    await capture.check();
    await expect(capture).toBeChecked();
    await expect(editor.locator('input[type="checkbox"]:checked')).toHaveCount(1);
    await expect(editor.getByRole('checkbox', { name: /^ดูตั้งค่าร้าน/ })).not.toBeChecked();
    await expect(editor.getByRole('checkbox', { name: /^อนุมัติและจ่ายใบเบิก/ })).not.toBeChecked();
    await editor.locator('[data-form-action-bar]').getByRole('button', { name: 'บันทึกบทบาท', exact: true }).click();
    await expect(toast(owner, `สร้างบทบาท ${roleName} แล้ว`)).toBeVisible(AFTER_PRESS);
    const row = cardWith(owner, 'บทบาททั้งหมด').getByRole('button').filter({ has: owner.getByText(roleName, { exact: true }) });
    await row.scrollIntoViewIfNeeded();
    await expectInSight(row);
    await expect(row).toContainText('บทบาทของร้าน');
    await expect(main.getByTestId('role-can-do')).toContainText('บันทึกค่าใช้จ่ายของฉัน');
    await expect(main.getByTestId('role-can-do')).not.toContainText('อนุมัติและจ่ายใบเบิก');
    await expect(main.getByTestId('role-can-do')).not.toContainText('ดูตั้งค่าร้าน');
  });

  await test.step('owner: รายชื่อพนักงาน → เพิ่มพนักงาน → บันทึกและเปิดใช้งาน → member card', async () => {
    await pressMenu(owner, 'รายชื่อพนักงาน', 'พนักงานและสิทธิ์');
    await expect(heading(owner, 'รายชื่อพนักงาน')).toBeVisible(FIRST_SIGHT);
    await main.getByRole('link', { name: 'เพิ่มพนักงาน', exact: true }).click();
    await expect(heading(owner, 'เพิ่มพนักงาน')).toBeVisible(FIRST_SIGHT);
    await main.getByLabel('ชื่อ *', { exact: true }).fill(firstName);
    await main.getByLabel('นามสกุล *', { exact: true }).fill(lastName);
    await main.getByLabel('ชื่อผู้ใช้ *', { exact: true }).fill(username);
    await main.getByLabel('วันเดือนปีเกิด (ค.ศ.) *', { exact: true }).fill('01/02/1995');
    await main.getByLabel('เลขบัตรประชาชน *', { exact: true }).fill(`${identityBase}${checksum}`);
    await main.locator('[data-form-action-bar]').getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(main.getByLabel('อีเมล (ใช้เข้าสู่ระบบ) *', { exact: true })).toBeVisible();
    await main.getByLabel('อีเมล (ใช้เข้าสู่ระบบ) *', { exact: true }).fill(email);
    await main.getByLabel('เบอร์โทรศัพท์ *', { exact: true }).fill(`08${randomInt(10_000_000, 100_000_000)}`);
    await main.locator('[data-form-action-bar]').getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(main.getByLabel('ตำแหน่งงาน *', { exact: true })).toBeVisible();
    await main.getByLabel('ตำแหน่งงาน *', { exact: true }).fill('บันทึกใบเสร็จ');
    const roleSearch = main.getByRole('searchbox', { name: 'ค้นหาบทบาทในฟอร์มพนักงาน', exact: true });
    if (await roleSearch.count()) await roleSearch.fill(roleName);
    await main.getByRole('radio', { name: roleName, exact: true }).check();
    await main.locator('[data-form-action-bar]').getByRole('button', { name: 'บันทึกและเปิดใช้งาน', exact: true }).click();
    await expect(main.getByRole('status').filter({ hasText: `เปิดใช้งานพนักงานแล้ว ส่งชื่อผู้ใช้และรหัสผ่านด้านล่างให้ ${displayName}` })).toBeVisible(AFTER_PRESS);
    const credentials = main.locator('section').filter({ has: owner.getByRole('heading', { name: 'ชื่อผู้ใช้และรหัสผ่าน', exact: true }) }).last();
    await expect(credentials).toContainText(username);
    await expect(credentials).toContainText('เขาต้องตั้งรหัสผ่านใหม่เมื่อเข้าสู่ระบบครั้งแรก');
    // The screen generates the first password; a person reads this handoff, not a hidden API response.
    await expect(main.getByAltText(`QR เชื่อม LINE ของ ${displayName}`, { exact: true })).toBeVisible();
    temporaryPassword = (await credentials.locator('dd[data-secret]').innerText()).trim();
    expect(Boolean(temporaryPassword), 'a one-time password is handed to the preparer').toBe(true);
    await main.getByRole('button', { name: 'ไปรายชื่อพนักงาน', exact: true }).click();
    await expect(heading(owner, 'รายชื่อพนักงาน')).toBeVisible(FIRST_SIGHT);
    await main.getByRole('searchbox', { name: 'ค้นหาพนักงาน', exact: true }).fill(firstName);
    const row = main.getByRole('button').filter({ has: owner.getByText(displayName, { exact: true }) });
    await expect(row).toContainText(roleName, AFTER_PRESS);
    await row.click();
    await expect(main.getByTestId('employee-detail-card')).toContainText(roleName);
    await main.getByRole('button', { name: 'เปลี่ยนบทบาทพนักงาน', exact: true }).click();
    await main.getByRole('searchbox', { name: 'ค้นหาบทบาทพนักงาน', exact: true }).fill(roleName);
    await expect(main.getByRole('listbox').getByRole('option', { name: roleName, exact: true })).toBeVisible();
    await expect(main.getByRole('listbox').getByRole('option')).toHaveCount(1);
    await main.getByRole('button', { name: 'เปลี่ยนบทบาทพนักงาน', exact: true }).click();
    await expect(main.getByRole('switch', { name: 'ใช้งาน / ปิดใช้งาน', exact: true })).toBeChecked();
    await main.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
    await expect(heading(owner, `แก้ไขข้อมูล ${displayName}`)).toBeVisible(FIRST_SIGHT);
    await main.getByRole('button', { name: 'ตั้งบัญชีรับเงินคืน', exact: true }).click();
    for (const width of [390, 1280, 1556]) {
      await owner.setViewportSize({ width, height: 1000 });
      await expect(main.getByRole('button', { name: 'บันทึกบัญชีรับเงินคืน', exact: true })).toBeVisible();
      await expect(main.getByText('หลังบันทึก คุณจะเห็นเฉพาะ 4 ตัวท้าย และเจ้าของบัญชีจะได้รับแจ้งเตือนให้ตรวจ', { exact: true })).toBeVisible();
    }
    await main.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await main.getByRole('link', { name: 'กลับไปรายชื่อพนักงาน', exact: true }).click();
  });

  await test.step('an assigned role names its blocking count and opens the employees who must move', async () => {
    await pressMenu(owner, 'บทบาทและสิทธิ์', 'พนักงานและสิทธิ์');
    await main.getByRole('searchbox', { name: 'ค้นหาบทบาท', exact: true }).fill(roleName);
    await cardWith(owner, 'บทบาททั้งหมด').getByRole('button').filter({ has: owner.getByText(roleName, { exact: true }) }).click();
    const inUse = main.getByRole('status').filter({ has: owner.getByRole('link', { name: 'ย้ายพนักงานไปบทบาทอื่น', exact: true }) });
    await expect(inUse).toContainText('ยังมีพนักงานใช้บทบาทนี้ 1 คน ย้ายไปบทบาทอื่นก่อนปิดใช้งาน', AFTER_PRESS);
    await expect(main.getByRole('button', { name: 'ปิดใช้งานบทบาท', exact: true })).toHaveCount(0);
    await main.getByRole('link', { name: 'ย้ายพนักงานไปบทบาทอื่น', exact: true }).click();
    await expect(heading(owner, 'รายชื่อพนักงาน')).toBeVisible(FIRST_SIGHT);
    await expect(main.getByRole('combobox', { name: 'เลือกบทบาท', exact: true })).toHaveText(roleName, AFTER_PRESS);
    await expect(main.getByRole('button').filter({ has: owner.getByText(displayName, { exact: true }) })).toBeVisible();
  });

  const context = await browser.newContext({ baseURL: urls.web, viewport: { width: 390, height: 844 } });
  const finishScreenFit = watchScreenFit(context, info);
  const member = await context.newPage();
  member.setDefaultTimeout(30_000);
  try {
    await test.step('new member: real login → new password → login again → clickwrap', async () => {
      await member.goto(`/login?next=${encodeURIComponent(`/companies/${shop}/dashboard`)}`, FIRST_SIGHT);
      await signIn(member, username, temporaryPassword);
      await expect(member.getByRole('heading', { level: 1, name: 'เปลี่ยนรหัสผ่าน', exact: true })).toBeVisible(FIRST_SIGHT);
      const current = member.locator('input[name="current-password"]');
      if (await current.isVisible()) await current.fill(temporaryPassword);
      await member.locator('input[name="new-password"]').fill(newPassword);
      await member.locator('input[name="confirm-password"]').fill(newPassword);
      await member.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน', exact: true }).click();
      await expect(member.getByRole('status').filter({ hasText: 'เปลี่ยนรหัสผ่านแล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่' })).toBeVisible(FIRST_SIGHT);
      await signIn(member, username, newPassword);
      // This is a brand-new account: it must see and accept the current three statements itself.
      await expect(member.getByRole('heading', { level: 1, name: 'ก่อนเริ่มใช้งานมั่งมี', exact: true })).toBeVisible(FIRST_SIGHT);
      const confirmations = member.locator('form input[type="checkbox"][required]');
      await expect(confirmations).toHaveCount(3);
      for (const box of await confirmations.all()) await box.check();
      await member.getByRole('button', { name: 'ยืนยันและเริ่มใช้งาน', exact: true }).click();
      await expect(heading(member, `สวัสดี คุณ${firstName}`)).toBeVisible(FIRST_SIGHT);
      await expect(member).toHaveURL(new RegExp(`/companies/${shop}/dashboard$`));
    });

    await test.step('member at 390: expense entry is offered, shop settings and claim approval are not granted', async () => {
      await member.locator('header').getByRole('button', { name: 'สลับเมนู', exact: true }).click();
      const nav = member.locator('aside nav');
      await expect(nav).toBeVisible();
      await expect(nav.getByRole('button', { name: /^ค่าใช้จ่ายและใบเสร็จ/ })).toBeVisible();
      await expect(nav.getByRole('button', { name: /^ตั้งค่าร้าน/ })).toHaveCount(0);
      await pressMenu(member, 'บันทึกด้วยมือ', 'ค่าใช้จ่ายและใบเสร็จ');
      await expect(heading(member, 'บันทึกด้วยมือ')).toBeVisible(FIRST_SIGHT);
      await expect(member.locator('main').getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true })).toBeVisible();
      await expect(member.locator('main').getByRole('button', { name: 'บันทึกร่าง', exact: true })).toBeEnabled(AFTER_PRESS);
      await expect(member.getByText('ไม่มีสิทธิ์เข้าถึง', { exact: true })).toHaveCount(0);
      await member.screenshot({ path: info.outputPath('member-expense-entry-390.png'), fullPage: true });
      // Intentional address-bar negative test requested by this journey; ordinary navigation uses menu presses.
      await member.goto(`/companies/${shop}/settings/profile`, FIRST_SIGHT);
      await expect(heading(member, 'ไม่มีสิทธิ์เข้าถึง')).toBeVisible(FIRST_SIGHT);
      await expect(member.locator('main').getByText('แจ้งเจ้าของกิจการหรือผู้มีสิทธิ์จัดการบทบาทให้ตรวจสิทธิ์ของคุณ', { exact: true })).toBeVisible();
      await expect(member.locator('main').getByRole('link', { name: 'กลับไปหน้าแรก', exact: true })).toBeVisible();
      await expect(heading(member, 'ข้อมูลร้าน')).toHaveCount(0);
      await expect(member).toHaveURL(new RegExp(`/companies/${shop}/settings/profile$`));
    });

    await test.step('owner: adds ดูตั้งค่าร้าน alone; member finds ข้อมูลร้าน in the menu and can only read', async () => {
      await pressMenu(owner, 'บทบาทและสิทธิ์', 'พนักงานและสิทธิ์');
      await expect(heading(owner, 'บทบาทและสิทธิ์')).toBeVisible(FIRST_SIGHT);
      await main.getByRole('searchbox', { name: 'ค้นหาบทบาท', exact: true }).fill(roleName);
      await cardWith(owner, 'บทบาททั้งหมด').getByRole('button').filter({ has: owner.getByText(roleName, { exact: true }) }).click();
      await main.getByRole('button', { name: 'แก้ไขบทบาท', exact: true }).click();
      const editor = main.locator('form').filter({ has: owner.getByRole('heading', { name: `แก้ไขบทบาท ${roleName}`, exact: true }) });
      await expect(editor.getByRole('checkbox', { name: /^บันทึกค่าใช้จ่ายของฉัน/ })).toBeChecked();
      await editor.getByRole('checkbox', { name: /^ดูตั้งค่าร้าน/ }).check();
      await expect(editor.getByRole('checkbox', { name: /^จัดการตั้งค่าร้าน/ })).not.toBeChecked();
      await editor.locator('[data-form-action-bar]').getByRole('button', { name: 'บันทึกบทบาท', exact: true }).click();
      await expect(toast(owner, `บันทึกบทบาท ${roleName} แล้ว`)).toBeVisible(AFTER_PRESS);
      await expect(main.getByTestId('role-can-do')).toContainText('ดูตั้งค่าร้าน');
      await member.reload();
      await expect(heading(member, 'ข้อมูลร้าน')).toBeVisible(FIRST_SIGHT);
      await member.locator('header').getByRole('button', { name: 'สลับเมนู', exact: true }).click();
      await expect(member.locator('aside nav').getByRole('button', { name: /^ตั้งค่าร้าน/ })).toBeVisible();
      await pressMenu(member, 'ข้อมูลร้าน', 'ตั้งค่าร้าน');
      await expect(heading(member, 'ข้อมูลร้าน')).toBeVisible(FIRST_SIGHT);
      await expect(member.getByText('ไม่มีสิทธิ์เข้าถึง', { exact: true })).toHaveCount(0);
      await expect(member.locator('main').getByRole('button', { name: 'บันทึกข้อมูลร้าน', exact: true })).toHaveCount(0);
    });

    await test.step('owner: manage automatically includes view; member can add a branch, the shop tax facts stay read-only', async () => {
      await main.getByRole('button', { name: 'แก้ไขบทบาท', exact: true }).click();
      const editor = main.locator('form').filter({ has: owner.getByRole('heading', { name: `แก้ไขบทบาท ${roleName}`, exact: true }) });
      // Clear the previous view choice first, to prove that manage selects it automatically.
      const view = editor.getByRole('checkbox', { name: /^ดูตั้งค่าร้าน/ });
      await view.uncheck();
      await editor.getByRole('checkbox', { name: /^จัดการตั้งค่าร้าน/ }).check();
      await expect(view).toBeChecked();
      await expect(view).toBeDisabled();
      await expect(editor.getByText('ต้องดูตั้งค่าร้านได้ก่อน จึงจะจัดการตั้งค่าร้านได้', { exact: true })).toBeVisible();
      await editor.locator('[data-form-action-bar]').getByRole('button', { name: 'บันทึกบทบาท', exact: true }).click();
      await expect(toast(owner, `บันทึกบทบาท ${roleName} แล้ว`)).toBeVisible(AFTER_PRESS);
      await member.reload();
      await expect(heading(member, 'ข้อมูลร้าน')).toBeVisible(FIRST_SIGHT);
      // The shop's registered name, tax number and address are their own right (แก้ไขข้อมูลภาษีร้าน), not settings manage.
      await expect(member.locator('main').getByRole('button', { name: 'บันทึกข้อมูลร้าน', exact: true })).toHaveCount(0);
      await pressMenu(member, 'สาขา', 'ตั้งค่าร้าน');
      await expect(heading(member, 'สาขา')).toBeVisible(FIRST_SIGHT);
      await expect(member.locator('main').getByRole('button', { name: '+ เพิ่มสาขา', exact: true })).toBeVisible(AFTER_PRESS);
    });

    await test.step('owner: switches the member off; the next page load refuses access with a way out', async () => {
      await pressMenu(owner, 'รายชื่อพนักงาน', 'พนักงานและสิทธิ์');
      await expect(heading(owner, 'รายชื่อพนักงาน')).toBeVisible(FIRST_SIGHT);
      await main.getByRole('searchbox', { name: 'ค้นหาพนักงาน', exact: true }).fill(firstName);
      await main.getByRole('button').filter({ has: owner.getByText(displayName, { exact: true }) }).click();
      const active = main.getByRole('switch', { name: 'ใช้งาน / ปิดใช้งาน', exact: true });
      await expect(active).toBeChecked();
      await active.click();
      const dialog = owner.getByRole('dialog', { name: `ปิดใช้งาน ${displayName}`, exact: true });
      await expect(dialog).toContainText('เข้าสู่ระบบของร้านนี้ไม่ได้และคืนที่นั่งให้ร้าน');
      await expect(dialog.getByRole('button', { name: 'ปิด', exact: true })).toHaveCount(1);
      await expect(dialog.getByRole('button', { name: 'ไม่ปิด', exact: true })).toHaveCount(1);
      await expect(dialog.getByRole('button', { name: 'ไม่ปิด', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'ปิดใช้งาน', exact: true }).click();
      await expect(toast(owner, `ปิดใช้งาน ${displayName} แล้ว`)).toBeVisible(AFTER_PRESS);
      await expect(active).not.toBeChecked();
      await expect(main.getByTestId('employee-detail-card')).toContainText('ปิดใช้งาน');
      await member.reload();
      await expect(member.getByRole('heading', { level: 1, name: 'เข้าร้านนี้ไม่ได้', exact: true })).toBeVisible(FIRST_SIGHT);
      await expect(member.getByText('บัญชีของคุณในร้านนี้ถูกปิดใช้งาน ให้เจ้าของกิจการหรือผู้ดูแลร้านเปิดใช้งานให้อีกครั้ง', { exact: true })).toBeVisible();
      await expect(member.getByRole('button', { name: 'ออกจากระบบ', exact: true })).toBeVisible();
      await expect(member.getByRole('link', { name: 'ไปร้านที่เข้าได้', exact: true })).toBeVisible();
      await expect(member.locator('aside nav')).toHaveCount(0);
    });

    await test.step('editing a disabled employee keeps that state; its result can re-enable them without the draft API', async () => {
      await main.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
      await expect(heading(owner, `แก้ไขข้อมูล ${displayName}`)).toBeVisible(FIRST_SIGHT);
      let issued = 0;
      const countIssue = (request: import('@playwright/test').Request) => {
        if (request.method() === 'POST' && request.url().endsWith('/line-link-token')) issued++;
      };
      owner.on('request', countIssue);
      try {
        await main.locator('[data-form-action-bar]').getByRole('button', { name: 'บันทึก', exact: true }).click();
        await expect(main.getByRole('status').filter({ hasText: `บันทึกข้อมูลของ ${displayName} แล้ว ยังปิดใช้งานอยู่` })).toBeVisible(AFTER_PRESS);
        expect(issued).toBe(0);
        await expect(main.getByAltText(`QR เชื่อม LINE ของ ${displayName}`, { exact: true })).toHaveCount(0);
        await expect(main.getByRole('button', { name: 'ออก QR ใหม่', exact: true })).toHaveCount(0);
        await expect(main).not.toContainText('ยังเป็นร่าง');
        await main.getByRole('button', { name: 'เปิดใช้งานพนักงาน', exact: true }).click();
        await expect(toast(owner, `เปิดใช้งาน ${displayName} แล้ว`)).toBeVisible(AFTER_PRESS);
        expect(issued).toBe(0);
        await expect(main.getByRole('button', { name: 'ออก QR ใหม่', exact: true })).toBeEnabled(AFTER_PRESS);
        const [issue] = await Promise.all([
          owner.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/line-link-token')),
          main.getByRole('button', { name: 'ออก QR ใหม่', exact: true }).click(),
        ]);
        expect(issue.ok()).toBe(true);
        await expect(main.getByAltText(`QR เชื่อม LINE ของ ${displayName}`, { exact: true })).toBeVisible(AFTER_PRESS);
        expect(issued).toBe(1);
      } finally { owner.off('request', countIssue); }
      await member.reload();
      // Back in the shop on whatever page the member had open (the branches page from the steps above), no longer refused.
      await expect(member.locator('main').getByRole('heading', { level: 1 })).toBeVisible(FIRST_SIGHT);
      await expect(member.getByRole('heading', { level: 1, name: 'เข้าร้านนี้ไม่ได้', exact: true })).toHaveCount(0);
      await main.getByRole('button', { name: 'ไปรายชื่อพนักงาน', exact: true }).click();
      await main.getByRole('searchbox', { name: 'ค้นหาพนักงาน', exact: true }).fill(firstName);
      await main.getByRole('button').filter({ has: owner.getByText(displayName, { exact: true }) }).click();
      await main.getByRole('switch', { name: 'ใช้งาน / ปิดใช้งาน', exact: true }).click();
      await owner.getByRole('dialog', { name: `ปิดใช้งาน ${displayName}`, exact: true }).getByRole('button', { name: 'ปิดใช้งาน', exact: true }).click();
      await expect(toast(owner, `ปิดใช้งาน ${displayName} แล้ว`)).toBeVisible(AFTER_PRESS);
    });

    await test.step('server records: exact pack permissions, the member role and disabled state match the screens', async () => {
      const api = await apiAs('OWNER');
      const headers = { 'X-Company-Id': shop };
      const roles = await json<Role[]>(await api.get(`companies/${shop}/settings/roles`, { headers }));
      const role = roles.find(item => item.name === roleName);
      expect(role).toBeDefined();
      expect(role).toMatchObject({ name: roleName, status: 'ACTIVE', isSystem: false });
      const catalog = await json<{ modules: Array<{ packs: Pack[] }> }>(await api.get(`companies/${shop}/settings/capability-packs`, { headers }));
      const selected = ['pack.expense.self', 'pack.company.settings.view', 'pack.company.settings.manage'];
      const packs = catalog.modules.flatMap(module => module.packs);
      expect(packs.filter(pack => selected.includes(pack.key)).map(pack => pack.key).sort()).toEqual([...selected].sort());
      // Roles store the compiled permissions, not a list of selected switches. Include automatic core packs.
      const expectedKeys = [...new Set(packs.filter(pack => pack.isCore || selected.includes(pack.key)).flatMap(pack => pack.permissionKeys))].sort();
      // A pack may bring the packs it needs with it, so the role holds at least these.
      expect(role!.permissionKeys).toEqual(expect.arrayContaining(expectedKeys));
      expect(role!.permissionKeys).not.toContain('reimbursement.approve');
      expect(role!.permissionKeys).toContain('company.setup.manage');
      const employees = await json<Employee[]>(await api.get(`companies/${shop}/settings/employees`, { headers }));
      const employee = employees.find(item => item.email === email);
      expect(employee).toMatchObject({ displayName, status: 'DISABLED', mustChangePassword: false, defaultBranchId: 'seed-plain-branch-ho' });
      expect(employee!.roles.map(item => item.id)).toEqual([role!.id]);
      expect(employee!.roles[0]!.name).toBe(roleName);
    });
  } finally {
    try { await finishScreenFit(); } finally { await context.close(); }
  }
});
