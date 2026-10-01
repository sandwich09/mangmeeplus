// ---- Item 14: Reimbursement Approval and Review ----
//
// Business contract for the reimbursement workflow. All monetary amounts are
// decimal strings (4 dp in DB). Dates are ISO strings across the wire.

import { coerceCivilDate, isCivilDate, todayCivilDate } from './civil-date.js';

/** One incurred-date rule for API writes, stored-draft submit and client validation. */
export function reimbursementIncurredDateError(value: string | Date, today = todayCivilDate()): string | null {
  try {
    // Date parsing otherwise silently rolls an impossible ISO day into the next month.
    if (typeof value === 'string') {
      if (!isCivilDate(value.slice(0, 10))) return 'line_incurred_date_invalid';
    } else if (!(value instanceof Date)) return 'line_incurred_date_invalid';
    return coerceCivilDate(value) > today ? 'line_incurred_date_in_future' : null;
  } catch {
    return 'line_incurred_date_invalid';
  }
}

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

export type ReimbursementApproverRoleOption = {
  key: string;
  name: string;
  optionLabel: string;
  eligibleApproverCount: number;
  coverage: 'COMPLETE' | 'PARTIAL' | 'NONE';
  uncoveredBranchNames: string[];
  selectable: boolean;
  unavailableReason?: 'MISSING_CAPABILITY' | 'NO_ACTIVE_HOLDERS' | 'OWNER_RECOVERY_NOT_READY';
  /** Whether the role also holds the pay right. Approving never needs it, so the policy screen only warns. */
  canRecordPayment: boolean;
};

export type ReimbursementPolicySnapshotV1 = {
  schemaVersion: 1;
  policyId: string | 'default';
  policyVersion: string;
  approvalRequiredFromAmount: string;
  requiresApproval: boolean;
  route: null | {
    mode: 'MANAGER_ROLE' | 'OWNER_ROLE' | 'CUSTOM_ROLE';
    roleKey: string;
    effectiveTaskRole: string;
    ownerFallbackUsedAtSubmission: boolean;
    /** Nobody but the requester could approve at submit, so they approve their own claim (owner order 2026-09-21). */
    soloSelfApprovalAtSubmission?: boolean;
  };
  allowSelfApproval: boolean;
  requireReceipt: boolean;
  allowMissingReceiptWithReason: boolean;
  duplicatePolicy: ReimbursementDuplicatePolicy;
  financeReviewRequired: boolean;
  slaHours?: number;
};

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
  /** First of `defaultApproverRoles`. */
  defaultApproverRole?: string;
  /** Holders of any of these roles may approve; the first decision wins. */
  defaultApproverRoles?: string[];
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
  expectedUpdatedAt?: string;
  approvalRequiredFromAmount?: string;
  defaultApproverRoles?: string[];
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

/**
 * Owner decision 2026-10-01 (D3): a payment recorded as a bank transfer must carry its slip; every
 * other method may. The API and the payment form both ask this one function, so they cannot disagree.
 */
export function reimbursementPaymentSlipRequired(paymentMethod: string): boolean {
  return paymentMethod === 'BANK_TRANSFER';
}

export const REIMBURSEMENT_PAYMENT_SLIP_MAX_BYTES = 10 * 1024 * 1024;
export const REIMBURSEMENT_PAYMENT_SLIP_MAX_FILES = 5;

/**
 * One file of payment evidence. Ids and times only: the file is opened through the slip endpoint,
 * which answers `canOpenReimbursementPaymentSlip` for the caller. Everyone else who reads the claim
 * sees that a slip is attached, and nothing more.
 */
export type ReimbursementPaymentSlipSummary = {
  attachmentId: string;
  attachedAt: string;
};

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
  /** Slips attached to this record, oldest first. A voided record keeps the slips it had. */
  slips: ReimbursementPaymentSlipSummary[];
  /**
   * Whether the caller may open this payment's slips: the verdict of `canOpenReimbursementPaymentSlip`
   * for them, set on every claim detail the API returns. The web offers ดูสลิป from this alone, so
   * the button and the slip endpoint cannot disagree. It says nothing about the full account number.
   */
  viewerCanOpenSlips?: boolean;
};

