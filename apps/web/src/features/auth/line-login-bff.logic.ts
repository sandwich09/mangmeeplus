// Server-only helpers for the LINE web-login BFF routes (OAuth Authorization Code + PKCE).
// Pure functions, no Next imports — the route handlers own request/response and cookies.
import { createHash, randomBytes } from 'node:crypto';

/** Short-lived HttpOnly transaction cookie; scoped so it is sent only to the two BFF routes. */
export const LINE_LOGIN_TXN_COOKIE = 'watchdog_line_txn';
export const LINE_LOGIN_TXN_COOKIE_PATH = '/api/auth/line-login';

/** P12-3a: the desktop's half of a QR login transaction. HttpOnly and path-scoped to the two QR
 *  routes, so page scripts can never read it and it is not sent anywhere else. Its lifetime is the
 *  QR TTL plus a small margin — the API row expires on its own schedule regardless. */
export const LINE_QR_SECRET_COOKIE = 'watchdog_line_qr_secret';
export const LINE_QR_SECRET_COOKIE_PATH = '/api/auth/line-qr';
export const LINE_QR_SECRET_COOKIE_MAX_AGE = 200;

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
    // P10 §4F: puts the add-friend checkbox on LINE's own consent screen, so linking and following
    // the OA are one step instead of two. 'normal' asks; it never adds the friend without consent.
    bot_prompt: 'normal',
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
