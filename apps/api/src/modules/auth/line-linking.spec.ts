import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { LinkLineIdentityUseCase } from './application/use-cases/link-line-identity.use-case';
import { UnlinkLineIdentityUseCase } from './application/use-cases/unlink-line-identity.use-case';
import { LineChannelBindingService } from './application/line-channel-binding.service';

const lineVerifier = { verify: async () => ({ subject: 'line-user-1' }) } as any;
const config = { lineLoginChannelId: 'login-ch-1', lineMessagingChannelId: 'msg-ch-1' } as any;
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
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
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
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' }),
      (err: unknown) => {
        assert.ok(err instanceof ConflictException);
        assert.ok((err as ConflictException).message.includes('another user'));
        return true;
      },
    );
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
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
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
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
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
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
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
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
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
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
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
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });

    assert.equal(result.linked, true);
    assert.equal(upserted.length, 0);
  });

  it('explicit companyId with multiple non-owner memberships throws ForbiddenException', async () => {
    const prisma = {
      client: {
        externalIdentity: { findFirst: async () => null, create: async () => ({}) },
        companyMembership: { findMany: async () => [staffMembership('co-1'), staffMembership('co-2')] },
        lineCompanyContext: { upsert: async () => {} },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1', companyId: 'co-2' }),
      (err: unknown) => { assert.ok(err instanceof ForbiddenException); return true; },
    );
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
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });
    assert.equal(result.linked, true);
    assert.equal(wheres.length, 1);
    assert.equal(wheres[0].providerChannelId, 'msg-ch-1');
  });

  it('falls back to a legacy-channel row and reactivates it in place', async () => {
    const updates: any[] = [];
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async (args: any) =>
            args.where.providerChannelId
              ? null
              : { id: 'ei-legacy', userId: 'user-1', status: 'UNLINKED', providerChannelId: 'legacy-ch' },
          update: async (args: any) => { updates.push(args); return {}; },
        },
        companyMembership: { findMany: async () => [ownerMembership()] },
        lineCompanyContext: { upsert: async () => {} },
      },
    } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, config);
    const result = await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' });
    assert.equal(result.linked, true);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].where.id, 'ei-legacy');
    assert.equal(updates[0].data.status, 'ACTIVE');
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
    const uc = new LinkLineIdentityUseCase(recordingVerifier, prisma, config);

    await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1', expectedNonce: 'n7' });
    assert.deepEqual(verifyCalls[0], ['tok', { nonce: 'n7' }]);

    // The LIFF/link surfaces mint no nonce, so they must stay byte-exact.
    await uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-2' });
    assert.deepEqual(verifyCalls[1], ['tok', undefined]);
  });

  it('fails closed in production when no LINE channel is configured', async () => {
    const prisma = { client: { externalIdentity: { findFirst: async () => null } } } as any;
    const prodConfig = { lineMessagingChannelId: undefined, lineLoginChannelId: undefined, isProduction: true } as any;
    const uc = new LinkLineIdentityUseCase(lineVerifier, prisma, prodConfig);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', idToken: 'tok', requestId: 'req-1' }),
      (err: unknown) => { assert.ok(err instanceof ServiceUnavailableException); return true; },
    );
  });
});

// ---- UnlinkLineIdentityUseCase ----

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

  it('sets status UNLINKED and returns unlinked=true', async () => {
    const updated: unknown[] = [];
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ id: 'ei-1', userId: 'user-1' }),
          update: async (args: unknown) => { updated.push(args); return {}; },
        },
      },
    } as any;
    const uc = new UnlinkLineIdentityUseCase(prisma);
    const result = await uc.execute({ userId: 'user-1', requestId: 'req-1' });

    assert.equal(result.unlinked, true);
    assert.equal(updated.length, 1);
    assert.equal((updated[0] as any).data.status, 'UNLINKED');
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
