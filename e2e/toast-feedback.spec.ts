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
    const expected = 'ข้อมูลจากหน้าจอไม่ตรงกับที่ระบบรองรับ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง';
    await authedPage.route('**/api/v1/**', (route) => (
      route.request().method() === 'PUT'
        ? route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              statusCode: 400,
              message: ['property visibility should not exist'],
              error: 'Bad Request',
            }),
          })
        : route.fallback()
    ));

    await authedPage.goto(`/companies/${companyId}/settings/notifications`);
    await expect(authedPage.getByRole('heading', { name: 'ตั้งค่าการแจ้งเตือน' })).toBeVisible();
    await expectNoClientError(authedPage);

    await authedPage.getByRole('button', { name: 'LINE', exact: true }).click();
    const errorToasts = authedPage.locator('[role="alert"].toast-enter');
    await expect(errorToasts).toHaveCount(1);
    await expect(errorToasts).toContainText(expected);
    await expect(errorToasts).not.toContainText(/visibility|property|should not exist|Bad Request|API error/i);
    await expect(authedPage.locator('body')).not.toContainText(/property visibility should not exist/i);
  });
});
