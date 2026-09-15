import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { LinkLineIdentityUseCase } from './application/use-cases/link-line-identity.use-case';
import { UnlinkLineIdentityUseCase } from './application/use-cases/unlink-line-identity.use-case';
import { LineChannelBindingService } from './application/line-channel-binding.service';

const lineVerifier = { verify: async () => ({ subject: 'line-user-1' }) } as any;
const config = { lineLoginChannelId: 'login-ch-1', lineMessagingChannelId: 'msg-ch-1' } as any;
/**
 * Review MED-1: the identity slot is now decided inside ONE transaction holding the shared
 * `line-identity:<channel>:<providerUserId>` advisory key, so every fake needs the two members the
 * use case reaches for. The lock keys are recorded, not merely swallowed, so a spec can prove the
 * key is taken and that it matches the one signup provisioning takes.
 */
const identityLocks: unknown[][] = [];
/** Every re-point revokes the previous holder's PENDING handoff links inside the same transaction,
 *  so the delegate belongs to the tx harness; a spec that cares passes its own recorder instead. */
const handoffRevokes: any[] = [];
function withIdentityTx(prisma: any): any {
  prisma.client.$transaction = async (fn: any) => fn(prisma.client);
  prisma.client.$executeRaw = async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    identityLocks.push(values);
    return 0;
  };
  prisma.client.lineWebHandoffToken ??= {
    updateMany: async (args: unknown) => { handoffRevokes.push(args); return { count: 0 }; },
  };
  prisma.client.externalIdentity.findMany ??= async () => [];
  prisma.client.externalIdentity.update ??= async () => ({});
  prisma.client.auditLog ??= { create: async () => ({}) };
  prisma.client.passwordResetToken ??= { updateMany: async () => ({ count: 0 }) };
  return prisma;
}

const ownerMembership = (companyId = 'co-1') => ({ companyId, roles: [{ role: { key: 'OWNER' } }] });
const staffMembership = (companyId = 'co-1') => ({ companyId, roles: [{ role: { key: 'STAFF' } }] });

// ---- LinkLineIdentityUseCase ----

