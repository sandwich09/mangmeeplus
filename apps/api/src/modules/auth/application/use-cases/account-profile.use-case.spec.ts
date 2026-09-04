import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DenyByDefaultGuard } from '../../../../common/security/deny-by-default.guard';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { AuthController } from '../../presentation/auth.controller';
import { verifyPassword } from '../../domain/logic/password-credential.logic';
import { AccountProfileUseCase, PASSWORD_ALREADY_SET, USERNAME_TAKEN, INVALID_PHONE_NUMBER } from './account-profile.use-case';
import { RequestEmailChangeUseCase } from './request-email-change.use-case';
import { ConfirmEmailVerificationUseCase } from './confirm-email-verification.use-case';
import { GetAccountSecurityStateUseCase } from './get-account-security-state.use-case';
import { hashToken } from '../../domain/logic/secure-token.logic';

type Row = Record<string, any>;

/**
 * One in-memory Prisma stand-in for the whole "my account" surface. Shared between the four
 * use cases under test on purpose: the single-use email token and the credential row are only
 * interesting because a *second* call sees what the first one wrote.
 */
function makePrisma(seed: { users?: Row[]; credentials?: Row[]; tokens?: Row[] } = {}) {
  const users: Row[] = seed.users ?? [];
  const credentials: Row[] = seed.credentials ?? [];
  const tokens: Row[] = seed.tokens ?? [];

  const match = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (value !== null && typeof value === 'object' && 'not' in value) return row[key] !== (value as Row)['not'];
      if (value !== null && typeof value === 'object' && 'gt' in value) return row[key] > (value as Row)['gt'];
      return row[key] === value;
    });

  const withCredential = (user: Row | undefined) =>
    user && { ...user, credential: credentials.find((row) => row['userId'] === user['id']) ?? null };

  const client: any = {
    user: {
      findUnique: async ({ where }: any) => withCredential(users.find((row) => match(row, where))) ?? null,
      findFirst: async ({ where }: any) => users.find((row) => match(row, where)) ?? null,
      update: async ({ where, data }: any) => {
        const user = users.find((row) => match(row, where));
        if (data.username && users.some((row) => row['username'] === data.username && row['id'] !== user!['id'])) {
          throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['username'] } });
        }
        return Object.assign(user!, data);
      },
      updateMany: async ({ where, data }: any) => {
        const matching = users.filter((row) => match(row, where));
        matching.forEach((row) => Object.assign(row, data));
        return { count: matching.length };
      },
    },
    userCredential: {
      create: async ({ data }: any) => {
        if (credentials.some((row) => row['userId'] === data.userId)) {
          throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: ['userId'] } });
        }
        credentials.push({ ...data });
        return data;
      },
    },
    emailVerificationToken: {
      findUnique: async ({ where }: any) => tokens.find((row) => match(row, where)) ?? null,
      findFirst: async ({ where }: any) => tokens.find((row) => match(row, where)) ?? null,
      create: async ({ data }: any) => { const row = { id: `tok-${tokens.length + 1}`, status: 'PENDING', ...data }; tokens.push(row); return row; },
      updateMany: async ({ where, data }: any) => {
        const matching = tokens.filter((row) => match(row, where));
        matching.forEach((row) => Object.assign(row, data));
        return { count: matching.length };
      },
    },
    externalIdentity: { findFirst: async () => null },
  };
  client.$transaction = async (fn: any) => fn(client);
  return { prisma: { client } as any, users, credentials, tokens };
}

const audit = { log: async () => undefined } as any;
const mailer = { sendEmailVerification: async () => undefined } as any;

const LINE_ONLY_USER = { id: 'user-line', status: 'ACTIVE', username: null, email: null, emailVerifiedAt: null, phoneNumber: null, aiAssistantOptOutAt: null };

