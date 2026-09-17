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
  test('SYS discovery attribution stays visible in company information on mobile and desktop', async ({ page }, info) => {
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    // Real admin page/session; only company detail data is controlled for this presentation check.
    let discoverySource: string | undefined = 'OTHER';
    await page.route(`**/api/v1/system/partners/${COMPANY_ID}`, async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.fulfill({ response, json: {
        ...await response.json(), discoverySource,
        discoverySourceOther: discoverySource === 'OTHER' ? 'เพื่อนแนะนำ <script>test</script>' : undefined,
      } });
    });
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/system/partners/${COMPANY_ID}`);
      const overview = page.getByRole('region', { name: 'ภาพรวมบริษัท', exact: true });
      await expect(overview.getByText('รู้จักเราทางไหน', { exact: true })).toBeVisible();
      await expect(overview.getByText('อื่น ๆ — เพื่อนแนะนำ <script>test</script>', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`company-discovery-${width}.png`), fullPage: true });
    }
    discoverySource = undefined;
    await page.reload();
    await expect(page.getByText('รู้จักเราทางไหน', { exact: true }).locator('..')).toContainText('ไม่ระบุ');
    await expectNoClientError(page);
  });

  test('SYS-01 @smoke system partner list renders for system admin', async ({ page }) => {
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    await page.goto('/system/partners');
    await expect(page.getByRole('heading', { name: 'บริษัทและผู้ใช้งาน', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'เพิ่มบริษัท', exact: true })).toBeVisible();
    await expectNoClientError(page);
  });

  test('SYS-01A directory search, status, pagination and browser return share the same dataset', async ({ page }) => {
    const databaseUrl = process.env['DATABASE_URL'];
    test.skip(!databaseUrl, 'DATABASE_URL is required for isolated directory fixtures');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const prefix = unique('directory');
    const ids = Array.from({ length: 21 }, (_, i) => `${prefix}-${String(i).padStart(2, '0')}`);
    try {
      await client.company.createMany({ data: ids.map((id, i) => ({ id, name: `${prefix} ${i}`, registeredName: `${prefix} registered ${i}`, status: i === 20 ? 'SUSPENDED' as const : 'ACTIVE' as const, createdAt: new Date('2026-01-01T00:00:00Z') })) });
      await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
      const directory = page.getByRole('region', { name: 'รายชื่อบริษัท', exact: true });
      await page.getByLabel('ค้นหาบริษัท', { exact: true }).fill(prefix);
      await directory.getByRole('button', { name: 'ค้นหา', exact: true }).click();
      await expect(directory.getByRole('status')).toContainText('พบ 21 บริษัท');
      await expect(directory.locator('tbody tr')).toHaveCount(20);
      await directory.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      await expect(directory.locator('tbody tr')).toHaveCount(1);
      await expect(directory).toContainText(`${prefix} 20`);
      await directory.getByRole('combobox', { name: 'สถานะบริษัท' }).click();
      await page.getByRole('option', { name: 'ระงับชั่วคราว', exact: true }).click();
      await expect(directory.getByRole('status')).toContainText('พบ 1 บริษัท');
      await expect(page).not.toHaveURL(/page=2/);
      await directory.getByRole('link', { name: `ดูรายละเอียด ${prefix} 20`, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/system/partners/${ids[20]}`));
      await page.goBack();
      await expect(page.getByLabel('ค้นหาบริษัท', { exact: true })).toHaveValue(prefix);
      await expect(directory.getByRole('status')).toContainText('พบ 1 บริษัท');
      await page.getByLabel('ค้นหาบริษัท', { exact: true }).fill(`${prefix} missing`);
      await directory.getByRole('button', { name: 'ค้นหา', exact: true }).click();
      await expect(directory.getByText('ไม่พบบริษัทที่ตรงกับการค้นหา', { exact: true })).toBeVisible();
      await expect(directory.locator('table')).toHaveCount(0);
      await directory.getByRole('button', { name: 'แสดงบริษัททั้งหมด' }).click();
      await expect(page.getByLabel('ค้นหาบริษัท', { exact: true })).toHaveValue('');
      await page.getByLabel('ค้นหาบริษัท', { exact: true }).fill(`${prefix} registered 20`);
      await directory.getByRole('button', { name: 'ค้นหา', exact: true }).click();
      await expect(directory.getByRole('status')).toContainText('พบ 1 บริษัท');
      await expectNoClientError(page);
    } finally {
      await client.company.deleteMany({ where: { id: { in: ids } } });
      await client.$disconnect();
    }
  });

  test('SYS-01B mobile user lookup stays separate, retains context and recovers from errors', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    const menu = page.getByRole('button', { name: /^เมนู/ });
    await expect(page.getByRole('navigation', { name: 'ส่วนงานผู้ดูแลระบบ' })).toBeHidden();
    await menu.click();
    const navigation = page.getByRole('navigation', { name: 'ส่วนงานผู้ดูแลระบบ' });
    await expect(navigation.getByRole('link', { name: 'บริษัทและผู้ใช้งาน' })).toHaveAttribute('aria-current', 'page');
    await navigation.getByRole('link', { name: 'บริษัทและผู้ใช้งาน' }).focus();
    await page.keyboard.press('Escape');
    await expect(navigation).toBeHidden();
    await expect(menu).toBeFocused();
    const views = page.getByRole('navigation', { name: 'มุมมองข้อมูลลูกค้า' });
    await views.getByRole('link', { name: 'ผู้ใช้งาน', exact: true }).click();
    const users = page.getByRole('region', { name: 'ค้นหาผู้ใช้งาน', exact: true });
    await expect(page.getByRole('region', { name: 'รายชื่อบริษัท', exact: true })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'ค้นหาผู้ใช้งาน', exact: true }).fill('Owner');
    await users.getByRole('button', { name: 'ค้นหา', exact: true }).click();
    await expect(users.locator('article')).toHaveCount(1);
    await users.getByRole('combobox', { name: 'สถานะผู้ใช้งาน' }).click();
    await page.getByRole('option', { name: 'ปิดใช้งาน', exact: true }).click();
    await expect(users.getByText('ไม่พบผู้ใช้งานที่ตรงกับการค้นหา', { exact: true })).toBeVisible();
    await views.getByRole('link', { name: 'บริษัท', exact: true }).click();
    await expect(page.getByRole('region', { name: 'รายชื่อบริษัท', exact: true })).toBeVisible();
    await views.getByRole('link', { name: 'ผู้ใช้งาน', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'ค้นหาผู้ใช้งาน', exact: true })).toHaveValue('Owner');
    await expect(users.getByRole('combobox')).toContainText('ปิดใช้งาน');
    await views.getByRole('link', { name: 'บริษัท', exact: true }).click();
    await expect(page.getByRole('region', { name: 'รายชื่อบริษัท' }).getByRole('status')).toContainText('พบ');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    const companies = page.getByRole('region', { name: 'รายชื่อบริษัท', exact: true });
    await page.route('**/api/v1/system/partners?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'ลองใหม่อีกครั้ง' }) }));
    await page.getByLabel('ค้นหาบริษัท', { exact: true }).fill('Bloom');
    await companies.getByRole('button', { name: 'ค้นหา', exact: true }).click();
    await expect(companies.getByRole('alert')).toBeVisible();
    await page.unroute('**/api/v1/system/partners?*');
    await companies.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
    await expect(companies.getByRole('status')).toContainText('พบ 1 บริษัท');
    await expect(page.getByLabel('ค้นหาบริษัท', { exact: true })).toHaveValue('Bloom');
  });

  test('SYS-02 @p1 partner detail renders metadata and feature toggles', async ({ page }) => {
    await login(page, SEED_USERS.systemAdmin.username, SEED_USERS.systemAdmin.password);
    await page.goto(`/system/partners/${COMPANY_ID}`);
    await expect(page.getByRole('navigation', { name: 'หมวดข้อมูลบริษัท', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ข้อมูลบริษัท', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'การเชื่อมบัญชี LINE', exact: true })).toBeVisible();
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
      await page.goto(`/system/partners/${companyId}?view=package`);
      await expect(page.getByRole('heading', { name: /E2E Entitlement Cycle/i })).toBeVisible();
      await page.getByRole('searchbox', { name: 'ค้นหาเมนู', exact: true }).fill('เอกสารขาย');

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
      await page.getByRole('searchbox', { name: 'ค้นหาเมนู', exact: true }).fill('เอกสารขาย');
      await expect(salesSwitch()).toHaveAttribute('aria-checked', 'false');
      const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(desktopOverflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: 'docs/evidence/p27-phase6/platform-admin-entitlement-off-desktop.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await page.getByRole('searchbox', { name: 'ค้นหาเมนู', exact: true }).fill('เอกสารขาย');
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
