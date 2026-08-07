import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { ReissueOwnerLineLinkUseCase } from './reissue-owner-line-link.use-case';
import { hashLineLinkToken } from '../../../employee-access/domain/logic/employee-access.logic';

function makeUseCase(opts: { run?: any; membership?: any } = {}) {
  const credentialTouches: any[] = [];
  const tokenSweeps: any[] = [];
  const tokenCreates: any[] = [];
  const auditCreates: any[] = [];

  const run = opts.run === undefined
    ? { id: 'run-1', companyId: 'co-1', ownerUserId: 'owner-1' }
    : opts.run;
  const membership = opts.membership === undefined ? { id: 'mem-1' } : opts.membership;

  const prisma = {
    client: {
      companyOnboardingRun: { findUnique: async () => run },
      // The whole point of this use case: the owner credential must never be read or written.
      userCredential: {
        findUnique: async () => { credentialTouches.push('findUnique'); return { userId: 'owner-1' }; },
        update: async () => { credentialTouches.push('update'); return {}; },
      },
      companyMembership: { findFirst: async () => membership },
      employeeLineLinkToken: {
        updateMany: async (args: any) => { tokenSweeps.push(args); return { count: 1 }; },
        create: async (args: any) => { tokenCreates.push(args); return {}; },
      },
      auditLog: { create: async (args: any) => { auditCreates.push(args); return {}; } },
      $transaction: async (ops: any[]) => Promise.all(ops),
    },
  } as any;

  const useCase = new ReissueOwnerLineLinkUseCase(prisma, { lineLiffId: '2010784350-ruzn5beM' } as any);
  return { useCase, credentialTouches, tokenSweeps, tokenCreates, auditCreates };
}

describe('ReissueOwnerLineLinkUseCase', () => {
  it('reissues a 24h owner QR without touching the password credential', async () => {
    const { useCase, credentialTouches, tokenSweeps, tokenCreates } = makeUseCase();
    const result = await useCase.execute('run-1', 'admin-1', 'req-1', 'https://api.example.com/v1');

    // escape hatch for an expired QR only — the password credential is never read or written
    assert.equal(credentialTouches.length, 0);

    // prior PENDING owner QRs are revoked before the replacement is created
    assert.deepEqual(tokenSweeps[0].where, { membershipId: 'mem-1', status: 'PENDING' });
    assert.deepEqual(tokenSweeps[0].data, { status: 'REVOKED' });

    // replacement token carries the 24h owner TTL, not the 15m in-person default
    const ttlMs = tokenCreates[0].data.expiresAt.getTime() - Date.now();
    assert.ok(ttlMs > 23 * 60 * 60 * 1000, `TTL too short: ${ttlMs}`);
    assert.ok(ttlMs <= 24 * 60 * 60 * 1000, `TTL too long: ${ttlMs}`);
    assert.equal(tokenCreates[0].data.companyId, 'co-1');
    assert.equal(tokenCreates[0].data.userId, 'owner-1');
    assert.equal(tokenCreates[0].data.issuedByUserId, 'admin-1');

    // H-09: QR rides a local data URI; storage holds only the hash of the raw token
    assert.ok(result.ownerLineLink.qrImageUrl.startsWith('data:image/svg+xml;base64,'));
    const rawToken = new URL(result.ownerLineLink.linkUrl).searchParams.get('token')!;
    assert.notEqual(tokenCreates[0].data.tokenHash, rawToken);
    assert.equal(tokenCreates[0].data.tokenHash, hashLineLinkToken(rawToken));
  });

  it('writes a CRITICAL audit row for the reissue', async () => {
    const { useCase, auditCreates } = makeUseCase();
    await useCase.execute('run-1', 'admin-1', 'req-1', 'https://api.example.com/v1');

    assert.equal(auditCreates[0].data.action, 'system.company_onboarding.reissue_owner_line_link');
    assert.equal(auditCreates[0].data.riskLevel, 'CRITICAL');
    assert.equal(auditCreates[0].data.actorUserId, 'admin-1');
    assert.equal(auditCreates[0].data.targetId, 'run-1');
    assert.deepEqual(auditCreates[0].data.metadataJson, { ownerUserId: 'owner-1', companyId: 'co-1' });
  });

  it('rejects an unknown onboarding run', async () => {
    const { useCase, tokenSweeps, tokenCreates } = makeUseCase({ run: null });
    await assert.rejects(() => useCase.execute('run-x', 'admin-1', 'req-1', 'https://api.example.com/v1'), NotFoundException);
    assert.equal(tokenSweeps.length, 0);
    assert.equal(tokenCreates.length, 0);
  });

  it('rejects when the owner has no membership instead of issuing an unclaimable QR', async () => {
    const { useCase, tokenSweeps, tokenCreates, auditCreates } = makeUseCase({ membership: null });
    await assert.rejects(() => useCase.execute('run-1', 'admin-1', 'req-1', 'https://api.example.com/v1'), NotFoundException);
    assert.equal(tokenSweeps.length, 0);
    assert.equal(tokenCreates.length, 0);
    assert.equal(auditCreates.length, 0);
  });
});