describe('AccountProfileUseCase — first password', () => {
  it('creates an ACTIVE credential that does not force a change, for an account that has none', async () => {
    const { prisma, credentials } = makePrisma({ users: [{ ...LINE_ONLY_USER }] });
    await new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'backup-password', undefined, 'req-1');

    assert.equal(credentials.length, 1);
    assert.equal(credentials[0]!['status'], 'ACTIVE');
    assert.equal(credentials[0]!['mustChangePassword'], false);
    assert.equal(verifyPassword('backup-password', credentials[0]!['passwordHash']), true);
  });

  // The whole reason this route can skip a current-password proof: it can only ever create.
  it('refuses to overwrite an existing password and names the change-password route instead', async () => {
    const { prisma, credentials } = makePrisma({
      users: [{ ...LINE_ONLY_USER }],
      credentials: [{ userId: 'user-line', passwordHash: 'scrypt$a$b', status: 'ACTIVE', mustChangePassword: false }],
    });
    await assert.rejects(
      () => new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'attacker-password', undefined, 'req-1'),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as Row)['code'] === PASSWORD_ALREADY_SET,
    );
    assert.equal(credentials[0]!['passwordHash'], 'scrypt$a$b', 'the existing hash must be untouched');
  });

  it('takes an optional username and rejects one that is already held', async () => {
    const { prisma, users } = makePrisma({
      users: [{ ...LINE_ONLY_USER }, { id: 'user-other', status: 'ACTIVE', username: 'somchai', email: null }],
    });
    const useCase = new AccountProfileUseCase(prisma, audit);

    await assert.rejects(
      () => useCase.setInitialPassword('user-line', 'backup-password', 'Somchai', 'req-1'),
      (error: unknown) => error instanceof ConflictException && (error.getResponse() as Row)['code'] === USERNAME_TAKEN,
    );

    await useCase.setInitialPassword('user-line', 'backup-password', ' MangMee.Shop ', 'req-2');
    assert.equal(users.find((row) => row['id'] === 'user-line')!['username'], 'mangmee.shop');
  });

  it('rejects a username that is not a usable login name', async () => {
    const { prisma } = makePrisma({ users: [{ ...LINE_ONLY_USER }] });
    await assert.rejects(
      () => new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'backup-password', 'ก ข', 'req-1'),
      BadRequestException,
    );
  });
});

describe('AccountProfileUseCase — recovery phone', () => {
  it('stores a Thai mobile however the owner spaced it, and clears it when blank', async () => {
    const { prisma, users } = makePrisma({ users: [{ ...LINE_ONLY_USER }] });
    const useCase = new AccountProfileUseCase(prisma, audit);

    assert.deepEqual(await useCase.setPhoneNumber('user-line', '081-234-5678', 'req-1'), { phoneNumber: '0812345678' });
    assert.equal(users[0]!['phoneNumber'], '0812345678');

    assert.deepEqual(await useCase.setPhoneNumber('user-line', '', 'req-2'), { phoneNumber: null });
    assert.equal(users[0]!['phoneNumber'], null);
  });

  it('rejects anything that is not a 10-digit Thai mobile', async () => {
    const { prisma, users } = makePrisma({ users: [{ ...LINE_ONLY_USER, phoneNumber: '0812345678' }] });
    for (const bad of ['12345', '0812345', '66812345678', '081234567890']) {
      await assert.rejects(
        () => new AccountProfileUseCase(prisma, audit).setPhoneNumber('user-line', bad, 'req-1'),
        (error: unknown) => error instanceof BadRequestException
          && (error.getResponse() as Row)['code'] === INVALID_PHONE_NUMBER,
        bad,
      );
    }
    assert.equal(users[0]!['phoneNumber'], '0812345678', 'a rejected write must not clear the stored number');
  });
});

