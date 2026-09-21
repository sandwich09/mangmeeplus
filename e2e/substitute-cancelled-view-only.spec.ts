import { test, expect } from './harness/fixtures';
import { expenseEvidenceConfirmationError, expenseEvidenceFingerprint, type ExpenseDetail, type ExpenseEvidenceAssessment } from '@watchdog-bms/contracts';

for (const signatureMode of ['DIGITAL', 'PAPER']) {
  test(`${signatureMode}: view and cancelled navigation show disabled forms and preserve file previews`, async ({ authedPage: page, companyId, urls }) => {
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
    const journey = page.getByRole('navigation', { name: 'เส้นทางการจัดทำเอกสาร' });
    for (const cancelled of [false, true]) {
      if (cancelled) {
        evidence = { ...evidence, status: 'SUPERSEDED', supersedeReason: 'เอกสารซ้ำ', updatedAt: '2026-09-10T01:00:00.000Z' };
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(page.getByRole('heading', { name: 'ยกเลิกแล้ว', exact: true })).toBeVisible();
      }
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 900 });
        // Explicit view also disables edits for the seeded OWNER. Cancelled is locked without the hint.
        await page.goto(`${url}${cancelled ? '' : '?mode=view'}`);
        await journey.getByRole('button', { name: /ข้อมูลและหลักฐาน/ }).click();
        await expect(page.getByRole('button', { name: 'แก้ไขข้อมูลใบแทน', exact: true })).toHaveCount(0);
        const inputs = page.locator('input:visible, textarea:visible');
        await expect(inputs.first()).toBeVisible();
        for (const input of await inputs.all()) await expect(input).toBeDisabled();
        for (const input of await page.getByRole('combobox').all()) await expect(input).toBeDisabled();
        await expect(page.getByRole('textbox', { name: /วัตถุประสงค์/ })).toHaveValue(evidence.businessPurpose);
        await expect(page.getByText('supporting.png', { exact: true })).toBeVisible();
        await expect(page.getByText('payment.png', { exact: true })).toBeVisible();
        await expect(page.getByText('unselected.png', { exact: true })).toHaveCount(0);
        await expect(page.getByText('ไม่พบข้อมูลไฟล์แนบ กรุณาโหลดหน้าใหม่', { exact: true })).toBeVisible();
        for (const id of ['supporting', 'payment']) {
          await page.getByRole('button', { name: `เปิดดูเอกสาร ${id}.png`, exact: true }).click();
          const dialog = page.getByRole('dialog');
          await expect(dialog).toBeVisible();
          await expect.poll(() => dialog.locator('img').evaluateAll(images => images.some(img => img.complete && img.naturalWidth > 0))).toBe(true);
          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
        }
        await page.screenshot({ path: test.info().outputPath(`disabled-${signatureMode}-${cancelled}-${width}.png`), fullPage: true });
        await page.getByRole('navigation', { name: 'การนำทางข้อมูลใบแทน' }).getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
        for (const input of await page.locator('input:visible, textarea:visible').all()) await expect(input).toBeDisabled();
        await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
        await page.getByRole('button', { name: 'ถัดไป', exact: true }).click();
        if (cancelled) await expect(page.getByRole('heading', { name: 'ยกเลิกแล้ว', exact: true })).toBeVisible();
      }
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('cancelled certificate can return to reviewed receipt evidence and confirm the same expense', async ({ authedPage: page, companyId, urls }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let confirmations = 0;
  const detail = {
    id: 'cancelled-confirm-expense', companyId, branchId: 'branch-1', status: 'READY_FOR_CONFIRMATION',
    captureSource: 'LINE_UPLOAD', expenseDate: '2026-09-18', currency: 'THB', vendorNameSnapshot: 'ร้านทดสอบ',
    vendorDocumentNumber: 'RECEIPT-1', vendorTaxIdSnapshot: null, vendorEntityKindSnapshot: 'INDIVIDUAL',
    sourceDocumentType: 'RECEIPT', taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE',
    vatMode: 'NO_VAT', primaryAttachmentId: 'receipt', duplicateStatus: 'NO_MATCH', duplicateCandidates: [],
    missingReceiptReason: 'เหตุผลจากใบรับรองที่ยกเลิกแล้ว', substituteReceiptGeneratedAt: null, substituteReceiptEvidence: null,
    note: 'ซื้อของใช้สำนักงาน', subtotalAmount: '100.00', discountAmount: '0.00', taxableAmount: '100.00',
    grandTotalAmount: '100.00', netPayableAmount: '100.00', vatAmount: '0.00', whtAmount: '0.00',
    paidAmount: '0.00', outstandingAmount: '100.00', payments: [], paymentStatus: 'UNPAID', postingStatus: 'pending',
    updatedAt: '2026-09-18T00:00:00.000Z', charges: [], aiVerificationSummaryJson: {},
    lines: [{ id: 'line-1', lineNumber: 1, description: 'กระดาษ A4', quantity: '1', unitPrice: '100.00',
      discountAmount: '0.00', lineSubtotalAmount: '100.00', taxableAmount: '100.00', lineTotalAmount: '100.00',
      vatRate: '0', vatAmount: '0.00', whtRate: null, whtAmount: '0.00' }],
    attachments: [{ id: 'receipt', originalFileName: 'receipt.png', mimeType: 'image/png', status: 'ACTIVE', purpose: 'expense.receipt.primary' }],
  } as unknown as ExpenseDetail;
  const review = (assessment: ExpenseEvidenceAssessment) => {
    detail.aiVerificationSummaryJson = { documentEvidenceDraft: assessment, documentReview: { version: 2,
      reviewedAt: detail.updatedAt, reviewedByUserId: 'seed-local-owner', assessment,
      fingerprint: expenseEvidenceFingerprint(detail, assessment) } };
  };
  review({ route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: ['receipt'], reason: detail.missingReceiptReason! });
  await page.route('**/__cancelled-confirm.png', route => route.fulfill({ contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64') }));
  // Expense responses are synthetic; authentication and the browser components remain real.
  await page.route('**/api/v1/companies/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/attachments/receipt/download-url')) return route.fulfill({ json: { downloadUrl: `${urls.web}/__cancelled-confirm.png` } });
    if (!path.includes(`/expenses/${detail.id}`)) return route.continue();
    if (path.endsWith('/totals-preview')) return route.fulfill({ json: detail });
    if (path.endsWith('/review-fields')) {
      const input = request.postDataJSON();
      if (input.documentReviewAcknowledged) review(input.evidenceAssessment);
      return route.fulfill({ json: detail });
    }
    if (path.endsWith('/confirm')) {
      expect(expenseEvidenceConfirmationError(detail)).toBeNull();
      confirmations++;
      detail.status = 'CONFIRMED';
      return route.fulfill({ json: detail });
    }
    if (request.method() === 'GET') return route.fulfill({ json: detail });
    throw new Error(`Unexpected expense write: ${request.method()} ${path}`);
  });
  await page.goto(`/companies/${companyId}/expenses/${detail.id}`);
  const next = page.getByRole('button', { name: 'ถัดไป', exact: true });
  await next.click();
  await next.click();
  const confirm = page.getByRole('button', { name: 'ยืนยันเอกสาร', exact: true });
  await expect(confirm).toBeDisabled();
  await expect(page.getByText(/ยืนยันไม่ได้:.*เลือกหลักฐาน.*ฉบับใหม่/)).toBeVisible();
  await expect(page.getByText(/ต้องให้ผู้จ่ายลงนาม/)).toHaveCount(0);
  await page.getByRole('button', { name: 'ย้อนกลับ', exact: true }).click();
  await page.getByRole('combobox', { name: 'ปัญหาของเอกสาร', exact: true }).click();
  await page.getByRole('option', { name: 'มีเอกสารใช้ประกอบรายการ', exact: true }).click();
  await page.getByRole('button', { name: 'บันทึกการตรวจ', exact: true }).click();
  await next.click();
  await expect(confirm).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('cancelled-receipt-ready.png'), fullPage: true });
  await confirm.click();
  await expect.poll(() => confirmations).toBe(1);
  expect(detail.missingReceiptReason).toBe('เหตุผลจากใบรับรองที่ยกเลิกแล้ว');
  expect(errors).toEqual([]);
});
