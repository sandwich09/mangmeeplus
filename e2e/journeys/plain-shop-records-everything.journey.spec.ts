/**
 * A starter shop with no tax identity can finish recording, evidence, payment and reimbursement.
 * Landing words: ExpensesPages.tsx + workspace-dictionary.ts (manual/upload/data),
 * ExpenseReviewPage.tsx (steps/confirm/payment), SubstituteReceiptWizardPage.tsx (certificate),
 * ReimbursementCreatePage.tsx / ReimbursementJourneyPage.tsx / ReimbursementsPages.tsx (claim),
 * CompanyProfilePage.tsx (the disabled never-answered VAT option).
 * The proof stack supplies storage and scan completion, not receipt OCR; the owner fills unread fields.
 */
import type { Locator, Page } from '@playwright/test';
import type { ExpenseDetail } from '@watchdog-bms/contracts';
import { test, expect } from '../harness/fixtures';
import { ensureBrowserLegalAcceptance } from '../harness/auth';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { QA_ACCOUNTS } from '../harness/roles';
import { AFTER_PRESS, FIRST_SIGHT, MAIN_SHOP, idFromUrl, metricValue, picture, pressMenu, recordExpenseByHand, signOnScreen, thaiDate, whole } from './journey-kit';

const BRANCH = 'สำนักงานใหญ่ (สำนักงานใหญ่)';
const STAFF = QA_ACCOUNTS.STAFF.displayName;
async function pick(page: Page, label: string, value: string) {
  const field = page.locator('main').getByRole('combobox', { name: label, exact: true });
  await expect(field).toBeVisible(AFTER_PRESS);
  if ((await field.innerText()).trim() !== value) await chooseThemedOption(page, field, value);
}
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text }).first();
/** The phone and wide layouts each carry a labelled file input; use the one whose label the person can see. */
const fileControl = (main: Locator, label: string) => main.locator('label').filter({ hasText: label }).filter({ visible: true }).locator('input[type="file"]');
/** The VAT chooser has the same accessible name as its printed question. */
async function vatAnswer(page: Page) {
  const main = page.locator('main');
  await pressMenu(page, 'ข้อมูลร้าน', 'ตั้งค่าร้าน');
  await expect(main.getByRole('heading', { level: 1, name: 'ข้อมูลร้าน', exact: true })).toBeVisible(FIRST_SIGHT);
  const question = main.locator('div').filter({ has: page.getByText('ร้านจดทะเบียน VAT หรือยัง', { exact: true }) }).last();
  await expect(question.getByText('ระบบใช้คำตอบนี้ออกเอกสารภาษีของร้าน', { exact: true })).toBeVisible();
  return main.getByRole('combobox', { name: 'ร้านจดทะเบียน VAT หรือยัง', exact: true });
}
async function enter(page: Page, shop: string) {
  await ensureBrowserLegalAcceptance(page.context(), shop);
  await page.goto(`/companies/${shop}/dashboard`, FIRST_SIGHT);
}
async function next(page: Page, landing: string | Locator) {
  const main = page.locator('main');
  const button = main.getByRole('button', { name: 'ถัดไป', exact: true });
  await expect(button).toBeEnabled(AFTER_PRESS);
  await button.click();
  await expect(typeof landing === 'string' ? main.getByText(landing, { exact: true }) : landing).toBeVisible(AFTER_PRESS);
}

