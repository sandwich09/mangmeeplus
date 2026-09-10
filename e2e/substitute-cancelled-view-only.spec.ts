import { test, expect } from './harness/fixtures';

for (const signatureMode of ['DIGITAL', 'PAPER']) {
  test(`cancelled ${signatureMode} receipt stays view-only, including after focus refresh`, async ({ authedPage: page, companyId }) => {
    let evidence = {
      id: 'cancelled-view-only', expenseId: 'view-only-expense', companyId,
      documentNumber: 'SRC-202609-00001', version: 1, status: 'PREPARED', signatureMode,
      payerUserId: signatureMode === 'PAPER' ? null : 'seed-local-owner', payerName: 'Local Owner',
      fundingSource: 'COMPANY', reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ร้านค้าไม่ออกใบเสร็จ',
      businessPurpose: 'ซื้อของใช้สำนักงาน', payeeName: 'ร้านทดสอบ', paymentMethod: 'CASH',
      paymentDate: '2026-09-10', supportingAttachmentIds: [], paymentEvidenceAttachmentIds: [],
      artifactAttachmentId: null, updatedAt: '2026-09-10T00:00:00.000Z', supersedeReason: '',
    };
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/v1/companies/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        writes.push(path);
        return route.abort();
      }
      if (path.endsWith('/substitute-receipts')) return route.fulfill({ json: {
        items: [{ ...evidence, evidenceId: evidence.id }], total: 1, page: 1, pageSize: 200,
      } });
      if (path.endsWith('/substitute-receipt/history')) return route.fulfill({ json: [evidence] });
      if (path.endsWith('/expenses/view-only-expense')) return route.fulfill({ json: {
        id: evidence.expenseId, companyId, status: 'DRAFT', expenseNumber: 'EXP-VIEW-ONLY',
        expenseDate: '2026-09-10', currency: 'THB', grandTotalAmount: '100.00',
        netPayableAmount: '100.00', paidAmount: '0.00', outstandingAmount: '100.00',
        sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY',
        vatMode: 'NO_VAT', vendorNameSnapshot: evidence.payeeName, lines: [], attachments: [],
        substituteReceiptEvidence: evidence,
      } });
      return route.continue();
    });
    const url = `/companies/${companyId}/expenses/substitute-receipts/${evidence.id}`;
    await page.goto(url);
    const journey = page.getByRole('navigation', { name: 'เส้นทางการจัดทำเอกสาร' });
    await expect(journey.getByRole('button', { name: /ข้อมูลและหลักฐาน/ })).toBeVisible();
    await journey.getByRole('button', { name: /ข้อมูลและหลักฐาน/ }).click();
    // The same reviewer can edit an active source; cancellation must revoke that path.
    await expect(page.getByRole('link', { name: 'แก้ไขข้อมูลค่าใช้จ่าย', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'กลับไปลงนามและอนุมัติ', exact: true }).click();
    await expect(page.locator('input:visible, textarea:visible').first()).toBeVisible();
    evidence = { ...evidence, status: 'SUPERSEDED', supersedeReason: 'เอกสารซ้ำ', updatedAt: '2026-09-10T01:00:00.000Z' };
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { name: 'ยกเลิกแล้ว', exact: true })).toBeVisible();

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.getByRole('heading', { name: 'ยกเลิกแล้ว', exact: true })).toBeVisible();
      await page.locator('summary').filter({ hasText: 'ประวัติและการจัดทำฉบับแก้ไข' }).click();
      await expect(page.locator('details')).toContainText('เอกสารซ้ำ');
      await expect(page.getByRole('button', { name: /จัดทำ.*ฉบับแก้ไข/ })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'ดูรายการค่าใช้จ่าย', exact: true })).toBeVisible();
      for (const stage of ['รายการค่าใช้จ่าย', 'ข้อมูลและหลักฐาน']) {
        await journey.getByRole('button', { name: new RegExp(stage) }).click();
        await expect(page.getByText('เอกสารยกเลิกแล้ว ดูข้อมูลและประวัติได้เท่านั้น', { exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'แก้ไขข้อมูลค่าใช้จ่าย', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /กลับไปลงนาม|เปลี่ยนวิธีลงนาม|จัดทำ.*ฉบับแก้ไข/ })).toHaveCount(0);
        await expect(page.locator('input, textarea, select')).toHaveCount(0);
      }
      await page.getByRole('button', { name: 'ถัดไป: หลักฐาน', exact: true }).click();
      await expect(page.locator('input, textarea, select')).toHaveCount(0);
      await page.getByRole('button', { name: 'กลับไปดูสถานะเอกสาร', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'ยกเลิกแล้ว', exact: true })).toBeVisible();
      await expect(page.locator('input, textarea, select')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`cancelled-${signatureMode}-${width}.png`), fullPage: true });
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
