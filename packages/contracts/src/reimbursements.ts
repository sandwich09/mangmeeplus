// ---- Item 14: Reimbursement Approval and Review ----
//
// Business contract for the reimbursement workflow. All monetary amounts are
// decimal strings (4 dp in DB). Dates are ISO strings across the wire.

import { coerceCivilDate, isCivilDate, todayCivilDate } from './civil-date.js';
import type { ExpenseVoidBlocker } from './expenses.js';
import { withholdingPeriodLockedMessage } from './tax.js';
import { expenseCorrectionMonth } from './expenses.js';
import { THAI_SYSTEM_ROLE_NAMES } from './employee-access.js';

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
  approvalFloor?: 'THIRD_PARTY_PAYOUT';
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

/** Owner 2026-10-04: evidence replaces a reference; transfers always need their slip separately. */
export function reimbursementPaymentReferenceRequired(paymentMethod: string, hasSlip = false): boolean {
  return paymentMethod === 'CHEQUE' && !hasSlip;
}

const transferReferenceName = 'เลขที่อ้างอิงการโอน';
const chequeReferenceName = 'เลขที่เช็ค';
const referenceRequiredMessage = `กรอก${chequeReferenceName}หรือแนบหลักฐานการจ่าย`;
export const REIMBURSEMENT_PAYMENT_REFERENCE_TEXT = {
  neutralLabel: 'เลขอ้างอิง',
  transferName: transferReferenceName,
  chequeName: chequeReferenceName,
  optionalName: 'เลขที่เอกสารการจ่าย',
  transferHint: `ดู${transferReferenceName}บนสลิปหรือในแอปธนาคาร ใช้กระทบยอดกับรายการเดินบัญชีภายหลัง ไม่บังคับกรอกเมื่อแนบสลิป`,
  chequeHint: `ดู${chequeReferenceName}บนเช็ค ใช้กระทบยอดกับรายการเดินบัญชีภายหลัง หากไม่กรอก ให้แนบหลักฐานการจ่าย`,
  optionalHint: 'ถ้ามี กรอกเลขที่ใบสำคัญจ่ายหรือใบเสร็จรับเงินไว้ค้นรายการภายหลัง',
  requiredMessage: referenceRequiredMessage,
  confirmationHint: 'ถ้าโอนเข้าบัญชีที่ใบนี้ระบุ ต้องติ๊กยืนยันบัญชีที่โอนเข้า',
  guidance: `เมื่อโอนเงิน ต้องแนบสลิป จะกรอก${transferReferenceName}ด้วยก็ได้ หากจ่ายเช็ค ${referenceRequiredMessage} เงินสดและวิธีอื่นกรอกเลขที่เอกสารการจ่ายได้ถ้ามี`,
} as const;

export function reimbursementPaymentReferenceField(paymentMethod: string, hasSlip: boolean) {
  const words = REIMBURSEMENT_PAYMENT_REFERENCE_TEXT;
  const transfer = paymentMethod === 'BANK_TRANSFER';
  const cheque = paymentMethod === 'CHEQUE';
  const required = reimbursementPaymentReferenceRequired(paymentMethod, hasSlip);
  const name = transfer ? words.transferName : cheque ? words.chequeName : words.optionalName;
  return {
    name, required,
    label: `${name}${transfer ? ' (ไม่บังคับเมื่อแนบสลิป)' : required ? ' *' : cheque ? ' (ไม่บังคับเมื่อแนบหลักฐาน)' : ' (ไม่บังคับ)'}`,
    hint: transfer ? words.transferHint : cheque ? words.chequeHint : words.optionalHint,
  };
}

export const REIMBURSEMENT_PAYMENT_STEP_NOTE = `บันทึกจ่ายเต็มจำนวน ระบุวิธีจ่ายและวันที่ ${REIMBURSEMENT_PAYMENT_REFERENCE_TEXT.guidance} ${REIMBURSEMENT_PAYMENT_REFERENCE_TEXT.confirmationHint}`;

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
  holderType?: ReimbursementPayoutHolderType;
  holderNote?: string;
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
   * Why the payer paid by another method than the claim states. Present exactly when they did, so
   * every surface says "จ่ายต่างจากที่ระบุในใบ" from this one fact (of the claim, never of who chose
   * its method: whoever prepared it, or answered a round for the requester, may have).
   */
  methodMismatchReason?: string;
};

// ---- One payment, the same words on every surface (spec §25.1, invariant I4) ----

/** A payment method in words: the payment row, the claim's timeline and the requester's notice read it from here. */
export const REIMBURSEMENT_PAYMENT_METHOD_LABELS: Record<ReimbursementPaymentMethod, string> = {
  CASH: 'เงินสด', BANK_TRANSFER: 'โอนเงิน', CHEQUE: 'เช็ค', OTHER: 'อื่น ๆ',
};

/** What a payment's words are built from. A payment summary has these, and so has a payment as it is being recorded. */
export type ReimbursementPaymentFacts = {
  paymentMethod: string;
  paidAmount: string;
  currency: string;
  slipCount: number;
  /** The account the payer confirmed the transfer into; absent when none was confirmed. */
  payoutDestination?: { payoutKind?: string | null; accountLast4?: string | null; holderType?: ReimbursementPayoutHolderType } | null;
};

/**
 * How a payment was made, in one phrase: where a confirmed transfer went ("โอนเข้าบัญชีลงท้าย 1234",
 * "โอนเข้าพร้อมเพย์เบอร์ลงท้าย 5678"), otherwise the method's own word. Empty for a method there is
 * no word for: a code is never printed.
 */
export function reimbursementPaymentHowText(payment: Pick<ReimbursementPaymentFacts, 'paymentMethod' | 'payoutDestination'>): string {
  const destination = payment.payoutDestination;
  if (destination) return `โอนเข้า${maskedPayoutAccountWithHolder({ payoutKind: destination.payoutKind === 'PROMPTPAY_PHONE' ? 'PROMPTPAY_PHONE' : 'BANK_ACCOUNT', accountLast4: destination.accountLast4, holderType: destination.holderType }).replace(/^เลขบัญชี/, 'บัญชี')}`;
  return Object.hasOwn(REIMBURSEMENT_PAYMENT_METHOD_LABELS, payment.paymentMethod)
    ? REIMBURSEMENT_PAYMENT_METHOD_LABELS[payment.paymentMethod as ReimbursementPaymentMethod] : '';
}

/**
 * What the requester is told when their claim is paid (spec §17.3, AC37): the method actually used,
 * which is not always the one they asked for (AC21); for a transfer the payer confirmed, the last 4
 * digits of the account it went into; the amount; and whether a slip is attached, which the notice's
 * link opens on the claim page. The payment event carries this as a finished sentence, built where
 * the payment is recorded from the payment's own facts: no template assembles it from raw fields.
 */
export function reimbursementPaidNotice(payment: ReimbursementPaymentFacts): string {
  // "1,614.50 บาท", as the claim page writes it. Another currency keeps its code rather than being called baht.
  const amount = `${Number(payment.paidAmount).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${
    payment.currency === 'THB' ? 'บาท' : payment.currency}`;
  const how = reimbursementPaymentHowText(payment);
  const paid = payment.payoutDestination || payment.paymentMethod === 'BANK_TRANSFER' ? `${how} จำนวน ${amount}`
    : payment.paymentMethod === 'OTHER' ? `จ่ายด้วยวิธีอื่น ${amount}`
      : how ? `จ่ายเป็น${how} ${amount}` : `จ่ายแล้ว ${amount}`;
  return `${paid}${payment.slipCount > 0 ? ' มีสลิปแนบ แตะเพื่อดูสลิป' : ''}`;
}

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

export const REIMBURSEMENT_POLICY_TAB_LABEL = 'ตั้งค่านโยบาย';
export const REIMBURSEMENT_SELF_APPROVAL_SWITCH_LABEL = 'ให้ผู้อนุมัติอนุมัติใบเบิกของตัวเองได้';
export const REIMBURSEMENT_SELF_APPROVAL_HELP = `ให้ผู้อนุมัติคนอื่นตัดสินแทน หรือให้ผู้มีสิทธิ์ตั้งค่านโยบายเปิด "${REIMBURSEMENT_SELF_APPROVAL_SWITCH_LABEL}" ใน${REIMBURSEMENT_POLICY_TAB_LABEL} ใบที่เก็บนโยบายไว้ตอนส่งต้องเปิดกลับเป็นร่างและส่งอนุมัติใหม่เมื่อยังไม่มีใครตัดสิน เพื่อใช้นโยบายที่เปิด`;
export const REIMBURSEMENT_SELF_APPROVAL_DENIED = `ไม่สามารถอนุมัติใบเบิกของตัวเองได้ตามนโยบายที่ใบนี้ใช้ ${REIMBURSEMENT_SELF_APPROVAL_HELP}`;

