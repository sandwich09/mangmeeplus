import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type {
  MessagingChannelSummary,
  CrmConversationPriority,
  ConnectMessagingChannelInput,
  RotateMessagingChannelCredentialInput,
  TestMessagingChannelResult,
  RevealMessagingChannelCredentialResult,
  ListCrmConversationsResult,
  CrmConversationDetail,
  CrmConversationStatus,
  CrmConversationSummary,
  UpdateCrmConversationAutoReplyRequest,
  SendCrmMessageResult,
  CrmMessageTemplateSummary,
  CreateCrmMessageTemplateInput,
  UpdateCrmMessageTemplateInput,
  CrmInboxPolicyDto,
  UpdateCrmInboxPolicyInput,
  UpdateMessagingChannelSettingsRequest,
  UpdateMessagingChannelSettingsResponse,
  DashboardPeriodKind,
} from '@watchdog-bms/contracts';

const base = (companyId: string) => `/companies/${companyId}/crm`;

export function listChannels(companyId: string): Promise<MessagingChannelSummary[]> {
  return apiFetch<MessagingChannelSummary[]>(`${base(companyId)}/channels`);
}

export function connectChannel(
  companyId: string,
  input: ConnectMessagingChannelInput,
): Promise<MessagingChannelSummary> {
  return apiFetch<MessagingChannelSummary>(`${base(companyId)}/channels`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function testChannel(companyId: string, channelId: string): Promise<TestMessagingChannelResult> {
  return apiFetch<TestMessagingChannelResult>(`${base(companyId)}/channels/${channelId}/test`, { method: 'POST' });
}

export function rotateChannel(
  companyId: string,
  channelId: string,
  input: RotateMessagingChannelCredentialInput,
): Promise<MessagingChannelSummary> {
  return apiFetch<MessagingChannelSummary>(`${base(companyId)}/channels/${channelId}/rotate`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function disableChannel(
  companyId: string,
  channelId: string,
  reason: string,
): Promise<MessagingChannelSummary> {
  return apiFetch<MessagingChannelSummary>(`${base(companyId)}/channels/${channelId}/disable`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export function revealChannelCredential(
  companyId: string,
  channelId: string,
): Promise<RevealMessagingChannelCredentialResult> {
  return apiFetch<RevealMessagingChannelCredentialResult>(`${base(companyId)}/channels/${channelId}/reveal`, {
    method: 'POST',
  });
}

export function updateChannelSettings(
  companyId: string,
  channelId: string,
  input: UpdateMessagingChannelSettingsRequest,
): Promise<UpdateMessagingChannelSettingsResponse> {
  return apiFetch<UpdateMessagingChannelSettingsResponse>(`${base(companyId)}/channels/${channelId}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function listConversations(
  companyId: string,
  filter?: { status?: CrmConversationStatus; search?: string; overdue?: boolean; tag?: string; assignee?: 'me' | 'none'; customerId?: string; page?: number; pageSize?: number },
): Promise<ListCrmConversationsResult> {
  const params = new URLSearchParams();
  if (filter?.status) params.set('status', filter.status);
  if (filter?.search) params.set('search', filter.search);
  if (filter?.overdue) params.set('overdue', 'true');
  if (filter?.tag) params.set('tag', filter.tag);
  if (filter?.assignee) params.set('assignee', filter.assignee);
  if (filter?.customerId) params.set('customerId', filter.customerId);
  if (filter?.page) params.set('page', String(filter.page));
  if (filter?.pageSize) params.set('pageSize', String(filter.pageSize));
  const query = params.toString();
  return apiFetch<ListCrmConversationsResult>(`${base(companyId)}/conversations${query ? `?${query}` : ''}`);
}

export function getConversation(companyId: string, conversationId: string): Promise<CrmConversationDetail> {
  return apiFetch<CrmConversationDetail>(`${base(companyId)}/conversations/${conversationId}`);
}

// ---- Phase 2 triage ----

export function sendReply(companyId: string, conversationId: string, text: string): Promise<SendCrmMessageResult> {
  return apiFetch<SendCrmMessageResult>(`${base(companyId)}/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function addInternalNote(companyId: string, conversationId: string, text: string): Promise<SendCrmMessageResult> {
  return apiFetch<SendCrmMessageResult>(`${base(companyId)}/conversations/${conversationId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

export function setConversationStatus(
  companyId: string,
  conversationId: string,
  status: CrmConversationStatus,
): Promise<CrmConversationSummary> {
  return apiFetch<CrmConversationSummary>(`${base(companyId)}/conversations/${conversationId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  });
}

export function setConversationAutoReply(
  companyId: string,
  conversationId: string,
  enabled: boolean,
): Promise<CrmConversationSummary> {
  const input: UpdateCrmConversationAutoReplyRequest = { enabled };
  return apiFetch<CrmConversationSummary>(`${base(companyId)}/conversations/${conversationId}/auto-reply`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function assignConversation(
  companyId: string,
  conversationId: string,
  assignedToUserId: string | null,
): Promise<CrmConversationSummary> {
  return apiFetch<CrmConversationSummary>(`${base(companyId)}/conversations/${conversationId}/assign`, {
    method: 'PUT',
    body: JSON.stringify({ assignedToUserId }),
  });
}

export function setConversationPriority(
  companyId: string,
  conversationId: string,
  priority: CrmConversationPriority,
): Promise<CrmConversationSummary> {
  return apiFetch<CrmConversationSummary>(`${base(companyId)}/conversations/${conversationId}/priority`, {
    method: 'PUT',
    body: JSON.stringify({ priority }),
  });
}

export function setConversationTags(
  companyId: string,
  conversationId: string,
  tags: string[],
): Promise<CrmConversationSummary> {
  return apiFetch<CrmConversationSummary>(`${base(companyId)}/conversations/${conversationId}/tags`, {
    method: 'PUT',
    body: JSON.stringify({ tags }),
  });
}

export function markConversationRead(companyId: string, conversationId: string): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`${base(companyId)}/conversations/${conversationId}/read`, { method: 'POST' });
}

// ---- Message templates (quick replies) ----

export function listMessageTemplates(companyId: string): Promise<CrmMessageTemplateSummary[]> {
  return apiFetch<CrmMessageTemplateSummary[]>(`${base(companyId)}/templates`);
}

export function createMessageTemplate(companyId: string, input: CreateCrmMessageTemplateInput): Promise<CrmMessageTemplateSummary> {
  return apiFetch<CrmMessageTemplateSummary>(`${base(companyId)}/templates`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateMessageTemplate(companyId: string, templateId: string, input: UpdateCrmMessageTemplateInput): Promise<CrmMessageTemplateSummary> {
  return apiFetch<CrmMessageTemplateSummary>(`${base(companyId)}/templates/${templateId}`, { method: 'POST', body: JSON.stringify(input) });
}

export function archiveMessageTemplate(companyId: string, templateId: string): Promise<CrmMessageTemplateSummary> {
  return apiFetch<CrmMessageTemplateSummary>(`${base(companyId)}/templates/${templateId}/archive`, { method: 'POST' });
}

export function approveMessageTemplateForAi(companyId: string, templateId: string): Promise<CrmMessageTemplateSummary> {
  return apiFetch<CrmMessageTemplateSummary>(`${base(companyId)}/templates/${templateId}/approve-ai`, { method: 'POST' });
}

// ---- Inbox policy (first-response SLA settings) ----

export function getInboxPolicy(companyId: string): Promise<CrmInboxPolicyDto> {
  return apiFetch<CrmInboxPolicyDto>(`${base(companyId)}/inbox-policy`);
}

export function updateInboxPolicy(companyId: string, input: UpdateCrmInboxPolicyInput): Promise<CrmInboxPolicyDto> {
  return apiFetch<CrmInboxPolicyDto>(`${base(companyId)}/inbox-policy`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

// --- A3 revenue loop: create-from-conversation + payment-proof ---
const conv = (companyId: string, conversationId: string) => `${base(companyId)}/conversations/${conversationId}`;

export function createDealFromConversation(companyId: string, conversationId: string, input: { title: string; amountEstimate?: string; expectedCloseDate?: string }) {
  return apiFetch<{ id: string; title: string }>(`${conv(companyId, conversationId)}/create-deal`, { method: 'POST', body: JSON.stringify(input) });
}

export function createTaskFromConversation(companyId: string, conversationId: string, input: { title: string; dueAt: string; priority?: string }) {
  return apiFetch<{ id: string; title: string }>(`${conv(companyId, conversationId)}/create-task`, { method: 'POST', body: JSON.stringify(input) });
}

export function createQuotationFromConversation(companyId: string, conversationId: string, input: { title: string; amountEstimate?: string }) {
  return apiFetch<{ opportunity: { id: string }; quotation: { id: string } }>(`${conv(companyId, conversationId)}/create-quotation`, { method: 'POST', body: JSON.stringify(input) });
}

export function flagPaymentProof(companyId: string, conversationId: string, messageId: string) {
  return apiFetch<{ ok: true; attachmentId: string; alreadyFlagged: boolean }>(`${conv(companyId, conversationId)}/messages/${messageId}/flag-payment-proof`, { method: 'POST', body: '{}' });
}

export interface PaymentProofItem {
  attachmentId: string;
  conversationId: string;
  messageId: string | null;
  fileName: string;
  mimeType: string;
  byteSize: number;
  status: string;
  flaggedByUserId: string;
  flaggedAt: string;
  customerId: string | null;
  customerName: string | null;
}
export function listPaymentProofs(companyId: string) {
  return apiFetch<{ items: PaymentProofItem[] }>(`${base(companyId)}/payment-proofs`);
}

export interface CrmDailyBriefWidget { key: string; label: string; value: number; href: string; severity: 'critical' | 'action' | 'info' }
export function getCrmDailyBrief(companyId: string, period?: DashboardPeriodKind) {
  const query = period ? `?period=${encodeURIComponent(period)}` : '';
  return apiFetch<{ generatedAt: string; widgets: CrmDailyBriefWidget[] }>(`${base(companyId)}/daily-brief${query}`);
}
