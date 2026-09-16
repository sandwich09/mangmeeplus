import { lineMessagingCredentialsFixture } from '../../common/config/line-messaging-credentials.fixture';
import { describe, it, beforeEach } from 'node:test';
import './line-recovery.pg.spec';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { IssueTokenUseCase } from './application/use-cases/issue-token.use-case';
import { ExchangeLineTokenUseCase } from './application/use-cases/exchange-line-token.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RevokeOtherSessionsUseCase } from './application/use-cases/revoke-other-sessions.use-case';
import { PasswordLoginUseCase } from './application/use-cases/password-login.use-case';
import { NotifyPasswordResetRequestUseCase } from './application/use-cases/notify-password-reset-request.use-case';
import { ChangePasswordUseCase, CURRENT_PASSWORD_INCORRECT } from './application/use-cases/change-password.use-case';
import { hashPassword, verifyPassword } from './domain/logic/password-credential.logic';
import { hashToken, hashLineRecoveryPassword } from './domain/logic/secure-token.logic';
import { WatchdogJwtVerifierAdapter } from './infrastructure/watchdog-jwt-verifier.adapter';
import { DevJwtVerifierAdapter } from './infrastructure/dev-jwt-verifier.adapter';
import { PlatformAccessService } from './application/platform-access.service';
import { DisabledAuthMailerAdapter } from './infrastructure/disabled-auth-mailer.adapter';
import { LocalConsoleAuthMailerAdapter } from './infrastructure/local-console-auth-mailer.adapter';
import { SesAuthMailerAdapter } from './infrastructure/ses-auth-mailer.adapter';
import { selectAuthMailer } from './auth.module';
import { AppConfigService } from '../../common/config/app-config.service';

const pendingLegalAcceptance = {
  getStatus: async () => ({ required: true }),
} as any;