export type ReimbursementDuplicateReason = 'ATTACHMENT_CHECKSUM' | 'EXPENSE_LINK' | 'AMOUNT_DATE_VENDOR' | 'MANUAL' | 'EXPENSE_DOCUMENT' | 'EXPENSE_CONFIRMATION' | 'EXPENSE_CONFIRMED_DUPLICATE';
const POSSIBLE_OTHER_CLAIM_TEXT = 'อาจซ้ำกับคำขอเบิกอื่น';
export const REIMBURSEMENT_DUPLICATE_REASON_TEXT: Record<ReimbursementDuplicateReason, string> = {
  ATTACHMENT_CHECKSUM: 'ใช้ใบเสร็จเดียวกับคำขอเบิกอื่น',
  EXPENSE_LINK: 'ใช้รายการค่าใช้จ่ายเดียวกับคำขอเบิกอื่น',
  AMOUNT_DATE_VENDOR: POSSIBLE_OTHER_CLAIM_TEXT,
  MANUAL: POSSIBLE_OTHER_CLAIM_TEXT,
  EXPENSE_DOCUMENT: 'เอกสารค่าใช้จ่ายของใบนี้อาจซ้ำกับเอกสารเดิม',
  EXPENSE_CONFIRMATION: 'เอกสารค่าใช้จ่ายของใบนี้ยังรอยืนยันหลังปลดรายการซ้ำ',
  EXPENSE_CONFIRMED_DUPLICATE: 'ใบเสร็จของใบเบิกนี้ได้รับการยืนยันว่าซ้ำ',
};
export const REIMBURSEMENT_DUPLICATE_BLOCK_LABEL = 'ติดรายการซ้ำ';
export const REIMBURSEMENT_DUPLICATE_CLEAR_HELP = 'ตรวจแล้วถ้าไม่ซ้ำ กดปลดรายการซ้ำพร้อมเหตุผล เพื่อปลดและยืนยันเอกสารก่อนบันทึกจ่าย ถ้าการยืนยันยังไม่เสร็จ กดปลดรายการซ้ำอีกครั้ง';
export function reimbursementDuplicateReasonText(reasons: readonly string[] = []): string {
  return [...new Set(reasons.filter(reason => Object.hasOwn(REIMBURSEMENT_DUPLICATE_REASON_TEXT, reason)).map(reason => REIMBURSEMENT_DUPLICATE_REASON_TEXT[reason as ReimbursementDuplicateReason]))].join(' และ ') || POSSIBLE_OTHER_CLAIM_TEXT;
}
export const REIMBURSEMENT_DUPLICATE_FINANCE_HELP = 'ตรวจว่าไม่ซ้ำแล้ว ให้ผู้ตรวจการเงินที่มีสิทธิ์ปลดรายการซ้ำอนุมัติจ่ายพร้อมเหตุผลก่อนบันทึกจ่าย';
export const REIMBURSEMENT_DUPLICATE_RESOLUTION_SAVED = 'บันทึกการตรวจรายการซ้ำแล้ว';
export type ReimbursementDuplicateGuidanceContext = {
  status?: string;
  canCancel?: boolean;
  cancellationPending?: boolean;
  canResumeCancellation?: boolean;
};
const CONFIRMED_DUPLICATE_PAYMENT_REASON = `${REIMBURSEMENT_DUPLICATE_REASON_TEXT.EXPENSE_CONFIRMED_DUPLICATE} จึงบันทึกจ่ายไม่ได้`;
const DUPLICATE_CANCEL_ACTOR = 'ผู้เบิกที่มีสิทธิ์ยกเลิกหรือผู้ตรวจการเงินที่ดูแลสาขาของใบนี้';
const DUPLICATE_NEW_CLAIM_HELP = 'ให้ผู้เบิกส่งใบเบิกใหม่โดยไม่ใส่รายการซ้ำ';
const DUPLICATE_CANCEL_ACTION = 'กดยกเลิกคำขอในหน้าใบเบิกนี้';
const DUPLICATE_CANCEL_HELP = `ให้${DUPLICATE_CANCEL_ACTOR}ยกเลิกคำขอ`;
const DUPLICATE_VOID_ACTOR = 'ผู้มีสิทธิ์ยกเลิกการจ่ายของสาขานี้';
const DUPLICATE_VOID_HELP = `ให้${DUPLICATE_VOID_ACTOR}ตรวจและยกเลิกรายการจ่ายให้ครบก่อน`;
/** Display-only duplicate hold, from the row/detail payment predicate; stored routing is unchanged. */
export function reimbursementDuplicateWait(claim?: { status?: string; duplicateReasons?: readonly string[]; hasDuplicateBlocker?: boolean; duplicateBlocksPayment?: boolean; cancellationPending?: boolean; currentDesk?: { kind?: string } | null } | null) {
  if (!claim || claim.cancellationPending || claim.currentDesk?.kind === 'SYSTEM') return undefined;
  if (!claim.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE')) {
    if (!(claim.hasDuplicateBlocker || claim.duplicateBlocksPayment) || !['READY_FOR_PAYMENT', 'APPROVED', 'PARTIALLY_PAID'].includes(claim.status ?? '') || (claim.status === 'APPROVED' && claim.currentDesk?.kind !== 'PAYMENT')) return undefined;
    return { status: REIMBURSEMENT_DUPLICATE_BLOCK_LABEL, actor: REIMBURSEMENT_DESK_LABELS.PAYMENT,
      waiting: reimbursementDuplicateBlockNotice(claim.duplicateReasons, false, { status: claim.status }) };
  }
  if (claim.status === 'PARTIALLY_PAID') return { status: undefined, actor: DUPLICATE_VOID_ACTOR,
    waiting: reimbursementDuplicateBlockNotice(claim.duplicateReasons, false, { status: claim.status }) };
  if (claim.status !== 'READY_FOR_PAYMENT' && !(claim.status === 'APPROVED' && claim.currentDesk?.kind === 'PAYMENT')) return undefined;
  return { status: 'รอยกเลิก', actor: DUPLICATE_CANCEL_ACTOR, waiting: `รอยกเลิกคำขอ เพราะใบเสร็จยืนยันว่าซ้ำ ${DUPLICATE_CANCEL_HELP}` };
}
export const REIMBURSEMENT_DUPLICATE_CONFIRM_WARNING = `หากยืนยันว่าซ้ำ ใบเบิกนี้จะบันทึกจ่ายไม่ได้ ต้องยกเลิกใบเบิกนี้ แล้ว${DUPLICATE_NEW_CLAIM_HELP} หากมีรายการจ่ายอยู่ ${DUPLICATE_VOID_HELP}จึงจะยกเลิกใบเบิกได้ การยืนยันว่าซ้ำแล้วไม่สามารถย้อนกลับได้`;
export function reimbursementDuplicateBlockText(reasons: readonly string[] = []): string {
  return reasons.includes('EXPENSE_CONFIRMED_DUPLICATE') ? 'ยืนยันว่าใบเสร็จซ้ำ' : 'อาจซ้ำ';
}
export function reimbursementDuplicateBlockNotice(reasons: readonly string[] = [], financeReview = false, context: ReimbursementDuplicateGuidanceContext = {}): string {
  if (reasons.includes('EXPENSE_CONFIRMED_DUPLICATE')) {
    const why = CONFIRMED_DUPLICATE_PAYMENT_REASON;
    // After a cancellation the requester sends a new claim: "…ยกเลิกคำขอ แล้วให้ผู้เบิก…" reads as one step after the other.
    const then = `แล้ว${DUPLICATE_NEW_CLAIM_HELP}`;
    let help: string;
    if (context.status === 'CANCELLED' || context.status === 'VOIDED') {
      help = `${context.status === 'CANCELLED' ? 'ใบนี้ยกเลิกแล้ว' : 'ใบนี้เพิกถอนแล้ว'} ${DUPLICATE_NEW_CLAIM_HELP}`;
    } else if (context.status === 'REJECTED') {
      help = `ใบนี้ถูกส่งกลับให้แก้ ${DUPLICATE_NEW_CLAIM_HELP}`;
    } else if (context.cancellationPending) {
      help = `ใบนี้กำลังดำเนินการยกเลิก ${context.canResumeCancellation ? 'กดดำเนินการยกเลิกต่อในหน้าใบเบิกนี้' : `ให้${DUPLICATE_CANCEL_ACTOR}ดำเนินการยกเลิกต่อ`} เมื่อยกเลิกเสร็จแล้ว ${DUPLICATE_NEW_CLAIM_HELP}`;
    } else if (context.status === 'PARTIALLY_PAID' || context.status === 'PAID') {
      help = `ใบนี้มีรายการจ่ายอยู่ จึงยกเลิกคำขอไม่ได้ ${DUPLICATE_VOID_HELP} เมื่อยกเลิกรายการจ่ายครบแล้ว ${DUPLICATE_CANCEL_HELP} ${then}`;
    } else if (!context.status) {
      // The reader's claim status is not known here (an error answer without it): say both steps.
      help = `${DUPLICATE_CANCEL_HELP} ถ้ามีรายการจ่ายอยู่ต้องยกเลิกการจ่ายให้ครบก่อน ${then}`;
    } else {
      help = `${context.canCancel ? DUPLICATE_CANCEL_ACTION : DUPLICATE_CANCEL_HELP} ${then}`;
    }
    return `${why} ${help}`;
  }
  return `${REIMBURSEMENT_DUPLICATE_BLOCK_LABEL}: ${reimbursementDuplicateReasonText(reasons)} ${financeReview ? REIMBURSEMENT_DUPLICATE_FINANCE_HELP : REIMBURSEMENT_DUPLICATE_CLEAR_HELP}`;
}
export const REIMBURSEMENT_DUPLICATE_UNRESOLVED = 'พบรายการที่อาจซ้ำ ต้องตรวจสอบก่อนทำต่อ';

/** Confirmed receipts cannot be cleared; these notices use the same general cancellation guidance as the claim. */
export function reimbursementConfirmedDuplicateNotice(recipient: 'requester' | 'cancel', overdue = false) {
  return {
    description: 'แจ้งเมื่อใบเสร็จของใบเบิกยืนยันว่าซ้ำ เพื่อให้ยกเลิกใบเบิกและส่งใบใหม่',
    title: `ใบเบิก${REIMBURSEMENT_DUPLICATE_BLOCK_LABEL}${overdue ? 'เกินกำหนด' : ''}: {{requestNo}}`,
    body: recipient === 'requester' ? reimbursementDuplicateBlockNotice(['EXPENSE_CONFIRMED_DUPLICATE'])
      : `${CONFIRMED_DUPLICATE_PAYMENT_REASON} รอคุณยกเลิกคำขอ ${DUPLICATE_NEW_CLAIM_HELP}`,
  };
}

export type ReimbursementPaymentDuplicateBlock = 'NONE' | 'UNRESOLVED' | 'CONFIRMED';
export const REIMBURSEMENT_PAYMENT_VOIDED_TITLE = 'ยกเลิกการจ่ายเงินเบิก: {{requestNo}}';

/** The payer's next step; callers suppress confirmed duplicates instead of telling anyone to pay. */
export function reimbursementPaymentTurnNotice(kind: 'ready' | 'overdue', unresolved = false): { title: string; body: string } {
  return {
    title: `${unresolved ? `ใบเบิกรอตรวจรายการที่อาจซ้ำ${kind === 'overdue' ? 'เกินกำหนด' : ''}`
      : kind === 'overdue' ? 'ใบเบิกรอจ่ายเงินเกินกำหนด' : 'พร้อมจ่ายเบิกจ่าย'}: {{requestNo}}`,
    body: `ยอด {{amount}} {{currency}} · ${unresolved ? 'รอคุณตรวจรายการที่อาจซ้ำก่อนบันทึกการจ่ายเงิน' : 'รอคุณบันทึกการจ่ายเงิน'}`,
  };
}

/** Only facts after the void, never its free-text reason or an account number. */
export function reimbursementPaymentVoidedNotice(claim: {
  status?: string; cancellationPending?: boolean; paymentDuplicateBlock?: ReimbursementPaymentDuplicateBlock; duplicateReasons?: readonly string[];
} = {}): string {
  const next = claim.cancellationPending ? REIMBURSEMENT_SYSTEM_WAIT_LABEL
    : claim.paymentDuplicateBlock && claim.paymentDuplicateBlock !== 'NONE'
      ? reimbursementDuplicateWait({ ...claim, currentDesk: { kind: 'PAYMENT' } })?.waiting
        ?? reimbursementDuplicateBlockNotice(claim.duplicateReasons, false, claim)
      : claim.status === 'PAID' ? 'ใบเบิกยังจ่ายครบแล้ว' : 'ใบเบิกกลับไปรอจ่าย';
  return `การจ่ายเงินที่บันทึกไว้ถูกยกเลิก ${next}`;
}
export function reimbursementDuplicateSubmitNotice(reasons: readonly string[] = []): string {
  return `พบรายการที่อาจซ้ำ: ${reimbursementDuplicateReasonText(reasons)} ยังส่งใบนี้ไม่ได้ ตรวจและแก้หลักฐาน หรือให้ผู้มีสิทธิ์ตั้งค่านโยบายตรวจนโยบายรายการซ้ำก่อนส่งอีกครั้ง`;
}
export const REIMBURSEMENT_DUPLICATE_POLICY_NOTE = 'ใบเสร็จหรือรายการค่าใช้จ่ายเดียวกันตรวจข้ามผู้เบิกทั้งบริษัท ความคล้ายของยอดและวันตรวจเฉพาะผู้เบิกเดียวกัน ใบที่เก็บนโยบายระงับการจ่ายไว้ตอนส่งจ่ายไม่ได้เมื่อรายการซ้ำของใบยังไม่ตัดสิน หรือเอกสารค่าใช้จ่ายของใบยังอาจซ้ำ ต้องตรวจแล้วปลดรายการซ้ำพร้อมเหตุผล และยืนยันเอกสารก่อนจ่าย';

// ---- Duplicate candidate ----

export type ReimbursementDuplicateCandidateSummary = {
  resolvedByName?: string;
  resolvedAt?: string;
  id: string;
  candidateType: 'ATTACHMENT_CHECKSUM' | 'EXPENSE_LINK' | 'AMOUNT_DATE_VENDOR' | 'MANUAL';
  candidateRequestId?: string;
  candidateExpenseId?: string;
  documentNumber?: string;
  requesterOrPayee?: string;
  amount?: string;
  currency?: string;
  date?: string;
  canOpen?: boolean;
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
  receiptPolicy?: { requireReceipt: boolean; allowMissingReceiptWithReason: boolean };
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

// `SYSTEM`: nobody's turn. The claim's decision is already made (approved, or being cancelled) and
// the system has not finished moving it on; while it is there, nobody is asked to approve or pay it.
export type ReimbursementCurrentDeskKind = 'REQUESTER' | 'APPROVER' | 'FINANCE' | 'PAYMENT' | 'SYSTEM';

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
  SYSTEM: 'ระบบ',
};

/**
 * What a claim on the system's desk is said to wait for: the words of the LINE backlog answer, and of
 * the claim page's step note and timeline row for the same claim.
 */
export const REIMBURSEMENT_SYSTEM_WAIT_LABEL = 'รอระบบปรับสถานะ';

/** The known fact on the claim page and printed form, for policy-on, solo and older frozen self-approvals alike. */
export const REIMBURSEMENT_SELF_APPROVED_NOTE = 'ผู้เบิกและผู้อนุมัติเป็นบุคคลเดียวกัน ใบนี้ได้รับการอนุมัติโดยผู้เบิกเอง';

// ---- หน้ารวม (hub) buckets ----

/** A returned claim is work for its requester or the person who prepared it. */
export function reimbursementNeedsCorrection(claim: {
  status: string; financeReviewStatus: string; requesterUserId: string; createdByUserId?: string;
  payoutCorrectionRequestedAt?: unknown; payoutCorrectionSubmittedAt?: unknown;
}, userId: string): boolean {
  return (claim.requesterUserId === userId || claim.createdByUserId === userId)
    && (claim.status === 'REJECTED' || (claim.status === 'DRAFT' && claim.financeReviewStatus === 'NEEDS_INFO')
      || (claim.status === 'PENDING_APPROVAL' && !!claim.payoutCorrectionRequestedAt && !claim.payoutCorrectionSubmittedAt));
}

/** Every claim sits in exactly one bucket, so the hub's chips add up to "ทั้งหมด". */
export type ReimbursementHubBucket = 'draft' | 'correction' | 'review' | 'payment' | 'duplicate_blocked' | 'paid' | 'closed';

/**
 * Where a claim's status alone places it. Typed over every status, so a status added later has to be
 * placed here and cannot fall into ยกเลิก unnoticed.
 */
const HUB_BUCKET_BY_STATUS: Record<ReimbursementRequestStatus, ReimbursementHubBucket> = {
  DRAFT: 'draft',
  PENDING_APPROVAL: 'review',
  FINANCE_REVIEW: 'review',
  APPROVED: 'payment',
  READY_FOR_PAYMENT: 'payment',
  PARTIALLY_PAID: 'payment',
  PAID: 'paid',
  REJECTED: 'correction',
  CANCELLED: 'closed',
  VOIDED: 'closed',
};

/**
 * The hub bucket of a claim: the desk it waits at, the one its row prints as "อยู่ที่ …". A claim with no
 * desk, with the system's desk, or with a desk kind this code does not know, is placed by its status: a
 * draft is a draft whether or not the row carries a desk. One rule for the cards, the chips and the list.
 */
