import type {
  SupportRequestActionDto, SupportRequestCountDto, SupportRequestQueueDto, SupportRequestStatus,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

export type { SupportRequestItemDto, SupportRequestQueueDto, SupportRequestStatus } from '@watchdog-bms/contracts';

export function listSupportRequests(
  status?: SupportRequestStatus,
  init?: { signal?: AbortSignal },
): Promise<SupportRequestQueueDto> {
  const query = status ? `?${new URLSearchParams({ status }).toString()}` : '';
  return apiFetch<SupportRequestQueueDto>(`/v1/system/support-requests${query}`, init);
}

export function getSupportOpenCount(init?: { signal?: AbortSignal }): Promise<SupportRequestCountDto> {
  // `suppressErrorToast`: the header asks for this on every navigation and a 403 there is normal
  // (not every system admin holds the partner-write permission). A toast would be noise, not news.
  return apiFetch<SupportRequestCountDto>('/v1/system/support-requests/count', {
    ...init, suppressErrorToast: true,
  });
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

/**
 * One number, one source.
 *
 * The nav badge and the inbox page both know the OPEN count, and they used to learn it separately
 * — so answering a request from the page left the badge in the header above it still claiming
 * somebody was waiting. The page publishes every count it reads (including the one after an
 * action), the header subscribes, and neither has to know the other exists.
 *
 * A module-level Set rather than a context or a store package: two components, one number, no
 * lifecycle. Add a real store when a third reader appears.
 */
type OpenCountListener = (open: number) => void;
const openCountListeners = new Set<OpenCountListener>();

export function subscribeSupportOpenCount(listener: OpenCountListener): () => void {
  openCountListeners.add(listener);
  return () => { openCountListeners.delete(listener); };
}

export function publishSupportOpenCount(open: number): void {
  for (const listener of openCountListeners) listener(open);
}