describe('LINE recovery credential lifecycle', () => {
  it('rejects a pending recovery password after the user changes their password', async () => {
    let credential = {
      passwordHash: hashPassword('old-user-password'), status: 'ACTIVE', mustChangePassword: false,
      updatedAt: new Date('2026-08-27T08:00:00Z'), expiresAt: null,
    };
    const tokens: any[] = [];
    let recoveryPassword = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init: any) => {
      recoveryPassword = JSON.parse(init.body).messages[0].contents.footer.contents[0].action.clipboardText;
      return { ok: true } as Response;
    }) as typeof fetch;
    const client: any = {
      $executeRaw: async () => 1,
      $queryRaw: async () => [{ id: 'credential-1' }],
      emailVerificationToken: { updateMany: async () => ({ count: 0 }) },
      user: {
        update: async () => ({}),
        findFirst: async () => ({ id: 'user-1', status: 'ACTIVE', credential: { ...credential } }),
        findMany: async () => [{ id: 'user-1', status: 'ACTIVE', credential: { ...credential } }],
      },
      companyMembership: { findFirst: async () => ({ id: 'member-1', companyId: 'company-1', roles: [{ role: { key: 'OWNER' } }] }) },
      externalIdentity: { findFirst: async () => ({ providerUserId: 'synthetic-line-owner' }) },
      userCredential: {
        findUnique: async () => ({ ...credential }),
        update: async ({ data }: any) => (credential = { ...credential, ...data, updatedAt: new Date(credential.updatedAt.getTime() + 1) }),
      },
      passwordResetToken: {
        create: async ({ data }: any) => { const token = { id: 'reset-1', ...data, status: 'PENDING' }; tokens.push(token); return token; },
        findUnique: async ({ where }: any) => tokens.find((token) => token.tokenHash === where.tokenHash) ?? null,
        updateMany: async ({ where, data }: any) => {
          const matching = tokens.filter((token) => token.status === where.status && (!where.id || token.id === where.id));
          matching.forEach((token) => Object.assign(token, data));
          return { count: matching.length };
        },
      },
      authSession: { updateMany: async () => ({ count: 0 }) },
      auditLog: { create: async () => ({}) },
    };
    client.$transaction = async (fn: any) => fn(client);
    const prisma = { client } as any;
    const issueToken = { execute: async () => ({ accessToken: 'test', refreshToken: 'test', expiresIn: 900 }) } as any;
    try {
      await new NotifyPasswordResetRequestUseCase(lineMessagingCredentialsFixture({ lineMessagingChannelId: 'synthetic', lineMessagingChannelAccessToken: 'synthetic', passwordResetResponseMinMs: 0 } as any), prisma, { lineMessagingChannelId: 'synthetic', lineMessagingChannelAccessToken: 'synthetic', passwordResetResponseMinMs: 0 } as any)
        .execute({ username: 'owner.one' });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(recoveryPassword);
      await new ChangePasswordUseCase(prisma).execute('user-1', 'old-user-password', 'new-user-password', 'current-session');
      await assert.rejects(
        () => new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance).execute('owner.one', recoveryPassword),
        (error: unknown) => error instanceof UnauthorizedException,
      );
      assert.equal(verifyPassword('new-user-password', credential.passwordHash), true);
      assert.equal(tokens[0].status, 'PENDING', 'an invalidated token must not rotate the current credential');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---- IssueTokenUseCase ----

function makeJwtService(secret: string) {
  // ponytail: use real @nestjs/jwt JwtService via dynamic import
  const { JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt');
  const svc = new JwtService({});
  return svc;
}

describe('IssueTokenUseCase', () => {
  it('creates a session and returns access + refresh tokens', async () => {
    const created: unknown[] = [];
    const prisma = {
      client: {
        authSession: {
          create: async (args: unknown) => { created.push(args); return {}; },
        },
      },
    } as any;
    const config = {
      authJwtSecret: 'test-secret',
      watchdogJwtSecret: 'test-secret',
      devAuthSecret: undefined,
      watchdogJwtIssuer: undefined,
      watchdogJwtAudience: undefined,
    } as any;
    const useCase = new IssueTokenUseCase(makeJwtService('test-secret'), prisma, config);

    const result = await useCase.execute('user-123');

    assert.ok(result.accessToken, 'accessToken must be present');
    assert.ok(result.refreshToken, 'refreshToken must be present');
    assert.equal(result.expiresIn, 900);
    assert.equal(created.length, 1, 'one AuthSession must be created');
  });

  it('throws when no signing secret is configured', async () => {
    const { JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt');
    const prisma = { client: { authSession: { create: async () => ({}) } } } as any;
    const config = { authJwtSecret: undefined, watchdogJwtSecret: undefined, devAuthSecret: undefined } as any;
    const useCase = new IssueTokenUseCase(new JwtService({}), prisma, config);

    await assert.rejects(() => useCase.execute('user-123'));
  });

  it('locks and rechecks the verified password credential before creating a watchdog session', async () => {
    const credentialUpdatedAt = new Date('2026-08-09T08:00:00.000Z');
    const order: string[] = [];
    const tx = {
      $queryRaw: async (strings: TemplateStringsArray) => {
        assert.match(strings.join('?'), /UserCredential.*FOR UPDATE/);
        order.push('lock');
        return [{ id: 'credential-1' }];
      },
      userCredential: {
        findUnique: async () => {
          order.push('recheck');
          return { updatedAt: credentialUpdatedAt };
        },
      },
      authSession: {
        create: async () => {
          order.push('session');
          return {};
        },
      },
    };
    const prisma = {
      client: {
        $transaction: async (fn: (db: typeof tx) => Promise<void>) => fn(tx),
        authSession: { create: async () => { throw new Error('must create inside transaction'); } },
      },
    } as any;
    const config = { authJwtSecret: 'test-secret' } as any;

    await new IssueTokenUseCase(makeJwtService('test-secret'), prisma, config)
      .execute('user-123', 'watchdog', credentialUpdatedAt);

    assert.deepEqual(order, ['lock', 'recheck', 'session']);
  });

  it('rejects a password login whose credential changed before its session was created', async () => {
    let sessionCreated = false;
    const tx = {
      $queryRaw: async () => [],
      userCredential: {
        findUnique: async () => ({ updatedAt: new Date('2026-08-09T08:00:01.000Z') }),
      },
      authSession: {
        create: async () => { sessionCreated = true; return {}; },
      },
    };
    const prisma = {
      client: {
        $transaction: async (fn: (db: typeof tx) => Promise<void>) => fn(tx),
        authSession: { create: async () => ({}) },
      },
    } as any;
    const config = { authJwtSecret: 'test-secret' } as any;
    const useCase = new IssueTokenUseCase(makeJwtService('test-secret'), prisma, config);

    await assert.rejects(
      () => useCase.execute('user-123', 'watchdog', new Date('2026-08-09T08:00:00.000Z')),
      (error: unknown) => error instanceof UnauthorizedException,
    );
    assert.equal(sessionCreated, false);
  });
});

// ---- Password credentials ----

describe('PasswordLoginUseCase', () => {
  it('blocks an ordinary valid credential while customer access is closed and issues no token', async () => {
    let issued = 0;
    const prisma = {
      client: {
        user: { findFirst: async () => ({
          id: 'user-1', status: 'ACTIVE', credential: {
            status: 'ACTIVE', passwordHash: hashPassword('watchdogbms11'), mustChangePassword: false, expiresAt: null,
          },
        }) },
        companyMembership: { findFirst: async () => ({
          id: 'membership-1', companyId: 'company-1', roles: [{ role: { key: 'OWNER' } }],
        }) },
      },
    } as any;
    const issueToken = { execute: async () => { issued += 1; return {}; } } as any;
    const closed = { getStatus: async () => ({ effectiveState: 'CLOSED' }) } as any;

    await assert.rejects(
      () => new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance, closed).execute('owner', 'watchdogbms11'),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.equal((error.getResponse() as any).code, 'platform_access_closed');
        return true;
      },
    );
    assert.equal(issued, 0);
  });

  it('allows SYSTEM_ADMIN while customer access is closed', async () => {
    const prisma = {
      client: {
        user: { findFirst: async () => ({
          id: 'admin-1', status: 'ACTIVE', credential: {
            status: 'ACTIVE', passwordHash: hashPassword('watchdogbms11'), mustChangePassword: false,
            expiresAt: null, updatedAt: new Date(),
          },
        }) },
        companyMembership: { findFirst: async () => ({
          id: 'membership-1', companyId: 'system-company', roles: [{ role: { key: 'SYSTEM_ADMIN' } }],
        }) },
      },
    } as any;
    const issueToken = { execute: async () => ({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }) } as any;
    const accepted = { getStatus: async () => ({ required: false }) } as any;
    const closed = { getStatus: async () => ({ effectiveState: 'CLOSED' }) } as any;
    const result = await new PasswordLoginUseCase(prisma, issueToken, accepted, closed)
      .execute('system-admin', 'watchdogbms11');
    assert.equal(result.redirectPath, '/system/platform-access');
    assert.equal(result.legalAcceptanceRequired, false);
  });

  it('issues watchdog tokens for an active username/password credential', async () => {
    const credentialUpdatedAt = new Date('2026-08-09T07:00:00.000Z');
    const issueToken = { execute: async (userId: string, provider: string, version: Date) => {
      assert.equal(userId, 'user-1');
      assert.equal(provider, 'watchdog');
      assert.equal(version, credentialUpdatedAt);
      return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
    } } as any;
    const prisma = {
      client: {
        user: {
          findFirst: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            credential: {
              status: 'ACTIVE',
              passwordHash: hashPassword('watchdogbms11'),
              mustChangePassword: false,
              expiresAt: null,
              updatedAt: credentialUpdatedAt,
            },
          }),
        },
        companyMembership: {
          findFirst: async () => ({ companyId: 'company-1', roles: [{ role: { key: 'OWNER' } }] }),
        },
      },
    } as any;

    const result = await new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance).execute('thawatchai.watchdog', 'watchdogbms11');
    assert.equal(result.accessToken, 'access');
    assert.equal(result.passwordChangeRequired, false);
    assert.equal(result.companyId, 'company-1');
    assert.equal(result.redirectPath, '/companies/company-1/dashboard');
    assert.equal(result.legalAcceptanceRequired, true);
  });

  it('keeps the current password valid while a recovery token is pending', async () => {
    const credentialUpdatedAt = new Date('2026-08-26T08:00:00.000Z');
    let rotated = false;
    const prisma = {
      client: {
        user: { findFirst: async () => ({
          id: 'user-1', status: 'ACTIVE', credential: {
            status: 'ACTIVE', passwordHash: hashPassword('current-password'),
            mustChangePassword: false, expiresAt: null, updatedAt: credentialUpdatedAt,
          },
        }) },
        passwordResetToken: { findUnique: async () => ({
          id: 'reset-1', userId: 'user-1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000),
        }) },
        companyMembership: { findFirst: async () => ({
          id: 'membership-1', companyId: 'company-1', roles: [{ role: { key: 'OWNER' } }],
        }) },
        $transaction: async () => { rotated = true; },
      },
    } as any;
    const issueToken = { execute: async (_userId: string, _provider: string, version: Date) => {
      assert.equal(version, credentialUpdatedAt);
      return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
    } } as any;

    const result = await new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance)
      .execute('owner.one', 'current-password');

    assert.equal(result.passwordChangeRequired, false);
    assert.equal(rotated, false);
  });

  it('atomically turns a one-time LINE recovery password into a forced-change credential', async () => {
    const recoveryPassword = 'Abcdef12_-xy';
    const oldHash = hashPassword('current-password');
    const credentialUpdatedAt = new Date('2026-08-26T08:10:00.000Z');
    const nextCredentialUpdatedAt = new Date('2026-08-26T08:11:00.000Z');
    let credentialUpdate: any;
    let sessionUpdate: any;
    let auditCreate: any;
    const tx = {
      $queryRaw: async () => [{ id: 'credential-1' }],
      passwordResetToken: {
        updateMany: async ({ where, data }: any) => {
          assert.equal(where.id, 'reset-1');
          assert.equal(where.userId, 'user-1');
          assert.equal(where.status, 'PENDING');
          assert.deepEqual(data, { status: 'USED', usedAt: where.expiresAt.gt });
          return { count: 1 };
        },
      },
      userCredential: {
        findUnique: async () => ({ status: 'ACTIVE', passwordHash: oldHash, updatedAt: credentialUpdatedAt }),
        update: async (args: any) => {
          credentialUpdate = args;
          return { updatedAt: nextCredentialUpdatedAt };
        },
      },
      authSession: {
        updateMany: async (args: any) => {
          sessionUpdate = args;
          return { count: 2 };
        },
      },
      auditLog: { create: async (args: any) => { auditCreate = args; return {}; } },
    };
    const prisma = {
      client: {
        user: { findFirst: async () => ({
          id: 'user-1', status: 'ACTIVE', credential: {
            status: 'ACTIVE', passwordHash: oldHash, mustChangePassword: false,
            expiresAt: null, updatedAt: credentialUpdatedAt,
          },
        }) },
        passwordResetToken: { findUnique: async ({ where }: any) => {
          assert.equal(where.tokenHash, hashLineRecoveryPassword(recoveryPassword, oldHash));
          return { id: 'reset-1', userId: 'user-1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) };
        } },
        companyMembership: { findFirst: async () => ({
          id: 'membership-1', companyId: 'company-1', roles: [{ role: { key: 'STAFF' } }],
        }) },
        $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => fn(tx),
      },
    } as any;
    const issueToken = { execute: async (userId: string, provider: string, version: Date) => {
      assert.equal(userId, 'user-1');
      assert.equal(provider, 'watchdog');
      assert.equal(version, nextCredentialUpdatedAt);
      return { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
    } } as any;

    const result = await new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance)
      .execute('staff.one', recoveryPassword);

    assert.equal(result.passwordChangeRequired, true);
    assert.equal(credentialUpdate.data.status, 'TEMPORARY');
    assert.equal(credentialUpdate.data.mustChangePassword, true);
    assert.equal(verifyPassword(recoveryPassword, credentialUpdate.data.passwordHash), true);
    assert.equal(verifyPassword('current-password', credentialUpdate.data.passwordHash), false);
    assert.equal(credentialUpdate.data.tempPasswordEncrypted, null);
    assert.deepEqual(sessionUpdate.where, { userId: 'user-1', status: 'ACTIVE' });
    assert.equal(sessionUpdate.data.status, 'REVOKED');
    assert.equal(auditCreate.data.targetId, 'reset-1');
    assert.equal(auditCreate.data.metadataJson.revokedSessionCount, 2);
  });

  it('never treats a parked email-reset token as a login password', async () => {
    let tokenLookupCalled = false;
    const prisma = {
      client: {
        user: { findFirst: async () => ({
          id: 'user-1', status: 'ACTIVE', credential: {
            status: 'ACTIVE', passwordHash: hashPassword('current-password'),
            mustChangePassword: false, expiresAt: null, updatedAt: new Date(),
          },
        }) },
        passwordResetToken: { findUnique: async () => {
          tokenLookupCalled = true;
          return { id: 'email-reset', userId: 'user-1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) };
        } },
      },
    } as any;
    const issueToken = { execute: async () => { throw new Error('must not issue'); } } as any;

    await assert.rejects(
      () => new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance).execute('staff.one', 'x'.repeat(43)),
      (error: unknown) => error instanceof UnauthorizedException,
    );
    assert.equal(tokenLookupCalled, false);
  });

  it('rejects an expired or concurrently claimed recovery password as invalid credentials', async () => {
    for (const token of [
      { id: 'expired', userId: 'user-1', status: 'PENDING', expiresAt: new Date(Date.now() - 1) },
      { id: 'claimed', userId: 'user-1', status: 'PENDING', expiresAt: new Date(Date.now() + 60_000) },
    ]) {
      let transactionCalled = false;
      const currentCredential = {
        status: 'ACTIVE', passwordHash: hashPassword('current-password'),
        mustChangePassword: false, expiresAt: null, updatedAt: new Date(),
      };
      const tx = {
        $queryRaw: async () => [{ id: 'credential-1' }],
        userCredential: { findUnique: async () => currentCredential },
        passwordResetToken: { updateMany: async () => ({ count: 0 }) },
      };
      const prisma = {
        client: {
          user: { findFirst: async () => ({
            id: 'user-1', status: 'ACTIVE', credential: currentCredential,
          }) },
          passwordResetToken: { findUnique: async () => token },
          companyMembership: { findFirst: async () => ({
            id: 'membership-1', companyId: 'company-1', roles: [{ role: { key: 'STAFF' } }],
          }) },
          $transaction: async (fn: (db: typeof tx) => Promise<unknown>) => {
            transactionCalled = true;
            return fn(tx);
          },
        },
      } as any;
      const issueToken = { execute: async () => { throw new Error('must not issue'); } } as any;

      await assert.rejects(
        () => new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance).execute('staff.one', 'Abcdef12_-xy'),
        (error: unknown) => error instanceof UnauthorizedException,
      );
      assert.equal(transactionCalled, token.id === 'claimed');
    }
  });

  it('matches the trimmed identifier against username or lowercased email', async () => {
    const issueToken = { execute: async () => ({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }) } as any;
    let capturedWhere: any = null;
    const prisma = {
      client: {
        user: {
          findFirst: async (args: any) => {
            capturedWhere = args.where;
            return {
              id: 'user-1',
              status: 'ACTIVE',
              credential: {
                status: 'ACTIVE',
                passwordHash: hashPassword('watchdogbms11'),
                mustChangePassword: false,
                expiresAt: null,
              },
            };
          },
        },
        companyMembership: {
          findFirst: async () => ({ companyId: 'company-1', roles: [{ role: { key: 'OWNER' } }] }),
        },
      },
    } as any;

    await new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance).execute('  Napa@Room45.co ', 'watchdogbms11');
    assert.deepEqual(capturedWhere.OR, [
      { username: 'Napa@Room45.co' },
      { email: 'napa@room45.co' },
    ]);
  });

  it('redirects system admin credentials to partner management', async () => {
    const issueToken = { execute: async () => ({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }) } as any;
    const prisma = {
      client: {
        user: {
          findFirst: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            credential: {
              status: 'ACTIVE',
              passwordHash: hashPassword('watchdogbms11'),
              mustChangePassword: false,
              expiresAt: null,
            },
          }),
        },
        companyMembership: {
          findFirst: async () => ({ companyId: 'seed-watchdog-system-company', roles: [{ role: { key: 'SYSTEM_ADMIN' } }] }),
        },
      },
    } as any;

    const result = await new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance).execute('thawatchai.watchdog', 'watchdogbms11');

    assert.equal(result.companyId, null);
    assert.equal(result.redirectPath, '/system/platform-access');
  });

  it('only considers active memberships whose company is active', async () => {
    const issueToken = { execute: async () => ({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }) } as any;
    let membershipWhere: any = null;
    const prisma = {
      client: {
        user: {
          findFirst: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            credential: {
              status: 'ACTIVE',
              passwordHash: hashPassword('watchdogbms11'),
              mustChangePassword: false,
              expiresAt: null,
            },
          }),
        },
        companyMembership: {
          findFirst: async (args: any) => {
            membershipWhere = args.where;
            return { companyId: 'company-1', roles: [{ role: { key: 'OWNER' } }] };
          },
        },
      },
    } as any;

    await new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance).execute('owner', 'watchdogbms11');

    assert.equal(membershipWhere.status, 'ACTIVE');
    assert.deepEqual(membershipWhere.company, { status: 'ACTIVE' });
  });

  it('rejects valid credentials with company_access_unavailable and issues no token when no active-company membership exists', async () => {
    let issueTokenCalls = 0;
    const issueToken = { execute: async () => { issueTokenCalls += 1; return {}; } } as any;
    const prisma = {
      client: {
        user: {
          findFirst: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            credential: {
              status: 'ACTIVE',
              passwordHash: hashPassword('watchdogbms11'),
              mustChangePassword: false,
              expiresAt: null,
            },
          }),
        },
        // Every membership the user has sits in a suspended/disabled company.
        companyMembership: { findFirst: async () => null },
      },
    } as any;

    await assert.rejects(
      () => new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance).execute('owner', 'watchdogbms11'),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        assert.equal((err.getResponse() as any).code, 'company_access_unavailable');
        return true;
      },
    );
    assert.equal(issueTokenCalls, 0, 'no token may be issued when company access is unavailable');
  });

  it('rejects expired temporary password', async () => {
    const prisma = {
      client: {
        user: {
          findFirst: async () => ({
            id: 'user-1',
            status: 'ACTIVE',
            credential: {
              status: 'TEMPORARY',
              passwordHash: hashPassword('watchdogbms11'),
              mustChangePassword: true,
              expiresAt: new Date(Date.now() - 1),
            },
          }),
        },
      },
    } as any;
    const issueToken = { execute: async () => ({}) } as any;

    await assert.rejects(
      () => new PasswordLoginUseCase(prisma, issueToken, pendingLegalAcceptance).execute('owner', 'watchdogbms11'),
      (err: unknown) => { assert.ok(err instanceof ForbiddenException); return true; },
    );
  });
});

