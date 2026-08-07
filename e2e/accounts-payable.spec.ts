import { test, expect } from './harness/fixtures';
import { gotoCompany, json, unique } from './harness/e2e-utils';

type Supplier = { id: string; displayNameSnapshot: string };
type VendorBill = { id: string; status: string; dueDate: string; netPayableAmount: string; supplierId: string };
type VendorBillPage = { data: VendorBill[] };

async function createSupplier(api: any, companyId: string) {
  return json<Supplier>(await api.post(`companies/${companyId}/procurement/suppliers`, {
    data: { displayName: unique('E2E AP supplier'), supplierType: 'JURISTIC_PERSON', defaultCurrency: 'THB' },
  }));
}

async function createVendorBill(api: any, companyId: string) {
  const supplier = await createSupplier(api, companyId);
  const today = new Date().toISOString();
  const due = new Date(Date.now() + 7 * 86400000).toISOString();
  const bill = await json<VendorBill>(await api.post(`companies/${companyId}/accounts-payable/vendor-bills`, {
    data: {
      supplierId: supplier.id,
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
    // Exact tab label: the broad /Bill/i regex also matched the "สร้าง Vendor Bill Draft"
    // submit button inside the bills panel (strict-mode violation).
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
