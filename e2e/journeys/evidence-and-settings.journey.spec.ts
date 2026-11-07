/**
 * Journey: the files for the accounting office, a branch switched off, and a name change that leaves
 * a trace: three short errands of an owner, with a staff member changing her own display name.
 *
 * Downloads are opened as archives so the Thai sheets and the actual installment facts are checked.
 */
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { posix, resolve } from 'node:path';
import type { APIRequestContext, Page, Response } from '@playwright/test';
import { test, expect } from '../harness/fixtures';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { loginAs, QA_ACCOUNTS } from '../harness/roles';
import { AFTER_PRESS, FIRST_SIGHT, branchEntry, openUserMenu, picture, pressForDownloadBuffer, pressMenu, recordExpenseByHand, thaiMonth, thaiDate, dayOfLastMonth } from './journey-kit';

type Branches = { items: Array<{ id: string; code: string; name: string; status: string }> };
type NameHistory = { displayName: string; history: Array<{ oldName: string; newName: string; changedByName: string | null }> };

const STAFF = QA_ACCOUNTS.STAFF.displayName;
const toast = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text }).first();

function unzip(file: Buffer) {
  const files = new Map<string, Buffer>();
  for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
    const size = file.readUInt32LE(offset + 18), length = file.readUInt16LE(offset + 26);
    const name = file.subarray(offset + 30, offset + 30 + length).toString();
    const start = offset + 30 + length + file.readUInt16LE(offset + 28);
    const bytes = file.subarray(start, start + size);
    files.set(name, file.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes);
    offset = start + size;
  }
  return files;
}
const decodeXml = (text: string) => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function rows(xml: string): string[][] {
  return [...xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map(row =>
    [...row[1]!.matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)].map(cell =>
      decodeXml(cell[1]!.match(/<t\b[^>]*>([\s\S]*?)<\/t>|<v>([^<]*)<\/v>/)?.slice(1).find(value => value !== undefined) ?? '')));
}
const headers = {
  'ต้องตามเอกสาร': ['เลขที่รายการ', 'สิ่งที่ต้องตาม', 'ดูรายการ'],
  'สรุปรายเดือน': ['หัวข้อ', 'รายการ', 'สกุลเงิน', 'มูลค่าก่อน VAT', 'VAT', 'ยอดรวมตามเอกสาร', 'หัก ณ ที่จ่าย', 'ยอดจ่ายสุทธิ', 'จ่ายแล้ว', 'ค้างจ่าย', 'จำนวนรายการ'],
  'รายการค่าใช้จ่าย': ['วันที่เอกสาร', 'วันที่ส่งเข้ามั่งมี', 'เลขที่รายการ', 'เลขที่ตามเอกสาร', 'ประเภทเอกสาร', 'ผู้ขาย/ผู้รับเงิน', 'เลขประจำตัวผู้เสียภาษีผู้ขาย', 'สาขาผู้ขาย', 'ที่อยู่ผู้ขาย', 'หมวดค่าใช้จ่าย', 'รายละเอียด', 'สกุลเงิน', 'มูลค่าก่อน VAT', 'VAT', 'ยอดรวมตามเอกสาร', 'สิทธิภาษีซื้อ', 'หลักฐานรายจ่าย', 'หัก ณ ที่จ่าย (ทั้งเอกสาร)', 'ยอดจ่ายสุทธิ', 'จ่ายแล้ว', 'ค้างจ่าย', 'วันที่จ่ายล่าสุด', 'สำรองจ่ายโดย', 'สถานะ', 'หมายเหตุ'],
  'การจ่าย': ['วันที่จ่าย', 'เลขที่รายการ', 'ผู้ขาย/ผู้รับเงิน', 'ยอดจ่าย', 'สกุลเงิน', 'วิธีจ่าย', 'จ่ายจาก', 'เลขที่ใบสำคัญจ่าย'],
  'หัก ณ ที่จ่าย': ['วันที่จ่าย', 'เลขที่รายการ', 'ผู้รับเงิน', 'เลขประจำตัวผู้เสียภาษี', 'สาขา', 'ที่อยู่', 'แบบ ภ.ง.ด.', 'ประเภทเงินได้', 'อัตรา (%)', 'จำนวนเงินที่จ่าย', 'ภาษีที่หัก', 'สกุลเงิน', 'เลขที่หนังสือรับรอง 50 ทวิ', 'สถานะ', 'หมายเหตุ'],
  'ไฟล์ทั้งหมด': ['เลขที่รายการ', 'ชนิดเอกสาร', 'ฉบับ', 'แทนด้วย', 'ไฟล์', 'ชุดที่'],
  'เกี่ยวกับไฟล์นี้': ['หัวข้อ', 'ค่า'],
};
function workbookSheets(buffer: Buffer, bundled = false, partCount = 1) {
  const files = unzip(buffer);
  const declarations = [...files.get('xl/workbook.xml')!.toString().matchAll(/<sheet\b([^>]+)>/g)];
  const names = declarations.map(match => decodeXml(match[1]!.match(/name="([^"]+)"/)![1]!));
  const relations = new Map([...files.get('xl/_rels/workbook.xml.rels')!.toString().matchAll(/<Relationship\b([^>]+)>/g)].map(match => {
    const attributes = match[1]!;
    return [attributes.match(/Id="([^"]+)"/)![1]!, decodeXml(attributes.match(/Target="([^"]+)"/)![1]!)];
  }));
  const expectedNames = Object.keys(headers).filter(name => (bundled || name !== 'ไฟล์ทั้งหมด') && (!['การจ่าย', 'หัก ณ ที่จ่าย'].includes(name) || names.includes(name)));
  expectedNames.splice(expectedNames.indexOf('ไฟล์ทั้งหมด') < 0 ? expectedNames.indexOf('เกี่ยวกับไฟล์นี้') : expectedNames.indexOf('ไฟล์ทั้งหมด'), 0, 'รายงานภาษีซื้อ');
  expect(names).toEqual(expectedNames);
  return new Map(names.map((name, index) => {
    const relationId = declarations[index]![1]!.match(/r:id="([^"]+)"/)![1]!;
    const target = relations.get(relationId)!;
    expect(target).not.toMatch(/^[a-z]+:/i);
    const path = posix.normalize(target.startsWith('/') ? target.slice(1) : posix.join('xl', target));
    const xml = files.get(path)!.toString();
    expect(decodeXml(xml)).not.toMatch(/HYPERLINK\("http/i);
    const data = rows(xml);
    if (name === 'รายงานภาษีซื้อ') {
      expect(data.flat()).toContain('จัดตามเดือนวันที่เอกสาร ระบบยังไม่ได้เก็บเดือนที่ใช้สิทธิภาษีซื้อ');
      return [name, data] as const;
    }
    const expected = headers[name as keyof typeof headers].filter(label => name !== 'ไฟล์ทั้งหมด' || label !== 'ชุดที่' || partCount > 1);
    if (name === 'รายการค่าใช้จ่าย') {
      if (data[0]!.includes('สาขาของร้าน')) expected.splice(2, 0, 'สาขาของร้าน');
      if (bundled) expected.push('ไฟล์เอกสาร');
      expected.push('วิธีนำส่งภาษีหัก ณ ที่จ่าย');
      if (bundled) expected.push('ชุดเอกสารรายการ');
    }
    if (name === 'การจ่าย' && bundled) expected.push('ไฟล์หลักฐานการจ่าย');
    expect(data[0]).toEqual(expected);
    return [name, data.slice(1)] as const;
  }));
}

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
  for (const label of ['ส่งออก Excel ให้สำนักงานบัญชี', 'ดาวน์โหลด Excel', 'ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี']) {
    await expect(main.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await pressMenu(page, 'อัปโหลดใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
  await expect(main.getByText('ส่งใบเสร็จให้ระบบอ่านและเก็บเป็นร่างเพื่อตรวจ', { exact: true })).toBeVisible();
  // A real BFF mutation carries the session's CSRF token and Origin, as the web app sends them.
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'watchdog_csrf')?.value;
  expect(csrf, 'watchdog_csrf cookie is present after sign-in').toBeTruthy();
  const mutation = { 'X-Company-Id': free.companyId, Origin: new URL(page.url()).origin, 'x-csrf-token': csrf! };
  for (const endpoint of ['accountant-package', 'accountant-package/bundle-plan', 'accountant-package/bundle/1', 'accounting-software-export']) {
    const result = await page.request.post(`/api/v1/companies/${free.companyId}/expenses/${endpoint}`, { data: endpoint === 'accounting-software-export' ? { preset: 'purchase_journal' } : {}, headers: mutation });
    expect(result.status()).toBe(403);
    expect((await result.json()).code).toBe('FREE_EXPENSE_DRAFTS_ONLY');
  }
  await expect(main.getByRole('combobox', { name: 'รูปแบบไฟล์', exact: true })).toHaveCount(0);
  await expect(main.getByRole('textbox', { name: /^รหัสหมวดในไฟล์/ })).toHaveCount(0);
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

for (const width of [390, 1280, 1556]) test(`@journey office category mapping survives refresh and clears (${width}px)`, async ({ pageAs, apiAs, companyId }) => {
  const page = await pageAs('OWNER'), api = await apiAs('OWNER');
  await page.setViewportSize({ width, height: 1000 });
  type Category = { id: string; name: string; referencedOnly?: true; accountantAccount?: { accountCode: string; accountName: string } | null };
  const categories = await json<Category[]>(await api.get(`companies/${companyId}/expense-categories/manage`));
  const category = categories.find(row => !row.referencedOnly);
  expect(category, 'At least one visible category is required').toBeTruthy();
  if (!category) throw new Error('No category fixture');
  const endpoint = `companies/${companyId}/expense-categories/${category.id}/accountant-account`;
  const original = category.accountantAccount;
  try {
    await page.goto(`/companies/${companyId}/expenses/categories`, FIRST_SIGHT);
    const code = page.getByRole('textbox', { name: `รหัสหมวดในไฟล์ ${category.name}`, exact: true });
    const name = page.getByRole('textbox', { name: `ชื่อหมวดในไฟล์ ${category.name}`, exact: true });
    await expect(code).toBeVisible(FIRST_SIGHT);
    const enteredCode = `J${Date.now()}`, enteredName = unique('หมวดสำนักงานบัญชี');
    await code.fill(enteredCode); await name.fill(enteredName);
    const saved = page.waitForResponse(response => response.url().includes(endpoint) && response.request().method() === 'PUT');
    await name.blur(); expect((await saved).status()).toBe(200);
    await page.reload(FIRST_SIGHT);
    await expect(code).toHaveValue(enteredCode, FIRST_SIGHT); await expect(name).toHaveValue(enteredName);
    await code.fill(''); await name.fill('');
    const cleared = page.waitForResponse(response => response.url().includes(endpoint) && response.request().method() === 'DELETE');
    await name.blur(); expect((await cleared).status()).toBe(204);
    await page.reload(FIRST_SIGHT);
    await expect(code).toHaveValue('', FIRST_SIGHT); await expect(name).toHaveValue('');
  } finally {
    const restored = original ? await api.put(endpoint, { data: original }) : await api.delete(endpoint);
    expect(restored.status()).toBe(original ? 200 : 204);
  }
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

  const expense = await test.step('owner: a service with 3% withheld, paid in two installments on two days', async () => {
    const expense = await recordExpenseByHand(owner, {
      branch: 'Head Office (สำนักงานใหญ่)', lastMonthDay: 1, item: unique('ค่าบริการ'), price: '1000', total: '1,000.00 บาท', seller: vendor, toPay: '970.00 บาท',
      withholding: { payeeKind: 'บริษัท / ห้างหุ้นส่วน', incomeType: 'ค่าบริการ (นิติบุคคล) · หัก 3%', rate: '3', withheld: '30.00 บาท',
        taxId: '0105557123457', address: '12 ถนนสีลม แขวงสีลม เขตบางรัก กรุงเทพมหานคร 10500' },
    });
    for (const day of [1, 2]) {
      const date = main.getByRole('combobox', { name: 'วันที่จ่ายเงินจริง', exact: true });
      const previousMonthSelected = (await date.innerText()).trim() === thaiDate(dayOfLastMonth(1));
      await date.click();
      if (!previousMonthSelected) await owner.getByRole('button', { name: 'เดือนก่อนหน้า', exact: true }).click();
      await owner.getByRole('button', { name: String(day), exact: true }).click();
      await expect(date).toHaveText(thaiDate(dayOfLastMonth(day)));
      await main.locator('#expense-payment-amount').fill('485');
      await main.getByLabel('แนบสลิป (ถ้ามี)', { exact: true }).setInputFiles(picture(`${unique('หลักฐานการจ่าย')}.png`));
      const response = owner.waitForResponse(result => result.url().endsWith(`/expenses/${expense.expenseId}/payment`) && result.request().method() === 'POST');
      // The second installment pays the whole remainder, so its button says so.
      await main.getByRole('button', { name: day === 1 ? 'บันทึกจ่าย 485.00 บาท' : 'บันทึกจ่ายส่วนที่เหลือ 485.00 บาท', exact: true }).click();
      expect((await response).ok()).toBe(true);
      await expect(toast(owner, 'บันทึกจ่ายแล้ว 485.00 บาท')).toBeVisible(AFTER_PRESS);
    }
    await expect(main.locator('.mangmee-page-header').getByText('จ่ายแล้ว', { exact: true })).toBeVisible();
    return expense;
  });

  await test.step('หลักฐานทางบัญชี: the installment month → fix a row, return to its filters, and download the accountant bundle', async () => {
    await pressMenu(owner, 'หลักฐานทางบัญชี', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(main.getByRole('heading', { level: 1, name: 'หลักฐานทางบัญชี', exact: true })).toBeVisible(FIRST_SIGHT);
    const month = main.getByRole('combobox', { name: 'เดือน', exact: true });
    await month.click();
    await owner.getByRole('option', { name: new RegExp(`^${thaiMonth(dayOfLastMonth(1)).replace(/\./g, '\\.')} · \\d+ รายการ`) }).click();
    await expect(month).toContainText(thaiMonth(dayOfLastMonth(1)));
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
    await chooseThemedOption(owner, main.getByRole('combobox', { name: 'รูปแบบไฟล์', exact: true }), 'Excel สำหรับสำนักงานบัญชี');
    const excel = main.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true });
    await expect(excel).toBeEnabled(AFTER_PRESS);
    const workbook = await pressForDownloadBuffer(owner, () => excel.click());
    expect(workbook.name).toMatch(/\.xlsx$/);
    const sheets = workbookSheets(workbook.buffer);
    const payments = sheets.get('การจ่าย')!.filter(row => row[1] === expense.expenseNumber);
    expect(payments.map(row => [row[0], row[3]])).toEqual([1, 2].map(day => [thaiDate(dayOfLastMonth(day)), '485']));
    const withheld = sheets.get('หัก ณ ที่จ่าย')!.filter(row => row[1] === expense.expenseNumber);
    expect(withheld.map(row => [row[0], row[8], row[9], row[10]])).toEqual([1, 2].map(day => [thaiDate(dayOfLastMonth(day)), '3', '500', '15']));
    await expect(owner.getByText(/ดาวน์โหลด Excel แล้ว/).first()).toBeVisible(AFTER_PRESS);
    await expect(main.getByText(/^สร้างเมื่อ /)).toBeVisible();
    await expect(main.getByRole('button', { name: 'ดาวน์โหลดไฟล์ทั้งหมด', exact: true })).toHaveCount(0);
    const bundles = main.getByRole('button', { name: /^ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี( ชุดที่ \d+ จาก \d+)?$/ });
    await expect(bundles.first()).toBeEnabled(AFTER_PRESS);
    const count = await bundles.count();
    const packetNames: string[] = [];
    for (let index = 0; index < count; index++) {
      const bundle = await pressForDownloadBuffer(owner, () => bundles.nth(index).click(), 120_000);
      expect(bundle.name).toMatch(/\.zip$/);
      const files = unzip(bundle.buffer);
      expect(files.has('สารบัญ.xlsx')).toBe(true);
      for (const name of files.keys()) expect(name).not.toMatch(/c[a-z0-9]{24}/i);
      const bundledSheets = workbookSheets(files.get('สารบัญ.xlsx')!, true, count);
      const selectedRow = bundledSheets.get('รายการค่าใช้จ่าย')!.find(row => row.includes(expense.expenseNumber));
      expect(selectedRow?.at(-1)).toContain('ชุดเอกสารรายการ/');
      for (const [name, bytes] of files) if (name.startsWith('ชุดเอกสารรายการ/')) {
        expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
        packetNames.push(name);
      }
    }
    expect(packetNames).toContain(`ชุดเอกสารรายการ/${expense.expenseNumber}.pdf`);
    await chooseThemedOption(owner, main.getByRole('combobox', { name: 'รูปแบบไฟล์', exact: true }), 'ไฟล์แยกตามหมวด');
    const journal = await pressForDownloadBuffer(owner, () => excel.click());
    expect(journal.name).toMatch(/^สมุดรายวันซื้อ-.*\.xlsx$/);
    const journalFiles = unzip(journal.buffer);
    expect(journalFiles.get('xl/workbook.xml')!.toString()).toContain('สมุดรายวันซื้อ');
    expect(journalFiles.get('xl/worksheets/sheet1.xml')!.toString()).toContain('รหัสบัญชี');
    await expect(main.getByText(/ดาวน์โหลดไฟล์แล้ว \d+ รายการ/)).toBeVisible(AFTER_PRESS);
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
    // This vendor's only expense is the installment one recorded at the start of the journey.
    await expect(expense).toContainText('1,000.00 บาท');
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

const accountantAccessNote = 'ผู้ทำบัญชีที่เชิญเข้าร้านดาวน์โหลดเองได้ตามสิทธิ์ที่ได้รับ';
const apiRequire = createRequire(resolve('apps/api/package.json'));

/** Only the disposable local proof database is used. Downloads still pass through real HTTP guards. */
async function packFixture(api: APIRequestContext, request: APIRequestContext, companyId: string, count: number, withVoucher = false) {
  const connectionString = process.env['DATABASE_URL'];
  if (!connectionString) throw new Error('DATABASE_URL is required for the pack v2 proof fixture');
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(connectionString).hostname);
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const dist = process.env['API_DIST_DIR'] ?? `dist/e2e-${process.env['API_PORT'] ?? '3001'}`;
  const { PrismaClient } = apiRequire(resolve(`apps/api/${dist}/apps/api/src/generated/prisma/client.js`));
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const owner = await db.user.findUniqueOrThrow({ where: { username: QA_ACCOUNTS.OWNER.username } });
    const branches = [];
    for (const suffix of ['VISIBLE', 'HIDDEN']) branches.push(await db.branch.create({ data: {
      companyId, code: unique(suffix).slice(-35), name: unique(`สาขาชุดเอกสาร ${suffix}`), type: 'BRANCH', status: 'ACTIVE',
    } }));
    const date = dayOfLastMonth(3), signed = await readFile(resolve('apps/api/src/modules/expenses/domain/logic/expense-record-signed.fixture.pdf'));
    const { PDFDocument } = apiRequire('pdf-lib');
    const paper = await PDFDocument.create(); paper.addPage().drawText('SYNTHETIC RECEIPT');
    const small = Buffer.from(await paper.save());
    const receipt = Buffer.concat([small, Buffer.alloc(500_000 - small.length, 32)]);
    const upload = async (bytes: Buffer, branchId: string, label: string) => {
      const checksumSha256 = createHash('sha256').update(bytes).digest('hex');
      const intent = await json<{ attachmentId: string; uploadUrl: string; uploadHeaders: Record<string, string> }>(await api.post(`companies/${companyId}/attachments/upload-intent`, {
        data: { originalFileName: `${unique(label)}.pdf`, mimeType: 'application/pdf', byteSize: bytes.length, branchId, visibility: 'INTERNAL' },
      }));
      const uploaded = await request.put(intent.uploadUrl, { data: bytes, headers: { ...intent.uploadHeaders, 'Content-Type': 'application/pdf' } });
      expect(uploaded.status()).toBe(200);
      await json(await api.post(`companies/${companyId}/attachments/${intent.attachmentId}/complete`, { data: { byteSize: bytes.length, checksumSha256 } }));
      return intent.attachmentId;
    };
    const records = [];
    for (let index = 0; index <= count; index++) {
      const branchId = branches[index === count ? 1 : 0]!.id;
      const attachmentId = await upload(index === 0 ? signed : receipt, branchId, 'หลักฐานทดสอบ');
      const row = await db.expenseRecord.create({ data: {
        companyId, branchId, expenseNumber: unique('EXP-PACK'), status: 'CONFIRMED', expenseDate: date,
        vendorNameSnapshot: unique(index === count ? 'ผู้ขายนอกสาขา' : 'ผู้ขายชุดเอกสาร'), currency: 'THB',
        sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'USABLE_FOR_TAX', inputVatClaimStatus: 'NON_CLAIMABLE',
        primaryAttachmentId: attachmentId, subtotalAmount: '100', taxableAmount: '100', grandTotalAmount: '100', netPayableAmount: '100',
        paidAmount: index === count - 1 ? '50' : '100', outstandingAmount: index === count - 1 ? '50' : '0',
        paymentStatus: index === count - 1 ? 'PARTIALLY_PAID' : 'PAID', paidAt: date, createdByUserId: owner.id,
        lines: { create: { companyId, lineNumber: 1, description: 'รายจ่ายทดสอบ', quantity: '1', unitPrice: '100', taxableAmount: '100', lineSubtotalAmount: '100', lineTotalAmount: '100' } },
      } });
      await db.attachmentLink.create({ data: { companyId, attachmentId, targetType: 'expense.record', targetId: row.id, purpose: 'expense.receipt.primary', linkedByUserId: owner.id } });
      const payment = await db.expensePayment.create({ data: { companyId, expenseId: row.id, amount: index === count - 1 ? '50' : '100', paidAt: date, paidAtConfirmed: true, paymentMethod: 'CASH', createdByUserId: owner.id, postingStatus: 'not_required' } });
      records.push({ ...row, paymentId: payment.id });
    }
    const claim = await db.reimbursementRequest.create({ data: { companyId, branchId: branches[0]!.id, requestNo: unique('RB-PACK'), requesterUserId: owner.id,
      requesterDisplayNameSnapshot: owner.displayName, reason: 'ทดสอบชุดเอกสาร', categoryKey: 'OTHER', amount: '200', incurredDate: date,
      status: 'APPROVED', paymentStatus: 'PAID', paymentTotalAmount: '200', outstandingAmount: '0', approvedAt: date, createdByUserId: owner.id } });
    for (let index = 0; index < 2; index++) {
      const line = await db.reimbursementLine.create({ data: { companyId, reimbursementRequestId: claim.id, lineNo: index + 1, incurredDate: date,
        description: 'รายจ่ายจากใบเบิก', categoryKey: 'OTHER', amount: '100', linkedExpenseId: records[index]!.id } });
      await db.expenseRecord.update({ where: { id: records[index]!.id }, data: { sourceReimbursementRequestId: claim.id, sourceReimbursementLineId: line.id } });
    }
    const claimAttachmentId = await upload(signed, branches[0]!.id, 'ใบเบิกเซ็นแล้ว');
    const link = await db.attachmentLink.create({ data: { companyId, attachmentId: claimAttachmentId, targetType: 'reimbursement_request', targetId: claim.id,
      purpose: 'reimbursement.claim_form.signed', linkedByUserId: owner.id } });
    await db.attachmentObject.update({ where: { id: claimAttachmentId }, data: { metadataJson: { reimbursementSignedCopyAck: { linkId: link.id,
      acknowledgedByUserId: owner.id, acknowledgedAt: new Date().toISOString() } } } });
    let voucher: { id: string; documentNumber: string | null } | undefined;
    if (withVoucher) voucher = await db.disbursementVoucher.create({ data: { companyId, branchId: branches[0]!.id, documentNumber: unique('PV-PACK'),
      status: 'PAID', origin: 'DIRECT_PAYMENT', payeeName: 'ผู้รับเงินทดสอบ', payeeBasis: 'PREPARER_CONFIRMED', totalAmount: '200',
      preparedByUserId: owner.id, paidByUserId: owner.id, paidDate: date, paidSnapshotJson: {}, pdfAttachmentId: claimAttachmentId,
      lines: { create: records.slice(0, 2).map((row, position) => ({ companyId, expenseId: row.id, position, amount: '100', expensePaymentId: row.paymentId, coversPaymentId: row.paymentId })) } } });
    test.info().annotations.push({ type: 'pack-v2-fixture', description: JSON.stringify({ companyId, branchIds: branches.map(branch => branch.id), expenseIds: records.map(row => row.id), claimId: claim.id, voucherId: voucher?.id }) });
    return { db, branches, records, claim, voucher, signed };
  } catch (error) { await db.$disconnect(); throw error; }
}

async function actualBundle(api: APIRequestContext, companyId: string, selection: { expenseIds: string[] }, part: number) {
  const response = await api.post(`companies/${companyId}/expenses/accountant-package/bundle/${part}`, { data: selection, timeout: 120_000 });
  if (!response.ok()) throw new Error(`Bundle ${part} failed with ${response.status()}: ${await response.text()}`);
  return unzip(await response.body());
}

test('@journey invited accountant downloads pack v2 within assigned scope', async ({ pageAs, apiAs, request, companyId }) => {
  test.setTimeout(300_000);
  const owner = await apiAs('OWNER'), fixture = await packFixture(owner, request, companyId, 3, true);
  const { db, records, branches, claim, voucher } = fixture;
  let membership: any;
  try {
    const user = await db.user.findUniqueOrThrow({ where: { username: QA_ACCOUNTS.ACCOUNTANT.username } });
    membership = await db.companyMembership.findUniqueOrThrow({ where: { companyId_userId: { companyId, userId: user.id } }, include: { branchScopes: true, roles: { include: { role: true } } } });
    expect(membership.roles.some((role: any) => role.role.key === 'ACCOUNTANT')).toBe(true);
    await db.membershipBranchScope.deleteMany({ where: { membershipId: membership.id } });
    await db.companyMembership.update({ where: { id: membership.id }, data: { branchScopeMode: 'SELECTED_BRANCHES', defaultBranchId: branches[0]!.id } });
    await db.membershipBranchScope.create({ data: { membershipId: membership.id, branchId: branches[0]!.id } });
    const accountant = await apiAs('ACCOUNTANT'), page = await pageAs('ACCOUNTANT');
    const selection = { expenseIds: [records[0]!.id, records[2]!.id, records[3]!.id] };
    const plan = await json<{ counts: { recordPacks: number; claimForms: number; vouchers: number }; partCount: number }>(await accountant.post(`companies/${companyId}/expenses/accountant-package/bundle-plan`, { data: selection }));
    expect(plan.counts).toMatchObject({ recordPacks: 2, claimForms: 0, vouchers: 0 });
    const sheetsResponse = await accountant.post(`companies/${companyId}/expenses/accountant-package`, { data: selection });
    expect(sheetsResponse.ok()).toBe(true);
    const workbook = workbookSheets(Buffer.from((await sheetsResponse.json()).indexXlsxBase64, 'base64'));
    expect(workbook.get('รายการค่าใช้จ่าย')!.flat()).toEqual(expect.arrayContaining([records[0]!.expenseNumber, records[2]!.expenseNumber]));
    const files = await actualBundle(accountant, companyId, selection, 1);
    expect(files.has(`ชุดเอกสารรายการ/${records[2]!.expenseNumber}.pdf`)).toBe(true);
    const { PDFDocument } = apiRequire('pdf-lib');
    expect((await PDFDocument.load(files.get(`ชุดเอกสารรายการ/${records[2]!.expenseNumber}.pdf`)!)).getPageCount()).toBeGreaterThan(1);
    const visibleText = [...files.keys(), ...workbookSheets(files.get('สารบัญ.xlsx')!, true, plan.partCount).values()].flat(3).join(' ');
    for (const hidden of [records[1]!.expenseNumber, records[3]!.expenseNumber, claim.requestNo, voucher!.documentNumber]) expect(visibleText).not.toContain(hidden);
    const denied = await accountant.post(`companies/${companyId}/expenses/accountant-package/bundle-plan`, { data: { branchId: branches[1]!.id } });
    expect(denied.status()).toBe(403);
    await page.goto(`/companies/${companyId}/expenses?month=${records[0]!.expenseDate.toISOString().slice(0, 7)}`, FIRST_SIGHT);
    await page.getByRole('button', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true }).click();
    await expect(page.getByRole('dialog').getByText(accountantAccessNote, { exact: true })).toBeVisible(AFTER_PRESS);
    const download = await pressForDownloadBuffer(page, () => page.getByRole('dialog').getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click());
    expect(workbookSheets(download.buffer).get('รายการค่าใช้จ่าย')!.flat()).not.toContain(records[3]!.expenseNumber);
  } finally {
    if (membership) {
      await db.membershipBranchScope.deleteMany({ where: { membershipId: membership.id } });
      if (membership.branchScopes.length) await db.membershipBranchScope.createMany({ data: membership.branchScopes.map((scope: any) => ({ membershipId: membership.id, branchId: scope.branchId })) });
      await db.companyMembership.update({ where: { id: membership.id }, data: { branchScopeMode: membership.branchScopeMode, defaultBranchId: membership.defaultBranchId } });
    }
    await db.$disconnect();
  }
});

test('@journey pack v2 export states and accountant hint at 390 1280 1556', async ({ pageAs, companyId }) => {
  test.setTimeout(300_000);
  const page = await pageAs('OWNER');
  const endpoint = `**/api/v1/companies/${companyId}/expenses/accountant-package/bundle-plan`;
  const plan = { fileCount: 63, partCount: 2, missingReceiptCount: 1,
    counts: { receipts: 30, paymentSlips: 0, substituteReceipts: 0, vouchers: 0, supportingFiles: 1, whtCertificates: 0, claimForms: 1, recordPacks: 31 } };
  // Only output states are controlled. The session, commercial gate and route remain real.
  for (const width of [390, 1280, 1556]) {
    await page.setViewportSize({ width, height: 1000 });
    let release!: () => void;
    const pending = new Promise<void>(done => { release = done; });
    await page.route(endpoint, async route => { await pending; await route.fulfill({ json: plan }); });
    await page.goto(`/companies/${companyId}/expenses/evidence`, FIRST_SIGHT);
    const card = page.getByText(accountantAccessNote, { exact: true }).locator('..');
    await expect(card).toBeVisible(AFTER_PRESS);
    await expect(card.getByRole('status').filter({ hasText: 'กำลังนับไฟล์...' })).toBeVisible();
    const capture = async (state: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await card.locator('button:visible, p:visible').evaluateAll(elements => elements.every(element => element.scrollWidth <= element.clientWidth))).toBe(true);
      await test.info().attach(`pack-v2-${width}-${state}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    };
    await capture('loading'); release();
    const parts = card.getByRole('button', { name: /^ดาวน์โหลดชุดเอกสารให้สำนักงานบัญชี/ });
    await expect(parts).toHaveCount(2, AFTER_PRESS);
    await expect(parts.first()).toHaveClass(/mangmee-btn-primary/);
    await expect(parts.nth(1)).toHaveClass(/mangmee-btn-secondary/);
    await expect(card.locator('.mangmee-btn-primary')).toHaveCount(1);
    await expect(card).toContainText('ใบเบิก 1'); await expect(card).toContainText('ชุดเอกสารรายการ 31');
    await expect(async () => {
      const sizes = await card.locator('.mangmee-actions > button').evaluateAll(buttons => buttons.map(button => { const box = button.getBoundingClientRect(); return [Math.round(box.width), Math.round(box.height)]; }));
      expect(sizes).toHaveLength(3);
      for (const size of sizes) expect(size).toEqual(sizes[0]);
    }).toPass();
    await capture('multipart');
    const bundle = `**/api/v1/companies/${companyId}/expenses/accountant-package/bundle/1`;
    await page.route(bundle, route => route.fulfill({ status: 503, json: { message: 'ดาวน์โหลดไม่ได้ ลองอีกครั้ง' } }));
    await parts.first().click(); await expect(card.getByRole('alert')).toBeVisible(AFTER_PRESS);
    await expect(card.getByRole('link', { name: 'กลับไปรายการค่าใช้จ่าย', exact: true })).toBeVisible();
    await capture('download-failed');
    await card.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
    await expect(card.getByRole('alert')).toHaveCount(0, AFTER_PRESS);
    await page.unroute(bundle);
    await page.route(bundle, route => route.fulfill({ contentType: 'application/zip', body: Buffer.from('504b0506000000000000000000000000000000000000', 'hex') }));
    const recovered = await pressForDownloadBuffer(page, () => parts.first().click());
    expect(recovered.name).toMatch(/\.zip$/); await page.unroute(bundle);
    await page.unroute(endpoint);
    await page.route(endpoint, route => route.fulfill({ json: { ...plan, fileCount: 2, partCount: 1, missingReceiptCount: 0,
      counts: { ...plan.counts, receipts: 1, supportingFiles: 0, claimForms: 0, recordPacks: 1 } } }));
    await page.reload(FIRST_SIGHT);
    await expect(parts).toHaveCount(1, AFTER_PRESS); await capture('normal');
    await page.unroute(endpoint);
    await page.route(endpoint, route => route.fulfill({ json: { ...plan, fileCount: 0, partCount: 0, missingReceiptCount: 0 } }));
    await page.reload(FIRST_SIGHT);
    await expect(card.getByText(/ยังไม่มีไฟล์หลักฐาน/)).toBeVisible(AFTER_PRESS); await capture('empty');
    await page.unroute(endpoint);
    await page.route(endpoint, route => route.fulfill({ status: 403, json: { code: 'FREE_EXPENSE_DRAFTS_ONLY' } }));
    await page.reload(FIRST_SIGHT);
    await expect(card.getByRole('alert')).toBeVisible(AFTER_PRESS); await capture('denied');
    await card.getByRole('link', { name: 'กลับไปรายการค่าใช้จ่าย', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/companies/${companyId}/expenses$`), AFTER_PRESS);
    await page.unroute(endpoint);
    await page.getByRole('button', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true }).click();
    await expect(page.getByRole('dialog').getByText(accountantAccessNote, { exact: true })).toBeVisible(AFTER_PRESS);
    await page.getByRole('dialog').getByRole('button', { name: 'ปิด', exact: true }).click();
  }
});

test('@journey pack v2 workbook and extracted packet links reconcile', async ({ apiAs, request, companyId }) => {
  test.setTimeout(300_000);
  const api = await apiAs('OWNER'), fixture = await packFixture(api, request, companyId, 31);
  const { db, records, claim, signed } = fixture;
  try {
    const selection = { expenseIds: records.slice(0, 31).map(row => row.id) };
    const standalone = await api.post(`companies/${companyId}/expenses/accountant-package`, { data: selection });
    expect(standalone.ok()).toBe(true);
    const sheets = workbookSheets(Buffer.from((await standalone.json()).indexXlsxBase64, 'base64'));
    expect(sheets.get('รายการค่าใช้จ่าย')!).toHaveLength(31);
    const sum = (values: string[]) => values.reduce((total, value) => total + Math.round(Number(value.replace(/,/g, '')) * 100), 0);
    const expenseRows = sheets.get('รายการค่าใช้จ่าย')!;
    const summary = sheets.get('สรุปรายเดือน')!.find(row => row[0] === 'รายจ่ายที่เลือก')!;
    expect(sum([summary[5]!])).toBe(sum(expenseRows.map(row => row[14]!)));
    expect(sum([summary[8]!])).toBe(sum(expenseRows.map(row => row[19]!)));
    expect(sum([summary[9]!])).toBe(sum(expenseRows.map(row => row[20]!)));
    const plan = await json<{ partCount: number; counts: { claimForms: number; recordPacks: number } }>(await api.post(`companies/${companyId}/expenses/accountant-package/bundle-plan`, { data: selection }));
    expect(plan.partCount).toBeGreaterThan(1); expect(plan.counts).toMatchObject({ claimForms: 1, recordPacks: 31 });
    const extracted = new Map<string, Buffer>(), locations = new Map<string, number>();
    const packetReferences: Array<{ part: number; value: string }> = [];
    let crossPart = false;
    for (let part = 1; part <= plan.partCount; part++) {
      const files = await actualBundle(api, companyId, selection, part);
      for (const [name, bytes] of files) if (name !== 'สารบัญ.xlsx') { expect(extracted.has(name)).toBe(false); extracted.set(name, bytes); locations.set(name, part); }
      const bundled = workbookSheets(files.get('สารบัญ.xlsx')!, true, plan.partCount);
      expect(bundled.get('สรุปรายเดือน')).toEqual(sheets.get('สรุปรายเดือน'));
      for (const row of bundled.get('รายการค่าใช้จ่าย')!) packetReferences.push({ part, value: row.at(-1)! });
      crossPart ||= bundled.get('รายการค่าใช้จ่าย')!.some(row => /^อยู่ในชุดที่ \d+: ชุดเอกสารรายการ\//.test(row.at(-1)!));
      const xml = [...unzip(files.get('สารบัญ.xlsx')!).values()].map(value => value.toString()).join(' ');
      expect(decodeXml(xml)).toMatch(/HYPERLINK\("#'รายการค่าใช้จ่าย'!A/);
    }
    expect(crossPart).toBe(true);
    for (const reference of packetReferences) {
      const remote = reference.value.match(/^อยู่ในชุดที่ (\d+): (.+)$/);
      const path = remote ? remote[2]! : reference.value;
      expect(path).toMatch(/^ชุดเอกสารรายการ\//);
      expect(locations.get(path)).toBe(remote ? Number(remote[1]) : reference.part);
    }
    const claimFiles = [...extracted.keys()].filter(name => name.startsWith('ใบเบิก/'));
    expect(claimFiles).toHaveLength(1); expect(claimFiles[0]).toContain(claim.requestNo);
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const protectedOriginal = [...extracted].find(([name]) => name.startsWith('เอกสารค่าใช้จ่าย/') && name.includes(records[0]!.expenseNumber))!;
    expect(digest(protectedOriginal[1])).toBe(digest(signed)); expect(digest(extracted.get(claimFiles[0]!)!)).toBe(digest(signed));
    const { PDFDocument } = apiRequire('pdf-lib');
    expect((await PDFDocument.load(extracted.get(`ชุดเอกสารรายการ/${records[0]!.expenseNumber}.pdf`)!)).getPageCount()).toBe(1);
    for (const row of records.slice(0, 31)) expect(locations.has(`ชุดเอกสารรายการ/${row.expenseNumber}.pdf`)).toBe(true);
    const partial = await actualBundle(api, companyId, { expenseIds: [records[0]!.id] }, 1);
    expect([...partial.keys()].some(name => name.startsWith('ใบเบิก/'))).toBe(false);
    const partialSheets = workbookSheets(partial.get('สารบัญ.xlsx')!, true);
    expect(partialSheets.get('ต้องตามเอกสาร')!.flat()).toContain('ใบเบิกรวมรายการนอกชุดที่เลือก จึงไม่ได้รวมใบนี้');
    expect([...partial.keys()].join(' ')).not.toContain(records[1]!.expenseNumber);
  } finally { await db.$disconnect(); }
});
