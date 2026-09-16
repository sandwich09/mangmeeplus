import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { ExchangeLineTokenUseCase } from './application/use-cases/exchange-line-token.use-case';

const databaseUrl = process.env.AUTH_LINE_BINDING_TEST_DATABASE_URL;

/** Real identity queries; LINE verification and token issuance are explicit test boundaries. */
describe('canonical LINE binding PostgreSQL boundary', { skip: !databaseUrl }, () => {
  it('keeps unlink/disable authoritative over a legacy alias, and preserves valid legacy login before repair', async () => {
    const url = new URL(databaseUrl!);
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
    assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
    const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
    const tag = `line-binding-${randomUUID()}`, currentUser = `${tag}-current`, legacyUser = `${tag}-legacy`;
    const subject = `${tag}-subject`, channel = `${tag}-messaging`, issued: string[] = [];
    const exchange = new ExchangeLineTokenUseCase(
      { verify: async () => ({ subject }) } as any,
      { client } as any,
      { lineMessagingChannelId: channel, isProduction: true } as any,
      { execute: async (userId: string) => { issued.push(userId); return { accessToken: 'synthetic', refreshToken: 'synthetic', expiresIn: 900 }; } } as any,
    );
    try {
      await client.user.createMany({ data: [{ id: currentUser, displayName: tag }, { id: legacyUser, displayName: tag }] });
      const legacy = await client.externalIdentity.create({ data: { userId: legacyUser, provider: 'LINE', providerUserId: subject, providerChannelId: `${tag}-login` } });
      assert.equal((await exchange.execute('synthetic-id-token', channel)).linked, true);
      assert.deepEqual(issued.splice(0), [legacyUser]);
      const canonical = await client.externalIdentity.create({ data: { userId: currentUser, provider: 'LINE', providerUserId: subject, providerChannelId: channel } });
      for (const status of ['ACTIVE', 'UNLINKED', 'DISABLED', 'ACTIVE'] as const) {
        await client.externalIdentity.update({ where: { id: canonical.id }, data: { status } });
        assert.equal((await exchange.execute('synthetic-id-token', channel)).linked, status === 'ACTIVE');
        assert.deepEqual(issued.splice(0), status === 'ACTIVE' ? [currentUser] : []);
        assert.deepEqual(await client.externalIdentity.findUniqueOrThrow({ where: { id: legacy.id } }), legacy);
      }
    } finally {
      await client.externalIdentity.deleteMany({ where: { userId: { in: [currentUser, legacyUser] } } });
      await client.user.deleteMany({ where: { id: { in: [currentUser, legacyUser] } } });
      await client.$disconnect();
    }
  });
});

// Real transactions and concurrent connections; only the LINE verification endpoint is simulated.
import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { CompleteEmployeeLineLinkUseCase } from './application/use-cases/complete-employee-line-link.use-case';
import { LinkLineIdentityUseCase } from './application/use-cases/link-line-identity.use-case';
import { hashPassword } from './domain/logic/password-credential.logic';
import { UnlinkLineIdentityUseCase } from './application/use-cases/unlink-line-identity.use-case';
import { PartnerMemberLineUnlinkUseCase } from '../system-partner-management/application/use-cases/partner-member-line-unlink.use-case';

