import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '../../domain/logic/password-credential.logic';
import { RequestPasswordResetUseCase } from './request-password-reset.use-case';
import { ConfirmPasswordResetUseCase } from './confirm-password-reset.use-case';
import { RequestEmailChangeUseCase } from './request-email-change.use-case';
import { AuthRateLimitService } from '../auth-rate-limit.service';

describe('RequestPasswordResetUseCase', () => {
  it('returns the same generic response when the identifier is not found', async () => {
    const prisma = {
      client: {
        user: { findFirst: async () => null },
      },
    } as any;

    const result = await new RequestPasswordResetUseCase(prisma, { sendPasswordResetLink: async () => {}, sendEmailVerification: async () => {} } as any).execute({
      identifier: 'missing-user',
      requestId: 'req-1',
    });

    assert.equal(result.message, 'If the account is eligible, a password reset link has been sent.');
  });

  it('revokes older pending reset tokens before issuing a new one', async () => {
    const calls: unknown[] = [];
    const prisma = {
      client: {
        user: {
          findFirst: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            email: 'owner@example.com',
            emailVerifiedAt: new Date(),
            credential: { status: 'ACTIVE' },
          }),
        },
        $transaction: async (fn: (tx: any) => Promise<void>) => fn({
          passwordResetToken: {
            updateMany: async (args: unknown) => { calls.push(args); return { count: 1 }; },
            create: async (args: unknown) => { calls.push(args); return args; },
          },
        }),
      },
    } as any;

    await new RequestPasswordResetUseCase(prisma, { sendPasswordResetLink: async () => {}, sendEmailVerification: async () => {} } as any).execute({
      identifier: 'owner@example.com',
      requestId: 'req-2',
    });

    assert.equal(calls.length, 2);
    assert.equal((calls[0] as any).where.userId, 'user-1');
    assert.equal((calls[0] as any).data.status, 'REVOKED');
    assert.equal((calls[1] as any).data.userId, 'user-1');
  });
});

describe('ConfirmPasswordResetUseCase', () => {
  it('updates the password, revokes sessions, and returns a new login session', async () => {
    const auditRows: unknown[] = [];
    let updatedCredential: any;
    const prisma = {
      client: {
        passwordResetToken: {
          findUnique: async () => ({
            id: 'token-1',
            userId: 'user-1',
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 60000),
          }),
        },
        user: {
          findUnique: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            credential: {
              id: 'cred-1',
              status: 'TEMPORARY',
              passwordHash: hashPassword('old-password-11'),
            },
          }),
        },
        companyMembership: {
          findFirst: async () => ({ companyId: 'company-1', roles: [{ role: { key: 'OWNER' } }] }),
        },
        $transaction: async (fn: (tx: any) => Promise<void>) => fn({
          passwordResetToken: {
            updateMany: async () => ({ count: 1 }),
          },
          authSession: {
            updateMany: async () => ({ count: 3 }),
          },
          userCredential: {
            update: async (args: unknown) => {
              updatedCredential = args;
              return { updatedAt: new Date('2026-08-09T08:00:00.000Z') };
            },
          },
          auditLog: {
            create: async (args: unknown) => { auditRows.push(args); return {}; },
          },
        }),
      },
    } as any;
    const issueToken = {
      execute: async () => ({
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresIn: 900,
      }),
    } as any;

    const result = await new ConfirmPasswordResetUseCase(prisma, issueToken).execute({
      token: 'raw-token',
      newPassword: 'new-password-11',
      requestId: 'req-3',
    });

    assert.equal(result.accessToken, 'access');
    assert.equal(result.companyId, 'company-1');
    assert.equal(result.redirectPath, '/companies/company-1/dashboard');
    assert.equal(verifyPassword('new-password-11', updatedCredential.data.passwordHash), true);
    assert.equal(updatedCredential.data.mustChangePassword, false);
    assert.equal(auditRows.length, 1);
  });

  // A reset that keeps the password already on the account is not a reset. Rejected before the
  // token is claimed, so the user can retry with the same link.
  it('rejects reusing the password already on the account, leaving the token usable', async () => {
    let tokenClaimed = false;
    let credentialUpdated = false;
    const prisma = {
      client: {
        passwordResetToken: {
          findUnique: async () => ({
            id: 'token-1',
            userId: 'user-1',
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 60000),
          }),
        },
        user: {
          findUnique: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            credential: { id: 'cred-1', status: 'ACTIVE', passwordHash: hashPassword('01011990') },
          }),
        },
        companyMembership: {
          findFirst: async () => ({ companyId: 'company-1', roles: [] }),
        },
        $transaction: async (fn: (tx: any) => Promise<void>) => fn({
          passwordResetToken: { updateMany: async () => { tokenClaimed = true; return { count: 1 }; } },
          authSession: { updateMany: async () => ({ count: 0 }) },
          userCredential: { update: async () => { credentialUpdated = true; return {}; } },
          auditLog: { create: async () => ({}) },
        }),
      },
    } as any;

    await assert.rejects(
      () => new ConfirmPasswordResetUseCase(prisma, { execute: async () => ({}) } as any)
        .execute({ token: 'raw-token', newPassword: '01011990' }),
      (error: any) => error.getStatus() === 400 && error.getResponse().code === 'password_reuse',
    );
    assert.equal(tokenClaimed, false);
    assert.equal(credentialUpdated, false);
  });

  it('rejects an expired token with a uniform error', async () => {
    const prisma = {
      client: {
        passwordResetToken: {
          findUnique: async () => ({
            id: 'token-1',
            userId: 'user-1',
            status: 'PENDING',
            expiresAt: new Date(Date.now() - 1000),
          }),
          updateMany: async () => ({ count: 1 }),
        },
      },
    } as any;

    await assert.rejects(
      () => new ConfirmPasswordResetUseCase(prisma, { execute: async () => ({}) } as any).execute({
        token: 'raw-token',
        newPassword: 'new-password-11',
      }),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        return true;
      },
    );
  });

  it('does not reset or issue a session without access to an active company', async () => {
    let issueTokenCalls = 0;
    const prisma = {
      client: {
        passwordResetToken: { findUnique: async () => ({ id: 'token-1', userId: 'user-1', status: 'PENDING', expiresAt: new Date(Date.now() + 60000) }) },
        user: { findUnique: async () => ({ id: 'user-1', status: 'ACTIVE', credential: { status: 'ACTIVE' } }) },
        companyMembership: { findFirst: async (args: any) => {
          assert.deepEqual(args.where.company, { status: 'ACTIVE' });
          return null;
        } },
        $transaction: async () => assert.fail('password reset must not mutate without company access'),
      },
    } as any;

    await assert.rejects(
      () => new ConfirmPasswordResetUseCase(prisma, { execute: async () => { issueTokenCalls += 1; return {}; } } as any).execute({ token: 'raw-token', newPassword: 'new-password-11' }),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.equal((error.getResponse() as any).code, 'company_access_unavailable');
        return true;
      },
    );
    assert.equal(issueTokenCalls, 0);
  });
});

