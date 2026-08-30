import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { IS_PUBLIC_ROUTE_KEY } from '../../../common/security/public.decorator';
import { accessTokenFromCookies } from './auth-cookie.constants';
import { AppConfigService } from '../../../common/config/app-config.service';
import { PrismaService } from '../../../common/database/prisma.service';
import { WatchdogJwtVerifierAdapter } from '../infrastructure/watchdog-jwt-verifier.adapter';
import { DevJwtVerifierAdapter } from '../infrastructure/dev-jwt-verifier.adapter';
import { ResolveRequestContextUseCase } from '../application/use-cases/resolve-request-context.use-case';
import type { RequestContext } from '../domain/models/request-context.model';
import { LegalAcceptanceService } from '../application/legal-acceptance.service';
import { PlatformAccessService } from '../application/platform-access.service';

export type RequestWithContext = Request & {
  context?: RequestContext;
};

// ponytail: exempt auth routes from mustChangePassword block so login/change-password flow works
const MUST_CHANGE_PASSWORD_EXEMPT_PREFIX = '/v1/auth/';

function cleanRequestPath(path: string): string {
  const cleanPath = path.split('?')[0] ?? '';
  return cleanPath.length > 1 ? cleanPath.replace(/\/$/, '') : cleanPath;
}

function isMustChangePasswordExempt(path: string): boolean {
  const cleanPath = cleanRequestPath(path);
  return cleanPath === '/v1/auth' || cleanPath.startsWith(MUST_CHANGE_PASSWORD_EXEMPT_PREFIX);
}

const LEGAL_ACCEPTANCE_EXEMPT_PATHS = new Set([
  '/v1/auth/me',
  '/v1/auth/legal-acceptance',
  '/v1/auth/password/change',
  '/v1/auth/logout',
]);

function isLegalAcceptanceExempt(path: string): boolean {
  return LEGAL_ACCEPTANCE_EXEMPT_PATHS.has(cleanRequestPath(path));
}

/**
 * P29 §4B on-access expiry check. Everything under `/v1/auth/` keeps working after the deadline —
 * login, `me`, the company switcher (`me/companies`), password change, logout — and so does the
 * customer's own read of why they are blocked. Without these the expired company would be a dead
 * end with no way in and nothing to explain it.
 */
const TERM_EXPIRY_EXEMPT_PREFIX = '/v1/auth/';
const TERM_EXPIRY_EXEMPT_PATHS = new Set(['/v1/auth', '/v1/plan-term/notice']);

function isTermExpiryExempt(path: string): boolean {
  const cleanPath = cleanRequestPath(path);
  return TERM_EXPIRY_EXEMPT_PATHS.has(cleanPath) || cleanPath.startsWith(TERM_EXPIRY_EXEMPT_PREFIX);
}

function isInternalWorkerPath(path: string): boolean {
  const cleanPath = cleanRequestPath(path);
  return cleanPath === '/v1/internal' || cleanPath.startsWith('/v1/internal/');
}

const CLOSED_PUBLIC_PATHS = new Set([
  '/v1/auth/platform-access',
  '/v1/auth/login-channels',
  '/v1/auth/password/login',
  // P12-1: LINE web login is a login endpoint — same gate posture as password login.
  '/v1/auth/line/login/callback',
  // P12-3a: minting and redeeming a desktop QR transaction are both login steps.
  '/v1/auth/line/qr/create',
  '/v1/auth/line/qr/redeem',
  '/v1/auth/session/refresh',
]);

const ALWAYS_PUBLIC_PATHS = new Set([
  '/v1/health',
  '/v1/internal/health/readiness',
]);

