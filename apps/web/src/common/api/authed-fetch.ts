// Shared browser client for the httpOnly-cookie session model.
// - Always same-origin (`/api/v1/*` → Next rewrite → ERP API) with cookies attached.
// - Adds the double-submit CSRF header on mutations.
// - On 401: refreshes the session once (single-flight across concurrent calls) and retries;
//   a second 401 redirects to /login with the current path as `next` — but only when the refresh
//   itself proved the session is gone, never when it failed for a transient reason.
// - On the middleware's CSRF 403 only: refreshes once (which reissues the double-submit cookie)
//   and retries once. Business permission 403s are never retried.
import { CSRF_COOKIE, CSRF_ERROR_CODE, CSRF_HEADER } from '../auth/auth-cookies.constants';
import { legalAcceptancePath } from '../auth/session-gate.logic';
import { emitApiErrorToast } from '../feedback/toast-bus';
import { ApiError } from '../models/api-error.model';
import { isBillingCustomerRecoveryPath } from '@watchdog-bms/contracts';

const API_PREFIX = '/api/v1';
const REFRESH_ENDPOINT = '/api/auth/refresh';
/** The BFF refresh route's success status. */
const REFRESH_ROTATED = 204;
const MUTATING_METHOD = /^(POST|PUT|PATCH|DELETE)$/i;
const LEGAL_ACCEPTANCE_REQUIRED_CODE = 'legal_acceptance_required';
/** P29: the company's usage term ended, so every business route is refused until it is renewed. */
const COMPANY_TERM_EXPIRED_CODE = 'company_term_expired';
export const ACCESS_CONTEXT_STALE_EVENT = 'watchdog:access-context-stale';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type AuthedInit = RequestInit & { suppressErrorToast?: boolean };

const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export function readCookieValue(cookieString: string, name: string): string | null {
  for (const part of cookieString.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function csrfTokenFromDocument(): string | null {
  if (typeof document === 'undefined') return null;
  return readCookieValue(document.cookie, CSRF_COOKIE);
}

// Some legacy call sites pass paths that already include the API version prefix.
function normalizePath(path: string): string {
  return path.startsWith('/v1/') ? path.slice(3) : path;
}

type RefreshResult = { response: Response | null; cause?: unknown };

let refreshInFlight: Promise<RefreshResult> | null = null;

function networkError(cause: unknown): ApiError {
  return new ApiError({ kind: 'network_error', message: 'Network request failed.', cause });
}

// Refresh rotates the server session (old sid dies), so concurrent 401s must share one attempt.
// Keeps the response/cause because *why* a refresh failed decides what the caller may show:
// 204 rotated, 401 the session is gone, and 5xx/network is a transient transport failure.
function refreshSession(fetchImpl: FetchLike): Promise<RefreshResult> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetchImpl(REFRESH_ENDPOINT, {
        method: 'POST',
        credentials: 'include',
        headers: buildCsrfHeader(),
      });
      return { response: res };
    } catch (cause) {
      return { response: null, cause };
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

function buildCsrfHeader(): Record<string, string> {
  const csrf = csrfTokenFromDocument();
  return csrf ? { [CSRF_HEADER]: csrf } : {};
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname === '/login' || pathname === '/change-password') return;
  window.location.assign(`/login?next=${encodeURIComponent(pathname + search)}`);
}

function redirectToLegalAcceptance(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (pathname === '/legal-acceptance' || pathname.startsWith('/legal-acceptance/')) return;
  window.location.assign(legalAcceptancePath(pathname + search));
}

async function rejectionCode(res: Response): Promise<string | null> {
  if (res.status !== 403) return null;
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return typeof body.code === 'string' ? body.code : null;
  } catch {
    return null;
  }
}

// Same shape as the legal-acceptance gate: a stable code, not a translated sentence, so every raw
// and JSON call routes out consistently instead of each screen inventing its own dead end.
function redirectToCompanyRenewal(): void {
  if (typeof window === 'undefined') return;
  const { pathname } = window.location;
  const companyId = /^\/companies\/([^/]+)/.exec(pathname)?.[1];
  if (!companyId || pathname.startsWith(`/companies/${companyId}/renew`)) return;
  // Incidental workspace reads may expire while the owner is already on a recovery-safe page.
  // Return the business denial, but keep the purchase/Checkout return/document route usable.
  if (isBillingCustomerRecoveryPath(pathname, decodeURIComponent(companyId))) return;
  window.location.assign(`/companies/${companyId}/renew`);
}

// The stable code is emitted only by the middleware CSRF gate — a valid session whose double-submit
// cookie went missing or stale. Any other 403 (permission, entitlement, cross-origin) is a real
// denial and is returned untouched, so recovery can never mask a business rule.
async function isRecoverableCsrfRejection(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return body.code === CSRF_ERROR_CODE;
  } catch {
    return false;
  }
}

