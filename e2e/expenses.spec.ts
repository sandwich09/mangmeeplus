import { deflateSync, crc32 } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { addCivilDays, civilDate, type ExpenseDetail as FullExpenseDetail, type IncomeExpenseLedgerSummary } from '@watchdog-bms/contracts';
import { test, expect } from './harness/fixtures';
import { branchOptionName, chooseThemedOption, firstActiveBranch, gotoCompany, json, unique } from './harness/e2e-utils';

type ExpenseSummary = { id: string; status: string; grandTotalAmount: string; updatedAt: string };
type ExpenseList = { data: ExpenseSummary[] };
type ExpenseDetail = ExpenseSummary & {
  subtotalAmount: string;
  taxableAmount: string;
  primaryAttachmentId?: string | null;
  attachments: Array<{ id: string; status: string }>;
  lines: unknown[];
};
type ReceiptUploadIntent = {
  expenseId: string;
  attachmentId: string;
  uploadUrl: string;
  uploadMethod: string;
  uploadHeaders: Record<string, string>;
};
type DownloadUrl = { downloadUrl: string };
type ExpenseExtractionResult = { status: 'ok' | 'not_configured' | 'unsupported' | 'no_attachment' | 'failed' };

async function createExpense(api: any, companyId: string, amount = '1000.00') {
  const { items: [branch] } = await json<{ items: Array<{ id: string }> }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  expect(branch).toBeTruthy();
  return json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses`, {
    data: {
      captureSource: 'WEB_MANUAL', branchId: branch!.id,
      expenseDate: new Date().toISOString(),
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      note: unique('E2E expense'),
      missingReceiptReason: 'E2E no receipt available',
      lines: [{ lineNumber: 1, description: unique('E2E expense line'), quantity: '1', unitPrice: amount }],
    },
  }));
}

type UploadIntent = { attachmentId: string; uploadUrl: string; uploadHeaders: Record<string, string> };

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// A tiny, byte-unique valid PNG per call. Confirming an expense runs it through
// checksum-based duplicate detection (createExpenseDuplicateCandidates) -- a fixed image
// byte-for-byte across many throwaway test expenses would make every one after the first
// look like an exact duplicate and block /confirm, so each receipt gets its own random pixels.
function uniqueReceiptPng(): Buffer {
  const size = 4;
  const rows = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), randomBytes(size * 3)])));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // color type: truecolor RGB
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}

// Test receipts are explicitly reviewed; merely uploading a file is not human approval.
async function reviewReceipt(api: any, companyId: string, expenseId: string) {
  const path = `companies/${companyId}/expenses/${expenseId}`;
  const detail = await json<FullExpenseDetail>(await api.get(path));
  expect(detail.primaryAttachmentId).toBeTruthy();
  return json<ExpenseSummary>(await api.patch(`${path}/review-fields`, { data: {
    expectedUpdatedAt: detail.updatedAt, sourceDocumentType: 'RECEIPT',
    taxEvidenceStatus: 'SUPPORTING_ONLY', inputVatClaimStatus: 'NON_CLAIMABLE',
    evidenceAssessment: { route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE',
      attachmentIds: [detail.primaryAttachmentId!], reason: '' },
    documentReviewAcknowledged: true,
  } }));
}

async function createExpenseWithReceipt(api: any, request: any, companyId: string, amount = '1000.00') {
  const { items: [branch] } = await json<{ items: Array<{ id: string }> }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  expect(branch).toBeTruthy();
  const created = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses`, {
    data: {
      captureSource: 'WEB_MANUAL', branchId: branch!.id,
      expenseDate: new Date().toISOString(),
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      note: unique('E2E expense'), vendorNameSnapshot: unique('Synthetic test vendor'),
      lines: [{ lineNumber: 1, description: unique('E2E expense line'), quantity: '1', unitPrice: amount }],
    },
  }));
  test.info().annotations.push({ type: 'own-expense', description: created.id });
  const receiptBytes = uniqueReceiptPng();
  const intent = await json<UploadIntent>(await api.post(`companies/${companyId}/attachments/upload-intent`, {
    data: { originalFileName: unique('e2e-primary-receipt') + '.png', mimeType: 'image/png', byteSize: receiptBytes.length, visibility: 'INTERNAL' },
  }));
  const uploaded = await request.put(intent.uploadUrl, { data: receiptBytes, headers: { ...intent.uploadHeaders, 'Content-Type': 'image/png' } });
  expect(uploaded.status()).toBe(200);
  const completed = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses/${created.id}/receipt-uploads/${intent.attachmentId}/complete`, {
    data: { byteSize: receiptBytes.length, purpose: 'expense.receipt.primary' },
  }));
  return reviewReceipt(api, companyId, completed.id);
}

test.describe('EXP — expenses + receipts', () => {
  test('EXP-INPUT @smoke normalizes price and discount zeros while preserving four decimals', async ({ authedPage: page, api, companyId }) => {
    const { items: branches } = await json<{ items: Array<{ id: string; name: string; type: string }> }>(
      await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`),
    );
    expect(branches.length).toBeGreaterThan(0);
    const branchId = branches[0]!.id;
    const created = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses`, {
      data: {
        captureSource: 'WEB_MANUAL', branchId, expenseDate: civilDate(new Date()), vatMode: 'NO_VAT',
        vendorNameSnapshot: unique('E2E amount input'), inputVatClaimStatus: 'NON_CLAIMABLE',
        lines: [{ lineNumber: 1, description: 'Decimal input regression', quantity: '1', unitPrice: '1000', discountAmount: '0' }],
      },
    }));

    for (const path of ['/expenses/manual', `/expenses/${created.id}`]) {
      await gotoCompany(page, companyId, path);
      // Source branch is a ThemedSelect now, not a native <select> — open, then click the option.
      if (path === '/expenses/manual') await chooseThemedOption(page, page.getByRole('combobox', { name: 'สาขา', exact: true }), branchOptionName(branches[0]!));
      const price = page.getByRole('spinbutton', { name: /^ราคาต่อหน่วย/ });
      const discount = page.getByRole('spinbutton', { name: /^ส่วนลด/ });
      for (const field of [price, discount]) {
        await price.fill('1000');
        await discount.fill('0');
        await field.fill('');
        await field.pressSequentially('0400');
        await expect(field).toHaveValue('400');
        await field.press('Tab');
        await expect(field).toHaveValue('400');
        // Paste-style replacement can normalize to the same state value as before.
        await field.fill('000400');
        await expect(field).toHaveValue('400');
        await field.fill('');
        await field.pressSequentially('0.402');
        await expect(field).toHaveValue('0.402');
        await field.fill('000.0042');
        await expect(field).toHaveValue('0.0042');
        expect(await field.evaluate((input) => (input as HTMLInputElement).validity.stepMismatch)).toBe(false);
        await expect(field).not.toHaveAttribute('aria-invalid', 'true');
        await field.fill('');
        await expect(field).toHaveValue('');
      }
    }
  });

  test('EXP-01 @smoke expenses list renders filters and table surface', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    await expect(authedPage.getByRole('heading', { name: /ค่าใช้จ่าย|Expenses/i })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /ทั้งหมด/ })).toBeVisible();
    // 2026-10-13: four groups whose names do not overlap (drafts are inside "ยังไม่ยืนยัน", which always counted them).
    await expect(authedPage.getByRole('button', { name: /^ยังไม่ยืนยัน/ })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /^ยกเลิก\/ปฏิเสธ/ })).toBeVisible();
    // The chip is named with its count ("ยืนยันแล้ว 0"); the export button "ส่งออก Excel ให้สำนักงานบัญชี" (it was "ส่งออกเอกสารยืนยันแล้ว")
    // carries the same word, so the chip is matched from the start of its name.
    await expect(authedPage.getByRole('button', { name: /^ยืนยันแล้ว/ })).toBeVisible();
    for (const name of ['รายวัน', 'รายเดือน']) await expect(authedPage.locator('main').getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(authedPage.locator('main').getByRole('combobox', { name: 'ใช้ VAT ตอนยื่นภาษี', exact: true })).toHaveCount(0);
  });

  test('EXP-LIST-1 a legacy day URL opens the month with no day toggle', async ({ authedPage, companyId }) => {
    const request = authedPage.waitForRequest(request => {
      const url = new URL(request.url());
      return request.method() === 'GET' && url.pathname.endsWith(`/companies/${companyId}/expenses`)
        && url.searchParams.get('fromDate') === '2026-09-01' && url.searchParams.get('toDate') === '2026-09-30';
    });
    await gotoCompany(authedPage, companyId, '/expenses?view=day&day=2026-09-14');
    await request;
    await expect(authedPage.locator('main').getByRole('combobox', { name: 'วันที่เอกสาร', exact: true })).toHaveText('ก.ย. 2569');
    for (const name of ['รายวัน', 'รายเดือน']) await expect(authedPage.locator('main').getByRole('button', { name, exact: true })).toHaveCount(0);
  });

  test('EXP-02 @p1 summary tiles render numeric values', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    // One card of numbers above the list (owner 2026-10-15).
    for (const label of ['ยอดค่าใช้จ่ายตามวันที่เอกสาร', 'ค้างจ่าย', 'VAT ตามเอกสาร']) {
      await expect(authedPage.getByText(label, { exact: true }).filter({ visible: true })).toBeVisible();
    }
    for (const removed of ['ยังไม่ยืนยัน', 'เกินกำหนดจ่าย', 'ค้างจ่ายที่ยืนยันแล้ว']) await expect(authedPage.getByTestId('expenses-summary').getByText(removed, { exact: true })).toHaveCount(0);
    await expect(authedPage.locator('main, #workspace-main').getByText(/฿|0|1|2|3|4|5|6|7|8|9/).first()).toBeVisible();
  });

  test('EXP-03 @smoke creates draft expense via API and verifies list truth', async ({ authedPage, api, companyId }) => {
    const created = await createExpense(api, companyId);
    await gotoCompany(authedPage, companyId, `/expenses?expenseId=${created.id}`);
    await expect(authedPage.getByText(/ร่าง|DRAFT/i).first()).toBeVisible();

    const body = await json<ExpenseList>(await api.get(`companies/${companyId}/expenses?pageSize=100`));
    expect(body.data.some((expense) => expense.id === created.id && expense.status === 'DRAFT')).toBe(true);
  });

  test('EXP-04 @p1 expense detail renders totals and transitions', async ({ authedPage, api, companyId }) => {
    const created = await createExpense(api, companyId);
    await gotoCompany(authedPage, companyId, `/expenses?expenseId=${created.id}`);
    // createExpense() leaves the vendor name empty. Until it is filled the money card reads
    // "ยังแสดงยอดล่าสุดไม่ได้: กรุณากรอกชื่อผู้ขาย" in place of the totals, and ถัดไป stays disabled.
    await authedPage.getByRole('textbox', { name: /ชื่อผู้ขาย/ }).first().fill('E2E Vendor');
    // guided stepper opens on the vendor+items step, where the money summary lives
    // The starting row (ยอดก่อนหักส่วนลด) shows only when a discount, a charge or VAT changes it on the way to the total.
    await expect(authedPage.getByTestId('expense-review-totals').getByText('ยอดรวม', { exact: true })).toBeVisible();
    await expect(authedPage.getByText('ยอดก่อนหักส่วนลด', { exact: true })).toHaveCount(0);
    // This fixture carries no VAT (NO_VAT, nothing charged). Since 4361ed0b7 the tax-base and VAT rows
    // show only for money that carries VAT, whatever the company's capture mode (FULL or SIMPLE).
    await expect(authedPage.getByText('ยอดก่อน VAT', { exact: true })).toHaveCount(0);
    await expect(authedPage.getByTestId('expense-review-totals').getByText('ยอดรวม', { exact: true })).toBeVisible();
    // The stepper is display-only: reach the final step through ถัดไป.
    await authedPage.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    // Step 2 lets ถัดไป through only after a saved document review (0283a3d0b). With no file attached
    // the one complete review is "ไม่มีใบเสร็จ" with a substitute receipt (expenseEvidenceInputError).
    await chooseThemedOption(authedPage, authedPage.getByRole('combobox', { name: 'ประเภทเอกสาร', exact: true }), 'เอกสารค่าใช้จ่ายอื่น');
    await authedPage.getByRole('button', { name: 'ไม่มีใบเสร็จ หรือใบเสร็จมีปัญหา', exact: true }).click();
    await chooseThemedOption(authedPage, authedPage.getByRole('combobox', { name: 'มีใบเสร็จของรายการนี้ไหม', exact: true }), 'ไม่มีใบเสร็จ');
    await chooseThemedOption(authedPage, authedPage.getByRole('combobox', { name: 'จะใช้อะไรแทน', exact: true }), 'ทำใบรับรองแทนใบเสร็จ');
    await expect(authedPage.getByRole('button', { name: 'บันทึกการตรวจ', exact: true })).toHaveCount(0);
    const reviewSaved = authedPage.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/review-fields'));
    await authedPage.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    expect((await reviewSaved).ok()).toBe(true);
    await expect(authedPage.getByRole('button', { name: 'ส่งให้ตรวจ', exact: true })).toBeVisible();
  });

  // Sending for review names the checker and leaves the stored request visible on the expense.
  test('EXP-04B @smoke sending for review chooses a checker and shows the stored request on the expense', async ({ authedPage, api, request, companyId }) => {
    test.skip(process.env['S3_E2E'] !== '1' && process.env['S3_E2E_ACTIVE'] !== '1', 'This submit journey requires an attached and reviewed receipt; run with local MinIO and S3_E2E=1.');
    const created = await createExpenseWithReceipt(api, request, companyId);
    await gotoCompany(authedPage, companyId, `/expenses/${created.id}`);
    await authedPage.getByRole('textbox', { name: /ชื่อผู้ขาย/ }).first().fill('E2E Vendor');
    await authedPage.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(authedPage.getByRole('heading', { name: 'ประเภทเอกสารและหมวดหมู่', exact: true })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: 'บันทึกการตรวจ', exact: true })).toHaveCount(0);
    const reviewSaved = authedPage.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/review-fields'));
    await authedPage.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    expect((await reviewSaved).ok()).toBe(true);

    const people = await json<Array<{ userId: string; displayName: string }>>(await api.get(`companies/${companyId}/expenses/${created.id}/reviewers`));
    expect(people.length, 'the review fixture needs another member with expense.confirm in this branch').toBeGreaterThan(0);
    const checker = people[0]!;
    const submit = authedPage.getByRole('button', { name: 'ส่งให้ตรวจ', exact: true });
    await expect(submit).toBeEnabled(); await submit.click();
    const dialog = authedPage.getByRole('dialog', { name: 'ส่งให้ใครตรวจ', exact: true });
    await expect(dialog).toBeVisible();
    if (people.length > 1) await dialog.getByRole('radio', { name: checker.displayName, exact: true }).check();
    await dialog.getByRole('button', { name: 'ส่งให้ตรวจ', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(authedPage).toHaveURL(new RegExp(`/companies/${companyId}/expenses/${created.id}$`));
    await expect(authedPage.getByText(new RegExp(`ส่งให้ ${checker.displayName} ตรวจแล้ว เมื่อ`))).toBeVisible();
    const stored = await json<FullExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`));
    expect(stored.reviewRequest?.requestedReviewerUserId).toBe(checker.userId);

    expect((await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`))).status)
      .toBe('READY_FOR_CONFIRMATION');
  });

  test('EXP-04A @p1 cancellation switches to deletion only after success', async ({ authedPage, api, companyId }, info) => {
    const created = await createExpense(api, companyId);
    await gotoCompany(authedPage, companyId, `/expenses/${created.id}`);
    await authedPage.setViewportSize({ width: 390, height: 844 });
    // Invalid drafts remain cancellable directly from the first step, with one click to the dialog.
    await expect(authedPage.getByRole('button', { name: 'ถัดไป', exact: true })).toBeDisabled();
    await expect(authedPage.getByRole('button', { name: 'ยกเลิกรายการ', exact: true })).toBeVisible();
    const deleteButton = authedPage.locator('button').filter({ hasText: /^ลบรายจ่าย$/ });
    await expect(deleteButton).toHaveCount(0);
    await expect(authedPage.locator('summary').filter({ hasText: /^เพิ่มเติม$/ })).toHaveCount(0);
    await authedPage.getByRole('button', { name: 'ยกเลิกรายการ', exact: true }).click();

    const dialog = authedPage.getByRole('dialog', { name: /^ยกเลิกรายการ/ });
    const reason = dialog.getByRole('textbox', { name: 'เหตุผลที่ยกเลิก' });
    const confirm = dialog.getByRole('button', { name: 'ยกเลิกรายการ', exact: true });
    await expect(dialog).toBeVisible();
    // The action stays pressable and says what is missing (thai-ux-standard §2.9).
    await confirm.click();
    await expect(dialog.getByText('ใส่เหตุผลที่ยกเลิกก่อน')).toBeVisible();
    await reason.fill('ยังไม่ยกเลิกในรอบแรก');
    await expect(confirm).toBeEnabled();
    await dialog.getByRole('button', { name: 'ไม่ยกเลิก', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`))).status).toBe('DRAFT');

    await authedPage.getByRole('button', { name: 'ยกเลิกรายการ', exact: true }).click();
    // A typed reason survives closing the window (thai-ux-standard §4.3).
    await expect(reason).toHaveValue('ยังไม่ยกเลิกในรอบแรก');
    await reason.fill('บันทึกรายการผิด');
    let releaseReject!: () => void;
    let rejectGate = new Promise<void>((resolve) => { releaseReject = resolve; });
    let failReject = true;
    await authedPage.route(`**/companies/${companyId}/expenses/${created.id}/reject`, async (route) => {
      await rejectGate;
      if (failReject) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'ยกเลิกไม่สำเร็จ กรุณาลองอีกครั้ง' }) });
      else await route.continue();
    });
    await confirm.click();
    await expect(dialog.getByRole('button', { name: 'กำลังยกเลิก…', exact: true })).toBeDisabled();
    await expect(reason).toBeDisabled();
    await expect(deleteButton).toHaveCount(0);
    releaseReject();
    await expect(confirm).toBeEnabled();
    await expect(dialog).toBeVisible();
    await expect(reason).toHaveValue('บันทึกรายการผิด');
    await expect(deleteButton).toHaveCount(0);
    expect((await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`))).status).toBe('DRAFT');

    failReject = false;
    rejectGate = new Promise<void>((resolve) => { releaseReject = resolve; });
    await confirm.click();
    await expect(dialog.getByRole('button', { name: 'กำลังยกเลิก…', exact: true })).toBeDisabled();
    await expect(deleteButton).toHaveCount(0);
    releaseReject();
    await expect(dialog).toBeHidden();
    expect((await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`))).status).toBe('REJECTED');
    await expect(deleteButton).toBeVisible();
    await expect(authedPage.getByRole('button', { name: 'ยกเลิกรายการ', exact: true })).toHaveCount(0);
    await expect(authedPage.locator('summary').filter({ hasText: /^เพิ่มเติม$/ })).toHaveCount(0);
    await expect(authedPage.getByRole('button', { name: 'เริ่มตรวจใหม่', exact: true })).toBeVisible();
    await authedPage.screenshot({ path: info.outputPath('cancelled-delete-390.png') });
    await deleteButton.click();
    const deleteDialog = authedPage.getByRole('dialog', { name: /^ลบรายจ่าย/ });
    await expect(deleteDialog.getByRole('button', { name: 'ลบรายจ่าย', exact: true })).toBeVisible();
    await deleteDialog.getByRole('button', { name: 'ไม่ลบ', exact: true }).click();
    await expect(deleteDialog).toBeHidden();
    expect((await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`))).status).toBe('REJECTED');
  });

  for (const width of [390, 1280]) {
    test(`EXP-READ-LOCK locks the complete form and preserves edits at ${width}px`, async ({ authedPage: page, api, companyId, urls }, info) => {
      const created = await createExpense(api, companyId);
      const path = `companies/${companyId}/expenses/${created.id}`;
      const stored = await json<FullExpenseDetail>(await api.get(path));
      const attachmentId = `synthetic-${created.id}`;
      const receipt = uniqueReceiptPng();
      let detail = { ...stored, primaryAttachmentId: attachmentId, attachments: [{
        id: attachmentId, purpose: 'expense.receipt.primary' as const, originalFileName: 'synthetic.png',
        mimeType: 'image/png', byteSize: receipt.length, checksumSha256: null, status: 'ACTIVE', createdAt: stored.updatedAt,
      }] };
      // Only OCR/status/preview responses are simulated. No provider call or charge is made.
      let job: { status: string; applied?: boolean } | null = null;
      let releaseRead!: () => void;
      let readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
      let refreshGate = Promise.resolve();
      let refreshStarted = false;
      await page.route(`**/v1/${path}`, async (route) => {
        refreshStarted = true;
        await refreshGate;
        await route.fulfill({ json: detail });
      });
      await page.route(`**/v1/${path}/read-status`, (route) => route.fulfill({ json: { files: job ? [{
        fileId: 'synthetic-job', attachmentId, pagesRead: 0, pageCount: 1, pausedReason: null, lastErrorCode: null, ...job,
      }] : [] } }));
      await page.route(`**/v1/${path}/extraction-request`, async (route) => {
        await readGate;
        await route.fulfill({ json: { status: 'ok', ...(job ? { readJobId: 'synthetic-job', readStatus: job.status } : {}) } });
      });
      await page.route(`**/attachments/${attachmentId}/download-url*`, (route) => route.fulfill({ json: { downloadUrl: `${urls.web}/__synthetic-receipt.png` } }));
      await page.route('**/__synthetic-receipt.png', (route) => route.fulfill({ contentType: 'image/png', body: receipt }));
      await page.setViewportSize({ width, height: 844 });
      await gotoCompany(page, companyId, `/expenses/${created.id}`);
      const form = page.getByTestId('expense-review-form');
      const vendor = form.getByRole('textbox', { name: /^ชื่อผู้ขาย/, includeHidden: true });
      const read = form.getByRole('button', { name: 'อ่านเอกสารอีกครั้ง', exact: true });
      await vendor.fill('ค่าที่พิมพ์ไว้ก่อนอ่าน');
      const originalInput = await vendor.elementHandle();
      await read.click();
      await expect(form.locator(':scope > fieldset')).toHaveAttribute('inert', '');
      await expect(vendor).toBeDisabled();
      await expect(form.locator('input:enabled, textarea:enabled, select:enabled, button:enabled')).toHaveCount(0);
      const select = form.locator('summary').first();
      await select.evaluate((element: HTMLElement) => element.focus());
      expect(await form.evaluate((element) => element.contains(document.activeElement))).toBe(false);
      const bounds = await form.boundingBox();
      const cover = await form.locator(':scope > .absolute').boundingBox();
      expect(cover).toEqual(bounds);
      await expect(form.getByRole('status').filter({ hasText: 'AI กำลังอ่านเอกสาร' })).toBeInViewport();
      if (width === 1280) await expect(page.getByRole('button', { name: 'เปิดเต็มจอ', exact: true })).toBeEnabled();
      await page.screenshot({ path: info.outputPath(`read-lock-${width}.png`), fullPage: true });
      releaseRead();
      await expect(vendor).toBeEnabled();
      await expect(vendor).toHaveValue('ค่าที่พิมพ์ไว้ก่อนอ่าน');
      expect(await originalInput!.evaluate((element) => element.isConnected)).toBe(true);

      // A queued response on the SAME attachment must hand off to polling without unlocking.
      readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
      await read.click();
      job = { status: 'QUEUED' };
      const queuedResponse = page.waitForResponse((response) => response.url().endsWith('/extraction-request'));
      releaseRead();
      await queuedResponse;
      await expect(form.getByRole('button', { name: 'อ่านเอกสารอีกครั้ง', exact: true, includeHidden: true })).toHaveCount(1);
      await expect(vendor).toBeDisabled();
      let releaseRefresh!: () => void;
      refreshGate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
      refreshStarted = false;
      detail = { ...detail, vendorNameSnapshot: 'ผลอ่านล่าสุด', updatedAt: new Date(Date.now() + 1000).toISOString() };
      job = { status: width === 390 ? 'PARTIAL' : 'DONE', applied: true };
      await expect.poll(() => refreshStarted).toBe(true);
      await expect(vendor).toBeDisabled();
      releaseRefresh();
      await expect(vendor).toBeEnabled();
      await expect(vendor).toHaveValue('ผลอ่านล่าสุด');
      expect(await originalInput!.evaluate((element) => element.isConnected)).toBe(true);

      // Returning to a running job locks immediately; a terminal failure permits manual entry.
      job = { status: 'READING' };
      await page.reload();
      await expect(vendor).toBeDisabled();
      job = { status: width === 390 ? 'PAUSED' : 'FAILED' };
      await expect(vendor).toBeEnabled();
      await vendor.fill('กรอกต่อหลังอ่านไม่สำเร็จ');
      await expect(vendor).toHaveValue('กรอกต่อหลังอ่านไม่สำเร็จ');
      await expect(page.getByRole('button', { name: 'ยกเลิกรายการ', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`review-ready-${width}.png`), fullPage: true });
    });
  }

  test('EXP-05 @p1 moves draft through ready and confirmed with API truth', async ({ api, request, companyId }) => {
    test.skip(
      process.env['S3_E2E'] !== '1' && process.env['S3_E2E_ACTIVE'] !== '1',
      'EXP-05 confirms past the substitute-receipt gate via a real attachment; requires compose MinIO on localhost:19000; start it and run with S3_E2E=1.',
    );
    const created = await createExpenseWithReceipt(api, request, companyId);
    const ready = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses/${created.id}/mark-ready`, { data: {} }));
    expect(ready.status).toBe('READY_FOR_CONFIRMATION');

    const confirmed = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses/${created.id}/confirm`, { data: {} }));
    expect(confirmed.status).toBe('CONFIRMED');

    const detail = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`));
    expect(detail.status).toBe('CONFIRMED');
    expect(Number(detail.grandTotalAmount)).toBeGreaterThan(0);
  });

  test('EXP-06 @p2 uploads receipt bytes and resolves the preview/download URL', async ({ api, request, companyId }) => {
    test.skip(
      process.env['S3_E2E'] !== '1' && process.env['S3_E2E_ACTIVE'] !== '1',
      'EXP-06 requires compose MinIO on localhost:19000; start it and run with S3_E2E=1.',
    );

    const branch = await firstActiveBranch(api, companyId);
    const receiptBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const intent = await json<ReceiptUploadIntent>(await api.post(`companies/${companyId}/expenses/receipt-uploads`, {
      data: {
        originalFileName: unique('e2e-receipt') + '.png',
        mimeType: 'image/png',
        byteSize: receiptBytes.length,
        branchId: branch.id,
        expenseDate: civilDate(new Date()),
        note: unique('EXP-06 receipt upload'),
      },
    }));
    const draft = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${intent.expenseId}`));
    expect(draft.status).toBe('DRAFT');

    const uploaded = await request.put(intent.uploadUrl, {
      data: receiptBytes,
      headers: { ...intent.uploadHeaders, 'Content-Type': 'image/png' },
    });
    expect(uploaded.status()).toBe(200);
    await json<ExpenseSummary>(await api.post(
      `companies/${companyId}/expenses/${intent.expenseId}/receipt-uploads/${intent.attachmentId}/complete`,
      { data: { byteSize: receiptBytes.length } },
    ));

    const detail = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${intent.expenseId}`));
    expect(detail.primaryAttachmentId).toBe(intent.attachmentId);
    expect(detail.attachments.some((attachment) => attachment.id === intent.attachmentId)).toBe(true);

    const preview = await json<DownloadUrl>(await api.get(`companies/${companyId}/attachments/${intent.attachmentId}/download-url`));
    const downloaded = await request.get(preview.downloadUrl);
    expect(downloaded.status()).toBe(200);
    expect(await downloaded.body()).toEqual(receiptBytes);
  });

  test('EXP-07 @p2 receipt extraction stays reviewable when OCR is not configured', async ({ api, request, companyId }) => {
    test.skip(
      process.env['S3_E2E'] !== '1' && process.env['S3_E2E_ACTIVE'] !== '1',
      'EXP-07 requires compose MinIO on localhost:19000; start it and run with S3_E2E=1.',
    );

    const branch = await firstActiveBranch(api, companyId);
    const receiptBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const intent = await json<ReceiptUploadIntent>(await api.post(`companies/${companyId}/expenses/receipt-uploads`, {
      data: {
        originalFileName: unique('e2e-extraction-receipt') + '.png',
        mimeType: 'image/png',
        byteSize: receiptBytes.length,
        branchId: branch.id,
        expenseDate: civilDate(new Date()),
        note: unique('EXP-07 receipt extraction'),
      },
    }));
    const uploaded = await request.put(intent.uploadUrl, {
      data: receiptBytes,
      headers: { ...intent.uploadHeaders, 'Content-Type': 'image/png' },
    });
    expect(uploaded.status()).toBe(200);
    await json<ExpenseSummary>(await api.post(
      `companies/${companyId}/expenses/${intent.expenseId}/receipt-uploads/${intent.attachmentId}/complete`,
      { data: { byteSize: receiptBytes.length } },
    ));

    const extraction = await json<ExpenseExtractionResult>(await api.post(
      `companies/${companyId}/expenses/${intent.expenseId}/extraction-request`,
      { data: {} },
    ));
    expect(extraction.status).toBe('not_configured');

    const detail = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${intent.expenseId}`));
    expect(detail.status).toBe('NEEDS_REVIEW');
  });

  test('EXP-08 @p1 recomputes edited line totals before confirming', async ({ api, request, companyId }) => {
    test.skip(
      process.env['S3_E2E'] !== '1' && process.env['S3_E2E_ACTIVE'] !== '1',
      'EXP-08 confirms past the substitute-receipt gate via a real attachment; requires compose MinIO on localhost:19000; start it and run with S3_E2E=1.',
    );
    const created = await createExpenseWithReceipt(api, request, companyId);
    await json<ExpenseSummary>(await api.patch(`companies/${companyId}/expenses/${created.id}`, {
      data: {
        expectedUpdatedAt: created.updatedAt,
        lines: [{
          lineNumber: 1,
          description: unique('EXP-08 edited line'),
          quantity: '2',
          unitPrice: '150',
        }],
      },
    }));

    const detail = await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`));
    expect(Number(detail.grandTotalAmount)).toBe(300);
    await reviewReceipt(api, companyId, created.id);

    const ready = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses/${created.id}/mark-ready`, { data: {} }));
    expect(ready.status).toBe('READY_FOR_CONFIRMATION');

    const confirmed = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses/${created.id}/confirm`, { data: {} }));
    expect(confirmed.status).toBe('CONFIRMED');
  });

  test('EXP-09 @p2 confirmed chip filters without client error', async ({ authedPage, api, companyId }) => {
    const created = await createExpense(api, companyId, '321.00');
    await api.post(`companies/${companyId}/expenses/${created.id}/mark-ready`, { data: {} });
    await api.post(`companies/${companyId}/expenses/${created.id}/confirm`, { data: {} });
    await gotoCompany(authedPage, companyId, '/expenses');
    // The chip, not the export button "ส่งออก Excel ให้สำนักงานบัญชี" (it was "ส่งออกเอกสารยืนยันแล้ว") (see EXP-01).
    await authedPage.getByRole('button', { name: /^ยืนยันแล้ว/ }).click();
    await expect(authedPage.getByText(/ยืนยันแล้ว/).first()).toBeVisible();
  });
});

