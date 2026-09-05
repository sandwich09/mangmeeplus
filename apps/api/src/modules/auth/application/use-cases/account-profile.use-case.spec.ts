import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { DenyByDefaultGuard } from '../../../../common/security/deny-by-default.guard';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from '../../../../common/security/permissions.decorator';
import { AuthController } from '../../presentation/auth.controller';
import { verifyPassword } from '../../domain/logic/password-credential.logic';
import { AccountProfileUseCase } from './account-profile.use-case';
import { PasswordLoginUseCase } from './password-login.use-case';
import { AuthRateLimitService } from '../auth-rate-limit.service';
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
function makePrisma(seed: { users?: Row[]; credentials?: Row[]; tokens?: Row[]; sessions?: Row[]; lineIdentities?: Row[] } = {}) {
  const users: Row[] = seed.users ?? [];
  const credentials: Row[] = seed.credentials ?? [];
  const tokens: Row[] = seed.tokens ?? [];
  const sessions: Row[] = seed.sessions ?? [];
  const lineIdentities: Row[] = seed.lineIdentities ?? [];

  const match = (row: Row, where: Row): boolean =>
    Object.entries(where).every(([key, value]) => {
      // `PasswordLoginUseCase` genuinely sends an OR of plain equalities.
      if (key === 'OR') return (value as Row[]).some((clause) => match(row, clause));
      // Never modelled: `mode: 'insensitive'` is ILIKE, and a fake that treats it as equality is
      // precisely what reported green while real Postgres refused `som_hai`
      // (`account-profile-username.pg.spec.ts`). Anything needing it must be raw SQL.
      if (value !== null && typeof value === 'object' && 'mode' in value) {
        throw new Error(`case-insensitive matching cannot be faked; use $queryRaw (field: ${key})`);
      }
      if (value !== null && typeof value === 'object' && 'not' in value) return row[key] !== (value as Row)['not'];
      if (value !== null && typeof value === 'object' && 'gt' in value) return row[key] > (value as Row)['gt'];
      return row[key] === value;
    });

  const withCredential = (user: Row | undefined) =>
    user && { ...user, credential: credentials.find((row) => row['userId'] === user['id']) ?? null };

  const client: any = {
    user: {
      findUnique: async ({ where }: any) => withCredential(users.find((row) => match(row, where))) ?? null,
      findFirst: async ({ where, include }: any) => {
        const row = users.find((user) => match(user, where)) ?? null;
        return row && include?.credential ? withCredential(row) : row;
      },
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
    externalIdentity: { findFirst: async ({ where }: any) => lineIdentities.find((row) => match(row, where)) ?? null },
    // Only `PasswordLoginUseCase` reads this; one active OWNER membership is enough for it.
    companyMembership: {
      findFirst: async () => ({ id: 'mem-1', companyId: 'company-1', roles: [{ role: { key: 'OWNER' } }] }),
    },
    authSession: {
      updateMany: async ({ where, data }: any) => {
        const matching = sessions.filter((row) => match(row, where));
        matching.forEach((row) => Object.assign(row, data));
        return { count: matching.length };
      },
    },
  };
  /**
   * The username uniqueness read is raw SQL, deliberately: Prisma's `mode: 'insensitive'` compiles
   * to ILIKE and `_` is a wildcard (see `account-profile-username.pg.spec.ts`). This fake answers
   * the ONE query the use case sends and refuses to guess at any other — a fake that modelled SQL
   * is exactly what reported green while real Postgres was refusing `som_hai`.
   */
  client.$queryRaw = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    assert.match(sql, /lower\("username"\) = /, `unmodelled raw query: ${sql}`);
    const [callerId, desired] = values as [string, string];
    return users
      .filter((row) => row['id'] !== callerId && String(row['username'] ?? '').toLowerCase() === desired)
      .slice(0, 1)
      .map((row) => ({ id: row['id'] }));
  };
  client.$transaction = async (fn: any) => fn(client);
  return { prisma: { client } as any, users, credentials, tokens, sessions, lineIdentities };
}

