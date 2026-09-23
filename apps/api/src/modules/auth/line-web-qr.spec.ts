import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DenyByDefaultGuard } from '../../common/security/deny-by-default.guard';
import { AuthController } from './presentation/auth.controller';
import { ApproveLineWebLoginTransactionUseCase } from './application/use-cases/approve-line-web-login-transaction.use-case';
import { RedeemLineWebLoginTransactionUseCase } from './application/use-cases/redeem-line-web-login-transaction.use-case';
import { hashLineWebQrValue } from './domain/logic/line-web-qr.logic';

const PUBLIC_CODE = 'public-code-1';
const DESKTOP_SECRET = 'desktop-secret-1';

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 1);

type Row = {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'CONSUMED';
  expiresAt: Date;
  userId?: string | null;
  returnTo?: string | null;
};

/** Prisma fake: one transaction row, plus a recording updateMany whose count the test controls. */
function makePrisma(options: {
  row: Row | null;
  userStatus?: 'ACTIVE' | 'SUSPENDED' | null;
  updatedCount?: number;
}) {
  const updates: any[] = [];
  const finds: any[] = [];
  const prisma = {
    client: {
      lineWebLoginTransaction: {
        findUnique: async (args: unknown) => { finds.push(args); return options.row; },
        updateMany: async (args: unknown) => {
          updates.push(args);
          return { count: options.updatedCount ?? 1 };
        },
      },
      user: {
        findUnique: async () => (options.userStatus ? { status: options.userStatus } : null),
      },
    },
  } as any;
  return { prisma, updates, finds };
}

function makeAudit() {
  const logged: any[] = [];
  return { logged, audit: { log: async (entry: unknown) => { logged.push(entry); } } as any };
}

const assertNoRawSecretInAudit = (logged: any[]) => {
  const serialized = JSON.stringify(logged);
  assert.ok(!serialized.includes(PUBLIC_CODE), 'audit metadata must never carry the raw public code');
  assert.ok(!serialized.includes(DESKTOP_SECRET), 'audit metadata must never carry the raw desktop secret');
};

it('allows QR approval for a signed-in account and denies one without session permission', () => {
  const guard = new DenyByDefaultGuard(new Reflector());
  const context = (permissions: string[]) => ({
    getHandler: () => AuthController.prototype.lineQrApprove,
    getClass: () => AuthController,
    switchToHttp: () => ({ getRequest: () => ({ context: { permissions } }) }),
  }) as any;
  assert.equal(guard.canActivate(context(['account.session.read'])), true);
  assert.throws(() => guard.canActivate(context([])), ForbiddenException);
});

// ---- ApproveLineWebLoginTransactionUseCase ----

describe('ApproveLineWebLoginTransactionUseCase', () => {
  it('binds the approving user to a pending transaction and looks it up by hash only', async () => {
    const { prisma, updates, finds } = makePrisma({
      row: { id: 'txn-1', status: 'PENDING', expiresAt: future() },
      userStatus: 'ACTIVE',
    });
    const { audit, logged } = makeAudit();
    const uc = new ApproveLineWebLoginTransactionUseCase(prisma, audit);

    const result = await uc.execute({ userId: 'user-1', publicCode: PUBLIC_CODE, requestId: 'req-1' });

    assert.deepEqual(result, { approved: true });
    assert.equal((finds[0] as any).where.publicCodeHash, hashLineWebQrValue(PUBLIC_CODE));
    assert.ok(!JSON.stringify(finds).includes(PUBLIC_CODE), 'the raw code must never reach the query');
    assert.deepEqual(updates[0].where, { id: 'txn-1', status: 'PENDING' });
    assert.equal(updates[0].data.status, 'APPROVED');
    assert.equal(updates[0].data.userId, 'user-1');
    assert.ok(updates[0].data.approvedAt instanceof Date);
    assert.equal(logged[0].action, 'auth.line_qr.approve');
    assert.equal(logged[0].result, 'SUCCESS');
    assert.equal(logged[0].riskLevel, 'MEDIUM');
    assert.equal(logged[0].actorUserId, 'user-1');
    assertNoRawSecretInAudit(logged);
  });

  it('rejects an expired transaction with the generic not-found', async () => {
    const { prisma, updates } = makePrisma({
      row: { id: 'txn-1', status: 'PENDING', expiresAt: past() },
      userStatus: 'ACTIVE',
    });
    const uc = new ApproveLineWebLoginTransactionUseCase(prisma);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', publicCode: PUBLIC_CODE, requestId: 'req-1' }),
      NotFoundException,
    );
    assert.equal(updates.length, 0);
  });

  it('rejects an unknown code with the same generic not-found', async () => {
    const { prisma } = makePrisma({ row: null, userStatus: 'ACTIVE' });
    const uc = new ApproveLineWebLoginTransactionUseCase(prisma);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', publicCode: PUBLIC_CODE, requestId: 'req-1' }),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.equal((error as NotFoundException).message, 'QR transaction is expired or not found.');
        return true;
      },
    );
  });

  it('loses the double-approve race without approving twice (updateMany count 0)', async () => {
    const { prisma } = makePrisma({
      row: { id: 'txn-1', status: 'PENDING', expiresAt: future() },
      userStatus: 'ACTIVE',
      updatedCount: 0,
    });
    const { audit, logged } = makeAudit();
    const uc = new ApproveLineWebLoginTransactionUseCase(prisma, audit);
    await assert.rejects(
      () => uc.execute({ userId: 'user-2', publicCode: PUBLIC_CODE, requestId: 'req-2' }),
      NotFoundException,
    );
    assert.equal(logged.length, 0, 'a lost race must not write a success audit row');
  });

  it('fails closed when the approving user is no longer active', async () => {
    const { prisma, updates } = makePrisma({
      row: { id: 'txn-1', status: 'PENDING', expiresAt: future() },
      userStatus: 'SUSPENDED',
    });
    const uc = new ApproveLineWebLoginTransactionUseCase(prisma);
    await assert.rejects(
      () => uc.execute({ userId: 'user-1', publicCode: PUBLIC_CODE, requestId: 'req-1' }),
      ForbiddenException,
    );
    assert.equal(updates.length, 0);
  });
});

