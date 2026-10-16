/**
 * Pure business logic for reimbursement approval and review (Item 14).
 * No Nest / Prisma / browser imports. Decimal-safe money math.
 */

import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import {
  reimbursementDuplicateBlockNotice, isReimbursementClaimApprover, reimbursementIncurredDateError, reimbursementPaymentSlipRequired, reimbursementPaymentReferenceRequired, reimbursementPayoutCorrectionPhase,
  reimbursementPayoutHeld, reimbursementPayoutRoundAnswer, reimbursementPayoutRoundStatus, REIMBURSEMENT_PAYOUT_ROUND_TEXTS, todayCivilDate,
} from '@watchdog-bms/contracts';
import type {
  ReimbursementRequestStatus,
  ReimbursementApprovalStepStatus,
  ReimbursementCurrentDesk,
  ReimbursementFinanceReviewStatus,
  ReimbursementPaymentMethod,
  ReimbursementPaymentSourceRef,
  ReimbursementPayoutCorrectionPhase,
  ReimbursementPayoutHeld,
  ReimbursementPayoutRoundAnswer,
  ReimbursementReceiptRequirementStatus,
  ReimbursementPolicySnapshotV1,
} from '@watchdog-bms/contracts';
import { hasPayoutSnapshot } from './payout-destination.logic';
// FIN-01: one settlement tolerance across the app. Shared, not copied, because the
// reimbursements module already depends on expenses (projection orchestrator, evidence
// service, repository) and expenses never depends back — this is a pure Decimal constant,
// so the "no Nest / Prisma" rule above still holds.
import { SETTLE_EPSILON } from '../../../expenses/domain/logic/expense-totals.logic';
import { effectivePolicyForRequest, parseReimbursementPolicySnapshot, type EffectivePolicy } from '../reimbursement.constants';
import type { ReimbursementRequestRecord } from '../models/reimbursement.model';

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