describe('ChangePasswordUseCase', () => {
  it('replaces the hash and clears temporary-password constraints', async () => {
    let updateArgs: any;
    let revokeArgs: any;
    const oldHash = hashPassword('watchdogbms11');
    const prisma = {
      client: {
        userCredential: {
          findUnique: async () => ({ status: 'TEMPORARY', passwordHash: oldHash, expiresAt: null }),
        },
        $transaction: async (fn: any) => fn({
          $executeRaw: async () => 1, $queryRaw: async () => [],
          user: { update: async () => ({}) },
          emailVerificationToken: { updateMany: async () => ({ count: 0 }) },
          userCredential: { findUnique: async () => ({ status: 'TEMPORARY', passwordHash: oldHash, expiresAt: null }), update: async (args: unknown) => { updateArgs = args; return {}; } },
          authSession: { updateMany: async (args: unknown) => { revokeArgs = args; return { count: 2 }; } },
        }),
      },
    } as any;

    await new ChangePasswordUseCase(prisma).execute('user-1', 'watchdogbms11', 'new-watchdog-password', 'session-current');

    assert.equal(updateArgs.where.userId, 'user-1');
    assert.equal(verifyPassword('new-watchdog-password', updateArgs.data.passwordHash), true);
    assert.equal(updateArgs.data.mustChangePassword, false);
    assert.equal(updateArgs.data.expiresAt, null);
    assert.deepEqual(revokeArgs.where, {
      userId: 'user-1',
      status: 'ACTIVE',
      tokenId: { not: 'session-current' },
    });
    assert.equal(revokeArgs.data.status, 'REVOKED');
  });

  // An employee's temporary password is their date of birth as DDMMYYYY — 8 characters, so the
  // minimum-length rule accepted it as the "new" password too. The change then cleared
  // mustChangePassword and the account stayed on the password the employer had issued.
  it('rejects re-submitting the current password as the new one', async () => {
    let updated = false;
    const prisma = {
      client: {
        userCredential: {
          findUnique: async () => ({ status: 'ACTIVE', passwordHash: hashPassword('01011990'), expiresAt: null }),
          update: async () => { updated = true; return {}; },
        },
      },
    } as any;

    await assert.rejects(
      () => new ChangePasswordUseCase(prisma).execute('user-1', '01011990', '01011990', 'session-current'),
      (error: any) => error.getStatus() === 400 && error.getResponse().code === 'password_reuse',
    );
    assert.equal(updated, false);
  });
});

