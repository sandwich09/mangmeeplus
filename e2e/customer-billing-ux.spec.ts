import { test, expect } from './harness/fixtures';
import { gotoCompany } from './harness/e2e-utils';
import { expectNoClientError } from './harness/auth';

for (const width of [1280, 390]) {
  test(`BILLING-UX package and picker have consistent navigation at ${width}px`, async ({ authedPage: page, companyId }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/billing')) writes.push(request.url()); });
    await gotoCompany(page, companyId, '/settings/branches');
    if (width < 768) await page.getByRole('button', { name: 'สลับเมนู', exact: true }).click();
    await page.locator('aside a[href$="/billing"]').click();
    const title = page.getByRole('heading', { name: 'แพ็กเกจและการชำระเงิน', exact: true });
    await expect(title).toBeVisible();
    await expect(page.locator('aside')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /กลับแดชบอร์ด|กลับไปใช้งาน/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'เลือกบริษัทอื่น', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'ตรวจผลการชำระเงิน' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'สถานะแพ็กเกจ' })).toContainText('ใบเสร็จคงเหลือ');
    const emailPanel = page.getByRole('region', { name: 'อีเมลบัญชีของฉัน', exact: true });
    await expect(emailPanel).toHaveCount(0);
    await expect(emailPanel.locator('.mangmee-card')).toHaveCount(0);
    await expect(page.getByText('ยืนยันอีเมลก่อนชำระเงิน', { exact: true })).toHaveCount(0);
    await expect(emailPanel.getByText('ไม่ได้รับรหัสยืนยันทางอีเมล', { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(title).toBeVisible();
    await expect(page.getByRole('region', { name: 'สถานะแพ็กเกจ' })).toBeVisible();
    await expect(emailPanel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'สลับบริษัท', exact: true })).toBeVisible();
    await expect(page.locator('aside')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /กลับแดชบอร์ด|กลับไปใช้งาน/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`billing-overview-${width}.png`), fullPage: true });

    const companies = await (await page.request.get('/api/v1/auth/me/companies')).json();
    const other = companies.data.find((item: { companyId: string; roles: string[]; expired?: boolean }) => item.companyId !== companyId && item.roles.includes('OWNER') && !item.expired);
    expect(other, 'local fixture has another owned company').toBeTruthy();
    await page.getByRole('button', { name: 'สลับบริษัท', exact: true }).click();
    await page.getByRole('button', { name: new RegExp(other.companyName) }).click();
    await expect(page).toHaveURL(new RegExp(`/companies/${other.companyId}/billing$`));
    await expect(title).toBeVisible();
    await expect(page.getByRole('link', { name: 'เลือกบริษัทอื่น', exact: true })).toHaveCount(0);

    // Standalone recovery picker remains available from its existing deep link.
    await page.goto(`/billing/companies?fromCompany=${companyId}`);
    await expect(page.getByRole('heading', { name: 'เลือกบริษัทที่จะจัดการแพ็กเกจ' })).toBeVisible();
    const back = page.getByRole('link', { name: /^กลับแพ็กเกจของ / });
    await expect(back).toHaveAttribute('href', `/companies/${companyId}/billing`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`billing-picker-${width}.png`), fullPage: true });
    await back.click();
    await expect(title).toBeVisible();
    await expect(page.locator('aside')).toHaveCount(1);
    await page.goto(`/billing/companies?fromCompany=${companyId}`);
    await page.getByRole('link', { name: /^ดูแพ็กเกจของ / }).filter({ hasText: 'ดูแพ็กเกจ' }).first().click();
    await expect(title).toBeVisible();
    await expect(page.getByRole('link', { name: 'เลือกบริษัทอื่น', exact: true })).toHaveCount(0);
    expect(writes).toEqual([]);
    await expectNoClientError(page);
  });
}

