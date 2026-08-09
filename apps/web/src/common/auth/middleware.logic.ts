// Pure request-guard decisions used by middleware.ts — kept framework-free so they are unit-testable.

const MUTATING_METHOD = /^(POST|PUT|PATCH|DELETE)$/i;

/** Pages that require a signed-in session cookie. */
export function isProtectedPagePath(pathname: string): boolean {
  return pathname === '/legal-acceptance'
    || pathname.startsWith('/legal-acceptance/')
    || pathname.startsWith('/companies/')
    || pathname === '/system'
    || pathname.startsWith('/system/');
}

/** Only same-origin (or non-browser) requests may mutate through the BFF. */
export function isSameOriginRequest(
  originHeader: string | null,
  secFetchSite: string | null,
  effectiveHost: string | null,
): boolean {
  if (originHeader) {
    try {
      return new URL(originHeader).host === effectiveHost;
    } catch {
      return false;
    }
  }
  if (secFetchSite) {
    return secFetchSite === 'same-origin' || secFetchSite === 'none';
  }
  // No Origin and no Sec-Fetch-Site → not a cross-site browser request
  // (browsers always send at least one on cross-site mutations).
  return true;
}

/**
 * Double-submit CSRF applies to mutating data calls that carry the ambient session cookie.
 * Bearer-only automation (no cookie) has no ambient credential, so no CSRF exposure.
 */
export function requiresCsrfCheck(method: string, pathname: string, hasAccessCookie: boolean): boolean {
  if (!MUTATING_METHOD.test(method)) return false;
  if (!pathname.startsWith('/api/v1/')) return false;
  return hasAccessCookie;
}

/**
 * L-07: constant-time double-submit compare. This runs in the Next middleware (Edge) runtime,
 * where `node:crypto.timingSafeEqual` is not reliably available, so the compare is a pure
 * accumulate-then-test loop with no early return: a mismatched length is folded into the same
 * accumulator and still walks the whole cookie, so neither equality nor length leaks through
 * timing. The loop length depends only on the server-issued cookie, never on attacker input.
 */
export function isCsrfTokenValid(csrfCookie: string | undefined, csrfHeader: string | null): boolean {
  // An absent credential is not a comparison — there is no secret to leak here.
  if (!csrfCookie || !csrfHeader) return false;
  let diff = csrfCookie.length ^ csrfHeader.length;
  for (let i = 0; i < csrfCookie.length; i += 1) {
    diff |= csrfCookie.charCodeAt(i) ^ csrfHeader.charCodeAt(i % csrfHeader.length);
  }
  return diff === 0;
}

/** Sanitize a post-login redirect target: same-app absolute paths only. */
export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Browsers treat backslashes as path separators and strip TAB/LF/CR before URL parsing; values
  // such as `/\t/evil.example` can therefore become an off-origin protocol-relative URL.
  if (!raw.startsWith('/') || /[\u0000-\u001F\u007F\\]/.test(raw)) return null;
  try {
    const base = 'https://mangmeeplus.invalid';
    const parsed = new URL(raw, base);
    if (parsed.origin !== base) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
