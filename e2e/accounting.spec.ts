import { test, expect } from './harness/fixtures';
import { branchOptionName, chooseThemedOption, ensureVatRegistrationAnswered, firstActiveBranch, gotoCompany, json, unique } from './harness/e2e-utils';

type AccountingDocument = {
  id: string;
  documentNumber?: string | null;
  status: string;
  grandTotalAmount: string;
  paidAmount: string;
  outstandingAmount: string;
  vatAmount: string;
  lines?: Array<{ description: string; lineTotalAmount: string }>;
};
type DocumentPage = { data: AccountingDocument[] };
type AccountingPayment = {
  id: string;
  counterpartyId: string;
  status: string;
  amount: string;
  whtAmount: string;
  allocatedAmount: string;
  unappliedAmount: string;
  paidAt: string;
};
type PaymentPage = { data: AccountingPayment[]; total: number };

async function createDocument(api: any, companyId: string, description = unique('E2E accounting line'), counterpartyId?: string) {
  await ensureVatRegistrationAnswered(api, companyId);
  const branch = await firstActiveBranch(api, companyId);
  return json<AccountingDocument>(await api.post(`companies/${companyId}/accounting/documents`, {
    data: {
      documentType: 'INVOICE',
      documentDate: new Date().toISOString().slice(0, 10),
      vatMode: 'NO_VAT',
      branchId: branch.id,
      ...(counterpartyId && { counterpartyId }),
      lines: [{ lineNumber: 1, description, quantity: '2', unitPrice: '125.00' }],
    },
  }));
}

