/** Fresh isolated starter shop: waiting never blocks confirmation, and a reviewer decides later.
 * Labels/presses read from ExpenseInputVatRight, ExpensesPages, CompanyProfilePage and the evidence page.
 * No API writes: the API assertions only verify the facts produced by the screens. */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import type { ExpenseDetail } from '@watchdog-bms/contracts';
import { test, expect } from '../harness/fixtures';
import { ensureBrowserLegalAcceptance } from '../harness/auth';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { QA_ACCOUNTS } from '../harness/roles';
import { AFTER_PRESS, FIRST_SIGHT, idFromUrl, picture, pressForDownload, pressMenu, thaiDate, thaiMonth, xlsxSheetXml } from './journey-kit';

const SHOP = 'seed-local-input-vat-shop';
const BRANCH = 'สำนักงานใหญ่ (สำนักงานใหญ่)';
const scope = { headers: { 'X-Company-Id': SHOP } };
const ticks = ['ซื้อเพื่อใช้ในกิจการ', 'VAT นี้ไม่ใช่รายการที่กฎห้ามใช้ เช่น ค่าเลี้ยงรับรอง', 'ผู้ออกใบมีสิทธิออกใบกำกับภาษี'];
async function pick(page: Page, label: string, value: string) {
  const field = page.locator('main').getByRole('combobox', { name: label, exact: true });
  await expect(field).toBeVisible(AFTER_PRESS);
  if ((await field.innerText()).trim() !== value) await chooseThemedOption(page, field, value);
}
/** Step 3 keeps the draft summary; confirmed documents show only failing checks. */
const summaryCard = (page: Page) => page.locator('main .mangmee-card').filter({ has: page.getByRole('heading', { name: 'สรุปการตรวจ', exact: true }) });
async function enter(page: Page) {
  await ensureBrowserLegalAcceptance(page.context(), SHOP);
  await page.goto(`/companies/${SHOP}/dashboard`, FIRST_SIGHT);
}
async function openFromList(page: Page, seller: string, waiting = false) {
  await pressMenu(page, 'รายการค่าใช้จ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
  const main = page.locator('main');
  await expect(main.getByRole('heading', { name: 'รายการค่าใช้จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
  await expect(main.getByRole('combobox', { name: 'ใช้ VAT ตอนยื่นภาษี', exact: true })).toHaveCount(0);
  await main.getByRole('searchbox', { name: 'ค้นหาผู้ขายหรือเลขที่', exact: true }).fill(seller);
  // Wide rows and phone buttons are separate renderings of the same source row.
  const row = main.getByTestId('expenses-row').filter({ hasText: seller }).filter({ visible: true });
  await expect(row).toBeVisible(AFTER_PRESS);
  if (waiting) await expect(row.getByText('รอตรวจ VAT สำหรับยื่นภาษี', { exact: true })).toBeVisible();
  await row.getByText(seller, { exact: true }).first().click();
  await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(FIRST_SIGHT);
}
async function manualDraft(page: Page, seller: string, withImage = true) {
  const main = page.locator('main');
  await pressMenu(page, 'บันทึกด้วยมือ', 'ค่าใช้จ่ายและใบเสร็จ');
  await expect(main.getByRole('heading', { level: 1, name: 'บันทึกด้วยมือ', exact: true })).toBeVisible(FIRST_SIGHT);
  await pick(page, 'สาขา', BRANCH);
  await main.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true }).fill(unique('ของใช้ในร้าน'));
  await main.getByRole('combobox', { name: 'ชื่อผู้ขาย', exact: true }).fill(seller);
  await main.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill('107');
  if (withImage) {
    await main.locator('input[type="file"]').first().setInputFiles(picture(`${seller}.png`));
    await expect(main.getByRole('button', { name: 'นำไฟล์ออก', exact: true })).toBeVisible(AFTER_PRESS);
  }
  await main.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect(main.getByRole('heading', { level: 1, name: seller, exact: true })).toBeVisible(FIRST_SIGHT);
  return idFromUrl(page);
}
async function reviewPaper(page: Page, invoice: boolean, originalNote?: string) {
  const main = page.locator('main');
  await pick(page, 'รูปแบบ VAT', 'VAT รวมในราคา');
  await pick(page, 'อัตรา VAT', 'มี VAT 7%');
  await pick(page, 'บนใบพิมพ์ VAT ไว้แบบไหน', 'ทั้ง % และจำนวนเงิน');
  await main.getByRole('spinbutton', { name: 'อัตรา VAT จากเอกสาร (%)', exact: true }).fill('7');
  await main.getByRole('spinbutton', { name: 'VAT จากเอกสาร (บาท)', exact: true }).fill('7');
  await expect(main.getByRole('textbox', { name: 'เลขประจำตัวผู้เสียภาษีผู้ขาย', exact: true })).toBeVisible();
  await main.getByRole('textbox', { name: 'เลขประจำตัวผู้เสียภาษีผู้ขาย', exact: true }).fill('0105558000014');
  await main.locator('input[id^="expense-document-number-"]').fill(unique('VAT'));
  await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
  await pick(page, 'ประเภทเอกสาร', invoice ? 'ใบกำกับภาษี (เต็มรูป)' : 'ใบเสร็จรับเงิน');
  await expect(main.getByRole('combobox', { name: 'ใช้เป็นหลักฐานรายจ่ายได้ไหม', exact: true }))
    .toHaveText(invoice ? 'ใช้ได้' : 'ใช้ได้เมื่อมีหลักฐานอื่นประกอบ');
  if (invoice) await expect(main.getByText('มีใบกำกับภาษีเต็มรูป รอตรวจ VAT สำหรับยื่นภาษี', { exact: true })).toBeVisible();
  await pick(page, 'ใช้เป็นหลักฐานรายจ่ายได้ไหม', 'ใช้ได้');
  if (originalNote !== undefined) {
    await main.getByRole('checkbox', { name: 'มีตัวจริง ยังไม่ได้แนบรูป', exact: true }).check();
    await main.getByRole('textbox', { name: 'หมายเหตุ', exact: true }).fill(originalNote);
  }
  await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ตรวจสรุป' })).toBeVisible(AFTER_PRESS);
}
async function assertPhoneConditions(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const conditions = page.locator('main').getByRole('region', { name: 'ใช้ VAT ตอนยื่นภาษี', exact: true });
  await expect(conditions).toBeVisible();
  // Measured once the page has settled: for about 0.1 s after 1556 → 390 the header and title are still
  // laid out for the wide window (scrollWidth 396–405, seen 2026-10-14), then everything fits. A phone never resizes.
  await expect(async () => {
    const box = await conditions.boundingBox(); expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    for (const label of ticks) {
      await expect(conditions.getByRole('checkbox', { name: label, exact: true })).toBeVisible();
      const labelBox = await conditions.locator('label').filter({ hasText: label }).boundingBox();
      expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(390);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }).toPass({ timeout: 5_000 });
}
function sheetRows(file: Buffer): string[][] {
  const xml = xlsxSheetXml(file, 'รายการค่าใช้จ่าย');
  expect(xml).toContain('<sheetData>');
  const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row => [...row[1]!.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(cell => decode(cell[1]!.match(/<t\b[^>]*>([\s\S]*?)<\/t>|<v>([^<]*)<\/v>/)?.slice(1).find(v => v !== undefined) ?? '')));
}

test('@journey input VAT: unknown shop answers from its link, waiting confirms, owner decides later, staff reads facts, accountant receives both answers', async ({ pageAs, apiAs }) => {
  test.setTimeout(420_000);
  const owner = await pageAs('OWNER'), staff = await pageAs('STAFF'), api = await apiAs('OWNER');
  owner.setDefaultTimeout(30_000); staff.setDefaultTimeout(30_000);
  await owner.setViewportSize({ width: 1556, height: 1000 }); await staff.setViewportSize({ width: 390, height: 844 });
  const main = owner.locator('main');
  await enter(owner); await enter(staff);
  const policy = await json<any>(await api.get(`companies/${SHOP}/expenses/capture-policy`, scope));
  expect(policy.vatStatus, 'Reset the proof database: this isolated journey starts with an unanswered VAT question.').toBe('UNKNOWN');
  await test.step('waiting list offers the shop question; answer yes and save shop facts through the screen', async () => {
    // Owner 2026-10-15: the expense list no longer carries the shop's VAT reminder; the question lives in ข้อมูลร้าน
    // (and on an expense's VAT card, see below).
    await owner.goto(`/companies/${SHOP}/settings/profile#shop`);
    await expect(main.getByRole('heading', { name: 'ข้อมูลร้าน', exact: true })).toBeVisible(FIRST_SIGHT);
    await pick(owner, 'ร้านจดทะเบียน VAT หรือยัง', 'จดทะเบียน VAT แล้ว');
    await main.getByRole('button', { name: 'บันทึกข้อมูลร้าน', exact: true }).click();
    await expect(owner.getByRole('status').filter({ hasText: 'บันทึกข้อมูลร้านแล้ว' }).first()).toBeVisible(AFTER_PRESS);
  });
  const invoiceSeller = unique('ร้านใบกำกับภาษีทดลอง'), receiptSeller = unique('ร้านใบเสร็จทดลอง');
  // The staff records this paper, so she can read it later through her own-expense permission.
  const invoiceId = await test.step('staff records the paper by hand without judging its VAT right', () => manualDraft(staff, invoiceSeller));
  await test.step('owner chooses full tax invoice; waiting is a fact, incomplete ticks refuse only the decision', async () => {
    await openFromList(owner, invoiceSeller); await reviewPaper(owner, true);
    await expect(summaryCard(owner).getByText('ใช้ VAT ตอนยื่นภาษี: รอตรวจสอบ', { exact: true })).toBeVisible();
    await main.getByRole('button', { name: 'กลับ', exact: true }).click();
    await pick(owner, 'ใช้ VAT ตอนยื่นภาษี', 'ใช้ได้ตามเงื่อนไข');
    await expect(main.getByText('กรอกชื่อจดทะเบียนและเลขผู้เสียภาษีของร้านที่ข้อมูลร้าน', { exact: true })).toBeVisible();
    await expect(main.getByRole('checkbox', { name: 'ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบแล้ว ตรงกับข้อมูลร้าน', exact: true })).toHaveCount(0);
    const shopLink = main.getByRole('link', { name: 'ตั้งค่าร้าน › ข้อมูลร้าน', exact: true });
    const destination = new URL((await shopLink.getAttribute('href'))!, owner.url());
    expect(destination.searchParams.get('returnTo')).toBe(`/companies/${SHOP}/expenses/${invoiceId}#expense-input-vat-${invoiceId}`);
    await shopLink.click();
    await expect(main.getByRole('heading', { name: 'ข้อมูลร้าน', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('textbox', { name: /^ชื่อจดทะเบียน/ }).fill('บริษัท ทดลองภาษีซื้อ จำกัด');
    await main.getByRole('textbox', { name: /^เลขผู้เสียภาษี/ }).fill('0105558000014');
    await main.getByRole('textbox', { name: 'รหัสไปรษณีย์', exact: true }).fill('10110');
    await expect(main.getByRole('combobox', { name: 'จังหวัด', exact: true })).toHaveText('กรุงเทพมหานคร', AFTER_PRESS);
    await pick(owner, 'อำเภอ / เขต', 'คลองเตย'); await pick(owner, 'ตำบล / แขวง', 'คลองเตย');
    await main.getByRole('textbox', { name: 'ที่อยู่ (บ้านเลขที่ ถนน)', exact: true }).fill('88 ถนนพระราม 4');
    await main.getByRole('button', { name: 'บันทึกข้อมูลร้าน', exact: true }).click();
    await expect(owner.getByRole('status').filter({ hasText: 'บันทึกข้อมูลร้านแล้ว' }).first()).toBeVisible(AFTER_PRESS);
    await main.getByRole('link', { name: 'กลับไปตรวจ VAT สำหรับยื่นภาษี', exact: true }).last().click();
    await expect(owner).toHaveURL(new RegExp(`/expenses/${invoiceId}#expense-input-vat-${invoiceId}$`));
    await expect(main.getByRole('region', { name: 'ใช้ VAT ตอนยื่นภาษี', exact: true })).toBeVisible(AFTER_PRESS);
    await pick(owner, 'ใช้ VAT ตอนยื่นภาษี', 'ใช้ได้ตามเงื่อนไข');
    await main.getByRole('checkbox', { name: 'ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบแล้ว ตรงกับข้อมูลร้าน', exact: true }).check();
    await expect(main.getByText('✓ ชื่อและเลขผู้เสียภาษีของร้านบนใบตรงกับข้อมูลร้าน', { exact: true })).toBeVisible();
    await expect(main.getByText('ยังไม่ครบ: ชื่อและเลขผู้เสียภาษีของร้านบนใบตรงกับข้อมูลร้าน', { exact: true })).toHaveCount(0);
    await assertPhoneConditions(owner);
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(main.getByRole('alert').filter({ hasText: 'ติ๊กเงื่อนไขให้ครบก่อนเลือก “ใช้ได้ตามเงื่อนไข”' })).toBeVisible(AFTER_PRESS);
    await pick(owner, 'ใช้ VAT ตอนยื่นภาษี', 'รอตรวจสอบ');
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await owner.setViewportSize({ width: 390, height: 844 });
    const bar = main.locator('[data-form-action-bar]').filter({ has: owner.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }) });
    await expect(bar.locator('.mangmee-actions')).toHaveAttribute('data-layout', 'stack');
    const confirmBox = await bar.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).boundingBox();
    const backBox = await bar.getByRole('button', { name: 'กลับ', exact: true }).boundingBox();
    expect(confirmBox!.y).toBeLessThan(backBox!.y);
    expect(confirmBox!.width).toBe(backBox!.width);
    expect(confirmBox!.height).toBeLessThanOrEqual(44);
    await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
    await expect(owner.getByText('ยืนยันเอกสารแล้ว', { exact: true }).first()).toBeVisible(AFTER_PRESS);
    const detail = await json<ExpenseDetail>(await api.get(`companies/${SHOP}/expenses/${invoiceId}`, scope));
    expect(detail.status).toBe('CONFIRMED'); expect(detail.inputVatClaimStatus).toBe('NEEDS_REVIEW');
    expect(detail.inputVatRight?.latestDecision).toBeNull(); expect(detail.inputVatRight?.postsToLedger).toBe(false);
    await expect(main.locator('.mangmee-page-header').getByText('ใช้ VAT ตอนยื่นภาษี: รอตรวจสอบ', { exact: true })).toBeVisible();
  });
  await test.step('filter the waiting list, decide after confirmation, and read who and when', async () => {
    await owner.setViewportSize({ width: 1556, height: 1000 }); await openFromList(owner, invoiceSeller, true);
    await main.getByRole('button', { name: 'ตรวจ VAT สำหรับยื่นภาษี', exact: true }).click();
    await pick(owner, 'ใช้ VAT ตอนยื่นภาษี', 'ใช้ได้ตามเงื่อนไข'); await assertPhoneConditions(owner);
    await main.getByRole('checkbox', { name: 'ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบแล้ว ตรงกับข้อมูลร้าน', exact: true }).check();
    for (const label of ticks) await main.getByRole('checkbox', { name: label, exact: true }).check();
    await main.getByRole('button', { name: 'บันทึกคำตอบเรื่อง VAT', exact: true }).click();
    const facts = main.locator(`#expense-document-review-${invoiceId}`);
    await expect(main.locator('dt').filter({ hasText: /^ใช้ VAT ตอนยื่นภาษี$/ })).toHaveCount(1);
    await expect(main.locator('dt').filter({ hasText: /^หลักฐานรายจ่าย$/ })).toHaveCount(1);
    await expect(facts.getByText('ใช้ได้ตามเงื่อนไข', { exact: true })).toBeVisible(AFTER_PRESS);
    await expect(facts.getByText(`ตรวจโดย ${QA_ACCOUNTS.OWNER.displayName}`, { exact: false })).toContainText(thaiDate());
    await expect(summaryCard(owner)).toHaveCount(0);
    await expect(main.getByRole('heading', { name: 'รายละเอียดเอกสาร', exact: true })).toBeVisible();
    await facts.getByRole('button', { name: 'เปลี่ยนคำตอบเรื่อง VAT', exact: true }).click();
    const reason = facts.getByRole('textbox', { name: 'เหตุผลที่เลือกใช้ VAT ตอนยื่นภาษี', exact: true });
    await expect(reason).toBeVisible();
    for (const label of ticks) await expect(facts.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
    await expect(facts.getByRole('checkbox', { name: 'ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบแล้ว ตรงกับข้อมูลร้าน', exact: true })).toBeChecked();
    await expect(facts.getByText('ยังไม่ครบ: ชื่อและเลขผู้เสียภาษีของร้านบนใบตรงกับข้อมูลร้าน', { exact: true })).toHaveCount(0);
    await expect(facts.locator('dt').filter({ hasText: /^ใช้ VAT ตอนยื่นภาษี$/ })).toHaveCount(0);
    const form = facts.getByRole('region', { name: 'ใช้ VAT ตอนยื่นภาษี', exact: true });
    for (const width of [390, 1556]) {
      await owner.setViewportSize({ width, height: 1000 });
      await expect(form).toHaveCSS('text-align', 'left');
      // Both boxes in one frame, polled: after a resize the shell still animates its columns for a moment.
      await expect.poll(async () => form.evaluate((section, label) => {
        const field = section.querySelector(`textarea[aria-label="${label}"]`)!.getBoundingClientRect(), box = section.getBoundingClientRect();
        return field.x === box.x && field.width > box.width - 4;
      }, 'เหตุผลที่เลือกใช้ VAT ตอนยื่นภาษี')).toBe(true);
    }

    const reasonBox = await reason.boundingBox();
    const rightBox = await facts.getByRole('combobox', { name: 'ใช้ VAT ตอนยื่นภาษี', exact: true }).boundingBox();
    expect(reasonBox!.y).toBeLessThan(rightBox!.y);
    await facts.getByRole('button', { name: 'กลับ', exact: true }).click();
    const detail = await json<ExpenseDetail>(await api.get(`companies/${SHOP}/expenses/${invoiceId}`, scope));
    expect(detail.status).toBe('CONFIRMED'); expect(detail.inputVatClaimStatus).toBe('CLAIMABLE');
    expect(detail.inputVatRight?.latestDecision?.conditions.every(c => c.answer)).toBe(true);
    expect(detail.inputVatRight?.latestDecision?.decidedByName).toBe(QA_ACCOUNTS.OWNER.displayName);
  });
  await test.step('staff reads both saved answers with no decision controls at phone width', async () => {
    await staff.reload();
    const sm = staff.locator('main'), facts = sm.locator(`#expense-document-review-${invoiceId}`);
    await expect(facts.locator('dt').filter({ hasText: /^หลักฐานรายจ่าย$/ }).locator('..').locator('dd')).toHaveText('ใช้ได้', AFTER_PRESS);
    await expect(facts.getByText('ใช้ได้ตามเงื่อนไข', { exact: true })).toBeVisible();
    await expect(sm.getByRole('button', { name: 'ตรวจ VAT สำหรับยื่นภาษี', exact: true })).toHaveCount(0);
    await expect(sm.getByRole('button', { name: 'เปลี่ยนคำตอบเรื่อง VAT', exact: true })).toHaveCount(0);
    await expect(sm.getByRole('combobox', { name: 'ใช้ VAT ตอนยื่นภาษี', exact: true })).toHaveCount(0);
    for (const label of ticks) await expect(sm.getByRole('checkbox', { name: label, exact: true })).toHaveCount(0);
  });
  let receiptId = '';
  await test.step('ordinary receipt with VAT is usable expense evidence, with a fixed nonclaimable right', async () => {
    await owner.setViewportSize({ width: 1556, height: 1000 }); receiptId = await manualDraft(owner, receiptSeller); await reviewPaper(owner, false);
    await expect(summaryCard(owner).getByText('หลักฐานรายจ่าย: ใช้ได้', { exact: true })).toBeVisible();
    await expect(summaryCard(owner).getByText('ใช้ VAT ตอนยื่นภาษี: ใช้ไม่ได้', { exact: true })).toBeVisible();
    await main.getByRole('button', { name: 'กลับ', exact: true }).click();
    const step2 = main.locator(`#expense-document-review-${receiptId}`);
    await expect(step2.getByText('ใช้ VAT ตอนยื่นภาษี: ใช้ไม่ได้', { exact: true })).toBeVisible();
    await expect(step2.getByText('เอกสารนี้ใช้ VAT ตอนยื่นภาษีไม่ได้', { exact: true })).toBeVisible();
    await expect(main.getByRole('combobox', { name: 'ใช้ VAT ตอนยื่นภาษี', exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
    await expect(owner.getByText('ยืนยันเอกสารแล้ว', { exact: true }).first()).toBeVisible(AFTER_PRESS);
  });
  await test.step('accounting office workbook carries both rows with accountant columns and shared Thai words', async () => {
    await pressMenu(owner, 'หลักฐานทางบัญชี', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'หลักฐานทางบัญชี', exact: true })).toBeVisible(FIRST_SIGHT);
    const month = main.getByRole('combobox', { name: 'เดือน', exact: true });
    // Choosing the already-current month starts an unnecessary route replacement during the export press.
    if (!(await month.innerText()).trim().startsWith(thaiMonth())) {
      await month.click();
      await owner.getByRole('option', { name: new RegExp(`^${thaiMonth().replace(/\./g, '\\.')} · \\d+ รายการ`) }).click();
      await owner.waitForURL(/\/expenses\/evidence\?/, FIRST_SIGHT);
    }
    await expect(main.getByRole('link').filter({ hasText: invoiceSeller }).filter({ visible: true })).toBeVisible(AFTER_PRESS);
    // Export Phase 2.2: the evidence card shows ดาวน์โหลด Excel beside the bundle button, no เพิ่มเติม menu.
    const file = await pressForDownload(owner, () => main.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click());
    const [headers, ...rows] = sheetRows(await readFile((await file.download.path())!));
    expect(headers).toContain('สิทธิภาษีซื้อ');
    // e-WHT plan 1.x appends its remittance column last; the earlier columns keep their places.
    expect(headers!.slice(-5)).toEqual(['วันที่จ่ายล่าสุด', 'สำรองจ่ายโดย', 'สถานะ', 'หมายเหตุ', 'วิธีนำส่งภาษีหัก ณ ที่จ่าย']);
    for (const removed of ['ผู้ตรวจสิทธิภาษีซื้อ', 'วันเวลาที่ตรวจสิทธิภาษีซื้อ', 'เหตุผลสิทธิภาษีซื้อ', 'เลขใบสำคัญจ่าย', 'เลขหนังสือรับรอง 50 ทวิ', 'ชื่อไฟล์ในชุดเอกสาร']) expect(headers).not.toContain(removed);
    expect(headers).toContain('หมายเหตุ');
    const cell = (row: string[], label: string) => row[headers!.indexOf(label)];
    const invoice = rows.find(row => cell(row, 'ผู้ขาย/ผู้รับเงิน') === invoiceSeller)!;
    const receipt = rows.find(row => cell(row, 'ผู้ขาย/ผู้รับเงิน') === receiptSeller)!;
    expect(invoice).toBeDefined(); expect(receipt).toBeDefined();
    for (const row of [invoice, receipt]) expect(cell(row, 'หลักฐานรายจ่าย')).toBe('ใช้ได้');
    expect(cell(invoice, 'สิทธิภาษีซื้อ')).toBe('ใช้ได้ตามเงื่อนไข');
    expect(cell(receipt, 'สิทธิภาษีซื้อ')).toBe('ใช้ไม่ได้');
    const saved = await json<ExpenseDetail>(await api.get(`companies/${SHOP}/expenses/${receiptId}`, scope));
    expect(saved.inputVatClaimStatus).toBe('NON_CLAIMABLE'); expect(saved.inputVatRight?.latestDecision).toBeNull();
  });
  await test.step('one download from the expense list includes the papers and their Excel index', async () => {
    await pressMenu(owner, 'รายการค่าใช้จ่าย', 'ค่าใช้จ่ายและใบเสร็จ');
    // The menu press returns before the list has arrived; open the export on the list that is showing.
    await owner.waitForURL(/\/expenses(\?.*)?$/, FIRST_SIGHT);
    await expect(main.getByTestId('expenses-summary')).toBeVisible(FIRST_SIGHT);
    await main.getByRole('button', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true }).click();
    const dialog = owner.getByRole('dialog', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true });
    // One line: the file count, then only the kinds of paper the bundle holds (a kind with none is left out).
    await expect(dialog.getByRole('status').filter({ hasText: /^\d+ ไฟล์ · / })).toHaveText(
      /^\d+ ไฟล์ · เอกสารค่าใช้จ่าย [1-9]\d*(?: · (?:ใบรับรองแทนใบเสร็จ|หลักฐานการจ่าย|ใบสำคัญจ่าย|เอกสารประกอบการจ่าย|50 ทวิ|ใบเบิก|ชุดเอกสารรายการ) [1-9]\d*)*$/, AFTER_PRESS);
    const download = await pressForDownload(owner, () => dialog.getByRole('button', { name: 'ดาวน์โหลดไฟล์ทั้งหมด', exact: true }).click());
    const zip = await readFile((await download.download.path())!);
    const files = new Map<string, Buffer>();
    for (let offset = 0; zip.readUInt32LE(offset) === 0x04034b50;) {
      const size = zip.readUInt32LE(offset + 18), length = zip.readUInt16LE(offset + 26);
      const name = zip.subarray(offset + 30, offset + 30 + length).toString();
      const start = offset + 30 + length + zip.readUInt16LE(offset + 28);
      files.set(name, zip.subarray(start, start + size)); offset = start + size;
    }
    expect(files.has('สารบัญ.xlsx')).toBe(true);
    const [headers, ...rows] = sheetRows(files.get('สารบัญ.xlsx')!);
    for (const seller of [invoiceSeller, receiptSeller]) {
      const row = rows.find(row => row[headers!.indexOf('ผู้ขาย/ผู้รับเงิน')] === seller);
      expect(row).toBeDefined();
      // Each row links to one record PDF; the original receipt stays in its own folder too.
      const packet = row![headers!.indexOf('เอกสารรายการ (PDF)')]!;
      expect(packet).toMatch(/^ชุดเอกสารรายการ\/EXP-.*\.pdf$/);
      expect(files.has(packet), packet).toBe(true);
      const number = packet.slice('ชุดเอกสารรายการ/'.length, -'.pdf'.length);
      expect([...files.keys()].some(name => name.startsWith(`เอกสารค่าใช้จ่าย/${number}`))).toBe(true);
    }
    // Downloading keeps the bundle dialog open so a person can download it again.
    await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
    await expect(dialog).toBeHidden(AFTER_PRESS);
  });
  await test.step('original paper without an image keeps VAT credit; later selecting its photo clears the reminder', async () => {
    // Reopen the full tax invoice, leaving the ordinary receipt's nonclaimable result intact.
    const seller = invoiceSeller, id = invoiceId, note = 'อยู่กับผู้ทำบัญชี';
    await openFromList(owner, seller);
    expect(idFromUrl(owner)).toBe(id);
    await main.getByRole('button', { name: 'แก้ไขเอกสาร', exact: true }).click();
    const reopen = owner.getByRole('dialog', { name: 'แก้ไขเอกสาร', exact: true });
    await reopen.getByRole('textbox', { name: 'เหตุผลที่แก้ไข', exact: true }).fill('ตรวจใบกำกับตัวจริงที่ยังไม่ได้แนบรูป');
    await reopen.getByRole('button', { name: 'เปิดเอกสารกลับไปตรวจสอบ', exact: true }).click();
    await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ตรวจข้อมูล' })).toBeVisible(AFTER_PRESS);
    await main.locator('summary').filter({ hasText: 'ตัวเลือกไฟล์' }).filter({ visible: true }).click();
    await main.getByRole('button', { name: `ลบไฟล์ ${seller}.png`, exact: true }).filter({ visible: true }).click();
    const remove = owner.getByRole('dialog', { name: 'ลบไฟล์นี้ออกจากรายการ?', exact: true });
    await remove.getByRole('button', { name: 'ลบไฟล์', exact: true }).click();
    await expect(owner.getByRole('status').filter({ hasText: 'ลบไฟล์ออกจากรายการแล้ว' }).first()).toBeVisible(AFTER_PRESS);
    await reviewPaper(owner, true, note);
    await expect(summaryCard(owner)).toContainText('ยังไม่มีรูปเอกสาร');
    // Removing the primary file clears its review and tax selections; choose the code before claiming VAT.
    await main.getByRole('button', { name: '1 ตรวจข้อมูล', exact: true }).click();
    await pick(owner, 'รูปแบบ VAT ของรายการ', 'ใช้ VAT ตอนยื่นภาษีได้ 7%');
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
    await pick(owner, 'ใช้ VAT ตอนยื่นภาษี', 'ใช้ได้ตามเงื่อนไข');
    await main.getByRole('textbox', { name: 'เหตุผลที่เลือกใช้ VAT ตอนยื่นภาษี', exact: true }).fill('ตรวจใบกำกับตัวจริงแล้ว ยังไม่ได้แนบรูป');
    await expect(main.getByText('✓ มีเอกสารตัวจริง', { exact: true })).toBeVisible(AFTER_PRESS);
    await main.getByRole('checkbox', { name: 'ตรวจชื่อและเลขผู้เสียภาษีของร้านบนใบแล้ว ตรงกับข้อมูลร้าน', exact: true }).check();
    for (const label of ticks) await main.getByRole('checkbox', { name: label, exact: true }).check();
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true })).toBeEnabled(AFTER_PRESS);
    await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
    await expect(owner.getByText('ยืนยันเอกสารแล้ว', { exact: true }).first()).toBeVisible(AFTER_PRESS);
    await expect(main.getByTestId('expense-evidence-checks')).toContainText('ยังไม่มีรูปเอกสาร');
    const before = await json<ExpenseDetail>(await api.get(`companies/${SHOP}/expenses/${id}`, scope));
    expect(before.status).toBe('CONFIRMED'); expect(before.sourceDocumentType).toBe('TAX_INVOICE');
    expect(before.vendorNameSnapshot).toBe(invoiceSeller);
    expect(before.lines.filter(line => Number(line.vatAmount) > 0)).toHaveLength(1);
    expect(before.lines.filter(line => Number(line.vatAmount) > 0).every(line => line.taxSnapshot?.taxCodeDefinitionId && line.taxSnapshot.claimability === 'CLAIMABLE')).toBe(true);
    expect(before.attachments).toHaveLength(0); expect(before.inputVatClaimStatus).toBe('CLAIMABLE'); expect(before.taxEvidenceStatus).toBe('USABLE_FOR_TAX');
    expect((before.aiVerificationSummaryJson?.documentEvidenceDraft as any).note).toBe(note);
    await main.getByRole('button', { name: 'แก้ไขเอกสาร', exact: true }).click();
    const correction = owner.getByRole('dialog', { name: 'แก้ไขเอกสาร', exact: true });
    await correction.getByRole('textbox', { name: 'เหตุผลที่แก้ไข', exact: true }).fill('แนบรูปใบกำกับตัวจริง');
    await correction.getByRole('button', { name: 'เปิดเอกสารกลับไปตรวจสอบ', exact: true }).click();
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
    await main.getByRole('button', { name: 'ไม่มีใบเสร็จ หรือใบเสร็จมีปัญหา', exact: true }).click();
    const image = picture(`${seller}.png`);
    await main.getByLabel('แนบไฟล์', { exact: true }).setInputFiles(image);
    await expect(owner.getByRole('status').filter({ hasText: 'แนบไฟล์ใบเสร็จแล้ว' }).first()).toBeVisible(AFTER_PRESS);
    await main.getByRole('checkbox', { name: image.name, exact: true }).check();
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(summaryCard(owner).getByText('ยังไม่มีรูปเอกสาร', { exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
    await expect(owner.getByText('ยืนยันเอกสารแล้ว', { exact: true }).first()).toBeVisible(AFTER_PRESS);
    await expect(main.getByTestId('expense-evidence-checks').getByText('ยังไม่มีรูปเอกสาร', { exact: true })).toHaveCount(0);
    const after = await json<ExpenseDetail>(await api.get(`companies/${SHOP}/expenses/${id}`, scope));
    expect(after.attachments).toHaveLength(1); expect(after.inputVatClaimStatus).toBe('CLAIMABLE');
  });

});


test('@journey PWS capture offers the expense guide when VAT options cannot be loaded', async ({ pageAs }) => {
  const owner = await pageAs('OWNER');
  await owner.setViewportSize({ width: 390, height: 844 });
  await enter(owner);
  const definitions = `**/companies/${SHOP}/tax/code-definitions*`;
  await owner.route(definitions, route => route.fulfill({ status: 503, json: { message: 'โหลดรูปแบบ VAT ไม่สำเร็จ' } }));
  try {
    await pressMenu(owner, 'บันทึกด้วยมือ', 'ค่าใช้จ่ายและใบเสร็จ');
    const selector = owner.getByTestId('transaction-tax-selector');
    await expect(selector.getByRole('combobox', { name: 'รูปแบบ VAT ของรายการ', exact: true })).toBeVisible(AFTER_PRESS);
    await expect(selector.locator('a[href*="accounting-tax-setup"]')).toHaveCount(0);
    await selector.getByRole('link', { name: 'เปิดคู่มือค่าใช้จ่าย', exact: true }).click();
    await expect(owner).toHaveURL(new RegExp(`/companies/${SHOP}/user-guide/expenses$`));
  } finally { await owner.unroute(definitions); }
});