describe('LinkLineIdentityUseCase', () => {
  it('returns linked=true (no conflict) when same user already linked', async () => {
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ id: 'ei-1', userId: 'user-1', status: 'ACTIVE', providerChannelId: 'msg-ch-1' }),
        },
        companyMembership: { findMany: async () => [ownerMembership()] },
        lineCompanyContext: { upsert: async () => {} },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });
    assert.equal(result.linked, true);
    assert.equal(result.providerUserId, 'line-user-1');
  });

  it('throws ConflictException when different user already linked', async () => {
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ id: 'ei-1', userId: 'other-user', status: 'ACTIVE', providerChannelId: 'msg-ch-1' }),
        },
        companyMembership: { findMany: async () => [ownerMembership()] },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' }),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.ok((err as ConflictException).message.includes('another user'));
        return true;
      },
    );
  });

  it('revokes the previous holder PENDING handoff links when an admin QR re-points the identity', async () => {
    const revokes: any[] = [];
    const updates: any[] = [];
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ id: 'ei-1', userId: 'other-user', status: 'ACTIVE', providerChannelId: 'msg-ch-1' }),
          update: async (args: any) => { updates.push(args); return {}; },
        },
        companyMembership: { findMany: async () => [ownerMembership()] },
        lineCompanyContext: { upsert: async () => {} },
        lineWebHandoffToken: {
          updateMany: async (args: any) => { revokes.push(args); return { count: 2 }; },
        },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1', allowReassign: true });

    assert.equal(updates[0].data.userId, 'user-1');
    // Owner decision 2026-09-06: the links already in that chat name `other-user`, so a tap after
    // the move would hand the NEW holder of the LINE account the OLD owner's web session.
    assert.deepEqual(revokes, [{
      where: { lineUserId: 'line-user-1', userId: 'other-user', status: 'PENDING' },
      data: { status: 'REVOKED' },
    }]);
  });

  it('revokes nothing when the same user re-links — their own links stay tappable', async () => {
    const revokes: any[] = [];
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ id: 'ei-1', userId: 'user-1', status: 'ACTIVE', providerChannelId: 'msg-ch-1' }),
        },
        companyMembership: { findMany: async () => [ownerMembership()] },
        lineCompanyContext: { upsert: async () => {} },
        lineWebHandoffToken: {
          updateMany: async (args: any) => { revokes.push(args); return { count: 0 }; },
        },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });
    assert.deepEqual(revokes, []);
  });

  it('creates identity and returns linked=true when not found', async () => {
    const created: unknown[] = [];
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => null,
          create: async (args: unknown) => { created.push(args); return {}; },
        },
        companyMembership: { findMany: async () => [ownerMembership()] },
        lineCompanyContext: { upsert: async () => {} },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });

    assert.equal(result.linked, true);
    assert.equal(result.providerUserId, 'line-user-1');
    assert.equal(created.length, 1);
    const data = (created[0] as any).data;
    assert.equal(data.provider, 'LINE');
    assert.equal(data.status, 'ACTIVE');
    assert.equal(data.providerChannelId, 'msg-ch-1');
  });

  it('same-user relink refreshes LineCompanyContext and returns linked=true (no conflict)', async () => {
    const upserted: unknown[] = [];
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ id: 'ei-1', userId: 'user-1', status: 'ACTIVE', providerChannelId: 'msg-ch-1' }),
        },
        companyMembership: { findMany: async () => [ownerMembership('co-1')] },
        lineCompanyContext: { upsert: async (args: unknown) => { upserted.push(args); return {}; } },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });

    assert.equal(result.linked, true);
    assert.equal(upserted.length, 1);
    assert.equal((upserted[0] as any).create.companyId, 'co-1');
  });

  it('new link with single membership auto-upserts LineCompanyContext', async () => {
    const upserted: unknown[] = [];
    const prisma = {
      client: {
        externalIdentity: { findFirst: async () => null, create: async () => ({}) },
        companyMembership: { findMany: async () => [ownerMembership('co-1')] },
        lineCompanyContext: { upsert: async (args: unknown) => { upserted.push(args); return {}; } },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });

    assert.equal(upserted.length, 1);
    assert.equal((upserted[0] as any).create.companyId, 'co-1');
  });

  it('new link with explicit valid companyId upserts LineCompanyContext', async () => {
    const upserted: unknown[] = [];
    const prisma = {
      client: {
        externalIdentity: { findFirst: async () => null, create: async () => ({}) },
        companyMembership: { findMany: async () => [ownerMembership('co-1'), ownerMembership('co-2')] },
        lineCompanyContext: { upsert: async (args: unknown) => { upserted.push(args); return {}; } },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1', companyId: 'co-2' });

    assert.equal(upserted.length, 1);
    assert.equal((upserted[0] as any).create.companyId, 'co-2');
  });

  it('new link with invalid companyId (no active membership) throws ForbiddenException', async () => {
    const created: unknown[] = [];
    const prisma = {
      client: {
        externalIdentity: { findFirst: async () => null, create: async (args: unknown) => { created.push(args); return {}; } },
        companyMembership: { findMany: async () => [ownerMembership('co-1')] },
        lineCompanyContext: { upsert: async () => {} },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1', companyId: 'co-bad' }),
      (err: unknown) => { assert.ok(err instanceof ForbiddenException); return true; },
    );
    assert.equal(created.length, 0);
  });

  it('new link with multiple memberships and no companyId skips LineCompanyContext write', async () => {
    const upserted: unknown[] = [];
    const prisma = {
      client: {
        externalIdentity: { findFirst: async () => null, create: async () => ({}) },
        companyMembership: { findMany: async () => [ownerMembership('co-1'), ownerMembership('co-2')] },
        lineCompanyContext: { upsert: async (args: unknown) => { upserted.push(args); return {}; } },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });

    assert.equal(result.linked, true);
    assert.equal(upserted.length, 0);
  });

  // Owner decision 2026-08-29: linking with an explicit company is login-level. The old rule threw
  // Forbidden for any multi-company non-owner; membership validation is the boundary that remains.
  it('explicit companyId with multiple non-owner memberships links and sets that context', async () => {
    const upserted: any[] = [];
    const prisma = {
      client: {
        externalIdentity: { findFirst: async () => null, create: async () => ({}) },
        companyMembership: { findMany: async () => [staffMembership('co-1'), staffMembership('co-2')] },
        lineCompanyContext: { upsert: async (args: any) => { upserted.push(args); } },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1', companyId: 'co-2' });

    assert.equal(result.linked, true);
    assert.equal(upserted[0]?.create.companyId, 'co-2');
  });

  it('prefers the canonical-channel row when looking up an existing identity', async () => {
    const wheres: any[] = [];
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async (args: any) => {
            wheres.push(args.where);
            return { id: 'ei-1', userId: 'user-1', status: 'ACTIVE', providerChannelId: 'msg-ch-1' };
          },
        },
        companyMembership: { findMany: async () => [ownerMembership()] },
        lineCompanyContext: { upsert: async () => {} },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });
    assert.equal(result.linked, true);
    assert.equal(wheres.length, 1);
    assert.equal(wheres[0].providerChannelId, 'msg-ch-1');
  });

  it('repairs a proved known legacy binding in place through an admin QR', async () => {
    const updates: any[] = [];
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => null,
          findMany: async () => [{ id: 'ei-legacy', userId: 'user-1', status: 'UNLINKED', providerChannelId: 'login-ch-1' }],
          update: async (args: any) => { updates.push(args); return {}; },
        },
        companyMembership: { findMany: async () => [ownerMembership()] },
        lineCompanyContext: { upsert: async () => {} },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1', allowReassign: true });
    assert.equal(result.linked, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].where.id, 'ei-legacy');
    assert.equal(updates[0].data.status, 'ACTIVE');
    assert.equal(updates[0].data.providerChannelId, 'msg-ch-1');
  });

  it('asks LINE to check the nonce claim only when the web OAuth link supplies one', async () => {
    const verifyCalls: unknown[][] = [];
    const recordingVerifier = {
      verify: async (...args: unknown[]) => { verifyCalls.push(args); return { subject: 'line-user-1' }; },
    } as any;
    const prisma = {
      client: {
        externalIdentity: { findFirst: async () => null, create: async () => ({}) },
        companyMembership: { findMany: async () => [ownerMembership()] },
        lineCompanyContext: { upsert: async () => {} },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(recordingVerifier, withIdentityTx(prisma), config);

    await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1', expectedNonce: 'n7' });
    assert.deepEqual(verifyCalls[0], ['tok', { nonce: 'n7' }]);

    // The LIFF/link surfaces mint no nonce, so they must stay byte-exact.
    await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-2' });
    assert.deepEqual(verifyCalls[1], ['tok', undefined]);
  });

  it('fails closed in production when no LINE channel is configured', async () => {
    const prisma = { client: { externalIdentity: { findFirst: async () => null } } } as any;
    const prodConfig = { lineMessagingChannelId: undefined, lineLoginChannelId: undefined, isProduction: true } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, withIdentityTx(prisma), prodConfig);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' }),
      (err: unknown) => { assert.ok(err instanceof ServiceUnavailableException); return true; },
    );
  });
});

