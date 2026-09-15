import {checkPartnerPlanAdjustments} from './partner-plan-adjustments-smoke';
import {checkBillingPlanAdjustments} from './billing-plan-adjustments-smoke';
import {checkBillingReceiptAdjustments} from './billing-receipt-adjustments-smoke';
import {checkBillingOfferTerms} from './billing-offer-terms-smoke';
import {checkBillingBatches} from './billing-batches-smoke';
import { checkBillingCheckoutExpiry } from './billing-checkout-expiry-smoke';
import { checkBillingSettlement } from './billing-settlement-smoke';
import { checkBillingRefunds } from './billing-refunds-smoke';
import { checkBillingRefundControls } from './billing-refund-controls-smoke';
import assert from 'node:assert/strict';
import { checkBillingReadiness } from './billing-readiness-smoke';
import { checkBillingSalesCohort } from './billing-sales-cohort-smoke';
import { checkBillingSupportSla } from './billing-support-sla-smoke';
import { checkBillingScheduledPolicy } from './billing-scheduled-policy-smoke';
import { randomUUID } from 'node:crypto';
import { BILLING_PERMISSIONS } from '@watchdog-bms/contracts';
import { hashPassword } from '../modules/auth/domain/logic/password-credential.logic';
import type { PrismaService } from '../common/database/prisma.service';
import type { startBillingBrowser } from './billing-browser-smoke';
import type { BrowserContext } from '@playwright/test';
import { checkBillingScopes } from './billing-scopes-smoke';
import {checkBillingConfigurationDrafts} from './billing-configuration-drafts-smoke';
import { checkBillingConfigurationImpact } from './billing-configuration-impact-smoke';

