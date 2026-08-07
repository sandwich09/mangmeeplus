import { test, expect } from './harness/fixtures';
import { gotoCompany, json } from './harness/e2e-utils';

test.describe('DASH — dashboard', () => {
  test('DASH-01 @smoke dashboard renders primary snapshot action', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/dashboard');
    await expect(authedPage.getByRole('heading', { name: /สวัสดี|Dashboard/i })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /รีเฟรช|สร้างใหม่|refresh|generate/i })).toBeVisible();
  });

  test('DASH-02 @p1 KPI tiles render values', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/dashboard');
    await expect(authedPage.getByText(/ภาพรวม|Overview/).first()).toBeVisible();
    await expect(authedPage.locator('main, #workspace-main').getByText(/\d+/).first()).toBeVisible();
  });

  test('DASH-03 @p1 refresh snapshot action completes without client error', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/dashboard');
    await authedPage.getByRole('button', { name: /รีเฟรช|สร้างใหม่|refresh|generate/i }).click();
    await expect(authedPage.getByText(/อัปเดตล่าสุด|updated/i).first()).toBeVisible();
  });

  test('DASH-04 @p2 dashboard API returns snapshot shape', async ({ api, companyId }) => {
    const body = await json<{ widgets?: unknown[] }>(await api.get(`companies/${companyId}/dashboard`));
    expect(Array.isArray(body.widgets)).toBe(true);
  });
});
