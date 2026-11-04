import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard, isBillingRecoveryRoute, isAccountEmailRecoveryRoute, isCompanyProfileRecoveryRoute } from './presentation/auth.guard';
import { ResolveRequestContextUseCase } from './application/use-cases/resolve-request-context.use-case';
import { ROLE_GRANTS } from './permission-registry';
import { DenyByDefaultGuard } from '../../common/security/deny-by-default.guard';
import { IS_PUBLIC_ROUTE_KEY } from '../../common/security/public.decorator';
import { REQUIRED_ANY_PERMISSIONS_KEY, REQUIRED_PERMISSIONS_KEY } from '../../common/security/permissions.decorator';
import { PermissionResolverService } from '../access-control/application/permission-resolver.service';
import { PrismaPermissionResolverRepository } from '../access-control/infrastructure/prisma-permission-resolver.repository';
import { PLATFORM_TENANT_ID, SalesAgentActiveGuard } from '../sales-console/application/sales-context';
import { SalesConsoleModule } from '../sales-console/sales-console.module';
import { SystemSalesAttributionController, SystemSalesReferralController } from '../sales-console/presentation/http/system-sales-agents.controller';
import { SystemIdentityReconciliationController } from '../system-identity-reconciliation/presentation/http/system-identity-reconciliation.controller';
import { ExecutiveReportController } from '../executive-business/presentation/http/executive-report.controller';
import { ExecutiveUsersController } from '../executive-business/presentation/http/executive-users.controller';

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
  method?: string;
}) {
  const request = {
    path: opts.path,
    method: opts.method ?? 'GET',
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

  it('preserves the disabled membership code on the open-session shop gate', async () => {
    const resolve = { execute: async () => { throw new ForbiddenException({ code: 'company_membership_disabled' }); } } as any;
    const prisma = { client: { ...noopPrisma.client, companyMembership: { findUnique: async (query: any) => {
      assert.deepEqual(query, {
        where: { companyId_userId: { companyId: 'co-target', userId: 'test-sub' } },
        select: { company: { select: { name: true } } },
      });
      return { status: 'DISABLED', company: { name: 'ร้านเดิม' } };
    } } } } as any;
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolve, localConfig, prisma, acceptedLegal);
    await assert.rejects(() => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', xCompanyId: 'co-target', path: '/v1/auth/me' })),
      (error: any) => {
        assert.deepEqual(error.getResponse(), {
          code: 'company_membership_disabled',
          message: 'No access to the requested company.',
          companyName: 'ร้านเดิม',
        });
        return true;
      });
  });

  it('does not name existing or nonexistent companies to unrelated users', async () => {
    const responses: Array<{ status: number; body: unknown }> = [];
    for (const companyId of ['co-existing', 'co-nonexistent']) {
      const resolve = { execute: async () => { throw new ForbiddenException('No active company membership.'); } } as any;
      const findCompany = mock.fn(async ({ where }: any) => where.id === 'co-existing' ? { name: 'ป๋อจ้าน Company' } : null);
      const prisma = {
        client: {
          ...noopPrisma.client,
          company: { findUnique: findCompany },
          companyMembership: { findUnique: async () => null },
        },
      } as any;
      const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolve, localConfig, prisma, acceptedLegal);

      await assert.rejects(
        () => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', xCompanyId: companyId, path: '/v1/auth/me' })),
        (error: unknown) => {
          assert.ok(error instanceof ForbiddenException);
          assert.equal(error.getStatus(), 403);
          assert.deepEqual(error.getResponse(), {
            code: 'company_access_unavailable',
            message: 'No access to the requested company.',
          });
          responses.push({ status: error.getStatus(), body: error.getResponse() });
          return true;
        },
      );
      assert.equal(findCompany.mock.callCount(), 0);
    }
    assert.deepEqual(responses[0], responses[1]);
  });

  it('names the requested company only on a scoped auth/me access denial', async () => {
    const resolve = { execute: async () => { throw new ForbiddenException('No active company membership.'); } } as any;
    const prisma = {
      client: {
        ...noopPrisma.client,
        // The name is available here because this user has a row for the requested company.
        companyMembership: { findUnique: async (query: any) => {
          assert.deepEqual(query.where, { companyId_userId: { companyId: 'co-target', userId: 'test-sub' } });
          return { company: { name: 'ป๋อจ้าน Company' } };
        } },
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

  describe('export cleanup 0.2 HTTP boundary', () => {
    it('free draft mode denies both export routes and bundle parts', async () => {
      const freeResolve = { execute: async (...args: any[]) => ({ ...await noopResolve.execute(...args), freeExpenseDrafts: true }) } as any;
      const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, freeResolve, localConfig,
        prismaFor('test-sub', null, { termEndsAt: new Date(Date.now() - 1000) }), acceptedLegal);
      for (const suffix of ['accountant-package', 'accountant-package/bundle-plan', 'accountant-package/bundle/1', 'software-export', 'software-export/bundle/1', 'accounting-software-export']) {
        await assert.rejects(() => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', method: 'POST', path: `/v1/companies/c1/expenses/${suffix}` })),
          (e: any) => e instanceof ForbiddenException && (e.getResponse() as { code?: string }).code === 'FREE_EXPENSE_DRAFTS_ONLY');
      }
    });
  });

  it('R10 free source-drafts shops cannot reach month, export or markFiled routes', async () => {
    const freeResolve = { execute: async (...args: any[]) => ({ ...await noopResolve.execute(...args), freeExpenseDrafts: true }) } as any;
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, freeResolve, localConfig,
      prismaFor('test-sub', null, { termEndsAt: new Date(Date.now() - 1000) }), acceptedLegal);
    for (const [method, suffix] of [
      ['GET', 'tax/withholding/months'], ['GET', 'tax/withholding/months/2026-09'],
      ['POST', 'tax/withholding/PND3/periods/p/export'], ['POST', 'tax/pnd53/periods/p/export'],
      ['PATCH', 'tax/withholding/PND53/periods/p/mark-filed'], ['PATCH', 'tax/periods/p/mark-filed'],
    ]) await assert.rejects(guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', method, path: `/v1/companies/c1/${suffix}` })),
      (error: any) => error instanceof ForbiddenException && (error.getResponse() as any).code === 'FREE_EXPENSE_DRAFTS_ONLY');
  });

  it('free mode opens exact draft actions while preserving legal and final-action gates', async () => {
    const freeResolve = { execute: async (...args: any[]) => ({ ...await noopResolve.execute(...args), freeExpenseDrafts: true }) } as any;
    const expiredPrisma = prismaFor('test-sub', null, { termEndsAt: new Date(Date.now() - 1000) });
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, freeResolve, localConfig, expiredPrisma, acceptedLegal);
    for (const [method, path] of [['GET', '/v1/companies/c1/expenses'], ['PATCH', '/v1/companies/c1/expenses/draft'], ['POST', '/v1/companies/c1/expenses/receipt-uploads'], ['GET', '/v1/auth/me'], ['GET', '/v1/plan-term/notice']]) {
      assert.equal(await guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', method, path })), true, path);
    }
    for (const [method, path] of [['POST', '/v1/companies/c1/expenses/draft/confirm'], ['POST', '/v1/companies/c1/expenses'], ['POST', '/v1/companies/c1/expenses/capture-groups/g/handoff'], ['GET', '/v1/companies/c1/ledger']]) {
      await assert.rejects(() => guard.canActivate(makeContext({ authHeader: 'Bearer valid.token', method, path })),
        (error: any) => error instanceof ForbiddenException && (error.getResponse() as any).code === 'FREE_EXPENSE_DRAFTS_ONLY');
    }
    const legalGuard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, freeResolve, localConfig, expiredPrisma,
      { isRequired: async () => true } as any);
    await assert.rejects(() => legalGuard.canActivate(makeContext({ authHeader: 'Bearer valid.token', path: '/v1/companies/c1/expenses' })),
      (error: any) => error instanceof ForbiddenException && (error.getResponse() as any).code === 'legal_acceptance_required');
    await assert.rejects(() => legalGuard.canActivate(makeContext({ authHeader: 'Bearer valid.token', method: 'POST', path: '/v1/companies/c1/expenses/draft/confirm' })),
      (error: any) => error instanceof ForbiddenException && (error.getResponse() as any).code === 'legal_acceptance_required');
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


describe('billing recovery boundaries', () => {
  it('allows company profile recovery only with the permission for that exact route', async () => {
    const routes = [
      ['GET', 'identity', 'company.setup.read'],
      ['PATCH', 'identity', 'company.legal_identity.manage'],
      ['PATCH', 'identity/business-type', 'company.legal_identity.manage'],
      ['GET', 'settings/address-master?postalCode=10330', 'company.setup.read'],
      ['GET', 'vat-registration', 'company.vat_registration.read'],
      ['PUT', 'vat-registration', 'company.vat_registration.manage'],
    ];
    const expired = prismaFor('test-sub', null, { termEndsAt: new Date(0) });
    expired.client.company = { findUnique: async () => ({ status: 'ACTIVE' }) };
    let permissions: string[] = [], recovery = false;
    const resolver = { execute: async (...args: any[]) => {
      recovery = args[4]; return { ...await noopResolve.execute(args[0], args[1]), roles: ['CHIEF_OPERATING_OFFICER'], permissions };
    } } as any;
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolver, localConfig, expired, acceptedLegal);
    for (const [method, suffix, permission] of routes) {
      const path = `/v1/companies/c1/${suffix}`;
      assert.equal(isCompanyProfileRecoveryRoute(method!, path), true);
      permissions = [permission!];
      assert.equal(await guard.canActivate(makeContext({ method, path, authHeader: 'Bearer token' })), true);
      assert.equal(recovery, true);
      permissions = [];
      await assert.rejects(guard.canActivate(makeContext({ method, path, authHeader: 'Bearer token' })), ForbiddenException);
    }
    permissions = ['company.setup.read'];
    assert.equal(await guard.canActivate(makeContext({
      path: '/v1/companies/c1/settings/address-master?postalCode=10330', authHeader: 'Bearer token',
    })), true);
    for (const [method, path] of [['POST', 'identity'], ['DELETE', 'identity'], ['PATCH', 'identity/other'], ['POST', 'settings/address-master'], ['GET', 'settings/address-master/other'], ['GET', 'expenses']])
      assert.equal(isCompanyProfileRecoveryRoute(method!, `/v1/companies/c1/${path}`), false);
    const legal = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolver, localConfig, expired,
      { isRequired: async () => true } as any);
    await assert.rejects(legal.canActivate(makeContext({ path: '/v1/companies/c1/identity', authHeader: 'Bearer token' })), ForbiddenException);
  });
  it('keeps email OTP and company recipient recovery available after expiry without widening account mutations', async () => {
    const routes = [
      ['GET', '/v1/auth/account/email/otp'], ['GET', '/v1/auth/account/email/otp/challenge'],
      ['PATCH', '/v1/auth/me/contact'], ['POST', '/v1/auth/me/password/set'],
      ['GET', '/v1/auth/account/display-name'], ['PATCH', '/v1/auth/account/display-name'],
      ...['request', 'login-method', 'line-reauth', 'line-reauth/start', 'challenge/resend', 'challenge/confirm', 'challenge/cancel']
        .map(path => ['POST', `/v1/auth/account/email/otp/${path}`]),
      ...['recipient', 'recipient/operation'].map(path => ['GET', `/v1/companies/c1/billing/${path}`]),
      ...['recipient/preview', 'recipient/operation/submit', 'recipient/operation/cancel']
        .map(path => ['POST', `/v1/companies/c1/billing/${path}`]),
    ];
    let recovery = false;
    const resolver = { execute: async (...args: any[]) => { recovery = args[4]; return noopResolve.execute(args[0], args[1]); } } as any;
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolver,
      localConfig, prismaFor('test-sub', null, { termEndsAt: new Date(0) }), acceptedLegal);
    for (const [method, path] of routes) {
      assert.equal(await guard.canActivate(makeContext({ method, path, authHeader: 'Bearer token' })), true);
      assert.equal(recovery, true, `${method} ${path}`);
    }
    for (const [method, path] of [['POST', '/v1/auth/account/email'], ['POST', '/v1/auth/account/line/unlink'],
      ['DELETE', '/v1/auth/account/email/otp/challenge'], ['POST', '/v1/auth/account/email/otp/challenge/admin']]) {
      assert.equal(isAccountEmailRecoveryRoute(method!, path!), false);
    }
    for (const [method, path] of [['POST', '/v1/auth/me/contact'], ['PATCH', '/v1/auth/me/password/set'], ['GET', '/v1/auth/me/contact'], ['DELETE', '/v1/auth/account/display-name'], ['POST', '/v1/auth/account/display-name']]) {
      await guard.canActivate(makeContext({ method, path, authHeader: 'Bearer token' }));
      assert.equal(recovery, false, `${method} ${path}`);
    }
    for (const path of ['recipient/operation/delete', 'recipient/operation/admin', 'recipient/other/deeper']) {
      assert.equal(isBillingRecoveryRoute('POST', `/v1/companies/c1/billing/${path}`), false);
    }
    const denied = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any,
      { execute: async () => { throw new ForbiddenException('Company or membership is held.'); } } as any,
      localConfig, noopPrisma, acceptedLegal);
    await assert.rejects(denied.canActivate(makeContext({ method: 'POST', path: '/v1/auth/account/email/otp/request', authHeader: 'Bearer token' })));
  });
  it('permits only callback POST routes during platform closure; controllers still verify provider credentials', async () => {
    const closed = { getStatus: async () => ({ effectiveState: 'CLOSED' }) } as any;
    const guard = new AuthGuard(makeReflector(true), failVerifier as any, failVerifier as any, noopResolve, localConfig, noopPrisma, acceptedLegal, closed);
    for (const path of ['/v1/public/stripe-events', '/v1/public/postmark-events/', '/v1/PUBLIC/STRIPE-EVENTS']) {
      assert.equal(await guard.canActivate(makeContext({ path, method: 'POST' })), true);
      await assert.rejects(guard.canActivate(makeContext({ path, method: 'GET' })), (e: any) => e.getResponse().code === 'platform_access_closed');
    }
    await assert.rejects(guard.canActivate(makeContext({ path: '/v1/public/stripe-events/other', method: 'POST' })));
  });
  it('bounds recovery to implemented methods and preserves business and legal gates', async () => {
    for(const method of ['GET','POST'])assert.equal(isBillingRecoveryRoute(method,'/v1/companies/c1/package-change-requests'),true);
    for(const [method,path] of [['DELETE','/v1/companies/c1/package-change-requests'],['POST','/v1/companies/c1/package-change-requests/approve'],['GET','/v1/system/package-change-requests']])assert.equal(isBillingRecoveryRoute(method!,path!),false);
    for (const path of ['quote', 'checkout', 'portal', 'refresh', 'attempts/a/resume', 'attempts/a/cancel', 'attempts/a/capacity', 'collection/a/capacity', 'documents/d/open',
      // Purchase without setup (R-A8/R-D1): a locked shop can prove a new recipient and resend its documents.
      'recipient/otp/request', 'recipient/otp/confirm', 'documents/d/resend']) assert.equal(isBillingRecoveryRoute('POST', `/v1/companies/c1/billing/${path}`), true);
    for (const path of ['recipient/otp/other', 'recipient/otp/request/x', 'documents/d/resend/x', 'documents/d/delete'])
      assert.equal(isBillingRecoveryRoute('POST', `/v1/companies/c1/billing/${path}`), false, path);
    for (const path of ['recipient/otp/request', 'documents/d/resend']) assert.equal(isBillingRecoveryRoute('GET', `/v1/companies/c1/billing/${path}`), false, path);
    assert.equal(isBillingRecoveryRoute('GET', '/v1/companies/c1/billing/capacity?offerKey=STARTER_249&interval=year'), true);
    for(const kind of ['refunds','credit-notes'])assert.equal(isBillingRecoveryRoute('GET',`/v1/companies/c1/billing/invoices/i1/adjustments/${kind}?cursor=re_1`),true);
    for(const method of ['GET','POST'])assert.equal(isBillingRecoveryRoute(method,'/v1/companies/c1/billing/invoices/i1/adjustments/admin'),false);
    assert.equal(isBillingRecoveryRoute('POST','/v1/companies/c1/billing/invoices/i1/adjustments/refunds'),false);
    for (const [method, path] of [['DELETE', '/v1/companies/c1/billing'], ['POST', '/v1/companies/c1/billing/admin'], ['GET', '/v1/companies/c1/billing/quote'], ['GET', '/v1/companies/c1/expenses']]) assert.equal(isBillingRecoveryRoute(method!, path!), false);
    let recovery = false;
    const resolver = { execute: async (...args: any[]) => { recovery = args[4]; return noopResolve.execute(args[0], args[1]); } } as any;
    const expired = prismaFor('test-sub', null, { termEndsAt: new Date(0) });
    const guard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolver, localConfig, expired as any, acceptedLegal);
    assert.equal(await guard.canActivate(makeContext({ path: '/v1/companies/c1/billing', authHeader: 'Bearer token' })), true);
    assert.equal(recovery, true);
    for(const method of ['GET','POST']){
      assert.equal(await guard.canActivate(makeContext({path:'/v1/companies/c1/package-change-requests',method,authHeader:'Bearer token'})),true);
      assert.equal(recovery,true);
    }
    // Sales-event spec §7.4: a shop with no package or an expired one reads its ส่วนลดจากงาน. GET only,
    // that exact path: its neighbours and every other method stay held.
    assert.equal(await guard.canActivate(makeContext({ path: '/v1/companies/c1/billing/event-discount', authHeader: 'Bearer token' })), true);
    assert.equal(recovery, true);
    for (const [method, path] of [['POST', '/v1/companies/c1/billing/event-discount'], ['GET', '/v1/companies/c1/billing/event-discount/x'],
      ['GET', '/v1/companies/c1/billing/event-discounts'], ['POST', '/v1/companies/c1/billing/event-discount/credit']])
      assert.equal(isBillingRecoveryRoute(method!, path!), false, `${method} ${path}`);
    await assert.rejects(guard.canActivate(makeContext({ path: '/v1/companies/c1/billing/event-discount', method: 'POST', authHeader: 'Bearer token' })),
      (e: any) => e.getResponse().code === 'company_term_expired');
    await assert.rejects(guard.canActivate(makeContext({ path: '/v1/companies/c1/expenses', authHeader: 'Bearer token' })), (e: any) => e.getResponse().code === 'company_term_expired');
    assert.equal(recovery, false);
    const legalRequired = { isRequired: async () => true } as any;
    const legalGuard = new AuthGuard(makeReflector(false), noopVerifier as any, failVerifier as any, resolver, localConfig, expired as any, legalRequired);
    await assert.rejects(legalGuard.canActivate(makeContext({ path: '/v1/companies/c1/billing', authHeader: 'Bearer token' })), (e: any) => e.getResponse().code === 'legal_acceptance_required');
    await assert.rejects(legalGuard.canActivate(makeContext({path:'/v1/companies/c1/package-change-requests',method:'POST',authHeader:'Bearer token'})),(e:any)=>e.getResponse().code==='legal_acceptance_required');
  });
});

