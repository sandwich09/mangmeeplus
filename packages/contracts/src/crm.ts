// ---- Item 15: CRM and Sales MVP ----
//
// Business contract for the CRM and sales workflow. Web/API owns mutations.
// LINE and AI are read-only. Accounting Documents item 08 owns the official
// quotation lifecycle; CRM links/reuses a quotation draft only.
// Monetary amounts are decimal strings. Dates are ISO strings across the wire.

// ---- Enumerations (spec section 10) ----

export type CrmCustomerStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' | 'MERGED';
export type CrmCustomerType = 'PERSON' | 'ORGANIZATION' | 'UNKNOWN';

export type CrmLeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'DISQUALIFIED' | 'ARCHIVED';
export type CrmLeadSource =
  | 'MANUAL'
  | 'CSV_IMPORT'
  | 'LINE'
  | 'FACEBOOK'
  | 'MARKETPLACE'
  | 'WEB_FORM'
  | 'REFERRAL'
  | 'OTHER';

export type CrmOpportunityStatus = 'OPEN' | 'WON' | 'LOST' | 'ARCHIVED';

export type CrmPipelineGroup =
  | 'NEW_LEAD'
  | 'CONTACTED'
  | 'QUALIFIED'
  | 'QUOTATION'
  | 'NEGOTIATION'
  | 'WON'
  | 'LOST';

export type CrmActivityType =
  | 'CALL'
  | 'CHAT'
  | 'EMAIL'
  | 'VISIT'
  | 'MEETING'
  | 'NOTE'
  | 'QUOTE_DRAFT_CREATED'
  | 'QUOTE_SENT'
  | 'STAGE_CHANGED'
  | 'TASK_CREATED'
  | 'TASK_COMPLETED'
  | 'CUSTOMER_UPDATED'
  | 'OTHER';

export type CrmActivityOutcome =
  | 'POSITIVE'
  | 'NEUTRAL'
  | 'NEGATIVE'
  | 'NO_RESPONSE'
  | 'NEEDS_FOLLOW_UP'
  | 'COMPLETED'
  | 'OTHER';

export type CrmFollowUpStatus = 'OPEN' | 'DONE' | 'SNOOZED' | 'CANCELED' | 'OVERDUE';
export type CrmFollowUpPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type CrmContactChannel = 'PHONE' | 'LINE' | 'EMAIL' | 'FACEBOOK' | 'MARKETPLACE_CHAT' | 'VISIT' | 'OTHER';
export type CrmConsentStatus = 'UNKNOWN' | 'GRANTED' | 'REVOKED' | 'NOT_REQUIRED';
export type CrmContactStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

export type CrmQuotationLinkStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'ISSUED'
  | 'VOIDED'
  | 'CONVERTED'
  | 'UNKNOWN';

// ---- Customer ----

export type CrmCustomerTier = 'VIP' | 'ACTIVE' | 'LEAD';
export type CrmCustomerOriginSource =
  | 'MANUAL'
  | 'LINE'
  | 'WALK_IN'
  | 'PHONE'
  | 'WEB'
  | 'FACEBOOK'
  | 'MARKETPLACE'
  | 'REFERRAL'
  | 'IMPORT'
  | 'OTHER';
export type CrmCustomerCreatedByType = 'USER' | 'SYSTEM' | 'AI_ASSISTED';

export type CrmCustomerSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  accountingCounterpartyId?: string;
  code?: string;
  displayName: string;
  legalName?: string;
  customerType: CrmCustomerType;
  status: CrmCustomerStatus;
  ownerUserId?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  taxId?: string;
  consentStatus: CrmConsentStatus;
  originSource: CrmCustomerOriginSource;
  createdByType: CrmCustomerCreatedByType;
  lineIdentityCount: number;
  lineIdentityStatus?: 'ACTIVE' | 'BLOCKED' | 'UNFOLLOWED';
  hasVerifiedLineIdentity: boolean;
  tier: CrmCustomerTier;
  engagementScore: number;
  lifetimeValueAmount?: string;
  lastActivityAt?: string;
  nextFollowUpAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CrmCustomerDetail = CrmCustomerSummary & {
  lineIdentities: CrmCustomerLineIdentitySummary[];
  facebookId?: string;
  /** @deprecated Legacy provenance string. Use originSource. */
  source?: string;
  notes?: string;
  consentUpdatedAt?: string;
  consentNote?: string;
  archivedAt?: string;
  archiveReason?: string;
  mergedIntoCustomerId?: string;
  contacts: CrmContactSummary[];
};

