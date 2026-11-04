/** Everyday owner errands, using real reads and writes; no route stubs or API-created records. */
import type { Page } from '@playwright/test';
import { addCivilDays, civilPeriodRange, todayCivilDate, shopPlanTierLabel, type BillingStatus, type PlanTierKey } from '@watchdog-bms/contracts';
import { test, expect } from '../harness/fixtures';
import { expectNoClientError } from '../harness/auth';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { AFTER_PRESS, FIRST_SIGHT, MAIN_SHOP, expectInSight, pressMenu, thaiDate, whole } from './journey-kit';

const WIDE = { width: 1556, height: 1000 };
const PHONE = { width: 390, height: 844 };
const base = `/companies/${MAIN_SHOP}`;
const apiBase = `companies/${MAIN_SHOP}`;
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text }).first();
const heading = (page: Page, name: string) => page.locator('main').getByRole('heading', { level: 1, name, exact: true });
/**
 * Open the same page at the other width, as a person on that device would (a reload: the sidebar keeps its
 * open/closed state across a live resize and a press then lands on a closed menu), and wait for the layout.
 */
async function resize(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.reload(FIRST_SIGHT);
  if (size.width < 1024) await expect(page.locator('header').getByRole('button', { name: 'สลับเมนู', exact: true })).toBeVisible(FIRST_SIGHT);
  else await expect(page.locator('aside nav')).toBeVisible(FIRST_SIGHT);
}

// These are the sold settings cards in SettingsMenu/settings-menu.logic.ts. The account card's
// old #account URL redirects to the person's account page; the landing title is บัญชีของฉัน.
const settingsEntries = [
  { label: 'ข้อมูลร้าน', href: '/settings/profile', title: 'ข้อมูลร้าน', landing: '/settings/profile' },
  { label: 'บัญชีของฉัน', href: '/settings/profile#account', title: 'บัญชีของฉัน', landing: '/account' },
  { label: 'สาขา', href: '/settings/branches', title: 'สาขา', landing: '/settings/branches' },
  { label: 'พนักงานและสิทธิ์', href: '/settings/access-overview', title: 'รายชื่อพนักงาน', landing: '/settings/access-overview' },
  { label: 'ตั้งค่าใบรับรองแทนใบเสร็จ', href: '/settings/substitute-receipt', title: 'ตั้งค่าใบรับรองแทนใบเสร็จ', landing: '/settings/substitute-receipt' },
  { label: 'ลายเซ็นบน 50 ทวิ', href: '/settings/tax-signature', title: 'ลายเซ็นบน 50 ทวิ', landing: '/settings/tax-signature' },
] as const;

