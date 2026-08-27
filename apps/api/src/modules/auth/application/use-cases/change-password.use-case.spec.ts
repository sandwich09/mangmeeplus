import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ChangePasswordUseCase, CURRENT_PASSWORD_INCORRECT } from './change-password.use-case';
import { hashPassword } from '../../domain/logic/password-credential.logic';

const currentPassword = 'synthetic-current-password';
const passwordHash = hashPassword(currentPassword);

function readOnlyUseCase(credential: unknown) {
  let transactions = 0;
  const prisma = { client: {
    userCredential: { findUnique: async ({ where }: any) => {
      assert.deepEqual(where, { userId: 'synthetic-user' });
      return credential;
    } },
    $transaction: async () => { transactions += 1; throw new Error('Unexpected mutation'); },
  } } as any;
  return { useCase: new ChangePasswordUseCase(prisma), transactions: () => transactions };
}

describe('ChangePasswordUseCase reauthentication errors', () => {
  for (const status of ['ACTIVE', 'TEMPORARY']) {
    it(`returns a correctable 400 before any mutation for a wrong ${status} current password`, async () => {
      const fixture = readOnlyUseCase({ status, passwordHash, mustChangePassword: status === 'TEMPORARY', expiresAt: null });
      await assert.rejects(
        fixture.useCase.execute('synthetic-user', 'synthetic-wrong-password', 'synthetic-new-password', 'synthetic-session'),
        (error: unknown) => {
          assert.ok(error instanceof BadRequestException);
          assert.equal(error.getStatus(), 400);
          assert.deepEqual(error.getResponse(), CURRENT_PASSWORD_INCORRECT);
          return true;
        },
      );
      assert.equal(fixture.transactions(), 0);
    });
  }

  for (const [name, credential] of [
    ['missing', null],
    ['disabled', { status: 'DISABLED', passwordHash, expiresAt: null }],
  ] as const) {
    it(`keeps ${name} credentials unauthorized even with a matching password`, async () => {
      const fixture = readOnlyUseCase(credential);
      await assert.rejects(
        fixture.useCase.execute('synthetic-user', currentPassword, 'synthetic-new-password', 'synthetic-session'),
        (error: unknown) => {
          assert.ok(error instanceof UnauthorizedException);
          assert.equal(error.getStatus(), 401);
          assert.equal((error.getResponse() as { code?: string }).code, undefined);
          return true;
        },
      );
      assert.equal(fixture.transactions(), 0);
    });
  }

  it('still rejects an expired temporary password before mutation', async () => {
    const fixture = readOnlyUseCase({ status: 'TEMPORARY', passwordHash, expiresAt: new Date(0) });
    await assert.rejects(
      fixture.useCase.execute('synthetic-user', currentPassword, 'synthetic-new-password', 'synthetic-session'),
      (error: unknown) => error instanceof ForbiddenException && error.message === 'Temporary password has expired.',
    );
    assert.equal(fixture.transactions(), 0);
  });

  it('still rejects password reuse before mutation', async () => {
    const fixture = readOnlyUseCase({ status: 'ACTIVE', passwordHash, expiresAt: null });
    await assert.rejects(
      fixture.useCase.execute('synthetic-user', currentPassword, currentPassword, 'synthetic-session'),
      (error: unknown) => error instanceof BadRequestException
        && (error.getResponse() as { code?: string }).code === 'password_reuse',
    );
    assert.equal(fixture.transactions(), 0);
  });
});
