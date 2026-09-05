import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type {
  CompanyIdentityResponse,
  PatchCompanyIdentityRequest,
  PatchCompanyIdentityResult,
  PutVatRegistrationRequest,
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
  phoneNumber: string | null;
  hasPassword: boolean;
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

/**
 * Reuses the existing verification route. `currentPassword` is omitted for a LINE-first account
 * that has none; the API demands it whenever a credential exists.
 */
export function requestMyEmailVerification(newEmail: string, currentPassword?: string): Promise<{ email: string; expiresAt: string }> {
  return apiFetch('/v1/auth/account/email', {
    method: 'POST',
    body: JSON.stringify(currentPassword ? { newEmail, currentPassword } : { newEmail }),
    suppressErrorToast: true,
  });
}
