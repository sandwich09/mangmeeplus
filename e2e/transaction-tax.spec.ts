import { test, expect } from './harness/fixtures';
import { gotoCompany } from './harness/e2e-utils';

test.describe('TAX-11B — transaction Tax Code journeys', () => {
  test('TAX-11B-01 @smoke tax workspace exposes reconciliation and evidence journeys', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/tax');
    await expect(authedPage.getByRole('heading', { name: 'ภาษี' })).toBeVisible();
    await expect(authedPage.getByRole('link', { name: /Reconciliation/i })).toBeVisible();
  });

  test('TAX-11B-02 @p1 only tax-bearing accounting documents show the line selector', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/accounting');
    await expect(authedPage.getByTestId('transaction-tax-selector')).toHaveCount(0);

    // Document type is now ThemedSelect (details/summary + role="option" buttons, a themed
    // drop-in for a native <select> -- see common/components/field/ThemedSelect.tsx), not a
    // real <select>, so it needs an open-then-click-option interaction instead of selectOption().
    const type = authedPage.getByRole('combobox', { name: 'Document type' });
    await type.click();
    await authedPage.getByRole('option', { name: 'ใบกำกับภาษี', exact: true }).click();
    await expect(authedPage.getByTestId('transaction-tax-selector')).toBeVisible();

    await type.click();
    await authedPage.getByRole('option', { name: 'ใบเสร็จรับเงิน', exact: true }).click();
    await expect(authedPage.getByTestId('transaction-tax-selector')).toHaveCount(0);
    await expect(authedPage.getByText(/ไม่มี Tax Code และไม่สร้าง VAT ซ้ำ/)).toBeVisible();

    await type.click();
    await authedPage.getByRole('option', { name: 'ใบเสนอราคา', exact: true }).click();
    await expect(authedPage.getByTestId('transaction-tax-selector')).toHaveCount(0);
  });

  test('TAX-11B-03 @smoke manual expense uses the same line Tax Code selector', async ({ authedPage, companyId }) => {
    // The manual-entry tab moved from a `?tab=manual` query param to its own route
    // (app/(workspace)/companies/[companyId]/expenses/manual/page.tsx); the query param now
    // only survives as a client-side redirect shim.
    await gotoCompany(authedPage, companyId, '/expenses/manual');
    await expect(authedPage.getByRole('heading', { name: 'บันทึกค่าใช้จ่ายด้วยมือ' })).toBeVisible();
    await expect(authedPage.getByTestId('transaction-tax-selector')).toBeVisible();
  });
});
