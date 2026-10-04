/**
 * Executive report — the main journey at 390 px (E1 accounts, E4a labels, E4b report screens):
 *   the System Admin creates an executive with both rights off and reads the one-time password;
 *   labels a seeded shop as a customer; a build round runs (the worker endpoint);
 *   the executive signs in, changes the temporary password, accepts the legal release and lands on the report;
 *   the companies card opens a list of exactly its count; a company's detail opens with its three tabs.
 *
 * Needs WORKER_INTERNAL_TOKEN (the same value the API runs with) for the build round; skips without it.
 */
import { test, expect, type Page } from '@playwright/test';
import { API_BASE_URL, SEED_USERS, WEB_BASE_URL, ensureBrowserLegalAcceptance } from './harness/auth';
import { WORKER_TOKEN } from './harness/expense-capture';

const PHONE = { width: 390, height: 844 };
const SHOP = 'seed-local-company-2';

async function signIn(page: Page, username: string, password: string) {
  await page.goto(`${WEB_BASE_URL}/login`);
  await page.locator('#login-identifier').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
}
async function setClassification(page: Page, label: string) {
  await page.goto(`${WEB_BASE_URL}/system/partners/${SHOP}?view=overview`);
  await page.locator('#reportClassification').click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await page.getByRole('button', { name: 'บันทึกข้อมูลสำหรับรายงาน' }).click();
  await expect(page.getByText('บันทึกข้อมูลสำหรับรายงานแล้ว')).toBeVisible();
}

test.describe('EXEC — executive report', () => {
  test('EXEC-01 @p1 create an executive, sign in, overview, drill into the list, open a company', async ({ browser }) => {
    test.skip(!WORKER_TOKEN, 'the build round needs WORKER_INTERNAL_TOKEN');
    test.setTimeout(180_000);

    // ── the System Admin creates the executive (both rights off) and reads the one-time password ──
    const adminContext = await browser.newContext({ viewport: PHONE });
    const admin = await adminContext.newPage();
    await signIn(admin, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    await admin.waitForURL(/\/(legal-acceptance|system|companies)/);
    await ensureBrowserLegalAcceptance(adminContext);
    const username = `e2e.exec.${Date.now()}`;
    await admin.goto(`${WEB_BASE_URL}/system/executive-users/new`);
    await expect(admin.getByRole('checkbox', { name: 'ส่งออก Excel' })).not.toBeChecked();
    await expect(admin.getByRole('checkbox', { name: 'ดูข้อมูลติดต่อเจ้าของร้าน' })).not.toBeChecked();
    await admin.getByRole('textbox', { name: 'ชื่อผู้ใช้' }).fill(username);
    await admin.getByRole('textbox', { name: 'ชื่อที่แสดง' }).fill('ผู้บริหาร ทดสอบอัตโนมัติ');
    await admin.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await expect(admin.getByRole('heading', { name: `รหัสผ่านชั่วคราวของ ${username}` })).toBeVisible();
    const temporaryPassword = (await admin.locator('span.select-all').innerText()).trim();
    expect(temporaryPassword.length).toBeGreaterThan(5);

    // ── one customer in the current month, then a build round ──
    await admin.goto(`${WEB_BASE_URL}/system/partners/${SHOP}?view=overview`);
    const previous = (await admin.locator('#reportClassification').innerText()).trim();
    await setClassification(admin, 'ลูกค้าจริง');
    try {
      const built = await admin.request.post(`${API_BASE_URL}/internal/executive/rebuild`, { headers: { 'x-worker-token': WORKER_TOKEN! } });
      expect(built.ok(), `rebuild -> ${built.status()}: ${await built.text()}`).toBe(true);

      // ── the executive: temporary password -> own password -> legal release -> the report ──
      const context = await browser.newContext({ viewport: PHONE });
      const page = await context.newPage();
      await signIn(page, username, temporaryPassword);
      await expect(page).toHaveURL(/\/change-password/);
      const changed = `E2e@Exec${Date.now()}`;
      await page.locator('input[name="new-password"]').fill(changed);
      await page.locator('input[name="confirm-password"]').fill(changed);
      await page.getByRole('button', { name: /เปลี่ยนรหัสผ่าน/ }).click();
      await expect(page).toHaveURL(/\/login/);
      await signIn(page, username, changed);
      await page.waitForURL(/\/(legal-acceptance|system\/executive)/);
      if (/legal-acceptance/.test(page.url())) {
        for (const name of ['termsAccepted', 'privacyAcknowledged', 'deletionAcknowledged']) await page.locator(`input[name="${name}"]`).check();
        await page.getByRole('button', { name: /ยืนยันและเริ่มใช้งาน/ }).click();
      }
      await expect(page).toHaveURL(/\/system\/executive(\?|$)/);
      await expect(page.getByRole('heading', { name: 'ภาพรวมธุรกิจมั่งมี', level: 1 })).toBeVisible();
      // Only the report menu.
      await expect(page.locator('#system-navigation')).toHaveAttribute('aria-label', 'ส่วนงานผู้บริหาร');
      await expect(page.locator('#system-navigation').getByRole('link', { name: 'บริษัทและผู้ใช้งาน' })).toHaveCount(0);

      // ── the companies card opens a list of exactly its count ──
      const card = page.locator('main div.grid.grid-cols-2 > a').first();
      await expect(page.getByRole('button', { name: 'ดูบริษัททั้งหมด', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'ดูอันดับการใช้', exact: true })).toBeVisible();
      await expect(card.locator('.mangmee-stat-value')).toHaveCSS('font-size', '24px');
      await expect(card).toContainText('บริษัทลูกค้า');
      const count = Number((await card.innerText()).match(/บริษัทลูกค้า\s+(?:อย่างน้อย\s+)?([\d,]+)/)?.[1]?.replace(/,/g, ''));
      expect(count).toBeGreaterThan(0);
      await card.click();
      await page.waitForURL(/\/system\/executive\/companies\?/);
      await expect(page.getByRole('status').filter({ hasText: new RegExp(`^พบ ${count.toLocaleString('th-TH')} บริษัท`) })).toBeVisible();

      // ── a company's detail and its three tabs ──
      const link = page.locator('main a[href^="/system/executive/companies/"]').first();
      const name = (await link.innerText()).trim();
      await link.click();
      await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
      await expect(page.getByText('ข้อมูลบริษัท', { exact: true }).first()).toBeVisible();
      await page.getByRole('button', { name: 'การใช้งานและรายรับ', exact: true }).click();
      await expect(page.getByRole('button', { name: 'การใช้งานและรายรับ', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'ประวัติบริษัท', exact: true }).click();
      await expect(page.getByText('สมัคร', { exact: true }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await context.close();
    } finally {
      if (previous && previous !== 'ลูกค้าจริง') await setClassification(admin, previous);
      await adminContext.close();
    }
  });
});
