import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { IJwtVerifier } from '../domain/ports/jwt-verifier.port';
import type { WatchdogJwtPayload } from '../domain/models/auth-token.model';
import { JWT_ALGORITHM, jwtClaimIdentity } from '../domain/logic/jwt-claims.logic';

@Injectable()
export class WatchdogJwtVerifierAdapter implements IJwtVerifier {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async verify(token: string) { return this.verifyClaims(token); }

  /** Used only to return 410, never to authorize a request. */
  async verifyDemoExpiry(token: string) {
    const identity = await this.verifyClaims(token, true);
    if (identity.provider !== 'demo' || !identity.demoCompanyId) throw new UnauthorizedException();
    return identity;
  }

  private async verifyClaims(token: string, ignoreExpiration = false): Promise<{ subject: string; tokenId: string; provider?: string; demoCompanyId?: string }> {
    const secret = this.config.authJwtSecret;
    if (!secret) {
      throw new UnauthorizedException('WatchDog JWT secret is not configured.');
    }

    // L-04: algorithm, issuer and audience are all pinned; the defaults keep issuer/audience
    // from degrading to an unchecked claim when the env vars are absent.
    const { issuer, audience } = jwtClaimIdentity(this.config);

    try {
      const payload = await this.jwtService.verifyAsync<WatchdogJwtPayload & { provider?: string; demoCompanyId?: string }>(token, {
        secret,
        algorithms: [JWT_ALGORITHM],
        issuer,
        audience,
        ignoreExpiration,
      });
      if (payload.type === 'refresh') {
        throw new UnauthorizedException('Refresh token cannot authorize requests.');
      }
      // L-05: `sid` is required. Without it the guard's session lookup would be skipped and
      // the token would outlive logout, revoke-others and the reset sweep.
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || payload.sid.length === 0) {
        throw new UnauthorizedException('Token is missing required claims.');
      }
      return {
        subject: payload.sub,
        tokenId: payload.sid,
        ...(typeof payload.demoCompanyId === 'string' ? { demoCompanyId: payload.demoCompanyId } : {}),
        ...(typeof payload.provider === 'string' ? { provider: payload.provider } : {}),
      };
    } catch {
      throw new UnauthorizedException('Invalid WatchDog JWT.');
    }
  }
}
