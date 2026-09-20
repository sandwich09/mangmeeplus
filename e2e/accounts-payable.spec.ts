import { test, expect } from './harness/fixtures';
import { branchOptionName, chooseThemedOption, firstActiveBranch, gotoCompany, json, unique, useWorkspaceBranch } from './harness/e2e-utils';

type Supplier = { id: string; displayNameSnapshot: string };
type VendorBill = { id: string; status: string; dueDate: string; netPayableAmount: string; supplierId: string; supplierDocumentNumber?: string; taxInvoiceNumber?: string };
type VendorBillPage = { data: VendorBill[] };

async function createSupplier(api: any, companyId: string) {
  return json<Supplier>(await api.post(`companies/${companyId}/procurement/suppliers`, {
    data: { displayName: unique('E2E AP supplier'), supplierType: 'JURISTIC_PERSON', defaultCurrency: 'THB' },
  }));
}

async function createVendorBill(api: any, companyId: string) {
  const supplier = await createSupplier(api, companyId);
  const branch = await firstActiveBranch(api, companyId);
  const today = new Date().toISOString();
  const due = new Date(Date.now() + 7 * 86400000).toISOString();
  const bill = await json<VendorBill>(await api.post(`companies/${companyId}/accounts-payable/vendor-bills`, {
    data: {
      supplierId: supplier.id,
      branchId: branch.id,
      billDate: today,
      dueDate: due,
      currency: 'THB',
      vatMode: 'NO_VAT',
      supplierDocumentNumber: unique('E2E-BILL'),
      subtotalAmount: '100.00',
      discountAmount: '0.00',
      taxableAmount: '100.00',
      vatAmount: '0.00',
      inputVatClaimStatus: 'NON_CLAIMABLE',
      whtAmount: '0.00',
      grandTotalAmount: '100.00',
      netPayableAmount: '100.00',
      matchingMode: 'NONE',
      lines: [{
        lineNumber: 1,
        lineType: 'SERVICE',
        description: unique('E2E AP line'),
        unitName: 'each',
        quantity: '1',
        unitPrice: '100.00',
        discountAmount: '0.00',
        vatMode: 'NO_VAT',
        vatAmount: '0.00',
        inputVatClaimStatus: 'NON_CLAIMABLE',
        whtAmount: '0.00',
        lineSubtotalAmount: '100.00',
        lineTotalAmount: '100.00',
      }],
    },
  }));
  return { supplier, bill };
}

