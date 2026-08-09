// ---- Item 14: Reimbursement Approval and Review ----
//
// Business contract for the reimbursement workflow. All monetary amounts are
// decimal strings (4 dp in DB). Dates are ISO strings across the wire.

export type ReimbursementRequestStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'FINANCE_REVIEW'
  | 'READY_FOR_PAYMENT'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'VOIDED';

export type ReimbursementApprovalStepStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'SKIPPED'
  | 'EXPIRED';

export type ReimbursementFinanceReviewStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'NEEDS_INFO'
  | 'APPROVED_FOR_PAYMENT'
  | 'BLOCKED';

export type ReimbursementPaymentStatus =
  | 'NOT_PAYABLE'
  | 'UNPAID'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'VOIDED';

export type ReimbursementDuplicateStatus =
  | 'NOT_CHECKED'
  | 'NO_MATCH'
  | 'POSSIBLE_DUPLICATE'
  | 'CONFIRMED_DUPLICATE'
  | 'OVERRIDDEN';

export type ReimbursementReceiptRequirementStatus =
  | 'REQUIRED'
  | 'ATTACHED'
  | 'MISSING_WITH_REASON'
  | 'WAIVED_BY_POLICY';

export type ReimbursementPostingStatus =
  | 'not_required'
  | 'pending'
  | 'posted'
  | 'posting_error'
  | 'reversed';

export type ReimbursementPaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHEQUE' | 'OTHER';

export type ReimbursementApproverMode =
  | 'DIRECT_MANAGER'
  | 'MANAGER_ROLE'
  | 'OWNER_ROLE'
  | 'CUSTOM_USER'
  | 'CUSTOM_ROLE';

export type ReimbursementDuplicatePolicy = 'WARN' | 'BLOCK_SUBMIT' | 'BLOCK_PAYMENT';

export type ReimbursementPolicyStatus = 'ACTIVE' | 'INACTIVE';

// ---- Policy ----

export type ReimbursementPolicySummary = {
  id: string;
  companyId: string;
  branchId?: string;
  currency: string;
  approvalThresholdAmount: string;
  approvalRequiredFromAmount: string;
  approverMode: ReimbursementApproverMode;
  defaultApproverUserId?: string;
  defaultApproverRole?: string;
  allowSelfApproval: boolean;
  requireReceipt: boolean;
  allowMissingReceiptWithReason: boolean;
  duplicatePolicy: ReimbursementDuplicatePolicy;
  financeReviewRequired: boolean;
  slaHours?: number;
  status: ReimbursementPolicyStatus;
  createdAt: string;
  updatedAt: string;
};

export type UpdateReimbursementPolicyInput = {
  currency?: string;
  approvalThresholdAmount?: string;
  approvalRequiredFromAmount?: string;
  approverMode?: ReimbursementApproverMode;
  defaultApproverUserId?: string | null;
  defaultApproverRole?: string | null;
  allowSelfApproval?: boolean;
  requireReceipt?: boolean;
  allowMissingReceiptWithReason?: boolean;
  duplicatePolicy?: ReimbursementDuplicatePolicy;
  financeReviewRequired?: boolean;
  slaHours?: number | null;
  status?: ReimbursementPolicyStatus;
};

// ---- Approval step ----

export type ReimbursementApprovalStepSummary = {
  id: string;
  sequenceNo: number;
  approverUserId?: string;
  /** Resolved on the detail read path — a cuid is unusable on screen and on paper. */
  approverName?: string;
  approverRoleSnapshot?: string;
  status: ReimbursementApprovalStepStatus;
  assignedAt: string;
  decidedAt?: string;
  decisionByUserId?: string;
  decidedByName?: string;
  comment?: string;
  rejectionReason?: string;
  invalidatedAt?: string;
  invalidatedReason?: string;
};

// ---- Payment ----

