import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BillingRecipientOtpService } from './billing-recipient-otp.service';
import { OTP_WRONG_ACTION } from '../../auth/application/account-email-otp.service';

type Row = Record<string, any>;
const code = (error: unknown) => (error as { getResponse(): { code: string } }).getResponse().code;
const status = (error: unknown) => (error as { getStatus(): number }).getStatus();

/** In-memory stand-in for the tables the service touches; Postgres locks become no-ops. */
function fixture(account: Row | null = { id: 'account-1', customerId: 'cus_1', recipientEmail: 'old@example.test' }) {
  const clock = { now: new Date('2026-09-28T03:00:00.000Z') };
  const sessions = [{ id: 'session-1', tokenId: 'tid-1' }, { id: 'session-2', tokenId: 'tid-2' }]
    .map(s => ({ ...s, userId: 'user-1', status: 'ACTIVE', expiresAt: new Date(clock.now.getTime() + 86_400_000) }));
  const tokens: Row[] = [], audits: Row[] = [], attempts: Row[] = [], sent: Row[] = [];
  const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value) return value.in.includes(row[key]);
      if ('gt' in value) return row[key] > value.gt;
    }
    return row[key] === value;
  });
  const tx: Row = {
    $executeRaw: async () => 1,
    $queryRaw: async (strings: TemplateStringsArray) => strings.join('?').includes('clock_timestamp') ? [{ now: clock.now }] : [],
    authSession: { findFirst: async ({ where }: Row) => sessions.find(s => s.userId === where.userId && s.status === 'ACTIVE' && s.expiresAt > clock.now &&
      (where.id ? s.id === where.id : where.OR.some((o: Row) => o.tokenId === s.tokenId || o.previousTokenId === s.tokenId))) ?? null },
    emailVerificationToken: {
      findUnique: async ({ where }: Row) => tokens.find(t => t.userId === where.userId_requestKey.userId && t.requestKey === where.userId_requestKey.requestKey) ?? null,
      findMany: async ({ where, orderBy }: Row) => tokens.filter(t => matches(t, where))
        .sort((a, b) => (orderBy.createdAt === 'desc' ? -1 : 1) * (a.createdAt.getTime() - b.createdAt.getTime())),
      findFirst: async ({ where }: Row) => tokens.find(t => matches(t, where)) ?? null,
      findFirstOrThrow: async ({ where }: Row) => tokens.find(t => matches(t, where)) ?? assert.fail('token missing'),
      findUniqueOrThrow: async ({ where }: Row) => tokens.find(t => t.id === where.id) ?? assert.fail('token missing'),
      updateMany: async ({ where, data }: Row) => { const hit = tokens.filter(t => matches(t, where)); hit.forEach(t => Object.assign(t, data)); return { count: hit.length }; },
      update: async ({ where, data }: Row) => Object.assign(tokens.find(t => t.id === where.id)!, data),
      create: async ({ data }: Row) => { const row = { status: 'PENDING', failedAttempts: 0, usedAt: null, ...data }; tokens.push(row); return row; },
    },
    emailAccessChallenge: { findMany: async () => [] },
    auditLog: { create: async ({ data }: Row) => { audits.push({ ...data, createdAt: clock.now }); return data; },
      count: async ({ where }: Row) => audits.filter(a => a.actorUserId === where.actorUserId && a.action === where.action).length },
    emailSendAttempt: { findUnique: async ({ where }: Row) => attempts.find(a => a.id === where.id) ?? null, updateMany: async () => ({ count: 0 }) },
  };
  const prisma = { client: { ...tx, $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } };
  const config = { isLocal: true, appEnv: 'local', emailProvider: 'postmark', postmarkServerId: 1, emailOtpHmacKey: 'a'.repeat(64),
    emailOtpHmacKeyVersion: 'v1', postmarkUatAllowedRecipients: [] };
  const delivery = {
    prepare: async (input: Row) => { const row = { id: `attempt-${attempts.length + 1}`, status: 'READY', deliveredAt: null, ...input }; attempts.push(row); return row; },
    send: async (attempt: Row, content: Row, beforeDispatch?: () => Promise<void>) => { await beforeDispatch?.(); sent.push({ attempt, content }); return 'msg'; },
  };
  const billing = { assertOwner: async () => {}, account: async () => account };
  const service = new BillingRecipientOtpService(prisma as any, config as any, delivery as any, billing as any);
  const caller = { companyId: 'company-1', userId: 'user-1', tokenId: 'tid-1', requestId: 'request-1' };
  const codeSent = () => /\b(\d{6})\b/.exec(sent.at(-1)!.content.text)![1]!;
  return { service, caller, clock, tokens, audits, sent, codeSent };
}

