// Cookie names shared by the BFF route handlers, middleware, and browser client.
// Pure constants only — this file must stay importable from client, server, and middleware code.

/** httpOnly access-token cookie; must match ACCESS_TOKEN_COOKIE on the API (auth-cookie.constants.ts). */
export const ACCESS_TOKEN_COOKIE = 'watchdog_token';

/** httpOnly refresh-token cookie, path-scoped to the BFF auth endpoints only. */
export const REFRESH_TOKEN_COOKIE = 'watchdog_refresh';

/** JS-readable double-submit CSRF cookie; echoed back via the CSRF header on mutations. */
export const CSRF_COOKIE = 'watchdog_csrf';

/** httpOnly cookie holding the user's home path (redirect target for /login when already signed in). */
export const HOME_PATH_COOKIE = 'watchdog_home';

/** httpOnly cookie remembering the "remember me" choice ('1' persistent / '0' session-scoped); path-scoped like the refresh cookie. */
export const PERSIST_COOKIE = 'watchdog_persist';

export const CSRF_HEADER = 'x-csrf-token';
/** Requested path+query, published by the proxy so server components can read the real URL. */
export const REQUEST_PATH_HEADER = 'x-request-path';

/**
 * Stable code on the middleware's CSRF rejection. It marks the one 403 the browser client may
 * self-recover from (valid session, missing/stale double-submit cookie) — business permission
 * 403s carry no code and are never retried.
 */
export const CSRF_ERROR_CODE = 'csrf_token_invalid';

/** Refresh cookie is only sent to the BFF auth routes, never on data requests. */
export const REFRESH_COOKIE_PATH = '/api/auth';

/** Mirrors REFRESH_EXPIRES_IN on the API (issue-token.use-case.ts). */
export const REFRESH_TOKEN_MAX_AGE_SECONDS = 7 * 24 * 3600;

// The access JWT embeds the permission list and can exceed the 4096-byte per-cookie
// browser limit (an OWNER token is ~9.4 KB). Values above CHUNK_SIZE are stored as
// `<name>.0`, `<name>.1`, … and re-joined by every server-side reader.
export const COOKIE_CHUNK_SIZE = 3500;
export const MAX_COOKIE_CHUNKS = 6;

export function splitCookieValue(value: string, chunkSize = COOKIE_CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }
  return chunks;
}

/** Rebuild a possibly-chunked cookie value; single unchunked cookie wins when present. */
export function joinCookieChunks(
  getCookie: (name: string) => string | undefined,
  name: string,
  maxChunks = MAX_COOKIE_CHUNKS,
): string | undefined {
  const whole = getCookie(name);
  if (whole) return whole;
  let joined = '';
  for (let i = 0; i < maxChunks; i += 1) {
    const part = getCookie(`${name}.${i}`);
    if (!part) break;
    joined += part;
  }
  return joined.length > 0 ? joined : undefined;
}
