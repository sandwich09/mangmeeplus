/**
 * Journey: a claim that is declined and cancelled, then a claim that is approved and paid, with
 * three people each doing their own step (staff files, manager decides, finance pays).
 *
 * The defect it walks over: a declined claim's badge still said `ปฏิเสธ`, and the claim's owner had
 * no direct way out of it.
 */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { QA_ACCOUNTS } from '../harness/roles';
import { AFTER_PRESS, FIRST_SIGHT, cardWith, idFromUrl, inOrder, picture, pressMenu, thaiDate } from './journey-kit';

type Claim = {
  status: string; paymentStatus: string; requestNo: string; amount: string;
  payments: Array<{ status: string; paymentMethod: string; slipCount: number }>;
};

const STAFF = QA_ACCOUNTS.STAFF.displayName;
const MANAGER = QA_ACCOUNTS.MANAGER.displayName;

const toast = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text }).first();
/** The claim's state badge under its number (the history further down repeats old states). */
const stateBadge = (main: Locator) => main.locator('.mangmee-badge').first();
const claimsHeading = (page: Page) => page.locator('main').getByRole('heading', { level: 1, name: 'การเบิกจ่าย', exact: true });

async function openClaims(page: Page) {
  await pressMenu(page, 'การเบิกจ่าย');
  await expect(claimsHeading(page)).toBeVisible(FIRST_SIGHT);
}

