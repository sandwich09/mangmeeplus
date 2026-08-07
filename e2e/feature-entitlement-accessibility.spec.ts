import { test, expect } from './harness/fixtures';
import { gotoCompany, json, unique } from './harness/e2e-utils';

type Supplier = { id: string; displayNameSnapshot: string };
type VendorBill = { id: string; status: string };
type SupplierPayment = { id: string };
type WhtHandoff = { id: string; sourcePaymentId: string | null };

async function createWhtHandoff(api: any, companyId: string) {
  const supplier = await json<Supplier>(await api.post(`companies/${companyId}/procurement/suppliers`, {
    data: {
      displayName: unique('E2E สำนักงานบัญชี'),
      supplierType: 'JURISTIC_PERSON',
      taxId: '0105559123456',
      branchCode: '00000',
      defaultCurrency: 'THB',
    },
  }));
  const today = new Date().toISOString();
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const bill = await json<VendorBill>(await api.post(`companies/${companyId}/accounts-payable/vendor-bills`, {
    data: {
      supplierId: supplier.id,
      billDate: today,
      dueDate: due,
      currency: 'THB',
      vatMode: 'NO_VAT',
      supplierDocumentNumber: unique('E2E-WHT-BILL'),
      whtCategoryCode: 'SERVICE',
      whtRate: '3',
      lines: [{
        lineNumber: 1,
        lineType: 'SERVICE',
        description: 'ค่าบริการบัญชี',
        unitName: 'งาน',
        quantity: '1',
        unitPrice: '100.00',
        discountAmount: '0.00',
        vatMode: 'NO_VAT',
        vatAmount: '0.00',
        inputVatClaimStatus: 'NON_CLAIMABLE',
        whtCategoryCode: 'SERVICE',
        whtRate: '3',
        whtAmount: '3.00',
        lineSubtotalAmount: '100.00',
        lineTotalAmount: '100.00',
      }],
    },
  }));
  await json<VendorBill>(await api.post(`companies/${companyId}/accounts-payable/vendor-bills/${bill.id}/submit`, { data: {} }));
  await json<VendorBill>(await api.post(`companies/${companyId}/accounts-payable/vendor-bills/${bill.id}/approve`, { data: {} }));
  const payment = await json<SupplierPayment>(await api.post(`companies/${companyId}/accounts-payable/payments`, {
    data: {
      idempotencyKey: unique('e2e-wht-payment'),
      supplierId: supplier.id,
      paymentDate: today,
      method: 'BANK_TRANSFER',
      currency: 'THB',
      grossAmount: '100.00',
      whtAmount: '3.00',
      netPaidAmount: '97.00',
      allocations: [{ vendorBillId: bill.id, amount: '97.00', whtAmount: '3.00' }],
    },
  }));
  const handoffs = await json<WhtHandoff[]>(await api.get(`companies/${companyId}/wht/payment-handoffs`));
  expect(handoffs.some((handoff) => handoff.sourcePaymentId === payment.id)).toBe(true);
  return supplier;
}

test.describe('ENT-A11Y — feature fallback accessibility', () => {
  test('ENT-A11Y-01 @p1 50 ทวิ fallback is keyboard-navigable, labelled and uses a 44px confirm target', async ({ authedPage, api, companyId }) => {
    const supplier = await createWhtHandoff(api, companyId);
    await gotoCompany(authedPage, companyId, '/accounts-payable?tab=wht');

    const row = authedPage.getByRole('row').filter({ hasText: supplier.displayNameSnapshot }).first();
    const toggle = row.locator('button[aria-controls]');
    await expect(toggle).toHaveAccessibleName('ดูข้อมูลสำหรับออกเอกสาร');
    await expect(toggle).toBeVisible();
    await toggle.focus();
    await authedPage.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    const number = authedPage.getByLabel('เลขที่หนังสือรับรอง');
    const evidence = authedPage.getByLabel('อ้างอิงหลักฐานหรือไฟล์');
    const issuedDate = authedPage.getByLabel('วันที่ออกหนังสือรับรอง');
    const note = authedPage.getByLabel('หมายเหตุ (ถ้ามี)');
    await expect(number).toBeVisible();
    await expect(evidence).toBeVisible();
    await expect(issuedDate).toBeVisible();
    await expect(note).toBeVisible();

    await number.focus();
    await authedPage.keyboard.press('Tab');
    await expect(evidence).toBeFocused();
    await authedPage.keyboard.press('Tab');
    await expect(issuedDate).toBeFocused();

    const submit = authedPage.getByRole('button', { name: 'แนบเอกสาร' });
    await number.fill('CERT-E2E-001');
    await evidence.fill('evidence://e2e/001');
    await issuedDate.fill(new Date().toISOString().slice(0, 10));
    await note.fill('ทดสอบการใช้งานด้วยแป้นพิมพ์');
    await note.focus();
    await authedPage.keyboard.press('Tab');
    await expect(submit).toBeFocused();
    const box = await submit.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  });
});
