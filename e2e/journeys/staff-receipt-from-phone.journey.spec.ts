/**
 * Journey: a receipt sent from a phone by a staff member, then reviewed, confirmed and paid by an owner.
 *
 * What it walks over: a picture chosen before a branch must be kept (the page says so), the sender
 * sees a result with its buttons straight away, and `เติมข้อมูล` asks only for what is still missing.
 *
 * On this stack nothing reads the picture (no AI gateway), so seller, date and amount all come back
 * unread: exactly the case the two `เติมข้อมูล` rounds are for.
 */
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { QA_ACCOUNTS } from '../harness/roles';
import { AFTER_PRESS, FIRST_SIGHT, confirmThroughThreeSteps, idFromUrl, inOrder, picture, pressMenu, thaiDate } from './journey-kit';

type ExpenseDetail = {
  status: string; paymentStatus: string; vendorNameSnapshot: string; grandTotalAmount: string; outstandingAmount: string;
  createdByUserId: string; attachments: unknown[];
};

test('@journey staff sends a receipt from a phone (picture before branch), fills in what is missing in two rounds; an owner opens it from the list, confirms and pays', async ({ pageAs, api, companyId }) => {
  test.setTimeout(300_000);
  const today = thaiDate();
  const vendor = unique('ร้านกาแฟหน้าปากซอย');
  const receipt = picture(`${unique('ใบเสร็จมือถือ')}.png`);

  const staff = await pageAs('STAFF');
  staff.setDefaultTimeout(30_000);
  await staff.setViewportSize({ width: 390, height: 844 });
  const main = staff.locator('main');
  const branch = main.getByRole('combobox', { name: 'สาขา', exact: true });
  const send = main.getByRole('button', { name: /^ส่งใบเสร็จ(?: \d+ ใบ)?$/ });
  const fill = main.getByRole('button', { name: 'เติมข้อมูล', exact: true });
  const result = main.getByRole('status').filter({ hasText: 'ส่งใบเสร็จแล้ว' });
  const unread = main.getByText('ระบบอ่านบางช่องไม่ออก', { exact: true }).filter({ visible: true });
  await staff.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  await test.step('staff, 390 wide: three-line button → อัปโหลดใบเสร็จ', async () => {
    await pressMenu(staff, 'อัปโหลดใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'อัปโหลดใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(main.getByText('ส่งใบเสร็จให้ระบบอ่านและเก็บเป็นร่างเพื่อตรวจ', { exact: true })).toBeVisible();
    await expect(branch).toHaveText('เลือกสาขา', AFTER_PRESS);
    await expect(main.getByRole('textbox', { name: 'หมายเหตุ (ไม่บังคับ)', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: '+ หมายเหตุ', exact: true })).toHaveCount(0);
    await expect(main.getByRole('link', { name: 'ไม่มีใบเสร็จ ทำใบรับรองแทนใบเสร็จ', exact: true })).toHaveCount(0);
    await expect(main.getByText('ถ่ายรูปใบเสร็จ', { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(main.getByText('เลือกจากคลังภาพหรือไฟล์', { exact: true }).filter({ visible: true })).toHaveCount(1);
    // Nothing on the page is wider than the phone.
    expect(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  await test.step('empty Send explains what is missing and focuses the picture picker', async () => {
    await expect(send).toBeEnabled();
    await send.click();
    await expect(main.getByText('เลือกรูปใบเสร็จก่อน', { exact: true })).toBeVisible();
    await expect(main.getByLabel('ถ่ายรูปใบเสร็จ', { exact: true })).toBeFocused();
    await expect(send).toBeEnabled();
  });

  await test.step('a picture stays in the list; only Send asks for its missing branch', async () => {
    await main.getByLabel('เลือกจากคลังภาพหรือไฟล์', { exact: true }).setInputFiles(receipt);
    await expect(main.getByText('เก็บรูปไว้แล้ว เลือกสาขา แล้วกด “ส่งใบเสร็จ”', { exact: true })).toHaveCount(0);
    await expect(main.getByText('เลือกรูปใบเสร็จก่อน', { exact: true })).toHaveCount(0);
    await expect(main.getByText(`✓ ${receipt.name}`, { exact: true })).toHaveCount(0);
    await expect(main.getByText('เปลี่ยนรูป', { exact: true })).toHaveCount(0);
    await expect(main.getByText('รอส่ง', { exact: true })).toHaveCount(0);
    await expect(main.getByText(receipt.name, { exact: true })).toBeVisible();
    await expect(main.getByLabel('ถ่ายเพิ่ม', { exact: true })).toHaveCount(1);
    await expect(main.getByLabel('เลือกเพิ่ม', { exact: true })).toHaveCount(1);
    await send.click();
    await expect(main.getByText('เลือกสาขาก่อนส่ง', { exact: true })).toBeVisible();
    await expect(branch).toBeFocused();
    await chooseThemedOption(staff, branch, 'Head Office (สำนักงานใหญ่)');
    await expect(main.getByText('เลือกสาขาก่อนส่ง', { exact: true })).toHaveCount(0);
    await expect(main.getByText(receipt.name, { exact: true })).toBeVisible();
    await expect(send).toBeEnabled();
  });

  await test.step('ส่งใบเสร็จ → the result and its buttons', async () => {
    await send.click();
    await expect(result).toHaveText('ส่งใบเสร็จแล้ว ผู้ตรวจจะตรวจและยืนยันให้', { timeout: 60_000 });
    await expect(unread).toHaveCount(1);
    await expect(main.getByRole('button', { name: 'ลบร่างใบเสร็จ', exact: true })).toBeEnabled();
    await expect(fill).toBeEnabled();
    await expect(main.getByRole('link', { name: 'ดูรายการที่ส่ง', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'ส่งอีกใบ', exact: true })).toBeEnabled();
  });

  await test.step('เติมข้อมูล, round 1: asked for seller, date and amount; she gives seller and amount', async () => {
    await fill.click();
    await expect(main.getByRole('heading', { name: 'เติมข้อมูลใบเสร็จ', exact: true })).toBeVisible();
    await expect(main.getByRole('combobox', { name: 'วันที่เอกสาร', exact: true })).toHaveText('เลือกวันที่');
    await main.getByRole('textbox', { name: 'ชื่อผู้ขาย', exact: true }).fill(vendor);
    await main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true }).fill('85');
    await main.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
    await expect(result).toBeVisible(AFTER_PRESS);
    // Still one thing missing: the page keeps saying so and keeps the way to give it.
    await expect(unread).toHaveCount(1);
    await expect(fill).toBeEnabled();
  });

  await test.step('เติมข้อมูล, round 2: asked only for the date', async () => {
    await fill.click();
    await expect(main.getByRole('heading', { name: 'เติมข้อมูลใบเสร็จ', exact: true })).toBeVisible();
    await expect(main.getByRole('textbox', { name: 'ชื่อผู้ขาย', exact: true })).toHaveCount(0);
    await expect(main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true })).toHaveCount(0);
    const date = main.getByRole('combobox', { name: 'วันที่เอกสาร', exact: true });
    await date.click();
    await staff.getByRole('button', { name: 'วันนี้', exact: true }).click();
    await expect(date).toHaveText(today);
    await expect(date).toBeFocused();
    await date.click();
    await staff.keyboard.press('Escape');
    await expect(date).toHaveAttribute('aria-expanded', 'false');
    await expect(date).toBeFocused();
    await main.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
    await expect(result).toBeVisible(AFTER_PRESS);
    await expect(unread).toHaveCount(0);
    await expect(fill).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'ส่งอีกใบ', exact: true })).toBeEnabled();
  });

  await test.step('ดูรายการที่ส่ง: her receipt waits for review', async () => {
    await main.getByRole('link', { name: 'ดูรายการที่ส่ง', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'รายการค่าใช้จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    const row = main.getByRole('button', { name: new RegExp(`^${vendor}`) });
    await expect(row).toContainText(inOrder(vendor, '85.00'), AFTER_PRESS);
    // One status a row since 2026-10-15 (owner): รอตรวจ, รอจ่าย, จ่ายแล้ว or ยกเลิก.
    await expect(row).toContainText(inOrder(today, 'รอตรวจ'));
    await expect(row).not.toContainText('ยังไม่จ่าย');
  });

  const owner = await pageAs('OWNER');
  owner.setDefaultTimeout(30_000);
  const ownerMain = owner.locator('main');
  await owner.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  await test.step('owner: รายการค่าใช้จ่าย → opens it from the list', async () => {
    await pressMenu(owner, 'รายการค่าใช้จ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(ownerMain.getByRole('heading', { level: 1, name: 'รายการค่าใช้จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await ownerMain.getByRole('searchbox', { name: 'ค้นหาผู้ขายหรือเลขที่', exact: true }).fill(vendor);
    const row = ownerMain.getByTestId('expenses-row').filter({ hasText: vendor }).filter({ visible: true });
    // The expense number sits under the seller's name, between it and the date.
    await expect(row).toContainText(test.info().project.use.isMobile
      ? new RegExp(`${inOrder(vendor, '85.00').source}\\s*EXP-\\d{6}-\\d{5}\\s*·\\s*${inOrder(today, 'รอตรวจ').source}`)
      : inOrder(today, '85.00', 'รอตรวจ'), AFTER_PRESS);
    await expect(row).not.toContainText('อัปโหลดเว็บ');
    await row.getByText(vendor, { exact: true }).filter({ visible: true }).first().click();
    await expect(ownerMain.getByRole('heading', { level: 1, name: vendor, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(ownerMain.locator('[aria-current="step"]').filter({ hasText: 'ตรวจข้อมูล' })).toBeVisible();
    const files = ownerMain.getByTestId('expense-attachment-list');
    if (await files.isVisible()) {
      await files.locator(':scope > div').filter({ hasText: receipt.name }).getByRole('button', { name: 'ดูไฟล์', exact: true }).click();
      const viewer = owner.getByRole('dialog', { name: receipt.name, exact: true });
      await expect(viewer.getByRole('img', { name: receipt.name, exact: true })).toBeVisible(AFTER_PRESS);
      await expect(viewer.locator('[data-preview-status]')).toHaveAttribute('data-preview-status', 'ready', AFTER_PRESS);
      await viewer.getByRole('button', { name: 'ปิด', exact: true }).click();
      await expect(viewer).toBeHidden();
    } else {
      await expect(ownerMain.getByRole('img', { name: receipt.name, exact: true })).toBeVisible();
    }
    await expect(ownerMain.getByRole('textbox', { name: 'ชื่อผู้ขาย', exact: true })).toHaveValue(vendor);
    await expect(ownerMain.getByRole('combobox', { name: 'วันที่เอกสาร', exact: true })).toHaveText(today);
    await expect(ownerMain.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true })).toHaveValue('85');
  });

  const expenseId = idFromUrl(owner);
  await test.step('owner: walks the three steps, confirms, records the payment', async () => {
    await confirmThroughThreeSteps(owner, { toPay: '85.00 บาท', pay: true });
    await expect(ownerMain.getByText('จ่ายครบแล้ว', { exact: true })).toHaveCount(0);
    await expect(ownerMain.getByTestId('expense-detail-totals')).toBeVisible();
    await expect(ownerMain.getByTestId('expense-detail-totals')).toContainText(inOrder('จ่ายแล้ว', '85.00', 'บาท'));
    await expect(ownerMain.locator('.mangmee-page-header').getByText('จ่ายแล้ว', { exact: true })).toBeVisible();
  });

  // The truth on the server.
  const expense = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${expenseId}`));
  expect(expense.status).toBe('CONFIRMED');
  expect(expense.paymentStatus).toBe('PAID');
  expect(expense.vendorNameSnapshot).toBe(vendor);
  expect(Number(expense.grandTotalAmount)).toBe(85);
  expect(Number(expense.outstandingAmount)).toBe(0);
  expect(expense.createdByUserId).toBe(`seed-qa-user-${QA_ACCOUNTS.STAFF.username.split('.')[1]}`);
  expect(expense.attachments.length).toBeGreaterThan(0);
});
