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
  workerToken?: string;
  path?: string;
}) {
  const request = {
    path: opts.path,
    headers: {
      ...(opts.authHeader ? { authorization: opts.authHeader } : {}),
      ...(opts.xRequestId ? { 'x-request-id': opts.xRequestId } : {}),
      ...(opts.xCompanyId ? { 'x-company-id': opts.xCompanyId } : {}),
      ...(opts.workerToken ? { 'x-worker-token': opts.workerToken } : {}),
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
// P29: `planTerm: null` — no CompanyPlanTerm row — is the default here on purpose. It is how
// every company that predates P29 reads, and every pre-existing test below therefore proves the
// term check leaves them alone.
function prismaFor(sessionUserId: string, credential: unknown = null, planTerm: { termEndsAt: Date } | null = null) {
  return {
    client: {
      authSession: {
        findUnique: async () => ({ userId: sessionUserId, status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) }),
      },
      userCredential: { findUnique: async () => credential },
      companyPlanTerm: { findUnique: async () => planTerm },
    },
  } as any;
}
const noopPrisma = prismaFor('test-sub');
const cookiePrisma = prismaFor('cookie-sub');
const mustChangePrisma = prismaFor('test-sub', { mustChangePassword: true });
const acceptedLegal = { isRequired: async () => false } as any;

describe('AuthGuard', () => {
  it('leaves public internal machine routes to their controller credential checks while customer access is closed', async () => {
    const closed = { getStatus: async () => ({ effectiveState: 'CLOSED' }) } as any;
    const guard = new AuthGuard(makeReflector(true), failVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal, closed);
    assert.equal(await guard.canActivate(makeContext({
      path: '/v1/internal/workflow/outbox/drain',
      workerToken: 'worker-token-value-1234567890',
    })), true);
    assert.equal(await guard.canActivate(makeContext({ path: '/v1/internal/ai/tools/invoke' })), true);
    await assert.rejects(
      () => guard.canActivate(makeContext({ path: '/v1/internalized/workflow', workerToken: 'worker-token-value-1234567890' })),
      (error: any) => error.getResponse().code === 'platform_access_closed',
    );
  });

  it('keeps login/status public but blocks other public routes while customer access is closed', async () => {
    const closed = { getStatus: async () => ({ effectiveState: 'CLOSED' }) } as any;
    for (const path of [
      '/v1/auth/password/login',
      '/v1/auth/platform-access',
      '/v1/auth/line/login/callback',
      '/v1/auth/line/qr/create',
      '/v1/auth/line/qr/redeem',
    ]) {
      const guard = new AuthGuard(makeReflector(true), failVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal, closed);
      assert.equal(await guard.canActivate(makeContext({ path })), true);
    }
    const guard = new AuthGuard(makeReflector(true), failVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal, closed);
    await assert.rejects(
      () => guard.canActivate(makeContext({ path: '/v1/line/webhook' })),
      (error: any) => error.getResponse().code === 'platform_access_closed',
    );
  });

  it('allows only SYSTEM_ADMIN protected sessions while customer access is closed', async () => {
    const closed = { getStatus: async () => ({ effectiveState: 'CLOSED' }) } as any;
    const ordinaryGuard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal, closed);
    await assert.rejects(
      () => ordinaryGuard.canActivate(makeContext({ authHeader: 'Bearer token', path: '/v1/companies/c1/dashboard' })),
      (error: any) => error.getResponse().code === 'platform_access_closed',
    );

    const adminResolve = {
      execute: async () => ({
        requestId: 'req-1', authSubject: 'test-sub', userId: 'admin-1', companyId: 'system-company',
        membershipId: 'membership-1', roles: ['SYSTEM_ADMIN'], permissions: ['system.launch_gate.manage'],
        scopes: {},
      }),
    } as any;
    const adminGuard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, adminResolve, localConfig, noopPrisma, acceptedLegal, closed);
    assert.equal(await adminGuard.canActivate(makeContext({ authHeader: 'Bearer token', path: '/v1/system/platform-access' })), true);
  });

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

  it('rejects conflicting header and route companies before resolving request context', async () => {
    const resolve = { execute: mock.fn(async () => ({})) } as any;
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolve, localConfig, noopPrisma, acceptedLegal);

    await assert.rejects(
      () => guard.canActivate(makeContext({
        authHeader: 'Bearer valid.token',
        xCompanyId: 'co-header',
        routeCompanyId: 'co-route',
      })),
      (error: unknown) => error instanceof ForbiddenException,
    );
    assert.equal(resolve.execute.mock.callCount(), 0);
  });

  it('names the requested company only on a scoped auth/me access denial', async () => {
    const resolve = { execute: async () => { throw new ForbiddenException('No active company membership.'); } } as any;
    const prisma = {
      client: {
        ...noopPrisma.client,
        company: { findUnique: async () => ({ name: 'ป๋อจ้าน Company' }) },
      },
    } as any;
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolve, localConfig, prisma, acceptedLegal);

    await assert.rejects(
      () => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', xCompanyId: 'co-target', path: '/v1/auth/me' })),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.deepEqual(error.getResponse(), {
          code: 'company_access_unavailable',
          message: 'No access to the requested company.',
          companyName: 'ป๋อจ้าน Company',
        });
        return true;
      },
    );
  });

  it('authenticates before reporting a conflicting company selector', async () => {
    const guard = new AuthGuard(makeReflector(false), failVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal);

    await assert.rejects(
      () => guard.canActivate(makeContext({ xCompanyId: 'co-header', routeCompanyId: 'co-route' })),
      (error: unknown) => error instanceof UnauthorizedException,
    );
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

  // ---- P29 on-access term expiry ----

  it('blocks business routes of an expired company with company_term_expired', async () => {
    const expiredPrisma = prismaFor('test-sub', null, { termEndsAt: new Date(Date.now() - 1000) });
    const guard = new AuthGuard(
      makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve,
      localConfig, expiredPrisma, acceptedLegal,
    );
    await assert.rejects(
      () => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', path: '/v1/companies/c1/expenses' })),
      (error: unknown) => {
        assert.ok(error instanceof ForbiddenException);
        assert.equal((error.getResponse() as any).code, 'company_term_expired');
        return true;
      },
    );
  });

  it('blocks on the exact hour: one millisecond before termEndsAt still passes', async () => {
    const notYet = prismaFor('test-sub', null, { termEndsAt: new Date(Date.now() + 1000) });
    const guard = new AuthGuard(
      makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve,
      localConfig, notYet, acceptedLegal,
    );
    assert.equal(await guard.canActivate(makeContext({
      authHeader: 'Bearer valid.token', path: '/v1/companies/c1/expenses',
    })), true);
  });

  it('keeps login, me, the company switcher, logout and the notice endpoint working when expired', async () => {
    const expiredPrisma = prismaFor('test-sub', null, { termEndsAt: new Date(Date.now() - 1000) });
    for (const path of [
      '/v1/auth/me',
      '/v1/auth/me/companies',
      '/v1/auth/logout',
      '/v1/auth/password/change',
      '/v1/plan-term/notice',
    ]) {
      const guard = new AuthGuard(
        makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve,
        localConfig, expiredPrisma, acceptedLegal,
      );
      assert.equal(await guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', path })), true, path);
    }
  });

  it('a company with NO term row is untouched by the expiry check', async () => {
    // noopPrisma returns planTerm=null, i.e. every customer that predates P29.
    const guard = new AuthGuard(
      makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve,
      localConfig, noopPrisma, acceptedLegal,
    );
    assert.equal(await guard.canActivate(makeContext({
      authHeader: 'Bearer valid.token', path: '/v1/companies/c1/expenses',
    })), true);
  });

  it('SYSTEM_ADMIN is never locked out by a term expiry — the console that fixes it must stay reachable', async () => {
    const expiredPrisma = prismaFor('test-sub', null, { termEndsAt: new Date(Date.now() - 1000) });
    const adminResolve = {
      execute: async () => ({
        requestId: 'req-1', authSubject: 'test-sub', userId: 'admin-1', companyId: 'system-company',
        membershipId: 'membership-1', roles: ['SYSTEM_ADMIN'], permissions: [], scopes: {},
      }),
    } as any;
    const guard = new AuthGuard(
      makeReflector(false), noopVerifier as any, failVerifier as any, adminResolve,
      localConfig, expiredPrisma, acceptedLegal,
    );
    assert.equal(await guard.canActivate(makeContext({
      authHeader: 'Bearer valid.token', path: '/v1/system/partners/co-1/plan-term',
    })), true);
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

  it('lets a pending-acceptance user approve a desktop QR login (UAT 2026-09-01)', async () => {
    // Approving the QR is a login handshake: the redeemed desktop session walks into this same
    // legal gate itself, so exempting the approve bypasses nothing. Before this, a freshly-claimed
    // account (binding acceptance deliberately happens in-app, after login) got 403 here and the
    // phone page read it as "QR หมดอายุ".
    const pendingLegal = { isRequired: async () => true } as any;
    const guard = new AuthGuard(
      makeReflector(false), noopVerifier as any, failVerifier as any, noopResolve,
      localConfig, noopPrisma, pendingLegal,
    );
    assert.equal(await guard.canActivate(makeContext({
      authHeader: 'Bearer valid.token',
      path: '/v1/auth/line/qr/approve',
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