// G9 regression — docs/specs/list-filter-retention-spec.md §9B.
// expenseDate is a DateTime and real rows carry a time: a LINE receipt photo stamps it with the
// moment it arrived. The list filter used `lte: <toDate midnight>`, which matched only rows
// sitting exactly on midnight, so a day view of today returned nothing at all. createExpense
// posts a full ISO timestamp, so it reproduces the condition exactly.
test('EXP-24 @p1 day-range filter still finds an expense stamped with a time', async ({ api, companyId }) => {
  const created = await createExpense(api, companyId, '777.00');
  // The API stores the instant's calendar day in Asia/Bangkok, so "today" is that day too. The UTC
  // day (toISOString) is still yesterday from 00:00 to 06:59 Bangkok time.
  const today = civilDate(new Date());

  const sameDay = await json<ExpenseList>(
    await api.get(`companies/${companyId}/expenses?fromDate=${today}&toDate=${today}&pageSize=200`),
  );
  expect(
    sameDay.data.some((expense) => expense.id === created.id),
    'an expense dated today must appear in a fromDate=toDate=today range',
  ).toBe(true);
});

// G9 write side. createExpense posts a FULL ISO timestamp, the shape the LINE receipt path used
// to send; expenseDate means a calendar date, so the API must store it date-only rather than let
// a time into the column.
test('EXP-25 @p1 stores expenseDate as a calendar date even when posted an instant', async ({ api, companyId }) => {
  const created = await createExpense(api, companyId, '888.00');
  const detail = await json<ExpenseDetail & { expenseDate: string }>(
    await api.get(`companies/${companyId}/expenses/${created.id}`),
  );

  expect(detail.expenseDate, 'a date column must not carry a time').toMatch(/T00:00:00(\.000)?Z$/);
});

