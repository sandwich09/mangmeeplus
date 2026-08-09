/**
 * Pure business logic for reimbursement approval and review (Item 14).
 * No Nest / Prisma / browser imports. Decimal-safe money math.
 */

import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import type {
  ReimbursementRequestStatus,
  ReimbursementPaymentMethod,
  ReimbursementPaymentSourceRef,
  ReimbursementReceiptRequirementStatus,
} from '@watchdog-bms/contracts';

// ---- Money helpers ----

export function d(v: string | number): Decimal {
  return new Decimal(String(v));
}

export function decStr(v: Decimal): string {
  return v.toFixed(4);
}

export const REIMBURSEMENT_MAX_AMOUNT = new Decimal('99999999999999.99');

/** Recorded reimbursement money follows the shared satang policy. */
export function normalizeReimbursementAmount(value: string | number): string {
  return d(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(4);
}

// ---- Approval threshold ----

/** Approval required when amount >= approvalRequiredFromAmount (default 1.00). Decimal-safe. */
export function requiresApproval(amount: string, approvalRequiredFromAmount: string): boolean {
  return d(amount).gte(d(approvalRequiredFromAmount));
}

// ---- Lines (1 ใบเบิก หลายรายการ) ----

export const REIMBURSEMENT_MAX_LINES = 50;

/** The line fields every rule below reads. Labels/ids beyond these never affect approval. */
export type ReimbursementLineFields = {
  lineNo: number;
  incurredDate: string | Date;
  description: string;
  purpose?: string | null;
  categoryKey: string;
  categoryLabel?: string | null;
  amount: string;
  attachmentId?: string | null;
  linkedExpenseId?: string | null;
};

const isoOf = (v: string | Date): string => (v instanceof Date ? v.toISOString() : v);

export function byLineNo<T extends { lineNo: number }>(lines: readonly T[]): T[] {
  return [...lines].sort((a, b) => a.lineNo - b.lineNo);
}

/** Header total = sum of line amounts. The only place a claim total is produced. */
export function computeClaimTotal(lines: readonly { amount: string }[]): string {
  return decStr(lines.reduce(
    (sum, line) => sum.add(d(normalizeReimbursementAmount(line.amount || '0'))),
    d(0),
  ));
}

/** A line carries evidence when it has a receipt attachment or a linked LINE-captured expense. */
export function isLineEvidenced(line: { attachmentId?: string | null; linkedExpenseId?: string | null }): boolean {
  return !!line.attachmentId || !!line.linkedExpenseId;
}

/**
 * Header display values derived from the lines: single category → that category,
 * mixed → line 1's key with a `หลายหมวด (N รายการ)` label; date = earliest line.
 */
export function deriveHeaderFromLines(lines: readonly ReimbursementLineFields[]): {
  amount: string;
  categoryKey: string;
  categoryLabelSnapshot?: string;
  incurredDate: Date;
} {
  const ordered = byLineNo(lines);
  const first = ordered[0]!;
  const distinct = [...new Set(ordered.map((line) => line.categoryKey))];
  const earliest = ordered.reduce(
    (min, line) => (new Date(isoOf(line.incurredDate)) < min ? new Date(isoOf(line.incurredDate)) : min),
    new Date(isoOf(first.incurredDate)),
  );
  return {
    amount: computeClaimTotal(ordered),
    categoryKey: first.categoryKey,
    categoryLabelSnapshot: distinct.length === 1
      ? (first.categoryLabel ?? undefined)
      : `หลายหมวด (${ordered.length} รายการ)`,
    incurredDate: earliest,
  };
}

// ---- Request field validation ----

export type RequestFieldsInput = {
  reason?: string;
  lines?: readonly ReimbursementLineFields[];
};

export function validateRequestFields(input: RequestFieldsInput): string[] {
  const errors: string[] = [];
  if (!input.reason || input.reason.trim() === '') errors.push('reason_required');
  errors.push(...validateLines(input.lines));
  return errors;
}

/** ≥1 line, ≤50, dense lineNo 1..N, every line complete and positive, claim total > 0. */
export function validateLines(lines?: readonly ReimbursementLineFields[]): string[] {
  const errors: string[] = [];
  if (!lines || lines.length === 0) return ['lines_required'];
  if (lines.length > REIMBURSEMENT_MAX_LINES) errors.push('too_many_lines');

  const ordered = byLineNo(lines);
  if (ordered.some((line, index) => line.lineNo !== index + 1)) errors.push('line_no_not_dense');
  for (const line of ordered) {
    if (!line.description || line.description.trim() === '') errors.push('line_description_required');
    if (!line.categoryKey || line.categoryKey.trim() === '') errors.push('line_category_required');
    if (!line.incurredDate) errors.push('line_incurred_date_required');
    if (line.amount === undefined || line.amount === null || line.amount === '') errors.push('line_amount_required');
    else {
      const normalized = d(normalizeReimbursementAmount(line.amount));
      if (!normalized.gt(0)) errors.push('line_amount_must_be_positive');
      if (normalized.gt(REIMBURSEMENT_MAX_AMOUNT)) errors.push('amount_exceeds_limit');
    }
  }
  const total = d(computeClaimTotal(ordered));
  if (!total.gt(0)) errors.push('amount_must_be_positive');
  if (total.gt(REIMBURSEMENT_MAX_AMOUNT)) errors.push('amount_exceeds_limit');
  return [...new Set(errors)];
}

// ---- Approval snapshot hash ----

export type ApprovalSnapshotFields = {
  amount: string;
  currency: string;
  categoryKey: string;
  incurredDate: string; // ISO date
  reason: string;
  primaryAttachmentId?: string | null;
  lines?: readonly ReimbursementLineFields[];
};

export type LegacyV1FallbackSnapshotFields = ApprovalSnapshotFields & {
  requestId: string;
  companyId: string;
  title?: string | null;
  categoryLabelSnapshot?: string | null;
  linkedExpenseId?: string | null;
  lines?: readonly (ReimbursementLineFields & {
    id: string;
    companyId: string;
    reimbursementRequestId: string;
    categoryLabelSnapshot?: string | null;
  })[];
};

function snapshotDigest(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

function snapshotHeaderParts(fields: ApprovalSnapshotFields): string[] {
  return [
    d(fields.amount).toFixed(4),
    fields.currency,
    fields.categoryKey,
    fields.incurredDate,
    (fields.reason ?? '').trim(),
    fields.primaryAttachmentId ?? '',
  ];
}

/** Exact algorithm used by the production header-only writer before line snapshots existed. */
export function computeLegacySnapshotHashV1(fields: ApprovalSnapshotFields): string {
  return snapshotDigest(snapshotHeaderParts(fields));
}

/**
 * Deterministic hash of the approval-sensitive fields frozen at submit time.
 * Every line is folded in lineNo order, so editing one line after submit
 * invalidates the pending approval exactly like editing the total does.
 */
export function computeSnapshotHash(fields: ApprovalSnapshotFields): string {
  const canonical = [
    ...snapshotHeaderParts(fields),
    ...byLineNo(fields.lines ?? []).map((line) => [
      line.lineNo,
      d(line.amount).toFixed(4),
      line.categoryKey,
      isoOf(line.incurredDate),
      (line.description ?? '').trim(),
      (line.purpose ?? '').trim(),
      line.attachmentId ?? '',
      line.linkedExpenseId ?? '',
    ].join('~')),
  ];
  return snapshotDigest(canonical);
}

/**
 * Compatibility is intentionally narrower than "hash matches the old header". The only accepted
 * line is the exact deterministic row produced by the reviewed legacy backfill; any line edit or
 * extra line remains stale and requires staff review, never employee resubmission by default.
 */
export function isExactLegacyV1FallbackSnapshot(
  fields: LegacyV1FallbackSnapshotFields,
  storedHash: string,
): boolean {
  if (storedHash !== computeLegacySnapshotHashV1(fields)) return false;
  if (!fields.lines || fields.lines.length !== 1) return false;

  const line = fields.lines[0]!;
  // PostgreSQL btrim(text) in the reviewed migration removes ASCII spaces only.
  // Keep runtime classification byte-equivalent so untouched tabs/NBSP cannot
  // pass PRE and become invalid after the backfill.
  const sqlBtrim = (value?: string | null): string => (value ?? '').replace(/^ +| +$/g, '');
  const title = sqlBtrim(fields.title);
  const reason = sqlBtrim(fields.reason);
  const fallbackDescription = title || reason || 'รายการเบิก';
  const sameOptional = (left?: string | null, right?: string | null): boolean => (
    (left === undefined ? null : left) === (right === undefined ? null : right)
  );

  return line.companyId === fields.companyId
    && line.id === `rbl_${fields.requestId}`
    && line.reimbursementRequestId === fields.requestId
    && line.lineNo === 1
    && isoOf(line.incurredDate) === fields.incurredDate
    && line.description === fallbackDescription
    && (line.purpose === undefined || line.purpose === null)
    && line.categoryKey === fields.categoryKey
    && sameOptional(line.categoryLabelSnapshot, fields.categoryLabelSnapshot)
    && d(line.amount).eq(d(fields.amount))
    && sameOptional(line.attachmentId, fields.primaryAttachmentId)
    && sameOptional(line.linkedExpenseId, fields.linkedExpenseId);
}

// ---- Self-approval guard ----

/**
 * Roles that may approve their own claim without the company turning the policy on
 * (owner decision 2026-08-10). Imported rather than restated: procurement already carries this
 * exact list for the same reason — a small company is one person doing everything — and two copies
 * of one policy is how they come to disagree.
 *
 * Every such decision is audited inside the approving transaction, so support can always answer
 * "who approved their own claim, and under what": see the selfApproval block in the approval audit
 * metadata. The exemption buys convenience, not anonymity.
 */
import { SELF_APPROVAL_EXEMPT_ROLES } from '../../../procurement/domain/logic/procurement.logic';
export { SELF_APPROVAL_EXEMPT_ROLES };

/**
 * `approverRoles` defaults to none, so a caller that has not opted in keeps the strict
 * maker-checker behaviour. Widening who may approve is not something a default should decide.
 */
export function isSelfApproval(
  requesterUserId: string,
  approverUserId: string,
  allowSelfApproval: boolean,
  approverRoles: string[] = [],
): boolean {
  if (allowSelfApproval) return false;
  if (requesterUserId !== approverUserId) return false;
  return !approverRoles.some((role) => SELF_APPROVAL_EXEMPT_ROLES.includes(role));
}

// ---- Status transitions ----

const ALLOWED_TRANSITIONS: Record<ReimbursementRequestStatus, ReimbursementRequestStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED', 'DRAFT'],
  APPROVED: ['FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'CANCELLED', 'VOIDED'],
  FINANCE_REVIEW: ['READY_FOR_PAYMENT', 'APPROVED', 'CANCELLED', 'VOIDED'],
  READY_FOR_PAYMENT: ['PAID', 'PARTIALLY_PAID', 'FINANCE_REVIEW', 'CANCELLED', 'VOIDED'],
  PARTIALLY_PAID: ['PAID', 'VOIDED'],
  REJECTED: ['DRAFT'],
  CANCELLED: [],
  PAID: ['VOIDED'],
  VOIDED: [],
};

export function canTransition(from: ReimbursementRequestStatus, to: ReimbursementRequestStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

// ---- Receipt requirement ----

/**
 * Claim-level receipt status over per-line evidence: every line must carry a
 * receipt (or a linked expense), otherwise one claim-level reason may cover the
 * gaps when policy allows it.
 */
export function computeReceiptRequirement(params: {
  requireReceipt: boolean;
  allowMissingReceiptWithReason: boolean;
  lines: readonly { attachmentId?: string | null; linkedExpenseId?: string | null }[];
  missingReceiptReason?: string | null;
}): { status: ReimbursementReceiptRequirementStatus; error?: string } {
  const evidence = params.lines.length > 0 && params.lines.every(isLineEvidenced);
  if (evidence) return { status: 'ATTACHED' };
  if (!params.requireReceipt) return { status: 'WAIVED_BY_POLICY' };
  if (params.allowMissingReceiptWithReason && params.missingReceiptReason && params.missingReceiptReason.trim() !== '') {
    return { status: 'MISSING_WITH_REASON' };
  }
  return { status: 'REQUIRED', error: 'missing_receipt' };
}

// ---- Rejection ----

export function validateRejectionReason(reason?: string): boolean {
  return !!reason && reason.trim() !== '';
}

// ---- Payment eligibility (MVP full-payment) ----

export type PaymentEligibilityInput = {
  status: ReimbursementRequestStatus;
  financeReviewRequired: boolean;
  financeReviewApproved: boolean;
  duplicateBlocking: boolean;
  approvedAmount: string;
  outstandingAmount: string;
  paidAmount: string;
  paymentMethod: ReimbursementPaymentMethod;
  paymentReference?: string;
};

/** Returns a stable error code, or null if payment is allowed. Enforces MVP full-payment. */
export function validatePaymentRecording(input: PaymentEligibilityInput): string | null {
  const payableStatuses: ReimbursementRequestStatus[] = ['APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'];
  if (!payableStatuses.includes(input.status)) return 'invalid_status_transition';
  if (input.financeReviewRequired && !input.financeReviewApproved) return 'finance_review_required';
  if (input.duplicateBlocking) return 'duplicate_unresolved';

  const paid = d(input.paidAmount);
  if (!paid.gt(0)) return 'payment_amount_invalid';

  const outstanding = d(input.outstandingAmount);
  if (paid.gt(outstanding)) return 'payment_over_approved_amount';
  // MVP: full payment only — paid must equal the outstanding amount exactly.
  if (!paid.eq(outstanding)) return 'partial_payment_not_allowed';

  if (!validatePaymentReference(input.paymentMethod, input.paymentReference)) return 'payment_reference_required';
  return null;
}

export function validatePaymentReference(method: ReimbursementPaymentMethod, reference?: string): boolean {
  if (method === 'BANK_TRANSFER' || method === 'CHEQUE') {
    return !!reference && reference.trim() !== '';
  }
  return true;
}

// ---- Payment totals ----

export function computeOutstanding(approvedAmount: string, paymentTotal: string): string {
  const outstanding = d(approvedAmount).sub(d(paymentTotal));
  return decStr(outstanding.lt(0) ? d(0) : outstanding);
}

export function computePaymentStatus(approvedAmount: string, paymentTotal: string): 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' {
  const total = d(paymentTotal);
  if (total.lte(0)) return 'UNPAID';
  if (total.gte(d(approvedAmount))) return 'PAID';
  return 'PARTIALLY_PAID';
}

// ---- Duplicate scoring ----

export type DuplicateCandidateInput = {
  requesterUserId: string;
  amount: string;
  currency: string;
  incurredDate: string; // ISO date (day granularity)
  categoryKey: string;
  normalizedReason?: string;
  lines?: readonly { lineNo: number; attachmentId?: string | null; linkedExpenseId?: string | null }[];
};

export type DuplicateMatch = {
  score: number;
  /** The line of `a` that shares evidence with `b`, so the candidate reason can name it. */
  sharedLineNo?: number;
  sharedType?: 'ATTACHMENT' | 'EXPENSE';
  sharedAttachmentId?: string;
  sharedExpenseId?: string;
};

/**
 * Scores similarity 0..100 between two requests. >= 60 is a possible duplicate.
 * Evidence signals are per line (any shared attachment/expense across the two
 * claims); amount and date stay header-level.
 */
export function scoreDuplicate(a: DuplicateCandidateInput, b: DuplicateCandidateInput): DuplicateMatch {
  let score = 0;
  const match: DuplicateMatch = { score: 0 };
  for (const line of byLineNo(a.lines ?? [])) {
    const other = (b.lines ?? []).find((candidate) =>
      (!!line.attachmentId && candidate.attachmentId === line.attachmentId)
      || (!!line.linkedExpenseId && candidate.linkedExpenseId === line.linkedExpenseId));
    if (!other) continue;
    score += 60; // same receipt/expense on both claims is the strongest signal
    if (match.sharedLineNo === undefined) {
      match.sharedLineNo = line.lineNo;
      if (line.attachmentId && other.attachmentId === line.attachmentId) {
        match.sharedType = 'ATTACHMENT';
        match.sharedAttachmentId = line.attachmentId;
      } else {
        match.sharedType = 'EXPENSE';
        match.sharedExpenseId = line.linkedExpenseId ?? undefined;
      }
    }
  }
  if (a.requesterUserId === b.requesterUserId) score += 10;
  if (d(a.amount).eq(d(b.amount)) && a.currency === b.currency) score += 20;
  if (dayOf(a.incurredDate) === dayOf(b.incurredDate)) score += 10;
  if (a.normalizedReason && b.normalizedReason && a.normalizedReason === b.normalizedReason) score += 10;
  match.score = Math.min(score, 100);
  return match;
}

export function normalizeReason(reason?: string): string {
  return (reason ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

// ---- Payment source ref for bank reconciliation (item 13) ----

export function buildPaymentSourceRef(payment: {
  id: string;
  paidAmount: string;
  currency: string;
  paidAt: Date | string;
  requesterDisplayNameSnapshot: string;
  reimbursementRequestId: string;
}): ReimbursementPaymentSourceRef {
  const paidAt = payment.paidAt instanceof Date ? payment.paidAt.toISOString() : payment.paidAt;
  return {
    sourceType: 'REIMBURSEMENT_PAYMENT',
    sourceId: payment.id,
    direction: 'PAID',
    amount: payment.paidAmount,
    currency: payment.currency,
    paidAt,
    counterpartyDisplay: payment.requesterDisplayNameSnapshot,
    requestId: payment.reimbursementRequestId,
  };
}

// ---- SLA / age ----

export function ageHours(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 3_600_000));
}

export function isSlaRisk(ageHrs: number, slaHours?: number): boolean {
  if (!slaHours || slaHours <= 0) return false;
  return ageHrs >= slaHours;
}

// ---- Redaction for outbox/AI payloads ----

const SENSITIVE_KEYS = /url|signedurl|objectkey|token|secret|accountnumber|ocr|rawtext|filebody/i;

/** Strips known-sensitive keys from a bounded payload before it leaves the module. */
export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.test(key)) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Whether an actor's roles satisfy a step routed to a ROLE (not to a named person).
 *
 * The A5 hardening closed the old hole where anyone holding `reimbursement.approve` could decide a
 * step regardless of routing — but as written it also locked out the OWNER: the default policy
 * routes to MANAGER, the seeded owner holds only OWNER, so in a fresh company nobody could approve
 * anything and the approval queue rendered empty. The owner is the principal every company role
 * reports to (role presets can never even mint an OWNER), so a role-routed step is always within
 * the owner's authority. A step naming a specific PERSON stays exact-match — deputising for a named
 * approver is a different decision than holding rank.
 */
export function matchesApproverRole(snapshot: string | null | undefined, roles: string[]): boolean {
  if (!snapshot) return false;
  return roles.includes(snapshot) || roles.includes('OWNER');
}
