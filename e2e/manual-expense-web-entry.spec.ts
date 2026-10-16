/**
 * "แสดงเมนูบันทึกด้วยมือบนเว็บ" in a real browser (manual-expense-web-entry-flag spec §7–§9, plan P6).
 *
 * Two sessions that never share a page: the platform's system admin on the shop's package screen,
 * and a member of the shop. The shop starts WITHOUT a stored value — the state every existing
 * company is in at release — so the first half is "nothing leads to the manual page", and the
 * admin's first press is what brings the entrances in, without the shop user signing in again.
 *
 * The shop is the second seeded company, which no other spec opens the manual page in. Its stored
 * value is removed before the journey and the seed's "shown" row is put back afterwards, whatever
 * happened in between.
 */
import type { BrowserContext, Page } from '@playwright/test';
import { PrismaPg } from '@prisma/adapter-pg';
import { hasAiSuggestionSourceAccess, ALL_FEATURE_ENTITLEMENT_KEYS } from '@watchdog-bms/contracts';
import { PrismaClient } from '../apps/api/src/generated/prisma/client';
import { test, expect } from './harness/fixtures';
import { SEED_USERS, WEB_BASE_URL, ensureBrowserLegalAcceptance, expectNoClientError, loginViaDevBff } from './harness/auth';
import { chooseThemedOption, unique } from './harness/e2e-utils';

const SHOP = 'seed-local-company-2';
const SWITCH = 'แสดงเมนูบันทึกด้วยมือบนเว็บ';
const NOT_ENABLED = 'หน้าบันทึกด้วยมือไม่ได้เปิดใช้สำหรับร้านของคุณ';
const CLOSED_NOTICE = 'หน้านี้ถูกปิดสำหรับร้านของคุณแล้ว คุณยังบันทึกรายการที่กำลังกรอกได้';
const GUIDE_NOTE = ['เมนูนี้ไม่ได้เปิดใช้สำหรับร้านของคุณ', 'ขั้นตอนในหัวข้อนี้ยังใช้ไม่ได้'] as const;
const CONFIRM_HIDE = 'ซ่อนเมนูบันทึกด้วยมือของร้านนี้ใช่ไหม พนักงานที่กำลังกรอกอยู่จะบันทึกต่อได้ แต่ถ้าหน้าเว็บถูกโหลดใหม่จะกลับเข้าหน้านี้ไม่ได้ แนะนำให้ปิดนอกเวลางาน';
const CONFIRM_UPLOAD_OFF = 'ร้านนี้ปิดอัปโหลดใบเสร็จอยู่ ถ้าซ่อนเมนูนี้ด้วย พนักงานที่ไม่มีสิทธิ์ตรวจสอบค่าใช้จ่ายจะไม่มีปุ่มสร้างรายจ่ายบนเว็บ';
const UPLOAD_OFF_NOTE = 'ร้านนี้ปิดอัปโหลดใบเสร็จอยู่ และไม่ได้แสดงเมนูบันทึกด้วยมือ พนักงานที่ไม่มีสิทธิ์ตรวจสอบค่าใช้จ่ายจึงไม่มีปุ่มสร้างรายจ่ายบนเว็บ';
const PARENT_OFF = 'เปิดฟีเจอร์บันทึกด้วยมือและบันทึกก่อน จึงจะตั้งค่านี้ได้';
// The seeded shop's package switches wait for its rights to be prepared; the menu switch does not.
const LOCKED_EXCEPT_SWITCH = `ขณะนี้ยังเปิดหรือปิดฟีเจอร์ไม่ได้ ยกเว้นสวิตช์ “${SWITCH}”`;
const AUDIT_ACTION = 'system.partner_manual_expense_web_entry.update';

const databaseUrl = process.env['DATABASE_URL'];
const manualLinks = (page: Page) => page.locator('a[href$="/expenses/manual"]');
const fitsTheScreen = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/**
 * The expenses submenu as the sidebar lists it. On a phone the sidebar is a drawer whose submenu
 * rows exist only while it is open, so it is opened, read and closed again.
 */