export function reimbursementHubBucket(claim: {
  needsCorrection?: boolean;
  status?: string;
  financeReviewStatus?: string;
  currentDesk?: { kind?: string } | null;
  hasDuplicateBlocker?: boolean;
}): ReimbursementHubBucket {
  if (claim.needsCorrection) return 'correction';
  const paymentBucket = claim.hasDuplicateBlocker ? 'duplicate_blocked' : 'payment';
  switch (claim.currentDesk?.kind) {
    // A claim waiting for approval that is with its requester was sent back to have its payout account
    // corrected (payout spec §14). It stands at the approval step, so its status places it, in รออนุมัติ/ตรวจสอบ:
    // the counts and the list filter are made from the status, and a row must fall where they put it.
    case 'REQUESTER': if (claim.status === 'PENDING_APPROVAL') break; return 'draft';
    case 'APPROVER': case 'FINANCE': return 'review';
    case 'PAYMENT': return paymentBucket;
  }
  // Approved and still being routed on: to finance review while that is pending, otherwise to payment.
  if (claim.status === 'APPROVED' && claim.financeReviewStatus === 'PENDING') return 'review';
  const bucket = HUB_BUCKET_BY_STATUS[claim.status as ReimbursementRequestStatus] ?? 'closed';
  return bucket === 'payment' ? paymentBucket : bucket;
}

/** The whole list scope as the server counted it, or what a search found in it: what the hub's cards and chips print. */
export type ReimbursementHubBootstrap = {
  financeReviewRequired: boolean;
  /** Exact assignments can keep this queue available after a role change. */
  hasApprovalTasks: boolean;
  queueCounts: { approvals: number; finance?: number };
  /** Visible rows, including held work; queueCounts above still chooses the initial work queue. */
  listCounts?: { mine?: number; approvals: number; finance?: number };
};

export type ReimbursementHubSummary = {
  /** Claims per bucket, and `all` for the scope. The buckets add up to `all`. */
  counts: Record<'all' | ReimbursementHubBucket, number>;
  /** Sum of the claimed amounts of the scope. */
  totalAmount: string;
  /** Drafts that still owe a receipt before they can be submitted. */
  blockedDraftCount: number;
  /** Whole searched scope before paging; pendingPayment excludes the duplicates held outside the payment bucket. */
  metrics?: { pendingApproval: { count: number; amount: string }; pendingPayment: { count: number; amount: string } };
};

// ---- Request ----