// ---- Who sees a claim's payout details (spec §11.1, owner decision D2) ----

export type ReimbursementPayoutViewer = { userId: string; permissions: readonly string[] };

/** The claim facts the rule reads. The API record and the web detail both have this shape. */
export type ReimbursementPayoutViewerClaim = {
  requesterUserId: string;
  approvalSteps?: readonly {
    status: string;
    decisionByUserId?: string | null;
    decidedAt?: string | Date | null;
    invalidatedAt?: string | Date | null;
  }[];
  /** Server-resolved authority over the pending step, as the claim detail reports it. */
  approvalActions?: { canApprove: boolean; canReject: boolean } | null;
};

/**
 * The people a claim's payout details belong to: the requester, the claim's own approver (whoever
 * decided its latest approval still in force, or may decide the step it waits on), and holders of
 * the payment-record right. Holding the approval permission without being routed this claim is not
 * enough. The caller has already established that the viewer may read the claim, branch included.
 */
export function isReimbursementPayoutParty(viewer: ReimbursementPayoutViewer, claim: ReimbursementPayoutViewerClaim): boolean {
  if (!viewer.userId) return false;
  if (viewer.userId === claim.requesterUserId) return true;
  if (viewer.permissions.includes('reimbursement.payment.record')) return true;
  if (claim.approvalActions?.canApprove || claim.approvalActions?.canReject) return true;
  const approved = [...(claim.approvalSteps ?? [])]
    .filter((step) => step.status === 'APPROVED' && !step.invalidatedAt && !!step.decidedAt)
    .sort((a, b) => new Date(b.decidedAt!).getTime() - new Date(a.decidedAt!).getTime())[0];
  return approved?.decisionByUserId === viewer.userId;
}

/**
 * Who may open a payment slip (spec §11.4): the payout parties, and finance reviewers too (owner
 * answer 2026-10-01, "ให้เปิดดูได้"). Nobody else. The slip download endpoint enforces this, and the
 * claim detail reports this same verdict to the web (`viewerCanOpenSlips`), so ดูสลิป is never offered
 * to someone the endpoint would refuse. Wider than the account-number group on purpose, for slips only.
 */
export function canOpenReimbursementPaymentSlip(viewer: ReimbursementPayoutViewer, claim: ReimbursementPayoutViewerClaim): boolean {
  return isReimbursementPayoutParty(viewer, claim) || viewer.permissions.includes('reimbursement.finance_review');
}

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

/** Server-owned facts retained from the selected source, independent of the claim payable. */
export type ReimbursementSourceSnapshot = {
  schemaVersion: 1;
  expenseId: string;
  expenseUpdatedAt: string;
  requesterUserId: string;
  /**
   * Who the server has established as the payer of the source expense (capture appendix §5).
   * Additive on schemaVersion 1 and ABSENT when unknown, so a snapshot pinned before this
   * field existed still deep-compares equal to a fresh read of the same facts.
   */
  payerUserId?: string;
  expenseDate: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  currency: string;
  seller: { name: string; taxId: string | null; branchCode: string | null; documentNumber: string | null };
  sourceDocumentType: string;
  vatMode: string;
  inputVatClaimStatus: string;
  taxEvidenceStatus: string;
  classification: { expenseCategoryId: string | null; accountHintKey: string | null; taxCategory: string | null };
  totals: Record<string, string>;
  lines: Array<Record<string, unknown>>;
  attachments: Array<{ id: string; fileName: string; checksumSha256: string | null }>;
  certificate: null | { id: string; documentNumber: string; version: number; fundingSource: string; payerUserId: string | null; payerName: string; businessPurpose: string; missingReceiptReason: string; artifactChecksumSha256: string | null; wetSignedScanChecksumSha256: string | null };
};
export type ReimbursementSourceOption = {
  expenseId: string; label: string; eligible: boolean; reason?: string; updatedAt: string;
  incurredDate: string; description: string; purpose: string; categoryKey: string; categoryLabel?: string;
  amount: string; currency: string; snapshot?: ReimbursementSourceSnapshot;
};
export type ReimbursementSourceOptions = {
  requesters: Array<{ userId: string; displayName: string }>;
  items: ReimbursementSourceOption[];
};

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
  sourceExpenseUpdatedAt?: string;
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
  sourceExpenseSnapshot?: ReimbursementSourceSnapshot;
};

