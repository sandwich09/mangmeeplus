import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, describe, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../common/database/prisma.service';
import type { AppConfigService } from '../../../common/config/app-config.service';
import { AccountEmailOtpService } from './account-email-otp.service';
import { emailUserInclude } from './account-email-state';
import { emailSecurityBinding } from '../domain/logic/email-otp.logic';
import { hashPassword } from '../domain/logic/password-credential.logic';
import { EmailAccessService } from './email-access.service';
import { EmailDeliveryService } from './email-delivery.service';
import { IssueTokenUseCase } from './use-cases/issue-token.use-case';
import { LegalAcceptanceService } from './legal-acceptance.service';
import type { PlatformAccessService } from './platform-access.service';
import { PostmarkSendError, type PostmarkClient } from '../infrastructure/postmark.client';
const url = process.env.EMAIL_ACCESS_TEST_DATABASE_URL;
const config = { databaseUrl: url, appEnv: 'local', emailProvider: 'postmark', postmarkServerId: 111111,
  postmarkMessageStream: 'outbound', postmarkFromName: 'Test', postmarkFromAddress: 'test@example.test',
  authJwtSecret: randomBytes(32).toString('hex'), emailOtpHmacKey: 'ab'.repeat(32), emailOtpHmacKeyVersion: 'test',
  postmarkUatAllowedRecipients: [] } as unknown as AppConfigService;
