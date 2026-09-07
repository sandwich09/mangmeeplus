import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { test, expect } from './harness/fixtures';
import { ensureBrowserLegalAcceptance, expectNoClientError } from './harness/auth';

const apiRequire = createRequire(resolve('apps/api/package.json'));
const databaseUrl = process.env.RECEIPT_CONTINUITY_TEST_DATABASE_URL;

/** Seed only synthetic records in an explicitly selected local DB; requests and UI stay real. */
async function fixture(companyId: string, ownerId = 'seed-local-owner', ocrItems = [{ description: 'กระดาษ A4' }, { description: 'ปากกา' }]) {
  if (!databaseUrl) throw new Error('RECEIPT_CONTINUITY_TEST_DATABASE_URL is required');
  const url = new URL(databaseUrl);
  expect(['localhost', '127.0.0.1']).toContain(url.hostname);
  expect(url.pathname).toBe('/watchdog_bms');
  expect(databaseUrl).toBe(process.env.DATABASE_URL);
  const dist = process.env.API_DIST_DIR ?? `dist/e2e-${process.env.API_PORT ?? '3001'}`;
  const compiled = (path: string) => apiRequire(resolve(`apps/api/${dist}/apps/api/src/${path}.js`));
  const { PrismaPg } = apiRequire('@prisma/adapter-pg');
  const { PrismaClient } = compiled('generated/prisma/client');
  const { S3StorageAdapter } = compiled('modules/data-model-core/infrastructure/storage/s3-storage.adapter');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const endpoint = new URL(process.env.S3_ENDPOINT!);
  expect(['localhost', '127.0.0.1']).toContain(endpoint.hostname);
  expect(process.env.S3_BUCKET).toMatch(/^receipt-remediation-/);
  const storage = new S3StorageAdapter({
    s3Region: 'local', s3Endpoint: endpoint.href, s3ForcePathStyle: true,
    s3Bucket: process.env.S3_BUCKET, s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  });
  const tag = `receipt-continuity-${randomUUID()}`;
  const objectKey = `${companyId}/${tag}.png`;
  // A generated test image, never a copied customer receipt.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64');
  const stored = await storage.putObject({ objectKey, bytes, mimeType: 'image/png' });
  const branch = await client.branch.findFirstOrThrow({ where: { companyId, status: 'ACTIVE' } });
  const attachment = await client.attachmentObject.create({ data: {
    companyId, branchId: branch.id, ...stored, originalFileName: `${tag}.png`, mimeType: 'image/png',
    uploadedByUserId: ownerId, status: 'ACTIVE', visibility: 'INTERNAL', uploadedAt: new Date(),
  } });
  const expense = await client.expenseRecord.create({ data: {
    companyId, branchId: branch.id, createdByUserId: ownerId, status: 'NEEDS_REVIEW', captureSource: 'LINE_UPLOAD',
    expenseDate: new Date(), currency: 'THB', vatMode: 'NO_VAT', sourceDocumentType: 'RECEIPT',
    primaryAttachmentId: attachment.id, note: 'LINE receipt upload', aiVerificationStatus: 'NEEDS_REVIEW',
    sourceChannelMetadataJson: { channel: 'LINE', kind: 'media', chatKeyHash: tag },
    aiVerificationSummaryJson: {
      status: 'partial', missingFields: ['expenseDate', 'vendorName'],
      recognizedFields: { lines: ocrItems },
    },
  } });
  await client.attachmentLink.create({ data: {
    companyId, attachmentId: attachment.id, targetType: 'expense.record', targetId: expense.id,
    purpose: 'expense.receipt.primary', linkedByUserId: ownerId,
  } });
  return {
    client, expense, attachment, compiled,
    async cleanup() {
      await client.expenseRecord.delete({ where: { id: expense.id } });
      await client.attachmentObject.delete({ where: { id: attachment.id } });
      await storage.deleteObject({ bucket: stored.bucket, objectKey, objectVersionId: stored.objectVersionId });
      await client.$disconnect();
    },
  };
}

