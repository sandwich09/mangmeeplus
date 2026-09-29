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
}

// Purchase without setup PR E (R-E1/R-E2): two admin tools on an invoice page — resend the Stripe
// documents to the current recipient, and change who receives future documents. The recipient
// change is the same reviewed-operation shape as a refund (preview -> submit -> approve/cancel),
// so this proves preview/submit/approve/cancel, none of which call Stripe. The one action that
// would actually dispatch to Stripe ("run", and the resend form's own submit) is intentionally
// never clicked here: this codebase's e2e convention (see the original-invoice-repair test in
// billing-admin-directory.spec.ts) keeps real Stripe calls out of Playwright-driven runs, using a
// stubbed worker instead on the rare occasion the dispatch step itself needs proving.
test('admin opens the resend tool and completes a recipient change through to queued, on desktop and mobile', async ({ page }, info) => {
  test.setTimeout(120_000);
  const databaseUrl = process.env['DATABASE_URL'];
  const stripeAccountId = process.env['STRIPE_ACCOUNT_ID'];
  test.skip(!databaseUrl || !stripeAccountId || process.env['BILLING_MODE'] !== 'test', 'Requires isolated DB and TEST billing mode');
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const companyId = unique('billing-doc-tools');
  let accountId = '';
  let invoiceId = '';
  try {
    await client.company.create({ data: { id: companyId, name: companyId } });
    const account = await client.billingAccount.create({ data: {
      companyId, stripeAccountId: stripeAccountId!, livemode: false, customerId: `cus_test_${companyId}`,
    } });
    accountId = account.id;
    const invoice = await client.billingInvoice.create({ data: {
      billingAccountId: account.id, providerInvoiceId: `in_${randomUUID()}`, offerSnapshot: {}, policyRevisionId: 'e2e-doc-tools-policy',
      currency: 'thb', totalSatang: 149900, paidSatang: 149900, periodStart: new Date(), periodEnd: new Date(Date.now() + 86400000),
      providerStatus: 'paid', evidenceHash: 'e2e-doc-tools-evidence',
    } });
    invoiceId = invoice.id;

    await page.setViewportSize({ width: 1512, height: 900 });
    await login(page);
    await page.goto(`/system/billing/companies/${companyId}/invoices/${invoiceId}`);
    await expect(page.getByText('อีเมลรับเอกสารปัจจุบัน: ยังไม่มี')).toBeVisible();

    // Resend: open the form, prove the reason/password fields gate the submit button, then close
    // without submitting (submitting would call Stripe for real).
    await page.getByRole('button', { name: 'ส่งเอกสารซ้ำ', exact: true }).click();
    const resendSubmit = page.getByRole('button', { name: 'ส่งอีกครั้ง', exact: true });
    await expect(resendSubmit).toBeDisabled();
    await page.getByLabel('เหตุผลภายใน (ลูกค้าไม่เห็น)').fill('ทดสอบ e2e: ยืนยันว่าเปิดฟอร์มส่งเอกสารซ้ำได้');
    await expect(resendSubmit).toBeDisabled();
    await page.getByLabel('รหัสผ่านปัจจุบัน').fill('placeholder-never-submitted');
    await expect(resendSubmit).toBeEnabled();
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await expect(page.getByRole('button', { name: 'ส่งเอกสารซ้ำ', exact: true })).toBeVisible();

    // Recipient change, round 1 (desktop): preview -> submit -> cancel.
    await page.getByRole('link', { name: 'เปลี่ยนอีเมลผู้รับเอกสาร', exact: true }).click();
    await page.waitForURL(new RegExp(`/system/billing/companies/${companyId}/invoices/${invoiceId}/recipient$`));
    await expect(page.getByRole('heading', { name: 'เปลี่ยนอีเมลผู้รับเอกสาร', level: 1 })).toBeVisible();
    await expect(page.getByText('โหมดทดสอบ · ไม่มีการเปลี่ยนแปลงจริงกับลูกค้า')).toBeVisible();
    await page.getByLabel('อีเมลผู้รับเอกสารใหม่').fill('new-recipient-round1@example.com');
    await page.getByLabel('เหตุผลภายใน (ลูกค้าไม่เห็น)').fill('ทดสอบ e2e รอบที่ 1: ตรวจ preview แล้วยกเลิก');
    await page.getByRole('button', { name: 'ตรวจข้อมูลก่อนบันทึก', exact: true }).click();
    await page.waitForURL(/\/system\/billing\/recipient-changes\/[^/]+$/);
    await expect(page.getByRole('status', { name: 'ตรวจข้อมูลก่อนส่งคำขอ', exact: true })).toBeVisible();
    await page.getByLabel('รหัสผ่านปัจจุบัน').fill(SEED_USERS.systemAdmin.password);
    await page.getByRole('button', { name: 'ยืนยันรหัสผ่าน', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'ยืนยันแล้วถึง' })).toBeVisible();
    await page.getByRole('button', { name: 'บันทึกคำขอก่อนยืนยัน', exact: true }).click();
    await expect(page.getByRole('status', { name: 'รอยืนยันรายการ', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ยกเลิกคำขอที่ยังไม่ส่ง', exact: true }).click();
    await expect(page.getByRole('status', { name: 'ยกเลิกคำขอแล้ว', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ยกเลิกคำขอที่ยังไม่ส่ง', exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('billing-recipient-cancelled-1512.png'), fullPage: true });

    // Recipient change, round 2 (mobile): a fresh preview succeeds once round 1 is terminal, then
    // preview -> submit -> approve (self-confirm, SINGLE_ADMIN) carries it through to queued.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/system/billing/companies/${companyId}/invoices/${invoiceId}/recipient`);
    await expect(page.getByText('โหมดทดสอบ · ไม่มีการเปลี่ยนแปลงจริงกับลูกค้า')).toBeVisible();
    await page.getByLabel('อีเมลผู้รับเอกสารใหม่').fill('new-recipient-round2@example.com');
    await page.getByLabel('เหตุผลภายใน (ลูกค้าไม่เห็น)').fill('ทดสอบ e2e รอบที่ 2: ตรวจจนถึงคิวดำเนินการ');
    await page.getByRole('button', { name: 'ตรวจข้อมูลก่อนบันทึก', exact: true }).click();
    await page.waitForURL(/\/system\/billing\/recipient-changes\/[^/]+$/);
    await page.getByLabel('รหัสผ่านปัจจุบัน').fill(SEED_USERS.systemAdmin.password);
    await page.getByRole('button', { name: 'ยืนยันรหัสผ่าน', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'ยืนยันแล้วถึง' })).toBeVisible();
    await page.getByRole('button', { name: 'บันทึกคำขอก่อนยืนยัน', exact: true }).click();
    await expect(page.getByRole('status', { name: 'รอยืนยันรายการ', exact: true })).toBeVisible();
    await expect(page.getByText('ยืนยันโดยผู้ดูแลระบบคนเดียว', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'ยืนยันเปลี่ยนอีเมลผู้รับ', exact: true }).click();
    await expect(page.getByRole('status', { name: 'รับคำขอแล้ว รอตรวจผลจาก Stripe', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('billing-recipient-queued-390.png'), fullPage: true });
    await expectNoClientError(page);

    const operations = await client.billingOperation.findMany({ where: { companyId, type: 'UPDATE_BILLING_EMAIL' }, orderBy: { createdAt: 'asc' } });
    expect(operations).toHaveLength(2);
    expect(operations[0]!.state).toBe('CANCELLED');
    expect(operations[1]!.state).toBe('QUEUED');
  } finally {
    await client.billingOperation.deleteMany({ where: { companyId } }).catch(() => {});
    await client.auditLog.deleteMany({ where: { companyId } }).catch(() => {});
    if (invoiceId) await client.billingInvoice.deleteMany({ where: { id: invoiceId } }).catch(() => {});
    if (accountId) await client.billingAccount.deleteMany({ where: { id: accountId } }).catch(() => {});
    await client.company.deleteMany({ where: { id: companyId } }).catch(() => {});
    await client.$disconnect();
  }
});
