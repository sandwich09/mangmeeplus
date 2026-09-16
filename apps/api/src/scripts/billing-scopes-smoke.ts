import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { BrowserContext } from '@playwright/test';
import type { checkBillingConfiguration } from './billing-configuration-smoke';
import { checkBillingCompanyRead } from './billing-company-read-smoke';
import { checkBillingCases } from './billing-cases-smoke';
import { checkBillingDeliveryRecovery } from './billing-delivery-recovery-smoke';

export async function checkBillingScopes(input: Parameters<typeof checkBillingConfiguration>[0] & {
  approveRequest: Parameters<typeof checkBillingConfiguration>[0]['request']; password: string; adminRoleId: string; secondBrowser?: BrowserContext;
}) {
  const { request, approveRequest, password, browser, companyId, stripeAccountId, adminRoleId } = input, client = input.prisma.client;
  const base = '/v1/system/billing', run = randomUUID(), targetId = `scope-${run}`, identity = { userId: targetId, companyId, stripeAccountId, livemode: false };
  const manage = await client.permission.upsert({ where: { key: 'admin.role.manage' }, update: {}, create: { key: 'admin.role.manage', description: 'Manage roles' } });
  const adminGrant = { roleId: adminRoleId, permissionId: manage.id };
  const existingGrant = await client.rolePermission.findUnique({ where: { roleId_permissionId: adminGrant } });
  if (!existingGrant) await client.rolePermission.create({ data: adminGrant });
  const permissions = await client.permission.findMany({ where: { key: { in: ['system.billing.read', 'account.session.read'] } } });
  assert.equal(permissions.length, 2);
  const role = await client.role.create({ data: { key: `BILLING_SCOPES_${run}`, name: 'Synthetic scoped support', scopeKey: 'system', isSystem: true,
    permissions: { create: permissions.map(p => ({ permissionId: p.id })) } } });
  await client.user.create({ data: { id: targetId, displayName: `Scope operator ${run}`, email: `${targetId}@example.test` } });
  input.userIds.push(targetId);
  const member = await client.companyMembership.create({ data: { companyId, userId: targetId, roles: { create: { roleId: role.id } } } });
  await input.recordLegal(targetId, member.id);
  const sid = randomUUID(), token = input.signToken(sid, targetId);
  await client.authSession.create({ data: { userId: targetId, tokenId: sid, expiresAt: new Date(Date.now() + 3600000) } });
  const delegated: typeof request = (path, method, body, extra) => request(path, method, body, { ...extra, authorization: `Bearer ${token}` });
  const accountIds = (await client.billingAccount.findMany({ where: { stripeAccountId }, select: { id: true } })).map(a=>a.id);
  const invoiceWhere = { billingAccountId: { in: accountIds } };
  const snapshot = await client.billingInvoice.findMany({ where: invoiceWhere, orderBy: { id: 'asc' } });
  const grants = await client.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } });
  const pageCompanies = Array.from({ length: 26 }, (_, n) => ({ id: `scope-page-${run}-${String(n).padStart(2,'0')}`, name: `Scope directory ${run} ${n}` }));
  const preview = async (type = 'GRANT_SCOPE', expiresAt: string | null = null, userId = targetId) => {
    const result = await request(`${base}/scope-changes/preview`, 'POST', { type, userId, companyId, expiresAt, reason: 'ตรวจขอบเขตโดยไม่เปลี่ยนข้อมูลการชำระเงิน' });
    return result;
  };
  const body = (op: any) => ({ expectedVersion: op.version, previewHash: op.previewHash });
  const submit = (op: any) => request(`${base}/scope-changes/${op.id}/submit`, 'POST', body(op), { 'idempotency-key': `billing-scope-${op.id}` });
  const approve = (op: any) => approveRequest(`${base}/scope-changes/${op.id}/approve`, 'POST', body(op));
  const proof = async (page: NonNullable<typeof browser>['page']) => {
    await page.getByLabel('รหัสผ่านปัจจุบัน', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'ยืนยันตัวตนก่อนเปลี่ยนขอบเขต', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'ยืนยันตัวตนถึง' }).waitFor();
  };
  try {
    assert.equal((await delegated(`${base}/operator-scopes`)).status, 403);
    assert.equal((await delegated(`${base}/overview`)).body.companies.length, 0);
    assert.equal((await request(`${base}/overview`)).body.canManageScopes, true);
    const operators = await request(`${base}/scope-directory/operators?search=${run}`);
    assert.equal(operators.status, 200, JSON.stringify(operators.body)); assert.deepEqual(operators.body.items.map((u: any) => u.id), [targetId]);
    assert.equal((await preview('GRANT_SCOPE', null, input.userIds[0]!)).body.code, 'CONTROL_SCOPE_TARGET_INVALID', 'SYSTEM_ADMIN cannot be accidentally constrained by a scope');
    await client.role.update({ where: { id: role.id }, data: { companyId, scopeKey: companyId, isSystem: false } });
    assert.equal((await preview()).body.code, 'CONTROL_SCOPE_TARGET_INVALID', 'copied company role cannot be promoted');
    await client.role.update({ where: { id: role.id }, data: { companyId: null, scopeKey: 'system', isSystem: true } });
    await client.company.createMany({ data: pageCompanies });
    const first = (await request(`${base}/scope-directory/companies?search=${run}`)).body;
    assert.equal(first.items.length, 25); assert.ok(first.nextCursor);
    const last = (await request(`${base}/scope-directory/companies?search=${run}&cursor=${first.nextCursor}`)).body;
    assert.equal(last.items.length, 1); assert.equal(last.nextCursor, null);
    assert.equal(new Set([...first.items, ...last.items].map(c => c.id)).size, 26);
    assert.equal((await request(`${base}/scope-directory/companies?search=missing-${run}&cursor=${first.nextCursor}`)).status, 404);
    assert.equal((await request(`${base}/scope-directory/operators?search=${'a'.repeat(101)}`)).status, 400);
    await client.authSession.updateMany({ where: { userId: { in: input.userIds.slice(0,2) } }, data: { billingReauthenticatedAt: null, billingCredentialVersion: null } });
    let proposed: any;
    if (browser) {
      const page = browser.page;
      await page.goto(`${browser.origin}/system/billing/operator-scopes`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('ค้นหาเจ้าหน้าที่', { exact: true }).fill(run);
      await page.getByRole('button', { name: 'ค้นหารายชื่อเจ้าหน้าที่', exact: true }).click();
      await page.getByLabel('เจ้าหน้าที่ที่เลือก', { exact: true }).selectOption(targetId);
      await page.getByLabel('ค้นหาบริษัท', { exact: true }).fill(run);
      await page.getByRole('button', { name: 'ค้นหารายชื่อบริษัท', exact: true }).click();
      await page.getByLabel('บริษัทที่เลือก', { exact: true }).selectOption(pageCompanies[0]!.id);
      await page.getByRole('button', { name: 'รายชื่อหน้าถัดไป', exact: true }).click();
      await page.waitForFunction(() => Array.from(document.querySelectorAll('select')).at(-1)?.options.length === 2);
      assert.equal(await page.getByLabel('บริษัทที่เลือก', { exact: true }).inputValue(), '', 'page change clears a now hidden selection');
      await page.getByLabel('ค้นหาบริษัท', { exact: true }).fill(companyId);
      await page.getByRole('button', { name: 'ค้นหารายชื่อบริษัท', exact: true }).click();
      await page.getByLabel('บริษัทที่เลือก', { exact: true }).selectOption(companyId);
      await page.getByLabel('ยืนยันให้ขอบเขตนี้โดยไม่กำหนดวันหมดอายุ', { exact: true }).check();
      await page.getByLabel('เหตุผลการเปลี่ยนขอบเขต', { exact: true }).fill('ทดสอบให้ขอบเขตและถอนผ่านเว็บ');
      for(let tries=0;;tries++) {
        const response=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith('/scope-changes/preview'));
        await page.getByRole('button', { name: 'ตรวจผลกระทบการให้ขอบเขต', exact: true }).click();
        const result=await response;
        if(result.status()!==429){assert.equal(result.status(),200);break;}
        const body=await result.json();assert.ok(tries<2&&body.retryAfterSeconds>=1&&body.retryAfterSeconds<=60);
        await page.getByRole('alert').filter({hasText:`กรุณารอ ${body.retryAfterSeconds} วินาที`}).waitFor();
        // The real limiter remains enabled; retry through the same button after its window, with the same selection.
        await new Promise(resolve=>setTimeout(resolve,Math.min(60,body.retryAfterSeconds+1)*1000));
      }
      await page.getByRole('status').filter({ hasText: 'ตรวจสอบขอบเขตก่อนยืนยัน' }).waitFor();
      const href = await page.getByRole('link', { name: 'เปิดคำขอขอบเขตนี้', exact: true }).getAttribute('href'); assert.ok(href);
      proposed = (await request(`${base}/scope-changes/${href.split('/').at(-1)}`)).body;
      assert.equal((await submit(proposed)).body.code, 'CONTROL_REAUTH_REQUIRED');
      await page.getByRole('link', { name: 'เปิดคำขอขอบเขตนี้', exact: true }).click();
      await page.waitForURL(`${browser.origin}${href}`);
      await proof(page);
      await page.getByRole('button', { name: 'บันทึกคำขอก่อนยืนยัน', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'รอยืนยันรายการ' }).waitFor();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByRole('status').filter({ hasText: 'รอยืนยันรายการ' }).waitFor();
    } else {
      const result = await preview(); assert.equal(result.status, 200); proposed = result.body;
      assert.equal((await submit(proposed)).body.code, 'CONTROL_REAUTH_REQUIRED');
      assert.equal((await request(`${base}/reauthenticate`, 'POST', { password })).status, 200);
      assert.equal((await submit(proposed)).body.state, 'AWAITING_APPROVAL');
    }
    const waiting = (await request(`${base}/scope-changes/${proposed.id}`)).body;
    assert.equal((await submit(proposed)).body.id, proposed.id);
    assert.ok(waiting.allowedActions.includes('approve'));
    const selfApprove=()=>request(`${base}/scope-changes/${waiting.id}/approve`,'POST',body(waiting));
    assert.equal((await approve(waiting)).body.code, 'CONTROL_REAUTH_REQUIRED');
    const actorRoleIds=(await client.membershipRole.findMany({where:{membershipId:input.membershipId}})).map(r=>r.roleId);
    const financialGrants=await client.rolePermission.findMany({where:{roleId:{in:actorRoleIds},permission:{key:'system.billing.financial.read'}}});
    try {
      await client.rolePermission.deleteMany({where:{roleId:{in:actorRoleIds},permission:{key:'system.billing.financial.read'}}});
      assert.ok(!(await request(`${base}/overview`)).body.capabilities.includes('system.billing.financial.read'));
    if (browser) {
      const page = browser.page;
      await page.goto(`${browser.origin}/system/billing/scope-changes/${waiting.id}`, { waitUntil: 'domcontentloaded' });
      await proof(page); await page.getByRole('button', { name: 'อนุมัติขอบเขตนี้', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'บันทึกขอบเขตแล้ว' }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: `${browser.evidenceDir}/admin-scopes-mobile.png`, fullPage: true });
      await page.getByRole('link', { name: 'รายการขอบเขตทั้งหมด', exact: true }).click();
      await page.getByRole('region', { name: 'ขอบเขตปัจจุบัน', exact: true }).getByText(/ดูแลบริษัทนี้ได้/).waitFor();
    } else { assert.equal((await approveRequest(`${base}/reauthenticate`, 'POST', { password })).status, 200);
      assert.equal((await selfApprove()).body.state, 'SUCCEEDED'); }
    } finally { await client.rolePermission.createMany({data:financialGrants}); }
    assert.equal((await selfApprove()).body.state, 'SUCCEEDED');
    assert.equal((await selfApprove()).body.approvalMode,'SINGLE_ADMIN');
    assert.equal((await approveRequest(`${base}/reauthenticate`,'POST',{password})).status,200);
    assert.deepEqual((await delegated(`${base}/overview`)).body.companies.map((c: any) => c.companyId), [companyId]);
    const detail = await delegated(`${base}/companies/${companyId}`); assert.equal(detail.status, 200); assert.equal(detail.body.financial, null);
    assert.equal((await delegated(`${base}/companies/${pageCompanies[0]!.id}`)).status, 404);
    assert.equal((await delegated(`${base}/scope-changes/${waiting.id}`)).status, 403);
    const companyCases=await checkBillingCompanyRead({...input,delegated,targetId,companyIds:pageCompanies.map(c=>c.id)});
    const caseCases=await checkBillingCases({...input,delegated,targetId,targetRoleId:role.id,otherCompanyId:pageCompanies[0]!.id});
    const deliveryCases=await checkBillingDeliveryRecovery({...input,delegated,targetId,targetRoleId:role.id,otherCompanyId:pageCompanies[0]!.id});
    if (browser) {
      const page = browser.page;
      await page.goto(`${browser.origin}/system/billing/operator-scopes`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('เหตุผลการเปลี่ยนขอบเขต', { exact: true }).fill('ถอนขอบเขตหลังปิดงาน');
      const scope = page.getByRole('region', { name: 'ขอบเขตปัจจุบัน', exact: true }).locator('article').filter({ hasText: `Scope operator ${run}` });
      await scope.getByRole('button', { name: /^ตรวจถอนขอบเขต/ }).click();
      await page.getByRole('button', { name: 'ยืนยันถอนขอบเขต', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'บันทึกขอบเขตแล้ว' }).waitFor();
      await scope.getByText(/ถอนสิทธิ์ดูแลบริษัทแล้ว/).waitFor();
    } else assert.equal((await submit((await preview('REVOKE_SCOPE')).body)).body.state, 'SUCCEEDED');
    assert.equal((await delegated(`${base}/companies/${companyId}`)).status, 404);
    assert.equal((await submit(proposed)).body.state, 'SUCCEEDED');
    assert.equal((await selfApprove()).body.state,'SUCCEEDED');
    assert.equal((await approve(waiting)).status,409,'another actor cannot replace the original confirmation');
    assert.equal((await delegated(`${base}/companies/${companyId}`)).status, 404, 'old successful submit/approval replay never regrants a revoked scope');
    const staleRole = (await submit((await preview()).body)).body;
    await client.rolePermission.create({ data: { roleId: role.id, permissionId: manage.id } });
    assert.equal((await approve(staleRole)).body.code, 'CONTROL_PREVIEW_STALE', 'changed target capabilities need a new review');
    await client.rolePermission.delete({ where: { roleId_permissionId: { roleId: role.id, permissionId: manage.id } } });
    assert.equal((await request(`${base}/scope-changes/${staleRole.id}/cancel`, 'POST', body(staleRole))).body.state, 'CANCELLED');
    const firstGrant = (await submit((await preview()).body)).body, competing = (await submit((await preview()).body)).body;
    await client.membershipRole.delete({ where: { membershipId_roleId: { membershipId: input.membershipId, roleId: adminRoleId } } });
    assert.equal((await approve(firstGrant)).status, 403, 'revoked initiator platform authority cannot be approved');
    await client.membershipRole.create({ data: { membershipId: input.membershipId, roleId: adminRoleId } });
    assert.equal((await approve(firstGrant)).body.state, 'SUCCEEDED');
    assert.equal((await approve(competing)).body.code, 'CONTROL_PREVIEW_STALE', 'competing old scope version cannot overwrite the grant');
    await client.billingOperatorScope.update({ where: { userId_stripeAccountId_livemode_companyId: identity }, data: { expiresAt: new Date(Date.now()-1000), version: { increment: 1 } } });
    assert.equal((await delegated(`${base}/companies/${companyId}`)).status, 404, 'expiry denies admission with no worker involved');
    await client.billingOperatorScope.create({ data: { ...identity, livemode: true, createdByUserId: input.userIds[0]! } });
    assert.equal((await delegated(`${base}/overview`)).body.companies.length, 0, 'LIVE scope cannot grant TEST access');
    const expiring = (await submit((await preview()).body)).body;
    await client.billingOperation.update({ where: { id: expiring.id }, data: { expiresAt: new Date(Date.now()-1000) } });
    assert.equal((await approve(expiring)).body.code, 'CONTROL_PREVIEW_STALE');
    const audit = await client.auditLog.count({ where: { companyId, action: 'billing.operator_scope.applied', metadataJson: { path: ['userId'], equals: targetId } } });
    assert.equal(audit, 3, 'one grant, one revoke, one new independently approved grant; no replay mutation');
    assert.deepEqual(await client.billingInvoice.findMany({ where: invoiceWhere, orderBy: { id: 'asc' } }), snapshot);
    assert.deepEqual(await client.billingReceiptGrant.findMany({ where: { companyId }, orderBy: { id: 'asc' } }), grants);
    return ['admin-scope-directory-pagination-and-real-platform-target-boundary', 'admin-scope-independent-password-approved-grant-and-delegated-redaction',
      'admin-scope-revoke-expiry-mode-and-historical-replay-no-regrant', 'admin-scope-stale-role-version-expired-preview-revoked-initiator-and-unchanged-ledgers',
      ...(browser ? ['browser-admin-scope-search-pagination-preview-reload-independent-approval-revoke-and-mobile'] : []),...companyCases,...caseCases,...deliveryCases];
  } catch (error) {
    if (browser) { await browser.page.screenshot({ path: `${browser.evidenceDir}/scopes-failure.png`, fullPage: true });
      console.error('Scope browser failure view:', browser.page.url(), await browser.page.locator('main').last().innerText()); }
    throw error;
  } finally {
    await client.billingOperatorScope.deleteMany({ where: { userId: targetId, stripeAccountId } });
    await client.membershipRole.deleteMany({ where: { roleId: role.id } });
    await client.role.delete({ where: { id: role.id } });
    await client.company.deleteMany({ where: { id: { in: pageCompanies.map(c=>c.id) } } });
    if (!existingGrant) await client.rolePermission.delete({ where: { roleId_permissionId: adminGrant } });
  }
}
