// Pure decisions for the server-side session gates (login route, company/system layouts).
// Framework-free so they stay unit-testable; the callers own the cookie/fetch/redirect plumbing.
import { sanitizeNextPath } from './middleware.logic';
import type { WebSession } from '../models/web-session.model';

/** Platform-scope role: the only role allowed to render the /system/* shell. */
export const SYSTEM_ADMIN_ROLE = 'SYSTEM_ADMIN';

/** Outcome of GET /v1/auth/me, by status: signed_out and forbidden must never be conflated. */
export type AuthMeOutcome = 'signed_in' | 'signed_out' | 'forbidden' | 'unavailable';

/**
 * 401 is a rejected session (recoverable via refresh), 403 is a real authorization denial, and
 * anything else — 5xx, 404, a gateway error — is the auth service being unavailable. Unavailable
 * must stay distinct: treating it as signed_out is what turns an API outage into a login loop.
 */
export function mapAuthMeStatus(status: number): AuthMeOutcome {
  if (status === 401) return 'signed_out';
  if (status === 403) return 'forbidden';
  if (status >= 200 && status < 300) return 'signed_in';
  return 'unavailable';
}

export function isSystemAdmin(session: WebSession): boolean {
  return session.roles.includes(SYSTEM_ADMIN_ROLE);
}

// A landing target that lands back on /login (or on '/', which redirects to /login) would bounce
// the signed-in user straight back here — the redirect loop this gate exists to prevent.
function usableLanding(path: string | null): string | null {
  if (!path || path === '/') return null;
  return path === '/login' || path.startsWith('/login/') || path.startsWith('/login?') ? null : path;
}

// NextResponse.cookies.set percent-encodes values, so the home cookie is read back encoded.
function decodeCookie(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Where an authenticated visitor to /login goes: an explicit sanitized `next`, else the home path
 * remembered at login, else the session's own default landing. Returns null when no safe target
 * exists — the caller then renders the login form rather than redirecting into a loop.
 */
export function resolveLoginLanding(
  next: string | null | undefined,
  homeCookie: string | undefined,
  session: WebSession,
): string | null {
  const explicit = usableLanding(sanitizeNextPath(next));
  if (explicit) return explicit;

  const home = usableLanding(sanitizeNextPath(decodeCookie(homeCookie)));
  if (home) return home;

  if (isSystemAdmin(session)) return '/system/partners';
  return session.companyId ? `/companies/${session.companyId}/dashboard` : null;
}

/** Query marker that spends the login page's single silent-recovery attempt. */
export const RECOVERY_PARAM = 'recovered';

/** The refresh cookie is invisible to page requests, so recovery is attempted exactly once. */
export function shouldAttemptSessionRecovery(recoveredParam: string | null): boolean {
  return recoveredParam !== '1';
}

/**
 * Where the login page returns after a successful silent refresh: back through /login, so the
 * server route re-validates the rotated cookies and owns the landing decision. The marker bounds
 * this to one attempt — a browser that refuses to store the cookies gets the form, not a loop.
 */
export function recoveryReturnUrl(nextPath: string | null): string {
  const params = new URLSearchParams({ [RECOVERY_PARAM]: '1' });
  const safeNext = sanitizeNextPath(nextPath);
  if (safeNext) params.set('next', safeNext);
  return `/login?${params.toString()}`;
}

/**
 * Where the forced password change lands afterwards. Same sanitizer as every other post-auth
 * redirect — a protocol-relative or absolute `next` can never navigate off-origin — falling back
 * to the redirect path remembered at login, then the user's company dashboard.
 */
export function resolvePasswordChangeTarget(
  next: string | null | undefined,
  pendingRedirectPath: string | null | undefined,
  pendingCompanyId: string | null | undefined,
): string {
  const explicit = usableLanding(sanitizeNextPath(next));
  if (explicit) return explicit;

  const pending = usableLanding(sanitizeNextPath(pendingRedirectPath));
  if (pending) return pending;

  return pendingCompanyId ? `/companies/${pendingCompanyId}/dashboard` : '/';
}
