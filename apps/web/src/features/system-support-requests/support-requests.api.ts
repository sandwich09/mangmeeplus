import type {
  SupportRequestActionDto, SupportRequestQueueDto, SupportRequestStatus,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

export type { SupportRequestItemDto, SupportRequestQueueDto, SupportRequestStatus } from '@watchdog-bms/contracts';

export function listSupportRequests(status?: SupportRequestStatus): Promise<SupportRequestQueueDto> {
  const query = status ? `?${new URLSearchParams({ status }).toString()}` : '';
  return apiFetch<SupportRequestQueueDto>(`/v1/system/support-requests${query}`);
}

export function markSupportRequestAnswered(id: string): Promise<SupportRequestActionDto> {
  return apiFetch<SupportRequestActionDto>(`/v1/system/support-requests/${id}/answered`, {
    method: 'POST', suppressErrorToast: true,
  });
}

export function resumeSupportRequestAi(id: string): Promise<SupportRequestActionDto> {
  return apiFetch<SupportRequestActionDto>(`/v1/system/support-requests/${id}/resume-ai`, {
    method: 'POST', suppressErrorToast: true,
  });
}