test('EXP-26 @p1 groups a backdated document by document month and labels both dates', async ({ authedPage, api, companyId }) => {
  const intakeDate = civilDate(new Date());
  const documentDate = addCivilDays(intakeDate, -51);
  const branch = await firstActiveBranch(api, companyId);
  const vendor = unique('EXP-26 backdated vendor');
  const created = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses`, {
    data: {
      captureSource: 'WEB_MANUAL',
      branchId: branch.id,
      expenseDate: documentDate,
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      missingReceiptReason: 'E2E no receipt available',
      lines: [{ lineNumber: 1, description: 'EXP-26 backdated expense', quantity: '1', unitPrice: '926.00' }],
    },
  }));
  await json<ExpenseSummary>(await api.patch(`companies/${companyId}/expenses/${created.id}`, {
    data: { expectedUpdatedAt: created.updatedAt, vendorNameSnapshot: vendor },
  }));
  const sameMonthVendor = unique('EXP-26 same-month vendor');
  const sameMonthCreated = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses`, {
    data: {
      captureSource: 'WEB_MANUAL',
      branchId: branch.id,
      expenseDate: intakeDate,
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      missingReceiptReason: 'E2E no receipt available',
      lines: [{ lineNumber: 1, description: 'EXP-26 same-month expense', quantity: '1', unitPrice: '927.00' }],
    },
  }));
  await json<ExpenseSummary>(await api.patch(`companies/${companyId}/expenses/${sameMonthCreated.id}`, {
    data: { expectedUpdatedAt: sameMonthCreated.updatedAt, vendorNameSnapshot: sameMonthVendor },
  }));

  const listRequestPromise = authedPage.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === 'GET'
      && url.pathname.endsWith(`/companies/${companyId}/expenses`)
      && url.searchParams.has('fromDate');
  });
  await gotoCompany(authedPage, companyId, '/expenses');
  const listUrl = new URL((await listRequestPromise).url());
  const [year, month] = intakeDate.slice(0, 7).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  expect(listUrl.searchParams.get('fromDate')).toBe(`${intakeDate.slice(0, 7)}-01`);
  expect(listUrl.searchParams.get('toDate')).toBe(`${intakeDate.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`);
  expect(listUrl.searchParams.get('uploadedFromDate')).toBeNull();
  expect(listUrl.searchParams.get('uploadedToDate')).toBeNull();

  const allRows = authedPage.getByTestId('expenses-row').filter({ hasText: vendor });
  const row = allRows.filter({ visible: true });
  await expect(authedPage.getByTestId('expenses-row').filter({ visible: true }).filter({ hasText: sameMonthVendor })).toBeVisible();
  await expect(allRows).toHaveCount(0);

  const documentMonth = documentDate.slice(0, 7);
  const [documentYear, documentMonthNumber] = documentMonth.split('-').map(Number);
  const documentLastDay = new Date(Date.UTC(documentYear!, documentMonthNumber!, 0)).getUTCDate();
  const documentListRequestPromise = authedPage.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === 'GET'
      && url.pathname.endsWith(`/companies/${companyId}/expenses`)
      && url.searchParams.get('fromDate') === `${documentMonth}-01`;
  });
  await expect(authedPage.locator('main').getByRole('button', { name: 'รายวัน', exact: true })).toHaveCount(0);
  await authedPage.locator('main').getByRole('combobox', { name: 'วันที่เอกสาร', exact: true }).click();
  if (documentYear !== year) await authedPage.getByRole('button', { name: 'ปีก่อนหน้า' }).click();
  await authedPage.getByRole('button', {
    name: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][documentMonthNumber! - 1],
    exact: true,
  }).click();
  const documentListUrl = new URL((await documentListRequestPromise).url());
  expect(documentListUrl.searchParams.get('toDate')).toBe(`${documentMonth}-${String(documentLastDay).padStart(2, '0')}`);
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('วันที่เอกสาร');
  await expect(row).toContainText(new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(documentDate)));
  await expect(row).toContainText('รอตรวจ');
  await expect(row).not.toContainText('อัปโหลดเว็บ');
  await expect(row).toContainText('ส่งเข้าระบบ');
  await expect(row).toContainText('เอกสารย้อนหลัง 51 วัน');
  await expect(authedPage.getByTestId('expenses-row').filter({ hasText: sameMonthVendor })).toHaveCount(0);

  const exportRequestPromise = authedPage.waitForRequest((request) => (
    request.method() === 'POST' && new URL(request.url()).pathname.endsWith(`/companies/${companyId}/expenses/accountant-package`)
  ));
  await authedPage.getByRole('button', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true }).click();
  await authedPage.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click();
  const exportPayload = (await exportRequestPromise).postDataJSON();
  expect(exportPayload.dateField).toBe('expenseDate');
  expect(exportPayload.fromDate).toBe(`${documentMonth}-01`);
  expect(exportPayload.toDate).toBe(`${documentMonth}-${String(documentLastDay).padStart(2, '0')}`);

  await authedPage.setViewportSize({ width: 390, height: 844 });
  const card = authedPage.getByTestId('expenses-row').filter({ visible: true }).filter({ hasText: vendor });
  await expect(card).toBeVisible();
  await expect(card).not.toContainText('วันที่เอกสาร');
  await expect(card).toContainText(new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(new Date(documentDate)));
  await expect(card).toContainText('รอตรวจ');
  await expect(card).not.toContainText('อัปโหลดเว็บ');
  await expect(card).toContainText('ส่งเข้าระบบ');
  await expect(card).toContainText('เอกสารย้อนหลัง 51 วัน');

  // ส่งให้ตรวจ and batch upload return with ?highlight=id. A backdated row must open its
  // document month automatically, including after a fresh navigation with no saved filter.
  const highlightedRequestPromise = authedPage.waitForRequest((request) => {
    const url = new URL(request.url());
    return request.method() === 'GET'
      && url.pathname.endsWith(`/companies/${companyId}/expenses`)
      && url.searchParams.get('fromDate') === `${documentMonth}-01`;
  });
  await gotoCompany(authedPage, companyId, `/expenses?highlight=${created.id}`);
  await highlightedRequestPromise;
  await expect(authedPage.getByTestId('expenses-row').filter({ visible: true }).filter({ hasText: vendor }))
    .toHaveAttribute('data-highlighted', 'true');
});

