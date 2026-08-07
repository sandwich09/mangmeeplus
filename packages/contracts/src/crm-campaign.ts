import type { AiModelPolicy, AiUsageEntry } from './ai-lineage.js';

export type CrmCampaignStatus = 'DRAFT' | 'READY' | 'SCHEDULED' | 'QUEUED' | 'SENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';
export type CrmCampaignRecipientStatus = 'PENDING' | 'SENDING' | 'DELIVERED' | 'FAILED' | 'SKIPPED_CONSENT' | 'SKIPPED_UNREACHABLE';
export type CrmCampaignSegment = { tier?: 'LEAD' | 'REGULAR' | 'VIP'; tags?: string[] };

export type CreateCrmCampaignInput = {
  name: string;
  messageText: string;
  imageUrl?: string;
  channelId: string;
  segment: CrmCampaignSegment;
};
export type UpdateCrmCampaignInput = Partial<Omit<CreateCrmCampaignInput, 'channelId'>>;
export type SendCrmCampaignInput = { scheduledAt?: string; idempotencyKey: string };
export type CrmCampaignSummary = {
  id: string; name: string; status: CrmCampaignStatus; messageText: string; imageUrl?: string;
  recipientCount: number; deliveredCount: number; failedCount: number; scheduledAt?: string;
  createdAt: string; updatedAt: string;
};
export type CrmCampaignMetricValue = {
  value: number | null;
  source: 'MANGMEE' | 'LINE_INSIGHT' | 'INFERRED' | 'UNSUPPORTED';
  /** Explains null values and prevents clients from silently rendering them as zero. */
  reason?: 'NOT_SYNCED' | 'PRIVACY_THRESHOLD' | 'NOT_SUPPORTED';
};
export type CrmCampaignMetrics = {
  targeted: CrmCampaignMetricValue;
  eligible: CrmCampaignMetricValue;
  /** LINE accepting a push request is not proof that the device received it. */
  accepted: CrmCampaignMetricValue;
  delivered: CrmCampaignMetricValue;
  open: CrmCampaignMetricValue;
  click: CrmCampaignMetricValue;
  reply: CrmCampaignMetricValue;
  attribution: CrmCampaignMetricValue;
};
export type CrmCampaignPreview = {
  eligibleCount: number; excludedConsentCount: number; excludedUnreachableCount: number;
  quotaRemaining?: number; quotaSufficient: boolean;
};
export type CrmCampaignResults = CrmCampaignSummary & { pendingCount: number; replies: number; metrics: CrmCampaignMetrics };

export type GenerateCrmBroadcastInput = {
  topic: string; price?: string; keyPoint?: string;
  tone: 'fun' | 'friendly' | 'premium' | 'polite' | 'concise';
};
export type CrmBroadcastCandidate = { id: string; headline: string; body: string };
export type CrmBroadcastGenerateRequest = GenerateCrmBroadcastInput & {
  requestId: string;
  companyId: string;
  /** API-resolved CompanyAiConfiguration; never accepted from an end-user payload. */
  modelPolicy?: AiModelPolicy;
  locale?: string;
};
/** `usage` rides the intersection so both arms carry what the gateway measured (metering §7.1). */
export type CrmBroadcastGenerateResult = { usage?: AiUsageEntry[] } & (
  | { status: 'ok'; requestId: string; candidates: CrmBroadcastCandidate[] }
  | { status: 'unavailable' | 'uncertain'; requestId: string; error?: string }
);