async function sidebarExpenseLinks(page: Page): Promise<string[]> {
  const drawer = page.getByRole('button', { name: 'สลับเมนู', exact: true });
  const phone = (page.viewportSize()?.width ?? 1280) < 1024;
  if (phone && (await drawer.getAttribute('aria-expanded')) !== 'true') await drawer.click();
  const links = page.locator('aside a[href*="/expenses"]');
  await expect(links.first()).toBeVisible();
  const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
  if (phone) await page.keyboard.press('Escape');
  return hrefs.map((href) => href.replace(/^\/companies\/[^/]+/, ''));
}

async function adminSession(context: BrowserContext): Promise<Page> {
  const res = await context.request.post(`${WEB_BASE_URL}/api/auth/login`, {
    data: { username: SEED_USERS.systemAdmin.username, password: SEED_USERS.systemAdmin.password, remember: true },
  });
  expect(res.ok(), `system admin login failed (${res.status()}): ${await res.text()}`).toBe(true);
  await ensureBrowserLegalAcceptance(context, ((await res.json()) as { companyId?: string | null }).companyId);
  return context.newPage();
}

/**
 * The package screen of a shop, with the "บันทึกด้วยมือ" row of the expenses card open — reached the
 * way an operator reaches it: the menu group, the card, its "เมนูย่อย" list. That list has to open
 * also while the package switches are locked, or the row could not be reached for such a shop.
 */
async function openManualRow(page: Page, companyId: string) {
  await page.goto(`/system/partners/${companyId}?view=package`);
  await chooseThemedOption(page, page.getByRole('combobox', { name: 'หมวดเมนู', exact: true }), 'การเงินและบัญชี');
  const card = page.locator('article').filter({ hasText: 'ค่าใช้จ่ายและใบเสร็จ' }).first();
  await expect(card).toBeVisible();
  const expander = card.getByRole('button', { name: /เมนูย่อย \d+\/\d+/ });
  await expect(expander).toBeEnabled();
  if ((await expander.getAttribute('aria-expanded')) !== 'true') await expander.click();
  const toggle = card.getByRole('switch', { name: SWITCH, exact: true });
  await expect(toggle).toBeVisible();
  return { card, toggle };
}