export async function checkBillingConfiguration(input: {
  request: (path: string, method?: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; body: any }>;
  provider:Record<string,Record<string,any>[]>;companyIds:string[];reconcile:(id:string)=>Promise<void>;repeatFixture:ReturnType<typeof import('./billing-repeat-smoke').repeatProviderFixture>;
  prisma: PrismaService; companyId: string; userIds: string[]; membershipId: string; stripeAccountId: string;
  browser?: Awaited<ReturnType<typeof startBillingBrowser>>; signToken: (sid: string, userId?: string) => string; recordLegal: (userId: string, membershipId: string, targetCompanyId?:string) => Promise<void>;
  transport: (hook?: (url: URL, init?: RequestInit) => Promise<Response | undefined>) => void;
  scanAccounts:()=>Promise<unknown>;drainProviderScans:()=>Promise<unknown>;drainOperations:()=>Promise<unknown>;drainNotifications:()=>Promise<unknown>;notificationFixture:ReturnType<typeof import('./billing-notification-smoke').billingNotificationFixture>;
}) {
  const { prisma, userIds, companyId, stripeAccountId, browser } = input, client = prisma.client, base = '/v1/system/billing', run = randomUUID();
  const request: typeof input.request = async (...args) => {
    for (let tries = 0; ; tries++) {
      const result = await input.request(...args);
      if (result.status !== 429 || tries >= 2) return result;
      assert.ok(result.body.retryAfterSeconds <= 60, 'Long credential lockout is a test failure, not something to bypass');
      await new Promise(resolve => setTimeout(resolve, Math.min(60, result.body.retryAfterSeconds + 1) * 1000));
    }
  };
  assert.equal((await request(`${base}/settings`)).status, 403);
  const existingAdmin = await client.role.findUnique({ where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } } });
  const admin = existingAdmin ?? await client.role.create({ data: { key: 'SYSTEM_ADMIN', scopeKey: 'system', companyId: null, isSystem: true, name: 'Synthetic platform role' } });
  const grants = await Promise.all([...BILLING_PERMISSIONS, 'account.session.read'].map(key => client.permission.upsert({ where: { key }, update: {}, create: { key, description: key } })));
  const role = await client.role.create({ data: { key: `BILLING_CONFIG_${run}`, scopeKey: 'system', isSystem: true, companyId: null, name: 'Synthetic billing configuration',
    permissions: { create: grants.map(g => ({ permissionId: g.id })) } } });
  const second = await client.companyMembership.create({ data: { companyId, userId: userIds[1]!, roles: { create: [{ roleId: admin.id }, { roleId: role.id }] } } });
  await client.membershipRole.createMany({ data: [{ membershipId: input.membershipId, roleId: admin.id }, { membershipId: input.membershipId, roleId: role.id }] });
  await input.recordLegal(userIds[1]!, second.id);
  const sid = randomUUID(), token = input.signToken(sid), password = `Synthetic!${run}`;
  await client.authSession.create({ data: { userId: userIds[1]!, tokenId: sid, expiresAt: new Date(Date.now() + 3600000) } });
  for (const userId of userIds) await client.userCredential.create({ data: { userId, passwordHash: hashPassword(password) } });
  const approveRequest: typeof request = (path, method, body, extra) => request(path, method, body, { ...extra, authorization: `Bearer ${token}` });
  assert.equal((await approveRequest('/v1/auth/me')).status, 200, 'approver fixture needs the normal browser session permission');
  let secondBrowser: BrowserContext | undefined;
  const snapshot = await client.billingInvoice.findMany({ where: { billingAccountId: (await client.billingAccount.findFirstOrThrow({ where: { companyId, stripeAccountId } })).id }, orderBy: { id: 'asc' } });
  try {
    if (process.env.BILLING_MANUAL_PLAN_ONLY === '1' || process.env.BILLING_PLAN_ADJUSTMENTS_ONLY === '1' || process.env.BILLING_RECEIPT_ADJUSTMENTS_ONLY === '1' || process.env.BILLING_OFFER_TERMS_ONLY === '1' || process.env.BILLING_BATCHES_ONLY === '1' || process.env.BILLING_CHECKOUT_EXPIRY_ONLY === '1' || process.env.BILLING_SETTLEMENT_ONLY === '1' || process.env.BILLING_REFUNDS_ONLY === '1' || process.env.BILLING_REFUND_CONTROLS_ONLY === '1' || process.env.BILLING_READINESS_ONLY === '1' || process.env.BILLING_SALES_COHORT_ONLY === '1' || process.env.BILLING_SUPPORT_SLA_ONLY === '1' || process.env.BILLING_SCHEDULED_POLICY_ONLY === '1') {
      if (browser) {
        secondBrowser = await browser.page.context().browser()!.newContext({ viewport: { width: 390, height: 844 } });
        secondBrowser.setDefaultTimeout(30000);
        secondBrowser.setDefaultNavigationTimeout(60000);
        await secondBrowser.addCookies([{ name: 'watchdog_token', value: token, url: browser.origin, httpOnly: true, sameSite: 'Lax' },
          { name: 'watchdog_csrf', value: 'synthetic-second-csrf', url: browser.origin, sameSite: 'Lax' }]);
        await secondBrowser.newPage();
      }
      return await (process.env.BILLING_MANUAL_PLAN_ONLY === '1' ? checkPartnerPlanAdjustments : process.env.BILLING_PLAN_ADJUSTMENTS_ONLY === '1' ? checkBillingPlanAdjustments : process.env.BILLING_RECEIPT_ADJUSTMENTS_ONLY === '1' ? checkBillingReceiptAdjustments : process.env.BILLING_OFFER_TERMS_ONLY === '1' ? checkBillingOfferTerms : process.env.BILLING_BATCHES_ONLY === '1' ? checkBillingBatches : process.env.BILLING_CHECKOUT_EXPIRY_ONLY === '1' ? checkBillingCheckoutExpiry : process.env.BILLING_SETTLEMENT_ONLY === '1' ? checkBillingSettlement : process.env.BILLING_REFUNDS_ONLY === '1' ? checkBillingRefunds : process.env.BILLING_REFUND_CONTROLS_ONLY === '1' ? checkBillingRefundControls : process.env.BILLING_READINESS_ONLY === '1' ? checkBillingReadiness : process.env.BILLING_SCHEDULED_POLICY_ONLY === '1' ? checkBillingScheduledPolicy : process.env.BILLING_SUPPORT_SLA_ONLY === '1' ? checkBillingSupportSla : checkBillingSalesCohort)({ ...input, request, approveRequest, password, adminRoleId: admin.id, secondBrowser });
    }
    const initial = await request(`${base}/settings`); assert.equal(initial.status, 200); assert.equal(initial.body.reauthenticatedUntil, null);
    const before = initial.body, revisionCount = await client.billingPolicyRevision.count({ where: { stripeAccountId } });
    const preview = (policy = before.policy, gates = before.gates, version = before.version, type = 'PUBLISH_POLICY') => request(`${base}/configuration-changes/preview`, 'POST', {
      type, policy, gates, expectedVersion: version, reason: 'ตรวจการตั้งค่าจากระบบจำลอง' });
    const submit = (op: any) => request(`${base}/configuration-changes/${op.id}/submit`, 'POST', { expectedVersion: op.version, previewHash: op.previewHash }, { 'idempotency-key': `billing-config-${op.id}` });
    const approve = (op: any) => approveRequest(`${base}/configuration-changes/${op.id}/approve`, 'POST', { expectedVersion: op.version, previewHash: op.previewHash });
    const browserPreview = async (proposed: any) => {
      const page = browser!.page;
      await page.goto(`${browser!.origin}/system/billing/settings`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('ภาษีมูลค่าเพิ่ม', { exact: true }).selectOption(proposed.taxTreatment);
      if (proposed.taxTreatment !== 'NOT_VAT_REGISTERED') {
        for (const [label, key] of [['ชื่อกิจการตามทะเบียน', 'legalName'], ['ที่อยู่กิจการ', 'address'], ['เลขประจำตัวผู้เสียภาษี 13 หลัก', 'thaiTaxId'], ['Stripe Account Tax ID', 'stripeTaxId']])
          await page.getByLabel(label!, { exact: true }).fill(proposed.issuer[key!]);
        await page.getByLabel('Stripe Tax Rate ID', { exact: true }).fill(proposed.taxRateId);
      }
      await page.getByText('เชื่อมราคาและ Portal ของ Stripe', { exact: true }).click();
      await page.getByLabel('มืออาชีพ (PRO) · รายปี · ราคาเก็บเงิน', { exact: true }).fill(proposed.priceIds['PRO_999:year']);
      await page.getByLabel('มืออาชีพ (PRO) · รายปี · ราคาศูนย์สำหรับช่วงจ่ายล่วงหน้า', { exact: true }).fill(proposed.zeroPriceIds['PRO_999:year']);
      await page.getByLabel('เหตุผลการเปลี่ยนค่า', { exact: true }).fill('ทดสอบเปลี่ยน VAT และย้อนกลับผ่านหน้าเว็บ');
      await page.getByRole('button', { name: 'ตรวจผลกระทบการตั้งค่า', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ตรวจผลกระทบก่อนส่ง' }).waitFor();
      const link = page.getByRole('link', { name: 'เปิดลิงก์คำขอนี้', exact: true }), href = await link.getAttribute('href');
      assert.ok(href); assert.ok(href.startsWith('/system/billing/configuration-changes/'));
      await link.click();
      await page.waitForURL(`${browser!.origin}${href}`);
      await page.getByRole('button', { name: 'ส่งคำขอให้ผู้อนุมัติ', exact: true }).waitFor();
      return request(`${base}/configuration-changes/${href.split('/').at(-1)}`);
    };
    const browserSubmit = async (op: any) => {
      await browser!.page.getByRole('button', { name: 'ส่งคำขอให้ผู้อนุมัติ', exact: true }).click();
      await browser!.page.getByRole('status').filter({ hasText: 'รอผู้อนุมัติอีกคน' }).waitFor();
      return request(`${base}/configuration-changes/${op.id}`);
    };
    const browserApprove = async (op: any) => {
      const page = secondBrowser!.pages()[0]!;
      await page.goto(`${browser!.origin}/system/billing/configuration-changes/${op.id}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'อนุมัติและใช้ค่าชุดนี้', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'การตั้งค่านี้มีผลแล้ว' }).waitFor();
      return request(`${base}/configuration-changes/${op.id}`);
    };
    const old = await preview(); assert.equal(old.status, 200);
    assert.equal((await submit(old.body)).body.code, 'CONTROL_REAUTH_REQUIRED');
    assert.equal((await request(`${base}/reauthenticate`, 'POST', { password: 'wrong' })).status, 403);
    if (browser) {
      await browser.page.goto(`${browser.origin}/system/billing/settings`, { waitUntil: 'domcontentloaded' });
      await browser.page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill(password);
      await browser.page.getByRole('button', { name: 'ยืนยันรหัสผ่าน', exact: true }).click();
      await browser.page.getByRole('status').filter({ hasText: 'ยืนยันแล้วถึง' }).waitFor();
    } else assert.equal((await request(`${base}/reauthenticate`, 'POST', { password })).status, 200);
    const closeBody = { expectedVersion: before.version, gates: { ...before.gates, new_sales: false }, reason: 'หยุดขายใหม่เพื่อทดสอบ' }, closeKey = `billing-close-${run}`;
    const close = await request(`${base}/settings/emergency-close`, 'POST', closeBody, { 'idempotency-key': closeKey }); assert.equal(close.status, 200); assert.equal(close.body.state, 'SUCCEEDED');
    assert.equal((await request(`${base}/settings/emergency-close`, 'POST', closeBody, { 'idempotency-key': closeKey })).body.id, close.body.id);
    assert.ok((await request('/v1/billing/catalog')).body.offers.every((o: any) => o.availability !== 'AVAILABLE'));
    assert.equal((await submit(old.body)).status, 409);
    assert.equal((await request(`${base}/settings/emergency-close`, 'POST', { ...closeBody, gates: before.gates, expectedVersion: before.version + 1 }, { 'idempotency-key': `billing-close-${randomUUID()}` })).status, 400);
    const reopen = await preview(before.policy, before.gates, before.version + 1, 'SET_ACTION_GATE'); assert.equal(reopen.status, 200);
    const waiting = await submit(reopen.body); assert.equal(waiting.body.state, 'AWAITING_APPROVAL');
    assert.equal((await submit(reopen.body)).body.id, waiting.body.id, 'lost submit response reuses the same intent');
    assert.equal((await request(`${base}/configuration-changes/${waiting.body.id}/approve`, 'POST', { expectedVersion: waiting.body.version, previewHash: waiting.body.previewHash })).status, 403);
    assert.equal((await approve(waiting.body)).body.code, 'CONTROL_REAUTH_REQUIRED');
    if (browser) {
      const engine = browser.page.context().browser()!;
      secondBrowser = await engine.newContext({ viewport: { width: 390, height: 844 } });
      secondBrowser.setDefaultTimeout(30000);
      secondBrowser.setDefaultNavigationTimeout(60000);
      await secondBrowser.addCookies([{ name: 'watchdog_token', value: token, url: browser.origin, httpOnly: true, sameSite: 'Lax' },
        { name: 'watchdog_csrf', value: 'synthetic-second-csrf', url: browser.origin, sameSite: 'Lax' }]);
      const page = await secondBrowser.newPage();
      await page.goto(`${browser.origin}/system/billing/configuration-changes/${waiting.body.id}`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'ยืนยันรหัสผ่าน', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'ยืนยันแล้วถึง' }).waitFor();
      await page.getByRole('button', { name: 'อนุมัติและใช้ค่าชุดนี้', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'การตั้งค่านี้มีผลแล้ว' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.locator('button:enabled').filter({ hasText: 'โหลดการตั้งค่าล่าสุด' }).waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${browser.evidenceDir}/admin-configuration-mobile.png`, fullPage: true });
    } else { assert.equal((await approveRequest(`${base}/reauthenticate`, 'POST', { password })).status, 200);
      const approved = await approve(waiting.body); assert.equal(approved.status, 200, JSON.stringify(approved.body)); assert.equal(approved.body.state, 'SUCCEEDED'); }
    assert.equal((await approve(waiting.body)).body.state, 'SUCCEEDED', 'approval response replay does not republish');
    assert.equal(await client.billingPolicyRevision.count({ where: { stripeAccountId } }), revisionCount, 'gate change does not rewrite policy');
    assert.equal((await request('/v1/billing/catalog')).body.offers.find((o: any) => o.offerKey === 'PRO_999' && o.interval === 'year').availability, 'AVAILABLE');
    const latest = (await request(`${base}/settings`)).body;
    const vat = { ...before.policy, taxTreatment: 'EXCLUSIVE_VAT_7', taxRateId: 'txr_Exclusive', priceIds: { 'PRO_999:year': 'price_ProYearExclusive' },
      zeroPriceIds: { 'PRO_999:year': 'price_ZeroProYearExclusive' }, issuer: { legalName: 'Synthetic company', address: 'Synthetic address Thailand', thaiTaxId: '0105567123456', stripeTaxId: 'txi_Synthetic' } };
    assert.equal((await preview({ ...vat, issuer: undefined }, latest.gates, latest.version)).body.code, 'CONTROL_ISSUER_REQUIRED');
    assert.equal((await preview({ ...vat, issuer: { ...vat.issuer, thaiTaxId: '0105567000000' } }, latest.gates, latest.version)).body.code, 'BILLING_TAX_MISMATCH');
    const vatPreview = browser ? await browserPreview(vat) : await preview(vat, latest.gates, latest.version); assert.equal(vatPreview.status, 200);
    assert.equal(vatPreview.body.impact.prices.find((p: any) => p.offerKey === 'PRO_999:year').afterTotalSatang, 1068930);
    const vatWaiting = browser ? await browserSubmit(vatPreview.body) : await submit(vatPreview.body); assert.equal(vatWaiting.body.state, 'AWAITING_APPROVAL');
    await client.membershipRole.delete({ where: { membershipId_roleId: { membershipId: input.membershipId, roleId: admin.id } } });
    assert.equal((await approve(vatWaiting.body)).status, 403, 'revoked initiator platform scope cannot publish');
    await client.membershipRole.create({ data: { membershipId: input.membershipId, roleId: admin.id } });
    assert.equal((browser ? await browserApprove(vatWaiting.body) : await approve(vatWaiting.body)).body.state, 'SUCCEEDED');
    assert.equal((await request('/v1/billing/catalog')).body.taxTreatment, 'EXCLUSIVE_VAT_7');
    const afterVat = (await request(`${base}/settings`)).body;
    const rollbackPreview = browser ? await browserPreview(before.policy) : await preview(before.policy, before.gates, afterVat.version);
    const rollbackWaiting = browser ? await browserSubmit(rollbackPreview.body) : await submit(rollbackPreview.body);
    assert.equal((browser ? await browserApprove(rollbackWaiting.body) : await approve(rollbackWaiting.body)).body.state, 'SUCCEEDED');
    assert.equal((await request('/v1/billing/catalog')).body.taxTreatment, 'NOT_VAT_REGISTERED');
    const after = (await request(`${base}/settings`)).body;
    assert.notEqual(after.policyRevisionId, before.policyRevisionId, 'rollback is a new approved revision');
    assert.deepEqual(await client.billingInvoice.findMany({ where: { id: { in: snapshot.map(i => i.id) } }, orderBy: { id: 'asc' } }), snapshot, 'configuration does not rewrite historical financial evidence');
    const race = await submit((await preview(before.policy, before.gates, after.version)).body);
    const raced = await Promise.all([approve(race.body), request(`${base}/configuration-changes/${race.body.id}/cancel`, 'POST', { expectedVersion: race.body.version })]);
    assert.deepEqual(raced.map(r => r.status).sort(), [200, 409], 'cancel and approve cannot both succeed');
    const draftCases=await checkBillingConfigurationDrafts({...input,request,approveRequest,password,adminRoleId:admin.id,secondBrowser});
    const impactCases=await checkBillingConfigurationImpact({...input,request,approveRequest,password,adminRoleId:admin.id,secondBrowser});
    const freshness = (await request(`${base}/settings`)).body, pending = await preview(before.policy, before.gates, freshness.version);
    await client.userCredential.update({ where: { userId: userIds[0]! }, data: { passwordHash: hashPassword(password) } });
    assert.equal((await submit(pending.body)).body.code, 'CONTROL_REAUTH_REQUIRED', 'credential change invalidates old proof');
    assert.equal((await request(`${base}/reauthenticate`, 'POST', { password })).status, 200);
    await client.authSession.updateMany({ where: { userId: userIds[0]! }, data: { billingReauthenticatedAt: new Date(Date.now() - 301000) } });
    assert.equal((await submit(pending.body)).body.code, 'CONTROL_REAUTH_REQUIRED', 'proof expires after five minutes');
    const anotherSid = randomUUID(), anotherToken = input.signToken(anotherSid);
    await client.authSession.create({ data: { userId: userIds[1]!, tokenId: anotherSid, expiresAt: new Date(Date.now() + 3600000) } });
    assert.equal((await request(`${base}/settings`, 'GET', undefined, { authorization: `Bearer ${anotherToken}` })).body.reauthenticatedUntil, null, 'proof is not shared with another session');
    const scopeCases = await checkBillingScopes({ ...input, request, approveRequest, password, adminRoleId: admin.id, secondBrowser });
    const refundControls = await checkBillingRefundControls({ ...input, request, approveRequest, password, adminRoleId: admin.id, secondBrowser });
    const manualPlanCases = await checkPartnerPlanAdjustments({ ...input, request, approveRequest, password, adminRoleId: admin.id, secondBrowser });
    const planAdjustmentCases = await checkBillingPlanAdjustments({ ...input, request, approveRequest, password, adminRoleId: admin.id, secondBrowser });
    const receiptAdjustmentCases = await checkBillingReceiptAdjustments({ ...input, request, approveRequest, password, adminRoleId: admin.id, secondBrowser });
    const refundCases = await checkBillingRefunds({ ...input, request, approveRequest, password, adminRoleId: admin.id, secondBrowser });
    const checkoutCases=await checkBillingCheckoutExpiry({...input,request,approveRequest,password,adminRoleId:admin.id,secondBrowser});
    const batchCases=await checkBillingBatches({...input,request,approveRequest,password,adminRoleId:admin.id,secondBrowser});
    const offerTermsCases=await checkBillingOfferTerms({...input,request,approveRequest,password,adminRoleId:admin.id,secondBrowser});
    const settlementCases=await checkBillingSettlement({...input,request,approveRequest,password,adminRoleId:admin.id,secondBrowser});
    return ['admin-configuration-password-proof-session-credential-expiry-and-platform-scope', 'admin-emergency-close-and-independent-approved-reopen-no-restart',
      'admin-vat-issuer-price-preview-publish-and-compensating-off-revision', 'admin-configuration-idempotency-revoked-requester-cancel-approval-race-and-historical-invoices',
      ...(browser ? ['browser-admin-password-independent-approval-observed-config-and-mobile', 'browser-admin-vat-form-publish-return-off-without-process-restart'] : []), ...draftCases,...impactCases,...scopeCases,...refundControls,...manualPlanCases,...planAdjustmentCases,...receiptAdjustmentCases, ...refundCases,...checkoutCases,...batchCases,...offerTermsCases,...settlementCases];
  } finally {
    await secondBrowser?.close();
    await client.membershipRole.deleteMany({ where: { membershipId: { in: [input.membershipId, second.id] }, roleId: { in: [admin.id, role.id] } } });
    await client.role.delete({ where: { id: role.id } });
    if (!existingAdmin) await client.role.delete({ where: { id: admin.id } });
  }
}
