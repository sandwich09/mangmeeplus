import { test, expect } from '../harness/fixtures';
import { json, unique } from '../harness/e2e-utils';
import { AFTER_PRESS, FIRST_SIGHT, picture, recordExpenseByHand } from './journey-kit';

test('@journey finance attaches payment instructions while preparing a voucher, removes one and opens the saved file from the document', async ({ pageAs, apiAs, companyId }) => {
  test.setTimeout(240_000);
  const page = await pageAs('FINANCE'), api = await apiAs('FINANCE');
  const main = page.locator('main'), seller = unique('ร้านเอกสารประกอบ');
  await page.goto(`/companies/${companyId}/dashboard`, FIRST_SIGHT);
  await recordExpenseByHand(page, { branch: 'Head Office (สำนักงานใหญ่)', item: unique('ค่าของ'), seller, price: '100', total: '100.00 บาท', toPay: '100.00 บาท' });
  await page.goto(`/companies/${companyId}/expenses/disbursement-vouchers/new`, FIRST_SIGHT);
  await main.getByRole('searchbox', { name: 'ค้นชื่อผู้รับเงินหรือเลขผู้เสียภาษี', exact: true }).fill(seller);
  await main.getByRole('button', { name: new RegExp(`^${seller}`) }).click();
  await main.getByRole('button', { name: 'ถัดไป', exact: true }).click();
  const supporting = main.getByTestId('disbursement-supporting-files');
  // A new voucher shows the file buttons at once: choosing files saves the draft first.
  await expect(supporting.getByRole('button', { name: 'บันทึกร่างเพื่อแนบไฟล์', exact: true })).toHaveCount(0);
  await expect(supporting.getByRole('button', { name: 'เลือกไฟล์', exact: true })).toBeVisible(FIRST_SIGHT);
  await supporting.getByLabel('เลือกไฟล์ประกอบการจ่าย', { exact: true }).setInputFiles([picture('บัญชีผู้รับ.png'), picture('ใบแจ้งหนี้.png')]);
  await expect(page).toHaveURL(/[?&]draft=/, AFTER_PRESS);
  const id = new URL(page.url()).searchParams.get('draft')!;
  expect(id).toBeTruthy();
  await expect(supporting.getByRole('button', { name: 'ดูไฟล์', exact: true })).toHaveCount(2);
  await supporting.getByRole('button', { name: 'เอาออก', exact: true }).last().click();
  await expect(supporting.getByRole('button', { name: 'ดูไฟล์', exact: true })).toHaveCount(1, AFTER_PRESS);
  await main.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect(main.getByText('หลักฐานว่าบันทึกจ่ายแล้ว', { exact: true })).toHaveCount(0);
  await expect(supporting.getByText('ไฟล์ประกอบ 1 ไฟล์', { exact: true })).toBeVisible(AFTER_PRESS);
  await expect(supporting.getByRole('button', { name: 'เอาออก', exact: true })).toHaveCount(0);
  await supporting.getByRole('button', { name: 'ดูไฟล์', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'บัญชีผู้รับ.png', exact: true })).toBeVisible(AFTER_PRESS);
  await page.getByRole('dialog', { name: 'บัญชีผู้รับ.png', exact: true }).getByRole('button', { name: 'ปิด', exact: true }).click();
  const read = await json<{ supportingFiles: { name: string; mimeType: string; byteSize: number }[] }>(await api.get(`companies/${companyId}/disbursement-vouchers/${id}`));
  expect(read.supportingFiles).toHaveLength(1); expect(read.supportingFiles[0]!.name).toBe('บัญชีผู้รับ.png');
  expect(read.supportingFiles[0]!.mimeType).toMatch(/^image\//); expect(read.supportingFiles[0]!.byteSize).toBeGreaterThan(0);
});