describe('ChangePasswordUseCase reauthentication errors', () => {
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

// L-04: iss/aud are unconditional now, so every fixture token must carry them.
const ISS = 'watchdog-bms';
const AUD = 'watchdog-bms-api';
const VERIFY_CONFIG = { authJwtSecret: 'secret', watchdogJwtIssuer: ISS, watchdogJwtAudience: AUD } as any;

describe('JWT verifiers', () => {
  it('rejects refresh tokens as request authorization tokens', async () => {
    const { JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt');
    const jwt = new JwtService({});
    const token = jwt.sign({ sub: 'user-1', sid: 'session-1', type: 'refresh' }, { secret: 'secret', issuer: ISS, audience: AUD });
    const verifier = new WatchdogJwtVerifierAdapter(jwt, VERIFY_CONFIG);

    await assert.rejects(
      () => verifier.verify(token),
      (err: unknown) => { assert.ok(err instanceof UnauthorizedException); return true; },
    );
  });

  it('verifies access tokens with the same fallback secret used for issuance', async () => {
    const { JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt');
    const jwt = new JwtService({});
    const token = jwt.sign({ sub: 'user-1', sid: 'session-1' }, { secret: 'fallback-secret', issuer: ISS, audience: AUD });
    const verifier = new WatchdogJwtVerifierAdapter(jwt, { ...VERIFY_CONFIG, authJwtSecret: 'fallback-secret' } as any);

    assert.deepEqual(await verifier.verify(token), { subject: 'user-1', tokenId: 'session-1' });
  });

  it('rejects dev refresh tokens as request authorization tokens', async () => {
    const { JwtService } = require('@nestjs/jwt') as typeof import('@nestjs/jwt');
    const jwt = new JwtService({});
    const token = jwt.sign({ sub: 'user-1', sid: 'session-1', type: 'refresh' }, { secret: 'secret', issuer: ISS, audience: AUD });
    const verifier = new DevJwtVerifierAdapter(jwt, {
      devAuthSecret: 'secret', isProduction: false, watchdogJwtIssuer: ISS, watchdogJwtAudience: AUD,
    } as any);

    await assert.rejects(
      () => verifier.verify(token),
      (err: unknown) => { assert.ok(err instanceof UnauthorizedException); return true; },
    );
  });
});

// ---- ExchangeLineTokenUseCase ----

describe('ExchangeLineTokenUseCase', () => {
  const exchangeConfig = { lineMessagingChannelId: 'msg-ch-1', isProduction: false } as any;

  it('returns linked=false when ExternalIdentity not found', async () => {
    const lineVerifier = { verify: async () => ({ subject: 'line-u1' }) } as any;
    const prisma = {
      client: {
        externalIdentity: { findFirst: async () => null },
      },
    } as any;
    const issueToken = { execute: async () => ({ accessToken: 'a', refreshToken: 'r', expiresIn: 900 }) } as any;
    const audited: unknown[] = [];
    const audit = { log: async (entry: unknown) => { audited.push(entry); } } as any;

    const useCase = new ExchangeLineTokenUseCase(lineVerifier, prisma, exchangeConfig, issueToken, audit);
    const result = await useCase.execute('id-token', 'channel-1');

    assert.equal((result as any).linked, false);
    assert.ok((result as any).message);
    const denied = audited.find((entry: any) => entry.action === 'auth.login.denied') as any;
    assert.equal(denied.action, 'auth.login.denied');
    assert.equal(denied.metadataJson.reason, 'unlinked_line_identity');
  });

  it('returns tokens when identity is found and user is active', async () => {
    const lineVerifier = { verify: async () => ({ subject: 'line-u2' }) } as any;
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ status: 'ACTIVE', user: { id: 'u-2', status: 'ACTIVE' } }),
        },
      },
    } as any;
    const issueToken = { execute: async () => ({ accessToken: 'tok', refreshToken: 'ref', expiresIn: 900 }) } as any;

    const useCase = new ExchangeLineTokenUseCase(lineVerifier, prisma, exchangeConfig, issueToken);
    const result = await useCase.execute('id-token', 'channel-1');

    assert.equal((result as any).linked, true);
    assert.equal((result as any).accessToken, 'tok');
  });

  it('throws ForbiddenException when user is suspended', async () => {
    const lineVerifier = { verify: async () => ({ subject: 'line-u3' }) } as any;
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ status: 'ACTIVE', user: { id: 'u-3', status: 'SUSPENDED' } }),
        },
      },
    } as any;
    const issueToken = { execute: async () => ({}) } as any;

    const useCase = new ExchangeLineTokenUseCase(lineVerifier, prisma, exchangeConfig, issueToken);
    await assert.rejects(
      () => useCase.execute('id-token', 'channel-1'),
      (err: unknown) => { assert.ok(err instanceof ForbiddenException); return true; },
    );
  });

  it('resolves via canonical channel first and falls back channel-agnostically for legacy rows', async () => {
    const lineVerifier = { verify: async () => ({ subject: 'line-u4' }) } as any;
    const calls: any[] = [];
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async (args: any) => {
            calls.push(args.where);
            return args.where.providerChannelId ? null : { id: 'ei-legacy', user: { id: 'u-4', status: 'ACTIVE' } };
          },
        },
      },
    } as any;
    const issueToken = { execute: async () => ({ accessToken: 'tok', refreshToken: 'ref', expiresIn: 900 }) } as any;

    const useCase = new ExchangeLineTokenUseCase(lineVerifier, prisma, exchangeConfig, issueToken);
    const result = await useCase.execute('id-token', 'channel-1');

    assert.equal((result as any).linked, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].providerChannelId, 'msg-ch-1');
    assert.equal(calls[1].providerChannelId, undefined);
  });

  for (const status of ['ACTIVE', 'UNLINKED', 'DISABLED']) {
    it(`keeps the canonical ${status} binding authoritative over an active legacy alias`, async () => {
      const identities = [
        { id: 'canonical', provider: 'LINE', providerUserId: 'same-line-user', providerChannelId: 'msg-ch-1', status, user: { id: 'current-user', status: 'ACTIVE' } },
        { id: 'legacy', provider: 'LINE', providerUserId: 'same-line-user', providerChannelId: 'old-login-channel', status: 'ACTIVE', user: { id: 'previous-user', status: 'ACTIVE' } },
      ];
      const queries: unknown[] = [], issued: string[] = [];
      const prisma = { client: { externalIdentity: { findFirst: async ({ where }: any) => {
        queries.push(where);
        return identities.find(row => Object.entries(where).every(([key, value]) => (row as any)[key] === value)) ?? null;
      } } } } as any;
      const verifier = { verify: async () => ({ subject: 'same-line-user' }) } as any;
      const issueToken = { execute: async (userId: string) => { issued.push(userId); return { accessToken: 'synthetic', refreshToken: 'synthetic', expiresIn: 900 }; } } as any;
      const result = await new ExchangeLineTokenUseCase(verifier, prisma, exchangeConfig, issueToken).execute('synthetic-id-token', 'channel-1');
      assert.equal(result.linked, status === 'ACTIVE');
      assert.deepEqual(issued, status === 'ACTIVE' ? ['current-user'] : []);
      assert.equal(queries.length, 1, 'canonical unlink/disable must not consult the legacy identity');
    });
  }

  it('fails closed in production when the canonical channel is not configured', async () => {
    const lineVerifier = { verify: async () => ({ subject: 'line-u5' }) } as any;
    const prisma = { client: { externalIdentity: { findFirst: async () => ({ user: { id: 'u-5', status: 'ACTIVE' } }) } } } as any;
    const issueToken = { execute: async () => ({}) } as any;
    const prodConfig = { lineMessagingChannelId: undefined, isProduction: true } as any;

    const useCase = new ExchangeLineTokenUseCase(lineVerifier, prisma, prodConfig, issueToken);
    await assert.rejects(
      () => useCase.execute('id-token', 'channel-1'),
      (err: unknown) => { assert.ok(err instanceof ServiceUnavailableException); return true; },
    );
  });
});