test('BILLING-UX recipient panel offers the verified account email only when it is verified and never reads it for buying', async ({ authedPage: page, companyId }) => {
  let failRead = false, requirement = 'READY', accountReads = 0;
  await page.route('**/api/v1/auth/account/email/otp', route => { accountReads++; return route.fulfill({ status: failRead ? 503 : 200, json: failRead ? { message: 'Temporary test outage' } : {
    email: 'owner@example.com', emailVerified: true, emailRequirement: requirement, emailRevision: 0,
    hasPassword: true, lineLinked: false, challenge: null, serverNow: new Date().toISOString(),
  } }); });
  await page.route(`**/api/v1/companies/${companyId}/billing`, async route => {
    const data = await (await route.fetch()).json();
    await route.fulfill({ json: { ...data, recipient: { email: 'accounts@example.com', source: 'STRIPE_CHECKOUT', bouncedAt: null, canChange: true } } });
  });
  await page.route(`**/api/v1/companies/${companyId}/billing/recipient`, route => route.fulfill({ json: { hasCustomer: true, email: 'accounts@example.com', operation: null, busy: false } }));
  await page.goto(`/companies/${companyId}/billing`);
  await expect(page.getByRole('region', { name: 'สถานะแพ็กเกจ' })).toBeVisible();
  // RV05: buying never waits on the account email, so the package page does not read it.
  expect(accountReads).toBe(0);
  await page.getByRole('button', { name: 'การต่ออายุและชำระเงิน', exact: true }).click();
  const recipient = page.getByRole('region', { name: 'ผู้รับเอกสารของร้าน', exact: true });
  await expect(recipient).toContainText('accounts@example.com');
  await recipient.getByRole('button', { name: 'แก้อีเมลรับเอกสาร', exact: true }).click();
  const accountOption = recipient.getByRole('radio', { name: /ใช้อีเมลบัญชีที่ยืนยันแล้ว/ });
  await expect(accountOption).toHaveAccessibleName(/owner@example\.com/);
  await expect(recipient.getByRole('radio', { name: 'ใช้อีเมลอื่น', exact: true })).toBeVisible();
  // An unreadable account email is simply not offered; the code path stays open.
  failRead = true;
  await recipient.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await recipient.getByRole('button', { name: 'แก้อีเมลรับเอกสาร', exact: true }).click();
  await expect(recipient.getByRole('radio', { name: 'ใช้อีเมลอื่น', exact: true })).toBeVisible();
  await expect(accountOption).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: 'ยังตรวจสอบอีเมลบัญชีไม่ได้' })).toHaveCount(0);
  failRead = false; requirement = 'CHANGE_PENDING';
  await recipient.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
  await recipient.getByRole('button', { name: 'แก้อีเมลรับเอกสาร', exact: true }).click();
  await expect(recipient.getByRole('radio', { name: 'ใช้อีเมลอื่น', exact: true })).toBeVisible();
  await expect(accountOption).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'อีเมลบัญชีของฉัน', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'เปลี่ยนอีเมล', exact: true })).toHaveCount(0);
});

