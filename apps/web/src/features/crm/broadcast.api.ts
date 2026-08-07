import { authedApiFetch as apiFetch } from '@/common/api/authed-fetch';
import type { CreateCrmCampaignInput, CrmCampaignPreview, CrmCampaignSummary } from '@watchdog-bms/contracts';
import type { MessagingChannelSummary } from '@watchdog-bms/contracts';
import type { CrmBroadcastGenerateResult, GenerateCrmBroadcastInput } from '@watchdog-bms/contracts';

const base = (companyId: string) => `/companies/${companyId}/crm/campaigns`;

export const listBroadcastCampaigns = (companyId: string) =>
  apiFetch<CrmCampaignSummary[]>(base(companyId));

export const listBroadcastChannels = (companyId: string) =>
  apiFetch<MessagingChannelSummary[]>(`/companies/${companyId}/crm/channels`);

export const generateBroadcast = (companyId: string, body: GenerateCrmBroadcastInput) =>
  apiFetch<CrmBroadcastGenerateResult>(`${base(companyId)}/generate`, { method: 'POST', body: JSON.stringify(body) });

export const createBroadcastDraft = (companyId: string, body: CreateCrmCampaignInput) =>
  apiFetch<CrmCampaignSummary>(`${base(companyId)}/drafts`, { method: 'POST', body: JSON.stringify(body) });

export const previewBroadcast = (companyId: string, campaignId: string) =>
  apiFetch<CrmCampaignPreview>(`${base(companyId)}/${campaignId}/preview`, { method: 'POST' });

export const sendBroadcast = (companyId: string, campaignId: string) =>
  apiFetch<CrmCampaignSummary>(`${base(companyId)}/${campaignId}/send`, { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }) });
