import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './harness/fixtures';
import { ensureBrowserLegalAcceptance, expectNoClientError } from './harness/auth';
import { chooseThemedOption } from './harness/e2e-utils';
import { EXPENSE_WITHHOLDING_WORDS } from '@watchdog-bms/contracts';
import { workspaceDictionary } from '../apps/web/src/common/i18n/workspace-dictionary';
import { PAYEE_ENTITY_KIND_LABELS } from '../apps/web/src/features/expenses/expenses.model';

const apiRequire = createRequire(resolve('apps/api/package.json'));
const databaseUrl = process.env.RECEIPT_CONTINUITY_TEST_DATABASE_URL;

/**
 * The source-facts card's own draft save.
 *
 * Since commit `0283a3d0` the document-review panel renders a second button with the very same
 * name (`ExpensesPages.tsx`, the `isMutable && canReview` row), so a page-wide locator stopped
 * meaning "the source draft save" — which is what every assertion below is actually about.
 */
const sourceDraftSave = (page: Page) => page.locator('section')
  .filter({ has: page.getByRole('heading', { name: 'ข้อมูลผู้ขายและรายการ', exact: true }) })
  .getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true });

/** The toast that carries this text: a save can also announce a vendor added to the counterparty list, so there may be two toasts. */
const statusToast = (page: Page, text: string) => page.locator('.toast-enter[role="status"]').filter({ hasText: text });

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
      dateStatus: 'unverified', reviewReasons: ['วันที่บนเอกสารยังอ่านไม่ได้ – ใช้วันที่ส่งไว้ก่อน'],
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
  test(`incomplete receipt keeps the ordinary form and saves blank facts at ${width}px`, async ({ authedPage: page, api, companyId }, info) => {
    test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
    const f = await fixture(companyId);
    try {
      await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'DRAFT' } });
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
      await expect(page.getByRole('region', { name: 'ข้อมูลบิลที่ยังไม่ครบ', exact: true })).toHaveCount(0);
      await expect(page.getByText(/ข้อมูลที่ยังต้องเติม/)).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'ข้อมูลผู้ขายและรายการ', exact: true })).toBeVisible();
      await expect(page.getByText('ขั้นที่ 1:', { exact: true })).toBeVisible();
      await expect(page.getByLabel('รายละเอียด', { exact: true })).toHaveCount(2);
      const date = page.getByRole('combobox', { name: /^วันที่เอกสาร/ });
      // Unknown date is blank in the existing date field, never the upload-day fallback.
      await expect(date).toContainText('เลือกวันที่');
      const quantity = page.getByRole('spinbutton', { name: /^จำนวน/ }).first();
      const price = page.getByRole('spinbutton', { name: /^ราคาต่อหน่วย/ }).first();
      await expect(quantity).toHaveValue('');
      await expect(price).toHaveValue('');
      await page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ }).fill('ร้านทดสอบที่กรอกเอง');
      await quantity.fill('5');
      const savedResponse = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(f.expense.id));
      await sourceDraftSave(page).click();
      const saveResult = await savedResponse;
      expect(saveResult.ok(), await saveResult.text()).toBe(true);
      await expect(statusToast(page, 'บันทึกฉบับร่างแล้ว กลับมาแก้ไขต่อได้')).toBeVisible();
      const saved = await (await api.get(`companies/${companyId}/expenses/${f.expense.id}`)).json();
      expect(saved.sourceDraft.header.vendorName).toBe('ร้านทดสอบที่กรอกเอง');
      expect(saved.sourceDraft.header.expenseDate).toBeNull();
      expect(saved.sourceDraft.items).toHaveLength(2);
      expect(saved.sourceDraft.items[0].quantity).toBe('5');
      expect(saved.sourceDraft.items[0].unitPrice).toBeNull();
      expect(saved.sourceDraft.items[1].quantity).toBeNull();
      expect(saved.lines).toHaveLength(0);
      expect(saved.primaryAttachmentId).toBe(f.attachment.id);
      expect(saved.status).toBe('DRAFT');
      await page.reload();
      await expect(page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ })).toHaveValue('ร้านทดสอบที่กรอกเอง');
      await expect(quantity).toHaveValue('5');
      await expect(price).toHaveValue('');
      await expect(date).toContainText('เลือกวันที่');
      // `ExpenseReviewPage` rule: what disables ถัดไป is printed under it. The count the data
      // section reports arrives one commit after the edit and starts as "not reported yet", so the
      // button must follow the message and never grey out in silence (`expenseDataStepBlocker`).
      await expect(page.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'ถัดไป', exact: true })).toHaveAccessibleDescription(/\S/);
      const categoryMenu = page.getByRole('combobox', { name: /^รายการที่ 1 / }).first();
      await categoryMenu.click();
      const categoryList = page.getByRole('listbox');
      await expect(categoryList).toBeVisible();
      await expect(categoryList.getByRole('option', { selected: true })).toHaveClass(/text-brand-700/);
      const bounds = await categoryList.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath(`receipt-partial-dropdown-${width}.png`) });
      await categoryList.getByRole('option', { selected: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expectNoClientError(page);
      await page.screenshot({ path: info.outputPath(`partial-draft-${width}.png`), fullPage: true });
      // Every mandatory fact can be supplied through the visible original form. No hidden
      // source-field requirement may block Next once these visible controls are complete.
      const category = await f.client.expenseCategory.findFirstOrThrow({ where: { companyId, status: 'ACTIVE' } });
      await date.click();
      await page.getByRole('button', { name: 'วันนี้', exact: true }).click();
      // Purpose is optional: deliberately leave it blank through API persistence and all steps.
      await expect(page.getByRole('textbox', { name: /^ซื้อไปใช้ทำอะไร/ })).toHaveValue('');
      for (let item = 0; item < 2; item += 1) {
        await page.getByRole('spinbutton', { name: /^จำนวน/ }).nth(item).fill(item === 0 ? '5' : '2');
        await page.getByRole('spinbutton', { name: /^ราคาต่อหน่วย/ }).nth(item).fill(item === 0 ? '100' : '10');
        await page.getByRole('combobox', { name: new RegExp(`^รายการที่ ${item + 1} `) }).click();
        await page.getByRole('option', { name: category.name, exact: true }).click();
      }
      const next = page.getByRole('button', { name: 'ถัดไป', exact: true });
      await expect(next).toBeEnabled();
      await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
      const completeResponse = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(f.expense.id));
      await next.click();
      const completeResult = await completeResponse;
      expect(completeResult.ok(), await completeResult.text()).toBe(true);
      await expect(page.getByText('ขั้นที่ 2:', { exact: true })).toBeVisible();
      const completed = await (await api.get(`companies/${companyId}/expenses/${f.expense.id}`)).json();
      expect(completed.sourceDraft.missingFields).toEqual([]);
      expect(completed.sourceDraft.header.businessPurpose).toBeNull();
      expect(completed.aiVerificationSummaryJson.dateStatus).toBe('verified');
      expect(completed.aiVerificationSummaryJson.reviewReasons).not.toContain('วันที่บนเอกสารยังอ่านไม่ได้ – ใช้วันที่ส่งไว้ก่อน');
      expect(completed.lines).toHaveLength(2);
      expect(Number(completed.grandTotalAmount)).toBe(520);
      // Step 2 keeps its own gate (`expenseEvidenceStepBlocker`): a LINE upload arrives with the tax
      // evidence status unanswered, so the reviewer answers it and saves the review before leaving.
      // Like step 1, the refusal is readable — the button points at the hint beside that form.
      await expect(next).toBeDisabled();
      await expect(next).toHaveAccessibleDescription(/บันทึกการตรวจ/);
      await chooseThemedOption(page, page.getByRole('combobox', { name: 'สถานะหลักฐานภาษี', exact: true }), 'ใช้เป็นหลักฐานภาษีได้');
      await page.getByRole('button', { name: 'บันทึกการตรวจ', exact: true }).click();
      await expect(next).toBeEnabled();
      await next.click();
      await expect(page.getByText('ขั้นที่ 3:', { exact: true })).toBeVisible();
      await expect(page.getByText('ยังไม่ระบุวันที่เอกสาร', { exact: true })).toHaveCount(0);
      await expect(sourceDraftSave(page)).toHaveCount(0);
      const readyResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes(`${f.expense.id}/reviewer-mark-ready`));
      await page.getByRole('button', { name: 'ส่งให้คนอื่นตรวจ', exact: true }).click();
      const readyResult = await readyResponse;
      expect(readyResult.ok(), await readyResult.text()).toBe(true);
      const ready = await f.client.expenseRecord.findUniqueOrThrow({ where: { id: f.expense.id } });
      expect(ready.status).toBe('READY_FOR_CONFIRMATION');
      expect(ready.note ?? '').not.toContain('วัตถุประสงค์:');
    } finally { await f.cleanup(); }
  });
}