test.describe('AP — accounts payable', () => {
  test('AP-01 @smoke accounts payable page renders bill and aging surface', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/accounts-payable');
    await expect(authedPage.getByRole('heading', { name: /เจ้าหนี้การค้า|Accounts Payable/i })).toBeVisible();
    // Keep the tab selector exact so it cannot match form actions.
    await expect(authedPage.getByRole('button', { name: 'ใบวางบิล', exact: true })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /AP Aging|Aging/i })).toBeVisible();
  });

  test('AP-02 @p1 creates a payable and verifies due amount through API', async ({ authedPage, api, companyId }) => {
    const { supplier, bill } = await createVendorBill(api, companyId);
    await gotoCompany(authedPage, companyId, '/accounts-payable');
    await expect(authedPage.getByRole('heading', { name: /เจ้าหนี้การค้า|Accounts Payable/i })).toBeVisible();

    const detail = await json<VendorBill>(await api.get(`companies/${companyId}/accounts-payable/vendor-bills/${bill.id}`));
    expect(detail.supplierId).toBe(supplier.id);
    expect(Number(detail.netPayableAmount)).toBe(100);
    expect(detail.dueDate).toContain(bill.dueDate.slice(0, 10));

    const list = await json<VendorBillPage>(await api.get(`companies/${companyId}/accounts-payable/vendor-bills?pageSize=100`));
    expect(list.data.some((item) => item.id === bill.id)).toBe(true);
    expect(supplier.displayNameSnapshot).toBeTruthy();
  });

  test('AP-03 @p1 enters a supplier source number in the form and explains duplicate rejection', async ({ authedPage, api, companyId }) => {
    // The vendor-bill form has no branch field; it posts whatever the header selector holds.
    await useWorkspaceBranch(authedPage, companyId, (await firstActiveBranch(api, companyId)).id);
    const suppliersResponsePromise = authedPage.waitForResponse((response) => response.request().method() === 'GET'
      && new URL(response.url()).pathname.endsWith(`/companies/${companyId}/procurement/suppliers`));
    await gotoCompany(authedPage, companyId, '/accounts-payable');
    const suppliersResponse = await suppliersResponsePromise;
    expect(suppliersResponse.status()).toBe(200);
    const { data: suppliers } = await suppliersResponse.json() as { data: Supplier[] };
    // The local QA setup must have at least two active suppliers to exercise an actual selection change.
    expect(suppliers.length, 'AP-03 requires at least two active QA suppliers').toBeGreaterThanOrEqual(2);
    const defaultSupplier = suppliers[0]!;
    const selectedIndex = 1;
    const selectedSupplier = suppliers[selectedIndex]!;
    expect(defaultSupplier.displayNameSnapshot.trim()).not.toBe('');
    expect(selectedSupplier.displayNameSnapshot.trim()).not.toBe('');
    const form = authedPage.locator('form').filter({ has: authedPage.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }) });
    const sourceNumber = form.getByLabel('เลขที่เอกสารผู้ขาย (ถ้ามี)', { exact: true });
    const submit = form.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true });
    const supplier = form.getByRole('combobox', { name: 'ผู้ขาย', exact: true });
    const number = unique('UI-SUPPLIER');
    await expect(form.locator('..').locator(':scope > summary')).toHaveText('บันทึกบิลผู้ขาย');
    await expect(form.getByRole('combobox', { name: 'วันที่เอกสาร', exact: true })).toBeVisible();
    await expect(form.getByRole('combobox', { name: 'วันที่ครบกำหนดชำระ', exact: true })).toBeVisible();
    await expect(form.getByRole('combobox', { name: 'ประเภทการซื้อ', exact: true })).toHaveText('ซื้อในประเทศ');
    await expect(form.getByLabel('จำนวน', { exact: true })).toHaveValue('1');
    await expect(sourceNumber).toBeVisible();
    await expect(sourceNumber).toHaveAttribute('maxlength', '80');
    await expect(sourceNumber).not.toHaveAttribute('required');
    await expect(sourceNumber).toHaveAccessibleDescription('หากไม่มีเลขให้เว้นว่าง เลขนี้ไม่แทนเลขที่ใบกำกับภาษีในส่วนหลักฐานภาษี');
    await sourceNumber.fill(`  ${number}  `);
    await form.getByLabel('รายละเอียดสินค้า/บริการ', { exact: true }).fill(unique('UI source-number bill'));
    await form.getByLabel('ราคาต่อหน่วย (บาท)', { exact: true }).fill('100.00');
    // Prove the displayed default and visible options come from the API's snapshot-name contract.
    await expect(supplier).toHaveAttribute('aria-disabled', 'false');
    await expect(supplier).toHaveText(defaultSupplier.displayNameSnapshot);
    await supplier.click();
    const options = authedPage.getByRole('listbox').getByRole('option');
    await expect(options).toHaveCount(suppliers.length);
    // The selected option's decorative checkmark is aria-hidden, not part of its name.
    for (const [index, item] of suppliers.entries()) {
      await expect(options.nth(index)).toHaveAccessibleName(item.displayNameSnapshot);
    }
    await expect(options.nth(selectedIndex)).toBeVisible();
    await options.nth(selectedIndex).click();
    await expect(supplier).toHaveText(selectedSupplier.displayNameSnapshot);
    await expect(submit).toBeEnabled();

    const endpoint = `/companies/${companyId}/accounts-payable/vendor-bills`;
    const [createdResponse] = await Promise.all([
      authedPage.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(endpoint)),
      submit.click(),
    ]);
    expect(createdResponse.status()).toBe(201);
    const payload = createdResponse.request().postDataJSON();
    expect(payload.supplierId).toBe(selectedSupplier.id);
    expect(payload.supplierDocumentNumber).toBe(number);
    expect(payload).not.toHaveProperty('taxInvoiceNumber');
    const created = await createdResponse.json() as VendorBill;
    const detail = await json<VendorBill>(await api.get(`companies/${companyId}/accounts-payable/vendor-bills/${created.id}`));
    expect(detail.supplierId).toBe(selectedSupplier.id);
    expect(detail.supplierDocumentNumber).toBe(number);
    expect(detail.taxInvoiceNumber).toBeUndefined();

    await authedPage.setViewportSize({ width: 390, height: 844 });
    const companyBanner = authedPage.locator('.mangmee-shell').getByRole('banner');
    await expect(companyBanner).toHaveCount(1);
    await expect(companyBanner).toBeVisible();
    const alert = form.locator('..').locator(':scope > [role="alert"]');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await submit.scrollIntoViewIfNeeded();
      const [duplicateResponse] = await Promise.all([
        authedPage.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(endpoint)),
        submit.click(),
      ]);
      expect(duplicateResponse.status()).toBe(409);
      await expect(alert).toHaveText('เลขที่เอกสารผู้ขายนี้ถูกบันทึกสำหรับผู้ขายรายนี้แล้ว กรุณาตรวจสอบบิลเดิมก่อนสร้างซ้ำ');
      await expect(alert).toBeFocused();
      const header = await companyBanner.boundingBox();
      expect(header, 'the actual company banner must have a layout box').not.toBeNull();
      if (!header) throw new Error('Missing company banner bounds');
      const headerBottom = header.y + header.height;
      expect(header.height).toBeGreaterThan(0);
      expect(headerBottom).toBeGreaterThan(0);
      const bounds = await alert.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
          scrollMarginTop: Number.parseFloat(style.scrollMarginTop),
          configuredHeaderHeight: Number.parseFloat(style.getPropertyValue('--app-header-h')),
          viewportHeight: window.innerHeight, viewportWidth: window.innerWidth,
        };
      });
      expect(bounds.configuredHeaderHeight).toBeGreaterThan(0);
      expect(bounds.scrollMarginTop).toBeGreaterThanOrEqual(header.height + 8);
      expect(bounds.top, 'duplicate error must clear the fixed company header').toBeGreaterThanOrEqual(headerBottom + 8);
      expect(bounds.bottom, 'duplicate error must be fully visible after each mobile retry').toBeLessThanOrEqual(bounds.viewportHeight);
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
      await expect(sourceNumber).toHaveValue(`  ${number}  `);
    }
  });

  test('AP-04 @p1 leaves the source number optional for repeated blank-number form entries', async ({ authedPage, api, companyId }) => {
    await useWorkspaceBranch(authedPage, companyId, (await firstActiveBranch(api, companyId)).id);
    await gotoCompany(authedPage, companyId, '/accounts-payable');
    const form = authedPage.locator('form').filter({ has: authedPage.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }) });
    const sourceNumber = form.getByLabel('เลขที่เอกสารผู้ขาย (ถ้ามี)', { exact: true });
    const submit = form.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true });
    await form.getByLabel('รายละเอียดสินค้า/บริการ', { exact: true }).fill(unique('UI no-number bill'));
    await form.getByLabel('ราคาต่อหน่วย (บาท)', { exact: true }).fill('100.00');
    await expect(form.getByRole('combobox', { name: 'ผู้ขาย', exact: true })).toHaveAttribute('aria-disabled', 'false');
    await expect(submit).toBeEnabled();
    const createdIds: string[] = [];

    for (const blank of ['', '   ']) {
      await sourceNumber.fill(blank);
      const [response] = await Promise.all([
        authedPage.waitForResponse((item) => item.request().method() === 'POST' && item.url().endsWith(`/companies/${companyId}/accounts-payable/vendor-bills`)),
        submit.click(),
      ]);
      expect(response.status()).toBe(201);
      const payload = response.request().postDataJSON();
      expect(payload).not.toHaveProperty('supplierDocumentNumber');
      expect(payload).not.toHaveProperty('taxInvoiceNumber');
      const created = await response.json() as VendorBill;
      createdIds.push(created.id);
      const detail = await json<VendorBill>(await api.get(`companies/${companyId}/accounts-payable/vendor-bills/${created.id}`));
      expect(detail.supplierDocumentNumber).toBeUndefined();
      expect(detail.taxInvoiceNumber).toBeUndefined();
    }
    expect(new Set(createdIds).size).toBe(2);
  });

  // Owner report 2026-09-20: on a multi-branch company with the header on 'ทุกสาขา (รวม)' the
  // vendor-bill form posted that read filter's blank branch and came back 422
  // TRANSACTION_BRANCH_REQUIRED with nowhere to answer it. The form now carries the shared
  // 'สาขาของรายการ' field, exactly like the accounting draft form (ACCT-02). No branch is seeded
  // into localStorage here on purpose — that IS the all-branches state.
  test('AP-06 @p1 creates a vendor bill from the all-branches header by choosing the transaction branch', async ({ authedPage, api, companyId }, info) => {
    const branch = await firstActiveBranch(api, companyId);
    await authedPage.setViewportSize({ width: 390, height: 844 });
    await gotoCompany(authedPage, companyId, '/accounts-payable');
    await expect(authedPage.getByRole('button', { name: 'เลือกสาขา' })).toHaveText('ทุกสาขา (รวม)');
    const form = authedPage.locator('form').filter({ has: authedPage.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }) });
    const branchField = form.getByRole('combobox', { name: 'สาขาของรายการ', exact: true });
    // The company's own branch, not the supplier's branch printed on the bill.
    await expect(branchField).toHaveAccessibleDescription(/ไม่ใช่สาขาของผู้ขาย/);
    await expect(branchField).toHaveAttribute('aria-invalid', 'true');
    await form.getByLabel('รายละเอียดสินค้า/บริการ', { exact: true }).fill(unique('UI all-branches bill'));
    await form.getByLabel('ราคาต่อหน่วย (บาท)', { exact: true }).fill('100.00');
    await chooseThemedOption(authedPage, branchField, branchOptionName(branch));
    await expect(branchField).not.toHaveAttribute('aria-invalid', 'true');
    await authedPage.screenshot({ path: info.outputPath('ap-vendor-bill-branch-390.png'), fullPage: true });
    expect(await authedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const endpoint = `/companies/${companyId}/accounts-payable/vendor-bills`;
    const [created] = await Promise.all([
      authedPage.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(endpoint)),
      form.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }).click(),
    ]);
    expect(created.status(), await created.text()).toBe(201);
    expect(created.request().postDataJSON().branchId).toBe(branch.id);
    const detail = await json<VendorBill & { branchId?: string }>(await api.get(`${endpoint.slice(1)}/${(await created.json() as VendorBill).id}`));
    expect(detail.branchId).toBe(branch.id);
  });

  test('AP-05 @p1 a background supplier-load failure does not steal focus or scroll', async ({ authedPage, companyId }) => {
    await authedPage.setViewportSize({ width: 390, height: 844 });
    let releaseSupplierResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => { releaseSupplierResponse = resolve; });
    const supplierPath = `/companies/${companyId}/procurement/suppliers`;
    await authedPage.route((url) => url.pathname.endsWith(supplierPath), async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      await responseGate;
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ statusCode: 403, message: 'Insufficient permissions.', error: 'Forbidden' }),
      });
    });
    const supplierRequest = authedPage.waitForRequest((request) => request.method() === 'GET'
      && new URL(request.url()).pathname.endsWith(supplierPath));
    const form = authedPage.locator('form').filter({ has: authedPage.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true }) });
    const activeControl = form.getByRole('combobox', { name: 'ประเภทการซื้อ', exact: true });
    try {
      await gotoCompany(authedPage, companyId, '/accounts-payable');
      await supplierRequest;
      await expect(form.getByRole('combobox', { name: 'ผู้ขาย', exact: true })).toHaveAttribute('aria-disabled', 'true');
      await activeControl.focus();
      await authedPage.evaluate(() => window.scrollTo(0, 0));
      await expect(activeControl).toBeFocused();
      expect(await authedPage.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({ x: 0, y: 0 });
    } finally {
      releaseSupplierResponse();
    }
    const alert = form.locator('..').locator(':scope > [role="alert"]');
    await expect(alert).toHaveText('คุณไม่มีสิทธิ์ทำรายการนี้ กรุณาติดต่อเจ้าของร้าน');
    // Let the committed error's passive effects run before asserting no focus/scroll change.
    await authedPage.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(activeControl).toBeFocused();
    await expect(alert).not.toBeFocused();
    expect(await authedPage.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual({ x: 0, y: 0 });
    await expect(form.getByRole('button', { name: 'บันทึกฉบับร่าง', exact: true })).toBeDisabled();
  });
});

// T1 regression — docs/specs/date-time-correctness-spec.md §5.1.
// billDate is a plain DateTime and 14/14 seeded rows carry a time, so the old inclusive
// `lte: <toDate at UTC midnight>` bound hid every bill on the range's last day: a one-day
// filter returned 0 of 13. createVendorBill posts a full ISO instant, reproducing it exactly.
test('AP-20 @p1 day-range filter finds a vendor bill stamped with a time', async ({ api, companyId }) => {
  const { bill } = await createVendorBill(api, companyId);
  const today = new Date().toISOString().slice(0, 10);

  const sameDay = await json<VendorBillPage>(
    await api.get(`companies/${companyId}/accounts-payable/vendor-bills?fromDate=${today}&toDate=${today}&pageSize=200`),
  );
  expect(
    sameDay.data.some((row) => row.id === bill.id),
    'a bill dated today must appear in a fromDate=toDate=today range',
  ).toBe(true);
});