// RB-40. AuthGuard reads a path parameter named `companyId` as the CALLER's company and resolves
// the membership there. On a platform route the id in the URL is the TARGET shop, where platform
// staff hold no membership, so the request was refused before any handler ran.
describe('platform routes and the companyId path parameter (RB-40)', () => {
  const MODULES = join(__dirname, '..');

  /** What Express hands the guard: one entry per `:name` in the handler's declared path. */
  function declaredParams(controller: Function, handler: string, value: string): Record<string, string> {
    const path = `${Reflect.getMetadata(PATH_METADATA, controller)}/${Reflect.getMetadata(PATH_METADATA, controller.prototype[handler])}`;
    return Object.fromEntries([...path.matchAll(/:(\w+)/g)].map((match) => [match[1]!, value]));
  }

  // The real resolver over one fact: the admin is a member of the platform tenant and of no shop.
  const adminPrisma = {
    client: {
      ...prismaFor('admin-1').client,
      user: { findUnique: async () => ({ id: 'admin-1', status: 'ACTIVE' }) },
      companyFeatureEntitlement: { findMany: async () => [] },
      companyMembership: {
        findFirst: async ({ where }: { where: { companyId?: string } }) => (where.companyId !== undefined && where.companyId !== PLATFORM_TENANT_ID ? null : {
          id: 'membership-admin', companyId: PLATFORM_TENANT_ID, branchScopeMode: 'ALL_BRANCHES', defaultBranchId: null,
          branchScopes: [], company: { status: 'ACTIVE', planTerm: null },
          roles: [{ role: { key: 'SYSTEM_ADMIN', status: 'ACTIVE', permissions: ROLE_GRANTS['SYSTEM_ADMIN']!.map((key) => ({ permission: { key } })) } }],
        }),
      },
    },
  } as any;

  it('lets the platform admin act on any shop through the real guards', async () => {
    const reflector = new Reflector();
    const resolve = new ResolveRequestContextUseCase(adminPrisma, new PermissionResolverService(new PrismaPermissionResolverRepository(adminPrisma)));
    const guard = new AuthGuard(reflector, { verify: async () => ({ subject: 'admin-1', tokenId: 'session-1' }) } as any, failVerifier as any, resolve, localConfig, adminPrisma, acceptedLegal);
    const routes: Array<[Function, string]> = [
      [SystemSalesReferralController, 'setReferral'],
      [SystemSalesAttributionController, 'review'],
      [SystemIdentityReconciliationController, 'generateForCompany'],
      [SystemIdentityReconciliationController, 'repairTaxId'],
      // Executive report API05/API06 (spec §16.1): the shop is `:targetCompanyId`, where the reader holds no membership.
      [ExecutiveReportController, 'company'],
      [ExecutiveReportController, 'history'],
    ];
    for (const [controller, handler] of routes) {
      const request = { method: 'POST', path: '/v1/system/x', headers: { authorization: 'Bearer valid.token' }, cookies: {}, params: declaredParams(controller, handler, 'shop-1'), context: undefined as any };
      const context = { getHandler: () => controller.prototype[handler], getClass: () => controller, switchToHttp: () => ({ getRequest: () => request }) } as any;
      assert.equal(await guard.canActivate(context), true, `${controller.name}.${handler}`);
      assert.equal(new DenyByDefaultGuard(reflector).canActivate(context), true, `${controller.name}.${handler}`);
      assert.equal(request.context.companyId, PLATFORM_TENANT_ID);
    }

    // The same admin on a shop route is still refused: there the parameter IS the caller's company.
    const shopRequest = { method: 'GET', path: '/v1/companies/shop-1/audit/logs', headers: { authorization: 'Bearer valid.token' }, cookies: {}, params: { companyId: 'shop-1' } };
    await assert.rejects(
      () => guard.canActivate({ getHandler: () => ({}), getClass: () => ({}), switchToHttp: () => ({ getRequest: () => shopRequest }) } as any),
      (error: unknown) => error instanceof ForbiddenException && error.message === 'No active company membership.',
    );
  });

  it('no route under system/ or sales/ declares a parameter named companyId', () => {
    const files = (readdirSync(MODULES, { recursive: true, encoding: 'utf8' }) as string[]).filter((file) => file.endsWith('.controller.ts'));
    let systemControllers = 0;
    let salesControllers = 0;
    const offenders = files.flatMap((file) => readFileSync(join(MODULES, file), 'utf8')
      // One block per controller class: its decorator, then the route decorators it owns.
      .split(/(?=@Controller\()/)
      .flatMap((block) => {
        const prefix = /^@Controller\(\s*['"`]([^'"`]*)/.exec(block)?.[1];
        if (prefix === undefined || !/^(system|sales)(\/|$)/.test(prefix)) return [];
        systemControllers += 1;
        if (/^sales(\/|$)/.test(prefix)) salesControllers += 1;
        return [prefix, ...[...block.matchAll(/@(?:Get|Post|Put|Patch|Delete|All)\(\s*['"`]([^'"`]*)/g)].map((match) => `${prefix}/${match[1]}`)]
          .filter((path) => /:companyId\b/.test(path))
          .map((path) => `${file}: ${path}`);
      }));
    assert.ok(salesControllers >= 3, `expected sales controllers in the scan, found ${salesControllers}`);
    assert.ok(systemControllers >= 15, `expected to scan the platform controllers, found ${systemControllers}`);
    assert.deepEqual(offenders, [], 'AuthGuard resolves :companyId as the caller membership; name the target :partnerCompanyId');
  });
});

// RB-36. Kept here because this is the guard suite the API test script runs. Suspending an agent
// leaves the membership and the role in place, so a fresh login used to walk straight back in.
describe('SalesAgentActiveGuard (RB-36)', () => {
  const agent = { userId: 'agent-1', companyId: PLATFORM_TENANT_ID, roles: ['MANGMEE_SALES'], permissions: ['sales.console.read'] };
  const httpContext = (context: object) => ({ switchToHttp: () => ({ getRequest: () => ({ context }) }) }) as any;
  const guardOver = (profile: { status: string } | null) => {
    const findUnique = mock.fn(async (_args: { where: { userId: string } }) => profile);
    return { guard: new SalesAgentActiveGuard({ client: { salesAgentProfile: { findUnique } } } as any), findUnique };
  };

  it('refuses a suspended agent with a stable code, and lets the same agent back in once reactivated', async () => {
    const profile = { status: 'SUSPENDED' };
    const { guard, findUnique } = guardOver(profile);
    await assert.rejects(() => guard.canActivate(httpContext(agent)), (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal((error.getResponse() as { code: string }).code, 'SALES_AGENT_SUSPENDED');
      return true;
    });
    assert.deepEqual(findUnique.mock.calls[0]!.arguments[0].where, { userId: 'agent-1' });

    // Nothing to re-grant: the role and the membership never left, only the status changed.
    profile.status = 'ACTIVE';
    assert.equal(await guard.canActivate(httpContext(agent)), true);
  });

  it('lets through a caller who has no agent profile, and never locks SYSTEM_ADMIN out', async () => {
    assert.equal(await guardOver(null).guard.canActivate(httpContext({ ...agent, roles: ['MANGMEE_SALES_LEAD'] })), true);
    const admin = guardOver({ status: 'SUSPENDED' });
    assert.equal(await admin.guard.canActivate(httpContext({ ...agent, roles: ['SYSTEM_ADMIN'] })), true);
    assert.equal(admin.findUnique.mock.callCount(), 0);
  });

  it('stands on every sales-console controller that requires a sales permission', () => {
    const controllers = Reflect.getMetadata('controllers', SalesConsoleModule) as Function[];
    const requiresSales = (controller: Function) => Object.getOwnPropertyNames(controller.prototype).some((name) => [
      ...(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.prototype[name]) ?? []),
      ...(Reflect.getMetadata(REQUIRED_ANY_PERMISSIONS_KEY, controller.prototype[name]) ?? []),
    ].some((permission: string) => permission.startsWith('sales.')));
    const sales = controllers.filter(requiresSales);
    assert.ok(sales.length >= 6, `expected the sales controllers, found ${sales.map((controller) => controller.name).join(', ')}`);
    assert.deepEqual(
      sales.filter((controller) => !(Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[] | undefined)?.includes(SalesAgentActiveGuard))
        .map((controller) => controller.name),
      [],
    );
  });
});

// E1: enumerate the module's actual route handlers, including E3 reads and the API13 export.
describe('executive account boundary (E1)', () => {
  it('requires permission and platform context on every route, independent of caller role names', async () => {
    const { ExecutiveBusinessModule } = await import('../executive-business/executive-business.module');
    const controllers = Reflect.getMetadata('controllers', ExecutiveBusinessModule) as any[];
    const { ExecutiveReportReadService } = await import('../executive-business/application/executive-report-read.service');
    const { METHOD_METADATA, HEADERS_METADATA } = await import('@nestjs/common/constants');
    let checked = 0;
    // Exact permissions per handler; API13 also takes the binary response.
    const routes = new Map<unknown, { permissions: (method: string) => string[]; args: (method: string, req: unknown) => unknown[] }>([
      [ExecutiveUsersController, { permissions: () => ['system.executive_user.manage'],
        args: (method, req) => method === 'list' || method === 'create' ? [{}, req] : method === 'detail' ? ['target', req] : ['target', {}, req] }],
      [ExecutiveReportController, { permissions: method => method === 'export' ? ['system.executive.read', 'system.executive.export'] : method === 'updateNote' ? ['system.executive.read', 'system.executive.company_note.manage'] : ['system.executive.read'],
        args: (method, req) => method === 'export' ? [{}, req, { setHeader: () => {}, send: () => {} }] : method === 'context' ? [req] : ['company', 'history', 'updateNote'].includes(method) ? ['target', {}, req] : [{}, req] }],
    ]);
    assert.deepEqual(controllers.map((controller) => controller.name), ['ExecutiveUsersController', 'ExecutiveReportController']);
    for (const Controller of controllers) {
      const { permissions, args } = routes.get(Controller)!;
      const calls: string[] = [];
      const service = new Proxy({}, { get: (_target, method: string) => method === 'clock' ? () => new Date('2026-10-04T00:00:00Z') : () => { calls.push(method); return Promise.resolve(method === 'export' ? { file: Buffer.alloc(0), exportReference: 'export-test', rowCount: 0, period: { from: '2026-09', to: '2026-09' } } : {}); } });
      const controller = new Controller(service);
      for (const method of Object.getOwnPropertyNames(Controller.prototype).filter((name) => Reflect.hasMetadata(METHOD_METADATA, Controller.prototype[name]))) {
        checked++;
        const handler = Controller.prototype[method];
        const context = { userId: 'caller', companyId: PLATFORM_TENANT_ID, roles: [] as string[], permissions: permissions(method), requestId: 'e1-guard' };
        assert.deepEqual(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler), context.permissions, method);
        assert.ok(Reflect.getMetadata(HEADERS_METADATA, handler).some((h: any) => h.name === 'Cache-Control' && h.value === 'no-store'));
        const request = { context: { ...context, companyId: 'customer-company' } };
        const http = { getHandler: () => handler, getClass: () => Controller, switchToHttp: () => ({ getRequest: () => request }) } as any;
        assert.equal(new DenyByDefaultGuard(new Reflector()).canActivate(http), true);
        // API13 checks tenant inside the service so every attempted export is audited.
        // Exercise that real entry point; a permissive service stub would bypass its tenant boundary.
        const readSource = mock.fn(() => assert.fail('denied export must not read report data'));
        const tenantController = method === 'export' ? new Controller(new ExecutiveReportReadService(
          { client: { $transaction: readSource } } as never, { logOrThrow: async () => {} } as never, {} as never, {} as never,
        )) : controller;
        await assert.rejects(async () => tenantController[method](...args(method, request)), (e: any) => e.getStatus() === 403, method);
        assert.equal(readSource.mock.callCount(), 0, method);
        assert.equal(calls.length, 0, method);
        request.context = { ...context };
        await controller[method](...args(method, request));
        assert.equal(calls.length, 1, method); calls.length = 0;
        for (const missing of context.permissions) {
          request.context = { ...context, roles: ['MANGMEE_EXECUTIVE', 'SYSTEM_ADMIN'], permissions: context.permissions.filter(permission => permission !== missing) };
          assert.throws(() => new DenyByDefaultGuard(new Reflector()).canActivate(http), ForbiddenException, `${method}: missing ${missing}`);
        }
      }
    }
    assert.equal(checked, 14);
    const app = readFileSync(join(__dirname, '../../app.module.ts'), 'utf8');
    assert.match(app, /imports:\s*\[[\s\S]*?ExecutiveBusinessModule/);
  });

  it('accepts only the documented command/query keys and rejects invalid values at the HTTP boundary', async () => {
    const { ValidationPipe } = await import('@nestjs/common');
    const { GLOBAL_VALIDATION_PIPE_OPTIONS } = await import('../../common/pipes/validation-pipe.options');
    const dto = await import('../executive-business/presentation/http/executive-users.controller');
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    for (const [metatype, body] of [
      [dto.ExecutiveUserCreateDto, { username: 'reader', displayName: 'ผู้บริหาร', canExport: false, canSeeContacts: false, canEditCompanyNote: true }],
      [dto.ExecutiveUserStatusDto, { status: 'SUSPENDED', reason: 'เหตุผล' }],
      [dto.ExecutiveUserCredentialDto, { reason: 'เหตุผล' }],
      [dto.ExecutiveUserAccessDto, { canExport: false, canSeeContacts: true, canEditCompanyNote: false, reason: 'เหตุผล' }],
      [dto.ExecutiveUserListQueryDto, { q: 'reader', status: 'ACTIVE', page: 1, pageSize: 20 }],
    ] as const) {
      const metadata = { type: 'body' as const, metatype };
      assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(await pipe.transform(body, metadata)))).sort(), Object.keys(body).sort());
      await assert.rejects(pipe.transform({ ...body, roles: ['SYSTEM_ADMIN'] }, metadata));
    }
    for (const body of [{ page: 0 }, { pageSize: 101 }, { status: 'DISABLED' }, { page: 'x' }, { page: 1.5 }]) {
      await assert.rejects(pipe.transform(body, { type: 'query', metatype: dto.ExecutiveUserListQueryDto }));
    }
    const parsed = await pipe.transform({ page: '2', pageSize: '10' }, { type: 'query', metatype: dto.ExecutiveUserListQueryDto });
    assert.equal(parsed.page, 2); assert.equal(parsed.pageSize, 10);
  });

  // E3, spec §12.4: a report query value outside the contract is 400 at the HTTP boundary, never widened to ALL.
  it('accepts only the report query of spec §12.4 and refuses anything else at the HTTP boundary', async () => {
    const { ValidationPipe } = await import('@nestjs/common');
    const { GLOBAL_VALIDATION_PIPE_OPTIONS } = await import('../../common/pipes/validation-pipe.options');
    const dto = await import('../executive-business/presentation/http/executive-report.controller');
    const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
    const query = (metatype: unknown, value: Record<string, unknown>) => pipe.transform(value, { type: 'query', metatype: metatype as never });
    const list = { month: '2026-09', buildId: 'b1', industry: 'FOOD_ACCOMMODATION', discovery: 'BEFORE_COLLECTION', referringSales: 'S001', companyStatus: 'ARCHIVED',
      planState: 'ADMIN_HOLD', usageGroup: 'NOT_STARTED', usageAssessed: 'false', activeInPeriod: 'true', paidInPeriod: 'true', positiveNetInPeriod: 'true', paidEver: 'UNKNOWN',
      fullyRefunded: 'true', receiptAdoption: 'NOT_ENTITLED', spendCohort: 'TO80_BOUNDARY_TIE', signupRail: 'email-otp', q: '  ร้านซ้ำ  ', sortBy: 'netReceipts', sortDir: 'asc',
      page: '3', pageSize: '100', receiptBucket: 'ONE_TO_FIVE', churned: 'true', receiptAdded7: 'true', atDataDate: 'true', packageLabel: 'แพ็กเกจทดสอบ' };
    const parsed = await query(dto.ExecutiveCompaniesQueryDto, list);
    assert.deepEqual([parsed.q, parsed.page, parsed.pageSize], ['ร้านซ้ำ', 3, 100]);
    assert.deepEqual(Object.keys(parsed).filter(key => parsed[key] !== undefined).sort(), Object.keys(list).sort());
    await query(dto.ExecutiveCompaniesQueryDto, { from: '2026-08', to: '2026-09' });
    for (const bad of [{ month: '2026-13' }, { month: '2569-9' }, { industry: 'MINING' }, { discovery: 'LINE' }, { referringSales: 'S 001' },
      { companyStatus: 'DELETED' }, { usageGroup: 'UNKNOWN' }, { usageAssessed: 'maybe' }, { activeInPeriod: 'false' }, { paidEver: 'MAYBE' }, { spendCohort: 'TOP10' },
      { signupRail: 'partner-api' }, { q: 'ก'.repeat(121) }, { sortBy: 'id' }, { sortDir: 'up' }, { page: '0' }, { pageSize: '101' }, { page: '1.5' }, { companyId: 'shop-1' }])
      await assert.rejects(query(dto.ExecutiveCompaniesQueryDto, { ...list, ...bad }), JSON.stringify(bad));
    await query(dto.ExecutiveAnalysisQueryDto, { month: '2026-09', section: 'compare', dimension: 'company', sideA: 'a', sideB: 'b' });
    for (const bad of [{ section: 'deletion' }, { view: 'list' }, { metric: 'documents' }, { dimension: 'province' }, { q: 'x' }])
      await assert.rejects(query(dto.ExecutiveAnalysisQueryDto, { month: '2026-09', section: 'usage', ...bad }), JSON.stringify(bad));
    await assert.rejects(query(dto.ExecutiveCompanyQueryDto, { month: '2026-09', industry: 'ALL' }));
    await assert.rejects(query(dto.ExecutiveHistoryQueryDto, { pageSize: '101' }));
  });
});


it('executive account errors carry safe codes and the request id without leaking guard/validation messages', async () => {
  const { EXCEPTION_FILTERS_METADATA } = await import('@nestjs/common/constants');
  const { BadRequestException } = await import('@nestjs/common');
  const { ExecutiveBusinessModule } = await import('../executive-business/executive-business.module');
  const { executiveError } = await import('../executive-business/application/executive-users.service');
  // Account filters are instances; the report filter is an injectable class with async export audit.
  const denied = (controller: Function) => {
    const filter = Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, controller)[0];
    if (typeof filter !== 'function') return filter;
    assert.ok(Reflect.getMetadata('providers', ExecutiveBusinessModule).includes(filter));
    return new filter({ logOrThrow: async () => {} });
  };
  const words: string[] = [];
  for (const [controller, method] of [[ExecutiveUsersController, 'GET'], [ExecutiveReportController, 'GET'], [ExecutiveReportController, 'POST']] as const) {
    const response = { setHeader: () => response, status: () => response, json: (value: { message: string; code: string }) => { assert.equal(value.code, 'EXECUTIVE_ACCESS_DENIED'); words.push(value.message); } };
    await denied(controller).catch(new ForbiddenException('No active company membership.'), { switchToHttp: () => ({ getRequest: () => ({ method, headers: {} }), getResponse: () => response }) });
  }
  assert.deepEqual(words, ['ไม่มีสิทธิ์จัดการบัญชีผู้บริหาร', 'คุณไม่มีสิทธิ์ดูรายงานนี้', 'คุณไม่มีสิทธิ์ส่งออกไฟล์นี้']);
  for (const controller of [ExecutiveUsersController, ExecutiveReportController]) {
    const filter = denied(controller);
    for (const [method, error, expectedCode] of [
      ['POST', new ForbiddenException('sales_console_platform_tenant_required'), 'EXECUTIVE_ACCESS_DENIED'],
      ['POST', new BadRequestException(['canExport must be a boolean']), 'INVALID_INPUT'],
      ['GET', new BadRequestException(['page must be a number']), 'EXECUTIVE_QUERY_INVALID'],
      ['GET', executiveError('request-e1', 'COMPANY_NOT_FOUND'), 'COMPANY_NOT_FOUND'],
      ['GET', executiveError('request-e1', 'SOURCE_UNAVAILABLE'), 'SOURCE_UNAVAILABLE'],
    ] as const) {
      let result: any; let status: number | undefined; let cache: string | undefined;
      const response = { setHeader: (name: string, value: string) => { assert.equal(name, 'Cache-Control'); cache = value; }, status: (value: number) => { status = value; return response; }, json: (value: any) => { result = value; } };
      await filter.catch(error, { switchToHttp: () => ({ getRequest: () => ({ method, headers: { 'x-request-id': 'request-e1' } }), getResponse: () => response }) });
      assert.equal(status, error.getStatus()); assert.equal(cache, 'no-store');
      assert.deepEqual(Object.keys(result).sort(), ['code', 'message', 'requestId']);
      assert.equal(result.code, expectedCode); assert.equal(result.requestId, 'request-e1');
      assert.doesNotMatch(result.message, /[A-Za-z]/);
    }
  }
});

describe('sold 50 ทวิ signature read boundary', () => {
  it('allows ENTERPRISE signature managers, refuses STARTER and non-managers, keeps full tax closed', async () => {
    const { TaxController } = await import('../tax/presentation/http/tax.controller');
    const { filterPermissionsByEntitlement } = await import('../employee-access/domain/logic/feature-gate.logic');
    const { evaluateEntitledFeatureKeys } = await import('../employee-access/application/entitlement.helper');
    const { TIER_FEATURE_PRESETS, ALL_FEATURE_ENTITLEMENT_KEYS } = await import('@watchdog-bms/contracts');
    const handler = (TaxController.prototype as any).getTaxSignature;
    assert.equal(typeof handler, 'function');
    assert.equal(Reflect.getMetadata(PATH_METADATA, handler), 'tax/profile/signature');
    const check = (keys: readonly string[], grants: string[], method = handler) => {
      const entitled = evaluateEntitledFeatureKeys(ALL_FEATURE_ENTITLEMENT_KEYS.map(featureKey => ({ featureKey, enabled: keys.includes(featureKey) })));
      const context = { permissions: filterPermissionsByEntitlement(grants, entitled) };
      return new DenyByDefaultGuard(new Reflector()).canActivate({
        getHandler: () => method, getClass: () => TaxController,
        switchToHttp: () => ({ getRequest: () => ({ context }) }),
      } as any);
    };
    const grants = ['company.tax_signature.manage', 'tax.profile.read'];
    assert.equal(check(TIER_FEATURE_PRESETS.ENTERPRISE_1999, grants), true);
    assert.throws(() => check(TIER_FEATURE_PRESETS.STARTER_249, grants), ForbiddenException);
    assert.throws(() => check(TIER_FEATURE_PRESETS.ENTERPRISE_1999, ['wht.certificate.issue']), ForbiddenException);
    assert.throws(() => check(TIER_FEATURE_PRESETS.ENTERPRISE_1999, grants, TaxController.prototype.getProfile), ForbiddenException);
  });

  it('reads only signature fields for the request company and defaults safely when no profile exists', async () => {
    const { TaxController } = await import('../tax/presentation/http/tax.controller');
    const { UpdateCompanyTaxSignatureUseCase } = await import('../tax/application/use-cases/update-company-tax-signature.use-case');
    let row: any = { signatureMode: 'AUTO_STAMP', signatureImageAttachmentId: 'signature-1' };
    const repo = { prisma: { client: { companyTaxProfile: { findUnique: async (query: any) => {
      assert.deepEqual(query, { where: { companyId: 'company-1' }, select: { signatureMode: true, signatureImageAttachmentId: true } });
      return row;
    } } } } };
    const signature = new UpdateCompanyTaxSignatureUseCase(repo as any, { findById: async () => null } as any, {} as any, {} as any);
    const dependencies = [...Array(12).fill({}), repo, {}]; dependencies[9] = signature;
    const value = new TaxController(...dependencies as ConstructorParameters<typeof TaxController>);
    const get = (value as any).getTaxSignature;
    assert.equal(typeof get, 'function');
    const ctx = { companyId: 'company-1', permissions: ['company.tax_signature.manage'] };
    assert.deepEqual(await get.call(value, ctx, 'company-1'), { ...row, signatureImageUrl: null, signatureStoredAt: null });
    row = null;
    assert.deepEqual(await get.call(value, ctx, 'company-1'), { signatureMode: 'BLANK', signatureImageAttachmentId: null, signatureImageUrl: null, signatureStoredAt: null });
    await assert.rejects(() => get.call(value, ctx, 'another-company'), ForbiddenException);
  });
});