export async function authedFetch(path: string, init?: RequestInit, fetchImpl: FetchLike = defaultFetch): Promise<Response> {
  const url = `${API_PREFIX}${normalizePath(path)}`;
  const method = (init?.method ?? 'GET').toUpperCase();

  const exec = async () => {
    const headers: Record<string, string> = {
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
      ...(MUTATING_METHOD.test(method) ? buildCsrfHeader() : {}),
    };
    try {
      return await fetchImpl(url, { ...init, headers, credentials: 'include' });
    } catch (cause) {
      throw networkError(cause);
    }
  };

  let res = await exec();
  if (res.status === 401) {
    const refresh = await refreshSession(fetchImpl);
    const refreshStatus = refresh.response?.status ?? 0;
    if (refreshStatus === REFRESH_ROTATED) res = await exec();
    else if (refreshStatus === 0) throw networkError(refresh.cause);
    else if (refreshStatus !== 401) res = refresh.response!.clone();
    // Bounce to /login only when the session is really gone — the BFF answers 401 for that, and
    // clears the cookies with it. A transient refresh failure (502/503/network) leaves the
    // cookies intact, so the caller sees that transport failure and the next call retries the
    // refresh; redirecting there would throw away a session that is still ACTIVE on the server.
    if (res.status === 401 && (refreshStatus === REFRESH_ROTATED || refreshStatus === 401)) redirectToLogin();
  } else if (await isRecoverableCsrfRejection(res)) {
    // At most one refresh + one retry: a second CSRF rejection is returned to the caller.
    if ((await refreshSession(fetchImpl)).response?.status === REFRESH_ROTATED) res = await exec();
  }
  // The API uses a stable code rather than a translated message, so every raw and JSON call is
  // caught consistently. Preserve the current same-app destination for the post-acceptance return.
  const code = await rejectionCode(res);
  if (code === LEGAL_ACCEPTANCE_REQUIRED_CODE) redirectToLegalAcceptance();
  else if (code === COMPANY_TERM_EXPIRED_CODE) redirectToCompanyRenewal();
  return res;
}

/**
 * JSON convenience wrapper matching the feature clients' error semantics:
 * throws Error(message) with `status`, optional stable `code`, and the parsed
 * error `details`; 204 resolves to undefined.
 */
export async function authedApiFetch<T>(path: string, init?: AuthedInit, fetchImpl: FetchLike = defaultFetch): Promise<T> {
  const { suppressErrorToast, ...requestInit } = init ?? {};
  const method = (requestInit.method ?? 'GET').toUpperCase();
  let res: Response;
  try {
    res = await authedFetch(path, requestInit, fetchImpl);
  } catch (error) {
    if (MUTATING_METHOD.test(method) && typeof window !== 'undefined' && !suppressErrorToast) {
      emitApiErrorToast(error);
    }
    throw error;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
      message?: unknown;
      code?: unknown;
    };
    const requestId = res.headers.get('x-request-id');
    const details = requestId && typeof body.requestId !== 'string'
      ? { ...body, requestId }
      : body;
    const message = Array.isArray(body.message)
      ? (body.message as unknown[]).join(', ')
      : typeof body.message === 'string'
        ? body.message
        : null;
    if (
      res.status === 403
      && (body.code === 'feature_not_enabled' || body.code === 'insufficient_permissions' || message === 'Insufficient permissions.')
      && typeof window !== 'undefined'
      && typeof window.dispatchEvent === 'function'
    ) {
      window.dispatchEvent(new Event(ACCESS_CONTEXT_STALE_EVENT));
    }
    // The API blocks business modules until a temporary password is changed.
    if (res.status === 403 && message?.includes('Password change required') && typeof window !== 'undefined') {
      window.location.assign('/change-password');
    }
    const error = Object.assign(new Error(message ?? `API error ${res.status}`), {
      status: res.status,
      details,
      ...(typeof body.code === 'string' ? { code: body.code } : {}),
    });
    if (MUTATING_METHOD.test(method) && typeof window !== 'undefined' && !suppressErrorToast) {
      emitApiErrorToast(error);
    }
    throw error;
  }
  if (res.status === 204) return undefined as T;
  // Some mutation endpoints answer 200/201 with an empty body (e.g. duplicate dismiss);
  // res.json() on those throws "Unexpected end of JSON input" AFTER the server persisted.
  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    const error = new ApiError({
      kind: 'server_error',
      code: 'invalid_response',
      message: 'Invalid API response.',
      statusCode: res.status,
      cause,
    });
    if (MUTATING_METHOD.test(method) && typeof window !== 'undefined' && !suppressErrorToast) {
      emitApiErrorToast(error);
    }
    throw error;
  }
}