// ---- UnlinkLineIdentityUseCase ----

type HandoffRow = { id: string; lineUserId: string; userId: string; status: string };

/** The unlink's three writes share one transaction, so the fake hands the same delegates to the
 *  callback. `lineWebHandoffToken.updateMany` really applies its WHERE to `handoffRows` — a spec
 *  that only recorded the call could not tell a correct filter from one that revokes the wrong
 *  rows, which is the whole risk in a query keyed on two columns and a status. */
function makeUnlinkPrisma(handoffRows: HandoffRow[] = []) {
  const updated: unknown[] = [];
  const contextDeletes: unknown[] = [];
  const ops = {
    passwordResetToken: { updateMany: async () => ({ count: 0 }) },
    externalIdentity: {
      findFirst: async () => ({ id: 'ei-1', userId: 'user-1', providerUserId: 'Uline-1', updatedAt: new Date(0) }),
      updateMany: async (args: unknown) => { updated.push(args); return { count: 1 }; },
    },
    lineCompanyContext: {
      deleteMany: async (args: unknown) => { contextDeletes.push(args); return { count: 1 }; },
    },
    lineWebHandoffToken: {
      updateMany: async ({ where, data }: any) => {
        const hit = handoffRows.filter((r) =>
          r.lineUserId === where.lineUserId && r.userId === where.userId && r.status === where.status);
        for (const r of hit) r.status = data.status;
        return { count: hit.length };
      },
    },
  };
  const prisma = { client: { ...ops, $transaction: async (fn: any) => fn(ops) } } as any;
  return { prisma, updated, contextDeletes, handoffRows };
}

