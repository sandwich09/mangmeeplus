import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { SignupClaimUseCase } from './signup-claim.use-case';
import { AccountClaimTokenService } from './account-claim-token.service';
import { hashClaimToken } from '../domain/account-claim.logic';
import { hashPassword } from '../../auth/domain/logic/password-credential.logic';

const RAW_TOKEN = 'raw-claim-token';

const REQUEST = {
  id: 'signup-1',
  state: 'EMAIL_PENDING',
  companyName: 'ร้านมั่งมี',
  contactEmail: 'somchai@example.com',
  attachUserId: null,
  pendingPasswordHash: null,
};

function harness(options: {
  token?: any;
  usernameTaken?: boolean;
  emailOwner?: { id: string } | null;
  loginUser?: any;
  consumable?: boolean;
} = {}) {
  const updates: any[] = [];
  const advances: any[] = [];
  const provisions: any[] = [];
  let consumed = false;

  const token = options.token === undefined
    ? {
      tokenHash: hashClaimToken(RAW_TOKEN), usedAt: null, revokedAt: null,
      expiresAt: new Date(Date.now() + 3_600_000), signupRequest: { ...REQUEST },
    }
    : options.token;

  const prisma = {
    client: {
      accountClaimToken: {
        findUnique: async () => token,
        updateMany: async () => {
          // Single-use CAS: only the first caller moves usedAt off null.
          if (consumed || options.consumable === false) return { count: 0 };
          consumed = true;
          return { count: 1 };
        },
      },
      user: {
        findUnique: async (args: any) => {
          if (args.where.username) return options.usernameTaken ? { id: 'other-user' } : null;
          if (args.where.email) return options.emailOwner ?? null;
          return null;
        },
        findFirst: async () => options.loginUser ?? null,
      },
      companySignupRequest: { update: async (args: any) => { updates.push(args); return {}; } },
      $transaction: async (fn: any) => (typeof fn === 'function' ? fn(prisma.client) : Promise.all(fn)),
    },
  } as any;

  const core = {
    advance: async (id: string, state: string) => { advances.push({ id, state }); return {}; },
  } as any;
  const provision = {
    execute: async (cmd: any) => {
      provisions.push(cmd);
      return { companyId: 'co-1', companyName: REQUEST.companyName, attachedToExistingUser: !!cmd.username === false };
    },
  } as any;

  const useCase = new SignupClaimUseCase(prisma, core, new AccountClaimTokenService(prisma), provision);
  return { useCase, updates, advances, provisions };
}

const cmd = {
  correlationRequestId: 'req-1',
  webBaseUrl: 'https://app.example.com',
  apiBaseUrl: 'https://api.example.com/v1',
};

describe('SignupClaimUseCase.info', () => {
  it('returns masked details for a live token', async () => {
    const info = await harness().useCase.info(RAW_TOKEN);
    assert.equal(info.valid, true);
    assert.equal(info.companyName, 'ร้านมั่งมี');
    assert.equal(info.maskedEmail, 'so***@example.com');
    assert.equal(info.suggestedUsername, 'somchai');
    // The full address never reaches an unauthenticated page.
    assert.equal(JSON.stringify(info).includes('somchai@example.com'), false);
  });

  it('answers identically for unknown, used, revoked and expired tokens', async () => {
    // Anchored to the real clock: `peek` compares expiry against `new Date()`.
    const live = new Date(Date.now() + 3_600_000);
    const cases = [
      { label: 'unknown', token: null },
      { label: 'used', token: { usedAt: new Date(), revokedAt: null, expiresAt: live, signupRequest: REQUEST } },
      { label: 'revoked', token: { usedAt: null, revokedAt: new Date(), expiresAt: live, signupRequest: REQUEST } },
      { label: 'expired', token: { usedAt: null, revokedAt: null, expiresAt: new Date(Date.now() - 1_000), signupRequest: REQUEST } },
      { label: 'wrong state', token: { usedAt: null, revokedAt: null, expiresAt: live, signupRequest: { ...REQUEST, state: 'REJECTED' } } },
    ];
    for (const { label, token } of cases) {
      const info = await harness({ token }).useCase.info(RAW_TOKEN);
      assert.deepEqual(info, { valid: false }, `${label} must not be distinguishable`);
    }
  });
});