async function withQrFixture(run: (h: any) => Promise<void>) {
  const url = new URL(databaseUrl!);
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.ok(['/mangmee_billing_20260912', '/watchdog_postmark_ci'].includes(url.pathname));
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl! }) });
  const tag = `line-qr-${randomUUID()}`, companyId = `${tag}-company`, userId = `${tag}-user`, otherUser = `${tag}-other`;
  const channelId = `${tag}-messaging`, loginChannelId = `${tag}-login`, subject = `${tag}-new`, oldSubject = `${tag}-old`;
  const verifier = { verify: async (proof: string) => {
    if (!proof.startsWith(tag)) throw new ForbiddenException('synthetic invalid proof');
    return { subject: proof };
  } } as any;
  const config = { lineMessagingChannelId: channelId, lineLoginChannelId: loginChannelId, isProduction: true } as any;
  const build = (db: any = { client }) => new CompleteEmployeeLineLinkUseCase(db, new LinkLineIdentityUseCase(verifier, db, config), verifier);
  try {
    await client.company.create({ data: { id: companyId, name: tag } });
    await client.user.createMany({ data: [{ id: userId, displayName: tag }, { id: otherUser, displayName: tag }] });
    const member = await client.companyMembership.create({ data: { userId, companyId } });
    await client.companyMembership.create({ data: { userId: otherUser, companyId } });
    await client.companyPlanTerm.create({ data: { companyId, tierKey: 'BASIC', branchLimit: 2, employeeLimit: 5, monthlySlipLimit: 50,
      termStartAt: new Date('2026-09-01T00:00:00Z'), termEndsAt: new Date('2027-09-01T00:00:00Z') } });
    const originalPlan = await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } });
    const issue = async () => {
      const raw = randomUUID();
      const token = await client.employeeLineLinkToken.create({ data: {
        companyId, membershipId: member.id, userId, issuedByUserId: otherUser,
        tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 60_000),
      } });
      return { token, input: { linkToken: raw, idToken: subject, requestId: `${tag}-request` } };
    };
    const identity = (providerUserId = oldSubject, providerChannelId = channelId) => client.externalIdentity.create({
      data: { userId, provider: 'LINE', providerUserId, providerChannelId },
    });
    const snapshot = async () => ({
      identities: await client.externalIdentity.findMany({ where: { userId: { in: [userId, otherUser] } }, orderBy: { id: 'asc' } }),
      recovery: await client.passwordResetToken.findMany({ where: { userId: { in: [userId, otherUser] } }, orderBy: { id: 'asc' } }),
      tokens: await client.employeeLineLinkToken.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
      contexts: await client.lineCompanyContext.findMany({ where: { companyId }, orderBy: { lineUserId: 'asc' } }),
      handoffs: await client.lineWebHandoffToken.findMany({ where: { companyId }, orderBy: { id: 'asc' } }),
      audits: await client.auditLog.findMany({ where: { OR: [{ companyId }, { actorUserId: { in: [userId, otherUser] } }] }, orderBy: { id: 'asc' } }),
    });
    await run({ client, build, issue, identity, snapshot, config, tag, companyId, userId, otherUser, member, channelId, loginChannelId, subject, oldSubject });
    assert.deepEqual(await client.companyPlanTerm.findUniqueOrThrow({ where: { companyId } }), originalPlan, 'LINE repair must not alter existing package rights');
  } finally {
    await client.auditLog.deleteMany({ where: { OR: [{ companyId }, { actorUserId: { in: [userId, otherUser] } }] } });
    await client.lineWebHandoffToken.deleteMany({ where: { companyId } });
    await client.lineCompanyContext.deleteMany({ where: { companyId } });
    await client.externalIdentity.deleteMany({ where: { userId: { in: [userId, otherUser] } } });
    await client.company.deleteMany({ where: { id: companyId } });
    await client.user.deleteMany({ where: { id: { in: [userId, otherUser] } } });
    await client.$disconnect();
  }
}

