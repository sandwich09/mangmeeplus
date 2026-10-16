import { test, expect } from './harness/fixtures';
import { chooseThemedOption, gotoCompany, unique } from './harness/e2e-utils';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test.describe('REIMBRCPT — reimbursement receipt attachment', () => {
  test('REIMBRCPT-01 @p2 creates a draft, attaches, changes, and removes its receipt', async ({ authedPage, companyId }) => {
    test.skip(
      process.env['S3_E2E'] !== '1' && process.env['S3_E2E_ACTIVE'] !== '1',
      'REIMBRCPT-01 requires compose MinIO on localhost:19000; start it and run with S3_E2E=1.',
    );

    const reason = unique('REIMBRCPT draft');
    const lineDescription = unique('REIMBRCPT line');
    await gotoCompany(authedPage, companyId, '/reimbursements');
    // Creating a claim is its own route now, so this is a link, not an in-page toggle button.
    await authedPage.getByRole('link', { name: '+ สร้างใบเบิก' }).click();
    const form = authedPage.locator('form').filter({ hasText: 'รายการที่ขอเบิก' });
    await form.getByLabel('เหตุผล', { exact: true }).fill(reason);
    // One claim row: รายการ / จำนวนเงิน / วันที่ / หมวด. The date starts on today; an unknown description leaves the category empty.
    await form.getByLabel('รายการ', { exact: true }).fill(lineDescription);
    await expect(form.getByRole('combobox', { name: 'หมวด', exact: true })).toHaveText('เลือกหมวด');
    await expect(form.getByText('เลือกให้จากรายละเอียด เปลี่ยนได้', { exact: true })).toHaveCount(0);
    await form.getByLabel('จำนวนเงิน', { exact: true }).fill('123.45');
    await form.getByLabel('วันที่', { exact: true }).click();
    await authedPage.getByRole('button', { name: 'วันนี้', exact: true }).click();
    await chooseThemedOption(authedPage, form.getByRole('combobox', { name: 'หมวด', exact: true }), 'อื่น ๆ');
    // The row is saved without a receipt, and a receipt-less row needs the claim-level reason (the server refuses
    // the submit without it: `missing_receipt_reason_required`). The form asks for it once a typed row has no receipt.
    await form.getByLabel('เหตุผลที่ไม่มีใบเสร็จ').fill('E2E: receipt is attached later in this test');
    await form.getByRole('button', { name: 'บันทึกร่าง' }).click();

    // The saved draft opens on its journey page, which shows its lines; the receipt hangs off the LINE, not the
    // claim header. Beside the step card the lines are cards at every screen width the suite runs (the table needs 44rem
    // of its own card).
    await expect(authedPage).toHaveURL(/\/reimbursements\/[^/?#]+$/);
    await expect(authedPage.getByText(reason).first()).toBeVisible();
    const lineRow = authedPage.getByTestId('reimbursement-line-card').filter({ hasText: lineDescription });
    await expect(lineRow).toBeVisible();
    await expect(lineRow).not.toContainText('📎');

    const input = lineRow.locator('input[type="file"]');
    await input.setInputFiles({ name: 'receipt-first.png', mimeType: 'image/png', buffer: PNG });
    await expect(lineRow).toContainText('receipt-first.png');

    await input.setInputFiles({ name: 'receipt-replacement.png', mimeType: 'image/png', buffer: PNG });
    await expect(lineRow).toContainText('receipt-replacement.png');

    await lineRow.getByRole('button', { name: 'นำไฟล์ออก' }).click();
    await expect(lineRow).not.toContainText('📎');
  });
});
