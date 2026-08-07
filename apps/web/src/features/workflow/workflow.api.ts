import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';

function qs(params?: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}

const base = (companyId: string) => `/companies/${companyId}/workflow`;

// ---- Templates ----
export function listWorkflowTemplates(companyId: string) {
  return apiFetch<any[]>(`${base(companyId)}/templates`);
}
export function enableWorkflowTemplate(companyId: string, templateKey: string, body: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/templates/${templateKey}/enable`, { method: 'POST', body: JSON.stringify(body) });
}

// ---- Rules ----
export function listWorkflowRules(companyId: string, params?: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/rules${qs(params)}`);
}
export function getWorkflowRule(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/rules/${id}`);
}
export function updateWorkflowRule(companyId: string, id: string, body: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}
export function enableWorkflowRule(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/rules/${id}/enable`, { method: 'POST', body: '{}' });
}
export function disableWorkflowRule(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/rules/${id}/disable`, { method: 'POST', body: '{}' });
}
export function testWorkflowRule(companyId: string, id: string, samplePayload: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/rules/${id}/test`, { method: 'POST', body: JSON.stringify({ samplePayload }) });
}

// ---- Runs ----
export function listWorkflowRuns(companyId: string, params?: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/runs${qs(params)}`);
}
export function getWorkflowRun(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/runs/${id}`);
}
export function explainWorkflowRun(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/explanations/${id}`);
}
export function replayWorkflowActionRun(companyId: string, actionRunId: string) {
  return apiFetch<any>(`${base(companyId)}/action-runs/${actionRunId}/replay`, { method: 'POST', body: '{}' });
}

// ---- Tasks ----
export function listWorkflowTasks(companyId: string, params?: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/tasks${qs(params)}`);
}
export function snoozeWorkflowTask(companyId: string, id: string, snoozedUntil: string) {
  return apiFetch<any>(`${base(companyId)}/tasks/${id}/snooze`, { method: 'POST', body: JSON.stringify({ snoozedUntil }) });
}
export function completeWorkflowTask(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/tasks/${id}/complete`, { method: 'POST', body: '{}' });
}
export function cancelWorkflowTask(companyId: string, id: string, reason?: string) {
  return apiFetch<any>(`${base(companyId)}/tasks/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
}

// ---- Dead letters ----
export function listWorkflowDeadLetters(companyId: string, params?: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/dead-letters${qs(params)}`);
}
export function replayWorkflowDeadLetter(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/dead-letters/${id}/replay`, { method: 'POST', body: '{}' });
}
export function ignoreWorkflowDeadLetter(companyId: string, id: string, resolutionNote: string) {
  return apiFetch<any>(`${base(companyId)}/dead-letters/${id}/ignore`, { method: 'POST', body: JSON.stringify({ resolutionNote }) });
}

// ---- Webhooks ----
export function listWorkflowWebhooks(companyId: string) {
  return apiFetch<any[]>(`${base(companyId)}/webhooks`);
}
export function createWorkflowWebhook(companyId: string, body: Record<string, unknown>) {
  return apiFetch<any>(`${base(companyId)}/webhooks`, { method: 'POST', body: JSON.stringify(body) });
}
export function enableWorkflowWebhook(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/webhooks/${id}/enable`, { method: 'POST', body: '{}' });
}
export function disableWorkflowWebhook(companyId: string, id: string) {
  return apiFetch<any>(`${base(companyId)}/webhooks/${id}/disable`, { method: 'POST', body: '{}' });
}