/** Staff fills the claim form (one line, one picture) and sends it; the page lands on the claim. */
async function fileClaim(page: Page, claim: { reason: string; amount: string; printed: string; category: string; payout: 'cash' | 'account' }) {
  const main = page.locator('main');
  await expect(main.getByRole('heading', { level: 1, name: 'สร้างใบเบิก', exact: true })).toBeVisible(FIRST_SIGHT);
  const branch = main.getByRole('combobox', { name: 'สาขา', exact: true });
  await expect(branch).toBeVisible(AFTER_PRESS);
  if ((await branch.innerText()).trim() !== 'Head Office (สำนักงานใหญ่)') await chooseThemedOption(page, branch, 'Head Office (สำนักงานใหญ่)');
  await expect(main.getByRole('button', { name: /^รายการที่ 1/ })).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'รายการที่ 1', exact: true })).toBeVisible();
  await main.getByRole('textbox', { name: 'เหตุผล', exact: true }).fill(claim.reason);
  const receipt = picture(`ใบเสร็จ-${claim.amount}.png`);
  await main.getByLabel('ใบเสร็จ', { exact: true }).setInputFiles(receipt);
  await expect(main.getByText(receipt.name).first()).toBeVisible(AFTER_PRESS);
  await expect(main.getByRole('combobox', { name: 'หมวด', exact: true })).toHaveText('เลือกหมวด');
  await main.getByRole('textbox', { name: 'รายการ', exact: true }).fill(claim.reason);
  await expect(main.getByRole('combobox', { name: 'หมวด', exact: true })).toHaveText(claim.category);
  // The preview rounds each typed line before adding, just as the saved claim does.
  await main.getByRole('button', { name: '+ เพิ่มรายการ', exact: true }).click();
  await main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true }).nth(1).fill('10.005');
  await expect(main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true })).toHaveCount(2);
  await main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true }).first().fill('10.005');
  await expect(main.getByText('20.02 บาท', { exact: true })).toBeVisible();
  await main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true }).first().fill('12,500.00');
  await main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true }).nth(1).fill('0');
  await expect(main.getByText('12,500.00 บาท', { exact: true })).toBeVisible();
  await expect(main).not.toContainText('฿');
  await main.getByRole('button', { name: 'ลบรายการ', exact: true }).nth(1).click();
  await expect(main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true })).toHaveCount(1);
  await main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true }).fill(claim.amount);
  // Account management must leave this form, including its picked receipt, mounted in the original tab.
  const [accountPage] = await Promise.all([
    page.waitForEvent('popup'),
    main.getByRole('link', { name: 'จัดการบัญชีรับเงินคืนของฉัน', exact: true }).click(),
  ]);
  await expect(accountPage.getByRole('heading', { level: 1, name: 'บัญชีรับเงินคืนของฉัน', exact: true })).toBeVisible(FIRST_SIGHT);
  await accountPage.getByRole('button', { name: /^(แก้ไขบัญชี|ตั้งบัญชีรับเงินคืน)$/ }).click();
  for (const width of [390, 1280, 1556]) {
    await accountPage.setViewportSize({ width, height: 1000 });
    await expect(accountPage.getByRole('button', { name: 'บันทึกบัญชีรับเงินคืน', exact: true })).toBeVisible();
  }
  await accountPage.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await accountPage.close();
  await expect(main.getByRole('textbox', { name: 'เหตุผล', exact: true })).toHaveValue(claim.reason);
  await expect(main.getByRole('textbox', { name: 'จำนวนเงิน', exact: true })).toHaveValue(claim.amount);
  await expect(main.getByText(receipt.name).first()).toBeVisible();
  await chooseThemedOption(page, main.getByRole('combobox', { name: 'หมวด', exact: true }), claim.category);
  await expect(main.getByText('เลือกให้จากรายละเอียด เปลี่ยนได้', { exact: true })).toHaveCount(0);

  const payout = main.getByRole('radiogroup', { name: 'รับเงินคืนทาง' });
  await expect(payout.getByRole('radio', { name: /claim-payout|DEFAULT|SPECIFIED|CASH/ })).toHaveCount(0);
  if (claim.payout === 'cash') {
    await payout.getByRole('radio', { name: 'รับเป็นเงินสด', exact: true }).check();
  } else {
    // An account for this claim only: the seeded person's standing account is left as it is.
    await payout.getByRole('radio', { name: 'ระบุบัญชีสำหรับใบนี้', exact: true }).check();
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ธนาคาร', exact: true }), 'ธนาคารกสิกรไทย');
    await main.getByRole('textbox', { name: 'ชื่อบัญชี', exact: true }).fill(STAFF);
    await main.getByRole('textbox', { name: 'เลขบัญชี', exact: true }).fill('1234567890');
    await expect(main.getByRole('radio', { name: 'บัญชีของฉันเอง', exact: true })).toBeChecked();
    const keep = main.getByRole('checkbox', { name: 'บันทึกเป็นบัญชีประจำของฉัน', exact: true });
    if (await keep.count()) await keep.uncheck();
  }
  await main.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();

  await expect(toast(page, 'ส่งอนุมัติแล้ว')).toBeVisible(AFTER_PRESS);
  const heading = main.getByRole('heading', { level: 1, name: /^ใบเบิก RB-\d{6}-\d{5}$/ });
  await expect(heading).toBeVisible(FIRST_SIGHT);
  const number = (await heading.innerText()).match(/RB-\d{6}-\d{5}/)![0];
  await expect(stateBadge(main)).toHaveText('รออนุมัติ');
  const step = main.getByRole('region', { name: 'อนุมัติ' });
  await expect(step.getByText('ขั้นตอน 2 จาก 4', { exact: true })).toBeVisible();
  await expect(step.getByText(new RegExp(`^รอ .*${MANAGER}.* อนุมัติ$`))).toBeVisible();
  await expect(main).toContainText(inOrder('ผู้เบิก', STAFF, 'เหตุผล', claim.reason, 'ยอดรวม', claim.printed));
  await expect(main.getByRole('button', { name: 'เซ็นใบเบิก', exact: true })).toHaveCount(0);
  await expect(main.getByLabel('แนบใบที่เซ็นแล้ว', { exact: true })).toHaveCount(0);
  return { number, id: idFromUrl(page) };
}

