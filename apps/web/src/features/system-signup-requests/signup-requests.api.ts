import type {
  AdminPackageChangeDecisionBody,
  AdminPackageChangeDecisionDto,
  AdminPackageChangeItemDto,
  AdminPackageChangeQueueDto,
  AdminSignupDecisionBody,
  AdminSignupDecisionDto,
  AdminSignupQueueDto,
  AdminSignupQueueItemDto,
  AdminSignupReissueDto,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

export type {
  AdminPackageChangeDecisionBody,
  AdminPackageChangeDecisionDto,
  AdminPackageChangeItemDto,
  AdminPackageChangeQueueDto,
  AdminSignupDecisionBody,
  AdminSignupDecisionDto,
  AdminSignupQueueDto,
  AdminSignupQueueItemDto,
  AdminSignupReissueDto,
};

/**
 * R13: one page of one tab. The server owns both — it used to answer with 200 unfiltered rows the
 * browser then filtered and counted, so a backlog past 200 was invisible and every count was a
 * count of the truncation.
 */
export function listSignupRequests(
  options: { tab?: string; cursor?: string } = {},
): Promise<AdminSignupQueueDto> {
  const query = new URLSearchParams();
  if (options.tab) query.set('tab', options.tab);
  if (options.cursor) query.set('cursor', options.cursor);
  const suffix = query.toString();
  return apiFetch<AdminSignupQueueDto>(`/v1/system/signup-requests${suffix ? `?${suffix}` : ''}`);
}

/** Review B-09 / §8: what AUTO_FREE let through, for after-the-fact review. Its own route. */
export function listAutoApprovedSignups(): Promise<AdminSignupQueueDto> {
  return apiFetch<AdminSignupQueueDto>('/v1/system/signup-requests/auto-approved');
}

export function listPackageChangeRequests(): Promise<AdminPackageChangeQueueDto> {
  return apiFetch<AdminPackageChangeQueueDto>('/v1/system/package-change-requests?status=OPEN');
}

export function decidePackageChangeRequest(
  id: string,
  body: AdminPackageChangeDecisionBody,
): Promise<AdminPackageChangeDecisionDto> {
  return apiFetch<AdminPackageChangeDecisionDto>(`/v1/system/package-change-requests/${id}/decision`, {
    method: 'POST',
    body: JSON.stringify(body),
    suppressErrorToast: true,
  });
}

export function decideSignupRequest(
  requestId: string,
  body: AdminSignupDecisionBody,
): Promise<AdminSignupDecisionDto> {
  return apiFetch<AdminSignupDecisionDto>(`/v1/system/signup-requests/${requestId}/decision`, {
    method: 'POST',
    body: JSON.stringify(body),
    suppressErrorToast: true,
  });
}

export function reissueSignupClaim(requestId: string): Promise<AdminSignupReissueDto> {
  return apiFetch<AdminSignupReissueDto>(`/v1/system/signup-requests/${requestId}/reissue-claim`, {
    method: 'POST',
    suppressErrorToast: true,
  });
}
