import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const base = (companyId: string) => `/companies/${companyId}/ai`;

export function listAiSuggestions(companyId: string, params?: Record<string, unknown>) {
  return apiFetch<{ items: any[]; total: number; page: number; pageSize: number }>(`${base(companyId)}/suggestions${qs(params)}`);
}
export function getAiSuggestion(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/suggestions/${id}`);
}
export function listAiTemplates(companyId: string) {
  return apiFetch<any[]>(`${base(companyId)}/suggestion-templates`);
}
export function getAiProviderStatus(companyId: string) {
  return apiFetch<{ mode: string; available: boolean; reason?: string }>(`${base(companyId)}/provider-status`);
}
export function requestAiSuggestion(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/suggestions/requests`, { method: 'POST', body: JSON.stringify(body) });
}
export function validateAiAction(companyId: string, suggestionId: string, actionId: string) {
  return apiFetch<any>(`${base(companyId)}/suggestions/${suggestionId}/actions/${actionId}/validate`, { method: 'POST', body: '{}' });
}
export function createAiSourceDraft(companyId: string, suggestionId: string, actionId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/suggestions/${suggestionId}/actions/${actionId}/create-source-draft`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
export function reviewAiSuggestion(companyId: string, suggestionId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/suggestions/${suggestionId}/reviews`, { method: 'POST', body: JSON.stringify(body) });
}