/** Labels read from ManualExpensePanel / ExpenseDraftFields in ExpensesPages.tsx. */
async function manual(page: Page, branch: string, simple: boolean, invoice: boolean, pay: boolean, vatStatus = 'NOT_REGISTERED') {
  const main = page.locator('main');
  const seller = unique(invoice ? 'ร้านใบกำกับภาษี' : 'ร้านใบเสร็จธรรมดา');
  const amount = invoice ? '107' : '85';
  const total = invoice ? '107.00 บาท' : '85.00 บาท';
  await pressMenu(page, 'บันทึกด้วยมือ', 'ค่าใช้จ่ายและใบเสร็จ');
  await expect(main.getByRole('heading', { level: 1, name: 'บันทึกด้วยมือ', exact: true })).toBeVisible(FIRST_SIGHT);
  await pick(page, 'สาขา', branch);
  await main.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true }).fill(unique('ของใช้หน้าร้าน'));
  await main.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill(amount);
  await main.getByRole('combobox', { name: 'ชื่อผู้ขาย', exact: true }).fill(seller);
  await main.locator('input[type="file"]').first().setInputFiles(picture(`${seller}.png`));
  await expect(main.getByRole('button', { name: 'นำไฟล์ออก', exact: true })).toBeVisible(AFTER_PRESS);
  // The short form has no tax block at all; the full form carries one. (Checked once the form has settled.)
  const vatPattern = main.getByText('รูปแบบ VAT', { exact: true });
  if (simple) {
    await expect(main.getByText('ภาษีของรายการ', { exact: true })).toHaveCount(0);
    await expect(vatPattern).toHaveCount(0);
    await expect(main.getByRole('combobox', { name: 'รายการนี้หักภาษี ณ ที่จ่ายไหม', exact: true })).toHaveCount(0);
  } else {
    await expect(main.getByRole('heading', { name: 'ภาษีของรายการ', exact: true })).toBeVisible();
    await expect(vatPattern).toBeVisible();
  }
  await expect(main.getByText(whole(`ยอดรวม ${total}`))).toBeVisible();
  await main.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(FIRST_SIGHT);
  await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ตรวจข้อมูล' })).toBeVisible();
  const id = idFromUrl(page);
  if (invoice) {
    // The shop still records VAT printed by its supplier, as cost, without selecting an input-tax code.
    await pick(page, 'รูปแบบ VAT', 'VAT รวมในราคา');
    // A known invalid rate gives the reason and a way to the field, not a useless retry.
    await expect(main.getByRole('status').filter({ hasText: 'เอกสารนี้มี VAT เลือกอัตรา หรือกรอกยอด VAT ตามใบเสร็จ' })).toBeVisible(AFTER_PRESS);
    await expect(main.getByRole('button', { name: 'คำนวณอีกครั้ง', exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'ตรวจข้อมูลที่ต้องแก้', exact: true }).click();
    await test.step('ตรวจข้อมูลที่ต้องแก้ takes the person to อัตรา VAT', async () => {
      const rate = main.getByRole('combobox', { name: 'อัตรา VAT', exact: true });
      await expect(rate).toBeFocused();
      await expect.poll(() => rate.evaluate(field => {
        const top = (document.querySelector('[data-app-top-bar]')?.getBoundingClientRect().bottom ?? 0)
          + (document.querySelector('[data-expense-stepper]')?.getBoundingClientRect().height ?? 0);
        const bottom = Array.from(document.querySelectorAll('[data-form-action-bar]')).reduce((edge, bar) => {
          if (!['sticky', 'fixed'].includes(getComputedStyle(bar).position)) return edge;
          const rect = bar.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < innerHeight ? Math.min(edge, rect.top) : edge;
        }, innerHeight);
        const rect = field.getBoundingClientRect();
        return rect.top >= top && rect.bottom <= bottom;
      })).toBe(true);
    });
    await pick(page, 'อัตรา VAT', 'มี VAT 7%');
    await pick(page, 'บนใบพิมพ์ VAT ไว้แบบไหน', 'ทั้ง % และจำนวนเงิน');
    await main.getByRole('spinbutton', { name: 'อัตรา VAT จากเอกสาร (%)', exact: true }).fill('7');
    await main.getByRole('spinbutton', { name: 'VAT จากเอกสาร (บาท)', exact: true }).fill('7');
    const shopLine = main.getByText('ร้านไม่ได้จด VAT จึงนำ VAT ในใบนี้ไปใช้ตอนยื่นภาษีไม่ได้', { exact: true });
    // The answer, not the short-form mode, decides this sentence.
    if (simple && vatStatus === 'NOT_REGISTERED') await expect(shopLine).toBeVisible(); else await expect(shopLine).toHaveCount(0);
    if (vatStatus === 'UNKNOWN') await expect(main.getByText('ร้านยังไม่ตอบเรื่อง VAT บันทึกรายจ่ายได้ตามเดิม', { exact: false }).first()).toBeVisible();
    const totals = main.getByTestId('expense-review-totals');
    const totalValue = metricValue(totals, 'ยอดรวม'), vatValue = metricValue(totals, 'VAT');
    await expect(totalValue).toBeVisible();
    await expect(vatValue).toBeVisible();
    await expect(totalValue).toHaveText(whole('107.00 บาท'), AFTER_PRESS);
    await expect(vatValue).toHaveText(whole('7.00 บาท'), AFTER_PRESS);
    // The base is no longer a separate line: the displayed total less displayed VAT must still be 100.
    const numberOn = async (value: Locator) => Number((await value.innerText()).replace(/[^\d.]/g, ''));
    expect(await numberOn(totalValue) - await numberOn(vatValue)).toBe(100);
    await expect(totals.getByText(/^ยอดก่อน VAT|^VAT ที่คำนวณได้/)).toHaveCount(0);
    await expect(main.getByText(whole('VAT ที่คำนวณได้ 7.00 บาท'))).toBeVisible();
  }
  if (!invoice) {
    await main.getByRole('textbox', { name: 'เลขประจำตัวผู้เสียภาษีผู้ขาย', exact: true }).fill('1234567890123');
    await expect(main.getByText('เลขผู้เสียภาษี 13 หลักนี้ดูไม่ถูกต้อง ลองตรวจกับใบเสร็จอีกครั้ง', { exact: true })).toBeVisible();
  }
  await next(page, page.locator('main [aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' }));
  await pick(page, 'ประเภทเอกสาร', invoice ? 'ใบกำกับภาษี (เต็มรูป)' : 'ใบเสร็จรับเงิน');
  await pick(page, 'ใช้เป็นหลักฐานรายจ่ายได้ไหม', 'ใช้ได้');
  await next(page, page.locator('main [aria-current="step"]').filter({ hasText: 'ตรวจสรุป' }));
  // PWS-CHAIN: this is a review-screen answer, separate from the accountant export header.
  if (invoice && vatStatus !== 'NOT_REGISTERED') await expect(main.getByText('ใช้ VAT ตอนยื่นภาษี: รอตรวจสอบ', { exact: true }).first()).toBeVisible();
  if (!invoice) {
    const summary = main.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: 'สรุปการตรวจ', exact: true }) });
    await expect(summary).toContainText('เลขผู้เสียภาษีผู้ขายครบ 13 หลัก แต่ดูไม่ถูกต้อง');
    await expect(summary).toContainText(/ต้องตรวจ [1-9]\d* รายการ/);
  }
  const confirm = main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true });
  await expect(confirm).toBeEnabled(AFTER_PRESS);
  await confirm.click();
  await expect(toast(page, 'ยืนยันเอกสารแล้ว')).toBeVisible(AFTER_PRESS);
  await expect(main.locator('.mangmee-page-header').getByText('รอจ่าย', { exact: true })).toBeVisible();
  if (pay) {
    await expect(main.getByRole('button', { name: 'ไปที่การจ่ายเงิน', exact: true })).toHaveCount(0);
    await main.getByRole('heading', { name: 'การจ่ายเงิน', exact: true }).scrollIntoViewIfNeeded();
    const amountField = main.locator('#expense-payment-amount');
    const originalAmount = await amountField.inputValue();
    await amountField.fill('99999');
    const payButton = main.locator('button[form="expense-record-payment"]');
    await expect(payButton).toBeEnabled();
    await payButton.click();
    await expect(amountField).toBeFocused();
    await expect(amountField).toHaveAttribute('aria-describedby', 'expense-payment-amount-error');
    await expect(main.locator('#expense-payment-amount-error')).toContainText('ยอดที่จ่ายต้องไม่เกินยอดค้างจ่าย');
    await amountField.fill(originalAmount);
    await main.getByLabel('แนบสลิป (ถ้ามี)', { exact: true }).setInputFiles(picture(`${unique('หลักฐานโอนจ่าย')}.png`));
    await main.getByRole('button', { name: `บันทึกจ่าย ${total}`, exact: true }).click();
    await expect(toast(page, `บันทึกจ่ายแล้ว ${total}`)).toBeVisible(AFTER_PRESS);
    await expect(main.locator('.mangmee-page-header').getByText('จ่ายแล้ว', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'ดูหลักฐานการจ่าย', exact: true })).toBeVisible();
  }
  return { id, seller, amount, invoice, pay };
}

