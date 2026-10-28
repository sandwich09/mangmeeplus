// Pure decisions for the server-side session gates (login route, company/system layouts).
// Framework-free so they stay unit-testable; the callers own the cookie/fetch/redirect plumbing.
import { EXECUTIVE_ROLE_KEYS } from '@watchdog-bms/contracts';
import { sanitizeNextPath } from './middleware.logic';
import type { WebSession } from '../models/web-session.model';

/** Platform-scope role: the only role allowed to render the /system/* shell. */
export const SYSTEM_ADMIN_ROLE = 'SYSTEM_ADMIN';

/** Outcome of GET /v1/auth/me, by status: signed_out and forbidden must never be conflated. */
export type AuthMeOutcome = 'signed_in' | 'signed_out' | 'forbidden' | 'platform_closed' | 'unavailable';

/**
 * 401 is a rejected session (recoverable via refresh), 403 is a real authorization denial, and
 * anything else — 5xx, 404, a gateway error — is the auth service being unavailable. Unavailable
 * must stay distinct: treating it as signed_out is what turns an API outage into a login loop.
 */
export function mapAuthMeStatus(status: number, code?: string): AuthMeOutcome {
  if (status === 401) return 'signed_out';
  if (status === 403) return 'forbidden';
  if (status === 503 && code === 'platform_access_closed') return 'platform_closed';
  if (status >= 200 && status < 300) return 'signed_in';
  return 'unavailable';
}

export function isSystemAdmin(session: WebSession): boolean {
  return session.roles.includes(SYSTEM_ADMIN_ROLE);
}

/** A server-confirmed free shop starts at its only ordinary module; all others keep the dashboard. */
export function defaultCompanyLandingPath(companyId: string, freeExpenseDrafts = false): string {
  return `/companies/${encodeURIComponent(companyId)}/${freeExpenseDrafts ? 'expenses' : 'dashboard'}`;
}

/** The มั่งมี sales console's landing path (spec §12). `/sales` itself only redirects here. */
export const SALES_HOME_PATH = '/sales/deals';

/** S07: `/sales` has its own shell, and one permission decides who may render it. */
export function canOpenSales(session: WebSession): boolean {
  return session.permissions.includes('sales.console.read');
}

/**
 * S29: `MANGMEE_SALES*` are memberships of the PLATFORM tenant, so without this a เซลล์ could open
 * that tenant's workspace — a business shell built for a shop, holding มั่งมี's own data. The two
 * roles carry nothing but `sales.*` and `account.*`, so "no business permission at all" is the
 * honest test: a SYSTEM_ADMIN (who also holds `sales.console.read`) keeps every shell they had.
 */
export function isSalesOnlySession(session: WebSession): boolean {
  return canOpenSales(session)
    && !isSystemAdmin(session)
    && session.permissions.every((key) => key.startsWith('sales.') || key.startsWith('account.'));
}

/** Preserve a `/sales` deep link through every authentication gate (mirrors the /system one). */
export function salesGateReturnPath(requestedPath: string | null | undefined): string {
  const sanitized = usablePostAcceptanceLanding(sanitizeNextPath(requestedPath));
  return sanitized?.startsWith('/sales') ? sanitized : SALES_HOME_PATH;
}

