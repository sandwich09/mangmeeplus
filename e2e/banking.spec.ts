import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';
import { gotoCompany } from './harness/e2e-utils';

test.describe('BANK — banking', () => {
  test('BANK-01 @smoke banking workspace renders accounts surface', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/banking');
    await expect(authedPage.getByRole('heading', { name: /บัญชีธนาคารและกระทบยอด|Banking/i })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /^บัญชีธนาคาร$|Bank accounts/i }).first()).toBeVisible();
    await expect(authedPage.getByText(/ยอดยกมา|Balance|KBANK/i).first()).toBeVisible();
  });

  test('BANK-02 @p1 import and matching views render', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/banking');
    await authedPage.getByRole('button', { name: /นำเข้า statement|statement/i }).click();
    await expect(authedPage.getByText(/นำเข้ารายการเดินบัญชี|CSV|Excel/i).first()).toBeVisible();
    await expect(authedPage.locator('textarea')).toBeVisible();

    await authedPage.getByRole('button', { name: /จับคู่รายการ|Match/i }).click();
    await expect(authedPage.getByText(/บัญชีธนาคาร|ไม่มีรายการค้างจับคู่|match/i).first()).toBeVisible();
    await expectNoClientError(authedPage);
  });
});
