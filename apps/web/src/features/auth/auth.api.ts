'use client';

import type {
  AcceptLegalDocumentsInput,
  AcceptLegalDocumentsResponse,
  LegalAcceptanceStatusResponse,
} from '@watchdog-bms/contracts';
import { createWebApiClient } from '@/common/api/http-client';
import { authedApiFetch } from '@/common/api/authed-fetch';

// Session responses no longer contain tokens: the BFF stores them in httpOnly cookies.
export type LoginSessionResponse = {
  passwordChangeRequired: boolean;
  legalAcceptanceRequired: boolean;
  companyId: string | null;
  redirectPath: string;
};

export type AccountSecurityState = {
  email: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  pendingEmail: string | null;
  pendingEmailExpiresAt: string | null;
  /** PDPA objection route (M-05 §3.1): set = LINE AI assistant opted out for this user. */
  aiAssistantOptOutAt: string | null;
};

// Same-origin public client: /api/auth/* hits the BFF route handlers (cookie set/clear),
// /api/v1/auth/* proxies public API endpoints through the Next rewrite.
const publicApi = createWebApiClient('', () => null);

export function loginWithPassword(username: string, password: string, remember = true): Promise<LoginSessionResponse> {
  return publicApi.post<LoginSessionResponse>('/api/auth/login', { username, password, remember });
}

/**
 * Local-development only (LoginPage hides it outside dev builds); the BFF route
 * 404s in production builds and the API endpoint 404s unless APP_ENV=local.
 */
export function loginAsDevOwner(): Promise<LoginSessionResponse> {
  return publicApi.post<LoginSessionResponse>('/api/auth/dev-login', {});
}

export type SessionRefreshOutcome = 'restored' | 'signed_out' | 'unavailable' | 'timeout';

/** A bounded refresh keeps an auth outage from leaving the login screen spinning forever. */
export async function refreshSessionWithOutcome(timeoutMs = 10_000): Promise<SessionRefreshOutcome> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (res.ok) return 'restored';
    return res.status === 401 ? 'signed_out' : 'unavailable';
  } catch {
    return controller.signal.aborted ? 'timeout' : 'unavailable';
  } finally {
    clearTimeout(timeout);
  }
}

/** Boolean compatibility wrapper for mutation retry callers: only a restored session may retry. */
export async function refreshSessionSilently(): Promise<boolean> {
  return (await refreshSessionWithOutcome()) === 'restored';
}

/** Always resolves with the same generic message — the API never reveals whether the username exists. */
export function requestPasswordReset(username: string): Promise<{ message: string }> {
  return publicApi.post<{ message: string }>('/api/v1/auth/password/reset-request', { username });
}

export function confirmEmailVerification(token: string): Promise<{ email: string; verifiedAt: string }> {
  return publicApi.post<{ email: string; verifiedAt: string }>('/api/v1/auth/account/email/verify', { token });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  try {
    await publicApi.post<void>('/api/auth/change-password', { currentPassword, newPassword });
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 401 || !(await refreshSessionSilently())) throw error;
    await publicApi.post<void>('/api/auth/change-password', { currentPassword, newPassword });
  }
}

export function getAccountSecurityState(): Promise<AccountSecurityState> {
  return authedApiFetch<AccountSecurityState>('/auth/account/security');
}

export function getLegalAcceptanceStatus(companyId: string): Promise<LegalAcceptanceStatusResponse> {
  return authedApiFetch<LegalAcceptanceStatusResponse>('/auth/legal-acceptance', {
    headers: { 'X-Company-Id': companyId },
    suppressErrorToast: true,
  });
}

export function acceptLegalDocuments(
  companyId: string,
  input: AcceptLegalDocumentsInput,
): Promise<AcceptLegalDocumentsResponse> {
  return authedApiFetch<AcceptLegalDocumentsResponse>('/auth/legal-acceptance', {
    method: 'POST',
    headers: { 'X-Company-Id': companyId },
    body: JSON.stringify(input),
    suppressErrorToast: true,
  });
}

/** PDPA objection route (M-05 §3.1): toggle the LINE AI assistant for the current user. */
export function setAiAssistantEnabled(enabled: boolean): Promise<void> {
  return authedApiFetch<void>('/auth/account/ai-assistant', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

export function requestEmailChange(currentPassword: string, newEmail: string): Promise<{ email: string; expiresAt: string }> {
  return authedApiFetch<{ email: string; expiresAt: string }>('/auth/account/email', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newEmail }),
  });
}

export function resendEmailVerification(): Promise<{ email: string; expiresAt: string }> {
  return authedApiFetch<{ email: string; expiresAt: string }>('/auth/account/email/resend', {
    method: 'POST',
    body: '{}',
  });
}