test('incomplete ordinary draft rejects stale save without replacing a newer vendor', async ({ authedPage: page, companyId }) => {
  test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
  const f = await fixture(companyId);
  try {
    await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'DRAFT' } });
    await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
    await page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ }).fill('ข้อมูลจากหน้าเก่า');
    await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { vendorNameSnapshot: 'ข้อมูลล่าสุดจากอีกหน้า' } });
    const failed = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().includes(f.expense.id));
    await sourceDraftSave(page).click();
    expect((await failed).status()).toBe(409);
    await expect(page.locator('.toast-enter[role="alert"]')).toContainText('รายการถูกแก้ไข');
    await expect(page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ })).toHaveValue('ข้อมูลจากหน้าเก่า');
    const record = await f.client.expenseRecord.findUniqueOrThrow({ where: { id: f.expense.id } });
    expect(record.vendorNameSnapshot).toBe('ข้อมูลล่าสุดจากอีกหน้า');
  } finally { await f.cleanup(); }
});

test('reviewer reopens legacy READY in the ordinary form without inventing financial rows', async ({ authedPage: page, companyId }) => {
  test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
  const f = await fixture(companyId);
  try {
    await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'READY_FOR_CONFIRMATION' } });
    await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
    await expect(page.getByRole('region', { name: 'ข้อมูลบิลที่ยังไม่ครบ', exact: true })).toHaveCount(0);
    const reopenButton = page.getByRole('button', { name: 'กลับไปเติมข้อมูลบิล', exact: true });
    await reopenButton.click();
    await expect(reopenButton).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ })).toBeEnabled();
    await page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ }).fill('เติมต่อโดยไม่เดายอด');
    await expect(sourceDraftSave(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }).click();
    await expect(statusToast(page, 'บันทึกฉบับร่างแล้ว')).toBeVisible();
    const saved = await f.client.expenseRecord.findUniqueOrThrow({ where: { id: f.expense.id }, include: { lines: true } });
    expect(saved.status).toBe('NEEDS_REVIEW');
    expect(saved.lines).toHaveLength(0);
    expect(saved.vendorNameSnapshot).toBe('เติมต่อโดยไม่เดายอด');
    expect(saved.primaryAttachmentId).toBe(f.attachment.id);
    await page.reload();
    await expect(page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ })).toHaveValue('เติมต่อโดยไม่เดายอด');
    await expect(page.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
  } finally { await f.cleanup(); }
});