// §19m: the first POST really commits; only its browser response is lost. Run against
// an isolated DB with --workers=1 because the paid-period assertions compare totals.
test('EXP-27 @smoke retries a real backdated partial expense payment on mobile without paying twice', async ({ apiAs, pageAs, request, companyId }, testInfo) => {
  test.skip(
    process.env['S3_E2E'] !== '1' && process.env['S3_E2E_ACTIVE'] !== '1',
    'EXP-27 needs a real primary receipt and confirmation; run with S3_E2E=1 and the isolated API/DB plus compose MinIO ready.',
  );
  const api = await apiAs('FINANCE');
  const page = await pageAs('FINANCE');
  const runtimeErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const created = await createExpenseWithReceipt(api, request, companyId, '100.00');
  testInfo.annotations.push({ type: 'own-expense', description: created.id });
  const expensePath = `companies/${companyId}/expenses/${created.id}`;
  const paymentPath = `/api/v1/${expensePath}/payment`;
  const paymentRoute = `**${paymentPath}`;
  let droppedResponses = 0;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (droppedResponses === 1 && message.location().url.endsWith(paymentPath)
      && message.text() === 'Failed to load resource: net::ERR_FAILED') return;
    consoleErrors.push(message.text());
  });
  const attempts: Array<{ body: string; clientTime: number; status: number; expenseId: string }> = [];
  let releaseFirstResponse = () => {};
  const firstResponseGate = new Promise<void>((resolve) => { releaseFirstResponse = resolve; });
  try {
    expect((await json<ExpenseSummary>(await api.post(`${expensePath}/mark-ready`, { data: {} }))).status)
      .toBe('READY_FOR_CONFIRMATION');
    expect((await json<ExpenseSummary>(await api.post(`${expensePath}/confirm`, { data: {} }))).status)
      .toBe('CONFIRMED');
    const before = await json<FullExpenseDetail>(await api.get(expensePath));
    expect(Number(before.grandTotalAmount)).toBe(100);
    expect(Number(before.paidAmount)).toBe(0);
    expect(before.payments).toHaveLength(0);

    const today = civilDate(new Date());
    const currentMonthStart = `${today.slice(0, 7)}-01`;
    const paidDay = addCivilDays(currentMonthStart, -1);
    const previousMonthStart = `${paidDay.slice(0, 7)}-01`;
    const readPaidPeriods = async () => {
      const previous = await json<IncomeExpenseLedgerSummary>(await api.get(
        `companies/${companyId}/income-expense-ledger/summary?from=${previousMonthStart}&to=${paidDay}`,
      ));
      const current = await json<IncomeExpenseLedgerSummary>(await api.get(
        `companies/${companyId}/income-expense-ledger/summary?from=${currentMonthStart}&to=${today}`,
      ));
      expect(previous.expense.available).toBe(true);
      expect(current.expense.available).toBe(true);
      return { previous: Number(previous.expense.paidExpenseTotal), current: Number(current.expense.paidExpenseTotal) };
    };
    const periodsBefore = await readPaidPeriods();
    const paidDate = new Date(`${paidDay}T00:00:00.000Z`);
    const monthName = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', month: 'long' }).format(paidDate);
    const calendarHeader = `${monthName} ${Number(paidDay.slice(0, 4)) + 543}`;
    const paidDateLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
      timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
    }).format(paidDate);

    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoCompany(page, companyId, `/expenses/${created.id}`);
    const card = page.getByRole('heading', { name: 'การจ่ายเงิน', exact: true }).locator('..');
    const amount = card.getByRole('textbox', { name: 'ยอดที่จ่าย', exact: true });
    const method = card.locator('label').filter({ hasText: 'วิธีจ่ายเงิน' }).getByRole('combobox');
    const paidAt = card.getByRole('combobox', { name: 'วันที่จ่ายเงินจริง', exact: true });
    await expect(card).toContainText('เลือกวันที่จ่ายเงินจริง แม้จะนำมาบันทึกภายหลัง');
    // What is owed is said once, in the box above the card.
    await expect(page.getByTestId('expense-detail-totals')).toContainText(/ค้างจ่าย\s*100\.00/);
    await expect(page.getByText(/^ต้องจ่าย ฿/)).toHaveCount(0);
    await expect(amount).toHaveValue('100.00');
    await amount.fill('40');
    await method.click();
    await page.getByRole('option', { name: 'เงินสด', exact: true }).click();
    await paidAt.click();
    await page.getByRole('button', { name: 'เดือนก่อนหน้า', exact: true }).click();
    const header = page.getByText(calendarHeader, { exact: true });
    await expect(header).toBeVisible();
    await header.locator('..').locator('..').getByRole('button', { name: String(Number(paidDay.slice(-2))), exact: true }).click();
    await expect(paidAt).toHaveText(paidDateLabel);

    await page.route(paymentRoute, async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const body = route.request().postData()!;
      const clientTime = await page.evaluate(() => Date.now());
      // No response or mutation stub: route.fetch uses the real BFF/auth/API transaction.
      const response = await route.fetch({ maxRetries: 0 });
      const result = await response.json() as ExpenseSummary;
      attempts.push({ body, clientTime, status: response.status(), expenseId: result.id });
      if (attempts.length === 1) {
        await firstResponseGate;
        droppedResponses += 1;
        await route.abort('failed');
      } else {
        await route.fulfill({ response });
      }
    });
    await card.getByRole('button', { name: /^บันทึกจ่าย(?:ส่วนที่เหลือ)? [\d,]+\.\d{2} บาท/ }).click();
    await expect.poll(() => attempts.length, { message: 'the real first payment transaction must finish before dropping its response' }).toBe(1);
    expect(attempts[0]!.status).toBe(201);
    expect(attempts[0]!.expenseId).toBe(created.id);
    await expect(amount).toBeDisabled();
    await expect(method).toHaveAttribute('aria-disabled', 'true');
    await expect(paidAt).toBeDisabled();
    await expect(card.getByRole('button', { name: 'กำลังบันทึก…', exact: true })).toBeDisabled();
    const firstCommit = await json<FullExpenseDetail>(await api.get(expensePath));
    expect(firstCommit.payments).toHaveLength(1);
    expect(Number(firstCommit.paidAmount)).toBe(40);
    expect(Number(firstCommit.outstandingAmount)).toBe(60);
    releaseFirstResponse();

    const retry = card.getByRole('button', { name: 'ลองบันทึกรายการเดิมอีกครั้ง', exact: true });
    await expect(retry).toBeEnabled();
    await expect(card.getByRole('status')).toContainText('ยังยืนยันผลการบันทึกไม่ได้');
    await expect(card.getByRole('status')).toContainText('ไม่เพิ่มยอดจ่ายซ้ำ');
    await expect(amount).toHaveValue('40');
    await expect(method).toHaveText('เงินสด');
    await expect(paidAt).toHaveText(paidDateLabel);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const desktopPath = testInfo.outputPath('expense-payment-lost-response-desktop.png');
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: desktopPath, fullPage: false });
    await testInfo.attach('expense-payment-lost-response-desktop', { path: desktopPath, contentType: 'image/png' });

    await page.setViewportSize({ width: 390, height: 844 });
    await retry.scrollIntoViewIfNeeded();
    await expect(retry).toBeVisible();
    await expect(paidAt).toHaveText(paidDateLabel);
    // Only Date advances, not timers; the visible form and its attempt stay mounted.
    await page.clock.setFixedTime(attempts[0]!.clientTime + 61_000);
    await retry.click();
    await expect(card.getByRole('button', { name: 'บันทึกจ่ายส่วนที่เหลือ 60.00 บาท', exact: true })).toBeEnabled();
    await expect(amount).toHaveValue('60.00');
    await expect(card.getByRole('status')).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(droppedResponses).toBe(1);
    expect(attempts[1]!.status).toBe(201);
    expect(attempts[1]!.expenseId).toBe(created.id);
    expect(attempts[1]!.clientTime - attempts[0]!.clientTime).toBeGreaterThanOrEqual(61_000);
    expect(attempts[1]!.body).toBe(attempts[0]!.body);
    const payload = JSON.parse(attempts[0]!.body) as Record<string, unknown>;
    expect(payload).toMatchObject({ paidAmount: '40', paymentMethod: 'CASH', paidAt: paidDay });
    expect(payload.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    const after = await json<FullExpenseDetail>(await api.get(expensePath));
    expect(after.status).toBe('CONFIRMED');
    expect(after.paymentStatus).toBe('PARTIALLY_PAID');
    expect(Number(after.paidAmount)).toBe(40);
    expect(Number(after.outstandingAmount)).toBe(60);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]!.id).toBe(firstCommit.payments[0]!.id);
    expect(after.payments[0]!.status).toBe('RECORDED');
    expect(after.payments[0]!.paymentMethod).toBe('CASH');
    expect(Number(after.payments[0]!.amount)).toBe(40);
    expect(after.payments[0]!.paidAt).toBe(`${paidDay}T00:00:00.000Z`);
    expect(civilDate(new Date(after.payments[0]!.paidAt))).toBe(paidDay);
    const history = card.getByText('ประวัติการจ่าย', { exact: true }).locator('..');
    await expect(history.locator(':scope > div')).toHaveCount(1);
    await expect(history).toContainText(`${paidDateLabel} · เงินสด`);
    await expect(history).toContainText('40.00 บาท');
    await expect(page.getByTestId('expense-detail-totals')).toContainText(/ค้างจ่าย\s*60\.00/);
    await expect(page.getByText(/^ต้องจ่าย ฿/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const mobilePath = testInfo.outputPath('expense-payment-replayed-mobile.png');
    // Let the deliberately induced transport-error toast expire before capturing success.
    await expect(page.getByText('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง', { exact: true })).toHaveCount(0);
    await history.scrollIntoViewIfNeeded();
    await page.screenshot({ path: mobilePath, fullPage: false });
    await testInfo.attach('expense-payment-replayed-mobile', { path: mobilePath, contentType: 'image/png' });
    const periodsAfter = await readPaidPeriods();
    expect(periodsAfter.previous - periodsBefore.previous).toBeCloseTo(40, 2);
    expect(periodsAfter.current - periodsBefore.current).toBeCloseTo(0, 2);
    await testInfo.attach('expense-payment-retry-api-proof', {
      body: Buffer.from(JSON.stringify({ expenseId: created.id, paidDay, attempts, before, firstCommit, after, periodsBefore, periodsAfter, runtimeErrors, consoleErrors }, null, 2)),
      contentType: 'application/json',
    });
    expect(runtimeErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    releaseFirstResponse();
    await page.unroute(paymentRoute);
    const current = await json<FullExpenseDetail>(await api.get(expensePath));
    if (current.status === 'CONFIRMED') {
      await json<ExpenseSummary>(await api.post(`${expensePath}/void`, { data: { reason: `EXP-27 own fixture cleanup ${created.id}` } }));
      const voided = await json<FullExpenseDetail>(await api.get(expensePath));
      expect(voided.status).toBe('VOIDED');
      expect(Number(voided.paidAmount)).toBe(0);
      expect(voided.payments.every((payment) => payment.status === 'VOIDED')).toBe(true);
      await testInfo.attach('expense-payment-own-fixture-voided', { body: Buffer.from(JSON.stringify(voided, null, 2)), contentType: 'application/json' });
    } else {
      testInfo.annotations.push({ type: 'fixture-preserved', description: `${created.id}: ${current.status}; normal void only accepts CONFIRMED expenses` });
    }
  }
});

