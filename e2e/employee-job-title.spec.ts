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
  await expect(row).toContainText(sales.displayName);
  await row.click();
  const detail = page.getByTestId('employee-detail-card');
  await expect(detail.getByRole('heading', { name: sales.displayName, exact: true })).toBeVisible();
  const historyResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/auth/account/display-name') && url.searchParams.get('userId') === sales.userId;
  });
  await detail.getByText('ประวัติการแก้ชื่อ', { exact: true }).click();
  const responseHistory = await historyResponse;
  expect(responseHistory.ok()).toBe(true);
  const { history } = await responseHistory.json() as { history: { oldName: string; newName: string; changedByName: string | null }[] };
  if (history.length) {
    await expect(detail.getByText(`${history[0]!.oldName} → ${history[0]!.newName}`, { exact: true }).first()).toBeVisible();
    await expect(detail.getByText(history[0]!.changedByName ? `แก้โดย ${history[0]!.changedByName}` : 'ไม่พบชื่อผู้แก้ไข', { exact: true }).first()).toBeVisible();
  } else {
    await expect(detail.getByText('ยังไม่มีการแก้ชื่อ', { exact: true })).toBeVisible();
  }
  await expect(detail.getByText(`ตำแหน่งงาน: ${sales.jobTitle}`, { exact: true })).toBeVisible();
  await expect(detail.getByLabel('บทบาทปัจจุบัน', { exact: true })).toContainText('ฝ่ายขาย');
  expect(await detail.getByText(`ตำแหน่งงาน: ${sales.jobTitle}`, { exact: true }).evaluate(node => getComputedStyle(node).textOverflow)).not.toBe('ellipsis');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await detail.screenshot({ path: info.outputPath(`employee-job-title-${width}.png`) });
  await detail.getByRole('button', { name: 'แก้ไขข้อมูล', exact: true }).click();
  await expect(page.getByRole('group', { name: 'ชื่อที่แสดง', exact: true })).toBeVisible();
});