test('BILLING-UX payment recheck tells the truth and documents return to history', async ({ authedPage: page, companyId }) => {
  let refreshes = 0, fail = false;
  await page.route(`**/api/v1/companies/${companyId}/billing`, async route => {
    const original = await route.fetch();
    const data = await original.json();
    await route.fulfill({ json: { ...data, paymentState: 'PENDING', allowedActions: [] } });
  });
  await page.route(`**/api/v1/companies/${companyId}/billing/refresh`, async route => {
    refreshes++;
    await route.fulfill({ status: fail ? 503 : 200, json: fail ? { message: 'Temporary test outage' } : { queued: true } });
  });
  await page.goto(`/companies/${companyId}/billing`);
  const check = page.getByRole('button', { name: 'ตรวจผลการชำระเงิน', exact: true });
  await expect(check).toBeVisible();
  expect(refreshes).toBe(0);
  await check.click();
  await expect(page.getByRole('status').filter({ hasText: 'ส่งคำขอตรวจสอบแล้ว' })).toContainText('ยังไม่ใช่ผลยืนยันการชำระเงิน');
  expect(refreshes).toBe(1);
  await page.getByRole('button', { name: 'อัปเดตข้อมูล', exact: true }).click();
  expect(refreshes).toBe(1);
  fail = true;
  await check.click();
  // A 503 is an outage to retry, not an unconfirmed result to report with a reference.
  await expect(page.getByRole('alert').filter({ hasText: 'บริการที่จำเป็นยังไม่พร้อมใช้งาน' })).toBeVisible();
  await expect(page.locator('aside')).toHaveCount(1);

  const invoiceId = '00000000-0000-4000-8000-000000000001';
  await page.route(`**/api/v1/companies/${companyId}/billing/invoices/${invoiceId}/adjustments/refunds`, route => route.fulfill({ json: {
    mode: 'TEST', invoiceNumber: 'TEST-INVOICE', canOpenDocuments: false, observedAt: new Date().toISOString(), kind: 'refunds', items: [], nextCursor: null,
  } }));
  await page.goto(`/companies/${companyId}/billing/invoices/${invoiceId}`);
  await expect(page.getByRole('heading', { name: 'เอกสารการชำระเงิน', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'กลับไปประวัติการชำระเงิน', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/billing#billing-history$`));
  await expect(page.getByRole('region', { name: 'ประวัติการชำระเงิน', exact: true })).toBeVisible();
});

test('BILLING-UX recovery never mounts business reads and picker rejects an unowned return company', async ({ authedPage: page, companyId }) => {
  const businessReads: string[] = [];
  page.on('request', request => { if (/\/branches\?|\/notifications|\/profile-checklist/.test(request.url())) businessReads.push(request.url()); });
  const response = await page.request.get(`/api/v1/companies/${companyId}/billing`);
  expect(response.ok()).toBeTruthy();
  const expiredOverview = { ...await response.json(), accessState: 'EXPIRED', allowedActions: [] };
  await page.route(`**/api/v1/companies/${companyId}/billing`, route => route.fulfill({ json: expiredOverview }));
  await page.goto(`/companies/${companyId}/billing`);
  await expect(page.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'กลับหน้าเลือกบริษัท', exact: true })).toBeVisible();
  expect(businessReads).toEqual([]);
  await page.goto(`/account/email?company=${companyId}&interval=year`);
  await expect(page.getByRole('heading', { name: 'จัดการอีเมลบัญชี', exact: true })).toBeVisible();
  // pr-d §3.11: the account email is for sign-in and notices; buying never waits on it (RV05).
  await expect(page.getByText('ไม่ต้องยืนยันก่อนซื้อแพ็กเกจ')).toBeVisible();
  await expect(page.getByRole('region', { name: 'อีเมลบัญชีของฉัน', exact: true })).toBeVisible();
  const back = page.getByRole('link', { name: 'กลับไปเลือกแพ็กเกจ', exact: true });
  await expect(back).toHaveAttribute('href', `/companies/${companyId}/billing?interval=year`);
  await back.click();
  await expect(page.getByRole('heading', { name: 'แพ็กเกจหมดอายุแล้ว', exact: true })).toBeVisible();
  expect(businessReads).toEqual([]);
  // R-B4 (purchase-without-setup §18.2): reopening this page outside LINE's own browser keeps
  // `channel=line` on the URL, so a session-less /login?next=<this> auto-starts LINE login (R-B5).
  await page.goto(`/account/email?company=${companyId}&channel=line`);
  await expect(page).toHaveURL(/channel=line/);
  await page.goto('/billing/companies?fromCompany=not-an-owned-company');
  await expect(page.getByRole('heading', { name: 'เลือกบริษัทที่จะจัดการแพ็กเกจ' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'กลับหน้าหลัก', exact: true })).toHaveAttribute('href', '/');
  await expect(page.locator('a[href*="not-an-owned-company"]')).toHaveCount(0);
});