// §19m error-response UI only: payment POSTs never reach the API. EXP-27 proves real replay.
test('EXP-28 @p1 distinguishes rejected, uncertain, and conflicting expense payment attempts', async ({ apiAs, pageAs, request, companyId }, testInfo) => {
  test.skip(
    process.env['S3_E2E'] !== '1' && process.env['S3_E2E_ACTIVE'] !== '1',
    'EXP-28 needs its own confirmed receipt-backed expense; use S3_E2E=1 with the isolated local API/DB and MinIO.',
  );
  const api = await apiAs('FINANCE');
  const page = await pageAs('FINANCE');
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const created = await createExpenseWithReceipt(api, request, companyId, '100.00');
  testInfo.annotations.push({ type: 'own-expense', description: created.id });
  testInfo.annotations.push({ type: 'evidence-limit', description: 'Mocked payment error envelopes only; no real payment POST or authorization decision.' });
  const expensePath = `companies/${companyId}/expenses/${created.id}`;
  const paymentRoute = `**/api/v1/${expensePath}/payment`;
  const forbidden = { status: 403, body: { statusCode: 403, message: 'Insufficient permissions.', error: 'Forbidden' } };
  // Exact Nest exception body shapes from the payment repository and permission guard.
  const responses = [
    { status: 400, body: { code: 'expense_payment_exceeds_outstanding', message: 'Payment amount must be positive and cannot exceed the outstanding amount.' } },
    forbidden,
    null, // network failure, not an HTTP refusal
    forbidden,
    { status: 409, body: { code: 'expense_payment_idempotency_conflict', message: 'This payment key was already used for a different payment.' } },
  ];
  const attempts: string[] = [];
  try {
    expect((await json<ExpenseSummary>(await api.post(`${expensePath}/mark-ready`, { data: {} }))).status).toBe('READY_FOR_CONFIRMATION');
    expect((await json<ExpenseSummary>(await api.post(`${expensePath}/confirm`, { data: {} }))).status).toBe('CONFIRMED');
    await page.route(paymentRoute, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      attempts.push(route.request().postData()!);
      const response = responses[attempts.length - 1];
      // Unexpected extra POSTs also abort; no error-state test can make a payment.
      if (!response) return route.abort('failed');
      return route.fulfill({ status: response.status, contentType: 'application/json', body: JSON.stringify(response.body) });
    });
    await gotoCompany(page, companyId, `/expenses/${created.id}`);
    const card = page.getByRole('heading', { name: 'การจ่ายเงิน', exact: true }).locator('..');
    const amount = card.getByRole('textbox', { name: 'ยอดที่จ่าย', exact: true });
    const method = card.getByRole('combobox', { name: 'วิธีจ่ายเงิน', exact: true });
    const submit = card.getByRole('button', { name: /^บันทึกจ่าย(?:ส่วนที่เหลือ)? [\d,]+\.\d{2} บาท/ });
    const retry = card.getByRole('button', { name: 'ลองบันทึกรายการเดิมอีกครั้ง', exact: true });
    const notice = card.getByRole('status');
    await expect(method).toBeVisible();
    await amount.fill('40');
    await submit.click();
    await expect(page.getByRole('alert').filter({ hasText: 'ยอดจ่ายต้องมากกว่า 0 และไม่เกินยอดคงเหลือที่ต้องจ่าย' }).first()).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(notice).toHaveCount(0);
    await expect(retry).toHaveCount(0);
    await amount.fill('41');
    await expect(notice).toHaveCount(0); // a rejected first attempt must not warn about duplicate payment on edit
    await submit.click();
    // A 403 reads the shared permission text (api-error-message.ts insufficient_permissions, since f98946566).
    await expect(page.getByRole('alert').filter({ hasText: 'คุณไม่มีสิทธิ์ทำรายการนี้ ขอสิทธิ์จากเจ้าของกิจการหรือผู้ดูแลสิทธิ์' }).first()).toBeVisible();
    await expect(submit).toBeEnabled();
    await expect(notice).toHaveCount(0);
    await expect(retry).toHaveCount(0);

    await submit.click(); // lost network response, with a fresh intent after definitive 403
    await expect(retry).toBeEnabled();
    await expect(notice).toContainText('ยังยืนยันผลการบันทึกไม่ได้');
    expect(attempts).toHaveLength(3);
    expect(JSON.parse(attempts[2]!).idempotencyKey).not.toBe(JSON.parse(attempts[1]!).idempotencyKey);
    await retry.click(); // a later 403 cannot disprove the earlier uncertain outcome
    await expect.poll(() => attempts.length).toBe(4);
    await expect(retry).toBeEnabled();
    await expect(notice).toContainText('ยังยืนยันผลการบันทึกไม่ได้');
    expect(attempts[3]).toBe(attempts[2]);
    await retry.click();
    await expect(card.getByRole('button', { name: 'ตรวจประวัติการจ่าย', exact: true })).toBeDisabled();
    await expect(notice).toContainText('ข้อมูลรายการนี้ไม่ตรงกับการจ่ายที่บันทึกไว้');
    await expect(retry).toHaveCount(0);
    expect(attempts).toHaveLength(5);
    expect(attempts[4]).toBe(attempts[2]);
    await amount.fill('42');
    await expect(submit).toBeEnabled();
    await expect(notice).toContainText('การบันทึกครั้งถัดไปเป็นรายการจ่ายใหม่');
    await expect(notice).toContainText('ตรวจประวัติการจ่ายก่อนเพื่อไม่ให้จ่ายซ้ำ');
    await expect(retry).toHaveCount(0);
    expect(attempts).toHaveLength(5); // editing never silently submits the new intent
    await amount.press('ArrowUp');
    await expect(amount).toHaveValue('42.01');
    await expect(notice).toContainText('การบันทึกครั้งถัดไปเป็นรายการจ่ายใหม่');
    expect(attempts).toHaveLength(5); // keyboard edits also require a separate explicit save
    const unchanged = await json<FullExpenseDetail>(await api.get(expensePath));
    expect(unchanged.status).toBe('CONFIRMED');
    expect(Number(unchanged.paidAmount)).toBe(0);
    expect(Number(unchanged.outstandingAmount)).toBe(100);
    expect(unchanged.payments).toHaveLength(0);
    expect(runtimeErrors).toEqual([]);
    await testInfo.attach('expense-payment-mocked-error-ui-proof', {
      body: Buffer.from(JSON.stringify({ expenseId: created.id, responses, attempts, unchanged, runtimeErrors, evidenceLimit: 'Payment responses mocked; no real payment mutation.' }, null, 2)),
      contentType: 'application/json',
    });
  } finally {
    await page.unroute(paymentRoute);
    const current = await json<FullExpenseDetail>(await api.get(expensePath));
    if (current.status === 'CONFIRMED') {
      await json<ExpenseSummary>(await api.post(`${expensePath}/void`, { data: { reason: `EXP-28 own fixture cleanup ${created.id}` } }));
      const voided = await json<FullExpenseDetail>(await api.get(expensePath));
      expect(voided.status).toBe('VOIDED');
      expect(Number(voided.paidAmount)).toBe(0);
      expect(voided.payments).toHaveLength(0);
      await testInfo.attach('expense-payment-error-ui-own-fixture-voided', { body: Buffer.from(JSON.stringify(voided, null, 2)), contentType: 'application/json' });
    } else {
      testInfo.annotations.push({ type: 'fixture-preserved', description: `${created.id}: ${current.status}; normal void only accepts CONFIRMED expenses` });
    }
  }
});

