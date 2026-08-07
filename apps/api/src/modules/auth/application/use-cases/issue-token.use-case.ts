import { Inject, Injectable, InternalServerErrorException, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
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

  async execute(userId: string, authProvider: 'watchdog' | 'line' | 'dev' = 'dev'): Promise<AuthTokensResult> {
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
    const basePayload: Record<string, unknown> = { sub: userId, sid: tokenId, provider: authProvider };
    // L-04: iss/aud come from the same helper the verifiers use, and ride the JWT library's
    // sign options rather than hand-written payload keys, so sign and verify cannot drift.
    const { issuer, audience } = jwtClaimIdentity(this.config);
    const signOptions = { secret, algorithm: JWT_ALGORITHM, issuer, audience } as const;

    // ponytail: resolve permissions at issuance so AI Gateway can read claims without a DB call;
    // empty array if no membership yet (new user); permissions refresh on token refresh
    let permissions: string[] = [];
    if (this.permissionResolver) {
      try {
        const resolved = await this.permissionResolver.resolveAccess(userId);
        permissions = resolved.permissions;
      } catch {
        // no active membership at login time → empty permissions; guards enforce at call time
      }
    }

    const accessToken = this.jwtService.sign({ ...basePayload, permissions }, { ...signOptions, expiresIn: ACCESS_EXPIRES_IN });
    const refreshToken = this.jwtService.sign(
      { ...basePayload, type: 'refresh', fid: familyId },
      { ...signOptions, expiresIn: REFRESH_EXPIRES_IN },
    );

    const expiresAt = new Date(Date.now() + REFRESH_EXPIRES_IN * 1000);
    await this.prisma.client.authSession.create({
      data: { userId, tokenId, familyId, expiresAt, status: 'ACTIVE' },
    });

    // L-10: awaited. Post-commit AuditService.log never throws, so a login cannot 500 here.
    // tokenId is reused as the requestId correlation for auth events.
    if (this.audit) {
      await this.audit.log({
        action: AuditAction.AUTH_LOGIN_EXCHANGE,
        actorUserId: userId,
        targetType: 'auth_session',
        requestId: tokenId,
        result: 'SUCCESS',
        metadataJson: { authProvider },
      });
    }

    return { accessToken, refreshToken, expiresIn: ACCESS_EXPIRES_IN };
  }
}
