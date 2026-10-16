import { writeFile } from 'node:fs/promises';
import { test, expect } from './harness/fixtures';
import type { APIResponse } from '@playwright/test';

async function json(response: APIResponse) {
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

for (const signatureMode of ['DIGITAL', 'PAPER']) {
  test(`${signatureMode}: Back opens forms, saves source and certificate facts with the same number`, async ({ authedPage: page, api, companyId }) => {
    test.skip(process.env['SUBSTITUTE_NAVIGATION_LIVE'] !== '1', 'Requires an isolated local review database with configured cash policy and the owner personal signature');
    const base = `/v1/companies/${companyId}`;
    const categories = await json(await api.get(`${base}/expense-categories`));
    const branches = await json(await api.get(`${base}/branches?status=ACTIVE&pageSize=100`));
    const tag = `NAV-FORM-${signatureMode}-${Date.now()}`;
    const draft = await json(await api.post(`${base}/expenses`, { data: {
      captureSource: 'WEB_MANUAL', expenseDate: '2026-08-10', branchId: (branches.data ?? branches.items ?? branches)[0].id,
      vendorNameSnapshot: 'ร้านทดสอบฟอร์ม', vatMode: 'NO_VAT', inputVatClaimStatus: 'NON_CLAIMABLE',
      lines: [{ lineNumber: 1, description: tag, quantity: '1', unitPrice: '100', discountAmount: '0', vatRate: '0', expenseCategoryId: categories.find((c: {status: string}) => c.status === 'ACTIVE').id }],
    } }));
    // Same payload the review panel sends (ExpensesPages.tsx `saveDocumentReview`): the assessment
    // plus the acknowledgement. Without them the PATCH stores no `documentReview`, and
    // substitute-receipt refuses with EXPENSE_EVIDENCE_REVIEW_REQUIRED because
    // `hasCurrentExpenseEvidenceReview` is false and the route is not SUBSTITUTE_RECEIPT.
    await json(await api.patch(`${base}/expenses/${draft.id}/review-fields`, { data: {
      expectedUpdatedAt: draft.updatedAt, vendorNameSnapshot: 'ร้านทดสอบฟอร์ม', sourceDocumentType: 'EXPENSE_NOTE_TEXT', taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE',
      documentReviewAcknowledged: true,
      evidenceAssessment: { route: 'SUBSTITUTE_RECEIPT', receiptProblem: 'NOT_AVAILABLE', attachmentIds: [], reason: 'ร้านค้าไม่ออกเอกสาร' },
    } }));
    let detail = await json(await api.get(`${base}/expenses/${draft.id}`));
    let evidence = await json(await api.post(`${base}/expenses/${draft.id}/substitute-receipt`, { data: {
      reasonCode: 'PAYEE_CANNOT_ISSUE', missingReceiptReason: 'ร้านค้าไม่ออกเอกสาร', businessPurpose: 'ทดสอบฟอร์มก่อนลงนาม',
      signatureMode, ...(signatureMode === 'DIGITAL' ? {payerUserId: 'seed-local-owner'} : {}),
      fundingSource: 'COMPANY', paidInFullAcknowledged: true, payeeName: 'ผู้รับเงินคนละคนกับร้าน',
      paymentDate: '2026-08-11', paymentMethod: 'CASH', supportingAttachmentIds: [], paymentEvidenceAttachmentIds: [],
      idempotencyKey: tag, expectedExpenseUpdatedAt: detail.updatedAt,
    } }));
    const number = evidence.documentNumber;
    // Digital signs using the seeded personal signature; later source edits must reopen signing.
    if (signatureMode === 'DIGITAL') {
      const preview = await json(await api.post(`${base}/expenses/${draft.id}/substitute-receipt/${evidence.id}/preview`, {data: {payerPosition: ''}}));
      evidence = await json(await api.post(`${base}/expenses/${draft.id}/substitute-receipt/${evidence.id}/certify`, {data: {
        payerPosition: '', certificationAcknowledged: true, previewChecksumSha256: preview.previewChecksumSha256,
        expectedVersion: evidence.version, expectedEvidenceUpdatedAt: preview.expectedEvidenceUpdatedAt,
      }}));
    }
    const previous = evidence;
    const url = `/companies/${companyId}/expenses/substitute-receipts/${evidence.id}`;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    const back = () => page.getByRole('button', { name: 'กลับ', exact: true });
    const next = () => page.getByRole('button', { name: 'ถัดไป', exact: true });
    await back().click();
    await expect(page.getByRole('textbox', { name: /ชื่อผู้รับเงิน/ })).toBeEditable();
    await expect(page.getByRole('button', { name: 'แก้ไขข้อมูลใบแทน', exact: true })).toHaveCount(0);
    // No-op across both forms preserves signed evidence and the source timestamp.
    await back().click();
    await next().click();
    await next().click();
    await expect(page.getByRole('navigation', {name:'การนำทางขั้นตอนเซ็น'})).toBeVisible();
    let history = await json(await api.get(`${base}/expenses/${draft.id}/substitute-receipt/history`));
    expect(history[0].id).toBe(previous.id);
    expect(history[0].updatedAt).toBe(previous.updatedAt);
    expect(history[0].status).toBe(previous.status);
    await back().click();
    await page.getByRole('textbox', { name: /ชื่อผู้รับเงิน/ }).fill('ผู้รับเงินแก้ในฟอร์ม');
    // Back preserves certificate-only typing; the source form shares all original calculation fields.
    await back().click();
    await page.getByRole('textbox', {name: 'ซื้อไปใช้ทำอะไร', exact:true}).fill('วัตถุประสงค์ล่าสุดจากรายการค่าใช้จ่าย');
    await page.getByRole('spinbutton', {name:'จำนวน', exact:true}).fill('2');
    await next().click();
    await expect(page.getByRole('textbox', { name: /ชื่อผู้รับเงิน/ })).toHaveValue('ผู้รับเงินแก้ในฟอร์ม');
    await expect(page.getByRole('textbox', { name: /ซื้อไปใช้ทำอะไร/ })).toHaveValue('วัตถุประสงค์ล่าสุดจากรายการค่าใช้จ่าย');
    await page.getByRole('textbox', { name: /เหตุผลที่ไม่มีใบเสร็จรับเงิน/ }).fill('');
    await expect(next()).toBeDisabled();
    await page.getByRole('textbox', { name: /เหตุผลที่ไม่มีใบเสร็จรับเงิน/ }).fill('เหตุผลที่แก้จากฟอร์ม');
    await next().click();
    await expect(page.getByRole('navigation', {name:'การนำทางขั้นตอนเซ็น'})).toBeVisible();
    detail = await json(await api.get(`${base}/expenses/${draft.id}`));
    history = await json(await api.get(`${base}/expenses/${draft.id}/substitute-receipt/history`));
    const current = detail.substituteReceiptEvidence;
    expect(current.documentNumber).toBe(number);
    expect(current.payeeName).toBe('ผู้รับเงินแก้ในฟอร์ม');
    expect(detail.vendorNameSnapshot).toBe('ร้านทดสอบฟอร์ม');
    expect(current.businessPurpose).toBe('วัตถุประสงค์ล่าสุดจากรายการค่าใช้จ่าย');
    expect(current.missingReceiptReason).toBe('เหตุผลที่แก้จากฟอร์ม');
    expect(Number(detail.grandTotalAmount)).toBe(200);
    expect(current.status).toBe('PREPARED');
    if (signatureMode === 'DIGITAL') {
      expect(current.id).not.toBe(previous.id);
      expect(history.find((row: {id:string}) => row.id === previous.id).status).toBe('SUPERSEDED');
    }
    expect(detail.expenseNumber).toBe(draft.expenseNumber);
    if (signatureMode === 'PAPER') {
      const printed = await api.get(`${base}/expenses/${draft.id}/substitute-receipt/${current.id}/form.pdf`);
      expect(printed.status()).toBe(200);
      const pdf = await printed.body();
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      await writeFile(test.info().outputPath('paper-form.pdf'), pdf);
    }
    expect(current.certifiedAt).toBeNull();
    expect(errors).toEqual([]);
    // Test-owned local records are named for discovery and cleanup, never customer records.
    console.log(JSON.stringify({ fixture: tag, expenseId: draft.id, evidenceId: current.id, documentNumber: number }));
    await page.setViewportSize({width:390,height:900});
    await back().click();
    await expect(page.getByRole('textbox', { name: /ชื่อผู้รับเงิน/ })).toHaveValue(current.payeeName);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:test.info().outputPath(`editable-${signatureMode}.png`), fullPage:true});
  });
}
