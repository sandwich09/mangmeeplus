import { test, expect } from './harness/fixtures';
import { gotoCompany, json } from './harness/e2e-utils';

type ReportsSummary = {
  total: number;
  resolved: number;
  resolvedRate: number;
  overdue: number;
};

test.describe('CRMRPT — CRM reports', () => {
  test('CRMRPT-01 @p2 renders seeded KPI truth and explicit unavailable sales data', async ({ authedPage, api, companyId }) => {
    // quarter window + skip: seeded conversations are clamped to the seed-run day,
    // so period=today goes red the day after a re-seed even though nothing broke.
    const summary = await json<ReportsSummary>(await api.get(`companies/${companyId}/crm/reports/summary?period=quarter`));
    test.skip(summary.total === 0, 'seed is older than the current quarter — re-seed the e2e DB');

    await authedPage.route(`**/companies/${companyId}/crm/daily-brief**`, (route) => route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Forbidden' }),
    }));
    await gotoCompany(authedPage, companyId, '/crm-reports?period=quarter');

    await expect(authedPage.getByRole('heading', { name: 'รายงานลูกค้าและแชท' })).toBeVisible();
    const totalCard = authedPage.getByText('แชททั้งหมด', { exact: true }).locator('..');
    await expect(totalCard.getByText(String(summary.total), { exact: true })).toBeVisible();
    const resolvedCard = authedPage.getByText('ตอบจบแล้ว', { exact: true }).locator('..');
    await expect(resolvedCard.getByText(`${summary.resolvedRate}%`, { exact: true })).toBeVisible();
    const overdueCard = authedPage.getByText('ลูกค้ารอตอบเกินกำหนด', { exact: true }).locator('..');
    await expect(overdueCard.getByText(String(summary.overdue), { exact: true })).toBeVisible();

    const salesOps = authedPage.getByText('ยอดขายและโอกาสขาย', { exact: true }).locator('..');
    await expect(salesOps.getByText('ไม่มีสิทธิ์ดูข้อมูลยอดขาย', { exact: true })).toBeVisible();
    await expect(salesOps.getByText('—', { exact: true })).toHaveCount(5);
  });

  test('CRMRPT-02 @p2 period switch reloads and disables CSV while the new period loads', async ({ authedPage, companyId }) => {
    await gotoCompany(authedPage, companyId, '/crm-reports');
    const download = authedPage.getByRole('button', { name: 'ดาวน์โหลด' });
    await expect(download).toBeEnabled();

    let release!: () => void;
    let requestStarted!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { requestStarted = resolve; });
    await authedPage.route(`**/companies/${companyId}/crm/reports/summary**`, async (route) => {
      if (new URL(route.request().url()).searchParams.get('period') !== 'week') return route.continue();
      requestStarted();
      await blocked;
      await route.continue();
    });

    const response = authedPage.waitForResponse((res) =>
      res.url().includes(`/companies/${companyId}/crm/reports/summary`)
      && new URL(res.url()).searchParams.get('period') === 'week',
    );
    await authedPage.getByRole('button', { name: '7 วันล่าสุด' }).click();
    await started;
    await expect(download).toBeDisabled();
    release();
    await response;
    await expect(download).toBeEnabled();
    await expect(authedPage.getByText(/7 วันล่าสุด/).first()).toBeVisible();
  });
});
