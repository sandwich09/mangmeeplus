// ---- Item 15A: CRM Customer OS — Company LINE OA channel + inbox foundation ----
//
// Business contract for the per-company LINE OA messaging channel and the CRM
// Inbox built on top of it. The company LINE OA serves END CUSTOMERS and is a
// separate channel from the WatchDog shared OA (items 10A/10B, internal users).
// End customers are CRM contacts only — never users, never AI callers.
// Channel credentials are encrypted at rest and never appear in DTOs; only a
// masked last-4 marker is exposed. Dates are ISO strings across the wire.

import type {
  CrmCustomerDetail,
  CrmOpportunitySummary,
  CrmFollowUpSummary,
  CrmQuotationLinkSummary,
} from './crm.js';

// ---- Enumerations (spec sections 10-11) ----

export type MessagingChannelProvider = 'LINE_OA';

export type MessagingChannelStatus = 'PENDING_SETUP' | 'CONNECTED' | 'ACTIVE' | 'ERROR' | 'DISABLED';

export type CrmChannelIdentityStatus = 'ACTIVE' | 'BLOCKED' | 'UNFOLLOWED';

export type CrmConversationStatus =
  | 'NEW'
  | 'OPEN'
  | 'WAITING_CUSTOMER'
  | 'WAITING_INTERNAL'
  | 'FOLLOW_UP'
  | 'RESOLVED'
  | 'SPAM';

export type CrmConversationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type CrmMessageDirection = 'INBOUND' | 'OUTBOUND';

export type CrmMessageVisibility = 'CUSTOMER' | 'INTERNAL_NOTE';

export type CrmMessageAuthorType = 'CUSTOMER' | 'STAFF' | 'SYSTEM' | 'AI';

export type CrmMessageType =
  | 'TEXT'
  | 'IMAGE'
  | 'STICKER'
  | 'FILE'
  | 'LOCATION'
  | 'DOCUMENT'
  | 'TEMPLATE'
  | 'SYSTEM';

export type CrmMessageDeliveryStatus = 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';

export type CrmSentiment = 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';

export type CrmRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

// ---- Messaging channel DTOs ----

export type ConnectMessagingChannelInput = {
  displayName: string;
  lineChannelId: string;
  channelSecret: string;
  accessToken: string;
};

export type RotateMessagingChannelCredentialInput = {
  channelSecret: string;
  accessToken: string;
  /** Also regenerate the webhook key (invalidates the old webhook URL). */
  rotateWebhookKey?: boolean;
};

export type DisableMessagingChannelInput = {
  reason: string;
};

export type UpdateMessagingChannelSettingsRequest = {
  autoReplyEnabled: boolean;
  autoReplyDailyCap: number;
  /** Omit to keep the current default; null clears it. */
  defaultBookingStaffUserId?: string | null;
  /** Omit to keep the current default; null clears it. */
  defaultBookingBranchId?: string | null;
};

