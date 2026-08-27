import { civilDate } from '@watchdog-bms/contracts';
import { test, expect } from './harness/fixtures';
import { gotoCompany, json, unique } from './harness/e2e-utils';

type Branch = { id: string; name: string; type: string };
const branchName = (branch: Branch) => branch.name + (branch.type === 'HEAD_OFFICE' ? ' (สำนักงานใหญ่)' : '');
const draft = () => ({
  captureSource: 'WEB_MANUAL', expenseDate: civilDate(new Date()), vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
  lines: [{ lineNumber: 1, description: unique('QA source branch'), quantity: '1', unitPrice: '1' }],
});

test('source branch API rejects ambiguous creation and clearing without changing a saved branch', async ({ api, companyId }) => {
  const branches = await json<{ items: Branch[] }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  expect(branches.items.length).toBeGreaterThan(1);
  const root = `companies/${companyId}/expenses`;
  const missing = await api.post(root, { data: draft() });
  expect(missing.status(), await missing.text()).toBe(422);
  const missingUpload = await api.post(`${root}/receipt-uploads`, { data: {
    originalFileName: 'source-branch.png', mimeType: 'image/png', byteSize: 100,
  } });
  expect(missingUpload.status()).toBe(422);
  const invalid = await api.post(root, { data: { ...draft(), branchId: 'not-a-company-branch' } });
  expect(invalid.status()).toBe(422);
  const created = await json<{ id: string; branchId: string; updatedAt: string }>(await api.post(root, {
    data: { ...draft(), branchId: branches.items[0]!.id },
  }));
  try {
    expect(created.branchId).toBe(branches.items[0]!.id);
    const cleared = await api.patch(`${root}/${created.id}`, { data: { branchId: null, expectedUpdatedAt: created.updatedAt } });
    expect(cleared.status()).toBe(422);
    expect((await json<{ branchId: string }>(await api.get(`${root}/${created.id}`))).branchId).toBe(created.branchId);
  } finally {
    expect((await api.delete(`${root}/${created.id}`)).ok()).toBeTruthy();
  }
});