describe('UnlinkLineIdentityUseCase', () => {
  it('throws NotFoundException when no linked identity', async () => {
    const prisma = {
      client: {
        externalIdentity: { findFirst: async () => null },
      },
    } as any;
    const uc = new UnlinkLineIdentityUseCase(prisma);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', requestId: 'req-1' }),
      (err: unknown) => { assert.ok(err instanceof NotFoundException); return true; },
    );
  });

  it('sets status UNLINKED, clears the selected-company row, and returns unlinked=true', async () => {
    const { prisma, updated, contextDeletes } = makeUnlinkPrisma();
    const uc = new UnlinkLineIdentityUseCase(prisma);
    const result = await uc.execute({ userId: 'user-1', requestId: 'req-1' });

    assert.equal(result.unlinked, true);
    assert.equal(updated.length, 1);
    assert.equal((updated[0] as any).data.status, 'UNLINKED');
    // line-support-request-spec-th §2.5: the row outlived the identity, so a support request
    // named a shop this LINE account had left — and a 24h assistant pause hung on a severed one.
    assert.deepEqual(contextDeletes, [{ where: { lineUserId: 'Uline-1' } }]);
  });

  it('revokes this identity PENDING handoff links and leaves every other row alone', async () => {
    // Owner decision 2026-09-06: an unspent handoff link is a ≤15-minute bearer session sitting in
    // the chat being severed. Only the first row may change.
    const rows: HandoffRow[] = [
      { id: 'mine-pending', lineUserId: 'Uline-1', userId: 'user-1', status: 'PENDING' },
      { id: 'mine-used', lineUserId: 'Uline-1', userId: 'user-1', status: 'USED' },
      { id: 'mine-expired', lineUserId: 'Uline-1', userId: 'user-1', status: 'EXPIRED' },
      // The same LINE account after a relink to somebody else, and the same person on another
      // LINE account: matching on ONE of the two columns would wrongly burn one of these.
      { id: 'other-user-same-line', lineUserId: 'Uline-1', userId: 'user-2', status: 'PENDING' },
      { id: 'same-user-other-line', lineUserId: 'Uline-9', userId: 'user-1', status: 'PENDING' },
    ];
    const { prisma } = makeUnlinkPrisma(rows);
    const audits: any[] = [];
    const uc = new UnlinkLineIdentityUseCase(prisma, { log: async (e: unknown) => { audits.push(e); } } as any);

    await uc.execute({ userId: 'user-1', requestId: 'req-1' });

    assert.deepEqual(
      rows.map((r) => `${r.id}:${r.status}`),
      ['mine-pending:REVOKED', 'mine-used:USED', 'mine-expired:EXPIRED',
        'other-user-same-line:PENDING', 'same-user-other-line:PENDING'],
    );
    // One row per unlink, naming how many links it killed.
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'auth.identity.unlink');
    assert.deepEqual(audits[0].metadataJson, { handoffLinksRevoked: 1 });
  });

  it('reports zero revoked when the chat held no unspent links', async () => {
    const { prisma } = makeUnlinkPrisma();
    const audits: any[] = [];
    const uc = new UnlinkLineIdentityUseCase(prisma, { log: async (e: unknown) => { audits.push(e); } } as any);
    await uc.execute({ userId: 'user-1', requestId: 'req-1' });
    assert.deepEqual(audits[0].metadataJson, { handoffLinksRevoked: 0 });
  });
});

// ---- LineChannelBindingService ----

describe('LineChannelBindingService', () => {
  it('returns null when no binding found', async () => {
    const prisma = {
      client: {
        lineChannelBinding: { findFirst: async () => null },
      },
    } as any;
    const svc = new LineChannelBindingService(prisma);
    const result = await svc.getBindingForChannel('ch-missing');
    assert.equal(result, null);
  });

  it('returns companyId when binding found', async () => {
    const prisma = {
      client: {
        lineChannelBinding: {
          findFirst: async () => ({ companyId: 'co-1' }),
        },
      },
    } as any;
    const svc = new LineChannelBindingService(prisma);
    const result = await svc.getBindingForChannel('ch-1');
    assert.deepEqual(result, { companyId: 'co-1' });
  });
});
