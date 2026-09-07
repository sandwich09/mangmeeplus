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
      const categoryMenu = source.getByRole('combobox').first();
      await categoryMenu.click();
      const categoryList = page.getByRole('listbox');
      await expect(categoryList).toBeVisible();
      await expect(categoryList).toHaveClass(/bg-white/);
      await expect(categoryList.getByRole('option', { selected: true })).toHaveClass(/text-brand-700/);
      const menuBounds = await categoryList.boundingBox();
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
      expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`receipt-partial-dropdown-${width}.png`) });
      await categoryList.getByRole('option', { selected: true }).click();
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

for (const width of [390, 1280]) {
  test(`readable LINE receipt has one review form and one saved purpose at ${width}px`, async ({ authedPage: page, api, companyId }, info) => {
    test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
    const f = await fixture(companyId, 'seed-local-owner', [
      { description: 'TOMATO SOUP', quantity: '0.63', unitPrice: '386.9048' },
      { description: 'SOUP', quantity: '1', unitPrice: '20' },
      { description: 'SELF SERVICE SAUCE', quantity: '1', unitPrice: '20' },
      { description: 'COKE', quantity: '1', unitPrice: '25' },
    ] as any);
    try {
      const category = await f.client.expenseCategory.findFirstOrThrow({ where: { companyId, status: 'ACTIVE' } });
      const setup = await api.patch(`companies/${companyId}/expenses/${f.expense.id}/review-fields`, { data: {
        expectedUpdatedAt: f.expense.updatedAt.toISOString(), expenseDate: '2026-09-07',
        vendorNameSnapshot: 'PANDA MALA (บริษัท รวยเจริญดี จำกัด)', vendorDocumentNumber: '00912/1',
        vatMode: 'VAT_INCLUDED', lines: [
          { lineNumber: 1, description: 'TOMATO SOUP', quantity: '0.63', unitPrice: '386.9048', discountAmount: '8.75', vatRate: '0.07', expenseCategoryId: category.id },
          ...['SOUP', 'SELF SERVICE SAUCE', 'COKE'].map((description, index) => ({ lineNumber: index + 2, description, quantity: '1', unitPrice: index === 2 ? '25' : '20', vatRate: '0.07', expenseCategoryId: category.id })),
        ],
      } });
      expect(setup.ok(), await setup.text()).toBe(true);
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
      const saveDraft = page.getByRole('button', { name: 'บันทึกแบบร่าง', exact: true });
      await expect(page.getByLabel('ชื่อผู้ขาย', { exact: true })).toBeVisible();
      await expect(saveDraft).toHaveCount(0); // NEEDS_REVIEW still saves via ถัดไป.
      // This synthetic row now exercises the exact DRAFT-only action without a production mutation.
      await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'DRAFT' } });
      await page.reload();
      await expect(saveDraft).toBeVisible();
      await expect(page.getByRole('region', { name: 'ข้อมูลบิลที่ยังไม่ครบ', exact: true })).toHaveCount(0);
      const vendor = page.getByLabel('ชื่อผู้ขาย', { exact: true });
      await expect(vendor).toHaveCount(1);
      await expect(vendor).toHaveValue('PANDA MALA (บริษัท รวยเจริญดี จำกัด)');
      await expect(page.getByLabel('รายละเอียด', { exact: true })).toHaveCount(4);
      await expect(page.getByText(/I01|I02|expense\.meals|D-PURPOSE/)).toHaveCount(0);
      const purpose = page.getByLabel('ซื้อไปใช้ทำอะไร', { exact: true });
      await purpose.fill('เลี้ยงอาหารลูกค้าที่มาคุยงาน');
      if (width === 390) {
        // Provider failures are injected before the real API write; entered values must survive.
        const path = `**/companies/${companyId}/expenses/${f.expense.id}/review-fields`;
        for (const failure of [
          { status: 400, code: 'EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED', copy: /โหลดรายการใหม่ก่อนบันทึก/ },
          { status: 403, code: 'private_permission_diagnostic', copy: /สิทธิ์/ },
          { status: 409, code: 'EXPENSE_UPDATE_CONFLICT', copy: /รายการถูกแก้ไข/ },
          { status: 500, code: 'private_database_diagnostic', copy: /ระบบขัดข้องชั่วคราว/ },
          { status: 0, code: '', copy: /ตรวจสอบอินเทอร์เน็ต/ },
        ]) {
          await page.route(path, (route) => failure.status === 0 ? route.abort('failed') : route.fulfill({
            status: failure.status, contentType: 'application/json',
            body: JSON.stringify({ statusCode: failure.status, code: failure.code, message: 'private_internal_diagnostic' }),
          }));
          await saveDraft.click();
          const toast = page.locator('.toast-enter[role="alert"]');
          await expect(toast).toHaveCount(1);
          await expect(toast).toContainText(failure.copy);
          await expect(page.getByText(/private_internal_diagnostic|EXPENSE_UPDATE_CONFLICT|EXPENSE_SOURCE_DRAFT_RELOAD_REQUIRED/)).toHaveCount(0);
          await expect(purpose).toHaveValue('เลี้ยงอาหารลูกค้าที่มาคุยงาน');
          await toast.getByRole('button', { name: 'ปิดการแจ้งเตือน' }).click();
          await page.unroute(path);
        }
      }
      await saveDraft.click();
      const savedToast = page.locator('.toast-enter[role="status"]');
      await expect(savedToast).toContainText('บันทึกแบบร่างแล้ว กลับมาแก้ไขต่อได้');
      await savedToast.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
      await page.screenshot({ path: info.outputPath(`receipt-saved-toast-${width}.png`) });
      await savedToast.getByRole('button', { name: 'ปิดการแจ้งเตือน' }).click();
      await expect(page.getByText(/บันทึกข้อมูลและคำนวณยอดใหม่แล้ว/)).toBeVisible();
      const saved = await (await api.get(`companies/${companyId}/expenses/${f.expense.id}`)).json();
      expect(saved.sourceDraft.header.businessPurpose).toBe('เลี้ยงอาหารลูกค้าที่มาคุยงาน');
      expect(saved.sourceDraft.missingFields).toEqual([]);
      expect(saved.lines).toHaveLength(4);
      expect(saved.primaryAttachmentId).toBe(f.attachment.id);
      expect(Number(saved.grandTotalAmount)).toBe(300);
      await page.reload();
      await expect(purpose).toHaveValue('เลี้ยงอาหารลูกค้าที่มาคุยงาน');
      await expect(vendor).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoClientError(page);
      const heading = page.getByRole('heading', { name: 'ข้อมูลผู้ขายและรายการ', exact: true });
      await heading.evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().top - 200));
      await page.waitForTimeout(200);
      await page.screenshot({ path: info.outputPath(`receipt-one-form-${width}.png`) });
      await purpose.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`receipt-purpose-${width}.png`) });
      const categoryMenu = page.getByRole('combobox', { name: /^รายการที่ 1 / }).first();
      await categoryMenu.click();
      const categoryList = page.getByRole('listbox');
      await expect(categoryList).toBeVisible();
      await expect(categoryList.getByRole('option', { selected: true })).toHaveClass(/text-brand-700/);
      const menuBounds = await categoryList.boundingBox();
      expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
      expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`receipt-review-dropdown-${width}.png`) });
      await categoryList.getByRole('option', { name: category.name, exact: true }).click();
      await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      await expect(page.getByText('ขั้นที่ 2:', { exact: true })).toBeVisible();
      await expect(saveDraft).toHaveCount(0);
      await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
      await expect(saveDraft).toBeVisible();
      await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'READY_FOR_CONFIRMATION' } });
      await page.reload();
      await expect(page.getByLabel('ชื่อผู้ขาย', { exact: true })).toBeVisible();
      await expect(saveDraft).toHaveCount(0);
      if (width === 390) {
        await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'DRAFT' } });
        await page.reload();
        await expect(saveDraft).toBeVisible();
        const readPath = `**/api/v1/companies/${companyId}/expenses/${f.expense.id}`;
        await page.route(readPath, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"private_readback_diagnostic"}' }));
        await saveDraft.click();
        await expect(page.locator('.toast-enter[role="status"]')).toContainText('บันทึกข้อมูลแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ');
        await expect(page.getByText('private_readback_diagnostic')).toHaveCount(0);
        await page.unroute(readPath);
        await page.reload();
        await expect(purpose).toHaveValue('เลี้ยงอาหารลูกค้าที่มาคุยงาน');
      }
    } finally { await f.cleanup(); }
  });
}