/** Billing delegates may enter only the billing subtree; the API verifies system-role and company scope. */
export function canOpenSystemBilling(session: WebSession, path: string): boolean {
  const pathname = sanitizeNextPath(path)?.split(/[?#]/)[0];
  return Boolean(pathname && (pathname === '/system/billing' || pathname.startsWith('/system/billing/'))) && session.permissions.includes('system.billing.read');
}

export const EXECUTIVE_HOME_PATH = '/system/executive';
export function canOpenSystemExecutive(session: WebSession, path: string): boolean {
  const pathname = sanitizeNextPath(path)?.split(/[?#]/)[0];
  return Boolean(pathname && (pathname === EXECUTIVE_HOME_PATH || pathname.startsWith(`${EXECUTIVE_HOME_PATH}/`)))
    && session.permissions.includes('system.executive.read');
}
/** Any executive role (read, export, contacts) or report permission, and nothing beyond the report and the own account. */
export function isExecutiveOnlySession(session: WebSession): boolean {
  return (session.roles.some(role => (EXECUTIVE_ROLE_KEYS as readonly string[]).includes(role)) || session.permissions.some(key => key.startsWith('system.executive.')))
    && !isSystemAdmin(session) && session.permissions.every(key => key.startsWith('system.executive.') || key.startsWith('account.'));
}

// A landing target that lands back on /login (or on '/', which redirects to /login) would bounce
// the signed-in user straight back here — the redirect loop this gate exists to prevent.
function usableLanding(path: string | null): string | null {
  if (!path || path === '/') return null;
  return path === '/login' || path.startsWith('/login/') || path.startsWith('/login?') ? null : path;
}

/** A target that is safe and meaningful after the one-time legal gate is complete. */
function usablePostAcceptanceLanding(path: string | null): string | null {
  const usable = usableLanding(path);
  if (!usable) return null;
  if (
    usable === '/legal-acceptance' ||
    usable.startsWith('/legal-acceptance/') ||
    usable.startsWith('/legal-acceptance?') ||
    usable === '/change-password' ||
    usable.startsWith('/change-password?')
  ) return null;
  return usable;
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
  const home = usableLanding(sanitizeNextPath(decodeCookie(homeCookie)));
  const freeExpenseHome = session.freeExpenseDrafts && session.companyId
    ? defaultCompanyLandingPath(session.companyId, true)
    : null;
  const savedFreeLanding = freeExpenseHome && home
    ? (home === freeExpenseHome || home.startsWith(`${freeExpenseHome}/`) || home.startsWith(`/companies/${encodeURIComponent(session.companyId)}/billing`)
      ? home : freeExpenseHome)
    : freeExpenseHome;
  // S07/S29: a sales-only session owns exactly one area. Its remembered home is the platform
  // tenant's dashboard (the login BFF derives it from `companyId`), and following that would land
  // it on a workspace the shell immediately bounces — so anything outside /sales is dropped here.
  const landing = isExecutiveOnlySession(session)
    ? [explicit, home].find(path => path && canOpenSystemExecutive(session, path)) ?? EXECUTIVE_HOME_PATH
    : isSalesOnlySession(session)
    ? [explicit, home].find((path) => path?.startsWith('/sales')) ?? SALES_HOME_PATH
    : explicit
      ?? savedFreeLanding
      ?? home
      ?? (isSystemAdmin(session)
        ? '/system/partners'
        : session.companyId
          ? defaultCompanyLandingPath(session.companyId)
          : null);

  // Only an explicit false from the current API proves the clickwrap is current. Missing fields
  // during a rolling deployment fail closed into the gate instead of bypassing it.
  if (session.legalAcceptanceRequired === false) return landing;
  // A direct recovery back to the gate is already correct; wrapping it again would grow a nested
  // `next=/legal-acceptance?...` query on every pass.
  if (explicit?.startsWith('/legal-acceptance')) return explicit;
  return legalAcceptancePath(landing, session.companyId);
}

/** Build the post-auth legal gate URL while retaining only a same-app business destination. */
export function legalAcceptanceContextCompanyId(
  next: string | null | undefined,
  fallbackCompanyId?: string | null,
): string | null {
  const sanitized = sanitizeNextPath(next);
  const match = sanitized?.match(/^\/companies\/([^/?#]+)/);
  if (match) {
    try {
      const companyId = decodeURIComponent(match[1]);
      if (/^[A-Za-z0-9_-]{1,128}$/.test(companyId)) return companyId;
    } catch {
      // Invalid percent encoding is not a usable company context.
    }
  }
  return fallbackCompanyId && /^[A-Za-z0-9_-]{1,128}$/.test(fallbackCompanyId)
    ? fallbackCompanyId
    : null;
}

export function legalAcceptancePath(
  next: string | null | undefined,
  fallbackCompanyId?: string | null,
): string {
  const sanitized = sanitizeNextPath(next);
  // Middleware can send a cookie-less visitor to `/login?next=/legal-acceptance?next=…`.
  // Preserve that already-safe gate URL after sign-in instead of discarding its nested business
  // destination or wrapping it into an ever-growing acceptance loop.
  if (
    sanitized === '/legal-acceptance'
    || sanitized?.startsWith('/legal-acceptance?')
    || sanitized?.startsWith('/legal-acceptance/')
  ) return sanitized;
  const safeNext = usablePostAcceptanceLanding(sanitized);
  const companyId = legalAcceptanceContextCompanyId(safeNext, fallbackCompanyId);
  const params = new URLSearchParams();
  if (companyId) params.set('companyId', companyId);
  if (safeNext) params.set('next', safeNext);
  const query = params.toString();
  return query ? `/legal-acceptance?${query}` : '/legal-acceptance';
}

/** Resolve the destination after acceptance without permitting an open redirect or gate loop. */
export function resolvePostLegalAcceptanceTarget(
  next: string | null | undefined,
  session: WebSession,
): string {
  const explicit = usablePostAcceptanceLanding(sanitizeNextPath(next));
  if (isExecutiveOnlySession(session)) return explicit && canOpenSystemExecutive(session, explicit) ? explicit : EXECUTIVE_HOME_PATH;
  if (isSalesOnlySession(session)) return explicit?.startsWith('/sales') ? explicit : SALES_HOME_PATH;
  if (session.freeExpenseDrafts && session.companyId && explicit) {
    const companyBase = `/companies/${encodeURIComponent(session.companyId)}`;
    if (explicit === `${companyBase}/dashboard` || explicit === `${companyBase}/renew`) {
      return defaultCompanyLandingPath(session.companyId, true);
    }
  }
  if (explicit) return explicit;
  if (isSystemAdmin(session)) return '/system/partners';
  return session.companyId ? defaultCompanyLandingPath(session.companyId, session.freeExpenseDrafts === true) : '/';
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

/**
 * Where the change-password and legal-acceptance gates should return a company visitor. The
 * requested path wins so a LINE deep link survives the round trip; anything outside this company —
 * a missing header, another tenant, a gate page itself — falls back to the dashboard.
 */
export function companyGateReturnPath(requestedPath: string | null | undefined, companyId: string): string {
  const dashboard = `/companies/${companyId}/dashboard`;
  const sanitized = usablePostAcceptanceLanding(sanitizeNextPath(requestedPath));
  return sanitized?.startsWith(`/companies/${companyId}/`) ? sanitized : dashboard;
}

/** Preserve the proxy's system deep link through every authentication gate. */
export function systemGateReturnPath(requestedPath: string | null | undefined): string {
  const sanitized = usablePostAcceptanceLanding(sanitizeNextPath(requestedPath));
  return sanitized?.startsWith('/system/') ? sanitized : '/system/partners';
}
