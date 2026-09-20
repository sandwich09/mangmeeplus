import type {
  SupportRequestActionDto, SupportRequestCountDto, SupportRequestQueueDto,
  SupportRequestReplyBody, SupportRequestReplyResultDto, SupportRequestStatus, SupportRequestThreadDto,
} from '@watchdog-bms/contracts';
import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

export type {
  SupportRequestItemDto, SupportRequestMessageDto, SupportRequestQueueDto, SupportRequestStatus,
  SupportRequestThreadDto,
} from '@watchdog-bms/contracts';

/**
 * สัญญา v3 ข้อ 11: the request and its messages in one read. `suppressErrorToast` because the chat
 * window polls this every 10 seconds — a transient failure is shown inside the window, not toasted
 * six times a minute.
 */
export function getSupportRequestThread(id: string, init?: { signal?: AbortSignal }): Promise<SupportRequestThreadDto> {
  return apiFetch<SupportRequestThreadDto>(`/v1/system/support-requests/${encodeURIComponent(id)}/thread`, {
    ...init, suppressErrorToast: true,
  });
}

/** Same-origin URL for a stored customer photo/file — <img>/<a> use it directly (cookie session). */
export function supportMessageContentUrl(id: string, messageId: string): string {
  return `/api/v1/system/support-requests/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/content`;
}

export function listSupportRequests(
  status?: SupportRequestStatus,
  cursor?: string,
  init?: { signal?: AbortSignal },
): Promise<SupportRequestQueueDto> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (cursor) params.set('cursor', cursor);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  return apiFetch<SupportRequestQueueDto>(`/v1/system/support-requests${query}`, init);
}

const postAction = (id: string, action: string, body?: unknown): Promise<SupportRequestActionDto> =>
  apiFetch<SupportRequestActionDto>(`/v1/system/support-requests/${id}/${action}`, {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
    suppressErrorToast: true,
  });

export const claimSupportRequest = (id: string) => postAction(id, 'claim');
export const releaseSupportRequest = (id: string) => postAction(id, 'release');
export const reclaimSupportRequest = (id: string, expectedAssignedAt: string, reason: string) =>
  postAction(id, 'reclaim', { expectedAssignedAt, reason });
export const resolveSupportRequest = (id: string, note: string) => postAction(id, 'resolve', { note });

export function replySupportRequest(
  id: string,
  body: SupportRequestReplyBody,
): Promise<SupportRequestReplyResultDto> {
  return apiFetch<SupportRequestReplyResultDto>(`/v1/system/support-requests/${id}/reply`, {
    method: 'POST', body: JSON.stringify(body), suppressErrorToast: true,
  });
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
