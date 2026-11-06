import { Inject, Injectable, InternalServerErrorException, Optional, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AppConfigService } from '../../../../common/config/app-config.service';
import { PermissionResolverService } from '../../../access-control/application/permission-resolver.service';
import { AuditService } from '../../../audit/application/audit.service';
import { AuditAction } from '../../../audit/domain/models/audit-action';
import { JWT_ALGORITHM, jwtClaimIdentity } from '../../domain/logic/jwt-claims.logic';

export type AuthTokensResult = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access token TTL in seconds
};

type DemoSessionProof = { tx: Prisma.TransactionClient; companyId: string; expiresAt: Date };

const ACCESS_EXPIRES_IN = 900;           // 15 min
const REFRESH_EXPIRES_IN = 7 * 24 * 3600; // 7 days

@Injectable()
export class IssueTokenUseCase {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Optional() @Inject(PermissionResolverService) private readonly permissionResolver: PermissionResolverService | null = null,
    @Optional() @Inject(AuditService) private readonly audit: AuditService | null = null,
  ) {}

  async execute(userId: string, authProvider: 'demo', proof: DemoSessionProof): Promise<AuthTokensResult>;
  async execute(userId: string, authProvider: 'watchdog', credentialUpdatedAt: Date): Promise<AuthTokensResult>;
  async execute(userId: string, authProvider?: 'line' | 'dev'): Promise<AuthTokensResult>;
  async execute(userId: string, authProvider: 'email', proof: { tx: Prisma.TransactionClient; reauthBinding: string; now: Date }): Promise<AuthTokensResult>;
  async execute(
    userId: string,
    authProvider: 'watchdog' | 'line' | 'dev' | 'email' | 'demo' = 'dev',
    credentialUpdatedAt?: Date | DemoSessionProof | { tx: Prisma.TransactionClient; reauthBinding: string; now: Date },
  ): Promise<AuthTokensResult> {
    // ponytail: prefer watchdog secret (prod); fall back to dev secret (local)
    const secret = this.config.authJwtSecret;
    if (!secret) {
      throw new InternalServerErrorException('JWT signing secret is not configured.');
    }

    const tokenId = randomUUID();
    // L-01: the family is minted once here and never rewritten, so every generation of this
    // session's refresh tokens names the same family. Refresh tokens only — the access token is
    // resolved by `sid` and would only carry the claim into the chunked browser cookie.
    const familyId = randomUUID();
    const demo = authProvider === 'demo' && credentialUpdatedAt && !(credentialUpdatedAt instanceof Date) && 'expiresAt' in credentialUpdatedAt ? credentialUpdatedAt : undefined;
    if (authProvider === 'demo' && !demo) throw new UnauthorizedException('Demo session requires an expiry and company.');
    const basePayload: Record<string, unknown> = { sub: userId, sid: tokenId, provider: authProvider,
      ...(demo ? { demoCompanyId: demo.companyId } : {}) };
    // L-04: iss/aud come from the same helper the verifiers use, and ride the JWT library's
    // sign options rather than hand-written payload keys, so sign and verify cannot drift.
    const { issuer, audience } = jwtClaimIdentity(this.config);
    const signOptions = { secret, algorithm: JWT_ALGORITHM, issuer, audience } as const;

    // ponytail: resolve permissions at issuance so AI Gateway can read claims without a DB call;
    // empty array if no membership yet (new user); permissions refresh on token refresh
    let permissions: string[] = [];
    if (this.permissionResolver) {
      try {
        const resolved = await this.permissionResolver.resolveAccess(userId, demo?.companyId);
        permissions = resolved.permissions;
      } catch {
        // no active membership at login time → empty permissions; guards enforce at call time
      }
    }

    const now = Date.now();
    const expiresAt = demo?.expiresAt ?? new Date(now + REFRESH_EXPIRES_IN * 1000);
    if (expiresAt.getTime() <= now) throw new UnauthorizedException('Session expiry has passed.');
    const issuedAt = Math.floor(now / 1000);
    const accessExpiry = Math.min(issuedAt + ACCESS_EXPIRES_IN, expiresAt.getTime() / 1000);
    const refreshExpiry = Math.min(issuedAt + REFRESH_EXPIRES_IN, expiresAt.getTime() / 1000);
    const accessExpiresIn = Math.min(ACCESS_EXPIRES_IN, (expiresAt.getTime() - now) / 1000);
    // Absolute NumericDates keep signing across a clock-second boundary inside the cap.
    const accessToken = this.jwtService.sign({ ...basePayload, permissions, iat: issuedAt, exp: accessExpiry }, signOptions);
    const refreshToken = this.jwtService.sign(
      { ...basePayload, type: 'refresh', fid: familyId, iat: issuedAt, exp: refreshExpiry }, signOptions,
    );

    const sessionData = {
      userId,
      tokenId,
      familyId,
      expiresAt,
      status: 'ACTIVE' as const,
      ...(authProvider === 'watchdog' && credentialUpdatedAt instanceof Date
        ? { passwordCredentialVersion: credentialUpdatedAt }
        : {}),
    };
    if (demo) {
      await demo.tx.authSession.create({ data: sessionData });
      await demo.tx.auditLog.create({ data: {
        action: AuditAction.AUTH_LOGIN_EXCHANGE, actorUserId: userId, companyId: demo.companyId,
        targetType: 'auth_session', requestId: tokenId, result: 'SUCCESS', metadataJson: { authProvider },
      } });
    } else if (authProvider === 'email' && credentialUpdatedAt && !(credentialUpdatedAt instanceof Date) && 'reauthBinding' in credentialUpdatedAt) {
      // Caller holds account/membership locks and consumes the email proof in this transaction.
      await credentialUpdatedAt.tx.authSession.create({ data: { ...sessionData,
        emailReauthenticatedAt: credentialUpdatedAt.now, emailReauthBindingHash: credentialUpdatedAt.reauthBinding } });
    } else if (authProvider === 'watchdog' && credentialUpdatedAt instanceof Date) {
      await this.prisma.client.$transaction(async (tx) => {
        // Lock the credential snapshot verified by PasswordLoginUseCase until the session row
        // exists. A concurrent password change then either runs first (this rejects the stale
        // login) or runs second (and revokes the newly-created session).
        await tx.$queryRaw`SELECT "id" FROM "UserCredential" WHERE "userId" = ${userId} FOR UPDATE`;
        const currentCredential = await tx.userCredential.findUnique({
          where: { userId },
          select: { updatedAt: true },
        });
        if (!currentCredential || currentCredential.updatedAt.getTime() !== credentialUpdatedAt.getTime()) {
          throw new UnauthorizedException('Invalid username or password.');
        }
        await tx.authSession.create({ data: sessionData });
      });
    } else {
      await this.prisma.client.authSession.create({ data: sessionData });
    }

    // L-10: awaited. Post-commit AuditService.log never throws, so a login cannot 500 here.
    // tokenId is reused as the requestId correlation for auth events.
    if (this.audit && authProvider !== 'email' && authProvider !== 'demo') {
      await this.audit.log({
        action: AuditAction.AUTH_LOGIN_EXCHANGE,
        actorUserId: userId,
        targetType: 'auth_session',
        requestId: tokenId,
        result: 'SUCCESS',
        metadataJson: { authProvider },
      });
    }

    return { accessToken, refreshToken, expiresIn: accessExpiresIn };
  }
}