export type ReimbursementPaymentSummary = {
  id: string;
  paymentNo?: string;
  paidAmount: string;
  currency: string;
  paymentMethod: ReimbursementPaymentMethod;
  paidAt: string;
  paymentReference?: string;
  bankAccountId?: string;
  sourcePaymentRef: string;
  status: 'RECORDED' | 'VOIDED';
  voidedAt?: string;
  voidReason?: string;
  postingStatus: ReimbursementPostingStatus;
  paidByUserId?: string;
  paidByName?: string;
};

// ---- Duplicate candidate ----

export type ReimbursementDuplicateCandidateSummary = {
  id: string;
  candidateType: 'ATTACHMENT_CHECKSUM' | 'EXPENSE_LINK' | 'AMOUNT_DATE_VENDOR' | 'MANUAL';
  candidateRequestId?: string;
  candidateExpenseId?: string;
  score: number;
  status: 'OPEN' | 'DISMISSED' | 'CONFIRMED' | 'OVERRIDDEN';
  reason?: string;
};

// ---- Lines (1 ใบเบิก หลายรายการ) ----
//
// One claim holds many expense rows. There is no currency on a line: the header
// currency applies to the whole claim, and the header `amount` is the
// server-computed rollup of the line amounts (clients never send a total).

export type ReimbursementLineInput = {
  lineNo: number;
  incurredDate: string;
  description: string;
  purpose?: string;
  categoryKey: string;
  categoryLabel?: string;
  amount: string;
  attachmentId?: string | null;
  linkedExpenseId?: string | null;
};

export type ReimbursementLineSummary = {
  id: string;
  lineNo: number;
  incurredDate: string;
  description: string;
  purpose?: string;
  categoryKey: string;
  categoryLabelSnapshot?: string;
  amount: string;
  attachmentId?: string;
  attachmentFileName?: string;
  linkedExpenseId?: string;
};

// ---- Request ----

