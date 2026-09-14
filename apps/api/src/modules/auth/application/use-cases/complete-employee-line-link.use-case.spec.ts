import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { CompleteEmployeeLineLinkUseCase } from './complete-employee-line-link.use-case';

// Transactional semantics are also exercised against actual PostgreSQL in line-binding.pg.spec.ts.
function harness(fault?: 'verify' | 'link' | 'sever' | 'handoff' | 'audit' | 'membership') {
  let state = {
    token: { id: 'token', userId: 'user', companyId: 'company', membershipId: 'member', status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000), usedAt: null, claimedLineUserId: null, claimedLineChannelId: null } as any,
    linked: false,
    old: { id: 'old', userId: 'user', providerUserId: 'old-line', status: 'ACTIVE', updatedAt: new Date(0) },
    deletedContexts: 0, revoked: 0, recoveryRevoked: 0, audits: [] as any[],
  };
  const events: string[] = [];
  const fails: any[] = [];
  const tx = {
    passwordResetToken: { updateMany: async () => { state.recoveryRevoked++; return { count: 1 }; } },
    $executeRaw: async () => undefined,
    employeeLineLinkToken: {
      findUnique: async () => structuredClone(state.token),
      updateMany: async ({ where, data }: any) => {
        events.push('claim');
        if (state.token.status !== where.status || state.token.expiresAt <= where.expiresAt.gt) return { count: 0 };
        Object.assign(state.token, data); return { count: 1 };
      },
    },
    companyMembership: { findFirst: async () => fault === 'membership' ? null : ({ id: 'member' }) },
    externalIdentity: {
      findFirst: async ({ where }: any) => state.linked && where.providerUserId === 'new-line' && where.providerChannelId === 'messaging' && where.userId === 'user' ? { id: 'new' } : null,
      findMany: async () => state.old.status === 'ACTIVE' ? [structuredClone(state.old)] : [],
      updateMany: async ({ where, data }: any) => {
        if (fault === 'sever') throw Error('synthetic failure');
        assert.equal(where.userId, state.old.userId);
        assert.equal(where.updatedAt.getTime(), state.old.updatedAt.getTime());
        state.old.status = data.status; return { count: 1 };
      },
    },
    lineCompanyContext: { deleteMany: async () => { state.deletedContexts++; return { count: 1 }; } },
    lineWebHandoffToken: { updateMany: async () => {
      if (fault === 'handoff') throw Error('synthetic failure');
      state.revoked++; return { count: 1 };
    } },
    auditLog: { create: async ({ data }: any) => {
      if (fault === 'audit') throw Error('synthetic failure');
      state.audits.push(data); return {};
    } },
  };
  const prisma = { client: { ...tx, $transaction: async (work: any) => {
    events.push('transaction'); const before = structuredClone(state);
    try { return await work(tx); } catch (error) { state = before; throw error; }
  } } } as any;
  const link = {
    canonicalChannelId: () => 'messaging',
    linkVerifiedIdentity: async (_input: any, activeTx: any) => {
      assert.equal(activeTx, tx); events.push('link');
      if (fault === 'link') throw Error('synthetic failure');
      state.linked = true; return { linked: true, providerUserId: 'new-line' };
    },
  } as any;
  const verifier = { verify: async (proof: string) => {
    events.push('verify'); if (fault === 'verify') throw new ForbiddenException();
    return { subject: proof };
  } } as any;
  return { useCase: new CompleteEmployeeLineLinkUseCase(prisma, link, verifier, { log: async (event: any) => { fails.push(event); } } as any),
    state: () => state, events, fails };
}
const input = { linkToken: 'synthetic-qr', idToken: 'new-line', requestId: 'request' };

describe('atomic employee LINE QR', () => {
  it('verifies before the transaction and commits claim, link, cleanup and audit together', async () => {
    const h = harness();
    assert.deepEqual(await h.useCase.execute(input), { linked: true });
    assert.deepEqual(h.events, ['verify', 'transaction', 'claim', 'link']);
    const state = h.state();
    assert.equal(state.token.status, 'USED');
    assert.equal(state.token.claimedLineUserId, 'new-line');
    assert.equal(state.token.claimedLineChannelId, 'messaging');
    assert.equal(state.old.status, 'UNLINKED');
    assert.equal(state.recoveryRevoked, 1); assert.equal(state.deletedContexts, 1); assert.equal(state.revoked, 1);
    assert.equal(state.audits.at(-1).action, 'access.employee.line_link.success');
  });
  for (const fault of ['link', 'sever', 'handoff', 'audit'] as const) {
    it(`rolls back every mutation after ${fault} failure so the same QR can retry`, async () => {
      const h = harness(fault), before = structuredClone(h.state());
      await assert.rejects(h.useCase.execute(input), ServiceUnavailableException);
      assert.deepEqual(h.state(), before);
      assert.equal(h.fails.length, 1);
    });
  }
  it('does not burn a pending QR for invalid LINE proof', async () => {
    const h = harness('verify');
    await assert.rejects(h.useCase.execute(input), ForbiddenException);
    assert.deepEqual(h.events, ['verify']); assert.equal(h.state().token.status, 'PENDING');
    assert.equal(h.fails[0].action, 'access.employee.line_link.failure');
  });
  it('checks membership before claiming and again on a used QR', async () => {
    const h = harness('membership');
    await assert.rejects(h.useCase.execute(input), ForbiddenException);
    assert.equal(h.state().token.status, 'PENDING');
    h.state().token.status = 'USED';
    await assert.rejects(h.useCase.execute(input), ForbiddenException);
    assert.equal(h.events.includes('link'), false);
  });
  it('recovers the original response with read-only verification and never severs a later identity', async () => {
    const h = harness(); await h.useCase.execute(input);
    h.state().old.status = 'ACTIVE'; // a later binding must survive an old USED QR
    const before = structuredClone(h.state());
    assert.deepEqual(await h.useCase.execute(input), { linked: true });
    assert.deepEqual(h.state(), before);
    assert.equal(h.events.filter(event => event === 'claim').length, 1);
    await assert.rejects(h.useCase.execute({ ...input, idToken: 'different-line' }), ForbiddenException);
    assert.deepEqual(h.state(), before);
  });
  for (const invalid of ['REVOKED', 'EXPIRED', 'old-used', 'expired-used', 'unlinked-used', 'changed-channel']) {
    it(`requires a new QR for ${invalid}`, async () => {
      const h = harness(); await h.useCase.execute(input);
      if (invalid === 'REVOKED' || invalid === 'EXPIRED') h.state().token.status = invalid;
      if (invalid === 'old-used') h.state().token.claimedLineUserId = null;
      if (invalid === 'expired-used') h.state().token.expiresAt = new Date(0);
      if (invalid === 'unlinked-used') h.state().linked = false;
      if (invalid === 'changed-channel') h.state().token.claimedLineChannelId = 'other';
      const before = structuredClone(h.state());
      await assert.rejects(h.useCase.execute(input), ForbiddenException);
      assert.deepEqual(h.state(), before);
    });
  }
});
