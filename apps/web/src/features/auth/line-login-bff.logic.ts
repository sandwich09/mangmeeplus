// Server-only helpers for the LINE web-login BFF routes (OAuth Authorization Code + PKCE).
// Pure functions, no Next imports — the route handlers own request/response and cookies.
import { createHash, randomBytes } from 'node:crypto';

/** Short-lived HttpOnly transaction cookie; scoped so it is sent only to the two BFF routes. */
export const LINE_LOGIN_TXN_COOKIE = 'watchdog_line_txn';
export const LINE_LOGIN_TXN_COOKIE_PATH = '/api/auth/line-login';

export function randomUrlToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function pkceChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function buildLineAuthorizeUrl(input: {
  channelId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.channelId,
    redirect_uri: input.redirectUri,
    state: input.state,
    scope: 'openid profile',
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

/** Same-app relative paths only: no scheme, no protocol-relative, bounded length. */
export function sanitizeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

export interface LineLoginTxn { state: string; nonce: string; verifier: string; returnTo?: string }

export function encodeLineLoginTxn(txn: LineLoginTxn): string {
  return Buffer.from(JSON.stringify(txn), 'utf8').toString('base64url');
}

export function decodeLineLoginTxn(raw: string | undefined): LineLoginTxn | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as LineLoginTxn;
    if (typeof parsed.state !== 'string' || typeof parsed.nonce !== 'string' || typeof parsed.verifier !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Public origin as the browser sees it (ALB forwards proto/host). */
export function publicOriginFromHeaders(headers: { get(name: string): string | null }, fallbackOrigin: string): string {
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const host = (headers.get('x-forwarded-host') ?? headers.get('host'))?.split(',')[0]?.trim();
  if (proto && host) return `${proto}://${host}`;
  return fallbackOrigin;
}
