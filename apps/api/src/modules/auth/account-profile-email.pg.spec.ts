import { lineMessagingCredentialsFixture } from '../../common/config/line-messaging-credentials.fixture';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { AccountProfileUseCase } from './application/use-cases/account-profile.use-case';
import { ConfirmEmailVerificationUseCase } from './application/use-cases/confirm-email-verification.use-case';
import { RequestEmailChangeUseCase } from './application/use-cases/request-email-change.use-case';
import { hashToken } from './domain/logic/secure-token.logic';
import { pgSpecUnreachableReason } from '../../common/database/pg-spec-guard';

const databaseUrl = process.env.ACCOUNT_PROFILE_TEST_DATABASE_URL;
const errorCode = (expected: string) => (error: any) => error.getResponse?.().code === expected;
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

describe('unverified owner email on PostgreSQL', { skip: !databaseUrl }, () => {
  it('corrects only the LINE-linked unverified account and fences verification/password races', async (t) => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.equal(url.pathname, '/watchdog_bms');
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `owner-email-${randomUUID()}`, userId = `${tag}-owner`, otherId = `${tag}-other`;
    const profile = new AccountProfileUseCase(lineMessagingCredentialsFixture(undefined), { client } as any);
    let reachable = false;
    const edit = (newEmail: string, expectedEmail: string | null, currentPassword?: string) => profile.setUnverifiedEmail({
      userId, newEmail, expectedEmail, currentPassword, requestId: tag, currentTokenId: 'current',
    });
    try {
      const reason = await pgSpecUnreachableReason(() => client.$queryRaw`SELECT 1`, 'ACCOUNT_PROFILE_REQUIRE_POSTGRES');
      if (reason) { t.skip(reason); return; } reachable = true;
      await client.user.createMany({ data: [
        { id: userId, displayName: tag, status: 'ACTIVE' },
        { id: otherId, displayName: tag, status: 'ACTIVE', email: `${tag}-taken@example.test`, username: `${tag}-legacy@example.test` },
      ] });
      await assert.rejects(edit(`${tag}@example.test`, null), errorCode('account_line_required'));
      await client.externalIdentity.create({ data: { userId, provider: 'LINE', providerUserId: tag, providerChannelId: tag, status: 'ACTIVE' } });
      const token = await client.emailVerificationToken.create({ data: { userId, newEmail: `${tag}-obsolete@example.test`, tokenHash: hashToken(tag), expiresAt: new Date(Date.now() + 60_000) } });
      for (const address of [`${tag}-taken@example.test`, `${tag}-legacy@example.test`]) {
        await assert.rejects(edit(address.toUpperCase(), null), errorCode('account_email_conflict'));
        assert.equal((await client.emailVerificationToken.findUniqueOrThrow({ where: { id: token.id } })).status, 'PENDING');
      }
      await assert.rejects(edit('not-an-email', null), errorCode('invalid_email'));
      const firstEmail = `${tag}@example.test`, corrected = `${tag}-corrected@example.test`;
      assert.deepEqual(await edit(` ${firstEmail.toUpperCase()} `, null), { email: firstEmail, emailVerified: false });
      assert.equal((await client.emailVerificationToken.findUniqueOrThrow({ where: { id: token.id } })).status, 'REVOKED');
      await assert.rejects(edit(corrected, null), errorCode('account_email_changed'));

      // A verification request that was prechecked before the correction may not create a new
      // obsolete token after the correction revoked its predecessors.
      const prechecked = deferred(), proceed = deferred();
      const stalePrisma = { client: new Proxy(client, { get(target, property) {
        if (property === '$transaction') return async (fn: any) => { prechecked.resolve(); await proceed.promise; return target.$transaction(fn); };
        const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
      } }) } as any;
      let sent = 0;
      const staleRequest = new RequestEmailChangeUseCase(stalePrisma, { sendEmailVerification: async () => { sent += 1; } } as any)
        .execute({ userId, newEmail: `${tag}-stale@example.test` });
      const staleResult = assert.rejects(staleRequest, errorCode('account_email_changed'));
      await prechecked.promise;
      await edit(corrected, firstEmail);
      proceed.resolve();
      await staleResult;
      assert.equal(sent, 0);
      assert.equal(await client.emailVerificationToken.count({ where: { userId, status: 'PENDING' } }), 0);

      // The first credential commits between the empty credential read and the parent User lock.
      const inserted = deferred(), commitPassword = deferred(), credentialMiss = deferred(), continueCorrection = deferred();
      const passwordPrisma = { client: new Proxy(client, { get(target, property) {
        if (property === '$transaction') return (fn: any) => target.$transaction(async (tx) => {
          const result = await fn(tx); inserted.resolve(); await commitPassword.promise; return result;
        });
        const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
      } }) } as any;
      const passwordWrite = new AccountProfileUseCase(lineMessagingCredentialsFixture(undefined), passwordPrisma).setInitialPassword(userId, 'owner-password', undefined, tag, 'current');
      await inserted.promise;
      let firstCredentialRead = true;
      const correctingPrisma = { client: new Proxy(client, { get(target, property) {
        if (property === '$transaction') return (fn: any) => target.$transaction((tx) => fn(new Proxy(tx, { get(transaction, key) {
          if (key === '$queryRaw') return async (...args: any[]) => {
            const rows = await (transaction.$queryRaw as any)(...args);
            if (firstCredentialRead && String(args[0]).includes('FROM "UserCredential"')) {
              firstCredentialRead = false; assert.deepEqual(rows, []);
              credentialMiss.resolve(); await continueCorrection.promise;
            }
            return rows;
          };
          const value = Reflect.get(transaction, key); return typeof value === 'function' ? value.bind(transaction) : value;
        } })));
        const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
      } }) } as any;
      const withoutPassword = assert.rejects(new AccountProfileUseCase(lineMessagingCredentialsFixture(undefined), correctingPrisma).setUnverifiedEmail({
        userId, newEmail: firstEmail, expectedEmail: corrected, requestId: tag, currentTokenId: 'current',
      }), errorCode('current_password_incorrect'));
      await credentialMiss.promise;
      commitPassword.resolve();
      await passwordWrite; continueCorrection.resolve(); await withoutPassword;
      await edit(firstEmail, corrected, 'owner-password');
      assert.equal((await client.user.findUniqueOrThrow({ where: { id: userId } })).emailVerifiedAt, null);

      // A real verification transaction holds the email lock until its verified User write commits.
      const verifiedWritten = deferred(), commitVerification = deferred();
      const verificationToken = `${tag}-verify`;
      await client.emailVerificationToken.create({ data: { userId, newEmail: corrected, tokenHash: hashToken(verificationToken), expiresAt: new Date(Date.now() + 60_000) } });
      const verifyingPrisma = { client: new Proxy(client, { get(target, property) {
        if (property === '$transaction') return (fn: any) => target.$transaction(async (tx) => {
          const result = await fn(tx); verifiedWritten.resolve(); await commitVerification.promise; return result;
        });
        const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
      } }) } as any;
      const verification = new ConfirmEmailVerificationUseCase(lineMessagingCredentialsFixture(undefined), verifyingPrisma).execute({ token: verificationToken });
      await verifiedWritten.promise;
      const obsoleteCorrection = assert.rejects(edit(firstEmail, firstEmail, 'owner-password'), errorCode('account_email_verified'));
      commitVerification.resolve();
      await verification; await obsoleteCorrection;
      const final = await client.user.findUniqueOrThrow({ where: { id: userId } });
      assert.equal(final.email, corrected); assert.ok(final.emailVerifiedAt);
      assert.equal(final.username, null);
      assert.equal((await client.user.findUniqueOrThrow({ where: { id: otherId } })).email, `${tag}-taken@example.test`);
    } finally {
      if (reachable) {
        await client.auditLog.deleteMany({ where: { actorUserId: { in: [userId, otherId] } } });
        await client.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
      }
      await client.$disconnect();
    }
  });
});