describe('SignupClaimUseCase.setPassword', () => {
  it('stores only a hash, verifies the email, and provisions', async () => {
    const h = harness();
    const result = await h.useCase.setPassword({ ...cmd, token: RAW_TOKEN, username: 'somchai', password: 'correct-horse' });

    assert.equal(result.companyId, 'co-1');
    assert.equal(result.homePath, '/companies/co-1/dashboard');
    const stored = h.updates[0].data.pendingPasswordHash as string;
    assert.match(stored, /^scrypt\$/);
    assert.equal(stored.includes('correct-horse'), false);
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'EMAIL_VERIFIED' }]);
    assert.equal(h.provisions[0].username, 'somchai');
  });

  it('refuses a taken username before burning the single-use link', async () => {
    const h = harness({ usernameTaken: true });
    await assert.rejects(
      () => h.useCase.setPassword({ ...cmd, token: RAW_TOKEN, username: 'taken', password: 'correct-horse' }),
      ConflictException,
    );
    // Nothing was consumed, so the applicant can simply try another username.
    assert.equal(h.updates.length, 0);
    assert.equal(h.advances.length, 0);
    assert.equal(h.provisions.length, 0);
  });

  it('sends an already-registered email to the attach branch instead of guessing', async () => {
    const h = harness({ emailOwner: { id: 'existing-user' } });
    await assert.rejects(
      () => h.useCase.setPassword({ ...cmd, token: RAW_TOKEN, username: 'somchai', password: 'correct-horse' }),
      (error: unknown) => error instanceof ConflictException
        && JSON.stringify((error as ConflictException).getResponse()).includes('email_already_registered'),
    );
    assert.equal(h.provisions.length, 0);
  });

  it('lets only one of two concurrent submissions through', async () => {
    const h = harness();
    const [first, second] = await Promise.allSettled([
      h.useCase.setPassword({ ...cmd, token: RAW_TOKEN, username: 'somchai', password: 'correct-horse' }),
      h.useCase.setPassword({ ...cmd, token: RAW_TOKEN, username: 'somchai', password: 'correct-horse' }),
    ]);
    const outcomes = [first!.status, second!.status].sort();
    assert.deepEqual(outcomes, ['fulfilled', 'rejected']);
    assert.equal(h.provisions.length, 1, 'a replayed link must not provision twice');
  });

  it('rejects a spent link', async () => {
    const h = harness({ consumable: false });
    await assert.rejects(
      () => h.useCase.setPassword({ ...cmd, token: RAW_TOKEN, username: 'somchai', password: 'correct-horse' }),
      BadRequestException,
    );
  });
});

describe('SignupClaimUseCase.attach', () => {
  const activeUser = {
    id: 'user-9', status: 'ACTIVE',
    credential: { passwordHash: hashPassword('right-password'), status: 'ACTIVE', expiresAt: null },
  };

  it('attaches to a verified existing account without creating a user or a session', async () => {
    const h = harness({ loginUser: activeUser });
    const result = await h.useCase.attach({ ...cmd, token: RAW_TOKEN, identifier: 'somchai', password: 'right-password' });

    assert.equal(result.companyId, 'co-1');
    assert.equal(h.updates[0].data.attachUserId, 'user-9');
    // Attach carries no password of its own.
    assert.equal(h.updates[0].data.pendingPasswordHash, null);
    assert.deepEqual(h.advances, [{ id: 'signup-1', state: 'EMAIL_VERIFIED' }]);
    assert.equal(h.provisions[0].username, undefined);
    // No token/session field may appear in the claim result.
    assert.equal(/token|session/i.test(JSON.stringify(result)), false);
  });

  it('rejects a wrong password without consuming the claim link', async () => {
    const h = harness({ loginUser: activeUser });
    await assert.rejects(
      () => h.useCase.attach({ ...cmd, token: RAW_TOKEN, identifier: 'somchai', password: 'wrong-password' }),
      UnauthorizedException,
    );
    assert.equal(h.updates.length, 0);
    assert.equal(h.provisions.length, 0);
  });

  it('gives an unknown identifier the same answer as a wrong password', async () => {
    const h = harness({ loginUser: null });
    await assert.rejects(
      () => h.useCase.attach({ ...cmd, token: RAW_TOKEN, identifier: 'nobody', password: 'right-password' }),
      (error: unknown) => error instanceof UnauthorizedException
        && (error as UnauthorizedException).message === 'Invalid username or password.',
    );
  });

  it('refuses a disabled credential and a suspended account', async () => {
    for (const user of [
      { ...activeUser, credential: { ...activeUser.credential, status: 'DISABLED' } },
      { ...activeUser, status: 'SUSPENDED' },
      { ...activeUser, credential: { ...activeUser.credential, expiresAt: new Date(Date.now() - 1000) } },
    ]) {
      const h = harness({ loginUser: user });
      await assert.rejects(
        () => h.useCase.attach({ ...cmd, token: RAW_TOKEN, identifier: 'somchai', password: 'right-password' }),
        UnauthorizedException,
      );
      assert.equal(h.provisions.length, 0);
    }
  });
});
