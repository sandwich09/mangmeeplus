import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { IssueTokenUseCase } from './application/use-cases/issue-token.use-case';
import { ExchangeLineTokenUseCase } from './application/use-cases/exchange-line-token.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RevokeOtherSessionsUseCase } from './application/use-cases/revoke-other-sessions.use-case';
import { PasswordLoginUseCase } from './application/use-cases/password-login.use-case';
import { ChangePasswordUseCase } from './application/use-cases/change-password.use-case';
import { hashPassword, verifyPassword } from './domain/logic/password-credential.logic';
import { WatchdogJwtVerifierAdapter } from './infrastructure/watchdog-jwt-verifier.adapter';
import { DevJwtVerifierAdapter } from './infrastructure/dev-jwt-verifier.adapter';

const pendingLegalAcceptance = {
  getStatus: async () => ({ required: true }),
} as any;

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
});

// ---- Password credentials ----

describe('PasswordLoginUseCase', () => {
  it('issues watchdog tokens for an active username/password credential', async () => {
    const issueToken = { execute: async (userId: string, provider: string) => {
      assert.equal(userId, 'user-1');
      assert.equal(provider, 'watchdog');
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
    assert.equal(result.redirectPath, '/system/partners');
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
    const oldHash = hashPassword('watchdogbms11');
    const prisma = {
      client: {
        userCredential: {
          findUnique: async () => ({ status: 'TEMPORARY', passwordHash: oldHash, expiresAt: null }),
          update: async (args: unknown) => { updateArgs = args; return {}; },
        },
      },
    } as any;

    await new ChangePasswordUseCase(prisma).execute('user-1', 'watchdogbms11', 'new-watchdog-password');

    assert.equal(updateArgs.where.userId, 'user-1');
    assert.equal(verifyPassword('new-watchdog-password', updateArgs.data.passwordHash), true);
    assert.equal(updateArgs.data.mustChangePassword, false);
    assert.equal(updateArgs.data.expiresAt, null);
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
      () => new ChangePasswordUseCase(prisma).execute('user-1', '01011990', '01011990'),
      (error: any) => error.getStatus() === 400 && error.getResponse().code === 'password_reuse',
    );
    assert.equal(updated, false);
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

    const useCase = new ExchangeLineTokenUseCase(lineVerifier, prisma, issueToken, audit);
    const result = await useCase.execute('id-token', 'channel-1');

    assert.equal((result as any).linked, false);
    assert.ok((result as any).message);
    assert.equal((audited[0] as any).action, 'auth.login.denied');
    assert.equal((audited[0] as any).metadataJson.reason, 'unlinked_line_identity');
  });

  it('returns tokens when identity is found and user is active', async () => {
    const lineVerifier = { verify: async () => ({ subject: 'line-u2' }) } as any;
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ user: { id: 'u-2', status: 'ACTIVE' } }),
        },
      },
    } as any;
    const issueToken = { execute: async () => ({ accessToken: 'tok', refreshToken: 'ref', expiresIn: 900 }) } as any;

    const useCase = new ExchangeLineTokenUseCase(lineVerifier, prisma, issueToken);
    const result = await useCase.execute('id-token', 'channel-1');

    assert.equal((result as any).linked, true);
    assert.equal((result as any).accessToken, 'tok');
  });

  it('throws ForbiddenException when user is suspended', async () => {
    const lineVerifier = { verify: async () => ({ subject: 'line-u3' }) } as any;
    const prisma = {
      client: {
        externalIdentity: {
          findFirst: async () => ({ user: { id: 'u-3', status: 'SUSPENDED' } }),
        },
      },
    } as any;
    const issueToken = { execute: async () => ({}) } as any;

    const useCase = new ExchangeLineTokenUseCase(lineVerifier, prisma, issueToken);
    await assert.rejects(
      () => useCase.execute('id-token', 'channel-1'),
      (err: unknown) => { assert.ok(err instanceof ForbiddenException); return true; },
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
