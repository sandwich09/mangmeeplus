/** A paid expense keeps its payment while its document and supporting evidence are corrected. */
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { AFTER_PRESS, FIRST_SIGHT, inOrder, picture, recordExpenseByHand, thaiDate } from './journey-kit';

type ExpenseDetail = {
  status: string; paymentStatus: string; paidAmount: string; primaryAttachmentId: string | null;
  vendorEntityKindSnapshot: string; whtCategoryCode: string; whtRate: string;
  payments: Array<{ id: string; status: string; amount: string }>;
  attachments: Array<{ id: string; originalFileName: string; purpose: string }>;
};

/** The server's refusal (expense-upload.use-case.ts, code expense_receipt_replace_locked). */
const REPLACE_REFUSED = 'รายจ่ายนี้บันทึกจ่ายแล้ว เปลี่ยนใบเสร็จหลักไม่ได้ ให้แนบเป็นหลักฐานเพิ่ม';

/** The phone and wide layouts each carry a labelled input; use the label the person can see. */
const fileControl = (main: Locator, label: string) => main.locator('label').filter({ hasText: label }).filter({ visible: true }).locator('input[type="file"]');

/** แก้ไขเอกสาร with a reason → the correction marker → ถัดไป: the confirmed expense is open for review, on step 2. */
async function reopenToStepTwo(page: Page, expenseNumber: string) {
  const main = page.locator('main');
  await main.getByRole('button', { name: 'แก้ไขเอกสาร', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'แก้ไขเอกสาร', exact: true });
  await expect(dialog).toContainText(expenseNumber);
  await expect(dialog).toContainText('รายการจ่ายเดิมยังอยู่');
  await dialog.getByRole('textbox', { name: 'เหตุผลที่แก้ไข', exact: true }).fill(unique('เพิ่มหลักฐานและแก้ประเภทผู้รับเงิน'));
  await dialog.getByRole('button', { name: 'เปิดเอกสารกลับไปตรวจสอบ', exact: true }).click();
  await expect(main.getByRole('status').filter({ hasText: 'กำลังแก้ไขเอกสารที่ยืนยันแล้ว' })).toBeVisible(AFTER_PRESS);
  await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
}