for (const width of [390, 1280]) {
  test(`branch chooser blocks ambiguous entry and keeps the selected branch at ${width}px (no writes)`, async ({ authedPage: page, api, companyId }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { items } = await json<{ items: Branch[] }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
    const chosen = items.find((branch) => branch.type === 'HEAD_OFFICE')!;
    await gotoCompany(page, companyId, '/expenses/manual');
    const field = page.getByRole('combobox', { name: 'สาขาของรายการ', exact: true });
    const description = page.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true });
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue('');
    await expect(description).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`manual-${width}-needs-selection.png`), fullPage: true });
    await field.selectOption(chosen.id);
    await description.fill('ทดสอบเลือกสาขา — ยังไม่บันทึก');
    await field.selectOption('');
    await expect(description).toBeDisabled();
    await field.selectOption(chosen.id);
    await expect(description).toHaveValue('ทดสอบเลือกสาขา — ยังไม่บันทึก');
    await page.screenshot({ path: info.outputPath(`manual-${width}-selected.png`), fullPage: true });
    await gotoCompany(page, companyId, '/expenses/upload');
    await expect(page.getByRole('combobox', { name: 'สาขาของรายการ', exact: true })).toHaveValue(chosen.id);
    await expect(page.getByRole('textbox', { name: 'เช่น ค่ากาแฟทีมงาน', exact: true })).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`upload-${width}-inherited.png`), fullPage: true });
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test(`source branch manual entry uses the selected branch at ${width}px`, async ({ authedPage: page, api, companyId }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { items } = await json<{ items: Branch[] }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
    const chosen = items.find((branch) => branch.type === 'HEAD_OFFICE')!;
    await gotoCompany(page, companyId, '/expenses/manual');
    const field = page.getByRole('combobox', { name: 'สาขาของรายการ', exact: true });
    await expect(field).toBeEnabled();
    await expect(field).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true })).toBeDisabled();
    await field.selectOption(chosen.id);
    await page.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true }).fill(unique('QA branch UI'));
    await page.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill('1');
    await page.screenshot({ path: info.outputPath(`manual-${width}-selected.png`), fullPage: true });
    const response = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/companies/${companyId}/expenses`));
    await page.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }).click();
    const result = await response;
    expect(result.ok()).toBeTruthy();
    const created = await result.json();
    try {
      expect(created.branchId).toBe(chosen.id);
      await expect(page).toHaveURL(new RegExp(`/expenses/${created.id}`));
      await expect(page.getByRole('heading', { name: /กำลังโหลด/ })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'ไม่พบรายการ', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /รอระบุผู้ขาย/ })).toBeVisible();
      const saved = await json<{ id: string; branchId: string; grandTotalAmount: string }>(await api.get(`companies/${companyId}/expenses/${created.id}`));
      expect(saved.branchId).toBe(chosen.id);
      expect(Number(saved.grandTotalAmount)).toBe(1);
      await info.attach('saved-branch-readback', { body: JSON.stringify({ id: saved.id, branchId: saved.branchId, amount: saved.grandTotalAmount }), contentType: 'application/json' });
      await page.screenshot({ path: info.outputPath(`manual-${width}-saved.png`), fullPage: true });
      expect(errors).toEqual([]);
      await gotoCompany(page, companyId, '/expenses/upload');
      await expect(page.getByRole('combobox', { name: 'สาขาของรายการ', exact: true })).toHaveValue(chosen.id);
      await page.screenshot({ path: info.outputPath(`upload-${width}-inherited.png`), fullPage: true });
    } finally {
      expect((await api.delete(`companies/${companyId}/expenses/${created.id}`)).ok()).toBeTruthy();
    }
  });

  test(`receipt upload saves actual bytes under the chosen branch at ${width}px`, async ({ authedPage: page, api, request, companyId }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { items } = await json<{ items: Branch[] }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
    const chosen = items.find((branch) => branch.type !== 'HEAD_OFFICE')!;
    expect(chosen, 'the seeded multi-branch fixture is present').toBeTruthy();
    await gotoCompany(page, companyId, '/expenses/upload');
    const field = page.getByRole('combobox', { name: 'สาขาของรายการ', exact: true });
    await expect(field).toHaveValue('');
    const submit = page.getByRole('button', { name: 'ให้ AI อ่านใบเสร็จ', exact: true });
    await expect(submit).toBeDisabled();
    await field.selectOption(chosen.id);
    // Synthetic PNG proves transport/storage, not OCR accuracy; no external AI is mocked as success.
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await page.locator('input[type="file"]').first().setInputFiles({ name: `branch-proof-${width}.png`, mimeType: 'image/png', buffer: bytes });
    const intentResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/companies/${companyId}/expenses/receipt-uploads`));
    const completedResponse = page.waitForResponse((response) => response.request().method() === 'POST' && /\/receipt-uploads\/[^/]+\/complete$/.test(response.url()));
    await submit.click();
    const intentResult = await intentResponse;
    expect(intentResult.ok(), await intentResult.text()).toBeTruthy();
    const intent = await intentResult.json();
    try {
      const complete = await completedResponse;
      expect(complete.ok(), await complete.text()).toBeTruthy();
      await expect(page).toHaveURL(new RegExp(`/expenses/${intent.expenseId}`));
      await expect(page.getByRole('heading', { name: /กำลังโหลด/ })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'ไม่พบรายการ', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /รอระบุผู้ขาย/ })).toBeVisible();
      const saved = await json<{ id: string; branchId: string; primaryAttachmentId: string }>(await api.get(`companies/${companyId}/expenses/${intent.expenseId}`));
      expect(saved.branchId).toBe(chosen.id);
      expect(saved.primaryAttachmentId).toBe(intent.attachmentId);
      const link = await json<{ downloadUrl: string }>(await api.get(`companies/${companyId}/attachments/${intent.attachmentId}/download-url`));
      const downloaded = await request.get(link.downloadUrl);
      expect(downloaded.ok()).toBeTruthy();
      expect(await downloaded.body()).toEqual(bytes);
      await info.attach('uploaded-branch-readback', { body: JSON.stringify(saved), contentType: 'application/json' });
      await page.screenshot({ path: info.outputPath(`upload-${width}-saved.png`), fullPage: true });
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    } finally {
      expect((await api.delete(`companies/${companyId}/expenses/${intent.expenseId}`)).ok()).toBeTruthy();
    }
  });
}

test('a single available branch defaults in the entry form (controlled branch-list response)', async ({ authedPage: page, api, companyId }, info) => {
  const { items } = await json<{ items: Branch[] }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  const chosen = items.find((branch) => branch.type === 'HEAD_OFFICE')!;
  await page.route('**/companies/*/branches?**', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, items: [chosen], total: 1 } });
  });
  await gotoCompany(page, companyId, '/expenses/manual');
  await expect(page.getByRole('combobox', { name: 'สาขาของรายการ', exact: true })).toHaveValue(chosen.id);
  await expect(page.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true })).toBeEnabled();
  await expect(page.getByRole('option', { name: branchName(chosen), exact: true })).toHaveCount(1);
  await page.screenshot({ path: info.outputPath('single-available-branch-default.png'), fullPage: true });
});