describe('Admin QR actual PostgreSQL repair', { skip: !databaseUrl }, () => {
  it('repairs the proved same-user legacy binding, severs the old phone and recovers the original response read-only', async () => withQrFixture(async (h) => {
    const legacy = await h.identity(h.subject, h.loginChannelId), old = await h.identity();
    const recovery = await h.client.passwordResetToken.create({ data: { userId: h.userId, tokenHash: h.tag, expiresAt: new Date(Date.now() + 60_000) } });
    await h.client.lineCompanyContext.create({ data: { lineUserId: h.oldSubject, companyId: h.companyId } });
    const handoff = await h.client.lineWebHandoffToken.create({ data: { tokenHash: h.tag, userId: h.userId,
      companyId: h.companyId, lineUserId: h.oldSubject, targetPath: '/', surface: 'synthetic', expiresAt: new Date(Date.now() + 60_000) } });
    const { token, input } = await h.issue(), useCase = h.build();
    assert.deepEqual(await useCase.execute(input), { linked: true });
    const repaired = await h.client.externalIdentity.findUniqueOrThrow({ where: { id: legacy.id } });
    assert.equal((await h.client.passwordResetToken.findUniqueOrThrow({ where: { id: recovery.id } })).status, 'REVOKED');
    assert.equal(repaired.providerChannelId, h.channelId); assert.equal(repaired.userId, h.userId);
    assert.equal((await h.client.externalIdentity.findUniqueOrThrow({ where: { id: old.id } })).status, 'UNLINKED');
    assert.equal((await h.client.lineWebHandoffToken.findUniqueOrThrow({ where: { id: handoff.id } })).status, 'REVOKED');
    assert.equal(await h.client.lineCompanyContext.findUnique({ where: { lineUserId: h.oldSubject } }), null);
    const receipt = await h.client.employeeLineLinkToken.findUniqueOrThrow({ where: { id: token.id } });
    assert.equal(receipt.claimedLineUserId, h.subject); assert.equal(receipt.claimedLineChannelId, h.channelId);
    const before = await h.snapshot();
    assert.deepEqual(await useCase.execute(input), { linked: true });
    await assert.rejects(useCase.execute({ ...input, idToken: h.oldSubject }), ForbiddenException);
    assert.deepEqual(await h.snapshot(), before);
    await h.client.companyMembership.update({ where: { id: h.member.id }, data: { status: 'SUSPENDED' } });
    await assert.rejects(useCase.execute(input), ForbiddenException);
  }));

  it('rolls back a failure after link/sever/handoff writes and then retries the same unconsumed QR', async () => withQrFixture(async (h) => {
    await h.identity(h.subject, h.loginChannelId); await h.identity();
    await h.client.lineCompanyContext.create({ data: { lineUserId: h.oldSubject, companyId: h.companyId } });
    await h.client.lineWebHandoffToken.create({ data: { tokenHash: h.tag, userId: h.userId,
      companyId: h.companyId, lineUserId: h.oldSubject, targetPath: '/', surface: 'synthetic', expiresAt: new Date(Date.now() + 60_000) } });
    const { input } = await h.issue(), before = await h.snapshot();
    const db = { client: { employeeLineLinkToken: h.client.employeeLineLinkToken,
      $transaction: (work: any, options: any) => h.client.$transaction((tx: any) => work({ ...tx, auditLog: {
        create: (args: any) => { if (args.data.action === 'access.employee.line_link.success') throw Error('synthetic final audit failure'); return tx.auditLog.create(args); },
      } }), options),
    } };
    await assert.rejects(h.build(db).execute(input), ServiceUnavailableException);
    assert.deepEqual(await h.snapshot(), before);
    assert.deepEqual(await h.build().execute(input), { linked: true });
  }));

  it('gives one winner to different LINE accounts racing one QR and preserves a same-winner retry', async () => withQrFixture(async (h) => {
    const { input } = await h.issue(), useCase = h.build();
    const attempts = [input, { ...input, idToken: `${h.tag}-other-subject` }];
    const outcomes = await Promise.allSettled(attempts.map(attempt => useCase.execute(attempt)));
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason instanceof ForbiddenException).length, 1);
    const winner = attempts[outcomes.findIndex(result => result.status === 'fulfilled')];
    const before = await h.snapshot();
    assert.deepEqual(await useCase.execute(winner), { linked: true });
    assert.deepEqual(await h.snapshot(), before);
  }));

  for (const reason of ['foreign', 'ambiguous', 'disabled', 'expired', 'revoked', 'invalid-proof', 'historic-used']) {
    it(`refuses ${reason} without modifying identities, QR or rights`, async () => withQrFixture(async (h) => {
      const canonical = reason === 'disabled' || reason === 'historic-used' ? await h.identity(h.subject) : null;
      if (reason === 'foreign') await h.identity(h.subject, `${h.tag}-unapproved`);
      if (reason === 'ambiguous') { await h.identity(h.subject, h.loginChannelId); await h.identity(h.subject, 'unknown'); }
      if (reason === 'disabled') { await h.client.externalIdentity.update({ where: { id: canonical.id }, data: { status: 'DISABLED' } }); await h.identity(h.subject, h.loginChannelId); }
      const { token, input } = await h.issue();
      if (reason === 'expired') await h.client.employeeLineLinkToken.update({ where: { id: token.id }, data: { expiresAt: new Date(0) } });
      if (reason === 'revoked') await h.client.employeeLineLinkToken.update({ where: { id: token.id }, data: { status: 'REVOKED' } });
      if (reason === 'historic-used') await h.client.employeeLineLinkToken.update({ where: { id: token.id }, data: { status: 'USED', usedAt: new Date() } });
      const before = await h.snapshot();
      await assert.rejects(h.build().execute({ ...input, ...(reason === 'invalid-proof' ? { idToken: 'bad' } : {}) }),
        (error: unknown) => error instanceof ForbiddenException || error instanceof ConflictException);
      assert.deepEqual(await h.snapshot(), before);
    }));
  }

  for (const lane of ['account', 'admin']) for (const mutation of ['owner', 'revision']) {
    it(`keeps current identity/context/handoff when ${lane} unlink races a newer ${mutation}`, async () => withQrFixture(async (h) => {
      if (lane === 'account') await h.client.user.update({ where: { id: h.userId }, data: { username: `${h.tag}-login`,
        credential: { create: { passwordHash: hashPassword('Synthetic-backup-password-123!'), status: 'ACTIVE' } },
      } });
      const identity = await h.identity();
      await h.client.lineCompanyContext.create({ data: { lineUserId: h.oldSubject, companyId: h.companyId } });
      await h.client.lineWebHandoffToken.create({ data: { tokenHash: h.tag, userId: h.userId,
        companyId: h.companyId, lineUserId: h.oldSubject, targetPath: '/', surface: 'synthetic', expiresAt: new Date(Date.now() + 60_000) } });
      let before: any;
      const db = { client: { companyMembership: h.client.companyMembership, externalIdentity: {
        findFirst: async (args: any) => {
          const observed = await h.client.externalIdentity.findFirst(args);
          await h.client.externalIdentity.update({ where: { id: identity.id }, data: {
            ...(mutation === 'owner' ? { userId: h.otherUser } : {}), updatedAt: new Date(Date.now() + 1000),
          } });
          before = await h.snapshot(); return observed;
        },
      }, $transaction: (work: any) => h.client.$transaction(work) } };
      const action = lane === 'account' ? new UnlinkLineIdentityUseCase(db as any).execute({ userId: h.userId, requestId: h.tag })
        : new PartnerMemberLineUnlinkUseCase(db as any).execute({ companyId: h.companyId, memberUserId: h.userId, requestingAdminUserId: h.otherUser, requestId: h.tag });
      await assert.rejects(action, ConflictException);
      assert.deepEqual(await h.snapshot(), before);
    }));
  }
});
