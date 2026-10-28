export type HealthStatus = {
  service: string;
  status: 'ok';
  timestamp: string;
};
export * from './company-business-type.js';
export * from './report-labels.js';
export * from './billing-company-profile.js';

export type TenantContext = {
  companyId: string;
  userId: string;
  roles: string[];
};

export type AuthProvider = 'watchdog' | 'line' | 'dev' | 'system';

export type RequestContext = {
  requestId: string;
  authSubject: string;
  sessionId?: string;
  userId: string;
  companyId: string;
  membershipId: string;
  roles: string[];
  permissions: string[];
  freeExpenseDrafts?: boolean;
  entitlementDeniedPermissions?: Record<string, string>;
  scopes: { branchIds?: string[]; locationIds?: string[]; teamIds?: string[] };
  authProvider: AuthProvider;
};

export type PermissionKey = string;

export type AuditResult = 'SUCCESS' | 'DENIED' | 'FAILED';
export type AuditRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type AuditEventInput = {
  companyId?: string;
  actorUserId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  requestId: string;
  result: AuditResult;
  riskLevel?: AuditRiskLevel;
  metadataJson?: Record<string, unknown>;
};

// ---- Data Model Core (Item 04) ----

export type CoreRecordStatus = 'active' | 'inactive' | 'archived';

export type AddressSnapshot = {
  line1: string;
  line2?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  countryCode: 'TH' | string;
};

// Branch
export type BranchType = 'head_office' | 'branch' | 'online' | 'warehouse';
export type BranchStatus = 'active' | 'disabled' | 'archived';

export type BranchSummary = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: BranchType;
  isVatEstablishment: boolean;
  taxBranchCode?: string | null;
  status: BranchStatus;
};

export type BranchDetail = BranchSummary & {
  phone?: string;
  email?: string;
  addressJson?: AddressSnapshot;
  createdAt: string;
  updatedAt: string;
};

export type CreateBranchDto = {
  code: string;
  name: string;
  type: BranchType;
  taxBranchCode?: string | null;
  phone?: string;
  email?: string;
  addressJson?: AddressSnapshot;
};

export type UpdateBranchDto = {
  name?: string;
  taxBranchCode?: string | null;
  phone?: string;
  email?: string;
  addressJson?: AddressSnapshot;
  status?: BranchStatus;
};

export type ListBranchesQuery = {
  status?: BranchStatus;
  type?: BranchType;
  page?: number;
  pageSize?: number;
};

export type PaginatedBranchesDto = {
  items: BranchSummary[];
  total: number;
  page: number;
  pageSize: number;
};

// Attachments
export type AttachmentStatus = 'pending_upload' | 'active' | 'quarantined' | 'deleted';
export type AttachmentVisibility = 'internal' | 'accounting' | 'audit' | 'customer_visible';

export type AttachmentObjectSummary = {
  id: string;
  companyId: string;
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  checksumSha256?: string;
  status: AttachmentStatus;
  visibility: AttachmentVisibility;
  uploadedAt?: string;
};

export type UploadIntentDto = {
  attachmentId: string;
  uploadUrl: string;
  uploadMethod: 'PUT' | 'POST';
  uploadHeaders: Record<string, string>;
  expiresAt: string;
};

export type CreateUploadIntentDto = {
  originalFileName: string;
  mimeType: string;
  byteSize: number;
  branchId?: string;
  visibility?: AttachmentVisibility;
};

export type CompleteUploadDto = {
  checksumSha256?: string;
  byteSize?: number;
};

export type AttachmentLinkDto = {
  targetType: string;
  targetId: string;
  purpose: string;
};

// Document Sequences
// Uppercase to match the Prisma enum the column actually stores; this union was
// lowercase, so any client that trusted it would have produced a 500 at the insert.
// Kept as a runtime array so prisma-enum-parity.spec.ts holds it to the schema.
export const DOCUMENT_RESET_POLICIES = ['NONE', 'MONTHLY', 'YEARLY'] as const;
export type DocumentResetPolicy = (typeof DOCUMENT_RESET_POLICIES)[number];
export type DocumentNumberStatus = 'reserved' | 'committed' | 'cancelled' | 'voided';