/**
 * Server-selected customer projections. Callers must narrow on `projection`;
 * accounting and marketing records are intentionally not assignable to the
 * operational customer DTO.
 */
export type CrmCustomerProjection = 'OPERATIONAL' | 'ACCOUNTING_CONTACT' | 'MARKETING';

export type CrmAccountingCustomerSummary = {
  id: string;
  code?: string;
  displayName: string;
  legalName?: string;
  customerType: CrmCustomerType;
  status: CrmCustomerStatus;
  branchId?: string;
  accountingCounterpartyId?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  taxId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CrmAccountingContactSummary = {
  id: string;
  customerId: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  preferredChannel?: CrmContactChannel;
  isPrimary: boolean;
  status: CrmContactStatus;
};

export type CrmAccountingCustomerDetail = CrmAccountingCustomerSummary & {
  contacts: CrmAccountingContactSummary[];
};

export type CrmMarketingCustomerSummary = {
  /** Random, output-only reference. It is never the canonical customer id. */
  customerRef: string;
  status: CrmCustomerStatus;
  consentStatus: CrmConsentStatus;
  originSource: CrmCustomerOriginSource;
  tier: CrmCustomerTier;
  segmentIds: string[];
};

export type CrmProjectedCustomerSummary =
  | { projection: 'OPERATIONAL'; customer: CrmCustomerSummary }
  | { projection: 'ACCOUNTING_CONTACT'; customer: CrmAccountingCustomerSummary }
  | { projection: 'MARKETING'; customer: CrmMarketingCustomerSummary };

export type CrmProjectedCustomerDetail =
  | { projection: 'OPERATIONAL'; customer: CrmCustomerDetail }
  | { projection: 'ACCOUNTING_CONTACT'; customer: CrmAccountingCustomerDetail };

export type ListCrmCustomersResult = {
  items: CrmProjectedCustomerSummary[];
  total: number;
  page: number;
  pageSize: number;
};

export type CrmDuplicateWarning = {
  customerId: string;
  displayName: string;
  status?: CrmCustomerStatus;
  redacted?: boolean;
  matchType: 'TAX_ID' | 'EMAIL' | 'PHONE' | 'NAME';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
};

export type CrmCustomerLineIdentitySummary = {
  id: string;
  channelId: string;
  provider: 'LINE_OA';
  displayName?: string;
  maskedProviderUserId: string;
  status: 'ACTIVE' | 'BLOCKED' | 'UNFOLLOWED';
  verifiedLinkAt?: string;
  verifiedLinkVia?: 'LIFF' | 'STAFF';
};

export type CreateCrmCustomerInput = {
  branchId?: string;
  code?: string;
  displayName: string;
  legalName?: string;
  customerType?: CrmCustomerType;
  ownerUserId?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  facebookId?: string;
  taxId?: string;
  accountingCounterpartyId?: string;
  consentStatus?: CrmConsentStatus;
  consentNote?: string;
  tier?: CrmCustomerTier;
  originSource?: CrmCustomerOriginSource;
  /** AI_ASSISTED requires crm.ai.assist; SYSTEM is internal-only. */
  createdByType?: Extract<CrmCustomerCreatedByType, 'USER' | 'AI_ASSISTED'>;
  /** @deprecated Accepted temporarily for old clients; the API maps it to originSource. */
  source?: string;
  notes?: string;
  /** Required to proceed after exact phone/email duplicate candidates are returned. */
  duplicateOverride?: boolean;
};

export type UpdateCrmCustomerInput = Partial<
  Omit<CreateCrmCustomerInput, 'code' | 'originSource' | 'createdByType' | 'source' | 'duplicateOverride'>
> & {
  status?: CrmCustomerStatus;
  tier?: CrmCustomerTier;
  duplicateOverride?: boolean;
};

export type ArchiveCrmCustomerInput = { reason: string; override?: boolean };
export type AssignCrmCustomerInput = { ownerUserId: string };

export type ListCrmCustomersFilter = {
  scope?: 'own' | 'all';
  status?: CrmCustomerStatus;
  ownerUserId?: string;
  tier?: CrmCustomerTier;
  search?: string;
  sortBy?: 'updatedAt' | 'ltv';
  page?: number;
  pageSize?: number;
};

export type CreateCrmCustomerResult = {
  customer: CrmCustomerSummary;
  duplicateWarnings: CrmDuplicateWarning[];
};

/** Keeps the existing top-level customer response shape and adds duplicate evidence. */
export type UpdateCrmCustomerResult = CrmCustomerSummary & {
  duplicateWarnings: CrmDuplicateWarning[];
};

export type MergeCrmCustomersInput = {
  primaryCustomerId: string;
  secondaryCustomerId: string;
  reason: string;
};

export type CrmCustomerMergeImpact = {
  bookings: number;
  contacts: number;
  opportunities: number;
  activities: number;
  followUps: number;
  quotationLinks: number;
  convertedLeads: number;
  lineIdentities: number;
  conversations: number;
};

export type PreviewCrmCustomerMergeResult = {
  primary: CrmCustomerSummary;
  secondary: CrmCustomerSummary;
  impact: CrmCustomerMergeImpact;
  conflicts: string[];
  canMerge: boolean;
};

export type MergeCrmCustomersResult = {
  customer: CrmCustomerSummary;
  mergedCustomerId: string;
  impact: CrmCustomerMergeImpact;
};

export type LinkCrmCustomerLineIdentityInput = {
  /** Optimistic lock: the identity must still point at this customer. */
  expectedCurrentCustomerId: string;
  reason: string;
};

export type LinkCrmCustomerLineIdentityResult = {
  customer: CrmCustomerSummary;
  identity: CrmCustomerLineIdentitySummary;
  previousCustomerId: string;
};

// ---- Contact ----

export type CrmContactSummary = {
  id: string;
  companyId: string;
  customerId: string;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  preferredChannel?: CrmContactChannel;
  consentStatus: CrmConsentStatus;
  isPrimary: boolean;
  note?: string;
  status: CrmContactStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreateCrmContactInput = {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
  preferredChannel?: CrmContactChannel;
  consentStatus?: CrmConsentStatus;
  isPrimary?: boolean;
  note?: string;
};

export type UpdateCrmContactInput = Partial<CreateCrmContactInput> & { status?: CrmContactStatus };

// ---- Lead ----

export type CrmLeadSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  source: CrmLeadSource;
  rawName?: string;
  rawPhone?: string;
  rawEmail?: string;
  status: CrmLeadStatus;
  assignedToUserId?: string;
  convertedCustomerId?: string;
  convertedOpportunityId?: string;
  disqualifiedReason?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCrmLeadInput = {
  branchId?: string;
  source?: CrmLeadSource;
  rawName?: string;
  rawPhone?: string;
  rawEmail?: string;
  assignedToUserId?: string;
  note?: string;
};

export type UpdateCrmLeadInput = Partial<CreateCrmLeadInput> & { status?: CrmLeadStatus };
export type AssignCrmLeadInput = { assignedToUserId: string };
export type DisqualifyCrmLeadInput = { reason: string };

export type ConvertCrmLeadInput = {
  // Link an existing customer, or create a new one from lead data.
  existingCustomerId?: string;
  customer?: CreateCrmCustomerInput;
  // Optional opportunity to open on conversion.
  opportunityTitle?: string;
  amountEstimate?: string;
  idempotencyKey?: string;
};

export type ConvertCrmLeadResult = {
  lead: CrmLeadSummary;
  customer: CrmCustomerSummary;
  opportunity?: CrmOpportunitySummary;
};

export type ListCrmLeadsFilter = {
  scope?: 'own' | 'all';
  status?: CrmLeadStatus;
  source?: CrmLeadSource;
  assignedToUserId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

// ---- Pipeline stage ----

export type CrmPipelineStageSummary = {
  id: string;
  companyId: string;
  name: string;
  canonicalGroup: CrmPipelineGroup;
  sortOrder: number;
  probabilityDefault?: number;
  isTerminalWon: boolean;
  isTerminalLost: boolean;
  isActive: boolean;
};

export type UpdateCrmPipelineStageInput = {
  id?: string;
  name: string;
  canonicalGroup: CrmPipelineGroup;
  sortOrder: number;
  probabilityDefault?: number;
  isActive?: boolean;
};

export type UpdateCrmPipelineStagesInput = { stages: UpdateCrmPipelineStageInput[] };

// ---- Opportunity ----

export type CrmOpportunitySummary = {
  id: string;
  companyId: string;
  branchId?: string;
  customerId: string;
  customerDisplayName?: string;
  leadId?: string;
  ownerUserId: string;
  title: string;
  stageId: string;
  canonicalStageGroup: CrmPipelineGroup;
  status: CrmOpportunityStatus;
  amountEstimate: string;
  currency: string;
  probability?: number;
  expectedCloseDate?: string;
  closedAt?: string;
  closeReason?: string;
  lostReason?: string;
  lastActivityAt?: string;
  nextFollowUpAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CrmOpportunityDetail = CrmOpportunitySummary & {
  createdByUserId: string;
  quotationLinks: CrmQuotationLinkSummary[];
  followUps: CrmFollowUpSummary[];
  activities: CrmActivitySummary[];
};

export type CreateCrmOpportunityInput = {
  customerId: string;
  branchId?: string;
  leadId?: string;
  ownerUserId?: string;
  title: string;
  stageId?: string;
  amountEstimate?: string;
  currency?: string;
  probability?: number;
  expectedCloseDate?: string;
};

export type UpdateCrmOpportunityInput = {
  title?: string;
  ownerUserId?: string;
  amountEstimate?: string;
  currency?: string;
  probability?: number;
  expectedCloseDate?: string;
};

export type MoveCrmOpportunityStageInput = { stageId: string; note?: string };
export type CloseCrmOpportunityInput = {
  result: 'WON' | 'LOST';
  reason?: string;
  winReason?: string;
};
export type ReopenCrmOpportunityInput = { stageId?: string; reason: string };

export type ListCrmOpportunitiesFilter = {
  scope?: 'own' | 'all';
  status?: CrmOpportunityStatus;
  stageId?: string;
  customerId?: string;
  ownerUserId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
};

export type CrmPipelineBoardColumn = {
  stage: CrmPipelineStageSummary;
  opportunities: CrmOpportunitySummary[];
  count: number;
  totalAmount: string;
};

export type CrmPipelineBoard = { columns: CrmPipelineBoardColumn[] };

// ---- Activity ----

export type CrmActivitySummary = {
  id: string;
  companyId: string;
  customerId?: string;
  leadId?: string;
  opportunityId?: string;
  followUpTaskId?: string;
  actorUserId: string;
  type: CrmActivityType;
  channel?: CrmContactChannel;
  outcome?: CrmActivityOutcome;
  note: string;
  occurredAt: string;
  createdAt: string;
};

export type CreateCrmActivityInput = {
  customerId?: string;
  leadId?: string;
  opportunityId?: string;
  type: CrmActivityType;
  channel?: CrmContactChannel;
  outcome?: CrmActivityOutcome;
  note: string;
  occurredAt?: string;
};

export type ListCrmActivitiesFilter = {
  customerId?: string;
  opportunityId?: string;
  leadId?: string;
  actorUserId?: string;
  page?: number;
  pageSize?: number;
};

// ---- Follow-up task ----

export type CrmFollowUpSummary = {
  id: string;
  companyId: string;
  customerId?: string;
  leadId?: string;
  opportunityId?: string;
  ownerUserId: string;
  title: string;
  dueAt: string;
  timezone: string;
  priority: CrmFollowUpPriority;
  channel: CrmContactChannel;
  status: CrmFollowUpStatus;
  completedAt?: string;
  snoozedUntil?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateCrmFollowUpInput = {
  customerId?: string;
  leadId?: string;
  opportunityId?: string;
  ownerUserId?: string;
  title: string;
  dueAt: string;
  timezone?: string;
  priority?: CrmFollowUpPriority;
  channel?: CrmContactChannel;
};

export type UpdateCrmFollowUpInput = {
  title?: string;
  dueAt?: string;
  priority?: CrmFollowUpPriority;
  channel?: CrmContactChannel;
};

export type CompleteCrmFollowUpInput = {
  outcome?: CrmActivityOutcome;
  note?: string;
  // Optionally chain the next follow-up in the same transaction.
  nextFollowUp?: CreateCrmFollowUpInput;
};

export type SnoozeCrmFollowUpInput = { snoozedUntil: string };
export type CancelCrmFollowUpInput = { reason: string };

export type ListCrmFollowUpsFilter = {
  scope?: 'own' | 'all';
  status?: CrmFollowUpStatus;
  view?: 'due_today' | 'overdue' | 'upcoming';
  customerId?: string;
  opportunityId?: string;
  ownerUserId?: string;
  page?: number;
  pageSize?: number;
};

// ---- Quotation link ----

export type CrmQuotationLinkSummary = {
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
  createdAt: string;
  updatedAt: string;
};

export type CreateCrmQuotationDraftInput = {
  // Provide a reason to create an additional draft while an active link exists.
  revisionReason?: string;
  idempotencyKey?: string;
};

// ---- AI / LINE read models (read-only, source-backed) ----

export type CrmSourceRef = { type: string; id: string; deepLink: string };

export type CrmFollowUpPriorityItem = {
  followUp: CrmFollowUpSummary;
  score: number;
  reason: string;
  source: CrmSourceRef;
};

export type CrmAiFollowUpPriorities = {
  items: CrmFollowUpPriorityItem[];
  generatedAt: string;
};

export type CrmAiCustomerSummary = {
  customer: CrmCustomerSummary;
  openOpportunities: number;
  openFollowUps: number;
  recentActivities: CrmActivitySummary[];
  source: CrmSourceRef;
};

export type CrmAiOpportunitySummary = {
  opportunity: CrmOpportunitySummary;
  quotationStatus?: CrmQuotationLinkStatus;
  daysSinceLastActivity?: number;
  source: CrmSourceRef;
};

export type CrmPipelineStageSummaryStat = {
  stage: CrmPipelineStageSummary;
  count: number;
  totalAmount: string;
};

export type CrmAiPipelineSummary = {
  stages: CrmPipelineStageSummaryStat[];
  openCount: number;
  totalPipelineAmount: string;
  stuckOpportunities: number;
  generatedAt: string;
};

// ---- Dashboard hooks ----

export type CrmDashboardSummary = {
  pipelineOpenCount: number;
  pipelineTotalAmount: string;
  followUpsDueToday: number;
  followUpsOverdue: number;
  unassignedLeads: number;
  stuckOpportunities: number;
};

// ---- มั่งมี Flow A (spec D8): bookings / appointment calendar ----

export type CrmBookingStatus = 'BOOKED' | 'CANCELLED' | 'DONE' | 'NO_SHOW';
export type CrmBookingSource = 'STAFF' | 'LINE' | 'WEB' | 'PHONE' | 'FACEBOOK' | 'WALK_IN' | 'OTHER';
export type CrmStaffBookingSource = Exclude<CrmBookingSource, 'LINE'>;

// staffUserId everywhere in the booking API is a User id (CompanyMembership.userId) —
// the same space as conversation.assignedToUserId, channel.defaultBookingStaffUserId,
// and notification recipients. It is NOT an EmployeeAccessProfile id; UI pickers built
// on EmployeeSummary must send/match EmployeeSummary.userId, never EmployeeSummary.id.

export type CrmBookingSummary = {
  id: string;
  companyId: string;
  branchId: string;
  customerId: string;
  customerName?: string;
  serviceName: string;
  staffUserId?: string; // User id, not EmployeeAccessProfile id (see note above)
  startAt: string;
  endAt: string;
  status: CrmBookingStatus;
  source?: CrmBookingSource;
  sourceConversationId?: string;
  /** Snapshot amounts (บาท, decimal string) entered at booking time; outstanding = totalAmount - depositAmount. */
  depositAmount?: string;
  totalAmount?: string;
  createdAt: string;
  updatedAt: string;
};

export type ListCrmBookingsFilter = {
  branchId?: string;
  weekStart?: string; // ISO date (yyyy-mm-dd); server returns the ISO week containing it
};

export type CrmBookingAvailabilityQuery = {
  branchId?: string;
  staffUserId?: string; // User id (see booking id-space note above)
  date?: string; // Bangkok calendar date (yyyy-mm-dd)
  durationMinutes: number;
};

export type CrmBookingAvailabilityResult = {
  date: string;
  durationMinutes: number;
  bufferMinutes: number;
  freeStartTimes: string[];
};

export const CRM_BOOKING_BUFFER_MINUTE_OPTIONS = [0, 30, 60, 90, 120] as const;
export type CrmBookingBufferMinutes = (typeof CRM_BOOKING_BUFFER_MINUTE_OPTIONS)[number];
export type CrmBookingSettings = { bufferMinutes: CrmBookingBufferMinutes };
export type UpdateCrmBookingSettingsInput = CrmBookingSettings;

export type CreateCrmBookingInput = {
  branchId: string;
  customerId: string;
  serviceName: string;
  staffUserId?: string; // User id of an active company member (server-validated)
  startAt: string;
  endAt: string;
  source?: CrmStaffBookingSource;
  /** Optional amounts (บาท, decimal string ≥ 0; deposit ≤ total when both sent). */
  depositAmount?: string;
  totalAmount?: string;
};

export type UpdateCrmBookingInput = Partial<Omit<CreateCrmBookingInput, 'branchId' | 'source'>> & {
  status?: CrmBookingStatus;
};
