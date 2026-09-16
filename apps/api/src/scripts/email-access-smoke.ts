import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { CompanySignupCoreService } from '../modules/external-signup/application/company-signup-core.service';
import { AppConfigService } from '../common/config/app-config.service';
import type { PrismaService } from '../common/database/prisma.service';
import { FEATURE_PACKAGE_PRESETS } from '@watchdog-bms/contracts';
import { ROLE_GRANTS } from '../modules/auth/permission-registry';
import type { startBillingBrowser } from './billing-browser-smoke';

export async function checkEmailAccess(input: { app: INestApplication; prisma: PrismaService; membershipId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<{ status: number; body: any }>;
  browser: Awaited<ReturnType<typeof startBillingBrowser>>; transport: (hook: (url: URL, init?: RequestInit) => Response | undefined) => void }) {
  const { app, prisma, browser } = input, db = prisma.client, tag = randomUUID().replaceAll('-', ''), mail: any[] = [], cases: string[] = [];
  const config = app.get(AppConfigService), saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ externalSignupEnabled: true, lineSignupApprovalMode: 'AUTO_FREE', lineSignupAutoDailyCap: 1000 })) {
    saved.set(key, Object.getOwnPropertyDescriptor(config, key)); Object.defineProperty(config, key, { configurable: true, value });
  }
  const visitorIp = `2001:db8:${tag.slice(0, 24).match(/.{4}/g)!.join(':')}`;
  const customer = await browser.page.context().browser()!.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-forwarded-for': visitorIp } });
  customer.setDefaultTimeout(30000); const page = await customer.newPage(); let recipient = `email-access-${tag}@example.test`, shop = `Email access ${tag}`; const recipients = [recipient];
  const reply = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  try {
    for (const [key, grants] of [['OWNER', ROLE_GRANTS.OWNER!], ['SYSTEM_ADMIN', ['system.company_onboarding.read', 'system.company_onboarding.create']]] as const) {
      await db.permission.createMany({ data: grants.map(key => ({ key, description: key })), skipDuplicates: true });
      const permissions = await db.permission.findMany({ where: { key: { in: [...grants] } } });
      const role = await db.role.upsert({ where: { scopeKey_key: { scopeKey: 'system', key } }, create: { key, scopeKey: 'system', isSystem: true, name: key,
        permissions: { create: permissions.map(p => ({ permissionId: p.id })) } }, update: {} });
      if (key === 'SYSTEM_ADMIN') await db.membershipRole.upsert({ where: { membershipId_roleId: { membershipId: input.membershipId, roleId: role.id } }, create: { membershipId: input.membershipId, roleId: role.id }, update: {} });
    }
    input.transport((url, init) => {
      if (url.origin !== 'https://api.postmarkapp.com' || url.pathname !== '/email') return;
      const body = JSON.parse(String(init?.body)); assert.equal(body.Tag, 'email_access'); assert.equal(body.To, recipient);
      assert.equal(body.TrackOpens, false); assert.equal(body.TrackLinks, 'None'); mail.push(body);
      return reply({ ErrorCode: 0, MessageID: randomUUID(), SubmittedAt: new Date().toISOString() });
    });
    const send = async (nextPath = '') => {
      await page.goto(`${browser.origin}/email-access${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ''}`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('อีเมลของคุณ', { exact: true }).fill(recipient);
      const pending = page.waitForResponse(r => r.url().endsWith('/email-access/request'));
      await page.getByRole('button', { name: 'รับรหัสทางอีเมล', exact: true }).click();
      const response = await pending; assert.equal(response.request().postDataJSON().email, recipient, 'hydrated email field must reach BFF'); assert.equal(response.status(), 200, await response.text());
      const data = await response.json(); assert.equal(data.deliveryStatus, 'ACCEPTED');
      assert.equal('browserSecret' in data, false); assert.equal('accessToken' in data, false);
      return data;
    };
    if (process.env.MANGMEE_MARKETING_DIR) {
      const { checkEmailSignupMarketing } = await import('./billing-marketing-smoke');
      cases.push(...await checkEmailSignupMarketing({ page, appOrigin: browser.origin, directory: process.env.MANGMEE_MARKETING_DIR, evidenceDir: browser.evidenceDir }));
    }
    const issued = await send(); assert.equal(mail.length, 1);
    const cookie = (await customer.cookies()).find(c => c.name === 'mm_email_access'); assert.ok(cookie?.httpOnly);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const rightCode = mail.at(-1).TextBody.match(/\b\d{6}\b/)[0];
    await page.getByLabel('รหัส 6 หลัก', { exact: true }).fill(rightCode === '000000' ? '000001' : '000000');
    await page.getByRole('button', { name: 'ยืนยันและดำเนินการต่อ', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.ok(await page.getByLabel('รหัส 6 หลัก', { exact: true }).isVisible());
    await page.getByLabel('รหัส 6 หลัก', { exact: true }).fill(mail.at(-1).TextBody.match(/\b\d{6}\b/)[0]);
    await page.getByRole('button', { name: 'ยืนยันและดำเนินการต่อ', exact: true }).click();
    await page.getByRole('heading', { name: 'เริ่มต้นร้านของคุณ', exact: true }).waitFor();
    await page.getByLabel('ชื่อร้าน', { exact: true }).fill(shop);
    await page.getByLabel('ชื่อผู้ติดต่อ', { exact: true }).fill('ผู้ประกอบการทดสอบ');
    await page.getByLabel('เบอร์มือถือ', { exact: true }).fill('089' + tag.split('').map(x => parseInt(x, 16) % 10).join('').slice(0, 7));
    assert.ok(await page.getByRole('link', { name: 'ประกาศความเป็นส่วนตัว', exact: true }).isVisible());
    await page.screenshot({ path: `${browser.evidenceDir}/email-signup-390.png`, fullPage: true });
    const submitting = page.waitForResponse(r => r.url().endsWith('/email-access/signup'));
    await page.getByRole('button', { name: 'เริ่มใช้ฟรี', exact: true }).click();
    const submitted = await submitting; assert.equal(submitted.status(), 200);
    await page.waitForURL('**/legal-acceptance?**');
    const request = await db.companySignupRequest.findFirstOrThrow({ where: { source: 'email-otp', contactEmail: recipient } });
    assert.equal(request.state, 'COMPLETED'); assert.ok(request.companyId && request.ownerUserId);
    const owner = await db.user.findUniqueOrThrow({ where: { id: request.ownerUserId }, include: { credential: true } });
    assert.ok(owner.emailVerifiedAt && owner.emailLoginEnabledAt); assert.equal(owner.credential, null); assert.equal(owner.username, null);
    const term = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: request.companyId } });
    assert.equal(term.tierKey, 'FREE_TRIAL_15'); assert.equal(term.monthlySlipLimit, 15); assert.equal(term.branchLimit, 1); assert.equal(term.employeeLimit, 2);
    const features = await db.companyFeatureEntitlement.findMany({ where: { companyId: request.companyId, enabled: true } });
    assert.deepEqual(features.map(f => f.featureKey).sort(), [...FEATURE_PACKAGE_PRESETS.starter.featureKeys].sort());
    await page.waitForURL('**/legal-acceptance?**');
    for (const name of ['termsAccepted', 'privacyAcknowledged', 'deletionAcknowledged']) await page.locator(`input[name="${name}"]`).check();
    await page.getByRole('button', { name: /ยืนยันและเริ่มใช้งาน|Confirm and start/i }).click();
    await page.waitForURL(`**/companies/${request.companyId}/**`);
    const me = await customer.request.get(`${browser.origin}/api/v1/auth/me`);
    assert.equal(me.status(), 200); assert.equal((await me.json()).userId, owner.id);
    await page.goto(`${browser.origin}/companies/${request.companyId}/expenses/upload`, { waitUntil: 'domcontentloaded' });
    await page.locator('fieldset:not([disabled]) input[type="file"]').first().waitFor({ state: 'attached' });
    cases.push('browser email→OTP→reload→short form→one trial/company→HttpOnly session; no password or raw auth tokens');
    await customer.clearCookies();
    await db.emailAccessChallenge.update({ where: { id: issued.challengeId }, data: { createdAt: new Date(Date.now() - 61_000) } });
    await send(`/companies/${request.companyId}/expenses/upload`);
    await page.getByLabel('รหัส 6 หลัก', { exact: true }).fill(mail.at(-1).TextBody.match(/\b\d{6}\b/)[0]);
    const login = page.waitForResponse(r => r.url().endsWith('/email-access/confirm'));
    await page.getByRole('button', { name: 'ยืนยันและดำเนินการต่อ', exact: true }).click();
    const loginResponse = await login; assert.equal(loginResponse.status(), 200);
    await page.waitForURL(`**/companies/${request.companyId}/expenses/upload`);
    assert.equal(await db.companySignupRequest.count({ where: { source: 'email-otp', contactEmail: recipient } }), 1);
    const unchanged = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: request.companyId } });
    assert.equal(unchanged.termEndsAt?.getTime(), term.termEndsAt?.getTime());
    cases.push('logout/new browser proof→same account/company; no second trial or date reset');
    await page.goto(`${browser.origin}/companies/${request.companyId}/expenses/upload`, { waitUntil: 'domcontentloaded' });
    await page.locator('fieldset:not([disabled]) input[type="file"]').first().waitFor({ state: 'attached' });
    await page.screenshot({ path: `${browser.evidenceDir}/email-returning-390.png`, fullPage: true });
    cases.push('current legal acceptance gate→authenticated user→receipt upload screen with starter permissions');

    // Manual review uses the original administration API and resumes the SAME browser proof.
    Object.defineProperty(config, 'lineSignupApprovalMode', { configurable: true, value: 'MANUAL' });
    await customer.clearCookies(); recipient = `manual-${tag}@example.test`; recipients.push(recipient);
    await send();
    await page.getByLabel('รหัส 6 หลัก', { exact: true }).fill(mail.at(-1).TextBody.match(/\b\d{6}\b/)[0]);
    await page.getByRole('button', { name: 'ยืนยันและดำเนินการต่อ', exact: true }).click();
    await page.getByRole('heading', { name: 'เริ่มต้นร้านของคุณ', exact: true }).waitFor();
    await page.getByLabel('ชื่อร้าน', { exact: true }).fill(`Manual ${tag}`);
    await page.getByLabel('ชื่อผู้ติดต่อ', { exact: true }).fill('ผู้สมัครรอตรวจ');
    await page.getByLabel('เบอร์มือถือ', { exact: true }).fill('088' + tag.split('').map(x => parseInt(x, 16) % 10).join('').slice(0, 7));
    await page.getByRole('button', { name: 'เริ่มใช้ฟรี', exact: true }).click();
    await page.getByRole('heading', { name: 'ทีมงานกำลังตรวจคำขอของคุณ', exact: true }).waitFor();
    const manual = await db.companySignupRequest.findFirstOrThrow({ where: { source: 'email-otp', contactEmail: recipient } });
    assert.equal(manual.state, 'PENDING_REVIEW'); assert.equal(manual.companyId, null);
    assert.equal(await db.user.count({ where: { email: recipient } }), 0);
    const admin = browser.page;
    await admin.goto(`${browser.origin}/system/signup-requests`, { waitUntil: 'domcontentloaded' });
    const row = admin.getByRole('row').filter({ hasText: `Manual ${tag}` });
    await row.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    const dialog = admin.getByRole('dialog');
    assert.match(await dialog.innerText(), /ไม่ต้องตั้งรหัสผ่าน/);
    const core = app.get(CompanySignupCoreService), complete = core.completeProvisioning.bind(core);
    core.completeProvisioning = async () => { throw new Error('synthetic crash after company commit'); };
    try {
      const failed = admin.waitForResponse(r => r.url().includes(`/signup-requests/${manual.id}/decision`));
      await dialog.getByRole('button', { name: 'อนุมัติและเปิดร้าน', exact: true }).click();
      assert.equal((await failed).status(), 500);
    } finally { core.completeProvisioning = complete; }
    const stranded = await db.companySignupRequest.findUniqueOrThrow({ where: { id: manual.id } });
    assert.equal(stranded.state, 'PROVISIONING_FAILED'); assert.ok(stranded.companyId);
    const priorTerm = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: stranded.companyId } });
    await admin.reload({ waitUntil: 'domcontentloaded' });
    await row.getByRole('button', { name: 'ลองเปิดร้านอีกครั้ง', exact: true }).click();
    const approved = admin.waitForResponse(r => r.url().includes(`/signup-requests/${manual.id}/decision`));
    await admin.getByRole('dialog').getByRole('button', { name: 'ทำรายการเดิมต่อ', exact: true }).click();
    assert.equal((await approved).status(), 200);
    const finalTerm = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: stranded.companyId } });
    assert.equal(finalTerm.termEndsAt?.getTime(), priorTerm.termEndsAt?.getTime());
    cases.push('admin UI source-aware approval→synthetic crash after company commit→retry adopts same shop/trial without resetting dates');
    await page.getByRole('button', { name: 'ตรวจสถานะอีกครั้ง', exact: true }).click();
    await page.waitForURL('**/legal-acceptance?**');
    const resolved = await db.companySignupRequest.findUniqueOrThrow({ where: { id: manual.id } });
    assert.ok(resolved.ownerUserId && resolved.companyId);
    assert.equal(await db.userCredential.count({ where: { userId: resolved.ownerUserId } }), 0);
    assert.equal(await db.emailSendAttempt.count({ where: { signupRequestId: manual.id, purpose: 'account_claim' } }), 0);
    cases.push('manual review has no early account/trial→real admin approval→same proof resumes passwordless→no legacy claim email');
    return cases;
  } finally {
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(config, key, descriptor); else delete (config as any)[key]; }
    await customer.close();
    for (const recipient of recipients) {
    const row = await db.companySignupRequest.findFirst({ where: { source: 'email-otp', contactEmail: recipient } });
    await db.emailAccessChallenge.deleteMany({ where: { email: recipient } });
    await db.emailSendAttempt.deleteMany({ where: { recipient } });
    if (row) {
      await db.outboxEvent.deleteMany({ where: { aggregateId: row.id } });
      await db.companySignupRequest.delete({ where: { id: row.id } });
      if (row.companyId) { await db.companyOnboardingRun.deleteMany({ where: { companyId: row.companyId } }); await db.company.delete({ where: { id: row.companyId } }); }
      if (row.ownerUserId) await db.user.delete({ where: { id: row.ownerUserId } });
    }
    }
  }
}
