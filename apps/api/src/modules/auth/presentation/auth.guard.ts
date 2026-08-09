import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithContext>();
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

    req.context = await this.resolveContext.execute(subject, requestId, authProvider, companyId);

    // Block business module access until temporary password is changed.
    // Null credential (LINE-only users) is treated as no block.
    // LINE-login sessions are never blocked: the forced change belongs to the password login.
    const reqPath = req.path ?? req.url ?? '';
    if (sessionProvider !== 'line' && !isMustChangePasswordExempt(reqPath)) {
      const credential = await this.prisma.client.userCredential.findUnique({
        where: { userId: req.context.userId },
        select: { mustChangePassword: true },
      });
      if (credential?.mustChangePassword) {
        throw new ForbiddenException('Password change required before accessing business modules.');
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
