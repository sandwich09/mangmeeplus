/**
 * Domain models for reimbursement approval and review (Item 14).
 * Plain TypeScript types — no Prisma, no NestJS imports.
 * Dates are Date objects; amounts are decimal strings.
 */

import type {
  ReimbursementRequestStatus,
  ReimbursementApprovalStepStatus,
  ReimbursementFinanceReviewStatus,
  ReimbursementPaymentStatus,
  ReimbursementDuplicateStatus,
  ReimbursementReceiptRequirementStatus,
  ReimbursementPostingStatus,
  ReimbursementClaimSignatureRole,
  ReimbursementPaymentMethod,
  ReimbursementApproverMode,
  ReimbursementDuplicatePolicy,
  ReimbursementPolicyStatus,
  ReimbursementPolicySnapshotV1,
  ReimbursementSourceSnapshot,
  ExpenseLineChargeKind,
} from '@watchdog-bms/contracts';

export type ReimbursementPolicyRecord = {
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
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ReimbursementApprovalStepRecord = {
  id: string;
  companyId: string;
  reimbursementRequestId: string;
  sequenceNo: number;
  approverUserId?: string;
  approverRoleSnapshot?: string;
  /** Frozen assignees at submit. Undefined is the legacy role-based fallback. */
  assignedApproverUserIds?: string[];
  status: ReimbursementApprovalStepStatus;
  assignedAt: Date;
  decidedAt?: Date;
  decisionByUserId?: string;
  comment?: string;
  rejectionReason?: string;
  requestSnapshotHash: string;
  invalidatedAt?: Date;
  invalidatedReason?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ReimbursementPaymentRecord = {
  id: string;
  companyId: string;
  reimbursementRequestId: string;
  idempotencyKey: string;
  paymentNo?: string;
  paidAmount: string;
  currency: string;
  paymentMethod: ReimbursementPaymentMethod;
  paidAt: Date;
  paymentReference?: string;
  bankAccountId?: string;
  sourcePaymentRef: string;
  status: 'RECORDED' | 'VOIDED';
  voidedAt?: Date;
  voidReason?: string;
  paidByUserId: string;
  voidedByUserId?: string;
  postingStatus: ReimbursementPostingStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type ReimbursementDuplicateCandidateRecord = {
  id: string;
  companyId: string;
  reimbursementRequestId: string;
  candidateType: 'ATTACHMENT_CHECKSUM' | 'EXPENSE_LINK' | 'AMOUNT_DATE_VENDOR' | 'MANUAL';
  candidateRequestId?: string;
  candidateExpenseId?: string;
  candidateAttachmentId?: string;
  score: number;
  status: 'OPEN' | 'DISMISSED' | 'CONFIRMED' | 'OVERRIDDEN';
  reason?: string;
  resolvedByUserId?: string;
  resolvedAt?: Date;
  createdAt: Date;
};

export type ReimbursementLineRecord = {
  id: string;
  companyId: string;
  reimbursementRequestId: string;
  lineNo: number;
  incurredDate: Date;
  description: string;
  purpose?: string;
  categoryKey: string;
  categoryLabelSnapshot?: string;
  amount: string;
  attachmentId?: string;
  linkedExpenseId?: string;
  sourceExpenseSnapshot?: ReimbursementSourceSnapshot;
  attachmentSnapshot?: ReimbursementAttachmentSnapshot;
  createdAt: Date;
  updatedAt: Date;
};

export type ReimbursementClaimSignatureRecord = {
  id: string;
  companyId: string;
  reimbursementRequestId: string;
  role: ReimbursementClaimSignatureRole;
  signatureAttachmentId: string;
  signedByUserId: string;
  signedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

/** A4 declaration made when attaching a paper-signed scan; stored with the scan, bound to its link row. */
export type ReimbursementSignedCopyAck = {
  requestId: string;
  requestNo: string;
  acknowledgedByUserId: string;
  acknowledgedAt: string;
  checksumSha256: string | null;
};

export type ReimbursementRequestRecord = {
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
  incurredDate: Date;
  submittedAt?: Date;
  submittedByUserId?: string;
  currentApproverUserId?: string;
  currentApprovalStepId?: string;
  approvedAt?: Date;
  rejectedAt?: Date;
  rejectionReason?: string;
  cancelledAt?: Date;
  cancellationPendingAt?: Date;
  cancellationPendingByUserId?: string;
  cancellationPendingReason?: string;
  financeReviewStatus: ReimbursementFinanceReviewStatus;
  financeReviewedByUserId?: string;
  financeReviewedAt?: Date;
  financeReviewNote?: string;
  status: ReimbursementRequestStatus;
  paymentStatus: ReimbursementPaymentStatus;
  duplicateStatus: ReimbursementDuplicateStatus;
  receiptRequirementStatus: ReimbursementReceiptRequirementStatus;
  postingStatus: ReimbursementPostingStatus;
  linkedExpenseId?: string;
  primaryAttachmentId?: string;
  missingReceiptReason?: string;
  approvalSnapshotHash?: string;
  approvalPolicySnapshotJson?: ReimbursementPolicySnapshotV1;
  paymentTotalAmount: string;
  outstandingAmount: string;
  idempotencyKey?: string;
  createdByUserId: string;
  updatedByUserId?: string;
  createdAt: Date;
  updatedAt: Date;
  /** Count without loading the rows (list queries select only the count). */
  lineCount?: number;
  lines?: ReimbursementLineRecord[];
  approvalSteps?: ReimbursementApprovalStepRecord[];
  payments?: ReimbursementPaymentRecord[];
  duplicateCandidates?: ReimbursementDuplicateCandidateRecord[];
  claimSignatures?: ReimbursementClaimSignatureRecord[];
};

// ---- Input shapes for repository writes ----

export type ReimbursementAttachmentSnapshot = { id: string; uploadedByUserId: string; checksumSha256: string | null; fileName: string };

export type ReimbursementLineWriteData = {
  lineNo: number;
  incurredDate: Date;
  description: string;
  purpose?: string | null;
  categoryKey: string;
  categoryLabelSnapshot?: string | null;
  amount: string;
  attachmentId?: string | null;
  linkedExpenseId?: string | null;
  sourceExpenseSnapshot?: ReimbursementSourceSnapshot;
  attachmentSnapshot?: ReimbursementAttachmentSnapshot;
};

export type ReimbursementDuplicateCandidateWriteData = {
  candidateType: 'ATTACHMENT_CHECKSUM' | 'EXPENSE_LINK' | 'AMOUNT_DATE_VENDOR';
  candidateRequestId?: string;
  candidateExpenseId?: string;
  candidateAttachmentId?: string;
  score: number;
  reason?: string;
};

// ---- GAP-02 Phase 2: claim → expense bridge ----

/**
 * One materialization instruction: turn a single unlinked reimbursement line
 * into a claim-born ExpenseRecord (+ its single expense line) and stamp the
 * `linkedExpenseId` back. Totals are pre-computed by the service so the
 * repository stays a dumb writer.
 */
export type MaterializeClaimExpenseItem = {
  reimbursementLineId: string;
  branchId?: string | null;
  currency: string;
  expenseDate: Date;
  /** Free-text description carried onto the expense note + its single line. */
  description: string;
  /** `เบิกคืนพนักงาน: <requester name>` — the employee-payee identity. */
  vendorNameSnapshot: string;
  /** Receipt evidence to relink to the new expense as its primary attachment, if any. */
  attachmentId?: string | null;
  /** Carried from the request when the line has NO receipt, so finance need not retype it. */
  missingReceiptReason?: string | null;
  /** Mapping decisions (see MaterializeClaimExpensesService) carried to the writer. */
  status: string;
  captureSource: string;
  vatMode: string;
  inputVatClaimStatus: string;
  sourceDocumentType: string;
  taxEvidenceStatus: string;
  /** Claim-form number (line-suffixed on multi-line claims) — the projection's document reference. */
  vendorDocumentNumber: string | null;
  /** Canonical CC2 VAT state retained until the shared CC4 resolution exists. */
  sourceChannelMetadataJson: { cc2VatClaimClassification: 'EXTERNAL_OR_UNRESOLVED'; reimbursementSource?: ReimbursementSourceSnapshot };
  /** Header totals for the neutral single-line ExpenseRecord projection. */
  subtotalAmount: string;
  discountAmount: string;
  taxableAmount: string;
  vatAmount: string;
  whtAmount: string;
  grandTotalAmount: string;
  netPayableAmount: string;
  outstandingAmount: string;
  /** The single expense line (qty 1, unitPrice = line amount). */
  line: {
    quantity: string;
    unitPrice: string;
    discountAmount: string;
    taxableAmount: string;
    vatAmount: string;
    whtAmount: string;
    lineSubtotalAmount: string;
    lineTotalAmount: string;
  };
  /** Supported source VAT is non-claimable: retain each category's gross cost. */
  sourceCostLines?: Array<{ description: string; chargeKind: ExpenseLineChargeKind | null; amount: string; expenseCategoryId: string | null; accountHintKey: string | null; taxCategory: string | null }>;
};

export type CreateReimbursementRequestData = {
  companyId: string;
  branchId?: string;
  requesterUserId: string;
  requesterDisplayNameSnapshot: string;
  title?: string;
  reason: string;
  categoryKey: string;
  categoryLabelSnapshot?: string;
  amount: string;
  currency: string;
  incurredDate: Date;
  missingReceiptReason?: string;
  receiptRequirementStatus: ReimbursementReceiptRequirementStatus;
  createdByUserId: string;
  lines: ReimbursementLineWriteData[];
};
