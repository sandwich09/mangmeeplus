import { test, expect } from './harness/fixtures';
import type { EmployeeSummary } from '@watchdog-bms/contracts';

for (const width of [1280, 390]) test(`employee job title reaches list and detail at ${width}px`, async ({ authedPage: page, api, companyId }, info) => {
  const response = await api.get(`companies/${companyId}/settings/employees`);
  expect(response.ok()).toBe(true);
  const employees = await response.json() as EmployeeSummary[];
  const sales = employees.find(employee => employee.id === 'seed-qa-profile-sales')!;
  expect(sales.jobTitle).toBe('พนักงานขาย');
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/companies/${companyId}/settings/access-overview`);
  await page.getByPlaceholder('ค้นหาชื่อ ตำแหน่งงาน หรือเบอร์โทร...').fill(sales.jobTitle!);
  const row = page.getByRole('button').filter({ has: page.getByText(sales.jobTitle!, { exact: true }) });
  await expect(row).toHaveCount(1);
  await row.click();
  const detail = page.getByTestId('employee-detail-card');
  await expect(detail.getByText(`ตำแหน่งงาน: ${sales.jobTitle}`, { exact: true })).toBeVisible();
  await expect(detail.getByLabel('บทบาทปัจจุบัน', { exact: true })).toContainText('ฝ่ายขาย');
  expect(await detail.getByText(`ตำแหน่งงาน: ${sales.jobTitle}`, { exact: true }).evaluate(node => getComputedStyle(node).textOverflow)).not.toBe('ellipsis');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await detail.screenshot({ path: info.outputPath(`employee-job-title-${width}.png`) });
});
