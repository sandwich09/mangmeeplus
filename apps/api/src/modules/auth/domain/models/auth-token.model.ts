export type AuthToken = {
  token: string;
  expiresAt: Date;
};

// L-05: `sid` is required on every verify-side payload. Modelling it as optional is what
// let the guard skip the session lookup, so a token without it bypassed revocation.
export type DevJwtPayload = {
  sub: string;
  sid: string;
  type?: 'refresh';
  iat?: number;
  exp?: number;
};

export type WatchdogJwtPayload = {
  sub: string;
  sid: string;
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  demoCompanyId?: string;
  type?: 'refresh';
};

// Payload for JWTs issued by IssueTokenUseCase (both access and refresh)
export type WatchdogIssuedJwtPayload = {
  sub: string;           // internal userId
  sid: string;           // AuthSession.tokenId (UUID)
  iss?: string;
  aud?: string | string[];
  exp: number;
  iat?: number;
  demoCompanyId?: string;
  type?: 'refresh';      // present only on refresh tokens
  // L-01: AuthSession.familyId — refresh tokens only, and absent on tokens issued before L-01.
  // It survives rotation so a retired token id can still be traced to its (live) family.
  fid?: string;
  permissions?: string[]; // present only on access tokens; AI Gateway reads this claim
};
