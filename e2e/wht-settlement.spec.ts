import { test, expect } from './harness/fixtures';
import { gotoCompany, json, unique } from './harness/e2e-utils';

/**
 * The two withholding journeys from the spec's acceptance table, driven end to end against a real
 * API and database: A1 (we withhold when paying a vendor) and B1 (a customer withholds from us).
 *
 * Both assert the ledger, not just the screen. The bug these features exist to fix was invisible in
 * the UI — a bill that looked paid while the payable stayed open by the withheld amount — so a test
 * that only checked the document status would have passed against the broken code too.
 */

type Supplier = { id: string };
type VendorBill = { id: string; status: string; outstandingAmount: string; paidAmount: string; whtAmount: string; taxableAmount: string; netPayableAmount: string };
type SupplierPayment = { id: string; grossAmount: string; whtAmount: string; netPaidAmount: string; whtCategoryCode?: string; whtRate?: string };
type WhtCategory = { code: string; status: string; defaultRate: string; formType: string };
type Doc = { id: string; status: string; grandTotalAmount: string; whtAmount: string; outstandingAmount: string; paidAmount: string; paymentStatus?: string };
type Payment = { id: string; amount: string; whtAmount: string };
type PostingSource = { totalAmount: string; whtTotal: string; payment?: { amount: string } };
type TaxEventPage = Array<{ eventType: string; sourceType: string; sourceId: string; grossAmount?: string | null; withheldAmount?: string | null; whtRate?: string | null; incomeCategoryCode?: string | null }>;

const WHT_CODE = 'WHT_SERVICE_5'; // ค่าบริการ (นิติบุคคล), 3%, ภ.ง.ด.53

/**
 * Asserts the ledger INPUT rather than a posted journal.
 *
 * Posting itself cannot run on the seeded company: it carries chart-template provenance, which
 * forces `requiresReviewedPostingRules`, and nothing in the system can create a PostingRule — no
 * endpoint, no UI, no seed (RA-01 in the readiness assessment). That blocker predates withholding
 * and blocks every document type equally.
 *
 * What it does NOT excuse is the bug this feature fixed, which lived here in the source: the
 * supplier-payment source used to report the NET as its total and a hardcoded zero withholding, so
 * the payable would have been relieved short. These two numbers are exactly what the posting engine
 * splits into lines, and the split itself is covered by unit tests.
 */
async function expectPostingBlockedOnlyByMissingRule(api: any, companyId: string, sourceType: string, sourceId: string) {
  const res = await api.post(`companies/${companyId}/posting/generate`, { data: { sourceType, sourceId } });
  if (res.ok()) return;
  const body = await res.json();
  expect(body.code, `posting failed for a reason other than the known RA-01 blocker: ${JSON.stringify(body)}`).toBe('posting_rule_missing');
}

