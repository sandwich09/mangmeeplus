import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { CompleteEmployeeLineLinkUseCase } from './complete-employee-line-link.use-case';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function makeUseCase(opts: {
  token?: any;
  membershipActive?: boolean;
  linkThrows?: boolean;
  linkThrowsConflict?: boolean;
  linkThrowsForbidden?: boolean;
  linkedLineUserId?: string;
  linkedIdentityLinkedAt?: Date;
  verifyThrows?: boolean;
  otherActiveIdentities?: Array<{ id: string; providerUserId: string }>;
  newerTokenExists?: boolean;
  restoreThrows?: boolean;
  severThrows?: boolean;
} = {}) {
  const auditEvents: any[] = [];
  const tokenUpdates: any[] = [];
  const identityUpdates: any[] = [];
  const handoffRevokes: any[] = [];
  // Interleaved operation log: proves the claim happens BEFORE the identity link (H-09).
  const ops: string[] = [];

  const defaultToken = {
    id: 'token-1',
    companyId: 'company-1',
    membershipId: 'membership-1',
    userId: 'user-1',
    tokenHash: hashToken('raw-token'),
    status: 'PENDING',
    usedAt: null,
    createdAt: new Date(Date.now() - 60_000),
    expiresAt: new Date(Date.now() + 60_000),
  };
  const token = opts.token === undefined ? defaultToken : opts.token;

  const prisma = {
    client: {
      employeeLineLinkToken: {
        findUnique: async () => token,
        findFirst: async () => (opts.newerTokenExists ? { id: 'token-newer' } : null),
        // Atomic status CAS like the real updateMany: the transition only lands when
        // the current status matches the WHERE clause.
        updateMany: async ({ where, data }: any) => {
          if (opts.restoreThrows && where.status === 'USED' && data.status === 'PENDING') {
            ops.push('token:restore-throws');
            throw new Error('db down');
          }
          tokenUpdates.push({ where, data });
          ops.push(`token:${where.status}->${data.status}`);
          if (!token || token.status !== where.status) return { count: 0 };
          token.status = data.status;
          return { count: 1 };
        },
      },
      companyMembership: {
        findFirst: async () => (opts.membershipActive === false ? null : { id: 'membership-1', status: 'ACTIVE' }),
      },
      externalIdentity: {
        findFirst: async ({ where }: any) =>
          opts.linkedLineUserId && where.providerUserId === opts.linkedLineUserId && where.userId === 'user-1'
            ? { id: 'identity-1', linkedAt: opts.linkedIdentityLinkedAt ?? new Date() }
            : null,
        findMany: async () => opts.otherActiveIdentities ?? [],
        updateMany: async ({ where, data }: any) => {
          if (opts.severThrows) throw new Error('db down');
          identityUpdates.push({ where, data });
          ops.push('identity:sever-others');
          return { count: (opts.otherActiveIdentities ?? []).length };
        },
      },
      // The severed phone keeps whatever handoff deep links were sent to it; each is a bearer
      // session for this employee until its TTL expires, so the sever kills them too.
      lineWebHandoffToken: {
        updateMany: async (args: any) => { handoffRevokes.push(args); return { count: 2 }; },
      },
    },
  } as any;

  const linkCalls: any[] = [];
  const linkLineIdentity = {
    execute: async (linkInput: any) => {
      linkCalls.push(linkInput);
      ops.push('link');
      if (opts.linkThrowsConflict) throw new ConflictException('LINE account already linked to another user.');
      if (opts.linkThrowsForbidden) throw new ForbiddenException('LINE identity is disabled.');
      if (opts.linkThrows) throw new Error('LINE verify failed');
      return { linked: true, providerUserId: 'line-user-1' };
    },
  } as any;

  const lineVerifier = {
    verify: async () => {
      if (opts.verifyThrows) throw new Error('LINE verify failed');
      return { subject: 'line-user-1' };
    },
  } as any;

  const audit = { log: async (entry: any) => { auditEvents.push(entry); } } as any;

  const useCase = new CompleteEmployeeLineLinkUseCase(prisma, linkLineIdentity, lineVerifier, audit);
  return { useCase, auditEvents, tokenUpdates, identityUpdates, handoffRevokes, linkCalls, ops, token };
}

const input = { linkToken: 'raw-token', idToken: 'line-id-token', requestId: 'req-1' };