function platformClosed(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'platform_access_closed',
    message: 'MangmeePlus customer access is currently closed.',
  });
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly watchdogVerifier: WatchdogJwtVerifierAdapter,
    private readonly devVerifier: DevJwtVerifierAdapter,
    private readonly resolveContext: ResolveRequestContextUseCase,
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly legalAcceptance: LegalAcceptanceService,
    private readonly platformAccess?: PlatformAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const reqPath = req.path ?? req.url ?? '';
    const cleanPath = cleanRequestPath(reqPath);
    if (isPublic && ALWAYS_PUBLIC_PATHS.has(cleanPath)) return true;
    if (isPublic && isInternalWorkerPath(cleanPath)) return true;

    const access = this.platformAccess ? await this.platformAccess.getStatus() : null;
    const accessClosed = access?.effectiveState === 'CLOSED';
    if (isPublic) {
      if (!accessClosed || CLOSED_PUBLIC_PATHS.has(cleanPath)) return true;
      throw platformClosed();
    }
    const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    const headerCompanyId = req.headers['x-company-id'] as string | undefined;
    const routeCompanyId = req.params?.['companyId'] as string | undefined;
    const companyId = headerCompanyId ?? routeCompanyId;

    const authHeader = req.headers['authorization'] as string | undefined;
    // ponytail: cookie fallback for browser clients; Bearer header is primary
    const cookieToken = accessTokenFromCookies((req as Record<string, any>)['cookies']);
    const rawToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : cookieToken;

    if (!rawToken) {
      throw new UnauthorizedException('Missing authentication token.');
    }

    let subject: string | undefined;
    let tokenId: string | undefined;
    let authProvider: 'watchdog' | 'dev' | undefined;
    let sessionProvider: string | undefined;

    // Try WatchDog JWT first
    try {
      const result = await this.watchdogVerifier.verify(rawToken);
      subject = result.subject;
      tokenId = result.tokenId;
      sessionProvider = result.provider;
      authProvider = 'watchdog';
    } catch {
      // fall through to dev verifier
    }

    // Try dev JWT only when APP_ENV=local
    if (!subject && !this.config.isProduction) {
      try {
        const result = await this.devVerifier.verify(rawToken);
        subject = result.subject;
        tokenId = result.tokenId;
        authProvider = 'dev';
      } catch {
        // fall through to throw below
      }
    }

    if (!subject || !authProvider) {
      throw new UnauthorizedException('Invalid authentication token.');
    }

    // L-05: fail closed independently of the verifiers. A validly-signed token without a
    // session id must never reach context resolution — skipping the lookup made it immune
    // to logout, revoke-others and the password-reset session sweep.
    if (!tokenId) {
      throw new UnauthorizedException('Token is missing the session claim.');
    }

    const session = await this.prisma.client.authSession.findUnique({
      where: { tokenId },
      select: { userId: true, status: true, expiresAt: true },
    });
    if (!session || session.userId !== subject || session.status !== 'ACTIVE' || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session is expired or revoked.');
    }

    // Header and route are two representations of one tenant selection, never independent
    // authorities. Enforce this centrally so a controller missing assertRouteCompany cannot
    // execute company B's URL against company A's request context.
    if (headerCompanyId !== undefined && routeCompanyId !== undefined && headerCompanyId !== routeCompanyId) {
      throw new ForbiddenException('Route company does not match request context.');
    }

    try {
      req.context = await this.resolveContext.execute(subject, requestId, authProvider, companyId);
    } catch (error) {
      // The company-access screen can name the blocked destination without widening access to any
      // company data endpoint. Other forbidden responses keep their existing shape.
      if (error instanceof ForbiddenException && companyId && cleanPath === '/v1/auth/me') {
        const company = await this.prisma.client.company.findUnique({
          where: { id: companyId },
          select: { name: true },
        }).catch(() => null);
        if (company) {
          throw new ForbiddenException({
            code: 'company_access_unavailable',
            message: 'No access to the requested company.',
            companyName: company.name,
          });
        }
      }
      throw error;
    }

    // Block business module access until temporary password is changed.
    // Null credential (LINE-only users) is treated as no block.
    // LINE-login sessions are never blocked: the forced change belongs to the password login.
    if (accessClosed && !req.context.roles.includes('SYSTEM_ADMIN')) {
      throw platformClosed();
    }

    if (sessionProvider !== 'line' && !isMustChangePasswordExempt(reqPath)) {
      const credential = await this.prisma.client.userCredential.findUnique({
        where: { userId: req.context.userId },
        select: { mustChangePassword: true },
      });
      if (credential?.mustChangePassword) {
        throw new ForbiddenException('Password change required before accessing business modules.');
      }
    }

    // P29: the deadline binds to the hour, so it is checked here rather than left to the 5-minute
    // sweep — a company is refused the instant `now` reaches `termEndsAt`, even while its status
    // still reads ACTIVE. A company with no CompanyPlanTerm row (every customer that predates
    // P29) matches nothing here and is completely unaffected. SYSTEM_ADMIN is exempt for the same
    // reason it is exempt from the platform-closed gate above: the console that fixes an expiry
    // must not be lockable by one.
    if (!isTermExpiryExempt(reqPath) && !req.context.roles.includes('SYSTEM_ADMIN')) {
      const term = await this.prisma.client.companyPlanTerm.findUnique({
        where: { companyId: req.context.companyId },
        select: { termEndsAt: true },
      });
      if (term && term.termEndsAt <= new Date()) {
        throw new ForbiddenException({
          code: 'company_term_expired',
          message: 'This company\'s usage term has ended. Contact the administrator to renew.',
        });
      }
    }

    if (!isLegalAcceptanceExempt(reqPath)) {
      if (await this.legalAcceptance.isRequired({
        userId: req.context.userId,
        companyId: req.context.companyId,
        membershipId: req.context.membershipId,
      })) {
        throw new ForbiddenException({
          code: 'legal_acceptance_required',
          message: 'Accept the current Terms and acknowledge the Privacy Notice before accessing business modules.',
        });
      }
    }

    return true;
  }
}
