import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { RegenerateTemporaryPasswordUseCase } from './regenerate-temporary-password.use-case';
import { verifyPassword } from '../../../auth/domain/logic/password-credential.logic';

function makeUseCase(opts: { run?: any; credential?: any; membership?: any } = {}) {
  const credentialUpdates: any[] = [];
  const tokenSweeps: any[] = [];
  const tokenCreates: any[] = [];
  const auditCreates: any[] = [];

  const run = opts.run === undefined
    ? { id: 'run-1', companyId: 'co-1', ownerUserId: 'owner-1' }
    : opts.run;
  const credential = opts.credential === undefined ? { userId: 'owner-1' } : opts.credential;
  const membership = opts.membership === undefined ? { id: 'mem-1' } : opts.membership;

  const prisma = {
    client: {
      companyOnboardingRun: { findUnique: async () => run },
      userCredential: {
        findUnique: async () => credential,
        update: async (args: any) => { credentialUpdates.push(args); return {}; },
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

  const config = { credentialEncryptionKey: Buffer.alloc(32, 7) } as any;
  const useCase = new RegenerateTemporaryPasswordUseCase(prisma, config);
  return { useCase, credentialUpdates, tokenSweeps, tokenCreates, auditCreates };
}

describe('RegenerateTemporaryPasswordUseCase', () => {
  it('rotates the password and reissues the owner LINE link with the 24h H-09 TTL', async () => {
    const { useCase, credentialUpdates, tokenSweeps, tokenCreates } = makeUseCase();
    const result = await useCase.execute('run-1', 'admin-1', 'req-1', 'https://api.example.com/v1');

    assert.ok(result.temporaryPassword.length > 0);
    assert.equal(credentialUpdates[0].data.mustChangePassword, true);
    assert.equal(credentialUpdates[0].data.status, 'TEMPORARY');
    assert.equal(verifyPassword(result.temporaryPassword, credentialUpdates[0].data.passwordHash), true);

    // prior PENDING owner QRs are revoked before the replacement is created
    assert.deepEqual(tokenSweeps[0].where, { membershipId: 'mem-1', status: 'PENDING' });
    assert.deepEqual(tokenSweeps[0].data, { status: 'REVOKED' });

    // replacement token carries the 24h owner TTL, not the 15m in-person default
    const ttlMs = tokenCreates[0].data.expiresAt.getTime() - Date.now();
    assert.ok(ttlMs > 23 * 60 * 60 * 1000, `TTL too short: ${ttlMs}`);
    assert.ok(ttlMs <= 24 * 60 * 60 * 1000, `TTL too long: ${ttlMs}`);

    // H-09: QR rides a local data URI; the raw token never appears hashed-only storage
    assert.ok(result.ownerLineLink);
    assert.ok(result.ownerLineLink.qrImageUrl.startsWith('data:image/svg+xml;base64,'));
    const rawToken = new URL(result.ownerLineLink.linkUrl).searchParams.get('token')!;
    assert.notEqual(tokenCreates[0].data.tokenHash, rawToken);
  });

  it('skips the LINE link package when the owner has no membership', async () => {
    const { useCase, tokenSweeps, tokenCreates } = makeUseCase({ membership: null });
    const result = await useCase.execute('run-1', 'admin-1', 'req-1', 'https://api.example.com/v1');

    assert.equal(result.ownerLineLink, undefined);
    assert.equal(tokenSweeps.length, 0);
    assert.equal(tokenCreates.length, 0);
  });

  it('rejects an unknown onboarding run', async () => {
    const { useCase } = makeUseCase({ run: null });
    await assert.rejects(() => useCase.execute('run-x', 'admin-1', 'req-1', 'https://api.example.com/v1'), NotFoundException);
  });

  it('rejects when the owner credential is missing', async () => {
    const { useCase } = makeUseCase({ credential: null });
    await assert.rejects(() => useCase.execute('run-1', 'admin-1', 'req-1', 'https://api.example.com/v1'), NotFoundException);
  });
});
