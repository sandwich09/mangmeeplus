import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { DEFAULT_JWT_AUDIENCE, DEFAULT_JWT_ISSUER } from '@watchdog-bms/config';
import { AiGatewayConfigService } from '../common/config/ai-gateway-config.service';

export type VerifiedContext = {
  userId: string;
  sessionId: string;
  permissions: string[];
};

@Injectable()
export class WatchdogContextVerifier {
  constructor(private readonly config: AiGatewayConfigService) {}

  verify(token: string): VerifiedContext {
    const secret = this.config.jwtSecret;
    if (!secret) {
      throw new UnauthorizedException('JWT secret is not configured.');
    }

    // L-04: algorithm pinned, and iss/aud always checked — the shared non-secret defaults
    // keep the check from degrading to "unset means skip" when the env vars are absent.
    const options: jwt.VerifyOptions = {
      clockTolerance: this.config.jwtClockToleranceSeconds,
      algorithms: ['HS256'],
      issuer: this.config.jwtIssuer ?? DEFAULT_JWT_ISSUER,
      audience: this.config.jwtAudience ?? DEFAULT_JWT_AUDIENCE,
    };

    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, secret, options) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token.');
    }

    if (payload['type'] === 'refresh') {
      throw new UnauthorizedException('Refresh token cannot authorize requests.');
    }

    const userId = payload['sub'];
    const sessionId = payload['sid'];
    if (typeof userId !== 'string' || typeof sessionId !== 'string') {
      throw new UnauthorizedException('Token missing required claims.');
    }

    const permissions = Array.isArray(payload['permissions']) ? (payload['permissions'] as string[]) : [];

    return { userId, sessionId, permissions };
  }
}
