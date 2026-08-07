import { test, expect } from './harness/fixtures';
import { expectNoClientError } from './harness/auth';

test.describe('TOAST — global feedback', () => {
  test('TOAST-01 notification channel saves show success toasts', async ({ authedPage, companyId }) => {
    await authedPage.goto(`/companies/${companyId}/settings/notifications`);
    await expect(authedPage.getByRole('heading', { name: 'ตั้งค่าการแจ้งเตือน' })).toBeVisible();
    await expectNoClientError(authedPage);

    const lineToggle = authedPage.getByRole('button', { name: 'LINE', exact: true });
    const successToasts = authedPage.locator('[role="status"].toast-enter');

    await lineToggle.click();
    await expect(successToasts.filter({ hasText: /ช่องทาง LINE เรียบร้อยแล้ว/ })).toBeVisible();
    const firstToast = await successToasts.filter({ hasText: /ช่องทาง LINE เรียบร้อยแล้ว/ }).first().textContent();

    await lineToggle.click();
    await expect(successToasts.filter({
      hasText: firstToast?.includes('เปิดช่องทาง LINE')
        ? 'ปิดช่องทาง LINE เรียบร้อยแล้ว'
        : 'เปิดช่องทาง LINE เรียบร้อยแล้ว',
    })).toBeVisible();
  });

  test('TOAST-02 failed notification save shows the API error toast', async ({ authedPage, companyId }) => {
    await authedPage.route('**/api/v1/**', (route) => (
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'ทดสอบข้อผิดพลาด' }),
          })
        : route.fallback()
    ));

    await authedPage.goto(`/companies/${companyId}/settings/notifications`);
    await expect(authedPage.getByRole('heading', { name: 'ตั้งค่าการแจ้งเตือน' })).toBeVisible();
    await expectNoClientError(authedPage);

    await authedPage.getByRole('button', { name: 'LINE', exact: true }).click();
    await expect(authedPage.locator('[role="alert"].toast-enter').filter({ hasText: 'ทดสอบข้อผิดพลาด' })).toBeVisible();
  });
});
