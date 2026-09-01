import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { PartnerMemberLineLinkTokenUseCase } from './partner-member-line-link-token.use-case';
import { hashLineLinkToken } from '../../../employee-access/domain/logic/employee-access.logic';

function makeUseCase(opts: { membership?: any } = {}) {
  const membershipQueries: any[] = [];
  const credentialTouches: string[] = [];
  const tokenSweeps: any[] = [];
  const tokenCreates: any[] = [];
  const auditCreates: any[] = [];

  const membership = opts.membership === undefined ? { id: 'mem-1' } : opts.membership;

  const prisma = {
    client: {
      companyMembership: {
        findFirst: async (args: any) => { membershipQueries.push(args); return membership; },
      },
      // Issuing a QR must never touch the password credential — that is the whole reason
      // this exists next to "Reset password" instead of being folded into it.
      userCredential: {
        findUnique: async () => { credentialTouches.push('findUnique'); return {}; },
        update: async () => { credentialTouches.push('update'); return {}; },
      },
      employeeLineLinkToken: {
        updateMany: async (args: any) => { tokenSweeps.push(args); return { count: 1 }; },
        create: async (args: any) => { tokenCreates.push(args); return {}; },
      },
      auditLog: { create: async (args: any) => { auditCreates.push(args); return {}; } },
      $transaction: async (ops: any[]) => Promise.all(ops),
    },
  } as any;

  const useCase = new PartnerMemberLineLinkTokenUseCase(prisma, { lineLiffId: '2010784350-ruzn5beM' } as any);
  return { useCase, membershipQueries, credentialTouches, tokenSweeps, tokenCreates, auditCreates };
}

const cmd = {
  companyId: 'co-1',
  memberUserId: 'owner-1',
  requestingAdminUserId: 'admin-1',
  requestId: 'req-1',
  apiBaseUrl: 'https://api.example.com/v1',
};

describe('PartnerMemberLineLinkTokenUseCase', () => {
  it('issues a 72h QR keyed by companyId + memberUserId, without touching the password', async () => {
    const { useCase, membershipQueries, credentialTouches, tokenSweeps, tokenCreates } = makeUseCase();
    const result = await useCase.execute(cmd);

    // no onboarding run id anywhere: the members console has both ids already
    assert.deepEqual(membershipQueries[0].where, { companyId: 'co-1', userId: 'owner-1', status: 'ACTIVE' });
    assert.equal(credentialTouches.length, 0);

    // prior PENDING QRs for this membership are revoked before the replacement is created
    assert.deepEqual(tokenSweeps[0].where, { membershipId: 'mem-1', status: 'PENDING' });
    assert.deepEqual(tokenSweeps[0].data, { status: 'REVOKED' });

    // 72h handoff window, not the 15-minute in-person employee default
    const ttlMs = tokenCreates[0].data.expiresAt.getTime() - Date.now();
    assert.ok(ttlMs > 71 * 60 * 60 * 1000, `TTL too short: ${ttlMs}`);
    assert.ok(ttlMs <= 72 * 60 * 60 * 1000, `TTL too long: ${ttlMs}`);
    assert.equal(tokenCreates[0].data.companyId, 'co-1');
    assert.equal(tokenCreates[0].data.membershipId, 'mem-1');
    assert.equal(tokenCreates[0].data.userId, 'owner-1');
    assert.equal(tokenCreates[0].data.issuedByUserId, 'admin-1');

    // H-09: QR renders locally and storage keeps only the hash of the raw bearer token
    assert.ok(result.lineLink.qrImageUrl.startsWith('data:image/svg+xml;base64,'));
    const rawToken = new URL(result.lineLink.linkUrl).searchParams.get('token')!;
    assert.notEqual(tokenCreates[0].data.tokenHash, rawToken);
    assert.equal(tokenCreates[0].data.tokenHash, hashLineLinkToken(rawToken));
  });

  it('writes a CRITICAL audit row naming the member the QR was issued for', async () => {
    const { useCase, auditCreates } = makeUseCase();
    await useCase.execute(cmd);

    assert.equal(auditCreates[0].data.action, 'system.partner_member.line_link_token.issue');
    assert.equal(auditCreates[0].data.riskLevel, 'CRITICAL');
    assert.equal(auditCreates[0].data.actorUserId, 'admin-1');
    assert.equal(auditCreates[0].data.targetId, 'mem-1');
    assert.deepEqual(auditCreates[0].data.metadataJson, { companyId: 'co-1', memberUserId: 'owner-1' });
  });

  it('rejects a member with no active membership instead of issuing an unclaimable QR', async () => {
    const { useCase, tokenSweeps, tokenCreates, auditCreates } = makeUseCase({ membership: null });
    await assert.rejects(() => useCase.execute(cmd), NotFoundException);
    assert.equal(tokenSweeps.length, 0);
    assert.equal(tokenCreates.length, 0);
    assert.equal(auditCreates.length, 0);
  });
});
