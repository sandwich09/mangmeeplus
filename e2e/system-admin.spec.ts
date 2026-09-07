import { test, expect } from './harness/fixtures';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client';
import {
  COMPANY_ID,
  SEED_USERS,
  ensureBrowserLegalAcceptance,
  expectNoClientError,
} from './harness/auth';
import { unique } from './harness/e2e-utils';

async function login(page: any, username: string, password: string) {
  await page.goto('/login');
  await page.locator('#login-identifier').fill(username);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
  await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/|system\/)/);
  await ensureBrowserLegalAcceptance(page.context());
  await page.goto('/system/partners');
}

test.describe('SYS — system admin', () => {
  test('SYS-01 @smoke system partner list renders for system admin', async ({ page }) => {
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    await page.goto('/system/partners');
    await expect(page.getByRole('heading', { name: /Partner Companies/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Onboard New Partner/i })).toBeVisible();
    await expectNoClientError(page);
  });

  test('SYS-02 @p1 partner detail renders metadata and feature toggles', async ({ page }) => {
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    await page.goto(`/system/partners/${COMPANY_ID}`);
    await expect(page.getByText(/WatchDog Local Company|seed-local-company|Feature/i).first()).toBeVisible();
    await expect(page.getByText(/LINE|feature|module|สถานะ/i).first()).toBeVisible();
    await expectNoClientError(page);
  });

  test('SYS-03 @p1 onboarding form can start a draft onboarding', async ({ page }) => {
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    await page.goto('/system/company-onboardings/new');
    await expect(page.getByRole('heading', { name: /New Company Onboarding/i })).toBeVisible();
    // ThemedSelect renders an sr-only form input for its `name`, so bare input-index
    // selectors drift; the three text fields are the only visible mangmee-input inputs.
    const fields = page.locator('input.mangmee-input:visible');
    await fields.nth(0).fill(unique('E2E Partner'));
    await fields.nth(1).fill(unique('E2E Owner'));
    await fields.nth(2).fill(unique('e2e-owner').toLowerCase());
    // Required since the PDPA tenant tripwire: the form will not submit uncategorised.
    // RETAIL deliberately — the non-alerting path, so the e2e run does not page the dev team.
    // The category picker is a ThemedSelect (combobox + role="option" buttons), not a native
    // <select>, so it needs open-then-click instead of selectOption().
    await page.getByRole('combobox', { name: 'ประเภทธุรกิจ / Business Category' }).click();
    await page.getByRole('option', { name: 'ค้าปลีก (Retail)', exact: true }).click();
    await page.getByRole('button', { name: /Create Onboarding/i }).click();
    await expect(page.getByText(/Handoff Package|temporary password|Company/i).first()).toBeVisible();
  });

  test('SYS-04 @p1 platform admin completes a reversible sales entitlement off/on/off cycle', async ({ page }) => {
    const databaseUrl = process.env['DATABASE_URL'];
    test.skip(!databaseUrl, 'DATABASE_URL is required for the reversible entitlement fixture');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const companyId = unique('e2e-entitlement-cycle').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    try {
      await client.company.create({ data: { id: companyId, name: 'E2E Entitlement Cycle' } });
      await client.companyEntitlementSet.create({ data: { companyId } });
      await client.companyEntitlementNormalization.create({ data: {
        companyId, status: 'COMPLETED', snapshotHash: companyId, runId: companyId,
        normalizerVersion: 1, cohortKind: 'EXPLICIT', completedAt: new Date(),
      } });
      await client.companyFeatureEntitlement.create({ data: { companyId, featureKey: 'sales_documents', enabled: true } });

      await page.setViewportSize({ width: 1280, height: 900 });
      await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
      await page.goto(`/system/partners/${companyId}`);
      await expect(page.getByRole('heading', { name: /E2E Entitlement Cycle/i })).toBeVisible();

      const salesSwitch = () => page.locator('article').filter({ hasText: 'เอกสารขายและรับชำระ' }).first().getByRole('switch');
      const saveCycle = async (enabled: boolean) => {
        await expect(salesSwitch()).toHaveAttribute('aria-checked', String(!enabled));
        await salesSwitch().click();
        await page.getByRole('button', { name: 'ตรวจสอบและบันทึก' }).click();
        await page.getByRole('button', { name: 'ยืนยันและบันทึก' }).click();
        await expect(salesSwitch()).toHaveAttribute('aria-checked', String(enabled));
      };

      await saveCycle(false);
      await saveCycle(true);
      await saveCycle(false);
      await page.reload();
      await expect(salesSwitch()).toHaveAttribute('aria-checked', 'false');
      const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(desktopOverflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: 'docs/evidence/p27-phase6/platform-admin-entitlement-off-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(salesSwitch()).toHaveAttribute('aria-checked', 'false');
      const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(mobileOverflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: 'docs/evidence/p27-phase6/platform-admin-entitlement-off-mobile.png', fullPage: true });
      await expectNoClientError(page);
    } finally {
      await client.company.deleteMany({ where: { id: companyId } }).catch(() => {});
      await client.$disconnect();
    }
  });

  test('SYS-05 @p1 seeded owner cannot reach system partner scope', async ({ authedPage }) => {
    await authedPage.goto('/system/partners');
    await expect(authedPage.getByText(/Access denied|ไม่มีสิทธิ์|not have permission/i).first()).toBeVisible();
  });

  test('SYS-06 @p1 LINE review requests every missing detail in one real mutation', async ({ page }) => {
    const databaseUrl = process.env['DATABASE_URL'];
    test.skip(!databaseUrl, 'DATABASE_URL is required for the signup review fixture');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const requestId = unique('e2e-line-request-info').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const lineProviderUserId = `U-${requestId}`;
    const companyName = `E2E LINE ${requestId.slice(-8)}`;
    const requestedInformation = '1. ชื่อร้านตามทะเบียน\n2. อีเมลติดต่อที่ถูกต้อง\n3. ยังเข้า LINE หรือบัญชีเดิมได้หรือไม่';
    try {
      await client.companySignupRequest.create({ data: {
        id: requestId,
        source: 'line-oa',
        externalSignupId: requestId,
        payloadHash: requestId,
        companyName,
        ownerDisplayName: 'เจ้าของร้าน LINE E2E',
        contactEmail: 'line-review@example.test',
        phoneNumber: '0812345678',
        consentVersion: 'e2e',
        state: 'PENDING_REVIEW',
        version: 3,
        lineSignupIntent: 'FIRST_SHOP',
        lineProviderUserId,
        lineChannelId: 'e2e-line-channel',
      } });

      await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
      await page.goto('/system/signup-requests');
      const row = page.getByRole('row').filter({ hasText: companyName });
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'เลือกผลคำขอ', exact: true }).click();
      await page.getByText('ขอข้อมูลเพิ่ม', { exact: true }).click();
      await page.getByLabel('ข้อมูลที่ต้องขอทั้งหมด').fill(requestedInformation);
      await page.getByRole('button', { name: 'บันทึกและแจ้งข้อมูลที่ต้องขอ', exact: true }).click();
      await expect(page.getByText('บันทึกข้อมูลที่ต้องขอและเข้าคิวแจ้งลูกค้าทาง LINE แล้ว', { exact: true })).toBeVisible();

      const stored = await client.companySignupRequest.findUniqueOrThrow({ where: { id: requestId } });
      expect(stored.state).toBe('PENDING_REVIEW');
      expect(stored.reviewResolution).toBe('REQUEST_INFO');
      expect(stored.resolutionNote).toBe(requestedInformation);
      expect(stored.version).toBe(4);
      const admin = await client.user.findFirstOrThrow({ where: { username: SEED_USERS.systemAdmin.username } });
      const support = await client.lineSupportRequest.findFirstOrThrow({ where: { signupRequestId: requestId } });
      expect(support.companyId).toBeNull();
      expect(support.lineUserId).toBe(lineProviderUserId);
      expect(support.status).toBe('OPEN');
      expect(support.assignedToUserId).toBe(admin.id);
      expect(support.assignedAt).not.toBeNull();
      await expectNoClientError(page);
    } finally {
      await client.lineSupportRequest.deleteMany({ where: { signupRequestId: requestId } }).catch(() => {});
      await client.outboxEvent.deleteMany({ where: { aggregateId: requestId } }).catch(() => {});
      await client.companySignupRequest.deleteMany({ where: { id: requestId } }).catch(() => {});
      await client.$disconnect();
    }
  });
});
