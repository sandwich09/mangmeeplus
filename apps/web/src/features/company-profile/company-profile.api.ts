import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type {
  CompanyIdentityResponse,
  PatchCompanyIdentityRequest,
  PatchCompanyIdentityResult,
  PutVatRegistrationRequest,
  CompanyBusinessType,
  PatchCompanyBusinessTypeRequest,
} from '@watchdog-bms/contracts';

/** Mirrors `AccountSecurityState` on the API (`get-account-security-state.use-case.ts`). */
export type AccountProfileState = {
  email: string | null;
  emailVerified: boolean;
  username: string | null;
  emailVerifiedAt: string | null;
  pendingEmail: string | null;
  pendingEmailExpiresAt: string | null;
  lineLinked: boolean;
  /** Current Messaging identity binding; provider delivery readiness is separate. */
  lineMessagingReady?: boolean;
  phoneNumber: string | null;
  hasPassword: boolean;
  /** False when `EMAIL_PROVIDER=disabled`: nothing can be sent, so nothing may be promised. */
  emailDeliveryEnabled?: boolean;
};

export function getCompanyIdentity(companyId: string): Promise<CompanyIdentityResponse> {
  return apiFetch(`/v1/companies/${companyId}/identity`);
}

export function patchCompanyIdentity(
  companyId: string,
  body: PatchCompanyIdentityRequest,
): Promise<PatchCompanyIdentityResult> {
  return apiFetch(`/v1/companies/${companyId}/identity`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function putVatRegistration(companyId: string, body: PutVatRegistrationRequest): Promise<unknown> {
  return apiFetch(`/v1/companies/${companyId}/vat-registration`, { method: 'PUT', body: JSON.stringify(body) });
}

export function patchCompanyBusinessType(companyId: string, body: PatchCompanyBusinessTypeRequest): Promise<CompanyBusinessType> {
  return apiFetch(`/v1/companies/${companyId}/identity/business-type`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function getAccountProfile(): Promise<AccountProfileState> {
  return apiFetch('/v1/auth/account/security');
}

/** Blank clears the stored number. */
export function setMyPhoneNumber(phoneNumber: string): Promise<{ phoneNumber: string | null }> {
  return apiFetch('/v1/auth/me/contact', { method: 'PATCH', body: JSON.stringify({ phoneNumber }) });
}

/** Answers the STORED username — lower-cased — which is what the login box will accept. */
export function setMyFirstPassword(password: string, username?: string): Promise<{ username: string | null }> {
  return apiFetch('/v1/auth/me/password/set', {
    method: 'POST',
    body: JSON.stringify(username ? { password, username } : { password }),
  });
}

/** Save a LINE-linked account's login email without claiming that the mailbox was verified. */
export function setMyUnverifiedEmail(
  newEmail: string,
  expectedEmail: string | null,
  currentPassword?: string,
): Promise<{ email: string; emailVerified: false }> {
  return apiFetch('/v1/auth/me/email/unverified', {
    method: 'POST',
    body: JSON.stringify({ newEmail, expectedEmail, ...(currentPassword ? { currentPassword } : {}) }),
    suppressErrorToast: true,
  });
}

/**
 * Reuses the existing verification route. `currentPassword` is omitted for a LINE-first account
 * that has none; the API demands it whenever a credential exists.
 */
/** Re-sends the link for the pending request; 404 when there is none. */
export function resendMyEmailVerification(): Promise<{ email: string; expiresAt: string }> {
  return apiFetch('/v1/auth/account/email/resend', { method: 'POST', suppressErrorToast: true });
}

export function requestMyEmailVerification(newEmail: string, currentPassword?: string): Promise<{ email: string; expiresAt: string }> {
  return apiFetch('/v1/auth/account/email', {
    method: 'POST',
    body: JSON.stringify(currentPassword ? { newEmail, currentPassword } : { newEmail }),
    suppressErrorToast: true,
  });
}

export const ACCOUNT_NAME_CHANGED_EVENT = 'mangmee:account-name-changed';
export type DisplayNameHistory = { displayName: string; history: { id: string; changedAt: string; oldName: string; newName: string; changedByName: string | null }[] };
export function getDisplayNameHistory(companyId: string, userId?: string): Promise<DisplayNameHistory> {
  return apiFetch(`/v1/auth/account/display-name?${new URLSearchParams({ companyId, ...(userId ? { userId } : {}) })}`, { headers: { 'x-company-id': companyId } });
}
export function setMyDisplayName(companyId: string, displayName: string): Promise<DisplayNameHistory> {
  return apiFetch('/v1/auth/account/display-name', { method: 'PATCH', headers: { 'x-company-id': companyId }, body: JSON.stringify({ companyId, displayName }), suppressErrorToast: true });
}