export type DocumentSequenceDto = {
  id: string;
  companyId: string;
  branchId?: string;
  documentType: string;
  periodKey: string;
  prefixTemplate: string;
  nextNumber: number;
  padding: number;
  resetPolicy: DocumentResetPolicy;
  status: 'active' | 'disabled';
};

export type UpsertDocumentSequenceDto = {
  branchId?: string;
  periodKey?: string;
  prefixTemplate: string;
  padding?: number;
  resetPolicy?: DocumentResetPolicy;
};

export type ReservedDocumentNumber = {
  id: string;
  documentType: string;
  documentNumber: string;
  status: DocumentNumberStatus;
};

// Outbox
export type OutboxEventStatus = 'pending' | 'processing' | 'published' | 'failed' | 'dead';
export type OutboxEventPriority = 'low' | 'normal' | 'high';

export type OutboxEventSummary = {
  id: string;
  companyId?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  status: OutboxEventStatus;
  priority: OutboxEventPriority;
  attempts: number;
  createdAt: string;
};

export type OutboxEventContract<TPayload = unknown> = {
  id: string;
  companyId?: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: TPayload;
  occurredAt: string;
};

// ---- Inventory (Item 05) ----
export * from './inventory.js';

// ---- Dashboard and Notification (Item 06) ----
export * from './dashboard.js';
export * from './notifications.js';
export * from './reports.js';

// ---- LINE AI Read-Only Assistant (Item 07) ----
export * from './ai-lineage.js';
export * from './ai-timeouts.js';
export * from './ai-budget-bounds.js';
export * from './line-ai.js';
export * from './line-ai-input-evidence.js';
export * from './line-ai-prepared-plan.js';
export * from './line-ai-advisor-answer.js';
export * from './line-ai-public-lookup.js';
export * from './line-reimbursement-draft.js';
export * from './line-ai-security-eval.js';
export * from './ai-tools.js';
// ---- LINE AI Multi-Intent Completion (Item 10F) ----
export * from './line-ai-value-normalizer.js';

export type CoreOutboxPayload = {
  companyId?: string;
  actorUserId?: string;
  requestId?: string;
  aggregateType: string;
  aggregateId: string;
  occurredAt: string;
  data: Record<string, unknown>;
};

export * from './accounting-documents.js';
export * from './expenses.js';
export * from './disbursement-vouchers.js';
export * from './expense-capture.js';
export * from './expense-capture-allocation.js';
export * from './ledger.js';
export * from './partner-management.js';
export * from './external-signup.js';
export * from './plan-term.js';
export * from './line-external-browser.js';
export * from './sales.js';
export * from './tax.js';
export * from './transaction-tax.js';
export * from './procurement.js';
export * from './banking.js';
export * from './reimbursements.js';
export * from './crm.js';
export * from './crm-inbox.js';
export * from './crm-campaign.js';
export * from './crm-ai.js';
export * from './employee-access.js';
export * from './workflow.js';
export * from './ai-draft-suggestion.js';
export * from './access-matrix.js';
export * from './feature-entitlements.js';
export * from './menu-entitlements.js';
export * from './business-policy.js';
export * from './legal-acceptance.js';
export * from './data-rights.js';
export * from './company-profile.js';
export * from './civil-date.js';
export * from './buyer-snapshot-v1.js';
export * from './company-tax-identity.js';
export * from './substitute-receipt-presentation.js';

export * from './billing.js';

export * from './billing-labels.js';
export * from './email-delivery.js';
export * from './line-document-qa.js';
export * from './expense-capture-evidence.js';

export * from './executive-business.js';

export * from './executive-report-words.js';

export * from './company-team-note.js';
export * from './home-theme.js';
