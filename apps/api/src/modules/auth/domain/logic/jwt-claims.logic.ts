import { DEFAULT_JWT_AUDIENCE, DEFAULT_JWT_ISSUER } from '@watchdog-bms/config';

/**
 * L-04: the only algorithm this service ever signs or verifies with. Pinned at every
 * verify site so a token claiming `none` (or any asymmetric alg) can never be accepted.
 */
export const JWT_ALGORITHM = 'HS256';

type JwtIdentityConfig = {
  watchdogJwtIssuer?: string | undefined;
  watchdogJwtAudience?: string | undefined;
};

/**
 * L-04: single source of `iss`/`aud` for both the sign and the verify side, so the two
 * cannot drift. Falling back to the shared non-secret defaults keeps the check from
 * silently degrading to "unset means skip" outside production; production still
 * requires explicit WATCHDOG_JWT_ISSUER / WATCHDOG_JWT_AUDIENCE at config boot.
 */
export function jwtClaimIdentity(config: JwtIdentityConfig): { issuer: string; audience: string } {
  return {
    issuer: config.watchdogJwtIssuer ?? DEFAULT_JWT_ISSUER,
    audience: config.watchdogJwtAudience ?? DEFAULT_JWT_AUDIENCE,
  };
}
