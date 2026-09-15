import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../common/database/prisma.service';
import type { startBillingBrowser } from './billing-browser-smoke';

export async function checkBillingAdmin(input: {
  request: (path: string, method?: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; body: any }>;
  prisma: PrismaService; companyIds: string[]; userId: string; membershipId: string; stripeAccountId: string;
  browser?: Awaited<ReturnType<typeof startBillingBrowser>>; drain: () => Promise<{ status: number; body: any }>; failNextRead: () => void;
}): Promise<string[]> {
  const { request, prisma, companyIds, userId, membershipId, stripeAccountId, browser } = input, client = prisma.client;
  const base = '/v1/system/billing', roleId = randomUUID(), run = randomUUID();
  const permissions = ['system.billing.read', 'system.billing.issue.manage'];
  assert.equal((await request(`${base}/overview`)).status, 403, 'a customer OWNER is not a billing operator');
  const permissionRows = await Promise.all(permissions.map(key => client.permission.upsert({ where: { key }, update: {}, create: { key, description: key } })));
  await client.role.create({ data: { id: roleId, key: `BILLING_SUPPORT_${run}`, scopeKey: 'system', companyId: null, isSystem: true,
    name: 'Synthetic billing support', permissions: { create: permissionRows.map(p => ({ permissionId: p.id })) } } });
  await client.membershipRole.create({ data: { membershipId, roleId } });
  try {
    await client.billingAccount.create({ data: { companyId: companyIds[1]!, stripeAccountId, livemode: false } });
    assert.equal((await request(`${base}/overview`)).body.companies.length, 0, 'permission alone grants no companies');
    const scope = await client.billingOperatorScope.create({ data: { userId, stripeAccountId, livemode: false, companyId: companyIds[0]!, createdByUserId: userId } });
    const overview = await request(`${base}/overview`); assert.equal(overview.status, 200);
    assert.equal(overview.body.platformScope, false); assert.deepEqual(overview.body.companies.map((c: any) => c.companyId), [companyIds[0]]);
    const detail = await request(`${base}/companies/${companyIds[0]}`); assert.equal(detail.status, 200); assert.equal(detail.body.financial, null);
    assert.doesNotMatch(JSON.stringify(detail.body), /amountSatang|paidSatang|providerChargeId|https:\/\/.*stripe/);
    assert.equal((await request(`${base}/companies/${companyIds[1]}`)).status, 404);
    assert.equal((await request(`${base}/issues?companyId=${companyIds[1]}`)).status, 404);
    const financialPermission = await client.permission.upsert({ where: { key: 'system.billing.financial.read' }, update: {},
      create: { key: 'system.billing.financial.read', description: 'Read billing finances' } });
    await client.rolePermission.create({ data: { roleId, permissionId: financialPermission.id } });
    const financial = await request(`${base}/companies/${companyIds[0]}`);
    assert.equal(financial.body.financial.invoices.length, 3);
    assert.equal(financial.body.financial.invoices[0].amountSatang, 999000);
    await client.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: financialPermission.id } } });
    assert.equal((await request(`${base}/companies/${companyIds[0]}`)).body.financial, null);
    const issue = await client.billingIssue.create({ data: { stripeAccountId, livemode: false, companyId: companyIds[0], kind: 'REPEAT_RECOVERY', referenceId: `test-${run}` } });
    const update = { expectedVersion: 0, state: 'ASSIGNED', note: 'ตรวจสอบรายการเดิมก่อนดำเนินการ', assigneeUserId: userId };
    if (browser) {
      const page = browser.page, background: string[] = [];
      const record = (request: { url(): string }) => { if (/\/api\/.*(?:system\/partners|system\/support-requests)/.test(request.url())) background.push(request.url()); };
      page.on('request', record);
      await page.goto(`${browser.origin}/system/billing/companies/${companyIds[0]}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('region', { name: 'ข้อมูลการชำระเงินบริษัท' }).getByText('ขอบเขตนี้ไม่มีสิทธิ์ดูรายละเอียดจำนวนเงิน', { exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: 'เปิด–ปิดระบบ', exact: true }).count(), 0);
      assert.equal(background.length, 0, 'billing delegate must not mount partner/support APIs');
      await page.goto(`${browser.origin}/system/billing/issues/${issue.id}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('textbox', { name: 'บันทึกการดำเนินการ', exact: true }).fill(update.note);
      await page.getByRole('button', { name: 'รับเคสนี้', exact: true }).click();
      const caseRegion = page.getByRole('region', { name: 'รายละเอียดเคส' });
      await caseRegion.getByText('รับงานแล้ว · เวอร์ชัน 1', { exact: true }).waitFor({ state: 'attached' });
      await caseRegion.getByText('ข้อมูลอ้างอิงเคส', { exact: true }).click();
      await caseRegion.getByText('รับงานแล้ว · เวอร์ชัน 1', { exact: true }).waitFor();
      await page.screenshot({ path: `${browser.evidenceDir}/admin-issue-mobile.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      page.off('request', record);
    } else assert.equal((await request(`${base}/issues/${issue.id}`, 'PATCH', update)).status, 200);
    assert.equal((await request(`${base}/issues/${issue.id}`, 'PATCH', update)).status, 409, 'stale update cannot overwrite another operator');
    assert.equal((await request(`${base}/issues/${issue.id}`, 'PATCH', { ...update, expectedVersion: 1, state: 'RESOLVED' })).status, 400, 'ticket status cannot invent a successful payment');
    assert.equal(await client.auditLog.count({ where: { targetType: 'BillingIssue', targetId: issue.id, action: 'billing.issue.updated' } }), 1);
    const operationCases = await checkOperations({ ...input, roleId });
    await client.billingOperatorScope.update({ where: { id: scope.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await request(`${base}/companies/${companyIds[0]}`)).status, 404);
    await client.billingOperatorScope.update({ where: { id: scope.id }, data: { expiresAt: null, revokedAt: new Date() } });
    await client.billingOperatorScope.create({ data: { userId, stripeAccountId, livemode: true, companyId: companyIds[1]!, createdByUserId: userId } });
    assert.equal((await request(`${base}/overview`)).body.companies.length, 0, 'a LIVE grant cannot expose TEST companies');
    // A forged company-scoped role with identical permission strings cannot become a platform operator.
    await client.role.update({ where: { id: roleId }, data: { companyId: companyIds[0], scopeKey: companyIds[0]!, isSystem: false } });
    assert.equal((await request(`${base}/overview`)).status, 403);
    return ['admin-system-role-company-mode-scope-and-owner-negative', 'admin-support-financial-redaction-and-expired-revoked-scope',
      'admin-case-version-audit-and-no-false-resolution', ...operationCases, ...(browser ? ['browser-delegated-billing-shell-case-assignment-and-mobile'] : [])];
  } finally {
    await client.billingOperatorScope.deleteMany({ where: { userId, stripeAccountId } });
    await client.membershipRole.deleteMany({ where: { roleId } });
    await client.role.delete({ where: { id: roleId } });
  }
}


async function checkOperations(input: Parameters<typeof checkBillingAdmin>[0] & { roleId: string }) {
  const { request, prisma, companyIds, roleId, browser, drain, failNextRead } = input, client = prisma.client, companyId = companyIds[0]!;
  const base = '/v1/system/billing';
  const preview = async (reason: string) => {
    const company = await request(`${base}/companies/${companyId}`);
    return request(`${base}/operations/preview`, 'POST', { type: 'RECONCILE', companyId, expectedVersion: company.body.version, reason });
  };
  assert.equal((await preview('permission denied')).status, 403);
  const grant = await client.permission.upsert({ where: { key: 'system.billing.reconcile.run' }, update: {}, create: { key: 'system.billing.reconcile.run', description: 'Reconcile billing' } });
  await client.rolePermission.create({ data: { roleId, permissionId: grant.id } });
  const proposed = await preview('ตรวจสอบรายการเดิม'); assert.equal(proposed.status, 200); assert.equal(proposed.body.state, 'PREVIEW');
  const competing = await preview('ตรวจสอบจากอีกแท็บ'); assert.equal(competing.status, 200);
  const body = { previewId: proposed.body.id, previewHash: proposed.body.previewHash, expectedVersion: proposed.body.version }, key = `billing-op-${proposed.body.id}`;
  assert.equal((await request(`${base}/operations`, 'POST', { ...body, previewHash: 'wrong' }, { 'idempotency-key': key })).status, 409);
  const queued = await request(`${base}/operations`, 'POST', body, { 'idempotency-key': key }); assert.equal(queued.status, 202); assert.equal(queued.body.state, 'QUEUED');
  const replay = await request(`${base}/operations`, 'POST', body, { 'idempotency-key': key }); assert.equal(replay.body.id, queued.body.id); assert.equal(replay.body.version, queued.body.version);
  assert.equal((await request(`${base}/operations`, 'POST', { previewId: competing.body.id, previewHash: competing.body.previewHash, expectedVersion: 0 },
    { 'idempotency-key': `billing-op-${competing.body.id}` })).status, 409);
  failNextRead(); await drain();
  const unknown = await request(`${base}/operations/${queued.body.id}`); assert.equal(unknown.body.state, 'UNKNOWN');
  const retry = await request(`${base}/operations/${queued.body.id}/retry`, 'POST', { expectedVersion: unknown.body.version }); assert.equal(retry.body.state, 'QUEUED');
  await client.rolePermission.delete({ where: { roleId_permissionId: { roleId, permissionId: grant.id } } });
  await drain(); const blocked = await request(`${base}/operations/${queued.body.id}`); assert.equal(blocked.body.state, 'BLOCKED'); assert.deepEqual(blocked.body.allowedActions, []);
  await client.rolePermission.create({ data: { roleId, permissionId: grant.id } });
  assert.equal((await request(`${base}/operations/${queued.body.id}/retry`, 'POST', { expectedVersion: blocked.body.version })).body.state, 'QUEUED');
  await drain(); const applied = await request(`${base}/operations/${queued.body.id}`); assert.equal(applied.body.state, 'SUCCEEDED');
  assert.equal(await client.billingIssue.count({ where: { referenceId: queued.body.id, kind: 'CONTROL_OPERATION_REVIEW', state: { not: 'RESOLVED' } } }), 0);
  assert.equal(await client.billingIssue.count({ where: { companyId, kind: 'REPEAT_RECOVERY', state: 'ASSIGNED' } }), 1, 'checking status does not resolve the customer support case');
  assert.ok(applied.body.observedAt); assert.equal(await client.billingReceiptGrant.count({ where: { companyId } }), 3);
  const cancelPreview = await preview('ยกเลิกคำสั่งที่ยังไม่เริ่ม');
  const cancelQueued = await request(`${base}/operations`, 'POST', { previewId: cancelPreview.body.id, previewHash: cancelPreview.body.previewHash, expectedVersion: 0 },
    { 'idempotency-key': `billing-op-${cancelPreview.body.id}` });
  assert.equal((await request(`${base}/operations/${cancelPreview.body.id}/cancel`, 'POST', { expectedVersion: cancelQueued.body.version })).body.state, 'CANCELLED');
  await drain(); assert.equal((await request(`${base}/operations/${cancelPreview.body.id}`)).body.state, 'CANCELLED');
  if (browser) {
    const page = browser.page;
    await page.goto(`${browser.origin}/system/billing/companies/${companyId}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'เหตุผลการตรวจสอบ', exact: true }).fill('ตรวจสอบจากหน้าเว็บ');
    await page.getByRole('button', { name: 'ตรวจสอบผลกระทบ', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'ตรวจสอบก่อนส่งคำสั่ง' }).waitFor();
    const permanentLink=page.getByRole('link', { name: 'เปิดลิงก์คำสั่งนี้', exact: true });
    const permanentPath=await permanentLink.getAttribute('href');assert.ok(permanentPath);
    await permanentLink.click();await page.waitForURL(`${browser.origin}${permanentPath}`);
    // Both pages contain the same controls. Wait for the destination's unique heading, not
    // a still-visible submit button on the departing company page.
    await page.getByRole('heading',{name:'คำสั่งตรวจสอบการชำระเงิน',exact:true}).waitFor();
    await page.getByRole('status').filter({ hasText: 'ตรวจสอบก่อนส่งคำสั่ง' }).waitFor();
    const submit = async () => {
      const response = page.waitForResponse(r => r.url().endsWith('/system/billing/operations') && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'ยืนยันส่งคำสั่งตรวจสอบ', exact: true }).click();
      return response;
    };
    const submitted = await submit(),accepted=await submitted.json();assert.equal(submitted.status(),202,JSON.stringify(accepted));assert.equal(accepted.state,'QUEUED');
    try{await page.getByRole('status').filter({ hasText: 'รอระบบตรวจสอบ' }).waitFor();}
    catch(error){await page.screenshot({path:`${browser.evidenceDir}/admin-operation-failure.png`,fullPage:true});
      console.error(JSON.stringify({stage:'admin-submit-display',pathname:new URL(page.url()).pathname,acceptedState:accepted.state,acceptedVersion:accepted.version,
        current:(await request(`${base}/operations/${accepted.id}`)).body.state,visible:await page.getByRole('region',{name:'คำสั่งตรวจสอบการชำระเงิน',exact:true}).innerText()}));throw error;}
    await drain(); await page.getByRole('button', { name: 'โหลดคำสั่งล่าสุด', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'ตรวจสอบสถานะล่าสุดแล้ว' }).waitFor();
    await page.screenshot({ path: `${browser.evidenceDir}/admin-operation-mobile.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole('link', { name: 'กลับไปบริษัท', exact: true }).click();
    await page.getByRole('region', { name: 'ข้อมูลการชำระเงินบริษัท' }).waitFor();
  }
  return ['admin-operation-preview-dedupe-and-competing-resource-reservation', 'admin-operation-provider-failure-permission-revoke-and-same-command-retry',
    'admin-operation-cancel-before-work-and-no-extra-quota', ...(browser ? ['browser-admin-preview-queue-observed-result-and-back'] : [])];
}
