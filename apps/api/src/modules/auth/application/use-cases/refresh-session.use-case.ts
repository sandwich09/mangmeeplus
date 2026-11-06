import { HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException, Logger, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { emitSecurityEvent, SECURITY_EVENT } from '../../../../common/logger/security-event';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import type { WatchdogIssuedJwtPayload } from '../../domain/models/auth-token.model';
import { JWT_ALGORITHM, jwtClaimIdentity } from '../../domain/logic/jwt-claims.logic';
import type { AuthTokensResult } from './issue-token.use-case';
import { AuthRateLimitService } from '../auth-rate-limit.service';
import { PlatformAccessService } from '../platform-access.service';

const ACCESS_EXPIRES_IN = 900;

type SessionRow = {
  id: string;
  userId: string;
  tokenId: string;
  previousTokenId: string | null;
  /** L-01: stable family identity, set at issuance and never rewritten. Null on pre-L-01 rows. */
  familyId: string | null;
  rotatedAt: Date | null;
  status: string;
  expiresAt: Date;
};

@Injectable()
export class RefreshSessionUseCase {
  private readonly logger = new Logger(RefreshSessionUseCase.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() @Inject(PermissionResolverService) private readonly permissionResolver: PermissionResolverService | null = null,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
    @Optional() @Inject(AuthRateLimitService) private readonly rateLimits: AuthRateLimitService | null = null,
    @Optional() @Inject(PlatformAccessService) private readonly platformAccess: PlatformAccessService | null = null,
  ) {}

  async execute(refreshToken: string): Promise<AuthTokensResult> {
    const secret = this.config.authJwtSecret;
    if (!secret) {
      throw new InternalServerErrorException('JWT signing secret is not configured.');
    }

    const { issuer, audience } = jwtClaimIdentity(this.config);

    let payload: WatchdogIssuedJwtPayload & { provider?: string };
    try {
      payload = await this.jwtService.verifyAsync<WatchdogIssuedJwtPayload & { provider?: string }>(refreshToken, {
        secret,
        algorithms: [JWT_ALGORITHM],
        issuer,
        audience,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Token is not a refresh token.');
    }
    // L-05: a sid-less refresh token must answer 401, never reach findUnique with `undefined`.
    const presentedTokenId = payload.sid;
    if (typeof presentedTokenId !== 'string' || presentedTokenId.length === 0) {
      throw new UnauthorizedException('Refresh token is missing the session claim.');
    }

    // The presented id is either the session's current token or the one it just rotated out.
    let session: SessionRow | null = await this.prisma.client.authSession.findFirst({
      where: { OR: [{ tokenId: presentedTokenId }, { previousTokenId: presentedTokenId }] },
    });

    // L-01: an id matching no generation may still name a live family — that is reuse two or more
    // rotations deep, which the current/previous pair alone cannot see. A token issued before the
    // family claim names no family, so it falls straight through to the plain 401 below.
    if (!session) return this.rejectRetiredToken(payload, presentedTokenId);

    if (!this.isLive(session)) {
      throw new UnauthorizedException('Session is expired or revoked.');
    }

    if ((await this.platformAccess?.getStatus())?.effectiveState === 'CLOSED') {
      const systemAdmin = await this.prisma.client.companyMembership.findFirst({
        where: {
          userId: session.userId,
          status: 'ACTIVE',
          company: { status: 'ACTIVE' },
          roles: { some: { role: { key: 'SYSTEM_ADMIN' } } },
        },
        select: { id: true },
      });
      if (!systemAdmin) {
        throw new ServiceUnavailableException({
          code: 'platform_access_closed',
          message: 'MangmeePlus customer access is currently closed.',
        });
      }
    }

    // L-01: the per-session bucket is consumed only after the session is proven ACTIVE, so a
    // holder of a stale-but-validly-signed token cannot burn a live session's quota.
    await this.assertRefreshQuota(presentedTokenId);

    if (session.tokenId === presentedTokenId) {
      const rotated = await this.rotate(session, presentedTokenId);
      if (rotated) return this.mintFor(session, rotated, payload, secret, 'rotate');
      // CAS miss: a concurrent refresh won the race. Re-read and fall through — this
      // presentation is now a replay of the previous token, not a rotation. The family read
      // covers the loser whose id a *second* rotation already pushed out of `previousTokenId`.
      session = await this.prisma.client.authSession.findUnique({
        where: { previousTokenId: presentedTokenId },
      }) ?? await this.findByFamily(payload.fid);
      if (!this.isLive(session)) {
        throw new UnauthorizedException('Session is expired or revoked.');
      }
    }

    // Presented id is the previous token. Grace is measured from the stored rotation instant,
    // and a replay never rotates, so replays cannot be chained to slide the window.
    const graceMs = this.config.sessionRefreshReuseGraceSeconds * 1000;
    const rotatedAgoMs = session.rotatedAt ? Date.now() - session.rotatedAt.getTime() : Number.POSITIVE_INFINITY;
    if (rotatedAgoMs >= graceMs) {
      await this.revokeForReuse(session, payload.sub, presentedTokenId);
      throw new UnauthorizedException('Session is expired or revoked.');
    }

    return this.mintFor(session, session.tokenId, payload, secret, 'grace_replay');
  }

  private isLive(session: SessionRow | null): session is SessionRow {
    return !!session && session.status === 'ACTIVE' && session.expiresAt > new Date();
  }

  /**
   * Over quota is a real answer and stays a 429 — emitted through AuthRateLimitService so the
   * L-14 `auth.rate_limit.exceeded` event fires here like every other auth bucket.
   *
   * An *unavailable* limiter is not an answer. The BFF deletes the auth cookies on a non-OK
   * refresh, so surfacing a Redis outage here would log every active user out mid-failover —
   * exactly the liveness-for-safety trade spec §4 rule 6 forbids. The session's own
   * ACTIVE/expiry row is the primary control; this bucket is defence in depth and must never
   * be able to end a session.
   */
  private async assertRefreshQuota(refreshTokenId: string): Promise<void> {
    if (!this.rateLimits) return;
    try {
      await this.rateLimits.assertRefreshAllowed(refreshTokenId);
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.TOO_MANY_REQUESTS) throw error;
      this.logger.warn('Session refresh rate-limit store is unavailable; allowing the refresh.');
    }
  }

  /** A retired token still names its family, so a live family here is reuse at any generation. */
  private async rejectRetiredToken(payload: WatchdogIssuedJwtPayload, presentedTokenId: string): Promise<never> {
    const family = await this.findByFamily(payload.fid);
    if (this.isLive(family)) await this.revokeForReuse(family, payload.sub, presentedTokenId);
    throw new UnauthorizedException('Session is expired or revoked.');
  }

  /** A missing/blank claim is an unknown family, never a match — pre-L-01 tokens carry none. */
  private async findByFamily(familyId: string | undefined): Promise<SessionRow | null> {
    if (typeof familyId !== 'string' || familyId.length === 0) return null;
    return this.prisma.client.authSession.findUnique({ where: { familyId } });
  }

  /** Compare-and-set on the presented token id: exactly one concurrent refresh can win. */
  private async rotate(session: SessionRow, presentedTokenId: string): Promise<string | null> {
    const newTokenId = randomUUID();
    const { count } = await this.prisma.client.authSession.updateMany({
      where: { id: session.id, tokenId: presentedTokenId, status: 'ACTIVE' },
      data: { tokenId: newTokenId, previousTokenId: presentedTokenId, rotatedAt: new Date() },
    });
    return count === 1 ? newTokenId : null;
  }

  private async revokeForReuse(session: SessionRow, actorUserId: string, presentedTokenId: string): Promise<void> {
    await this.prisma.client.authSession.updateMany({
      where: { id: session.id, status: 'ACTIVE' },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });
    emitSecurityEvent(this.logger, SECURITY_EVENT.authSessionRefreshReuse, 'CRITICAL', {
      sessionId: session.id,
      userId: actorUserId,
    });
    await this.audit?.log({
      action: AuditAction.AUTH_SESSION_REFRESH,
      actorUserId,
      targetType: 'auth_session',
      targetId: session.id,
      requestId: presentedTokenId,
      result: 'DENIED',
      riskLevel: 'CRITICAL',
      metadataJson: { reason: 'refresh_token_reuse_detected' },
    });
  }

  /**
   * Signs a working pair for `tokenId`. Rotation never writes `expiresAt`, so the refresh
   * token's remaining lifetime always shrinks toward the original session expiry.
   */
  private async mintFor(
    session: SessionRow,
    tokenId: string,
    payload: WatchdogIssuedJwtPayload & { provider?: string },
    secret: string,
    reason: 'rotate' | 'grace_replay',
  ): Promise<AuthTokensResult> {
    const { issuer, audience } = jwtClaimIdentity(this.config);
    // ponytail: carry the origin claim across rotation; old tokens without it are password sessions
    if (payload.provider === 'demo' && !payload.demoCompanyId) throw new UnauthorizedException('Demo company claim is required.');
    const basePayload = { sub: payload.sub, sid: tokenId, provider: payload.provider ?? 'watchdog',
      ...(payload.provider === 'demo' ? { demoCompanyId: payload.demoCompanyId } : {}) };
    const signOptions = { secret, algorithm: JWT_ALGORITHM, issuer, audience } as const;

    // ponytail: re-resolve permissions on refresh so revoked roles are reflected immediately
    let permissions: string[] = [];
    if (this.permissionResolver) {
      try {
        const resolved = await this.permissionResolver.resolveAccess(payload.sub, payload.demoCompanyId);
        permissions = resolved.permissions;
      } catch {
        // no active membership → empty permissions
      }
    }

    const now = Date.now();
    if (session.expiresAt.getTime() <= now) throw new UnauthorizedException('Session expiry has passed.');
    const issuedAt = Math.floor(now / 1000);
    const accessExpiry = Math.min(issuedAt + ACCESS_EXPIRES_IN, session.expiresAt.getTime() / 1000);
    const accessExpiresIn = Math.min(ACCESS_EXPIRES_IN, (session.expiresAt.getTime() - now) / 1000);
    const accessToken = this.jwtService.sign({ ...basePayload, permissions, iat: issuedAt, exp: accessExpiry }, signOptions);
    const refreshToken = this.jwtService.sign(
      { ...basePayload, type: 'refresh', ...(session.familyId ? { fid: session.familyId } : {}),
        iat: issuedAt, exp: session.expiresAt.getTime() / 1000 }, signOptions,
    );

    await this.audit?.log({
      action: AuditAction.AUTH_SESSION_REFRESH,
      actorUserId: payload.sub,
      targetType: 'auth_session',
      targetId: session.id,
      requestId: tokenId,
      result: 'SUCCESS',
      ...(reason === 'grace_replay' ? { riskLevel: 'LOW' as const, metadataJson: { reason } } : {}),
    });

    return { accessToken, refreshToken, expiresIn: accessExpiresIn };
  }
}
