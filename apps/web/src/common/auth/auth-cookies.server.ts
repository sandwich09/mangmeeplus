// Server-only helpers: set/clear the auth cookies on a BFF NextResponse.
// Single source of truth for cookie attributes — never set auth cookies anywhere else.
import type { NextResponse } from 'next/server';
import {
  ACCESS_TOKEN_COOKIE,
  CSRF_COOKIE,
  HOME_PATH_COOKIE,
  MAX_COOKIE_CHUNKS,
  PERSIST_COOKIE,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_MAX_AGE_SECONDS,
  splitCookieValue,
} from './auth-cookies.constants';

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  /** access token TTL in seconds (API returns 900) */
  expiresIn: number;
};

// Secure requires HTTPS. The local Docker stack runs a production Next build served
// over plain http://localhost, where Safari drops Secure cookies — so gate on APP_ENV,
// not the build mode. AUTH_COOKIE_SECURE overrides explicitly when needed.
const SECURE =
  process.env['AUTH_COOKIE_SECURE'] != null
    ? process.env['AUTH_COOKIE_SECURE'] === 'true'
    : process.env.NODE_ENV === 'production' && process.env['APP_ENV'] !== 'local';

function httpOnlyFlags() {
  return { httpOnly: true, secure: SECURE, sameSite: 'lax' as const };
}

export function generateCsrfToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

// The access JWT exceeds the 4 KB per-cookie browser limit for permission-rich users,
// so it is chunked into watchdog_token.0..N; stale chunk slots are always cleared.
function setChunkedAccessCookie(res: NextResponse, value: string, maxAge: number | undefined): void {
  const chunks = splitCookieValue(value);
  const flags = { ...httpOnlyFlags(), path: '/' };
  const life = maxAge !== undefined ? { maxAge } : {};
  if (chunks.length === 1) {
    res.cookies.set(ACCESS_TOKEN_COOKIE, value, { ...flags, ...life });
  } else {
    res.cookies.set(ACCESS_TOKEN_COOKIE, '', { ...flags, maxAge: 0 });
    chunks.forEach((chunk, index) => {
      res.cookies.set(`${ACCESS_TOKEN_COOKIE}.${index}`, chunk, { ...flags, ...life });
    });
  }
  for (let i = chunks.length === 1 ? 0 : chunks.length; i < MAX_COOKIE_CHUNKS; i += 1) {
    res.cookies.set(`${ACCESS_TOKEN_COOKIE}.${i}`, '', { ...flags, maxAge: 0 });
  }
}

export function setAuthCookies(
  res: NextResponse,
  tokens: AuthTokens,
  opts?: { csrfToken?: string; homePath?: string; persistent?: boolean },
): void {
  // "จดจำการเข้าสู่ระบบ" unchecked → session cookies (no maxAge): the browser drops
  // them when it closes. PERSIST_COOKIE remembers the choice so refresh rotation
  // keeps the same lifetime.
  const persistent = opts?.persistent ?? true;
  const life = (seconds: number) => (persistent ? { maxAge: seconds } : {});
  setChunkedAccessCookie(res, tokens.accessToken, persistent ? tokens.expiresIn : undefined);
  res.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...httpOnlyFlags(),
    path: REFRESH_COOKIE_PATH,
    ...life(REFRESH_TOKEN_MAX_AGE_SECONDS),
  });
  res.cookies.set(PERSIST_COOKIE, persistent ? '1' : '0', {
    ...httpOnlyFlags(),
    path: REFRESH_COOKIE_PATH,
    ...life(REFRESH_TOKEN_MAX_AGE_SECONDS),
  });
  if (opts?.csrfToken) {
    // Double-submit token: intentionally NOT httpOnly — the client echoes it in the CSRF header.
    res.cookies.set(CSRF_COOKIE, opts.csrfToken, {
      httpOnly: false,
      secure: SECURE,
      sameSite: 'lax',
      path: '/',
      ...life(REFRESH_TOKEN_MAX_AGE_SECONDS),
    });
  }
  if (opts?.homePath) {
    res.cookies.set(HOME_PATH_COOKIE, opts.homePath, {
      ...httpOnlyFlags(),
      path: '/',
      ...life(REFRESH_TOKEN_MAX_AGE_SECONDS),
    });
  }
}

export function clearAuthCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_TOKEN_COOKIE, '', { ...httpOnlyFlags(), path: '/', maxAge: 0 });
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i += 1) {
    res.cookies.set(`${ACCESS_TOKEN_COOKIE}.${i}`, '', { ...httpOnlyFlags(), path: '/', maxAge: 0 });
  }
  res.cookies.set(REFRESH_TOKEN_COOKIE, '', { ...httpOnlyFlags(), path: REFRESH_COOKIE_PATH, maxAge: 0 });
  res.cookies.set(PERSIST_COOKIE, '', { ...httpOnlyFlags(), path: REFRESH_COOKIE_PATH, maxAge: 0 });
  res.cookies.set(CSRF_COOKIE, '', { httpOnly: false, secure: SECURE, sameSite: 'lax', path: '/', maxAge: 0 });
  res.cookies.set(HOME_PATH_COOKIE, '', { ...httpOnlyFlags(), path: '/', maxAge: 0 });
}

/** Default post-login landing path when the API response does not provide one. */
export function resolveHomePath(redirectPath: string | null | undefined, companyId: string | null | undefined): string {
  if (redirectPath && redirectPath.startsWith('/')) return redirectPath;
  if (companyId) return `/companies/${companyId}/dashboard`;
  return '/';
}
