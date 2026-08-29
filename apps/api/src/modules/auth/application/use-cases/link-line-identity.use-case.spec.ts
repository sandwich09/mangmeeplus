import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { LinkLineIdentityUseCase } from './link-line-identity.use-case';

function makeUseCase(opts: { existing?: any; createThrowsP2002?: boolean; memberships?: any[] } = {}) {
  const creates: any[] = [];
  const updates: any[] = [];
  const contextUpserts: any[] = [];

  const prisma = {
    client: {
      externalIdentity: {
        findFirst: async () => (opts.existing ? { providerChannelId: 'msg-chan-1', ...opts.existing } : null),
        create: async ({ data }: any) => {
          if (opts.createThrowsP2002) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          creates.push(data);
          return { id: 'identity-new', ...data };
        },
        update: async ({ where, data }: any) => { updates.push({ where, data }); return { id: where.id, ...data }; },
      },
      companyMembership: {
        findMany: async () => opts.memberships ?? [{ companyId: 'company-1' }],
      },
      lineCompanyContext: {
        upsert: async (args: any) => { contextUpserts.push(args); },
      },
    },
  } as any;

  const lineVerifier = { verify: async () => ({ subject: 'line-user-1' }) } as any;
  const config = { lineMessagingChannelId: 'msg-chan-1', lineLoginChannelId: 'login-chan-1' } as any;
  const audit = { log: async () => {} } as any;

  const useCase = new LinkLineIdentityUseCase(lineVerifier, prisma, config, audit);
  return { useCase, creates, updates, contextUpserts };
}

const input = { userId: 'user-1', idToken: 'line-id-token', requestId: 'req-1' };

describe('LinkLineIdentityUseCase', () => {
  it('creates an ACTIVE identity on first link', async () => {
    const { useCase, creates, updates } = makeUseCase();
    const result = await useCase.execute(input);

    assert.deepEqual(result, { linked: true, providerUserId: 'line-user-1' });
    assert.equal(creates.length, 1);
    assert.equal(creates[0].status, 'ACTIVE');
    assert.equal(updates.length, 0);
  });

  it('maps a unique-constraint race on create to the same conflict as the read path (H-09 cardinality)', async () => {
    const { useCase } = makeUseCase({ createThrowsP2002: true });
    await assert.rejects(() => useCase.execute(input), ConflictException);
  });

  it('is idempotent when the same user is already actively linked', async () => {
    const { useCase, creates, updates, contextUpserts } = makeUseCase({
      existing: { id: 'identity-1', userId: 'user-1', status: 'ACTIVE' },
    });
    const result = await useCase.execute(input);

    assert.deepEqual(result, { linked: true, providerUserId: 'line-user-1' });
    assert.equal(creates.length, 0);
    assert.equal(updates.length, 0);
    assert.equal(contextUpserts.length, 1);
  });

  it('reactivates an UNLINKED row instead of creating a duplicate (relink after unlink)', async () => {
    const { useCase, creates, updates } = makeUseCase({
      existing: { id: 'identity-1', userId: 'user-1', status: 'UNLINKED' },
    });
    const result = await useCase.execute(input);

    assert.deepEqual(result, { linked: true, providerUserId: 'line-user-1' });
    assert.equal(creates.length, 0);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].where.id, 'identity-1');
    assert.equal(updates[0].data.status, 'ACTIVE');
    assert.equal(updates[0].data.userId, 'user-1');
  });

  it('moves a severed LINE account to a different user via reactivation', async () => {
    const { useCase, updates } = makeUseCase({
      existing: { id: 'identity-1', userId: 'user-other', status: 'UNLINKED' },
    });
    const result = await useCase.execute(input);

    assert.deepEqual(result, { linked: true, providerUserId: 'line-user-1' });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].data.userId, 'user-1');
  });

  it('rejects when the LINE account is actively linked to another user', async () => {
    const { useCase, creates, updates } = makeUseCase({
      existing: { id: 'identity-1', userId: 'user-other', status: 'ACTIVE' },
    });
    await assert.rejects(() => useCase.execute(input), ConflictException);
    assert.equal(creates.length, 0);
    assert.equal(updates.length, 0);
  });

  it('reassigns an active LINE account when an admin-issued link token authorizes it', async () => {
    const { useCase, updates, contextUpserts } = makeUseCase({
      existing: { id: 'identity-1', userId: 'user-other', status: 'ACTIVE' },
    });
    const result = await useCase.execute({ ...input, allowReassign: true, companyId: 'company-1' });

    assert.deepEqual(result, { linked: true, providerUserId: 'line-user-1' });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].data.userId, 'user-1');
    assert.equal(contextUpserts.length, 1);
  });

  // Owner decision 2026-08-29: linking with an explicit company is login-level — the old rule
  // rejected any multi-company user who was not OWNER, so an employee of one company and owner of
  // another could not link from the first company at all.
  it('links a multi-company user into a company where they are not OWNER', async () => {
    const { useCase, contextUpserts } = makeUseCase({
      memberships: [{ companyId: 'company-1' }, { companyId: 'company-2' }],
    });
    const result = await useCase.execute({ ...input, companyId: 'company-1' });

    assert.deepEqual(result, { linked: true, providerUserId: 'line-user-1' });
    assert.equal(contextUpserts.length, 1);
    assert.equal(contextUpserts[0].create.companyId, 'company-1');
  });

  it('rejects an explicit companyId outside the user memberships', async () => {
    const { useCase, contextUpserts } = makeUseCase({
      memberships: [{ companyId: 'company-1' }, { companyId: 'company-2' }],
    });
    await assert.rejects(() => useCase.execute({ ...input, companyId: 'company-x' }), ForbiddenException);
    assert.equal(contextUpserts.length, 0);
  });

  it('refuses to resurrect a DISABLED identity', async () => {
    const { useCase, creates, updates } = makeUseCase({
      existing: { id: 'identity-1', userId: 'user-1', status: 'DISABLED' },
    });
    await assert.rejects(() => useCase.execute(input), ForbiddenException);
    assert.equal(creates.length, 0);
    assert.equal(updates.length, 0);
  });
});
