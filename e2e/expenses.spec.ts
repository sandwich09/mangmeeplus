import { deflateSync, crc32 } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { addCivilDays, civilDate } from '@watchdog-bms/contracts';
import { test, expect } from './harness/fixtures';
import { gotoCompany, json, unique } from './harness/e2e-utils';

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
  return json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses`, {
    data: {
      captureSource: 'WEB_MANUAL',
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

// Confirming now requires either a primary receipt attachment or a fully-issued substitute
// receipt certificate (see ConfirmExpenseUseCase.execute in expense-draft.use-case.ts) -- a
// bare missingReceiptReason no longer reaches CONFIRMED. Tests that must actually confirm
// attach a throwaway receipt instead of relying on createExpense()'s missingReceiptReason.
async function createExpenseWithReceipt(api: any, request: any, companyId: string, amount = '1000.00') {
  const created = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses`, {
    data: {
      captureSource: 'WEB_MANUAL',
      expenseDate: new Date().toISOString(),
      vatMode: 'NO_VAT',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      note: unique('E2E expense'),
      lines: [{ lineNumber: 1, description: unique('E2E expense line'), quantity: '1', unitPrice: amount }],
    },
  }));
  const receiptBytes = uniqueReceiptPng();
  const intent = await json<UploadIntent>(await api.post(`companies/${companyId}/attachments/upload-intent`, {
    data: { originalFileName: unique('e2e-primary-receipt') + '.png', mimeType: 'image/png', byteSize: receiptBytes.length, visibility: 'INTERNAL' },
  }));
  const uploaded = await request.put(intent.uploadUrl, { data: receiptBytes, headers: { ...intent.uploadHeaders, 'Content-Type': 'image/png' } });
  expect(uploaded.status()).toBe(200);
  const completed = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses/${created.id}/receipt-uploads/${intent.attachmentId}/complete`, {
    data: { byteSize: receiptBytes.length, purpose: 'expense.receipt.primary' },
  }));
  return completed;
}

test.describe('EXP — expenses + receipts', () => {
  test('EXP-01 @smoke expenses list renders filters and table surface', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    await expect(authedPage.getByRole('heading', { name: /ค่าใช้จ่าย|Expenses/i })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /ทั้งหมด/ })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /ฉบับร่าง/ })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /รอตรวจสอบ/ })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /ยืนยันแล้ว/ })).toBeVisible();
  });

  test('EXP-02 @p1 summary tiles render numeric values', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    for (const label of [/ค่าใช้จ่ายรวม/, /ภาษีซื้อ \(VAT\)/, /ค้างจ่าย/, /เกินกำหนดชำระ/]) {
      await expect(authedPage.getByText(label)).toBeVisible();
    }
    await expect(authedPage.locator('main, #workspace-main').getByText(/฿|0|1|2|3|4|5|6|7|8|9/).first()).toBeVisible();
  });

  test('EXP-03 @smoke creates draft expense via API and verifies list truth', async ({ authedPage, api, companyId }) => {
    const created = await createExpense(api, companyId);
    await gotoCompany(authedPage, companyId, `/expenses?expenseId=${created.id}`);
    await expect(authedPage.getByText(/ฉบับร่าง|DRAFT/i).first()).toBeVisible();

    const body = await json<ExpenseList>(await api.get(`companies/${companyId}/expenses?pageSize=100`));
    expect(body.data.some((expense) => expense.id === created.id && expense.status === 'DRAFT')).toBe(true);
  });

  test('EXP-04 @p1 expense detail renders totals and transitions', async ({ authedPage, api, companyId }) => {
    const created = await createExpense(api, companyId);
    await gotoCompany(authedPage, companyId, `/expenses?expenseId=${created.id}`);
    // guided stepper opens on the vendor+items step, where the money summary lives
    await expect(authedPage.getByText('ยอดก่อนหักส่วนลด', { exact: true })).toBeVisible();
    await expect(authedPage.getByText('ฐานภาษี (ยอดก่อน VAT)', { exact: true })).toBeVisible();
    await expect(authedPage.getByText('ยอดรวมทั้งสิ้น', { exact: true })).toBeVisible();
    // The stepper is display-only: reach the final step through ถัดไป. A vendor name is
    // required first — createExpense() leaves it empty, which disables ถัดไป by validation.
    await authedPage.getByRole('textbox', { name: /ชื่อผู้ขาย/ }).first().fill('E2E Vendor');
    await authedPage.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await authedPage.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(authedPage.getByRole('button', { name: /ส่งตรวจสอบ/ })).toBeVisible();
  });

  test('EXP-04A @p1 cancellation dialog keeps or rejects a draft with API truth', async ({ authedPage, api, companyId }) => {
    const created = await createExpense(api, companyId);
    await gotoCompany(authedPage, companyId, `/expenses/${created.id}`);
    // ยกเลิกรายการ renders on every guided step now that the stepper is display-only.
    await authedPage.getByRole('button', { name: 'ยกเลิกรายการ', exact: true }).click();

    const dialog = authedPage.getByRole('dialog', { name: 'ยืนยันการยกเลิกรายการ' });
    const reason = dialog.getByRole('textbox', { name: 'เหตุผลการยกเลิกรายการ' });
    const confirm = dialog.getByRole('button', { name: 'ยืนยัน', exact: true });
    await expect(dialog).toBeVisible();
    await expect(confirm).toBeDisabled();
    await reason.fill('ยังไม่ยกเลิกในรอบแรก');
    await expect(confirm).toBeEnabled();
    await dialog.getByRole('button', { name: 'ยังไม่ยกเลิก', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect((await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`))).status).toBe('DRAFT');

    await authedPage.getByRole('button', { name: 'ยกเลิกรายการ', exact: true }).click();
    await expect(reason).toHaveValue('');
    await reason.fill('บันทึกรายการผิด');
    await confirm.click();
    await expect(dialog).toBeHidden();
    expect((await json<ExpenseDetail>(await api.get(`companies/${companyId}/expenses/${created.id}`))).status).toBe('REJECTED');
  });

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

    const receiptBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const intent = await json<ReceiptUploadIntent>(await api.post(`companies/${companyId}/expenses/receipt-uploads`, {
      data: {
        originalFileName: unique('e2e-receipt') + '.png',
        mimeType: 'image/png',
        byteSize: receiptBytes.length,
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

    const receiptBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const intent = await json<ReceiptUploadIntent>(await api.post(`companies/${companyId}/expenses/receipt-uploads`, {
      data: {
        originalFileName: unique('e2e-extraction-receipt') + '.png',
        mimeType: 'image/png',
        byteSize: receiptBytes.length,
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
    await authedPage.getByRole('button', { name: /ยืนยันแล้ว/ }).click();
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
  const today = new Date().toISOString().slice(0, 10);

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

test('EXP-26 @p1 keeps a backdated document in its intake month and labels both dates', async ({ authedPage, api, companyId }) => {
  const intakeDate = civilDate(new Date());
  const documentDate = addCivilDays(intakeDate, -51);
  const vendor = unique('EXP-26 backdated vendor');
  const created = await json<ExpenseSummary>(await api.post(`companies/${companyId}/expenses`, {
    data: {
      captureSource: 'WEB_MANUAL',
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
      && url.searchParams.has('uploadedFromDate');
  });
  await gotoCompany(authedPage, companyId, '/expenses');
  const listUrl = new URL((await listRequestPromise).url());
  const [year, month] = intakeDate.slice(0, 7).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year!, month!, 0)).getUTCDate();
  expect(listUrl.searchParams.get('uploadedFromDate')).toBe(`${intakeDate.slice(0, 7)}-01`);
  expect(listUrl.searchParams.get('uploadedToDate')).toBe(`${intakeDate.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`);
  expect(listUrl.searchParams.get('fromDate')).toBeNull();
  expect(listUrl.searchParams.get('toDate')).toBeNull();

  const row = authedPage.getByTestId('expenses-row').filter({ hasText: vendor });
  await expect(row).toBeVisible();
  await expect(row).toContainText('วันที่เอกสาร');
  await expect(row).toContainText('ส่งเข้าระบบ');
  await expect(row).toContainText('เอกสารย้อนหลัง 51 วัน');
  await expect(authedPage.getByTestId('expenses-row').filter({ hasText: sameMonthVendor })).not.toContainText('เอกสารย้อนหลัง');

  const exportRequestPromise = authedPage.waitForRequest((request) => (
    request.method() === 'POST' && new URL(request.url()).pathname.endsWith(`/companies/${companyId}/expenses/accountant-package`)
  ));
  await authedPage.getByRole('button', { name: 'ส่งออก Excel' }).click();
  const exportPayload = (await exportRequestPromise).postDataJSON();
  expect(exportPayload.dateField).toBe('expenseDate');
  expect(exportPayload.fromDate).toBe(`${intakeDate.slice(0, 7)}-01`);
  expect(exportPayload.toDate).toBe(`${intakeDate.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`);

  await authedPage.setViewportSize({ width: 390, height: 844 });
  await authedPage.reload();
  const card = authedPage.getByTestId('expenses-card').filter({ hasText: vendor });
  await expect(card).toBeVisible();
  await expect(card).toContainText('วันที่เอกสาร');
  await expect(card).toContainText('ส่งเข้าระบบ');
  await expect(card).toContainText('เอกสารย้อนหลัง 51 วัน');
});

// Filter retention — docs/specs/list-filter-retention-spec.md §2, §14.
//
// Every step here must be a CLIENT-SIDE navigation. gotoCompany() is page.goto(), a full
// document load, which resets the store by design — using it would make the reset tests pass
// even if the feature did not exist, and the retention test fail even though it works.
//
// The probe is the export-columns select: it is retained exactly like the period, but unlike
// the period, chip and search it does not filter the list, so a row stays clickable for the
// round trip. All six retained values share one mechanism, so proving one proves it.
test.describe('expense list filter retention', () => {
  const SUMMARY = 'แบบย่อ (อ่านง่าย)';
  const FULL = 'แบบเต็ม (สำนักงานบัญชี)';
  const columns = (page: any) => page.getByRole('combobox', { name: 'คอลัมน์ที่ส่งออก' });

  async function chooseFullColumns(page: any) {
    await expect(columns(page)).toHaveText(SUMMARY);
    await columns(page).click();
    await page.getByRole('option', { name: FULL, exact: true }).click();
    await expect(columns(page)).toHaveText(FULL);
  }

  /** Navigate the way a user does — the sidebar — so Next routes on the client. */
  async function clickSidebar(page: any, hrefSuffix: string) {
    const link = page.locator(`aside a[href$="${hrefSuffix}"]`).first();
    await link.scrollIntoViewIfNeeded();
    await link.click();
    await page.waitForURL(`**${hrefSuffix}`);
  }

  test('EXP-20 @p1 keeps the filter across a row detail round trip', async ({ authedPage, api, companyId }) => {
    await createExpense(api, companyId);
    await gotoCompany(authedPage, companyId, '/expenses');
    await chooseFullColumns(authedPage);

    // Into the detail route by clicking a row, and back out via the กลับ link — both client-side.
    await authedPage.getByTestId('expenses-row').first().click();
    await authedPage.waitForURL(/\/expenses\/[^/]+$/);
    await authedPage.getByRole('link', { name: /กลับไปรายการค่าใช้จ่าย|Back to expenses/ }).click();
    await authedPage.waitForURL(/\/expenses$/);

    await expect(columns(authedPage)).toHaveText(FULL);
  });

  test('EXP-21 @p1 resets the filter on reload', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    await chooseFullColumns(authedPage);
    await authedPage.reload();
    await expect(columns(authedPage)).toHaveText(SUMMARY);
  });

  test('EXP-22 @p1 resets the filter when another menu is visited', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    await chooseFullColumns(authedPage);
    await clickSidebar(authedPage, '/dashboard');
    await clickSidebar(authedPage, '/expenses');
    await expect(columns(authedPage)).toHaveText(SUMMARY);
  });

  // A sibling tab is a different sidebar entry, so it counts as a menu change (owner decision
  // 2026-08-06) even though its path nests under /expenses.
  test('EXP-23 @p2 resets the filter when a sibling expense tab is visited', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/expenses');
    await chooseFullColumns(authedPage);
    await clickSidebar(authedPage, '/expenses/evidence');
    await clickSidebar(authedPage, '/expenses');
    await expect(columns(authedPage)).toHaveText(SUMMARY);
  });
});
