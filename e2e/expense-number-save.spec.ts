import { test, expect } from './harness/fixtures';

test.beforeEach(() => {
  test.skip(process.env['EXPENSE_NUMBER_LIVE'] !== '1', 'Requires isolated local DB with draft numbering enabled');
  expect(['localhost', '127.0.0.1']).toContain(new URL(process.env['E2E_API_BASE_URL'] ?? 'http://invalid').hostname);
});

test('numbered manual draft recovers a lost response with the same command', async ({ authedPage: page, api, companyId }) => {
  const commands: any[] = [];
  let saved: any;
  await page.route(`**/api/v1/companies/${companyId}/expenses`, async route => {
    if (route.request().method() !== 'POST') return route.continue();
    commands.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json();
    if (commands.length === 1) { saved = body; return route.abort('failed'); }
    expect(body.id).toBe(saved.id);
    await route.fulfill({ response });
  });
  await page.goto(`/companies/${companyId}/expenses/manual`);
  await page.locator('[data-transaction-branch-select]').getByRole('combobox').click();
  await page.getByRole('option', { name: /Head Office|สำนักงานใหญ่/ }).first().click();
  const description = page.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true });
  await description.fill('Local lost-response original');
  await page.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill('100');
  await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ยังยืนยันผลการบันทึกไม่ได้' })).toBeVisible();
  expect(saved.expenseNumber).toMatch(/^EXP-\d{6}-\d+$/);
  // Clearing a required field must not prevent recovery of the already committed command.
  await description.fill('');
  await page.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/expenses/${saved.id}`));
  expect(commands).toHaveLength(2);
  expect(commands[1]).toEqual(commands[0]);
  const detail = await (await api.get(`companies/${companyId}/expenses/${saved.id}`)).json();
  expect(detail.expenseNumber).toBe(saved.expenseNumber);
  expect(detail.lines[0].description).toBe('Local lost-response original');
  await expect(page.getByText(saved.expenseNumber, { exact: true }).first()).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`expense-number-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  await page.screenshot({ path: test.info().outputPath('expense-number-large-text.png'), fullPage: true });
});

test('upload staging receives EXP only after deliberate date review and keeps it when OCR date is corrected', async ({ api, companyId }) => {
  const read = async (response: any) => { expect(response.ok(), await response.text()).toBe(true); return response.json(); };
  const branches = await read(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  const base = `companies/${companyId}/expenses`;
  const draft = await read(await api.post(base, { data: { idempotencyKey: `staging-${Date.now()}`, branchId: (branches.items ?? branches.data ?? branches)[0].id,
    captureSource: 'WEB_UPLOAD', expenseDate: '2026-09-11', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
    lines: [{ lineNumber: 1, description: 'OCR review local test', quantity: '1', unitPrice: '90', vatRate: '0' }] } }));
  expect(draft.expenseNumber).toBeNull();
  // An OCR-style vendor-only update is still staging. No actual external OCR service is invoked.
  const staged = await read(await api.patch(`${base}/${draft.id}/review-fields`, { data: { expectedUpdatedAt: draft.updatedAt, vendorNameSnapshot: 'Local OCR shop' } }));
  expect(staged.expenseNumber).toBeNull();
  const reviewed = await read(await api.patch(`${base}/${draft.id}/review-fields`, { data: { expectedUpdatedAt: staged.updatedAt, expenseDate: '2026-08-31' } }));
  expect(reviewed.expenseNumber).toMatch(/^EXP-202608-/);
  const corrected = await read(await api.patch(`${base}/${draft.id}/review-fields`, { data: { expectedUpdatedAt: reviewed.updatedAt, expenseDate: '2026-07-31' } }));
  expect(corrected.expenseNumber).toBe(reviewed.expenseNumber);
  expect(corrected.expenseDate).toContain('2026-07-31');
});
