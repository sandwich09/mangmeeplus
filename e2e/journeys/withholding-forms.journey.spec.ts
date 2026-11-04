import { E_WHT_WORDS } from '@watchdog-bms/contracts';
import { eWhtPayeeTaxId, openEWhtMonth, printedPdfPages, setEWhtSetting, withEWhtBranch, workbookXml } from './e-wht-journey-kit';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
/**
 * Journey: withholding tax in one place, from three paid expenses to the month marked as filed.
 *
 * Runs in the second seeded shop (Bloom Beauty Clinic), which starts empty: marking a month as filed
 * locks it, and the shop's registered name, tax number and address are filled in on the way. So this
 * journey NEEDS A FRESHLY RESET DATABASE and says so before it presses anything.
 *
 * The defect it walks over: the withholding page showed one fault per press and never dropped a
 * fault that had been fixed.
 */
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import {
  AFTER_PRESS, FIRST_SIGHT, MAIN_SHOP, SECOND_SHOP, dayOfLastMonth, inOrder, periodKey, pressForDownloadBuffer, pressForDownload, pressMenu, recordExpenseByHand,
  thaiDate, thaiMonth, fillShopIdentity,
} from './journey-kit';

const metricText = (value: string, unit: string) => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*${unit}$`);
async function expectFormTotals(card: Locator, count: number, paid: string, withheld: string, due: string) {
  await expect(card.locator('.mangmee-unit')).toHaveText([metricText(String(count), 'รายการ'), metricText(paid, 'บาท'), metricText(withheld, 'บาท')], AFTER_PRESS);
  await expect(card.getByText(`กำหนดยื่น ${due}`, { exact: true })).toBeVisible();
  await expect(card).not.toContainText('฿');
}
const paymentRows = (main: Locator) => main.locator('tr[data-href], div[data-href]').filter({ visible: true });

type WithholdingForm = { formType: 'PND3' | 'PND53'; status: string; paymentCount: number; totalWithheld: string; papers?: Array<{ id: string; sequence: number; status: string; paymentCount: number; cancellations?: Array<{ sourceId: string; payeeName: string }> }> };
type WithholdingMonth = { forms: WithholdingForm[]; establishments: Array<{ code: string; name: string; forms: WithholdingForm[] }> };
type ExpenseDetail = { status: string; paymentStatus: string; whtAmount: string };

/** Read only, using the same generated client/build and local database as the running proof API. */
async function filedRows(period: string) {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required to prove frozen filing rows');
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(connectionString).hostname);
  const apiRequire = createRequire(resolve('apps/api/package.json'));
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const dist = process.env['API_DIST_DIR'] ?? `dist/e2e-${process.env['API_PORT'] ?? '3001'}`;
  const { PrismaClient } = apiRequire(resolve(`apps/api/${dist}/apps/api/src/generated/prisma/client.js`));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    return await db.whtFiling.findMany({ where: { companyId: SECOND_SHOP, periodKey: period, status: 'FILED' }, orderBy: [{ formType: 'asc' }, { sequence: 'asc' }],
      select: { id: true, formType: true, establishmentCode: true, sequence: true, rowsChecksum: true, payerSnapshotJson: true,
        lines: { orderBy: { rowNumber: 'asc' }, select: { rowNumber: true, sourceId: true, lineJson: true } },
        latestPackage: { select: { attachmentId: true, checksum: true } } } });
  } finally { await db.$disconnect(); }
}

const BRANCH = 'Bloom Clinic · สำนักงานใหญ่ (สำนักงานใหญ่)';
const FORMS = [
  { key: 'PND3', short: 'ภ.ง.ด.3', card: 'ภ.ง.ด.3 (จ่ายให้บุคคล)', paid: '4,000.00', withheld: '120.00' },
  { key: 'PND53', short: 'ภ.ง.ด.53', card: 'ภ.ง.ด.53 (จ่ายให้บริษัท)', paid: '10,000.00', withheld: '300.00' },
] as const;


async function addBranch(page: Page, name: string, code: string, taxCode?: string) {
  const main = page.locator('main');
  await pressMenu(page, 'สาขา', 'ตั้งค่าร้าน');
  await main.getByRole('button', { name: '+ เพิ่มสาขา', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'เพิ่มสาขา' });
  await dialog.getByRole('textbox', { name: 'ชื่อสาขา', exact: true }).fill(name);
  await dialog.getByRole('textbox', { name: /^รหัสสาขา ชื่อย่อ/ }).fill(code);
  if (taxCode) await dialog.getByRole('textbox', { name: /^รหัสสาขาภาษี/ }).fill(taxCode);
  await dialog.getByRole('button', { name: 'เพิ่มสาขา', exact: true }).click();
  await expect(dialog).toBeHidden(AFTER_PRESS);
}

test('@journey withholding forms: three paid expenses, the shop fault fixed through its link, both forms and a 50 ทวิ downloaded, the month filed', async ({ authedPage: page, api }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(30_000);
  const shop = { headers: { 'X-Company-Id': SECOND_SHOP } };
  const period = periodKey();
  const monthUrl = `companies/${SECOND_SHOP}/tax/withholding/months/${period}`;
  const main = page.locator('main');
  const card = (heading: string) => main.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
  const [year, month] = period.split('-').map(Number) as [number, number];
  const dueDate = thaiDate(new Date(Date.UTC(year, month, 7, 12)));
  const today = thaiDate();

  const before = await json<WithholdingMonth>(await api.get(monthUrl, shop));
  expect(
    before.forms.filter((form) => form.status === 'FILED' || form.paymentCount > 0).map((form) => `${form.formType} ${form.status} ${form.paymentCount} payment(s)`),
    `This journey needs a freshly reset database: ${period} of Bloom Beauty Clinic already has withholding payments or is marked as filed (a filed month is locked). Run reset.sh and start.sh of the proof stack, then run it again.`,
  ).toEqual([]);

  const branchName = unique('สาขาทดลองยื่นเอง');
  const noCodeName = unique('สาขาทดลองไม่มีรหัส');
  const headFiles = new Map<string, Buffer>();
  const person = unique('นายวิชัย ช่างแอร์');
  const company = `${unique('บริษัท ป้ายรุ่งเรือง')} จำกัด`;

  // The one page opened by address.
  await page.goto(`/companies/${SECOND_SHOP}/dashboard`, FIRST_SIGHT);
  await expect(page.locator('header').getByText('Bloom Beauty Clinic', { exact: true })).toBeVisible(FIRST_SIGHT);

  const personExpense = await test.step('expense 1: a person, service 3% of 4,000, confirmed and paid', () => recordExpenseByHand(page, {
    branch: BRANCH, item: unique('ค่าจ้างช่างซ่อมแอร์'), price: '4000', total: '4,000.00 บาท', seller: person,
    withholding: {
      payeeKind: 'บุคคลธรรมดา', incomeType: 'ค่าบริการ (บุคคลธรรมดา) · หัก 3%', rate: '3', withheld: '120.00 บาท',
      taxId: '3101200456789', address: '12 ซอยลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900',
    },
    toPay: '3,880.00 บาท', pay: true,
  }));

  await test.step('the 50 ทวิ card of that expense is off and says what the shop lacks', async () => {
    const whtCard = main.locator('.mangmee-card').filter({ has: page.locator('h2#wht-certificate') });
    const state = whtCard.getByRole('status').filter({ hasText: /ยังไม่ออก|ออกแล้ว/ });
    await expect(state).toHaveText(/^ยังไม่ออก\s*ออกได้เมื่อมีข้อมูลร้าน$/, AFTER_PRESS);
    await expect(whtCard.getByText('ข้อมูลร้านยังขาด: ชื่อจดทะเบียน เลขผู้เสียภาษี และที่อยู่ของร้าน', { exact: true })).toBeVisible();
    await expect(whtCard.getByRole('link', { name: 'ไปกรอกข้อมูลร้าน', exact: true })).toBeVisible();
    await expect(whtCard.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true })).toHaveCount(0);
  });

  const companyExpense = await test.step('expense 2: a company, service 3% of 10,000, confirmed and paid', () => recordExpenseByHand(page, {
    branch: BRANCH, item: unique('ค่าทำป้ายหน้าร้าน'), price: '10000', total: '10,000.00 บาท', seller: company,
    withholding: {
      payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: 'ค่าบริการ (นิติบุคคล) · หัก 3%', rate: '3', withheld: '300.00 บาท',
      taxId: '0105564000128', address: '45 ถนนสีลม แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500',
    },
    toPay: '9,700.00 บาท', pay: true,
  }));

  await test.step('ภาษีหัก ณ ที่จ่าย: each card counts one payment and a download press explains the missing shop facts', async () => {
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await expect(main.getByRole('heading', { level: 1, name: 'ภาษีหัก ณ ที่จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(main.getByRole('combobox', { name: 'เดือนที่จ่าย', exact: true })).toHaveText(thaiMonth());
    for (const form of FORMS) {
      const formCard = card(form.card);
      // The cards fill themselves on opening the page: nothing is pressed to pull the payments in.
      await expectFormTotals(formCard, 1, form.paid, form.withheld, dueDate);
      await expect(formCard.getByText('ยังไม่ได้ยื่น', { exact: true })).toBeVisible();
      const download = formCard.getByRole('button', { name: `ดาวน์โหลดแบบ ${form.short}`, exact: true });
      await expect(download).toBeEnabled();
      await download.click();
      const fault = formCard.getByRole('status');
      await expect(fault, 'on a freshly reset database the shop has no registered name, tax number or address').toContainText('ข้อมูลร้านยังขาด:');
      for (const lacking of ['ชื่อจดทะเบียน', 'เลขผู้เสียภาษี', 'ที่อยู่']) await expect(fault).toContainText(lacking);
      await expect(fault.getByRole('link', { name: 'ตั้งค่าร้าน › ข้อมูลร้าน', exact: true })).toBeVisible();
      await expect(download).toBeEnabled();
      await expect(formCard.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true })).toHaveCount(0);
    }
    // Each form has only its normal paper here, so the rows have no paper label.
    const viewport = page.viewportSize();
    for (const width of [390, 1280, 1556]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(main.locator('thead th').filter({ hasText: /^จ่ายค่าอะไร$/ })).toHaveCount(1);
    }
    if (viewport) await page.setViewportSize(viewport);
    const personRow = paymentRows(main).filter({ hasText: person }).filter({ hasText: 'ค่าบริการ (บุคคลธรรมดา)' });
    for (const text of [person, today, 'ภ.ง.ด.3', 'ค่าบริการ (บุคคลธรรมดา) · 3%', '4,000.00', '120.00', 'ยังไม่ออก']) await expect(personRow).toContainText(text);
    await expect(personRow.getByRole('link', { name: 'เปิดรายจ่าย', exact: true })).toHaveCount(0);
    const companyRow = paymentRows(main).filter({ hasText: company });
    for (const text of [company, today, 'ภ.ง.ด.53', 'ค่าบริการ (นิติบุคคล) · 3%', '10,000.00', '300.00', 'ยังไม่ออก']) await expect(companyRow).toContainText(text);
    for (const row of [personRow, companyRow]) for (const paper of ['ยื่นปกติ', 'ยังไม่อยู่ในแบบ']) await expect(row).not.toContainText(paper);
  });

  await test.step('the fault’s link → fill the shop’s registered name, tax number, address', async () => {
    await card(FORMS[0].card).getByRole('link', { name: 'ตั้งค่าร้าน › ข้อมูลร้าน', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'ข้อมูลร้าน', exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(main.getByRole('status').filter({ hasText: 'ข้อมูลร้านยังขาด' })).toHaveText('⚠ ข้อมูลร้านยังขาด: ชื่อจดทะเบียน · เลขผู้เสียภาษี · ที่อยู่ · กรอกช่องที่แจ้งไว้แล้วบันทึก', AFTER_PRESS);
    await expect(main.getByRole('textbox', { name: 'ชื่อร้าน', exact: true })).toHaveValue('Bloom Beauty Clinic');
    await main.getByRole('textbox', { name: /^ชื่อจดทะเบียน/ }).fill('บริษัท บลูมบิวตี้ทดลอง จำกัด');
    await main.getByRole('textbox', { name: /^เลขผู้เสียภาษี/ }).fill('0105558000014');
    await main.getByRole('textbox', { name: 'รหัสไปรษณีย์', exact: true }).fill('10110');
    await expect(main.getByRole('combobox', { name: 'จังหวัด', exact: true })).toHaveText('กรุงเทพมหานคร', AFTER_PRESS);
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'อำเภอ / เขต', exact: true }), 'คลองเตย');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ตำบล / แขวง', exact: true }), 'คลองเตย');
    await main.getByRole('textbox', { name: 'ที่อยู่ (บ้านเลขที่ ถนน)', exact: true }).fill('88 ถนนพระราม 4');
    await main.getByRole('button', { name: 'บันทึกข้อมูลร้าน', exact: true }).click();
    const saved = main.getByRole('status').filter({ hasText: 'บันทึกข้อมูลร้านแล้ว' });
    await expect(saved).toContainText('✓ บันทึกข้อมูลร้านแล้ว', AFTER_PRESS);
    // The page knows where the person came from and offers the way back.
    await expect(saved.getByRole('link', { name: 'กลับไปภาษีหัก ณ ที่จ่าย', exact: true })).toBeVisible();
    await expect(main.getByRole('status').filter({ hasText: 'ข้อมูลร้านยังขาด' })).toHaveCount(0);
  });

  await test.step('กลับไปภาษีหัก ณ ที่จ่าย: the fault is gone, both downloads are on', async () => {
    await main.getByRole('link', { name: 'กลับไปภาษีหัก ณ ที่จ่าย', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'ภาษีหัก ณ ที่จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    for (const form of FORMS) {
      const formCard = card(form.card);
      await expectFormTotals(formCard, 1, form.paid, form.withheld, dueDate);
      await expect(formCard.getByRole('button', { name: `ดาวน์โหลดแบบ ${form.short}`, exact: true })).toBeEnabled();
      await expect(formCard.getByRole('status')).toHaveCount(0);
      await expect(formCard).not.toContainText('ข้อมูลร้านยังขาด');
    }
  });

  const prizeExpense = await test.step('same person: prize 5%, a second PND3 payment without blocking either form', async () => {
    const expense = await recordExpenseByHand(page, {
      branch: BRANCH, item: unique('รางวัลประกวดจัดหน้าร้าน'), price: '2000', total: '2,000.00 บาท', seller: person,
      withholding: { payeeKind: 'บุคคลธรรมดา', incomeType: 'รางวัลจากการประกวด แข่งขัน หรือชิงโชค (บุคคลธรรมดา) · หัก 5%',
        rate: '5', withheld: '100.00 บาท', taxId: '3101200456789', address: '12 ซอยลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900' },
      toPay: '1,900.00 บาท', pay: true,
    });
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await expectFormTotals(card(FORMS[0].card), 2, '6,000.00', '220.00', dueDate);
    await expect(card(FORMS[0].card).getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.3', exact: true })).toBeEnabled();
    await expectFormTotals(card(FORMS[1].card), 1, FORMS[1].paid, FORMS[1].withheld, dueDate);
    return expense;
  });

  // S2.3 forbids changing the effective mode of an already-filed month: answer BEFORE filing.
  // The new branch's payment is recorded AFTER filing, so the kept head-office paper is still tested.
  await test.step('add a paying branch and choose แต่ละสาขาจ่ายเอง before the first paper is filed', async () => {
    await addBranch(page, branchName, `T${Date.now().toString(36)}`, '00009');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ผู้ที่จ่ายเงินและหักภาษี', exact: true }), 'แต่ละสาขาจ่ายเอง');
    await expect(main.getByRole('combobox', { name: 'ใช้ตั้งแต่เดือน', exact: true })).toHaveText(thaiMonth());
    await main.getByRole('button', { name: 'บันทึกวิธีจ่าย', exact: true }).click();
    await expect(main.getByRole('status').filter({ hasText: 'บันทึกวิธีจ่ายแล้ว' })).toContainText(thaiMonth(), AFTER_PRESS);
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await expect(main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true })).toHaveCount(0);
  });

  await test.step('download ภ.ง.ด.3 and ภ.ง.ด.53', async () => {
    for (const form of FORMS) {
      const formCard = card(form.card);
      const file = await pressForDownload(page, () => formCard.getByRole('button', { name: `ดาวน์โหลดแบบ ${form.short}`, exact: true }).click());
      // The establishment code identifies the paper returned by this card.
      expect(file.name).toMatch(/ภ\.ง\.ด\.(3|53)-\d{4}-\d{2}-\d{5}\.pdf$/);
      expect(file.head).toBe('%PDF-');
      await expect(formCard.getByText('ดาวน์โหลดแบบแล้ว', { exact: true })).toBeVisible(AFTER_PRESS);
      await expect(formCard.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true })).toBeVisible();
    }
  });

  let certificateNumber = '';
  await test.step('issue the person’s 50 ทวิ from the expense and download it', async () => {
    await paymentRows(main).filter({ hasText: person }).filter({ hasText: 'ค่าบริการ (บุคคลธรรมดา)' }).click();
    await expect(main.getByRole('heading', { level: 1, name: person, exact: true })).toBeVisible(FIRST_SIGHT);
    await main.getByRole('button', { name: 'ไปที่หนังสือรับรอง 50 ทวิ', exact: true }).click();
    const whtCard = main.locator('.mangmee-card').filter({ has: page.locator('h2#wht-certificate') });
    const state = whtCard.getByRole('status').filter({ hasText: /ยังไม่ออก|ออกแล้ว/ });
    // The shop is complete now: the line about what the shop lacks is gone from this card too.
    await expect(state).toHaveText('ยังไม่ออก', AFTER_PRESS);
    await expect(whtCard).not.toContainText('ข้อมูลร้านยังขาด');
    await whtCard.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'ออกหนังสือรับรอง 50 ทวิ ให้ผู้รับเงิน' });
    await expect(dialog.getByRole('term')).toHaveText(['ผู้รับเงิน', 'เลขผู้เสียภาษี', 'ที่อยู่', 'จ่ายค่าอะไร', 'จำนวนเงินที่จ่าย', 'ภาษีที่หักไว้']);
    await expect(dialog.getByRole('definition')).toHaveText([
      person, '3-1012-00456-78-9', '12 ซอยลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900',
      'ค่าบริการ (บุคคลธรรมดา)', '4,000.00 บาท', '120.00 บาท',
    ]);
    await expect(dialog.getByText('ออกแล้วได้เลขที่ทันที ถ้าผิดต้องยกเลิกแล้วออกใหม่', { exact: true })).toBeVisible();
    const issue = dialog.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true });
    await expect(issue).toBeEnabled(AFTER_PRESS);
    const file = await pressForDownload(page, () => issue.click());
    expect(file.head).toBe('%PDF-');
    expect(file.name).toMatch(/\.pdf$/);
    const issued = page.getByText(/^ออกหนังสือรับรองเลขที่ WHT-\d{4}-\d{5} แล้ว$/).first();
    await expect(issued).toBeVisible(AFTER_PRESS);
    certificateNumber = (await issued.innerText()).match(/WHT-\d{4}-\d{5}/)![0];
    await expect(state).toHaveText(inOrder('ออกแล้ว', `เลขที่ ${certificateNumber}`, `วันที่ออก ${today}`));
    await expect(whtCard.getByText('พิมพ์ ตรวจลายเซ็น แล้วส่งให้ผู้รับเงิน', { exact: true })).toBeVisible();
    await expect(whtCard.getByRole('button', { name: 'ดาวน์โหลดหนังสือรับรอง', exact: true })).toBeEnabled();
    // C59: a stale caller cannot change financial facts through spelling correction.
    const scope = { headers: { 'X-Company-Id': SECOND_SHOP } };
    const handoffs = await json<Array<{ id: string; certificateNumber: string }>>(await api.get(`companies/${SECOND_SHOP}/wht/payment-handoffs?sourcePaymentId=${personExpense.expenseId}`, scope));
    // Issuing for the payment adds a handoff beside the earlier expense-wide REQUIRED row.
    const issuedHandoffs = handoffs.filter(handoff => handoff.certificateNumber === certificateNumber);
    expect(issuedHandoffs).toHaveLength(1);
    const issuedHandoff = issuedHandoffs[0]!;
    const locked = await api.post(`companies/${SECOND_SHOP}/wht/payment-handoffs/${issuedHandoff.id}/system-certificate/correction`, {
      ...scope, data: { corrected: { grossAmount: '4001' }, reason: 'ทดสอบทางแก้ยอดจากรายจ่าย' },
    });
    expect(locked.status()).toBe(409);
    expect(await locked.json()).toMatchObject({ code: 'wht_correction_field_locked', message: 'แก้ยอด อัตรา รายการที่จ่าย หรือเลขผู้เสียภาษีที่รายจ่ายด้วย “แก้ไขเอกสาร”' });
    expect(await json<Array<{ id: string; certificateNumber: string }>>(await api.get(`companies/${SECOND_SHOP}/wht/payment-handoffs?sourcePaymentId=${personExpense.expenseId}`, scope))).toContainEqual(expect.objectContaining({ id: issuedHandoff.id, certificateNumber }));
    await whtCard.getByRole('button', { name: 'แก้ไขหนังสือรับรอง', exact: true }).click();
    const correction = whtCard.locator('form');
    await expect(correction).toContainText('ค่าบริการ (บุคคลธรรมดา)');
    await expect(correction).toContainText('จ่าย 4,000.00 บาท');
    await expect(correction).toContainText('หักไว้ 120.00 บาท');
    for (const locked of ['จ่ายค่าอะไร', 'จำนวนเงินที่จ่าย', 'อัตราหัก ณ ที่จ่าย', 'เลขผู้เสียภาษีของผู้รับเงิน'])
      await expect(correction.getByRole('textbox', { name: locked, exact: true })).toHaveCount(0);
    await expect(correction).toContainText('ถ้าส่วนนี้ผิด');
    const certificateViewport = page.viewportSize();
    expect(certificateViewport).not.toBeNull();
    for (const width of [390, 1280, 1556]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(correction.getByRole('button', { name: 'แก้ไขเอกสาร', exact: true })).toBeVisible();
      // The content area slides for 300 ms after a resize; measure once it has settled.
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), AFTER_PRESS).toBe(true);
    }
    await page.setViewportSize(certificateViewport!);
    await correction.getByRole('button', { name: 'แก้ไขเอกสาร', exact: true }).click();
    const reopen = page.getByRole('dialog', { name: 'แก้ไขเอกสาร', exact: true });
    await expect(reopen).toContainText(certificateNumber);
    await expect(reopen.getByRole('radio', { name: 'ยังไม่ได้ยื่นภาษีหัก ณ ที่จ่ายของรายการนี้', exact: true })).toBeVisible();
    await expect(reopen.getByRole('button', { name: 'ยกเลิกหนังสือรับรองและแก้ไขเอกสาร', exact: true })).toBeDisabled();
    await reopen.getByRole('button', { name: 'ปิด', exact: true }).last().click();
    await expect(reopen).toHaveCount(0);
    await expect(whtCard.getByRole('status').filter({ hasText: 'ออกแล้ว' })).toContainText('ออกแล้ว');

    const fromExpense = await pressForDownload(page, () => whtCard.getByRole('button', { name: 'ดาวน์โหลดหนังสือรับรอง', exact: true }).click());
    expect(fromExpense.name).toBe(`หนังสือรับรอง-50-ทวิ-${certificateNumber}.pdf`);
    await expect(page.getByRole('status').filter({ hasText: `ดาวน์โหลดหนังสือรับรอง ${certificateNumber} แล้ว` }).first()).toBeVisible(AFTER_PRESS);
  });

  await test.step('back on the withholding page the row carries the number and downloads the same paper', async () => {
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    const personRow = paymentRows(main).filter({ hasText: person }).filter({ hasText: 'ค่าบริการ (บุคคลธรรมดา)' });
    await expect(personRow).toContainText(inOrder('ออกแล้ว', certificateNumber), FIRST_SIGHT);
    const again = await pressForDownload(page, () => personRow.getByRole('button', { name: 'ดาวน์โหลดหนังสือรับรอง', exact: true }).click());
    expect(again.name).toBe(`หนังสือรับรอง-50-ทวิ-${certificateNumber}.pdf`);
    await expect(page.getByRole('status').filter({ hasText: `ดาวน์โหลดหนังสือรับรอง ${certificateNumber} แล้ว` }).first()).toBeVisible(AFTER_PRESS);
    expect(again.head).toBe('%PDF-');
    await expect(paymentRows(main).filter({ hasText: company })).toContainText('ยังไม่ออก');
  });

  await test.step('the 50 ทวิ row lands on the expense certificate and downloads the same paper', async () => {
    await main.locator('summary').filter({ hasText: /^เพิ่มเติม$/ }).click();
    await expect(main.getByRole('link', { name: 'ดูหนังสือรับรอง 50 ทวิ', exact: true })).toBeInViewport({ ratio: 1 });
    await main.getByRole('link', { name: 'ดูหนังสือรับรอง 50 ทวิ', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'หนังสือรับรอง 50 ทวิ', exact: true })).toBeVisible(FIRST_SIGHT);
    const formFilter = main.getByRole('combobox', { name: 'แบบภาษี', exact: true });
    await chooseThemedOption(page, formFilter, 'ภ.ง.ด.2');
    await expect(page).toHaveURL(/formType=PND2/, AFTER_PRESS);
    await page.reload();
    await expect(formFilter).toHaveText('ภ.ง.ด.2', FIRST_SIGHT);
    await chooseThemedOption(page, formFilter, 'ภ.ง.ด.3');
    await expect(page).toHaveURL(/formType=PND3/, AFTER_PRESS);

    await main.getByRole('button', { name: /^ออกแล้ว/ }).click();
    await main.getByRole('searchbox', { name: 'ค้นชื่อผู้รับเงิน เลขผู้เสียภาษี เลขที่ใบ หรือเลขที่รายจ่าย', exact: true }).fill(certificateNumber);
    const certificate = main.locator('tr, article[data-testid="wht-certificate-card"]').filter({ hasText: certificateNumber }).filter({ visible: true });
    await expect(certificate).toHaveCount(1, AFTER_PRESS);
    // The tab says ออกแล้ว; the row carries the number instead of repeating it.
    await expect(certificate).toContainText(certificateNumber);
    await expect(certificate).not.toContainText('ออกเมื่อ');
    await expect(certificate.getByText('เพิ่มเติม', { exact: true })).toHaveCount(0);
    await expect(main.getByRole('columnheader', { name: 'หนังสือรับรอง', exact: true })).toHaveCount(0);
    await expect(certificate).not.toContainText('รายจ่ายเลขที่');
    await expect(certificate).not.toContainText('฿');
    await expect(certificate.locator('summary')).toHaveCount(0);
    await expect(certificate.getByRole('button')).toHaveCount(0);
    await expect(certificate.getByRole('button', { name: 'พิมพ์ใบแทน (เลขที่เดิม)', exact: true })).toHaveCount(0);
    // The search refetches after typing and can redraw the row under the focus: press Enter on the row that is showing.
    await expect(async () => {
      if (!page.url().includes(`/expenses/${personExpense.expenseId}`)) { await certificate.focus(); await page.keyboard.press('Enter'); }
      await expect(page).toHaveURL(new RegExp(`/expenses/${personExpense.expenseId}$`), { timeout: 5_000 });
    }).toPass(AFTER_PRESS);
    const heading = main.locator('h2#wht-certificate');
    await expect(heading).toBeFocused(AFTER_PRESS);
    await expect(page).toHaveURL(new RegExp(`/expenses/${personExpense.expenseId}$`));
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    // `has:` takes a page-level locator: a `main.` one would be looked up inside the card itself and never match.
    const expenseCertificate = main.locator('.mangmee-card').filter({ has: page.locator('h2#wht-certificate') });
    await expect(expenseCertificate.getByRole('button', { name: 'พิมพ์ใบแทน (เลขที่เดิม)', exact: true })).toBeVisible();
    const file = await pressForDownload(page, () => expenseCertificate.getByRole('button', { name: 'ดาวน์โหลดหนังสือรับรอง', exact: true }).click());
    expect(file.name).toBe(`หนังสือรับรอง-50-ทวิ-${certificateNumber}.pdf`);
    expect(file.head).toBe('%PDF-');
    await expect(page.getByRole('status').filter({ hasText: `ดาวน์โหลดหนังสือรับรอง ${certificateNumber} แล้ว` }).first()).toBeVisible(AFTER_PRESS);
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await expect(main.getByRole('heading', { level: 1, name: 'ภาษีหัก ณ ที่จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
  });

  await test.step('บันทึกว่ายื่นแล้ว and confirm: the card says filed, and downloading again leaves it filed', async () => {
    for (const form of FORMS) {
      const formCard = card(form.card);
      await formCard.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: new RegExp(`^บันทึกว่ายื่น ${form.short.replace(/\./g, '\\.')} ยื่นปกติ เดือน\\s*${thaiMonth().replace(/\./g, '\\.')} แล้ว\\?$`) });
      await expect(dialog.getByText('ใช้เมื่อนำแบบไปยื่นกรมสรรพากรแล้ว', { exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'ยังไม่ได้ยื่น', exact: true }).last()).toBeVisible();
      await dialog.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true }).click();
      await expect(formCard.getByText('ยื่นแล้ว', { exact: true })).toBeVisible(AFTER_PRESS);
      await expect(formCard.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true })).toHaveCount(0);

      const file = await pressForDownload(page, () => formCard.getByRole('button', { name: 'ดาวน์โหลดแบบที่ยื่น', exact: true }).click());
      // The establishment code identifies the paper returned by this card.
      expect(file.name).toMatch(/ภ\.ง\.ด\.(3|53)-\d{4}-\d{2}-\d{5}\.pdf$/);
      expect(file.head).toBe('%PDF-');
      await expect(formCard.getByRole('button', { name: 'ดาวน์โหลดแบบที่ยื่น', exact: true })).toBeVisible();
      const again = await pressForDownload(page, () => formCard.getByRole('button', { name: 'ดาวน์โหลดแบบที่ยื่น', exact: true }).click());
      const firstBytes = await readFile((await file.download.path())!);
      headFiles.set(form.key, firstBytes);
      const againBytes = await readFile((await again.download.path())!);
      expect(againBytes.length).toBe(firstBytes.length);
      expect(again.head).toBe(file.head);
      expect(againBytes.equals(firstBytes)).toBe(true);
      await expect(formCard.getByText('ยื่นแล้ว', { exact: true })).toBeVisible();
      await expect(formCard.getByText('ดาวน์โหลดแบบแล้ว', { exact: true })).toHaveCount(0);
      await expectFormTotals(formCard, form.key === 'PND3' ? 2 : 1, form.key === 'PND3' ? '6,000.00' : form.paid, form.key === 'PND3' ? '220.00' : form.withheld, dueDate);
    }
  });

  // The truth on the server.
  const after = await json<WithholdingMonth>(await api.get(monthUrl, shop));
  expect(after.forms.map((form) => [form.formType, form.status, form.paymentCount])).toEqual([['PND3', 'FILED', 2], ['PND53', 'FILED', 1]]);
  expect(after.forms.map((form) => Number(form.totalWithheld))).toEqual([220, 300]);
  for (const [expense, withheld] of [[personExpense, 120], [companyExpense, 300], [prizeExpense, 100]] as const) {
    const detail = await json<ExpenseDetail>(await api.get(`companies/${SECOND_SHOP}/expenses/${expense.expenseId}`, shop));
    expect(detail.status).toBe('CONFIRMED');
    expect(detail.paymentStatus).toBe('PAID');
    expect(Number(detail.whtAmount)).toBe(withheld);
  }
  // The chooser prints a branch by its name alone (only head office carries a suffix) and offers again the
  // branch this person chose last in this browser.
  async function branchExpense(branch: string, offered: string, seller: string) {
    return recordExpenseByHand(page, {
      branch, branchOffered: offered, item: unique('ค่าบริการสาขา'), price: '1000', total: '1,000.00 บาท', seller,
      withholding: { payeeKind: 'บุคคลธรรมดา', incomeType: 'ค่าบริการ (บุคคลธรรมดา) · หัก 3%', rate: '3', withheld: '30.00 บาท', taxId: '3101200456789', address: '12 ซอยลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900' },
      toPay: '970.00 บาท', pay: true,
    });
  }
  await test.step('a new branch payment has its own paper; the head-office filed bytes never change', async () => {
    await branchExpense(branchName, BRANCH, unique('ผู้รับเงินสาขา'));
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    const chooser = main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true });
    await chooseThemedOption(page, chooser, `${branchName} (00009)`);
    const personal = card(FORMS[0].card);
    await expect(personal.getByText('ยังไม่ได้ยื่น', { exact: true })).toBeVisible(AFTER_PRESS);
    await expect(personal.locator('.mangmee-unit').first()).toHaveText(metricText('1', 'รายการ'));
    const branchFile = await pressForDownload(page, () => personal.getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.3', exact: true }).click());
    expect(branchFile.name).toBe(`ภ.ง.ด.3-${period}-00009.pdf`);
    expect(branchFile.head).toBe('%PDF-');
    await chooseThemedOption(page, chooser, 'สำนักงานใหญ่ (00000)');
    for (const form of FORMS) {
      await expect(card(form.card).getByText('ยื่นแล้ว', { exact: true })).toBeVisible();
      const kept = await pressForDownload(page, () => card(form.card).getByRole('button', { name: 'ดาวน์โหลดแบบที่ยื่น', exact: true }).click());
      const bytes = await readFile((await kept.download.path())!);
      expect(bytes.length).toBe(headFiles.get(form.key)!.length);
      expect(bytes.subarray(0, 32).equals(headFiles.get(form.key)!.subarray(0, 32))).toBe(true);
      expect(bytes.equals(headFiles.get(form.key)!)).toBe(true);
    }
    const truth = await json<WithholdingMonth>(await api.get(monthUrl, shop));
    expect(truth.establishments.map(row => [row.code, row.forms.find(form => form.formType === 'PND3')?.status]).sort()).toEqual([['00000', 'FILED'], ['00009', 'EXPORTED']]);
  });
  await test.step('a branch without a code stays off paper; its link opens the code field and saving returns to this month', async () => {
    await addBranch(page, noCodeName, `N${Date.now().toString(36)}`);
    const seller = unique('ผู้รับเงินสาขารอรหัส');
    await branchExpense(noCodeName, branchName, seller);
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    const stop = main.getByRole('status').filter({ hasText: `${noCodeName} ยังไม่มีรหัสสาขาภาษี` });
    await expect(stop).toContainText('1 รายการ', AFTER_PRESS);
    await expect(paymentRows(main).filter({ hasText: seller })).toContainText('ยังไม่มีรหัสสาขาภาษี');
    await stop.getByRole('link', { name: 'ตั้งค่าร้าน › สาขา', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `แก้ไขสาขา ${noCodeName}` });
    const code = dialog.getByRole('textbox', { name: /^รหัสสาขาภาษี/ });
    await expect(code).toBeFocused(AFTER_PRESS);
    await code.fill('00010');
    await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(main.getByRole('heading', { name: 'ภาษีหัก ณ ที่จ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
    await expect(main.getByRole('combobox', { name: 'เดือนที่จ่าย', exact: true })).toHaveText(thaiMonth(), AFTER_PRESS);
    await expect(main.getByRole('status').filter({ hasText: `${noCodeName} ยังไม่มีรหัสสาขาภาษี` })).toHaveCount(0);
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true }), `${noCodeName} (00010)`);
    await expect(card(FORMS[0].card).locator('.mangmee-unit').first()).toHaveText(metricText('1', 'รายการ'));
    await expect(card(FORMS[0].card).getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.3', exact: true })).toBeEnabled();
    await expect(paymentRows(main).filter({ hasText: seller })).toContainText(`ยื่นโดย ${noCodeName}`);
  });

  const originalPapers = await filedRows(period);
  expect(originalPapers).toHaveLength(2);
  for (const paper of originalPapers) expect(paper.lines[0]).toBeTruthy();
  await test.step('a late head-office payment opens additional filing 1, while the normal stored paper stays unchanged', async () => {
    const latePayee = unique('ผู้รับเงินหลังยื่น');
    // The step before chose the branch without a code last on this browser: the chooser offers it again.
    await recordExpenseByHand(page, {
      branch: BRANCH, branchOffered: noCodeName, item: unique('ค่าบริการหลังยื่น'), price: '3000', total: '3,000.00 บาท', seller: latePayee,
      withholding: { payeeKind: 'บุคคลธรรมดา', incomeType: 'ค่าบริการ (บุคคลธรรมดา) · หัก 3%', rate: '3', withheld: '90.00 บาท',
        taxId: '3101200456789', address: '12 ซอยลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900' },
      toPay: '2,910.00 บาท', pay: true,
    });
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true }), 'สำนักงานใหญ่ (00000)');
    const personal = card(FORMS[0].card);
    const additional = personal.getByRole('region', { name: 'ยื่นเพิ่มเติมครั้งที่ 1', exact: true });
    await expect(additional).toContainText(inOrder('ยื่นเพิ่มเติมครั้งที่ 1', 'ยังไม่ได้ยื่น', '1 รายการ · หักไว้ 90.00 บาท'), AFTER_PRESS);
    await expect(additional).toContainText('เงินเพิ่ม (ถ้ามี) ให้ผู้ทำบัญชีคำนวณและกรอกก่อนยื่น');
    await expect(paymentRows(main).filter({ hasText: latePayee })).toContainText('ยื่นเพิ่มเติมครั้งที่ 1');
    // Head office now has two ภ.ง.ด.3 papers this month, so its earlier row names its own (seen on screen 2026-10-14).
    await expect(paymentRows(main).filter({ hasText: person }).filter({ hasText: 'ค่าบริการ (บุคคลธรรมดา)' }))
      .toContainText(inOrder('ภ.ง.ด.3', 'ยื่นปกติ', 'ค่าบริการ (บุคคลธรรมดา) · 3%'));
    await expectFormTotals(personal, 3, '9,000.00', '310.00', dueDate);
    const file = await pressForDownload(page, () => additional.getByRole('button', { name: 'ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ 1', exact: true }).click());
    expect(file.name).toBe(`ภ.ง.ด.3-${period}-00000-เพิ่มเติมครั้งที่-1.pdf`);
    expect(file.head).toBe('%PDF-');
    const normal = personal.getByRole('region', { name: 'ยื่นปกติ', exact: true });
    // The paper's heading carries its filing date between the two words.
    await expect(normal).toContainText(/ยื่นปกติ[\s\S]*ยื่นแล้ว/);
    const kept = await pressForDownload(page, () => normal.getByRole('button', { name: 'ดาวน์โหลดแบบที่ยื่น', exact: true }).click());
    const keptBytes = await readFile((await kept.download.path())!);
    expect(keptBytes.equals(headFiles.get('PND3')!)).toBe(true);
    await additional.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^บันทึกว่ายื่น ภ.ง.ด.3 ยื่นเพิ่มเติมครั้งที่ 1 เดือน .+ ในนาม สำนักงานใหญ่ \(00000\) แล้ว\?$/ });
    await dialog.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true }).click();
    await expect(additional).toContainText(/ยื่นเพิ่มเติมครั้งที่\s*1[\s\S]*ยื่นแล้ว/, AFTER_PRESS);
  });
  await test.step('cancel the filed company expense without a certificate; keep its original row and stored bytes', async () => {
    await paymentRows(main).filter({ hasText: company }).click();
    await expect(main.getByRole('heading', { level: 1, name: company, exact: true })).toBeVisible(FIRST_SIGHT);
    await main.locator('summary').filter({ hasText: /^เพิ่มเติม$/ }).click();
    await main.getByRole('button', { name: 'ยกเลิกเอกสาร', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^ยกเลิกเอกสาร/ });
    await dialog.getByRole('textbox', { name: 'เหตุผลที่ยกเลิก', exact: true }).fill('บันทึกผู้รับเงินผิด');
    await dialog.getByRole('button', { name: 'ยกเลิกเอกสาร', exact: true }).click();
    await expect(dialog).toBeHidden(AFTER_PRESS);
    expect((await json<ExpenseDetail>(await api.get(`companies/${SECOND_SHOP}/expenses/${companyExpense.expenseId}`, shop))).status).toBe('VOIDED');
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true }), 'สำนักงานใหญ่ (00000)');
    const companyCard = card(FORMS[1].card);
    await expect(companyCard).toContainText(`ยกเลิกหลังยื่น: ${company} หักไว้ 300.00 บาท ระบบแก้แบบที่ยื่นแล้วไม่ได้ ให้ผู้ทำบัญชีแจ้งกรมสรรพากร`, AFTER_PRESS);
    const kept = await pressForDownload(page, () => companyCard.getByRole('button', { name: 'ดาวน์โหลดแบบที่ยื่น', exact: true }).click());
    expect((await readFile((await kept.download.path())!)).equals(headFiles.get('PND53')!)).toBe(true);
    const truth = await json<WithholdingMonth>(await api.get(monthUrl, shop));
    const head = truth.establishments.find(row => row.code === '00000')!;
    expect(head.forms[0]!.papers!.map(p => [p.sequence, p.status, p.paymentCount])).toEqual([[0, 'FILED', 2], [1, 'FILED', 1]]);
    expect(head.forms[1]!.papers![0]!.cancellations!.map(row => row.sourceId)).toContain(companyExpense.expenseId);
    const stored = await filedRows(period);
    expect(stored).toHaveLength(3);
    for (const original of originalPapers) expect(stored.find((paper: { id: string }) => paper.id === original.id)).toEqual(original);
  });

  await test.step('W1/W2: an invoice last month waits unpaid, then belongs to this payment month', async () => {
    const seller = unique('นายทดสอบวันที่จ่าย');
    const expense = await recordExpenseByHand(page, { branch: BRANCH, lastMonthDay: 28, item: unique('บริการข้ามเดือน'), seller, price: '1000', total: '1,000.00 บาท', toPay: '970.00 บาท',
      withholding: { payeeKind: 'บุคคลธรรมดา', incomeType: 'ค่าบริการ (บุคคลธรรมดา) · หัก 3%', rate: '3', withheld: '30.00 บาท', taxId: '3101200456789', address: '12 กรุงเทพมหานคร 10900' } });
    const certificate = main.locator('.mangmee-card').filter({ has: page.locator('h2#wht-certificate') });
    await expect(certificate).toContainText('ร่าง · บันทึกการจ่ายก่อนออกหนังสือรับรอง', AFTER_PRESS);
    await expect(certificate.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true })).toHaveCount(0);
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await expect(paymentRows(main).filter({ hasText: seller })).toHaveCount(0);
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'เดือนที่จ่าย', exact: true }), thaiMonth(dayOfLastMonth(28)));
    await expect(main.getByText(/ยืนยันแล้ว ยังไม่ได้จ่าย/)).toBeVisible(AFTER_PRESS);
    await main.getByRole('link', { name: seller, exact: true }).click();
    await expect(main.getByRole('button', { name: 'ไปที่การจ่ายเงิน', exact: true })).toHaveCount(0);
    await main.getByRole('heading', { name: 'การจ่ายเงิน', exact: true }).scrollIntoViewIfNeeded();
    await main.getByRole('button', { name: 'บันทึกจ่าย 970.00 บาท', exact: true }).click();
    await expect(page.getByText('บันทึกจ่ายแล้ว 970.00 บาท', { exact: true }).first()).toBeVisible(AFTER_PRESS);
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'เดือนที่จ่าย', exact: true }), thaiMonth());
    await expect(paymentRows(main).filter({ hasText: seller })).toContainText(today, AFTER_PRESS);
    const read = await json<{ payments: Array<{ expenseId: string; paymentDate: string; paper: { sequence: number } | null }> }>(await api.get(monthUrl, shop));
    expect(read.payments.find(row => row.expenseId === expense.expenseId)?.paymentDate.slice(0, 7)).toBe(period);
    expect(read.payments.find(row => row.expenseId === expense.expenseId)?.paper?.sequence).toBe(2);
  });
  await test.step('W6: issue later keeps the real payment day and shows today as the issue day', async () => {
    const seller = unique('นายออกหนังสือรับรองภายหลัง');
    await recordExpenseByHand(page, { branch: BRANCH, lastMonthDay: 1, item: unique('บริการจ่ายเดือนก่อน'), seller, price: '1000', total: '1,000.00 บาท', toPay: '970.00 บาท',
      withholding: { payeeKind: 'บุคคลธรรมดา', incomeType: 'ค่าบริการ (บุคคลธรรมดา) · หัก 3%', rate: '3', withheld: '30.00 บาท', taxId: '3101200456789', address: '12 กรุงเทพมหานคร 10900' } });
    await expect(main.getByRole('button', { name: 'ไปที่การจ่ายเงิน', exact: true })).toHaveCount(0);
    await main.getByRole('heading', { name: 'การจ่ายเงิน', exact: true }).scrollIntoViewIfNeeded();
    await main.getByRole('combobox', { name: 'วันที่จ่ายเงินจริง', exact: true }).click();
    await page.getByRole('button', { name: 'เดือนก่อนหน้า', exact: true }).click();
    await page.getByRole('button', { name: '5', exact: true }).click();
    await main.getByRole('button', { name: 'บันทึกจ่าย 970.00 บาท', exact: true }).click();
    await expect(page.getByText('บันทึกจ่ายแล้ว 970.00 บาท', { exact: true }).first()).toBeVisible(AFTER_PRESS);
    const certificate = main.locator('.mangmee-card').filter({ has: page.locator('h2#wht-certificate') });
    await certificate.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'ออกหนังสือรับรอง 50 ทวิ ให้ผู้รับเงิน' });
    await pressForDownload(page, () => dialog.getByRole('button', { name: 'ออกเลขที่และดาวน์โหลด', exact: true }).click());
    await expect(certificate).toContainText(`วันที่จ่าย ${thaiDate(dayOfLastMonth(5))}`, AFTER_PRESS);
    await expect(certificate).toContainText(`วันที่ออก ${today}`);
  });

});


test('@journey other company income: accountant workbook without changing the personal return', async ({ authedPage: page, api }) => {
  test.setTimeout(180_000);
  const period = periodKey(), shop = { headers: { 'X-Company-Id': MAIN_SHOP } };
  const monthUrl = `companies/${MAIN_SHOP}/tax/withholding/months/${period}`;
  await page.goto(`/companies/${MAIN_SHOP}/dashboard`, FIRST_SIGHT);
  await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
  await expect(page.getByRole('heading', { name: 'ภ.ง.ด.3 (จ่ายให้บุคคล)', exact: true })).toBeVisible(AFTER_PRESS);
  const before = await json<WithholdingMonth>(await api.get(monthUrl, shop));
  expect(before.forms.find(form => form.formType === 'PND53')?.status, 'Use the main shop, where no journey files the month').not.toBe('FILED');
  const payee = unique('บริษัท รับจัดงาน');
  await recordExpenseByHand(page, {
    branch: 'Head Office (สำนักงานใหญ่)', item: unique('เงินได้อื่น'), price: '1000', total: '1,000.00 บาท', seller: payee,
    withholding: { payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: 'อื่นๆ (นิติบุคคล) · หัก 3%', rate: '3', withheld: '30.00 บาท',
      taxId: '0105564000128', address: '45 ถนนสีลม แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500',
      routeHint: 'บอกผู้ทำบัญชีว่าเป็นเงินได้อะไร ผู้ทำบัญชีต้องจัดทำแบบของเดือนนี้เอง' },
    toPay: '970.00 บาท', pay: true,
  });
  await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
  const card = page.locator('main .mangmee-card').filter({ has: page.getByRole('heading', { name: 'ภ.ง.ด.53 (จ่ายให้บริษัท)', exact: true }) });
  await expect(card.getByText('ผู้ทำบัญชีจัดทำแบบนี้เอง', { exact: true })).toBeVisible(AFTER_PRESS);
  // The page refreshes the month right after it opens; the row arrives with that refresh.
  await expect(page.getByTestId('withholding-fixes')).toContainText(`${payee} · อื่นๆ (นิติบุคคล)`, AFTER_PRESS);
  await expect(card).not.toContainText('มีเงินได้ที่ระบบยังกรอกลงแบบไม่ได้:');
  await expect(card.getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.53', exact: true })).toHaveCount(0);
  const file = await pressForDownload(page, () => card.getByRole('button', { name: 'ดาวน์โหลดรายการให้ผู้ทำบัญชี', exact: true }).click());
  expect(file.name).toMatch(/\.xlsx$/); expect(file.head.startsWith('PK')).toBe(true);
  await expect(card.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true })).toBeVisible(AFTER_PRESS);
  const after = await json<WithholdingMonth>(await api.get(monthUrl, shop));
  // The personal return keeps every number, row and state. Only the filing branch may become known (head office, 00000) once the
  // month has its first payment: a fresh shop has none before this step, a shop used by other journeys already has it.
  const personal = (month: WithholdingMonth) => { const { establishmentCode, ...rest } = month.forms.find(form => form.formType === 'PND3') ?? {} as any; return { establishmentCode, rest }; };
  expect(personal(after).rest).toEqual(personal(before).rest);
  expect([undefined, '00000']).toContain(personal(before).establishmentCode);
  expect(personal(after).establishmentCode).toBe('00000');
});

/*
 * Found by looking on the proof stack (2026-10-14). These regression tests press what a person presses and assert what that person must then read. The month-display check reads Bloom as the first test leaves it; the empty-form check creates its own branch and payments. In the main shop, which has several
 * branches and has not answered: the next one needs this month's accountant workbook downloaded by "other company
 * income"; the next two work in last month, where nothing was downloaded, and the passing one answers the question; the
 * last one leaves the main shop with head office as its only active branch.
 */
const HEAD = 'Head Office (สำนักงานใหญ่)';
const SIAM = 'Room45 Eyes Lashes · สยาม';
const PERSON_SERVICE = {
  payeeKind: 'บุคคลธรรมดา', incomeType: 'ค่าบริการ (บุคคลธรรมดา) · หัก 3%', rate: '3', withheld: '30.00 บาท',
  taxId: '3101200456789', address: '12 ซอยลาดพร้าว 15 แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900',
} as const;
async function paidFromBranch(page: Page, branch: string, options: { offered?: string; lastMonthDay?: number } = {}) {
  const seller = unique('นายสมชาย ช่างหลายสาขา');
  await recordExpenseByHand(page, {
    branch, ...(options.offered && { branchOffered: options.offered }), ...(options.lastMonthDay && { lastMonthDay: options.lastMonthDay }),
    item: unique('ค่าซ่อมหน้าร้าน'), price: '1000', total: '1,000.00 บาท', seller, withholding: PERSON_SERVICE, toPay: '970.00 บาท', pay: !options.lastMonthDay,
  });
  if (options.lastMonthDay) {
    // These older branch regressions need an actual payment in last month, not just an older invoice.
    const main = page.locator('main');
    await expect(main.getByRole('button', { name: 'ไปที่การจ่ายเงิน', exact: true })).toHaveCount(0);
    await main.getByRole('heading', { name: 'การจ่ายเงิน', exact: true }).scrollIntoViewIfNeeded();
    await main.getByRole('combobox', { name: 'วันที่จ่ายเงินจริง', exact: true }).click();
    await page.getByRole('button', { name: 'เดือนก่อนหน้า', exact: true }).click();
    await page.getByRole('button', { name: String(options.lastMonthDay), exact: true }).click();
    await main.getByRole('button', { name: 'บันทึกจ่าย 970.00 บาท', exact: true }).click();
    await expect(page.getByText('บันทึกจ่ายแล้ว 970.00 บาท', { exact: true }).first()).toBeVisible(AFTER_PRESS);
  }
  return seller;
}
const formCard = (page: Page, heading: string) => page.locator('main .mangmee-card').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
const STOP = 'มีรายการจ่ายจากหลายสาขา บอกก่อนว่าใครจ่ายเงินและหักภาษี';

// This scenario creates its own branch and payments; it does not depend on the long filing journey finishing.
// A branch's own paper with no payment of a form warns "เดือนนี้ไม่มีรายการหักภาษี ดึงรายการล่าสุดก่อนดาวน์โหลดแบบ" under
// "เดือนนี้ไม่มีรายการ": the month has payments (head office's) and pulling changes nothing. Head office's empty card has no such line.
test('@journey withholding: a branch paper with no payment of a form says only that there is none', async ({ authedPage: page }) => {
  test.setTimeout(240_000);
  const main = page.locator('main');
  await page.goto(`/companies/${SECOND_SHOP}/dashboard`, FIRST_SIGHT);
  const branchName = unique('สาขาจ่ายให้บุคคลเท่านั้น');
  await addBranch(page, branchName, `N${Date.now().toString(36)}`, '90009');
  // Wait for the saved answer before changing it; a previously filed month already has this mode.
  await expect(main.getByRole('button', { name: 'บันทึกวิธีจ่าย', exact: true })).toBeEnabled(AFTER_PRESS);
  const mode = main.getByRole('combobox', { name: 'ผู้ที่จ่ายเงินและหักภาษี', exact: true });
  if ((await mode.innerText()).trim() !== 'แต่ละสาขาจ่ายเอง') {
    await chooseThemedOption(page, mode, 'แต่ละสาขาจ่ายเอง');
    await main.getByRole('button', { name: 'บันทึกวิธีจ่าย', exact: true }).click();
    await expect(main.getByRole('status').filter({ hasText: 'บันทึกวิธีจ่ายแล้ว' })).toContainText(thaiMonth(), AFTER_PRESS);
  }
  await paidFromBranch(page, BRANCH);
  await paidFromBranch(page, branchName, { offered: BRANCH });
  await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
  await chooseThemedOption(page, main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true }), `${branchName} (90009)`);
  const companies = formCard(page, 'ภ.ง.ด.53 (จ่ายให้บริษัท)');
  await expect(companies.locator('.mangmee-unit').first()).toHaveText(metricText('0', 'รายการ'), AFTER_PRESS);
  await expect(companies.getByText('เดือนนี้ไม่มีรายการ', { exact: true })).toBeVisible();
  await expect(companies.getByRole('status')).toHaveCount(0);
});

// ใช้ตั้งแต่เดือน is the browser's own month box: it prints "October 2026" (English, Christian year) while the month
// chooser of the withholding page and the saved notice print "ต.ค. 2569".
test('@journey withholding: ใช้ตั้งแต่เดือน shows the month the way the rest of the app prints it', async ({ authedPage: page }) => {
  await page.goto(`/companies/${SECOND_SHOP}/dashboard`, FIRST_SIGHT);
  await pressMenu(page, 'สาขา', 'ตั้งค่าร้าน');
  const block = page.locator('main .mangmee-card').filter({ has: page.getByRole('heading', { name: 'ใครจ่ายเงินและหักภาษี', exact: true }) });
  await expect(block.getByRole('button', { name: 'บันทึกวิธีจ่าย', exact: true })).toBeVisible(FIRST_SIGHT);
  await expect(block).toContainText(thaiMonth());
});

// A shop that has not answered downloads a paper of the month (here the accountant's workbook), then gets payments from a
// second branch: both cards read "0 รายการ", "เดือนนี้ไม่มีรายการหักภาษี ดึงรายการล่าสุดก่อนดาวน์โหลดแบบ" and
// "เดือนนี้ไม่มีรายการ", ภ.ง.ด.53 says "มีรายการเปลี่ยนหลังดาวน์โหลดแบบ" and "ดาวน์โหลดแบบใหม่ก่อนยื่น" with no button,
// while the list under them holds the payments.
test('@journey withholding: a downloaded month that gets a second branch’s payments still counts them on its cards', async ({ authedPage: page }) => {
  test.setTimeout(240_000);
  const main = page.locator('main');
  await page.goto(`/companies/${MAIN_SHOP}/dashboard`, FIRST_SIGHT);
  await paidFromBranch(page, HEAD);
  await paidFromBranch(page, SIAM, { offered: HEAD });
  await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
  await expect(main.getByRole('status').filter({ hasText: STOP })).toBeVisible(FIRST_SIGHT);
  const list = main.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: 'รายการที่หักภาษีของเดือนนี้', exact: true }) });
  let listed = 0;
  while (true) {
    listed += await paymentRows(list).filter({ hasText: 'ภ.ง.ด.3' }).count();
    const next = list.getByRole('button', { name: 'ถัดไป', exact: true });
    if (!(await next.count()) || !(await next.isEnabled())) break;
    const pageLabel = await list.getByText(/^หน้า \d+ จาก \d+$/).innerText();
    await next.click();
    await expect(list.getByText(/^หน้า \d+ จาก \d+$/)).not.toHaveText(pageLabel);
  }
  expect(listed).toBeGreaterThan(1);
  await expect(formCard(page, 'ภ.ง.ด.3 (จ่ายให้บุคคล)').locator('.mangmee-unit').first()).toHaveText(metricText(String(listed), 'รายการ'));
  await expect(main.getByText('เดือนนี้ไม่มีรายการหักภาษี ดึงรายการล่าสุดก่อนดาวน์โหลดแบบ')).toHaveCount(0);
});

// A shop that has not answered, payments from two branches: beside the new stop, the ภ.ง.ด.3 card still prints the old
// fault "มีรายการจ่ายจากหลายสาขา ให้ผู้ทำบัญชีแยกแบบยื่นตามสาขา" (no link). Spec S2.2: the fault carries the link to the
// question instead of that sentence.
test('@journey withholding: a shop that has not answered reads one stop with its link, not the old fault', async ({ authedPage: page }) => {
  test.setTimeout(240_000);
  const main = page.locator('main');
  await page.goto(`/companies/${MAIN_SHOP}/dashboard`, FIRST_SIGHT);
  await paidFromBranch(page, HEAD, { lastMonthDay: 15 });
  await paidFromBranch(page, SIAM, { offered: HEAD, lastMonthDay: 15 });
  await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
  await chooseThemedOption(page, main.getByRole('combobox', { name: 'เดือนที่จ่าย', exact: true }), thaiMonth(dayOfLastMonth(15)));
  await expect(main.getByRole('status').filter({ hasText: STOP })).toBeVisible(AFTER_PRESS);
  await expect(main.getByText(/ให้ผู้ทำบัญชีแยกแบบยื่นตามสาขา/)).toHaveCount(0);
});

test('@journey withholding: a shop with several branches that has not answered is stopped with its link, answers on branch settings and comes back to the same month', async ({ authedPage: page, pageAs, api }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);
  const main = page.locator('main');
  // Last month: no paper of it was downloaded, and it is not the month the page opens on.
  const period = periodKey(dayOfLastMonth(15));
  const month = thaiMonth(dayOfLastMonth(15));
  await page.goto(`/companies/${MAIN_SHOP}/dashboard`, FIRST_SIGHT);
  await expect(page.locator('header').getByText('WatchDog Local Company', { exact: true })).toBeVisible(FIRST_SIGHT);
  const [headSeller, siamSeller] = await test.step(`two paid person payments of ${month}, from head office and from สยาม`, async () => [
    await paidFromBranch(page, HEAD, { lastMonthDay: 15 }),
    await paidFromBranch(page, SIAM, { offered: HEAD, lastMonthDay: 15 }),
  ]);

  await test.step('the person who may not answer is told who answers; the block on branch settings says the same and offers no form', async () => {
    const finance = await pageAs('FINANCE');
    const fm = finance.locator('main');
    await finance.goto(`/companies/${MAIN_SHOP}/dashboard`, FIRST_SIGHT);
    await pressMenu(finance, 'ภาษีหัก ณ ที่จ่าย');
    await chooseThemedOption(finance, fm.getByRole('combobox', { name: 'เดือนที่จ่าย', exact: true }), month);
    const stop = fm.getByRole('status').filter({ hasText: STOP });
    await expect(stop).toHaveText(inOrder(`⚠ ${STOP} ให้ผู้ที่แก้ไขข้อมูลร้านได้เป็นผู้บันทึก`, 'ตั้งค่าร้าน › สาขา'), FIRST_SIGHT);
    await stop.getByRole('link', { name: 'ตั้งค่าร้าน › สาขา', exact: true }).click();
    const block = fm.locator('.mangmee-card').filter({ has: finance.getByRole('heading', { name: 'ใครจ่ายเงินและหักภาษี', exact: true }) });
    await expect(block).toHaveText(inOrder('ใครจ่ายเงินและหักภาษี', 'แบบภาษีหัก ณ ที่จ่ายยื่นในนามผู้ที่จ่ายจริง',
      'ยังไม่ได้บอกว่าใครจ่ายเงินและหักภาษี ให้ผู้ที่แก้ไขข้อมูลร้านได้เป็นผู้บันทึก'), FIRST_SIGHT);
    await expect(block.getByRole('button')).toHaveCount(0);
  });

  await test.step(`the owner, ${month}: the stop and its link; ภ.ง.ด.3 cannot be downloaded; the link opens branch settings with that month set`, async () => {
    await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'เดือนที่จ่าย', exact: true }), month);
    const stop = main.getByRole('status').filter({ hasText: STOP });
    await expect(stop).toHaveText(inOrder(`⚠ ${STOP}`, 'ตั้งค่าร้าน › สาขา'), AFTER_PRESS);
    await expect(main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true })).toHaveCount(0);
    const download = formCard(page, 'ภ.ง.ด.3 (จ่ายให้บุคคล)').getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.3', exact: true });
    await expect(download).toBeEnabled();
    await download.click();
    await expect(stop).toBeVisible();
    await stop.getByRole('link', { name: 'ตั้งค่าร้าน › สาขา', exact: true }).click();
    await expect(main.getByRole('heading', { level: 1, name: 'สาขา', exact: true })).toBeVisible(FIRST_SIGHT);
    expect(new URL(page.url()).search).toBe(`?from=withholding&periodKey=${period}`);
    await expect(main.getByRole('combobox', { name: 'ใช้ตั้งแต่เดือน', exact: true })).toHaveText(month);
    // Saving with nothing chosen says what to choose, and the message stays. On the development server a press in the
    // first moments after the heading shows lands before the page is interactive and does nothing (seen 2026-10-14; 3 s
    // later it answers). The block also reads the shop's answer twice there (React's development double effect), and a
    // read that lands after a press clears the message (whole runs, 2026-10-14: 20-40 ms after the heading, with the
    // load's own ลองอีกครั้ง beside it when the first read had not landed either). No person presses that fast: press again.
    const choose = main.getByRole('alert').filter({ hasText: 'เลือกผู้ที่จ่าย' });
    await expect(async () => {
      await main.getByRole('button', { name: 'บันทึกวิธีจ่าย', exact: true }).click();
      await expect(choose).toHaveText('⚠ เลือกผู้ที่จ่ายเงินและหักภาษีก่อนบันทึก', { timeout: 2_000 });
      await page.waitForTimeout(1_000);
      await expect(choose).toHaveText('⚠ เลือกผู้ที่จ่ายเงินและหักภาษีก่อนบันทึก', { timeout: 100 });
    }).toPass(AFTER_PRESS);
    await expect(choose).toHaveText('⚠ เลือกผู้ที่จ่ายเงินและหักภาษีก่อนบันทึก');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'ผู้ที่จ่ายเงินและหักภาษี', exact: true }), 'แต่ละสาขาจ่ายเอง');
    await main.getByRole('button', { name: 'บันทึกวิธีจ่าย', exact: true }).click();
    await expect(main.getByRole('status').filter({ hasText: 'บันทึกวิธีจ่ายแล้ว' }))
      .toHaveText(inOrder(`✓ บันทึกวิธีจ่ายแล้ว ใช้ตั้งแต่เดือน ${month}`, 'กลับไปภาษีหัก ณ ที่จ่าย'), AFTER_PRESS);
  });

  await test.step(`กลับไปภาษีหัก ณ ที่จ่าย: ${month} again, the stop gone, a paper per establishment, each row says who files it`, async () => {
    await main.getByRole('link', { name: 'กลับไปภาษีหัก ณ ที่จ่าย', exact: true }).click();
    await expect(main.getByRole('combobox', { name: 'เดือนที่จ่าย', exact: true })).toHaveText(month, FIRST_SIGHT);
    expect(new URL(page.url()).searchParams.get('periodKey')).toBe(period);
    await expect(main.getByRole('status').filter({ hasText: STOP })).toHaveCount(0);
    await expect(main.getByText(/ให้ผู้ทำบัญชีแยกแบบยื่นตามสาขา/)).toHaveCount(0);
    const chooser = main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true });
    await expect(chooser).toHaveText('สำนักงานใหญ่ (00000)', AFTER_PRESS);
    await chooseThemedOption(page, chooser, `${SIAM} (00001)`);
    const truth = await json<WithholdingMonth>(await api.get(`companies/${MAIN_SHOP}/tax/withholding/months/${period}`, { headers: { 'X-Company-Id': MAIN_SHOP } }));
    const siamCount = truth.establishments.find(row => row.code === '00001')!.forms.find(form => form.formType === 'PND3')!.paymentCount;
    expect(siamCount).toBeGreaterThan(0);
    await expect(formCard(page, 'ภ.ง.ด.3 (จ่ายให้บุคคล)').locator('.mangmee-unit').first()).toHaveText(metricText(String(siamCount), 'รายการ'), AFTER_PRESS);
    await expect(paymentRows(main).filter({ hasText: siamSeller })).toContainText(`ยื่นโดย ${SIAM}`);
    await expect(paymentRows(main).filter({ hasText: headSeller })).toContainText('ยื่นโดย สำนักงานใหญ่');
  });
});

// A shop with one active branch: every row of the list gains "ยื่นโดย สำนักงานใหญ่". N3 and the acceptance: a shop with one
// branch meets no new line and sees the page it sees today.
test('@journey withholding: a shop with one active branch reads its list without ยื่นโดย', async ({ authedPage: page }) => {
  test.setTimeout(240_000);
  const main = page.locator('main');
  await page.goto(`/companies/${MAIN_SHOP}/dashboard`, FIRST_SIGHT);
  await pressMenu(page, 'สาขา', 'ตั้งค่าร้าน');
  for (const name of [SIAM, 'Room45 Eyes Lashes · อารีย์', 'Room45 Eyes Lashes · ทองหล่อ']) {
    await main.getByRole('button', { name: `แก้ไขสาขา ${name}`, exact: true }).first().click(FIRST_SIGHT);
    const dialog = page.getByRole('dialog', { name: `แก้ไขสาขา ${name}` });
    await chooseThemedOption(page, dialog.getByRole('combobox', { name: 'สถานะ', exact: true }), 'ปิดใช้งาน');
    await dialog.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(dialog).toBeHidden(AFTER_PRESS);
  }
  await expect(main.getByRole('heading', { name: 'ใครจ่ายเงินและหักภาษี', exact: true })).toHaveCount(0);
  await pressMenu(page, 'ภาษีหัก ณ ที่จ่าย');
  await expect(paymentRows(main).first()).toBeVisible(FIRST_SIGHT);
  await expect(main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true })).toHaveCount(0);
  await expect(main.getByText(/^ยื่นโดย /)).toHaveCount(0);
});

// R10 needs legacy source facts which today's review form correctly refuses to create.
// Only this fresh local proof database receives those synthetic omissions.
test('@journey R10 source-only correction, read-only and hidden branches preserve FILED bytes and open an additional paper', async ({ authedPage: page, pageAs, api }) => {
  test.setTimeout(900_000);
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required for the fresh R10 proof fixture');
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(connectionString).hostname);
  const apiRequire = createRequire(resolve('apps/api/package.json'));
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const dist = process.env['API_DIST_DIR'] ?? `dist/e2e-${process.env['API_PORT'] ?? '3001'}`;
  const { PrismaClient } = apiRequire(resolve(`apps/api/${dist}/apps/api/src/generated/prisma/client.js`));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const main = page.locator('main'), period = periodKey();
  const branchName = unique('สาขาตรวจข้อมูลผู้รับเงิน'), branchCode = '91012';
  const shop = { headers: { 'X-Company-Id': MAIN_SHOP } };
  let readerMembership: any, readerRole: any;
  const openMonth = async (target = page, selectBranch = true) => {
    await target.goto(`/companies/${MAIN_SHOP}/tax/withholding?periodKey=${period}`, FIRST_SIGHT);
    await expect(async () => {
      const ready = await formCard(target, 'ภ.ง.ด.3 (จ่ายให้บุคคล)').count() + await target.locator('main').getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).count();
      expect(ready).toBeGreaterThan(0);
    }).toPass(AFTER_PRESS);
    const chooser = target.locator('main').getByRole('combobox', { name: 'ยื่นในนาม', exact: true });
    if (selectBranch && await chooser.count()) await chooseThemedOption(target, chooser, `${branchName} (${branchCode})`);
    await expect(target.getByRole('heading', { level: 1, name: 'ภาษีหัก ณ ที่จ่าย', exact: true })).toBeVisible(AFTER_PRESS);
  };
  const payerMode = async (mode: string) => json(await api.post(`companies/${MAIN_SHOP}/tax/withholding/payer-mode`, {
    ...shop, data: { mode, effectiveFromPeriodKey: period },
  }));
  const makeLegacySource = async (kind: 'UNKNOWN' | 'MISSING_ID') => {
    const seller = unique(kind === 'UNKNOWN' ? 'ผู้รับเงินเดิมไม่ทราบประเภท' : 'ผู้รับเงินเดิมขาดเลขผู้เสียภาษี');
    const expense = await recordExpenseByHand(page, { branch: branchName, item: unique('ค่าซ่อมร้าน'), price: '1000', total: '1,000.00 บาท', seller,
      withholding: PERSON_SERVICE, toPay: '970.00 บาท', pay: true });
    await db.expenseRecord.update({ where: { id: expense.expenseId }, data: { vendorCounterpartyId: null, vendorTaxIdSnapshot: null,
      ...(kind === 'UNKNOWN' ? { vendorEntityKindSnapshot: null } : {}) } });
    await db.taxEvent.updateMany({ where: { companyId: MAIN_SHOP, sourceType: 'expense.record', sourceId: expense.expenseId,
      eventType: { in: ['WHT_PND3', 'WHT_PND53'] }, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
    return { ...expense, seller };
  };
  const correctSource = async (expense: { expenseId: string; seller: string }) => {
    const fixes = main.getByTestId('withholding-fixes');
    const issue = fixes.getByRole('status').filter({ hasText: expense.seller }).first();
    await issue.getByRole('link', { name: 'เปิดค่าใช้จ่าย', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/expenses/${expense.expenseId}$`), FIRST_SIGHT);
    await main.getByRole('button', { name: 'แก้ไขเอกสาร', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'แก้ไขเอกสาร', exact: true });
    await dialog.getByRole('textbox', { name: 'เหตุผลที่แก้ไข', exact: true }).fill('เติมข้อมูลผู้รับเงินก่อนจัดทำแบบภาษี');
    await dialog.getByRole('button', { name: 'เปิดเอกสารกลับไปตรวจสอบ', exact: true }).click();
    const payeeKind = main.getByRole('combobox', { name: 'ผู้รับเงินเป็นใคร', exact: true });
    await expect(payeeKind).toBeVisible(FIRST_SIGHT);
    if (await payeeKind.textContent() !== 'บุคคลธรรมดา') await chooseThemedOption(page, payeeKind, 'บุคคลธรรมดา');
    await chooseThemedOption(page, main.getByRole('combobox', { name: 'จ่ายค่าอะไร', exact: true }), 'ค่าบริการ (บุคคลธรรมดา) · หัก 3%');
    await main.getByRole('textbox', { name: 'เลขประจำตัวผู้เสียภาษีผู้ขาย', exact: true }).fill('3101200456789');
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
    await expect(page.getByText('ยืนยันเอกสารแล้ว', { exact: true }).first()).toBeVisible(AFTER_PRESS);
    await openMonth();
  };
  const filePaper = async (scope: Locator) => {
    await scope.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /^บันทึกว่ายื่น ภ\.ง\.ด\.3/ });
    await dialog.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว', exact: true }).click();
    await expect(scope.getByText('ยื่นแล้ว', { exact: true })).toBeVisible(AFTER_PRESS);
  };
  try {
    expect(await db.whtFiling.count({ where: { companyId: MAIN_SHOP, periodKey: period, status: 'FILED' } }), 'R10 requires the fresh isolated withholding proof database').toBe(0);
    const payer = await db.company.findUniqueOrThrow({ where: { id: MAIN_SHOP }, select: { registeredName: true, taxId: true, addressJson: true } });
    if (!payer.registeredName || !payer.taxId || !payer.addressJson) await fillShopIdentity(page);
    await page.goto(`/companies/${MAIN_SHOP}/dashboard`, FIRST_SIGHT);
    await addBranch(page, branchName, `R${Date.now().toString(36)}`, branchCode);
    await payerMode('EACH_BRANCH_PAYS');
    const branch = await db.branch.findFirstOrThrow({ where: { companyId: MAIN_SHOP, taxBranchCode: branchCode } });
    const legacy = await makeLegacySource('UNKNOWN');
    await test.step('a failed month read offers retry and never calls the month empty', async () => {
      let failing = true;
      const pattern = `**/companies/${MAIN_SHOP}/tax/withholding/months/${period}`;
      await page.route(pattern, route => failing ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'โหลดรายการไม่ได้ ลองอีกครั้ง' }) }) : route.fallback());
      try {
        await openMonth(page, false);
        await expect(main.getByRole('button', { name: 'ลองอีกครั้ง', exact: true })).toBeVisible(AFTER_PRESS);
        await expect(main.getByText('เดือนนี้ไม่มีรายการ', { exact: true })).toHaveCount(0);
        failing = false;
        await main.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
        await expect(main.getByRole('combobox', { name: 'ยื่นในนาม', exact: true })).toBeVisible(AFTER_PRESS);
      } finally { await page.unroute(pattern); }
    });
    await test.step('zero events shows corrective work on both forms and an authorized correction link', async () => {
      await openMonth();
      await expect(main.getByTestId('withholding-fixes')).toContainText(legacy.seller, AFTER_PRESS);
      await expect(main.getByRole('link', { name: 'เปิดค่าใช้จ่าย', exact: true })).toHaveCount(1);
      for (const title of ['ภ.ง.ด.3 (จ่ายให้บุคคล)', 'ภ.ง.ด.53 (จ่ายให้บริษัท)']) await expect(formCard(page, title)).not.toContainText('เดือนนี้ไม่มีรายการ');
      const list = main.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: 'รายการที่หักภาษีของเดือนนี้', exact: true }) });
      await expect(list).not.toContainText('เดือนนี้ไม่มีรายการ');
    });
    await test.step('a read-only user gets a permitted return action, and a hidden shared-payer source exposes no identity', async () => {
      const reader = await db.user.findUniqueOrThrow({ where: { username: 'qa.company' } });
      readerMembership = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId: MAIN_SHOP, userId: reader.id } }, include: { branchScopes: true } });
      const permission = await db.permission.findUniqueOrThrow({ where: { key: 'wht.pnd53.read' } });
      readerRole = await db.role.create({ data: { companyId: MAIN_SHOP, scopeKey: MAIN_SHOP, key: unique('R10_READ'), name: 'อ่านข้อมูลภาษีทดสอบ',
        permissions: { create: { permissionId: permission.id } }, memberships: { create: { membershipId: readerMembership.id } } } });
      await db.companyMembership.update({ where: { id: readerMembership.id }, data: { branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: branch.id } });
      await db.membershipBranchScope.deleteMany({ where: { membershipId: readerMembership.id } });
      await db.membershipBranchScope.create({ data: { membershipId: readerMembership.id, branchId: branch.id } });
      const readonly = await pageAs('COMPANY_VIEW');
      await openMonth(readonly);
      const rm = readonly.locator('main');
      await expect(rm.getByTestId('withholding-fixes')).toContainText(legacy.seller);
      await expect(rm.getByRole('link', { name: 'เปิดค่าใช้จ่าย', exact: true })).toHaveCount(0);
      await expect(rm.getByRole('link', { name: 'กลับไปรายการค่าใช้จ่าย', exact: true }).first()).toBeVisible();
      await expect(rm.getByRole('button', { name: /ดาวน์โหลดแบบ|บันทึกว่ายื่นแล้ว/ })).toHaveCount(0);
      await payerMode('HEAD_OFFICE_PAYS_ALL');
      const head = await db.branch.findFirstOrThrow({ where: { companyId: MAIN_SHOP, type: 'HEAD_OFFICE', status: 'ACTIVE' } });
      await db.membershipBranchScope.updateMany({ where: { membershipId: readerMembership.id }, data: { branchId: head.id } });
      await db.companyMembership.update({ where: { id: readerMembership.id }, data: { defaultBranchId: head.id } });
      await openMonth(readonly, false);
      await expect(rm.getByText('มีรายการของสาขาที่คุณไม่ได้ดูแลที่ต้องแก้ก่อนยื่นแบบนี้ ให้ผู้ดูแลสาขานั้นแก้ข้อมูล')).toHaveCount(1);
      await expect(rm).not.toContainText(legacy.seller);
      await expect(rm.getByRole('link', { name: 'กลับไปรายการค่าใช้จ่าย', exact: true }).first()).toBeVisible();
      await payerMode('EACH_BRANCH_PAYS');
    });
    await test.step('correct the source through its expense, then download and file the normal paper', async () => {
      await openMonth(); await correctSource(legacy);
      await expect(main.getByTestId('withholding-fixes').getByText(legacy.seller, { exact: false })).toHaveCount(0);
      const normal = formCard(page, 'ภ.ง.ด.3 (จ่ายให้บุคคล)');
      await pressForDownload(page, () => normal.getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.3', exact: true }).click());
      await filePaper(normal);
    });
    const normal = formCard(page, 'ภ.ง.ด.3 (จ่ายให้บุคคล)');
    const earlier = await pressForDownload(page, () => normal.getByRole('button', { name: 'ดาวน์โหลดแบบที่ยื่น', exact: true }).click());
    const earlierBytes = await readFile((await earlier.download.path())!);
    const before = await db.whtFiling.findFirstOrThrow({ where: { companyId: MAIN_SHOP, periodKey: period, establishmentCode: branchCode, sequence: 0, status: 'FILED' }, include: { lines: true, latestPackage: true } });
    const missing = await makeLegacySource('MISSING_ID');
    await test.step('one good filed source and one missing ID show a truthful warning while the old download stays byte-identical', async () => {
      await openMonth();
      await expect(normal).toContainText(`${missing.seller}: ไม่อยู่ในแบบที่ยื่นแล้ว แก้ข้อมูลก่อน แล้วระบบจะบอกว่าต้องยื่นแบบเพิ่มเติมหรือยื่นอีกแบบหนึ่ง`, AFTER_PRESS);
      await expect(main.getByTestId('withholding-fixes')).toContainText(missing.seller);
      const kept = await pressForDownload(page, () => normal.getByRole('button', { name: 'ดาวน์โหลดแบบที่ยื่น', exact: true }).click());
      expect(await readFile((await kept.download.path())!)).toEqual(earlierBytes);
      expect(await db.whtFiling.findUniqueOrThrow({ where: { id: before.id }, include: { lines: true, latestPackage: true } })).toEqual(before);
    });
    await test.step('correct the omitted source and download the existing additional-paper sequence', async () => {
      await correctSource(missing);
      await expect(main.getByTestId('withholding-fixes').getByText(missing.seller, { exact: false })).toHaveCount(0);
      const additional = normal.getByRole('region', { name: 'ยื่นเพิ่มเติมครั้งที่ 1', exact: true });
      const file = await pressForDownload(page, () => normal.getByRole('button', { name: 'ดาวน์โหลดแบบยื่นเพิ่มเติมครั้งที่ 1', exact: true }).click());
      expect(file.name).toContain('เพิ่มเติมครั้งที่-1');
      await filePaper(additional);
      expect(await db.whtFiling.findUniqueOrThrow({ where: { id: before.id }, include: { lines: true, latestPackage: true } })).toEqual(before);
    });
  } finally {
    if (readerMembership) {
      await db.membershipBranchScope.deleteMany({ where: { membershipId: readerMembership.id } });
      if (readerMembership.branchScopes.length) await db.membershipBranchScope.createMany({ data: readerMembership.branchScopes.map((s: any) => ({ membershipId: readerMembership.id, branchId: s.branchId })) });
      await db.companyMembership.update({ where: { id: readerMembership.id }, data: { branchScopeMode: readerMembership.branchScopeMode, defaultBranchId: readerMembership.defaultBranchId } });
    }
    if (readerRole) await db.role.delete({ where: { id: readerRole.id } });
    await db.$disconnect();
  }
});

