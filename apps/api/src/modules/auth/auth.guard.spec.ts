import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './presentation/auth.guard';
import { DenyByDefaultGuard } from '../../common/security/deny-by-default.guard';
import { IS_PUBLIC_ROUTE_KEY } from '../../common/security/public.decorator';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from '../../common/security/permissions.decorator';

// Minimal mock factory for ExecutionContext
function makeContext(opts: {
  isPublic?: boolean;
  authHeader?: string;
  cookieToken?: string;
  cookieTokenChunks?: string[];
  xRequestId?: string;
  xCompanyId?: string;
  routeCompanyId?: string;
  path?: string;
}) {
  const request = {
    path: opts.path,
    headers: {
      ...(opts.authHeader ? { authorization: opts.authHeader } : {}),
      ...(opts.xRequestId ? { 'x-request-id': opts.xRequestId } : {}),
      ...(opts.xCompanyId ? { 'x-company-id': opts.xCompanyId } : {}),
    },
    params: {
      ...(opts.routeCompanyId ? { companyId: opts.routeCompanyId } : {}),
    },
    cookies: {
      ...(opts.cookieToken ? { watchdog_token: opts.cookieToken } : {}),
      ...Object.fromEntries((opts.cookieTokenChunks ?? []).map((chunk, i) => [`watchdog_token.${i}`, chunk])),
    },
    context: undefined as unknown,
  };

  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as any;
}

function makeReflector(isPublic: boolean) {
  return {
    getAllAndOverride: () => (isPublic ? true : undefined),
  } as any;
}

const noopVerifier = { verify: async () => ({ subject: 'test-sub', tokenId: 'session-1' }) };
const failVerifier = { verify: async () => { throw new Error('fail'); } };
const localConfig = { isProduction: false } as any;
const prodConfig = { isProduction: true } as any;
const noopResolve = {
  execute: async (subject: string, requestId: string) => ({
    requestId,
    authSubject: subject,
    userId: 'u1',
    companyId: 'c1',
    membershipId: 'm1',
    roles: [],
    permissions: [],
    scopes: {},
  }),
} as any;
// L-05: every authenticated token now carries a sid, so the guard always resolves a session.
// ponytail: null credential keeps the mustChangePassword block inactive unless a test asks for it.
function prismaFor(sessionUserId: string, credential: unknown = null) {
  return {
    client: {
      authSession: {
        findUnique: async () => ({ userId: sessionUserId, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }),
      },
      userCredential: { findUnique: async () => credential },
    },
  } as any;
}
const noopPrisma = prismaFor('test-sub');
const cookiePrisma = prismaFor('cookie-sub');
const mustChangePrisma = prismaFor('test-sub', { mustChangePassword: true });
const acceptedLegal = { isRequired: async () => false } as any;