// ---- RedeemLineWebLoginTransactionUseCase ----

describe('RedeemLineWebLoginTransactionUseCase', () => {
  const issueToken = (calls: unknown[][]) => ({
    execute: async (...args: unknown[]) => {
      calls.push(args);
      return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
    },
  }) as any;

  it('answers pending while the phone has not approved yet', async () => {
    const { prisma } = makePrisma({ row: { id: 'txn-1', status: 'PENDING', expiresAt: future() } });
    const uc = new RedeemLineWebLoginTransactionUseCase(prisma, issueToken([]));
    assert.deepEqual(await uc.execute({ desktopSecret: DESKTOP_SECRET }), { status: 'pending' });
  });

  it('issues a first-party session for an approved transaction and consumes it', async () => {
    const calls: unknown[][] = [];
    const { prisma, updates, finds } = makePrisma({
      row: { id: 'txn-1', status: 'APPROVED', expiresAt: future(), userId: 'user-1', returnTo: '/companies/co-1/dashboard' },
      userStatus: 'ACTIVE',
    });
    const { audit, logged } = makeAudit();
    const uc = new RedeemLineWebLoginTransactionUseCase(prisma, issueToken(calls), audit);

    const result = await uc.execute({ desktopSecret: DESKTOP_SECRET });

    assert.deepEqual(result, {
      status: 'approved',
      returnTo: '/companies/co-1/dashboard',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresIn: 900,
    });
    assert.deepEqual(calls, [['user-1', 'line']]);
    assert.equal((finds[0] as any).where.desktopSecretHash, hashLineWebQrValue(DESKTOP_SECRET));
    assert.deepEqual(updates[0].where, { id: 'txn-1', status: 'APPROVED' });
    assert.equal(updates[0].data.status, 'CONSUMED');
    assert.ok(updates[0].data.consumedAt instanceof Date);
    assert.equal(logged[0].action, 'auth.line_qr.redeem');
    assert.equal(logged[0].result, 'SUCCESS');
    assert.equal(logged[0].riskLevel, 'MEDIUM');
    assertNoRawSecretInAudit(logged);
  });

  it('never re-mints for a replayed secret after the transaction was consumed (rule 8)', async () => {
    const calls: unknown[][] = [];
    const { prisma, updates } = makePrisma({
      row: { id: 'txn-1', status: 'CONSUMED', expiresAt: future(), userId: 'user-1' },
      userStatus: 'ACTIVE',
    });
    const uc = new RedeemLineWebLoginTransactionUseCase(prisma, issueToken(calls));
    assert.deepEqual(await uc.execute({ desktopSecret: DESKTOP_SECRET }), { status: 'expired' });
    assert.equal(calls.length, 0, 'a consumed transaction must never issue a second session');
    assert.equal(updates.length, 0);
  });

  it('reports expired once the TTL has passed, without issuing tokens', async () => {
    const calls: unknown[][] = [];
    const { prisma } = makePrisma({
      row: { id: 'txn-1', status: 'APPROVED', expiresAt: past(), userId: 'user-1' },
      userStatus: 'ACTIVE',
    });
    const uc = new RedeemLineWebLoginTransactionUseCase(prisma, issueToken(calls));
    assert.deepEqual(await uc.execute({ desktopSecret: DESKTOP_SECRET }), { status: 'expired' });
    assert.equal(calls.length, 0);
  });

  it('loses the double-redeem race without issuing a session (updateMany count 0)', async () => {
    const calls: unknown[][] = [];
    const { prisma } = makePrisma({
      row: { id: 'txn-1', status: 'APPROVED', expiresAt: future(), userId: 'user-1' },
      userStatus: 'ACTIVE',
      updatedCount: 0,
    });
    const uc = new RedeemLineWebLoginTransactionUseCase(prisma, issueToken(calls));
    assert.deepEqual(await uc.execute({ desktopSecret: DESKTOP_SECRET }), { status: 'expired' });
    assert.equal(calls.length, 0);
  });

  it('rejects an unknown desktop secret with 403 instead of a poll-able status', async () => {
    const { prisma } = makePrisma({ row: null });
    const uc = new RedeemLineWebLoginTransactionUseCase(prisma, issueToken([]));
    await assert.rejects(() => uc.execute({ desktopSecret: DESKTOP_SECRET }), ForbiddenException);
  });

  it('fails closed when the approved user is no longer active', async () => {
    const calls: unknown[][] = [];
    const { prisma, updates } = makePrisma({
      row: { id: 'txn-1', status: 'APPROVED', expiresAt: future(), userId: 'user-1' },
      userStatus: 'SUSPENDED',
    });
    const uc = new RedeemLineWebLoginTransactionUseCase(prisma, issueToken(calls));
    await assert.rejects(() => uc.execute({ desktopSecret: DESKTOP_SECRET }), ForbiddenException);
    assert.equal(calls.length, 0);
    assert.equal(updates.length, 0);
  });
});