// §19m: both POSTs are real; only the first post-save detail GET is failed.
test('EXP-29 @p1 retains a committed payment intent until its detail refresh succeeds', async ({ apiAs, pageAs, request, companyId }, testInfo) => {
  test.skip(
    process.env['S3_E2E'] !== '1' && process.env['S3_E2E_ACTIVE'] !== '1',
    'EXP-29 needs a real receipt-backed payment; use S3_E2E=1 with the isolated local API/DB and MinIO.',
  );
  const api = await apiAs('FINANCE');
  const page = await pageAs('FINANCE');
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  const created = await createExpenseWithReceipt(api, request, companyId, '100.00');
  testInfo.annotations.push({ type: 'own-expense', description: created.id });
  const expensePath = `companies/${companyId}/expenses/${created.id}`;
  const paymentPath = `/api/v1/${expensePath}/payment`;
  const detailRoute = `**/api/v1/${expensePath}`;
  const attempts: Array<{ body: string; status: number }> = [];
  let failedDetailReads = 0;
  page.on('response', (response) => {
    const request = response.request();
    if (request.method() === 'POST' && new URL(request.url()).pathname === paymentPath) {
      attempts.push({ body: request.postData()!, status: response.status() });
    }
  });
  try {
    expect((await json<ExpenseSummary>(await api.post(`${expensePath}/mark-ready`, { data: {} }))).status).toBe('READY_FOR_CONFIRMATION');
    expect((await json<ExpenseSummary>(await api.post(`${expensePath}/confirm`, { data: {} }))).status).toBe('CONFIRMED');
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoCompany(page, companyId, `/expenses/${created.id}`);
    const card = page.getByRole('heading', { name: 'การจ่ายเงิน', exact: true }).locator('..');
    const amount = card.getByRole('textbox', { name: 'ยอดที่จ่าย', exact: true });
    const submit = card.getByRole('button', { name: /^บันทึกจ่าย(?:ส่วนที่เหลือ)? [\d,]+\.\d{2} บาท/ });
    const retry = card.getByRole('button', { name: 'ลองบันทึกรายการเดิมอีกครั้ง', exact: true });
    const notice = card.getByRole('status');
    await amount.fill('40');
    await page.route(detailRoute, (route) => {
      if (route.request().method() === 'GET' && attempts.length === 1 && attempts[0]!.status === 201 && failedDetailReads === 0) {
        failedDetailReads += 1;
        return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ statusCode: 500, message: 'Internal server error' }) });
      }
      return route.fallback();
    });
    await submit.click();
    await expect(retry).toBeEnabled();
    await expect(notice).toContainText('บันทึกการจ่ายแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ');
    await expect(notice).toContainText('ไม่เพิ่มยอดจ่ายซ้ำ');
    await expect(notice).not.toContainText('ยังยืนยันผลการบันทึกไม่ได้');
    await expect(amount).toHaveValue('40');
    await expect(submit).toHaveCount(0);
    // Next's empty route announcer is outside main; check the actual expense error surface.
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    expect(failedDetailReads).toBe(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.status).toBe(201);
    const firstCommit = await json<FullExpenseDetail>(await api.get(expensePath));
    expect(firstCommit.payments).toHaveLength(1);
    expect(Number(firstCommit.paidAmount)).toBe(40);
    expect(Number(firstCommit.outstandingAmount)).toBe(60);
    // Desktop Chromium wheel interaction must not silently replace the saved intent.
    await amount.focus();
    await amount.hover();
    await page.mouse.wheel(0, 100);
    await expect(amount).toHaveValue('40');
    await expect(notice).toContainText('บันทึกการจ่ายแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ');
    expect(attempts).toHaveLength(1);
    const pendingPath = testInfo.outputPath('expense-payment-saved-refresh-failed.png');
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: pendingPath, fullPage: false });
    await testInfo.attach('expense-payment-saved-refresh-failed', { path: pendingPath, contentType: 'image/png' });

    await retry.click(); // real POST replay with the original immutable intent
    await expect(submit).toBeEnabled();
    await expect(amount).toHaveValue('60.00');
    await expect(notice).toHaveCount(0);
    await expect(retry).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('expense-detail-totals')).toContainText(/ค้างจ่าย\s*60\.00/);
    await expect(page.getByText(/^ต้องจ่าย ฿/)).toHaveCount(0);
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.status).toBe(201);
    expect(attempts[1]!.body).toBe(attempts[0]!.body);
    const payload = JSON.parse(attempts[0]!.body) as { paidAmount: string; paidAt: string; idempotencyKey: string };
    expect(payload.paidAmount).toBe('40');
    expect(payload.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const after = await json<FullExpenseDetail>(await api.get(expensePath));
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]!.id).toBe(firstCommit.payments[0]!.id);
    expect(after.payments[0]!.paidAt).toBe(`${payload.paidAt}T00:00:00.000Z`);
    expect(Number(after.paidAmount)).toBe(40);
    expect(Number(after.outstandingAmount)).toBe(60);
    const history = card.getByText('ประวัติการจ่าย', { exact: true }).locator('..');
    await expect(history.locator(':scope > div')).toHaveCount(1);
    await expect(history).toContainText('40.00 บาท');
    expect(runtimeErrors).toEqual([]);
    const refreshedPath = testInfo.outputPath('expense-payment-refreshed-on-replay.png');
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: refreshedPath, fullPage: false });
    await testInfo.attach('expense-payment-refreshed-on-replay', { path: refreshedPath, contentType: 'image/png' });
    await testInfo.attach('expense-payment-post-write-refresh-proof', {
      body: Buffer.from(JSON.stringify({ expenseId: created.id, attempts, failedDetailReads, firstCommit, after, runtimeErrors, evidenceLimit: 'Real payment POSTs; only one following detail GET failed with a mocked 500.' }, null, 2)),
      contentType: 'application/json',
    });
  } finally {
    await page.unroute(detailRoute);
    const current = await json<FullExpenseDetail>(await api.get(expensePath));
    if (current.status === 'CONFIRMED') {
      await json<ExpenseSummary>(await api.post(`${expensePath}/void`, { data: { reason: `EXP-29 own fixture cleanup ${created.id}` } }));
      const voided = await json<FullExpenseDetail>(await api.get(expensePath));
      expect(voided.status).toBe('VOIDED');
      expect(Number(voided.paidAmount)).toBe(0);
      expect(voided.payments.every((payment) => payment.status === 'VOIDED')).toBe(true);
      await testInfo.attach('expense-payment-refresh-own-fixture-voided', { body: Buffer.from(JSON.stringify(voided, null, 2)), contentType: 'application/json' });
    } else {
      testInfo.annotations.push({ type: 'fixture-preserved', description: `${created.id}: ${current.status}; normal void only accepts CONFIRMED expenses` });
    }
  }
});