export type MessagingChannelSummary = {
  id: string;
  provider: MessagingChannelProvider;
  displayName: string;
  lineChannelId: string;
  credentialLast4: string;
  secretVersion: number;
  status: MessagingChannelStatus;
  /** Present only for callers holding crm.channel.manage. */
  webhookPath?: string;
  /** Present only for callers holding crm.channel.manage. */
  autoReplyEnabled?: boolean;
  /** Present only for callers holding crm.channel.manage. */
  autoReplyDailyCap?: number;
  /** Present only for callers holding crm.channel.manage; omitted when unset. */
  defaultBookingStaffUserId?: string;
  /** Present only for callers holding crm.channel.manage; omitted when unset. */
  defaultBookingBranchId?: string;
  /** Absolute URL when the deployment knows its public origin. */
  webhookUrl?: string;
  lastWebhookAt?: string;
  lastValidatedAt?: string;
  lastErrorAt?: string;
  lastErrorCode?: string;
  connectedByUserId: string;
  disabledAt?: string;
  disableReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type UpdateMessagingChannelSettingsResponse = MessagingChannelSummary;

export type TestMessagingChannelResult = {
  ok: boolean;
  botDisplayName?: string;
  error?: string;
};

export type RevealMessagingChannelCredentialResult = {
  lineChannelId: string;
  channelSecret: string;
  accessToken: string;
};

// ---- Conversation / message read DTOs (Phase 1 minimal; Phase 2 extends) ----

export type CrmConversationSummary = {
  id: string;
  channelId: string;
  customerId: string;
  customerDisplayName?: string;
  autoReplyEnabled: boolean;
  status: CrmConversationStatus;
  priority: CrmConversationPriority;
  tags: string[];
  assignedToUserId?: string;
  assignedToDisplayName?: string;
  unreadCount: number;
  lastMessageAt?: string;
  lastInboundAt?: string;
  lastMessagePreview?: string;
  firstResponseDueAt?: string;
  firstRespondedAt?: string;
  slaBreachedAt?: string;
  reopenedCount: number;
  createdAt: string;
};

/** Bounded non-text payload for rendering media/sticker/location bubbles. */
export type CrmMessageContentMeta = {
  fileName?: string;
  stickerId?: string;
  packageId?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  /** Set when inbound media could not be stored (expired / too large / fetch failed). */
  mediaError?: string;
};

export type CrmMessageSummary = {
  id: string;
  conversationId: string;
  direction: CrmMessageDirection;
  visibility: CrmMessageVisibility;
  authorType: CrmMessageAuthorType;
  authorUserId?: string;
  messageType: CrmMessageType;
  contentText?: string;
  contentMeta?: CrmMessageContentMeta;
  /** Present when the media bytes were stored — content served via the message content route. */
  attachmentId?: string;
  providerMessageId?: string;
  deliveryStatus: CrmMessageDeliveryStatus;
  deliveryError?: string;
  sentAt?: string;
  createdAt: string;
};

export type CrmConversationDetail = CrmConversationSummary & {
  messages: CrmMessageSummary[];
};

export type ListCrmConversationsFilter = {
  status?: CrmConversationStatus;
  /** Matches customer display name or last message preview. */
  search?: string;
  /** Only first-response-SLA-overdue conversations (เกิน 30 นาที). */
  overdue?: boolean;
  /** Only conversations still waiting for their first staff reply, due or not (resolved and spam excluded). */
  unanswered?: boolean;
  /** Only conversations carrying this tag (exact match). */
  tag?: string;
  /** 'me' = assigned to the caller; 'none' = unassigned (pickup queue). */
  assignee?: 'me' | 'none';
  /** Only conversations of this CRM customer (Customer 360 tabs). */
  customerId?: string;
  page?: number;
  pageSize?: number;
};

export type ListCrmConversationsResult = {
  items: CrmConversationSummary[];
  total: number;
  page: number;
  pageSize: number;
  /** Visibility-scoped counts (ignore status/search filters) for the inbox filter chips. */
  statusCounts?: Partial<Record<CrmConversationStatus, number>>;
  overdueCount?: number;
  /** Conversations still waiting for their first staff reply (resolved and spam excluded). */
  unansweredCount?: number;
  /** Conversations assigned to the caller (non-spam). */
  mineCount?: number;
  /** Unassigned conversations awaiting pickup (non-spam). */
  unassignedCount?: number;
};

// ---- Owner Daily Brief ----

export type CrmDailyBriefSeverity = 'critical' | 'action' | 'info';

export type CrmDailyBriefWidget = {
  key: string;
  label: string;
  /** Primary numeric value; null means there was no sample (for example, no responses today). */
  value: number | null;
  /** Supporting record/sample count for monetary and average widgets. */
  count?: number;
  /** Decimal-safe monetary value when the widget represents money. */
  amount?: string;
  currency?: string;
  unit?: 'minutes';
  href: string;
  severity: CrmDailyBriefSeverity;
};

export type CrmDailyBrief = {
  generatedAt: string;
  widgets: CrmDailyBriefWidget[];
};

// ---- Phase 2 triage inputs ----

export type SendCrmMessageInput = {
  text: string;
  /** CUSTOMER = reply pushed to LINE; INTERNAL_NOTE = staff-only, never sent. */
  visibility?: CrmMessageVisibility;
};

export type SendCrmMessageResult = {
  message: CrmMessageSummary;
  conversation: CrmConversationSummary;
};

export type SetCrmConversationStatusInput = {
  status: CrmConversationStatus;
};

export type UpdateCrmConversationAutoReplyRequest = {
  enabled: boolean;
};

export type AssignCrmConversationInput = {
  /** null clears the assignment. */
  assignedToUserId: string | null;
};

export type SetCrmConversationPriorityInput = {
  priority: CrmConversationPriority;
};

export type SetCrmConversationTagsInput = {
  /** Full replacement; server trims, drops empties, dedupes case-insensitively. */
  tags: string[];
};

// ---- Message templates (quick replies) ----

export type CrmMessageTemplateStatus = 'ACTIVE' | 'ARCHIVED';

export type CrmMessageTemplateSummary = {
  id: string;
  companyId: string;
  title: string;
  bodyText: string;
  category?: string;
  status: CrmMessageTemplateStatus;
  version: number;
  aiApproved: boolean;
  aiApprovedVersion?: number;
  aiApprovedAt?: string;
  aiApprovedByUserId?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCrmMessageTemplateInput = {
  title: string;
  bodyText: string;
  category?: string;
};

export type UpdateCrmMessageTemplateInput = {
  title?: string;
  bodyText?: string;
  category?: string | null;
};

// ---- Inbox policy (first-response SLA settings) ----

export type CrmBusinessHours = {
  /** HH:MM 24h wall clock in `timezone`. */
  start: string;
  end: string;
  /** IANA timezone, e.g. Asia/Bangkok. */
  timezone: string;
};

export type CrmInboxPolicyDto = {
  firstResponseMinutes: number;
  /** null = SLA clock runs 24/7. */
  businessHours: CrmBusinessHours | null;
  /** true when the company has no saved row — values are the spec defaults. */
  isDefault: boolean;
  updatedAt?: string;
};

export type UpdateCrmInboxPolicyInput = {
  firstResponseMinutes: number;
  businessHours: CrmBusinessHours | null;
};

// ---- Phase 3: Customer 360 aggregate + unified timeline (spec section 10.3) ----
//
// Aggregates are read models composed from permission-checked sources. A block
// the caller may not see is null and its key is listed in `redactedSources`
// (per-source redaction, spec "Customer 360 aggregate"). A block that is
// visible but empty is present with empty/zero values — the web renders
// "no permission" and "no data yet" differently.

export type CrmCustomer360Source =
  | 'conversations'
  | 'deals'
  | 'tasks'
  | 'quotations'
  | 'finance'
  | 'activities';

/** Thin projection of an accounting document (item 08) for the finance tab. */
export type CrmCustomer360FinanceDocument = {
  id: string;
  documentType: string;
  documentNumber?: string;
  status: string;
  documentDate: string;
  dueDate?: string;
  currency: string;
  grandTotalAmount: string;
  outstandingAmount: string;
  paymentStatus?: string;
};

export type CrmCustomer360Summary = {
  customer: CrmCustomerDetail;
  /** Conversation numbers reflect the caller's inbox visibility scope; spam excluded. */
  conversations: {
    total: number;
    open: number;
    unread: number;
    lastMessageAt?: string;
  } | null;
  deals: {
    openCount: number;
    /** Sum of amountEstimate across OPEN deals visible to the caller. */
    openAmountTotal: string;
    latest?: CrmOpportunitySummary;
  } | null;
  tasks: {
    openCount: number;
    /** Earliest-due OPEN follow-up. */
    next?: CrmFollowUpSummary;
  } | null;
  quotations: CrmQuotationLinkSummary[] | null;
  /** null when the caller lacks accounting read; empty documents = no linked history. */
  finance: { documents: CrmCustomer360FinanceDocument[] } | null;
  redactedSources: CrmCustomer360Source[];
};

export type CrmReportsStatusBreakdownItem = { status: CrmConversationStatus; count: number; pct: number };
export type CrmReportsStaffPerformanceItem = {
  userId: string | null;
  displayName?: string;
  assigned: number;
  resolved: number;
  rate: number;
};
export type CrmReportsTopCustomer = {
  customerId: string;
  displayName: string;
  lifetimeValueAmount: string;
  tier: 'vip' | 'active' | 'lead';
};
export type CrmReportsRetention = {
  totalCount: number;
  returningCount: number;
  newCount: number;
  atRiskCount: number;
  repeatRatePct: number;
  churnRatePct: number;
  avgLtvAmount: string;
  atRiskName: string | null;
};
export type CrmReportsSummary = {
  total: number;
  resolved: number;
  resolvedRate: number;
  avgResponseMin: number | null;
  overdue: number;
  statusBreakdown: CrmReportsStatusBreakdownItem[];
  staffPerformance: CrmReportsStaffPerformanceItem[];
  topCustomers: CrmReportsTopCustomer[];
  retention?: CrmReportsRetention;
  branchId: string | null;
};

export type CrmCustomer360TimelineType =
  | 'ACTIVITY'
  | 'CONVERSATION_STARTED'
  | 'DEAL_CREATED'
  | 'TASK_CREATED'
  | 'FINANCE_DOCUMENT'
  | 'CONSENT_CHANGED';

export type CrmCustomer360TimelineEvent = {
  /** `${type}:${sourceId}` — stable across pages. */
  id: string;
  type: CrmCustomer360TimelineType;
  occurredAt: string;
  /** Source-record display string (activity note, deal/task title, document number). */
  title: string;
  detail?: string;
  actorUserId?: string;
  refType?: 'conversation' | 'opportunity' | 'followUp' | 'document' | 'activity' | 'customer';
  refId?: string;
  amount?: string;
  currency?: string;
};

export type CrmCustomer360Timeline = {
  /** Newest first. */
  events: CrmCustomer360TimelineEvent[];
  /** Pass as ?before= to fetch older events; absent when exhausted. */
  nextBefore?: string;
  redactedSources: CrmCustomer360Source[];
};
