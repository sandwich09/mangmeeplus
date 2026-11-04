/**
 * Journey: the files for the accounting office, a branch switched off, and a name change that leaves
 * a trace: three short errands of an owner, with a staff member changing her own display name.
 *
 * Download names are being moved to Thai ones while this is written, so a download is asserted by
 * its extension and its first bytes, not by its exact name.
 */
import type { Page, Response } from '@playwright/test';
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { loginAs, QA_ACCOUNTS } from '../harness/roles';
import { AFTER_PRESS, FIRST_SIGHT, branchEntry, openUserMenu, picture, pressForDownload, pressMenu, recordExpenseByHand, thaiMonth } from './journey-kit';

type Branches = { items: Array<{ id: string; code: string; name: string; status: string }> };
type NameHistory = { displayName: string; history: Array<{ oldName: string; newName: string; changedByName: string | null }> };

const STAFF = QA_ACCOUNTS.STAFF.displayName;
const toast = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text }).first();

// Requires the QA owner to belong to one never-paid free shop and one paid shop.
// These are real commercial states: do not mock auth/me or the export endpoints.
for (const width of [390, 1280, 1556]) test(`@journey free shops cannot open either export at 390, 1280 and 1556 (${width}px)`, async ({ pageAs, companyId }) => {
  const page = await pageAs('OWNER');
  await page.setViewportSize({ width, height: 1000 });
  const companies = await json<{ data: Array<{ companyId: string; companyName: string; freeExpenseDrafts?: boolean }> }>(await page.request.get('/api/v1/auth/me/companies'));
  const free = companies.data.find(shop => shop.freeExpenseDrafts);
  const paid = companies.data.find(shop => shop.companyId === companyId && !shop.freeExpenseDrafts);
  expect(free, 'Controller fixture: QA OWNER needs membership in a never-paid free shop').toBeTruthy();
  expect(paid, 'Controller fixture: seeded paid shop must remain paid').toBeTruthy();
  if (!free || !paid) throw new Error('Free and paid owner memberships are required');
  const context = async (id: string) => json<{ userId: string; companyId: string; freeExpenseDrafts?: boolean; permissions: string[] }>(await page.request.get('/api/v1/auth/me', { headers: { 'X-Company-Id': id } }));
  const before = await context(free.companyId);
  expect(before.freeExpenseDrafts).toBe(true);
  expect(before.permissions).not.toContain('expense.export');
  await page.goto(`/companies/${free.companyId}/expenses`, FIRST_SIGHT);
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'รายการค่าใช้จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
  for (const label of ['ส่งออก Excel ให้สำนักงานบัญชี', 'ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี']) {
    await expect(main.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // A real BFF mutation carries the session's CSRF token and Origin, as the web app sends them.
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'watchdog_csrf')?.value;
  expect(csrf, 'watchdog_csrf cookie is present after sign-in').toBeTruthy();
  const mutation = { 'X-Company-Id': free.companyId, Origin: new URL(page.url()).origin, 'x-csrf-token': csrf! };
  for (const endpoint of ['accountant-package', 'accountant-package/bundle-plan', 'accountant-package/bundle/1']) {
    const result = await page.request.post(`/api/v1/companies/${free.companyId}/expenses/${endpoint}`, { data: {}, headers: mutation });
    expect(result.status()).toBe(403);
    expect((await result.json()).code).toBe('FREE_EXPENSE_DRAFTS_ONLY');
  }
  // Software export is added by its own Phase 1.6; it is not an endpoint in this step.
  await page.getByRole('button', { name: 'เปลี่ยนร้าน', exact: true }).click();
  await page.locator('[data-company-switch]').getByRole('button').filter({ hasText: paid.companyName }).click();
  await expect(page).toHaveURL(new RegExp(`/companies/${paid.companyId}/`), AFTER_PRESS);
  await pressMenu(page, 'รายการค่าใช้จ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
  const after = await context(paid.companyId);
  expect(after.userId).toBe(before.userId); expect(after.companyId).toBe(paid.companyId);
  expect(after.freeExpenseDrafts).not.toBe(true); expect(after.permissions).toContain('expense.export');
  const bundlePlanPath = `**/api/v1/companies/${paid.companyId}/expenses/accountant-package/bundle-plan`;
  await page.route(bundlePlanPath, route => route.fulfill({ status: 403, json: { code: 'FREE_EXPENSE_DRAFTS_ONLY' } }));
  await main.getByRole('button', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible(AFTER_PRESS);
  await dialog.getByRole('button', { name: 'กลับไปรายการค่าใช้จ่าย', exact: true }).click();
  await expect(dialog).toHaveCount(0, AFTER_PRESS);
  await page.unroute(bundlePlanPath);
  await main.getByRole('button', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true }).click();
  await expect(dialog).toBeVisible(AFTER_PRESS);
  // A stale tab gets a same-screen exit after the server refuses its export.
  await page.route(`**/api/v1/companies/${paid.companyId}/expenses/accountant-package`, route => route.fulfill({
    status: 403, json: { code: 'FREE_EXPENSE_DRAFTS_ONLY', message: 'สิทธิ์นี้ใช้สำหรับอ่านเอกสารและเก็บร่างรายจ่ายเท่านั้น' },
  }));
  await dialog.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click();
  await dialog.getByRole('button', { name: 'กลับไปรายการค่าใช้จ่าย', exact: true }).click();
  await expect(dialog).toHaveCount(0, AFTER_PRESS);
  await expect(main.getByRole('heading', { name: 'รายการค่าใช้จ่าย', exact: true })).toBeVisible();
});

test('@journey an owner downloads the accounting files, switches a branch off and no longer finds it in the upload chooser; a staff name change shows under ประวัติการแก้ชื่อ on her card', async ({ pageAs, api, apiAs, companyId }) => {
  test.setTimeout(300_000);
  const vendor = unique('ร้านหลักฐานบัญชี');
  const branchName = unique('สาขาทดลองปิด');
  const branchCode = `J${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
  const newName = unique('ปวีณ์ใหม่ ทดลองชื่อ');

  const owner = await pageAs('OWNER');
  owner.setDefaultTimeout(30_000);
  const main = owner.locator('main');
  await owner.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  await test.step('owner: a confirmed receipt of this journey, so the files do not depend on another journey', () => recordExpenseByHand(owner, {
    branch: 'Head Office (สำนักงานใหญ่)', item: unique('อาหารประชุม'), price: '1.005', total: '1.01 บาท', seller: vendor, toPay: '1.01 บาท',
  }));

  await test.step('หลักฐานทางบัญชี: this month → fix a row, return to its filters, and download the accountant bundle', async () => {
    await pressMenu(owner, 'หลักฐานทางบัญชี', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'หลักฐานทางบัญชี', exact: true })).toBeVisible(FIRST_SIGHT);
    const month = main.getByRole('combobox', { name: 'เดือน', exact: true });
    await month.click();
    await owner.getByRole('option', { name: new RegExp(`^${thaiMonth().replace(/\./g, '\\.')} · \\d+ รายการ`) }).click();
    await expect(month).toContainText(thaiMonth());
    await expect(main.getByText('การเงินและบัญชี', { exact: true })).toHaveCount(0);
    await expect(main.getByText(/^แสดง \d+-\d+ จาก/)).toHaveCount(0);
    await expect(main.getByText('กำลังโหลด...', { exact: true })).toHaveCount(0);
    const row = main.getByRole('link', { name: /^เปิดรายการค่าใช้จ่าย EXP-/ }).filter({ hasText: vendor });
    while (!await row.count()) {
      const next = main.getByRole('button', { name: 'ถัดไป', exact: true });
      await expect(next).toBeEnabled(AFTER_PRESS);
      const pageNumber = Number(new URL(owner.url()).searchParams.get('page') || 1);
      await next.click();
      await expect(main.getByText(new RegExp(`^หน้า ${pageNumber + 1} จาก `))).toBeVisible(AFTER_PRESS);
    }
    const incomplete = !await row.getByText('ครบแล้ว', { exact: true }).count();
    const listUrl = owner.url();
    expect(await main.locator('td:visible').evaluateAll(cells => cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true);
    await row.focus(); await row.press('Enter');
    if (incomplete) await expect(main.getByRole('heading', { name: 'สิ่งที่ต้องแก้', exact: true })).toBeFocused(AFTER_PRESS);
    await expect(owner).not.toHaveURL(/section=checks/);
    await expect(owner.getByRole('dialog')).toHaveCount(0);
    await main.getByRole('link', { name: 'กลับไปรายการ', exact: true }).click();
    await owner.waitForURL(url => url.pathname.endsWith('/expenses/evidence'));
    for (const [key, value] of new URL(listUrl).searchParams) expect(new URL(owner.url()).searchParams.get(key)).toBe(value);
    await expect(row).toBeVisible(AFTER_PRESS);
    await main.locator('summary').filter({ hasText: 'เพิ่มเติม' }).click();

    const excel = main.getByRole('button', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true });
    await expect(excel).toBeEnabled(AFTER_PRESS);
    const workbook = await pressForDownload(owner, () => excel.click());
    expect(workbook.name).toMatch(/\.xlsx$/);
    expect(workbook.head.slice(0, 2)).toBe('PK');
    await expect(owner.getByText(/ดาวน์โหลด Excel แล้ว \d+ รายการ/).first()).toBeVisible(AFTER_PRESS);
    await expect(main.getByText(/^สร้างเมื่อ /)).toBeVisible();

    await expect(main.getByRole('button', { name: 'ดาวน์โหลดไฟล์ทั้งหมด', exact: true })).toHaveCount(0);
    const bundles = main.getByRole('button', { name: /^ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี( ชุดที่ \d+ จาก \d+)?$/ });
    await expect(bundles.first()).toBeEnabled(AFTER_PRESS);
    const count = await bundles.count();
    for (let index = 0; index < count; index++) {
      const bundle = await pressForDownload(owner, () => bundles.nth(index).click(), 120_000);
      expect(bundle.name).toMatch(/\.zip$/);
      expect(bundle.head.slice(0, 2)).toBe('PK');
    }
  });

  await test.step('คู่ค้า: search, open a row with Enter, open its recent expense and return to the same counterparty', async () => {
    await pressMenu(owner, 'คู่ค้า');
    await expect(main.getByRole('heading', { level: 1, name: 'คู่ค้า', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('searchbox').fill(vendor);
    const row = main.getByRole('link', { name: `เปิดคู่ค้า ${vendor}`, exact: true });
    await expect(row).toBeVisible(AFTER_PRESS);
    await expect(main.getByText(/^ทั้งหมด \d+ ราย$/)).toHaveCount(0);
    expect(await main.locator('td:visible').evaluateAll(cells => cells.every(cell => cell.scrollWidth <= cell.clientWidth))).toBe(true);
    await row.focus(); await row.press('Enter');
    await expect(main.getByRole('heading', { level: 1, name: vendor, exact: true })).toBeVisible(AFTER_PRESS);
    const detailUrl = owner.url();
    await expect(main.locator('[data-form-action-bar]').getByRole('button', { name: 'บันทึก', exact: true })).toBeVisible();
    const recent = main.locator('section').filter({ has: owner.getByRole('heading', { name: 'ใบล่าสุด', exact: true }) });
    const expense = recent.getByRole('link').filter({ hasText: 'EXP-' }).first();
    await expect(expense).toContainText('1.01 บาท');
    await expect(recent).not.toContainText('฿');
    await expense.click();
    await owner.waitForURL(url => url.pathname.includes('/expenses/'));
    await main.getByRole('link', { name: 'กลับไปรายการ', exact: true }).click();
    await expect(owner).toHaveURL(detailUrl, AFTER_PRESS);
  });

  await test.step('สาขา: add a branch, switch it off (the line in the dialog, the toast)', async () => {
    await pressMenu(owner, 'สาขา', 'ตั้งค่าร้าน');
    await expect(main.getByRole('heading', { level: 1, name: 'สาขา', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('button', { name: '+ เพิ่มสาขา', exact: true }).click();
    const create = owner.getByRole('dialog', { name: 'เพิ่มสาขา' });
    await create.getByRole('textbox', { name: 'ชื่อสาขา', exact: true }).fill(branchName);
    await create.getByRole('textbox', { name: /^รหัสสาขา ชื่อย่อ/ }).fill(branchCode);
    await create.getByRole('button', { name: 'เพิ่มสาขา', exact: true }).click();
    await expect(toast(owner, `เพิ่มสาขา ${branchName} แล้ว`)).toBeVisible(AFTER_PRESS);
    const row = branchEntry(owner, branchName);
    await expect(row.getByText(branchCode, { exact: true })).toBeVisible();
    await expect(row.getByText('ใช้งาน', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: `แก้ไขสาขา ${branchName}`, exact: true }).click();
    const edit = owner.getByRole('dialog');
    await expect(edit.getByRole('textbox', { name: 'ชื่อสาขา', exact: true })).toHaveValue(branchName);
    const phone = edit.getByRole('textbox', { name: 'โทรศัพท์', exact: true });
    await phone.fill('0812345678');
    await edit.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(edit).toHaveCount(0, AFTER_PRESS);
    await row.getByRole('button', { name: `แก้ไขสาขา ${branchName}`, exact: true }).click();
    await expect(phone).toHaveValue('0812345678', AFTER_PRESS);
    await phone.fill('');
    await edit.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(edit).toHaveCount(0, AFTER_PRESS);
    await row.getByRole('button', { name: `แก้ไขสาขา ${branchName}`, exact: true }).click();
    await expect(phone).toHaveValue('', AFTER_PRESS);
    await chooseThemedOption(owner, edit.getByRole('combobox', { name: 'สถานะ', exact: true }), 'ปิดใช้งาน');
    await expect(edit.getByText('ปิดใช้งานแล้วจะเพิ่มรายการในสาขานี้ไม่ได้ รายการเดิมยังอยู่', { exact: true })).toBeVisible();
    await edit.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(toast(owner, `ปิดใช้งานสาขา ${branchName} แล้ว`)).toBeVisible(AFTER_PRESS);
    await expect(row.getByText('ปิดใช้งาน', { exact: true })).toBeVisible();
  });

  await test.step('อัปโหลดใบเสร็จ: the branch chooser no longer offers it', async () => {
    await pressMenu(owner, 'อัปโหลดใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'อัปโหลดใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('combobox', { name: 'สาขา', exact: true }).click();
    await expect(owner.getByRole('option', { name: /^Head Office \(สำนักงานใหญ่\)/ })).toBeVisible();
    await expect(owner.getByRole('option').filter({ hasText: branchName })).toHaveCount(0);
    await owner.keyboard.press('Escape');
  });

  const staff = await pageAs('STAFF');
  staff.setDefaultTimeout(30_000);
  const staffMain = staff.locator('main');
  const nameBox = staffMain.getByRole('textbox', { name: 'ชื่อที่แสดง', exact: true });
  const saveName = staffMain.getByRole('button', { name: 'บันทึกชื่อ', exact: true });
  let changed = false;
  let limited = false;
  const isNameSave = (response: Response) => response.request().method() === 'PATCH' && response.url().includes('/auth/account/display-name');
  const LIMIT = 'The name change was refused with 429: a person may write to her account 10 times in 15 minutes, and the proof reset does not clear that count. Wait 15 minutes, reset, and run again.';
  try {
    await test.step('staff: user menu → บัญชีของฉัน → changes her display name', async () => {
      await staff.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
      await openUserMenu(staff);
      await staff.getByRole('link', { name: 'บัญชีของฉัน', exact: true }).click();
      await expect(staffMain.getByRole('heading', { level: 1, name: 'บัญชีของฉัน', exact: true })).toBeVisible(FIRST_SIGHT);
      const phone = staffMain.locator('details').filter({ has: staff.getByText('เบอร์มือถือ', { exact: true }) });
      await phone.locator('summary').click();
      await expect(phone.locator('[data-form-action-bar]').getByRole('button', { name: 'บันทึกเบอร์มือถือ', exact: true })).toBeVisible();
      await phone.locator('summary').click();
      await expect(nameBox).toHaveValue(STAFF, AFTER_PRESS);
      await nameBox.fill(newName);
      const answer = staff.waitForResponse(isNameSave, { timeout: 10_000 });
      await saveName.click();
      limited = (await answer).status() === 429;
      if (!limited) {
        changed = true;
        await expect(toast(staff, 'บันทึกชื่อแล้ว')).toBeVisible(AFTER_PRESS);
        await expect(nameBox).toHaveValue(newName);
        await expect(await openUserMenu(staff)).toContainText(newName);
        await pressMenu(staff, 'หน้าแรก');
        await expect(staffMain.getByRole('heading', { level: 1 })).toContainText(newName.split(' ')[0]!);
        await openUserMenu(staff);
        await staff.getByRole('link', { name: 'บัญชีของฉัน', exact: true }).click();
        await expect(nameBox).toHaveValue(newName);
      }
      expect(limited, LIMIT).toBe(false);
    });

    await test.step('owner: รายชื่อพนักงาน → her card → ประวัติการแก้ชื่อ shows old → new and who changed it', async () => {
      await pressMenu(owner, 'รายชื่อพนักงาน', 'พนักงานและสิทธิ์');
      await expect(main.getByRole('heading', { level: 1, name: 'รายชื่อพนักงาน', exact: true })).toBeVisible(FIRST_SIGHT);
      // Her card is found by her job title, whichever of the two names the list prints.
      const card = main.getByRole('button', { name: /พนักงานทั่วไป ทุกสาขา พนักงาน$/ });
      await expect(card).toBeVisible(AFTER_PRESS);
      await expect(card).toContainText(`ชื่อที่แสดง: ${newName}`);
      await card.click();
      await expect(main.getByTestId('employee-detail-card')).toContainText(`ชื่อที่แสดง: ${newName}`);
      await expect(main.getByTestId('access-permission-summary')).toContainText(`ชื่อที่แสดง: ${newName}`);
      const history = owner.locator('details').filter({ has: owner.getByText('ประวัติการแก้ชื่อ', { exact: true }) }).filter({ visible: true }).first();
      await history.locator('summary').click();
      await expect(history).toContainText(`${STAFF} → ${newName}`, AFTER_PRESS);
      await expect(history).toContainText(`แก้โดย ${newName}`);
    });
  } finally {
    // The seeded name is put back through the same screen, also when an assertion above failed.
    if (changed) {
      if (!(await nameBox.isVisible())) {
        await openUserMenu(staff);
        await staff.getByRole('link', { name: 'บัญชีของฉัน', exact: true }).click();
        await expect(nameBox).toBeVisible(AFTER_PRESS);
      }
      if (!limited) {
        await nameBox.fill(STAFF);
        const answer = staff.waitForResponse(isNameSave, { timeout: 10_000 });
        await saveName.click();
        limited = (await answer).status() === 429;
        if (!limited) {
          await expect(nameBox).toHaveValue(STAFF);
          await expect(await openUserMenu(staff)).toContainText(STAFF);
        }
      }
      expect(limited, `${LIMIT} The seeded name was NOT put back.`).toBe(false);
    }
  }

  // The truth on the server.
  const branches = await json<Branches>(await api.get(`companies/${companyId}/branches?pageSize=100`));
  const created = branches.items.find((item) => item.code === branchCode);
  expect(created?.name).toBe(branchName);
  expect(created?.status).not.toBe('ACTIVE');
  const active = await json<Branches>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  expect(active.items.map((item) => item.code)).not.toContain(branchCode);
  const staffApi = await apiAs('STAFF');
  const name = await json<NameHistory>(await staffApi.get(`auth/account/display-name?companyId=${encodeURIComponent(companyId)}`));
  expect(name.displayName).toBe(STAFF);
  expect(name.history.some((row) => row.oldName === STAFF && row.newName === newName)).toBe(true);
  expect(name.history.some((row) => row.oldName === newName && row.newName === STAFF)).toBe(true);
});

test('@journey a shared browser remembers the upload branch for the staff member but does not give it to the owner', async ({ context, page, api, apiAs, companyId, urls }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  const chosenBranch = 'Head Office (สำนักงานใหญ่)';
  const main = page.locator('main');
  const branch = main.getByRole('combobox', { name: 'สาขา', exact: true });
  const topBranch = page.locator('header').getByRole('button', { name: 'เลือกสาขา', exact: true });
  const allBranches = async () => {
    await topBranch.click();
    await page.locator('header').getByRole('button', { name: /^ทุกสาขา \(รวม\)( ✓)?$/ }).click();
    await expect(topBranch).toHaveText('ทุกสาขา (รวม)');
  };
  const openUpload = async () => {
    await pressMenu(page, 'อัปโหลดใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'อัปโหลดใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
  };

  await test.step('staff chooses the upload branch, leaves, and still sees her choice with the top filter on all branches', async () => {
    await loginAs(context, 'STAFF');
    await page.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
    await openUpload();
    await expect(branch).toHaveText('เลือกสาขา', AFTER_PRESS);
    await chooseThemedOption(page, branch, chosenBranch);
    await expect(branch).toHaveText(chosenBranch);
    await pressMenu(page, 'รายการค่าใช้จ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'รายการค่าใช้จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await allBranches();
    await openUpload();
    await expect(branch).toHaveText(chosenBranch, AFTER_PRESS);
    await pressMenu(page, 'รายการค่าใช้จ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
  });

  await test.step('owner signs in to that SAME context; all branches does not prefill the staff choice', async () => {
    // Keep localStorage and the same page: only the cookie session changes through the real BFF login.
    await loginAs(context, 'OWNER');
    await page.reload(FIRST_SIGHT);
    await expect(await openUserMenu(page)).toContainText(QA_ACCOUNTS.OWNER.displayName, FIRST_SIGHT);
    await page.getByRole('button', { name: /^เมนูผู้ใช้/ }).click();
    const closeDrawer = page.getByRole('button', { name: 'ปิดเมนู', exact: true });
    if (await closeDrawer.isVisible()) await closeDrawer.click();
    await allBranches();
    await openUpload();
    await expect(branch).toHaveText('เลือกสาขา', AFTER_PRESS);
    await expect(branch).not.toHaveText(chosenBranch);
    // ส่งใบเสร็จ is never switched off for a missing branch: with a picture chosen, the page keeps it
    // and asks for the branch. That line is only there while her form has no branch.
    await main.getByLabel('เลือกจากคลังภาพหรือไฟล์', { exact: true }).setInputFiles(picture('ใบเสร็จของเจ้าของ.png'));
    await expect(main.getByText('เก็บรูปไว้แล้ว เลือกสาขา แล้วกด “ส่งใบเสร็จ”', { exact: true })).toHaveCount(0);
    await expect(branch).not.toHaveAttribute('aria-invalid', 'true');
    await main.getByRole('button', { name: /^ส่งใบเสร็จ 1 ใบ$/ }).click();
    await expect(main.getByText('เลือกสาขาก่อนส่ง', { exact: true })).toBeVisible(AFTER_PRESS);
    await expect(branch).toBeFocused();
    await expect(branch).toHaveText('เลือกสาขา');
  });

  // The final server identity is the owner, while the staff's remembered choice stayed on this device.
  const current = await json<{ userId: string }>(await context.request.get(`${urls.web}/api/v1/auth/me`));
  const ownerApi = await apiAs('OWNER');
  const owner = await json<{ userId: string }>(await ownerApi.get('auth/me'));
  const staffApi = await apiAs('STAFF');
  const staff = await json<{ userId: string }>(await staffApi.get('auth/me'));
  expect(current.userId).toBe(owner.userId);
  expect(current.userId).not.toBe(staff.userId);
  const branches = await json<Branches>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  expect(branches.items.some(branch => branch.name === 'Head Office')).toBe(true);
});

test('@journey expense reads fail visibly, keep filters and recover through ลองอีกครั้ง on all four screens', async ({ pageAs, companyId }) => {
  test.setTimeout(300_000);
  const page = await pageAs('OWNER');
  page.setDefaultTimeout(30_000);
  const main = page.locator('main');
  await page.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
  const screens = [
    ['รายการค่าใช้จ่าย', 'expenses'],
    ['หลักฐานทางบัญชี', 'expenses/shared-evidence'],
    ['หมวดหมู่', 'expense-categories/manage'],
    ['ลายเซ็นของฉัน', 'expense-signatures'],
  ] as const;
  for (const [title, endpoint] of screens) await test.step(`${title}: failed read → ลองอีกครั้ง → real data`, async () => {
    const path = `/api/v1/companies/${companyId}/${endpoint}`;
    const matches = (url: URL) => url.pathname === path;
    let fail = true, failedUrl = '';
    await page.route(matches, async route => {
      if (route.request().method() !== 'GET' || !fail) return route.continue();
      failedUrl = route.request().url();
      await route.fulfill({ status: 503, json: { message: 'Service unavailable' } });
    });
    try {
      if (title === 'ลายเซ็นของฉัน') {
        await openUserMenu(page);
        await page.getByRole('link', { name: 'บัญชีของฉัน', exact: true }).click();
        await main.getByRole('link', { name: 'จัดการลายเซ็น', exact: true }).click();
      } else await pressMenu(page, title, 'ค่าใช้จ่ายและใบเสร็จ');
      await expect(main.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible(FIRST_SIGHT);
      await expect(main.getByText('โหลดไม่สำเร็จ', { exact: true })).toBeVisible(AFTER_PRESS);
      const retry = main.getByRole('button', { name: 'ลองอีกครั้ง', exact: true });
      await expect(retry).toBeVisible();
      await expect(main.getByText('ยังไม่มีรายจ่ายในช่วงที่เลือก', { exact: true })).toHaveCount(0);
      await expect(main.getByText('ไม่มีรายการที่ตรงกับตัวกรอง', { exact: true })).toHaveCount(0);
      if (title === 'รายการค่าใช้จ่าย') {
        await expect(main.getByTestId('expenses-summary')).toHaveCount(0);
        await expect(main.getByRole('combobox', { name: 'วันที่เอกสาร', exact: true })).toBeVisible();
        await expect(main.getByRole('searchbox', { name: 'ค้นหาผู้ขายหรือเลขที่', exact: true })).toBeVisible();
      }
      if (title === 'หลักฐานทางบัญชี') {
        await expect(main.getByRole('combobox', { name: 'เดือน', exact: true })).toBeVisible();
        await expect(main.getByRole('button', { name: 'วันที่ส่งเข้า', exact: true })).toBeVisible();
        await expect(main.getByRole('group', { name: 'ความครบของหลักฐาน', exact: true })).toBeVisible();
      }
      const response = page.waitForResponse(result => new URL(result.url()).pathname === path && result.request().method() === 'GET' && result.ok());
      fail = false;
      await retry.click();
      expect((await response).url()).toBe(failedUrl);
      await expect(main.getByText('โหลดไม่สำเร็จ', { exact: true })).toHaveCount(0, AFTER_PRESS);
      if (title === 'รายการค่าใช้จ่าย') await expect(main.getByTestId('expenses-summary')).toBeVisible(AFTER_PRESS);
      if (title === 'หลักฐานทางบัญชี') await expect(main.getByTestId('evidence-card-list')).toBeAttached(AFTER_PRESS);
      if (title === 'หมวดหมู่') await expect(main.locator('[data-category-rows]')).toBeAttached(AFTER_PRESS);
      if (title === 'ลายเซ็นของฉัน') await expect(main.getByRole('button', { name: /^(เพิ่มลายเซ็น|เปลี่ยนลายเซ็น)$/ })).toBeVisible(AFTER_PRESS);
    } finally { await page.unroute(matches); }
  });
});