test('@journey owner adds and renames a category, fills a counterparty address, visits shop settings and packages, restores a receipt setting and reads all three guides', async ({ authedPage: page, api }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(AFTER_PRESS.timeout);
  await page.setViewportSize(WIDE);
  await page.goto(`${base}/dashboard`, FIRST_SIGHT);
  await expect(heading(page, 'รายจ่ายของร้าน')).toBeVisible(FIRST_SIGHT);
  const main = page.locator('main');
  const categoryName = unique('หมวดงานหน้าร้าน');
  const renamedCategory = unique('หมวดงานหน้าร้านใหม่');
  const partnerName = unique('คู่ค้าทดลองที่อยู่');
  const address = '99 ถนนประชาอุทิศ แขวงบางมด เขตทุ่งครุ กรุงเทพมหานคร 10140';
  let partnerId = '';
  let originalCashPolicy = '';
  let packageName = '';

  await test.step('หน้าแรก: choose last month and change a date at phone and wide widths', async () => {
    const range = civilPeriodRange(addCivilDays(`${todayCivilDate().slice(0, 7)}-01`, -1).slice(0, 7));
    const spending = main.getByRole('region', { name: 'ตัวเลขรายจ่าย', exact: true });
    const tabs = spending.getByRole('group', { name: 'ช่วงเวลา', exact: true });
    const customRead = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/dashboard') && url.searchParams.get('periodKind') === 'custom'
        && url.searchParams.get('customStart') === range.startDate && url.searchParams.get('customEnd') === range.endDate;
    }, AFTER_PRESS);
    await tabs.getByRole('button', { name: 'เลือกวันที่', exact: true }).click();
    expect((await customRead).ok()).toBe(true);
    const from = spending.getByRole('combobox', { name: 'ตั้งแต่', exact: true });
    const to = spending.getByRole('combobox', { name: 'ถึง', exact: true });
    await expect(from).toHaveText(thaiDate(new Date(range.startDate)));
    await expect(to).toHaveText(thaiDate(new Date(range.endDate)));
    await expect(spending.getByText(whole(`รายจ่าย ${thaiDate(new Date(range.startDate)).replace(/ \d{4}$/, '')} – ${thaiDate(new Date(range.endDate))}`))).toBeVisible();
    await expect(spending.getByRole('status')).toHaveCount(0, AFTER_PRESS);
    await expect(spending.getByText('ใบเสร็จรอตรวจ', { exact: true })).toBeVisible();
    await expect(spending.getByText('ค้างจ่ายทั้งหมด', { exact: true })).toBeVisible();
    for (const viewport of [{ width: 375, height: 667 }, PHONE, { width: 1280, height: 900 }, WIDE]) {
      await page.setViewportSize(viewport);
      await expect(from).toBeVisible(); await expect(to).toBeVisible();
      const boxes = await tabs.getByRole('button').evaluateAll(buttons => buttons.map(button => {
        const { left, right, width, height } = button.getBoundingClientRect(); return { left, right, width, height };
      }));
      expect(boxes).toHaveLength(4);
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(viewport.width);
        expect(Math.abs(box.width - boxes[0]!.width)).toBeLessThan(1);
        expect(box.height).toBe(boxes[0]!.height);
        expect(box.height).toBeGreaterThanOrEqual(viewport.width < 640 ? 44 : 40);
      }
      const fromBox = (await from.boundingBox())!, toBox = (await to.boundingBox())!;
      expect(fromBox.x + fromBox.width).toBeLessThanOrEqual(viewport.width);
      expect(toBox.x + toBox.width).toBeLessThanOrEqual(viewport.width);
      // Measured after the resize settles: the grid switches to two columns at 390 px.
      if (viewport.width >= 390) await expect.poll(async () => Math.abs((await from.boundingBox())!.y - (await to.boundingBox())!.y)).toBeLessThan(1);
      else expect(toBox.y).toBeGreaterThan(fromBox.y + fromBox.height);
    }
    await from.click();
    const changed = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/dashboard') && url.searchParams.get('periodKind') === 'custom'
        && url.searchParams.get('customStart') === addCivilDays(range.startDate, 1) && url.searchParams.get('customEnd') === range.endDate;
    }, AFTER_PRESS);
    await page.getByRole('button', { name: '2', exact: true }).click();
    expect((await changed).ok()).toBe(true);
    await expect(from).toHaveText(thaiDate(new Date(addCivilDays(range.startDate, 1))));
    await expect(spending.getByRole('status')).toHaveCount(0, AFTER_PRESS);
    await tabs.getByRole('button', { name: 'เดือนนี้', exact: true }).click();
    await expect(tabs.getByRole('button', { name: 'เดือนนี้', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(from).toHaveCount(0);
  });

  await test.step('หมวดหมู่: add on wide, rename on phone; built-in rows cannot be renamed', async () => {
    await pressMenu(page, 'หมวดหมู่', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(heading(page, 'หมวดหมู่')).toBeVisible(FIRST_SIGHT);
    const rows = () => main.locator('tbody tr:visible, [data-category-rows] > li:visible');
    const builtIn = rows().filter({ hasText: 'มากับระบบ' }).first();
    await expect(builtIn).toBeVisible(AFTER_PRESS);
    await expect(builtIn.getByRole('button', { name: 'แก้ชื่อ', exact: true })).toHaveCount(0);
    await main.getByRole('button', { name: 'เพิ่มหมวดหมู่', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'เพิ่มหมวดหมู่', exact: true });
    await create.getByRole('textbox', { name: 'ชื่อหมวดหมู่', exact: true }).fill(categoryName);
    await create.getByRole('button', { name: 'เพิ่มหมวดหมู่', exact: true }).click();
    await expect(create).toBeHidden(AFTER_PRESS);
    await expect(toast(page, 'เพิ่มหมวดหมู่แล้ว')).toBeVisible(AFTER_PRESS);
    await expect(rows().filter({ hasText: categoryName })).toBeVisible(AFTER_PRESS);

    await resize(page, PHONE);
    await expect(builtIn.getByText('มากับระบบ', { exact: true })).toBeVisible();
    await expect(builtIn.getByRole('button', { name: 'แก้ชื่อ', exact: true })).toHaveCount(0);
    await rows().filter({ hasText: categoryName }).getByRole('button', { name: 'แก้ชื่อ', exact: true }).click();
    const rename = page.getByRole('dialog', { name: 'แก้ชื่อหมวดหมู่', exact: true });
    await rename.getByRole('textbox', { name: 'ชื่อหมวดหมู่', exact: true }).fill(renamedCategory);
    await rename.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(rename).toBeHidden(AFTER_PRESS);
    await expect(toast(page, 'แก้ชื่อหมวดหมู่แล้ว')).toBeVisible(AFTER_PRESS);
    await expect(rows().filter({ hasText: renamedCategory })).toBeVisible(AFTER_PRESS);
    await expect(rows().filter({ hasText: categoryName })).toHaveCount(0);
  });

  await test.step('ใบรับรองแทนใบเสร็จ: the renamed category is offered where a line takes a category, at both widths', async () => {
    // Categories are chosen on a line of a no-receipt certificate (the typed expense forms take none).
    await pressMenu(page, 'ใบรับรองแทนใบเสร็จ', 'ค่าใช้จ่ายและใบเสร็จ');
    await expect(heading(page, 'ใบรับรองแทนใบเสร็จ')).toBeVisible(FIRST_SIGHT);
    await main.getByRole('link', { name: 'สร้างใบรับรอง', exact: true }).click();
    await expect(heading(page, 'สร้างใบรับรองแทนใบเสร็จ')).toBeVisible(FIRST_SIGHT);
    await main.getByRole('radio', { name: /^ยังไม่ได้บันทึก/ }).check();
    const category = main.getByRole('combobox', { name: 'รายการที่ 1: หมวดหมู่ค่าใช้จ่าย', exact: true });
    for (const viewport of [PHONE, WIDE]) {
      await page.setViewportSize(viewport); // no reload: the form is half filled
      await expect(category).toBeEnabled(AFTER_PRESS);
      await chooseThemedOption(page, category, renamedCategory);
      await expect(category).toContainText(renamedCategory);
    }
    // Nothing is saved: the person leaves through the sidebar.
  });

  await test.step('คู่ค้า: create a row without an address, open it with Enter, fill and save at the page end', async () => {
    await pressMenu(page, 'คู่ค้า');
    await expect(heading(page, 'คู่ค้า')).toBeVisible(FIRST_SIGHT);
    await main.getByRole('button', { name: 'เพิ่มคู่ค้า', exact: true }).click();
    const create = page.getByRole('dialog', { name: 'เพิ่มคู่ค้า', exact: true });
    await create.getByRole('textbox', { name: 'ชื่อ', exact: true }).fill(partnerName);
    await create.getByRole('button', { name: 'เพิ่มคู่ค้า', exact: true }).click();
    await expect(heading(page, partnerName)).toBeVisible(AFTER_PRESS);
    partnerId = new URL(page.url()).pathname.split('/').at(-1)!;
    await expect(main.getByRole('textbox', { name: /^ที่อยู่ตามเอกสาร/ })).toHaveValue('');
    await main.getByRole('link', { name: 'กลับไปคู่ค้า', exact: true }).click();
    await expect(heading(page, 'คู่ค้า')).toBeVisible(AFTER_PRESS);
    await main.getByRole('searchbox').fill(partnerName);
    const row = () => main.getByRole('link', { name: `เปิดคู่ค้า ${partnerName}`, exact: true });
    await expect(row().getByText('ยังไม่มีที่อยู่', { exact: true })).toBeVisible(AFTER_PRESS);
    await row().focus();
    await row().press('Enter');
    await expect(heading(page, partnerName)).toBeVisible(AFTER_PRESS);
    await resize(page, PHONE);
    const addressBox = main.getByRole('textbox', { name: /^ที่อยู่ตามเอกสาร/ });
    await addressBox.fill(address);
    const save = main.locator('[data-form-action-bar]').getByRole('button', { name: 'บันทึก', exact: true });
    await save.scrollIntoViewIfNeeded();
    // Not expectInSight: on a local dev server the Next.js badge sits over the bar's left edge at 390.
    await expect(save).toBeInViewport();
    await save.click();
    await expect(toast(page, 'บันทึกข้อมูลคู่ค้าแล้ว')).toBeVisible(AFTER_PRESS);
    await expect(addressBox).toHaveValue(address, AFTER_PRESS);
    // The header badge uses the reloaded record, so do not leave while the form is still dirty.
    await expect(main.getByText('ยังไม่มีที่อยู่', { exact: true })).toHaveCount(0, AFTER_PRESS);
    // Another editor saves while this form still carries the prior version.
    const current = await json<{ updatedAt: string }>(await api.get(`${apiBase}/accounting/counterparties/${partnerId}`));
    await json(await api.patch(`${apiBase}/accounting/counterparties/${partnerId}`, { data: { phone: '0811111111', expectedUpdatedAt: current.updatedAt } }));
    const phone = main.getByRole('textbox', { name: 'เบอร์โทร', exact: true });
    await phone.fill('0822222222');
    await save.click();
    const conflict = main.getByRole('alert').filter({ hasText: 'มีคนแก้ข้อมูลคู่ค้านี้ไปแล้ว' });
    await expect(conflict).toBeVisible(AFTER_PRESS);
    await expect(phone).toHaveValue('0822222222');
    await conflict.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
    await expect(phone).toHaveValue('0811111111', AFTER_PRESS);
    await save.click();
    await expect(conflict).toHaveCount(0, AFTER_PRESS);
    await main.getByRole('link', { name: 'กลับไปคู่ค้า', exact: true }).click();
    await expect(heading(page, 'คู่ค้า')).toBeVisible(AFTER_PRESS);
    await main.getByRole('searchbox').fill(partnerName);
    for (const viewport of [PHONE, WIDE]) {
      await resize(page, viewport);
      await expect(row()).toContainText(address, AFTER_PRESS);
      await expect(row().getByText('ยังไม่มีที่อยู่', { exact: true })).toHaveCount(0);
    }
  });

  await test.step('ตั้งค่าร้าน: every sold overview entry opens its named page, on wide and phone', async () => {
    for (const viewport of [WIDE, PHONE]) {
      await resize(page, viewport);
      // Already on the overview after the first round: pressing the page you are on leaves the phone menu open.
      if (!new URL(page.url()).pathname.endsWith('/settings')) await pressMenu(page, 'ภาพรวมการตั้งค่า', 'ตั้งค่าร้าน');
      await expect(heading(page, 'ตั้งค่าร้าน')).toBeVisible(FIRST_SIGHT);
      await expect(main.locator(`a[href="${base}/billing"]`)).toHaveCount(0);
      for (const entry of settingsEntries) {
        const link = main.locator(`a[href="${base}${entry.href}"]`);
        await expect(link).toContainText(entry.label);
        await link.click();
        await expect(page).toHaveURL(`${base}${entry.landing}`, FIRST_SIGHT);
        await expect(heading(page, entry.title)).toBeVisible(FIRST_SIGHT);
        await expectNoClientError(page);
        // The sidebar works on pages without a back control too, including the package page.
        await pressMenu(page, 'ภาพรวมการตั้งค่า', 'ตั้งค่าร้าน');
        await expect(heading(page, 'ตั้งค่าร้าน')).toBeVisible(AFTER_PRESS);
      }
    }
  });

  await test.step('ตั้งค่าใบรับรองแทนใบเสร็จ: change, save, reload, then restore and reload the original cash rule', async () => {
    await pressMenu(page, 'ตั้งค่าใบรับรองแทนใบเสร็จ', 'ตั้งค่าร้าน');
    await expect(heading(page, 'ตั้งค่าใบรับรองแทนใบเสร็จ')).toBeVisible(FIRST_SIGHT);
    const strict = main.getByRole('radio', { name: /^ต้องมีหลักฐานการจ่ายอย่างน้อย 1 ไฟล์/ });
    const allow = main.getByRole('radio', { name: /^ใช้หลักฐานประกอบอย่างเดียวได้/ });
    await expect(strict).toBeVisible(AFTER_PRESS);
    const wasStrict = await strict.isChecked();
    originalCashPolicy = wasStrict ? 'REQUIRE_SEPARATE_PAYMENT_EVIDENCE' : 'ALLOW_SUPPORTING_EVIDENCE_ONLY';
    const original = wasStrict ? strict : allow;
    const changed = wasStrict ? allow : strict;
    const save = main.getByRole('button', { name: 'บันทึกการตั้งค่า', exact: true });
    await expect(original).toBeChecked();
    try {
      await changed.check();
      const stored = page.waitForResponse(response => response.url().includes('/expense-settings/substitute-receipt') && response.request().method() !== 'GET');
      await save.click();
      expect((await stored).ok()).toBe(true);
      await expect(toast(page, 'บันทึกการตั้งค่าใบรับรองแทนใบเสร็จแล้ว')).toBeVisible(AFTER_PRESS);
      await page.reload(FIRST_SIGHT);
      await expect(heading(page, 'ตั้งค่าใบรับรองแทนใบเสร็จ')).toBeVisible(FIRST_SIGHT);
      await expect(changed).toBeChecked(AFTER_PRESS);
      await expect(original).not.toBeChecked();
    } finally {
      // Restore through the screen even if the changed-value assertion fails. No API mutation
      // bypasses the page, and a second reload proves the default was actually stored again.
      await resize(page, WIDE);
      await expect(original).toBeEnabled(AFTER_PRESS);
      await original.check();
      // The first save's notice can still be showing: wait for this save's own answer before reloading.
      const restored = page.waitForResponse(response => response.url().includes('/expense-settings/substitute-receipt') && response.request().method() !== 'GET');
      await save.click();
      expect((await restored).ok()).toBe(true);
      await page.reload(FIRST_SIGHT);
      await expect(original).toBeChecked(FIRST_SIGHT);
      await expect(changed).not.toBeChecked();
    }
  });

  // The seeded legacy shop has no package data; compare the sentence with the real server below.
  await test.step('แพ็กเกจ: the page opens on the real server and names the package of the shop, at both widths', async () => {
    await pressMenu(page, 'แพ็กเกจ');
    await expect(heading(page, 'แพ็กเกจ')).toBeVisible(FIRST_SIGHT);
    const status = main.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true });
    const noPackage = status.getByRole('heading', { name: 'ยังไม่มีแพ็กเกจ', exact: true });
    for (const viewport of [WIDE, PHONE]) {
      await resize(page, viewport);
      await expect(noPackage).toBeVisible(AFTER_PRESS);
      await expect(status.locator('.mangmee-unit')).toHaveCount(0);
      await expect(status).not.toContainText('฿');
      await expectNoClientError(page);
    }
    packageName = (await noPackage.innerText()).trim();
  });

  await test.step('คู่มือการใช้งานระบบ: open each guide, expand its contents, and read without sideways scrolling on phone', async () => {
    const guides = [
      { slug: 'getting-started', title: 'เริ่มใช้งานร้านและ LINE' },
      { slug: 'expenses', title: 'ค่าใช้จ่ายและใบเสร็จ' },
      { slug: 'substitute-receipts', title: 'ใบรับรองแทนใบเสร็จ' },
      { slug: 'reimbursements', title: 'การเบิกจ่าย' },
    ];
    for (const viewport of [WIDE, { width: 1280, height: 1000 }, PHONE]) {
      await resize(page, viewport);
      for (const guide of guides) {
        // pressMenu deliberately excludes guide links, whose names repeat the sold menu names.
        const nav = page.locator('aside nav');
        const group = nav.getByRole('button', { name: 'คู่มือการใช้งานระบบ', exact: true });
        // As pressMenu does: a page still settling can close the phone menu right after it opened.
        await expect(async () => {
          if (!await nav.isVisible()) await page.locator('header').getByRole('button', { name: 'สลับเมนู', exact: true }).click();
          await expect(group).toBeVisible({ timeout: 3_000 });
        }).toPass(FIRST_SIGHT);
        if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
        const link = nav.locator(`a[href="${base}/user-guide/${guide.slug}"]`);
        await expect(link).toHaveAccessibleName(guide.title);
        await link.click();
        await expect(heading(page, guide.title)).toBeVisible(FIRST_SIGHT);
        await expect(main.getByText(/^คู่มือนี้มี \d+ หัวข้อ/)).toBeVisible();
        await main.getByRole('button', { name: 'เปิดอ่านทุกหัวข้อ', exact: true }).click();
        await expect(main.getByRole('button', { name: 'ย่อทุกหัวข้อ', exact: true })).toHaveAttribute('aria-expanded', 'true');
        if (guide.slug === 'getting-started' || guide.slug === 'expenses') await expect(main).toContainText('หลักฐานว่าบันทึกจ่ายแล้ว');
        if (guide.slug === 'getting-started') await expect(main).toContainText('ตรวจคำตอบ “ใช้ VAT ตอนยื่นภาษี” ให้ครบก่อนใช้ยื่น');
        if (guide.slug === 'reimbursements') await expect(main).toContainText('เมื่อระบบกำลังยกเลิกใบเบิก อ่านเหตุผลที่ค้างอยู่ในหน้าใบเบิกก่อนทำต่อ');
        if (viewport.width === PHONE.width) {
          expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${guide.title}: no horizontal scroll at 390`).toBeLessThanOrEqual(1);
        }
        await expectNoClientError(page);
      }
    }
  });

  await test.step('คู่มือภาษี: read the action names and the original certificate payment date', async () => {
    await page.goto(`${base}/user-guide/tax`, FIRST_SIGHT);
    await expect(heading(page, 'ภาษี')).toBeVisible(FIRST_SIGHT);
    await main.getByRole('button', { name: 'เปิดอ่านทุกหัวข้อ', exact: true }).click();
    await expect(main.getByText('คำนวณรายงาน · ยื่นแบบแล้ว · ชำระแล้ว', { exact: true })).toBeVisible();
    await expect(main.getByText(/กรอก “เลขที่ใบ” “วันที่จ่ายตามหนังสือรับรองเดิม” และ “วันที่ทำใบ”/)).toBeVisible();
    await expectNoClientError(page);
  });

  await test.step('หน้าแรก: return through the sidebar, then read the saved records from the server', async () => {
    for (const viewport of [PHONE, WIDE]) {
      await resize(page, viewport);
      await pressMenu(page, 'หน้าแรก');
      await expect(heading(page, 'รายจ่ายของร้าน')).toBeVisible(FIRST_SIGHT);
      const expenses = main.getByRole('region', { name: 'ตัวเลขรายจ่าย', exact: true });
      await expect(expenses.getByText('ค้างจ่ายทั้งหมด', { exact: true })).toBeVisible(AFTER_PRESS);
      await expect(expenses.getByText('รายจ่ายยืนยันแล้วทุกเดือน รวมที่จ่ายบางส่วน', { exact: true })).toBeVisible(AFTER_PRESS);
      await expectNoClientError(page);
    }
    const categories = await json<Array<{ id: string; name: string; companyId: string | null; status: string }>>(
      await api.get(`${apiBase}/expense-categories`, { headers: { 'X-Company-Id': MAIN_SHOP } }),
    );
    expect(categories.filter(category => category.name === renamedCategory)).toEqual([
      expect.objectContaining({ companyId: MAIN_SHOP, name: renamedCategory, status: 'ACTIVE' }),
    ]);
    expect(categories.some(category => category.name === categoryName)).toBe(false);
    const partner = await json<{ id: string; displayName: string; billingAddressJson: { addressText: string } }>(
      await api.get(`${apiBase}/accounting/counterparties/${partnerId}`, { headers: { 'X-Company-Id': MAIN_SHOP } }),
    );
    expect(partner).toMatchObject({ id: partnerId, displayName: partnerName, billingAddressJson: { addressText: address } });
    const policy = await json<{ cashEvidencePolicy: string }>(await api.get(`${apiBase}/expense-settings/substitute-receipt`, { headers: { 'X-Company-Id': MAIN_SHOP } }));
    expect(policy.cashEvidencePolicy).toBe(originalCashPolicy);
    const billing = await json<BillingStatus>(await api.get(`${apiBase}/billing`, { headers: { 'X-Company-Id': MAIN_SHOP } }));
    expect(packageName).toBe(billing.tierKey ? shopPlanTierLabel(billing.tierKey as PlanTierKey) : 'ยังไม่มีแพ็กเกจ');
  });
});

test('@journey phone owner opens the three-line sidebar, finds every top-level sold menu and closes it by button, Escape, backdrop and links', async ({ authedPage: page, api }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(PHONE);
  await page.goto(`${base}/dashboard`, FIRST_SIGHT);
  await expect(heading(page, 'รายจ่ายของร้าน')).toBeVisible(FIRST_SIGHT);
  await expect(page.locator('aside nav')).toBeHidden();
  const opener = page.locator('header').getByRole('button', { name: 'สลับเมนู', exact: true });
  await expectInSight(opener);
  await opener.click();
  const nav = page.locator('aside nav');
  await expect(nav).toBeVisible();
  const drawer = page.getByRole('dialog', { name: 'เมนูหลัก', exact: true });
  await expect(drawer).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('#workspace-main').locator('..')).toHaveAttribute('inert', '');
  const controls = drawer.locator('a[href]:visible:not([inert] *), button:visible:not([disabled]):not([inert] *)');
  await controls.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect(controls.last()).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  const topLevel = nav.locator('ul').first().locator(':scope > li > a, :scope > li > button');
  for (const label of ['หน้าแรก', 'ค่าใช้จ่ายและใบเสร็จ', 'คู่ค้า', 'การเบิกจ่าย', 'แพ็กเกจ', 'พนักงานและสิทธิ์', 'ตั้งค่าร้าน', 'คู่มือการใช้งานระบบ']) {
    const entry = topLevel.filter({ hasText: new RegExp(`^${label}`) });
    await expect(entry).toHaveCount(1);
    await entry.scrollIntoViewIfNeeded();
    await expectInSight(entry);
  }
  const expectClosed = async () => {
    await expect(nav).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator('#workspace-main').locator('..')).not.toHaveAttribute('inert');
  };
  const close = drawer.getByRole('button', { name: 'ปิดเมนู', exact: true });
  await expect(close.locator('..')).toHaveCSS('justify-content', 'space-between');
  const closeBounds = await close.boundingBox();
  await close.hover(); // A mouse on a phone-sized window must not expand the desktop rail under this click.
  await expect(close.locator('..')).toHaveCSS('justify-content', 'space-between');
  expect(await close.boundingBox()).toEqual(closeBounds);
  await close.click();
  await expectClosed();
  await opener.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press('Escape');
  await expectClosed();
  await opener.click();
  await expect(drawer).toBeVisible();
  await page.locator('.fixed.inset-0.z-40').click({ position: { x: PHONE.width - 10, y: 200 } });
  await expectClosed();
  await opener.click();
  await nav.getByRole('link', { name: 'หน้าแรก', exact: true }).click(); // same route: no pathname effect
  await expectClosed();
  await opener.click();
  await nav.getByRole('link', { name: 'คู่ค้า', exact: true }).click();
  await expectClosed();
  await expect(heading(page, 'คู่ค้า')).toBeVisible(FIRST_SIGHT);
  // Package-changing journeys own withholding visibility; this test makes no assertion about it.
  await expectNoClientError(page);
  const session = await json<{ companyId: string; roles: string[] }>(await api.get('auth/me', { headers: { 'X-Company-Id': MAIN_SHOP } }));
  expect(session.companyId).toBe(MAIN_SHOP);
  expect(session.roles).toContain('OWNER');
});
