import { test, expect } from './harness/fixtures';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client';
import { SEED_USERS, ensureBrowserLegalAcceptance, expectNoClientError } from './harness/auth';
import { randomUUID } from 'node:crypto';
import { unique } from './harness/e2e-utils';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#login-identifier').fill(SEED_USERS.systemAdmin.username);
  await page.locator('#login-password').fill(SEED_USERS.systemAdmin.password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
  await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/|system\/)/);
  await ensureBrowserLegalAcceptance(page.context());
  await page.goto('/system/billing');
}

test('billing directory searches all pages, counts matching companies, returns and clears without moving controls', async ({ page }) => {
  const databaseUrl = process.env['DATABASE_URL'];
  test.skip(!databaseUrl, 'DATABASE_URL is required for the isolated billing directory fixtures');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const prefix = unique('billing-directory');
  const ids = Array.from({ length: 26 }, (_, i) => `${prefix}-${String(i).padStart(2, '0')}`);
  try {
    await client.company.createMany({ data: ids.map((id, i) => ({ id, name: `${prefix} ${i}` })) });
    await page.setViewportSize({ width: 1512, height: 900 });
    await login(page);
    const directory = page.getByRole('region', { name: 'แพ็กเกจและการชำระเงินของบริษัท' });
    const search = page.getByRole('searchbox', { name: 'ค้นหาบริษัท', exact: true });
    await expect(directory.getByRole('button', { name: 'ล้างตัวกรอง', exact: true })).toBeVisible();
    const initial = await search.boundingBox();
    await search.fill(prefix);
    expect(await search.boundingBox()).toEqual(initial);
    await directory.getByRole('button', { name: 'ค้นหา', exact: true }).click();
    await expect(directory.getByRole('status')).toContainText('พบ 26 บริษัท');
    await expect(directory.getByText('รายการ 1–25 จาก 26 บริษัท', { exact: true })).toBeVisible();
    await expect(directory.locator('tbody tr')).toHaveCount(25);
    await directory.getByRole('button', { name: 'ถัดไป', exact: true }).click();
    await expect(directory.getByText('รายการ 26–26 จาก 26 บริษัท', { exact: true })).toBeVisible();
    await directory.getByRole('link', { name: `${prefix} 25`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/companies/${ids[25]}`));
    await page.goBack();
    await expect(search).toHaveValue(prefix);
    await expect(directory.getByText('รายการ 26–26 จาก 26 บริษัท', { exact: true })).toBeVisible();
    await directory.getByRole('button', { name: 'ก่อนหน้า', exact: true }).click();
    await expect(directory.getByText('รายการ 1–25 จาก 26 บริษัท', { exact: true })).toBeVisible();
    await search.fill(`${prefix}-missing`);
    await directory.getByRole('button', { name: 'ค้นหา', exact: true }).click();
    await expect(directory.getByText('ไม่พบบริษัทที่ตรงกับคำค้น', { exact: true })).toBeVisible();
    await expect(directory.locator('table')).toHaveCount(0);
    await directory.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
    await expect(search).toHaveValue('');
    await expect(directory.getByRole('status')).toContainText(/พบ [\d,]+ บริษัท/);
    await expect(directory.locator('tbody tr')).toHaveCount(25);
    await expect(page).toHaveURL(/\/system\/billing$/);
    await expectNoClientError(page);
  } finally {
    await client.company.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  }
});

test('billing mobile exposes useful tools, plain trial state and local error references with retry', async ({ page }) => {
  const databaseUrl = process.env['DATABASE_URL'];
  test.skip(!databaseUrl, 'DATABASE_URL is required for the isolated billing directory fixtures');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const id = unique('billing-mobile-trial');
  try {
    await client.company.create({ data: { id, name: id } });
    await client.companyPlanTerm.create({ data: {
      companyId: id, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2, monthlySlipLimit: 15,
      termStartAt: new Date(), termEndsAt: new Date(Date.now() + 30 * 86400000),
    } });
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`/system/billing?search=${encodeURIComponent(id)}`);
    const directory = page.getByRole('region', { name: 'แพ็กเกจและการชำระเงินของบริษัท' });
    await expect(directory.getByRole('status')).toContainText('พบ 1 บริษัท');
    const trial = directory.getByRole('article', { name: id, exact: true });
    await expect(trial.getByText('ทดลองใช้ฟรี', { exact: true })).toHaveCount(1);
    await expect(trial.getByText('ทดลองใช้ถึง', { exact: true })).toBeVisible();
    await expect(trial).not.toContainText('ยังไม่มีสมาชิก Stripe');
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
    const tools = page.locator('summary').filter({ hasText: 'ตรวจสอบกับ Stripe' });
    await tools.click();
    await expect(page.getByRole('link', { name: /ตรวจสถานะหลายบริษัท/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /ประวัติแจ้งสถานะจาก Stripe/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await tools.press('Escape');
    await expect(page.getByRole('link', { name: /ตรวจสถานะหลายบริษัท/ })).toBeHidden();
    const search = page.getByRole('searchbox', { name: 'ค้นหาบริษัท', exact: true });
    const before = await search.boundingBox();
    await search.fill(`${id} `);
    expect(await search.boundingBox()).toEqual(before);
    await page.route('**/api/v1/system/billing/overview?*', route => route.fulfill({ status: 503, headers: { 'x-request-id': 'local-billing-review-503' }, contentType: 'application/json', body: JSON.stringify({ message: 'Simulated read outage' }) }));
    await directory.getByRole('button', { name: 'ค้นหา', exact: true }).click();
    await expect(directory.getByRole('alert')).toBeVisible();
    await directory.locator('summary').filter({ hasText: 'ข้อมูลสำหรับตรวจสอบภายใน' }).click();
    await expect(directory.getByText('เลขอ้างอิง: local-billing-review-503', { exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'ส่วนงานการชำระเงิน' })).toBeVisible();
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
    await page.unroute('**/api/v1/system/billing/overview?*');
    await directory.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
    await expect(directory.getByRole('status')).toContainText('พบ 1 บริษัท');
    await expect(search).toHaveValue(`${id} `);
    await page.getByRole('link', { name: 'ปัญหาการชำระเงิน', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'ปัญหาการชำระเงิน' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'ปัญหาการชำระเงิน', exact: true })).toHaveAttribute('aria-current', 'page');
  } finally {
    await client.company.deleteMany({ where: { id } });
    await client.$disconnect();
  }
});


test('billing issue queue uses themed filters, preserves page on return, and recovers from read errors without mutations', async ({ page }) => {
  const databaseUrl = process.env['DATABASE_URL'];
  const stripeAccountId = process.env['STRIPE_ACCOUNT_ID'];
  test.skip(!databaseUrl || !stripeAccountId || process.env['BILLING_MODE'] !== 'test', 'Requires isolated DB and TEST billing mode');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const companyId = unique('billing-issue-ux');
  const ids = Array.from({ length: 27 }, () => `00000000${randomUUID().slice(8)}`).sort();
  const past = new Date(Date.now() - 3600000), future = new Date(Date.now() + 86400000);
  const writes: string[] = [];
  try {
    const admin = await client.user.findUniqueOrThrow({ where: { username: SEED_USERS.systemAdmin.username } });
    await client.company.create({ data: { id: companyId, name: companyId } });
    await client.billingIssue.createMany({ data: ids.map((id, i) => ({
      id, stripeAccountId: stripeAccountId!, livemode: false, companyId, kind: 'PAID_NOT_APPLIED', referenceId: `${companyId}-${i}`,
      state: i === 0 ? 'ASSIGNED' : 'OPEN', assigneeUserId: i === 0 ? admin.id : null,
      priority: i === 0 ? 'HIGH' : 'NORMAL', followUpAt: i === 26 ? future : past,
    })) });
    await page.setViewportSize({ width: 1512, height: 900 });
    await login(page);
    page.on('request', request => { if (request.url().includes('/api/v1/system/billing/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.method() + ' ' + request.url()); });
    await page.getByRole('link', { name: 'ปัญหาการชำระเงิน', exact: true }).click();
    const list = page.getByRole('region', { name: 'รายการปัญหาการชำระเงิน', exact: true });
    const filter = page.getByRole('combobox', { name: 'แสดงรายการ', exact: true });
    const choose = async (label: string) => {
      await expect(list).toHaveAttribute('aria-busy', 'false');
      await filter.click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await expect(filter).toContainText(label);
      await expect(list).toHaveAttribute('aria-busy', 'false');
    };
    await expect(list.getByText(companyId, { exact: true })).toHaveCount(25);
    await expect(list.getByRole('status')).toContainText('แสดง 25 รายการในหน้านี้');
    await choose('ยังไม่มีคนรับเรื่อง');
    await expect(list.locator(`a[href^="/system/billing/issues/${ids[0]}"]`)).toHaveCount(0);
    await choose('เกินกำหนดติดตาม');
    await expect(list.locator(`a[href^="/system/billing/issues/${ids[0]}"]`)).toBeVisible();
    await list.getByRole('button', { name: 'หน้าถัดไป', exact: true }).click();
    const last = list.locator(`a[href^="/system/billing/issues/${ids[25]}"]`);
    await expect(last).toBeVisible();
    const returnUrl = page.url();
    await last.click();
    await expect(page.getByRole('region', { name: 'รายละเอียดเคส', exact: true }).getByText(companyId, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'ปัญหาการชำระเงิน', exact: true }).click();
    await expect(page).toHaveURL(returnUrl);
    await expect(last).toBeVisible();
    await page.reload();
    await expect(filter).toContainText('เกินกำหนดติดตาม');
    await expect(last).toBeVisible();
    await list.getByRole('button', { name: 'ล้างตัวกรอง', exact: true }).click();
    await expect(page).toHaveURL(/\/system\/billing\/issues$/);
    await expect(list.getByText(companyId, { exact: true })).toHaveCount(25);
    await page.setViewportSize({ width: 390, height: 844 });
    await filter.click();
    await expect(page.getByRole('option', { name: 'ยังไม่เสร็จทั้งหมด', exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.getByRole('option', { name: 'ยังไม่มีคนรับเรื่อง', exact: true }).click();
    await expect(list.locator(`a[href^="/system/billing/issues/${ids[0]}"]`)).toHaveCount(0);
    await expect(list).toHaveAttribute('aria-busy', 'false');
    await page.route('**/api/v1/system/billing/issues?*', route => route.fulfill({ status: 503, headers: { 'x-request-id': 'local-issue-503' }, contentType: 'application/json', body: '{}' }));
    await list.getByRole('button', { name: 'โหลดรายการใหม่', exact: true }).click();
    await expect(list.getByRole('alert')).toBeVisible();
    await expect(filter).toContainText('ยังไม่มีคนรับเรื่อง');
    await expect(list.getByRole('article')).toHaveCount(0);
    await expect(page.locator('summary').filter({ hasText: 'ตรวจสอบกับ Stripe' })).toBeVisible();
    await list.locator('summary').filter({ hasText: 'ข้อมูลสำหรับตรวจสอบภายใน' }).click();
    await expect(list.getByText('เลขอ้างอิง: local-issue-503', { exact: true })).toBeVisible();
    await page.unroute('**/api/v1/system/billing/issues?*');
    await list.getByRole('button', { name: 'ลองอีกครั้ง', exact: true }).click();
    await expect(list.getByText(companyId, { exact: true })).toHaveCount(25);
    await expect(filter).toContainText('ยังไม่มีคนรับเรื่อง');
    await page.route('**/api/v1/system/billing/issues?*', route => route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }));
    await list.getByRole('button', { name: 'โหลดรายการใหม่', exact: true }).click();
    await expect(list.getByRole('alert')).toContainText('บัญชีนี้ไม่มีสิทธิ์');
    await expect(page.locator('summary').filter({ hasText: 'ตรวจสอบกับ Stripe' })).toHaveCount(0);
    await expect(list.getByRole('article')).toHaveCount(0);
    expect(writes).toEqual([]);
    await expectNoClientError(page);
  } finally {
    await client.billingIssue.deleteMany({ where: { id: { in: ids } } });
    await client.company.deleteMany({ where: { id: companyId } });
    await client.$disconnect();
  }
});

test('billing issue guides original-invoice repair, confirms, observes closure and retains queue context', async ({ page }) => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  test.skip(!databaseUrl, 'Isolated local database required');
  const url = new URL(databaseUrl!);
  expect(['localhost','127.0.0.1']).toContain(url.hostname);
  expect(url.pathname).toBe('/mangmee_ux');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const companyId = unique('issue-repair-ui'), stripeAccountId = process.env['STRIPE_ACCOUNT_ID']!;
  const identity = { companyId, stripeAccountId, livemode:false };
  let accountId = '';
  try {
    await client.company.create({data:{id:companyId,name:companyId}});
    const account=await client.billingAccount.create({data:identity});accountId=account.id;
    // Synthetic previously verified evidence. No payment is sent to a provider by this test.
    const invoice=await client.billingInvoice.create({data:{billingAccountId:account.id,providerInvoiceId:`in_${randomUUID()}`,offerSnapshot:{},policyRevisionId:'isolated-ui-proof',currency:'THB',totalSatang:49900,paidSatang:49900,
      periodStart:new Date(),periodEnd:new Date(Date.now()+86400000),providerStatus:'paid',evidenceHash:'synthetic-ui-proof',applyStatus:'APPLIED',appliedAt:new Date()}});
    const issue=await client.billingIssue.create({data:{...identity,kind:'PAID_NOT_APPLIED',referenceId:invoice.providerInvoiceId}});
    const sibling=await client.billingIssue.create({data:{...identity,kind:'PAID_HELD',referenceId:randomUUID()}});
    const mutations:string[]=[];
    page.on('request',r=>{if(r.url().includes('/system/billing/') && r.method()!=='GET')mutations.push(r.url());});
    await login(page);
    await page.goto(`/system/billing/issues/${issue.id}?queue=UNASSIGNED&cursor=${sibling.id}`);
    const resolution=page.getByRole('region',{name:'วิธีแก้ปัญหา',exact:true});
    await expect(resolution.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true})).toBeVisible();
    await expect(page.getByLabel('บันทึกการดำเนินการ',{exact:true})).toBeHidden();
    await expect(resolution.getByRole('button',{name:'ตรวจผลการแก้ไข',exact:true})).toHaveCount(0);
    expect(mutations).toHaveLength(0);
    await expect(resolution.locator('button:visible')).toHaveCount(1);
    expect(await resolution.innerText()).not.toContain(issue.id);
    await expect(resolution.getByRole('button',{name:'อัปเดตข้อมูล',exact:true})).toBeHidden();
    await page.getByText('ผู้รับผิดชอบและบันทึกติดตาม',{exact:true}).click();
    await page.getByRole('button',{name:'รับเรื่องนี้',exact:true}).click();
    await expect.poll(async()=> (await client.billingIssue.findUniqueOrThrow({where:{id:issue.id}})).state).toBe('ASSIGNED');
    await expect(page.getByRole('status',{name:'สถานะปัญหา',exact:true})).toHaveText('รับงานแล้ว');
    expect(await client.billingReceiptGrant.count({where:{companyId}})).toBe(0);
    await expect(page.getByLabel('บันทึกการดำเนินการ',{exact:true})).toBeVisible();
    await page.getByRole('combobox',{name:'ความเร่งด่วน',exact:true}).click();
    await page.getByRole('option',{name:'สูง',exact:true}).click();
    await page.getByLabel('บันทึกการดำเนินการ',{exact:true}).fill('ติดตามใบเดิมก่อนตรวจสิทธิ์');
    await page.getByRole('button',{name:'บันทึกสถานะ',exact:true}).click();
    await expect.poll(async()=> (await client.billingIssue.findUniqueOrThrow({where:{id:issue.id}})).note).toBe('ติดตามใบเดิมก่อนตรวจสิทธิ์');
    const trackingNote=page.getByLabel('บันทึกการดำเนินการ',{exact:true});
    await expect(trackingNote).toBeVisible();
    await expect(trackingNote).toHaveValue('');
    await expect(page.getByLabel('ค้นหาผู้รับผิดชอบ',{exact:true})).toBeHidden();
    await page.getByText('เปลี่ยนผู้รับผิดชอบ',{exact:true}).click();
    await page.getByLabel('ค้นหาผู้รับผิดชอบ',{exact:true}).fill('ร่างค้นหาทีม');
    await trackingNote.fill('ร่างติดตาม ต้องไม่หายเมื่อบันทึกอีกส่วน');
    await trackingNote.evaluate(node=>node.setAttribute('data-preserved','tracking'));
    await page.getByText('ประวัติการติดต่อและบันทึกเพิ่มเติม',{exact:true}).click();
    const support=page.getByRole('region',{name:'ผลการติดต่อของเคส',exact:true});
    const contactNote=support.getByLabel('รายละเอียดผลติดต่อ',{exact:true});
    await contactNote.fill('ติดต่อแล้ว รอลูกค้าทดลองใช้งาน');
    await contactNote.evaluate(node=>node.setAttribute('data-preserved','contact'));
    await support.getByRole('combobox',{name:'ประเภทผลติดต่อ',exact:true}).click();
    await page.getByRole('option',{name:'ติดต่อลูกค้าแล้ว',exact:true}).click();
    await support.getByRole('button',{name:'ตรวจบันทึกก่อนยืนยัน',exact:true}).click();
    await expect(support.getByRole('button',{name:'ยืนยันบันทึกผลติดต่อ',exact:true})).toBeVisible();
    expect(new URL(page.url()).searchParams.get('queue')).toBe('UNASSIGNED');
    expect(new URL(page.url()).searchParams.get('cursor')).toBe(sibling.id);
    await support.getByRole('button',{name:'ยืนยันบันทึกผลติดต่อ',exact:true}).click();
    await expect(support.getByRole('status')).toHaveText('บันทึกผลติดต่อแล้ว');
    await expect(support.getByRole('button',{name:'ตรวจบันทึกก่อนยืนยัน',exact:true})).toBeEnabled();
    await expect(trackingNote).toHaveAttribute('data-preserved','tracking');
    await expect(contactNote).toHaveAttribute('data-preserved','contact');
    await expect(trackingNote).toHaveValue('ร่างติดตาม ต้องไม่หายเมื่อบันทึกอีกส่วน');
    await expect(page.getByLabel('ค้นหาผู้รับผิดชอบ',{exact:true})).toHaveValue('ร่างค้นหาทีม');
    await expect(contactNote).toHaveValue('ติดต่อแล้ว รอลูกค้าทดลองใช้งาน');
    await expect(resolution.getByRole('button',{name:'ตรวจผลการแก้ไข',exact:true})).toHaveCount(0);
    // Contact commits advance the issue version; saving a preserved tracking draft must still succeed.
    await page.getByRole('button',{name:'บันทึกสถานะ',exact:true}).click();
    await expect(trackingNote).toHaveValue('');
    await expect(contactNote).toHaveAttribute('data-preserved','contact');
    await expect(contactNote).toHaveValue('ติดต่อแล้ว รอลูกค้าทดลองใช้งาน');
    await contactNote.fill('ร่างใหม่ที่ขอยกเลิก');
    await support.getByRole('button',{name:'ตรวจบันทึกก่อนยืนยัน',exact:true}).click();
    await support.getByRole('button',{name:'ยกเลิกฉบับตรวจสอบ',exact:true}).click();
    await expect(support.getByRole('status')).toHaveText('ยกเลิกฉบับตรวจสอบแล้ว');
    await expect(contactNote).toHaveValue('ร่างใหม่ที่ขอยกเลิก');
    // Re-previewing unchanged text after cancellation must create a usable new draft.
    await support.getByRole('button',{name:'ตรวจบันทึกก่อนยืนยัน',exact:true}).click();
    await expect(support.getByRole('button',{name:'ยืนยันบันทึกผลติดต่อ',exact:true})).toBeVisible();
    await support.getByRole('button',{name:'ยกเลิกฉบับตรวจสอบ',exact:true}).click();
    await expect(support.getByRole('status')).toHaveText('ยกเลิกฉบับตรวจสอบแล้ว');
    await trackingNote.fill('ร่างที่ยังไม่ส่ง');
    await client.billingIssue.update({where:{id:issue.id},data:{priority:'NORMAL',version:{increment:1}}});
    // Refresh failure keeps both panels and drafts, then retry recovers in place.
    const detailRoute=`**/api/v1/system/billing/issues/${issue.id}`;
    await page.route(detailRoute,route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Simulated read outage"}'}));
    await support.getByRole('button',{name:'โหลดประวัติผลติดต่อล่าสุด',exact:true}).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('โหลดสถานะล่าสุดไม่ได้');
    await expect(trackingNote).toHaveValue('ร่างที่ยังไม่ส่ง');
    await expect(contactNote).toHaveValue('ร่างใหม่ที่ขอยกเลิก');
    await page.unroute(detailRoute);
    await page.getByRole('button',{name:'ลองโหลดอีกครั้ง',exact:true}).click();
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(trackingNote).toHaveAttribute('data-preserved','tracking');
    await expect(contactNote).toHaveAttribute('data-preserved','contact');
    await expect(page.getByRole('combobox',{name:'ความเร่งด่วน',exact:true})).toContainText('ปกติ');
    await page.setViewportSize({width:390,height:844});
    const command=page.getByRole('region',{name:'คำสั่งตรวจสอบการชำระเงิน',exact:true});
    await expect(command.getByLabel('เหตุผลการตรวจสอบ')).toBeHidden();
    await command.getByText('บันทึกเหตุผล (ระบบใส่ให้แล้ว)',{exact:true}).click();
    await expect(command.getByLabel('เหตุผลการตรวจสอบ')).toHaveValue('ตรวจและแก้การเปิดสิทธิ์จากรายการชำระเดิม');
    await command.getByLabel('เหตุผลการตรวจสอบ').fill('ตรวจใบเดิม พร้อมคงร่างระหว่างโหลดหลักฐาน');
    await command.getByText('ประวัติและข้อมูลอ้างอิง',{exact:true}).click();
    await command.getByRole('button',{name:'อัปเดตข้อมูล',exact:true}).click();
    await expect(command.getByLabel('เหตุผลการตรวจสอบ')).toHaveValue('ตรวจใบเดิม พร้อมคงร่างระหว่างโหลดหลักฐาน');
    await command.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true}).click();
    await expect(command.getByRole('button',{name:'ยืนยันแก้ไขรายการนี้',exact:true})).toBeVisible();
    await command.getByText('ประวัติและข้อมูลอ้างอิง',{exact:true}).click();
    // Preview history must not duplicate the current action in the main journey.
    await expect(command.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true})).toHaveCount(0);
    expect(await command.innerText()).not.toContain(issue.id);
    await expect(command.locator('button:visible')).toHaveCount(2);
    const preview=await client.billingOperation.findFirstOrThrow({where:{companyId,type:'RETRY_APPLY',state:'PREVIEW'}});
    expect(preview.referenceId).toBe(invoice.id);
    expect(preview.reason).toContain(issue.id);
    await command.getByRole('button',{name:'ยกเลิกการตรวจครั้งนี้',exact:true}).click();
    await expect(command.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true})).toBeVisible();
    await expect(resolution.getByRole('button',{name:'ตรวจผลการแก้ไข',exact:true})).toHaveCount(0);
    await command.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true}).click();
    await expect(command.getByRole('button',{name:'ยืนยันแก้ไขรายการนี้',exact:true})).toBeVisible();
    await expect(resolution.getByRole('button',{name:'ตรวจผลการแก้ไข',exact:true})).toHaveCount(0);
    expect((await client.billingIssue.findUniqueOrThrow({where:{id:issue.id}})).state).toBe('ASSIGNED');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
    await command.getByRole('button',{name:'ยืนยันแก้ไขรายการนี้',exact:true}).click();
    await expect(command.getByRole('status').filter({hasText:'รอระบบตรวจสอบ'})).toBeVisible();
    await expect(resolution.getByRole('button',{name:'ตรวจผลการแก้ไข',exact:true})).toBeEnabled();
    await expect(trackingNote).toHaveValue('ร่างที่ยังไม่ส่ง');
    await expect(contactNote).toHaveValue('ร่างใหม่ที่ขอยกเลิก');
    await page.route('**/api/v1/system/billing/operations**',route=>route.request().method()==='GET'?route.fulfill({status:503,contentType:'application/json',body:'{"message":"Simulated command read outage"}'}):route.continue());
    await command.getByText('ประวัติและข้อมูลอ้างอิง',{exact:true}).click();
    await command.getByRole('button',{name:'อัปเดตข้อมูล',exact:true}).click();
    await expect(command.getByRole('alert')).toContainText('โหลดคำสั่งล่าสุดไม่ได้');
    await expect(command.getByRole('status').filter({hasText:'รอระบบตรวจสอบ'})).toBeVisible();
    await expect(trackingNote).toHaveValue('ร่างที่ยังไม่ส่ง');
    await page.unroute('**/api/v1/system/billing/operations**');
    // Run the actual compiled worker only for this fixture company; provider access must never occur.
    const { createRequire }=await import('node:module');
    const apiRequire=createRequire(`${process.cwd()}/apps/api/package.json`);
    const { BillingAdminService }=apiRequire('./dist/apps/api/src/modules/billing/application/billing-admin.service.js');
    const { BillingOperationsService }=apiRequire('./dist/apps/api/src/modules/billing/application/billing-operations.service.js');
    const scoped=client.$extends({query:{billingOperation:{findMany({args,query}){return query({...args,where:{...args.where,companyId}});}}}});
    const billing={stripe:{enabled:true,accountId:stripeAccountId,livemode:false}};
    const admin=new BillingAdminService({client:scoped},billing);
    const worker=new BillingOperationsService({client:scoped},admin,billing,{reconcileAccount(){throw Error('test must never call provider');}},{});
    expect(await worker.drain()).toEqual({processed:1,failed:0});
    // Read the original command; terminal evidence refreshes the issue automatically.
    await command.getByRole('button',{name:'ลองโหลดข้อมูลอีกครั้ง',exact:true}).click();
    await expect(resolution.getByRole('heading',{name:'แก้ไขรายการนี้แล้ว',exact:true})).toBeVisible();
    expect(await client.billingReceiptGrant.count({where:{companyId}})).toBe(0);
    expect((await client.billingIssue.findUniqueOrThrow({where:{id:sibling.id}})).state).toBe('OPEN');
    expect(await client.auditLog.count({where:{targetId:issue.id,action:'billing.issue.resolved'}})).toBe(1);
    await page.getByRole('link',{name:'กลับรายการปัญหา',exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/system/billing/issues\\?queue=UNASSIGNED&cursor=${sibling.id}$`));
    // An unmatched reference goes to discovery; a failed source read never offers a guessed invoice.
    await page.goto(`/system/billing/issues/${sibling.id}`);
    await expect(page.getByRole('link',{name:'ตรวจใบแจ้งหนี้ของบริษัท',exact:true})).toHaveAttribute('href',`/system/billing/companies/${companyId}/invoice-scans`);
    await client.billingIssue.update({where:{id:issue.id},data:{state:'OPEN',resolvedAt:null}});
    await page.route(`**/api/v1/system/billing/companies/${companyId}/apply-invoices/${invoice.id}`,route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Simulated source read outage"}'}));
    await page.goto(`/system/billing/issues/${issue.id}`);
    await expect(resolution.getByRole('alert')).toContainText('โหลดหลักฐานรายการเดิมไม่ได้');
    await expect(resolution.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true})).toHaveCount(0);
    await page.unroute(`**/api/v1/system/billing/companies/${companyId}/apply-invoices/${invoice.id}`);
    await resolution.getByRole('button',{name:'ลองโหลดหลักฐานอีกครั้ง'}).click();
    await expect(resolution.getByRole('button',{name:'ตรวจสอบรายการนี้',exact:true})).toBeVisible();
    // A return visit recovers the previously submitted command from server history.
    await expect(resolution.getByRole('button',{name:'ตรวจผลการแก้ไข',exact:true})).toBeEnabled();
    await page.route(detailRoute,route=>route.fulfill({status:403,contentType:'application/json',body:'{"message":"Simulated access removal"}'}));
    await resolution.getByRole('button',{name:'ตรวจผลการแก้ไข',exact:true}).click();
    await expect(page.getByRole('region',{name:'รายละเอียดเคส',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'ลองโหลดอีกครั้ง',exact:true})).toBeEnabled();
    await page.unroute(detailRoute);
    await page.getByRole('button',{name:'ลองโหลดอีกครั้ง',exact:true}).click();
    await expect(page.getByRole('region',{name:'รายละเอียดเคส',exact:true})).toBeVisible();
    await expectNoClientError(page);
  } finally {
    await client.auditLog.deleteMany({where:{companyId}});
    await client.billingOperation.deleteMany({where:{companyId}});
    await client.billingIssue.deleteMany({where:{companyId}});
    if(accountId)await client.billingInvoice.deleteMany({where:{billingAccountId:accountId}});
    await client.billingAccount.deleteMany({where:{companyId}});
    await client.company.deleteMany({where:{id:companyId}});
    await client.$disconnect();
  }
});

