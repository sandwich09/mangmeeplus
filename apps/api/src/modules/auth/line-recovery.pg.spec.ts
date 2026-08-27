import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { NotifyPasswordResetRequestUseCase } from './application/use-cases/notify-password-reset-request.use-case';
import { PasswordLoginUseCase } from './application/use-cases/password-login.use-case';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { hashPassword, verifyPassword } from './domain/logic/password-credential.logic';
import { hashLineRecoveryPassword } from './domain/logic/secure-token.logic';

const databaseUrl = process.env.AUTH_RECOVERY_TEST_DATABASE_URL;

describe('LINE recovery PostgreSQL lifecycle and concurrency', { skip: !databaseUrl }, () => {
  it('serializes requests and claims, invalidates old recovery after every credential rotation, and preserves denied flows', async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname), 'only an explicit local test database is allowed');
    assert.match(url.pathname, /_recovery_review_/);
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `recovery-${randomUUID()}`;
    const companyId = `${tag}-company`;
    const userId = `${tag}-user`;
    const username = tag;
    const prisma = { client } as any;
    const legal = { getStatus: async () => ({ required: true }) } as any;
    const messages: string[] = [];
    const originalFetch = globalThis.fetch;
    let delivered = true;
    globalThis.fetch = (async (input: any, init: any) => {
      assert.equal(String(input), 'https://api.line.me/v2/bot/message/push');
      const payload = JSON.parse(init.body);
      assert.equal(payload.to, `${tag}-line`);
      messages.push(/รหัสผ่านชั่วคราว: ([^\n]+)/.exec(payload.messages[0].text)![1]!);
      return { ok: delivered, status: delivered ? 200 : 500 } as Response;
    }) as typeof fetch;
    const requester = new NotifyPasswordResetRequestUseCase(prisma, {
      lineMessagingChannelAccessToken: 'synthetic-not-a-real-token', passwordResetResponseMinMs: 0,
    } as any);
    const issueToken = { execute: async () => ({ accessToken: 'synthetic', refreshToken: 'synthetic', expiresIn: 900 }) } as any;
    const login = new PasswordLoginUseCase(prisma, issueToken, legal);
    const credential = () => client.userCredential.findUniqueOrThrow({ where: { userId } });
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
    const request = async () => { await requester.execute({ username }); await flush(); return messages.at(-1)!; };
    const rejects = (password: string) => assert.rejects(() => login.execute(username, password), (error: unknown) => error instanceof UnauthorizedException);
    try {
      await client.company.create({ data: { id: companyId, name: tag } });
      await client.user.create({ data: {
        id: userId, displayName: tag, username,
        credential: { create: { passwordHash: hashPassword('original-user-password') } },
      } });
      await client.companyMembership.create({ data: { companyId, userId } });
      await client.externalIdentity.create({ data: { userId, provider: 'LINE', providerUserId: `${tag}-line`, providerChannelId: 'synthetic' } });
      await client.authSession.create({ data: { userId, tokenId: `${tag}-session`, expiresAt: new Date(Date.now() + 60_000) } });

      const initial = await credential();
      await Promise.all(Array.from({ length: 4 }, () => requester.execute({ username })));
      await flush();
      assert.equal(await client.passwordResetToken.count({ where: { userId, status: 'PENDING' } }), 1, 'only the latest request remains pending');
      assert.deepEqual(await credential(), initial, 'requesting must not change credentials');
      assert.equal(await client.authSession.count({ where: { userId, status: 'ACTIVE' } }), 1);
      assert.equal((await login.execute(username, 'original-user-password')).passwordChangeRequired, false);
      const token = await client.passwordResetToken.findFirstOrThrow({ where: { userId, status: 'PENDING' } });
      const raw = messages.find((value) => hashLineRecoveryPassword(value, initial.passwordHash) === token.tokenHash)!;
      assert.ok(raw);

      // Both callers must hold the pre-recovery credential snapshot before either claims.
      let arrived = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const raceLegal = { getStatus: async () => { if (++arrived === 2) release(); await gate; return { required: true }; } } as any;
      const racing = new PasswordLoginUseCase(prisma, issueToken, raceLegal);
      const results = await Promise.allSettled([racing.execute(username, raw), racing.execute(username, raw)]);
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(results.filter((result) => result.status === 'rejected' && result.reason instanceof UnauthorizedException).length, 1);
      assert.equal((await credential()).mustChangePassword, true);
      assert.equal(await client.authSession.count({ where: { userId, status: 'ACTIVE' } }), 0);
      assert.equal(await client.auditLog.count({ where: { actorUserId: userId, targetId: token.id } }), 1);
      await rejects('original-user-password');

      const stale = await request();
      await new ChangePasswordUseCase(prisma).execute(userId, raw, 'chosen-new-password', `${tag}-session`);
      await rejects(stale);
      await rejects(raw);
      assert.equal((await login.execute(username, 'chosen-new-password')).passwordChangeRequired, false);

      const beforeAdminReset = await request();
      await client.userCredential.update({ where: { userId }, data: { passwordHash: hashPassword('admin-issued-password'), mustChangePassword: true } });
      await rejects(beforeAdminReset);
      assert.equal(verifyPassword('admin-issued-password', (await credential()).passwordHash), true);

      // A password rotation after token lookup but before claim must not be overwritten.
      const delayed = await request();
      const rotateLegal = { getStatus: async () => {
        await client.userCredential.update({ where: { userId }, data: { passwordHash: hashPassword('concurrent-new-password') } });
        return { required: true };
      } } as any;
      await assert.rejects(() => new PasswordLoginUseCase(prisma, issueToken, rotateLegal).execute(username, delayed), UnauthorizedException);
      assert.equal(verifyPassword('concurrent-new-password', (await credential()).passwordHash), true);

      const denied = await request();
      const closed = new PasswordLoginUseCase(prisma, issueToken, legal, { getStatus: async () => ({ effectiveState: 'CLOSED' }) } as any);
      await assert.rejects(() => closed.execute(username, denied), (error: any) => error.getResponse?.().code === 'platform_access_closed');
      const beforeDisable = await credential();
      await client.userCredential.update({ where: { userId }, data: { status: 'DISABLED' } });
      await rejects(denied);
      await client.userCredential.update({ where: { userId }, data: { status: 'ACTIVE' } });
      assert.equal((await credential()).passwordHash, beforeDisable.passwordHash);

      delivered = false;
      await request();
      // Delivery is deliberately detached; wait on the persisted outcome, not a guessed delay.
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await client.passwordResetToken.count({ where: { userId, status: 'PENDING' } }) === 0) break;
        await flush();
      }
      assert.equal(await client.passwordResetToken.count({ where: { userId, status: 'PENDING' } }), 0);
      assert.equal((await login.execute(username, 'concurrent-new-password')).passwordChangeRequired, true);
    } finally {
      globalThis.fetch = originalFetch;
      await client.auditLog.deleteMany({ where: { actorUserId: userId } });
      await client.companyMembership.deleteMany({ where: { userId } });
      await client.user.deleteMany({ where: { id: userId } });
      await client.company.deleteMany({ where: { id: companyId } });
      await client.$disconnect();
    }
  });
});
