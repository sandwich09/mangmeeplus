/**
 * Domain models for CRM and Sales (Item 15).
 * Plain TypeScript types — no Prisma, no NestJS imports.
 * Dates are Date objects; amounts are decimal strings.
 */

import type {
  CrmCustomerStatus,
  CrmCustomerType,
  CrmCustomerTier,
  CrmCustomerOriginSource,
  CrmCustomerCreatedByType,
  CrmConsentStatus,
  CrmContactStatus,
  CrmContactChannel,
  CrmLeadStatus,
  CrmLeadSource,
  CrmPipelineGroup,
  CrmOpportunityStatus,
  CrmActivityType,
  CrmActivityOutcome,
  CrmFollowUpStatus,
  CrmFollowUpPriority,
  CrmQuotationLinkStatus,
  CrmBookingStatus,
  CrmBookingSource,
} from '@watchdog-bms/contracts';

export type CrmCustomerRecord = {
  id: string;
  marketingRef: string;
  companyId: string;
  branchId?: string;
  accountingCounterpartyId?: string;
  code?: string;
  displayName: string;
  displayNameNormalized: string;
  legalName?: string;
  customerType: CrmCustomerType;
  status: CrmCustomerStatus;
  ownerUserId?: string;
  ownerTeamId?: string;
  primaryPhone?: string;
  primaryPhoneNormalized?: string;
  primaryEmail?: string;
  primaryEmailNormalized?: string;
  lineUserId?: string;
  facebookId?: string;
  taxId?: string;
  taxIdNormalized?: string;
  consentStatus: CrmConsentStatus;
  originSource: CrmCustomerOriginSource;
  createdByType: CrmCustomerCreatedByType;
  consentUpdatedAt?: Date;
  consentNote?: string;
  personalDataErasedAt?: Date;
  tier: CrmCustomerTier;
  engagementScore: number;
  lifetimeValueAmount?: string;
  source?: string;
  notes?: string;
  lastActivityAt?: Date;
  lastContactedAt?: Date;
  nextFollowUpAt?: Date;
  mergedIntoCustomerId?: string;
  archivedAt?: Date;
  archiveReason?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  contacts?: CrmContactRecord[];
  lineIdentities?: CrmCustomerLineIdentityRecord[];
};

export type CrmCustomerLineIdentityRecord = {
  id: string;
  companyId: string;
  channelId: string;
  customerId: string;
  provider: 'LINE_OA';
  providerUserId: string;
  displayName?: string;
  status: 'ACTIVE' | 'BLOCKED' | 'UNFOLLOWED';
  verifiedLinkAt?: Date;
  verifiedLinkVia?: 'LIFF' | 'STAFF';
};

export type CrmContactRecord = {
  id: string;
  companyId: string;
  customerId: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  lineUserId?: string;
  preferredChannel?: CrmContactChannel;
  consentStatus: CrmConsentStatus;
  isPrimary: boolean;
  note?: string;
  status: CrmContactStatus;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmLeadRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  source: CrmLeadSource;
  rawName?: string;
  rawPhone?: string;
  rawEmail?: string;
  status: CrmLeadStatus;
  assignedToUserId?: string;
  note?: string;
  convertedCustomerId?: string;
  convertedOpportunityId?: string;
  disqualifiedReason?: string;
  disqualifiedAt?: Date;
  convertedAt?: Date;
  createdByUserId?: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmPipelineStageRecord = {
  id: string;
  companyId: string;
  name: string;
  canonicalGroup: CrmPipelineGroup;
  sortOrder: number;
  probabilityDefault?: number;
  isTerminalWon: boolean;
  isTerminalLost: boolean;
  isActive: boolean;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmOpportunityRecord = {
  id: string;
  companyId: string;
  branchId?: string;
  customerId: string;
  customerDisplayName?: string;
  leadId?: string;
  ownerUserId: string;
  ownerTeamId?: string;
  title: string;
  stageId: string;
  canonicalStageGroup: CrmPipelineGroup;
  status: CrmOpportunityStatus;
  amountEstimate: string;
  currency: string;
  probability?: number;
  expectedCloseDate?: Date;
  closedAt?: Date;
  closedByUserId?: string;
  closeReason?: string;
  lostReason?: string;
  lastActivityAt?: Date;
  nextFollowUpAt?: Date;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  quotationLinks?: CrmQuotationLinkRecord[];
  followUps?: CrmFollowUpRecord[];
  activities?: CrmActivityRecord[];
};

export type CrmActivityRecord = {
  id: string;
  companyId: string;
  customerId: string;
  leadId?: string;
  opportunityId?: string;
  followUpTaskId?: string;
  actorUserId: string;
  type: CrmActivityType;
  channel?: CrmContactChannel;
  outcome?: CrmActivityOutcome;
  note: string;
  occurredAt: Date;
  createdAt: Date;
};

export type CrmFollowUpRecord = {
  id: string;
  companyId: string;
  customerId?: string;
  leadId?: string;
  opportunityId?: string;
  ownerUserId: string;
  ownerTeamId?: string;
  title: string;
  dueAt: Date;
  timezone: string;
  priority: CrmFollowUpPriority;
  channel: CrmContactChannel;
  status: CrmFollowUpStatus;
  completedAt?: Date;
  completedByUserId?: string;
  snoozedUntil?: Date;
  canceledAt?: Date;
  canceledByUserId?: string;
  cancelReason?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmQuotationLinkRecord = {
  id: string;
  companyId: string;
  customerId: string;
  opportunityId: string;
  accountingDocumentId: string;
  accountingDocumentType: string;
  accountingDocumentNumber?: string;
  status: CrmQuotationLinkStatus;
  grandTotalAmount?: string;
  currency: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
};

export type CrmBookingRecord = {
  id: string;
  companyId: string;
  branchId: string;
  customerId: string;
  customerName?: string;
  serviceName: string;
  staffUserId?: string;
  startAt: Date;
  endAt: Date;
  status: CrmBookingStatus;
  source?: CrmBookingSource;
  sourceConversationId?: string;
  /** Prisma Decimal (or string in fakes) — mapper renders with String(). */
  depositAmount?: unknown;
  totalAmount?: unknown;
  reminderSentAt?: Date;
  reminderClaimedAt?: Date;
  reminderAttemptCount: number;
  reminderNextAttemptAt?: Date;
  reminderLastError?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};