test('@journey an owner reopens a paid company expense, adds evidence without replacing the receipt, changes the payee to a person and confirms again', async ({ pageAs, api, companyId }) => {
  test.setTimeout(300_000);
  const page = await pageAs('OWNER');
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const main = page.locator('main');
  const next = main.getByRole('button', { name: 'ถัดไป', exact: true });
  const seller = unique('ผู้รับค่าบริการตรวจอุปกรณ์');
  const supporting = picture(`${unique('หลักฐานเพิ่มเติม')}.png`);
  const replacement = picture(`${unique('ใบเสร็จที่เปลี่ยนไม่ได้')}.png`);
  await page.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);

  const expense = await test.step('owner: a picture, company service withholding at 3%, confirm and pay', () => recordExpenseByHand(page, {
    branch: 'Head Office (สำนักงานใหญ่)', item: unique('ค่าบริการตรวจอุปกรณ์'), seller,
    price: '1000', total: '1,000.00 บาท', toPay: '970.00 บาท', pay: true,
    withholding: {
      payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: 'ค่าบริการ (นิติบุคคล) · หัก 3%', rate: '3', withheld: '30.00 บาท',
      taxId: '0105564000128', address: '45 ถนนสีลม แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500',
    },
  }));
  const readExpense = async () => json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${expense.expenseId}`));
  const paid = await readExpense();
  await expect(main.getByText('จ่ายแล้วพิมพ์ใบสำคัญจ่ายได้จากประวัติการจ่าย', { exact: true })).toHaveCount(0);
  await expect(main.getByTestId('expense-payment-history').getByRole('button', { name: 'ออกใบสำคัญจ่าย', exact: true })).toBeVisible();
  await expect(main.getByText('หลักฐานว่าบันทึกจ่ายแล้ว', { exact: true })).toHaveCount(0);
  expect(paid.status).toBe('CONFIRMED');
  expect(paid.paymentStatus).toBe('PAID');
  expect(Number(paid.paidAmount)).toBe(970);
  expect(paid.payments).toHaveLength(1);
  expect(paid.primaryAttachmentId).toBeTruthy();
  expect(paid.whtCategoryCode).toBe('WHT_SERVICE_5');
  // Action capabilities change while reopened; the payment's stored identity, status and amount do not.
  const payments = paid.payments.map(({ id, status, amount }) => expect.objectContaining({ id, status, amount }));

  await test.step('แก้ไขเอกสาร with a reason → the correction marker and step 2', () => reopenToStepTwo(page, expense.expenseNumber));

  await test.step('แนบหลักฐานเพิ่ม keeps the payment; replacing the main receipt is refused', async () => {
    await main.locator('summary').filter({ hasText: /^ตัวเลือกไฟล์$/ }).filter({ visible: true }).first().click();
    await fileControl(main, 'แนบหลักฐานเพิ่ม').setInputFiles(supporting);
    await expect(page.getByRole('status').filter({ hasText: 'แนบไฟล์ใบเสร็จแล้ว' }).first()).toBeVisible(AFTER_PRESS);
    const supportingRow = main.getByTestId('expense-attachment-list').locator(':scope > div').filter({ hasText: supporting.name });
    await expect(supportingRow.getByText(supporting.name, { exact: true })).toBeVisible(AFTER_PRESS);
    await expect(supportingRow.getByRole('button', { name: 'ดูไฟล์', exact: true })).toBeEnabled();
    const appended = await readExpense();
    expect(appended.attachments).toContainEqual(expect.objectContaining({ originalFileName: supporting.name, purpose: 'expense.receipt.supporting' }));
    expect(appended.paidAmount).toBe(paid.paidAmount);
    expect(appended.payments).toEqual(payments);
    expect(appended.primaryAttachmentId).toBe(paid.primaryAttachmentId);

    await fileControl(main, 'เปลี่ยนไฟล์ใบเสร็จ').setInputFiles(replacement);
    // At the press the refusal is said in a toast (outside main, gone after a few seconds). What stays
    // on the page is checked separately below.
    await expect(page.getByRole('alert').filter({ hasText: REPLACE_REFUSED }).first()).toBeVisible(AFTER_PRESS);
    const refused = await readExpense();
    expect(refused.primaryAttachmentId).toBe(paid.primaryAttachmentId);
    expect(refused.attachments).toEqual(appended.attachments);
    expect(refused.payments).toEqual(payments);
  });

  await test.step('กลับ → person clears จ่ายค่าอะไร → choose the person service type → ถัดไป saves it', async () => {
    await main.getByRole('button', { name: 'กลับ', exact: true }).click();
    await expect(main.getByRole('combobox', { name: 'ผู้รับเงินเป็นใคร', exact: true })).toHaveText('บริษัท / ห้างหุ้นส่วน');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ผู้รับเงินเป็นใคร', exact: true }), 'บุคคลธรรมดา');
    const income = main.getByRole('combobox', { name: 'จ่ายค่าอะไร', exact: true });
    await expect(income).toHaveText('ยังไม่ระบุ');
    await chooseThemedOption(page, income, 'ค่าบริการ (บุคคลธรรมดา) · หัก 3%');
    await expect(main.getByRole('textbox', { name: /^อัตราหัก ณ ที่จ่าย/ })).toHaveValue('3');
    const taxId = main.getByRole('textbox', { name: 'เลขประจำตัวผู้เสียภาษีผู้ขาย', exact: true });
    await expect(taxId).toBeVisible();
    await taxId.fill('3101200456789');
    await next.click();
    await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
    const person = await readExpense();
    expect(person.vendorEntityKindSnapshot).toBe('INDIVIDUAL');
    expect(person.whtCategoryCode).toBe('WHT_SERVICE_3');
    expect(Number(person.whtRate)).toBe(3);
  });

  await test.step('ยืนยันเอกสาร again, with the same payment and main receipt', async () => {
    await next.click();
    await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ตรวจสรุป' })).toBeVisible(AFTER_PRESS);
    await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
    await expect(page.getByText('ยืนยันเอกสารแล้ว', { exact: true }).first()).toBeVisible(AFTER_PRESS);
    await expect(main.locator('.mangmee-page-header').getByText('จ่ายแล้ว', { exact: true })).toBeVisible();
    // With tax withheld and no 50 ทวิ yet the page has no "จ่ายครบแล้ว" line; it shows nothing left to pay and the same payment.
    await expect(main.getByText(/^ต้องจ่าย /)).toHaveCount(0);
    await expect(main).toContainText(inOrder('ประวัติการจ่าย', `${thaiDate()} · โอนเงิน`, '970.00 บาท'));
    await expect(main.getByTestId('expense-detail-totals')).toContainText(inOrder('จ่ายแล้ว', '970.00', 'บาท'));
    await expect(main.getByText('ยอดที่ต้องจ่าย (หลังหัก ณ ที่จ่าย)', { exact: true })).toHaveCount(0);
  });

  const confirmed = await readExpense();
  expect(confirmed.status).toBe('CONFIRMED');
  expect(confirmed.paymentStatus).toBe('PAID');
  expect(confirmed.paidAmount).toBe(paid.paidAmount);
  expect(confirmed.payments).toEqual(payments);
  expect(confirmed.primaryAttachmentId).toBe(paid.primaryAttachmentId);
  expect(confirmed.attachments).toHaveLength(paid.attachments.length + 1);
  expect(confirmed.vendorEntityKindSnapshot).toBe('INDIVIDUAL');
  expect(confirmed.whtCategoryCode).toBe('WHT_SERVICE_3');
});

test('@journey the notice left on the page after a refused receipt replacement on a paid expense says why and what to do instead', async ({ pageAs, companyId }) => {
  test.setTimeout(300_000);
  const page = await pageAs('OWNER');
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const main = page.locator('main');
  await page.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
  const expense = await recordExpenseByHand(page, {
    branch: 'Head Office (สำนักงานใหญ่)', item: unique('ค่าซ่อมเครื่องพิมพ์'), seller: unique('ร้านซ่อมเครื่องพิมพ์'),
    price: '800', total: '800.00 บาท', toPay: '800.00 บาท', pay: true,
  });
  await reopenToStepTwo(page, expense.expenseNumber);

  await fileControl(main, 'เปลี่ยนไฟล์ใบเสร็จ').setInputFiles(picture(`${unique('ใบเสร็จที่เปลี่ยนไม่ได้')}.png`));
  // The one notice of the page carries the server's own sentence, which names the way out (แนบหลักฐานเพิ่ม)…
  await expect(main.getByRole('alert')).toHaveText(`⚠ ${REPLACE_REFUSED}`, AFTER_PRESS);
  // …and nothing on the page says that attaching is impossible here: แนบหลักฐานเพิ่ม works on this very step.
  await expect(main.getByText(/เปลี่ยนหรือแนบไฟล์ตรงนี้ไม่ได้/)).toHaveCount(0);
});
