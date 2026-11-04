import type { Locator, Page } from '@playwright/test';
import { E_WHT_WORDS } from '@watchdog-bms/contracts';
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, unique } from '../harness/e2e-utils';
import { AFTER_PRESS, FIRST_SIGHT, MAIN_SHOP, cardWith, pressForDownloadBuffer, pressMenu, recordExpenseByHand, thaiDate } from './journey-kit';
import { eWhtPayeeTaxId, expectButtonGroup, openEWhtMonth, setEWhtSetting, withEWhtBranch, workbookXml } from './e-wht-journey-kit';

test.describe.configure({ mode: 'serial' });
const income = 'ค่าโฆษณา (นิติบุคคล) · หัก 2%';
const rental = 'ค่าเช่า (นิติบุคคล) · หัก 5%';

async function bankMethods(page: Page, method: Locator) {
  // The review page may re-read once after it opens, closing an open list; open, check and pick again until it holds.
  const transfer = page.getByRole('option', { name: 'โอนเงิน', exact: true });
  await expect(async () => {
    if (await method.getAttribute('aria-expanded') !== 'true') await method.click();
    await expect(transfer).toBeVisible({ timeout: 1_000 });
    await expect(page.getByRole('option', { name: /เงินสด|บัตร/ })).toHaveCount(0);
    await transfer.click({ timeout: 2_000 });
    await expect(method).toContainText('โอนเงิน', { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

async function outsideWindow(page: Page, date: Locator) {
  const displayed = await date.innerText();
  const year = Number(displayed.match(/\d{4}/)![0]) - 543;
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const month = months.findIndex(name => displayed.includes(name));
  await date.click();
  for (let i = year; i > 2022; i--) await page.getByRole('button', { name: 'ปีก่อนหน้า', exact: true }).click();
  for (let i = month; i < 11; i++) await page.getByRole('button', { name: 'เดือนถัดไป', exact: true }).click();
  await page.getByRole('button', { name: '31', exact: true }).click();
  await expect(page.getByText(E_WHT_WORDS['W-P2'], { exact: true })).toBeVisible();
  await date.click();
  await page.getByRole('button', { name: 'วันนี้', exact: true }).click();
  await expect(date).toHaveText(thaiDate());
  await expect(page.getByText(E_WHT_WORDS['W-P2'], { exact: true })).toHaveCount(0);
}

for (const width of [390, 1280, 1556]) {
  test(`@journey e-WHT ${width}px: enable, review RATE/AMOUNT, bank payment, voucher and bank-only month`, async ({ pageAs, api }) => {
    test.setTimeout(900_000);
    const page = await pageAs('OWNER');
    await page.setViewportSize({ width, height: 1000 });
    page.setDefaultTimeout(AFTER_PRESS.timeout);
    const main = page.locator('main');
    const capture = async (name: string) => {
      for (const group of await main.locator('.mangmee-actions').filter({ visible: true }).all()) {
        if (await group.locator('button.mangmee-btn, a.mangmee-btn').filter({ visible: true }).count()) await expectButtonGroup(group, width);
      }
      await test.info().attach(`${width}-${name}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    };
    await withEWhtBranch(api, async branch => {
      await test.step('settings: สมัครแล้ว and the S-6 saved toast', async () => {
        await setEWhtSetting(page, true);
        await capture('settings');
      });
      const seller = unique('บริษัท โฆษณาผ่านธนาคาร');
      await test.step('review: RATE becomes 1%, AMOUNT survives channel and category changes', async () => {
        await recordExpenseByHand(page, { branch: branch.name, seller, item: unique('ค่าโฆษณา e-WHT'), price: '1000', total: '1,000.00 บาท', toPay: '990.00 บาท',
          withholding: { payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: income, rate: '1', withheld: '10.00 บาท', taxId: eWhtPayeeTaxId(branch.code, 1), address: '45 ถนนสีลม กรุงเทพมหานคร 10500' } }, async block => {
          const remittance = block.getByRole('combobox', { name: E_WHT_WORDS['W-F1'], exact: true });
          await expect(remittance).toHaveText(E_WHT_WORDS['W-F2'], AFTER_PRESS);
          await expect(block.getByRole('textbox', { name: /^อัตราหัก ณ ที่จ่าย/ })).toHaveValue('2');
          await chooseThemedOption(page, remittance, E_WHT_WORDS['W-F3']);
          await expect(block.getByRole('textbox', { name: /^อัตราหัก ณ ที่จ่าย/ })).toHaveValue('1');
          await chooseThemedOption(page, block.getByRole('combobox', { name: 'หน่วยหัก ณ ที่จ่าย', exact: true }), 'จำนวนเงิน (บาท)');
          const amount = block.getByRole('textbox', { name: 'ยอดหัก ณ ที่จ่าย (บาท)', exact: true });
          await amount.fill('37');
          await chooseThemedOption(page, remittance, E_WHT_WORDS['W-F2']);
          await expect(amount).toHaveValue('37');
          await chooseThemedOption(page, remittance, E_WHT_WORDS['W-F3']);
          await chooseThemedOption(page, block.getByRole('combobox', { name: 'จ่ายค่าอะไร', exact: true }), rental);
          await expect(amount).toHaveValue('37');
          await chooseThemedOption(page, block.getByRole('combobox', { name: 'หน่วยหัก ณ ที่จ่าย', exact: true }), 'เปอร์เซ็นต์ (%)');
          await chooseThemedOption(page, block.getByRole('combobox', { name: 'จ่ายค่าอะไร', exact: true }), income);
          await expect(block.getByRole('textbox', { name: /^อัตราหัก ณ ที่จ่าย/ })).toHaveValue('1');
          await capture('review');
        });
        await expect(main.getByText(E_WHT_WORDS['W-D1u'], { exact: true })).toBeVisible();
        await expect(main.getByText(E_WHT_WORDS['W-D1'], { exact: true })).toHaveCount(0);
        await capture('unpaid');
      });
      await test.step('payer: bank methods, conditional expired-date warning, then W-D1', async () => {
        await bankMethods(page, main.getByRole('combobox', { name: 'วิธีจ่ายเงิน', exact: true }));
        await expect(main.getByText(E_WHT_WORDS['W-P2'], { exact: true })).toHaveCount(0);
        await outsideWindow(page, main.getByRole('combobox', { name: 'วันที่จ่ายเงินจริง', exact: true }));
        await capture('payment');
        await main.getByRole('button', { name: 'บันทึกจ่าย 990.00 บาท', exact: true }).click();
        await expect(main.getByText(E_WHT_WORDS['W-D1'], { exact: true })).toBeVisible(AFTER_PRESS);
        await expect(main.getByText(E_WHT_WORDS['W-D1u'], { exact: true })).toHaveCount(0);
      });
      await test.step('voucher: W-V1u before bank payment and W-V1 after it, with no certificate action', async () => {
        const payee = unique('บริษัท ใบเตรียมจ่ายธนาคาร');
        await recordExpenseByHand(page, { branch: branch.name, seller: payee, item: unique('ค่าโฆษณาใบเตรียมจ่าย'), price: '1000', total: '1,000.00 บาท', toPay: '990.00 บาท',
          withholding: { payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: income, rate: '1', withheld: '10.00 บาท', taxId: eWhtPayeeTaxId(branch.code, 2), address: '45 ถนนสีลม กรุงเทพมหานคร 10500' } }, async block => {
          await chooseThemedOption(page, block.getByRole('combobox', { name: E_WHT_WORDS['W-F1'], exact: true }), E_WHT_WORDS['W-F3']);
        });
        await pressMenu(page, 'ใบเตรียมจ่าย/ใบสำคัญจ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
        await main.getByRole('link', { name: 'สร้างใบเตรียมจ่าย', exact: true }).click();
        await main.getByRole('searchbox', { name: 'ค้นชื่อผู้รับเงินหรือเลขผู้เสียภาษี', exact: true }).fill(payee);
        await main.getByRole('button', { name: new RegExp(`^${payee}`) }).click();
        await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
        await bankMethods(page, main.getByRole('combobox', { name: 'วิธีที่จะจ่าย', exact: true }));
        await chooseThemedOption(page, main.getByRole('combobox', { name: 'ธนาคาร', exact: true }), 'ธนาคารกสิกรไทย');
        await main.getByRole('textbox', { name: 'ชื่อบัญชี', exact: true }).fill(payee);
        await main.getByRole('textbox', { name: 'เลขบัญชี', exact: true }).fill('1234567890');
        await main.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
        await expect(main.getByText(E_WHT_WORDS['W-V1u'], { exact: true })).toBeVisible(AFTER_PRESS);
        await expect(main.getByRole('button', { name: /หนังสือรับรอง|ออก 50 ทวิ/ })).toHaveCount(0);
        await capture('voucher-draft');
        await main.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();
        const approval = page.getByRole('dialog', { name: 'ให้ใครอนุมัติ' });
        await approval.getByRole('radio', { name: 'ฉันอนุมัติเลย', exact: true }).check();
        await expectButtonGroup(approval, width);
        await approval.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();
        await expect(main.getByRole('button', { name: 'บันทึกว่าจ่ายแล้ว', exact: true })).toBeVisible(AFTER_PRESS);
        await bankMethods(page, main.getByRole('combobox', { name: 'วิธีจ่าย', exact: true }));
        await outsideWindow(page, main.getByRole('combobox', { name: 'วันที่จ่ายจริง', exact: true }));
        const paidDate = main.getByRole('combobox', { name: 'วันที่จ่ายจริง', exact: true });
        await paidDate.click();
        await page.getByRole('button', { name: 'ล้าง', exact: true }).click();
        await main.getByRole('button', { name: 'บันทึกว่าจ่ายแล้ว', exact: true }).click();
        await expect(main.getByText('เลือกวันที่จ่ายจริงก่อนบันทึก', { exact: true })).toBeVisible();
        await expect(page.getByRole('dialog', { name: 'บันทึกว่าจ่ายแล้ว', exact: true })).toHaveCount(0);
        await paidDate.click();
        await page.getByRole('button', { name: 'วันนี้', exact: true }).click();
        await main.getByRole('button', { name: 'บันทึกว่าจ่ายแล้ว', exact: true }).click();
        const payment = page.getByRole('dialog', { name: 'บันทึกว่าจ่ายแล้ว', exact: true });
        await expectButtonGroup(payment, width);
        await payment.getByRole('button', { name: 'ยืนยัน จ่ายแล้ว 990.00 บาท', exact: true }).click();
        await expect(main.getByText(E_WHT_WORDS['W-V1'], { exact: true })).toBeVisible(AFTER_PRESS);
        await expect(main.getByText(E_WHT_WORDS['W-V1u'], { exact: true })).toHaveCount(0);
        await expect(main.getByRole('button', { name: /หนังสือรับรอง|ออก 50 ทวิ/ })).toHaveCount(0);
        await expect(main.getByRole('link', { name: /หนังสือรับรอง|ออก 50 ทวิ/ })).toHaveCount(0);
        await capture('voucher-paid');
      });
      await test.step('month: W-T3 replaces the paper button and the e-WHT workbook still downloads', async () => {
        await openEWhtMonth(page, branch);
        const paper = cardWith(page, 'ภ.ง.ด.53 (จ่ายให้บริษัท)');
        await expect(paper.getByText(E_WHT_WORDS['W-T3']('ภ.ง.ด.53', branch.name), { exact: true })).toBeVisible();
        await expect(paper.getByRole('button', { name: /ดาวน์โหลด/ })).toHaveCount(0);
        const bank = cardWith(page, E_WHT_WORDS['W-T1']);
        await expect(bank).toContainText(E_WHT_WORDS['W-T2']);
        await expect(bank).toContainText(seller);
        const file = await pressForDownloadBuffer(page, () => bank.getByRole('button', { name: E_WHT_WORDS['W-T2b'], exact: true }).click());
        expect(file.name).toMatch(/\.xlsx$/);
        expect(workbookXml(file.buffer)).toContain(seller);
        await capture('month');
      });
      await test.step('unopened shop: fresh withholding expense keeps the remittance field hidden', async () => {
        await setEWhtSetting(page, false);
        await recordExpenseByHand(page, { branch: branch.name, seller: unique('บริษัท ยังไม่สมัครธนาคาร'), item: unique('โฆษณาร้านยังไม่สมัคร'), price: '1000', total: '1,000.00 บาท', toPay: '980.00 บาท',
          withholding: { payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: income, rate: '2', withheld: '20.00 บาท', taxId: eWhtPayeeTaxId(branch.code, 3), address: '45 ถนนสีลม กรุงเทพมหานคร 10500' } }, async block => {
          await expect(block.getByRole('combobox', { name: E_WHT_WORDS['W-F1'], exact: true })).toHaveCount(0);
          await capture('setting-off-review');
        });
      });
    });
  });
}