// ---- Current desk (อยู่ที่ใคร) ----
//
// A claim never said who the ball is with. Individuals are named only for the
// approval stage — the one stage where the system really does assign people.
// Every other desk is a permission pool and prints as the pool, never as a
// guessed person.

export type ReimbursementCurrentDeskKind = 'REQUESTER' | 'APPROVER' | 'FINANCE' | 'PAYMENT';

export type ReimbursementCurrentDesk = {
  kind: ReimbursementCurrentDeskKind;
  /** Assigned approver display names; absent for pool desks and when no name resolves. */
  names?: string[];
};

/**
 * The words for a desk when no person is named. One source for the web ("อยู่ที่ …", the step note, the
 * timeline) and for the LINE backlog answer, so they cannot name different parties for the same claim.
 * Payment is whoever holds the pay right: most shops have no finance desk, so "ฝ่ายการเงิน" is said only
 * of the finance-review step.
 */
export const REIMBURSEMENT_DESK_LABELS: Record<ReimbursementCurrentDeskKind, string> = {
  REQUESTER: 'ผู้ยื่น',
  APPROVER: 'ผู้มีสิทธิ์อนุมัติ',
  FINANCE: 'ฝ่ายการเงิน',
  PAYMENT: 'ผู้มีสิทธิ์บันทึกจ่าย',
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
  /** Who the claim is waiting on now. Absent on terminal claims (paid/rejected/cancelled/voided). */
  currentDesk?: ReimbursementCurrentDesk;
  financeReviewStatus: ReimbursementFinanceReviewStatus;
  paymentStatus: ReimbursementPaymentStatus;
  duplicateStatus: ReimbursementDuplicateStatus;
  receiptRequirementStatus: ReimbursementReceiptRequirementStatus;
  /** Effective policy hint for pre-submit guidance; server validation remains authoritative. */
  allowMissingReceiptWithReason?: boolean;
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

/** Two blocks (ผู้เบิก, ผู้อนุมัติ) for every claim, except one already signed in the old accounting/payer blocks. */
export type ReimbursementClaimFormLayout = 'TWO_SIGNERS' | 'LEGACY_FOUR_SIGNERS';

/** How the document step was done: every block signed in the system, an acknowledged paper scan, both, or neither. */
export type ReimbursementDocumentSignedVia = 'DIGITAL' | 'PAPER' | 'BOTH' | null;

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
  /** A4: present on a scan attached with the completeness declaration — when it was declared. */
  acknowledgedAt?: string;
  /** Who made that declaration, on the detail read when the name resolves (never a user id). */
  acknowledgedByName?: string;
};

export type ReimbursementInternalNote = {
  id: string;
  authorUserId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};

export type SignReimbursementClaimFormInput = {
  role: ReimbursementClaimSignatureRole;
  /** Legacy callers may provide a claim-scoped upload; otherwise the server resolves the signer's saved signature. */
  signatureAttachmentId?: string;
  /** The hash the signer previewed — the server recomputes it and rejects `stale_claim_snapshot`. */
  snapshotHash: string;
};

export type LinkReimbursementSignedCopyInput = {
  attachmentId: string;
  /** The attacher declares the scan carries every signature. Omitted: the scan is archived only, as before. */
  acknowledgedComplete?: true;
  /** Required with `acknowledgedComplete`; must equal the claim's requestNo. */
  confirmedRequestNo?: string;
};