describe('CompleteEmployeeLineLinkUseCase', () => {
  it('links successfully and marks the token used exactly once', async () => {
    const { useCase, auditEvents, linkCalls, token } = makeUseCase();
    const result = await useCase.execute(input);

    assert.deepEqual(result, { linked: true });
    assert.equal(linkCalls[0].allowReassign, true);
    assert.equal(token.status, 'USED');
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].action, 'access.employee.line_link.success');
  });

  it('claims the token atomically BEFORE linking the identity (H-09 ordering)', async () => {
    const { useCase, ops } = makeUseCase();
    await useCase.execute(input);

    assert.ok(ops.indexOf('token:PENDING->USED') < ops.indexOf('link'), `claim must precede link, got: ${ops.join(', ')}`);
  });

  it('gives exactly one winner when two LINE identities race the same token — the loser never links (H-09)', async () => {
    const { useCase, linkCalls, token } = makeUseCase();
    const [first, second] = await Promise.allSettled([
      useCase.execute({ linkToken: 'raw-token', idToken: 'line-id-token-A', requestId: 'req-A' }),
      useCase.execute({ linkToken: 'raw-token', idToken: 'line-id-token-B', requestId: 'req-B' }),
    ]);

    const outcomes = [first, second];
    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1);
    const loser = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
    assert.match(String(loser.reason?.message), /invalid, expired, or already used/);
    // No orphan side effect: only the winner's identity was ever linked.
    assert.equal(linkCalls.length, 1);
    assert.equal(token.status, 'USED');
  });

  it('burns the token (no restore) when the link fails for an unknown reason — a restore could resurrect a persisted link or a revoked QR', async () => {
    const { useCase, ops, token, auditEvents } = makeUseCase({ linkThrows: true });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);

    assert.equal(token.status, 'USED');
    assert.deepEqual(ops, ['token:PENDING->USED', 'link']);
    assert.equal(auditEvents[0].metadataJson.reason, 'line_verification_failed');
  });

  it('releases the claim (token back to PENDING) on a pre-write forbidden failure', async () => {
    const { useCase, tokenUpdates, ops, token, auditEvents } = makeUseCase({ linkThrowsForbidden: true });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);

    assert.equal(token.status, 'PENDING');
    assert.deepEqual(ops, ['token:PENDING->USED', 'link', 'token:USED->PENDING']);
    const restore = tokenUpdates.at(-1);
    assert.equal(restore.where.status, 'USED');
    assert.deepEqual(restore.data, { status: 'PENDING', usedAt: null });
    assert.equal(auditEvents[0].metadataJson.reason, 'line_verification_failed');
  });

  it('releases the claim before surfacing an identity conflict', async () => {
    const { useCase, token, auditEvents } = makeUseCase({ linkThrowsConflict: true });
    await assert.rejects(() => useCase.execute(input), /already linked to another user/);

    assert.equal(token.status, 'PENDING');
    assert.equal(auditEvents[0].metadataJson.reason, 'line_identity_conflict');
  });

  it('re-revokes the restored token when a newer token was issued during the claim window', async () => {
    const { useCase, token, ops } = makeUseCase({ linkThrowsConflict: true, newerTokenExists: true });
    await assert.rejects(() => useCase.execute(input), /already linked to another user/);

    assert.equal(token.status, 'REVOKED');
    assert.deepEqual(ops, ['token:PENDING->USED', 'link', 'token:USED->PENDING', 'token:PENDING->REVOKED']);
  });

  it('leaves the token burned (fail closed) when the release itself fails', async () => {
    const { useCase, token } = makeUseCase({ linkThrowsConflict: true, restoreThrows: true });
    await assert.rejects(() => useCase.execute(input), /already linked to another user/);
    assert.equal(token.status, 'USED');
  });

  it('severs other ACTIVE LINE identities of the user after a successful relink (identity cardinality)', async () => {
    const { useCase, identityUpdates, auditEvents, handoffRevokes } = makeUseCase({
      otherActiveIdentities: [{ id: 'identity-old', providerUserId: 'line-user-old' }],
    });
    await useCase.execute(input);

    assert.equal(identityUpdates.length, 1);
    assert.deepEqual(identityUpdates[0].where, { id: { in: ['identity-old'] }, status: 'ACTIVE' });
    assert.deepEqual(identityUpdates[0].data, { status: 'UNLINKED' });

    // Owner decision 2026-09-06: severing the old phone's identity is not enough while the deep
    // links already delivered to it still exchange into this employee's session.
    assert.deepEqual(handoffRevokes, [{
      where: { lineUserId: 'line-user-old', userId: 'user-1', status: 'PENDING' },
      data: { status: 'REVOKED' },
    }]);

    const unlinkAudit = auditEvents.find((event) => event.action === 'auth.identity.unlink');
    assert.ok(unlinkAudit, 'per-identity AUTH_IDENTITY_UNLINK audit must be emitted');
    assert.equal(unlinkAudit.targetId, 'identity-old');
    assert.equal(unlinkAudit.metadataJson.severedProviderUserId, 'line-user-old');
    assert.equal(unlinkAudit.metadataJson.keptProviderUserId, 'line-user-1');
    assert.equal(unlinkAudit.metadataJson.handoffTokensRevoked, 2);

    const successAudit = auditEvents.find((event) => event.action === 'access.employee.line_link.success');
    assert.equal(successAudit.metadataJson.unlinkedPreviousLineIdentities, 1);
  });

  it('omits the sever metadata when the user had no other LINE identity', async () => {
    const { useCase, auditEvents } = makeUseCase();
    await useCase.execute(input);
    assert.equal(auditEvents[0].metadataJson, undefined);
  });

  it('still succeeds and flags the audit when the sever fails after a committed link', async () => {
    const { useCase, auditEvents, token } = makeUseCase({
      otherActiveIdentities: [{ id: 'identity-old', providerUserId: 'line-user-old' }],
      severThrows: true,
    });
    const result = await useCase.execute(input);

    assert.deepEqual(result, { linked: true });
    assert.equal(token.status, 'USED');
    const successAudit = auditEvents.find((event) => event.action === 'access.employee.line_link.success');
    assert.equal(successAudit.metadataJson.lineIdentitySeverFailed, true);
  });

  it('rejects an unknown token', async () => {
    const { useCase } = makeUseCase({ token: null });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);
  });

  it('rejects an already-used token when the LINE user was never linked', async () => {
    const { useCase } = makeUseCase({ token: { ...makeUseCase().token, status: 'USED' } });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);
  });

  it('treats a re-scan of a used token by the already-linked LINE user as success', async () => {
    const { useCase, tokenUpdates, linkCalls } = makeUseCase({
      token: { ...makeUseCase().token, status: 'USED' },
      linkedLineUserId: 'line-user-1',
    });
    const result = await useCase.execute(input);

    assert.deepEqual(result, { linked: true });
    assert.equal(tokenUpdates.length, 0);
    assert.equal(linkCalls.length, 0);
  });

  it('self-heals a missed sever on re-scan of a used token', async () => {
    const { useCase, identityUpdates } = makeUseCase({
      token: { ...makeUseCase().token, status: 'USED', usedAt: new Date(Date.now() - 5_000) },
      linkedLineUserId: 'line-user-1',
      otherActiveIdentities: [{ id: 'identity-old', providerUserId: 'line-user-old' }],
    });
    const result = await useCase.execute(input);

    assert.deepEqual(result, { linked: true });
    assert.equal(identityUpdates.length, 1);
    assert.deepEqual(identityUpdates[0].where.id, { in: ['identity-old'] });
  });

  it('denies the grace path to an identity linked BEFORE the claim — the old phone cannot ride a used QR to sever the new account', async () => {
    const usedAt = new Date();
    const { useCase, identityUpdates } = makeUseCase({
      token: { ...makeUseCase().token, status: 'USED', usedAt },
      linkedLineUserId: 'line-user-1',
      linkedIdentityLinkedAt: new Date(usedAt.getTime() - 60_000),
      otherActiveIdentities: [{ id: 'identity-new', providerUserId: 'line-user-new' }],
    });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);
    assert.equal(identityUpdates.length, 0);
  });

  it('rejects a used token when the re-scanning LINE user is someone else', async () => {
    const { useCase } = makeUseCase({
      token: { ...makeUseCase().token, status: 'USED' },
      linkedLineUserId: 'line-user-other',
    });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);
  });

  it('rejects a used token when LINE verification fails during the re-scan check', async () => {
    const { useCase } = makeUseCase({
      token: { ...makeUseCase().token, status: 'USED' },
      linkedLineUserId: 'line-user-1',
      verifyThrows: true,
    });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);
  });

  it('rejects an expired token', async () => {
    const expired = { ...makeUseCase().token, expiresAt: new Date(Date.now() - 1000) };
    const { useCase } = makeUseCase({ token: expired });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);
  });

  it('rejects when the membership is no longer active without burning the token', async () => {
    const { useCase, token, tokenUpdates } = makeUseCase({ membershipActive: false });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);
    assert.equal(token.status, 'PENDING');
    assert.equal(tokenUpdates.length, 0);
  });

  it('rejects and audits without revealing the token value on LINE verification failure', async () => {
    const { useCase, auditEvents } = makeUseCase({ linkThrows: true });
    await assert.rejects(() => useCase.execute(input), /invalid, expired, or already used/);
    assert.equal(auditEvents[0].action, 'access.employee.line_link.failure');
    assert.ok(!JSON.stringify(auditEvents).includes('raw-token'));
  });

  it('surfaces the real message when the LINE account is already linked to another user', async () => {
    const { useCase, auditEvents } = makeUseCase({ linkThrowsConflict: true });
    // Masking this as a token error sends users hunting for new QR codes that can never work.
    await assert.rejects(() => useCase.execute(input), /already linked to another user/);
    assert.equal(auditEvents[0].action, 'access.employee.line_link.failure');
    assert.equal(auditEvents[0].metadataJson.reason, 'line_identity_conflict');
    assert.ok(!JSON.stringify(auditEvents).includes('raw-token'));
  });

  it('never includes the raw token in any audit metadata on success', async () => {
    const { useCase, auditEvents } = makeUseCase();
    await useCase.execute(input);
    assert.ok(!JSON.stringify(auditEvents).includes('raw-token'));
  });
});