test('@journey e-WHT mixed month: normal PND53 printed bytes exclude bank rows and the bank workbook downloads separately', async ({ pageAs, api }) => {
  test.setTimeout(600_000);
  const page = await pageAs('OWNER');
  page.setDefaultTimeout(AFTER_PRESS.timeout);
  const main = page.locator('main');
  const card = () => main.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: 'ภ.ง.ด.53 (จ่ายให้บริษัท)', exact: true }) });
  await withEWhtBranch(api, async branch => {
    await setEWhtSetting(page, true);
    const payer = unique('บริษัท ยื่นแบบเองเดือนผสม');
    await recordExpenseByHand(page, { branch: branch.name, seller: payer, item: unique('ค่าบริการเดือนผสม'), price: '1000', total: '1,000.00 บาท', toPay: '970.00 บาท', pay: true,
      withholding: { payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: 'ค่าบริการ (นิติบุคคล) · หัก 3%', rate: '3', withheld: '30.00 บาท', taxId: eWhtPayeeTaxId(branch.code, 4), address: '45 ถนนสีลม กรุงเทพมหานคร 10500' } });
    await openEWhtMonth(page, branch);
    const normal = await pressForDownloadBuffer(page, () => card().getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.53', exact: true }).click());
    expect(normal.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    const baselinePages = await printedPdfPages(normal.buffer);
    const bankPayee = unique('บริษัท ธนาคารนำส่งเดือนผสม');
    await recordExpenseByHand(page, { branch: branch.name, seller: bankPayee, item: unique('ค่าโฆษณาเดือนผสม'), price: '1000', total: '1,000.00 บาท', toPay: '990.00 บาท', pay: true,
      withholding: { payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: 'ค่าโฆษณา (นิติบุคคล) · หัก 2%', rate: '1', withheld: '10.00 บาท', taxId: eWhtPayeeTaxId(branch.code, 5), address: '45 ถนนสีลม กรุงเทพมหานคร 10500' } }, async block => {
      await chooseThemedOption(page, block.getByRole('combobox', { name: E_WHT_WORDS['W-F1'], exact: true }), E_WHT_WORDS['W-F3']);
    });
    await openEWhtMonth(page, branch);
    await expect(card().locator('.mangmee-unit')).toHaveText([metricText('1', 'รายการ'), metricText('1,000.00', 'บาท'), metricText('30.00', 'บาท')], AFTER_PRESS);
    const mixed = await pressForDownloadBuffer(page, () => card().getByRole('button', { name: 'ดาวน์โหลดแบบ ภ.ง.ด.53', exact: true }).click());
    expect(await printedPdfPages(mixed.buffer), 'adding an e-WHT payment changes no printed page bytes').toEqual(baselinePages);
    const bank = main.locator('.mangmee-card').filter({ has: page.getByRole('heading', { name: E_WHT_WORDS['W-T1'], exact: true }) });
    await expect(bank).toContainText(bankPayee);
    await expect(bank).not.toContainText(payer);
    const separate = await pressForDownloadBuffer(page, () => bank.getByRole('button', { name: E_WHT_WORDS['W-T2b'], exact: true }).click());
    const xml = workbookXml(separate.buffer);
    expect(xml).toContain(bankPayee);
    expect(xml).not.toContain(payer);
    expect(xml).toContain(E_WHT_WORDS['W-X3']);
    await test.info().attach('e-wht-mixed-month', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  });
});
