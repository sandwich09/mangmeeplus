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
  missingReceiptReason?: string;
  /** Where the money goes back to, masked. Absent on a legacy claim: one sent before claims carried a receiving method. */
  payout?: ReimbursementPayoutSummary;
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
   * `payout.submitToken` of the detail the submitter was looking at. Required when the claim's
   * account comes from the requester's default: a submit that would freeze anything else than what
   * was shown is refused with `payout_destination_changed`.
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
 * Returns the first field that fails, or null.
 */
export function invalidPayoutDestinationField(input: Partial<PayoutDestinationInput> | null | undefined): PayoutDestinationField | null {
  const kind = input?.payoutKind;
  if (kind !== 'BANK_ACCOUNT' && kind !== 'PROMPTPAY_PHONE') return 'payoutKind';
  const bankName = typeof input?.bankName === 'string' ? input.bankName.trim() : '';
  if (kind === 'BANK_ACCOUNT' && (bankName.length === 0 || bankName.length > PAYOUT_BANK_NAME_MAX_LENGTH)) return 'bankName';
  const accountName = typeof input?.accountName === 'string' ? input.accountName.trim() : '';
  if (accountName.length < 2 || accountName.length > PAYOUT_ACCOUNT_NAME_MAX_LENGTH || /^[\d\s-]+$/.test(accountName)) return 'accountName';
  const accountNumber = normalizePayoutAccountNumber(input?.accountNumber);
  if (!(kind === 'BANK_ACCOUNT' ? /^\d{6,20}$/ : /^0\d{9}$/).test(accountNumber)) return 'accountNumber';
  return null;
}

/**
 * Whether free text looks like it carries an account number. Used on the notes the system copies
 * into a notification, where an account number must never land (payout spec §11.3):
 *  - a run of 6 or more digits; or
 *  - 10 or more digits written in groups joined by spaces or dashes, the way people write an account
 *    or a PromptPay number: "123-4-56789-0", "081 234 5678".
 * Groups are only joined from 10 digits up, so a date such as "01-10-2569" or "2026-10-01" still passes.
 */
export function looksLikeAccountNumber(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  if (/\d{6,}/.test(text)) return true;
  return (text.match(/\d+(?:[ -]\d+)+/g) ?? []).some((grouped) => grouped.replace(/[ -]/g, '').length >= 10);
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
  /** Who typed or set the account, when it was not the requester. */
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
   * Whether THIS viewer may call "แสดงเลขบัญชี". Set on the detail read only; absent means no.
   * About the account number alone: who may open a payment slip is a different group and a different flag.
   */
  canRevealAccountNumber?: boolean;
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