// ---- LogoutUseCase ----

describe('LogoutUseCase', () => {
  it('marks session as revoked', async () => {
    const updated: unknown[] = [];
    const prisma = {
      client: {
        authSession: {
          updateMany: async (args: unknown) => { updated.push(args); return { count: 1 }; },
        },
      },
    } as any;

    const useCase = new LogoutUseCase(prisma);
    await useCase.execute('token-id-123');

    assert.equal(updated.length, 1);
    const call = updated[0] as any;
    assert.equal(call.where.tokenId, 'token-id-123');
    assert.equal(call.data.status, 'REVOKED');
    assert.ok(call.data.revokedAt instanceof Date);
  });

  // L-10: the audit used to be skipped entirely when the actor could not be resolved —
  // exactly the logout worth keeping.
  it('audits a logout whose actor cannot be resolved, marking the actor explicitly', async () => {
    const prisma = { client: { authSession: { updateMany: async () => ({ count: 1 }) } } } as any;
    const audited: any[] = [];
    const audit = { log: async (entry: unknown) => { audited.push(entry); } } as any;

    await new LogoutUseCase(prisma, audit).execute('token-id-123');

    assert.equal(audited.length, 1);
    assert.equal(audited[0].action, 'auth.session.logout');
    assert.equal(audited[0].actorUserId, undefined);
    assert.equal(audited[0].metadataJson.actor, 'unresolved');
    assert.equal(audited[0].riskLevel, 'MEDIUM');
  });

  it('records the resolved actor without the unresolved marker', async () => {
    const prisma = { client: { authSession: { updateMany: async () => ({ count: 1 }) } } } as any;
    const audited: any[] = [];
    const audit = { log: async (entry: unknown) => { audited.push(entry); } } as any;

    await new LogoutUseCase(prisma, audit).execute('token-id-123', 'user-1', 'req-1');

    assert.equal(audited[0].actorUserId, 'user-1');
    assert.equal(audited[0].metadataJson, undefined);
  });
});

