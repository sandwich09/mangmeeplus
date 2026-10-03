import type { ExecutiveUserCreateBody, ExecutiveUserCreateResult, ExecutiveUserCredential, ExecutiveUserListDto, ExecutiveUserListQuery, ExecutiveUserView } from '@watchdog-bms/contracts';
import { authedApiFetch } from '@/common/api/authed-fetch';
import type { ExecutiveCommand } from './executive-users.logic';
const ROOT = '/v1/system/executive-users';
const options = { cache: 'no-store', suppressErrorToast: true } as const;
export function listExecutiveUsers(query: ExecutiveUserListQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
  return authedApiFetch<ExecutiveUserListDto>(`${ROOT}?${params}`, { ...options, signal });
}
export function getExecutiveUser(userId: string, signal?: AbortSignal) {
  return authedApiFetch<ExecutiveUserView>(`${ROOT}/${encodeURIComponent(userId)}`, { ...options, signal });
}
export function createExecutiveUser(body: ExecutiveUserCreateBody) {
  return authedApiFetch<ExecutiveUserCreateResult>(ROOT, { ...options, method: 'POST', body: JSON.stringify(body) });
}
export function commandExecutiveUser(userId: string, command: ExecutiveCommand) {
  return authedApiFetch<ExecutiveUserView | ExecutiveUserCredential>(`${ROOT}/${encodeURIComponent(userId)}/${command.path}`,
    { ...options, method: 'POST', body: JSON.stringify(command.body) });
}
