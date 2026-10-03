import { test, expect } from './harness/fixtures';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../apps/api/src/generated/prisma/client';
import { SEED_USERS, ensureBrowserLegalAcceptance, expectNoClientError } from './harness/auth';
import { billingCompletedDays, billingLocalTime, billingTimeIso } from '../apps/web/src/features/billing-admin/billing-date-time';
import { randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import type { BillingPlanAdjustments } from '@watchdog-bms/contracts';

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('#login-identifier').fill(SEED_USERS.systemAdmin.username);
  await page.locator('#login-password').fill(SEED_USERS.systemAdmin.password);
  await page.getByRole('button', { name: /^(เข้าสู่ระบบ|Sign in)$/i }).click();
  await page.waitForURL(/\/(?:legal-acceptance(?:[/?]|$)|companies\/|system\/)/);
  await ensureBrowserLegalAcceptance(page.context());
}

let db: PrismaClient, accountId: string, issueId: string, invoiceId: string;
const companyId = `billing-menu-ux-${randomUUID()}`;
const companyName = 'บริษัททดสอบลำดับการใช้งาน';
const base = `/system/billing/companies/${companyId}`;

test.beforeAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  test.skip(!databaseUrl, 'Requires the isolated local UX database');
  const url = new URL(databaseUrl!);
  expect(['localhost', '127.0.0.1']).toContain(url.hostname);
  expect(url.pathname).toBe('/mangmee_ux');
  db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  await db.company.create({ data: { id: companyId, name: companyName } });
  const identity = { companyId, stripeAccountId: process.env['STRIPE_ACCOUNT_ID']!, livemode: false };
  accountId = (await db.billingAccount.create({ data: identity })).id;
  for (let i = 0; i < 26; i++) {
    const invoice = await db.billingInvoice.create({ data: { billingAccountId: accountId, providerInvoiceId: `in_${randomUUID()}`, offerSnapshot: {}, policyRevisionId: 'isolated-ui-proof', currency: 'THB', totalSatang: 49900, paidSatang: 49900,
      periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000), providerStatus: 'paid', evidenceHash: 'synthetic-ui-proof', applyStatus: 'HELD' } });
    if (i === 25) {
      invoiceId = invoice.id;
      issueId = (await db.billingIssue.create({ data: { ...identity, kind: 'PAID_HELD', referenceId: invoice.providerInvoiceId } })).id;
    }
  }
});
test.afterAll(async () => {
  if (!db) return;
  await db.auditLog.deleteMany({ where: { companyId } });
  await db.billingOperation.deleteMany({ where: { companyId } });
  await db.billingIssue.deleteMany({ where: { companyId } });
  await db.billingInvoice.deleteMany({ where: { billingAccountId: accountId } });
  await db.billingAccount.deleteMany({ where: { id: accountId } });
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

function observeWrites(page: import('@playwright/test').Page) {
  const writes: string[] = [];
  page.on('request', request => { if (request.url().includes('/system/billing/') && !['GET', 'HEAD'].includes(request.method())) writes.push(request.url()); });
  return writes;
}

test('company overview prioritizes issues, separates history, paginates payments and preserves section drafts', async ({ page }) => {
  const writes = observeWrites(page);
  await login(page);
  await page.goto(base);
  await expect(page.getByRole('heading', { name: companyName, exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'ดูวิธีแก้ปัญหา', exact: true })).toHaveAttribute('href', `/system/billing/issues/${issueId}`);
  await expect(page.getByRole('region', { name: 'ประวัติแพ็กเกจและการชำระเงิน', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('เหตุผลการตรวจสอบ', { exact: true })).toBeHidden();
  expect(await page.locator('main').innerText()).not.toContain(invoiceId);
  await page.getByRole('link', { name: 'รายการชำระเงิน', exact: true }).click();
  const payments = page.getByRole('region', { name: 'รายการชำระเงินของบริษัท', exact: true });
  await expect(payments.getByRole('article')).toHaveCount(25);
  await payments.getByRole('button', { name: 'หน้าถัดไป', exact: true }).click();
  await expect(payments.getByRole('article')).toHaveCount(1);
  await expect(page).toHaveURL(/view=payments/);
  await payments.getByRole('button', { name: 'หน้าแรก', exact: true }).click();
  await expect(payments.getByRole('article')).toHaveCount(25);
  await page.getByRole('link', { name: 'ประวัติ', exact: true }).click();
  const history = page.getByRole('region', { name: 'ประวัติแพ็กเกจและการชำระเงิน', exact: true });
  await expect(history.getByRole('article')).toHaveCount(25);
  expect(await history.innerText()).not.toContain(invoiceId);
  await page.getByRole('link', { name: 'ปรับแพ็กเกจและตรวจสอบ', exact: true }).click();
  await page.getByText('ตรวจข้อมูลกับ Stripe เพิ่มเติม', { exact: true }).click();
  await page.getByText('บันทึกเหตุผล (ระบบใส่ให้แล้ว)', { exact: true }).click();
  const reason = page.getByLabel('เหตุผลการตรวจสอบ', { exact: true });
  await reason.fill('ร่างตรวจข้อมูล ต้องไม่หายเมื่อเปลี่ยนหมวด');
  await page.getByRole('link', { name: 'ภาพรวม', exact: true }).click();
  await page.getByRole('button', { name: 'อัปเดตข้อมูลบริษัท', exact: true }).click();
  await expect(page.getByRole('button', { name: 'อัปเดตข้อมูลบริษัท', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'ปรับแพ็กเกจและตรวจสอบ', exact: true }).click();
  await expect(reason).toHaveValue('ร่างตรวจข้อมูล ต้องไม่หายเมื่อเปลี่ยนหมวด');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.reload();
  await expect(page.getByRole('region', { name: 'ปรับแพ็กเกจและตรวจสอบบริษัท', exact: true })).toBeVisible();
  await page.route(`**/api/v1${base}`, route => route.fulfill({ status: 403, json: {} }));
  await page.getByRole('button', { name: 'อัปเดตข้อมูลบริษัท', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'บัญชีนี้ไม่มีสิทธิ์' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'ข้อมูลการชำระเงินบริษัท', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'ประวัติแพ็กเกจและการชำระเงิน', exact: true })).toHaveCount(0);
  await page.unroute(`**/api/v1${base}`);
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click();
  await expect(page.getByRole('region', { name: 'ปรับแพ็กเกจและตรวจสอบบริษัท', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  await expectNoClientError(page);
});

test('plan tools show one task at a time and preserve draft input without creating a command', async ({ page }) => {
  // UI contract fixture only. No provider or entitlement change is submitted.
  const capacity = { tierKey: 'BASIC_499' as const, branchLimit: 2, employeeLimit: 5 };
  const data: BillingPlanAdjustments = { companyId, companyName, sourceHash: 'ui-only', baseline: capacity, current: capacity, activeBranches: 1, activeMembers: 1,
    maxExpiresAt: new Date(Date.now() + 86400000).toISOString(), canCreate: true, canManageCollection: true, blockedReason: null, unchanged: null, items: [], nextCursor: null };
  await page.route(`**/api/v1${base}/plan-adjustments`, route => route.fulfill({ json: data }));
  const writes = observeWrites(page);
  await login(page);
  await page.goto(`${base}/plan-adjustments`);
  const task = page.getByRole('combobox', { name: 'ต้องการทำอะไร', exact: true });
  await expect(task).toBeVisible();
  await expect(page.getByRole('button', { name: 'ตรวจสิทธิ์ก่อนส่งคำขอ', exact: true })).toBeHidden();
  await task.click(); await page.getByRole('option', { name: 'ปรับแพ็กเกจชั่วคราว', exact: true }).click();
  await page.getByLabel('เหตุผลที่ปรับสิทธิ์', { exact: true }).fill('ร่างปรับสิทธิ์');
  await expect(page.getByRole('region', { name: 'แถมวันใช้งาน', exact: true })).toBeHidden();
  await task.click(); await page.getByRole('option', { name: 'เพิ่มวันใช้งาน', exact: true }).click();
  await expect(page.getByLabel('จำนวนวันแถม', { exact: true })).toBeVisible();
  await expect(page.getByLabel('เหตุผลที่ปรับสิทธิ์', { exact: true })).toBeHidden();
  await task.click(); await page.getByRole('option', { name: 'พักหรือกลับมาเก็บเงิน', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'รายการที่ต้องการ', exact: true })).toBeVisible();
  await task.click(); await page.getByRole('option', { name: 'ปรับแพ็กเกจชั่วคราว', exact: true }).click();
  await expect(page.getByLabel('เหตุผลที่ปรับสิทธิ์', { exact: true })).toHaveValue('ร่างปรับสิทธิ์');
  await page.setViewportSize({ width: 390, height: 844 });
  await task.click(); await task.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect(writes).toEqual([]);
});

test('invoice documents keep refunds secondary, hide internal IDs and never ask admins to email themselves', async ({ page }) => {
  await page.route(`**/api/v1${base}/invoices/${invoiceId}/adjustments/*`, route => route.fulfill({ json: {
    invoiceId, invoiceNumber: 'INV-UX-001', kind: route.request().url().endsWith('credit-notes') ? 'credit-notes' : 'refunds', mode: 'TEST',
    items: [{ id: randomUUID(), number: null, amountSatang: 10000, createdAt: new Date().toISOString(), status: 'failed' }], nextCursor: null, observedAt: new Date().toISOString(), canOpenDocuments: true,
  } }));
  const writes = observeWrites(page);
  await login(page); await page.goto(`${base}/invoices/${invoiceId}`);
  await expect(page.getByRole('region', { name: 'เอกสารจากผู้ให้บริการรับชำระเงิน', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'รายละเอียดการปรับยอด', exact: true })).toBeHidden();
  await page.getByText('ประวัติคืนเงินและเอกสารปรับยอด', { exact: true }).click();
  await expect(page.locator('a[href^="mailto:"]')).toHaveCount(0);
  expect(await page.locator('main').innerText()).not.toContain(invoiceId);
  await expect(page.getByRole('link', { name: 'ตรวจหรือสร้างคำขอคืนเงิน', exact: true })).toBeHidden();
  await page.getByText('ต้องการคืนเงินให้ลูกค้า', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'ตรวจหรือสร้างคำขอคืนเงิน', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'รายการที่ต้องการดู', exact: true }).click();
  await page.getByRole('option', { name: 'เอกสารปรับยอด', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'เอกสารปรับยอด', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'กลับไปประวัติการชำระเงิน', exact: true }).click();
  await expect(page.getByRole('region', { name: 'รายการชำระเงินของบริษัท', exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test('all billing routes retain a readable heading, recovery navigation and mobile layout', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await login(page);
  // Empty detail IDs intentionally verify recovery paths; populated company/issue paths use local fixtures.
  const missingId = randomUUID();
  const root = 'apps/web/app/system/billing';
  const templates = readdirSync(root, { recursive: true }).map(String).filter(path => path.endsWith('page.tsx')).sort();
  const writes = observeWrites(page), errors: string[] = [], results: unknown[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const template of templates) {
    const segments = template.replace(/\/?page\.tsx$/, '').split('/').filter(Boolean);
    const route = '/system/billing' + (segments.length ? '/' + segments.map((part, index) => part.startsWith('[') ? segments[index - 1] === 'companies' ? companyId : segments[index - 1] === 'issues' ? issueId : missingId : part).join('/') : '');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /^กำลัง/ })).toHaveCount(0, { timeout: 20_000 });
    await expect(page.locator('a[href="/system/billing"]').first()).toBeAttached();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    expect(overflow, route).toBeLessThanOrEqual(1);
    expect(await page.locator('main select:visible').count(), `${route}: use themed select`).toBe(0);
    await expectNoClientError(page);
    results.push({ template, route, heading: await page.getByRole('heading', { level: 1 }).innerText(), alerts: await page.getByRole('alert').allTextContents(), width: 390, overflow });
  }
  // A tripwire: a new admin page must join this sweep. 57d90305d added the two recipient-change pages.
  expect(templates).toHaveLength(39);
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
  await testInfo.attach('billing-route-review', { body: JSON.stringify(results, null, 2), contentType: 'application/json' });
});

test('settings selectors retain policy permission locks and permit keyboard selection only when allowed', async ({ page }) => {
  let policyAllowed = false;
  await page.route('**/api/v1/system/billing/settings', async route => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ json: { ...data, capabilities: policyAllowed ? ['system.billing.gate.manage', 'system.billing.policy.manage'] : ['system.billing.gate.manage'] } });
  });
  const writes = observeWrites(page);
  await login(page); await page.goto('/system/billing/settings');
  const tax = page.getByRole('combobox', { name: 'ภาษีมูลค่าเพิ่ม', exact: true });
  const sales = page.getByRole('combobox', { name: 'เปิดรับรายการซื้อใหม่สำหรับ', exact: true });
  await expect(page.locator('[aria-label="ภาษีมูลค่าเพิ่ม"]')).toHaveAttribute('aria-disabled', 'true');
  const topic=page.getByRole('combobox',{name:'หัวข้อการตั้งค่า',exact:true});
  await topic.click(); await page.getByRole('option',{name:'เปิด–ปิดการซื้อและบริการ',exact:true}).click();
  await expect(sales).toHaveAttribute('aria-disabled', 'true');
  policyAllowed = true;
  await page.getByText('การเชื่อมต่อและการอ่านข้อมูลใหม่',{exact:true}).click();
  await page.getByRole('button', { name: 'อ่านการตั้งค่าใหม่', exact: true }).click();
  await expect(sales).toHaveAttribute('aria-disabled','false');
  await topic.click(); await page.getByRole('option',{name:'ภาษี ระยะผ่อนผัน และวงเงินคืนเงิน',exact:true}).click();
  await expect(tax).toHaveAttribute('aria-disabled', 'false');
  await tax.click();
  await page.getByRole('option', { name: 'ปิด — ยังไม่จด VAT', exact: true }).click();
  expect(writes).toEqual([]);
});


test('billing periods use Bangkok calendar days and reject invalid dates and times', () => {
  const now=Date.parse('2026-09-16T19:30:00Z');
  expect(billingLocalTime(now)).toBe('2026-09-17T02:30');
  expect(billingCompletedDays(1,now)).toEqual({start:'2026-09-16T00:00',end:'2026-09-17T00:00'});
  expect(billingCompletedDays(7,now)).toEqual({start:'2026-09-10T00:00',end:'2026-09-17T00:00'});
  expect(billingTimeIso('2026-09-16T00:00')).toBe('2026-09-15T17:00:00.000Z');
  for(const invalid of ['2026-02-30T12:00','2026-09-16T25:00','2026-09-16T12:7','T12:00',''])expect(billingTimeIso(invalid)).toBeNull();
});

test('settlement has a usable default, themed custom dates and blocks incomplete periods without requests', async ({page}) => {
  await page.route('**/api/v1/system/billing/settlements?*',r=>r.fulfill({json:{items:[],nextCursor:null,canCreate:true}}));
  const writes=observeWrites(page);
  await login(page);
  const now=new Date('2026-09-16T10:00:00.000Z');
  await page.clock.setFixedTime(now);
  await page.goto('/system/billing/settlements');
  const start=page.getByRole('button',{name:'เริ่มตรวจยอดช่วงนี้',exact:true});
  await expect(start).toBeEnabled();
  await page.getByLabel('กำหนดช่วงเอง',{exact:true}).check();
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
  await page.getByRole('textbox',{name:'เริ่มตรวจตั้งแต่ เวลา',exact:true}).fill('25:00');
  await start.click();
  expect(writes).toEqual([]);
  await page.getByRole('textbox',{name:'เริ่มตรวจตั้งแต่ เวลา',exact:true}).fill('00:00');
  const requests: {body:unknown;key:string|null}[]=[];
  await page.route('**/api/v1/system/billing/settlements',route=>{
    requests.push({body:route.request().postDataJSON(),key:route.request().headers()['idempotency-key']??null});
    return route.fulfill({status:503,json:{code:'SETTLEMENT_PROVIDER_UNAVAILABLE'}});
  });
  await start.click();
  await expect(start).toBeEnabled();
  await start.click();
  await expect(start).toBeEnabled();
  const range=billingCompletedDays(1,now.getTime());
  expect(requests).toHaveLength(2);
  expect(requests[0]!.body).toMatchObject({windowStart:billingTimeIso(range.start),windowEnd:billingTimeIso(range.end)});
  expect(requests[1]!.key).toBe(requests[0]!.key);
  expect(requests[0]!.key).toBeTruthy();
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
});

test('documents explain source mismatch, missing, denied and unavailable states without refund actions', async ({page}) => {
  await login(page);
  // The real isolated invoice intentionally lacks a Stripe customer binding.
  await page.goto(`${base}/invoices/${invoiceId}`);
  await expect(page.getByRole('heading',{name:'ข้อมูลรายการนี้ยังยืนยันกับผู้ให้บริการรับชำระเงินไม่ได้',exact:true})).toBeVisible();
  const states=[{status:403,code:'FORBIDDEN',title:'บัญชีนี้เปิดเอกสารไม่ได้'},{status:404,code:'NOT_FOUND',title:'ไม่พบเอกสารของรายการนี้'},{status:503,code:'BILLING_NOT_CONFIGURED',title:'ยังเชื่อมต่อเอกสารจากผู้ให้บริการรับชำระเงินไม่ได้'},{status:409,code:'BILLING_DOCUMENT_PENDING',title:'เอกสารยังไม่พร้อมเปิด'}];
  for(const state of states){
    await page.route(`**/api/v1${base}/invoices/${invoiceId}/adjustments/*`,r=>r.fulfill({status:state.status,json:{code:state.code,message:state.code}}));
    await page.reload();
    await expect(page.getByRole('heading',{name:state.title,exact:true})).toBeVisible();
    await expect(page.getByRole('button',{name:'เปิดใบเสร็จรับเงิน',exact:true})).toHaveCount(0);
    await expect(page.getByRole('link',{name:'ตรวจหรือสร้างคำขอคืนเงิน',exact:true})).toHaveCount(0);
    await page.unroute(`**/api/v1${base}/invoices/${invoiceId}/adjustments/*`);
  }
});

test('paid invoice recovery keeps its draft on refresh and directs blocked plan adjustments to payments', async ({page}) => {
  const writes=observeWrites(page);
  await login(page); await page.goto(`${base}/apply-invoices/${invoiceId}`);
  await expect(page.getByText('มีหลักฐานว่าชำระครบแล้ว',{exact:true})).toBeVisible();
  await page.getByText('บันทึกเหตุผล (ระบบใส่ให้แล้ว)',{exact:true}).click();
  const reason=page.getByLabel('เหตุผลการตรวจสอบ',{exact:true});
  await reason.fill('ร่างนี้ต้องคงอยู่หลังอ่านสถานะใหม่');
  await page.getByRole('button',{name:'อัปเดตสถานะ',exact:true}).click();
  await expect(page.getByRole('button',{name:'อัปเดตสถานะ',exact:true})).toBeEnabled();
  await expect(reason).toHaveValue('ร่างนี้ต้องคงอยู่หลังอ่านสถานะใหม่');
  await page.goto(`${base}/plan-adjustments`);
  await expect(page.getByRole('heading',{name:'ยังไม่มีแพ็กเกจที่พร้อมปรับสิทธิ์',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'ตรวจรายการชำระเงินของบริษัท',exact:true})).toHaveAttribute('href',`${base}?view=payments`);
  await expect(page.getByRole('combobox',{name:'ต้องการทำอะไร',exact:true})).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('settings preserves edits across topics, reveals invalid fields and replaces editor with preview', async ({page}) => {
  const posted: unknown[]=[];
  await page.route('**/api/v1/system/billing/configuration-changes/preview',async route=>{
    const body=route.request().postDataJSON();posted.push(body);
    await route.fulfill({json:{id:randomUUID(),type:'PUBLISH_POLICY',state:'PREVIEW',version:1,reason:body.reason,scope:{kind:'PLATFORM',mode:'TEST'},
      sourceVersion:body.expectedVersion,previewHash:'mock-preview-only',proposed:{policy:body.policy,gates:body.gates,effectiveAt:body.effectiveAt},impact:null,
      expiresAt:new Date(Date.now()+600000).toISOString(),allowedActions:['submit','cancel'],activeRevisionId:null,createdAt:new Date().toISOString()}});
  });
  await login(page);await page.goto('/system/billing/settings');
  await expect(page.getByLabel('เหตุผลการเปลี่ยนค่า',{exact:true})).toBeHidden();
  const topic=page.getByRole('combobox',{name:'หัวข้อการตั้งค่า',exact:true});
  const choose=async(name:string)=>{await topic.click();await page.getByRole('option',{name,exact:true}).click();};
  await choose('ราคาและสิทธิ์แพ็กเกจ');
  const price=page.getByLabel(/BASIC.*ราคารายเดือน/i);
  await price.fill('bad');
  await choose('ภาษี ระยะผ่อนผัน และวงเงินคืนเงิน');
  await page.getByLabel('ระยะผ่อนผันเมื่อต่ออายุไม่ผ่าน (วัน)',{exact:true}).fill('9');
  await page.getByLabel('เหตุผลการเปลี่ยนค่า',{exact:true}).fill('ทดสอบการแยกขั้นตอน ไม่มีการใช้ค่าจริง');
  await page.getByRole('button',{name:'2. ตรวจผลก่อนยืนยัน',exact:true}).click();
  await expect(price).toBeVisible(); // Invalid hidden field brings the user back to the relevant topic.
  expect(posted).toEqual([]);
  await price.fill('499');
  await choose('ภาษี ระยะผ่อนผัน และวงเงินคืนเงิน');
  await expect(page.getByLabel('ระยะผ่อนผันเมื่อต่ออายุไม่ผ่าน (วัน)',{exact:true})).toHaveValue('9');
  await page.getByRole('button',{name:'2. ตรวจผลก่อนยืนยัน',exact:true}).click();
  await expect(page.getByRole('heading',{name:'2. ตรวจผลก่อนยืนยัน',exact:true})).toBeVisible();
  await expect(topic).toHaveCount(0);
  await expect(page.getByRole('button',{name:'บันทึกคำขอก่อนยืนยัน',exact:true})).toBeDisabled();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({policy:{graceDays:9},reason:'ทดสอบการแยกขั้นตอน ไม่มีการใช้ค่าจริง'});
  await expectNoClientError(page);
});

test('settlement results distinguish unknown, partial and confirmed zero with one relevant next step', async ({page}) => {
  const id=randomUUID();
  const seed:import('@watchdog-bms/contracts').BillingSettlementRun={id,mode:'TEST',state:'BLOCKED',version:3,reason:'ตรวจยอดทดสอบ',windowStart:'2026-09-14T17:00:00.000Z',windowEnd:'2026-09-15T17:00:00.000Z',createdAt:'2026-09-16T01:00:00.000Z',observedAt:null,pages:0,seen:0,matched:0,different:0,missing:0,manual:0,totals:{grossCharges:'0',knownTax:'0',unknownTaxCharges:0,fees:'0',netMovement:'0',payouts:'0',payoutReversals:'0',excluded:0},errorCode:'SETTLEMENT_SOURCE_REVIEW',retryAt:null,canResume:true,canRun:false,canCancel:true};
  let run={...seed};
  await page.route(`**/api/v1/system/billing/settlements/${id}*`,route=>route.fulfill({json:run}));
  await page.route(`**/api/v1/system/billing/settlements/${id}/findings?*`,route=>route.fulfill({json:{items:[],nextCursor:null,caseIds:[randomUUID()]}}));
  const writes=observeWrites(page);
  await login(page);await page.goto(`/system/billing/settlements/${id}`);
  await expect(page.getByRole('heading',{name:'ยังตรวจยอดไม่สำเร็จ',exact:true})).toBeVisible();
  await expect(page.getByText('ยังสรุปยอดไม่ได้',{exact:true})).toBeVisible();
  expect(await page.locator('main').innerText()).not.toContain('฿0.00');
  await expect(page.getByRole('link',{name:'ตรวจการเชื่อมต่อ Stripe',exact:true})).toHaveAttribute('href','/system/billing/configuration-checks');
  await expect(page.getByRole('button',{name:'ลองตรวจยอดครั้งเดิมอีกครั้ง',exact:true})).toBeHidden();
  await expect(page.getByRole('link',{name:'ดูบันทึกติดตามปัญหา',exact:true})).toBeHidden();
  // A queued retry retains its prior source error until it has actually checked again.
  run={...seed,state:'QUEUED',canResume:false,canRun:true};await page.reload();
  await expect(page.getByRole('heading',{name:'ยังตรวจยอดไม่สำเร็จ',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'เริ่มตรวจยอด',exact:true})).toHaveCount(0);
  run={...seed,state:'RUNNING',seen:25,matched:25,observedAt:'2026-09-16T01:01:00.000Z',errorCode:null,canResume:false,canRun:true,totals:{...seed.totals,grossCharges:'100000',fees:'3000'}};await page.reload();
  await expect(page.getByRole('heading',{name:'ผลบางส่วนที่ตรวจได้',exact:true})).toBeVisible();
  await expect(page.getByText('ยอดด้านล่างรวมเฉพาะ 25 รายการที่ตรวจแล้ว ยังไม่ใช่ยอดครบทั้งช่วง',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'ตรวจรายการที่เหลือต่อ',exact:true})).toBeVisible();
  run={...seed,state:'SUCCEEDED',observedAt:'2026-09-16T01:01:00.000Z',errorCode:null,canResume:false,canCancel:false};await page.reload();
  await expect(page.getByRole('heading',{name:'ตรวจครบแล้ว ไม่พบรายการในช่วงนี้',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'ยอดเงินที่ตรวจได้',exact:true})).toBeVisible();
  expect(await page.getByRole('region',{name:'ยอดเงินที่ตรวจได้',exact:true}).innerText()).toContain('฿0.00');
  run={...seed,state:'SUCCEEDED',seen:25,matched:24,different:1,errorCode:null,canResume:false,canCancel:false};await page.reload();
  await expect(page.getByRole('heading',{name:'ตรวจครบแล้ว มีรายการต้องตรวจต่อ',exact:true})).toBeVisible();
  run={...seed,state:'QUEUED',errorCode:'SETTLEMENT_PROVIDER_UNAVAILABLE',retryAt:new Date(Date.now()+600000).toISOString(),canRun:false,canResume:false};await page.reload();
  await expect(page.getByRole('heading',{name:'รออ่านข้อมูลจาก Stripe อีกครั้ง',exact:true})).toBeVisible();
  await expect(page.getByRole('region',{name:'ยอดเงินที่ตรวจได้',exact:true})).toHaveCount(0);
  run={...seed,state:'CANCELLED',canCancel:false,canResume:false};await page.reload();
  await expect(page.getByRole('heading',{name:'ยกเลิกการตรวจครั้งนี้แล้ว',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'เลือกช่วงวันที่เพื่อตรวจใหม่',exact:true})).toBeVisible();
  run={...seed,canCancel:false,canResume:false};await page.reload();
  await expect(page.getByRole('heading',{name:'ยังตรวจยอดไม่สำเร็จ',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'ยืนยันยกเลิกการตรวจ',exact:true})).toHaveCount(0);
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
  expect(writes).toEqual([]);
  await expectNoClientError(page);
});

test('blocked settlement resume requires acknowledgement and cancellation needs a separate confirmation', async ({page}) => {
  const id=randomUUID();
  let run:import('@watchdog-bms/contracts').BillingSettlementRun={id,mode:'TEST',state:'BLOCKED',version:3,reason:'ทดสอบ UI เท่านั้น',windowStart:'2026-09-14T17:00:00.000Z',windowEnd:'2026-09-15T17:00:00.000Z',createdAt:'2026-09-16T01:00:00.000Z',observedAt:null,pages:0,seen:0,matched:0,different:0,missing:0,manual:0,totals:{grossCharges:'0',knownTax:'0',unknownTaxCharges:0,fees:'0',netMovement:'0',payouts:'0',payoutReversals:'0',excluded:0},errorCode:'SETTLEMENT_SOURCE_REVIEW',retryAt:null,canResume:true,canRun:false,canCancel:true};
  const commands:string[]=[];
  await page.route(`**/api/v1/system/billing/settlements/${id}**`,async route=>{
    const request=route.request();
    if(request.method()==='POST'){
      expect(request.postDataJSON()).toEqual({expectedVersion:run.version});
      const action=new URL(request.url()).pathname.split('/').at(-1)!;commands.push(action);
      expect(['resume','cancel']).toContain(action);
      run={...run,version:run.version+1,state:action==='resume'?'QUEUED':'CANCELLED',canResume:false,canRun:action==='resume',canCancel:action==='resume'};
    }
    await route.fulfill({json:request.url().includes('/findings')?{items:[],nextCursor:null,caseIds:[]}:run});
  });
  await login(page);await page.goto(`/system/billing/settlements/${id}`);
  await page.getByText('หลังแก้สาเหตุแล้ว หรือเมื่อต้องการยกเลิก',{exact:true}).click();
  const resume=page.getByRole('button',{name:'ลองตรวจยอดครั้งเดิมอีกครั้ง',exact:true});
  await expect(resume).toBeDisabled();
  await page.getByLabel('ตรวจและแก้สาเหตุแล้ว',{exact:true}).check();
  await resume.click();
  await expect(page.getByRole('heading',{name:'ยังตรวจยอดไม่สำเร็จ',exact:true})).toBeVisible();
  expect(commands).toEqual(['resume']);
  await page.getByText('หลังแก้สาเหตุแล้ว หรือเมื่อต้องการยกเลิก',{exact:true}).click();
  await expect(resume).toBeDisabled();
  const cancel=page.getByRole('button',{name:'ยกเลิกการตรวจครั้งนี้',exact:true});
  await cancel.click();expect(commands).toEqual(['resume']);
  await page.getByRole('button',{name:'ยังไม่ยกเลิก',exact:true}).click();expect(commands).toEqual(['resume']);
  await cancel.click();await page.getByRole('button',{name:'ยืนยันยกเลิกการตรวจ',exact:true}).click();
  await expect(page.getByRole('heading',{name:'ยกเลิกการตรวจครั้งนี้แล้ว',exact:true})).toBeVisible();
  expect(commands).toEqual(['resume','cancel']);
  await expect(page.getByRole('region',{name:'ยอดเงินที่ตรวจได้',exact:true})).toHaveCount(0);
});
