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

export function clearStoredAuthTokens(storage: Storage | null = browserStorage()): void {
  if (!storage) return;
  for (const key of AUTH_STORAGE_KEYS) {
    storage.removeItem(key);
  }
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
  if (typeof window !== 'undefined') {
    window.location.assign(redirectTo);
  }
  return true;
}

export async function revokeOtherSessions(): Promise<RevokeOtherSessionsResult> {
  return authedApiFetch<RevokeOtherSessionsResult>('/auth/sessions/revoke-others', { method: 'POST', body: '{}' });
}