export type ReimbursementRequestDetail = ReimbursementRequestSummary & {
  createdByName?: string;
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
   * Task-scoped authority resolved by the server for the current actor. A person
   * frozen onto the pending step keeps these actions after a later role change;
   * clients must not infer them from the current role or the selected tab.
   */
  approvalActions?: {
    canApprove: boolean;
    canReject: boolean;
    /** The requester holds the approval this claim waits on; only the self-approval switch refuses them. */
    selfApprovalBlocked?: boolean;
  };
  /**
   * Hash of the claim as it stands NOW, acknowledged when signing the form.
   * Distinct from `approvalSnapshotHash`, which is frozen at submit time.
   */
  claimSignatureAckHash?: string;
  /** Which blocks the printed form carries, so the screen shows the same slots. */
  claimFormLayout?: ReimbursementClaimFormLayout;
  documentSignedVia?: ReimbursementDocumentSignedVia;
  /** Whether this claim has the finance review step: its frozen policy once submitted, the current policy while a draft. Detail only. */
  financeReviewRequired?: boolean;
  /**
   * Who can record this claim's payment, while it waits at the payment desk: the active members the API
   * would accept the payment from (pay right, branch scope). At most five names, then how many more.
   * GET detail only; an empty list means nobody can. Absent on a claim the payment endpoint refuses for
   * everyone (no branch, or part paid): the page then prints the desk's pool label.
   */
  paymentDesk?: { names: string[]; moreCount: number };
  missingReceiptReason?: string;
  lines: ReimbursementLineSummary[];
  approvalSteps: ReimbursementApprovalStepSummary[];
  payments: ReimbursementPaymentSummary[];
  duplicateCandidates: ReimbursementDuplicateCandidateSummary[];
  /** An open duplicate candidate under this claim's BLOCK_PAYMENT policy: payment is refused until it is cleared. */
  duplicateBlocksPayment?: boolean;
  signatures: ReimbursementClaimSignatureSummary[];
  /** Uploaded scans/photos of the wet-ink signed form, newest first. */
  signedCopies: ReimbursementSignedCopySummary[];
  internalNotes?: ReimbursementInternalNote[];
};

// ---- Inputs ----
//
// Header amount/category/incurredDate are derived from `lines` server-side, so
// they are not accepted from clients (the DTO layer rejects them outright).

export type CreateReimbursementRequestInput = {
  requesterUserId?: string;
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
  /**
   * Omitted only on a resolve-only call (`resolveDuplicate` + reason) at the payment step, where
   * no finance decision is left to make: it clears a duplicate block without finance review.
   */
  decision?: 'APPROVED_FOR_PAYMENT' | 'NEEDS_INFO' | 'BLOCKED';
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
  /**
   * The slip for this payment: required when `reimbursementPaymentSlipRequired(paymentMethod)`.
   * A slip uploaded for this claim by the payer, or a file already attached to the claim (a signed
   * copy that is really the slip, or the slip of an earlier payment of the same claim).
   */
  slipAttachmentId?: string;
};

export type AttachReimbursementPaymentSlipInput = {
  attachmentId: string;
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
  /**
   * What this viewer may do with the row, resolved by the server as on the claim detail: the current
   * permission, or a frozen assignment. A row is listed only when at least one is true.
   */
  approvalActions: { canApprove: boolean; canReject: boolean };
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
  /** Legacy continuous image for clients predating paginated previews. */
  svgDataUrl: string;
  /** Ordered, self-contained A4 pages; preview, print and PDF must use the complete array. */
  pageSvgDataUrls?: string[];
  checksumSha256: string;
};

// ---- Read-only AI/LINE summary ----

export type ReimbursementAiSummary = {
  pendingApprovalCount: number;
  unpaidApprovedCount: number;
  overdueApprovalCount: number;
  totalUnpaidAmount: string;
  /** Item 1 (spec R-A1 row 18): the caller's own effective read scope, from the same own/related/
   *  company permission check `GetReimbursementAiSummaryUseCase` already applies above. */
  accessScope: 'own' | 'related' | 'company';
};

// ---- Document sequence keys ----

export const REIMBURSEMENT_SEQUENCE_KEYS = {
  REQUEST: 'reimbursement.request',
  PAYMENT: 'reimbursement.payment',
} as const;
