import type { Browser, Page } from '@playwright/test';
/**
 * Journey: a shop on the 999 package records a withheld payment, then the package becomes 1999 and the
 * SAME expense issues its 50 ทวิ at once: no new expense, no sign-out, nothing re-entered.
 *
 * Runs in its own seeded shop (seed-local-package-shop: the 999 menus, its owner only, nothing recorded),
 * so the shops the other journeys read keep their menus. The package is moved on the system admin's
 * partner page (ชุดเมนูสำเร็จรูป): a paid purchase writes the same feature set (TIER_FEATURE_PRESETS),
 * and a local stack cannot take a real payment. NEEDS A FRESHLY RESET DATABASE (the shop starts on 999).
 */
import { test, expect } from '../harness/fixtures';
import { watchScreenFit } from '../harness/screen-fit';
import { ensureBrowserLegalAcceptance, expectNoClientError, SEED_USERS } from '../harness/auth';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { AFTER_PRESS, FIRST_SIGHT, inOrder, pressForDownload, pressMenu, recordExpenseByHand } from './journey-kit';

const SHOP = 'seed-local-package-shop';
const SELF_ISSUE = 'แพ็กนี้ทำใบ 50 ทวิ ในระบบไม่ได้ ทำนอกระบบแล้วจดเลขที่ไว้';
type ExpenseDetail = { status: string; paymentStatus: string; whtAmount: string };

async function adminPage(browser: Browser) {
  const context = await browser.newContext({ viewport: { width: 1556, height: 960 } });
  const finishScreenFit = watchScreenFit(context, test.info());
  const page = await context.newPage();
  await page.goto('/login', FIRST_SIGHT);
  await page.locator('#login-identifier').fill(SEED_USERS.systemAdmin.username);
  await page.locator('#login-password').fill(SEED_USERS.systemAdmin.password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
  await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/|system\/)/, FIRST_SIGHT);
  await ensureBrowserLegalAcceptance(context);
  return { page, finishScreenFit };
}

async function openPackages(admin: Page) {
  await admin.goto(`/system/partners/${SHOP}?view=package`, FIRST_SIGHT);
  await expect(admin.getByRole('heading', { name: 'เมนูและฟีเจอร์ที่เปิดให้ใช้', exact: true })).toBeVisible(FIRST_SIGHT);
}

