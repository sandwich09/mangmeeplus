import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type {
  CrmConversationSummaryResult,
  CrmInsightsResult,
  CrmReplyDraftResult,
  CrmTrustReadResult,
} from '@watchdog-bms/contracts';

export type CrmAiFeedbackInput = {
  kind: 'SUMMARY' | 'REPLY_DRAFT' | 'INSIGHTS';
  rating: 'UP' | 'DOWN';
  comment?: string;
  requestId: string;
};

const aiBase = (companyId: string, conversationId: string) => `/companies/${companyId}/crm/conversations/${conversationId}/ai`;

export function getAiTrust(companyId: string, conversationId: string): Promise<CrmTrustReadResult> {
  return apiFetch<CrmTrustReadResult>(`${aiBase(companyId, conversationId)}/trust`);
}

export function requestAiSummary(companyId: string, conversationId: string): Promise<CrmConversationSummaryResult> {
  return apiFetch<CrmConversationSummaryResult>(`${aiBase(companyId, conversationId)}/summary`, { method: 'POST' });
}

export function requestAiReplyDraft(
  companyId: string,
  conversationId: string,
  input: { tone?: string } = {},
): Promise<CrmReplyDraftResult> {
  return apiFetch<CrmReplyDraftResult>(`${aiBase(companyId, conversationId)}/reply-draft`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function requestAiInsights(companyId: string, conversationId: string): Promise<CrmInsightsResult> {
  return apiFetch<CrmInsightsResult>(`${aiBase(companyId, conversationId)}/insights`, { method: 'POST' });
}

export function sendAiFeedback(
  companyId: string,
  conversationId: string,
  input: CrmAiFeedbackInput,
): Promise<{ id: string; createdAt: string }> {
  return apiFetch<{ id: string; createdAt: string }>(`${aiBase(companyId, conversationId)}/feedback`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