// Reproduces the Drtb projection gap: source gross 55 differs from the stored tax-exclusive
// financial price 51.40. This is a synthetic reconciliation case, not a claim about its live VAT mode.
for (const width of [390, 1280]) {
  test(`Drtb-shaped coffee uses the PANDA form and retains money and category at ${width}px`, async ({ authedPage: page, api, companyId }, info) => {
    test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
    const f = await fixture(companyId, 'seed-local-owner', [{ description: 'AMERICANO - ICED', quantity: '1', unitPrice: '55' }] as any);
    try {
      const category = await f.client.expenseCategory.findFirstOrThrow({ where: { companyId, status: 'ACTIVE', accountHintKey: 'expense.meals' } });
      const setup = await api.patch(`companies/${companyId}/expenses/${f.expense.id}/review-fields`, { data: {
        expectedUpdatedAt: f.expense.updatedAt.toISOString(), vendorNameSnapshot: 'ร้านกาแฟทดสอบ Drtb', vendorDocumentNumber: '67',
        vatMode: 'VAT_EXCLUDED', vatSource: { inputType: 'AMOUNT', vatAmount: '3.60' },
        lines: [{ lineNumber: 1, description: 'AMERICANO - ICED', quantity: '1', unitPrice: '51.40', discountAmount: '0', vatRate: '0.07', expenseCategoryId: category.id }],
      } });
      expect(setup.ok(), await setup.text()).toBe(true);
      await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: {
        status: 'DRAFT', reviewedAt: null, sourceChannelMetadataJson: { channel: 'LINE', chatKeyHash: 'synthetic-drtb' },
        aiVerificationSummaryJson: { status: 'partial', missingFields: ['expenseDate'], recognizedFields: {
          grandTotalAmount: '55', vatAmount: '3.60', lines: [{ description: 'AMERICANO - ICED', quantity: '1', unitPrice: '55' }],
        } },
      } });
      const before = await (await api.get(`companies/${companyId}/expenses/${f.expense.id}`)).json();
      expect(before.sourceDraft.header.expenseDate).toBeNull();
      expect(before.sourceDraft.items[0].expenseCategoryId).toBeNull();
      expect(before.sourceDraft.missingFields.some((field: { field: string }) => field.field === 'review')).toBe(true);
      expect(Number(before.grandTotalAmount)).toBe(55);
      expect(Number(before.vatAmount)).toBe(3.6);
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
      await expect(page.getByRole('heading', { name: 'ข้อมูลผู้ขายและรายการ', exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'ข้อมูลบิลที่ยังไม่ครบ', exact: true })).toHaveCount(0);
      await expect(page.getByText(/ข้อมูลที่ยังต้องเติม/)).toHaveCount(0);
      await expect(page.getByText('ขั้นที่ 1:', { exact: true })).toBeVisible();
      await expect(page.getByLabel('รายละเอียด', { exact: true })).toHaveCount(1);
      await expect(page.getByLabel('รายละเอียด', { exact: true })).toHaveValue('AMERICANO - ICED');
      await expect(page.getByRole('spinbutton', { name: /^จำนวน/ })).toHaveValue('1');
      expect(Number(await page.getByRole('spinbutton', { name: /^ราคาต่อหน่วย/ }).inputValue())).toBe(51.4);
      const categoryMenu = page.getByRole('combobox', { name: /^รายการที่ 1 / }).first();
      await expect(categoryMenu).toContainText(category.name);
      const date = page.getByRole('combobox', { name: /^วันที่เอกสาร/ });
      await expect(date).toContainText('เลือกวันที่');
      await page.getByLabel('ซื้อไปใช้ทำอะไร', { exact: true }).fill('ทดสอบเก็บค่าเครื่องดื่มไว้ตรวจต่อ');
      // A financial header edit and an unknown source fact must persist together in one PATCH.
      await page.getByRole('textbox', { name: /^เลขที่เอกสาร/ }).fill('67-ทดสอบ');
      const saves: string[] = [];
      page.on('request', (request) => { if (request.method() === 'PATCH' && request.url().includes(f.expense.id)) saves.push(request.url()); });
      await sourceDraftSave(page).click();
      await expect(statusToast(page, 'บันทึกฉบับร่างแล้ว')).toBeVisible();
      expect(saves).toHaveLength(1);
      const saved = await (await api.get(`companies/${companyId}/expenses/${f.expense.id}`)).json();
      expect(saved.sourceDraft.header.expenseDate).toBeNull();
      expect(saved.vendorDocumentNumber).toBe('67-ทดสอบ');
      expect(saved.sourceDraft.header.businessPurpose).toBe('ทดสอบเก็บค่าเครื่องดื่มไว้ตรวจต่อ');
      expect(saved.lines.map((line: { id: string }) => line.id)).toEqual(before.lines.map((line: { id: string }) => line.id));
      expect(saved.lines[0].expenseCategoryId).toBe(category.id);
      expect(Number(saved.grandTotalAmount)).toBe(55);
      expect(Number(saved.vatAmount)).toBe(3.6);
      expect(saved.primaryAttachmentId).toBe(f.attachment.id);
      await page.reload();
      await expect(date).toContainText('เลือกวันที่');
      await expect(categoryMenu).toContainText(category.name);
      await expect(page.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
      await page.getByRole('heading', { name: 'ข้อมูลผู้ขายและรายการ', exact: true }).evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().top - 190));
      await page.screenshot({ path: info.outputPath(`drtb-stable-form-${width}.png`) });
      await categoryMenu.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath(`drtb-stable-line-${width}.png`) });
      // Once the synthetic receipt date is supplied, the same form progresses into the original tax step.
      await date.click();
      await page.getByRole('button', { name: 'วันนี้', exact: true }).click();
      await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      await expect(page.getByText('ขั้นที่ 2:', { exact: true })).toBeVisible();
      await expect(sourceDraftSave(page)).toHaveCount(0);
      await expectNoClientError(page);
    } finally { await f.cleanup(); }
  });
}

