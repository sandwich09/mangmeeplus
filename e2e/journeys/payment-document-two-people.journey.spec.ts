/**
 * Journey: a payment document made by one person and approved by another.
 *
 * Finance makes a confirmed unpaid expense, puts it on a ใบเตรียมจ่าย, sends it to the manager and
 * reminds her; the manager finds ONE row for it in her notification centre, opens it from there and
 * approves; finance records the payment and the same number becomes the ใบสำคัญจ่าย.
 *
 * Finance opens `ส่งอนุมัติ`, which defaults to herself; this journey chooses the manager instead.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { QA_ACCOUNTS } from '../harness/roles';
import { AFTER_PRESS, FIRST_SIGHT, idFromUrl, inOrder, picture, pressForDownload, pressMenu, recordExpenseByHand, thaiDate, whole } from './journey-kit';

type Voucher = {
  header: { status: string; documentNumber: string; totalAmount: string; reminderCount: number; paidDate: string | null };
  preparerName: string; requestedApproverName: string; approvedByName: string; paidByName: string;
  lines: unknown[];
};
type ExpenseDetail = { status: string; paymentStatus: string };

const FINANCE = QA_ACCOUNTS.FINANCE.displayName;
const MANAGER = QA_ACCOUNTS.MANAGER.displayName;
const AMOUNT = '2,500.00 บาท';
const evidence = picture('หลักฐาน.png');

const toast = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text }).first();

/** Opens the bell's panel (when it is closed) and shows one of its three groups. */
async function showNotices(page: Page, group: 'ยังรออยู่' | 'ยังไม่ได้อ่าน' | 'ทั้งหมด') {
  const header = page.locator('header');
  const bell = header.getByRole('button', { name: /^การแจ้งเตือน/ });
  if ((await bell.getAttribute('aria-expanded')) !== 'true') await bell.click();
  const tab = header.getByRole('group', { name: 'สถานะการแจ้งเตือน' }).getByRole('button', { name: group, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-pressed', 'true');
  return header;
}

test('@journey a payment document is prepared by finance, approved by the manager from one notice, paid by finance, and becomes the ใบสำคัญจ่าย under the same number', async ({ pageAs, api, companyId }) => {
  test.setTimeout(300_000);
  const today = thaiDate();
  const seller = unique('ร้านวัสดุทวีทรัพย์');
  const item = unique('ค่าปูนและทราย');

  const finance = await pageAs('FINANCE');
  finance.setDefaultTimeout(30_000);
  const main = finance.locator('main');
  const next = main.getByRole('button', { name: 'ถัดไป', exact: true });
  await finance.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  const expense = await test.step('finance: a confirmed, unpaid expense made through the screens', () => recordExpenseByHand(finance, {
    branch: 'Head Office (สำนักงานใหญ่)', item, price: '2500', total: AMOUNT, seller, toPay: AMOUNT,
  }));

  await test.step('finance: ใบเตรียมจ่าย/ใบสำคัญจ่าย → สร้างใบเตรียมจ่าย → payee → items → details', async () => {
    await pressMenu(finance, 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(main.getByText('รวมรายจ่ายของผู้รับเงินรายเดียว ส่งอนุมัติ แล้วบันทึกจ่าย', { exact: true })).toBeVisible();
    await expect(main.getByRole('group', { name: 'สถานะใบเตรียมจ่าย' }).getByRole('button')).toHaveText([/^ทั้งหมด/, /^ร่าง/, /^รออนุมัติ/, /^รอจ่าย/, /^จ่ายแล้ว/, /^ยกเลิกแล้ว/]);
    const create = main.getByRole('link', { name: 'สร้างใบเตรียมจ่าย', exact: true });
    await expect(create).toHaveCount(1);
    await create.click();

    await expect(main.getByText('ขั้น 1 จาก 3: เลือกผู้รับเงิน', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('heading', { name: 'จ่ายให้ใคร', exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'โหลดเพิ่ม', exact: true })).toHaveCount(0);
    await expect(main.getByTestId('disbursement-draft-bottom-bar')).toHaveCount(0);
    await expect(main.getByTestId('disbursement-payee-card-list')).toBeVisible();
    const payeePages = main.getByText(/^หน้า \d+ จาก \d+$/);
    if (await payeePages.count()) {
      await expect(payeePages).toHaveText(/^หน้า 1 จาก \d+$/);
      await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      await expect(payeePages).toHaveText(/^หน้า 2 จาก \d+$/);
      await main.getByRole('button', { name: 'ก่อนหน้า', exact: true }).click();
      await expect(payeePages).toHaveText(/^หน้า 1 จาก \d+$/);
    }
    // Picking the payee advances directly; the old Next control and instruction are gone.
    await expect(main.getByTestId('disbursement-draft-bottom-bar').getByRole('button', { name: 'ถัดไป', exact: true })).toHaveCount(0);
    await expect(main.getByText('เลือกผู้รับเงินก่อน', { exact: true })).toHaveCount(0);
    await main.getByRole('searchbox', { name: 'ค้นชื่อผู้รับเงินหรือเลขผู้เสียภาษี', exact: true }).fill(seller);
    const payee = main.getByRole('button', { name: new RegExp(`^${seller}`) });
    await expect(payee).toContainText(inOrder(seller, 'ค้างจ่าย 1 รายการ · 2,500.00 บาท'), AFTER_PRESS);
    await payee.click();

    await expect(main.getByText('ขั้น 2 จาก 3: เลือกรายการ', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('heading', { name: `เลือกรายการที่จะจ่ายให้ ${seller}`, exact: true })).toBeVisible();
    await expect(main.getByRole('checkbox', { name: new RegExp(`^${item}.*${expense.expenseNumber}`) })).toBeChecked();
    await expect(main.getByText(whole(`เลือก 1 รายการ · รวม 2,500.00 บาท`))).toBeVisible();
    await next.click();

    await expect(main.getByText('ขั้น 3 จาก 3: รายละเอียดการจ่าย', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('textbox', { name: 'ผู้รับเงิน (ชื่อบนใบ)', exact: true })).toHaveValue(seller);
    await expect(main.getByRole('button', { name: 'กลับ', exact: true })).toBeEnabled();
    await expect(main.getByRole('button', { name: 'ส่งอนุมัติ', exact: true })).toBeEnabled();
    await chooseThemedOption(finance, main.getByRole('combobox', { name: 'ธนาคาร', exact: true }), 'ธนาคารกสิกรไทย');
    await main.getByRole('textbox', { name: 'ชื่อบัญชี', exact: true }).fill(seller);
    await main.getByRole('textbox', { name: 'เลขบัญชี', exact: true }).fill('1234567890');
    await main.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(toast(finance, 'บันทึกร่างแล้ว')).toBeVisible(AFTER_PRESS);
    await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(main.getByText('ใบเตรียมจ่าย ยังไม่มีเลขที่', { exact: true })).toBeVisible();
    await expect(main).toContainText(inOrder('ยอดที่จะจ่าย', '2,500.00', 'บาท'));
    await expect(main.getByText(new RegExp(`^จัดทำ(?:และส่ง)?โดย ${FINANCE} ·`))).toHaveCount(0);
    await expect(main.getByText('ยังไม่ได้ส่ง', { exact: true })).toHaveCount(0);
  });

  const voucherId = idFromUrl(finance);
  let number = '';
  await test.step('finance: reveal and hide the saved account while editing a draft', async () => {
    await main.getByRole('link', { name: 'แก้ไข', exact: true }).click();
    await next.click();
    const account = main.getByRole('textbox', { name: 'เลขบัญชี', exact: true });
    await expect(account).toHaveValue('xxx-7890');
    await main.getByRole('button', { name: 'ดูเลขเต็ม', exact: true }).click();
    await expect(account).toHaveValue('1234567890', AFTER_PRESS);
    await main.getByRole('button', { name: 'ซ่อนเลข', exact: true }).click();
    await expect(account).toHaveValue('xxx-7890');
    await main.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(AFTER_PRESS);
  });
  await test.step('finance: ส่งอนุมัติ → the manager → ส่งให้ผู้ที่เลือก', async () => {
    // She may approve herself; the screen offers the other person too and that is the path taken.
    await expect(main.getByRole('button', { name: 'ส่งอนุมัติ', exact: true })).toBeEnabled();
    await expect(main.getByRole('button', { name: 'ส่งให้คนอื่นอนุมัติ', exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();
    const dialog = finance.getByRole('dialog', { name: 'ให้ใครอนุมัติ' });
    const send = dialog.getByRole('button', { name: 'ส่งอนุมัติ', exact: true });
    await expect(dialog.getByRole('radio', { name: 'ฉันอนุมัติเลย', exact: true })).toBeChecked();
    await expect(send).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'ปิด', exact: true })).toHaveCount(1);
    await dialog.getByRole('button', { name: 'ยังไม่ส่ง', exact: true }).click();
    await expect(dialog).toBeHidden();
    await main.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();
    await expect(dialog.getByRole('radio', { name: 'ฉันอนุมัติเลย', exact: true })).toBeChecked();
    await expect(dialog.getByRole('button', { name: 'อนุมัติเลย', exact: true })).toHaveCount(0);
    await dialog.getByRole('radio', { name: MANAGER, exact: true }).check();
    await send.click();
    const sent = toast(finance, /ส่งอนุมัติแล้ว เลขที่ PV-\d{6}-\d{5}/);
    await expect(sent).toContainText(`ระบบแจ้ง ${MANAGER} แล้ว`, AFTER_PRESS);
    number = (await sent.innerText()).match(/PV-\d{6}-\d{5}/)![0];
    await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible();
    await expect(main.getByText(`ใบเตรียมจ่าย ${number}`, { exact: true })).toBeVisible();
    await expect(main.getByText('รออนุมัติ', { exact: true }).first()).toBeVisible();
    await expect(main.getByText(`รอ ${MANAGER} อนุมัติ`, { exact: true })).toBeVisible();
    await expect(main.getByText(new RegExp(`^จัดทำและส่งโดย ${FINANCE} · ${today.replace(/\./g, '\\.')}`))).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'อนุมัติเอง', exact: true })).toBeEnabled();
  });

  await test.step('finance: the payee step explains reserved bills and opens the unpaid expense list', async () => {
    await pressMenu(finance, 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    await main.getByRole('link', { name: 'สร้างใบเตรียมจ่าย', exact: true }).click();
    const excluded = main.getByText(/^อีก \d+ รายการยังเลือกไม่ได้/);
    await expect(excluded).toContainText(/อยู่ในใบเตรียมจ่าย [1-9]\d*/, AFTER_PRESS);
    await excluded.getByRole('link', { name: 'ดูที่หน้ารายจ่าย', exact: true }).click();
    await expect(finance).toHaveURL(new RegExp(`/companies/${companyId}/expenses\\?view=unpaid$`));
    await pressMenu(finance, 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    await main.getByRole('link', { name: `เปิด ${seller} · ${number}`, exact: true }).click();
  });
  await test.step('finance: ส่งเตือนอีกครั้ง', async () => {
    await main.getByRole('button', { name: 'ส่งเตือนอีกครั้ง', exact: true }).click();
    const dialog = finance.getByRole('dialog', { name: 'ส่งเตือนให้ใคร' });
    await expect(dialog.getByRole('radio', { name: MANAGER, exact: true })).toBeChecked();
    await dialog.getByRole('button', { name: 'ส่งเตือน', exact: true }).click();
    await expect(toast(finance, `ส่งเตือน ${MANAGER} แล้ว`)).toBeVisible(AFTER_PRESS);
    await expect(main.getByText(new RegExp(`เตือนล่าสุด: ${MANAGER} เมื่อ ${today.replace(/\./g, '\\.')}`))).toBeVisible();
  });

  const manager = await pageAs('MANAGER');
  manager.setDefaultTimeout(30_000);
  const managerMain = manager.locator('main');
  await manager.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  await test.step('manager: the bell shows ONE row for it under ยังรออยู่ → open → approve', async () => {
    await expect(manager.locator('header').getByRole('button', { name: /^การแจ้งเตือน/ })).toBeVisible(FIRST_SIGHT);
    const panel = await showNotices(manager, 'ยังรออยู่');
    const rows = panel.getByRole('link').filter({ hasText: number });
    // Sent once and reminded once: still one piece of work, so one row.
    await expect(rows).toHaveCount(1, AFTER_PRESS);
    await expect(rows).toContainText(inOrder('ต้องดำเนินการ'));
    await expect(rows).toContainText(`เตือนอีกครั้ง: ใบเตรียมจ่ายเลขที่ ${number} รออนุมัติ`);
    await expect(rows).toContainText(`${FINANCE} ขอให้คุณตรวจและอนุมัติใบเตรียมจ่ายนี้ จ่ายให้ ${seller} ยอด 2,500.00 บาท`);
    await rows.click();

    await expect(managerMain.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(managerMain.getByText(`ใบเตรียมจ่าย ${number}`, { exact: true })).toBeVisible();
    await expect(managerMain.getByText('ตรวจรายการ แล้วอนุมัติหรือส่งกลับให้แก้', { exact: true })).toHaveCount(0);
    await expect(managerMain.getByText(new RegExp(`^จัดทำ(?:และส่ง)?โดย ${FINANCE} ·`))).toHaveCount(0);
    await expect(managerMain).toContainText(inOrder('ยอดที่จะจ่าย', '2,500.00', 'บาท'));
    await expect(managerMain.getByRole('link', { name: `เปิดรายจ่าย ${expense.expenseNumber}`, exact: true })).toContainText(expense.expenseNumber);
    await expect(managerMain.getByRole('link', { name: `เปิดรายจ่าย ${expense.expenseNumber}`, exact: true })).toContainText(today);
    await expect(managerMain.getByRole('button', { name: 'ส่งกลับให้แก้', exact: true })).toBeEnabled();
    await managerMain.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    const confirm = manager.getByRole('dialog', { name: `อนุมัติจ่าย ${AMOUNT} ให้ ${seller} ใช่ไหม` });
    await confirm.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await expect(toast(manager, 'อนุมัติแล้ว ระบบแจ้งผู้จัดทำแล้ว')).toBeVisible(AFTER_PRESS);
    await expect(managerMain.getByText('รอจ่าย', { exact: true }).first()).toBeVisible();
    await expect(managerMain.getByText(new RegExp(`อนุมัติโดย ${MANAGER} · ${today.replace(/\./g, '\\.')}`))).toHaveCount(0);
    await expect(managerMain.getByRole('button', { name: 'อนุมัติ', exact: true })).toHaveCount(0);
  });

  await test.step('finance: finds it as รอจ่าย in the list and records the payment', async () => {
    await pressMenu(finance, 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    const wideList = (finance.viewportSize()?.width ?? 1280) >= 1280;
    const dateSort = main.getByRole('button', { name: 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่', exact: true });
    await (wideList ? dateSort : main.getByRole('button', { name: 'เรียง: ใหม่ไปเก่า ↓', exact: true })).click();
    await expect(finance).toHaveURL(/[?&]order=oldest(?:&|$)/);
    const reverseSort = main.getByRole('button', { name: 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า', exact: true });
    await (wideList ? reverseSort : main.getByRole('button', { name: 'เรียง: เก่าไปใหม่ ↑', exact: true })).click();
    await expect(finance).not.toHaveURL(/[?&]order=oldest(?:&|$)/);
    const row = main.getByRole('link', { name: `เปิด ${seller} · ${number}`, exact: true });
    for (const fact of [seller, number, '2,500.00', 'รอจ่าย']) await expect(row).toContainText(fact, AFTER_PRESS);
    await expect(row).not.toContainText('จัดทำโดย');
    await expect(row).not.toContainText(FINANCE);
    await expect(row).not.toContainText('1 รายการ');
    await row.click();
    await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(main.getByText(`ใบเตรียมจ่าย ${number}`, { exact: true })).toBeVisible();
    await expect(main.getByText('จ่ายเงินให้ผู้รับเงิน แล้วกลับมาบันทึกว่าจ่ายแล้ว', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('combobox', { name: 'วิธีจ่าย', exact: true })).toHaveText('โอนเงิน');
    await expect(main.getByRole('combobox', { name: 'วันที่จ่ายจริง', exact: true })).toHaveText(today);
    await main.getByRole('combobox', { name: 'วันที่จ่ายจริง', exact: true }).click();
    await finance.getByRole('button', { name: 'ล้าง', exact: true }).click();
    await expect(main.getByText('เลือกวันที่จ่ายจริงก่อนบันทึก', { exact: true })).toBeVisible();
    const payButton = main.getByRole('button', { name: 'บันทึกว่าจ่ายแล้ว', exact: true });
    await expect(payButton).toBeEnabled();
    await payButton.click();
    await expect(finance.getByRole('dialog', { name: 'บันทึกว่าจ่ายแล้ว', exact: true })).toHaveCount(0);
    await main.getByRole('combobox', { name: 'วันที่จ่ายจริง', exact: true }).click();
    await finance.getByRole('button', { name: 'วันนี้', exact: true }).click();
    await expect(main.getByText('เลือกวันที่จ่ายจริงก่อนบันทึก', { exact: true })).toHaveCount(0);
    await expect(main.getByText(`ใบนี้ไม่มีบัญชีผู้รับ ถามผู้จัดทำ ${FINANCE} ก่อนโอน`, { exact: true })).toHaveCount(0);
    const bankAccount = main.getByRole('region', { name: 'โอนเข้าบัญชี', exact: true });
    await expect(bankAccount).toContainText(new RegExp(`${seller}.*ธนาคารกสิกรไทย.*ชื่อบัญชี${seller}.*xxx-7890`));
    await expect(bankAccount.getByRole('button', { name: 'ดูเลขบัญชีเต็ม', exact: true })).toBeVisible();
    const evidencePicker = main.getByLabel('แนบหลักฐานการจ่าย (ถ้ามี)', { exact: true });
    await evidencePicker.setInputFiles(evidence);
    const localEvidence = main.getByTestId('disbursement-local-slip');
    await expect(localEvidence.getByRole('img', { name: evidence.name })).toBeVisible(AFTER_PRESS);
    await localEvidence.getByRole('button', { name: 'ดูไฟล์', exact: true }).click();
    const localViewer = finance.getByRole('dialog', { name: evidence.name, exact: true });
    await expect(localViewer).toBeVisible();
    await localViewer.getByRole('button', { name: 'ปิด', exact: true }).click();
    await localEvidence.getByRole('button', { name: 'เอาออก', exact: true }).click();
    await expect(localEvidence).toHaveCount(0);
    await main.getByRole('button', { name: 'บันทึกว่าจ่ายแล้ว', exact: true }).click();
    const dialog = finance.getByRole('dialog', { name: 'บันทึกว่าจ่ายแล้ว' });
    await expect(dialog.getByText(whole(`จ่าย ${AMOUNT} ให้ ${seller}`))).toBeVisible();
    await expect(dialog.getByText('ยังไม่ได้แนบหลักฐาน', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: `ยืนยัน จ่ายแล้ว ${AMOUNT}`, exact: true }).click();

    await expect(toast(finance, `บันทึกจ่ายแล้ว ใบนี้เป็นใบสำคัญจ่ายเลขที่ ${number}`)).toBeVisible(AFTER_PRESS);
    // The same number, now the ใบสำคัญจ่าย.
    await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible();
    await expect(main.getByText(`ใบสำคัญจ่าย ${number}`, { exact: true })).toBeVisible();
    await expect(main.getByText('หลักฐานว่าบันทึกจ่ายแล้ว', { exact: true })).toHaveCount(1);
    await expect(main.getByText('จ่ายแล้ว', { exact: true }).first()).toBeVisible();
    await expect(main.getByText(`จ่ายเมื่อ ${today}`, { exact: true })).toHaveCount(0);
    const paidCard = main.locator('section').filter({ has: finance.getByRole('heading', { name: 'ยอดที่จ่าย', exact: true }) });
    await expect(paidCard).toContainText(inOrder('ยอดที่จ่าย', '2,500.00', 'บาท'));
    await expect(paidCard.getByRole('definition')).toHaveText([today, 'โอนเงิน', /^กสิกรไทย xxx-7890/]); // the account it went to
    await expect(paidCard.getByTestId('disbursement-voucher-slip')).toContainText('หลักฐานการจ่าย · ยังไม่ได้แนบ');
    await expect(paidCard.getByRole('button', { name: 'แนบหลักฐาน', exact: true })).toBeVisible();
    // The paid evidence uses the same viewer, after the existing optional upload has been saved.
    await paidCard.getByLabel('แนบหลักฐานการจ่าย (ถ้ามี)', { exact: true }).setInputFiles(evidence);
    await expect(paidCard.getByTestId('disbursement-voucher-slip')).toContainText(`แนบโดย ${FINANCE}`, AFTER_PRESS);
    await paidCard.getByRole('button', { name: 'ดูไฟล์', exact: true }).click();
    const savedViewer = finance.getByRole('dialog', { name: 'ดูหลักฐาน', exact: true });
    await expect(savedViewer).toBeVisible();
    await savedViewer.getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(main.getByRole('navigation', { name: 'ขั้นตอน', exact: true })).toHaveCount(0);
    for (const name of ['จ่ายให้', 'การจ่าย']) await expect(main.getByRole('heading', { name, exact: true })).toHaveCount(0);
    await expect(paidCard).not.toContainText('—');
    await expect(paidCard).not.toContainText('วิธีที่จะจ่าย');
    await expect(paidCard).not.toContainText('กำหนดจ่าย');
    await main.getByRole('button', { name: 'ดูประวัติ', exact: true }).click();
    const history = finance.getByRole('dialog', { name: 'ประวัติของใบ', exact: true });
    for (const [event, actor] of [['สร้างใบ', FINANCE], ['ส่งอนุมัติ ครั้งที่ 1', FINANCE], ['อนุมัติ', MANAGER], ['บันทึกว่าจ่ายแล้ว', FINANCE]]) {
      const row = history.getByRole('listitem').filter({ has: finance.getByText(event, { exact: true }) });
      await expect(row).toContainText(actor);
      await expect(row).toContainText(new RegExp(`${today.replace(/\./g, '\\.')}.*\\d{2}:\\d{2}`));
    }
    await history.getByRole('button', { name: 'ปิด', exact: true }).last().click();
    const file = await pressForDownload(finance, () => main.getByRole('button', { name: 'ดาวน์โหลดใบสำคัญจ่าย', exact: true }).click());
    expect(file.name).toMatch(/\.pdf$/);
    expect(file.head).toBe('%PDF-');
  });

  await test.step('manager: her notice is finished, nothing is left waiting', async () => {
    const waiting = await showNotices(manager, 'ยังรออยู่');
    await expect(waiting.getByRole('link').filter({ hasText: number })).toHaveCount(0);
    const all = await showNotices(manager, 'ทั้งหมด');
    const rows = all.getByRole('link').filter({ hasText: number });
    await expect(rows).toHaveCount(1, AFTER_PRESS);
    await expect(rows).toContainText('เสร็จแล้ว');
    await expect(rows).not.toContainText('ต้องดำเนินการ');
  });

  // The truth on the server.
  const voucher = await json<Voucher>(await api.get(`companies/${companyId}/disbursement-vouchers/${voucherId}`));
  expect(voucher.header.documentNumber).toBe(number);
  expect(voucher.header.status).toBe('PAID');
  expect(Number(voucher.header.totalAmount)).toBe(2500);
  expect(voucher.header.reminderCount).toBe(1);
  expect([voucher.preparerName, voucher.requestedApproverName, voucher.approvedByName, voucher.paidByName]).toEqual([FINANCE, MANAGER, MANAGER, FINANCE]);
  expect(voucher.lines).toHaveLength(1);
  const paidExpense = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${expense.expenseId}`));
  expect(paidExpense.status).toBe('CONFIRMED');
  expect(paidExpense.paymentStatus).toBe('PAID');
});

test('@journey finance reads who sent a payment document back and why, sends the same number again, and the manager approves', async ({ pageAs, api, companyId }) => {
  test.setTimeout(300_000);
  const finance = await pageAs('FINANCE');
  finance.setDefaultTimeout(30_000);
  const main = finance.locator('main');
  const seller = unique('ร้านอุปกรณ์ใบเตรียมจ่ายส่งกลับ');
  const item = unique('ค่าอุปกรณ์สำนักงาน');
  const reason = unique('ตรวจชื่อผู้รับเงินและเอกสารแนบอีกครั้ง');
  await finance.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
  const expense = await recordExpenseByHand(finance, {
    branch: 'Head Office (สำนักงานใหญ่)', item, seller, price: '2500', total: AMOUNT, toPay: AMOUNT,
  });

  await test.step('finance prepares a draft with the confirmed expense', async () => {
    await pressMenu(finance, 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    const create = main.getByRole('link', { name: 'สร้างใบเตรียมจ่าย', exact: true });
    await expect(create).toHaveCount(1);
    await create.click();
    await expect(main.getByText('ขั้น 1 จาก 3: เลือกผู้รับเงิน', { exact: true })).toHaveCount(0);
    // A slow read of the payee's saved account: a save pressed meanwhile is kept, never "press again".
    const slowAccount = /\/payee-account(\?|$)/;
    await finance.route(slowAccount, async route => { await new Promise(resolve => setTimeout(resolve, 2_000)); await route.continue(); });
    await main.getByRole('searchbox', { name: 'ค้นชื่อผู้รับเงินหรือเลขผู้เสียภาษี', exact: true }).fill(seller);
    await main.getByRole('button', { name: new RegExp(`^${seller}`) }).click();
    await expect(main.getByText('ขั้น 2 จาก 3: เลือกรายการ', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('checkbox', { name: new RegExp(`^${item}.*${expense.expenseNumber}`) })).toBeChecked();
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(main.getByText('ขั้น 3 จาก 3: รายละเอียดการจ่าย', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('textbox', { name: 'ผู้รับเงิน (ชื่อบนใบ)', exact: true })).toHaveValue(seller);
    await main.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(main.getByText('กำลังอ่านบัญชีผู้รับเงิน รอสักครู่แล้วบันทึกอีกครั้ง', { exact: true })).toHaveCount(0);
    await expect(toast(finance, 'บันทึกร่างแล้ว')).toBeVisible(AFTER_PRESS);
    await finance.unroute(slowAccount);
    await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible();
    await expect(main.getByText('ใบเตรียมจ่าย ยังไม่มีเลขที่', { exact: true })).toBeVisible();
  });

  const voucherId = idFromUrl(finance);
  let number = '';
  const sendToManager = async () => {
    await expect(main.getByRole('button', { name: 'ส่งให้คนอื่นอนุมัติ', exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();
    const dialog = finance.getByRole('dialog', { name: 'ให้ใครอนุมัติ', exact: true });
    await dialog.getByRole('radio', { name: MANAGER, exact: true }).check();
    await dialog.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();
    const sent = toast(finance, /ส่งอนุมัติแล้ว เลขที่ PV-\d{6}-\d{5}/);
    await expect(sent).toContainText(`ระบบแจ้ง ${MANAGER} แล้ว`, AFTER_PRESS);
    const sentNumber = (await sent.innerText()).match(/PV-\d{6}-\d{5}/)![0];
    if (number) expect(sentNumber).toBe(number);
    number = sentNumber;
    await expect(main.getByText('รออนุมัติ', { exact: true }).first()).toBeVisible();
  };
  await test.step('finance sends to the manager', sendToManager);

  const manager = await pageAs('MANAGER');
  manager.setDefaultTimeout(30_000);
  const managerMain = manager.locator('main');
  await manager.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
  const openFromList = async (page: Page) => {
    await pressMenu(page, 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    const content = page.locator('main');
    await expect(content.getByRole('heading', { level: 1, name: 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await content.getByRole('searchbox', { name: 'ค้นชื่อผู้รับเงินหรือเลขที่ใบ', exact: true }).fill(number);
    await content.getByRole('link', { name: `เปิด ${seller} · ${number}`, exact: true }).click();
    await expect(content.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(content.getByText(`ใบเตรียมจ่าย ${number}`, { exact: true })).toBeVisible();
  };

  await test.step('manager: ส่งกลับให้แก้ → named dialog, reason, matching button and toast', async () => {
    await openFromList(manager);
    await expect(managerMain.getByText('ตรวจรายการ แล้วอนุมัติหรือส่งกลับให้แก้', { exact: true })).toHaveCount(0);
    await managerMain.getByRole('button', { name: 'ส่งกลับให้แก้', exact: true }).click();
    const dialog = manager.getByRole('dialog', { name: `ส่งกลับให้แก้ใบเตรียมจ่าย ${number}`, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('textbox', { name: 'เหตุผลที่ส่งกลับให้แก้', exact: true }).fill(reason);
    await dialog.getByRole('button', { name: 'ส่งกลับให้แก้', exact: true }).click();
    await expect(toast(manager, 'ส่งกลับให้แก้แล้ว ระบบแจ้งผู้จัดทำแล้ว')).toBeVisible(AFTER_PRESS);
  });

  await test.step('finance reads the actor, date and reason, then sends again', async () => {
    await openFromList(finance);
    // One notice: its mark and who/when in one line (date and time), the reason on a line of its own, and the way out.
    const returned = main.getByRole('status').filter({ hasText: 'ถูกส่งกลับให้แก้โดย' });
    await expect(returned).toHaveText(new RegExp(`^⚠ ถูกส่งกลับให้แก้โดย ${MANAGER} เมื่อ ${thaiDate().replace(/\./g, '\\.')} \\d{1,2}:\\d{2} น\\.`));
    await expect(returned.getByText(`เหตุผล: ${reason}`, { exact: true })).toBeVisible();
    await expect(returned.getByRole('link', { name: 'แก้ไข', exact: true })).toBeVisible();
    await sendToManager();
    await expect(returned).toHaveCount(0);
  });

  await test.step('manager opens the same number again and approves', async () => {
    await openFromList(manager);
    await managerMain.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    const dialog = manager.getByRole('dialog', { name: `อนุมัติจ่าย ${AMOUNT} ให้ ${seller} ใช่ไหม`, exact: true });
    await dialog.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await expect(toast(manager, 'อนุมัติแล้ว ระบบแจ้งผู้จัดทำแล้ว')).toBeVisible(AFTER_PRESS);
    await expect(managerMain.getByText('รอจ่าย', { exact: true }).first()).toBeVisible();
  });

  const voucher = await json<Voucher & {
    revisions: Array<{ decision: string | null; decisionReason: string | null; decidedByName: string | null }>;
  }>(await api.get(`companies/${companyId}/disbursement-vouchers/${voucherId}`));
  expect(voucher.header.documentNumber).toBe(number);
  expect(voucher.header.status).toBe('APPROVED');
  expect(voucher.preparerName).toBe(FINANCE);
  expect(voucher.approvedByName).toBe(MANAGER);
  expect(voucher.revisions).toContainEqual(expect.objectContaining({ decision: 'RETURNED', decisionReason: reason, decidedByName: MANAGER }));
  expect(voucher.revisions).toContainEqual(expect.objectContaining({ decision: 'APPROVED', decidedByName: MANAGER }));
  const unpaid = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${expense.expenseId}`));
  expect(unpaid.status).toBe('CONFIRMED');
  expect(unpaid.paymentStatus).toBe('UNPAID');
});

test('@journey an approver pays directly unless another bill for the same payee makes a voucher useful', async ({ pageAs, companyId }) => {
  test.setTimeout(300_000);
  const page = await pageAs('OWNER');
  const main = page.locator('main');
  const seller = unique('ร้านรวมบิลก่อนจ่าย');
  const linkName = 'รวมกับบิลอื่น หรือให้คนอื่นอนุมัติก่อนจ่าย → ใบเตรียมจ่าย';
  let reads = 0;
  page.on('request', request => { if (request.url().includes('/disbursement-vouchers/payable-expenses')) reads++; });
  await page.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
  const firstRead = page.waitForResponse(response => response.url().includes('/disbursement-vouchers/payable-expenses') && response.ok(), FIRST_SIGHT);
  const first = await recordExpenseByHand(page, { branch: 'Head Office (สำนักงานใหญ่)', item: unique('บิลแรก'), seller, price: '100', total: '100.00 บาท', toPay: '100.00 บาท' });
  await firstRead;
  await expect(main.getByRole('link', { name: linkName, exact: true })).toHaveCount(0);
  await expect(main.getByText('จ่ายแล้วพิมพ์ใบสำคัญจ่ายได้จากประวัติการจ่าย', { exact: true })).toBeVisible();
  await expect(main.getByRole('link', { name: 'เพิ่มเข้าใบเตรียมจ่าย', exact: true })).toHaveCount(0);
  const second = await recordExpenseByHand(page, { branch: 'Head Office (สำนักงานใหญ่)', item: unique('บิลที่สอง'), seller, price: '200', total: '200.00 บาท', toPay: '200.00 บาท' });
  const link = main.getByRole('link', { name: linkName, exact: true });
  await expect(link).toBeVisible(AFTER_PRESS);
  await expect(link).not.toHaveClass(/mangmee-btn/);
  await expect.poll(() => reads).toBe(2);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/disbursement-vouchers/new\\?expenseId=${second.expenseId}`));
  await expect(main.getByRole('heading', { name: `เลือกรายการที่จะจ่ายให้ ${seller}`, exact: true })).toBeVisible(FIRST_SIGHT);
  await expect(main.getByRole('checkbox', { name: new RegExp(second.expenseNumber) })).toBeChecked();
  await expect(main.getByRole('checkbox', { name: new RegExp(first.expenseNumber) })).not.toBeChecked();
});
