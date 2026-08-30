import type {
  AdminSignupDecisionBody,
  AdminSignupDecisionDto,
  AdminSignupQueueDto,
  AdminSignupQueueItemDto,
  AdminSignupReissueDto,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

export type {
  AdminSignupDecisionBody,
  AdminSignupDecisionDto,
  AdminSignupQueueDto,
  AdminSignupQueueItemDto,
  AdminSignupReissueDto,
};

export function listSignupRequests(): Promise<AdminSignupQueueDto> {
  return apiFetch<AdminSignupQueueDto>('/v1/system/signup-requests');
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
