/**
 * Shared helpers for the browser journeys (`*.journey.spec.ts`).
 *
 * A journey moves as a person moves: the first page of a person's part is opened by address, every
 * later page is reached by pressing the menu row, the button or the link that person would press.
 * These helpers are the presses that every journey repeats.
 */
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync, inflateRawSync } from 'node:zlib';
import type { Download, Locator, Page } from '@playwright/test';
import { expect, test } from '../harness/fixtures';
import { expectFitsScreen as checkScreenFit } from '../harness/screen-fit';
import { chooseThemedOption, json } from '../harness/e2e-utils';

/** First sight of a page: the development server compiles a route on its first visit. */
export const FIRST_SIGHT = { timeout: 90_000 };
/** A press that waits for the server (save, send, approve) on an already compiled page. */
export const AFTER_PRESS = { timeout: 30_000 };

export const MAIN_SHOP = 'seed-local-company';
export const SECOND_SHOP = 'seed-local-company-2';

/** The payer's legal identity the first journey fills through ข้อมูลร้าน; later journeys may find it cleared. */
export async function fillShopIdentity(page: Page, companyId = MAIN_SHOP) {
  const main = page.locator('main');
  await page.goto(`/companies/${companyId}/settings/profile?from=withholding`, FIRST_SIGHT);
  await expect(main.getByRole('heading', { level: 1, name: 'ข้อมูลร้าน', exact: true })).toBeVisible(FIRST_SIGHT);
  await main.getByRole('textbox', { name: /^ชื่อจดทะเบียน/ }).fill('บริษัท บลูมบิวตี้ทดลอง จำกัด');
  await main.getByRole('textbox', { name: /^เลขผู้เสียภาษี/ }).fill('0105558000014');
  await main.getByRole('textbox', { name: 'รหัสไปรษณีย์', exact: true }).fill('10110');
  await expect(main.getByRole('combobox', { name: 'จังหวัด', exact: true })).toHaveText('กรุงเทพมหานคร', AFTER_PRESS);
  await chooseThemedOption(page, main.getByRole('combobox', { name: 'อำเภอ / เขต', exact: true }), 'คลองเตย');
  await chooseThemedOption(page, main.getByRole('combobox', { name: 'ตำบล / แขวง', exact: true }), 'คลองเตย');
  await main.getByRole('textbox', { name: 'ที่อยู่ (บ้านเลขที่ ถนน)', exact: true }).fill('88 ถนนพระราม 4');
  await main.getByRole('button', { name: 'บันทึกข้อมูลร้าน', exact: true }).click();
  await expect(main.getByRole('status').filter({ hasText: 'บันทึกข้อมูลร้านแล้ว' })).toContainText('✓ บันทึกข้อมูลร้านแล้ว', AFTER_PRESS);
}

/** Today as the screens print it, e.g. `13 ต.ค. 2569` (Buddhist year, Bangkok time). */
/** The XML of one sheet of an .xlsx, found by its name. Pack v2 puts 'ต้องตามเอกสาร' first, so sheet1.xml is not the expense list. */
export function xlsxSheetXml(file: Buffer, sheetName: string): string {
  const parts = new Map<string, string>();
  for (let offset = 0; file.readUInt32LE(offset) === 0x04034b50;) {
    const size = file.readUInt32LE(offset + 18), length = file.readUInt16LE(offset + 26);
    const start = offset + 30 + length + file.readUInt16LE(offset + 28), bytes = file.subarray(start, start + size);
    parts.set(file.subarray(offset + 30, offset + 30 + length).toString(), (file.readUInt16LE(offset + 8) === 8 ? inflateRawSync(bytes) : bytes).toString());
    offset = start + size;
  }
  const sheet = [...parts.get('xl/workbook.xml')!.matchAll(/<sheet\b([^>]+)>/g)].map(match => match[1]!).find(attributes => attributes.includes(`name="${sheetName}"`));
  expect(sheet, `sheet ${sheetName}`).toBeTruthy();
  const id = sheet!.match(/r:id="([^"]+)"/)![1]!;
  const relation = [...parts.get('xl/_rels/workbook.xml.rels')!.matchAll(/<Relationship\b([^>]+)>/g)].map(match => match[1]!).find(attributes => attributes.includes(`Id="${id}"`))!;
  const target = relation.match(/Target="([^"]+)"/)![1]!;
  return parts.get(target.startsWith('/') ? target.slice(1) : `xl/${target}`)!;
}

export function thaiDate(date = new Date()) {
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
  }).format(date);
}