describe('recovery email for an account with no password', () => {
  it('lets a credential-less LINE account request verification without a password', async () => {
    const { prisma, tokens } = makePrisma({ users: [{ ...LINE_ONLY_USER }] });
    const result = await new RequestEmailChangeUseCase(prisma, mailer, audit)
      .execute({ userId: 'user-line', newEmail: 'Owner@Example.com', requestId: 'req-1' });

    assert.equal(result.email, 'owner@example.com');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0]!['status'], 'PENDING');
  });

  // The password stays mandatory the moment there is one to prove.
  it('still demands the current password once a credential exists', async () => {
    const { prisma, tokens } = makePrisma({
      users: [{ ...LINE_ONLY_USER }],
      credentials: [{ userId: 'user-line', passwordHash: 'scrypt$a$b', status: 'ACTIVE' }],
    });
    await assert.rejects(
      () => new RequestEmailChangeUseCase(prisma, mailer, audit)
        .execute({ userId: 'user-line', newEmail: 'owner@example.com', requestId: 'req-1' }),
      BadRequestException,
    );
    assert.equal(tokens.length, 0);
  });

  it('answers a mailbox held by another account with the merge code, not a dead end', async () => {
    const { prisma } = makePrisma({
      users: [{ ...LINE_ONLY_USER }, { id: 'user-other', status: 'ACTIVE', email: 'owner@example.com' }],
    });
    await assert.rejects(
      () => new RequestEmailChangeUseCase(prisma, mailer, audit)
        .execute({ userId: 'user-line', newEmail: 'owner@example.com', requestId: 'req-1' }),
      (error: unknown) => error instanceof ConflictException
        && (error.getResponse() as Row)['code'] === 'email_belongs_to_other_account',
    );
  });

  it('spends the confirmation token exactly once', async () => {
    const raw = 'raw-verification-token';
    const { prisma, users } = makePrisma({
      users: [{ ...LINE_ONLY_USER }],
      tokens: [{
        id: 'tok-1', userId: 'user-line', newEmail: 'owner@example.com',
        tokenHash: hashToken(raw), status: 'PENDING', expiresAt: new Date(Date.now() + 60_000),
      }],
    });
    const useCase = new ConfirmEmailVerificationUseCase(prisma, audit);

    const first = await useCase.execute({ token: raw, requestId: 'req-1' });
    assert.equal(first.email, 'owner@example.com');
    assert.equal(users[0]!['email'], 'owner@example.com');
    assert.ok(users[0]!['emailVerifiedAt']);

    await assert.rejects(() => useCase.execute({ token: raw, requestId: 'req-2' }), ForbiddenException);
  });
});

describe('GET account/security reports what the profile page must branch on', () => {
  it('separates "no password at all" from "has one"', async () => {
    const noCredential = makePrisma({ users: [{ ...LINE_ONLY_USER, phoneNumber: '0812345678' }] });
    const state = await new GetAccountSecurityStateUseCase(noCredential.prisma).execute('user-line');
    assert.equal(state.hasPassword, false);
    assert.equal(state.phoneNumber, '0812345678');

    const withCredential = makePrisma({
      users: [{ ...LINE_ONLY_USER }],
      credentials: [{ id: 'cred-1', userId: 'user-line', passwordHash: 'scrypt$a$b', status: 'ACTIVE' }],
    });
    assert.equal((await new GetAccountSecurityStateUseCase(withCredential.prisma).execute('user-line')).hasPassword, true);
  });
});

/** The real guard, fed the real decorator metadata off the real controller — not a restatement. */
describe('the HTTP surface of the my-account routes', () => {
  const handlerOf = (name: keyof AuthController) =>
    (AuthController.prototype as unknown as Record<string, object>)[name]!;

  function guardFor(name: keyof AuthController) {
    const method = handlerOf(name);
    const reflector = {
      getAllAndOverride: (key: string) =>
        key === REQUIRED_PERMISSIONS_KEY ? Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, method) ?? []
          : key === REQUIRED_ANY_PERMISSIONS_KEY ? Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, method) ?? []
            : undefined,
    } as any;
    return new DenyByDefaultGuard(reflector);
  }

  const context = (permissions: string[]) => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ context: { permissions, userId: 'user-line' } }) }),
  }) as any;

  it('mounts the routes the profile page calls', () => {
    assert.equal(Reflect.getMetadata(PATH_METADATA, handlerOf('setMyContact')), 'me/contact');
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handlerOf('setMyContact')), RequestMethod.PATCH);
    assert.equal(Reflect.getMetadata(PATH_METADATA, handlerOf('setMyFirstPassword')), 'me/password/set');
    assert.equal(Reflect.getMetadata(METHOD_METADATA, handlerOf('setMyFirstPassword')), RequestMethod.POST);
  });

  it('refuses a member who does not hold the self-service key, and admits one who does', () => {
    for (const route of ['setMyContact', 'setMyFirstPassword'] as const) {
      assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handlerOf(route)), ['account.password.change']);
      // A STAFF-shaped context that can read its own session but was never granted the write key.
      assert.throws(() => guardFor(route).canActivate(context(['account.session.read'])), ForbiddenException, route);
      assert.equal(guardFor(route).canActivate(context(['account.session.read', 'account.password.change'])), true, route);
    }
  });
});