test('billing operation history is readable, preserves return context and keeps confirmation and read guards', async ({ page }) => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  test.skip(!databaseUrl, 'Isolated local database required');
  const database = new URL(databaseUrl!);
  expect(['localhost', '127.0.0.1']).toContain(database.hostname);
  expect(database.pathname).toBe('/mangmee_ux');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const companyId = unique('operation-history-ui');
  let accountId = '';
  try {
    await client.company.create({ data: { id: companyId, name: companyId } });
    const identity = { companyId, stripeAccountId: process.env['STRIPE_ACCOUNT_ID']!, livemode: false };
    const account = await client.billingAccount.create({ data: identity }); accountId = account.id;
    const invoice = await client.billingInvoice.create({ data: { billingAccountId: account.id, providerInvoiceId: `in_${randomUUID()}`, offerSnapshot: {}, policyRevisionId: 'isolated-ui-proof', currency: 'THB', totalSatang: 49900, paidSatang: 49900,
      periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000), providerStatus: 'paid', evidenceHash: 'synthetic-ui-proof', applyStatus: 'APPLIED', appliedAt: new Date() } });
    const issue = await client.billingIssue.create({ data: { ...identity, kind: 'PAID_NOT_APPLIED', referenceId: invoice.providerInvoiceId } });
    const cursor = randomUUID(), issuePath = `/system/billing/issues/${issue.id}?queue=OVERDUE&cursor=${cursor}`;
    await login(page);
    await page.goto(issuePath);
    await page.getByRole('button', { name: 'ตรวจสอบรายการนี้', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ยืนยันแก้ไขรายการนี้', exact: true })).toBeVisible();
    await page.getByText('ประวัติและข้อมูลอ้างอิง', { exact: true }).click();
    const preview = await client.billingOperation.findFirstOrThrow({ where: { companyId, state: 'PREVIEW' } });
    const opPath = `/system/billing/operations/${preview.id}`, opApi = `**/api/v1/system/billing/operations/${preview.id}`;
    await page.getByRole('link', { name: 'เปิดรายละเอียดการดำเนินการนี้', exact: true }).click();
    const detail = page.getByRole('article', { name: 'รายละเอียดการดำเนินการ', exact: true });
    await expect(detail.getByRole('status')).toHaveText('รอยืนยัน');
    await expect(detail.getByRole('link', { name: 'กลับไปหน้าปัญหา', exact: true })).toHaveAttribute('href', issuePath);
    expect(await detail.innerText()).not.toContain(issue.id);
    expect(await detail.innerText()).not.toContain(preview.id);
    await expect(detail.getByRole('link', { name: 'เปิดลิงก์คำสั่งนี้', exact: true })).toHaveCount(0);
    await expect(detail.getByText('รอบแพ็กเกจของรายการเดิม เริ่ม', { exact: true })).toBeVisible();
    await expect(detail.getByText('รอบแพ็กเกจของรายการเดิม สิ้นสุด', { exact: true })).toBeVisible();
    await page.route(opApi, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"simulated read outage"}' }));
    await detail.getByRole('button', { name: 'อัปเดตสถานะ', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('อัปเดตข้อมูลไม่ได้');
    await expect(detail.getByRole('button', { name: 'ยืนยันดำเนินการ', exact: true })).toBeDisabled();
    await expect(detail.getByRole('status')).toHaveText('รอยืนยัน');
    await page.unroute(opApi);
    await page.getByRole('button', { name: 'ลองโหลดข้อมูลอีกครั้ง', exact: true }).click();
    await expect(detail.getByRole('button', { name: 'ยืนยันดำเนินการ', exact: true })).toBeEnabled();
    // Real preview/hash/version/idempotency submit, followed by real queued cancellation. No worker/provider.
    await detail.getByRole('button', { name: 'ยืนยันดำเนินการ', exact: true }).click();
    await expect(detail.getByRole('status')).toHaveText('รอระบบดำเนินการ');
    await detail.getByRole('button', { name: 'ยกเลิกครั้งนี้', exact: true }).click();
    await expect(detail.getByRole('status')).toHaveText('ยกเลิกการดำเนินการครั้งนี้แล้ว');
    await expect(detail.getByRole('button', { name: 'ยืนยันดำเนินการ', exact: true })).toHaveCount(0);
    await detail.getByRole('link', { name: 'กลับไปหน้าปัญหา', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${issuePath.replace('?', '\\?')}$`));
    await page.getByText('ประวัติและข้อมูลอ้างอิง', { exact: true }).click();
    await page.locator(`a[href^="${opPath}?"]`).click();
    await expect(detail.getByRole('status')).toHaveText('ยกเลิกการดำเนินการครั้งนี้แล้ว');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(detail.getByRole('link', { name: 'กลับไปหน้าปัญหา', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await detail.getByText('ข้อมูลอ้างอิงสำหรับตรวจสอบ', { exact: true }).click();
    await expect(detail.getByText(preview.reason, { exact: true })).toBeVisible();
    await expect(detail.getByText(preview.id, { exact: true })).toBeVisible();
    const responsePromise = page.waitForResponse(r => r.url().endsWith(`/operations/${preview.id}`) && r.request().method() === 'GET');
    await detail.getByRole('button', { name: 'อัปเดตสถานะ', exact: true }).click();
    const response = await responsePromise, base = await response.json();
    // UI variants use explicit simulated observations; they never prove payment or issue closure.
    const simulated = { ...base, version: base.version + 1, state: 'SUCCEEDED', allowedActions: [], observed: { issueCount: 1, pendingAttemptId: null, invoiceApplyState: 'APPLIED' } };
    await page.route(opApi, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(simulated) }));
    for (const [state, label] of [['SUCCEEDED', 'ดำเนินการเสร็จแล้ว'], ['BLOCKED', 'ยังดำเนินการต่อไม่ได้'], ['UNKNOWN', 'ยังยืนยันผลไม่ได้'], ['FAILED', 'ดำเนินการไม่สำเร็จ'], ['RUNNING', 'กำลังดำเนินการ'], ['PREVIEW', 'รอยืนยัน']]) {
      simulated.state = state; simulated.version++;
      await detail.getByRole('button', { name: 'อัปเดตสถานะ', exact: true }).click();
      await expect(detail.getByRole('status')).toHaveText(label);
      await expect(detail.getByRole('button', { name: 'ยืนยันดำเนินการ', exact: true })).toHaveCount(0);
    }
    await expect(detail.getByText(/ตอนนี้ยืนยันรายการนี้ไม่ได้/)).toBeVisible();
    await page.unroute(opApi);
    await page.route(opApi, route => route.fulfill({ status: 403, contentType: 'application/json', body: '{"message":"simulated access removal"}' }));
    await detail.getByRole('button', { name: 'อัปเดตสถานะ', exact: true }).click();
    await expect(detail).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toContainText('เปิดรายการนี้ไม่ได้');
    await page.unroute(opApi);
    await page.getByRole('button', { name: 'ลองโหลดข้อมูลอีกครั้ง', exact: true }).click();
    await expect(detail.getByRole('status')).toHaveText('ยกเลิกการดำเนินการครั้งนี้แล้ว');
    // Reject arbitrary/repeated return destinations; direct links retain an authorized source route.
    await page.goto(`${opPath}?issue=https://example.com&issue=${issue.id}&queue=INVALID&cursor=invalid`);
    await expect(detail.getByRole('link', { name: 'กลับไปหน้าปัญหา', exact: true })).toHaveCount(0);
    await expect(detail.getByRole('link', { name: 'เปิดรายการชำระเดิม', exact: true })).toHaveAttribute('href', `/system/billing/companies/${companyId}/apply-invoices/${invoice.id}`);
    await page.goto(`${opPath}?batch=${cursor}`);
    await expect(detail.getByRole('link', { name: 'กลับงานตรวจหลายบริษัท', exact: true })).toHaveAttribute('href', `/system/billing/batches/${cursor}`);
    expect((await client.billingOperation.findUniqueOrThrow({ where: { id: preview.id } })).state).toBe('CANCELLED');
    expect((await client.billingIssue.findUniqueOrThrow({ where: { id: issue.id } })).state).toBe('OPEN');
    expect(await client.billingReceiptGrant.count({ where: { companyId } })).toBe(0);
    await expectNoClientError(page);
  } finally {
    await client.auditLog.deleteMany({ where: { companyId } });
    await client.billingOperation.deleteMany({ where: { companyId } });
    await client.billingIssue.deleteMany({ where: { companyId } });
    if (accountId) await client.billingInvoice.deleteMany({ where: { billingAccountId: accountId } });
    await client.billingAccount.deleteMany({ where: { companyId } });
    await client.company.deleteMany({ where: { id: companyId } });
    await client.$disconnect();
  }
});