describe('RequestEmailChangeUseCase', () => {
  it('creates a pending verification token for a valid password', async () => {
    const calls: unknown[] = [];
    const passwordHash = hashPassword('watchdog-old');
    const prisma = {
      client: {
        user: {
          findUnique: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            email: null,
            emailVerifiedAt: null,
            credential: {
              status: 'ACTIVE',
              passwordHash,
            },
          }),
          findFirst: async () => null,
        },
        $transaction: async (fn: (tx: any) => Promise<void>) => fn({
          $executeRaw: async () => 1,
          $queryRaw: async () => [],
          user: prisma.client.user,
          emailVerificationToken: {
            updateMany: async (args: unknown) => { calls.push(args); return { count: 0 }; },
            create: async (args: unknown) => { calls.push(args); return args; },
          },
        }),
      },
    } as any;

    const result = await new RequestEmailChangeUseCase(prisma, { sendEmailVerification: async () => {}, sendPasswordResetLink: async () => {} } as any).execute({
      userId: 'user-1',
      currentPassword: 'watchdog-old',
      newEmail: 'Owner@Example.com',
      requestId: 'req-4',
    });

    assert.equal(result.email, 'owner@example.com');
    assert.equal(calls.length, 2);
  });

  it('rejects a wrong current password without writes, email delivery or audit', async () => {
    let sideEffects = 0;
    const unexpected = async () => { sideEffects += 1; throw new Error('Unexpected side effect'); };
    const prisma = {
      client: {
        user: {
          findUnique: async () => ({
            id: 'user-1',
            credential: {
              status: 'ACTIVE',
              passwordHash: hashPassword('watchdog-old'),
            },
          }),
          findFirst: unexpected,
        },
        $transaction: unexpected,
      },
    } as any;

    await assert.rejects(
      () => new RequestEmailChangeUseCase(prisma, { sendEmailVerification: unexpected } as any, { log: unexpected } as any).execute({
        userId: 'user-1',
        currentPassword: 'wrong-password',
        newEmail: 'owner@example.com',
      }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.equal(error.getStatus(), 400);
        assert.deepEqual(error.getResponse(), {
          code: 'current_password_incorrect',
          message: 'Current password is incorrect.',
        });
        return true;
      },
    );
    assert.equal(sideEffects, 0);
  });

  // A *missing* credential is no longer in this list (P10-L §15.4): a LINE-first account was never
  // issued a password, so demanding one locked it out of ever setting a recovery email. That path
  // is covered in `account-profile.use-case.spec.ts`. A DISABLED credential is a different fact —
  // access was taken away — and stays 401.
  it('keeps missing users and disabled credentials unauthorized', async () => {
    for (const user of [null, {
      credential: { status: 'DISABLED', passwordHash: hashPassword('synthetic-current-password') },
    }]) {
      let transactions = 0;
      const prisma = { client: {
        user: { findUnique: async () => user },
        $transaction: async () => { transactions += 1; throw new Error('Unexpected mutation'); },
      } } as any;
      await assert.rejects(
        new RequestEmailChangeUseCase(prisma, {} as any).execute({
          userId: 'synthetic-user', currentPassword: 'synthetic-current-password', newEmail: 'new@example.test',
        }),
        (error: unknown) => error instanceof UnauthorizedException && error.getStatus() === 401,
      );
      assert.equal(transactions, 0);
    }
  });
});

describe('AuthRateLimitService', () => {
  it('blocks repeated reset requests after the configured threshold', async () => {
    const service = new AuthRateLimitService({
      passwordResetRequestMaxPerIdentifier: 1,
      passwordResetRequestMaxPerIp: 10,
      passwordResetRequestWindowSeconds: 60,
      passwordResetConfirmMaxPerIp: 10,
      passwordResetConfirmWindowSeconds: 60,
      emailVerificationRequestMaxPerUser: 10,
      emailVerificationRequestWindowSeconds: 60,
      emailVerificationConfirmMaxPerIp: 10,
      emailVerificationConfirmWindowSeconds: 60,
    } as any);

    await service.assertPasswordResetRequestAllowed('owner', '127.0.0.1');
    await assert.rejects(
      service.assertPasswordResetRequestAllowed('owner', '127.0.0.1'),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
    );
  });
});