describe('AuthGuard', () => {
  it('returns true for @Public() routes', async () => {
    const guard = new AuthGuard(makeReflector(true), failVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal);
    const result = await guard.canActivate(makeContext({ isPublic: true }));
    assert.equal(result, true);
  });

  it('throws UnauthorizedException when Authorization header is missing', async () => {
    const guard = new AuthGuard(makeReflector(false), failVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal);
    await assert.rejects(
      () => guard.canActivate(makeContext({})),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedException);
        return true;
      },
    );
  });

  it('throws UnauthorizedException when both verifiers fail', async () => {
    const guard = new AuthGuard(makeReflector(false), failVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal);
    await assert.rejects(
      () => guard.canActivate(makeContext({ authHeader: 'Bearer bad.token.here' })),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedException);
        return true;
      },
    );
  });

  it('dev auth is not tried when APP_ENV is not local', async () => {
    // watchdog verifier fails, dev verifier would succeed but should NOT be called in production
    let devCalled = false;
    const devVerifier = {
      verify: async () => {
        devCalled = true;
        return { subject: 'dev-sub' };
      },
    } as any;
    const guard = new AuthGuard(makeReflector(false), failVerifier as any, devVerifier, noopResolve, prodConfig, noopPrisma, acceptedLegal);
    await assert.rejects(
      () => guard.canActivate(makeContext({ authHeader: 'Bearer some.token' })),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedException);
        assert.equal(devCalled, false, 'dev verifier must not be called outside local');
        return true;
      },
    );
  });

  it('attaches context when watchdog verifier succeeds', async () => {
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal);
    const ctx = makeContext({ authHeader: 'Bearer valid.token' });
    const result = await guard.canActivate(ctx);
    assert.equal(result, true);
    const req = ctx.switchToHttp().getRequest();
    assert.ok(req.context, 'request.context should be set');
    assert.equal(req.context.authSubject, 'test-sub');
  });

  it('accepts the watchdog_token cookie when no Authorization header is present', async () => {
    let verifiedWith: string | undefined;
    const verifier = {
      verify: async (raw: string) => {
        verifiedWith = raw;
        return { subject: 'cookie-sub', tokenId: 'session-1' };
      },
    } as any;
    const guard = new AuthGuard(makeReflector(false), verifier, failVerifier as any, noopResolve, localConfig, cookiePrisma, acceptedLegal);
    const ctx = makeContext({ cookieToken: 'cookie.jwt.value' });
    const result = await guard.canActivate(ctx);
    assert.equal(result, true);
    assert.equal(verifiedWith, 'cookie.jwt.value');
    assert.equal((ctx.switchToHttp().getRequest() as any).context.authSubject, 'cookie-sub');
  });

  it('re-joins a chunked watchdog_token.0..N cookie (large tokens exceed the 4KB cookie limit)', async () => {
    let verifiedWith: string | undefined;
    const verifier = {
      verify: async (raw: string) => {
        verifiedWith = raw;
        return { subject: 'cookie-sub', tokenId: 'session-1' };
      },
    } as any;
    const guard = new AuthGuard(makeReflector(false), verifier, failVerifier as any, noopResolve, localConfig, cookiePrisma, acceptedLegal);
    const result = await guard.canActivate(makeContext({ cookieTokenChunks: ['aaa.', 'bbb.', 'ccc'] }));
    assert.equal(result, true);
    assert.equal(verifiedWith, 'aaa.bbb.ccc');
  });

  it('prefers the Bearer header over the cookie when both are present', async () => {
    let verifiedWith: string | undefined;
    const verifier = {
      verify: async (raw: string) => {
        verifiedWith = raw;
        return { subject: 'test-sub', tokenId: 'session-1' };
      },
    } as any;
    const guard = new AuthGuard(makeReflector(false), verifier, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal);
    await guard.canActivate(makeContext({ authHeader: 'Bearer header.token', cookieToken: 'cookie.token' }));
    assert.equal(verifiedWith, 'header.token');
  });

  it('uses route companyId as membership hint when x-company-id is absent', async () => {
    const resolve = {
      execute: mock.fn(async (subject: string, requestId: string, authProvider: string, companyId?: string) => ({
        requestId,
        authSubject: subject,
        userId: 'u1',
        companyId: companyId ?? 'c1',
        membershipId: 'm1',
        roles: [],
        permissions: [],
        scopes: {},
        authProvider,
      })),
    } as any;
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolve, localConfig, noopPrisma, acceptedLegal);
    await guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', routeCompanyId: 'co-route' }));
    const call = (resolve.execute.mock.calls as any[])[0]?.arguments;
    assert.equal(call[3], 'co-route');
  });

  it('rejects a revoked session token before protected route handling', async () => {
    const verifier = { verify: async () => ({ subject: 'u1', tokenId: 'token-1' }) };
    const prisma = {
      client: {
        authSession: {
          findUnique: async () => ({
            userId: 'u1',
            status: 'REVOKED',
            expiresAt: new Date(Date.now() + 60_000),
          }),
        },
        userCredential: { findUnique: async () => null },
      },
    } as any;
    const guard = new AuthGuard(makeReflector(false), verifier as any, failVerifier as any, noopResolve, localConfig, prisma, acceptedLegal);

    await assert.rejects(
      () => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token' })),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedException);
        return true;
      },
    );
  });

  // L-05: a validly-signed token without `sid` used to skip the session lookup entirely and
  // stay authenticated for its full lifetime — immune to logout, revoke-others and the
  // password-reset sweep. The guard must fail closed on its own, not trust the verifier.
  it('rejects a sid-less token and never resolves a request context', async () => {
    const sidlessVerifier = { verify: async () => ({ subject: 'test-sub' }) } as any;
    let resolveCalls = 0;
    let sessionLookups = 0;
    const resolve = { execute: async () => { resolveCalls += 1; return {}; } } as any;
    const prisma = {
      client: {
        authSession: { findUnique: async () => { sessionLookups += 1; return null; } },
        userCredential: { findUnique: async () => null },
      },
    } as any;
    const guard = new AuthGuard(makeReflector(false), sidlessVerifier, failVerifier as any, resolve, localConfig, prisma, acceptedLegal);

    await assert.rejects(
      () => guard.canActivate(makeContext({ authHeader: 'Bearer sidless.token' })),
      (err: unknown) => { assert.ok(err instanceof UnauthorizedException); return true; },
    );
    assert.equal(resolveCalls, 0, 'context resolution must never run for a sid-less token');
    assert.equal(sessionLookups, 0, 'the guard rejects before it can be tricked into skipping the lookup');
  });

  it('does not fall back to dev auth when watchdog verifier rejects a refresh token in production', async () => {
    const refreshVerifier = { verify: async () => { throw new UnauthorizedException('Refresh token cannot authorize requests.'); } };
    const guard = new AuthGuard(makeReflector(false), refreshVerifier as any, noopVerifier as any, noopResolve, prodConfig, noopPrisma, acceptedLegal);

    await assert.rejects(
      () => guard.canActivate(makeContext({ authHeader: 'Bearer refresh.token' })),
      (err: unknown) => {
        assert.ok(err instanceof UnauthorizedException);
        return true;
      },
    );
  });

  it('does not block a LINE-login session that still has mustChangePassword set', async () => {
    const lineVerifier = { verify: async () => ({ subject: 'test-sub', tokenId: 'session-1', provider: 'line' }) };
    const guard = new AuthGuard(makeReflector(false), lineVerifier as any, failVerifier as any, noopResolve, localConfig, mustChangePrisma, acceptedLegal);
    const result = await guard.canActivate(makeContext({ authHeader: 'Bearer line.token', path: '/v1/crm/customers' }));
    assert.equal(result, true);
  });

  it('blocks password-login and legacy (no provider claim) sessions that must change password', async () => {
    for (const verifier of [{ verify: async () => ({ subject: 'test-sub', tokenId: 'session-1', provider: 'watchdog' }) }, noopVerifier]) {
      const guard = new AuthGuard(makeReflector(false), verifier as any, failVerifier as any, noopResolve, localConfig, mustChangePrisma, acceptedLegal);
      await assert.rejects(
        () => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', path: '/v1/crm/customers' })),
        (err: unknown) => {
          assert.ok(err instanceof ForbiddenException);
          return true;
        },
      );
    }
  });

  it('blocks protected business routes with a stable legal_acceptance_required response', async () => {
    const pendingLegal = { isRequired: async () => true } as any;
    const guard = new AuthGuard(
      makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve,
      localConfig, noopPrisma, pendingLegal,
    );

    await assert.rejects(
      () => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', path: '/v1/expenses' })),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.equal((error.getResponse() as any).code, 'legal_acceptance_required');
        return true;
      },
    );
  });

  it('keeps the legal acceptance status/write path available while acceptance is pending', async () => {
    const pendingLegal = { isRequired: async () => true } as any;
    const guard = new AuthGuard(
      makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve,
      localConfig, noopPrisma, pendingLegal,
    );

    assert.equal(await guard.canActivate(makeContext({
      authHeader: 'Bearer valid.token',
      path: '/v1/auth/legal-acceptance',
    })), true);
  });

  it('does not exempt unrelated authenticated /v1/auth mutations from the legal gate', async () => {
    const pendingLegal = { isRequired: async () => true } as any;
    for (const path of ['/v1/auth/account/ai-assistant', '/v1/auth/line/link']) {
      const guard = new AuthGuard(
        makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve,
        localConfig, noopPrisma, pendingLegal,
      );
      await assert.rejects(
        () => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', path })),
        (error: unknown) => {
          assert.ok(error instanceof ForbiddenException);
          assert.equal((error.getResponse() as any).code, 'legal_acceptance_required');
          return true;
        },
      );
    }
  });
});

