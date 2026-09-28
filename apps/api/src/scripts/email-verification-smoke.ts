import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import type { PrismaService } from '../common/database/prisma.service';
import { AppConfigService } from '../common/config/app-config.service';
import { StripeClient } from '../modules/billing/infrastructure/stripe.client';
import { BillingReconcilerService } from '../modules/billing/application/billing-reconciler.service';
import { AccountEmailOtpService } from '../modules/auth/application/account-email-otp.service';
import { hashPassword } from '../modules/auth/domain/logic/password-credential.logic';
import type { startBillingBrowser } from './billing-browser-smoke';

/** Real authenticated HTTP, PostgreSQL and Next browser. Only external mail/LINE transports are simulated. */
export async function checkEmailVerification(input: { app: INestApplication; prisma: PrismaService; userId: string; membershipId: string;
  request: (path: string, method?: string, body?: unknown, extra?: Record<string, string>) => Promise<{ status: number; body: any }>;
  browser: Awaited<ReturnType<typeof startBillingBrowser>>;
  transport: (hook?: (url: URL, init?: RequestInit) => Response | undefined) => void }) {
  const { app, prisma, browser, request } = input, db = prisma.client, tag = randomUUID().replaceAll('-', ''), mail: any[] = [];
  const user = await db.user.findUniqueOrThrow({ where: { id: input.userId } });
  const member = await db.companyMembership.findUniqueOrThrow({ where: { id: input.membershipId }, include: { roles: true } });
  const term = await db.companyPlanTerm.findUniqueOrThrow({ where: { companyId: member.companyId } }), roleId = member.roles[0]!.roleId;
  const company = await db.company.findUniqueOrThrow({ where: { id: member.companyId } });
  const password = 'Synthetic-OTP-password-123!'.repeat(12), addedPermissions: string[] = [];
  const service = app.get(AccountEmailOtpService), confirm = service.confirm.bind(service), page = browser.page, urls: string[] = [];
  const base = '/v1/auth/account/email/otp';
  const billingBase = `/v1/companies/${member.companyId}/billing`;
  const stripe = app.get(StripeClient);
  let recipientAccountId: string | undefined;
  const customer = { id: `cus_otp_${tag}`, object: 'customer', livemode: stripe.livemode, email: 'previous-recipient@example.test', metadata: { billingAccountId: '' } };
  let recipientWrites = 0;
  const config = app.get(AppConfigService);
  const linked = await db.externalIdentity.findFirstOrThrow({ where: { userId: user.id, provider: 'LINE', status: 'ACTIVE' } });
  const configKeys = ['lineLoginChannelId', 'lineLoginChannelSecret', 'lineMessagingChannelId', 'webBaseUrl'] as const;
  const previousConfig = new Map(configKeys.map(key => [key, Object.getOwnPropertyDescriptor(config, key)]));
  const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const lastCode = () => { const code = String(mail.at(-1)?.TextBody).match(/\b\d{6}\b/)?.[0]; assert.ok(code); return code; };
  page.on('request', r => urls.push(r.url()));
  try {
    await db.companyPlanTerm.update({ where: { companyId: member.companyId }, data: { termEndsAt: new Date(Date.now() + 86400000) } });
    await db.user.update({ where: { id: user.id }, data: { email: null, emailVerifiedAt: null } });
    await db.userCredential.create({ data: { userId: user.id, passwordHash: hashPassword(password) } });
    for (const key of ['company.setup.read', 'account.password.change']) {
      const permission = await db.permission.upsert({ where: { key }, update: {}, create: { key, description: key } });
      if (!await db.rolePermission.findUnique({ where: { roleId_permissionId: { roleId, permissionId: permission.id } } })) {
        await db.rolePermission.create({ data: { roleId, permissionId: permission.id } }); addedPermissions.push(permission.id);
      }
    }
    input.transport((url, init) => {
      if (url.origin === 'https://api.stripe.com' && url.pathname === `/v1/customers/${customer.id}`) {
        if (init?.method === 'POST') { recipientWrites++; customer.email = new URLSearchParams(String(init.body)).get('email')!; }
        return response(customer);
      }
      if (url.origin === 'https://api.line.me') {
        if (url.pathname.endsWith('/token')) return response({ id_token: 'aaa.bbb.ccc' });
        if (url.pathname.endsWith('/verify')) return response({ sub: linked.providerUserId, aud: '2000000001', exp: Math.floor(Date.now() / 1000) + 3600, auth_time: Math.floor(Date.now() / 1000) });
        return response({});
      }
      if (url.origin !== 'https://api.postmarkapp.com') return;
      assert.equal(url.pathname, '/email'); const body = JSON.parse(String(init?.body));
      assert.equal(body.TrackOpens, false); assert.equal(body.TrackLinks, 'None');
      if (body.Tag === 'email_verification') { assert.match(body.To, new RegExp(`^verify-${tag}-`)); mail.push(body); }
      return response({ ErrorCode: 0, MessageID: randomUUID(), SubmittedAt: new Date().toISOString() });
    });
    for (const [path, body] of [['/v1/auth/account/email', { newEmail: 'old@example.test' }],
      ['/v1/auth/account/email/resend', {}], ['/v1/auth/account/email/verify', { token: 'old-proof' }],
      ['/v1/auth/me/email/unverified', { newEmail: 'old@example.test', expectedEmail: null }]] as const) {
      const result = await request(path, 'POST', body); assert.equal(result.status, 409); assert.equal(result.body.code, 'EMAIL_OTP_REQUIRED');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${browser.origin}/companies/${member.companyId}/settings/profile#account`, { waitUntil: 'domcontentloaded' });
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: /^(อีเมลบัญชีของฉัน|ยืนยันอีเมลก่อนชำระเงิน)$/ }) }).last();
    await panel.getByLabel('อีเมลที่ต้องการยืนยัน', { exact: true }).fill(`verify-${tag}-first@example.test`);
    await panel.getByLabel(/^รหัสผ่านปัจจุบัน/).fill(password);
    const sent = page.waitForResponse(r => r.url().endsWith('/auth/account/email/otp/request') && r.request().method() === 'POST');
    await panel.getByRole('button', { name: 'ขอรหัสยืนยัน', exact: true }).click(); assert.equal((await sent).status(), 202);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).email, null);
    const pending = (await request(base)).body; assert.equal(pending.emailRequirement, 'CHANGE_PENDING');
    // R-A6: an unverified account email no longer blocks a quote; Checkout will ask for the address.
    const quote = await request(`/v1/companies/${member.companyId}/billing/quote`, 'POST', { offerKey: 'PRO_999', interval: 'year', billingEmail: 'forged@example.test' });
    assert.equal(quote.status, 200, JSON.stringify(quote.body)); assert.equal(quote.body.billingEmail, null);
    await panel.getByLabel('รหัสยืนยัน 6 หลัก', { exact: true }).fill('000012');
    assert.equal(await panel.getByLabel('รหัสยืนยัน 6 หลัก', { exact: true }).inputValue(), '000012');
    await page.reload(); await panel.getByLabel('รหัสยืนยัน 6 หลัก', { exact: true }).waitFor();
    await panel.getByLabel('รหัสยืนยัน 6 หลัก', { exact: true }).fill(lastCode());
    const verified = page.waitForResponse(r => r.url().includes('/auth/account/email/otp/') && r.url().endsWith('/confirm'));
    await panel.getByRole('button', { name: 'ยืนยันอีเมล', exact: true }).click(); assert.equal((await verified).status(), 200);
    await panel.getByRole('status').getByText('ยืนยันอีเมลเรียบร้อยแล้ว', { exact: true }).waitFor();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), `OTP panel fits ${width}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await panel.screenshot({ path: `${browser.evidenceDir}/email-otp-verified-mobile.png` });
    assert.ok(!urls.some(url => url.includes(lastCode())), 'OTP never enters a request URL');
    // Exercise the purpose-bound BFF/callback through the actual browser; LINE endpoints are simulated.
    for (const [key, value] of Object.entries({ lineLoginChannelId: '2000000001', lineLoginChannelSecret: 'synthetic-line-secret',
      lineMessagingChannelId: linked.providerChannelId, webBaseUrl: browser.origin })) Object.defineProperty(config, key, { value, configurable: true });
    await db.authSession.updateMany({ where: { userId: user.id }, data: { emailReauthenticatedAt: null, emailReauthBindingHash: null } });
    const sessionCount = await db.authSession.count({ where: { userId: user.id } });
    // Prove payment recovery after the expiry sweep, including fresh LINE identity proof.
    await db.companyPlanTerm.update({ where: { companyId: member.companyId }, data: { termEndsAt: new Date(0), termDisabledAt: new Date() } });
    await db.company.update({ where: { id: member.companyId }, data: { status: 'DISABLED' } });
    await page.goto(`${browser.origin}/companies/${member.companyId}/billing?interval=year`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'แพ็กเกจและการชำระเงิน', exact: true }).waitFor();
    await page.goto(`${browser.origin}/account/email?company=${member.companyId}&interval=year`, { waitUntil: 'domcontentloaded' });
    await panel.getByText(`verify-${tag}-first@example.test`, { exact: true }).waitFor();
    await page.route(url => url.origin === browser.origin && url.pathname === '/api/auth/line-login/start', async route => {
      // Playwright does not reroute subsequent URLs in an HTTP redirect chain. Read the
      // real BFF's 302 without following it, preserve its cookie, then simulate LINE's callback.
      const started = await route.fetch({ maxRedirects: 0 });
      assert.equal(started.status(), 302);
      const url = new URL(started.headers().location!); assert.equal(url.searchParams.get('prompt'), 'login'); assert.equal(url.searchParams.get('max_age'), '0');
      const callback = new URL('/api/auth/line-login/callback', browser.origin);
      callback.searchParams.set('state', url.searchParams.get('state')!); callback.searchParams.set('code', 'synthetic-auth-code');
      await route.fulfill({ response: started, headers: { ...started.headers(), location: callback.toString() } });
    });
    await panel.getByRole('button', { name: 'เปลี่ยนอีเมล', exact: true }).click();
    await panel.getByRole('button', { name: 'ยืนยันตัวตนผ่าน LINE', exact: true }).click();
    await page.getByText('ยืนยันตัวตนผ่าน LINE แล้ว กรอกอีเมลและขอรหัสได้ภายใน 5 นาที', { exact: true }).waitFor();
    assert.equal(await db.authSession.count({ where: { userId: user.id } }), sessionCount, 'reauth must not mint a new login');
    assert.ok(await db.authSession.findFirst({ where: { userId: user.id, emailReauthenticatedAt: { not: null } } }));
    const current = (await request(base)).body;
    const command = { newEmail: `verify-${tag}-second@example.test`, expectedEmailRevision: current.emailRevision, requestKey: randomUUID() };
    await db.emailVerificationToken.update({ where: { id: pending.challenge.id }, data: { createdAt: new Date(Date.now() - 61000) } });
    const next = await request(`${base}/request`, 'POST', command); assert.equal(next.status, 202);
    assert.equal((await request(`${base}/request`, 'POST', command)).body.challenge.id, next.body.challenge.id); assert.equal(mail.length, 2);
    service.confirm = async args => { await confirm(args); throw new ServiceUnavailableException('Synthetic lost response after commit'); };
    assert.equal((await request(`${base}/${next.body.challenge.id}/confirm`, 'POST', { code: lastCode() })).status, 503);
    service.confirm = confirm;
    assert.equal((await request(`${base}/${next.body.challenge.id}/confirm`, 'POST', { code: lastCode() })).status, 200);
    assert.equal((await request(base)).body.email, command.newEmail);
    const publicVerify = await fetch(new URL(`${base}/${next.body.challenge.id}/confirm`, new URL(await app.getUrl())), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: lastCode() }) });
    assert.equal(publicVerify.status, 401);
    const account = await db.billingAccount.create({ data: { companyId: member.companyId, stripeAccountId: stripe.accountId, livemode: stripe.livemode, customerId: customer.id } });
    recipientAccountId = account.id; customer.metadata.billingAccountId = account.id;
    const invalidPreview = await request(`${billingBase}/recipient/preview`, 'POST', { email: 'injected@example.test' });
    assert.equal(invalidPreview.status, 400);
    const preview = await request(`${billingBase}/recipient/preview`, 'POST', {}); assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.newEmail, command.newEmail); assert.equal(recipientWrites, 0);
    const submitted = await request(`${billingBase}/recipient/${preview.body.id}/submit`, 'POST', {
      expectedVersion: preview.body.version, previewHash: preview.body.previewHash, accepted: true,
    }, { 'idempotency-key': `recipient-${tag}` });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
    await app.get(BillingReconcilerService).reconcileAccount(account.id);
    const observed = await request(`${billingBase}/recipient`); assert.equal(observed.body.email, command.newEmail); assert.equal(observed.body.busy, false);
    assert.equal(recipientWrites, 1);
    // R-A8: the column follows Stripe and the change queues the old-recipient notice.
    const changed = await db.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(changed.recipientEmail, command.newEmail); assert.equal(changed.recipientSource, 'ACCOUNT_EMAIL');
    assert.ok(await db.outboxEvent.findUnique({ where: { eventKey: `billing:recipient-changed:${preview.body.id}` } }));
    assert.deepEqual(observed.body.stored, { email: command.newEmail, source: 'ACCOUNT_EMAIL', bouncedAt: null, canChange: true });
    // A code sent to a mailbox that is not the account email changes it again, on the locked company.
    const recipientEmail = `verify-${tag}-recipient@example.test`;
    const challenge = await request(`${billingBase}/recipient/otp/request`, 'POST', { email: recipientEmail, requestKey: randomUUID() });
    assert.equal(challenge.status, 202, JSON.stringify(challenge.body)); assert.equal(challenge.body.email, recipientEmail);
    const proof = await request(`${billingBase}/recipient/otp/confirm`, 'POST', { challengeId: challenge.body.challengeId, code: lastCode() });
    assert.equal(proof.status, 200, JSON.stringify(proof.body));
    const otpPreview = await request(`${billingBase}/recipient/preview`, 'POST', { recipientProofId: proof.body.recipientProofId });
    assert.equal(otpPreview.status, 200, JSON.stringify(otpPreview.body)); assert.equal(otpPreview.body.source, 'CUSTOMER_OTP');
    const otpSubmitted = await request(`${billingBase}/recipient/${otpPreview.body.id}/submit`, 'POST', {
      expectedVersion: otpPreview.body.version, previewHash: otpPreview.body.previewHash, accepted: true,
    }, { 'idempotency-key': `recipient-otp-${tag}` });
    assert.equal(otpSubmitted.status, 200, JSON.stringify(otpSubmitted.body));
    await app.get(BillingReconcilerService).reconcileAccount(account.id);
    assert.equal(recipientWrites, 2); assert.equal(customer.email, recipientEmail);
    const otpChanged = await db.billingAccount.findUniqueOrThrow({ where: { id: account.id } });
    assert.equal(otpChanged.recipientEmail, recipientEmail); assert.equal(otpChanged.recipientSource, 'CUSTOMER_OTP');
    await page.goto(`${browser.origin}/verify-email#token=retired-synthetic-proof`);
    await page.getByRole('heading', { name: 'ยืนยันอีเมลด้วยรหัส OTP' }).waitFor();
    await page.waitForURL(url => !url.hash && !url.searchParams.has('token'));
    assert.equal(await page.getByRole('link', { name: 'เข้าสู่ระบบเพื่อขอรหัส OTP' }).getAttribute('href'), '/login');
    assert.equal(await page.getByRole('main').getByRole('button').count(), 0, 'legacy page must not offer a retired verification mutation');
    return ['expired-company-OTP-LINE-reauth-recipient-payment-recovery', 'legacy-link-browser-OTP-recovery-and-token-removal', 'optional-email-authenticated-OTP-real-HTTP-PG-browser-existing-long-password', 'retired-link-and-direct-email-writers-refuse',
      'OTP-leading-zero-reload-explicit-confirm-no-URL-secret', 'unverified-account-email-quote-open',
      'OTP-idempotent-request-and-confirm-after-lost-response', 'company-recipient-review-submit-reconcile-real-HTTP', 'company-recipient-OTP-to-new-mailbox-on-locked-company', 'LINE-reauth-BFF-browser-same-session-no-password-email-request', 'OTP-panel-320-390-768-1280'];
  } catch (error) {
    await page.screenshot({ path: `${browser.evidenceDir}/email-otp-failure.png`, fullPage: true }); throw error;
  } finally {
    service.confirm = confirm; input.transport(undefined);
    for (const key of configKeys) { const descriptor = previousConfig.get(key); if (descriptor) Object.defineProperty(config, key, descriptor); else Reflect.deleteProperty(config, key); }
    await db.billingOperation.deleteMany({ where: { companyId: member.companyId, type: 'UPDATE_BILLING_EMAIL' } });
    await db.emailSendAttempt.deleteMany({ where: { intentKey: { startsWith: 'billing-recipient-notice:' }, recipient: 'previous-recipient@example.test' } });
    if (recipientAccountId) await db.billingAccount.delete({ where: { id: recipientAccountId } });
    await db.outboxEvent.deleteMany({ where: { aggregateType: 'User', aggregateId: user.id, eventType: 'auth.email.security_notice' } });
    await db.emailVerificationToken.deleteMany({ where: { userId: user.id } });
    await db.userCredential.deleteMany({ where: { userId: user.id } });
    await db.user.update({ where: { id: user.id }, data: { email: user.email, emailVerifiedAt: user.emailVerifiedAt, emailRevision: user.emailRevision } });
    await db.companyPlanTerm.update({ where: { companyId: member.companyId }, data: { termEndsAt: term.termEndsAt, termDisabledAt: term.termDisabledAt } });
    await db.company.update({ where: { id: member.companyId }, data: { status: company.status } });
    await db.rolePermission.deleteMany({ where: { roleId, permissionId: { in: addedPermissions } } });
    await db.emailSendAttempt.deleteMany({ where: { OR: [{ recipient: { startsWith: `verify-${tag}-` } }, { intentKey: { startsWith: 'email-security:' }, recipient: user.email ?? '' }] } });
  }
}
