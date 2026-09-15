import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, HttpException, UnauthorizedException } from '@nestjs/common';
import { hashPassword, verifyPassword } from '../../domain/logic/password-credential.logic';
import { RequestPasswordResetUseCase } from './request-password-reset.use-case';
import { ConfirmPasswordResetUseCase } from './confirm-password-reset.use-case';
import { RequestEmailChangeUseCase } from './request-email-change.use-case';
import { AuthRateLimitService } from '../auth-rate-limit.service';

describe('email password reset proof boundaries', () => {
  it('rejects malformed and legacy proofs without querying a user or issuing a session', async () => {
    const prisma = { client: { passwordResetToken: { findUnique: async () => { throw Error('must not query'); } } } } as any;
    for (const token of ['', 'legacy-token', 'er1.bad']) await assert.rejects(new ConfirmPasswordResetUseCase(prisma).execute({token,newPassword:'new-password-11'}), ForbiddenException);
  });
  it('keeps unknown identifiers generic without sending mail', async () => {
    const service=new RequestPasswordResetUseCase({client:{user:{findMany:async()=>[]}}} as any,{sendPasswordResetLink:async()=>{throw Error('must not send');}} as any,
      {passwordResetResponseMinMs:0} as any,{isPostmark:true} as any);
    assert.deepEqual(await service.execute({identifier:'missing'}),{message:'If the account is eligible, a password reset link has been sent.'});
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