describe('RevokeOtherSessionsUseCase', () => {
  it('revokes active sessions for the user except the current token', async () => {
    const updated: unknown[] = [];
    const audited: unknown[] = [];
    const prisma = {
      client: {
        authSession: {
          updateMany: async (args: unknown) => {
            updated.push(args);
            return { count: 2 };
          },
        },
      },
    } as any;
    const audit = { log: async (entry: unknown) => { audited.push(entry); } } as any;

    const result = await new RevokeOtherSessionsUseCase(prisma, audit).execute({
      userId: 'user-1',
      currentTokenId: 'current-token',
      requestId: 'req-1',
    });

    assert.equal(result.revokedCount, 2);
    assert.equal(updated.length, 1);
    const call = updated[0] as any;
    assert.equal(call.where.userId, 'user-1');
    assert.equal(call.where.status, 'ACTIVE');
    assert.equal(call.where.tokenId.not, 'current-token');
    assert.equal(call.data.status, 'REVOKED');
    assert.ok(call.data.revokedAt instanceof Date);
    assert.equal((audited[0] as any).action, 'auth.session.revoke_others');
    assert.equal((audited[0] as any).metadataJson.revokedCount, 2);
  });

  it('returns zero when there are no other active sessions', async () => {
    const prisma = {
      client: {
        authSession: {
          updateMany: async () => ({ count: 0 }),
        },
      },
    } as any;

    const result = await new RevokeOtherSessionsUseCase(prisma).execute({
      userId: 'user-1',
      currentTokenId: 'current-token',
    });

    assert.equal(result.revokedCount, 0);
  });
});

function platformConfig(targetEnvironment: 'local' | 'uat' | 'production', servingMode?: 'live' | 'maintenance_only') {
  return { deploymentIdentity: { targetEnvironment, buildReleaseId: 'build-1' }, productionServingMode: servingMode } as any;
}

function platformService(options: {
  target?: 'local' | 'uat' | 'production';
  mode?: 'live' | 'maintenance_only';
  row?: any;
  readError?: boolean;
} = {}) {
  const writes: any[] = [];
  const audits: any[] = [];
  const row = options.row ?? null;
  const tx = {
    platformAccessControl: {
      upsert: async (args: any) => {
        writes.push(args);
        return args.create;
      },
    },
  };
  const prisma = {
    client: {
      platformAccessControl: {
        findUnique: async () => {
          if (options.readError) throw new Error('table unavailable');
          return row;
        },
      },
      $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
    },
  } as any;
  const audit = { log: async (entry: any, client: any) => audits.push({ entry, client }) } as any;
  return {
    instance: new PlatformAccessService(
      prisma,
      platformConfig(options.target ?? 'production', options.mode),
      audit,
    ),
    writes,
    audits,
    tx,
  };
}