function makeDenyContext(requestContext?: { permissions: string[]; entitlementDeniedPermissions?: Record<string, string> }) {
  const request = { context: requestContext };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as any;
}

function makeDenyReflector(requiredPermissions?: string[], requiredAnyPermissions?: string[]) {
  return {
    getAllAndOverride: (key: string) => {
      if (key === IS_PUBLIC_ROUTE_KEY) return undefined;
      if (key === REQUIRED_PERMISSIONS_KEY) return requiredPermissions;
      if (key === REQUIRED_ANY_PERMISSIONS_KEY) return requiredAnyPermissions;
      return undefined;
    },
  } as any;
}

describe('DenyByDefaultGuard', () => {
  it('throws ForbiddenException when protected route has no permission metadata', () => {
    const guard = new DenyByDefaultGuard(makeDenyReflector());
    assert.throws(
      () => guard.canActivate(makeDenyContext({ permissions: ['health.read'] })),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        return true;
      },
    );
  });

  it('throws ForbiddenException when required permission is missing', () => {
    const guard = new DenyByDefaultGuard(makeDenyReflector(['health.read']));
    assert.throws(
      () => guard.canActivate(makeDenyContext({ permissions: [] })),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        return true;
      },
    );
  });

  it('accepts any one explicitly equivalent permission and rejects callers holding neither', () => {
    const guard = new DenyByDefaultGuard(makeDenyReflector(undefined, ['report.export.read_own', 'report.export.manage']));
    assert.equal(guard.canActivate(makeDenyContext({ permissions: ['report.export.manage'] })), true);
    assert.equal(guard.canActivate(makeDenyContext({ permissions: ['report.export.read_own'] })), true);
    assert.throws(() => guard.canActivate(makeDenyContext({ permissions: [] })), ForbiddenException);
  });

  it('returns feature_not_enabled only when every missing permission was granted then entitlement-filtered', () => {
    const guard = new DenyByDefaultGuard(makeDenyReflector(['report.catalog.read', 'report.query.run']));
    assert.throws(
      () => guard.canActivate(makeDenyContext({
        permissions: [],
        entitlementDeniedPermissions: {
          'report.catalog.read': 'reports',
          'report.query.run': 'reports',
        },
      })),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        assert.deepEqual(err.getResponse(), { code: 'feature_not_enabled', featureKey: 'reports' });
        return true;
      },
    );
  });

  it('does not mislabel a partial role grant as feature_not_enabled', () => {
    const guard = new DenyByDefaultGuard(makeDenyReflector(['report.catalog.read', 'report.query.run']));
    assert.throws(
      () => guard.canActivate(makeDenyContext({
        permissions: [],
        entitlementDeniedPermissions: { 'report.query.run': 'reports' },
      })),
      (err: unknown) => {
        assert.ok(err instanceof ForbiddenException);
        assert.equal((err.getResponse() as { message: string }).message, 'Insufficient permissions.');
        return true;
      },
    );
  });

  it('allows protected route when required permission exists', () => {
    const guard = new DenyByDefaultGuard(makeDenyReflector(['health.read']));
    assert.equal(guard.canActivate(makeDenyContext({ permissions: ['health.read'] })), true);
  });
});