/** The push is a bare `fetch`, so this is how the repo's other push specs observe one. */
function captureLinePush() {
  const pushes: Array<{ to: string; text: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: any) => {
    const body = JSON.parse(init.body as string);
    pushes.push({ to: body.to, text: body.messages[0]?.text });
    return { ok: true, status: 200 } as Response;
  }) as typeof fetch;
  return { pushes, restore: () => { globalThis.fetch = original; } };
}

const lineConfig = { lineMessagingChannelAccessToken: 'synthetic-channel-token' } as any;

const audit = { log: async () => undefined } as any;
const mailer = { sendEmailVerification: async () => undefined } as any;

const LINE_ONLY_USER = { id: 'user-line', status: 'ACTIVE', username: null, email: null, emailVerifiedAt: null, phoneNumber: null, aiAssistantOptOutAt: null };

describe('AccountProfileUseCase — first password', () => {
  it('creates an ACTIVE credential that does not force a change, for an account that has none', async () => {
    const { prisma, credentials } = makePrisma({ users: [{ ...LINE_ONLY_USER }] });
    await new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'backup-password', 'mangmee.shop', 'req-1', 'session-current');

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
        && (error.getResponse() as Row)['code'] === 'password_already_set',
    );
    assert.equal(credentials[0]!['passwordHash'], 'scrypt$a$b', 'the existing hash must be untouched');
  });

  // F1: the whole point of a backup password is being able to log in with it afterwards.
  it('lets the LINE-first owner log in with the username they just set', async () => {
    const { prisma, users } = makePrisma({ users: [{ ...LINE_ONLY_USER }] });
    const result = await new AccountProfileUseCase(prisma, audit)
      .setInitialPassword('user-line', 'backup-password', ' MangMee.Shop ', 'req-1', 'session-current');
    assert.deepEqual(result, { username: 'mangmee.shop' }, 'the caller must be told the stored form');
    assert.equal(users[0]!['username'], 'mangmee.shop');

    // The real login use case, against the row that was just written.
    const session = await new PasswordLoginUseCase(
      prisma,
      { execute: async () => ({ accessToken: 'issued', refreshToken: 'r', expiresIn: 900 }) } as any,
      { getStatus: async () => ({ required: false }) } as any,
    ).execute(result.username!, 'backup-password');
    assert.equal(session.accessToken, 'issued', 'the credential must be reachable from the login form');
  });

  it('refuses a password that nothing could ever log in with', async () => {
    const { prisma, credentials } = makePrisma({ users: [{ ...LINE_ONLY_USER }] });
    await assert.rejects(
      () => new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'backup-password', undefined, 'req-1', 'session-current'),
      (error: unknown) => error instanceof BadRequestException && (error.getResponse() as Row)['code'] === 'username_required',
    );
    assert.equal(credentials.length, 0, 'a dead credential must never be stored');
  });

  it('accepts no username once a verified email can carry the login', async () => {
    const { prisma, credentials } = makePrisma({
      users: [{ ...LINE_ONLY_USER, email: 'owner@example.com', emailVerifiedAt: new Date() }],
    });
    await new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'backup-password', undefined, 'req-1', 'session-current');
    assert.equal(credentials.length, 1);
  });

  // F5: the DB unique index is case-SENSITIVE, so this read is the only thing standing between
  // "somchai" and "Somchai" becoming two login names — and the login lookup accepts an email too.
  it('rejects a username differing only by case from one already held', async () => {
    const { prisma } = makePrisma({
      // Stored with uppercase by another writer (`create-employee` does not lower-case), which is
      // the only shape an exact-match query would miss — the desired name is lower-cased first.
      users: [{ ...LINE_ONLY_USER }, { id: 'user-other', status: 'ACTIVE', username: 'SomChai', email: 'boss@example.com' }],
    });
    await assert.rejects(
      () => new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'backup-password', 'somchai', 'req-1', 'session-current'),
      (error: unknown) => error instanceof ConflictException && (error.getResponse() as Row)['code'] === 'username_taken',
      'a case-sensitive read would let two people hold one login name',
    );
    // The login lookup accepts an address as the identifier, so a username may not be one. The
    // character set refuses it before the uniqueness read does — hence 400, not 409.
    await assert.rejects(
      () => new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'backup-password', 'boss@example.com', 'req-1', 'session-current'),
      BadRequestException,
    );
  });

  // F3: a new way into the account invalidates every session opened before it.
  it('revokes the other sessions and tells the owner over LINE', async () => {
    const { prisma, sessions } = makePrisma({
      users: [{ ...LINE_ONLY_USER }],
      sessions: [
        { id: 's1', userId: 'user-line', tokenId: 'session-current', status: 'ACTIVE' },
        { id: 's2', userId: 'user-line', tokenId: 'session-other', status: 'ACTIVE' },
        { id: 's3', userId: 'user-other', tokenId: 'session-elsewhere', status: 'ACTIVE' },
      ],
      lineIdentities: [{ userId: 'user-line', provider: 'LINE', status: 'ACTIVE', providerUserId: 'line-user-1' }],
    });
    const line = captureLinePush();
    try {
      await new AccountProfileUseCase(prisma, audit, lineConfig)
        .setInitialPassword('user-line', 'backup-password', 'mangmee.shop', 'req-1', 'session-current');
    } finally {
      line.restore();
    }

    assert.equal(sessions.find((row) => row['tokenId'] === 'session-current')!['status'], 'ACTIVE', 'the tab doing the work must survive');
    assert.equal(sessions.find((row) => row['tokenId'] === 'session-other')!['status'], 'REVOKED');
    assert.equal(sessions.find((row) => row['tokenId'] === 'session-elsewhere')!['status'], 'ACTIVE', 'another user is not touched');

    assert.equal(line.pushes.length, 1);
    assert.equal(line.pushes[0]!.to, 'line-user-1');
    assert.match(line.pushes[0]!.text, /098-256-5628/, 'the notice must say what to do if it was not them');
  });

  // L3: an unlinked identity belongs to a LINE account that no longer speaks for this user.
  it('does not announce the password to a revoked LINE identity', async () => {
    const { prisma, credentials } = makePrisma({
      users: [{ ...LINE_ONLY_USER }],
      lineIdentities: [{ userId: 'user-line', provider: 'LINE', status: 'REVOKED', providerUserId: 'line-old-phone' }],
    });
    const line = captureLinePush();
    try {
      await new AccountProfileUseCase(prisma, audit, lineConfig)
        .setInitialPassword('user-line', 'backup-password', 'mangmee.shop', 'req-1', 'session-current');
    } finally {
      line.restore();
    }
    assert.equal(credentials.length, 1, 'the password is still set');
    assert.deepEqual(line.pushes, [], 'a revoked identity must not be told a password was set');
  });

  it('still sets the password when there is no LINE identity to notify', async () => {
    const { prisma, credentials } = makePrisma({ users: [{ ...LINE_ONLY_USER }] });
    const line = captureLinePush();
    try {
      await new AccountProfileUseCase(prisma, audit, lineConfig)
        .setInitialPassword('user-line', 'backup-password', 'mangmee.shop', 'req-1', 'session-current');
    } finally {
      line.restore();
    }
    assert.equal(credentials.length, 1);
    assert.equal(line.pushes.length, 0);
  });

  // M1: a Thai owner typing สมชาย was getting an uncoded English sentence.
  it('rejects a username that is not a usable login name, with a code the web can translate', async () => {
    const { prisma, credentials } = makePrisma({ users: [{ ...LINE_ONLY_USER }] });
    for (const bad of ['สมชาย', 'ก ข', 'ab', 'som chai', 'somchai@gmail.com']) {
      await assert.rejects(
        () => new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'backup-password', bad, 'req-1', 'session-current'),
        (error: unknown) => error instanceof BadRequestException
          && (error.getResponse() as Row)['code'] === 'invalid_username',
        bad,
      );
    }
    assert.equal(credentials.length, 0);
  });

  // L5: an unverified address cannot receive a reset, so it is not a login identifier.
  it('does not let an unverified email stand in for a username', async () => {
    const { prisma, credentials } = makePrisma({
      users: [{ ...LINE_ONLY_USER, email: 'owner@example.com', emailVerifiedAt: null }],
    });
    await assert.rejects(
      () => new AccountProfileUseCase(prisma, audit).setInitialPassword('user-line', 'backup-password', undefined, 'req-1', 'session-current'),
      (error: unknown) => error instanceof BadRequestException && (error.getResponse() as Row)['code'] === 'username_required',
    );
    assert.equal(credentials.length, 0);
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

  // F8: the ACTIVE clause is the whole tenancy guard on this write.
  it('refuses to write the number of a user who is not active', async () => {
    const { prisma, users } = makePrisma({ users: [{ ...LINE_ONLY_USER, status: 'DISABLED' }] });
    await assert.rejects(
      () => new AccountProfileUseCase(prisma, audit).setPhoneNumber('user-line', '0812345678', 'req-1'),
      NotFoundException,
    );
    assert.equal(users[0]!['phoneNumber'], null);
  });

  it('rejects anything that is not a 10-digit Thai mobile', async () => {
    const { prisma, users } = makePrisma({ users: [{ ...LINE_ONLY_USER, phoneNumber: '0812345678' }] });
    for (const bad of ['12345', '0812345', '66812345678', '081234567890']) {
      await assert.rejects(
        () => new AccountProfileUseCase(prisma, audit).setPhoneNumber('user-line', bad, 'req-1'),
        (error: unknown) => error instanceof BadRequestException
          && (error.getResponse() as Row)['code'] === 'invalid_phone_number',
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

  // F6: `username_taken` makes password/set a username oracle for anyone with one valid session.
  it('spends a per-user budget on both writes before the use case is reached', async () => {
    const limiter = new AuthRateLimitService({} as any);
    const seen: Array<{ scope: string; key: string; max: number }> = [];
    Reflect.set(limiter, 'limits', {
      consume: async (scope: string, key: string, max: number) => {
        seen.push({ scope, key, max });
        return { allowed: seen.filter((entry) => entry.scope === scope).length <= max, retryAfterSeconds: 60 };
      },
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limiter.assertAccountProfileWriteAllowed('user-line');
    }
    await assert.rejects(
      () => limiter.assertAccountProfileWriteAllowed('user-line'),
      (error: unknown) => error instanceof HttpException && error.getStatus() === 429,
      'an unbounded oracle is the finding; the eleventh call must be refused',
    );
    assert.equal(seen[0]!.scope, 'account-profile-write-user');
    assert.equal(seen[0]!.key, 'user-line', 'the budget is per account, not per IP');

    // And the controller actually spends it — on both routes, before doing any work.
    const controller = readFileSync(join(__dirname, '../../presentation/auth.controller.ts'), 'utf8');
    for (const handler of ['async setMyContact', 'async setMyFirstPassword']) {
      const start = controller.indexOf(handler);
      assert.notEqual(start, -1, handler);
      const body = controller.slice(start, controller.indexOf('\n  }', start));
      assert.match(body, /assertAccountProfileWriteAllowed\(req\.context\.userId\)/, handler);
      assert.ok(
        body.indexOf('assertAccountProfileWriteAllowed') < body.indexOf('this.accountProfile.'),
        `${handler}: the budget must be spent before the write`,
      );
    }
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
