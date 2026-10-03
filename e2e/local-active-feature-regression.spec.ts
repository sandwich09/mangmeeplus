import { test, expect } from './harness/fixtures';
import { branchOptionName, chooseThemedOption, gotoCompany, json } from './harness/e2e-utils';

type Branch = { id: string; name: string; type: string; code: string };
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const width of [390, 1280]) {
  test(`active-feature dashboard worklist and mobile hierarchy at ${width}px`, async ({ authedPage: page, api, companyId }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const snapshot = await json<any>(await api.post(`companies/${companyId}/dashboard/snapshots/generate`, { data: { periodKind: 'today' } }));
    const metric = snapshot.widgets.flatMap((widget: any) => widget.metrics).find((item: any) => item.key === 'expense_pending_review');
    expect(metric).toBeTruthy();
    await gotoCompany(page, companyId, '/dashboard');
    await expect(page.getByRole('heading', { name: 'ถามน้องมั่งมี', exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: /ใบเสร็จรอตรวจ \(ทุกช่วงเวลา\)/ }).click();
    await expect(page).toHaveURL(/view=pending/);
    await expect(page.getByRole('button', { name: `ทั้งหมด ${metric.value}`, exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'อัปโหลดใบเสร็จ', exact: true })).toBeVisible();
    await expect(page.getByText('ใบเสร็จรอตรวจ · ทุกช่วงเวลา รวมฉบับร่าง', { exact: false })).toBeVisible();
    if (width === 390 && metric.value > 0) {
      const first = page.getByTestId('expenses-card').first();
      await expect(first).toBeVisible();
      expect((await first.boundingBox())!.y).toBeLessThan(1000);
    }
    await page.screenshot({ path: info.outputPath(`pending-${width}.png`), fullPage: true });
    await gotoCompany(page, companyId, '/expenses');
    if (width === 390) await page.getByText(/ดูสรุปยอด/).click();
    await expect(page.getByText('VAT ตามเอกสาร', { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText('เครดิตภาษีที่ขอคืนได้', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`list-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`evidence/export use the exact selected branch at ${width}px`, async ({ authedPage: page, api, companyId }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const { items } = await json<{ items: Branch[] }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
    for (const branch of items.slice(0, 2)) {
      const list = await json<any>(await api.get(`companies/${companyId}/expenses?branchId=${branch.id}&status=CONFIRMED&pageSize=200`));
      const evidence = await json<any>(await api.get(`companies/${companyId}/expenses/shared-evidence?branchId=${branch.id}&pageSize=200`));
      expect(evidence.total).toBe(list.total);
      expect(evidence.rows.map((row: any) => row.expenseId).sort()).toEqual(list.data.map((row: any) => row.id).sort());
      const exported = await json<any>(await api.post(`companies/${companyId}/expenses/accountant-package`, { data: { branchId: branch.id } }));
      expect(exported.totalMatched).toBe(list.total);
      expect(exported.indexRows.every((row: any) => row.branch_code === branch.code)).toBe(true);
      await gotoCompany(page, companyId, '/expenses/evidence');
      await page.getByRole('button', { name: 'เลือกสาขา', exact: true }).click();
      await page.getByRole('button', { name: new RegExp(`^${escaped(branch.name)}`) }).click();
      await expect(page.getByRole('button', { name: 'เลือกสาขา', exact: true })).toContainText(branch.name);
      const branchLabel = page.getByRole('button', { name: 'เลือกสาขา', exact: true }).locator('span[title]');
      expect(await branchLabel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect(page.getByText('กำลังโหลด...').filter({ visible: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`evidence-${width}-${branch.code}.png`), fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });

  test(`employee role is explicit and branch follows the current scope at ${width}px (no save)`, async ({ authedPage: page, api, companyId }, info) => {
    await page.setViewportSize({ width, height: 844 });
    const { items } = await json<{ items: Branch[] }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
    const branch = items.find((item) => item.type !== 'HEAD_OFFICE')!;
    await gotoCompany(page, companyId, '/dashboard');
    await page.getByRole('button', { name: 'เลือกสาขา', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(`^${escaped(branch.name)}`) }).click();
    await gotoCompany(page, companyId, '/settings/employees');
    await page.getByRole('textbox', { name: 'ชื่อ *', exact: true }).fill('ทดสอบ');
    await page.getByRole('textbox', { name: 'นามสกุล *', exact: true }).fill('ยังไม่บันทึก');
    await page.getByRole('textbox', { name: 'Username *', exact: true }).fill('regression.no.save');
    await page.getByRole('textbox', { name: 'วันเดือนปีเกิด (ค.ศ.) *', exact: true }).fill('01/01/1980');
    await page.getByRole('textbox', { name: 'เลขบัตรประชาชน *', exact: true }).fill('0000000000000');
    await page.getByRole('button', { name: 'ถัดไป ›', exact: true }).click();
    await page.getByRole('textbox', { name: 'อีเมล (ใช้เข้าสู่ระบบ) *', exact: true }).fill('regression@example.test');
    await page.getByRole('textbox', { name: 'เบอร์โทรศัพท์ *', exact: true }).fill('0800000000');
    await page.getByRole('button', { name: 'ถัดไป ›', exact: true }).click();
    // A person holds one role, so the buttons show the bare role name ("✓ " only once chosen) and none is chosen yet.
    await expect(page.getByRole('button', { name: 'ฝ่ายบัญชี', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#employee-default-branch')).toHaveText(branch.name);
    const emailSummary = page.getByText('regression@example.test', { exact: true });
    await expect(emailSummary).toBeVisible();
    expect((await emailSummary.boundingBox())!.height).toBeLessThan(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('heading', { name: 'เพิ่มพนักงาน', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`employee-choice-${width}.png`), fullPage: true });
  });
}

test('mobile save refusal focuses a readable error and keeps typed data (controlled failure)', async ({ authedPage: page, api, companyId }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { items } = await json<{ items: Branch[] }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  await gotoCompany(page, companyId, '/expenses/manual');
  // Source branch is a ThemedSelect now, not a native <select> — open, then click the option.
  await chooseThemedOption(page, page.getByRole('combobox', { name: 'สาขาของรายการ', exact: true }), branchOptionName(items[0]!));
  const description = page.getByRole('textbox', { name: 'รายละเอียดค่าใช้จ่าย', exact: true });
  await description.fill('ทดสอบรักษาข้อมูลเมื่อบันทึกไม่สำเร็จ');
  await page.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill('1');
  await page.route(`**/companies/${companyId}/expenses`, (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'TRANSACTION_BRANCH_INVALID', message: 'Branch no longer active' }) })
    : route.continue());
  await page.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }).click();
  const error = page.getByRole('main').getByRole('alert').filter({ hasText: 'ไม่พบสาขาที่ใช้งานได้ในบริษัทนี้ กรุณาเลือกสาขาอีกครั้ง' });
  await expect(error).toBeFocused();
  const bounds = (await error.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await expect(description).toHaveValue('ทดสอบรักษาข้อมูลเมื่อบันทึกไม่สำเร็จ');
  await page.screenshot({ path: info.outputPath('mobile-save-error-focused.png') });
});

test('retained report notification never substitutes a different file', async ({ authedPage: page, companyId }, info) => {
  await gotoCompany(page, companyId, '/reports?exportId=regression-missing-export');
  await expect(page.getByText(/ไม่พบไฟล์จากการแจ้งเตือนนี้/)).toBeVisible();
  await page.screenshot({ path: info.outputPath('missing-report-file.png'), fullPage: true });
});

test('sales entry is reachable with the enabled sales permission', async ({ authedPage: page, companyId }, info) => {
  await gotoCompany(page, companyId, '/sales-documents');
  await expect(page.getByRole('link', { name: /บันทึกรายรับ/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('sales-entry.png'), fullPage: true });
});
