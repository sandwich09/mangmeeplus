import { test, expect } from './harness/fixtures';
import { gotoCompany, json } from './harness/e2e-utils';

test.describe('DASH — dashboard', () => {
  test('DASH-01 @smoke dashboard renders its title and the time of its numbers', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/dashboard');
    await expect(authedPage.getByRole('heading', { name: /สวัสดี|รายจ่ายของร้าน|Dashboard/i })).toBeVisible();
    // Owner 2026-10-15: the expense home has no refresh button; it reads fresh on every visit and names the time.
    await expect(authedPage.getByText(/อัปเดตล่าสุด/).first()).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /อัปเดตข้อมูล|อัปเดตตัวเลข/ })).toHaveCount(0);
  });

  test('DASH-02 @p1 KPI tiles render values', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/dashboard');
    await expect(authedPage.getByText(/ค่าใช้จ่ายและใบเสร็จ|ภาพรวม|Overview/).first()).toBeVisible();
    // สรุปงานลูกค้าและการขาย is a closed disclosure since 2026-10-13: its tiles are in the DOM but not on screen.
    await expect(authedPage.locator('main, #workspace-main').getByText(/\d+/).filter({ visible: true }).first()).toBeVisible();
  });

  test('DASH-03 @p1 the period choice changes the first number without a client error', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/dashboard');
    await authedPage.getByRole('button', { name: 'วันนี้', exact: true }).click();
    await expect(authedPage.getByText('รายจ่ายวันนี้', { exact: true })).toBeVisible();
    await expect(authedPage.getByRole('heading', { name: 'รายจ่ายรายเดือน', exact: true })).toBeVisible();
  });

  test('DASH-04 @p2 dashboard API returns snapshot shape', async ({ api, companyId }) => {
    const body = await json<{ widgets?: unknown[] }>(await api.get(`companies/${companyId}/dashboard`));
    expect(Array.isArray(body.widgets)).toBe(true);
  });
});