// Filter retention — docs/specs/list-filter-retention-spec.md §2, §14.
//
// Every step here must be a CLIENT-SIDE navigation. gotoCompany() is page.goto(), a full
// document load, which resets the store by design — using it would make the reset tests pass
// even if the feature did not exist, and the retention test fail even though it works.
//
// Date order changes no selection, so a row remains available for the return trip.
test.describe('expense list filter retention', () => {
  const sort = (page: any, order: 'newest' | 'oldest') => page.getByRole('button', {
    name: order === 'newest' ? 'วันที่ ใหม่ไปเก่า กดเพื่อเรียงเก่าไปใหม่' : 'วันที่ เก่าไปใหม่ กดเพื่อเรียงใหม่ไปเก่า', exact: true,
  }).filter({ visible: true });

  async function chooseOldest(page: any) {
    await expect(sort(page, 'newest')).toBeVisible();
    await sort(page, 'newest').click();
    await expect(sort(page, 'oldest')).toBeVisible();
  }

  /** Navigate the way a user does — the sidebar — so Next routes on the client. */
  async function clickSidebar(page: any, hrefSuffix: string) {
    const link = page.locator(`aside a[href$="${hrefSuffix}"]`).first();
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await page.waitForURL(`**${hrefSuffix}`);
  }

  test('EXP-20 @p1 keeps the filter across a row detail round trip', async ({ authedPage, api, companyId }) => {
    const ownDraft = await createExpense(api, companyId);
    try {
      await gotoCompany(authedPage, companyId, '/expenses');
      await chooseOldest(authedPage);

      const listQuery = new URL(authedPage.url()).searchParams;
      // Into the detail route by clicking a row, and back out via the กลับ link — both client-side.
      await authedPage.getByTestId('expenses-row').filter({ visible: true }).first().click();
      await authedPage.waitForURL(/\/expenses\/[^/?]+\?back=/);
      await authedPage.getByRole('link', { name: 'กลับไปรายการ', exact: true }).click();
      await authedPage.waitForURL(/\/expenses\?.*highlight=/);
      const returned = new URL(authedPage.url()).searchParams;
      for (const key of ['month', 'chip', 'query', 'dateOrder', 'page']) expect(returned.get(key)).toBe(listQuery.get(key));
      await expect(authedPage.locator('[data-testid="expenses-row"][data-highlighted]').filter({ visible: true })).toBeVisible();

      await expect(sort(authedPage, 'oldest')).toBeVisible();
    } finally {
      expect((await api.delete(`companies/${companyId}/expenses/${ownDraft.id}`)).status()).toBe(204);
    }
  });

  test('EXP-21 @p1 resets the filter on reload', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    await chooseOldest(authedPage);
    await authedPage.reload();
    await expect(sort(authedPage, 'newest')).toBeVisible();
  });

  test('EXP-22 @p1 resets the filter when another menu is visited', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    await chooseOldest(authedPage);
    await clickSidebar(authedPage, '/dashboard');
    await clickSidebar(authedPage, '/expenses');
    await expect(sort(authedPage, 'newest')).toBeVisible();
  });

  // A sibling tab is a different sidebar entry, so it counts as a menu change (owner decision
  // 2026-08-06) even though its path nests under /expenses.
  test('EXP-23 @p2 resets the filter when a sibling expense tab is visited', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    await chooseOldest(authedPage);
    await clickSidebar(authedPage, '/expenses/evidence');
    await clickSidebar(authedPage, '/expenses');
    await expect(sort(authedPage, 'newest')).toBeVisible();
  });
});