const rejected = (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 401;
describe('email access transaction integration', { skip: !url }, () => {
  let prisma: PrismaService;
  before(async () => { const parsed = new URL(url!); assert.ok(parsed.hostname === '127.0.0.1' && ['/email_access_test', '/email_otp_test'].includes(parsed.pathname));
    prisma = new PrismaService(config); await prisma.onModuleInit(); });
  after(async () => { await prisma?.onModuleDestroy(); });
  async function fixture(existing = true, enabled = true) {
    const id = randomUUID(), email = `${id}@example.test`, mail: string[] = [];
    const company = await prisma.client.company.create({ data: { name: 'Email test' } });
    const user = existing ? await prisma.client.user.create({ data: { id, displayName: 'Email test', email,
      emailVerifiedAt: new Date(), emailLoginEnabledAt: enabled ? new Date() : null } }) : null;
    if (user) await prisma.client.companyMembership.create({ data: { companyId: company.id, userId: user.id } });
    const delivery = new EmailDeliveryService(prisma, config, { send: async (message: { TextBody: string }, authorize?: () => Promise<void>) => {
      await authorize?.(); mail.push(message.TextBody); return { messageId: randomUUID(), submittedAt: new Date() };
    } } as unknown as PostmarkClient);
    const service = new EmailAccessService(prisma, config, delivery, new IssueTokenUseCase(new JwtService(), prisma, config),
      new LegalAcceptanceService(prisma, undefined as any), { getStatus: async () => ({ effectiveState: 'OPEN' }) } as unknown as PlatformAccessService);
    const input = { email, browserSecret: randomBytes(32).toString('base64url'), requestKey: randomUUID(), requestId: randomUUID() };
    const issued = await service.request(input), code = mail.at(-1)!.match(/\b\d{6}\b/)![0]!;
    const proof = { challengeId: issued.challengeId, browserSecret: input.browserSecret, requestId: input.requestId, code };
    return { service, delivery, input, issued, proof, user, company, mail };
  }
  test('mailbox proof creates a signup-only capability, never a user/session', async () => {
    const f = await fixture(false);
    assert.equal((await f.service.confirm(f.proof)).kind, 'SIGNUP');
    assert.equal(await prisma.client.user.count({ where: { email: f.input.email } }), 0);
    await assert.rejects(f.service.confirm(f.proof), rejected);
    await assert.rejects(prisma.client.$transaction(tx => f.service.requireSignupProof(tx, { ...f.proof, browserSecret: randomBytes(32).toString('base64url') })), rejected);
  });
  test('returning opt-in user consumes once and creates a fresh session under the same transaction', async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([f.service.confirm(f.proof), f.service.confirm(f.proof)]);
    assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
    assert.equal(await prisma.client.authSession.count({ where: { userId: f.user!.id } }), 1);
    assert.equal((await prisma.client.emailAccessChallenge.findUniqueOrThrow({ where: { id: f.issued.challengeId } })).status, 'USED');
    const session = await prisma.client.authSession.findFirstOrThrow({ where: { userId: f.user!.id } });
    assert.ok(session.emailReauthenticatedAt && session.emailReauthBindingHash);
  });
  test('verified legacy email does not silently enable passwordless', async () => {
    const f = await fixture(true, false);
    assert.equal((await f.service.confirm(f.proof)).kind, 'EXISTING_LOGIN_REQUIRED');
    assert.equal(await prisma.client.authSession.count({ where: { userId: f.user!.id } }), 0);
  });
  test('incorrect attempts commit, fifth attempt revokes, even the right code cannot revive it', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) await assert.rejects(f.service.confirm({ ...f.proof, code: f.proof.code === '000000' ? '000001' : '000000' }), (e: any) => [400, 401].includes(e.getStatus()));
    const token = await prisma.client.emailAccessChallenge.findUniqueOrThrow({ where: { id: f.issued.challengeId } });
    assert.equal(token.failedAttempts, 5); assert.equal(token.status, 'REVOKED');
    await assert.rejects(f.service.confirm(f.proof), rejected);
  });
  test('changed email/security, disabled membership and expired code grant no session', async () => {
    for (const change of ['email', 'member', 'expiry']) {
      const f = await fixture();
      if (change === 'email') await prisma.client.user.update({ where: { id: f.user!.id }, data: { emailRevision: { increment: 1 } } });
      if (change === 'member') await prisma.client.companyMembership.updateMany({ where: { userId: f.user!.id }, data: { status: 'DISABLED' } });
      if (change === 'expiry') await prisma.client.emailAccessChallenge.update({ where: { id: f.issued.challengeId }, data: { expiresAt: new Date(0) } });
      const result = await f.service.confirm(f.proof).catch(e => e);
      assert.notEqual(result.kind, 'LOGIN');
      assert.equal(await prisma.client.authSession.count({ where: { userId: f.user!.id } }), 0);
    }
  });
  test('original request replay sends once and recipient cooldown persists across browser keys', async () => {
    const f = await fixture();
    assert.equal((await f.service.request(f.input)).challengeId, f.issued.challengeId); assert.equal(f.mail.length, 1);
    await assert.rejects(f.service.request({ ...f.input, requestKey: randomUUID() }), (e: any) => e.getStatus() === 429);
  });
  test('audit failure rolls back code consumption AND session creation', async () => {
    const f = await fixture();
    const audit = (f.service as any).audit;
    (f.service as any).audit = async (...args: any[]) => { if (args[1] === 'auth.email_access.login') throw new Error('synthetic audit failure'); return audit.apply(f.service, args); };
    await assert.rejects(f.service.confirm(f.proof), /synthetic audit/);
    assert.equal(await prisma.client.authSession.count({ where: { userId: f.user!.id } }), 0);
    assert.equal((await prisma.client.emailAccessChallenge.findUniqueOrThrow({ where: { id: f.issued.challengeId } })).status, 'PENDING');
    (f.service as any).audit = audit;
    assert.equal((await f.service.confirm(f.proof)).kind, 'LOGIN');
  });
  test('existing account must explicitly opt in with fresh proof; old challenge is revoked', async () => {
    const f = await fixture(true, false), password = 'Synthetic-opt-in-123!';
    await prisma.client.userCredential.create({ data: { userId: f.user!.id, passwordHash: hashPassword(password) } });
    const session = await prisma.client.authSession.create({ data: { userId: f.user!.id, tokenId: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    const account = new AccountEmailOtpService(prisma, config, f.delivery), caller = { userId: f.user!.id, tokenId: session.tokenId, requestId: randomUUID(), enabled: true };
    await assert.rejects(account.setEmailLogin({ ...caller, currentPassword: 'wrong' }), (e: any) => e.getStatus() === 403);
    assert.equal((await account.setEmailLogin({ ...caller, currentPassword: password })).emailLoginEnabled, true);
    await assert.rejects(f.service.confirm(f.proof), rejected);
    await prisma.client.emailAccessChallenge.update({ where: { id: f.issued.challengeId }, data: { createdAt: new Date(Date.now() - 61_000) } });
    const next = await f.service.request({ ...f.input, requestKey: randomUUID() });
    const code = f.mail.at(-1)!.match(/\b\d{6}\b/)![0]!;
    assert.equal((await f.service.confirm({ ...f.proof, challengeId: next.challengeId, code })).kind, 'LOGIN');
  });
  test('email-only owner cannot switch off the last usable login method', async () => {
    const f = await fixture();
    await f.service.confirm(f.proof);
    const session = await prisma.client.authSession.findFirstOrThrow({ where: { userId: f.user!.id } });
    const account = new AccountEmailOtpService(prisma, config, f.delivery);
    await assert.rejects(account.setEmailLogin({ userId: f.user!.id, tokenId: session.tokenId, requestId: randomUUID(), enabled: false }),
      (e: any) => e.getResponse().code === 'LAST_LOGIN_REQUIRED');
    assert.ok((await prisma.client.user.findUniqueOrThrow({ where: { id: f.user!.id } })).emailLoginEnabledAt);
  });
  test('unverified account contact cannot authorize a session and gets the existing-login recovery path', async () => {
    const f = await fixture(true, false);
    await prisma.client.user.update({ where: { id: f.user!.id }, data: { emailVerifiedAt: null } });
    await prisma.client.emailAccessChallenge.update({ where: { id: f.issued.challengeId }, data: { createdAt: new Date(Date.now() - 61_000) } });
    const next = await f.service.request({ ...f.input, requestKey: randomUUID() });
    const code = f.mail.at(-1)!.match(/\b\d{6}\b/)![0]!;
    assert.equal((await f.service.confirm({ ...f.proof, challengeId: next.challengeId, code })).kind, 'EXISTING_LOGIN_REQUIRED');
    assert.equal(await prisma.client.authSession.count({ where: { userId: f.user!.id } }), 0);
    assert.equal((await prisma.client.user.findUniqueOrThrow({ where: { id: f.user!.id } })).emailVerifiedAt, null);
  });

  test('post-proof security changes cannot resume an unfinished signup', async () => {
    const f = await fixture(false);
    await f.service.confirm(f.proof);
    const user = await prisma.client.user.create({ data: { email: f.input.email, emailVerifiedAt: new Date(), emailLoginEnabledAt: new Date(), displayName: 'Bound owner' }, include: emailUserInclude });
    await prisma.client.emailAccessChallenge.update({ where: { id: f.proof.challengeId }, data: { userId: user.id, securityBindingHash: emailSecurityBinding(user) } });
    await prisma.client.$transaction(tx => f.service.requireSignupProof(tx, f.proof));
    await prisma.client.user.update({ where: { id: user.id }, data: { emailRevision: { increment: 1 } } });
    await assert.rejects(prisma.client.$transaction(tx => f.service.requireSignupProof(tx, f.proof)), rejected);
  });
  test('resend revokes even verified signup proof; previous browser cannot consume the new code', async () => {
    const f = await fixture(false); await f.service.confirm(f.proof);
    await prisma.client.emailAccessChallenge.update({ where: { id: f.proof.challengeId }, data: { createdAt: new Date(Date.now() - 61_000) } });
    const browserSecret = randomBytes(32).toString('base64url');
    const next = await f.service.request({ ...f.input, browserSecret, requestKey: randomUUID() });
    await assert.rejects(prisma.client.$transaction(tx => f.service.requireSignupProof(tx, f.proof)), rejected);
    const code = f.mail.at(-1)!.match(/\b\d{6}\b/)![0]!;
    await assert.rejects(f.service.confirm({ ...f.proof, challengeId: next.challengeId, code }), rejected);
    assert.equal((await f.service.confirm({ ...f.proof, browserSecret, challengeId: next.challengeId, code })).kind, 'SIGNUP');
  });
  test('provider uncertain/config/permanent results never claim sent and replay never sends twice', async () => {
    for (const kind of ['UNKNOWN', 'CONFIG', 'PERMANENT'] as const) {
      const f = await fixture(false); let calls = 0;
      await prisma.client.emailAccessChallenge.update({ where: { id: f.proof.challengeId }, data: { createdAt: new Date(Date.now() - 61_000) } });
      (f.delivery as any).postmark.send = async () => { calls++; throw new PostmarkSendError(kind, 'synthetic'); };
      const input = { ...f.input, requestKey: randomUUID() };
      const result = await f.service.request(input);
      assert.equal(result.deliveryStatus, kind);
      assert.equal((await f.service.request(input)).challengeId, result.challengeId);
      assert.equal(calls, 1);
    }
  });
  test('suppressed recipients get a controlled unavailable response without issuing proof', async () => {
    const f = await fixture(false);
    await prisma.client.emailAccessChallenge.update({ where: { id: f.proof.challengeId }, data: { createdAt: new Date(Date.now() - 61_000) } });
    const prepare = f.delivery.prepare.bind(f.delivery);
    f.delivery.prepare = async () => { throw new PostmarkSendError('SUPPRESSED', 'inactive_recipient'); };
    await assert.rejects(f.service.request({ ...f.input, requestKey: randomUUID() }), (e: any) => e.getStatus() === 503);
    assert.equal(await prisma.client.emailAccessChallenge.count({ where: { email: f.input.email } }), 1);
    f.delivery.prepare = prepare;
  });
  test('hourly and daily recipient budgets apply after cooldown', async () => {
    for (const daily of [false, true]) {
      const f = await fixture(false), now = Date.now();
      const row = await prisma.client.emailAccessChallenge.findUniqueOrThrow({ where: { id: f.proof.challengeId } });
      await prisma.client.emailAccessChallenge.update({ where: { id: row.id }, data: { createdAt: new Date(now - (daily ? 7_200_000 : 61_000)) } });
      await prisma.client.emailAccessChallenge.createMany({ data: Array.from({ length: daily ? 9 : 4 }, (_, i) => ({ ...row, id: randomUUID(), requestKey: randomUUID(), createdAt: new Date(now - (daily ? 7_200_000 : 61_000) - i * 1000) })) });
      await assert.rejects(f.service.request({ ...f.input, requestKey: randomUUID() }), (e: any) => e.getStatus() === 429 && e.getResponse().retryAfterSeconds > 60);
    }
  });
  test('protected accounts and closed platform never create passwordless sessions', async () => {
    for (const protectedAccount of [true, false]) {
      const f = await fixture();
      if (protectedAccount) await prisma.client.user.update({ where: { id: f.user!.id }, data: { isSystemProtected: true } });
      else (f.service as any).platform.getStatus = async () => ({ effectiveState: 'CLOSED' });
      const result = await f.service.confirm(f.proof).catch(e => e);
      assert.notEqual(result.kind, 'LOGIN');
      assert.equal(await prisma.client.authSession.count({ where: { userId: f.user!.id } }), 0);
    }
  });

});
