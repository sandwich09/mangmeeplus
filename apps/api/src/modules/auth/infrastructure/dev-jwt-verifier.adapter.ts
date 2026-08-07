import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../../common/config/app-config.service';
import type { IJwtVerifier } from '../domain/ports/jwt-verifier.port';
import type { DevJwtPayload } from '../domain/models/auth-token.model';
import { JWT_ALGORITHM, jwtClaimIdentity } from '../domain/logic/jwt-claims.logic';

// ponytail: only instantiated when APP_ENV=local; guard check is the enforcement boundary
@Injectable()
export class DevJwtVerifierAdapter implements IJwtVerifier {
  constructor(
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async verify(token: string): Promise<{ subject: string; tokenId: string }> {
    if (this.config.isProduction) {
      throw new UnauthorizedException('Dev auth is not allowed outside local environment.');
    }

    const secret = this.config.devAuthSecret;
    if (!secret) {
      throw new UnauthorizedException('DEV_AUTH_SECRET is not configured.');
    }

    // L-04: same pinning as the production verifier — dev tokens are minted by
    // IssueTokenUseCase, which signs iss/aud from this identical source.
    const { issuer, audience } = jwtClaimIdentity(this.config);

    try {
      const payload = await this.jwtService.verifyAsync<DevJwtPayload>(token, {
        secret,
        algorithms: [JWT_ALGORITHM],
        issuer,
        audience,
      });
      if (payload.type === 'refresh') {
        throw new UnauthorizedException('Refresh token cannot authorize requests.');
      }
      // L-05: `sid` is required here too; the guard must never receive a session-less token.
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || payload.sid.length === 0) {
        throw new UnauthorizedException('Token is missing required claims.');
      }
      return { subject: payload.sub, tokenId: payload.sid };
    } catch {
      throw new UnauthorizedException('Invalid dev JWT.');
    }
  }
}