test('@journey a 999 shop records a withheld payment; after the package becomes 1999 the same expense issues its 50 ทวิ at once', async ({ pageAs, apiAs, browser }) => {
  test.setTimeout(420_000);
  const page = await pageAs('OWNER');
  const api = await apiAs('OWNER');
  page.setDefaultTimeout(30_000);
  await page.setViewportSize({ width: 1556, height: 960 });
  const main = page.locator('main');
  const nav = page.locator('aside nav');
  const certificateCard = main.locator('.mangmee-card').filter({ has: page.locator('h2#wht-certificate') });
  const payee = `${unique('บริษัท ซ่อมบำรุงทดลอง')} จำกัด`;
  const { page: admin, finishScreenFit } = await adminPage(browser);

  await test.step('system admin: the shop is on the 999 menus (ชุด เริ่มต้น)', async () => {
    await openPackages(admin);
    await expect(admin.getByRole('button', { name: 'เริ่มต้น ✓ ใช้อยู่', exact: true }), 'needs a freshly reset proof database').toBeVisible(AFTER_PRESS);
  });

  await test.step('owner on 999: no withholding page in the menu', async () => {
    await ensureBrowserLegalAcceptance(page.context(), SHOP);
    await page.goto(`/companies/${SHOP}/dashboard`, FIRST_SIGHT);
    await expect(nav).toBeVisible(FIRST_SIGHT);
    await expect(nav.getByRole('link', { name: 'คู่ค้า', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'ภาษีหัก ณ ที่จ่าย', exact: true })).toHaveCount(0);
  });

  await test.step('owner on 999: ข้อมูลร้าน gets the registered name, tax number and address', async () => {
    await pressMenu(page, 'ข้อมูลร้าน', 'ตั้งค่าร้าน');
    await expect(main.getByRole('heading', { level: 1, name: 'ข้อมูลร้าน', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('textbox', { name: /^ชื่อจดทะเบียน/ }).fill('บริษัท เปลี่ยนแพ็กเกจทดลอง จำกัด');
    await main.getByRole('textbox', { name: /^เลขผู้เสียภาษี/ }).fill('0105558000014');
    await main.getByRole('textbox', { name: 'รหัสไปรษณีย์', exact: true }).fill('10110');
    await expect(main.getByRole('combobox', { name: 'จังหวัด', exact: true })).toHaveText('กรุงเทพมหานคร', AFTER_PRESS);
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'อำเภอ / เขต', exact: true }), 'คลองเตย');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ตำบล / แขวง', exact: true }), 'คลองเตย');
    await main.getByRole('textbox', { name: 'ที่อยู่ (บ้านเลขที่ ถนน)', exact: true }).fill('88 ถนนพระราม 4');
    await main.getByRole('button', { name: 'บันทึกข้อมูลร้าน', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'บันทึกข้อมูลร้านแล้ว' }).first()).toBeVisible(AFTER_PRESS);
  });

  const expense = await test.step('owner on 999: a company paid with 3% withheld, confirmed and paid', () => recordExpenseByHand(page, {
    branch: 'สำนักงานใหญ่ (สำนักงานใหญ่)', item: unique('ค่าซ่อมบำรุงเครื่องปรับอากาศ'), seller: payee,
    price: '2000', total: '2,000.00 บาท', toPay: '1,940.00 บาท', pay: true,
    withholding: {
      payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: 'ค่าบริการ (นิติบุคคล) · หัก 3%', rate: '3', withheld: '60.00 บาท',
      taxId: '0105564000128', address: '45 ถนนสีลม แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500',
    },
  }));

  await test.step('owner on 999: the expense says the shop issues the certificate itself; no issue button', async () => {
    await expect(main.getByText(SELF_ISSUE, { exact: true })).toBeVisible(AFTER_PRESS);
    await expect(main.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true })).toHaveCount(0);
  });

  await test.step('system admin: แพ็กเกจ 1999 → ตรวจสอบและบันทึก → ยืนยันและบันทึก', async () => {
    await openPackages(admin);
    await admin.getByRole('button', { name: 'แพ็กเกจ 1999', exact: true }).click();
    await admin.getByRole('button', { name: 'ตรวจสอบและบันทึก', exact: true }).click();
    await admin.getByRole('button', { name: 'ยืนยันและบันทึก', exact: true }).click();
    await expect(admin.getByRole('button', { name: 'แพ็กเกจ 1999 ✓ ใช้อยู่', exact: true })).toBeVisible(AFTER_PRESS);
  });

  await test.step('owner, same session, one reload: the withholding page is in the menu and the self-issue line is gone', async () => {
    await page.reload(FIRST_SIGHT);
    await expect(main.getByRole('heading', { level: 1, name: payee, exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(nav.getByRole('link', { name: 'ภาษีหัก ณ ที่จ่าย', exact: true })).toBeVisible(AFTER_PRESS);
    await expect(main.getByText(SELF_ISSUE, { exact: true })).toHaveCount(0);
  });

  let certificateNumber = '';
  await test.step('the SAME expense: its 50 ทวิ card offers issuing; issue and download', async () => {
    const state = certificateCard.getByRole('status').filter({ hasText: /ยังไม่ออก|ออกแล้ว/ });
    await expect(state).toHaveText('ยังไม่ออก', AFTER_PRESS);
    await certificateCard.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'ออกหนังสือรับรอง 50 ทวิ ให้ผู้รับเงิน' });
    // The payee and amounts recorded on 999 are carried into the certificate as they are.
    await expect(dialog).toContainText(payee, AFTER_PRESS);
    await expect(dialog.getByText('จ่ายค่าอะไร', { exact: true })).toBeVisible();
    for (const fact of ['0-1055-64000-12-8', '2,000.00 บาท', '60.00 บาท']) await expect(dialog).toContainText(fact);
    const issue = dialog.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true });
    await expect(issue).toBeEnabled(AFTER_PRESS);
    const file = await pressForDownload(page, () => issue.click());
    expect(file.head).toBe('%PDF-');
    const issued = page.getByText(/^ออกหนังสือรับรองเลขที่ WHT-\d{4}-\d{5} แล้ว$/).first();
    await expect(issued).toBeVisible(AFTER_PRESS);
    certificateNumber = (await issued.innerText()).match(/WHT-\d{4}-\d{5}/)![0];
    await expect(state).toHaveText(inOrder('ออกแล้ว', `เลขที่ ${certificateNumber}`));
  });

  await test.step('หนังสือรับรอง 50 ทวิ (menu): the new certificate is listed', async () => {
    await pressMenu(page, 'หนังสือรับรอง 50 ทวิ', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'หนังสือรับรอง 50 ทวิ', exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('button', { name: /^ออกแล้ว/ }).click();
    await expect(main.locator('tr, [data-href]').filter({ visible: true }).filter({ hasText: certificateNumber }).first()).toContainText(payee, AFTER_PRESS);
  });

  await test.step('ภาษีหัก ณ ที่จ่าย (menu): the payment is in this month with its 50 ทวิ issued', async () => {
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await expect(main.getByRole('heading', { level: 1, name: 'ภาษีหัก ณ ที่จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    const row = main.locator('tr[data-href], div[data-href]').filter({ visible: true }).filter({ hasText: payee });
    await expect(row).toContainText('ออกแล้ว', AFTER_PRESS);
    const viewport = page.viewportSize();
    for (const width of [390, 1280, 1556]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(main.locator('thead th').filter({ hasText: /^จ่ายค่าอะไร$/ })).toHaveCount(1);
    }
    if (viewport) await page.setViewportSize(viewport);
  });

  await test.step('ลายเซ็นบน 50 ทวิ (menu) opens', async () => {
    await pressMenu(page, 'ลายเซ็นบน 50 ทวิ', 'ตั้งค่าร้าน');
    await expect(main.getByRole('heading', { level: 1 })).toContainText('50 ทวิ', FIRST_SIGHT);
    await expectNoClientError(page);
  });

  await test.step('server: the expense is the same one, confirmed, paid and withheld 60', async () => {
    const saved = await json<ExpenseDetail>(await api.get(`companies/${SHOP}/expenses/${expense.expenseId}`, { headers: { 'X-Company-Id': SHOP } }));
    expect(saved.status).toBe('CONFIRMED');
    expect(saved.paymentStatus).toBe('PAID');
    expect(Number(saved.whtAmount)).toBe(60);
  });
  try { await finishScreenFit(); } finally { await admin.context().close(); }
});