test.describe('ACCT — accounting documents', () => {
  test('ACCT-01 @smoke accounting workspace renders document list and draft form', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/accounting');
    await expect(authedPage.getByRole('heading', { name: 'เอกสารบัญชี', exact: true })).toBeVisible();
    await expect(authedPage.getByRole('heading', { name: 'สร้างเอกสารใหม่', exact: true })).toBeVisible();
  });

  test('ACCT-02 @p1 creates a document through the UI form', async ({ authedPage, api, companyId }) => {
    const line = unique('E2E UI accounting');
    await ensureVatRegistrationAnswered(api, companyId);
    const branch = await firstActiveBranch(api, companyId);
    await gotoCompany(authedPage, companyId, '/accounting');
    // The draft form carries TransactionBranchField; with no branch chosen it refuses client-side
    // ('กรุณาเลือกสาขาของรายการ') and never reaches the API.
    await chooseThemedOption(authedPage, authedPage.getByRole('combobox', { name: 'สาขา', exact: true }), branchOptionName(branch));
    await authedPage.getByRole('textbox', { name: 'รายละเอียดรายการ', exact: true }).fill(line);
    await authedPage.getByRole('spinbutton', { name: 'จำนวน', exact: true }).fill('2');
    await authedPage.getByRole('spinbutton', { name: 'ราคาต่อหน่วย', exact: true }).fill('125');
    await authedPage.getByRole('button', { name: 'บันทึกร่าง', exact: true }).click();
    await expect(authedPage.getByText(line)).toBeVisible();
    await expect(authedPage.getByText(/250\.00|250/).first()).toBeVisible();
  });

  test('ACCT-03 @p1 document detail totals match line math', async ({ authedPage, api, companyId }) => {
    const doc = await createDocument(api, companyId);
    // The list is paginated; deep-link our own document instead of assuming it is on page one.
    await gotoCompany(authedPage, companyId, `/accounting?documentId=${encodeURIComponent(doc.id)}`);
    await expect(authedPage.getByRole('heading', { name: doc.id, exact: true })).toBeVisible();

    const detail = await json<AccountingDocument>(await api.get(`companies/${companyId}/accounting/documents/${doc.id}`));
    expect(detail.status).toBe('DRAFT');
    expect(Number(detail.grandTotalAmount)).toBe(250);
    expect(Number(detail.vatAmount)).toBe(0);
  });

  test('ACCT-04 @p1 issues a draft and verifies API list truth', async ({ api, companyId }) => {
    const doc = await createDocument(api, companyId);
    const issued = await json<AccountingDocument>(await api.post(`companies/${companyId}/accounting/documents/${doc.id}/issue`, { data: {} }));
    expect(issued.status).toBe('ISSUED');
    expect(issued.documentNumber).toBeTruthy();

    const list = await json<DocumentPage>(await api.get(`companies/${companyId}/accounting/documents?pageSize=100`));
    expect(list.data.some((item) => item.id === doc.id && item.status === 'ISSUED')).toBe(true);
  });

  test('ACCT-05 @p2 zero-line document is rejected by API validation', async ({ api, companyId }) => {
    await ensureVatRegistrationAnswered(api, companyId);
    const branch = await firstActiveBranch(api, companyId);
    const created = await json<AccountingDocument>(await api.post(`companies/${companyId}/accounting/documents`, {
      data: { documentType: 'INVOICE', documentDate: new Date().toISOString().slice(0, 10), vatMode: 'NO_VAT', branchId: branch.id, lines: [] },
    }));
    const res = await api.post(`companies/${companyId}/accounting/documents/${created.id}/issue`, { data: {} });
    expect(res.ok()).toBe(false);
    expect([400, 422]).toContain(res.status());
  });

  test('ACCT-06 @smoke legacy payment retries a committed lost response once across desktop and mobile', async ({ apiAs, pageAs, companyId }, testInfo) => {
    const api = await apiAs('FINANCE');
    const page = await pageAs('FINANCE');
    const label = unique('E2E payment retry');
    const customer = await json<{ id: string }>(await api.post(`companies/${companyId}/accounting/counterparties`, {
      data: { type: 'CUSTOMER', displayName: label },
    }));
    const paymentsPath = `companies/${companyId}/accounting/payments`;
    const paymentRoute = `**/api/v1/${paymentsPath}`;
    const readPayments = () => api.get(`${paymentsPath}?counterpartyId=${encodeURIComponent(customer.id)}&pageSize=100`).then(json<PaymentPage>);
    let documentId: string | undefined;
    const requestBodies: string[] = [];
    const committedPayments: AccountingPayment[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    try {
      const draft = await createDocument(api, companyId, label, customer.id);
      documentId = draft.id;
      testInfo.annotations.push({ type: 'fixture', description: `customer=${customer.id}; invoice=${documentId}` });
      const invoice = await json<AccountingDocument>(await api.post(`companies/${companyId}/accounting/documents/${documentId}/issue`, { data: {} }));
      expect(invoice.status).toBe('ISSUED');
      expect(invoice.documentNumber).toBeTruthy();
      expect((await readPayments()).total).toBe(0);

      await page.setViewportSize({ width: 1280, height: 900 });
      await gotoCompany(page, companyId, `/sales-documents?documentId=${encodeURIComponent(documentId)}`);
      const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: invoice.documentNumber!, exact: true }) });
      const submit = panel.getByRole('button', { name: 'บันทึกรับชำระ', exact: true });
      await panel.getByLabel('เงินสดที่ได้รับ', { exact: true }).fill('97.00');
      await panel.getByLabel('ยอดถูกหัก ณ ที่จ่าย', { exact: true }).fill('3.00');
      await panel.getByLabel('เลขที่หนังสือรับรองหัก ณ ที่จ่าย', { exact: true }).fill(label);
      const firstTime = Date.now();
      await page.clock.setFixedTime(firstTime);
      await page.route(paymentRoute, async (route) => {
        if (route.request().method() !== 'POST' || route.request().postDataJSON()?.allocateToDocumentId !== documentId) {
          await route.continue();
          return;
        }
        requestBodies.push(route.request().postData()!);
        // Forward the real cookie/CSRF request and wait for the server commit before losing bytes.
        const response = await route.fetch({ maxRetries: 0 });
        expect(response.ok(), await response.text()).toBe(true);
        committedPayments.push(await response.json() as AccountingPayment);
        if (requestBodies.length === 1) await route.abort('failed');
        else await route.fulfill({ response });
      });

      await submit.click();
      const networkError = panel.getByText('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง', { exact: true });
      await expect(networkError).toBeVisible();
      expect(requestBodies).toHaveLength(1);
      const firstBody = JSON.parse(requestBodies[0]);
      expect(firstBody).toMatchObject({ amount: '97.00', whtAmount: '3.00', externalReference: label, allocateToDocumentId: documentId, paidAt: new Date(firstTime).toISOString() });
      expect(firstBody.idempotencyKey).toMatch(/^payment_.+_[a-f0-9]{32}$/);
      const beforeRetry = await readPayments();
      expect(beforeRetry.total).toBe(1);
      expect(beforeRetry.data.map((payment) => payment.id)).toEqual([committedPayments[0].id]);
      const paidBeforeRetry = await json<AccountingDocument>(await api.get(`companies/${companyId}/accounting/documents/${documentId}`));
      expect(Number(paidBeforeRetry.paidAmount)).toBe(100);
      expect(Number(paidBeforeRetry.outstandingAmount)).toBe(150);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await testInfo.attach('lost-response-desktop', { body: await panel.screenshot(), contentType: 'image/png' });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.clock.setFixedTime(firstTime + 61_000);
      expect(await page.evaluate(() => Date.now())).toBe(firstTime + 61_000);
      const [retryResponse] = await Promise.all([
        page.waitForResponse((response) => response.url().endsWith(`/api/v1/${paymentsPath}`) && response.request().method() === 'POST'),
        submit.click(),
      ]);
      expect(retryResponse.ok()).toBe(true);
      await expect(page.getByText('บันทึกรับชำระเรียบร้อยแล้ว', { exact: true })).toBeVisible();
      await expect(networkError).toHaveCount(0);
      await expect(submit).toBeEnabled();
      expect(requestBodies).toHaveLength(2);
      expect(requestBodies[1]).toBe(requestBodies[0]);
      expect(committedPayments.map((payment) => payment.id)).toEqual([committedPayments[0].id, committedPayments[0].id]);

      const afterRetry = await readPayments();
      expect(afterRetry.total).toBe(1);
      expect(afterRetry.data.map((payment) => payment.id)).toEqual([committedPayments[0].id]);
      // The public API exposes allocation totals, not raw allocation-row counts.
      const payment = await json<AccountingPayment>(await api.get(`${paymentsPath}/${committedPayments[0].id}`));
      expect(payment.counterpartyId).toBe(customer.id);
      expect(Number(payment.amount)).toBe(97);
      expect(Number(payment.whtAmount)).toBe(3);
      expect(Number(payment.allocatedAmount)).toBe(97);
      expect(Number(payment.unappliedAmount)).toBe(0);
      expect(payment.paidAt).toBe(firstBody.paidAt);
      const paidAfterRetry = await json<AccountingDocument>(await api.get(`companies/${companyId}/accounting/documents/${documentId}`));
      expect(Number(paidAfterRetry.paidAmount)).toBe(100);
      expect(Number(paidAfterRetry.outstandingAmount)).toBe(150);
      await expect(panel.locator('dt').filter({ hasText: /^รับชำระแล้ว$/ }).locator('..').locator('dd')).toHaveText('100.00');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(pageErrors).toEqual([]);
      // The earlier transport-error toast expires independently of the inline form error.
      // Capture the settled successful UI, not the transient stack containing both notices.
      await expect(page.getByText('เชื่อมต่อไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง', { exact: true })).toHaveCount(0);
      await testInfo.attach('replayed-payment-mobile', { body: await panel.screenshot(), contentType: 'image/png' });
      await testInfo.attach('payment-retry-readback', {
        body: Buffer.from(JSON.stringify({ documentId, customerId: customer.id, requestBodies, beforeRetry, afterRetry, payment, paidBeforeRetry, paidAfterRetry }, null, 2)),
        contentType: 'application/json',
      });
    } finally {
      await page.unroute(paymentRoute);
      // Never clean the shared company: only the newly-created customer's payment IDs and invoice.
      const ownPayments = await readPayments();
      expect(ownPayments.data).toHaveLength(ownPayments.total);
      for (const payment of ownPayments.data) {
        expect(payment.counterpartyId).toBe(customer.id);
        if (payment.status !== 'VOIDED') {
          const voided = await json<AccountingPayment>(await api.post(`${paymentsPath}/${payment.id}/void`, { data: { reason: `${label} fixture cleanup` } }));
          expect(voided.status).toBe('VOIDED');
          expect(Number(voided.allocatedAmount)).toBe(0);
          expect(Number(voided.unappliedAmount)).toBe(0);
        }
      }
      if (documentId) {
        const restored = await json<AccountingDocument>(await api.get(`companies/${companyId}/accounting/documents/${documentId}`));
        expect(Number(restored.paidAmount)).toBe(0);
        const voided = await json<AccountingDocument>(await api.post(`companies/${companyId}/accounting/documents/${documentId}/void`, { data: { reason: `${label} fixture cleanup` } }));
        expect(voided.status).toBe('VOIDED');
      }
      const archived = await json<{ status: string }>(await api.patch(`companies/${companyId}/accounting/counterparties/${customer.id}`, { data: { status: 'ARCHIVED' } }));
      expect(archived.status).toBe('ARCHIVED');
    }
  });
});
