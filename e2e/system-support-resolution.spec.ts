import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client';
import { test, expect } from './harness/fixtures';
import { ensureBrowserLegalAcceptance, expectNoClientError, SEED_USERS } from './harness/auth';
import { unique } from './harness/e2e-utils';

async function loginSystemAdmin(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#login-identifier').fill(SEED_USERS.systemAdmin.username);
  await page.locator('#login-password').fill(SEED_USERS.systemAdmin.password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
  await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/|system\/)/);
  await ensureBrowserLegalAcceptance(page.context());
}

test.describe('system support resolution', () => {
  test('claims and resolves a no-company LINE case with the latest message and outcome retained', async ({ page }, info) => {
    const databaseUrl = process.env['DATABASE_URL'];
    test.skip(!databaseUrl, 'DATABASE_URL is required for the support resolution fixture');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const id = unique('e2e-support-resolution').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const requestedAt = new Date('2000-01-01T00:00:00.000Z');
    const question = `เปิดร้านไม่ได้หลังส่งข้อมูลแล้ว อยากทราบว่าต้องตรวจอะไรเพิ่มและควรทำอย่างไรต่อ โดยยังไม่อยากกรอกคำขอใหม่ ${id.slice(-8)}`;
    const latest = 'ลองปิดแล้วเปิด LINE ใหม่และตรวจข้อมูลทุกช่องแล้ว แต่ยังเข้าใช้งานไม่ได้ค่ะ ขอให้ช่วยตรวจจากคำขอเดิม';
    const resolution = 'ตรวจข้อมูลแล้ว เปิดสิทธิ์ให้ลูกค้าและยืนยันว่าเข้าใช้งานได้';
    try {
      await client.lineSupportRequest.create({ data: {
        id,
        companyId: null,
        lineUserId: `U-${id}`,
        lineUserIdHash: '0123456789abcdef',
        requestedAt,
        requestText: question,
        lastMessageText: latest,
        lastMessageAt: requestedAt,
        notifiedAt: requestedAt,
        status: 'OPEN',
      } });

      await page.setViewportSize({ width: 390, height: 844 });
      await loginSystemAdmin(page);
      await page.goto('/system/support-requests');
      const row = page.getByRole('row').filter({ hasText: question });
      await expect(row).toBeVisible();
      await expect(row).toContainText('ผู้ที่ยังไม่ได้เปิดร้าน');
      await expect(row).toContainText(latest);
      const questionText = row.getByTitle(question);
      const latestText = row.getByTitle(latest);
      await expect(questionText).toBeVisible();
      await expect(latestText).toBeVisible();
      expect(await questionText.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      expect(await latestText.evaluate((element) => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      const claimButton = row.getByRole('button', { name: 'รับเคส', exact: true });
      await expect(claimButton).toBeVisible();
      expect((await claimButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => {
        const table = document.querySelector('table');
        const card = table?.parentElement?.parentElement;
        return document.documentElement.scrollWidth <= innerWidth
          && (!card || card.scrollWidth <= card.clientWidth);
      })).toBe(true);

      await row.getByRole('button', { name: 'รับเคส', exact: true }).click();
      await expect(page.getByText('รับผิดชอบเคสนี้แล้ว', { exact: true })).toBeVisible();
      await expect(row).toContainText('ผู้รับผิดชอบ: คุณ');
      for (const name of ['ตอบใน LINE', 'แก้ไขสำเร็จและปิดเคส', 'ปล่อยเคส']) {
        const button = row.getByRole('button', { name, exact: true });
        await expect(button).toBeVisible();
        expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      const admin = await client.user.findFirstOrThrow({ where: { username: SEED_USERS.systemAdmin.username } });
      const claimed = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      expect(claimed.assignedToUserId).toBe(admin.id);
      expect(claimed.assignedAt).not.toBeNull();
      await page.screenshot({ path: info.outputPath('support-no-company-claimed-390.png'), fullPage: true });

      await row.getByRole('button', { name: 'แก้ไขสำเร็จและปิดเคส', exact: true }).click();
      await page.getByLabel('ผลที่แก้ไขให้ลูกค้า').fill(resolution);
      await page.getByRole('button', { name: 'บันทึกและปิดเคส', exact: true }).click();
      await expect(page.getByText('บันทึกว่าแก้ไขสำเร็จและปิดเคสแล้ว', { exact: true })).toBeVisible();

      const closed = await client.lineSupportRequest.findUniqueOrThrow({ where: { id } });
      expect(closed.status).toBe('CLOSED');
      expect(closed.closedReason).toBe('resolved');
      expect(closed.resolvedByUserId).toBe(admin.id);
      expect(closed.resolutionNote).toBe(resolution);
      expect(closed.lastMessageText).toBe(latest);
      expect(closed.assignedToUserId).toBe(admin.id);

      await page.getByRole('button', { name: 'ปิดแล้ว', exact: true }).click();
      await expect(page.getByRole('row').filter({ hasText: question })).toContainText(`ผลที่บันทึก: ${resolution}`);
      await page.screenshot({ path: info.outputPath('support-no-company-resolved-390.png'), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoClientError(page);
    } finally {
      await client.lineSupportRequest.deleteMany({ where: { id } }).catch(() => {});
      await client.$disconnect();
    }
  });

  test('a company owner cannot read the system support inbox by UI or API', async ({ authedPage, api }) => {
    const response = await api.get('system/support-requests?status=OPEN');
    expect(response.status()).toBe(403);

    await authedPage.goto('/system/support-requests');
    await expect(authedPage.getByText(/Access denied|ไม่มีสิทธิ์|not have permission/i).first()).toBeVisible();
  });
});
