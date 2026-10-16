import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { COMPANY_ID, ensureBrowserLegalAcceptance, expectNoClientError } from './harness/auth';

// API dependencies stay owned by the API package; no new root dependency is needed.
const apiRequire = createRequire(resolve('apps/api/package.json'));

for (const width of [390, 1280]) {
  test(`LINE recovery generic request and support fallback at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/forgot-password');
    await expect(page.getByRole('heading', { name: 'ลืมรหัสผ่าน', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'ชื่อผู้ใช้หรืออีเมล', exact: true }).fill(`missing.${randomUUID()}`);
    // The page sends to e-mail unless LINE is chosen; this journey is the LINE one.
    await page.getByRole('radio', { name: 'LINE ที่เชื่อมไว้กับบัญชีนี้', exact: true }).check();
    const response = page.waitForResponse((response) => response.url().endsWith('/auth/password/reset-request'));
    await page.getByRole('button', { name: 'ส่งรหัสผ่านชั่วคราว', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'ส่งแล้ว ดูที่ LINE', exact: true })).toBeVisible();
    // The fallback for someone whose LINE never gets the message is said once, after sending.
    await expect(page.getByText(/ไม่ได้รับ ให้ผู้ดูแลร้านตั้งรหัสผ่านให้ใหม่/)).toBeVisible();
    await page.screenshot({ path: info.outputPath(`forgot-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'กลับไปหน้าเข้าสู่ระบบ', exact: true }).click();
    await expect(page.locator('#login-identifier')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test(`LINE recovery real login, forced change and ordinary login at ${width}px`, async ({ page, context }, info) => {
    const databaseUrl = process.env.AUTH_RECOVERY_TEST_DATABASE_URL;
    test.skip(!databaseUrl, 'requires the isolated local recovery review database');
    // Load compiled helpers only after webServer setup, not during clean-tree test discovery.
    const { PrismaPg } = apiRequire('@prisma/adapter-pg');
    const { PrismaClient } = apiRequire(resolve('apps/api/dist/apps/api/src/generated/prisma/client.js'));
    const { hashPassword, verifyPassword } = apiRequire(resolve('apps/api/dist/apps/api/src/modules/auth/domain/logic/password-credential.logic.js'));
    const { hashLineRecoveryPassword } = apiRequire(resolve('apps/api/dist/apps/api/src/modules/auth/domain/logic/secure-token.logic.js'));
    const url = new URL(databaseUrl!);
    expect(['localhost', '127.0.0.1']).toContain(url.hostname);
    expect(url.pathname).toMatch(/_recovery_review_/);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const userId = `recovery-ui-${randomUUID()}`;
    const username = userId;
    const passwordHash = hashPassword('original-ui-password');
    const rawRecovery = 'Recovery12_x';
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const login = async (password: string) => {
      await page.goto('/login');
      await page.locator('#login-identifier').fill(username);
      await page.locator('#login-password').fill(password);
      await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
    };
    try {
      await client.user.create({ data: { id: userId, username, displayName: 'ผู้ทดสอบกู้รหัสผ่าน', credential: { create: { passwordHash } } } });
      const role = await client.role.findFirstOrThrow({ where: { key: 'OWNER', status: 'ACTIVE', OR: [{ companyId: null }, { companyId: COMPANY_ID }] } });
      await client.companyMembership.create({ data: { userId, companyId: COMPANY_ID, roles: { create: { roleId: role.id } } } });
      // Synthetic transport fixture only. The PostgreSQL suite separately exercises
      // request generation + intercepted LINE delivery; this test uses real login APIs.
      const token = await client.passwordResetToken.create({ data: { userId, tokenHash: hashLineRecoveryPassword(rawRecovery, passwordHash), expiresAt: new Date(Date.now() + 30 * 60_000) } });
      await page.setViewportSize({ width, height: 844 });
      await login('original-ui-password');
      await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/)/);
      await ensureBrowserLegalAcceptance(context, COMPANY_ID);
      await page.goto(`/companies/${COMPANY_ID}/dashboard`);
      await expect(page.getByRole('heading', { name: /สวัสดี/ })).toBeVisible();
      expect((await client.passwordResetToken.findUniqueOrThrow({ where: { id: token.id } })).status).toBe('PENDING');
      if (!await page.getByRole('button', { name: /เมนูผู้ใช้|User Menu/ }).isVisible()) {
        await page.getByRole('button', { name: 'สลับเมนู', exact: true }).click();
      }
      await page.getByRole('button', { name: /เมนูผู้ใช้|User Menu/ }).click();
      // No question before signing out since 2026-10-13: the menu row signs out at once.
      await page.getByRole('button', { name: /ออกจากระบบ|Sign out/ }).click();
      await expect(page).toHaveURL(/\/login/);

      await login(rawRecovery);
      await expect(page).toHaveURL(/\/change-password/);
      await page.goto(`/companies/${COMPANY_ID}/dashboard`);
      await expect(page).toHaveURL(/\/change-password/);
      await expect(page.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน', exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`forced-change-${width}.png`), fullPage: true });
      await page.locator('input[name="new-password"]').fill('chosen-new-ui-password');
      await page.locator('input[name="confirm-password"]').fill('chosen-new-ui-password');
      await page.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน', exact: true }).click();
      await expect(page).toHaveURL(/\/login/);
      const saved = await client.userCredential.findUniqueOrThrow({ where: { userId } });
      expect(saved.mustChangePassword).toBe(false);
      expect(verifyPassword('chosen-new-ui-password', saved.passwordHash)).toBe(true);
      expect(verifyPassword(rawRecovery, saved.passwordHash)).toBe(false);
      expect((await client.passwordResetToken.findUniqueOrThrow({ where: { id: token.id } })).status).toBe('USED');
      await login('chosen-new-ui-password');
      await expect(page).toHaveURL(new RegExp(`/companies/${COMPANY_ID}/dashboard`));
      await expect(page.getByRole('heading', { name: /สวัสดี/ })).toBeVisible();
      await expect(page.getByRole('button', { name: 'เลือกสาขา', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: /ใบเสร็จรอตรวจ \(ทุกช่วงเวลา\)/ })).toBeVisible();
      await expectNoClientError(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`recovered-${width}.png`), fullPage: true });
      expect(errors).toEqual([]);
    } finally {
      // Legal acceptance is append-only even in this isolated clone. Retain its
      // synthetic evidence; never disable the trigger merely to clean a fixture.
      await client.auditLog.deleteMany({ where: { actorUserId: userId } });
      await client.companyMembership.deleteMany({ where: { userId } });
      await client.user.deleteMany({ where: { id: userId } });
      await client.$disconnect();
    }
  });
}