for (const width of [390, 1280]) {
  test(`receipt partial draft saves and reloads all incomplete items at ${width}px`, async ({ authedPage: page, api, companyId }, info) => {
    test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
    const f = await fixture(companyId);
    try {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
      const source = page.getByRole('region', { name: 'ข้อมูลบิลที่ยังไม่ครบ', exact: true });
      await expect(source).toBeVisible();
      await expect(page.getByText(/ยังไม่ทราบวันที่ในบิล$/)).toBeVisible();
      await expect(page.getByText('ยังสรุปยอดไม่ได้ ข้อมูลบิลยังไม่ครบ', { exact: true })).toBeVisible();
      await expect(source.getByRole('region', { name: 'รายการที่ 1', exact: true })).toBeVisible();
      await expect(source.getByRole('region', { name: 'รายการที่ 2', exact: true })).toBeVisible();
      await source.getByLabel('ชื่อผู้ขาย', { exact: true }).fill('ร้านทดสอบที่กรอกเอง');
      await source.getByLabel('รายการที่ 1 จำนวน', { exact: true }).fill('5');
      await expect(source.getByLabel('รายการที่ 1 ราคาต่อหน่วย', { exact: true })).toHaveValue('');
      await source.getByRole('button', { name: 'เก็บร่างไว้ก่อน', exact: true }).click();
      await expect(source.getByRole('status')).toHaveText('เก็บร่างแล้ว ยังไม่ยืนยันรายการ');

      const response = await api.get(`companies/${companyId}/expenses/${f.expense.id}`);
      expect(response.ok()).toBe(true);
      const saved = await response.json();
      expect(saved.sourceDraft.header.vendorName).toBe('ร้านทดสอบที่กรอกเอง');
      expect(saved.sourceDraft.items).toHaveLength(2);
      expect(saved.sourceDraft.items[0].quantity).toBe('5');
      expect(saved.sourceDraft.items[0].unitPrice).toBeNull();
      expect(saved.sourceDraft.items[1].quantity).toBeNull();
      expect(saved.lines).toHaveLength(0);
      expect(saved.primaryAttachmentId).toBe(f.attachment.id);
      expect(saved.sourceDraft.missingFields.some((field: { field: string }) => field.field === 'price')).toBe(true);
      expect(['DRAFT', 'NEEDS_REVIEW']).toContain(saved.status);

      await page.reload();
      await expect(source.getByLabel('ชื่อผู้ขาย', { exact: true })).toHaveValue('ร้านทดสอบที่กรอกเอง');
      await expect(source.getByLabel('รายการที่ 1 จำนวน', { exact: true })).toHaveValue('5');
      await expect(source.getByLabel('รายการที่ 1 ราคาต่อหน่วย', { exact: true })).toHaveValue('');
      await expect(source.getByRole('region', { name: 'รายการที่ 2', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoClientError(page);
      await source.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`partial-draft-${width}.png`), fullPage: true });
    } finally { await f.cleanup(); }
  });
}

test('source draft rejects stale browser save without replacing a newer vendor', async ({ authedPage: page, companyId }) => {
  test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
  const f = await fixture(companyId);
  try {
    await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
    const source = page.getByRole('region', { name: 'ข้อมูลบิลที่ยังไม่ครบ', exact: true });
    await expect(source).toBeVisible();
    await source.getByLabel('ชื่อผู้ขาย', { exact: true }).fill('ข้อมูลจากหน้าเก่า');
    await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { vendorNameSnapshot: 'ข้อมูลล่าสุดจากอีกหน้า' } });
    const failed = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(f.expense.id));
    await source.getByRole('button', { name: 'เก็บร่างไว้ก่อน', exact: true }).click();
    expect((await failed).status()).toBe(409);
    await expect(source.getByRole('alert')).toBeVisible();
    const record = await f.client.expenseRecord.findUniqueOrThrow({ where: { id: f.expense.id } });
    expect(record.vendorNameSnapshot).toBe('ข้อมูลล่าสุดจากอีกหน้า');
  } finally { await f.cleanup(); }
});

test('reviewer can reopen a legacy READY partial without inventing financial rows', async ({ authedPage: page, companyId }) => {
  test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
  const f = await fixture(companyId);
  try {
    // Represents a record moved to READY before the source-completeness guard existed.
    await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'READY_FOR_CONFIRMATION' } });
    await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
    const source = page.getByRole('region', { name: 'ข้อมูลบิลที่ยังไม่ครบ', exact: true });
    await expect(source.getByLabel('ชื่อผู้ขาย', { exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'กลับไปเติมข้อมูลบิล', exact: true }).click();
    await expect(source.getByLabel('ชื่อผู้ขาย', { exact: true })).toBeEnabled();
    await source.getByLabel('ชื่อผู้ขาย', { exact: true }).fill('เติมต่อโดยไม่เดายอด');
    await source.getByRole('button', { name: 'เก็บร่างไว้ก่อน', exact: true }).click();
    await expect(source.getByRole('status')).toHaveText('เก็บร่างแล้ว ยังไม่ยืนยันรายการ');
    const saved = await f.client.expenseRecord.findUniqueOrThrow({ where: { id: f.expense.id }, include: { lines: true } });
    expect(saved.status).toBe('NEEDS_REVIEW');
    expect(saved.lines).toHaveLength(0);
    expect(saved.vendorNameSnapshot).toBe('เติมต่อโดยไม่เดายอด');
    expect(saved.primaryAttachmentId).toBe(f.attachment.id);
  } finally { await f.cleanup(); }
});