test('EXP-EVIDENCE @p1 pending evidence saves and reopens without enabling Next or creating a certificate', async ({ authedPage: page, api, companyId }, testInfo) => {
  const created = await createExpense(api, companyId);
  testInfo.annotations.push({ type: 'own-expense', description: created.id });
  const path = `companies/${companyId}/expenses/${created.id}`;
  await json(await api.patch(path, { data: { expectedUpdatedAt: created.updatedAt, vendorNameSnapshot: 'Synthetic review test vendor' } }));
  await gotoCompany(page, companyId, `/expenses/${created.id}`);
  const next = page.getByRole('button', { name: 'ถัดไป', exact: true });
  await next.click();
  const card = page.getByRole('heading', { name: 'ประเภทเอกสารและหมวดหมู่', exact: true }).locator('..');
  await expect(next).toBeDisabled();
  await chooseThemedOption(page, page.getByRole('combobox', { name: 'ประเภทเอกสาร', exact: true }), 'สลิปโอนเงิน');
  await card.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
  await expect.poll(async () => (await json<FullExpenseDetail>(await api.get(path))).sourceDocumentType).toBe('TRANSFER_SLIP');
  await page.reload();
  await next.click();
  await expect(page.getByRole('combobox', { name: 'ประเภทเอกสาร', exact: true })).toContainText('สลิปโอนเงิน');
  await expect(next).toBeDisabled();
  await expect(card.getByRole('button', { name: 'บันทึกการตรวจ', exact: true })).toBeDisabled();
  const saved = await json<FullExpenseDetail>(await api.get(path));
  expect(saved.aiVerificationSummaryJson?.documentReview).toBeUndefined();
  expect(saved.substituteReceiptEvidence).toBeFalsy();
});

// Opening export options must not move the trigger or the list, including on mobile.
for (const width of [390, 1280, 1556]) {
  test(`EXP-EXPORT @p1 export dialog keeps layout and offers one accountant file at ${width}px`, async ({ authedPage: page, companyId }) => {
    await page.setViewportSize({ width, height: 900 });
    const requests: Array<Record<string, unknown>> = [];
    await page.route('**/expenses/accounting-software-export', async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, json: { message: 'ทดสอบส่งออกไม่สำเร็จ กรุณาลองอีกครั้ง' } });
    });
    await gotoCompany(page, companyId, '/expenses');
    const trigger = page.getByRole('button', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true });
    const listSearch = page.getByPlaceholder('ค้นหาผู้ขายหรือเลขที่', { exact: true });
    await trigger.scrollIntoViewIfNeeded();
    // The brand fonts swap in once loaded (font-display: swap) and widen the Thai label by ~5 px, so
    // measure after they have loaded: only the dialog may move things in this test.
    await page.evaluate(async () => { await document.fonts.ready; });
    const before = { trigger: await trigger.boundingBox(), list: await listSearch.boundingBox() };
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'ส่งออก Excel ให้สำนักงานบัญชี', exact: true });
    await expect(dialog).toBeVisible();
    expect(await trigger.boundingBox()).toEqual(before.trigger);
    expect(await listSearch.boundingBox()).toEqual(before.list);
    expect(requests).toHaveLength(0);
    await expect(dialog.getByRole('combobox', { name: 'รายละเอียดในไฟล์', exact: true })).toHaveCount(0);
    await dialog.getByRole('combobox', { name: 'รูปแบบไฟล์', exact: true }).click();
    await page.getByRole('option', { name: 'ไฟล์แยกตามหมวด', exact: true }).click();
    await dialog.getByRole('button', { name: 'ดาวน์โหลด Excel', exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].preset).toBe('purchase_journal');
    expect(requests[0]).not.toHaveProperty('columnSet');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(await trigger.boundingBox()).toEqual(before.trigger);
    await trigger.click();
    await expect(dialog.getByRole('combobox', { name: 'รายละเอียดในไฟล์', exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('combobox', { name: 'รูปแบบไฟล์', exact: true })).toHaveText('ไฟล์แยกตามหมวด');
    await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
    expect(await listSearch.boundingBox()).toEqual(before.list);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}

test('EXP-DATE upload leaves receipt date to AI or review and omits it from the request', async ({ authedPage: page, api, companyId }, info) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/expenses/receipt-uploads', async route => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { message: 'Synthetic upload stopped before creating data' } });
  });
  await gotoCompany(page, companyId, '/expenses/upload');
  const { items: branches } = await json<{ items: Array<{ id: string; name: string; type: string }> }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  await chooseThemedOption(page, page.getByRole('combobox', { name: 'สาขา', exact: true }), branchOptionName(branches[0]!));
  await expect(page.getByRole('combobox', { name: 'วันที่ในใบเสร็จ', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('receipt-upload-steps.png'), fullPage: true });
  await page.locator('input[type=file].hidden').setInputFiles({ name: 'synthetic-receipt.png', mimeType: 'image/png', buffer: uniqueReceiptPng() });
  await page.getByRole('button', { name: /^ส่งใบเสร็จ(?: \d+ ใบ)?$/ }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).not.toHaveProperty('expenseDate');
  await expect(page.getByRole('combobox', { name: 'วันที่ในใบเสร็จ', exact: true })).toHaveCount(0);
});

for (const width of [390, 1280, 1556]) {
  // 2026-10-13: the three-step explainer box of this page was removed (thai-ux-standard §1.3, §3.1: the page title and
  // the one button say it). What this test keeps protecting at both widths: the page fits the screen and offers its
  // one action without a second heading that repeats the title.
  test(`EXP-STEPS signature page offers its one action at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoCompany(page, companyId, '/expenses/signatures');
    await expect(page.getByRole('heading', { name: 'ลายเซ็นของฉันทำงานอย่างไร', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'ลายเซ็นของฉัน', exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^(เพิ่มลายเซ็น|เปลี่ยนลายเซ็น)$/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`signature-page-${width}.png`), fullPage: true });
  });
}

test('EXP-DATE intake API retains unknown or explicitly entered receipt dates', async ({ api, companyId }) => {
  const { items: branches } = await json<{ items: Array<{ id: string }> }>(await api.get(`companies/${companyId}/branches?status=ACTIVE&pageSize=100`));
  for (const date of [undefined, '2026-09-12']) {
    const intent = await json<ReceiptUploadIntent>(await api.post(`companies/${companyId}/expenses/receipt-uploads`, { data: {
      originalFileName: 'synthetic-date-check.png', mimeType: 'image/png', byteSize: 12, branchId: branches[0]!.id,
      note: unique('EXP-DATE own disposable fixture'), ...(date ? { expenseDate: date } : {}),
    } }));
    try {
      const detail = await json<FullExpenseDetail>(await api.get(`companies/${companyId}/expenses/${intent.expenseId}`));
      expect(detail.aiVerificationSummaryJson?.dateStatus).toBe(date ? 'verified' : 'unverified');
      if (date) expect(detail.expenseDate.slice(0, 10)).toBe(date);
      else expect(detail.aiVerificationSummaryJson?.missingFields).toContain('expenseDate');
    } finally {
      expect((await api.delete(`companies/${companyId}/expenses/${intent.expenseId}`)).status()).toBe(204);
    }
  }
});