for (const { id: SHOP, name: SHOP_NAME, vatStatus, vatLabel } of [
  { id: 'seed-local-plain-shop', name: 'ร้านทั่วไป (ไม่จด VAT)', vatStatus: 'NOT_REGISTERED', vatLabel: 'ยังไม่ได้จดทะเบียน VAT' },
  { id: 'seed-local-plain-shop-unanswered', name: 'ร้านทั่วไป (ยังไม่ตอบเรื่อง VAT)', vatStatus: 'UNKNOWN', vatLabel: 'ยังไม่ได้ตอบ' },
]) {
test(`@journey ${SHOP_NAME} records receipts, a VAT invoice, a phone upload, a substitute receipt and a paid staff claim`, async ({ pageAs, apiAs }, info) => {
  test.setTimeout(300_000);
  const owner = await pageAs('OWNER');
  const staff = await pageAs('STAFF');
  const manager = await pageAs('MANAGER');
  const finance = await pageAs('FINANCE');
  const api = await apiAs('OWNER');
  const scope = { headers: { 'X-Company-Id': SHOP } };
  const main = owner.locator('main');
  await enter(owner, SHOP);
  await expect(owner.locator('header').getByText(SHOP_NAME, { exact: true })).toBeVisible(FIRST_SIGHT);
  const policy = await json<any>(await api.get(`companies/${SHOP}/expenses/capture-policy`, scope));
  expect(policy).toMatchObject({ mode: 'SIMPLE', vatStatus });
  await test.step(`ข้อมูลร้าน: no registered name, tax number or address is a notice, not a stop; the VAT answer reads ${vatLabel}`, async () => {
    await expect(await vatAnswer(owner)).toHaveText(vatLabel);
    await expect(main.getByRole('status').filter({ hasText: 'ข้อมูลร้านยังขาด' })).toHaveText('⚠ ข้อมูลร้านยังขาด: ชื่อจดทะเบียน · เลขผู้เสียภาษี · ที่อยู่ · กรอกช่องที่แจ้งไว้แล้วบันทึก');
  });
  const records: Awaited<ReturnType<typeof manual>>[] = [];
  await test.step('plain receipt: short form → picture → confirm → payment, with supporting slip', async () => {
    records.push(await manual(owner, BRANCH, true, false, true, vatStatus));
  });
  await test.step('a supplier’s full VAT invoice: record its VAT as cost, then confirm', async () => {
    records.push(await manual(owner, BRANCH, true, true, false, vatStatus));
  });

  let phoneId = '';
  await test.step('staff camera at 390: send → owner finds it and completes the unread fields', async () => {
    await staff.setViewportSize({ width: 390, height: 844 });
    await enter(staff, SHOP);
    const sm = staff.locator('main');
    await pressMenu(staff, 'อัปโหลดใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(sm.getByRole('heading', { level: 1, name: 'อัปโหลดใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
    await pick(staff, 'สาขา', BRANCH);
    const photo = picture(`${unique('ใบเสร็จจากกล้อง')}.png`);
    await sm.getByLabel('ถ่ายรูปใบเสร็จ', { exact: true }).setInputFiles(photo);
    await expect(sm.getByRole('status').filter({ hasText: 'ส่งใบเสร็จแล้ว' })).toHaveText('ส่งใบเสร็จแล้ว ผู้ตรวจจะตรวจและยืนยันให้', { timeout: 60_000 });
    await expect(sm.getByRole('button', { name: 'เติมข้อมูล', exact: true })).toBeEnabled();
    await expect(sm.getByRole('link', { name: 'ดูรายการที่ส่ง', exact: true })).toBeVisible();
    // Give just a unique seller so the owner can find this receipt, leaving amount/date for the reviewer.
    const seller = unique('ร้านรับรูปจากพนักงาน');
    await sm.getByRole('button', { name: 'เติมข้อมูล', exact: true }).click();
    await expect(sm.getByRole('heading', { name: 'เติมข้อมูลใบเสร็จ', exact: true })).toBeVisible();
    await sm.getByRole('textbox', { name: 'ชื่อผู้ขาย', exact: true }).fill(seller);
    await sm.getByRole('button', { name: 'บันทึกข้อมูล', exact: true }).click();
    await expect(toast(staff, 'บันทึกข้อมูลแล้ว')).toBeVisible(AFTER_PRESS);
    await expect(sm.getByText('ระบบอ่านบางช่องไม่ออก', { exact: true }).filter({ visible: true })).toBeVisible(AFTER_PRESS);
    await expect(sm.getByRole('button', { name: 'เติมข้อมูล', exact: true })).toBeEnabled();
    await pressMenu(owner, 'รายการค่าใช้จ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'รายการค่าใช้จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('searchbox', { name: 'ค้นหาผู้ขายหรือเลขที่', exact: true }).fill(seller);
    const row = main.getByTestId('expenses-row').filter({ hasText: seller }).filter({ visible: true });
    await expect(row).toContainText('รอตรวจ', AFTER_PRESS);
    await row.getByText(seller, { exact: true }).first().click();
    await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(FIRST_SIGHT);
    phoneId = idFromUrl(owner);
    // Nothing was read from the picture: the page says what is missing, and the owner fills it.
    const date = main.getByRole('combobox', { name: 'วันที่เอกสาร', exact: true });
    await expect(date).toHaveText('เลือกวันที่');
    const noTotal = main.getByText('ยอดรวมต้องมากกว่า 0 กรอกราคาอย่างน้อย 1 รายการ', { exact: true });
    await expect(main.getByText('ยังไม่มีรายการสินค้า/บริการ', { exact: true })).toBeVisible();
    await expect(noTotal).toBeVisible();
    await date.click();
    await owner.getByRole('button', { name: 'วันนี้', exact: true }).click();
    await main.getByRole('button', { name: 'เพิ่มรายการ', exact: true }).click();
    await expect(main.locator('textarea[id^="expense-review-line-input-"]').last()).toBeFocused();
    await main.getByRole('textbox', { name: 'รายละเอียด', exact: true }).fill(unique('ของใช้จากรูป'));
    await main.getByRole('spinbutton', { name: 'จำนวน', exact: true }).fill('1');
    await main.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill('60');
    await expect(noTotal).toHaveCount(0);
    await next(owner, owner.locator('main [aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' }));
    await pick(owner, 'ประเภทเอกสาร', 'ใบเสร็จรับเงิน');
    await pick(owner, 'ใช้เป็นหลักฐานรายจ่ายได้ไหม', 'ใช้ได้');
    await next(owner, owner.locator('main [aria-current="step"]').filter({ hasText: 'ตรวจสรุป' }));
    await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
    await expect(toast(owner, 'ยืนยันเอกสารแล้ว')).toBeVisible(AFTER_PRESS);
  });

  let certificateExpenseId = '';
  await test.step('no receipt: create in the certificate wizard, read once, sign and confirm the expense', async () => {
    const payee = unique('ร้านตลาดสดไม่มีใบเสร็จ');
    await pressMenu(owner, 'ใบรับรองแทนใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'ใบรับรองแทนใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('link', { name: 'สร้างใบรับรอง', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'สร้างใบรับรองแทนใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('radio', { name: /^ยังไม่ได้บันทึก/ }).check();
    await pick(owner, 'สาขา', BRANCH);
    await main.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true }).fill(unique('น้ำแข็งหน้าร้าน'));
    await pick(owner, 'รายการที่ 1: หมวดหมู่ค่าใช้จ่าย', 'ค่าอาหารและเครื่องดื่ม');
    await main.getByRole('spinbutton', { name: 'จำนวน', exact: true }).fill('1');
    await main.getByRole('textbox', { name: 'ราคาต่อหน่วย บาท', exact: true }).fill('40');
    await main.getByRole('button', { name: 'บันทึกร่างค่าใช้จ่ายและไปต่อ', exact: true }).click();
    await expect(main.getByText(/^บันทึกร่างค่าใช้จ่าย EXP-.* แล้ว$/)).toBeVisible(AFTER_PRESS);
    await expect(main.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
    await expect(main.getByRole('status').filter({ hasText: 'ยังขาด:' })).toContainText('ติ๊กว่าเข้าใจแล้ว');
    await main.getByRole('checkbox', { name: 'เข้าใจแล้วว่าใบรับรองแทนใบเสร็จใช้ VAT ตอนยื่นภาษีไม่ได้', exact: true }).check();
    await next(owner, 'ผู้รับเงิน');
    await main.getByRole('textbox', { name: /^ชื่อผู้รับเงิน/ }).fill(payee);
    await main.getByRole('textbox', { name: 'เหตุผลที่ไม่มีใบเสร็จรับเงิน', exact: true }).fill('ร้านตลาดสดไม่ได้ออกใบเสร็จ');
    await main.getByRole('textbox', { name: 'ซื้อไปใช้ทำอะไร', exact: true }).fill('แช่เครื่องดื่มหน้าร้าน');
    await main.getByRole('radio', { name: 'เงินของร้าน', exact: true }).check();
    await main.getByRole('checkbox', { name: 'จ่ายครบ 40.00 บาท แล้ว ไม่ได้แบ่งจ่าย', exact: true }).check();
    const nameNotice = main.getByRole('status').filter({ hasText: 'ใบรับรองจะใช้ชื่อ' });
    await expect(nameNotice).toContainText(`⚠ ใบรับรองจะใช้ชื่อ “${SHOP_NAME}” เพราะยังไม่ได้กรอกชื่อจดทะเบียนของร้าน`);
    const returnPath = `/companies/${SHOP}/expenses/substitute-receipts/new?expenseId=${new URL(owner.url()).searchParams.get('expenseId')}`;
    const shopLink = nameNotice.getByRole('link', { name: 'กรอกข้อมูลร้าน', exact: true });
    await expect(shopLink).toHaveAttribute('href', `/companies/${SHOP}/settings/profile?returnTo=${encodeURIComponent(returnPath)}#shop`);
    await shopLink.click();
    await expect(main.getByRole('heading', { level: 1, name: 'ข้อมูลร้าน', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('link', { name: 'กลับไปทำใบรับรอง', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'สร้างใบรับรองแทนใบเสร็จ', exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(main.getByRole('textbox', { name: /^ชื่อผู้รับเงิน/ })).toHaveValue(payee);
    await expect(main.getByRole('textbox', { name: 'เหตุผลที่ไม่มีใบเสร็จรับเงิน', exact: true })).toHaveValue('ร้านตลาดสดไม่ได้ออกใบเสร็จ');
    await expect(main.getByRole('textbox', { name: 'ซื้อไปใช้ทำอะไร', exact: true })).toHaveValue('แช่เครื่องดื่มหน้าร้าน');
    await expect(main.getByRole('radio', { name: 'เงินของร้าน', exact: true })).toBeChecked();
    await expect(main.getByRole('checkbox', { name: 'จ่ายครบ 40.00 บาท แล้ว ไม่ได้แบ่งจ่าย', exact: true })).toBeChecked();
    // This is a warning, not a stop: the shop display name is a permitted fallback, with no tax id required.
    await next(owner, 'หลักฐานการจ่าย');
    const proof = picture(`${unique('หลักฐานจ่ายน้ำแข็ง')}.png`);
    await main.getByLabel('หลักฐานการจ่าย', { exact: true }).setInputFiles(proof);
    await expect(main.getByText('เพิ่มไฟล์หลักฐานแล้ว', { exact: true })).toBeVisible(AFTER_PRESS);
    await next(owner, main.getByRole('group', { name: 'เลือกวิธีเซ็น' }));
    await main.getByRole('radio', { name: /^เซ็นออนไลน์/ }).check();
    certificateExpenseId = new URL(owner.url()).searchParams.get('expenseId')!;
    await main.getByRole('button', { name: 'สร้างใบรับรองและไปเซ็น', exact: true }).click();
    const heading = main.getByRole('heading', { level: 1, name: /^ใบรับรองแทนใบเสร็จ SRC-/ });
    await expect(heading).toBeVisible(AFTER_PRESS);
    const title = await heading.innerText();
    await main.getByRole('button', { name: 'อ่านเอกสาร', exact: true }).click();
    const reader = owner.getByRole('dialog', { name: title, exact: true });
    await expect(reader.getByRole('img', { name: title, exact: true })).toBeVisible(AFTER_PRESS);
    await reader.getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(main.getByText('อ่านแล้ว', { exact: true })).toBeVisible();
    await signOnScreen(owner);
    await main.getByRole('checkbox', { name: 'รับรองว่าจ่ายจริงเพื่อร้านและใช้ใบเสร็จประกอบไม่ได้ ตรวจเอกสารและหลักฐานแล้ว และอนุมัติให้ออกใบรับรอง', exact: true }).check();
    await main.getByRole('button', { name: 'เซ็นและออกใบรับรอง', exact: true }).click();
    await expect(main.getByText('✓ ออกใบรับรองแล้ว เหลือยืนยันค่าใช้จ่ายนี้')).toBeVisible(AFTER_PRESS);
    await main.getByRole('link', { name: 'ไปยืนยันค่าใช้จ่าย', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: payee, exact: true })).toBeVisible(FIRST_SIGHT);
    await next(owner, owner.locator('main [aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' }));
    await next(owner, owner.locator('main [aria-current="step"]').filter({ hasText: 'ตรวจสรุป' }));
    await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
    await expect(toast(owner, 'ยืนยันเอกสารแล้ว')).toBeVisible(AFTER_PRESS);
    await expect(main.locator('.mangmee-page-header').getByText('จ่ายแล้ว', { exact: true })).toBeVisible();
    await main.getByTestId('expense-payment-history').getByRole('button', { name: 'ดูหลักฐานการจ่าย', exact: true }).click();
    const paymentProof = owner.getByRole('dialog', { name: proof.name, exact: true });
    await expect(paymentProof).toBeVisible(AFTER_PRESS);
    await paymentProof.getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(main.getByTestId('expense-payment-history').getByRole('button', { name: 'ดูหลักฐานการจ่าย', exact: true })).toBeFocused();
    await expect(main.getByText(proof.name, { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(main.getByText(/^หลักฐานการจ่ายเงิน · /).filter({ visible: true })).toBeVisible();
  });

  let claimId = '';
  await test.step('staff sends a pictured claim → manager checks the account and approves → finance pays → staff reads จ่ายแล้ว', async () => {
    await staff.setViewportSize({ width: 1280, height: 900 });
    const sm = staff.locator('main');
    await pressMenu(staff, 'การเบิกจ่าย');
    await expect(sm.getByRole('heading', { level: 1, name: 'การเบิกจ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await sm.getByRole('link', { name: '+ สร้างใบเบิก', exact: true }).click();
    await expect(sm.getByRole('heading', { level: 1, name: 'สร้างใบเบิก', exact: true })).toBeVisible(FIRST_SIGHT);
    await pick(staff, 'สาขา', BRANCH);
    const reason = unique('ค่าถุงใส่ของร้านทั่วไป');
    await sm.getByRole('textbox', { name: 'เหตุผล', exact: true }).fill(reason);
    const receipt = picture(`${reason}.png`);
    await sm.getByLabel('ใบเสร็จ', { exact: true }).setInputFiles(receipt);
    await expect(sm.getByText(receipt.name).first()).toBeVisible(AFTER_PRESS);
    await sm.getByRole('textbox', { name: 'รายการ', exact: true }).fill(reason);
    await sm.getByRole('textbox', { name: 'จำนวนเงิน', exact: true }).fill('95');
    await pick(staff, 'หมวด', 'วัสดุอุปกรณ์');
    await sm.getByRole('radiogroup', { name: 'รับเงินคืนทาง' }).getByRole('radio', { name: 'ระบุบัญชีสำหรับใบนี้', exact: true }).check();
    await pick(staff, 'ธนาคาร', 'ธนาคารกสิกรไทย');
    await sm.getByRole('textbox', { name: 'ชื่อบัญชี', exact: true }).fill(STAFF);
    await sm.getByRole('textbox', { name: 'เลขบัญชี', exact: true }).fill('1234567890');
    const keep = sm.getByRole('checkbox', { name: 'บันทึกเป็นบัญชีประจำของฉัน', exact: true });
    if (await keep.count()) await keep.uncheck();
    await sm.getByRole('button', { name: 'ส่งอนุมัติ', exact: true }).click();
    await expect(toast(staff, 'ส่งอนุมัติแล้ว')).toBeVisible(AFTER_PRESS);
    const heading = sm.getByRole('heading', { level: 1, name: /^ใบเบิก RB-\d{6}-\d{5}$/ });
    await expect(heading).toBeVisible(FIRST_SIGHT);
    const number = (await heading.innerText()).replace('ใบเบิก ', '');
    claimId = idFromUrl(staff);
    await expect(sm.locator('.mangmee-badge').first()).toHaveText('รออนุมัติ');

    await enter(manager, SHOP);
    const mm = manager.locator('main');
    await pressMenu(manager, 'การเบิกจ่าย');
    await expect(mm.getByRole('heading', { level: 1, name: 'การเบิกจ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    const waiting = mm.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: number });
    await expect(waiting).toContainText(reason, AFTER_PRESS);
    await waiting.getByRole('button', { name: 'ตรวจบัญชีและอนุมัติ', exact: true }).click();
    await expect(mm.getByRole('heading', { level: 1, name: `ใบเบิก ${number}`, exact: true })).toBeVisible(FIRST_SIGHT);
    const approval = mm.getByRole('region', { name: 'อนุมัติ' });
    await approval.getByRole('checkbox', { name: /^ฉันตรวจแล้วว่าบัญชีนี้เป็นบัญชีรับเงินของผู้เบิก/ }).check();
    await approval.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await expect(toast(manager, 'อนุมัติใบเบิกแล้ว')).toBeVisible(AFTER_PRESS);
    await expect(mm.locator('.mangmee-badge').first()).toHaveText('พร้อมจ่าย');

    await enter(finance, SHOP);
    const fm = finance.locator('main');
    await pressMenu(finance, 'การเบิกจ่าย');
    await expect(fm.getByRole('heading', { level: 1, name: 'การเบิกจ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await fm.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: number }).getByRole('button', { name: 'จ่ายเงิน', exact: true }).click();
    const dialog = info.project.use.isMobile
      ? fm.getByRole('region', { name: 'จ่ายเงินคืน', exact: true })
      : finance.getByRole('dialog', { name: `บันทึกจ่าย ${number}` });
    await expect(dialog.getByRole('combobox', { name: 'วิธีจ่าย', exact: true })).toHaveText('โอนเงิน');
    const slip = picture(`${unique('สลิปคืนค่าถุง')}.png`);
    await dialog.getByLabel('หลักฐานการจ่าย', { exact: true }).setInputFiles(slip);
    await expect(dialog.getByText(slip.name).first()).toBeVisible(AFTER_PRESS);
    await dialog.getByRole('checkbox', { name: /^โอนเข้าบัญชีนี้แล้ว และชื่อผู้รับที่ธนาคารแสดงตรงกับใบเบิก/ }).check();
    await dialog.getByRole('button', { name: 'บันทึกจ่าย 95.00 บาท', exact: true }).click();
    await expect(toast(finance, `บันทึกจ่าย ${number} 95.00 บาท แล้ว`)).toBeVisible(AFTER_PRESS);

    await pressMenu(staff, 'การเบิกจ่าย');
    await expect(sm.getByRole('heading', { level: 1, name: 'การเบิกจ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await sm.getByRole('combobox', { name: 'สถานะ', exact: true }).click();
    await staff.getByRole('option', { name: /^จ่ายแล้ว \([1-9]\d*\)$/ }).click();
    const paid = sm.getByRole('link', { name: /^เปิดใบเบิก / }).filter({ hasText: number });
    await expect(paid).toContainText('รอเซ็นใบเบิก', AFTER_PRESS);
    await expect(paid).not.toContainText('ยังไม่ได้เซ็นใบเบิก');
    await expect(paid.getByRole('link')).toHaveCount(0);
    await paid.click();
    await expect(sm.getByRole('heading', { level: 1, name: `ใบเบิก ${number}`, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(sm.locator('.mangmee-badge').first()).toHaveText('จ่ายแล้ว');
  });

  // Finish on each server record; all mutations above came through a person's screen.
  for (const record of records) {
    const saved = await json<ExpenseDetail>(await api.get(`companies/${SHOP}/expenses/${record.id}`, scope));
    expect(saved.status).toBe('CONFIRMED');
    expect(saved.vendorNameSnapshot).toBe(record.seller);
    expect(Number(saved.grandTotalAmount)).toBe(Number(record.amount));
    expect(saved.inputVatClaimStatus).toBe(record.invoice && vatStatus === 'UNKNOWN' ? 'NEEDS_REVIEW' : 'NON_CLAIMABLE');
    if (record.invoice) expect(Number(saved.vatAmount)).toBe(7);
    if (record.pay) {
      expect(saved.paymentStatus).toBe('PAID');
      expect(Number(saved.paidAmount)).toBe(85);
      expect(saved.payments).toHaveLength(1);
      expect(saved.attachments).toHaveLength(2); // original receipt and supporting payment slip
    }
  }
  const phone = await json<ExpenseDetail>(await api.get(`companies/${SHOP}/expenses/${phoneId}`, scope));
  expect(phone.status).toBe('CONFIRMED');
  expect(Number(phone.grandTotalAmount)).toBe(60);
  const certificate = await json<ExpenseDetail>(await api.get(`companies/${SHOP}/expenses/${certificateExpenseId}`, scope));
  expect(certificate.status).toBe('CONFIRMED');
  expect(certificate.paymentStatus).toBe('PAID');
  expect(certificate.substituteReceiptEvidence?.status).toBe('ISSUED');
  expect(Number(certificate.paidAmount)).toBe(40);
  const claim = await json<any>(await api.get(`companies/${SHOP}/reimbursements/${claimId}`, scope));
  expect(claim.status).toBe('PAID');
  expect(claim.paymentStatus).toBe('PAID');
  expect(Number(claim.amount)).toBe(95);
  expect(claim.payments).toHaveLength(1);
  expect(claim.payments[0]).toMatchObject({ status: 'RECORDED', paymentMethod: 'BANK_TRANSFER', slipCount: 1 });
});

}

test('@journey the never-answered VAT shop cannot un-answer on screen and can confirm plain receipts and full VAT invoices', async ({ pageAs, apiAs }) => {
  test.setTimeout(300_000);
  const owner = await pageAs('OWNER');
  const api = await apiAs('OWNER');
  const scope = { headers: { 'X-Company-Id': MAIN_SHOP } };
  await enter(owner, MAIN_SHOP);
  const policy = await json<any>(await api.get(`companies/${MAIN_SHOP}/expenses/capture-policy`, scope));
  // Fresh seed has only the obsolete CompanyTaxProfile bit, not a registration fact. Do not reset a shop by API.
  expect(policy).toMatchObject({ mode: 'FULL', vatStatus: 'UNKNOWN' });
  const vat = await vatAnswer(owner);
  await expect(vat).toHaveText('ยังไม่ได้ตอบ');
  await vat.click();
  await expect(owner.getByRole('option', { name: 'ยังไม่ได้ตอบ', exact: true })).toBeDisabled();
  await owner.keyboard.press('Escape');
  const receipt = await manual(owner, 'Head Office (สำนักงานใหญ่)', false, false, true, 'UNKNOWN');
  const invoice = await manual(owner, 'Head Office (สำนักงานใหญ่)', false, true, false, 'UNKNOWN');
  for (const record of [receipt, invoice]) {
    const saved = await json<ExpenseDetail>(await api.get(`companies/${MAIN_SHOP}/expenses/${record.id}`, scope));
    expect(saved.status).toBe('CONFIRMED');
    expect(Number(saved.grandTotalAmount)).toBe(Number(record.amount));
    expect(saved.inputVatClaimStatus).toBe(record.invoice ? 'NEEDS_REVIEW' : 'NON_CLAIMABLE');
    if (record.invoice) expect(Number(saved.vatAmount)).toBe(7);
    if (record.pay) {
      expect(saved.paymentStatus).toBe('PAID');
      expect(Number(saved.paidAmount)).toBe(85);
      expect(saved.attachments).toHaveLength(2);
    }
  }
  expect((await json<any>(await api.get(`companies/${MAIN_SHOP}/expenses/capture-policy`, scope))).vatStatus).toBe('UNKNOWN');
});


test('@journey a plain shop keeps withholding and explains the certificate and filing it must handle itself', async ({ pageAs, apiAs }) => {
  test.setTimeout(300_000);
  const shop = 'seed-local-plain-shop';
  const owner = await pageAs('OWNER');
  const api = await apiAs('OWNER');
  await enter(owner, shop);
  const expense = await recordExpenseByHand(owner, {
    branch: BRANCH, item: unique('ค่าบริการร้านทั่วไป'), seller: unique('ผู้ให้บริการร้านทั่วไป'),
    price: '1000', total: '1,000.00 บาท', toPay: '970.00 บาท', pay: true,
    withholding: {
      payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: 'ค่าบริการ (นิติบุคคล) · หัก 3%', rate: '3', withheld: '30.00 บาท',
      taxId: '0105564000128', address: '45 ถนนสีลม แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500',
    },
  });
  const main = owner.locator('main');
  await expect(main.getByText('แพ็กนี้ทำใบ 50 ทวิ ในระบบไม่ได้ ทำนอกระบบแล้วจดเลขที่ไว้', { exact: true })).toBeVisible(AFTER_PRESS);
  await expect(main.getByRole('button', { name: 'จดเลขที่ใบ 50 ทวิ', exact: true })).toBeEnabled();
  const saved = await json<ExpenseDetail>(await api.get(`companies/${shop}/expenses/${expense.expenseId}`, { headers: { 'X-Company-Id': shop } }));
  expect(saved.status).toBe('CONFIRMED');
  expect(saved.paymentStatus).toBe('PAID');
  expect(Number(saved.whtAmount)).toBe(30);
  expect(Number(saved.paidAmount)).toBe(970);
  await main.getByRole('button', { name: 'จดเลขที่ใบ 50 ทวิ', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: 'จดเลขที่ใบ 50 ทวิ ที่ทำนอกระบบ', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'เลขที่ใบ', exact: true })).toBeVisible();
  const paidDate = dialog.getByRole('combobox', { name: 'วันที่จ่ายตามหนังสือรับรองเดิม', exact: true });
  await expect(paidDate).toHaveText(thaiDate(new Date(saved.payments[0]!.paidAt)));
  await paidDate.click();
  const previous = owner.getByRole('button', { name: 'เดือนก่อนหน้า', exact: true });
  const calendar = owner.locator('div').filter({ has: previous }).filter({ has: owner.getByRole('button', { name: /^\d{1,2}$/ }) }).last();
  const days = calendar.getByRole('button', { name: /^\d{1,2}$/ });
  await expect(days.first()).toBeInViewport({ ratio: 1 });
  await expect(days.last()).toBeInViewport({ ratio: 1 });
  await paidDate.press('Escape');
  await expect(main).toContainText('จ่ายครบแล้ว ยังไม่ได้ทำใบ 50 ทวิ');
  await expect(dialog.getByText('ใบนี้ทำจากนอกระบบ ระบบเก็บเลขที่และไฟล์ไว้ให้ค้นเจอเท่านั้น', { exact: true })).toBeVisible();
  const externalNumber = unique('OUT');
  await dialog.getByRole('textbox', { name: 'เลขที่ใบ', exact: true }).fill(externalNumber);
  await dialog.getByRole('combobox', { name: 'วันที่ทำใบ', exact: true }).click();
  await owner.getByRole('button', { name: 'วันนี้', exact: true }).click();
  await dialog.getByLabel('แนบรูปหรือ PDF ของใบ (ถ้ามี)', { exact: true }).setInputFiles(picture('ใบ-50-ทวิ.png'));
  await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(dialog).toHaveCount(0, AFTER_PRESS);
  await expect(toast(owner, 'จดเลขที่แล้ว ย้ายไป "ทำใบแล้ว"')).toBeVisible(AFTER_PRESS);
  await expect(main).toContainText('จ่ายครบ และทำใบ 50 ทวิ นอกระบบแล้ว', AFTER_PRESS);
  const certificate = main.locator('section').filter({ has: owner.getByRole('heading', { name: 'หนังสือรับรอง 50 ทวิ', exact: true }) }).last();
  await expect(certificate).toContainText(externalNumber);
  await expect(certificate.getByText('ทำนอกระบบ', { exact: true })).toBeVisible();
  await certificate.getByRole('button', { name: 'ดูไฟล์', exact: true }).filter({ visible: true }).click();
  const preview = owner.getByRole('dialog', { name: 'ใบ-50-ทวิ.png', exact: true });
  const image = preview.getByRole('img');
  await expect(image).toBeVisible(AFTER_PRESS);
  await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth), AFTER_PRESS).toBeGreaterThan(0);
  await preview.getByRole('button', { name: 'ปิด', exact: true }).click();

});