for (const emptyOcr of [false, true]) {
test(`originating upload-only user can ${emptyOcr ? 'add an unreadable item and ' : ''}save source facts without acquiring finance authority`, async ({ browser, companyId, urls }, info) => {
  test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
  const f = await fixture(companyId, 'seed-local-owner', emptyOcr ? [] : undefined);
  const tag = `upload-only-${randomUUID()}`;
  const { hashPassword } = f.compiled('modules/auth/domain/logic/password-credential.logic');
  const password = 'LocalReceiptOnly123!';
  let roleId: string | undefined;
  const context = await browser.newContext({ baseURL: urls.web, viewport: { width: 390, height: 844 } });
  try {
    await f.client.user.create({ data: { id: tag, username: tag, displayName: 'ผู้ส่งบิลทดสอบ', credential: { create: { passwordHash: hashPassword(password), mustChangePassword: false } } } });
    const keys = ['account.session.read', 'attachment.read', 'expense.read_own', 'expense.receipt.line_upload'];
    const permissions = await f.client.permission.findMany({ where: { key: { in: keys } } });
    expect(permissions).toHaveLength(keys.length);
    const role = await f.client.role.create({ data: { companyId, scopeKey: companyId, key: tag, name: 'ผู้ส่งบิลทดสอบ', permissions: { create: permissions.map((permission: { id: string }) => ({ permissionId: permission.id })) } } });
    roleId = role.id;
    await f.client.companyMembership.create({ data: { companyId, userId: tag, roles: { create: { roleId } } } });
    await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { createdByUserId: tag } });
    await f.client.attachmentObject.update({ where: { id: f.attachment.id }, data: { uploadedByUserId: tag } });
    await f.client.attachmentLink.updateMany({ where: { attachmentId: f.attachment.id }, data: { linkedByUserId: tag } });
    const login = await context.request.post(`${urls.web}/api/auth/login`, { data: { username: tag, password, remember: false } });
    expect(login.ok(), await login.text()).toBe(true);
    await ensureBrowserLegalAcceptance(context, companyId);
    const page = await context.newPage();
    await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
    const source = page.getByRole('region', { name: 'ข้อมูลบิลที่ยังไม่ครบ', exact: true });
    await expect(source).toBeVisible();
    await page.getByRole('button', { name: /receipt-continuity-.*ดูไฟล์/ }).click();
    const receiptImage = page.getByRole('img', { name: f.attachment.originalFileName, exact: true });
    await expect(receiptImage).toBeVisible();
    expect(await receiptImage.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.getByText(/ยังไม่ทราบวันที่ในบิล$/)).toBeVisible();
    await expect(page.getByText('ยอดเงิน', { exact: true })).toHaveCount(0);
    await expect(page.getByText('ตรวจสอบเอกสารและหลักฐานภาษี', { exact: true })).toHaveCount(0);
    if (emptyOcr) {
      await source.getByRole('button', { name: 'เพิ่มรายการ', exact: true }).click();
      await source.getByLabel('รายการที่ 1 รายละเอียด', { exact: true }).fill('รายการที่กรอกเอง');
    }
    await source.getByLabel('ชื่อผู้ขาย', { exact: true }).fill('กรอกได้ด้วยสิทธิ์ส่งบิล');
    await source.getByRole('button', { name: 'เก็บร่างไว้ก่อน', exact: true }).click();
    await expect(source.getByRole('status')).toHaveText('เก็บร่างแล้ว ยังไม่ยืนยันรายการ');
    const record = await f.client.expenseRecord.findUniqueOrThrow({ where: { id: f.expense.id } });
    expect(record.vendorNameSnapshot).toBe('กรอกได้ด้วยสิทธิ์ส่งบิล');
    expect(['DRAFT', 'NEEDS_REVIEW']).toContain(record.status);
    if (emptyOcr) {
      await page.reload();
      await expect(source.getByLabel('รายการที่ 1 รายละเอียด', { exact: true })).toHaveValue('รายการที่กรอกเอง');
      await expect(source.getByLabel('รายการที่ 1 จำนวน', { exact: true })).toHaveValue('');
    }
    await expect(page.getByRole('button', { name: /ยืนยันเอกสาร|ยืนยันและลงบัญชี|อนุมัติ/, exact: false })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('upload-only-source-draft.png'), fullPage: true });
  } finally {
    await context.close();
    await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { createdByUserId: 'seed-local-owner', updatedByUserId: null } });
    await f.client.user.deleteMany({ where: { id: tag } });
    if (roleId) await f.client.role.delete({ where: { id: roleId } });
    await f.cleanup();
  }
});
}