export type ReimbursementRequestSummary = {
  approvalActions?: { canApprove: boolean; canReject: boolean };
  needsCorrection?: boolean;
  /** Saved approver reason, also shown on the requester’s list row. */
  rejectionReason?: string;
  cancelledCertificates?: Array<{ expenseId: string; kind: 'SYSTEM' | 'EXTERNAL'; number: string | null }>;
  /** The payment predicate evaluated on this claim's submitted policy and own duplicate facts. */
  hasDuplicateBlocker?: boolean;
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
  /**
   * Present while a cancellation of the claim was started and has not completed. The API takes no other
   * decision on the claim meanwhile (submit, approve, reject, finance review, payment, a second cancel),
   * so a list or queue row offers none. The claim detail says more in `pendingCancellation`.
   */
  cancellationPending?: true;
  financeReviewStatus: ReimbursementFinanceReviewStatus;
  paymentStatus: ReimbursementPaymentStatus;
  duplicateStatus: ReimbursementDuplicateStatus;
  duplicateReasons?: ReimbursementDuplicateReason[];
  receiptRequirementStatus: ReimbursementReceiptRequirementStatus;
  /** Effective policy hint for pre-submit guidance; server validation remains authoritative. */
  allowMissingReceiptWithReason?: boolean;
  postingStatus: ReimbursementPostingStatus;
  /** How the requester asked to be paid back. Absent on a legacy claim and on a draft that follows the default account. */
  payoutMethod?: ReimbursementPayoutMethod;
  /**
   * Present while the claim was sent back from the pay step for its requester to give its payout
   * destination again (payout spec §14): whom it waits for. Its status is PENDING_APPROVAL meanwhile,
   * and nothing is paid. What it is said to wait for is `reimbursementPayoutRoundStatus`.
   */
  payoutCorrectionPhase?: ReimbursementPayoutCorrectionPhase;
  /**
   * AWAITING_APPROVAL only: what the requester gave, against what the claim was approved with when the
   * round began. Absent on a claim whose round has no record of how it began.
   */
  payoutCorrectionAnswer?: ReimbursementPayoutRoundAnswer;
  /**
   * AWAITING_APPROVAL only: who gave that answer, and whether it was someone other than the requester. A
   * sentence that says what was done says it of this person (`reimbursementPayoutRoundDid`).
   */
  payoutCorrectionAnsweredBy?: ReimbursementPayoutRoundAnsweredBy;
  paymentTotalAmount: string;
  outstandingAmount: string;
  lineCount: number;
  submittedAt?: string;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
  /** Signed document completion, read on the list as on the claim page. */
  documentSignedVia?: ReimbursementDocumentSignedVia;
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
  /**
   * A scan declared as signed before the claim was sent back from the pay step: it stays in the list
   * ("สำเนาก่อนส่งกลับ") and no longer counts as the signed document. It carries no `acknowledgedAt`.
   */
  beforePayoutCorrection?: true;
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

/** What stands in the way of a cancellation that was started: a reason the expense void refuses, or what stops the void itself. */
export function reimbursementCertificateCancellationMessage(number: string | null): string {
  return `รายจ่ายของใบเบิกนี้ออกหนังสือรับรอง 50 ทวิแล้ว${number ? ` (เลขที่ ${number})` : ''} จึงยกเลิกใบเบิกตอนนี้ไม่ได้ ระบบยังไม่ได้เปลี่ยนแปลงอะไร แจ้งทีมงานมั่งมีเพื่อช่วยยกเลิก`;
}

export type ReimbursementCancellationCertificate = { expenseNumber: string | null; kind: 'SYSTEM' | 'EXTERNAL'; number: string | null };

export const REIMBURSEMENT_CERTIFICATE_CANCELLATION_WORDS = {
  attestationRequired: 'ยังไม่ได้ยืนยันเรื่องการยื่นภาษี ติ๊กยืนยันก่อนยกเลิกใบเบิก',
  accountingPeriodLocked: (periodKey: string): string => `เดือน ${expenseCorrectionMonth(periodKey)} ของรายจ่ายในใบเบิกนี้ยังไม่เปิดให้ทำรายการ จึงยกเลิกใบเบิกไม่ได้ ให้ผู้ทำบัญชีตรวจสอบและเปิดเดือนนั้นก่อน แล้วลองอีกครั้ง`,
  taxPeriodLocked: (periodKey: string): string => `ภาษีของรายจ่ายในใบเบิกนี้สำหรับเดือน ${expenseCorrectionMonth(periodKey)} ถูกล็อกแล้ว จึงยกเลิกใบเบิกไม่ได้ ให้ผู้ทำบัญชีตรวจสอบเรื่องการยื่นแบบเพิ่มเติมก่อน แล้วลองอีกครั้ง`,
  postingUnresolved: 'ยกเลิกใบเบิกไม่ได้ ให้ผู้ทำบัญชีตรวจรายการนี้ต่อ',
  expenseNotVoidable: 'รายจ่ายในใบเบิกนี้ยังไม่พร้อมให้ยกเลิก จึงยกเลิกใบเบิกไม่ได้ เปิดหน้านี้ใหม่ ถ้ายังยกเลิกไม่ได้ ให้แจ้งทีมงานมั่งมีเพื่อช่วยตรวจสอบ',
  taxWorkspaceCertificate: 'ใบเบิกนี้มีรายจ่ายที่มีหนังสือรับรอง 50 ทวิที่ออกจากหน้าภาษี จึงยกเลิกใบเบิกจากหน้านี้ไม่ได้ แจ้งทีมงานมั่งมีเพื่อช่วยตรวจสอบ',
  permissionMissing: ({ kind, number }: Pick<ReimbursementCancellationCertificate, 'kind' | 'number'>): string =>
    `ใบเบิกนี้มีรายจ่ายที่${kind === 'SYSTEM' ? 'ออกหนังสือรับรอง 50 ทวิแล้ว' : 'บันทึกไว้ว่าออกหนังสือรับรอง 50 ทวินอกระบบแล้ว'}${number ? ` (เลขที่ ${number})` : ''} การยกเลิกใบเบิกจะยกเลิก${kind === 'SYSTEM'
      ? 'หนังสือรับรองด้วย ซึ่งต้องใช้สิทธิ์จัดการหนังสือรับรอง 50 ทวิ'
      : 'การบันทึกนั้นด้วย ซึ่งต้องใช้สิทธิ์บันทึกหนังสือรับรองที่ทำนอกระบบ'} ให้${THAI_SYSTEM_ROLE_NAMES.FINANCE}หรือผู้ที่มีสิทธิ์นั้นเป็นผู้ยกเลิกใบเบิกนี้`,
  periodLocked: (kind: 'SYSTEM' | 'EXTERNAL', periodKey: string, formType: string): string => withholdingPeriodLockedMessage(periodKey, 'ยกเลิกใบเบิก', formType, kind),
} as const;

export type ReimbursementCancellationBlocker = { code: 'reason_too_short' }
  | { code: 'certificate_attestation_required'; message: string } | ExpenseVoidBlocker;

/**
 * A cancellation that was started and has not completed. Cancelling voids the claim's expense
 * records after the intent is committed, so a claim can sit between the two. While it does, approval
 * and payment are refused; this says so, to whom it falls, and what they can do.
 */
export type ReimbursementPendingCancellation = {
  startedAt: string;
  startedByUserId?: string;
  startedByName?: string;
  /** The reason it was started with. */
  reason: string;
  /** What stops it from completing right now. Absent: nothing known does, and continuing should finish it. */
  blocker?: ReimbursementCancellationBlocker;
  /** The cancel endpoint takes this viewer: they may continue it, with a corrected reason when `reason_too_short` blocks it. */
  canResume: boolean;
  /** This viewer may take it back so the claim goes on as before: none of its expense records has been voided yet. */
  canWithdraw: boolean;
};

/**
 * A claim whose decision is made and on record, waiting for the system to carry it out: build and
 * confirm its expense records and move it on to payment. The decision is committed first and the
 * rest follows it, so a claim can sit between the two; a scheduled run picks it up, and this says
 * who may also tell the system to carry on now.
 *
 * APPROVAL: its approver approved it. NO_APPROVAL_NEEDED: nobody had to approve it, and it cannot be
 * paid until its expense records are confirmed.
 */
export type ReimbursementAwaitingSystem = {
  kind: 'APPROVAL' | 'NO_APPROVAL_NEEDED';
  /** The resume endpoint takes this viewer ("ดำเนินการต่อ"). Nothing is decided or attested again. */
  canResume: boolean;
};

export type ReimbursementRequestDetail = ReimbursementRequestSummary & {
  /** A legacy claim expense was voided; cancel this unpaid claim rather than retrying payment. */
  hasVoidedProjections?: true;
  /** GET detail only, available before a cancellation is started. */
  certificates?: ReimbursementCancellationCertificate[];
  certificateCancelAllowed?: boolean;
  certificateCancelBlocker?: { code: string; message: string };
  createdByName?: string;
  currentApproverUserId?: string;
  currentApprovalStepId?: string;
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
  /** Whether this claim has the finance review step: its frozen policy once submitted, the current policy while a draft. Detail only. */
  financeReviewRequired?: boolean;
  /**
   * Who can record this claim's payment, while it waits at the payment desk: the active members the API
   * would accept the payment from (pay right, branch scope). At most two names, then how many more. The
   * person whose turn it is comes first when they can pay: the finance reviewer who passed the claim,
   * then the claim's own approver. GET detail only; an empty list means nobody can. Absent on a claim the
   * payment endpoint refuses for everyone (no branch, or part paid): the page then prints the desk's pool label.
   */
  paymentDesk?: { names: string[]; moreCount: number };
  /** Present while a cancellation was started and has not completed. GET detail only, like `approvalActions`. */
  pendingCancellation?: ReimbursementPendingCancellation;
  /** Present while the claim's decision waits for the system to carry it out. GET detail only. Never together with `pendingCancellation`. */
  awaitingSystem?: ReimbursementAwaitingSystem;
  missingReceiptReason?: string;
  /** Where the money goes back to, masked. Absent on a legacy claim: one sent before claims carried a receiving method. */
  payout?: ReimbursementPayoutSummary;
  /**
   * GET detail only: every account this claim has been sent with, oldest first, masked. The one in use
   * is `payout.version`. Absent on a claim never sent with an account: cash, legacy, a draft not sent yet.
   */
  payoutHistory?: ReimbursementPayoutVersionSummary[];
  /**
   * GET detail only, on a legacy claim that can be paid, for a viewer who may record its payment and
   * whose requester has a default account to transfer into (spec §15). Absent for everyone else, and
   * on every claim that carries its own `payout`.
   */
  legacyPayoutDefault?: ReimbursementLegacyPayoutDefault;
  /** Present while the claim's payout account is being corrected (payout spec §14), on every detail the API returns. */
  payoutCorrection?: ReimbursementPayoutCorrection;
  /** GET detail only: what THIS viewer may do about the payout account of an approved claim. Absent means neither. */
  payoutCorrectionActions?: ReimbursementPayoutCorrectionActions;
  /** GET detail only: every step of every correction round this claim went through, oldest first. Absent when there was none. */
  payoutCorrectionHistory?: ReimbursementPayoutCorrectionEvent[];
  lines: ReimbursementLineSummary[];
  approvalSteps: ReimbursementApprovalStepSummary[];
  payments: ReimbursementPaymentSummary[];
  duplicateCandidates: ReimbursementDuplicateCandidateSummary[];
  /** Confirmed own expense duplicates always block; unresolved duplicates follow the frozen policy. */
  duplicateBlocksPayment?: boolean;
  duplicateReasons?: ReimbursementDuplicateReason[];
  /** The cancel endpoint's actor, status and branch verdict for this viewer. */
  viewerCanCancel?: boolean;
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
  /** Explicit acceptance of a third-party account, in addition to the version attestation. */
  payoutThirdPartyAccepted?: boolean;
};

export type RejectReimbursementInput = {
  reason: string;
  approvalSnapshotHash?: string;
  idempotencyKey?: string;
  /**
   * Only for a claim whose payout account is being corrected: refusing its new account sends it back
   * to the requester again, never to REJECTED. This names why, from the fixed list, and `reason` (still
   * required here, and held to the note's rules) becomes the round's note. Without it the reason is
   * OTHER. `POST :requestId/payout-correction` does the same with an optional note.
   */
  payoutCorrectionReasonCode?: ReimbursementPayoutCorrectionReason;
};

// ---- Correcting the payout account after approval (payout spec §14) ----
//
// A payout destination found wrong after approval and before payment is fixed on the SAME claim: it is
// sent back, its requester gives the destination again (an account or cash), and its approvers approve
// that alone. Lines, amounts and evidence do not change, and nothing is paid meanwhile. A claim may be
// sent back holding an account, cash, or (sent before claims carried one) nothing: the words of the
// round follow that, and what the requester answers ("The words of a round" below).

/**
 * Why a claim is sent back for its payout destination. A fixed list on purpose: the reason is copied
 * into the requester's notice, and free text there could carry an account number.
 *
 * Each reason is true of one thing a claim can hold: the first of a claim with no account of its own
 * (sent before claims carried one), the next five of an account, the two after them of cash. Which
 * reasons a claim takes is `reimbursementPayoutCorrectionReasons`; what a reason is printed as is
 * `reimbursementPayoutCorrectionReasonLabel`, which words it for the kind of account held.
 */
export const REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS = {
  NO_ACCOUNT_ON_CLAIM: 'ใบนี้ยังไม่มีบัญชีรับเงิน',
  ACCOUNT_NUMBER_WRONG: 'เลขบัญชีไม่ถูกต้อง',
  ACCOUNT_NAME_MISMATCH: 'ชื่อบัญชีไม่ตรงกับผู้เบิก',
  BANK_WRONG: 'ธนาคารไม่ถูกต้อง',
  ACCOUNT_UNUSABLE: 'บัญชีปิดหรือโอนไม่ได้',
  REQUESTER_ASKED: 'ผู้เบิกขอเปลี่ยนบัญชี',
  CASH_NOT_PAYABLE: 'จ่ายเป็นเงินสดไม่ได้',
  REQUESTER_ASKED_METHOD: 'ผู้เบิกขอเปลี่ยนวิธีรับเงินคืน',
  OTHER: 'อื่น ๆ',
} as const;
export const REIMBURSEMENT_PAYOUT_NAME_MISMATCH_THIRD_PARTY = 'บัญชีของบุคคลอื่นใช้เหตุผลว่าชื่อบัญชีไม่ตรงกับผู้เบิกไม่ได้ เลือกเหตุผลอื่น';
export type ReimbursementPayoutCorrectionReason = keyof typeof REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS;

export function isReimbursementPayoutCorrectionReason(value: unknown): value is ReimbursementPayoutCorrectionReason {
  return typeof value === 'string' && Object.hasOwn(REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS, value);
}

/**
 * The reasons a claim can be sent back with, in the order a form lists them, by what the claim holds
 * when it is sent back (`reimbursementPayoutHeld`; in a round that waits for approval, what its requester
 * just gave). One list for the form that offers them and the API that takes them, so nobody is offered,
 * and nothing is taken, that is untrue of the claim: an account can be wrong in five ways, of which a
 * PromptPay number, having no bank, has four; cash has its own two; and a claim with no account is sent
 * back for that one reason, which a form states and does not ask.
 *
 * `payoutKind` and `holderType` are the facts of the account held. A third-party account
 * deliberately differs from the requester, so name mismatch is never a reason for it.
 */
export function reimbursementPayoutCorrectionReasons(held: ReimbursementPayoutHeld, payoutKind?: ReimbursementPayoutKind | null, holderType?: ReimbursementPayoutHolderType | null): ReimbursementPayoutCorrectionReason[] {
  if (held === 'NOTHING') return ['NO_ACCOUNT_ON_CLAIM'];
  if (held === 'CASH') return ['CASH_NOT_PAYABLE', 'REQUESTER_ASKED_METHOD', 'OTHER'];
  return [
    'ACCOUNT_NUMBER_WRONG', ...(holderType === 'THIRD_PARTY' ? [] : ['ACCOUNT_NAME_MISMATCH' as const]), ...(payoutKind === 'PROMPTPAY_PHONE' ? [] : ['BANK_WRONG' as const]),
    'ACCOUNT_UNUSABLE', 'REQUESTER_ASKED', 'OTHER',
  ];
}

/**
 * A reason in words, by the kind of the account the claim held when it was sent back with it. The reason is the
 * same one under the same code; only what a person reads differs: a PromptPay destination is a phone number, which
 * the entry form calls "เบอร์พร้อมเพย์" and nothing calls "เลขบัญชี". The send-back form, the requester's notice and
 * the claim's timeline print this, so they cannot say it differently. Without a kind: the list's own words.
 */
export function reimbursementPayoutCorrectionReasonLabel(reasonCode: ReimbursementPayoutCorrectionReason, payoutKind?: ReimbursementPayoutKind | null): string {
  return payoutKind === 'PROMPTPAY_PHONE' && reasonCode === 'ACCOUNT_NUMBER_WRONG' ? 'เบอร์พร้อมเพย์ไม่ถูกต้อง' : REIMBURSEMENT_PAYOUT_CORRECTION_REASON_LABELS[reasonCode];
}

/** The note that may go with a reason. Shown on the claim page only; it may not carry an account number. */
export const REIMBURSEMENT_PAYOUT_CORRECTION_NOTE_MAX_LENGTH = 500;

/**
 * Where a claim stands in a correction round. AWAITING_REQUESTER (spec phase A): sent back, no approval
 * step is open, the requester gives the account. AWAITING_APPROVAL (spec phase B): the account was
 * given and a new step waits for the approvers the claim had.
 */
export type ReimbursementPayoutCorrectionPhase = 'AWAITING_REQUESTER' | 'AWAITING_APPROVAL';

/**
 * Whether a claim is in a correction round, and whom it waits for, from the claim's own columns. A
 * claim in a round is PENDING_APPROVAL, so every reader of that status asks this before it treats
 * the claim as waiting for its approver: sent back and still without its account it waits for its
 * requester, with no approval step open at all. The one definition for the API's modules; a list
 * row and a claim detail carry the answer as `payoutCorrectionPhase`.
 */
export function reimbursementPayoutCorrectionPhase(claim: {
  status?: string;
  payoutCorrectionRequestedAt?: unknown;
  payoutCorrectionSubmittedAt?: unknown;
}): ReimbursementPayoutCorrectionPhase | undefined {
  if (claim.status !== 'PENDING_APPROVAL' || !claim.payoutCorrectionRequestedAt) return undefined;
  return claim.payoutCorrectionSubmittedAt ? 'AWAITING_APPROVAL' : 'AWAITING_REQUESTER';
}

// ---- The words of a round (payout spec §14.2) ----
//
// Every word a round shows is chosen from two facts, never from the phase alone and never from the reason
// code: what the claim HELD when it was sent back, and what its requester ANSWERED against what the round
// began with. The words are here, as whole literals, for the web, the notices, the printed form and the
// LINE assistant alike. "ใหม่" only where an account replaced an account; "เดิม" only where the destination
// is the very one the claim was approved with; "แก้" only where an account was held; cash is never called
// an account; an answer that changed nothing is "ยืนยัน".

/** What a claim holds as its payout destination: an account (a bank account or a PromptPay number), cash, or nothing (sent before claims carried one, spec §15). */
export type ReimbursementPayoutHeld = 'ACCOUNT' | 'CASH' | 'NOTHING';

/**
 * What a claim holds, from the method of its own snapshot: `payoutMethod` of a sent claim's list row or
 * detail, which is absent on a claim sent before claims carried one. The API asks the same of its record.
 */
export function reimbursementPayoutHeld(claim: { payoutMethod?: string | null } | null | undefined): ReimbursementPayoutHeld {
  return claim?.payoutMethod === 'BANK_TRANSFER' ? 'ACCOUNT' : claim?.payoutMethod === 'CASH' ? 'CASH' : 'NOTHING';
}

/**
 * What the requester gave in a round, against what the claim was approved with when the round began.
 * From an account: another account, that same account, or cash. From cash: an account, or cash again.
 * From nothing: a first account, or cash.
 */
export type ReimbursementPayoutRoundAnswer =
  | 'NEW_ACCOUNT' | 'SAME_ACCOUNT' | 'CASH_INSTEAD'
  | 'ACCOUNT_INSTEAD' | 'SAME_CASH'
  | 'FIRST_ACCOUNT' | 'FIRST_CASH';

/**
 * The answer, from what the round began with, the method given, and whether an account given is the very
 * account the claim was approved with. Only the server can say the last: it compares what it stores, once,
 * when the answer is taken. Cash after cash is the same by itself.
 */
export function reimbursementPayoutRoundAnswer(
  start: ReimbursementPayoutHeld, given: ReimbursementPayoutMethod, sameAccount: boolean,
): ReimbursementPayoutRoundAnswer {
  if (start === 'ACCOUNT') return given === 'CASH' ? 'CASH_INSTEAD' : sameAccount ? 'SAME_ACCOUNT' : 'NEW_ACCOUNT';
  if (start === 'CASH') return given === 'CASH' ? 'SAME_CASH' : 'ACCOUNT_INSTEAD';
  return given === 'CASH' ? 'FIRST_CASH' : 'FIRST_ACCOUNT';
}

/**
 * By what the claim holds when it is sent back: the status while it is with its requester, what the
 * requester is asked to do (a button, a form title), how the send-back is said (a form title, a step
 * note, a timeline row) and the title of the requester's notice.
 */
const PAYOUT_ROUND_HELD_WORDS = {
  ACCOUNT: { status: 'รอผู้เบิกแก้บัญชีรับเงิน', ask: 'แก้บัญชีรับเงิน', sendBack: 'ส่งกลับให้แก้บัญชีรับเงิน', noticeTitle: 'ใบเบิกต้องแก้บัญชีรับเงิน' },
  NOTHING: { status: 'รอผู้เบิกเพิ่มบัญชีรับเงิน', ask: 'เพิ่มบัญชีรับเงิน', sendBack: 'ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน', noticeTitle: 'ใบเบิกต้องเพิ่มบัญชีรับเงิน' },
  CASH: { status: 'รอผู้เบิกเลือกวิธีรับเงินคืน', ask: 'เลือกวิธีรับเงินคืน', sendBack: 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง', noticeTitle: 'ใบเบิกต้องเลือกวิธีรับเงินคืนอีกครั้ง' },
} as const satisfies Record<ReimbursementPayoutHeld, Record<'status' | 'ask' | 'sendBack' | 'noticeTitle', string>>;

/**
 * By the requester's answer: what was done (after "ผู้เบิก"), the thing the approvers approve (a noun
 * phrase that goes after "อนุมัติ", "ตรวจ" and "รอ … อนุมัติ") and the status while it waits for them.
 */
const PAYOUT_ROUND_ANSWER_WORDS = {
  NEW_ACCOUNT: { did: 'แก้บัญชีรับเงิน', approves: 'บัญชีรับเงินใหม่', status: 'รออนุมัติบัญชีรับเงินใหม่' },
  SAME_ACCOUNT: { did: 'ยืนยันบัญชีเดิม', approves: 'บัญชีรับเงินเดิม', status: 'รออนุมัติบัญชีรับเงินเดิม' },
  CASH_INSTEAD: { did: 'เปลี่ยนวิธีรับเงินคืน', approves: 'การรับเป็นเงินสด', status: 'รออนุมัติการรับเป็นเงินสด' },
  ACCOUNT_INSTEAD: { did: 'เปลี่ยนวิธีรับเงินคืน', approves: 'บัญชีรับเงิน', status: 'รออนุมัติบัญชีรับเงิน' },
  SAME_CASH: { did: 'ยืนยันวิธีรับเงินคืนเดิม', approves: 'การรับเป็นเงินสด', status: 'รออนุมัติการรับเป็นเงินสด' },
  FIRST_ACCOUNT: { did: 'เพิ่มบัญชีรับเงิน', approves: 'บัญชีรับเงิน', status: 'รออนุมัติบัญชีรับเงิน' },
  FIRST_CASH: { did: 'เลือกวิธีรับเงินคืน', approves: 'การรับเป็นเงินสด', status: 'รออนุมัติการรับเป็นเงินสด' },
} as const satisfies Record<ReimbursementPayoutRoundAnswer, Record<'did' | 'approves' | 'status', string>>;

/**
 * The thing approved and the status of an answer. For a value with no words (no answer on record, or one
 * a later build added) they name the method, which is true of every answer.
 */
function payoutRoundApprovalWords(answer: unknown): { approves: string; status: string } {
  return typeof answer === 'string' && Object.hasOwn(PAYOUT_ROUND_ANSWER_WORDS, answer)
    ? PAYOUT_ROUND_ANSWER_WORDS[answer as ReimbursementPayoutRoundAnswer]
    : { approves: 'วิธีรับเงินคืน', status: 'รออนุมัติวิธีรับเงินคืน' };
}

/**
 * What a claim in a round is said to wait for: the status badge, a hub row, the waiting row of the
 * timeline, the printed form, a notice title and the LINE assistant all print this. With its requester
 * it follows what the claim holds; with its approvers, what the requester answered. Undefined: the claim
 * is in no round.
 *
 * A reader without the fact behind the words gets words that are true of every claim: a row with no
 * answer on it (a round with no record of how it began, a page fed by an older server), or a method this
 * build does not know.
 */
export function reimbursementPayoutRoundStatus(claim: {
  payoutCorrectionPhase?: string | null;
  payoutMethod?: string | null;
  payoutCorrectionAnswer?: string | null;
}): string | undefined {
  if (claim.payoutCorrectionPhase === 'AWAITING_REQUESTER') {
    const known = !claim.payoutMethod || claim.payoutMethod === 'BANK_TRANSFER' || claim.payoutMethod === 'CASH';
    return known ? PAYOUT_ROUND_HELD_WORDS[reimbursementPayoutHeld(claim)].status : 'รอผู้เบิกเลือกวิธีรับเงินคืน';
  }
  if (claim.payoutCorrectionPhase === 'AWAITING_APPROVAL') return payoutRoundApprovalWords(claim.payoutCorrectionAnswer).status;
  return undefined;
}

/** What the requester of a claim sent back is asked to do: the words of their button and of their form's title. */
export function reimbursementPayoutRoundAsk(held: ReimbursementPayoutHeld): string {
  return PAYOUT_ROUND_HELD_WORDS[held].ask;
}

/** How a send-back is said, by what the claim held at that send-back: "…โดย {ชื่อ} : {เหตุผล}" goes after it. */
export function reimbursementPayoutRoundSendBack(held: ReimbursementPayoutHeld): string {
  return PAYOUT_ROUND_HELD_WORDS[held].sendBack;
}

/**
 * Who gave an answer of a round: the requester, or someone on the requester's behalf (a finance reviewer may).
 * A list row, a claim detail and a history event carry it, because no sentence may say the requester did what
 * someone else did for them: every sentence that says who answered takes this.
 */
export type ReimbursementPayoutRoundAnsweredBy = {
  byUserId: string;
  /** Absent when the name cannot be resolved; a list row resolves none. */
  byName?: string;
  /** Present when it was not the requester. */
  onBehalf?: true;
};

/** What a sentence needs of who answered. None at all: the requester. A row, a detail's `payoutCorrectionAnsweredBy` and a history event all fit. */
type PayoutRoundAnsweredBy = { onBehalf?: boolean | null; byName?: string | null } | null | undefined;

/**
 * The doer of "what was done", at the head of a sentence and inside one, and what follows the verb when it was
 * done for the requester. A name that cannot be resolved reads "ผู้จัดทำ": an id is never printed.
 */
function payoutRoundDoer(answeredBy: PayoutRoundAnsweredBy): { who: string; named: string; forRequester: string } {
  if (!answeredBy?.onBehalf) return { who: 'ผู้เบิก', named: 'ผู้เบิก', forRequester: '' };
  const name = answeredBy.byName?.trim() || 'ผู้จัดทำ';
  return { who: `${name} `, named: ` ${name} `, forRequester: 'แทนผู้เบิก' };
}

/**
 * Who answered a round and what they did, as the timeline and the approvers' card say it: "ผู้เบิกแก้บัญชีรับเงิน"
 * when the requester answered, "{ชื่อ} แก้บัญชีรับเงินแทนผู้เบิก" when someone answered on the requester's behalf.
 */
export function reimbursementPayoutRoundDid(answer: ReimbursementPayoutRoundAnswer, answeredBy?: PayoutRoundAnsweredBy): string {
  const { who, forRequester } = payoutRoundDoer(answeredBy);
  return `${who}${PAYOUT_ROUND_ANSWER_WORDS[answer].did}${forRequester}`;
}

/** The step note of whoever may approve an answer, by the answer and by who gave it. */
const PAYOUT_ROUND_APPROVER_NOTES: Record<ReimbursementPayoutRoundAnswer, (doer: ReturnType<typeof payoutRoundDoer>) => string> = {
  NEW_ACCOUNT: () => 'รอคุณอนุมัติบัญชีรับเงินใหม่ ตรวจบัญชีเดิมกับบัญชีใหม่ด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน',
  SAME_ACCOUNT: ({ who, forRequester }) => `รอคุณอนุมัติบัญชีรับเงินเดิม ${who}ยืนยันบัญชีเดิมของใบนี้${forRequester} ไม่ได้เปลี่ยน ตรวจบัญชีด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน`,
  CASH_INSTEAD: ({ who, forRequester }) => `รอคุณอนุมัติการรับเป็นเงินสด ${who}เปลี่ยนจากโอนเข้าบัญชีเป็นรับเป็นเงินสด${forRequester} รายการและยอดเงินไม่เปลี่ยน`,
  ACCOUNT_INSTEAD: ({ who, forRequester }) => `รอคุณอนุมัติบัญชีรับเงิน ${who}เปลี่ยนจากรับเป็นเงินสดเป็นโอนเข้าบัญชี${forRequester} ตรวจบัญชีด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน`,
  SAME_CASH: ({ who, forRequester }) => `รอคุณอนุมัติการรับเป็นเงินสด ${who}ยืนยันรับเป็นเงินสดตามเดิม${forRequester} ไม่ได้เปลี่ยน รายการและยอดเงินไม่เปลี่ยน`,
  FIRST_ACCOUNT: ({ named, forRequester }) => `รอคุณอนุมัติบัญชีรับเงิน ใบนี้ไม่เคยมีบัญชีรับเงิน ตรวจบัญชีที่${named}เพิ่ม${forRequester}ด้านล่างก่อนอนุมัติ รายการและยอดเงินไม่เปลี่ยน`,
  FIRST_CASH: ({ who, forRequester }) => `รอคุณอนุมัติการรับเป็นเงินสด ใบนี้ไม่เคยมีบัญชีรับเงิน ${who}เลือกรับเป็นเงินสด${forRequester} รายการและยอดเงินไม่เปลี่ยน`,
};

/**
 * What the step note tells whoever may approve an answer: the thing that waits for them, what was done and by
 * whom, and what to look at. "ผู้เบิกยืนยันบัญชีเดิมของใบนี้" when the requester answered; when someone answered
 * for them, that person by name: "{ชื่อ} ยืนยันบัญชีเดิมของใบนี้แทนผู้เบิก".
 */
export function reimbursementPayoutRoundApproverNote(answer: ReimbursementPayoutRoundAnswer, answeredBy?: PayoutRoundAnsweredBy): string {
  return PAYOUT_ROUND_APPROVER_NOTES[answer](payoutRoundDoer(answeredBy));
}

/** What the card "การรับเงินคืน" says of what it shows while an answer waits for approval: who sent it. */
export function reimbursementPayoutRoundGivenNote(answeredBy?: PayoutRoundAnsweredBy): string {
  const { named, forRequester } = payoutRoundDoer(answeredBy);
  return `ด้านล่างคือวิธีรับเงินคืนที่${named}ส่งมา${forRequester} รอผู้อนุมัติอนุมัติก่อนจึงจ่ายได้`;
}

/**
 * What that card says of a claim whose cash an answer of a round gave it: who chose cash. "ผู้เบิกขอรับเป็นเงินสด" is
 * true of a claim its requester answered with cash, not of one a finance reviewer answered with cash for them. A
 * claim that no answer gave its cash is not asked here: no fact says who chose cash on its draft (someone may have
 * prepared it for the requester), so its card says what the claim states.
 */
export function reimbursementPayoutRoundCashNote(answeredBy?: PayoutRoundAnsweredBy): string {
  const { who, forRequester } = payoutRoundDoer(answeredBy);
  return forRequester ? `${who}เลือกรับเป็นเงินสด${forRequester} ไม่ต้องมีบัญชี` : 'ผู้เบิกขอรับเป็นเงินสด ไม่ต้องมีบัญชี';
}

/**
 * The thing a round's approvers approve, as a noun phrase: "อนุมัติ{…}โดย …", "ตรวจ{…}", "รอ … อนุมัติ{…}".
 * Without an answer it is the method, which is true of every answer.
 */
export function reimbursementPayoutRoundApproves(answer: ReimbursementPayoutRoundAnswer | null | undefined): string {
  return payoutRoundApprovalWords(answer).approves;
}

/**
 * The requester's notice of a send-back (spec §17.3): the title, which the template follows with the claim
 * number, and the body. Both are finished here, where the event is written, from what the claim held and
 * the fixed list's own words: no template assembles a sentence, so no rule can print a code or anything a
 * person typed. `payoutKind`: the kind of the account held, by which the reason is worded.
 */
export function reimbursementPayoutSentBackNotice(
  held: ReimbursementPayoutHeld, reasonCode: ReimbursementPayoutCorrectionReason, payoutKind?: ReimbursementPayoutKind | null,
  holder?: { holderType?: ReimbursementPayoutHolderType | null },
): { title: string; body: string } {
  const words = PAYOUT_ROUND_HELD_WORDS[held];
  return { title: withPayoutHolderFlag(words.noticeTitle, holder), body: withPayoutHolderFlag(`เหตุผล: ${reimbursementPayoutCorrectionReasonLabel(reasonCode, payoutKind)} · เปิดใบเบิกเพื่อ${words.ask}`, holder) };
}

/**
 * The approvers' notice of an answer (spec §17.3): the title is the claim's status label, which the
 * template follows with the claim number; the body goes after the amount.
 */
export function reimbursementPayoutAnswerNotice(answer: ReimbursementPayoutRoundAnswer | null | undefined, holder?: { holderType?: ReimbursementPayoutHolderType | null }): { title: string; body: string } {
  const words = payoutRoundApprovalWords(answer);
  return { title: withPayoutHolderFlag(words.status, holder), body: withPayoutHolderFlag(`รอคุณตรวจและอนุมัติ${words.approves}`, holder) };
}

type PayoutRoundHeldTexts = Record<
  | 'payLead' | 'payLeadCannotPay' | 'payLink' | 'sendBackLine1' | 'sendBackLine2' | 'notePlaceholder' | 'sentBackToast'
  | 'waitForYou' | 'waitOnBehalf' | 'askOnBehalf' | 'cardNote' | 'assistantNote', string>;

/**
 * What whoever sends a claim back is told comes after, whatever the claim holds: in words true of any answer and of
 * whoever gives it. The requester may keep the account, give another or take cash, and a finance reviewer may answer
 * for them, so it names no kind of answer ("แก้", "เพิ่ม") and nobody as the one who answers.
 */
const PAYOUT_ROUND_SEND_BACK_LINE_2 = 'เมื่อเลือกวิธีรับเงินคืนแล้ว ผู้อนุมัติของใบนี้ต้องอนุมัติอีกครั้งก่อนจึงจ่ายได้ ใบที่ไม่ต้องอนุมัติตามนโยบายจะกลับมารอจ่ายทันที';
type PayoutRoundGivenTexts = Record<'sendBackAgain' | 'sendBackAgainLine1' | 'askAgain' | 'againForYou' | 'againOnBehalf' | 'cardChecks', string>;
type PayoutRoundAnswerTexts = { cardTitle: string; cardRows: readonly [string] | readonly [string, string] };

/**
 * The longer sentences of a round, where they differ by case: the pay step and the send-back form, the
 * requester's step, the card "การรับเงินคืน", the approvers' card, and what the LINE assistant is told.
 * A sentence that reads the same in every case stays with the screen that shows it, and a sentence that
 * says who answered is a function of who did (`reimbursementPayoutRoundDid` and the three after it).
 */
export const REIMBURSEMENT_PAYOUT_ROUND_TEXTS = {
  /** At the pay step and while the claim is with its requester: by what the claim holds. */
  held: {
    ACCOUNT: {
      // Above the send-back at the pay step: for whoever records the payment, and for a reader who cannot.
      payLead: 'ถ้าวิธีรับเงินคืนหรือบัญชีนี้ไม่ถูกต้อง อย่าเพิ่งจ่าย ส่งกลับให้แก้ก่อน',
      payLeadCannotPay: 'ถ้าวิธีรับเงินคืนหรือบัญชีนี้ไม่ถูกต้อง ส่งกลับให้แก้ได้ก่อนมีการจ่าย',
      // The send-back itself, at the pay step.
      payLink: 'ส่งกลับให้แก้บัญชีรับเงิน',
      // The send-back form: what happens, what comes after, the note's placeholder, and what is said once it is sent.
      sendBackLine1: 'ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน',
      sendBackLine2: PAYOUT_ROUND_SEND_BACK_LINE_2,
      notePlaceholder: 'เช่น ธนาคารแจ้งว่าไม่พบบัญชีนี้',
      sentBackToast: 'ส่งกลับให้ผู้เบิกแก้บัญชีรับเงินแล้ว',
      // The end of the step note: for the requester, and for whoever may answer on their behalf.
      waitForYou: 'รอคุณแก้บัญชีรับเงิน กดแก้บัญชีรับเงินแล้วเลือกวิธีรับเงินคืนที่ถูกต้อง',
      waitOnBehalf: 'รอผู้เบิกแก้บัญชีรับเงิน คุณแก้แทนผู้เบิกได้',
      // The button and the form title of whoever answers on the requester's behalf.
      askOnBehalf: 'แก้บัญชีรับเงินแทนผู้เบิก',
      // The card "การรับเงินคืน" while the claim is with its requester.
      cardNote: 'ใบนี้ถูกส่งกลับให้แก้บัญชีรับเงิน ด้านล่างคือบัญชีที่ถูกส่งกลับ ระหว่างนี้ยังบันทึกจ่ายไม่ได้',
      // What the LINE assistant is told happens next.
      assistantNote: 'ใบเบิกถูกส่งกลับให้ผู้เบิกแก้บัญชีรับเงิน ผู้เบิกแก้ได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้',
    },
    NOTHING: {
      // Such a claim can be paid as it is: the same lead for every reader.
      payLead: 'ใบนี้บันทึกจ่ายได้เลยโดยไม่ต้องมีบัญชีในใบ ข้อความด้านล่างใช้เมื่อต้องการให้ใบมีบัญชีที่ผู้อนุมัติตรวจแล้วเท่านั้น',
      payLeadCannotPay: 'ใบนี้บันทึกจ่ายได้เลยโดยไม่ต้องมีบัญชีในใบ ข้อความด้านล่างใช้เมื่อต้องการให้ใบมีบัญชีที่ผู้อนุมัติตรวจแล้วเท่านั้น',
      payLink: 'เพิ่มบัญชีรับเงินให้ใบนี้ แล้วให้ผู้อนุมัติตรวจบัญชีนั้น',
      sendBackLine1: 'ใบนี้จะกลับไปให้ผู้เบิกเพิ่มบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน',
      sendBackLine2: PAYOUT_ROUND_SEND_BACK_LINE_2,
      notePlaceholder: 'รายละเอียดเพิ่มเติมถึงผู้เบิก',
      sentBackToast: 'ส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงินแล้ว',
      waitForYou: 'รอคุณเพิ่มบัญชีรับเงิน กดเพิ่มบัญชีรับเงินแล้วเลือกวิธีรับเงินคืนของใบนี้',
      waitOnBehalf: 'รอผู้เบิกเพิ่มบัญชีรับเงิน คุณเพิ่มแทนผู้เบิกได้',
      askOnBehalf: 'เพิ่มบัญชีรับเงินแทนผู้เบิก',
      cardNote: 'ใบนี้ถูกส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน ระหว่างนี้ยังบันทึกจ่ายไม่ได้',
      assistantNote: 'ใบเบิกถูกส่งกลับให้ผู้เบิกเพิ่มบัญชีรับเงิน ผู้เบิกเพิ่มได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้',
    },
    CASH: {
      payLead: 'ถ้าวิธีรับเงินคืนนี้ไม่ถูกต้อง อย่าเพิ่งจ่าย ส่งกลับให้ผู้เบิกเลือกก่อน',
      payLeadCannotPay: 'ถ้าวิธีรับเงินคืนนี้ไม่ถูกต้อง ส่งกลับให้ผู้เบิกเลือกได้ก่อนมีการจ่าย',
      payLink: 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง',
      sendBackLine1: 'ใบนี้จะกลับไปให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ระหว่างนี้ยังบันทึกจ่ายไม่ได้ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน',
      sendBackLine2: PAYOUT_ROUND_SEND_BACK_LINE_2,
      notePlaceholder: 'รายละเอียดเพิ่มเติมถึงผู้เบิก',
      sentBackToast: 'ส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้งแล้ว',
      waitForYou: 'รอคุณเลือกวิธีรับเงินคืนอีกครั้ง กดเลือกวิธีรับเงินคืนแล้วเลือกวิธีที่ต้องการ',
      waitOnBehalf: 'รอผู้เบิกเลือกวิธีรับเงินคืน คุณเลือกแทนผู้เบิกได้',
      askOnBehalf: 'เลือกวิธีรับเงินคืนแทนผู้เบิก',
      cardNote: 'ใบนี้ถูกส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ด้านล่างคือวิธีรับเงินคืนที่ถูกส่งกลับ ระหว่างนี้ยังบันทึกจ่ายไม่ได้',
      assistantNote: 'ใบเบิกถูกส่งกลับให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ผู้เบิกเลือกได้ที่หน้าใบเบิกบนเว็บ ระหว่างนี้ยังจ่ายเงินไม่ได้',
    },
  },
  /** While the answer waits for approval: by what the requester gave. The claim then holds an account or cash, never nothing. */
  given: {
    ACCOUNT: {
      // The approver's way of not taking the answer: the button and the form's title, then what happens.
      sendBackAgain: 'ส่งกลับให้แก้อีกครั้ง',
      sendBackAgainLine1: 'ใบนี้จะกลับไปให้ผู้เบิกแก้บัญชีรับเงิน ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน',
      // The requester may answer again while it waits: their button, and the end of the step note for them
      // and for whoever may answer on their behalf (whose button is `held[…].askOnBehalf`).
      askAgain: 'แก้บัญชีรับเงินอีกครั้ง',
      againForYou: 'ถ้าบัญชีที่ส่งไปยังไม่ถูกต้อง กดแก้บัญชีรับเงินอีกครั้งได้',
      againOnBehalf: 'ถ้าบัญชีที่ส่งไปยังไม่ถูกต้อง คุณแก้แทนผู้เบิกได้',
      // The approvers' card, after "รายการและยอดเงิน … เท่ากับที่อนุมัติไว้เมื่อ …": what this approval looks at.
      cardChecks: 'การอนุมัติครั้งนี้ตรวจเฉพาะบัญชีรับเงิน',
    },
    CASH: {
      sendBackAgain: 'ส่งกลับให้เลือกอีกครั้ง',
      sendBackAgainLine1: 'ใบนี้จะกลับไปให้ผู้เบิกเลือกวิธีรับเงินคืนอีกครั้ง ใบไม่ถูกปฏิเสธ เลขที่ใบ รายการ และยอดเงินไม่เปลี่ยน',
      askAgain: 'เลือกวิธีรับเงินคืนอีกครั้ง',
      againForYou: 'ถ้าต้องการเปลี่ยนวิธีรับเงินคืน กดเลือกวิธีรับเงินคืนอีกครั้งได้',
      againOnBehalf: 'ถ้าต้องการเปลี่ยนวิธีรับเงินคืน คุณเลือกแทนผู้เบิกได้',
      cardChecks: 'การอนุมัติครั้งนี้ตรวจเฉพาะวิธีรับเงินคืน',
    },
  },
  /**
   * For the approvers, by the answer: the title of the card they compare on and the names of its rows. Two
   * rows: what the claim had, then what was given. One row: the destination was kept, and is shown once.
   * (Their step note says who answered, so it is a function: `reimbursementPayoutRoundApproverNote`.)
   */
  answer: {
    NEW_ACCOUNT: {
      cardTitle: 'สิ่งที่รออนุมัติ: บัญชีรับเงินใหม่',
      cardRows: ['บัญชีเดิม', 'บัญชีใหม่'],
    },
    SAME_ACCOUNT: {
      cardTitle: 'สิ่งที่รออนุมัติ: บัญชีรับเงินเดิม',
      cardRows: ['บัญชีเดิม ไม่ได้เปลี่ยน'],
    },
    CASH_INSTEAD: {
      cardTitle: 'สิ่งที่รออนุมัติ: การรับเป็นเงินสด',
      cardRows: ['วิธีรับเงินคืนเดิม', 'วิธีรับเงินคืนใหม่'],
    },
    ACCOUNT_INSTEAD: {
      cardTitle: 'สิ่งที่รออนุมัติ: บัญชีรับเงิน',
      cardRows: ['วิธีรับเงินคืนเดิม', 'วิธีรับเงินคืนใหม่'],
    },
    SAME_CASH: {
      cardTitle: 'สิ่งที่รออนุมัติ: การรับเป็นเงินสด',
      cardRows: ['วิธีรับเงินคืนเดิม ไม่ได้เปลี่ยน'],
    },
    FIRST_ACCOUNT: {
      cardTitle: 'สิ่งที่รออนุมัติ: บัญชีรับเงิน',
      cardRows: ['เดิม', 'บัญชีที่เพิ่ม'],
    },
    FIRST_CASH: {
      cardTitle: 'สิ่งที่รออนุมัติ: การรับเป็นเงินสด',
      cardRows: ['เดิม', 'วิธีรับเงินคืนที่เลือก'],
    },
  },
} as const satisfies {
  held: Record<ReimbursementPayoutHeld, PayoutRoundHeldTexts>;
  given: Record<Exclude<ReimbursementPayoutHeld, 'NOTHING'>, PayoutRoundGivenTexts>;
  answer: Record<ReimbursementPayoutRoundAnswer, PayoutRoundAnswerTexts>;
};

/**
 * The line above the send-back at the pay step (`held[…].payLead`, `payLeadCannotPay`), said to the claim's own
 * requester, who reads that line too: they may send their claim back, and may be the one who records its payment.
 * Only where the line every other reader gets names "ผู้เบิก", a claim that holds cash: the requester is spoken to
 * as "คุณ". The other two lines name nobody, and the requester reads them as they are.
 */
export const REIMBURSEMENT_PAYOUT_ROUND_PAY_LEAD_FOR_REQUESTER: Partial<Record<ReimbursementPayoutHeld, Pick<PayoutRoundHeldTexts, 'payLead' | 'payLeadCannotPay'>>> = {
  CASH: {
    payLead: 'ถ้าวิธีรับเงินคืนนี้ไม่ถูกต้อง อย่าเพิ่งจ่าย คุณส่งกลับเพื่อเลือกอีกครั้งได้',
    payLeadCannotPay: 'ถ้าวิธีรับเงินคืนนี้ไม่ถูกต้อง คุณส่งกลับเพื่อเลือกอีกครั้งได้ก่อนมีการจ่าย',
  },
};

/**
 * The requester's notice when someone else chose a draft destination or answered a round for them (spec §17.3; owner rule 2026-10-01: the
 * person whose money it is hears of every change made for them). The title is the timeline's own row of that
 * answer, said to the requester: "{ชื่อ} ยืนยันบัญชีเดิมในใบเบิกของคุณ". Whoever sends it follows the title with
 * the claim number, as a template does for the other two notices of a round. The body is what the claim holds
 * now (an account by its bank and last 4 digits and no more, or cash) and what to do about it.
 *
 * A name that cannot be resolved reads "ผู้จัดทำ". An answer with no words (a round with no record of how it
 * began) reads as a choice of method, which is true of every answer.
 */
export function reimbursementPayoutAnsweredForRequesterNotice(
  answer: ReimbursementPayoutRoundAnswer | null | undefined,
  byName: string | null | undefined,
  given: { payoutMethod?: string | null; payoutKind?: ReimbursementPayoutKind | null; bankName?: string | null; accountLast4?: string | null; holderType?: ReimbursementPayoutHolderType } | null | undefined,
  facts: { draft?: boolean; alsoSavedAsDefault?: boolean } = {},
): { title: string; body: string } {
  const did = typeof answer === 'string' && Object.hasOwn(PAYOUT_ROUND_ANSWER_WORDS, answer) ? PAYOUT_ROUND_ANSWER_WORDS[answer].did : 'เลือกวิธีรับเงินคืน';
  const account = given?.payoutMethod === 'BANK_TRANSFER' && given.accountLast4 ? maskedPayoutAccountWithHolder(given) : undefined;
  const holds = account ?? (given?.payoutMethod === 'CASH' ? 'รับเป็นเงินสด' : facts.draft ? 'ยังไม่ได้ระบุวิธีรับเงินคืน' : undefined);
  const next = facts.draft
    ? 'เปิดใบเบิกเพื่อตรวจ ถ้าไม่ถูกต้อง แจ้งผู้จัดทำใบเบิก'
    : `เปิดใบเบิกเพื่อตรวจ ${account && given?.holderType !== 'THIRD_PARTY' ? 'ถ้าไม่ใช่บัญชีของคุณ' : 'ถ้าไม่ถูกต้อง'} แก้ได้ทันที`;
  return {
    title: withPayoutHolderFlag(`${payoutRoundDoer({ onBehalf: true, byName }).who}${did}ในใบเบิกของคุณ`, given ?? undefined),
    body: `${holds ? `${holds} · ` : ''}${next}${facts.alsoSavedAsDefault ? ' · บันทึกบัญชีนี้เป็นบัญชีรับเงินคืนประจำของคุณด้วย' : ''}`,
  };
}

export const REIMBURSEMENT_PAYOUT_TYPING_ON_BEHALF_NOTE = 'กรอกบัญชีรับเงินคืนของใบนี้ หลังบันทึกคุณจะเห็นเฉพาะ 4 ตัวท้าย';

/** What the preparer is told about the requester's notice, by the kind of save. */
export function reimbursementPayoutOnBehalfNotice(inDraft = false): string {
  return inDraft
    ? 'เมื่อคุณเลือกหรือเปลี่ยนวิธีรับเงินคืนแทนผู้เบิก ผู้เบิกที่ยังใช้งานอยู่จะได้รับแจ้งเตือน ถ้าบันทึกโดยไม่เปลี่ยนจะไม่แจ้งซ้ำ'
    : 'ผู้เบิกจะได้รับแจ้งเตือนทุกครั้งที่มีผู้เลือกวิธีรับเงินคืนแทน ไม่ว่าเลือกแบบใด';
}

/** A finance block stays on the finance desk; its optional free-text reason belongs on the claim page only. */
export function reimbursementFinanceBlockedRequesterNotice(): { title: string; body: string } {
  return {
    title: 'ใบเบิกของคุณถูกระงับการจ่าย',
    body: 'ใบเบิกยังอยู่ขั้นตรวจการเงิน รอผู้ตรวจการเงินดำเนินการต่อ หากผู้ตรวจระบุเหตุผล อ่านได้ในใบเบิก',
  };
}

/** `POST :requestId/payout-correction`: send an approved claim back to have its payout account corrected. */
export type RequestReimbursementPayoutCorrectionInput = {
  reasonCode: ReimbursementPayoutCorrectionReason;
  note?: string;
};

/**
 * `PUT :requestId/payout-destination`: the account a claim in a round is to be paid into. The three
 * choices of a draft, and one a draft has no use for: the account the claim had. Whatever is chosen is
 * frozen as a new version and approved again.
 */
export type SubmitReimbursementPayoutCorrectionInput = (
  | { mode: 'CASH' }
  | { mode: 'SAVED'; savedAccountId: string }
  | {
    mode: 'DEFAULT';
    /** `payoutCorrectionActions.requesterDefault.token` of the default account the page showed. */
    defaultToken: string;
  }
  /**
   * The account the claim was approved with before it was sent back (`payoutCorrection.previous`), as it
   * is. Nobody types anything, so it can also be given on behalf of a requester who is no longer
   * active, for whom no account may be typed. Refused (`payout_destination_required`) for a claim that
   * had none.
   */
  | { mode: 'PREVIOUS' }
  | ({
    mode: 'SPECIFIED';
    /** Also make it the requester's default account. */
    saveAsDefault?: boolean;
    saveForLater?: boolean;
    holderType?: ReimbursementPayoutHolderType;
    holderNote?: string;
  } & PayoutDestinationInput)
) & {
  /**
   * `updatedAt` of the claim detail the form was opened on. The account is taken only while the claim
   * is still that one; otherwise the answer is `reimbursement_changed` (409) and the page reads the
   * claim again. So a second press that arrives after the first was taken freezes no further version
   * and sends no further notice. A form should always send it: without it the call is held only to
   * the claim as the server reads it at that moment, which a late second press passes.
   */
  expectedUpdatedAt?: string;
};

/** A receiving method and account, masked: what a claim was to be paid into at some point. */
export type ReimbursementPayoutCorrectionAccount = {
  payoutMethod: ReimbursementPayoutMethod;
  payoutKind?: ReimbursementPayoutKind;
  bankName?: string;
  accountName?: string;
  accountLast4?: string;
  holderType?: ReimbursementPayoutHolderType;
  holderNote?: string;
  version?: number;
};

/** The round a claim is in. Absent on a claim that is in none. */
export type ReimbursementPayoutCorrection = {
  phase: ReimbursementPayoutCorrectionPhase;
  /** When, by whom and why it was last sent back. The name is absent when it cannot be resolved. */
  requestedAt: string;
  requestedByUserId?: string;
  requestedByName?: string;
  reasonCode: ReimbursementPayoutCorrectionReason;
  note?: string;
  /** AWAITING_APPROVAL: when the account now on the claim was given. The approvers' wait counts from here. */
  submittedAt?: string;
  /**
   * What the claim was approved with before the round, to set beside the account it has now. Absent
   * for a claim sent before claims carried a receiving method: it had none.
   */
  previous?: ReimbursementPayoutCorrectionAccount;
  /** When that approval was given. The claim's lines, amounts and evidence are what they were then. */
  previouslyApprovedAt?: string;
  /**
   * AWAITING_APPROVAL: whether what was given in the round is the very destination the claim was approved
   * with before it (the same kind, bank, account name and number, or cash both times): the claim's
   * `payoutCorrectionAnswer` is SAME_ACCOUNT or SAME_CASH. The server compares what it stores, once, when
   * the answer is taken; the last 4 digits a page shows cannot tell. False for a claim that had no account.
   */
  sameAsPrevious?: boolean;
};

/** What this viewer may do about the payout account of an approved claim. The endpoints enforce the same. */
export type ReimbursementPayoutCorrectionActions = {
  /** `POST :requestId/payout-correction` takes this viewer: send the claim back (or, on its waiting step, back again). */
  canRequest: boolean;
  /** `PUT :requestId/payout-destination` takes this viewer: give the account of a claim in a round. */
  canSubmit: boolean;
  /**
   * With `canSubmit`: the requester's default account as it is now, masked, and the token that names it.
   * Choosing it sends `{ mode: 'DEFAULT', defaultToken }`, so the claim never takes an account the page did not show.
   * Absent when the requester has set none.
   */
  requesterDefault?: ReimbursementPayoutCorrectionAccount & { token: string };
  /**
   * With `canSubmit`: the choices `PUT :requestId/payout-destination` takes from this viewer for this claim,
   * decided by the endpoint's own rules, so a form offers exactly these and nobody fills in a choice only to
   * have it refused. `DEFAULT` is there when the requester has a default to use (`requesterDefault`),
   * `PREVIOUS` when the claim was approved with an account or cash before the round, `CASH` always, and
   * `SPECIFIED` unless the viewer would type the account of a requester no notice can reach.
   */
  submitModes?: SubmitReimbursementPayoutCorrectionInput['mode'][];
  /**
   * Why `SPECIFIED` is not among `submitModes`: the requester is no longer an active member, so an account
   * typed on their behalf would be on the claim without anyone being told (`payout_account_member_not_active`).
   */
  specifiedRefusal?: 'REQUESTER_NOT_ACTIVE';
  /** This frozen policy has no approval step: typed/saved choices must be own accounts. */
  thirdPartyRefusal?: 'APPROVAL_NOT_REQUIRED';
};

/**
 * One thing that happened in a round, for the claim's timeline (spec §17.2). The words of each row come
 * from the fact the event carries, never from the reason code:
 * SENT_BACK "{reimbursementPayoutRoundSendBack(held)}โดย … : เหตุผล",
 * ACCOUNT_SUBMITTED `reimbursementPayoutRoundDid(answer, event)`, which names whoever answered for the requester,
 * REAPPROVED "อนุมัติ{reimbursementPayoutRoundApproves(answer)}โดย …".
 * A claim nobody has to approve has no REAPPROVED: it is ready for payment from its ACCOUNT_SUBMITTED.
 */
export type ReimbursementPayoutCorrectionEvent = {
  kind: 'SENT_BACK' | 'ACCOUNT_SUBMITTED' | 'REAPPROVED';
  at: string;
  byUserId: string;
  /** Absent when the name cannot be resolved. */
  byName?: string;
  /** SENT_BACK only. */
  reasonCode?: ReimbursementPayoutCorrectionReason;
  note?: string;
  /**
   * SENT_BACK only: what the claim held at that send-back. From the pay step, what it was approved with;
   * from the round's waiting step, the answer that was not taken. Absent only where the log has no record of it.
   */
  held?: ReimbursementPayoutHeld;
  /**
   * ACCOUNT_SUBMITTED: what was given, against what the claim was approved with when that round began.
   * REAPPROVED: the answer that was approved. Absent only where the log has no record of how the round began.
   */
  answer?: ReimbursementPayoutRoundAnswer;
  /**
   * ACCOUNT_SUBMITTED only: the answer was given by someone other than the requester, who is `byUserId` and
   * `byName`. With them the event is who answered, as the sentences that say so take it.
   */
  onBehalf?: true;
  /** ACCOUNT_SUBMITTED only: what the claim was given. A transfer names its row of `payoutHistory`. */
  payoutMethod?: ReimbursementPayoutMethod;
  payoutVersion?: number;
  /** REAPPROVED only: the approval step that approved the account, a row of `approvalSteps`. */
  approvalStepId?: string;
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
   * The payer was told that using this file as the slip takes it out of ใบเบิกที่เซ็นแล้ว for good and
   * withdraws its "signed on paper" declaration, and goes on. Required when the file carries such a
   * declaration, else `payment_slip_signed_copy_unconfirmed`: there is no way to move the file back.
   */
  confirmSignedCopyWithdrawal?: boolean;
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
  /** As on `RecordReimbursementPaymentInput`: required for a file that carries a "signed on paper" declaration. */
  confirmSignedCopyWithdrawal?: boolean;
};

export type VoidReimbursementPaymentInput = {
  reason: string;
};

export type ListReimbursementsFilter = {
  order?: 'newest' | 'oldest';
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
  /**
   * Whether the company has the finance-review step now: its current policy, the one a claim sent
   * today would be held to. The hub names its third tab by it ("คิวการเงิน" or "คิวรอจ่าย"). This one
   * fact goes to whoever may list claims; the policy itself stays with the policy endpoint and its rights.
   */
  financeReviewRequired: boolean;
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
  duplicateReasons?: ReimbursementDuplicateReason[];
  viewerCanCancel?: boolean;
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
export type ReimbursementPayoutHolderType = 'SELF' | 'THIRD_PARTY';
/** Where a claim's account came from: the default, a saved account, or whoever typed it. */
export type ReimbursementPayoutSource = 'DEFAULT_ACCOUNT' | 'SAVED_ACCOUNT' | 'REQUESTER' | 'PREPARER';

export const PAYOUT_SAVED_ACCOUNT_LABEL_MAX_LENGTH = 40;
export const PAYOUT_HOLDER_NOTE_MIN_LENGTH = 2;
export const PAYOUT_HOLDER_NOTE_MAX_LENGTH = 200;
export const PAYOUT_SAVED_ACCOUNT_LIMIT = 20;

export type PayoutHolderFacts = {
  holderType: ReimbursementPayoutHolderType;
  holderNote?: string;
};

/** Holder facts are stated by a person, never inferred from the account name. */
export function invalidPayoutHolderField(input: Partial<PayoutHolderFacts> | null | undefined): 'holderType' | 'holderNote' | null {
  if (input?.holderType !== 'SELF' && input?.holderType !== 'THIRD_PARTY') return 'holderType';
  if (input.holderNote !== undefined && typeof input.holderNote !== 'string') return 'holderNote';
  const note = input.holderNote?.trim() ?? '';
  if (input.holderType === 'SELF') return note ? 'holderNote' : null;
  return note.length < PAYOUT_HOLDER_NOTE_MIN_LENGTH || note.length > PAYOUT_HOLDER_NOTE_MAX_LENGTH || looksLikeAccountNumber(note)
    ? 'holderNote' : null;
}

/** A private optional label still must not carry an account number. */
export function invalidSavedPayoutAccountLabel(label: unknown): 'label' | null {
  if (label === undefined) return null;
  if (typeof label !== 'string') return 'label';
  return label.trim().length > PAYOUT_SAVED_ACCOUNT_LABEL_MAX_LENGTH || looksLikeAccountNumber(label) ? 'label' : null;
}

/** Shared by forms, claim print, notices and LINE; notes are excluded from short notices. */
export const REIMBURSEMENT_PAYOUT_HOLDER_WORDS = {
  self: 'บัญชีของฉันเอง',
  requesterSelf: 'บัญชีของผู้เบิกเอง',
  thirdParty: 'บัญชีของบุคคลอื่น',
  noteLabel: 'เป็นบัญชีของใคร และเกี่ยวข้องอย่างไร',
  noteExample: 'เช่น ช่างรับเหมาที่สำรองจ่ายค่าวัสดุ หรือคู่สมรสของผู้เบิก',
  noteInvalid: 'ระบุว่าเป็นบัญชีของใคร และเกี่ยวข้องอย่างไร (2 ถึง 200 ตัวอักษร)',
  noteContainsAccountNumber: 'อย่าพิมพ์เลขบัญชีในช่องนี้ เพราะเมื่อใช้บัญชีนี้ในใบเบิก ทุกคนที่เปิดใบเบิกจะเห็นข้อความนี้',
  thirdPartyAcceptance: 'ฉันตรวจบัญชีนี้แล้ว และยอมรับให้คืนเงินของใบนี้เข้าบัญชีของบุคคลอื่นตามที่ระบุ',
  thirdPartyAcceptanceRequired: 'ติ๊กยอมรับการคืนเงินเข้าบัญชีของบุคคลอื่นก่อนอนุมัติ',
  thirdPartyApprovalNotice: 'ใบนี้คืนเงินเข้าบัญชีของบุคคลอื่น จึงต้องผ่านผู้อนุมัติก่อนจ่ายทุกครั้ง',
  thirdPartySelfAttestation: 'ผู้เบิกยืนยันบัญชีของบุคคลอื่นด้วยตนเอง',
  thirdPartyPaymentConfirmation: 'โอนเข้าบัญชีของบุคคลอื่นตามที่อนุมัติในใบนี้แล้ว และชื่อผู้รับที่ธนาคารแสดงตรงกับใบเบิก',
} as const;

export function payoutHolderChoiceLabel(holderType: ReimbursementPayoutHolderType, forSelf: boolean): string {
  return holderType === 'THIRD_PARTY' ? REIMBURSEMENT_PAYOUT_HOLDER_WORDS.thirdParty
    : forSelf ? REIMBURSEMENT_PAYOUT_HOLDER_WORDS.self : REIMBURSEMENT_PAYOUT_HOLDER_WORDS.requesterSelf;
}

/** Existing claims and self accounts gain no new line. */
export function payoutHolderLine(account: { holderType?: ReimbursementPayoutHolderType | null; holderNote?: string | null }): string | null {
  return account.holderType === 'THIRD_PARTY' ? `${REIMBURSEMENT_PAYOUT_HOLDER_WORDS.thirdParty}: ${account.holderNote?.trim() ?? ''}` : null;
}

// Words added by the saved-account screens, shared by their rows, forms and refusals.
export const REIMBURSEMENT_SAVED_PAYOUT_WORDS = {
  title: 'บัญชีอื่นที่บันทึกไว้', row: 'บัญชีที่บันทึกไว้', add: 'เพิ่มบัญชี',
  empty: 'ยังไม่มีบัญชีอื่นที่บันทึกไว้', loading: 'กำลังโหลดบัญชีที่บันทึกไว้...',
  label: 'ชื่อเรียก (ไม่บังคับ)', holder: 'เจ้าของบัญชี',
  labelInvalid: `ชื่อเรียกต้องไม่เกิน ${PAYOUT_SAVED_ACCOUNT_LABEL_MAX_LENGTH} ตัวอักษร และไม่ใส่เลขบัญชี แก้ชื่อเรียกแล้วลองอีกครั้ง`,
  limit: `บันทึกบัญชีอื่นได้ไม่เกิน ${PAYOUT_SAVED_ACCOUNT_LIMIT} บัญชี หากครบแล้วให้ลบบัญชีที่ไม่ใช้ก่อนเพิ่มบัญชีใหม่`,
  makeDefault: 'ตั้งเป็นบัญชีประจำ', saved: 'เพิ่มบัญชีแล้ว', removed: 'ลบบัญชีที่บันทึกไว้แล้ว', madeDefault: 'ตั้งเป็นบัญชีประจำแล้ว',
  madeDefaultWithPrevious: 'ตั้งเป็นบัญชีประจำแล้ว บัญชีประจำเดิมอยู่ในรายการบัญชีที่บันทึกไว้',
  deleteTitle: 'ลบบัญชีที่บันทึกไว้', deleteNotice: 'บัญชีนี้จะหายจากรายการ ใบเบิกที่บันทึกหรือส่งไปแล้วจะยังใช้บัญชีของใบนั้นตามเดิม',
  saveForLater: 'บันทึกบัญชีนี้ไว้ใช้ครั้งหน้า', choose: 'กรุณาเลือกวิธีรับเงินคืนของใบนี้',
  notFound: 'ไม่พบบัญชีที่เลือกในรายการแล้ว เปิดหน้านี้ใหม่และเลือกวิธีรับเงินคืนอีกครั้ง',
  accountNameHint: 'กรอกชื่อตามที่ธนาคารแสดง เพื่อให้ผู้อนุมัติตรวจบัญชีที่เลือก',
};
export const REIMBURSEMENT_SAVED_PAYOUT_ERROR_WORDS = {
  payout_saved_account_not_found: REIMBURSEMENT_SAVED_PAYOUT_WORDS.notFound,
  payout_saved_account_limit: REIMBURSEMENT_SAVED_PAYOUT_WORDS.limit,
  payout_saved_account_duplicate: 'บันทึกบัญชีนี้ไว้แล้ว เลือกบัญชีจากรายการเดิม',
  payout_saved_account_is_default: 'บัญชีนี้เป็นบัญชีประจำอยู่แล้ว ใช้บัญชีประจำหรือเพิ่มบัญชีอื่น',
  payout_default_must_be_own: 'บัญชีประจำต้องเป็นบัญชีของตัวเอง ใช้บัญชีนี้เฉพาะใบเบิกหรือเลือกบัญชีของตัวเอง',
  payout_holder_type_invalid: 'เจ้าของบัญชีไม่ถูกต้อง เลือกจากตัวเลือกที่แสดง',
  payout_holder_note_invalid: `${REIMBURSEMENT_PAYOUT_HOLDER_WORDS.noteInvalid} ${REIMBURSEMENT_PAYOUT_HOLDER_WORDS.noteContainsAccountNumber}`,
  payout_saved_account_label_invalid: REIMBURSEMENT_SAVED_PAYOUT_WORDS.labelInvalid,
  payout_third_party_acceptance_required: REIMBURSEMENT_PAYOUT_HOLDER_WORDS.thirdPartyAcceptanceRequired,
  payout_third_party_needs_approval: 'ใบนี้ใช้บัญชีของบุคคลอื่นไม่ได้เพราะไม่มีขั้นอนุมัติ เลือกบัญชีของตัวเองหรือเงินสด หรือยกเลิกใบนี้แล้วส่งใบใหม่',
  payment_currency_mismatch: 'สกุลเงินที่จ่ายไม่ตรงกับใบเบิก ใช้สกุลเงินเดียวกับใบเบิก',
  payment_source_bank_account_invalid: 'บัญชีที่ใช้จ่ายไม่พร้อมใช้งานในร้านนี้ เปิดหน้านี้ใหม่และเลือกบัญชีที่ใช้จ่ายใหม่',
  // A choice the form should never send, and the two the command refuses for who is filling the form.
  payout_mode_invalid: 'เลือกวิธีรับเงินคืนไม่สำเร็จ เปิดหน้านี้ใหม่แล้วเลือกวิธีรับเงินคืนอีกครั้ง',
  payout_save_options_invalid: 'เลือกได้อย่างเดียว: บันทึกเป็นบัญชีประจำ หรือบันทึกบัญชีนี้ไว้ใช้ครั้งหน้า เอาเครื่องหมายออกหนึ่งช่อง',
  payout_saved_account_owner_required: 'บัญชีที่บันทึกไว้เป็นของผู้เบิก จึงเลือกหรือบันทึกเพิ่มได้เฉพาะเมื่อผู้เบิกกรอกใบเบิกเอง เลือกบัญชีประจำของผู้เบิก เงินสด หรือกรอกบัญชีสำหรับใบนี้',
};

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

/** Short account text for notices and LINE: holder flag only, never the holder note. */
export function maskedPayoutAccountWithHolder(account: Parameters<typeof maskedPayoutAccount>[0] & { holderType?: ReimbursementPayoutHolderType | null }): string {
  return withPayoutHolderFlag(maskedPayoutAccount(account), account);
}

/** The same short flag on sentences that name an account without its digits. */
export function withPayoutHolderFlag(text: string, account?: { holderType?: ReimbursementPayoutHolderType | null }): string {
  return account?.holderType === 'THIRD_PARTY' ? `${text} (${REIMBURSEMENT_PAYOUT_HOLDER_WORDS.thirdParty})` : text;
}

/** Saved accounts are private to their member; the label is never copied into a claim. */
export type SavedPayoutAccountSummary = PayoutHolderFacts & {
  id: string;
  label?: string;
  payoutKind: ReimbursementPayoutKind;
  bankName?: string;
  accountName: string;
  accountLast4: string;
  createdAt: string;
};

export type SavedPayoutAccountListResponse = { accounts: SavedPayoutAccountSummary[]; limit: number };
export type AddSavedPayoutAccountInput = PayoutDestinationInput & PayoutHolderFacts & { label?: string };

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
  | { mode: 'SAVED'; savedAccountId: string }
  | ({
    mode: 'SPECIFIED';
    /** Also make it the requester's default account; the claim then follows that default. */
    saveAsDefault?: boolean;
    saveForLater?: boolean;
    holderType?: ReimbursementPayoutHolderType;
    holderNote?: string;
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
  holderType?: ReimbursementPayoutHolderType;
  holderNote?: string;
  /** Draft only: this account requires approval even below the policy's amount threshold. */
  approvalRequiredForThirdParty?: true;
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
 * One account a claim has been sent with, masked like every other account: a row of the claim page's
 * account history (spec §17.2). A claim sent again with another account keeps the earlier ones here.
 */
export type ReimbursementPayoutVersionSummary = {
  version: number;
  payoutKind: ReimbursementPayoutKind;
  bankName?: string;
  accountName: string;
  accountLast4: string;
  holderType?: ReimbursementPayoutHolderType;
  holderNote?: string;
  source: ReimbursementPayoutSource;
  /** Who typed or set the account, when it was not the requester. The name is absent when it cannot be resolved. */
  enteredByUserId?: string;
  enteredByName?: string;
  /** When the claim was first sent with this account. */
  frozenAt: string;
  /** The attestation of this version ("ตรวจบัญชีแล้ว"); absent when nobody attested it. */
  verifiedByUserId?: string;
  verifiedByName?: string;
  verifiedAt?: string;
  /** The approval step whose decision attested it. Absent when nobody did, or when whoever recorded the payment did. */
  approvalStepId?: string;
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

export type ReimbursementAiSummaryItem = { requestNo: string | null; title: string | null; requesterDisplayName: string | null; amount: string };

export type ReimbursementAiReadFilters = { requesterName?: string; categoryName?: string; round?: string; status?: ReimbursementRequestStatus | 'APPROVED_UNPAID'; paymentStatus?: string };

export type ReimbursementAiSummary = {
  matchedCount?: number;
  matchedItems?: Array<ReimbursementAiSummaryItem & { id: string; status: string }>;
  pendingApprovalCount: number;
  unpaidApprovedCount: number;
  overdueApprovalCount: number;
  totalUnpaidAmount: string;
  /** Unpaid claims excluded from the payment figures by the duplicate predicate; absent in older output. */
  duplicateBlockedCount?: number;
  /** The first claims behind the two counts (at most 5 each), so a LINE answer names them (owner
   *  2026-11-06). `amount` is what is still owed for an unpaid claim. Absent in older output. */
  unpaidApprovedItems?: ReimbursementAiSummaryItem[];
  pendingApprovalItems?: ReimbursementAiSummaryItem[];
  /** Item 1 (spec R-A1 row 18): the caller's own effective read scope, from the same own/related/
   *  company permission check `GetReimbursementAiSummaryUseCase` already applies above. */
  accessScope: 'own' | 'related' | 'company';
};

// ---- Document sequence keys ----

export const REIMBURSEMENT_SEQUENCE_KEYS = {
  REQUEST: 'reimbursement.request',
  PAYMENT: 'reimbursement.payment',
} as const;

export const REIMBURSEMENT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'ร่าง',
  PENDING_APPROVAL: 'รออนุมัติ',
  APPROVED: 'อนุมัติแล้ว',
  REJECTED: 'ถูกส่งกลับให้แก้',
  CANCELLED: 'ยกเลิกแล้ว',
  FINANCE_REVIEW: 'รอตรวจสอบการเงิน',
  READY_FOR_PAYMENT: 'พร้อมจ่าย',
  PARTIALLY_PAID: 'จ่ายบางส่วน',
  PAID: 'จ่ายแล้ว',
  VOIDED: 'เพิกถอน',
};

export const REIMBURSEMENT_PROJECTION_VOIDED_MESSAGE = 'รายการค่าใช้จ่ายของใบเบิกนี้ถูกยกเลิกไปแล้ว จ่ายใบนี้ไม่ได้ ยกเลิกใบเบิกนี้แล้วทำใบใหม่';
