// Single source of truth for the browser session cookie name.
// The web BFF (apps/web) sets this cookie; AuthGuard and sid extraction read it.
export const ACCESS_TOKEN_COOKIE = 'watchdog_token';

// The access JWT embeds permissions and can exceed the 4 KB per-cookie browser limit,
// so the web BFF chunks it into `watchdog_token.0..N` (apps/web auth-cookies.constants.ts).
const MAX_COOKIE_CHUNKS = 6;

/** Rebuild the access token from a parsed cookie record; unchunked value wins when present. */
export function accessTokenFromCookies(cookies: Record<string, unknown> | undefined): string | undefined {
  if (!cookies) return undefined;
  const whole = cookies[ACCESS_TOKEN_COOKIE];
  if (typeof whole === 'string' && whole.length > 0) return whole;
  let joined = '';
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i += 1) {
    const part = cookies[`${ACCESS_TOKEN_COOKIE}.${i}`];
    if (typeof part !== 'string' || part.length === 0) break;
    joined += part;
  }
  return joined.length > 0 ? joined : undefined;
}
