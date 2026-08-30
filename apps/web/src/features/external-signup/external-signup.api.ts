'use client';

import type {
  PublicCompanySignupAcceptedDto,
  PublicCompanySignupBody,
  PublicSignupStatusDto,
  SignupClaimAttachBody,
  SignupClaimInfoDto,
  SignupClaimResultDto,
  SignupClaimSetPasswordBody,
} from '@watchdog-bms/contracts';
import { ApiError } from '@/common/models/api-error.model';

// P10 Flow B public pages. `/api/v1/*` is the Next rewrite onto the ERP API, and none of these
// endpoints has (or accepts) a session — the claim token is the proof.
//
// Not `createWebApiClient`: its 400/422 branch replaces the body with "Validation failed." and only
// keeps `message` when the server sent an array. This flow's one user-fixable rejection is the MX
// check, whose sentence names the mistyped domain — losing it leaves the applicant with a generic
// "reload the page" for a typo only they can fix. So the calls keep `message`/`code` in the same
// shape `authedApiFetch` throws, and 202-with-no-body resolves instead of failing to parse.
async function publicJson<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init?.method ?? 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: init ? JSON.stringify(init.body) : undefined,
      credentials: 'include',
      cache: 'no-store',
    });
  } catch (cause) {
    throw new ApiError({ kind: 'network_error', message: 'Network request failed.', cause });
  }

  const text = await response.text();
  const body = (() => {
    try {
      return text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();

  if (!response.ok) {
    const raw = body.message;
    const message = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : null;
    throw Object.assign(new Error(message ?? `API error ${response.status}`), {
      status: response.status,
      ...(typeof body.code === 'string' ? { code: body.code } : {}),
    });
  }
  return body as T;
}

export function getSignupAvailability(): Promise<{ enabled: boolean }> {
  return publicJson<{ enabled: boolean }>('/api/v1/public/company-signups/availability');
}

export function submitCompanySignup(body: PublicCompanySignupBody): Promise<PublicCompanySignupAcceptedDto> {
  return publicJson<PublicCompanySignupAcceptedDto>('/api/v1/public/company-signups', { method: 'POST', body });
}

export function getSignupStatus(requestId: string): Promise<PublicSignupStatusDto> {
  return publicJson<PublicSignupStatusDto>(`/api/v1/public/company-signups/${encodeURIComponent(requestId)}`);
}

export function resendSignupClaimEmail(requestId: string): Promise<void> {
  return publicJson<void>(`/api/v1/public/company-signups/${encodeURIComponent(requestId)}/resend-claim`, {
    method: 'POST',
    body: {},
  });
}

export function getSignupClaimInfo(token: string): Promise<SignupClaimInfoDto> {
  return publicJson<SignupClaimInfoDto>(`/api/v1/public/signup-claims/${encodeURIComponent(token)}`);
}

export function setSignupClaimPassword(body: SignupClaimSetPasswordBody): Promise<SignupClaimResultDto> {
  return publicJson<SignupClaimResultDto>('/api/v1/public/signup-claims/set-password', { method: 'POST', body });
}

export function attachSignupClaimToExistingUser(body: SignupClaimAttachBody): Promise<SignupClaimResultDto> {
  return publicJson<SignupClaimResultDto>('/api/v1/public/signup-claims/attach', { method: 'POST', body });
}