test.describe('manual-expense web entry — the setting a system admin switches per shop', () => {
  test.skip(!databaseUrl, 'DATABASE_URL is required: the journey starts from a shop without a stored value');

  test('a shop without a stored value has no entrance; the admin switches it on, then off with a form left open', async ({ browser }) => {
    test.setTimeout(240_000);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const shopContext = await browser.newContext({ baseURL: WEB_BASE_URL, viewport: { width: 390, height: 844 } });
    const adminContext = await browser.newContext({ baseURL: WEB_BASE_URL, viewport: { width: 1280, height: 900 } });
    const description = unique('ค่าใช้จ่ายทดสอบเมนู');
    try {
      await client.auditLog.deleteMany({ where: { companyId: SHOP, action: AUDIT_ACTION } });
      await client.companyWebEntrySetting.deleteMany({ where: { companyId: SHOP } });

      await loginViaDevBff(shopContext);
      await ensureBrowserLegalAcceptance(shopContext, SHOP);
      const shop = await shopContext.newPage();
      const admin = await adminSession(adminContext);

      // ── 1. No stored value: nothing on the web leads to the manual page ───────────────────────
      const me = await shopContext.request.get(`${WEB_BASE_URL}/api/v1/auth/me`, { headers: { 'X-Company-Id': SHOP } });
      const session = (await me.json()) as { manualExpenseWebEntry?: boolean; permissions: string[] };
      expect(session.manualExpenseWebEntry).toBe(false);
      expect(session.permissions).toContain('expense.create');

      await shop.goto(`/companies/${SHOP}/expenses`);
      await expect(shop.getByRole('link', { name: 'อัปโหลดใบเสร็จ', exact: true }).first()).toBeVisible();
      await expect(shop.getByRole('link', { name: 'บันทึกด้วยมือ', exact: true })).toHaveCount(0);
      await expect(manualLinks(shop)).toHaveCount(0);
      // The rest of the expenses menu is still there: only this one entrance is absent.
      const menuWithout = await sidebarExpenseLinks(shop);
      expect(menuWithout).toContain('/expenses/upload');
      expect(menuWithout).not.toContain('/expenses/manual');
      expect(await fitsTheScreen(shop)).toBeLessThanOrEqual(1);

      await shop.goto(`/companies/${SHOP}/income-expense-ledger`);
      await expect(shop.getByRole('heading', { name: 'เพิ่มรายการใหม่' })).toBeVisible();
      await expect(shop.getByRole('link', { name: 'ถ่ายหรืออัปโหลดใบเสร็จ' })).toBeVisible();
      await expect(shop.getByRole('link', { name: 'กรอกรายจ่ายเอง' })).toHaveCount(0);
      await expect(manualLinks(shop)).toHaveCount(0);

      // The AI page's "how to" list (folded, so counted in the page rather than on screen) names the
      // other expense work and not this page.
      await shop.goto(`/companies/${SHOP}/ai-suggestions`);
      if (hasAiSuggestionSourceAccess(session.permissions)) {
        await expect(shop.getByRole('main').locator('a[href$="/expenses/upload"]')).toHaveCount(1);
      } else {
        await expect(shop.getByRole('heading', { name: 'ไม่มีสิทธิ์เข้าถึง', exact: true })).toBeVisible();
        await expect(shop.getByRole('main').getByRole('link', { name: /^กลับไป/ })).toBeVisible();
      }
      await expect(manualLinks(shop)).toHaveCount(0);

      // The guide opens the section its address names; the note is the first thing in it.
      await shop.goto(`/companies/${SHOP}/user-guide/expenses#manual`);
      for (const line of GUIDE_NOTE) await expect(shop.getByText(line, { exact: true })).toBeVisible();
      await expect(shop.getByText('การ์ดรายการค่าใช้จ่าย', { exact: true })).toBeVisible();
      await expect(shop.getByRole('link', { name: 'เปิดหน้าบันทึกด้วยมือ' })).toHaveCount(0);
      await expect(manualLinks(shop)).toHaveCount(0);
      expect(await fitsTheScreen(shop)).toBeLessThanOrEqual(1);

      // The address itself: answered normally, no redirect, no refusal — a state that says what is so.
      const direct = await shop.goto(`/companies/${SHOP}/expenses/manual`);
      expect(direct!.status()).toBe(200);
      await expect(shop).toHaveURL(new RegExp(`/companies/${SHOP}/expenses/manual$`));
      await expect(shop.getByRole('heading', { name: NOT_ENABLED, exact: true })).toBeVisible();
      await expect(shop.getByRole('main').getByRole('link', { name: 'อัปโหลดใบเสร็จ', exact: true })).toBeVisible();
      await expect(shop.getByRole('main').getByRole('link', { name: 'กลับไปรายการค่าใช้จ่าย', exact: true })).toBeVisible();
      await expect(shop.getByRole('button', { name: 'บันทึกร่าง', exact: true })).toHaveCount(0);
      await expect(shop.getByText(/ไม่มีสิทธิ์|Forbidden/)).toHaveCount(0);
      await expectNoClientError(shop);
      expect(await fitsTheScreen(shop)).toBeLessThanOrEqual(1);
      await shop.screenshot({ path: test.info().outputPath('shop-390-not-enabled.png'), fullPage: true });

      // The old `?tab=manual` address lands on the same page and the same state.
      await shop.goto(`/companies/${SHOP}/expenses?tab=manual`);
      await expect(shop).toHaveURL(new RegExp(`/companies/${SHOP}/expenses/manual$`));
      await expect(shop.getByRole('heading', { name: NOT_ENABLED, exact: true })).toBeVisible();

      // ── 2. The admin switches it on: one press, no question, saved at once ────────────────────
      const { card, toggle } = await openManualRow(admin, SHOP);
      await expect(admin.getByText(LOCKED_EXCEPT_SWITCH, { exact: true })).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(toggle).toBeEnabled();
      await expect(card.getByText('ไม่แสดง', { exact: true })).toBeVisible();
      await expect(admin.getByText('มีการเปลี่ยนแปลง 0 รายการ')).toBeVisible();
      await admin.screenshot({ path: test.info().outputPath('admin-1280-not-shown.png'), fullPage: true });
      await toggle.click();
      await expect(admin.getByText('แสดงเมนูบันทึกด้วยมือแล้ว', { exact: true })).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(admin.getByRole('dialog')).toHaveCount(0);
      // It is not part of the package change set: nothing is waiting for "ตรวจสอบและบันทึก".
      await expect(admin.getByText('มีการเปลี่ยนแปลง 0 รายการ')).toBeVisible();
      expect(await client.companyWebEntrySetting.findUnique({ where: { companyId: SHOP } })).toMatchObject({ manualExpenseEntryEnabled: true, version: 1 });
      expect(await client.auditLog.count({ where: { companyId: SHOP, action: AUDIT_ACTION } })).toBe(1);

      // ── 3. The shop user's open page takes it up: no reload, no new login ─────────────────────
      // A mark on the document: a reload or a trip through the login page would lose it.
      await shop.evaluate(() => { (window as unknown as { sameDocument?: boolean }).sameDocument = true; });
      const sameDocument = () => shop.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true);
      await shop.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(shop.getByRole('button', { name: 'บันทึกร่าง', exact: true })).toBeVisible();
      await expect(shop.getByRole('heading', { name: NOT_ENABLED, exact: true })).toHaveCount(0);
      expect(await sidebarExpenseLinks(shop)).toEqual([...menuWithout.slice(0, menuWithout.indexOf('/expenses/upload') + 1), '/expenses/manual', ...menuWithout.slice(menuWithout.indexOf('/expenses/upload') + 1)]);
      expect(await sameDocument(), 'the page was refreshed in place, not reloaded or signed in again').toBe(true);

      // ── 4. A form in progress, and the admin switches it off ─────────────────────────────────
      await shop.locator('[data-transaction-branch-select]').getByRole('combobox').click();
      await shop.getByRole('option', { name: /สำนักงานใหญ่|Head Office/ }).first().click();
      await shop.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true }).fill(description);
      await shop.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill('65');

      await toggle.click();
      const dialog = admin.getByRole('dialog');
      await expect(dialog.getByText(CONFIRM_HIDE, { exact: true })).toBeVisible();
      await admin.screenshot({ path: test.info().outputPath('admin-1280-confirm-hide.png') });
      // Declining changes nothing.
      // The dialog's close mark carries the same name; the worded button is the one a person reads.
      await dialog.getByText('ยังไม่ซ่อน', { exact: true }).click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect((await client.companyWebEntrySetting.findUnique({ where: { companyId: SHOP } }))!.version).toBe(1);

      await toggle.click();
      await admin.getByRole('dialog').getByRole('button', { name: 'ซ่อนเมนู', exact: true }).click();
      await expect(admin.getByText('ซ่อนเมนูบันทึกด้วยมือแล้ว', { exact: true })).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(await client.companyWebEntrySetting.findUnique({ where: { companyId: SHOP } })).toMatchObject({ manualExpenseEntryEnabled: false, version: 2 });

      // The open form stays, with what was typed, and says it may still be saved.
      await shop.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(shop.getByText(CLOSED_NOTICE, { exact: true })).toBeVisible();
      await expect(shop.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true })).toHaveValue(description);
      await expect(shop.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true })).toHaveValue('65');
      expect(await sidebarExpenseLinks(shop)).toEqual(menuWithout);
      await expect(shop.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true })).toHaveValue(description);
      expect(await sameDocument()).toBe(true);
      expect(await fitsTheScreen(shop)).toBeLessThanOrEqual(1);
      await shop.screenshot({ path: test.info().outputPath('shop-390-form-left-open.png'), fullPage: true });

      // Saved once, by the same permission as ever: hiding the menu is not a refusal to record by hand.
      await shop.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
      // On to the saved record's own page (any address under /expenses except the manual page itself).
      await expect(shop).toHaveURL(new RegExp(`/companies/${SHOP}/expenses/(?!manual$)[^/]+$`));
      const saved = await client.expenseRecord.findMany({ where: { companyId: SHOP, lines: { some: { description } } }, select: { captureSource: true, status: true } });
      expect(saved).toEqual([{ captureSource: 'WEB_MANUAL', status: 'DRAFT' }]);

      // A new visit is judged again: the form does not open.
      await shop.goto(`/companies/${SHOP}/expenses/manual`);
      await expect(shop.getByRole('heading', { name: NOT_ENABLED, exact: true })).toBeVisible();
      await expect(shop.getByRole('button', { name: 'บันทึกร่าง', exact: true })).toHaveCount(0);

      // The same states on a computer screen, and the admin's row on a phone: nothing off the edge.
      await shop.setViewportSize({ width: 1280, height: 900 });
      await shop.reload();
      await expect(shop.getByRole('heading', { name: NOT_ENABLED, exact: true })).toBeVisible();
      expect(await fitsTheScreen(shop)).toBeLessThanOrEqual(1);
      await shop.screenshot({ path: test.info().outputPath('shop-1280-not-enabled.png'), fullPage: true });
      await admin.setViewportSize({ width: 390, height: 844 });
      await admin.reload();
      const phone = await openManualRow(admin, SHOP);
      await expect(phone.toggle).toHaveAttribute('aria-checked', 'false');
      expect(await fitsTheScreen(admin)).toBeLessThanOrEqual(1);
      await phone.toggle.scrollIntoViewIfNeeded();
      await admin.screenshot({ path: test.info().outputPath('admin-390-row.png') });
      expect(await client.auditLog.count({ where: { companyId: SHOP, action: AUDIT_ACTION } })).toBe(2);
    } finally {
      // What the seed writes for this demo company, so every other journey finds it as seeded.
      await client.companyWebEntrySetting.upsert({
        where: { companyId: SHOP }, update: { manualExpenseEntryEnabled: true }, create: { companyId: SHOP, manualExpenseEntryEnabled: true },
      }).catch(() => {});
      await shopContext.close();
      await adminContext.close();
      await client.$disconnect();
    }
  });

  test('the admin row says why it is locked, and what a shop with receipt upload off is left with', async ({ browser }) => {
    test.setTimeout(120_000);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const adminContext = await browser.newContext({ baseURL: WEB_BASE_URL, viewport: { width: 390, height: 844 } });
    const companyId = unique('e2e-web-entry').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const entitlement = (featureKey: string, enabled: boolean) => client.companyFeatureEntitlement.update({
      where: { companyId_featureKey: { companyId, featureKey } }, data: { enabled },
    });
    try {
      // A normal shop with a complete package, whose receipt upload is switched off.
      await client.company.create({ data: { id: companyId, name: 'E2E Web Entry' } });
      await client.companyEntitlementSet.create({ data: { companyId } });
      await client.companyEntitlementNormalization.create({ data: {
        companyId, status: 'COMPLETED', snapshotHash: companyId, runId: companyId, normalizerVersion: 1, cohortKind: 'EXPLICIT', completedAt: new Date(),
      } });
      await client.companyFeatureEntitlement.createMany({
        data: ALL_FEATURE_ENTITLEMENT_KEYS.map((featureKey) => ({ companyId, featureKey, enabled: featureKey !== 'expenses.upload' && featureKey !== 'expense_auto_post' })),
      });

      const admin = await adminSession(adminContext);
      let { card, toggle } = await openManualRow(admin, companyId);

      // Upload off and the menu not shown, without anyone having pressed anything: a standing note.
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(card.getByText(UPLOAD_OFF_NOTE, { exact: true })).toBeVisible();
      expect(await fitsTheScreen(admin)).toBeLessThanOrEqual(1);
      await toggle.scrollIntoViewIfNeeded();
      await admin.screenshot({ path: test.info().outputPath('admin-390-upload-off-note.png') });

      // Shown: staff have a create button again, so the note goes.
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(card.getByText(UPLOAD_OFF_NOTE, { exact: true })).toHaveCount(0);

      // Hiding it again asks first, with the extra warning for this shop.
      await toggle.click();
      const dialog = admin.getByRole('dialog');
      await expect(dialog.getByText(CONFIRM_HIDE, { exact: true })).toBeVisible();
      await expect(dialog.getByText(CONFIRM_UPLOAD_OFF, { exact: true })).toBeVisible();
      expect(await fitsTheScreen(admin)).toBeLessThanOrEqual(1);
      await admin.screenshot({ path: test.info().outputPath('admin-390-confirm-upload-off.png') });
      await dialog.getByRole('button', { name: 'ซ่อนเมนู', exact: true }).click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(card.getByText(UPLOAD_OFF_NOTE, { exact: true })).toBeVisible();

      // Another operator changed it meanwhile: this page still holds the old version.
      await client.companyWebEntrySetting.update({ where: { companyId }, data: { manualExpenseEntryEnabled: true, version: { increment: 1 } } });
      await client.companyWebEntrySetting.update({ where: { companyId }, data: { manualExpenseEntryEnabled: false, version: { increment: 1 } } });
      await toggle.click();
      await expect(admin.getByText('ค่านี้ถูกเปลี่ยนไปแล้ว กรุณาตรวจค่าล่าสุดก่อนบันทึกอีกครั้ง', { exact: true })).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(await client.companyWebEntrySetting.findUnique({ where: { companyId } })).toMatchObject({ manualExpenseEntryEnabled: false, version: 4 });
      // The page took the latest version with it: the next press saves.
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(await client.companyWebEntrySetting.findUnique({ where: { companyId } })).toMatchObject({ manualExpenseEntryEnabled: true, version: 5 });

      // The save fails on the way: said in Thai without the raw answer, and the switch is as it was, usable.
      await admin.route('**/manual-expense-web-entry', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }));
      await toggle.click();
      await admin.getByRole('dialog').getByRole('button', { name: 'ซ่อนเมนู', exact: true }).click();
      await expect(admin.getByText('ระบบขัดข้องชั่วคราว ลองอีกครั้ง', { exact: true })).toBeVisible();
      await expect(admin.getByText('boom')).toHaveCount(0);
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(toggle).toBeEnabled();
      await admin.unroute('**/manual-expense-web-entry');
      expect(await client.companyWebEntrySetting.findUnique({ where: { companyId } })).toMatchObject({ manualExpenseEntryEnabled: true, version: 5 });

      // The manual-expense feature saved as off: the shop sees no menu whatever is stored, so the row
      // says "ไม่แสดง", locked, with the way out. The stored "shown" waits, unchanged.
      await entitlement('expenses.manual', false);
      ({ card, toggle } = await openManualRow(admin, companyId));
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(toggle).toBeDisabled();
      await expect(card.getByText('ไม่แสดง', { exact: true })).toBeVisible();
      await expect(card.getByText('แสดง', { exact: true })).toHaveCount(0);
      await expect(card.getByText(PARENT_OFF, { exact: true })).toBeVisible();
      await expect(card.getByText(UPLOAD_OFF_NOTE, { exact: true })).toHaveCount(0);
      expect(await client.companyWebEntrySetting.findUnique({ where: { companyId } })).toMatchObject({ manualExpenseEntryEnabled: true, version: 5 });
      await toggle.scrollIntoViewIfNeeded();
      await admin.screenshot({ path: test.info().outputPath('admin-390-parent-off.png') });
      await admin.setViewportSize({ width: 1280, height: 900 });
      expect(await fitsTheScreen(admin)).toBeLessThanOrEqual(1);
      await toggle.scrollIntoViewIfNeeded();
      await admin.screenshot({ path: test.info().outputPath('admin-1280-parent-off.png') });
      await admin.setViewportSize({ width: 390, height: 844 });
      // The feature back on: the stored value is what the shop sees again, without anyone pressing the switch.
      await entitlement('expenses.manual', true);
      ({ card, toggle } = await openManualRow(admin, companyId));
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(toggle).toBeEnabled();
      await expect(card.getByText('แสดง', { exact: true })).toBeVisible();
      await expectNoClientError(admin);
    } finally {
      await client.auditLog.deleteMany({ where: { companyId } }).catch(() => {});
      await client.company.deleteMany({ where: { id: companyId } }).catch(() => {});
      await adminContext.close();
      await client.$disconnect();
    }
  });
});
