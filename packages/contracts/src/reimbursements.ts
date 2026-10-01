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

/** What recording a payment asks for beyond amount, date and reference (payout spec §12.4). */
export type ReimbursementPaymentRule = {
  /** A transfer is recorded with its slip (D3), whatever the claim asked for. */
  slipRequired: boolean;
  /**
   * The payer's "โอนเข้าบัญชีนี้แล้ว". `required`: a transfer on a claim that carries an account.
   * `optional`: a transfer on a legacy claim, which froze no account, so the payer confirms the
   * requester's current default only when the money went there (§15). `none`: no account is paid into.
   */
  payoutConfirmation: 'required' | 'optional' | 'none';
  /** The method recorded is not the one the requester asked for: the payer says why. */
  mismatchReasonRequired: boolean;
};

/**
 * The one table of payout spec §12.4. The API asks it under the payment lock and the payment form
 * asks it for the fields it shows, so the two cannot disagree. `requested` is what the claim's
 * requester asked for: the method of the claim's own snapshot and whether that snapshot carries an
 * account. Null for a legacy claim, one sent before claims carried a receiving method.
 */
export function reimbursementPaymentRule(
  requested: { payoutMethod: ReimbursementPayoutMethod; hasAccount: boolean } | null,
  paymentMethod: string,
): ReimbursementPaymentRule {
  const transfer = paymentMethod === 'BANK_TRANSFER';
  return {
    slipRequired: reimbursementPaymentSlipRequired(paymentMethod),
    payoutConfirmation: !transfer ? 'none' : !requested ? 'optional' : requested.hasAccount ? 'required' : 'none',
    mismatchReasonRequired: !!requested && paymentMethod !== requested.payoutMethod,
  };
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

/**
 * The account a payment was confirmed into, masked: bank, account name and the last 4 digits, the same
 * for every reader. No surface carries more than this of a payment's account.
 */
export type ReimbursementPaymentDestinationSummary = {
  /** The claim's account version the payer was shown and confirmed. */
  version: number;
  payoutKind: ReimbursementPayoutKind;
  bankName?: string;
  accountName: string;
  accountLast4: string;
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
  /** How many slips this record carries. Every reader of the claim sees this much; a voided record keeps its slips. */
  slipCount: number;
  /**
   * The slip files, oldest first, for a caller who may open them (`viewerCanOpenSlips`). Empty for
   * everyone else: a file id is not handed to someone the slip endpoint would refuse.
   */
  slips: ReimbursementPaymentSlipSummary[];
  /**
   * Whether the caller may open this payment's slips: the verdict of `canOpenReimbursementPaymentSlip`
   * for them, set on every claim detail the API returns. The web offers ดูสลิป from this alone, so
   * the button and the slip endpoint cannot disagree. It says nothing about the full account number.
   */
  viewerCanOpenSlips: boolean;
  /**
   * The account the payer confirmed the transfer into: the version of the claim's own snapshot they
   * were shown or, on a legacy claim, the copy of the requester's default account kept with the
   * payment (spec §15). Absent when no account was confirmed: cash, a cheque, or a transfer on a
   * legacy claim into an account the payer asked the requester for.
   */
  payoutDestination?: ReimbursementPaymentDestinationSummary;
  /** When the payer confirmed the transfer into `payoutDestination`. */
  payoutConfirmedAt?: string;
  /**
   * Why the payer paid by another method than the requester asked for. Present exactly when they
   * did, so every surface says "จ่ายต่างจากที่ผู้เบิกขอ" from this one fact.
   */
  methodMismatchReason?: string;
};

// ---- Who sees a claim's payout details (spec §11.1, owner decision D2) ----

export type ReimbursementPayoutViewer = { userId: string; permissions: readonly string[] };

/** The claim facts the rule reads. The API record and the web detail both have this shape. */
export type ReimbursementPayoutViewerClaim = {
  requesterUserId: string;
  /** When the claim's current round was submitted; none while it is a draft. Named by every caller: it decides whose approval still counts. */
  submittedAt: string | Date | null | undefined;
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
 * Whether this person approved the claim as it stands: they decided an approval that is still in
 * force and belongs to the current round, that is, decided at or after the claim was last
 * submitted. An approval from before a correction and resubmission is history: the claim has since
 * been routed again, and its earlier approver has no say over what it became. The claim page asks
 * this rule too, for "approved by a person" (`buildJourneySteps`); it no longer keeps a copy.
 *
 * The one definition of a claim's own approver. The account-number reveal and its
 * `canRevealAccountNumber` flag (`claimPayoutRevealGroup` in the API), the payment slip
 * (`isReimbursementPayoutParty` below) and the approver a ready-to-pay notice asks after finance
 * (`claimApproverUserId` in the API) all ask it. One reader cannot call it, a database query, and
 * restates it: the payment reminder's `findClaimApprovers` (workflow repository) with the round test
 * in `paymentSlaBreach`. A change here is a change there.
 */
export function isReimbursementClaimApprover(userId: string, claim: Pick<ReimbursementPayoutViewerClaim, 'submittedAt' | 'approvalSteps'>): boolean {
  if (!userId || !claim.submittedAt) return false;
  const roundStartedAt = new Date(claim.submittedAt).getTime();
  return (claim.approvalSteps ?? []).some((step) => step.status === 'APPROVED' && !step.invalidatedAt && !!step.decidedAt
    && step.decisionByUserId === userId && new Date(step.decidedAt).getTime() >= roundStartedAt);
}

/**
 * The people a claim's payout details belong to: the requester, the claim's own approver (whoever
 * approved its current round, or may decide the step it waits on), and holders of the
 * payment-record right. Holding the approval permission without being routed this claim is not
 * enough. The caller has already established that the viewer may read the claim, branch included.
 * The single rule for the full account number (§11.1) and, with finance reviewers added, for slips.
 */
export function isReimbursementPayoutParty(viewer: ReimbursementPayoutViewer, claim: ReimbursementPayoutViewerClaim): boolean {
  if (!viewer.userId) return false;
  if (viewer.userId === claim.requesterUserId) return true;
  if (viewer.permissions.includes('reimbursement.payment.record')) return true;
  if (claim.approvalActions?.canApprove || claim.approvalActions?.canReject) return true;
  return isReimbursementClaimApprover(viewer.userId, claim);
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

// ---- หน้ารวม (hub) buckets ----

/** Every claim sits in exactly one bucket, so the hub's chips add up to "ทั้งหมด". */
export type ReimbursementHubBucket = 'draft' | 'review' | 'payment' | 'paid' | 'closed';

/**
 * Where a claim's status alone places it. Typed over every status, so a status added later has to be
 * placed here and cannot fall into ปฏิเสธ/ยกเลิก unnoticed.
 */
const HUB_BUCKET_BY_STATUS: Record<ReimbursementRequestStatus, ReimbursementHubBucket> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'review',
  FINANCE_REVIEW: 'review',
  APPROVED: 'payment',
  READY_FOR_PAYMENT: 'payment',
  PARTIALLY_PAID: 'payment',
  PAID: 'paid',
  REJECTED: 'closed',
  CANCELLED: 'closed',
  VOIDED: 'closed',
};

/**
 * The hub bucket of a claim: the desk it waits at, the one its row prints as "อยู่ที่ …". A claim with no
 * desk, or with a desk kind this code does not know, is placed by its status: a draft is a draft whether
 * or not the row carries a desk. One rule for the cards, the chips and the list.
 */
export function reimbursementHubBucket(claim: {
  status?: string;
  financeReviewStatus?: string;
  currentDesk?: { kind?: string } | null;
}): ReimbursementHubBucket {
  switch (claim.currentDesk?.kind) {
    case 'REQUESTER': return 'draft';
    case 'APPROVER': case 'FINANCE': return 'review';
    case 'PAYMENT': return 'payment';
  }
  // Approved and still being routed on: to finance review while that is pending, otherwise to payment.
  if (claim.status === 'APPROVED' && claim.financeReviewStatus === 'PENDING') return 'review';
  return HUB_BUCKET_BY_STATUS[claim.status as ReimbursementRequestStatus] ?? 'closed';
}

/** The whole list scope as the server counted it, or what a search found in it: what the hub's cards and chips print. */
export type ReimbursementHubSummary = {
  /** Claims per bucket, and `all` for the scope. The buckets add up to `all`. */
  counts: Record<'all' | ReimbursementHubBucket, number>;
  /** Sum of the claimed amounts of the scope. */
  totalAmount: string;
  /** Drafts that still owe a receipt before they can be submitted. */
  blockedDraftCount: number;
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
  /** How the requester asked to be paid back. Absent on a legacy claim and on a draft that follows the default account. */
  payoutMethod?: ReimbursementPayoutMethod;
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
  /** Where the money goes back to, masked. Absent on a legacy claim: one sent before claims carried a receiving method. */
  payout?: ReimbursementPayoutSummary;
  /**
   * GET detail only, on a legacy claim that can be paid, for a viewer who may record its payment and
   * whose requester has a default account to transfer into (spec §15). Absent for everyone else, and
   * on every claim that carries its own `payout`.
   */
  legacyPayoutDefault?: ReimbursementLegacyPayoutDefault;
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
  /** Omitted: the draft follows the requester's default payout account. */
  payout?: ReimbursementPayoutInput;
  lines: ReimbursementLineInput[];
};

export type UpdateReimbursementDraftInput = {
  title?: string;
  reason?: string;
  currency?: string;
  missingReceiptReason?: string | null;
  /** Omitted: the draft's receiving method is left as it is. */
  payout?: ReimbursementPayoutInput;
  lines?: ReimbursementLineInput[];
};

export type SubmitReimbursementRequestInput = {
  idempotencyKey?: string;
  /**
   * `payout.submitToken` of the detail the submitter was looking at. Required whenever the claim is
   * paid into an account (the requester's default or one typed into the claim) or follows the
   * default: a submit that would freeze anything else than what was shown is refused with
   * `payout_destination_changed`. Only cash chosen on the claim itself needs none.
   */
  payoutSubmitToken?: string;
};

export type ApproveReimbursementInput = {
  comment?: string;
  /** The hash of the claim the approver was looking at. Required: nothing is approved unseen. */
  approvalSnapshotHash?: string;
  idempotencyKey?: string;
  /**
   * "ตรวจบัญชีแล้ว": the account version the approver looked at. Required to approve a claim paid by
   * transfer, and it must be the claim's current version. Cash and legacy claims take none.
   */
  payoutVerifiedVersion?: number;
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
  /**
   * The claim's account version the payer was shown (`payout.version`). Whenever it is sent it must be
   * the claim's current version, else `payout_destination_changed`. Required, with `payoutConfirmed`,
   * to record a transfer on a claim that carries an account.
   */
  payoutDestinationVersion?: number;
  /** "โอนเข้าบัญชีนี้แล้ว และชื่อผู้รับที่ธนาคารแสดงตรงกับใบเบิก": the payer transferred into the account shown. */
  payoutConfirmed?: boolean;
  /**
   * Legacy claim only: `legacyPayoutDefault.confirmToken` of the account the payer was shown, sent
   * with `payoutConfirmed` when the transfer went into that account. A copy of it is then kept with
   * the payment. Omitted when the payer transferred somewhere else.
   */
  payoutDefaultToken?: string;
  /**
   * Why the payment is recorded by another method than the requester asked for; required then
   * (`reimbursementPaymentRule`). Shown on the payment row, so it may not carry an account number.
   */
  methodMismatchReason?: string;
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
  /** Only the claims of one hub bucket. Any other name is refused (400). */
  bucket?: ReimbursementHubBucket;
  /**
   * The hub's search box: every word is in the claim's number, requester name, reason or category, or is
   * its amount. It narrows the list and `hub` alike, so each count is still the rows its filter returns.
   */
  search?: string;
  page?: number;
  pageSize?: number;
};

export type PaginatedReimbursements = {
  items: ReimbursementRequestSummary[];
  /** How many claims the list holds over all its pages. With `bucket`, that is `hub.counts[bucket]`. */
  total: number;
  page: number;
  pageSize: number;
  /** The scope counted per bucket, whatever `bucket` or page was asked for. With `search`, the claims it found. */
  hub: ReimbursementHubSummary;
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
  /** What this row showed. An approval from the queue sends it back, so a claim sent again since is not approved unseen. */
  approvalSnapshotHash?: string;
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

// ---- Payout account (บัญชีรับเงินคืน) ----
//
// Where a claim is paid back. The full number travels in exactly two shapes: `PayoutDestinationInput`
// on the way in, and `PayoutAccountReveal` out of the audited "แสดงเลขบัญชี" call. Every other payload
// carries `accountLast4` only.

/** A subset of the payment methods on purpose: no new enum value. */
export type ReimbursementPayoutMethod = 'BANK_TRANSFER' | 'CASH';
export type ReimbursementPayoutKind = 'BANK_ACCOUNT' | 'PROMPTPAY_PHONE';
/** Where a claim's account came from: the requester's default, typed by the requester, or typed by whoever prepared the claim for them. */
export type ReimbursementPayoutSource = 'DEFAULT_ACCOUNT' | 'REQUESTER' | 'PREPARER';

// Source: Bank of Thailand financial institution directory, checked 2026-09-23.
export const THAI_BANK_NAMES = [
  'ธนาคารกรุงเทพ', 'ธนาคารกสิกรไทย', 'ธนาคารกรุงไทย', 'ธนาคารไทยพาณิชย์',
  'ธนาคารกรุงศรีอยุธยา', 'ธนาคารทหารไทยธนชาต', 'ธนาคารยูโอบี',
  'ธนาคารซีไอเอ็มบี ไทย', 'ธนาคารเกียรตินาคินภัทร', 'ธนาคารแลนด์ แอนด์ เฮ้าส์',
  'ธนาคารไทยเครดิต', 'ธนาคารไอซีบีซี (ไทย)', 'ธนาคารสแตนดาร์ดชาร์เตอร์ด (ไทย)',
  'ธนาคารออมสิน', 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร',
  'ธนาคารอาคารสงเคราะห์', 'ธนาคารอิสลามแห่งประเทศไทย',
] as const;

export const PAYOUT_BANK_NAME_MAX_LENGTH = 80;
export const PAYOUT_ACCOUNT_NAME_MAX_LENGTH = 140;

/** An account as it is typed. The only inbound shape that carries a full number. */
export type PayoutDestinationInput = {
  payoutKind: ReimbursementPayoutKind;
  /** Required for a bank account; a PromptPay number has none. */
  bankName?: string;
  accountName: string;
  accountNumber: string;
};

/** Digits kept as text: spaces and dashes go, a leading zero stays, nothing is ever read as a number. */
export function normalizePayoutAccountNumber(raw: unknown): string {
  return typeof raw === 'string' ? raw.replace(/[\s-]/g, '') : '';
}

export type PayoutDestinationField = 'payoutKind' | 'bankName' | 'accountName' | 'accountNumber';

/**
 * The one format rule for an account, shared by the API and the web form. Completeness and shape
 * only: a bank account is 6 to 20 digits (never forced to 10), a PromptPay number is a Thai mobile
 * number. Nothing here matches the account name to a person or asks a bank; people verify that.
 * The bank name and the account name are shown unmasked on every screen and copied into notices, so
 * neither may carry something that reads as an account number (`looksLikeAccountNumber`).
 * Returns the first field that fails, or null.
 */
export function invalidPayoutDestinationField(input: Partial<PayoutDestinationInput> | null | undefined): PayoutDestinationField | null {
  const kind = input?.payoutKind;
  if (kind !== 'BANK_ACCOUNT' && kind !== 'PROMPTPAY_PHONE') return 'payoutKind';
  const bankName = typeof input?.bankName === 'string' ? input.bankName.trim() : '';
  if (kind === 'BANK_ACCOUNT' && (bankName.length === 0 || bankName.length > PAYOUT_BANK_NAME_MAX_LENGTH || looksLikeAccountNumber(bankName))) return 'bankName';
  const accountName = typeof input?.accountName === 'string' ? input.accountName.trim() : '';
  if (accountName.length < 2 || accountName.length > PAYOUT_ACCOUNT_NAME_MAX_LENGTH || /^[\d\s-]+$/.test(accountName) || looksLikeAccountNumber(accountName)) return 'accountName';
  const accountNumber = normalizePayoutAccountNumber(input?.accountNumber);
  if (!(kind === 'BANK_ACCOUNT' ? /^\d{6,20}$/ : /^0\d{9}$/).test(accountNumber)) return 'accountNumber';
  return null;
}

/**
 * The product's own document numbers: a Latin prefix, a year, an optional month and a running number
 * ("RB-202609-0003", "EXP-2026-10-000123"). A bank's short name is no such prefix: "SCB-0123456789"
 * has no year after it and is read as the account number it is.
 */
const OWN_DOCUMENT_NUMBER = /\b[A-Za-z]{2,}-(?:20|25)\d{2}(?:-?(?:0[1-9]|1[0-2]))?-\d{1,6}\b/g;

/**
 * Whether free text looks like it carries an account number. Used on the notes the system copies
 * into a notification, and on the two account fields every screen shows unmasked, where an account
 * number must never land (payout spec §11.3). A number counts when it has:
 *  - a run of 6 or more digits; or
 *  - 10 or more digits written in groups, the way people write an account or a PromptPay number:
 *    "123-4-56789-0", "081 234 5678", "123.4.56789.0", "123/4/56789/0", with one or several spaces.
 * Thai digits are read as digits. Two things people do write in such notes are let through: the
 * product's own document numbers, and a plain amount followed by "บาท" ("ยอดเกิน 1500000 บาท").
 * Groups are only joined from 10 digits up, so a date such as "01-10-2569" or "01/10/2569" still passes.
 */
// ponytail: a heuristic for what people type by accident, not a wall against someone set on writing
// a number out (in words, or dressed as "AB-2026-10-345678"). The audited reveal is the wall.
export function looksLikeAccountNumber(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const plain = text
    .replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(OWN_DOCUMENT_NUMBER, ' ');
  for (const written of plain.matchAll(/\d+(?:(?:\s+|[-./])\d+)*/g)) {
    const groups = written[0].split(/\D+/);
    if (groups.join('').length < 10 && groups.every((group) => group.length < 6)) continue;
    // An amount is one number of at most 9 digits that does not start with 0, said to be baht.
    const amount = /^[1-9]\d{0,8}(?:\.\d{1,2})?$/.test(written[0]) && /^\s*บาท/.test(plain.slice(written.index + written[0].length));
    if (!amount) return true;
  }
  return false;
}

/** The one masked form of an account number, on every surface that shows one. */
export function maskedPayoutAccountNumber(accountLast4: string): string {
  return `ลงท้าย ${accountLast4}`;
}

/**
 * The masked account in words — "ธนาคารกสิกรไทย เลขบัญชีลงท้าย 6789", "พร้อมเพย์เบอร์ลงท้าย 5678" —
 * so the screen, the notification and the printed form never phrase it differently.
 */
export function maskedPayoutAccount(account: {
  payoutKind?: ReimbursementPayoutKind | null;
  bankName?: string | null;
  accountLast4?: string | null;
}): string {
  const masked = maskedPayoutAccountNumber(account.accountLast4 ?? '');
  return account.payoutKind === 'PROMPTPAY_PHONE' ? `พร้อมเพย์เบอร์${masked}` : `${account.bankName ?? ''} เลขบัญชี${masked}`.trim();
}

/** A member's default payout account as every screen sees it: never the full number. */
export type MemberPayoutAccountSummary = {
  userId: string;
  payoutMethod: ReimbursementPayoutMethod;
  payoutKind?: ReimbursementPayoutKind;
  bankName?: string;
  accountName?: string;
  accountLast4?: string;
  updatedAt: string;
  /** Present while the latest save was made by someone else, until the account owner saves it themselves. */
  setByOtherName?: string;
};

export type MemberPayoutAccountResponse = {
  account: MemberPayoutAccountSummary | null;
  /** Whether THIS viewer may set or change the account; the same rule the write call enforces. */
  canEdit?: boolean;
};

export type SetMemberPayoutAccountInput =
  | { payoutMethod: 'CASH' }
  | ({ payoutMethod: 'BANK_TRANSFER' } & PayoutDestinationInput);

/** The answer of the audited "แสดงเลขบัญชี" call: the only outbound shape that carries a full number. */
export type PayoutAccountReveal = { accountNumber: string };

/** A draft's choice: follow the requester's default account, take cash, or name an account for this claim only. */
export type ReimbursementPayoutInput =
  | { mode: 'DEFAULT' }
  | { mode: 'CASH' }
  | ({
    mode: 'SPECIFIED';
    /** Also make it the requester's default account; the claim then follows that default. */
    saveAsDefault?: boolean;
  } & PayoutDestinationInput);

export type ReimbursementPayoutNotReadyReason = 'payout_method_required' | 'payout_destination_required';

/**
 * A claim's receiving method and account, masked. Once the claim is submitted this is the claim's
 * own frozen snapshot: a later change to the member's default account never shows up here.
 */
export type ReimbursementPayoutSummary = {
  /** Absent only while a draft follows a default account the requester has not set yet. */
  payoutMethod?: ReimbursementPayoutMethod;
  payoutKind?: ReimbursementPayoutKind;
  bankName?: string;
  accountName?: string;
  accountLast4?: string;
  /** The claim's own snapshot version. Absent for cash, and while a draft still follows the default. */
  version?: number;
  source?: ReimbursementPayoutSource;
  /** Draft only: the account is read from the requester's default until submit freezes a copy. */
  followsDefault?: boolean;
  /** Who typed or set the account, when it was not the requester. The name is absent when it cannot be resolved (they left the company). */
  enteredByUserId?: string;
  enteredByName?: string;
  /** The attestation of exactly this version ("ตรวจบัญชีแล้ว"); absent until someone attests it. */
  verifiedByUserId?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  /** Draft only: why submit would be refused. */
  notReadyReason?: ReimbursementPayoutNotReadyReason;
  /**
   * Draft only, on the detail read: what "ส่งอนุมัติ" would freeze right now, as an opaque token. The
   * page sends it back as `payoutSubmitToken`, so the claim is sent with the account it showed.
   */
  submitToken?: string;
  /**
   * For the requester only, on the detail read of a sent claim not yet paid: their default account
   * is no longer the one this claim copied. The claim still uses the account shown here. Absent means no.
   */
  defaultAccountChanged?: true;
  /**
   * Whether THIS viewer may call "แสดงเลขบัญชี". Set on the detail read only; absent means no.
   * About the account number alone: who may open a payment slip is a different group and a different flag.
   */
  canRevealAccountNumber?: boolean;
};

/**
 * Legacy claims only (payout spec §15). A claim sent before claims carried an account froze none, so
 * whoever records its payment is shown the requester's CURRENT default account instead, as an account
 * this claim never had approved. Masked like every other account: the full number comes from the
 * claim's own reveal call, which answers that payer for this account and records it.
 */
export type ReimbursementLegacyPayoutDefault = {
  payoutKind: ReimbursementPayoutKind;
  bankName?: string;
  accountName: string;
  accountLast4: string;
  /**
   * Names the account shown, opaquely. A payer who transferred into it sends this back as
   * `payoutDefaultToken`; the payment is refused (`payout_destination_changed`) when the requester's
   * default is no longer that account, so nobody confirms an account they were not shown.
   */
  confirmToken: string;
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