describe('PlatformAccessService', () => {
  it('forces production maintenance closed even when the stored request says OPEN', async () => {
    const { instance } = platformService({
      mode: 'maintenance_only',
      row: {
        state: 'OPEN',
        updatedAt: new Date('2026-08-10T12:00:00.000Z'),
        updatedBySystemAdminUserId: 'admin-1',
        reason: 'requested',
      },
    });
    const status = await instance.getStatus();
    assert.equal(status.requestedState, 'OPEN');
    assert.equal(status.effectiveState, 'CLOSED');
    assert.equal(status.canOpen, false);
  });

  it('defaults production closed and non-production open when no row exists', async () => {
    assert.equal((await platformService({ mode: 'live' }).instance.getStatus()).effectiveState, 'CLOSED');
    assert.equal((await platformService({ target: 'uat' }).instance.getStatus()).effectiveState, 'OPEN');
  });

  it('fails closed and refuses opening when the control table cannot be read', async () => {
    const { instance } = platformService({ mode: 'live', readError: true });
    const status = await instance.getStatus();
    assert.equal(status.effectiveState, 'CLOSED');
    assert.equal(status.canOpen, false);
    await assert.rejects(
      () => instance.setState({ state: 'OPEN', actorUserId: 'admin-1', requestId: 'req-1' }),
      (error: unknown) => error instanceof ConflictException,
    );
  });

  it('writes the switch and CRITICAL audit atomically in a verified live release', async () => {
    const result = platformService({ mode: 'live' });
    await result.instance.setState({ state: 'OPEN', reason: ' pilot ready ', actorUserId: 'admin-1', requestId: 'req-1' });
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].create.state, 'OPEN');
    assert.equal(result.writes[0].create.reason, 'pilot ready');
    assert.equal(result.audits.length, 1);
    assert.equal(result.audits[0].client, result.tx);
    assert.equal(result.audits[0].entry.riskLevel, 'CRITICAL');
    assert.equal(result.audits[0].entry.metadataJson.to, 'OPEN');
  });
});