export type ReimbursementRequestSummary = {
  id: string;
  companyId: string;
  branchId?: string;
  requestNo?: string;
  requesterUserId: string;
  requesterDisplayNameSnapshot: string;
  title?: string;
  reason: string;
  categoryKey: string;
  categoryLabelSnapshot?: string;
  amount: string;
  currency: string;
  incurredDate: string;
  status: ReimbursementRequestStatus;
  financeReviewStatus: ReimbursementFinanceReviewStatus;
  paymentStatus: ReimbursementPaymentStatus;
  duplicateStatus: ReimbursementDuplicateStatus;
  receiptRequirementStatus: ReimbursementReceiptRequirementStatus;
  postingStatus: ReimbursementPostingStatus;
  paymentTotalAmount: string;
  outstandingAmount: string;
  lineCount: number;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

// ---- Claim-form signatures + signed copies (lane F) ----
//
// A role can only be signed by the real actor of that step, so at most four
// signatures exist per claim. The signed scan uploaded back into the system is
// the immutable record; the rendered form itself stays on-demand.

export type ReimbursementClaimSignatureRole = 'REQUESTER' | 'APPROVER' | 'FINANCE_REVIEW' | 'PAYER';

export type ReimbursementClaimSignatureSummary = {
  role: ReimbursementClaimSignatureRole;
  signedByUserId: string;
  signedByName?: string;
  signedAt: string;
};

export type ReimbursementSignedCopySummary = {
  attachmentId: string;
  fileName: string;
  uploadedAt: string;
};

export type SignReimbursementClaimFormInput = {
  role: ReimbursementClaimSignatureRole;
  signatureAttachmentId: string;
  /** The hash the signer previewed — the server recomputes it and rejects `stale_claim_snapshot`. */
  snapshotHash: string;
};

export type LinkReimbursementSignedCopyInput = {
  attachmentId: string;
};

export type ReimbursementRequestDetail = ReimbursementRequestSummary & {
  currentApproverUserId?: string;
  currentApprovalStepId?: string;
  rejectionReason?: string;
  financeReviewedByUserId?: string;
  financeReviewedByName?: string;
  financeReviewedAt?: string;
  financeReviewNote?: string;
  linkedExpenseId?: string;
  primaryAttachmentId?: string;
  primaryAttachmentFileName?: string;
  approvalSnapshotHash?: string;
  /**
   * Hash of the claim as it stands NOW, acknowledged when signing the form.
   * Distinct from `approvalSnapshotHash`, which is frozen at submit time.
   */
  claimSignatureAckHash?: string;
  missingReceiptReason?: string;
  lines: ReimbursementLineSummary[];
  approvalSteps: ReimbursementApprovalStepSummary[];
  payments: ReimbursementPaymentSummary[];
  duplicateCandidates: ReimbursementDuplicateCandidateSummary[];
  signatures: ReimbursementClaimSignatureSummary[];
  /** Uploaded scans/photos of the wet-ink signed form, newest first. */
  signedCopies: ReimbursementSignedCopySummary[];
};

// ---- Inputs ----
//
// Header amount/category/incurredDate are derived from `lines` server-side, so
// they are not accepted from clients (the DTO layer rejects them outright).

export type CreateReimbursementRequestInput = {
  branchId?: string;
  title?: string;
  reason: string;
  currency?: string;
  missingReceiptReason?: string;
  lines: ReimbursementLineInput[];
};

export type UpdateReimbursementDraftInput = {
  title?: string;
  reason?: string;
  currency?: string;
  missingReceiptReason?: string | null;
  lines?: ReimbursementLineInput[];
};

export type SubmitReimbursementRequestInput = {
  idempotencyKey?: string;
};

export type ApproveReimbursementInput = {
  comment?: string;
  approvalSnapshotHash?: string;
  idempotencyKey?: string;
};

export type RejectReimbursementInput = {
  reason: string;
  approvalSnapshotHash?: string;
  idempotencyKey?: string;
};

export type FinanceReviewReimbursementInput = {
  decision: 'APPROVED_FOR_PAYMENT' | 'NEEDS_INFO' | 'BLOCKED';
  note?: string;
  resolveDuplicate?: boolean;
  duplicateResolutionReason?: string;
};

export type RecordReimbursementPaymentInput = {
  paidAmount: string;
  currency?: string;
  paymentMethod: ReimbursementPaymentMethod;
  paidAt: string;
  paymentReference?: string;
  bankAccountId?: string;
  note?: string;
  idempotencyKey?: string;
};

export type VoidReimbursementPaymentInput = {
  reason: string;
};

export type ListReimbursementsFilter = {
  scope?: 'own' | 'related' | 'team' | 'all';
  status?: ReimbursementRequestStatus;
  paymentStatus?: ReimbursementPaymentStatus;
  requesterUserId?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedReimbursements = {
  items: ReimbursementRequestSummary[];
  total: number;
  page: number;
  pageSize: number;
};

// ---- Queue items ----

export type ReimbursementApprovalQueueItem = ReimbursementRequestSummary & {
  ageHours: number;
  slaRisk: boolean;
};

export type ReimbursementFinanceQueueItem = ReimbursementRequestSummary & {
  ageHours: number;
  hasDuplicateBlocker: boolean;
};

// ---- Source ref for item 13 bank reconciliation ----

export type ReimbursementPaymentSourceRef = {
  sourceType: 'REIMBURSEMENT_PAYMENT';
  sourceId: string;
  direction: 'PAID';
  amount: string;
  currency: string;
  paidAt: string;
  counterpartyDisplay: string;
  requestId: string;
};

// ---- Printable claim form (ใบเบิกค่าใช้จ่าย) ----
//
// Preview-only: the SVG is rendered on demand and returned inline, never stored.
// Printing is the browser's own print dialog on the rendered image.

export type ReimbursementClaimFormPreview = {
  svgDataUrl: string;
  checksumSha256: string;
};

// ---- Read-only AI/LINE summary ----

export type ReimbursementAiSummary = {
  pendingApprovalCount: number;
  unpaidApprovedCount: number;
  overdueApprovalCount: number;
  totalUnpaidAmount: string;
};

// ---- Document sequence keys ----

export const REIMBURSEMENT_SEQUENCE_KEYS = {
  REQUEST: 'reimbursement.request',
  PAYMENT: 'reimbursement.payment',
} as const;
