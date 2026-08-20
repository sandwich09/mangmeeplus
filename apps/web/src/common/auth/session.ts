import { authedApiFetch, readCookieValue } from '@/common/api/authed-fetch';
import { CSRF_COOKIE, CSRF_HEADER } from './auth-cookies.constants';

// Legacy keys from the pre-cookie session model. Kept only so logout scrubs
// stale tokens left behind in browsers that used the old localStorage flow.
export const AUTH_STORAGE_KEYS = [
  'watchdog.accessToken',
  'watchdog.refreshToken',
  'watchdog.auth.accessToken',
  'watchdog.auth.refreshToken',
  'watchdog_access_token',
  'watchdog_refresh_token',
] as const;

export type RevokeOtherSessionsResult = {
  revokedCount: number;
};

function browserStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

function browserSessionStorage(): Storage | null {
  return typeof window !== 'undefined' ? window.sessionStorage : null;
}

export function clearStoredAuthTokens(storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  for (const key of AUTH_STORAGE_KEYS) {
    storage.removeItem(key);
  }
}

/**
 * Unsent work in progress — the substitute-receipt wizard's typed reason, business purpose and payee
 * identity, the expense notices — lives in sessionStorage. Sign-out is a same-tab navigation, so
 * anything left there is readable by the NEXT person to sign in on this tab, and on this product
 * that text goes verbatim onto a statutory tax document.
 *
 * The whole per-tab store is dropped rather than a list of keys: this origin owns all of it, none of
 * it is meant to outlive the session, and a draft added next month is covered the day it is added —
 * which is the only version of this that stays true.
 */
export function clearStoredDrafts(storage: Storage | null = browserSessionStorage()): void {
  try { storage?.clear(); }
  catch { /* private mode can refuse; the key is user-scoped as well, so this is defence in depth */ }
}

export async function logoutCurrentSession(redirectTo = '/login'): Promise<boolean> {
  let response: Response;
  try {
    const csrf = typeof document !== 'undefined' ? readCookieValue(document.cookie, CSRF_COOKIE) : null;
    // BFF logout revokes the server session and clears the httpOnly cookies.
    response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { [CSRF_HEADER]: csrf } : {},
    });
  } catch {
    // Without a BFF response, JavaScript cannot clear the httpOnly cookies. Stay on the current
    // page and let the caller tell the user that they are still signed in.
    return false;
  }
  if (!response.ok) return false;

  clearStoredAuthTokens();
  clearStoredDrafts();
  if (typeof window !== 'undefined') {
    window.location.assign(redirectTo);
  }
  return true;
}

export async function revokeOtherSessions(): Promise<RevokeOtherSessionsResult> {
  return authedApiFetch<RevokeOtherSessionsResult>('/auth/sessions/revoke-others', { method: 'POST', body: '{}' });
}