describe('P11 SES auth mailer provider boundary', () => {
  function config(overrides: Record<string, unknown> = {}) {
    return {
      emailProvider: 'ses', isLocal: false, sesRegion: 'ap-southeast-1',
      sesFromAddress: 'no-reply@example.com', webBaseUrl: 'https://api.example.com', sesWebBaseUrl: 'https://app.example.com',
      ...overrides,
    } as any;
  }

  function sesMailer(options: { failure?: Error } = {}) {
    const commands: any[] = [];
    const client = {
      send: async (command: any) => {
        commands.push(command);
        if (options.failure) throw options.failure;
        return { MessageId: 'ses-message-1' };
      },
    };
    return { mailer: new SesAuthMailerAdapter(config(), client as any), commands };
  }

  it('keeps disabled as a true no-op and makes local console explicit', async () => {
    const disabled = new DisabledAuthMailerAdapter();
    const local = new LocalConsoleAuthMailerAdapter(config({ webBaseUrl: 'http://localhost:3000' }));
    const ses = sesMailer().mailer;
    for (const isLocal of [true, false]) {
      assert.equal(selectAuthMailer(config({ emailProvider: 'disabled', isLocal }), disabled, local, ses), disabled);
    }
    assert.equal(selectAuthMailer(config({ emailProvider: 'local-console', isLocal: true }), disabled, local, ses), local);
    assert.throws(
      () => selectAuthMailer(config({ emailProvider: 'local-console', isLocal: false }), disabled, local, ses),
      /allowed only when APP_ENV=local/,
    );
    assert.equal(selectAuthMailer(config(), disabled, local, ses), ses);

    const logged: unknown[] = [];
    const previous = console.info;
    console.info = (...args: unknown[]) => { logged.push(args); };
    try {
      const input = { toEmail: 'owner@example.com', rawToken: 'secret-token', expiresAt: new Date() };
      await disabled.sendEmailVerification(input);
      await disabled.sendPasswordResetLink(input);
      await disabled.sendAccountClaim({ ...input, companyName: 'Acme' });
    } finally {
      console.info = previous;
    }
    assert.equal(logged.length, 0, 'disabled must never log a raw auth link in local mode');
  });

  it('fails SES selection at boot when required delivery config is missing', () => {
    const disabled = new DisabledAuthMailerAdapter();
    const local = new LocalConsoleAuthMailerAdapter(config({ webBaseUrl: 'http://localhost:3000' }));
    const ses = sesMailer().mailer;
    for (const key of ['sesRegion', 'sesFromAddress', 'sesWebBaseUrl']) {
      for (const missing of [undefined, '']) {
        assert.throws(
          () => selectAuthMailer(config({ [key]: missing }), disabled, local, ses),
          /requires SES_REGION, SES_FROM_ADDRESS, and WEB_BASE_URL/,
        );
      }
    }
  });
  it('selects Postmark explicitly and refuses incomplete or validation-only production credentials', () => {
    const disabled = new DisabledAuthMailerAdapter();
    const local = new LocalConsoleAuthMailerAdapter(config());
    const ses = sesMailer().mailer;
    const postmark = { provider: 'postmark' } as any;
    const settings = config({ emailProvider: 'postmark', postmarkServerToken: 'synthetic-server-token', postmarkServerId: 42,
      postmarkMessageStream: 'outbound', postmarkFromAddress: 'system@example.test',
      postmarkWebhookUsername: 'callback', postmarkWebhookPassword: 'synthetic-webhook-secret-12345' });
    assert.equal(selectAuthMailer(settings, disabled, local, ses, postmark), postmark);
    for (const key of ['postmarkServerToken', 'postmarkServerId', 'postmarkMessageStream', 'postmarkFromAddress',
      'sesWebBaseUrl', 'postmarkWebhookUsername', 'postmarkWebhookPassword']) {
      assert.throws(() => selectAuthMailer({ ...settings, [key]: undefined }, disabled, local, ses, postmark), /Postmark requires/);
    }
    assert.throws(() => selectAuthMailer({ ...settings, sesWebBaseUrl: 'http://app.example.test' }, disabled, local, ses, postmark), /HTTPS/);
    assert.throws(() => selectAuthMailer({ ...settings, postmarkServerToken: 'POSTMARK_API_TEST' }, disabled, local, ses, postmark), /Postmark requires/);
    assert.equal(selectAuthMailer({ ...settings, isLocal: true, postmarkServerToken: 'POSTMARK_API_TEST' }, disabled, local, ses, postmark), postmark);
    assert.throws(() => selectAuthMailer(settings, disabled, local, ses), /Postmark requires/);
    assert.throws(() => selectAuthMailer({ ...settings, emailProvider: 'typo' }, disabled, local, ses, postmark), /Unsupported email provider/);
  });

  it('never uses the public API origin as the SES frontend base', async () => {
    const disabled = new DisabledAuthMailerAdapter();
    for (const WEB_BASE_URL of [undefined, '', 'https://frontend.example.com']) {
      // Exercise the real getters without changing process.env or booting external services.
      const actual = Object.assign(Object.create(AppConfigService.prototype), { config: {
        APP_ENV: 'local', EMAIL_PROVIDER: 'ses', SES_REGION: 'ap-southeast-1',
        SES_FROM_ADDRESS: 'no-reply@example.com', PUBLIC_BASE_URL: 'https://api.example.com', WEB_BASE_URL,
      } }) as AppConfigService;
      assert.equal(actual.webBaseUrl, WEB_BASE_URL ?? 'https://api.example.com', 'general fallback stays unchanged');
      assert.equal(actual.sesWebBaseUrl, WEB_BASE_URL);
      const commands: any[] = [];
      const ses = new SesAuthMailerAdapter(actual, { send: async (command: any) => { commands.push(command); return {}; } } as any);
      const local = new LocalConsoleAuthMailerAdapter(actual);
      const send = () => ses.sendEmailVerification({ toEmail: 'owner@example.com', rawToken: 'token', expiresAt: new Date() });
      if (!WEB_BASE_URL) {
        assert.throws(() => selectAuthMailer(actual, disabled, local, ses), /requires SES_REGION, SES_FROM_ADDRESS, and WEB_BASE_URL/);
        await assert.rejects(send, /WEB_BASE_URL is required/);
        assert.equal(commands.length, 0);
      } else {
        assert.equal(selectAuthMailer(actual, disabled, local, ses), ses);
        await send();
        assert.match(commands[0].input.Message.Body.Text.Data, /https:\/\/frontend\.example\.com\/verify-email#token=token/);
        assert.doesNotMatch(JSON.stringify(commands), /https:\/\/api\.example\.com/);
      }
    }
  });

  it('builds UTF-8 SES messages for verification, reset, and account claim without unsafe HTML', async () => {
    const { mailer, commands } = sesMailer();
    const expiresAt = new Date('2026-08-27T08:30:00.000Z');
    await mailer.sendEmailVerification({ toEmail: 'owner@example.com', rawToken: 'verify+/=', expiresAt });
    await mailer.sendPasswordResetLink({ toEmail: 'owner@example.com', rawToken: 'reset+/=', expiresAt });
    await mailer.sendAccountClaim({
      toEmail: 'owner@example.com', rawToken: 'claim+/=', expiresAt,
      companyName: 'บริษัท <script>alert(1)</script> จำกัด',
      signupRequestId: 'signup-1',
    });

    assert.equal(commands.length, 3);
    const inputs = commands.map((command) => command.input);
    assert.ok(inputs.every((input) => input.Source === 'no-reply@example.com'));
    assert.ok(inputs.every((input) => input.Message.Body.Text.Data.includes('https://app.example.com/')));
    assert.doesNotMatch(JSON.stringify(inputs), /https:\/\/api\.example\.com/);
    for (const input of inputs) {
      assert.deepEqual(input.Destination, { ToAddresses: ['owner@example.com'] });
      assert.equal(input.Message.Subject.Charset, 'UTF-8');
      assert.equal(input.Message.Body.Text.Charset, 'UTF-8');
      assert.equal(input.Message.Body.Html.Charset, 'UTF-8');
    }
    assert.deepEqual(inputs.map((input) => input.Tags[0].Value), ['email_verification', 'password_reset', 'account_claim']);
    assert.match(inputs[0].Message.Body.Text.Data, /verify-email#token=verify%2B%2F%3D/);
    assert.match(inputs[1].Message.Body.Text.Data, /reset-password#token=reset%2B%2F%3D/);
    assert.doesNotMatch(inputs[2].Message.Body.Text.Data, /claim-account\?token=/);
    // R12: the request id rides beside the token so a spent or expired link still knows which
    // status page to offer. It is not a secret — the status endpoint answers a coarse state only.
    assert.match(inputs[2].Message.Body.Text.Data, /claim-account\?r=signup-1#token=claim%2B%2F%3D/);
    assert.match(inputs[2].Message.Body.Text.Data, /ไม่ใช่รหัสผ่านของ LINE/);
    assert.match(inputs[2].Message.Body.Html.Data, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(inputs[2].Message.Body.Html.Data, /<script>/);
    // Owner order 2026-08-31: no OA add-friend link in the claim letter — the LINE step lives in-app.
    assert.doesNotMatch(inputs[2].Message.Body.Html.Data, /lin\.ee/);
    assert.doesNotMatch(JSON.stringify(inputs[2]), /temporaryPassword|taxId|qrImage|passwordHash/);
  });

  it('propagates SES failures so the caller or outbox can retry', async () => {
    const { mailer } = sesMailer({ failure: new Error('ses unavailable') });
    await assert.rejects(
      () => mailer.sendEmailVerification({
        toEmail: 'owner@example.com', rawToken: 'verify-token', expiresAt: new Date('2026-08-27T08:30:00.000Z'),
      }),
      /ses unavailable/,
    );
  });

  it('rejects non-HTTPS claim and application links before sending', async () => {
    const { mailer, commands } = sesMailer();
    const insecure = new SesAuthMailerAdapter(config({ sesWebBaseUrl: 'http://app.example.com' }), { send: async () => ({}) } as any);
    await assert.rejects(
      () => insecure.sendEmailVerification({ toEmail: 'owner@example.com', rawToken: 'token', expiresAt: new Date() }),
      /WEB_BASE_URL must use HTTPS/,
    );
    assert.equal(commands.length, 0);
  });
});
