import 'reflect-metadata';
import { before, after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/database/prisma.service';
import type { AppConfigService } from '../../../common/config/app-config.service';
import type { PostmarkClient } from '../infrastructure/postmark.client';
import { PostmarkSendError } from '../infrastructure/postmark.client';
import { hashPassword } from '../domain/logic/password-credential.logic';
import { AccountEmailOtpService } from './account-email-otp.service';
import { EmailDeliveryService } from './email-delivery.service';
import { assertAccountEmailProof, verifiedAccountEmailProof } from './account-email-state';
import { AccountEmailReauthService } from './account-email-reauth.service';
import { AccountProfileUseCase } from './use-cases/account-profile.use-case';
import { lineMessagingCredentialsFixture } from '../../../common/config/line-messaging-credentials.fixture';
import { ChangePasswordUseCase } from './use-cases/change-password.use-case';

const url = process.env.EMAIL_OTP_TEST_DATABASE_URL;
const password = 'Local-email-test-123!';
const config = { databaseUrl: url, appEnv: 'local', emailProvider: 'postmark', postmarkServerId: 1234567,
  postmarkMessageStream: 'outbound', postmarkFromName: 'Test', postmarkFromAddress: 'test@example.test',
  emailOtpHmacKey: 'ab'.repeat(32), emailOtpHmacKeyVersion: 'test-v1', postmarkUatAllowedRecipients: [] } as unknown as AppConfigService;
const codeOf = (error: unknown) => (error as { getResponse?: () => { code?: string } }).getResponse?.().code;
describe('account email OTP real PostgreSQL', { skip: !url }, () => {
  let prisma: PrismaService;
  before(async () => {
    const parsed = new URL(url!);
    assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname) && parsed.pathname === '/email_otp_test', 'Dedicated local test database required');
    prisma = new PrismaService(config); await prisma.onModuleInit();
  });
  after(async () => { await prisma?.onModuleDestroy(); });
  async function fixture(verified = true) {
    const id = randomUUID(), tokenId = randomUUID(), oldEmail = `${id}@old.example.test`;
    const user = await prisma.client.user.create({ data: { id, displayName: 'OTP integration', email: oldEmail,
      emailVerifiedAt: verified ? new Date() : null, credential: { create: { passwordHash: hashPassword(password) } } } });
    const session = await prisma.client.authSession.create({ data: { userId: id, tokenId, expiresAt: new Date(Date.now() + 3_600_000) } });
    const messages: Array<{ To: string; TextBody: string }> = [];
    let sendError = false, failPrepare = false;
    let dispatchHook: (() => Promise<void>) | undefined;
    const postmark = { send: async (message: { To: string; TextBody: string }, beforeDispatch?: () => Promise<void>) => {
      await dispatchHook?.();
      await beforeDispatch?.();
      messages.push(message); if (sendError) throw new PostmarkSendError('UNKNOWN', 'transport_unconfirmed');
      return { messageId: randomUUID(), submittedAt: new Date() };
    } } as unknown as PostmarkClient;
    const delivery = new EmailDeliveryService(prisma, config, postmark);
    const prepare = delivery.prepare.bind(delivery);
    delivery.prepare = async (...args) => { if (failPrepare) throw new Error('local prepare failure'); return prepare(...args); };
    const service = new AccountEmailOtpService(prisma, config, delivery);
    const caller = { userId: id, tokenId, requestId: randomUUID() };
    const input = { ...caller, newEmail: `${id}@new.example.test`, requestKey: randomUUID(), expectedEmailRevision: 0, currentPassword: password };
    const latestCode = () => { const code = messages.at(-1)?.TextBody.match(/\b\d{6}\b/)?.[0]; assert.ok(code); return code; };
    return { user, session, service, caller, input, messages, latestCode, delivery,
      beforeDispatch: (hook: () => Promise<void>) => { dispatchHook = hook; },
      failSend: () => { sendError = true; }, failPrepare: () => { failPrepare = true; } };
  }
  test('cancellation during native preflight prevents OTP mail dispatch without resetting the old email', async () => {
    const f = await fixture();
    f.beforeDispatch(async () => {
      const status = await f.service.status(f.caller.userId);
      await f.service.cancel({ ...f.caller, challengeId: status.challenge!.id });
    });
    await f.service.request(f.input);
    assert.equal(f.messages.length, 0);
    const state = await f.service.status(f.caller.userId);
    assert.equal(state.email, f.user.email); assert.equal(state.emailRequirement, 'READY');
  });
  test('request/confirm preserves old email, admits only current proof, revokes other sessions and durably queues notices', async () => {
    const f = await fixture();
    const oldProof = await verifiedAccountEmailProof(prisma.client, f.user.id);
    const other = await prisma.client.authSession.create({ data: { userId: f.user.id, tokenId: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    const pending = await f.service.request(f.input);
    assert.equal(pending.email, f.user.email); assert.equal(pending.emailRequirement, 'CHANGE_PENDING');
    await assert.rejects(verifiedAccountEmailProof(prisma.client, f.user.id), e => codeOf(e) === 'BILLING_EMAIL_VERIFICATION_REQUIRED');
    const token = await prisma.client.emailVerificationToken.findUniqueOrThrow({ where: { id: pending.challenge!.id } });
    assert.equal(token.tokenHash.length, 64); assert.notEqual(token.tokenHash, f.latestCode());
    const confirmed = await f.service.confirm({ ...f.caller, challengeId: token.id, code: f.latestCode() });
    assert.equal(confirmed.email, f.input.newEmail); assert.equal(confirmed.emailRequirement, 'READY');
    assert.equal((await prisma.client.authSession.findUniqueOrThrow({ where: { id: other.id } })).status, 'REVOKED');
    assert.equal((await prisma.client.authSession.findUniqueOrThrow({ where: { id: f.session.id } })).status, 'ACTIVE');
    const outbox = await prisma.client.outboxEvent.findMany({ where: { aggregateId: f.user.id } });
    assert.equal(outbox.length, 1); assert.ok(!JSON.stringify(outbox).includes(f.latestCode()));
    await assert.rejects(assertAccountEmailProof(prisma.client, f.user.id, oldProof), e => codeOf(e) === 'BILLING_EMAIL_CHANGED');
    await assertAccountEmailProof(prisma.client, f.user.id, await verifiedAccountEmailProof(prisma.client, f.user.id));
    await f.service.confirm({ ...f.caller, challengeId: token.id, code: f.latestCode() });
    assert.equal(await prisma.client.outboxEvent.count({ where: { aggregateId: f.user.id } }), 1);
  });
  test('concurrent duplicate request sends once; same key with changed body and a new key inside cooldown refuse', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.service.request(f.input), f.service.request(f.input)]);
    assert.equal(a.challenge!.id, b.challenge!.id); assert.equal(f.messages.length, 1);
    await assert.rejects(f.service.request({ ...f.input, newEmail: 'different@example.test' }), e => codeOf(e) === 'EMAIL_STATE_CHANGED');
    await assert.rejects(f.service.request({ ...f.input, expectedEmailRevision: a.emailRevision, requestKey: randomUUID() }), e => codeOf(e) === 'EMAIL_OTP_RATE_LIMITED');
  });
  test('wrong attempts commit despite error, and five attempts revoke only the pending proof', async () => {
    const f = await fixture(); const pending = await f.service.request(f.input), id = pending.challenge!.id;
    const wrong = f.latestCode() === '000000' ? '111111' : '000000';
    for (let count = 1; count <= 5; count++) {
      await assert.rejects(f.service.confirm({ ...f.caller, challengeId: id, code: wrong }), e => codeOf(e) === (count === 5 ? 'EMAIL_OTP_ATTEMPTS_EXCEEDED' : 'EMAIL_OTP_INVALID'));
      assert.equal((await prisma.client.emailVerificationToken.findUniqueOrThrow({ where: { id } })).failedAttempts, count);
    }
    assert.equal((await f.service.status(f.user.id)).emailRequirement, 'READY');
    assert.equal((await prisma.client.user.findUniqueOrThrow({ where: { id: f.user.id } })).email, f.user.email);
  });
  test('expired/cancelled proof restores old eligibility; ownership and requesting session are enforced', async () => {
    const f = await fixture(), stranger = await fixture(); const pending = await f.service.request(f.input), id = pending.challenge!.id;
    await assert.rejects(f.service.confirm({ ...stranger.caller, challengeId: id, code: f.latestCode() }), e => codeOf(e) === 'EMAIL_OTP_NOT_FOUND');
    const second = await prisma.client.authSession.create({ data: { userId: f.user.id, tokenId: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } });
    await assert.rejects(f.service.confirm({ ...f.caller, tokenId: second.tokenId, challengeId: id, code: f.latestCode() }), e => codeOf(e) === 'EMAIL_REAUTH_REQUIRED');
    await prisma.client.emailVerificationToken.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(f.service.confirm({ ...f.caller, challengeId: id, code: f.latestCode() }), e => codeOf(e) === 'EMAIL_OTP_EXPIRED');
    assert.equal((await f.service.status(f.user.id)).emailRequirement, 'READY');
    await f.service.cancel({ ...f.caller, challengeId: id });
    assert.equal((await f.service.status(f.user.id)).email, f.user.email);
  });
  test('delivery uncertainty does not overwrite account email; cancellation remains available', async () => {
    const f = await fixture(); f.failSend(); const pending = await f.service.request(f.input);
    assert.equal(pending.challenge!.deliveryStatus, 'UNKNOWN'); assert.equal(pending.email, f.user.email);
    const canceled = await f.service.cancel({ ...f.caller, challengeId: pending.challenge!.id });
    assert.equal(canceled.emailRequirement, 'READY');
    await assert.rejects(f.service.confirm({ ...f.caller, challengeId: pending.challenge!.id, code: f.latestCode() }), e => codeOf(e) === 'EMAIL_STATE_CHANGED');
  });
  test('preparation failure rolls back replacement; previous code still works', async () => {
    const f = await fixture(); const old = await f.service.request(f.input); const code = f.latestCode();
    await prisma.client.emailVerificationToken.update({ where: { id: old.challenge!.id }, data: { createdAt: new Date(Date.now() - 61_000) } });
    f.failPrepare();
    await assert.rejects(f.service.request({ ...f.input, requestKey: randomUUID(), expectedEmailRevision: old.emailRevision }));
    assert.equal((await f.service.status(f.user.id)).emailRevision, old.emailRevision);
    await f.service.confirm({ ...f.caller, challengeId: old.challenge!.id, code });
  });
  test('password change invalidates pending code and stale quote, even on the retained session', async () => {
    const f = await fixture(); const pending = await f.service.request(f.input);
    await new ChangePasswordUseCase(prisma).execute(f.user.id, password, 'Changed-local-password-123!', f.caller.tokenId);
    await assert.rejects(f.service.confirm({ ...f.caller, challengeId: pending.challenge!.id, code: f.latestCode() }), e => codeOf(e) === 'EMAIL_STATE_CHANGED');
    assert.equal((await f.service.status(f.user.id)).emailRequirement, 'READY');
  });
  test('two accounts cannot both verify the same target under concurrent confirmation', async () => {
    const a = await fixture(), b = await fixture(), target = `${randomUUID()}@shared.example.test`;
    const ap = await a.service.request({ ...a.input, newEmail: target });
    const bp = await b.service.request({ ...b.input, newEmail: target });
    const results = await Promise.allSettled([
      a.service.confirm({ ...a.caller, challengeId: ap.challenge!.id, code: a.latestCode() }),
      b.service.confirm({ ...b.caller, challengeId: bp.challenge!.id, code: b.latestCode() }),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await prisma.client.user.count({ where: { email: target } }), 1);
    assert.equal(codeOf((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), 'EMAIL_CONFLICT');
  });
  test('normal session rotation and service restart retain proof; logout invalidates it without losing old email', async () => {
    const f = await fixture(); const pending = await f.service.request(f.input), id = pending.challenge!.id;
    const rotated = randomUUID();
    await prisma.client.authSession.update({ where: { id: f.session.id }, data: { tokenId: rotated, previousTokenId: f.caller.tokenId, rotatedAt: new Date() } });
    const restarted = new AccountEmailOtpService(prisma, config, f.delivery);
    await restarted.confirm({ ...f.caller, tokenId: rotated, challengeId: id, code: f.latestCode() });
    const second = await fixture(); const waiting = await second.service.request(second.input);
    await prisma.client.authSession.update({ where: { id: second.session.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
    assert.equal((await second.service.status(second.user.id)).emailRequirement, 'READY');
    await assert.rejects(second.service.confirm({ ...second.caller, challengeId: waiting.challenge!.id, code: second.latestCode() }), e => codeOf(e) === 'EMAIL_REAUTH_REQUIRED');
  });
  test('same verified email is a no-op, missing email never inherits an inconsistent legacy verified timestamp', async () => {
    const f = await fixture(); const same = await f.service.request({ ...f.input, newEmail: f.user.email! });
    assert.equal(same.emailRevision, 0); assert.equal(same.challenge, null); assert.equal(f.messages.length, 0);
    await prisma.client.user.update({ where: { id: f.user.id }, data: { email: null } });
    assert.equal((await f.service.status(f.user.id)).emailRequirement, 'MISSING');
    await assert.rejects(verifiedAccountEmailProof(prisma.client, f.user.id), e => codeOf(e) === 'BILLING_EMAIL_VERIFICATION_REQUIRED');
  });

  test('email underscores use exact equality, never SQL LIKE wildcards', async () => {
    const f = await fixture(), prefix = randomUUID();
    await prisma.client.user.create({ data: { displayName: 'Other', email: `${prefix}axb@example.test` } });
    const pending = await f.service.request({ ...f.input, newEmail: `${prefix}a_b@example.test` });
    const result = await f.service.confirm({ ...f.caller, challengeId: pending.challenge!.id, code: f.latestCode() });
    assert.equal(result.email, `${prefix}a_b@example.test`);
  });
  test('resends preserve durable user and recipient budgets, across service instances', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) {
      const status = await f.service.status(f.user.id);
      const pending = await f.service.request({ ...f.input, requestKey: randomUUID(), expectedEmailRevision: status.emailRevision });
      await prisma.client.emailVerificationToken.update({ where: { id: pending.challenge!.id }, data: { createdAt: new Date(Date.now() - 120_000 - (5 - i) * 1000) } });
    }
    const next = new AccountEmailOtpService(prisma, config, f.delivery);
    const status = await next.status(f.user.id);
    await assert.rejects(next.request({ ...f.input, requestKey: randomUUID(), expectedEmailRevision: status.emailRevision }),
      (e: any) => codeOf(e) === 'EMAIL_OTP_RATE_LIMITED' && e.getResponse().retryAfterSeconds > 3000);
    const other = await fixture();
    await assert.rejects(other.service.request({ ...other.input, newEmail: f.input.newEmail }), e => codeOf(e) === 'EMAIL_OTP_RATE_LIMITED');
    assert.equal(f.messages.length, 5); assert.equal(other.messages.length, 0);
  });
  test('key version or target environment changes cannot consume old proof', async () => {
    const f = await fixture(), pending = await f.service.request(f.input), code = f.latestCode();
    const rotated = new AccountEmailOtpService(prisma, { ...config, emailOtpHmacKeyVersion: 'test-v2', emailOtpHmacKey: 'cd'.repeat(32) } as any, f.delivery);
    await assert.rejects(rotated.confirm({ ...f.caller, challengeId: pending.challenge!.id, code }), e => codeOf(e) === 'EMAIL_STATE_CHANGED');
    const anotherEnvironment = new AccountEmailOtpService(prisma, { ...config, appEnv: 'production', isLocal: false,
      deploymentIdentity: { targetEnvironment: 'production' } } as any, f.delivery);
    await assert.rejects(anotherEnvironment.confirm({ ...f.caller, challengeId: pending.challenge!.id, code }), e => codeOf(e) === 'EMAIL_OTP_INVALID');
    assert.equal((await f.service.status(f.user.id)).email, f.user.email);
  });
  test('LINE reauthentication binds nonce, same identity, fresh auth time and stable session; first-password bootstrap requires it', async () => {
    const f = await fixture(), subject = randomUUID(), channel = 'synthetic-channel';
    await prisma.client.userCredential.delete({ where: { userId: f.user.id } });
    await prisma.client.externalIdentity.create({ data: { userId: f.user.id, provider: 'LINE', providerChannelId: channel, providerUserId: subject } });
    const profile = new AccountProfileUseCase(lineMessagingCredentialsFixture(null), prisma, null, null);
    await assert.rejects(profile.setInitialPassword(f.user.id, password, `owner_${randomUUID().slice(0, 8)}`, 'test', f.caller.tokenId), e => codeOf(e) === 'ACCOUNT_REAUTH_REQUIRED');
    const settings = { ...config, webBaseUrl: 'https://uat.mangmeeplus.com', lineMessagingChannelId: channel, lineLoginChannelId: '123456', lineLoginChannelSecret: 'synthetic-secret' } as any;
    let verifiedSubject: string = subject, authenticatedAt = Math.floor(Date.now() / 1000), exchanges = 0;
    const reauth = new AccountEmailReauthService(prisma, settings, { exchangeAuthorizationCode: async ({ redirectUri }: any) => {
      assert.equal(redirectUri, 'https://uat.mangmeeplus.com/api/auth/line-login/callback'); exchanges++; return { idToken: 'simulated-proof' };
    } } as any, { verify: async (_token: string, options: any) => { assert.ok(options.nonce); return { subject: verifiedSubject, authenticatedAt }; } } as any);
    const { nonce } = await reauth.begin(f.caller), input = { ...f.caller, nonce, code: 'simulated-oauth-code', codeVerifier: 'synthetic-pkce' };
    await assert.rejects(reauth.execute({ ...input, nonce: 'wrong-nonce' })); assert.equal(exchanges, 0);
    verifiedSubject = 'another-line'; await assert.rejects(reauth.execute(input), e => codeOf(e) === 'EMAIL_REAUTH_REQUIRED');
    verifiedSubject = subject; authenticatedAt -= 601; await assert.rejects(reauth.execute(input), e => codeOf(e) === 'EMAIL_REAUTH_REQUIRED');
    authenticatedAt = Math.floor(Date.now() / 1000); await reauth.execute(input);
    await assert.rejects(reauth.execute(input), e => codeOf(e) === 'EMAIL_REAUTH_REQUIRED');
    await profile.setInitialPassword(f.user.id, password, `owner_${randomUUID().slice(0, 8)}`, 'test', f.caller.tokenId);
    assert.ok(await prisma.client.userCredential.findUnique({ where: { userId: f.user.id } }));
  });

});
