import { test, expect } from './harness/fixtures';
import { gotoCompany, unique } from './harness/e2e-utils';

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
    await authedPage.getByRole('link', { name: '+ สร้างคำขอเบิก' }).click();
    const form = authedPage.locator('form').filter({ hasText: 'ข้อมูลคำขอ' });
    await form.getByRole('textbox').first().fill(reason);
    // The row below is saved without a receipt, and a receipt-less row needs the claim-level
    // reason (the server refuses the submit without it: `missing_receipt_reason_required`).
    await form.getByLabel('เหตุผลที่ไม่มีใบเสร็จ').fill('E2E: receipt is attached later in this test');
    // One claim row: วันที่ / รายการ / จำนวนเงิน.
    await form.getByLabel('วันที่', { exact: true }).click();
    await authedPage.getByRole('button', { name: 'วันนี้', exact: true }).click();
    await form.getByLabel('รายการ', { exact: true }).fill(lineDescription);
    await form.getByLabel('จำนวนเงิน', { exact: true }).fill('123.45');
    await form.getByRole('button', { name: 'บันทึกร่าง' }).click();

    // The saved draft opens on its journey page, which shows the line table; the receipt
    // hangs off the LINE, not the claim header.
    await expect(authedPage).toHaveURL(/\/reimbursements\/[^/?#]+$/);
    await expect(authedPage.getByText(reason).first()).toBeVisible();
    const lineRow = authedPage.getByRole('row').filter({ hasText: lineDescription });
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
