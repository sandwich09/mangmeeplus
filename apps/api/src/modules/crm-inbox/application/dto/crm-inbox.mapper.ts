import type {
  MessagingChannelSummary,
  CrmConversationSummary,
  CrmMessageContentMeta,
  CrmMessageSummary,
} from '@watchdog-bms/contracts';
import type {
  CompanyMessagingChannelRecord,
  CrmConversationRecord,
  CrmMessageRecord,
} from '../../domain/models/crm-inbox.model';
import { CRM_LINE_WEBHOOK_PATH_PREFIX } from '../../domain/crm-inbox.constants';

const iso = (d: Date | null): string | undefined => (d ? d.toISOString() : undefined);

/**
 * Channel DTO. Never exposes encryptedSecretJson. The webhook path/URL is a
 * capability marker: include it only for callers holding crm.channel.manage.
 */
export function toChannelSummary(
  record: CompanyMessagingChannelRecord,
  opts: { includeWebhook: boolean; publicBaseUrl?: string },
): MessagingChannelSummary {
  const webhookPath = `${CRM_LINE_WEBHOOK_PATH_PREFIX}${record.webhookKey}`;
  return {
    id: record.id,
    provider: record.provider,
    displayName: record.displayName,
    lineChannelId: record.lineChannelId,
    credentialLast4: record.credentialLast4,
    secretVersion: record.secretVersion,
    status: record.status,
    webhookPath: opts.includeWebhook ? webhookPath : undefined,
    autoReplyEnabled: opts.includeWebhook ? record.autoReplyEnabled : undefined,
    autoReplyDailyCap: opts.includeWebhook ? record.autoReplyDailyCap : undefined,
    defaultBookingStaffUserId: opts.includeWebhook ? record.defaultBookingStaffUserId ?? undefined : undefined,
    defaultBookingBranchId: opts.includeWebhook ? record.defaultBookingBranchId ?? undefined : undefined,
    webhookUrl: opts.includeWebhook && opts.publicBaseUrl
      ? `${opts.publicBaseUrl.replace(/\/$/, '')}${webhookPath}`
      : undefined,
    lastWebhookAt: iso(record.lastWebhookAt),
    lastValidatedAt: iso(record.lastValidatedAt),
    lastErrorAt: iso(record.lastErrorAt),
    lastErrorCode: record.lastErrorCode ?? undefined,
    connectedByUserId: record.connectedByUserId,
    disabledAt: iso(record.disabledAt),
    disableReason: record.disableReason ?? undefined,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function toConversationSummary(
  record: CrmConversationRecord,
  customerDisplayName?: string,
  assignedToDisplayName?: string,
): CrmConversationSummary {
  return {
    id: record.id,
    channelId: record.channelId,
    customerId: record.customerId,
    customerDisplayName,
    autoReplyEnabled: record.autoReplyEnabled,
    status: record.status,
    priority: record.priority,
    tags: record.tags,
    assignedToUserId: record.assignedToUserId ?? undefined,
    assignedToDisplayName,
    unreadCount: record.unreadCount,
    lastMessageAt: iso(record.lastMessageAt),
    lastInboundAt: iso(record.lastInboundAt),
    lastMessagePreview: record.lastMessagePreview ?? undefined,
    firstResponseDueAt: iso(record.firstResponseDueAt),
    firstRespondedAt: iso(record.firstRespondedAt),
    slaBreachedAt: iso(record.slaBreachedAt),
    reopenedCount: record.reopenedCount,
    createdAt: record.createdAt.toISOString(),
  };
}

// Whitelist matching CrmMessageContentMeta — contentJson stays bounded at
// ingestion, but the DTO re-filters so stray keys can never reach clients.
const CONTENT_META_KEYS = ['fileName', 'stickerId', 'packageId', 'latitude', 'longitude', 'address', 'mediaError'] as const;

function toContentMeta(json: Record<string, unknown> | null): CrmMessageContentMeta | undefined {
  if (!json) return undefined;
  const meta: Record<string, unknown> = {};
  for (const key of CONTENT_META_KEYS) {
    if (json[key] !== undefined && json[key] !== null) meta[key] = json[key];
  }
  return Object.keys(meta).length > 0 ? (meta as CrmMessageContentMeta) : undefined;
}

export function toMessageSummary(record: CrmMessageRecord): CrmMessageSummary {
  return {
    id: record.id,
    conversationId: record.conversationId,
    direction: record.direction,
    visibility: record.visibility,
    authorType: record.authorType,
    authorUserId: record.authorUserId ?? undefined,
    messageType: record.messageType,
    contentText: record.contentText ?? undefined,
    contentMeta: toContentMeta(record.contentJson),
    attachmentId: record.attachmentId ?? undefined,
    providerMessageId: record.providerMessageId ?? undefined,
    deliveryStatus: record.deliveryStatus,
    deliveryError: record.deliveryError ?? undefined,
    sentAt: iso(record.sentAt),
    createdAt: record.createdAt.toISOString(),
  };
}