test('reviewer retains the accepted financial row while original OCR quantity stays evidence', async ({ authedPage: page, api, companyId }) => {
  test.skip(!databaseUrl, 'requires the explicitly selected isolated receipt continuity DB');
  const f = await fixture(companyId, 'seed-local-owner', [{ description: 'AMERICANO - ICED', amount: '55' }] as any);
  try {
    const category = await f.client.expenseCategory.findFirstOrThrow({ where: { companyId, status: 'ACTIVE', accountHintKey: 'expense.meals' } });
    const setup = await api.patch(`companies/${companyId}/expenses/${f.expense.id}/review-fields`, { data: {
      expectedUpdatedAt: f.expense.updatedAt.toISOString(), vendorNameSnapshot: 'ร้านกาแฟทดสอบ', vatMode: 'VAT_INCLUDED',
      lines: [{ lineNumber: 1, description: 'AMERICANO - ICED', quantity: '1', unitPrice: '55', discountAmount: '0', vatRate: '0.07', expenseCategoryId: category.id }],
    } });
    expect(setup.ok(), await setup.text()).toBe(true);
    await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: {
      status: 'DRAFT', reviewedAt: null, sourceChannelMetadataJson: { channel: 'LINE', chatKeyHash: 'synthetic-unknown-quantity' },
      aiVerificationSummaryJson: { status: 'partial', missingFields: ['expenseDate', 'quantity'], recognizedFields: {
        grandTotalAmount: '55', lines: [{ description: 'AMERICANO - ICED', amount: '55' }],
      } },
    } });
    await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
    const quantity = page.getByRole('spinbutton', { name: /^จำนวน/ });
    const price = page.getByRole('spinbutton', { name: /^ราคาต่อหน่วย/ });
    await expect(quantity).toHaveValue('1');
    await expect(price).toHaveValue('55');
    await page.getByLabel('ซื้อไปใช้ทำอะไร', { exact: true }).fill('ทดสอบยืนยันจำนวนที่อ่านไม่ได้');
    await sourceDraftSave(page).click();
    await expect(statusToast(page, 'บันทึกฉบับร่างแล้ว')).toBeVisible();
    await page.reload();
    await expect(quantity).toHaveValue('1');
    await expect(price).toHaveValue('55');
    const partial = await (await api.get(`companies/${companyId}/expenses/${f.expense.id}`)).json();
    expect(Number(partial.grandTotalAmount)).toBe(55);
    expect(partial.sourceDraft.items[0].quantity).toBe('1');
    expect(partial.aiVerificationSummaryJson.recognizedFields.lines[0].quantity).toBeUndefined();
    await quantity.fill('1');
    await price.fill('55');
    await page.getByRole('combobox', { name: /^วันที่เอกสาร/ }).click();
    await page.getByRole('button', { name: 'วันนี้', exact: true }).click();
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(page.getByText('ขั้นที่ 2:', { exact: true })).toBeVisible();
    const reviewed = await (await api.get(`companies/${companyId}/expenses/${f.expense.id}`)).json();
    expect(reviewed.sourceDraft.items[0].quantity).toBe('1');
    expect(reviewed.sourceDraft.missingFields).toEqual([]);
    expect(Number(reviewed.grandTotalAmount)).toBe(55);
    expect(reviewed.lines).toHaveLength(1);
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
    await source.getByRole('textbox', { name: /^ชื่อผู้ขาย/ }).fill('กรอกได้ด้วยสิทธิ์ส่งบิล');
    await source.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }).click();
    await expect(source.getByRole('status')).toHaveText('บันทึกฉบับร่างแล้ว ยังไม่ยืนยันรายการ');
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
    const words = workspaceDictionary.th;
    // A vendor of this run only: the counterparty list remembers a vendor's payee type, and the next run must start without one.
    const vendorName = 'PANDA MALA (บริษัท รวยเจริญดี จำกัด) ' + randomUUID().slice(0, 8);
    const whtCategoryCode = 'e2e-wht-' + randomUUID();
    const whtCategoryName = 'ค่าบริการทดสอบ';
    const whtPath = '**/api/v1/companies/' + companyId + '/expenses/wht-income-categories';
    await page.route(whtPath, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    try {
      const category = await f.client.expenseCategory.findFirstOrThrow({ where: { companyId, status: 'ACTIVE', accountHintKey: 'expense.meals' } });
      const setup = await api.patch(`companies/${companyId}/expenses/${f.expense.id}/review-fields`, { data: {
        expectedUpdatedAt: f.expense.updatedAt.toISOString(), expenseDate: '2026-09-07',
        vendorNameSnapshot: vendorName, vendorDocumentNumber: '00912/1',
        vatMode: 'VAT_INCLUDED', lines: [
          { lineNumber: 1, description: 'TOMATO SOUP', quantity: '0.63', unitPrice: '386.9048', discountAmount: '8.75', vatRate: '0.07', expenseCategoryId: category.id },
          ...['SOUP', 'SELF SERVICE SAUCE', 'COKE'].map((description, index) => ({ lineNumber: index + 2, description, quantity: '1', unitPrice: index === 2 ? '25' : '20', vatRate: '0.07', expenseCategoryId: category.id })),
        ],
      } });
      expect(setup.ok(), await setup.text()).toBe(true);
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`/companies/${companyId}/expenses/${f.expense.id}`);
      const saveDraft = sourceDraftSave(page);
      await expect(page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ })).toBeVisible();
      await expect(saveDraft).toHaveCount(0); // NEEDS_REVIEW still saves via ถัดไป.
      // This synthetic row now exercises the exact DRAFT-only action without a production mutation.
      await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'DRAFT' } });
      await page.reload();
      await expect(saveDraft).toBeVisible();
      await expect(page.getByRole('region', { name: 'ข้อมูลบิลที่ยังไม่ครบ', exact: true })).toHaveCount(0);
      const vendor = page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ });
      await expect(vendor).toHaveCount(1);
      await expect(vendor).toHaveValue(vendorName);
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
      const savedToast = statusToast(page, 'บันทึกฉบับร่างแล้ว กลับมาแก้ไขต่อได้');
      await expect(savedToast).toBeVisible();
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
      {
        const next = page.getByRole('button', { name: words['expenses.step_next'], exact: true });
        const block = page.getByTestId('expense-withholding');
        const choice = block.getByRole('combobox', { name: words['expenses.wht_choice'], exact: true });
        const payeeKind = block.getByRole('combobox', { name: words['expenses.payee_entity_kind'], exact: true });
        const incomeCategory = block.getByRole('combobox', { name: words['expenses.wht_income_category'], exact: true });
        // A text field with a decimal keypad: it may be empty while it is being typed in.
        const withholding = block.getByRole('textbox', { name: words['expenses.wht_value_percent'] });
        const flagged = block.locator('[aria-invalid="true"]');
        const wayOut = page.getByText(EXPENSE_WITHHOLDING_WORDS.wayOut(words['expenses.wht_no']), { exact: true });
        await expect(choice).toContainText(words['expenses.wht_no']);
        await expect(payeeKind).toHaveCount(0);
        await expect(incomeCategory).toHaveCount(0);
        await expect(withholding).toHaveCount(0);
        await choice.click();
        await page.getByRole('option', { name: words['expenses.wht_yes'], exact: true }).click();
        await expect(payeeKind).toBeVisible();
        await expect(incomeCategory).toBeVisible();
        // A freshly chosen หัก starts clean: an empty rate, nothing flagged, ถัดไป still open.
        await expect(withholding).toHaveAttribute('inputmode', 'decimal');
        await expect(withholding).toHaveValue('');
        await expect(flagged).toHaveCount(0);
        await expect(next).toBeEnabled();
        await expect(block.getByText(words['expenses.wht_categories_empty'], { exact: true })).toHaveCount(0);
        await payeeKind.click();
        await page.getByRole('option', { name: PAYEE_ENTITY_KIND_LABELS.INDIVIDUAL, exact: true }).click();
        await expect(block.getByText(words['expenses.wht_categories_empty'], { exact: true })).toBeVisible();
        // One Next press reveals both missing answers and focuses the first, with one way-out hint.
        await next.click();
        await expect(incomeCategory).toBeFocused();
        await expect(incomeCategory).toHaveAttribute('aria-invalid', 'true');
        await expect(flagged).toHaveCount(2);
        await expect(withholding).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByText(words['expenses.v_wht_category_required'], { exact: true })).toHaveCount(1);
        await expect(wayOut).toHaveCount(1);
        await expect(next).toBeDisabled();
        await block.screenshot({ path: info.outputPath('withholding-empty-catalog-' + width + '.png') });
        // Typing in the rate never changes the decision: a leading zero is tidied on leaving the field, and an emptied field keeps หัก.
        await withholding.fill('03');
        await withholding.blur();
        await expect(withholding).toHaveValue('3');
        await withholding.fill('');
        await expect(choice).toContainText(words['expenses.wht_yes']);
        await expect(incomeCategory).toBeVisible();
        // With an empty catalog the way out is the decision itself.
        await choice.click();
        await page.getByRole('option', { name: words['expenses.wht_no'], exact: true }).click();
        await expect(payeeKind).toHaveCount(0);
        await expect(incomeCategory).toHaveCount(0);
        await expect(next).toBeEnabled();
        // A synthetic ACTIVE row in the explicitly selected isolated DB; seeded catalog decisions stay untouched.
        await f.client.whtIncomeCategory.create({ data: {
          code: whtCategoryCode, nameTh: whtCategoryName, formType: 'PND53', defaultRate: '3', status: 'ACTIVE',
        } });
        await page.unroute(whtPath);
        await page.reload();
        await choice.click();
        await page.getByRole('option', { name: words['expenses.wht_yes'], exact: true }).click();
        // Income categories follow the payee type, so the type comes first; the category then fills its rate and nothing is flagged.
        await payeeKind.click();
        await page.getByRole('option', { name: PAYEE_ENTITY_KIND_LABELS.INDIVIDUAL, exact: true }).click();
        // The seeded catalog has kinds for a person; the synthetic one is for a juristic payee, so it is not offered here.
        await incomeCategory.click();
        await expect(page.getByRole('option').first()).toBeVisible();
        await expect(page.getByRole('option', { name: `${whtCategoryName} · หัก 3%`, exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await payeeKind.click();
        await page.getByRole('option', { name: PAYEE_ENTITY_KIND_LABELS.JURISTIC, exact: true }).click();
        await expect(block.getByText(words['expenses.wht_categories_empty'], { exact: true })).toHaveCount(0);
        await incomeCategory.click();
        await page.getByRole('option', { name: `${whtCategoryName} · หัก 3%`, exact: true }).click();
        await expect(withholding).toHaveValue('3');
        await expect(flagged).toHaveCount(0);
        await expect(next).toBeEnabled();
        // A blank rate keeps the selected decision/category; leaving it reveals one field error.
        await withholding.fill('');
        await expect(choice).toContainText(words['expenses.wht_yes']);
        await expect(incomeCategory).toContainText(whtCategoryName);
        await expect(withholding).not.toHaveAttribute('aria-invalid', 'true');
        await withholding.blur();
        await next.click();
        await expect(next).toBeDisabled();
        await expect(withholding).toHaveAttribute('aria-invalid', 'true');
        await expect(flagged).toHaveCount(1);
        await expect(page.getByText(words['expenses.v_wht_percent'], { exact: true })).toHaveCount(1);
        await expect(wayOut).toHaveCount(1);
        await withholding.fill('3');
        await expect(flagged).toHaveCount(0);
        await expect(wayOut).toHaveCount(0);
        await expect(next).toBeEnabled();
        const order = await block.evaluate((element) => {
          const fields = ['expense-payee-entity-kind-', 'expense-wht-category-', 'expense-wht-rate-'];
          return fields.map((id) => element.querySelector('[id^="' + id + '"]')!.getBoundingClientRect().top);
        });
        expect(order[0]).toBeLessThan(order[1]);
        expect(order[1]).toBeLessThan(order[2]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const whtBase = block.getByRole('spinbutton', { name: words['expenses.wht_base'] });
        await whtBase.fill('1000');
        await expect(next).toBeEnabled();
        await saveDraft.click();
        await expect(statusToast(page, words['expenses.review_draft_saved'])).toBeVisible();
        const taxes = await (await api.get('companies/' + companyId + '/expenses/' + f.expense.id)).json();
        expect(taxes.whtInputJson).toMatchObject({ inputType: 'RATE', value: '3', baseAmount: '1000' });
        expect(Number(taxes.whtAmount)).toBe(30);
        expect(Number(taxes.netPayableAmount)).toBe(270);
        expect(taxes.vatAmount).toBe(saved.vatAmount);
        await page.reload();
        await expect(whtBase).toHaveValue('1000');
        await expect(withholding).toHaveValue('3');
        await expect(choice).toContainText(words['expenses.wht_yes']);
        await block.screenshot({ path: info.outputPath('withholding-selected-' + width + '.png') });
        await whtBase.fill('100000');
        await expect(next).toBeDisabled();
        // The sentence is said once, beside the rate; the footer only points to it.
        await expect(withholding).toHaveAttribute('aria-invalid', 'true');
        await expect(page.getByText(words['expenses.v_wht_exceeds_base'], { exact: true })).toHaveCount(1);
        await expect(page.getByRole('status').filter({ hasText: words['expenses.v_wht_exceeds_base'] })).toHaveCount(0);
        await choice.click();
        await page.getByRole('option', { name: words['expenses.wht_no'], exact: true }).click();
        await expect(payeeKind).toHaveCount(0);
        await expect(incomeCategory).toHaveCount(0);
        await expect(withholding).toHaveCount(0);
        await expect(next).toBeEnabled();
        await saveDraft.click();
        await expect(statusToast(page, words['expenses.review_draft_saved'])).toBeVisible();
        const cleared = await (await api.get('companies/' + companyId + '/expenses/' + f.expense.id)).json();
        expect(cleared.whtInputJson).toMatchObject({ inputType: 'RATE', value: '0' });
        expect(cleared.whtInputJson.baseAmount).toBeUndefined();
        expect(Number(cleared.whtAmount)).toBe(0);
        expect(cleared.whtCategoryCode).toBe('');
        expect(Number(cleared.whtRate)).toBe(0);
        expect(cleared.vendorEntityKindSnapshot).toBe('JURISTIC');
        await choice.click();
        await page.getByRole('option', { name: words['expenses.wht_yes'], exact: true }).click();
        await expect(payeeKind).toContainText(PAYEE_ENTITY_KIND_LABELS.JURISTIC);
        await incomeCategory.click();
        await page.getByRole('option', { name: `${whtCategoryName} · หัก 3%`, exact: true }).click();
        await withholding.fill('0');
        await expect(choice).toContainText(words['expenses.wht_yes']);
        await expect(incomeCategory).toContainText(whtCategoryName);
        await withholding.press('End');
        await withholding.pressSequentially('.5');
        await expect(withholding).toHaveValue('0.5');
        await expect(next).toBeEnabled();
        await block.getByRole('combobox', { name: words['expenses.wht_input_unit'], exact: true }).click();
        await page.getByRole('option', { name: words['expenses.wht_unit_baht'], exact: true }).click();
        const amount = block.getByRole('textbox', { name: words['expenses.wht_value_baht'] });
        await expect(amount).toHaveAttribute('inputmode', 'decimal');
        await amount.fill('30');
        // An emptied amount is only a field being typed in: the decision stays หัก until the reviewer changes it.
        await amount.fill('');
        await expect(choice).toContainText(words['expenses.wht_yes']);
        await expect(incomeCategory).toContainText(whtCategoryName);
        await expect(amount).not.toHaveAttribute('aria-invalid', 'true');
        await amount.blur();
        await expect(next).toBeDisabled();
        await expect(amount).toHaveAttribute('aria-invalid', 'true');
        await expect(flagged).toHaveCount(1);
        await expect(page.getByText(words['expenses.v_wht_amount'], { exact: true })).toHaveCount(1);
        await expect(wayOut).toHaveCount(1);
        await choice.click();
        await page.getByRole('option', { name: words['expenses.wht_no'], exact: true }).click();
        await expect(incomeCategory).toHaveCount(0);
        await expect(amount).toHaveCount(0);
        await expect(wayOut).toHaveCount(0);
        await expect(next).toBeEnabled();
      }
      await page.getByRole('button', { name: words['expenses.step_next'], exact: true }).click();
      await expect(page.getByText('ขั้นที่ 2:', { exact: true })).toBeVisible();
      await expect(saveDraft).toHaveCount(0);
      const advanced = await (await api.get(`companies/${companyId}/expenses/${f.expense.id}`)).json();
      expect(advanced.whtInputJson).toMatchObject({ inputType: 'RATE', value: '0' });
      expect(advanced.whtInputJson.baseAmount).toBeUndefined();
      expect(Number(advanced.whtAmount)).toBe(0);
      expect(advanced.whtCategoryCode).toBe('');
      expect(Number(advanced.whtRate)).toBe(0);
      expect(advanced.vendorEntityKindSnapshot).toBe('JURISTIC');
      // ย้อนกลับ is one of the secondary actions behind เพิ่มเติม in the footer.
      await page.locator('summary').filter({ hasText: 'เพิ่มเติม' }).click();
      await page.getByRole('button', { name: words['expenses.step_back'], exact: true }).click();
      await expect(saveDraft).toBeVisible();
      await expect(page.getByTestId('expense-withholding').getByRole('combobox', { name: words['expenses.wht_choice'], exact: true })).toContainText(words['expenses.wht_no']);
      await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'READY_FOR_CONFIRMATION' } });
      await page.reload();
      await expect(page.getByRole('textbox', { name: /^ชื่อผู้ขาย/ })).toBeVisible();
      await expect(saveDraft).toHaveCount(0);
      if (width === 390) {
        await f.client.expenseRecord.update({ where: { id: f.expense.id }, data: { status: 'DRAFT' } });
        await page.reload();
        await expect(saveDraft).toBeVisible();
        const readPath = `**/api/v1/companies/${companyId}/expenses/${f.expense.id}`;
        await page.route(readPath, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"private_readback_diagnostic"}' }));
        await saveDraft.click();
        await expect(statusToast(page, 'บันทึกข้อมูลแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ')).toBeVisible();
        await expect(page.getByText('private_readback_diagnostic')).toHaveCount(0);
        await page.unroute(readPath);
        await page.reload();
        await expect(purpose).toHaveValue('เลี้ยงอาหารลูกค้าที่มาคุยงาน');
      }
    } finally {
      // The page is already closed after a timeout; the synthetic rows must still be removed.
      await page.unroute(whtPath).catch(() => {});
      await f.client.whtIncomeCategory.deleteMany({ where: { code: whtCategoryCode } });
      await f.client.accountingCounterparty.deleteMany({ where: { companyId, displayName: vendorName } }).catch(() => {});
      await f.cleanup();
    }
  });
}
