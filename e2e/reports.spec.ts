import { test, expect } from './harness/fixtures';
import { gotoCompany, json } from './harness/e2e-utils';

type ExportItem = { id: string; status: string; datasetCode: string };
type NotificationPage = { items: Array<{ triggerKey?: string }> };
type AuditPage = { data: Array<{ action: string }> };

async function runTrialBalance(page: any, companyId: string) {
  await gotoCompany(page, companyId, '/reports');
  await page.locator('aside').getByRole('button', { name: /งบทดลอง/ }).first().click();
  await page.getByRole('button', { name: /เรียกรายงาน|Run report/i }).click();
  await expect(page.getByText(/ตารางผลลัพธ์|Result table/i)).toBeVisible();
}

test.describe('RPT — reports & BI', () => {
  test('RPT-01 @smoke reports catalog renders Trial Balance', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/reports');
    await expect(authedPage.getByRole('heading', { name: /^(รายงาน|Reports and BI|Reports)$/i })).toBeVisible();
    await expect(authedPage.getByRole('button', { name: /งบทดลอง/ }).first()).toBeVisible();
  });

  test('RPT-02 @p1 runs report and shows result table', async ({ authedPage, companyId }) => {
    await runTrialBalance(authedPage, companyId);
    await expect(authedPage.locator('table').last()).toBeVisible();
  });

  test('RPT-03 @p1 saves a dated report view', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/reports');
    await authedPage.locator('aside').getByRole('button', { name: /งบทดลอง/ }).first().click();
    await authedPage.getByRole('button', { name: /บันทึกมุมมอง|Save view/i }).click();
    await expect(authedPage.locator('aside').getByText(/งบทดลอง \d{1,2} [ก-๙.]+ 25\d{2}/).first()).toBeVisible();
  });

  test('RPT-04 @smoke exports CSV and shows READY export', async ({ authedPage, companyId }) => {
    await runTrialBalance(authedPage, companyId);
    const downloadPromise = authedPage.waitForEvent('download');
    await authedPage.getByRole('button', { name: /ส่งออก CSV|Export CSV/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    await expect(authedPage.locator('aside').getByText('พร้อมดาวน์โหลด').first()).toBeVisible();
  });

  test('RPT-05 @p1 saved view and READY export persist after reload', async ({ authedPage, companyId }) => {
    await runTrialBalance(authedPage, companyId);
    await authedPage.getByRole('button', { name: /บันทึกมุมมอง|Save view/i }).click();
    const downloadPromise = authedPage.waitForEvent('download');
    await authedPage.getByRole('button', { name: /ส่งออก CSV|Export CSV/i }).click();
    await downloadPromise;
    await authedPage.reload();
    await expect(authedPage.getByRole('button', { name: /งบทดลอง/ }).first()).toBeVisible();
    await expect(authedPage.locator('aside').getByText('พร้อมดาวน์โหลด').first()).toBeVisible();
    await expect(authedPage.locator('aside').getByText(/งบทดลอง \d{1,2} [ก-๙.]+ 25\d{2}/).first()).toBeVisible();
  });

  test('RPT-06 @p1 exports API exposes READY item', async ({ api, companyId }) => {
    const exports = await json<ExportItem[]>(await api.get(`companies/${companyId}/reports/exports`));
    expect(exports.some((item) => item.status === 'READY')).toBe(true);
  });

  test('RPT-07 @p1 report-ready notification exists', async ({ api, companyId }) => {
    const body = await json<NotificationPage>(await api.get(`companies/${companyId}/notifications?triggerKey=report_ready&pageSize=10`));
    expect(body.items.some((item) => item.triggerKey === 'report_ready')).toBe(true);
  });

  test('RPT-08 @p1 audit trail records report export request', async ({ api, companyId }) => {
    const audit = await json<AuditPage>(await api.get(`companies/${companyId}/audit/logs?targetType=report_export_request&pageSize=10`));
    expect(audit.data.some((item) => item.action === 'report.export.request')).toBe(true);
  });
});
