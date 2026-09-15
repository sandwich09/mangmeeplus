import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { AppConfigService } from '../common/config/app-config.service';
import type { PrismaService } from '../common/database/prisma.service';
import { hashPassword } from '../modules/auth/domain/logic/password-credential.logic';
import type { startBillingBrowser } from './billing-browser-smoke';

/** Real Admin/BFF/LIFF HTTP and PostgreSQL; LINE SDK and provider verification/push are simulated.
 * The response-loss case calls the real API, then discards its committed response exactly once.
 */
export async function checkLineBinding(input: { app: INestApplication; prisma: PrismaService; origin: string; userId: string; companyId: string; membershipId: string;
  request: (path: string, method?: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any }>;
  browser: Awaited<ReturnType<typeof startBillingBrowser>>;
  transport: (hook: ((url: URL, init?: RequestInit) => Promise<Response | undefined> | Response | undefined) | undefined) => void;
}) {
  const { prisma, request, browser } = input, db = prisma.client, config = input.app.get(AppConfigService), cases: string[] = [];
  const identity = await db.externalIdentity.findFirstOrThrow({ where: { userId: input.userId, provider: 'LINE' } });
  const originalTerm = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: input.companyId } });
  const originalUser = await db.user.findUniqueOrThrow({ where: { id: input.userId } });
  const pushes: any[] = [], proof = 'synthetic.payload.signature';
  input.transport(async (url, init) => {
    if (url.hostname !== 'api.line.me') return undefined;
    if (url.pathname === '/oauth2/v2.1/verify') {
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get('id_token'), proof); assert.equal(form.get('client_id'), config.lineLoginChannelId);
      return Response.json({ sub: identity.providerUserId, aud: config.lineLoginChannelId, exp: Math.floor(Date.now() / 1000) + 3600 });
    }
    if (url.pathname === '/v2/bot/info') return Response.json({}, { status: 503 });
    if (url.pathname === '/v2/bot/message/push') { pushes.push(JSON.parse(String(init?.body))); return Response.json({}); }
    throw Error('Unexpected synthetic LINE route');
  });
  const admin = await db.role.upsert({ where: { scopeKey_key: { scopeKey: 'system', key: 'SYSTEM_ADMIN' } }, update: {},
    create: { scopeKey: 'system', key: 'SYSTEM_ADMIN', name: 'System Admin', isSystem: true } });
  const addedPermissions: string[] = [];
  const base = `/v1/system/partners/${input.companyId}`;
  const issuePath = `${base}/members/${input.userId}/line-link-token`;
  const username = `qr-${randomUUID()}`;
  const credential = await db.userCredential.create({ data: { userId: input.userId, passwordHash: hashPassword('Synthetic!Password123') } });
  const page = browser.page, liff = await page.context().newPage();
  try {
    await db.user.update({ where: { id: input.userId }, data: { username } });
    await db.externalIdentity.update({ where: { id: identity.id }, data: { providerChannelId: config.lineLoginChannelId! } });
    await db.companyPlanTerm.update({ where: { companyId: input.companyId }, data: { termEndsAt: new Date(Date.now() + 86400000) } });
    const beforePlan = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: input.companyId } });
    assert.equal((await request(issuePath, 'POST')).status, 403);
    const state = await request('/v1/auth/account/security');
    assert.equal(state.status, 200); assert.equal(state.body.lineLinked, true); assert.equal(state.body.lineMessagingReady, false);
    assert.equal((await request('/v1/auth/password/reset-request', 'POST', { username })).status, 200);
    assert.equal(pushes.length, 0); assert.equal(await db.passwordResetToken.count({ where: { userId: input.userId } }), 0);
    cases.push('legacy-link-visible-but-not-deliverable-no-recovery-secret-sent-no-admin-qr-without-permission');
    await page.goto(`${browser.origin}/companies/${input.companyId}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.locator('[aria-controls="sidebar-user-menu"]').click();
    await page.getByText('การรับข้อความ LINE ต้องตรวจการเชื่อมต่อ กรุณาติดต่อผู้ดูแลเพื่อออก QR ใหม่', { exact: true }).waitFor();
    assert.equal(await page.locator('#sidebar-user-menu button').filter({ hasText: 'LINE' }).isDisabled(), true);
    cases.push('existing-linked-user-sees-admin-repair-guidance-with-self-relink-still-disabled');
    for (const key of ['system.partner_dashboard.read', 'system.partner_member.read', 'system.partner_member.manage']) {
      const permission = await db.permission.upsert({ where: { key }, update: {}, create: { key, description: key } });
      if (!await db.rolePermission.findUnique({ where: { roleId_permissionId: { roleId: admin.id, permissionId: permission.id } } })) {
        await db.rolePermission.create({ data: { roleId: admin.id, permissionId: permission.id } }); addedPermissions.push(permission.id);
      }
    }
    await db.membershipRole.create({ data: { membershipId: input.membershipId, roleId: admin.id } });
    await page.goto(`${browser.origin}/system/partners/${input.companyId}`, { waitUntil: 'domcontentloaded' });
    await page.getByText('ตรวจช่องทาง LINE ของระบบ แล้วออก QR ใหม่เพื่อซ่อมการเชื่อมต่อ', { exact: true }).waitFor();
    const issuedResponse = page.waitForResponse(response => response.url().endsWith(`/members/${input.userId}/line-link-token`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Issue LINE QR', exact: true }).click();
    await page.getByRole('button', { name: 'Issue QR', exact: true }).click();
    const issued = await issuedResponse; assert.equal(issued.status(), 200);
    const issuedBody = await issued.json(), raw = new URL(issuedBody.lineLink.linkUrl).searchParams.get('token')!;
    assert.match(raw, /^[A-Za-z0-9_-]{32}$/);
    // Only the external LIFF SDK is substituted. The page, script and link API are our real app.
    await liff.route('https://static.line-scdn.net/**', route => route.fulfill({ contentType: 'application/javascript', body:
      `window.liff={init:async()=>{},isLoggedIn:()=>true,getIDToken:()=>${JSON.stringify(proof)},getDecodedIDToken:()=>({exp:Math.floor(Date.now()/1000)+3600})};` }));
    let discarded = false;
    await liff.route('**/v1/auth/line/employee-link', async route => {
      if (discarded) { await route.continue(); return; }
      const realResponse = await route.fetch(); assert.equal(realResponse.status(), 200);
      discarded = true; await route.abort('failed');
    });
    await liff.setViewportSize({ width: 390, height: 844 });
    await liff.goto(`${input.origin}/v1/auth/line/link-page/employee?token=${encodeURIComponent(raw)}`, { waitUntil: 'domcontentloaded' });
    // The real LIFF page starts linking on load; wait for that original response loss.
    await liff.getByText('เชื่อม LINE ไม่สำเร็จ', { exact: true }).waitFor();
    assert.equal(discarded, true);
    const used = await db.employeeLineLinkToken.findFirstOrThrow({ where: { userId: input.userId, status: 'USED' } });
    assert.equal(used.claimedLineUserId, identity.providerUserId); assert.equal(used.claimedLineChannelId, config.lineMessagingChannelId);
    assert.equal(new URL(liff.url()).searchParams.has('token'), false);
    const beforeRetry = await db.externalIdentity.findUniqueOrThrow({ where: { id: identity.id } });
    const auditCount = await db.auditLog.count({ where: { actorUserId: input.userId } });
    await liff.getByRole('button', { name: 'เชื่อม LINE', exact: true }).click();
    await liff.getByText('เชื่อม LINE สำเร็จแล้ว ปิดหน้านี้และกลับไปที่ LINE ได้เลย', { exact: true }).waitFor();
    assert.deepEqual(await db.externalIdentity.findUniqueOrThrow({ where: { id: identity.id } }), beforeRetry);
    assert.equal(await db.auditLog.count({ where: { actorUserId: input.userId } }), auditCount);
    assert.equal(await liff.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await liff.screenshot({ path: `${browser.evidenceDir}/line-qr-recovered-mobile.png`, fullPage: true });
    cases.push('real-admin-qr-issue-liff-legacy-repair-lost-response-same-qr-read-only-recovery');
    assert.equal((await request('/v1/auth/account/security')).body.lineMessagingReady, true);
    const members = await request(`${base}/members`); assert.equal(members.status, 200);
    assert.equal(members.body.items.find((member: any) => member.userId === input.userId).lineMessagingReady, true);
    assert.equal((await request('/v1/auth/password/reset-request', 'POST', { username })).status, 200);
    const deadline = Date.now() + 5000;
    while (!pushes.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(pushes.length, 1); assert.equal(pushes[0].to, identity.providerUserId);
    assert.equal(await db.passwordResetToken.count({ where: { userId: input.userId, status: 'PENDING' } }), 1);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Issue LINE QR', exact: true }).waitFor();
    assert.equal(await page.getByText('ตรวจช่องทาง LINE ของระบบ แล้วออก QR ใหม่เพื่อซ่อมการเชื่อมต่อ', { exact: true }).count(), 0);
    assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: input.companyId } }), beforePlan);
    cases.push('repaired-account-and-admin-state-original-recovery-request-delivers-on-current-binding-without-package-change');
    const recoveryPassword = pushes[0].messages[0].contents.footer.contents[0].action.clipboardText;
    assert.equal(typeof recoveryPassword, 'string');
    const oldRecovery = await db.passwordResetToken.findFirstOrThrow({ where: { userId: input.userId, status: 'PENDING' } });
    const unlinkedResponse = page.waitForResponse(response => response.url().endsWith(`/members/${input.userId}/line-unlink`) && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Unlink LINE', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Unlink LINE', exact: true }).click();
    assert.equal((await unlinkedResponse).status(), 200);
    assert.equal((await db.passwordResetToken.findUniqueOrThrow({ where: { id: oldRecovery.id } })).status, 'REVOKED');
    assert.equal((await request('/v1/auth/password/login', 'POST', { username, password: recoveryPassword })).status, 401);
    const legacyAlias = await db.externalIdentity.create({ data: { userId: input.userId, provider: 'LINE', providerUserId: identity.providerUserId,
      providerChannelId: config.lineLoginChannelId! } });
    const oldQr = await request('/v1/auth/line/employee-link', 'POST', { token: raw, idToken: proof });
    assert.equal(oldQr.status, 403);
    assert.equal((await db.externalIdentity.findUniqueOrThrow({ where: { id: identity.id } })).status, 'UNLINKED');
    cases.push('browser-admin-unlink-revokes-delivered-recovery-password-and-old-used-qr-cannot-revive-through-legacy-alias');
    const replacement = await request(issuePath, 'POST'); assert.equal(replacement.status, 200);
    const replacementToken = new URL(replacement.body.lineLink.linkUrl).searchParams.get('token')!;
    await liff.goto(`${input.origin}/v1/auth/line/link-page/employee?token=${encodeURIComponent(replacementToken)}`, { waitUntil: 'domcontentloaded' });
    await liff.getByText('เชื่อม LINE สำเร็จแล้ว ปิดหน้านี้และกลับไปที่ LINE ได้เลย', { exact: true }).waitFor();
    assert.equal((await request('/v1/auth/account/security')).body.lineMessagingReady, true);
    assert.deepEqual(await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: input.companyId } }), beforePlan);
    await db.externalIdentity.delete({ where: { id: legacyAlias.id } });
    cases.push('fresh-admin-qr-restores-the-current-binding-through-the-same-liff-page-with-unchanged-package');
    await db.membershipRole.deleteMany({ where: { membershipId: input.membershipId, roleId: admin.id } });
    assert.equal((await request(issuePath, 'POST')).status, 403);
    cases.push('fresh-admin-authorization-required-after-role-revocation');
    return cases;
  } finally {
    await liff.close(); input.transport(undefined);
    await db.employeeLineLinkToken.deleteMany({ where: { userId: input.userId } });
    await db.passwordResetToken.deleteMany({ where: { userId: input.userId } });
    await db.membershipRole.deleteMany({ where: { membershipId: input.membershipId, roleId: admin.id } });
    await db.rolePermission.deleteMany({ where: { roleId: admin.id, permissionId: { in: addedPermissions } } });
    await db.externalIdentity.update({ where: { id: identity.id }, data: { providerChannelId: identity.providerChannelId } });
    await db.userCredential.deleteMany({ where: { id: credential.id } });
    await db.user.update({ where: { id: input.userId }, data: { username: originalUser.username } });
    await db.companyPlanTerm.update({ where: { companyId: input.companyId }, data: { termEndsAt: originalTerm.termEndsAt } });
  }
}