test('@journey a declined claim is cancelled by its owner from its own page; a second claim is approved with the account check, paid by finance and seen as paid', async ({ pageAs, api, companyId }, info) => {
  test.setTimeout(300_000);
  const today = thaiDate();
  const claimText = (reason: string, number: string, printed: string, status: string) => info.project.use.isMobile
    ? inOrder(reason, printed, `${number} · ${today} · ${STAFF}`, status)
    : inOrder(reason, number, STAFF, today, printed.replace(' บาท', ''), status);
  const first = { reason: unique('ค่าแท็กซี่ไปส่งของ'), amount: '180', printed: '180.00 บาท', category: 'เดินทาง', payout: 'cash' as const };
  const second = { reason: unique('ค่าถุงใส่ของ'), amount: '95', printed: '95.00 บาท', category: 'วัสดุอุปกรณ์', payout: 'account' as const };

  await test.step('owner: create stays in the same header on all claim work tabs', async () => {
    const owner = await pageAs('OWNER');
    const main = owner.locator('main');
    await owner.goto(`/companies/${companyId}/reimbursements`, FIRST_SIGHT);
    await expect(claimsHeading(owner)).toBeVisible(FIRST_SIGHT);
    const nav = main.getByRole('navigation', { name: 'งานเบิกจ่าย' });
    for (let index = 0; index < await nav.getByRole('button').count(); index++) {
      await nav.getByRole('button').nth(index).click();
      await expect(main.locator('.mangmee-page-header').getByRole('link', { name: '+ สร้างใบเบิก', exact: true })).toBeVisible();
    }
    await main.locator('.mangmee-page-header').getByRole('link', { name: '+ สร้างใบเบิก', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'สร้างใบเบิก', exact: true })).toBeVisible(FIRST_SIGHT);
  });

  const staff = await pageAs('STAFF');
  staff.setDefaultTimeout(30_000);
  const staffMain = staff.locator('main');
  await staff.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  const declined = await test.step('staff: การเบิกจ่าย → + สร้างใบเบิก → one line and a picture → ส่งอนุมัติ', async () => {
    await openClaims(staff);
    await expect(staffMain.getByRole('navigation', { name: 'งานเบิกจ่าย' }).getByText('บัญชีรับเงินคืนของฉัน')).toHaveCount(0);
    await staffMain.getByText('เพิ่มเติม', { exact: true }).click();
    await expect(staffMain.getByRole('link', { name: 'บัญชีรับเงินคืนของฉัน', exact: true })).toBeVisible();
    await expect(staffMain.getByRole('button', { name: 'ตั้งค่านโยบาย', exact: true })).toHaveCount(0);
    await staffMain.getByText('เพิ่มเติม', { exact: true }).click();
    await staffMain.getByRole('link', { name: '+ สร้างใบเบิก', exact: true }).click();
    const claim = await fileClaim(staff, first);
    await expect(staffMain.getByText('รับเป็นเงินสด', { exact: true })).toBeVisible();
    return claim;
  });

  const manager = await pageAs('MANAGER');
  manager.setDefaultTimeout(30_000);
  const managerMain = manager.locator('main');
  await manager.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  await test.step('manager: opens the claim from her waiting list and declines it with a reason', async () => {
    await openClaims(manager);
    await expect(managerMain.getByText(/^ยอดรวม [\d,]+\.\d{2} บาท$/)).toBeVisible(AFTER_PRESS);
    await expect(managerMain.getByText(/^รอคุณอนุมัติ \d+ ใบ/)).toHaveCount(0);
    const row = managerMain.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: declined.number });
    await expect(row).toContainText(claimText(first.reason, declined.number, first.printed, 'รออนุมัติ'));
    await expect(row.getByRole('link')).toHaveCount(0);
    await row.focus();
    await row.press('Enter');
    await expect(managerMain.getByRole('heading', { level: 1, name: `ใบเบิก ${declined.number}`, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(managerMain.getByText('รอคุณอนุมัติ', { exact: true })).toBeVisible();
    const step = managerMain.getByRole('region', { name: 'อนุมัติ' });
    await expect(step.getByText('ตรวจรายการและใบเสร็จก่อนอนุมัติ', { exact: true })).toBeVisible();
    await expect(step.getByRole('button', { name: 'อนุมัติ', exact: true })).toBeEnabled();
    await step.getByRole('button', { name: 'ส่งกลับให้แก้', exact: true }).click();

    const dialog = manager.getByRole('dialog', { name: `ส่งกลับให้แก้ ${declined.number}` });
    const reason = dialog.getByRole('textbox', { name: 'เหตุผล (ผู้เบิกจะเห็น)', exact: true });
    const decline = dialog.getByRole('button', { name: 'ส่งกลับให้แก้', exact: true });
    // Off while the reason the claimant will read is empty; the field that is missing is named.
    await expect(reason).toHaveValue('');
    await expect(decline).toBeDisabled();
    await reason.fill('ไม่ใช่งานของร้าน');
    await decline.click();
    await expect(toast(manager, 'ส่งกลับให้แก้แล้ว')).toBeVisible(AFTER_PRESS);
    await expect(stateBadge(managerMain)).toHaveText('ถูกส่งกลับให้แก้');
    await expect(step.getByText(`${MANAGER} ส่งกลับให้แก้: ไม่ใช่งานของร้าน`, { exact: true })).toBeVisible();
    await expect(managerMain).not.toContainText('ปฏิเสธ');
  });

  await test.step('staff: finds it under ต้องแก้ไข with the badge ส่งกลับให้แก้', async () => {
    await openClaims(staff);
    const group = staffMain.getByRole('combobox', { name: 'สถานะ', exact: true });
    await expect(group).toBeVisible(AFTER_PRESS);
    await group.click();
    await staff.getByRole('option', { name: /^ต้องแก้ไข \([1-9]\d*\)$/ }).click();
    await expect(group).toHaveText(/^ต้องแก้ไข \([1-9]\d*\)$/);
    const row = staffMain.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: declined.number });
    await expect(row).toContainText(claimText(first.reason, declined.number, first.printed, 'ส่งกลับให้แก้'));
    await expect(row.locator('.mangmee-badge')).toHaveText('ส่งกลับให้แก้');
    await expect(row).not.toContainText('ส่งกลับให้แก้: ไม่ใช่งานของร้าน');
    await expect(staffMain).not.toContainText('ปฏิเสธ');
    await expect(row.getByRole('link')).toHaveCount(0);
    await row.focus();
    await row.press('Enter');
    await expect(staffMain.getByRole('heading', { level: 1, name: `ใบเบิก ${declined.number}`, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(staffMain.getByText('รอคุณแก้ไขแล้วส่งอนุมัติอีกครั้ง', { exact: true })).toBeVisible();
    await expect(stateBadge(staffMain)).toHaveText('ถูกส่งกลับให้แก้');
    const step = staffMain.getByRole('region', { name: 'อนุมัติ' });
    await expect(step.getByText(`${MANAGER} ส่งกลับให้แก้: ไม่ใช่งานของร้าน`, { exact: true })).toBeVisible();
    await expect(step.getByRole('button', { name: 'แก้ไขใบเบิก', exact: true })).toBeEnabled();
    await expect(staffMain).not.toContainText('ปฏิเสธ');
  });

  await test.step('staff: cancels it directly from its page; back lands in the same group', async () => {
    await staffMain.getByRole('region', { name: 'อนุมัติ' }).getByRole('button', { name: 'ยกเลิกใบเบิกนี้', exact: true }).click();
    const dialog = staff.getByRole('dialog', { name: `ยกเลิกใบเบิก ${declined.number} ${first.printed}` });
    await expect(dialog.getByText('ยกเลิกแล้วนำกลับมาใช้ไม่ได้', { exact: true })).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'ยกเลิกใบเบิก', exact: true });
    // Off until a reason is typed, and the dialog says how long it must be.
    await expect(cancel).toBeDisabled();
    await expect(dialog.getByText(/อย่างน้อย 3 ตัวอักษร/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'ไม่ยกเลิก', exact: true })).toBeEnabled();
    await dialog.getByRole('textbox', { name: 'เหตุผล', exact: true }).fill('เบิกผิดรายการ');
    await cancel.click();
    await expect(toast(staff, 'ยกเลิกใบเบิกแล้ว')).toBeVisible(AFTER_PRESS);
    await expect(stateBadge(staffMain)).toHaveText('ยกเลิกแล้ว');
    await expect(staffMain.getByText('ยกเลิกใบเบิกแล้ว: เบิกผิดรายการ', { exact: true })).toBeVisible();
    await expect(staffMain.getByRole('button', { name: 'ยกเลิกใบเบิกนี้', exact: true })).toHaveCount(0);

    await staffMain.getByRole('link', { name: 'กลับไปการเบิกจ่าย', exact: true }).click();
    await expect(claimsHeading(staff)).toBeVisible(FIRST_SIGHT);
    await expect(staff).toHaveURL(/[?&]filter=correction(&|$)/);
    await expect(staffMain.getByRole('combobox', { name: 'สถานะ', exact: true })).toHaveText(/^ต้องแก้ไข \(\d+\)$/);
    await expect(staffMain.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: declined.number })).toHaveCount(0);
    await staffMain.getByRole('combobox', { name: 'สถานะ', exact: true }).click();
    await expect(staff.getByRole('option', { name: /^ยกเลิก \([1-9]\d*\)$/ })).toBeVisible();
    await staff.keyboard.press('Escape');
  });

  const paid = await test.step('staff: a second claim, to be paid into a bank account', async () => {
    await staffMain.getByRole('link', { name: '+ สร้างใบเบิก', exact: true }).click();
    const claim = await fileClaim(staff, second);
    const payout = cardWith(staff, 'การรับเงินคืน');
    await expect(payout).toContainText(inOrder('โอนเข้าบัญชี', 'ผู้เบิก', STAFF, 'ชื่อบัญชี', STAFF, 'บัญชีรับเงินคืน', 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 7890'));
    await expect(payout).toContainText('ยังไม่มีผู้ตรวจบัญชีนี้');
    return claim;
  });

  await test.step('manager: ตรวจบัญชีและอนุมัติ, the page asks for the account check before it approves', async () => {
    await openClaims(manager);
    const row = managerMain.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: paid.number });
    await expect(row).toContainText(claimText(second.reason, paid.number, second.printed, 'รออนุมัติ'), AFTER_PRESS);
    await row.getByRole('button', { name: 'ตรวจบัญชีและอนุมัติ', exact: true }).click();
    await expect(managerMain.getByRole('heading', { level: 1, name: `ใบเบิก ${paid.number}`, exact: true })).toBeVisible(FIRST_SIGHT);
    const step = managerMain.getByRole('region', { name: 'อนุมัติ' });
    const approve = step.getByRole('button', { name: 'อนุมัติ', exact: true });
    const check = step.getByRole('checkbox', { name: /^ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก/ });
    await expect(check).not.toBeChecked();
    // Pressed without the tick: nothing is approved and the page says what to do.
    await approve.click();
    await expect(step.getByRole('alert')).toHaveText('ติ๊กยืนยันว่าตรวจบัญชีรับเงินแล้วก่อนอนุมัติ');
    await expect(stateBadge(managerMain)).toHaveText('รออนุมัติ');
    await check.check();
    await approve.click();
    await expect(toast(manager, 'อนุมัติใบเบิกแล้ว')).toBeVisible(AFTER_PRESS);
    await expect(stateBadge(managerMain)).toHaveText('พร้อมจ่าย');
    await expect(managerMain.getByText('ขั้นตอน 3 จาก 4', { exact: true })).toBeVisible();
  });

  const finance = await pageAs('FINANCE');
  finance.setDefaultTimeout(30_000);
  const financeMain = finance.locator('main');
  await finance.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  await test.step('finance: pays it from her waiting list with a slip', async () => {
    await openClaims(finance);
    await expect(financeMain.getByText(/^ยอดรวม [\d,]+\.\d{2} บาท$/)).toBeVisible(AFTER_PRESS);
    await expect(financeMain.getByText(/^รอจ่าย \d+ ใบ/)).toHaveCount(0);
    const row = financeMain.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: paid.number });
    await expect(row).toContainText(claimText(second.reason, paid.number, second.printed, 'รอจ่าย'));
    await expect(row).toHaveAccessibleName(`เปิดใบเบิก ${second.reason} ${paid.number}`);
    await expect(financeMain.getByText('ใบเบิกในแท็บนี้', { exact: true })).toBeVisible();
    await row.getByRole('button', { name: 'จ่ายเงิน', exact: true }).click();

    // The phone opens this same form on the claim's payment step; the table opens a dialog.
    const dialog = info.project.use.isMobile
      ? financeMain.getByRole('region', { name: 'จ่ายเงินคืน', exact: true })
      : finance.getByRole('dialog', { name: `บันทึกจ่าย ${paid.number}` });
    await expect(dialog).toContainText(inOrder('โอนเข้าบัญชี', 'ผู้เบิก', STAFF, 'ชื่อบัญชี', STAFF, 'บัญชีรับเงินคืน', 'ธนาคารกสิกรไทย เลขบัญชีลงท้าย 7890'));
    await expect(dialog.getByText(new RegExp(`^ตรวจบัญชีแล้วโดย ${MANAGER} เมื่อ ${today.replace(/\./g, '\\.')}`))).toBeVisible();
    await expect(dialog.getByText(inOrder(`จ่ายให้ ${STAFF}`, second.printed))).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'วิธีจ่าย', exact: true })).toHaveText('โอนเงิน');
    await expect(dialog.getByText(/^โอนเงินต้องแนบหลักฐานการจ่าย/)).toBeVisible();
    const slip = picture('สลิปโอนคืนค่าถุง.png');
    await dialog.getByLabel('หลักฐานการจ่าย', { exact: true }).setInputFiles(slip);
    await expect(dialog.getByText(slip.name).first()).toBeVisible(AFTER_PRESS);
    await dialog.getByRole('checkbox', { name: /^โอนเข้าบัญชีนี้แล้ว และชื่อผู้รับที่ธนาคารแสดงตรงกับใบเบิก/ }).check();
    // Hold the actual payment request long enough to prove cancel and Escape cannot close its form.
    let releasePayment: () => void = () => undefined;
    const paymentHeld = new Promise<void>(resolve => { releasePayment = resolve; });
    const paymentUrl = `**/api/v1/companies/${companyId}/reimbursements/${paid.id}/payments`;
    await finance.route(paymentUrl, async route => { await paymentHeld; await route.continue(); });
    try {
      await dialog.getByRole('button', { name: `บันทึกจ่าย ${second.printed}`, exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'ยกเลิก', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'ยกเลิก', exact: true })).toHaveAttribute('aria-busy', 'true');
      await finance.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
    } finally { releasePayment(); }
    await expect(toast(finance, `บันทึกจ่าย ${paid.number} ${second.printed} แล้ว`)).toBeVisible(AFTER_PRESS);
    await finance.unroute(paymentUrl);
    if (info.project.use.isMobile) await financeMain.getByRole('link', { name: 'กลับไปการเบิกจ่าย', exact: true }).click();
    await expect(financeMain.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: paid.number })).toHaveCount(0, AFTER_PRESS);

    await financeMain.getByRole('button', { name: /^ใบเบิกทั้งหมด\s*\d+$/ }).click();
    await expect(financeMain.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: paid.number })).toContainText(claimText(second.reason, paid.number, second.printed, 'รอเซ็นใบเบิก'), AFTER_PRESS);
  });

  await test.step('staff: sees it under จ่ายแล้ว with the payment on its page', async () => {
    await openClaims(staff);
    const group = staffMain.getByRole('combobox', { name: 'สถานะ', exact: true });
    await expect(group).toBeVisible(AFTER_PRESS);
    await group.click();
    await staff.getByRole('option', { name: /^จ่ายแล้ว \([1-9]\d*\)$/ }).click();
    const row = staffMain.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: paid.number });
    await expect(row).toContainText(claimText(second.reason, paid.number, second.printed, 'รอเซ็นใบเบิก'));
    await expect(row.getByRole('link')).toHaveCount(0);
    await row.click();
    await expect(staffMain.getByRole('heading', { level: 1, name: `ใบเบิก ${paid.number}`, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(stateBadge(staffMain)).toHaveText('จ่ายแล้ว');
    await expect(staffMain.getByText('ยังไม่ได้เซ็นใบเบิก', { exact: true })).toBeVisible();
    await expect(staffMain.getByText('ขั้นตอน 4 จาก 4', { exact: true })).toBeVisible();
    const payments = cardWith(staff, 'การจ่ายเงิน');
    await expect(payments).toContainText(/RBPAY-\d{6}-\d{5}/);
    await expect(staffMain).not.toContainText('฿');
    // Nothing signed or attached yet: the step card holds the signing, so no record card repeats it.
    await expect(staffMain.getByRole('heading', { name: 'ลายเซ็นและใบเบิกที่เซ็นแล้ว', exact: true })).toHaveCount(0);
    await expect(staffMain.getByRole('heading', { name: 'ลายเซ็นในใบเบิก', exact: true })).toHaveCount(0);
    await expect(staffMain.getByRole('heading', { name: /^ใบเบิกที่เซ็นแล้ว/ })).toHaveCount(0);
    await expect(payments).toContainText(inOrder(second.printed, 'บันทึกแล้ว', 'วิธีจ่าย', 'โอนเงิน', 'วันที่จ่าย', today));
    await expect(payments).toContainText(inOrder('จ่ายโดย', QA_ACCOUNTS.FINANCE.displayName, 'หลักฐาน', 'มีหลักฐานการจ่ายแนบ 1 ไฟล์'));
    await expect(staffMain).toContainText(`ตรวจบัญชีแล้วโดย ${MANAGER}`);
    const work = staffMain.locator('section[aria-labelledby="journey-step-title"]');
    await expect(work.getByRole('heading', { name: 'เซ็นในระบบ', exact: true })).toBeVisible();
    await expect(work.getByRole('heading', { name: 'เซ็นบนกระดาษ', exact: true })).toBeVisible();
    await expect(work.getByText('เลือกวิธีใดวิธีหนึ่ง', { exact: true })).toBeVisible();
    await expect(work.getByRole('button', { name: 'เซ็นใบเบิก', exact: true })).toBeVisible();
    await expect(work.getByLabel('แนบใบที่เซ็นแล้ว', { exact: true })).toHaveCount(1);
    await expect(staffMain.locator('input[type="file"]')).toHaveCount(1);
    await expect(payments.locator('input[type="file"]')).toHaveCount(0);
    for (const width of [390, 1280, 1556]) {
      await staff.setViewportSize({ width, height: 900 });
      // A phone opens the page at its own width: the app shell picks its menu on load, so each width is a fresh load.
      await staff.reload();
      await expect(work.getByRole('heading', { name: 'เซ็นในระบบ', exact: true })).toBeVisible(FIRST_SIGHT);
      const system = await work.getByRole('heading', { name: 'เซ็นในระบบ', exact: true }).boundingBox();
      const paper = await work.getByRole('heading', { name: 'เซ็นบนกระดาษ', exact: true }).boundingBox();
      if (width === 390) expect(paper!.y).toBeGreaterThan(system!.y);
      else expect(Math.abs(paper!.y - system!.y)).toBeLessThan(2);
      expect(await staff.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await staff.screenshot({ path: info.outputPath(`claim-step-document-${width}.png`), fullPage: true });
    }
    await work.getByLabel('แนบใบที่เซ็นแล้ว', { exact: true }).setInputFiles(picture('ใบเบิกที่เซ็นแล้ว.png'));
    const copyDialog = staff.getByRole('dialog', { name: 'แนบใบเบิกที่เซ็นแล้ว', exact: true });
    await expect(copyDialog).toBeVisible();
    await expect(copyDialog.getByRole('checkbox', { name: /^สำเนานี้มีลายเซ็นผู้เบิกและผู้อนุมัติครบ/ })).toBeVisible();
    await copyDialog.getByRole('button', { name: 'ปิด', exact: true }).last().click();
    await expect(copyDialog).toHaveCount(0);
  });

  await test.step('finance: payment cancellation is in เพิ่มเติม and keeps the existing confirmation', async () => {
    await finance.goto(`/companies/${companyId}/reimbursements/${paid.id}`, FIRST_SIGHT);
    await expect(financeMain.getByRole('heading', { level: 1, name: `ใบเบิก ${paid.number}`, exact: true })).toBeVisible();
    const payment = financeMain.getByTestId('reimbursement-payment-row').first();
    const cancel = payment.getByRole('button', { name: 'ยกเลิกรายการจ่ายนี้', exact: true });
    await expect(cancel).toBeHidden();
    await expect(payment.getByRole('button', { name: 'แนบหลักฐานการจ่ายเพิ่ม', exact: true })).toBeHidden();
    await payment.locator('summary').filter({ hasText: /^เพิ่มเติม$/ }).click();
    await payment.getByRole('button', { name: 'แนบหลักฐานการจ่ายเพิ่ม', exact: true }).click();
    const upload = finance.getByRole('dialog', { name: /^แนบหลักฐานการจ่ายเพิ่ม/ });
    await expect(upload.getByLabel('แนบหลักฐานการจ่ายเพิ่ม', { exact: true })).toHaveCount(1);
    await upload.getByRole('button', { name: 'ปิด', exact: true }).last().click();
    await payment.locator('summary').filter({ hasText: /^เพิ่มเติม$/ }).click();
    await cancel.click();
    const dialog = finance.getByRole('dialog', { name: 'ยกเลิกรายการจ่ายนี้ 95.00 บาท', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText('฿');
    await dialog.getByRole('button', { name: 'ไม่ยกเลิก', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });

  // The truth on the server.
  const cancelledClaim = await json<Claim>(await api.get(`companies/${companyId}/reimbursements/${declined.id}`));
  expect(cancelledClaim.requestNo).toBe(declined.number);
  expect(cancelledClaim.status).toBe('CANCELLED');
  expect(cancelledClaim.payments).toEqual([]);
  const paidClaim = await json<Claim>(await api.get(`companies/${companyId}/reimbursements/${paid.id}`));
  expect(paidClaim.requestNo).toBe(paid.number);
  expect(paidClaim.status).toBe('PAID');
  expect(paidClaim.paymentStatus).toBe('PAID');
  expect(Number(paidClaim.amount)).toBe(95);
  expect(paidClaim.payments.map((payment) => [payment.status, payment.paymentMethod, payment.slipCount])).toEqual([['RECORDED', 'BANK_TRANSFER', 1]]);
});