describe('company recipient OTP request (R-A8)', () => {
  it('refuses before a purchase, for the current recipient and for a malformed address', async () => {
    const none = fixture({ id: 'account-1', customerId: null, recipientEmail: null });
    await assert.rejects(none.service.request({ ...none.caller, email: 'new@example.test', requestKey: 'k1' }), e => code(e) === 'BILLING_RECIPIENT_UNAVAILABLE');
    const f = fixture();
    await assert.rejects(f.service.request({ ...f.caller, email: ' OLD@example.test ', requestKey: 'k1' }), e => code(e) === 'BILLING_RECIPIENT_UNCHANGED');
    await assert.rejects(f.service.request({ ...f.caller, email: 'not-an-email', requestKey: 'k1' }), e => code(e) === 'EMAIL_OTP_TARGET_INVALID' && status(e) === 400);
    assert.equal(f.tokens.length + none.tokens.length, 0); assert.equal(f.sent.length, 0);
  });

  it('binds the challenge to the company and session, sends one code, and replays by request key', async () => {
    const f = fixture();
    const challenge = await f.service.request({ ...f.caller, email: ' New@Example.test ', requestKey: 'k1' });
    assert.equal(challenge.email, 'new@example.test'); assert.equal(challenge.attemptsRemaining, 5); assert.equal(challenge.delivered, false);
    assert.equal(challenge.retryAt, new Date(f.clock.now.getTime() + 60_000).toISOString());
    assert.equal(Object.hasOwn(challenge, 'serverNow'), false);
    const token = f.tokens[0]!;
    assert.deepEqual([token.companyId, token.proofKind, token.sessionId, token.status], ['company-1', 'BILLING_RECIPIENT', 'session-1', 'PENDING']);
    assert.equal(f.sent.length, 1); assert.match(f.codeSent(), /^\d{6}$/);
    assert.equal(f.sent[0]!.attempt.intentKey, `billing-recipient-otp:${token.id}`);
    assert.deepEqual(f.audits.map(a => a.action), ['billing.recipient.otp.requested', 'billing.recipient.otp.dispatch_authorized']);
    assert.doesNotMatch(JSON.stringify(f.audits), /@/, 'no email address in audit rows');
    const replay = await f.service.request({ ...f.caller, email: 'new@example.test', requestKey: 'k1' });
    assert.equal(replay.challengeId, challenge.challengeId); assert.equal(f.sent.length, 1);
    await assert.rejects(f.service.request({ ...f.caller, email: 'other@example.test', requestKey: 'k1' }), e => code(e) === 'EMAIL_STATE_CHANGED');
  });

  it('shares the per-minute mail budget and revokes the previous pending code of the company', async () => {
    const f = fixture();
    await f.service.request({ ...f.caller, email: 'new@example.test', requestKey: 'k1' });
    await assert.rejects(f.service.request({ ...f.caller, email: 'new@example.test', requestKey: 'k2' }),
      e => code(e) === 'EMAIL_OTP_RATE_LIMITED' && status(e) === 429 && (e as any).getResponse().retryAfterSeconds > 0);
    f.clock.now = new Date(f.clock.now.getTime() + 61_000);
    await f.service.request({ ...f.caller, email: 'new@example.test', requestKey: 'k2' });
    assert.deepEqual(f.tokens.map(t => t.status), ['REVOKED', 'PENDING']);
  });
});

describe('company recipient OTP confirm (R-A8)', () => {
  it('counts wrong codes, then turns the right code into a 30-minute proof, idempotently', async () => {
    const f = fixture();
    const { challengeId } = await f.service.request({ ...f.caller, email: 'new@example.test', requestKey: 'k1' });
    const right = f.codeSent(), wrong = right === '000000' ? '111111' : '000000';
    await assert.rejects(f.service.confirm({ ...f.caller, challengeId, code: wrong }), e => code(e) === 'EMAIL_OTP_INVALID' && status(e) === 409);
    assert.equal(f.tokens[0]!.failedAttempts, 1); assert.equal(f.audits.at(-1)!.action, OTP_WRONG_ACTION);
    const proof = await f.service.confirm({ ...f.caller, challengeId, code: right });
    assert.deepEqual(proof, { recipientProofId: challengeId, email: 'new@example.test', expiresAt: new Date(f.clock.now.getTime() + 30 * 60_000).toISOString() });
    assert.equal(f.tokens[0]!.status, 'USED'); assert.equal(f.audits.at(-1)!.action, 'billing.recipient.otp.verified');
    assert.deepEqual(await f.service.confirm({ ...f.caller, challengeId, code: right }), proof);
  });

  it('refuses an unknown challenge, another session, an expired code and a fifth wrong code', async () => {
    const f = fixture();
    await assert.rejects(f.service.confirm({ ...f.caller, challengeId: 'missing', code: '123456' }), e => code(e) === 'EMAIL_OTP_NOT_FOUND' && status(e) === 404);
    const { challengeId } = await f.service.request({ ...f.caller, email: 'new@example.test', requestKey: 'k1' });
    const right = f.codeSent(), wrong = right === '000000' ? '111111' : '000000';
    await assert.rejects(f.service.confirm({ ...f.caller, tokenId: 'tid-2', challengeId, code: right }), e => code(e) === 'EMAIL_REAUTH_REQUIRED' && status(e) === 409);
    for (let i = 1; i < 5; i++) await assert.rejects(f.service.confirm({ ...f.caller, challengeId, code: wrong }), e => code(e) === 'EMAIL_OTP_INVALID');
    await assert.rejects(f.service.confirm({ ...f.caller, challengeId, code: wrong }), e => code(e) === 'EMAIL_OTP_ATTEMPTS_EXCEEDED');
    assert.equal(f.tokens[0]!.status, 'REVOKED');
    await assert.rejects(f.service.confirm({ ...f.caller, challengeId, code: right }), e => code(e) === 'EMAIL_STATE_CHANGED');
    const g = fixture();
    const second = await g.service.request({ ...g.caller, email: 'new@example.test', requestKey: 'k1' });
    g.clock.now = new Date(g.clock.now.getTime() + 11 * 60_000);
    await assert.rejects(g.service.confirm({ ...g.caller, challengeId: second.challengeId, code: g.codeSent() }), e => code(e) === 'EMAIL_OTP_EXPIRED');
    assert.equal(g.tokens[0]!.status, 'EXPIRED');
  });
});