/** This month as the pickers print it, e.g. `ต.ค. 2569`. */
export function thaiMonth(date = new Date()) {
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'Asia/Bangkok', month: 'short', year: 'numeric' }).format(date);
}

/** That day of last month (Bangkok calendar), e.g. `dayOfLastMonth(15)` on 14 Oct 2026 is 15 Sep 2026. */
export function dayOfLastMonth(day: number) {
  const [year, month] = periodKey().split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 2, day, 5));
}

/** This month as file names and API keys carry it, e.g. `2026-10` (Bangkok time). */
export function periodKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).format(date).slice(0, 7);
}

/**
 * A small valid PNG whose pixels are random, so no two calls give the same picture: the app flags
 * the same picture uploaded twice as a possible duplicate.
 */
export function distinctPng(): Buffer {
  const width = 16, height = 16, row = 1 + width * 3;
  const raw = Buffer.alloc(height * row);
  for (let y = 0; y < height; y++) randomBytes(width * 3).copy(raw, y * row + 1);
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A picture to hand to a file input. */
export function picture(name: string) {
  return { name, mimeType: 'image/png', buffer: distinctPng() };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function expectFitsScreen(page: Page) {
  await checkScreenFit(page, test.info().project.name);
}

/** The same branch facts and actions, in a table row or a phone card. */
export function branchEntry(page: Page, name: string) {
  return page.getByTestId('branch-entry').filter({ hasText: name }).filter({ visible: true });
}

/** Account actions live in the navigation drawer on a phone. */
export async function openUserMenu(page: Page) {
  const menu = page.getByRole('button', { name: /^เมนูผู้ใช้/ });
  await expect(async () => {
    if (!await menu.isVisible()) await page.locator('header').getByRole('button', { name: 'สลับเมนู', exact: true }).click();
    await expect(menu).toBeVisible({ timeout: 3_000 });
  }).toPass(FIRST_SIGHT);
  if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expectFitsScreen(page);
  return menu;
}

/**
 * The whole text of one element, whatever it is built from. `getByText(text, { exact: true })` only
 * reads an element's own text nodes, and the screens put every amount in a span of its own
 * (`รวมรายการนี้ <span>120.00 บาท</span>`), so a line with an amount in it never matches exactly.
 */
export function whole(text: string) {
  return new RegExp(`^\\s*${text.trim().split(/\s+/).map(escapeRegExp).join('\\s*')}\\s*$`);
}

/** The amount and written unit belonging to one quiet MetricGrid label. */
export function metricValue(grid: Locator, label: string) {
  return grid.locator('div:has(> .mangmee-unit)').filter({ has: grid.page().getByText(label, { exact: true }) }).locator(':scope > .mangmee-unit');
}

/**
 * Press a row of the left menu. `parent` is the group the row sits in ("ค่าใช้จ่ายและใบเสร็จ",
 * "ตั้งค่าร้าน", …); the group is opened first when it is closed. On a narrow screen the menu sits
 * behind the three-line button, which is pressed first.
 *
 * The guide group at the bottom repeats some row names (ใบรับรองแทนใบเสร็จ, การเบิกจ่าย), so guide
 * links are left out.
 */
export async function pressMenu(page: Page, label: string, parent?: string) {
  const nav = page.locator('aside nav');
  const opener = page.locator('header').getByRole('button', { name: 'สลับเมนู', exact: true });
  // Wide screen: the menu is there. Phone: the three-line button is there instead. Wait for either.
  await expect(async () => { expect((await nav.isVisible()) || (await opener.isVisible())).toBe(true); }).toPass(FIRST_SIGHT);
  const realRow = nav.locator('a:not([href*="/user-guide/"])');
  // Phone: a page that is still settling can close the menu again right after it opened. Open it until the row is there.
  // A row may carry a badge in its name ("แพ็กเกจ เหลือ 0 วัน"), as a group's button may.
  const row = nav.getByRole('link', { name: new RegExp(`^${escapeRegExp(label)}(?:\\s|$)`) }).and(realRow);
  const first = parent ? nav.getByRole('button', { name: new RegExp(`^${escapeRegExp(parent)}`) }) : row;
  await expect(async () => {
    if (!(await nav.isVisible())) await opener.click();
    await expect(first).toBeVisible({ timeout: 3_000 });
  }).toPass(FIRST_SIGHT);
  if (!parent) {
    await row.click();
    await expectFitsScreen(page);
    return;
  }
  // The group's button may carry a badge in its name ("ตั้งค่าร้าน ตั้งค่ายังไม่ครบ").
  const groupButton = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(parent)}`) });
  const group = nav.locator('li').filter({ has: groupButton });
  const button = group.getByRole('button', { name: new RegExp(`^${escapeRegExp(parent)}`) });
  await expect(button).toBeVisible(FIRST_SIGHT);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await group.getByRole('link', { name: new RegExp(`^${escapeRegExp(label)}`) }).and(realRow).first().click();
  await expectFitsScreen(page);
}

/**
 * A person can read it without scrolling: it is inside the window and nothing lies over it (the top bar, the bottom action
 * bar). `toBeInViewport()` alone passes for a line that sits behind the action bar.
 */
export async function expectInSight(target: Locator) {
  await expect(target).toBeVisible();
  await expect(async () => {
    const seen = await target.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const top = document.elementFromPoint(box.left + Math.min(box.width, 48) / 2, box.top + box.height / 2);
      return !!top && (el === top || el.contains(top));
    });
    expect(seen, 'in the window and not covered').toBe(true);
  }).toPass({ timeout: 5_000 });
}

/** These pieces one after another inside one block, whatever elements and spacing sit between them. */
export function inOrder(...pieces: string[]) {
  return new RegExp(pieces.map((piece) => piece.trim().split(/\s+/).map(escapeRegExp).join('\\s*')).join('\\s*'));
}

/** The card (or section) that carries this heading: the innermost one, so its own lines and buttons only. */
export function cardWith(page: Page, heading: string, scope: Locator = page.locator('main')) {
  return scope.locator('section, .mangmee-card').filter({ has: page.getByRole('heading', { name: heading, exact: true }) }).last();
}

/**
 * Sign inside the on-screen signature box the way a mouse does, then keep the signature.
 * Right after the page arrives the box can still be moving into place (first paint of a development
 * server), and a stroke drawn then lands beside it: like a person, look whether the stroke took and
 * sign again if it did not. Three failed strokes are a defect of the page, not of the test.
 */
export async function signOnScreen(page: Page, scope: Locator = page.locator('main')) {
  const canvas = scope.locator('canvas');
  const keep = scope.getByRole('button', { name: 'ใช้ลายเซ็นนี้', exact: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    expect(box, 'the signature box is on the screen').toBeTruthy();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.5 + (i % 2 ? -0.25 : 0.2)), { steps: 4 });
    }
    await page.mouse.up();
    if (await keep.isEnabled({ timeout: 2_000 }).catch(() => false)) break;
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  await expect(keep, 'a drawn signature can be kept').toBeEnabled();
  await keep.click();
}

/** Press something that downloads a file and hand back the file with its first bytes. */
export async function pressForDownload(page: Page, press: () => Promise<unknown>, timeout = 90_000) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout }), press()]);
  return { download, name: download.suggestedFilename(), head: (await downloadBuffer(download)).subarray(0, 5).toString('latin1') };
}

/** Press a download and keep all bytes for workbook and archive assertions. */
export async function pressForDownloadBuffer(page: Page, press: () => Promise<unknown>, timeout = 90_000) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout }), press()]);
  return { name: download.suggestedFilename(), buffer: await downloadBuffer(download) };
}

async function downloadBuffer(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** The id at the end of the address, e.g. `/expenses/<id>`. */
export function idFromUrl(page: Page) {
  return new URL(page.url()).pathname.split('/').filter(Boolean).pop()!;
}

export type HandExpense = {
  /** The branch as the chooser prints it, e.g. `Head Office (สำนักงานใหญ่)`. */
  branch: string;
  /**
   * Another branch that the chooser already shows on arrival: the one this person chose last on this
   * device (a shop with several branches offers it again, so the form is ready and บันทึกร่าง is on).
   * The journey reads it, then changes it to `branch`.
   */
  branchOffered?: string;
  item: string;
  /** The document is dated this day of last month (pressed in the date chooser); otherwise it keeps today. */
  lastMonthDay?: number;
  /** Unit price as typed, e.g. `4000`. */
  price: string;
  /** The total as the form prints it, e.g. `4,000.00 บาท`. */
  total: string;
  seller: string;
  withholding?: {
    payeeKind: 'บุคคลธรรมดา' | 'บริษัท / ห้างหุ้นส่วน';
    incomeType: string;
    routeHint?: string;
    /** The rate the screen fills in by itself for that income type, e.g. `3`. */
    rate: string;
    taxId: string;
    address: string;
    /** e.g. `120.00 บาท` */
    withheld: string;
  };
  /** What is left to pay after confirming, as printed: `3,880.00 บาท`. */
  toPay: string;
  /** Also record the payment in full from the expense page. */
  pay?: boolean;
};

/**
 * One expense typed by hand and taken to "ยืนยันแล้ว" through the three steps, the way a reviewer does
 * it: menu → บันทึกด้วยมือ → บันทึกร่าง → (withholding) → ถัดไป → ประเภทเอกสาร → ถัดไป → ยืนยันเอกสาร,
 * and when asked, การจ่ายเงิน → บันทึกจ่าย. The page is left on the expense.
 */
export async function recordExpenseByHand(page: Page, expense: HandExpense, reviewWithholding?: (block: Locator) => Promise<void>) {
  const main = page.locator('main');
  const pick = (name: string, option: string) => chooseThemedOption(page, main.getByRole('combobox', { name, exact: true }), option);

  await pressMenu(page, 'บันทึกด้วยมือ', 'ค่าใช้จ่ายและใบเสร็จ');
  await expect(main.getByRole('heading', { level: 1, name: 'บันทึกด้วยมือ', exact: true })).toBeVisible(FIRST_SIGHT);
  const save = main.getByRole('button', { name: 'บันทึกร่าง', exact: true });
  const branch = main.getByRole('combobox', { name: 'สาขา', exact: true });
  await expect(branch).toBeVisible(AFTER_PRESS);
  if (expense.branchOffered) {
    // The last branch chosen here is offered again; nothing is asked, the person changes it.
    await expect(branch).toHaveText(expense.branchOffered, AFTER_PRESS);
    await expect(save).toBeEnabled();
    await expect(main.getByText('เลือกสาขาก่อนบันทึก', { exact: true })).toHaveCount(0);
    await pick('สาขา', expense.branch);
    await expect(branch).toHaveText(expense.branch);
  } else if ((await branch.innerText()).trim() !== expense.branch) {
    // Off until a branch is chosen, and the page says so.
    await expect(save).toBeDisabled();
    await expect(main.getByText('เลือกสาขาก่อนบันทึก', { exact: true })).toBeVisible();
    await pick('สาขา', expense.branch);
  }
  await main.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true }).fill(expense.item);
  await main.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill(expense.price);
  await main.getByRole('combobox', { name: 'ชื่อผู้ขาย', exact: true }).fill(expense.seller);
  if (expense.lastMonthDay) {
    // The date chooser opens on this month: one month back, then the day.
    const date = main.getByRole('combobox', { name: 'วันที่เอกสาร', exact: true });
    await date.click();
    const back = page.getByRole('button', { name: 'เดือนก่อนหน้า', exact: true });
    const calendar = page.locator('div').filter({ has: back }).filter({ has: page.getByRole('button', { name: /^\d{1,2}$/ }) }).last();
    await calendar.getByRole('button', { name: 'เดือนก่อนหน้า', exact: true }).click();
    await calendar.getByRole('button', { name: String(expense.lastMonthDay), exact: true }).click();
    await expect(date).toHaveText(thaiDate(dayOfLastMonth(expense.lastMonthDay)));
  }
  const receipt = picture(`ใบเสร็จ-${expense.price}.png`);
  await main.locator('input[type="file"]').first().setInputFiles(receipt);
  await expect(main.getByRole('button', { name: 'นำไฟล์ออก', exact: true })).toBeVisible(AFTER_PRESS);
  await expect(main.getByText(whole(`ยอดรวม ${expense.total}`))).toBeVisible();
  await save.click();

  await expect(main.getByRole('heading', { level: 1, name: expense.seller, exact: true })).toBeVisible(FIRST_SIGHT);
  await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ตรวจข้อมูล' })).toBeVisible();
  await expect(main.getByText('ขั้นที่ 1:', { exact: true })).toHaveCount(0);
  const numberLine = main.getByText(/^EXP-\d{6}-\d{5}$/);
  await expect(numberLine).toBeVisible();
  const expenseNumber = (await numberLine.innerText()).trim();
  const expenseId = idFromUrl(page);

  if (expense.withholding) {
    const wht = expense.withholding;
    // A full-form shop gets its VAT card above the withholding block once the page knows the shop's VAT answer, and it
    // can land a moment after the heading. A list opened before it is pushed off the screen and hides (seen in a whole
    // run, 2026-10-14). A person reads the page first: wait for the card where the shop has one.
    const shop = new URL(page.url()).pathname.split('/')[2]!;
    const capture = await json<{ mode: string }>(await page.request.get(`/api/v1/companies/${shop}/expenses/capture-policy`, { headers: { 'X-Company-Id': shop } }));
    if (capture.mode === 'FULL') await expect(main.locator('p.font-semibold').filter({ hasText: /^VAT$/ })).toBeVisible(AFTER_PRESS);
    await pick('รายการนี้หักภาษี ณ ที่จ่ายไหม', 'หัก');
    const block = main.getByRole('group', { name: 'รายการนี้หักภาษี ณ ที่จ่ายไหม' }).first();
    await expect(block.getByText('เลือกให้ครบเพื่อคำนวณยอดหัก', { exact: true })).toBeVisible();
    await pick('ผู้รับเงินเป็นใคร', wht.payeeKind);
    await pick('จ่ายค่าอะไร', wht.incomeType);
    if (wht.routeHint) await expect(block.getByText(wht.routeHint, { exact: true })).toBeVisible();
    if (reviewWithholding) await reviewWithholding(block);
    await expect(block.getByRole('textbox', { name: /^อัตราหัก ณ ที่จ่าย/ })).toHaveValue(wht.rate);
    await expect(block).toContainText(inOrder('หัก ณ ที่จ่าย', wht.withheld));
    await expect(main.getByRole('textbox', { name: 'เลขประจำตัวผู้เสียภาษีผู้ขาย', exact: true })).toBeVisible();
    await main.getByRole('textbox', { name: 'เลขประจำตัวผู้เสียภาษีผู้ขาย', exact: true }).fill(wht.taxId);
    await main.getByRole('textbox', { name: 'ที่อยู่ผู้ขายตามใบ', exact: true }).fill(wht.address);
  }

  await confirmThroughThreeSteps(page, { toPay: expense.toPay, withheld: expense.withholding?.withheld, pay: expense.pay });
  return { expenseId, expenseNumber };
}

/**
 * From step 1 of an expense's page to "ยืนยันแล้ว": ถัดไป → ประเภทเอกสาร = ใบเสร็จรับเงิน → ถัดไป →
 * ยืนยันเอกสาร, and when asked, การจ่ายเงิน → บันทึกจ่าย in full.
 */
export async function confirmThroughThreeSteps(page: Page, expense: { toPay: string; withheld?: string; pay?: boolean }) {
  const main = page.locator('main');
  const next = main.getByRole('button', { name: 'ถัดไป', exact: true });
  await next.click();
  await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ภาษีและเอกสาร' })).toBeVisible(AFTER_PRESS);
  await chooseThemedOption(page, main.getByRole('combobox', { name: 'ประเภทเอกสาร', exact: true }), 'ใบเสร็จรับเงิน');
  await chooseThemedOption(page, main.getByRole('combobox', { name: 'ใช้เป็นหลักฐานรายจ่ายได้ไหม', exact: true }), 'ใช้ได้');
  await next.click();
  await expect(main.locator('[aria-current="step"]').filter({ hasText: 'ตรวจสรุป' })).toBeVisible(AFTER_PRESS);
  await main.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true }).click();
  await expect(page.getByText('ยืนยันเอกสารแล้ว', { exact: true }).first()).toBeVisible(AFTER_PRESS);
  await expect(main.locator('.mangmee-page-header').getByText('รอจ่าย', { exact: true })).toBeVisible();
  await expect(main.getByText(/^ต้องจ่าย ฿/)).toHaveCount(0);
  const outstanding = metricValue(main.getByTestId('expense-detail-totals'), 'ค้างจ่าย');
  await expect(outstanding).toBeVisible();
  await expect(outstanding).toHaveText(whole(expense.toPay));
  if (expense.withheld) {
    await expect(main.getByText(/^หักภาษี ณ ที่จ่ายไว้ ฿/)).toHaveCount(0);
    const withheld = main.locator('[data-expense-document-facts] dl > div').filter({ has: page.getByText('ภาษีหัก ณ ที่จ่าย', { exact: true }) });
    await expect(withheld.getByRole('definition')).toBeVisible();
    await expect(withheld.getByRole('definition')).toContainText(expense.withheld);
  }

  if (expense.pay) {
    await expect(main.getByRole('button', { name: 'ไปที่การจ่ายเงิน', exact: true })).toHaveCount(0);
    await main.getByRole('heading', { name: 'การจ่ายเงิน', exact: true }).scrollIntoViewIfNeeded();
    await main.getByRole('button', { name: `บันทึกจ่าย ${expense.toPay}`, exact: true }).click();
    await expect(page.getByText(whole(`บันทึกจ่ายแล้ว ${expense.toPay}`)).first()).toBeVisible(AFTER_PRESS);
    await expect(main).toContainText(inOrder('ประวัติการจ่าย', `${thaiDate()} · โอนเงิน`, expense.toPay));
  }
}
