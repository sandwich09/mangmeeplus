import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import type { startBillingBrowser } from './billing-browser-smoke';
import { admitCompanyOcr } from '../modules/line-ai/application/company-ocr-governance';
import { grantPaidPackageReceipts } from '../modules/billing/application/billing-receipt-grants';
import { bangkokMonthKey } from '../modules/line-ai/application/company-ai-usage-meter';
import {checkAdminAiAdjustments} from './admin-ai-adjustments-smoke';

/** Actual Admin HTTP/Next/PG + shared web/LINE admission. No OCR or payment provider call. */
export async function checkReceiptQuotaRuntime(input: {
  request: (path: string, method?: string, body?: unknown) => Promise<{ status: number; body: any }>;
  prisma: PrismaService; userId: string; membershipId: string;
  browser?: Awaited<ReturnType<typeof startBillingBrowser>>;
}): Promise<string[]> {
  const { request, prisma, userId, membershipId, browser } = input, db = prisma.client;
  const companyId = `quota-runtime-${randomUUID()}`, roleId = randomUUID(), base = `/v1/system/partners/${companyId}`;
  const now = new Date(), end = new Date(now.getTime() + 30 * 86400000), monthKey = bangkokMonthKey();
  let accountId: string | undefined, adminId: string | undefined, createdAdmin = false;
  const save = async (value: boolean | null, expectedVersion?: number, extra: Record<string, unknown> = {}) => {
    const usage = await request(`${base}/ai-usage`); assert.equal(usage.status, 200, JSON.stringify(usage));
    const config = usage.body.ocr.config;
    return request(`${base}/ocr-config`, 'PUT', { reason:'ปรับโควตาทดสอบ', enabled: true, monthlyLimit: null, receiptQuotaEnforced: value,
      expectedVersion: expectedVersion ?? config.version, ...extra });
  };
  const admission = (sourceRoute: 'receipt-ocr-web' | 'receipt-ocr-line' | 'bank-statement-extract', startup = false) =>
    admitCompanyOcr(prisma, { companyId, sourceRoute, requestId: randomUUID(), monthKey, enforceReceiptQuota: startup });
  try {
    await db.company.create({ data: { id: companyId, name: 'Synthetic runtime quota company' } });
    await db.companyPlanTerm.create({ data: { companyId, tierKey: 'FREE_TRIAL_15', branchLimit: 1, employeeLimit: 2,
      monthlySlipLimit: 15, termStartAt: now, termEndsAt: end } });
    assert.equal((await request(`${base}/ocr-config`, 'PUT', { reason:'ปรับโควตาทดสอบ', enabled: true, monthlyLimit: null, receiptQuotaEnforced: true, expectedVersion: 0 })).status, 403);
    assert.equal((await request(`${base}/ai-adjustments`)).status,403);
    const keys = ['system.partner_dashboard.read', 'system.partner_ai_model.manage'];
    const permissions = await Promise.all(keys.map(key => db.permission.upsert({ where: { key }, update: {}, create: { key, description: key } })));
    await db.role.create({ data: { id: roleId, key: `QUOTA_ADMIN_${roleId}`, scopeKey: 'system', isSystem: true, name: 'Synthetic quota operator',
      permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
    await db.membershipRole.create({ data: { membershipId, roleId } });
    // The real platform shell and expired-company exemption require the system-admin role too.
    const existingAdmin = await db.role.findUnique({ where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } } });
    const admin = existingAdmin ?? await db.role.create({ data: { key: 'SYSTEM_ADMIN', scopeKey: 'system', isSystem: true, name: 'Synthetic platform role' } });
    adminId = admin.id; createdAdmin = !existingAdmin;
    await db.membershipRole.create({ data: { membershipId, roleId: adminId } });
    for (let i = 0; i < 15; i++) assert.equal((await admission(i % 2 ? 'receipt-ocr-line' : 'receipt-ocr-web')).allowed, true);
    assert.equal((await save(true)).status, 200);
    const config = (await request(`${base}/ai-usage`)).body.ocr.config;
    for (const route of ['receipt-ocr-web', 'receipt-ocr-line'] as const) assert.equal((await admission(route)).allowed, false);
    assert.equal((await save(false, config.version - 1)).status, 409);
    const concurrent = await Promise.all([save(false, config.version), save(null, config.version)]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
    assert.equal((await save(false)).status, 200);
    assert.equal((await admission('receipt-ocr-web', true)).allowed, true);
    assert.equal((await admission('receipt-ocr-line', true)).allowed, true);
    const observed = (await request(`${base}/ai-usage`)).body.ocr;
    assert.equal(observed.planQuota.enforced, false); assert.equal(observed.planQuota.source, 'COMPANY');
    assert.equal((await request(`${base}/ocr-config`, 'PUT', { reason:'คงค่าเดิมหลังอ่านข้อมูล', enabled: true, monthlyLimit: null, expectedVersion: observed.config.version })).status, 200);
    assert.equal((await request(`${base}/ai-usage`)).body.ocr.config.receiptQuotaEnforced, false, 'old client omission preserves override');
    assert.equal((await save(null)).status, 200);
    assert.equal((await admission('receipt-ocr-line', false)).allowed, true);
    assert.equal((await admission('receipt-ocr-web', true)).allowed, false);
    assert.equal((await save(true)).status, 200);
    assert.equal((await admission('bank-statement-extract')).allowed, true);
    for (const bad of ['false', 1, {}]) assert.equal((await save(true, undefined, { receiptQuotaEnforced: bad })).status, 400);
    const audits = await db.auditLog.findMany({ where: { targetId: companyId, action: 'system.partner_ocr_config.update' } });
    assert.ok(audits.length >= 4); assert.ok(audits.every(a => a.riskLevel === 'CRITICAL' && a.metadataJson && 'toReceiptQuotaEnforced' in (a.metadataJson as object)));

    if (browser) {
      const { page } = browser;
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${browser.origin}/system/partners/${companyId}?view=ai`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('receipt-quota-effective').getByText(/บังคับโควตา/).waitFor();
      for (const [mode, value] of [['observe', false], ['inherit', null], ['enforce', true]] as const) {
        await page.getByRole('textbox',{name:'เหตุผลที่ปรับการอ่านเอกสาร',exact:true}).fill('ปรับโควตาจากหน้า Admin');
        await page.locator('#receipt-quota-mode').selectOption(mode);
        const response = page.waitForResponse(r => r.url().endsWith(`${base}/ocr-config`) && r.request().method() === 'PUT');
        await page.getByRole('button', { name: 'บันทึก OCR', exact: true }).click();
        assert.equal((await response).status(), 200);
        await page.getByTestId('receipt-quota-effective').getByText(value === true ? /บังคับโควตา/ : /นับอย่างเดียว/).waitFor();
        assert.equal((await admission('receipt-ocr-line')).allowed, value !== true);
      }
      await page.getByRole('textbox',{name:'เหตุผลที่ปรับการอ่านเอกสาร',exact:true}).fill('ตรวจการแก้พร้อมกัน');
      await page.locator('#receipt-quota-mode').selectOption('observe');
      assert.equal((await save(null)).status, 200, 'another admin changes the saved version');
      const stale = page.waitForResponse(r => r.url().endsWith(`${base}/ocr-config`) && r.request().method() === 'PUT');
      await page.getByRole('button', { name: 'บันทึก OCR', exact: true }).click();
      assert.equal((await stale).status(), 409);
      await page.getByTestId('receipt-quota-effective').getByText(/ค่าเริ่มต้นของระบบ/).waitFor();
      assert.equal(await page.locator('#receipt-quota-mode').inputValue(), 'inherit');
      await page.locator('#receipt-quota-mode').selectOption('enforce');
      const fresh = page.waitForResponse(r => r.url().endsWith(`${base}/ocr-config`) && r.request().method() === 'PUT');
      await page.getByRole('button', { name: 'บันทึก OCR', exact: true }).click();
      assert.equal((await fresh).status(), 200);
      await page.getByTestId('receipt-quota-effective').getByText(/บังคับโควตา/).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.goto(`${browser.origin}/system/partners`, { waitUntil: 'domcontentloaded' });
      await page.goto(`${browser.origin}/system/partners/${companyId}?view=ai`, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('receipt-quota-effective').getByText(/บังคับโควตา/).waitFor();
      await page.locator('#receipt-quota-mode').locator('..').screenshot({ path: `${browser.evidenceDir}/admin-receipt-quota-mobile.png` });
    }

    accountId = (await db.billingAccount.create({ data: { companyId, stripeAccountId: `acct_quota_${randomUUID()}`, livemode: false } })).id;
    await db.$transaction(tx => grantPaidPackageReceipts(tx, { companyId, billingAccountId: accountId!, sourceKey: 'TEST_ONLY_QUOTA',
      policyRevisionId: 'TEST_ONLY', kind: 'INITIAL', units: 0, serviceStart: now, serviceEnd: end, availableAt: now, expiresAt: end }));
    await db.companyPlanTerm.update({ where: { companyId }, data: { billingReceiptAccountId: accountId } });
    assert.equal((await save(false)).status, 200);
    for (const route of ['receipt-ocr-web', 'receipt-ocr-line'] as const) assert.equal((await admission(route)).allowed, false, 'exhausted paid balance cannot be bypassed');
    const paid = (await request(`${base}/ai-usage`)).body.ocr.planQuota;
    assert.deepEqual(paid, { enforced: true, source: 'PAID_GRANTS', defaultEnforced: false });
    assert.equal((await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId } })).termEndsAt.getTime(), end.getTime());
    assert.equal(await db.billingReceiptGrant.count({ where: { companyId } }), 1);
    if (browser) {
      await browser.page.reload({ waitUntil: 'domcontentloaded' });
      await browser.page.getByTestId('receipt-quota-effective').getByText(/แพ็กเกจที่ชำระเงิน/).waitFor();
      // Admin tab rework: a paid package always enforces, so the trial/staff-set choice is not shown at all.
      assert.equal(await browser.page.locator('#receipt-quota-mode').count(), 0);
    }
    return ['runtime-receipt-quota-admin-cas-audit-legacy-input-and-validation', 'runtime-receipt-quota-web-line-inheritance-no-reset-and-statement-exclusion',
      'runtime-receipt-quota-paid-grants-cannot-bypass', ...(browser ? ['browser-admin-receipt-quota-three-modes-reload-return-mobile-and-paid-lock'] : []),
      ...await checkAdminAiAdjustments({prisma,companyId,userId,request,browser})];
  } finally {
    if (adminId) await db.membershipRole.deleteMany({ where: { membershipId, roleId: adminId } });
    if (adminId && createdAdmin) await db.role.delete({ where: { id: adminId } });
    await db.membershipRole.deleteMany({ where: { roleId } }); await db.role.deleteMany({ where: { id: roleId } });
    await db.companyOcrUsageEvent.deleteMany({ where: { companyId } });
    await db.companyPlanTerm.deleteMany({ where: { companyId } }); await db.billingReceiptGrant.deleteMany({ where: { companyId } });
    if (accountId) await db.billingAccount.delete({ where: { id: accountId } });
    await db.auditLog.deleteMany({ where: { targetId: companyId } });
    await db.company.deleteMany({ where: { id: companyId } });
  }
}
