import { test, expect } from './harness/fixtures';

for (const signatureMode of ['DIGITAL', 'PAPER']) {
  test(`${signatureMode} step 2 retains saved facts and files, including after cancellation`, async ({ authedPage: page, companyId, urls }) => {
    const attachments = ['supporting', 'payment', 'unselected'].map(id => ({
      id, originalFileName: `${id}.png`, mimeType: 'image/png', status: 'ACTIVE',
      purpose: id === 'payment' ? 'expense.payment.evidence' : 'expense.receipt.supporting',
    }));
    let evidence = {
      id: 'cancelled-view-only', expenseId: 'view-only-expense', companyId,
      documentNumber: 'SRC-202609-00001', version: 1, status: 'PREPARED', signatureMode,
      payerUserId: signatureMode === 'PAPER' ? null : 'seed-local-owner', payerName: 'Local Owner',
      fundingSource: 'COMPANY', reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ร้านค้าไม่ออกใบเสร็จ',
      businessPurpose: 'ซื้อของใช้สำนักงาน', payeeName: 'ร้านทดสอบ', paymentMethod: 'CASH',
      paymentDate: '2026-09-10', supportingAttachmentIds: ['supporting', 'missing'], paymentEvidenceAttachmentIds: ['payment'],
      artifactAttachmentId: null, updatedAt: '2026-09-10T00:00:00.000Z', supersedeReason: '',
    };
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/__step2-evidence/*.png', route => route.fulfill({
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64'),
    }));
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
      if (path.endsWith('/download-url')) {
        const id = path.split('/').at(-2);
        expect(['supporting', 'payment']).toContain(id);
        return route.fulfill({ json: { downloadUrl: `${urls.web}/__step2-evidence/${id}.png` } });
      }
      if (path.endsWith('/expenses/view-only-expense')) return route.fulfill({ json: {
        id: evidence.expenseId, companyId, status: 'DRAFT', expenseNumber: 'EXP-VIEW-ONLY',
        expenseDate: '2026-09-10', currency: 'THB', grandTotalAmount: '100.00',
        netPayableAmount: '100.00', paidAmount: '0.00', outstandingAmount: '100.00',
        sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY',
        vatMode: 'NO_VAT', vendorNameSnapshot: evidence.payeeName, lines: [], attachments,
        substituteReceiptEvidence: evidence,
      } });
      return route.continue();
    });
    const url = `/companies/${companyId}/expenses/substitute-receipts/${evidence.id}`;
    await page.goto(url);
    const journey = page.getByRole('navigation', { name: 'เส้นทางการจัดทำเอกสาร' });
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'ผู้รับเงินและเหตุผล', exact: true })).toBeVisible();
      await expect(page.getByText(evidence.businessPurpose, { exact: true })).toBeVisible();
      await expect(page.getByText('supporting.png', { exact: true })).toBeVisible();
      await expect(page.getByText('payment.png', { exact: true })).toBeVisible();
      await expect(page.getByText('unselected.png', { exact: true })).toHaveCount(0);
      await expect(page.getByText('ไม่พบข้อมูลไฟล์แนบ กรุณาโหลดหน้าใหม่', { exact: true })).toBeVisible();
      await expect(page.locator('input:visible, textarea:visible, select:visible')).toHaveCount(0);
      for (const id of ['supporting', 'payment']) {
        await page.getByRole('button', { name: `เปิดดูเอกสาร ${id}.png`, exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(`${id}.png`);
        await expect.poll(() => dialog.locator('img').evaluateAll(images => images.some(img => img.complete && img.naturalWidth > 0))).toBe(true);
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }
      await journey.getByRole('button', { name: /ข้อมูลและหลักฐาน/ }).click();
      await expect(page.getByText('payment.png', { exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`step2-${signatureMode}-${width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    }
    await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
    // The same reviewer can edit an active source; cancellation must revoke that path.
    await expect(page.getByRole('link', { name: 'แก้ไขรายการค่าใช้จ่าย', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
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
        await expect(page.getByRole('link', { name: 'แก้ไขรายการค่าใช้จ่าย', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /กลับไปลงนาม|เปลี่ยนวิธีลงนาม|จัดทำ.*ฉบับแก้ไข/ })).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'จัดการข้อมูล', exact: true })).toHaveCount(0);
        await expect(page.locator('input, textarea, select')).toHaveCount(0);
      }
      await expect(page.getByText(evidence.businessPurpose, { exact: true })).toBeVisible();
      await expect(page.getByText('payment.png', { exact: true })).toBeVisible();
      await expect(page.locator('input, textarea, select')).toHaveCount(0);
      await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'ยกเลิกแล้ว', exact: true })).toBeVisible();
      await expect(page.locator('input, textarea, select')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`cancelled-${signatureMode}-${width}.png`), fullPage: true });
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