/** The same approval floor for the draft warning and submit routing. */
export function thirdPartyPayoutApprovalRequired(amount: string, threshold: string, thirdParty: boolean): boolean {
  return thirdParty && !requiresApproval(amount, threshold);
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
  sourceExpenseSnapshot?: import('@watchdog-bms/contracts').ReimbursementSourceSnapshot;
  attachmentSnapshot?: import('../models/reimbursement.model').ReimbursementAttachmentSnapshot;
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
export function validateLines(lines?: readonly ReimbursementLineFields[], today = todayCivilDate()): string[] {
  const errors: string[] = [];
  if (!lines || lines.length === 0) return ['lines_required'];
  if (lines.length > REIMBURSEMENT_MAX_LINES) errors.push('too_many_lines');

  const ordered = byLineNo(lines);
  if (ordered.some((line, index) => line.lineNo !== index + 1)) errors.push('line_no_not_dense');
  for (const line of ordered) {
    if (!line.description || line.description.trim() === '') errors.push('line_description_required');
    if (!line.categoryKey || line.categoryKey.trim() === '') errors.push('line_category_required');
    if (!line.incurredDate) errors.push('line_incurred_date_required');
    else {
      const dateError = reimbursementIncurredDateError(line.incurredDate, today);
      if (dateError) errors.push(`${dateError}:${line.lineNo}`);
    }
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
  approvalPolicySnapshotJson?: ReimbursementPolicySnapshotV1;
  /**
   * The claim's receiving method and its own account snapshot. Folded into the hash only when the
   * claim carries `payoutFingerprint` — the one value nothing but the payout-aware submit writes — so
   * a claim sent before the field existed, or sent by an older build during a rollback, keeps the
   * hash it was approved and signed under whatever a draft had chosen.
   */
  payoutMethod?: string | null;
  payoutDestinationVersion?: number | null;
  payoutFingerprint?: string | null;
};

/** A claim as its hash reads it: the record itself, or the same columns read by the production gate. */
export type ClaimSnapshotSource = {
  amount: string;
  currency: string;
  categoryKey: string;
  incurredDate: Date | string;
  reason: string;
  primaryAttachmentId?: string | null;
  lines?: ApprovalSnapshotFields['lines'];
  payoutMethod?: string | null;
  payoutDestinationVersion?: number | null;
  payoutFingerprint?: string | null;
};

/**
 * The ONE mapping from a claim to the fields its hash is made of. Submit, the live approval check,
 * the signature acknowledgement (preview and sign) and the production gate all hash through it, so
 * the payout part cannot be folded into one and left out of another.
 */
export function claimSnapshotFields(
  claim: ClaimSnapshotSource,
  approvalPolicySnapshotJson?: ReimbursementPolicySnapshotV1 | null,
): ApprovalSnapshotFields {
  return {
    amount: claim.amount,
    currency: claim.currency,
    categoryKey: claim.categoryKey,
    incurredDate: isoOf(claim.incurredDate),
    reason: claim.reason,
    primaryAttachmentId: claim.primaryAttachmentId,
    lines: claim.lines ?? [],
    ...(approvalPolicySnapshotJson && { approvalPolicySnapshotJson }),
    payoutMethod: claim.payoutMethod,
    payoutDestinationVersion: claim.payoutDestinationVersion,
    payoutFingerprint: claim.payoutFingerprint,
  };
}

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
 * The hash a claim-form signer acknowledges: the claim as it stands NOW, folded
 * exactly like the approval snapshot (header + every line). Distinct from
 * `approvalSnapshotHash`, which is frozen at submit — you sign what you printed.
 * Lives here (not in an application use-case) so every detail assembler can share
 * it without an application-layer import cycle; structural param keeps this file
 * free of model/Prisma imports.
 */
export function claimSignatureAckHash(req: ClaimSnapshotSource): string {
  return computeSnapshotHash(claimSnapshotFields(req));
}

/**
 * Deterministic hash of the approval-sensitive fields frozen at submit time.
 * Every line is folded in lineNo order, so editing one line after submit
 * invalidates the pending approval exactly like editing the total does.
 */
export function computeSnapshotHash(fields: ApprovalSnapshotFields): string {
  const canonical = [
    ...snapshotHeaderParts(fields),
    ...(fields.approvalPolicySnapshotJson
      ? [`policy:${stableJson(fields.approvalPolicySnapshotJson)}`]
      : []),
    // Cash is hashed too (no version; its fingerprint is the fixed cash marker): switching cash to a
    // transfer after approval has to invalidate that approval. The attestation itself is not hashed,
    // so ticking it never changes what was signed.
    ...(fields.payoutFingerprint
      ? [`payout:${fields.payoutMethod ?? ''}:${fields.payoutDestinationVersion ?? ''}:${fields.payoutFingerprint}`]
      : []),
    ...byLineNo(fields.lines ?? []).map((line) => [
      line.lineNo,
      d(line.amount).toFixed(4),
      line.categoryKey,
      isoOf(line.incurredDate),
      (line.description ?? '').trim(),
      (line.purpose ?? '').trim(),
      line.attachmentId ?? '',
      line.linkedExpenseId ?? '',
      ...(line.sourceExpenseSnapshot ? [`source:${stableJson(line.sourceExpenseSnapshot)}`] : []),
      ...(line.attachmentSnapshot ? [`attachment:${stableJson(line.attachmentSnapshot)}`] : []),
    ].join('~')),
  ];
  return snapshotDigest(canonical);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
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
  if (fields.approvalPolicySnapshotJson) return false;
  if (!fields.lines || fields.lines.length !== 1) return false;

  const line = fields.lines[0]!;
  if (line.sourceExpenseSnapshot || line.attachmentSnapshot) return false;
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

/** The shop owner may decide their own claim regardless of its routed approver or switch. */
export function isOwnerSelfApproval(requesterUserId: string, approverUserId: string, roles: readonly string[]): boolean {
  return requesterUserId === approverUserId && roles.includes('OWNER');
}

/** Frozen assignments are checked by callers; the shop owner is exempt from the switch. */
export function isSelfApproval(
  requesterUserId: string,
  approverUserId: string,
  allowSelfApproval: boolean,
  roles: readonly string[] = [],
): boolean {
  return !allowSelfApproval && requesterUserId === approverUserId && !isOwnerSelfApproval(requesterUserId, approverUserId, roles);
}

/**
 * The claim's own approver, for a notice that asks one person. Who that is has one definition,
 * `isReimbursementClaimApprover` in contracts (it also decides the account number and the payment
 * slip): an approval still in force, made in the round the claim was last sent in. This asks that
 * rule of each decider and takes the latest. The workflow reminder scan reads the same person with a
 * query (`findClaimApprovers`), which restates the rule because it cannot call it.
 */
export function claimApproverUserId(claim: Parameters<typeof claimApprovalStep>[0]): string | undefined {
  return claimApprovalStep(claim)?.decisionByUserId ?? undefined;
}

/**
 * The approval the claim stands on: the step that same rule answers for, the latest when there are
 * several. The printed form's ผู้อนุมัติ block and the right to sign it read this step, so the paper,
 * the signature and the page name one person. A claim whose approval was invalidated (its payout
 * account is being corrected, payout spec §14) or was given before the claim was last sent has none.
 */
export function claimApprovalStep<Step extends { status: string; decisionByUserId?: string | null; decidedAt?: Date | null; invalidatedAt?: Date | null }>(claim: {
  submittedAt?: Date | null;
  approvalSteps?: readonly Step[];
}): Step | undefined {
  return (claim.approvalSteps ?? [])
    .filter((step) => !!step.decisionByUserId
      && isReimbursementClaimApprover(step.decisionByUserId, { submittedAt: claim.submittedAt, approvalSteps: [step] }))
    .sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())[0];
}

// ---- Payout account correction round (payout spec §14) ----

/** `invalidatedReason` of every approval step a correction round sets aside: the approval it replaces, and each step of the round that did not end in approval. */
export const PAYOUT_CORRECTION_STEP_REASON = 'payout_account_correction';

/** Whether a claim is in a correction round, and whom it waits for: the contracts rule, under the name this module calls it by. */
export const payoutCorrectionPhase = reimbursementPayoutCorrectionPhase;

/**
 * The approval step a round's new step takes its approvers from (payout spec §14.5): the one still
 * waiting when the account is given a second time, else the one the round last set aside when the
 * claim was sent back. The new step copies who it names, so the same people approve the account,
 * and the step's own recovery rule (its recorded role, or the owner) applies when none of them can
 * act any more. None: nobody had to approve this claim, and it needs no approval now.
 */
export function payoutCorrectionSourceStep<Step extends { id: string; status: string; invalidatedAt?: Date | null; invalidatedReason?: string | null }>(claim: {
  currentApprovalStepId?: string | null;
  payoutCorrectionRequestedAt?: Date | null;
  approvalSteps?: readonly Step[];
}): Step | undefined {
  const steps = claim.approvalSteps ?? [];
  const waiting = steps.find((step) => step.id === claim.currentApprovalStepId && step.status === 'PENDING');
  if (waiting) return waiting;
  const since = claim.payoutCorrectionRequestedAt?.getTime();
  if (since === undefined) return undefined;
  return steps
    .filter((step) => step.invalidatedReason === PAYOUT_CORRECTION_STEP_REASON && !!step.invalidatedAt && step.invalidatedAt.getTime() >= since)
    .sort((a, b) => b.invalidatedAt!.getTime() - a.invalidatedAt!.getTime())[0];
}

/** The frozen policy decides for current claims; legacy rounds retain their recorded approval route. */
export function payoutCorrectionApprovalRequired(claim: Parameters<typeof payoutCorrectionSourceStep>[0] & { approvalPolicySnapshotJson?: unknown }): boolean {
  return parseReimbursementPolicySnapshot(claim.approvalPolicySnapshotJson)?.requiresApproval ?? !!payoutCorrectionSourceStep(claim);
}

/**
 * What the claim was approved with when its current round began: kept by the send-back that opened
 * the round (a send-back from the round's own step keeps none). The detail's "previous account" and
 * the choice to keep that account read it. A legacy claim had no method; cash has no version.
 */
export function payoutCorrectionRoundStart<Approved extends { payoutMethod?: string; payoutVersion?: number; at?: string }>(claim: {
  payoutCorrectionLog?: readonly { kind: string; approved?: Approved }[] | null;
}): Approved | undefined {
  return [...(claim.payoutCorrectionLog ?? [])].reverse().find((entry) => entry.kind === 'SENT_BACK' && !!entry.approved)?.approved;
}

// ---- The facts behind the words of a round (payout spec §14.2) ----
//
// Every word a round shows follows what the claim HELD when it was sent back and what its requester
// ANSWERED, never the phase alone or the reason code. The words are in contracts; the facts are read here.

/** A claim, as far as what it holds goes: the method of its own snapshot. */
type PayoutHolder = { payoutMethod?: string | null; payoutFingerprint?: string | null };
/** A claim, as far as its round goes. */
type PayoutCorrectionClaim = PayoutHolder & Parameters<typeof reimbursementPayoutCorrectionPhase>[0] & {
  requesterUserId?: string | null;
  payoutCorrectionLog?: Parameters<typeof payoutCorrectionFacts>[0];
};

/**
 * What a claim record holds as its payout destination (contracts `reimbursementPayoutHeld`): the method
 * of its own snapshot. A claim sent before claims carried one holds nothing, whatever its draft once chose.
 */
export function payoutCorrectionHeld(claim: PayoutHolder): ReimbursementPayoutHeld {
  return reimbursementPayoutHeld({ payoutMethod: hasPayoutSnapshot(claim) ? claim.payoutMethod : undefined });
}

/**
 * The fact behind the words of every step of every round of a claim, in the order of its log and one
 * for each entry: what the claim held at a send-back, and what an answer gave against what its round
 * began with. The ONE reading of the log: a list row, a claim detail, the timeline, the two notices,
 * the printed form and the LINE assistant take their words from it, so they cannot tell it differently.
 *
 * A send-back from the pay step opens a round and says what the claim was approved with (`approved`,
 * with no method for a claim that had no account). A send-back from the round's waiting step holds
 * what the answer before it gave. An approval approves the answer before it. Whether an answer is the
 * very destination the round began with was decided when it was taken (`sameAsApproved`). An entry
 * whose round has no opening on record gets no fact: its reader then says words true of every claim.
 *
 * An answer also says whether someone gave it on the requester's behalf (`requesterUserId`: the claim's
 * requester): no sentence says the requester did what someone else did for them.
 */
export function payoutCorrectionFacts(log: readonly {
  kind: string;
  byUserId?: string | null;
  approved?: { payoutMethod?: string | null } | null;
  payoutMethod?: string | null;
  sameAsApproved?: boolean;
}[] | null | undefined, requesterUserId?: string | null): Array<{ held?: ReimbursementPayoutHeld; answer?: ReimbursementPayoutRoundAnswer; onBehalf?: true }> {
  let start: ReimbursementPayoutHeld | undefined;
  let given: ReimbursementPayoutHeld | undefined;
  let answer: ReimbursementPayoutRoundAnswer | undefined;
  return (log ?? []).map((entry) => {
    if (entry.kind === 'SENT_BACK' && entry.approved) {
      start = reimbursementPayoutHeld(entry.approved);
      given = undefined;
      answer = undefined;
      return { held: start };
    }
    if (entry.kind === 'SENT_BACK') return given ? { held: given } : {};
    if (entry.kind === 'ACCOUNT_SUBMITTED') {
      const method = entry.payoutMethod === 'BANK_TRANSFER' || entry.payoutMethod === 'CASH' ? entry.payoutMethod : undefined;
      given = method && reimbursementPayoutHeld({ payoutMethod: method });
      answer = start && method ? reimbursementPayoutRoundAnswer(start, method, entry.sameAsApproved === true) : undefined;
      const onBehalf = !!entry.byUserId && !!requesterUserId && entry.byUserId !== requesterUserId;
      return { ...(answer && { answer }), ...(onBehalf && { onBehalf: true as const }) };
    }
    // The approval of the answer before it.
    return answer ? { answer } : {};
  });
}

/**
 * What the requester gave, of a claim whose answer waits for approval: the fact of that answer, the
 * last entry of its log. Undefined for a claim in any other state.
 */
export function payoutCorrectionAnswer(claim: PayoutCorrectionClaim): ReimbursementPayoutRoundAnswer | undefined {
  return payoutCorrectionPhase(claim) === 'AWAITING_APPROVAL' ? payoutCorrectionFacts(claim.payoutCorrectionLog).at(-1)?.answer : undefined;
}

/**
 * Who gave the answer that waits for approval, and whether that was someone other than the claim's
 * requester: the same last entry of the log. Undefined for a claim in any other state.
 */
export function payoutCorrectionAnsweredBy(claim: PayoutCorrectionClaim): { byUserId: string; onBehalf?: true } | undefined {
  const answered = payoutCorrectionPhase(claim) === 'AWAITING_APPROVAL' ? claim.payoutCorrectionLog?.at(-1) : undefined;
  if (answered?.kind !== 'ACCOUNT_SUBMITTED' || !answered.byUserId) return undefined;
  const onBehalf = payoutCorrectionFacts(claim.payoutCorrectionLog, claim.requesterUserId).at(-1)?.onBehalf;
  return { byUserId: answered.byUserId, ...(onBehalf && { onBehalf }) };
}

/**
 * The desk of a claim that waits for its requester, as the LINE backlog lists it (payout spec §17.3): the
 * claim page's status label for what the claim holds, and the sentence that says what happens next. One
 * desk row per label, so each label is true of every claim its row counts; `order` places the rows.
 */
export function payoutCorrectionRequesterDesk(claim: PayoutHolder): { order: number; label: string; note: string } {
  const held = payoutCorrectionHeld(claim);
  const payoutMethod = hasPayoutSnapshot(claim) ? claim.payoutMethod : undefined;
  return {
    order: Object.keys(REIMBURSEMENT_PAYOUT_ROUND_TEXTS.held).indexOf(held),
    label: reimbursementPayoutRoundStatus({ payoutCorrectionPhase: 'AWAITING_REQUESTER', payoutMethod }) as string,
    note: REIMBURSEMENT_PAYOUT_ROUND_TEXTS.held[held].assistantNote,
  };
}

/** What a claim in a round is said to wait for (contracts `reimbursementPayoutRoundStatus`), asked of a claim record. Undefined: it is in no round. */
export function payoutCorrectionStatusLabel(claim: PayoutCorrectionClaim): string | undefined {
  return reimbursementPayoutRoundStatus({
    payoutCorrectionPhase: payoutCorrectionPhase(claim),
    payoutMethod: hasPayoutSnapshot(claim) ? claim.payoutMethod : undefined,
    payoutCorrectionAnswer: payoutCorrectionAnswer(claim),
  });
}

/**
 * Since when a claim waits for its approvers: the day it was sent, or, in a correction round, the
 * moment its new account was given. The approval queue's age, the deadline reminder and the LINE
 * backlog count from here, so a round's approvers are not held to a wait that was not theirs.
 */
export function approvalWaitStartedAt(claim: { submittedAt?: Date | null; payoutCorrectionSubmittedAt?: Date | null }): Date | undefined {
  return claim.payoutCorrectionSubmittedAt ?? claim.submittedAt ?? undefined;
}

/**
 * Whose turn it is to record a claim's payment, first to last (owner rule 2026-10-01): the finance
 * reviewer who passed the claim, then the claim's own approver. It is the order the ready-to-pay notice
 * and the payment reminder ask in, so the claim page names first the person those notices went to.
 * Whether they can pay is the caller's question: someone who cannot is not named at all.
 */
export function paymentTurnUserIds(claim: Parameters<typeof claimApproverUserId>[0] & {
  financeReviewStatus?: string;
  financeReviewedByUserId?: string | null;
}): string[] {
  const reviewer = claim.financeReviewStatus === 'APPROVED_FOR_PAYMENT' ? claim.financeReviewedByUserId : undefined;
  return [...new Set([reviewer, claimApproverUserId(claim)].filter((userId): userId is string => !!userId))];
}

// ---- Status transitions ----

const ALLOWED_TRANSITIONS: Record<ReimbursementRequestStatus, ReimbursementRequestStatus[]> = {
  DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
  // READY_FOR_PAYMENT: only out of a payout account correction round, whose approval moves the claim on in one step.
  PENDING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED', 'DRAFT', 'READY_FOR_PAYMENT'],
  APPROVED: ['FINANCE_REVIEW', 'READY_FOR_PAYMENT', 'CANCELLED', 'VOIDED'],
  FINANCE_REVIEW: ['READY_FOR_PAYMENT', 'APPROVED', 'CANCELLED', 'VOIDED'],
  // PENDING_APPROVAL: sent back to have its payout account corrected.
  READY_FOR_PAYMENT: ['PAID', 'PARTIALLY_PAID', 'FINANCE_REVIEW', 'CANCELLED', 'VOIDED', 'PENDING_APPROVAL'],
  PARTIALLY_PAID: ['PAID', 'VOIDED'],
  REJECTED: ['DRAFT', 'CANCELLED'],
  CANCELLED: [],
  PAID: ['VOIDED'],
  VOIDED: [],
};

export function canTransition(from: ReimbursementRequestStatus, to: ReimbursementRequestStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

// ---- A decision the system has yet to carry out ----

export type PendingProjectionIntent = {
  /** MANAGER: a person approved it. FINANCE: finance passed it for payment. POLICY: it needed no approval. */
  kind: 'MANAGER' | 'FINANCE' | 'POLICY';
  /** Who made the decision the claim waits on (for POLICY: who sent the claim). */
  actorUserId: string;
  approvalStepId?: string;
};

/**
 * The durable decision a claim waits for the system to carry out, if any. A decision is committed
 * first and the claim's expense records are built and confirmed after it, so a failure in between
 * leaves the claim decided but not moved on (audit B4). One definition for the scheduled reconciler,
 * for the "ดำเนินการต่อ" call and for the flag on the claim detail, so the three cannot disagree on
 * which claims are in that state.
 *
 * Needs the claim's approval steps (the approved ones at least). A claim that is being cancelled is
 * never one: the cancellation comes first.
 */
export function pendingProjectionIntent(request: {
  status: ReimbursementRequestStatus;
  financeReviewStatus?: ReimbursementFinanceReviewStatus;
  financeReviewedByUserId?: string | null;
  currentApprovalStepId?: string | null;
  cancellationPendingAt?: Date | null;
  payoutCorrectionRequestedAt?: Date | null;
  requesterUserId: string;
  submittedByUserId?: string | null;
  approvalPolicySnapshotJson?: unknown;
  approvalSteps?: ReadonlyArray<{ id: string; status: ReimbursementApprovalStepStatus; decisionByUserId?: string | null }>;
}): PendingProjectionIntent | undefined {
  if (request.cancellationPendingAt) return undefined;
  if (request.status === 'PENDING_APPROVAL') {
    // A claim in a payout account correction round holds no decision to carry out: its expense records
    // stand, and its approval moves it on in the approval's own transaction (payout spec §14.6).
    if (request.payoutCorrectionRequestedAt) return undefined;
    const step = request.approvalSteps?.find((candidate) => candidate.id === request.currentApprovalStepId);
    return step?.status === 'APPROVED' && step.decisionByUserId
      ? { kind: 'MANAGER', actorUserId: step.decisionByUserId, approvalStepId: step.id } : undefined;
  }
  if (request.status === 'FINANCE_REVIEW') {
    return request.financeReviewStatus === 'APPROVED_FOR_PAYMENT' && request.financeReviewedByUserId
      ? { kind: 'FINANCE', actorUserId: request.financeReviewedByUserId } : undefined;
  }
  if (request.status === 'APPROVED' && !request.currentApprovalStepId) {
    const snapshot = parseReimbursementPolicySnapshot(request.approvalPolicySnapshotJson);
    return snapshot && !snapshot.requiresApproval && !snapshot.financeReviewRequired
      ? { kind: 'POLICY', actorUserId: request.submittedByUserId ?? request.requesterUserId } : undefined;
  }
  return undefined;
}

// ---- Current desk (อยู่ที่ใคร) ----

/** The pending-step fields the desk rule reads; nothing else on a step matters here. */
export type CurrentDeskStepFields = {
  sequenceNo: number;
  status: ReimbursementApprovalStepStatus;
  approverUserId?: string;
  assignedApproverUserIds?: readonly string[];
  invalidatedAt?: Date;
};

/**
 * Who the ball is with right now, so a queue row can say it in one line.
 *
 * Only the approval stage names individuals — it is the one stage where the system truly
 * assigns people (the frozen assignment snapshot). Finance review and payment are permission
 * pools, so they answer with the pool and never with a guessed person. Terminal claims
 * (paid/rejected/cancelled/voided) have no desk at all.
 */
export function currentDesk(input: {
  status: ReimbursementRequestStatus;
  financeReviewStatus?: ReimbursementFinanceReviewStatus;
  /** The claim's approval steps when the caller loaded them; left out, nothing is concluded from their absence. */
  steps?: readonly CurrentDeskStepFields[];
  names?: Record<string, string>;
  /** A cancellation was started and has not completed. */
  cancellationPending?: boolean;
  /** The claim's place in a payout account correction round (`payoutCorrectionPhase`), when it is in one. */
  payoutCorrectionPhase?: ReimbursementPayoutCorrectionPhase;
}): ReimbursementCurrentDesk | undefined {
  // A claim being cancelled is with the system whatever its status: nobody approves or pays it meanwhile
  // (audit B3). A finished claim keeps having no desk.
  const cancelling = (desk: ReimbursementCurrentDesk): ReimbursementCurrentDesk => (input.cancellationPending ? { kind: 'SYSTEM' } : desk);
  switch (input.status) {
    case 'DRAFT': return cancelling({ kind: 'REQUESTER' });
    case 'FINANCE_REVIEW': return cancelling({ kind: 'FINANCE' });
    case 'READY_FOR_PAYMENT':
    case 'PARTIALLY_PAID': return cancelling({ kind: 'PAYMENT' });
    // Transient: approved, waiting for the projection to route it on to one of the two.
    case 'APPROVED': return cancelling({ kind: input.financeReviewStatus === 'PENDING' ? 'FINANCE' : 'PAYMENT' });
    case 'PENDING_APPROVAL': break;
    default: return undefined;
  }
  if (input.cancellationPending) return { kind: 'SYSTEM' };
  // Sent back to have its payout account corrected (payout spec §14.2): no step is open, and that is
  // not a decision waiting for the system. The claim is with its requester until they give the account;
  // after that the new step below names its approvers like any other.
  if (input.payoutCorrectionPhase === 'AWAITING_REQUESTER') return { kind: 'REQUESTER' };
  const step = [...(input.steps ?? [])]
    .filter((s) => s.status === 'PENDING' && !s.invalidatedAt)
    .sort((a, b) => a.sequenceNo - b.sequenceNo)[0];
  // Decided (audit B4): the steps were loaded and none is waiting. The approval is durable and the claim
  // stays PENDING_APPROVAL only until the system has built its expense records. It waits for no approver,
  // which is what the LINE backlog answer has always said of it ("รอระบบปรับสถานะ").
  if (input.steps && !step) return { kind: 'SYSTEM' };
  const names = [...new Set([
    ...(step?.assignedApproverUserIds ?? []),
    ...(step?.approverUserId ? [step.approverUserId] : []),
  ])]
    .map((userId) => input.names?.[userId])
    .filter((name): name is string => !!name);
  // Nobody resolvable (role-routed step, or names were never loaded): the client prints the
  // pool label. A cuid on screen is as unusable as no answer at all.
  return names.length > 0 ? { kind: 'APPROVER', names } : { kind: 'APPROVER' };
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
  if (params.allowMissingReceiptWithReason) {
    return params.missingReceiptReason?.trim()
      ? { status: 'MISSING_WITH_REASON' } : { status: 'REQUIRED', error: 'missing_receipt_reason_required' };
  }
  return params.requireReceipt ? { status: 'REQUIRED', error: 'missing_receipt' } : { status: 'WAIVED_BY_POLICY' };
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
  duplicateReasons?: readonly import('@watchdog-bms/contracts').ReimbursementDuplicateReason[];
  approvedAmount: string;
  outstandingAmount: string;
  paidAmount: string;
  paymentMethod: ReimbursementPaymentMethod;
  paymentReference?: string;
  /** A slip comes with this payment. Whether the file itself is acceptable is proven separately. */
  hasSlip: boolean;
};

/**
 * The statuses a payment is recorded in. PARTIALLY_PAID is not one: only the full outstanding amount is
 * taken. The claim page names who can pay only in these, so it never names someone the endpoint refuses.
 */
export const PAYMENT_RECORDING_STATUSES: readonly ReimbursementRequestStatus[] = ['APPROVED', 'FINANCE_REVIEW', 'READY_FOR_PAYMENT'];

// ---- A possible duplicate: one fact, from the claim's own candidates ----
//
// Submit records the other claims this one may repeat as candidates, OPEN until a person clears them.
// The claim's `duplicateStatus` column says the same until its expense records are built; from then on
// the column holds the result of THOSE records, which know nothing of the candidates. So a claim
// found possibly duplicate at submit read NO_MATCH after approval while its payment was still refused.
// Answers combine the claim candidates with its own expense records below.

/**
 * A confirmed own expense duplicate always refuses new payment. An unresolved duplicate refuses
 * it only under the claim's BLOCK_PAYMENT policy. The one test.
 * Recording a payment asks it before
 * the payment lock and under it (`duplicate_unresolved`), the claim detail reports it as
 * `duplicateBlocksPayment` and a pay-queue row as `hasDuplicateBlocker`, so a row and a claim page
 * carry the mark exactly when the payment would be refused for it.
 */
export function duplicateBlocksPayment(duplicatePolicy: string, openCandidates: number, unresolvedExpenses = 0, confirmedExpenses = 0): boolean {
  return confirmedExpenses > 0 || (duplicatePolicy === 'BLOCK_PAYMENT' && (openCandidates > 0 || unresolvedExpenses > 0));
}

/** The same payment predicate on the claim's frozen policy and loaded duplicate facts. */
export function claimDuplicateBlocksPayment(request: Pick<ReimbursementRequestRecord, 'approvalPolicySnapshotJson' | 'duplicateCandidates'
  | 'possibleDuplicateExpenseCount' | 'duplicateConfirmationPendingCount' | 'confirmedDuplicateExpenseCount'>, currentPolicy: EffectivePolicy,
  openCandidates = (request.duplicateCandidates ?? []).filter((candidate) => candidate.status === 'OPEN').length): boolean {
  return duplicateBlocksPayment(effectivePolicyForRequest(request, currentPolicy).duplicatePolicy,
    openCandidates,
    (request.possibleDuplicateExpenseCount ?? 0) + (request.duplicateConfirmationPendingCount ?? 0), request.confirmedDuplicateExpenseCount);
}

export function claimDuplicateReasons(request: { duplicateCandidates?: { status: string; candidateType: string }[]; possibleDuplicateExpenseCount?: number; duplicateConfirmationPendingCount?: number; confirmedDuplicateExpenseCount?: number }): import('@watchdog-bms/contracts').ReimbursementDuplicateReason[] {
  return [...new Set([
    ...(request.duplicateCandidates ?? []).filter(candidate => candidate.status === 'OPEN').map(candidate => candidate.candidateType),
    ...((request.possibleDuplicateExpenseCount ?? 0) > 0 ? ['EXPENSE_DOCUMENT'] : []),
    ...((request.duplicateConfirmationPendingCount ?? 0) > 0 ? ['EXPENSE_CONFIRMATION'] : []),
    ...((request.confirmedDuplicateExpenseCount ?? 0) > 0 ? ['EXPENSE_CONFIRMED_DUPLICATE'] : []),
  ])] as import('@watchdog-bms/contracts').ReimbursementDuplicateReason[];
}

export function claimPaymentDuplicateBlock(request: Parameters<typeof claimDuplicateBlocksPayment>[0], currentPolicy: EffectivePolicy): import('@watchdog-bms/contracts').ReimbursementPaymentDuplicateBlock {
  if (!claimDuplicateBlocksPayment(request, currentPolicy)) return 'NONE';
  return claimDuplicateReasons(request).includes('EXPENSE_CONFIRMED_DUPLICATE') ? 'CONFIRMED' : 'UNRESOLVED';
}

export function confirmedDuplicateRefusal(request: Parameters<typeof claimDuplicateReasons>[0] & { status: string }, canCancel?: boolean) {
  const duplicateReasons = claimDuplicateReasons(request);
  if (!duplicateReasons.includes('EXPENSE_CONFIRMED_DUPLICATE')) return null;
  return { code: 'duplicate_confirmed', duplicatePhase: 'PAYMENT', duplicateReasons, claimStatus: request.status, canCancel,
    message: reimbursementDuplicateBlockNotice(duplicateReasons, false, { status: request.status, canCancel }) };
}

/**
 * A claim's duplicate status as an answer reports it: the stored column (its expense records' result
 * once they exist) together with the claim's own candidates. A candidate still open is a possible
 * duplicate whatever the records say; candidates a person cleared read as checked, never as "none
 * found". A draft (NOT_CHECKED) says nothing yet: the candidates of an earlier round are replaced
 * when it is sent again. `candidates` undefined: they were not loaded, and the column is all there is.
 */
export function claimDuplicateStatus<Status extends string>(
  stored: Status,
  candidates: readonly { status: string }[] | null | undefined,
): Status | 'POSSIBLE_DUPLICATE' | 'OVERRIDDEN' {
  if (!candidates || stored === 'CONFIRMED_DUPLICATE' || stored === 'NOT_CHECKED') return stored;
  if (candidates.some((candidate) => candidate.status === 'OPEN')) return 'POSSIBLE_DUPLICATE';
  if (stored === 'POSSIBLE_DUPLICATE') return stored;
  return candidates.some((candidate) => candidate.status === 'OVERRIDDEN') ? 'OVERRIDDEN' : stored;
}

/** Returns a stable error code, or null if payment is allowed. Enforces MVP full-payment. */
export function validatePaymentRecording(input: PaymentEligibilityInput): string | null {
  if (!PAYMENT_RECORDING_STATUSES.includes(input.status)) return 'invalid_status_transition';
  if (input.financeReviewRequired && !input.financeReviewApproved) return 'finance_review_required';
  if (input.duplicateBlocking) {
    if (input.duplicateReasons?.includes('EXPENSE_CONFIRMED_DUPLICATE')) return 'duplicate_confirmed';
    return 'duplicate_unresolved';
  }

  const paid = d(input.paidAmount);
  if (!paid.gt(0)) return 'payment_amount_invalid';

  const outstanding = d(input.outstandingAmount);
  // FIN-01: a legacy 4dp claim (580.0042) prints and displays its satang rounding (580.00),
  // and that is the only figure the payer can transfer. Both guards therefore work to half a
  // satang, so paying the displayed outstanding is accepted and settles the claim. A real
  // over- or underpayment (a satang or more either way) is still refused.
  if (paid.sub(outstanding).gt(SETTLE_EPSILON)) return 'payment_over_approved_amount';
  // MVP: full payment only — paid must clear the outstanding amount within the satang tolerance.
  if (outstanding.sub(paid).gte(SETTLE_EPSILON)) return 'partial_payment_not_allowed';

  if (!validatePaymentReference(input.paymentMethod, input.paymentReference, input.hasSlip)) return 'payment_reference_required';
  // Owner decision D3: a transfer is recorded with its slip. Claims approved before the slip
  // existed are paid under the same rule, so nothing here reads the claim's age.
  if (reimbursementPaymentSlipRequired(input.paymentMethod) && !input.hasSlip) return 'payment_slip_required';
  return null;
}

/**
 * Whether a request repeats an already recorded payment (spec §12.7). One list of facts for the
 * shortcut before the payment lock and the check under it: a replay that differs in any of them,
 * the slip and the account included, is a conflict and never a success.
 *
 * The account is compared as the payer stated it: the claim's account version the transfer was
 * confirmed into, or the token of the default a legacy claim's payer confirmed. The recorded side
 * comes from `readRecordedPaymentPayout`, the requested side from `planPaymentPayout`.
 */
export function isSamePaymentRequest(
  recorded: {
    paidAmount: unknown; currency: string; paymentMethod: string; paidAt: Date;
    paymentReference?: string | null; bankAccountId?: string | null; slipAttachmentId?: string | null;
    payoutDestinationVersion?: number | null; payoutDefaultToken?: string | null;
  },
  requested: {
    paidAmount: string; currency: string; paymentMethod: string; paidAt: Date;
    paymentReference?: string; bankAccountId?: string; slipAttachmentId?: string;
    payoutDestinationVersion?: number; payoutDefaultToken?: string;
  },
): boolean {
  const same = (left?: string | number | null, right?: string | number | null) => (left ?? undefined) === (right ?? undefined);
  return d(String(recorded.paidAmount)).eq(d(requested.paidAmount))
    && recorded.currency === requested.currency
    && recorded.paymentMethod === requested.paymentMethod
    && recorded.paidAt.getTime() === requested.paidAt.getTime()
    && same(recorded.paymentReference, requested.paymentReference)
    && same(recorded.bankAccountId, requested.bankAccountId)
    && same(recorded.slipAttachmentId, requested.slipAttachmentId)
    && same(recorded.payoutDestinationVersion, requested.payoutDestinationVersion)
    && same(recorded.payoutDefaultToken, requested.payoutDefaultToken);
}

export function validatePaymentReference(method: ReimbursementPaymentMethod, reference?: string, hasSlip = false): boolean {
  return !reimbursementPaymentReferenceRequired(method, hasSlip) || !!reference?.trim();
}

// ---- Payment totals ----

/** Satang policy (FIN-01): the stored outstanding is the figure the UI prints, so sub-satang
 * residue on a legacy 4dp claim reads and stores as 0.00 instead of an unpayable 0.0042. */
export function computeOutstanding(approvedAmount: string, paymentTotal: string): string {
  const outstanding = Decimal.max(d(approvedAmount).sub(d(paymentTotal)), 0);
  return normalizeReimbursementAmount(outstanding.toFixed(4));
}

export function computePaymentStatus(approvedAmount: string, paymentTotal: string): 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' {
  const total = d(paymentTotal);
  if (total.lte(0)) return 'UNPAID';
  // Half a satang forgives only sub-satang residue — a real 0.01 shortfall stays PARTIALLY_PAID.
  if (d(approvedAmount).sub(total).lt(SETTLE_EPSILON)) return 'PAID';
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
  lines?: readonly { lineNo: number; attachmentId?: string | null; linkedExpenseId?: string | null; attachmentChecksum?: string }[];
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
      || (!!line.attachmentChecksum && candidate.attachmentChecksum === line.attachmentChecksum)
      || (!!line.linkedExpenseId && candidate.linkedExpenseId === line.linkedExpenseId));
    if (!other) continue;
    score += 80; // Strong evidence blocks submit regardless of requester, amount or date.
    if (match.sharedLineNo === undefined) {
      match.sharedLineNo = line.lineNo;
      if (line.attachmentId && (other.attachmentId === line.attachmentId || (!!line.attachmentChecksum && other.attachmentChecksum === line.attachmentChecksum))) {
        match.sharedType = 'ATTACHMENT';
        match.sharedAttachmentId = line.attachmentId;
      } else {
        match.sharedType = 'EXPENSE';
        match.sharedExpenseId = line.linkedExpenseId ?? undefined;
      }
    }
  }
  if (a.requesterUserId !== b.requesterUserId) return { ...match, score: Math.min(score, 100) };
  score += 10;
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

/**
 * Strips known-sensitive keys from a bounded payload before it leaves the module. The key list
 * applies to the top level, as before; an account number is stripped at any depth, because the
 * export and the event payloads nest objects and a full number must not ride out inside one
 * (`accountLast4` is a different key and stays).
 */
export function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_KEYS.test(key)) continue;
    out[key] = withoutAccountNumbers(value);
  }
  return out;
}

function withoutAccountNumbers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAccountNumbers);
  // Plain objects only: a Date or a decimal is a value, not a bag of keys.
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/accountnumber/i.test(key))
    .map(([key, item]) => [key, withoutAccountNumbers(item)]));
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

export type FrozenApprovalAuthority = 'ASSIGNED' | 'FALLBACK' | 'DENIED';

/**
 * A non-null assignment snapshot is the authority for that step. Role edits after submission do
 * not remove an active assignee; only when every frozen assignee has left/been disabled may the
 * recorded role/OWNER recovery rule take over. Undefined is an old step and keeps legacy routing.
 */
export function frozenApprovalAuthority(
  assignedUserIds: readonly string[] | undefined,
  activeUserIds: ReadonlySet<string>,
  actorUserId: string,
): FrozenApprovalAuthority {
  if (assignedUserIds === undefined) return 'FALLBACK';
  const activeAssigned = assignedUserIds.filter((userId) => activeUserIds.has(userId));
  if (activeAssigned.length === 0) return 'FALLBACK';
  return activeAssigned.includes(actorUserId) ? 'ASSIGNED' : 'DENIED';
}