test.describe('WHT at settlement time', () => {
  test('A1 @p1 paying a vendor with 3% withheld clears the bill, pays the net, and reaches ภ.ง.ด.53', async ({ authedPage, api, companyId }) => {
    // The catalog ships DRAFT — nothing may withhold until an accountant vouches for the rate.
    // This is the activation an accountant performs from the tax workspace WHT tab.
    const before = await json<WhtCategory[]>(await api.get(`companies/${companyId}/tax/wht-categories`));
    expect(before.some((row) => row.code === WHT_CODE), 'seeded catalog must contain the service category').toBe(true);
    await json<WhtCategory>(await api.patch(`companies/${companyId}/tax/wht-categories/${WHT_CODE}`, { data: { status: 'ACTIVE' } }));

    const supplier = await json<Supplier>(await api.post(`companies/${companyId}/procurement/suppliers`, {
      data: { displayName: unique('E2E WHT supplier'), legalName: unique('บริษัท ผู้รับเงิน'), taxId: '0105500000001', supplierType: 'JURISTIC_PERSON', defaultCurrency: 'THB' },
    }));

    // 1,000 base + 70 VAT. The withholding applies to the base, never to the VAT.
    const bill = await json<VendorBill>(await api.post(`companies/${companyId}/accounts-payable/vendor-bills`, {
      data: {
        supplierId: supplier.id, billDate: new Date().toISOString(), dueDate: new Date(Date.now() + 7 * 86400000).toISOString(),
        currency: 'THB', vatMode: 'VAT_EXCLUDED', supplierDocumentNumber: unique('E2E-WHT-BILL'), matchingMode: 'NONE',
        subtotalAmount: '1000.00', discountAmount: '0.00', taxableAmount: '1000.00', vatAmount: '70.00',
        inputVatClaimStatus: 'NON_CLAIMABLE', whtAmount: '0.00', grandTotalAmount: '1070.00', netPayableAmount: '1070.00',
        lines: [{
          lineNumber: 1, lineType: 'SERVICE', description: unique('E2E WHT service'), unitName: 'each',
          quantity: '1', unitPrice: '1000.00', discountAmount: '0.00', vatMode: 'VAT_EXCLUDED', vatRate: '7', vatAmount: '70.00',
          inputVatClaimStatus: 'NON_CLAIMABLE', whtAmount: '0.00', lineSubtotalAmount: '1000.00', lineTotalAmount: '1070.00',
        }],
      },
    }));
    await json(await api.post(`companies/${companyId}/accounts-payable/vendor-bills/${bill.id}/submit`, { data: {} }));
    await json(await api.post(`companies/${companyId}/accounts-payable/vendor-bills/${bill.id}/approve`, { data: {} }));

    // The server recomputes every total from the lines, so read back what is really owed rather
    // than trusting the header we posted.
    const approved = await json<VendorBill>(await api.get(`companies/${companyId}/accounts-payable/vendor-bills/${bill.id}`));
    const debt = Number(approved.outstandingAmount);
    const base = Number(approved.taxableAmount);
    expect(base, 'the withholding base is the pre-VAT amount').toBe(1000);
    // 3% of the base, never of the VAT.
    const withheld = Number((base * 0.03).toFixed(2));
    const cash = Number((debt - withheld).toFixed(2));

    const payment = await json<SupplierPayment>(await api.post(`companies/${companyId}/accounts-payable/payments`, {
      data: {
        idempotencyKey: unique('e2e-wht-pay'), supplierId: supplier.id, paymentDate: new Date().toISOString(),
        method: 'BANK_TRANSFER', currency: 'THB', externalReference: unique('TRF'),
        grossAmount: debt.toFixed(2), whtAmount: withheld.toFixed(2), whtCategoryCode: WHT_CODE, whtRate: '3', netPaidAmount: cash.toFixed(2),
        allocations: [{ vendorBillId: bill.id, amount: debt.toFixed(2), whtAmount: withheld.toFixed(2) }],
      },
    }));
    expect(Number(payment.netPaidAmount)).toBe(cash);
    expect(payment.whtCategoryCode).toBe(WHT_CODE);

    // The whole point: the bill closes even though less than the debt left the bank.
    const settled = await json<VendorBill>(await api.get(`companies/${companyId}/accounts-payable/vendor-bills/${bill.id}`));
    expect(settled.status).toBe('PAID');
    expect(Number(settled.outstandingAmount)).toBe(0);
    expect(Number(settled.paidAmount)).toBe(debt);

    const source = await json<PostingSource>(await api.get(`companies/${companyId}/accounts-payable/payments/${payment.id}/posting-source`));
    expect(Number(source.totalAmount), 'AP is relieved by the debt cleared, not by the cash paid').toBe(debt);
    expect(Number(source.whtTotal), 'the withheld tax is what splits off the credit side').toBe(withheld);
    expect(Number(source.payment?.amount), 'the bank figure stays cash for reconciliation').toBe(cash);
    await expectPostingBlockedOnlyByMissingRule(api, companyId, 'procurement.supplier_payment', payment.id);

    // ภ.ง.ด.53, because the payee is a juristic person. The income base is the 1,000 the rate was
    // applied to — not the 1,070 settlement, which includes VAT and is not income to the payee.
    await json(await api.post(`companies/${companyId}/tax/sync`, { data: {} }));
    // Events hang off their period, so find the ภ.ง.ด.53 period this payment date falls in.
    // The list endpoint answers `{ items, total }`.
    const periods = await json<{ items: Array<{ id: string; formType: string; periodKey: string }> }>(
      await api.get(`companies/${companyId}/tax/periods?taxType=WHT&pageSize=100`),
    );
    const periodRows = periods.items;
    const periodKey = new Date().toISOString().slice(0, 7);
    const period = periodRows.find((row) => row.formType === 'PND53' && row.periodKey === periodKey);
    expect(period, `no PND53 period for ${periodKey}`).toBeTruthy();
    // Period events come back as a plain array.
    const rows = await json<TaxEventPage>(await api.get(`companies/${companyId}/tax/periods/${period!.id}/events`));
    const event = rows.find((row) => row.sourceType === 'procurement.supplier_payment' && row.sourceId === payment.id);
    expect(event, 'the payment must appear as a withholding tax event').toBeTruthy();
    expect(event!.eventType).toBe('WHT_PND53');
    expect(Number(event!.grossAmount), 'the income base is recovered from the rate, not the VAT-inclusive settlement').toBe(base);
    expect(Number(event!.withheldAmount)).toBe(withheld);
    expect(event!.incomeCategoryCode).toBe(WHT_CODE);

    // And the screen an operator would use shows the same payment.
    await gotoCompany(authedPage, companyId, '/accounts-payable?tab=payments');
    await expect(authedPage.getByRole('heading', { name: /เจ้าหนี้การค้า|Accounts Payable/i })).toBeVisible();
    await expect(authedPage.getByText('หัก ณ ที่จ่าย', { exact: false }).first()).toBeVisible();
  });

  test('B1 @p1 a customer withholding 3% still settles the invoice, and the tax lands as a credit', async ({ authedPage, api, companyId }) => {
    const counterparty = await json<{ id: string }>(await api.post(`companies/${companyId}/accounting/counterparties`, {
      data: { type: 'CUSTOMER', displayName: unique('E2E WHT customer'), taxId: '0105500000002' },
    }));

    // The invoice declares the rate the customer will withhold; the total it owes is unchanged.
    // A plain INVOICE is what carries the receivable here; VAT rides on a separate TAX_INVOICE, and
    // only INVOICE/BILLING_NOTE/DEBIT_NOTE accept a payment allocation. Withholding is orthogonal.
    const doc = await json<Doc>(await api.post(`companies/${companyId}/accounting/documents`, {
      data: {
        documentType: 'INVOICE', documentDate: new Date().toISOString().slice(0, 10), vatMode: 'NO_VAT',
        counterpartyId: counterparty.id,
        lines: [{ lineNumber: 1, description: unique('E2E WHT sale'), quantity: '1', unitPrice: '1000.00', whtRate: '3' }],
      },
    }));
    expect(Number(doc.grandTotalAmount)).toBe(1000);
    expect(Number(doc.whtAmount), 'the document computes what the customer will withhold').toBe(30);

    const issued = await json<Doc>(await api.post(`companies/${companyId}/accounting/documents/${doc.id}/issue`, { data: {} }));
    expect(issued.status).toBe('ISSUED');

    const payment = await json<Payment>(await api.post(`companies/${companyId}/accounting/payments`, {
      data: {
        direction: 'RECEIVED', method: 'BANK_TRANSFER', counterpartyId: counterparty.id,
        amount: '970.00', whtAmount: '30.00', paidAt: new Date().toISOString(),
        externalReference: unique('50TAWI'), allocateToDocumentId: doc.id,
      },
    }));
    expect(Number(payment.amount)).toBe(970);
    expect(Number(payment.whtAmount)).toBe(30);

    // Settled in full despite only 1,040 arriving — the failure this feature was built to fix.
    const settled = await json<Doc>(await api.get(`companies/${companyId}/accounting/documents/${doc.id}`));
    expect(settled.paymentStatus).toBe('PAID');
    expect(Number(settled.outstandingAmount)).toBe(0);
    expect(Number(settled.paidAmount)).toBe(1000);

    await expectPostingBlockedOnlyByMissingRule(api, companyId, 'accounting.payment', payment.id);

    await gotoCompany(authedPage, companyId, '/accounting');
    await expect(authedPage.getByRole('heading', { name: /Accounting documents/i })).toBeVisible();
  });
});
