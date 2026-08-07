import type {
  MessagingChannelProvider,
  MessagingChannelStatus,
  CrmChannelIdentityStatus,
  CrmConversationStatus,
  CrmConversationPriority,
  CrmMessageDirection,
  CrmMessageVisibility,
  CrmMessageAuthorType,
  CrmMessageType,
  CrmMessageDeliveryStatus,
} from '@watchdog-bms/contracts';

export type CompanyMessagingChannelRecord = {
  id: string;
  companyId: string;
  provider: MessagingChannelProvider;
  displayName: string;
  lineChannelId: string;
  /** Ciphertext. Never leaves the module; DTO mappers must not expose it. */
  encryptedSecretJson: string;
  credentialLast4: string;
  secretVersion: number;
  webhookKey: string;
  status: MessagingChannelStatus;
  lastWebhookAt: Date | null;
  lastValidatedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
  connectedByUserId: string;
  disabledAt: Date | null;
  disabledByUserId: string | null;
  disableReason: string | null;
  autoReplyEnabled: boolean;
  autoReplyDailyCap: number;
  defaultBookingStaffUserId: string | null;
  defaultBookingBranchId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmChannelIdentityRecord = {
  id: string;
  companyId: string;
  channelId: string;
  customerId: string;
  provider: MessagingChannelProvider;
  providerUserId: string;
  displayName: string | null;
  pictureUrl: string | null;
  followedAt: Date | null;
  unfollowedAt: Date | null;
  verifiedLinkAt: Date | null;
  verifiedLinkVia: 'LIFF' | 'STAFF' | null;
  status: CrmChannelIdentityStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmConversationRecord = {
  id: string;
  companyId: string;
  channelId: string;
  customerId: string;
  channelIdentityId: string;
  status: CrmConversationStatus;
  priority: CrmConversationPriority;
  tags: string[];
  assignedToUserId: string | null;
  unreadCount: number;
  lastMessageAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastMessagePreview: string | null;
  firstResponseDueAt: Date | null;
  firstRespondedAt: Date | null;
  slaBreachedAt: Date | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  reopenedCount: number;
  autoReplyEnabled: boolean;
  autoReplyCount: number;
  autoReplyCheckedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmMessageRecord = {
  id: string;
  companyId: string;
  conversationId: string;
  direction: CrmMessageDirection;
  visibility: CrmMessageVisibility;
  authorType: CrmMessageAuthorType;
  authorUserId: string | null;
  messageType: CrmMessageType;
  contentText: string | null;
  /** Bounded provider payload captured at ingestion (never the raw webhook body). */
  contentJson: Record<string, unknown> | null;
  attachmentId: string | null;
  providerMessageId: string | null;
  webhookEventId: string | null;
  deliveryStatus: CrmMessageDeliveryStatus;
  deliveryError: string | null;
  sentAt: Date | null;
  createdAt: Date;
};

export type CrmAutonomyJobRecord = {
  id: string;
  companyId: string;
  conversationId: string;
  messageId: string;
  replyToken: string | null;
  replyTokenAt: Date | null;
  status: 'PENDING' | 'DONE' | 'FAILED';
  attempts: number;
  nextAttemptAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmInboxPolicyRecord = {
  id: string;
  companyId: string;
  firstResponseMinutes: number;
  businessHoursJson: unknown;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmMessageTemplateRecord = {
  id: string;
  companyId: string;
  title: string;
  bodyText: string;
  category: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  version: number;
  aiApprovedVersion: number | null;
  aiApprovedAt: Date | null;
  aiApprovedByUserId: string | null;
  createdByUserId: string;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Parsed LINE webhook event — only the fields the inbox cares about. */
export type LineInboundEvent = {
  type: string;
  webhookEventId?: string;
  timestamp?: number;
  replyToken?: string;
  receivedAt?: number;
  source?: { userId?: string; type?: string };
  message?: {
    id?: string;
    type?: string;
    text?: string;
    fileName?: string;
    stickerId?: string;
    packageId?: string;
    latitude?: number;
    longitude?: number;
    address?: string;
  };
};
