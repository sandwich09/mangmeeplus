/** Everyday owner errands, using real reads and writes; no route stubs or API-created records. */
import type { Page } from '@playwright/test';
import { shopPlanTierLabel, type BillingStatus, type PlanTierKey } from '@watchdog-bms/contracts';
import { test, expect } from '../harness/fixtures';
import { expectNoClientError } from '../harness/auth';
import { chooseThemedOption, json, unique } from '../harness/e2e-utils';
import { AFTER_PRESS, FIRST_SIGHT, MAIN_SHOP, expectInSight, pressMenu, whole } from './journey-kit';

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
  { label: 'แพ็กเกจ', href: '/billing', title: 'แพ็กเกจและการจ่ายเงิน', landing: '/billing' },
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
      await expect(heading(page, 'ตั้งค่า')).toBeVisible(FIRST_SIGHT);
      for (const entry of settingsEntries) {
        const link = main.locator(`a[href="${base}${entry.href}"]`);
        await expect(link).toContainText(entry.label);
        await link.click();
        await expect(page).toHaveURL(`${base}${entry.landing}`, FIRST_SIGHT);
        await expect(heading(page, entry.title)).toBeVisible(FIRST_SIGHT);
        await expectNoClientError(page);
        // The sidebar works on pages without a back control too, including the package page.
        await pressMenu(page, 'ภาพรวมการตั้งค่า', 'ตั้งค่าร้าน');
        await expect(heading(page, 'ตั้งค่า')).toBeVisible(AFTER_PRESS);
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

  // The seeded shop has no package term (a live shop always has one): the page must still open and name what it knows.
  await test.step('แพ็กเกจ: the page opens on the real server and names the package of the shop, at both widths', async () => {
    await pressMenu(page, 'แพ็กเกจ', 'ตั้งค่าร้าน');
    await expect(heading(page, 'แพ็กเกจและการจ่ายเงิน')).toBeVisible(FIRST_SIGHT);
    const status = main.getByRole('region', { name: 'สถานะแพ็กเกจ', exact: true });
    const plan = status.locator('dl > div').filter({ has: page.locator('dt').filter({ hasText: whole('แพ็กเกจ') }) });
    for (const viewport of [WIDE, PHONE]) {
      await resize(page, viewport);
      await expect(plan.locator('dd')).toBeVisible(AFTER_PRESS);
      // These current-package facts are counts/dates, not the price cards.
      await expect(status.locator('dl')).not.toContainText('฿');
      await expectNoClientError(page);
    }
    packageName = (await plan.locator('dd').innerText()).trim();
  });

  await test.step('คู่มือการใช้งานระบบ: open each guide, expand its contents, and read without sideways scrolling on phone', async () => {
    const guides = [
      { slug: 'expenses', title: 'ค่าใช้จ่ายและใบเสร็จ' },
      { slug: 'substitute-receipts', title: 'ใบรับรองแทนใบเสร็จ' },
      { slug: 'reimbursements', title: 'การเบิกจ่าย' },
    ];
    for (const viewport of [WIDE, PHONE]) {
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
        if (viewport.width === PHONE.width) {
          expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${guide.title}: no horizontal scroll at 390`).toBeLessThanOrEqual(1);
        }
        await expectNoClientError(page);
      }
    }
  });

  await test.step('หน้าแรก: return through the sidebar, then read the saved records from the server', async () => {
    for (const viewport of [PHONE, WIDE]) {
      await resize(page, viewport);
      await pressMenu(page, 'หน้าแรก');
      await expect(heading(page, 'รายจ่ายของร้าน')).toBeVisible(FIRST_SIGHT);
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
    expect(packageName).toBe(billing.tierKey ? shopPlanTierLabel(billing.tierKey as PlanTierKey) : 'ยังไม่มีข้อมูลแพ็กเกจ');
  });
});

test('@journey phone owner opens the three-line sidebar and finds every top-level sold menu', async ({ authedPage: page, api }) => {
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
  const topLevel = nav.locator('ul').first().locator(':scope > li > a, :scope > li > button');
  for (const label of ['หน้าแรก', 'ค่าใช้จ่ายและใบเสร็จ', 'คู่ค้า', 'การเบิกจ่าย', 'พนักงานและสิทธิ์', 'ตั้งค่าร้าน', 'คู่มือการใช้งานระบบ']) {
    const entry = topLevel.filter({ hasText: new RegExp(`^${label}`) });
    await expect(entry).toHaveCount(1);
    await entry.scrollIntoViewIfNeeded();
    await expectInSight(entry);
  }
  // Package-changing journeys own withholding visibility; this test makes no assertion about it.
  await expectNoClientError(page);
  const session = await json<{ companyId: string; roles: string[] }>(await api.get('auth/me', { headers: { 'X-Company-Id': MAIN_SHOP } }));
  expect(session.companyId).toBe(MAIN_SHOP);
  expect(session.roles).toContain('OWNER');
});
