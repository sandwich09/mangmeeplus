import { reimbursementDuplicateReasonText, canOpenReimbursementPaymentSlip } from '@watchdog-bms/contracts';
import type {
  ReimbursementPayoutCorrection,
  ReimbursementPayoutCorrectionReason,
  ReimbursementPayoutViewer, RequestContext,
  ReimbursementPolicySummary,
  ReimbursementRequestSummary,
  ReimbursementRequestDetail,
  ReimbursementApprovalStepSummary,
  ReimbursementPaymentSummary,
  ReimbursementDuplicateCandidateSummary,
  ReimbursementLineSummary,
  ReimbursementClaimSignatureSummary,
  ReimbursementDocumentSignedVia,
  ReimbursementPayoutSummary,
  ReimbursementPayoutVersionSummary,
  ReimbursementSignedCopySummary,
} from '@watchdog-bms/contracts';
import type {
  ReimbursementPolicyRecord,
  ReimbursementRequestRecord,
  ReimbursementApprovalStepRecord,
  ReimbursementPaymentRecord,
  ReimbursementDuplicateCandidateRecord,
  ReimbursementLineRecord,
  ReimbursementClaimSignatureRecord,
} from '../../domain/models/reimbursement.model';
import {
  claimDuplicateBlocksPayment, claimDuplicateReasons, claimDuplicateStatus, claimSignatureAckHash, computeReceiptRequirement, currentDesk, duplicateBlocksPayment,
  payoutCorrectionAnswer, payoutCorrectionAnsweredBy, payoutCorrectionPhase, payoutCorrectionRoundStart,
} from '../../domain/logic/reimbursement.logic';
import { claimFormLayout, documentSignedVia } from '../../domain/logic/claim-form.logic';
import { effectivePolicy, effectivePolicyForRequest, type EffectivePolicy } from '../../domain/reimbursement.constants';
import { assertCanReadRequestOrAssignment, mayCancelReimbursement, mayDeleteReimbursementDraft } from '../use-cases/reimbursement-request.use-case';
import { ForbiddenException } from '@nestjs/common';
import type { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import type { ClaimPayoutRecord, ClaimPayoutVersionRecord, PaymentPayoutDestinationRecord } from '../../infrastructure/reimbursement-payout';
import { hasPayoutSnapshot } from '../../domain/logic/payout-destination.logic';
import { maskedPayoutHolderFacts } from '../../infrastructure/reimbursement-payout';
import type { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';

const iso = (d?: Date): string | undefined => (d ? d.toISOString() : undefined);

export function toPolicySummary(p: ReimbursementPolicyRecord): ReimbursementPolicySummary {
  return {
    id: p.id,
    companyId: p.companyId,
    branchId: p.branchId,
    currency: p.currency,
    approvalThresholdAmount: p.approvalRequiredFromAmount,
    approvalRequiredFromAmount: p.approvalRequiredFromAmount,
    approverMode: p.approverMode,
    defaultApproverUserId: p.defaultApproverUserId,
    defaultApproverRole: p.defaultApproverRole,
    defaultApproverRoles: p.defaultApproverRoles,
    allowSelfApproval: p.allowSelfApproval,
    requireReceipt: p.requireReceipt,
    allowMissingReceiptWithReason: p.allowMissingReceiptWithReason,
    duplicatePolicy: p.duplicatePolicy,
    financeReviewRequired: p.financeReviewRequired,
    slaHours: p.slaHours,
    status: p.status,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export function toRequestSummary(
  r: ReimbursementRequestRecord,
  // `approverNames` is what turns a PENDING_APPROVAL desk from the pool label into named
  // people; a caller that has not loaded the names simply gets the pool.
  options: { allowMissingReceiptWithReason?: boolean; approverNames?: Record<string, string>; currentPolicy?: EffectivePolicy; hasAcknowledgedPaperCopy?: boolean } = {},
): ReimbursementRequestSummary {
  // A claim sent back from the pay step for its payout destination (payout spec §14): whom it waits for.
  const correctionPhase = payoutCorrectionPhase(r);
  const correctionAnswer = payoutCorrectionAnswer(r);
  const answeredBy = payoutCorrectionAnsweredBy(r);
  const desk = currentDesk({
    status: r.status,
    financeReviewStatus: r.financeReviewStatus,
    steps: r.approvalSteps,
    names: options.approverNames,
    cancellationPending: !!r.cancellationPendingAt,
    payoutCorrectionPhase: correctionPhase,
  });
  return {
    id: r.id,
    companyId: r.companyId,
    branchId: r.branchId,
    requestNo: r.requestNo,
    requesterUserId: r.requesterUserId,
    requesterDisplayNameSnapshot: r.requesterDisplayNameSnapshot,
    title: r.title,
    reason: r.reason,
    categoryKey: r.categoryKey,
    categoryLabelSnapshot: r.categoryLabelSnapshot,
    amount: r.amount,
    currency: r.currency,
    incurredDate: r.incurredDate.toISOString(),
    status: r.status,
    rejectionReason: r.rejectionReason,
    ...(r.claimSignatures ? { documentSignedVia: documentSignedVia(r, options.hasAcknowledgedPaperCopy ?? false) } : {}),
    ...(desk ? { currentDesk: desk } : {}),
    // A cancelled claim keeps the intent it was cancelled with; only one still on its way is pending.
    ...(r.cancellationPendingAt && r.status !== 'CANCELLED' && r.status !== 'VOIDED' ? { cancellationPending: true as const } : {}),
    financeReviewStatus: r.financeReviewStatus,
    paymentStatus: r.paymentStatus,
    // With the claim's own candidates where they were loaded: a candidate still open is a possible
    // duplicate whatever the column says once the claim's expense records exist (`claimDuplicateStatus`).
    duplicateStatus: claimDuplicateStatus(r.duplicateStatus, r.duplicateCandidates),
    duplicateReasons: claimDuplicateReasons(r),
    ...(options.currentPolicy ? { hasDuplicateBlocker: claimDuplicateBlocksPayment(r, options.currentPolicy) } : {}),
    receiptRequirementStatus: r.receiptRequirementStatus,
    ...(options.allowMissingReceiptWithReason !== undefined
      ? { allowMissingReceiptWithReason: options.allowMissingReceiptWithReason }
      : {}),
    postingStatus: r.postingStatus,
    // The method only: no list or queue row carries an account. On a sent claim it is the method
    // of its own snapshot; a legacy claim has none, whatever a draft once chose.
    ...(r.payoutMethod && (r.status === 'DRAFT' || hasPayoutSnapshot(r)) ? { payoutMethod: r.payoutMethod } : {}),
    ...(correctionPhase && { payoutCorrectionPhase: correctionPhase }),
    // Once its requester has answered: what was given, against what the round began with. With the method
    // above, it is what the words of a round are chosen from (payout spec §14.2).
    ...(correctionAnswer && { payoutCorrectionAnswer: correctionAnswer }),
    // And who gave it: the requester, or someone on their behalf, named where the names were loaded. No
    // sentence says the requester did what someone else did for them.
    ...(answeredBy && { payoutCorrectionAnsweredBy: {
      byUserId: answeredBy.byUserId,
      ...(options.approverNames?.[answeredBy.byUserId] && { byName: options.approverNames[answeredBy.byUserId] }),
      ...(answeredBy.onBehalf && { onBehalf: true as const }),
    } }),
    paymentTotalAmount: r.paymentTotalAmount,
    outstandingAmount: r.outstandingAmount,
    lineCount: r.lineCount ?? r.lines?.length ?? 0,
    submittedAt: iso(r.submittedAt),
    approvedAt: iso(r.approvedAt),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toStepSummary(s: ReimbursementApprovalStepRecord, names: Record<string, string> = {}): ReimbursementApprovalStepSummary {
  return {
    id: s.id,
    sequenceNo: s.sequenceNo,
    approverUserId: s.approverUserId,
    approverName: s.approverUserId ? names[s.approverUserId] : undefined,
    decidedByName: s.decisionByUserId ? names[s.decisionByUserId] : undefined,
    approverRoleSnapshot: s.approverRoleSnapshot,
    status: s.status,
    assignedAt: s.assignedAt.toISOString(),
    decidedAt: iso(s.decidedAt),
    decisionByUserId: s.decisionByUserId,
    comment: s.comment,
    rejectionReason: s.rejectionReason,
    invalidatedAt: iso(s.invalidatedAt),
    invalidatedReason: s.invalidatedReason,
  };
}

/** A payment's slips as the repository lists them: per payment id, oldest first. */
export type PaymentSlipRows = Record<string, { attachmentId: string; attachedAt: Date }[]>;

export function toPaymentSummary(
  p: ReimbursementPaymentRecord,
  names: Record<string, string> = {},
  slips: PaymentSlipRows[string] = [],
  // Default deny: a slip's file id goes only to a caller the slip endpoint would serve.
  viewerCanOpenSlips = false,
  // The masked account this payment was confirmed into, where the caller loaded it.
  payoutDestination?: PaymentPayoutDestinationRecord,
): ReimbursementPaymentSummary {
  return {
    id: p.id,
    paidByUserId: p.paidByUserId,
    paidByName: names[p.paidByUserId],
    paymentNo: p.paymentNo,
    paidAmount: p.paidAmount,
    currency: p.currency,
    paymentMethod: p.paymentMethod,
    paidAt: p.paidAt.toISOString(),
    paymentReference: p.paymentReference,
    bankAccountId: p.bankAccountId,
    sourcePaymentRef: p.sourcePaymentRef,
    status: p.status,
    voidedAt: iso(p.voidedAt),
    voidReason: p.voidReason,
    postingStatus: p.postingStatus,
    // From the slip links alone, so every reader of a payment answers "is there a slip" the same way.
    slipCount: slips.length,
    slips: viewerCanOpenSlips ? slips.map((slip) => ({ attachmentId: slip.attachmentId, attachedAt: slip.attachedAt.toISOString() })) : [],
    viewerCanOpenSlips,
    // What the payer confirmed, the same for every reader: the masked account, when, and why the
    // method is not the one asked for. Absent keys mean nothing of the kind was recorded.
    ...(payoutDestination && { payoutDestination }),
    ...(p.payoutConfirmedAt && { payoutConfirmedAt: p.payoutConfirmedAt.toISOString() }),
    ...(p.methodMismatchReason && { methodMismatchReason: p.methodMismatchReason }),
  };
}

export function toDuplicateSummary(d: ReimbursementDuplicateCandidateRecord): ReimbursementDuplicateCandidateSummary {
  return {
    id: d.id,
    candidateType: d.candidateType,
    candidateRequestId: d.candidateRequestId,
    candidateExpenseId: d.candidateExpenseId,
    score: d.score,
    status: d.status,
    reason: d.reason,
  };
}

export function toLineSummary(l: ReimbursementLineRecord, attachmentFileName?: string): ReimbursementLineSummary {
  return {
    id: l.id,
    lineNo: l.lineNo,
    incurredDate: l.incurredDate.toISOString(),
    description: l.description,
    purpose: l.purpose,
    categoryKey: l.categoryKey,
    categoryLabelSnapshot: l.categoryLabelSnapshot,
    amount: l.amount,
    attachmentId: l.attachmentId,
    attachmentFileName,
    linkedExpenseId: l.linkedExpenseId,
    sourceExpenseSnapshot: l.sourceExpenseSnapshot,
  };
}

/** Every user id whose display name the drawer and the claim form need — one batch lookup, no N+1. */
export function detailUserIds(r: ReimbursementRequestRecord): string[] {
  return [
    r.createdByUserId,
    r.financeReviewedByUserId,
    // Whoever sent the claim back from the pay step, and whoever answered it: the round's notes name them.
    r.payoutCorrectionRequestedByUserId,
    payoutCorrectionAnsweredBy(r)?.byUserId,
    // The frozen assignees too: they are the people the timeline's "กำลังรอ" row names.
    ...(r.approvalSteps ?? []).flatMap((s) => [s.approverUserId, s.decisionByUserId, ...(s.assignedApproverUserIds ?? [])]),
    ...(r.payments ?? []).map((p) => p.paidByUserId),
    ...(r.claimSignatures ?? []).map((s) => s.signedByUserId),
  ].filter((id): id is string => !!id);
}

export function toClaimSignatureSummary(
  s: ReimbursementClaimSignatureRecord,
  names: Record<string, string> = {},
): ReimbursementClaimSignatureSummary {
  return {
    role: s.role,
    signedByUserId: s.signedByUserId,
    signedByName: names[s.signedByUserId],
    signedAt: s.signedAt.toISOString(),
  };
}

export function toSignedCopySummaries(
  rows: { attachmentId: string; fileName: string; uploadedAt: Date; acknowledgedAt?: string; acknowledgedByUserId?: string; beforePayoutCorrection?: true }[],
  names: Record<string, string> = {},
): ReimbursementSignedCopySummary[] {
  return rows.map((row) => {
    const acknowledgedByName = row.acknowledgedAt && row.acknowledgedByUserId ? names[row.acknowledgedByUserId] : undefined;
    return {
      attachmentId: row.attachmentId, fileName: row.fileName, uploadedAt: row.uploadedAt.toISOString(),
      ...(row.acknowledgedAt && { acknowledgedAt: row.acknowledgedAt }),
      ...(acknowledgedByName && { acknowledgedByName }),
      ...(row.beforePayoutCorrection && { beforePayoutCorrection: true as const }),
    };
  });
}

/**
 * The round a claim is in, as every detail carries it: whom it waits for, who sent it back and why,
 * and what it was approved with before, for the comparison its approvers are shown. Undefined: the
 * claim is in no round. `previousAccount` is the masked account of the version the round started from.
 */
export function toPayoutCorrection(
  r: ReimbursementRequestRecord,
  names: Record<string, string> = {},
  previousAccount?: PaymentPayoutDestinationRecord,
): ReimbursementPayoutCorrection | undefined {
  const phase = payoutCorrectionPhase(r);
  if (!phase || !r.payoutCorrectionRequestedAt) return undefined;
  const requestedByName = r.payoutCorrectionRequestedByUserId ? names[r.payoutCorrectionRequestedByUserId] : undefined;
  const approved = payoutCorrectionRoundStart(r);
  const answer = payoutCorrectionAnswer(r);
  return {
    phase,
    requestedAt: r.payoutCorrectionRequestedAt.toISOString(),
    ...(r.payoutCorrectionRequestedByUserId && { requestedByUserId: r.payoutCorrectionRequestedByUserId }),
    ...(requestedByName && { requestedByName }),
    reasonCode: (r.payoutCorrectionReasonCode ?? 'OTHER') as ReimbursementPayoutCorrectionReason,
    ...(r.payoutCorrectionNote && { note: r.payoutCorrectionNote }),
    ...(r.payoutCorrectionSubmittedAt && { submittedAt: r.payoutCorrectionSubmittedAt.toISOString() }),
    ...(approved?.payoutMethod && { previous: {
      payoutMethod: approved.payoutMethod,
      ...(previousAccount && {
        payoutKind: previousAccount.payoutKind, ...(previousAccount.bankName && { bankName: previousAccount.bankName }),
        accountName: previousAccount.accountName, accountLast4: previousAccount.accountLast4, version: previousAccount.version,
        ...maskedPayoutHolderFacts(previousAccount),
      }),
    } }),
    ...(approved?.at && { previouslyApprovedAt: approved.at }),
    // Only once the requester has answered: whether what was given is the very destination the claim had.
    // Decided when the answer was taken and read from the round's log, like every other word of the round.
    ...(phase === 'AWAITING_APPROVAL' && { sameAsPrevious: answer === 'SAME_ACCOUNT' || answer === 'SAME_CASH' }),
  };
}

/** The masked payout block of a detail: bank, account name and last 4 digits, the same for every viewer. */
export function toPayoutSummary(payout: ClaimPayoutRecord | undefined, names: Record<string, string> = {}): ReimbursementPayoutSummary | undefined {
  if (!payout) return undefined;
  const { verifiedAt, ...shown } = payout;
  return {
    ...shown,
    // The id stays also when the name cannot be resolved, so the screen still says someone else entered it.
    ...(payout.enteredByUserId && names[payout.enteredByUserId] && { enteredByName: names[payout.enteredByUserId] }),
    ...(verifiedAt && {
      verifiedAt: verifiedAt.toISOString(),
      ...(payout.verifiedByUserId && names[payout.verifiedByUserId] && { verifiedByName: names[payout.verifiedByUserId] }),
    }),
  };
}

/** One row of the claim's account history: the stored version with the two people it names resolved. */
export function toPayoutVersionSummary(version: ClaimPayoutVersionRecord, names: Record<string, string> = {}): ReimbursementPayoutVersionSummary {
  const { frozenAt, verifiedAt, ...shown } = version;
  return {
    ...shown,
    frozenAt: frozenAt.toISOString(),
    ...(version.enteredByUserId && names[version.enteredByUserId] && { enteredByName: names[version.enteredByUserId] }),
    ...(verifiedAt && {
      verifiedAt: verifiedAt.toISOString(),
      ...(version.verifiedByUserId && names[version.verifiedByUserId] && { verifiedByName: names[version.verifiedByUserId] }),
    }),
  };
}

export function toRequestDetail(
  r: ReimbursementRequestRecord,
  primaryAttachmentFileName?: string,
  lineAttachmentFileNames: Record<string, string> = {},
  displayNames: Record<string, string> = {},
  // Read-path extras: they need queries the action paths do not run, and the
  // drawer re-reads GET detail after every action anyway.
  extras: {
    signedCopies?: ReimbursementSignedCopySummary[];
    claimSignatureAckHash?: string;
    documentSignedVia?: ReimbursementDocumentSignedVia;
    financeReviewRequired?: boolean;
    allowMissingReceiptWithReason?: boolean;
    duplicateBlocksPayment?: boolean;
    duplicateReasons?: import('@watchdog-bms/contracts').ReimbursementDuplicateReason[];
    paymentSlips?: PaymentSlipRows;
    viewerCanOpenSlips?: boolean;
    payout?: ReimbursementPayoutSummary;
    /** The masked accounts the claim's payments were confirmed into, by account version. */
    paymentDestinations?: Record<number, PaymentPayoutDestinationRecord>;
    payoutCorrection?: ReimbursementPayoutCorrection;
  } = {},
): ReimbursementRequestDetail {
  return {
    ...toRequestSummary(r, {
      allowMissingReceiptWithReason: extras.allowMissingReceiptWithReason,
      approverNames: displayNames,
    }),
    ...(r.hasVoidedProjections && { hasVoidedProjections: true as const }),
    lines: (r.lines ?? []).map((l) => toLineSummary(l, l.attachmentId ? lineAttachmentFileNames[l.attachmentId] : undefined)),
    createdByName: displayNames[r.createdByUserId],
    currentApproverUserId: r.currentApproverUserId,
    currentApprovalStepId: r.currentApprovalStepId,
    rejectionReason: r.rejectionReason,
    financeReviewedByUserId: r.financeReviewedByUserId,
    financeReviewedByName: r.financeReviewedByUserId ? displayNames[r.financeReviewedByUserId] : undefined,
    financeReviewedAt: iso(r.financeReviewedAt),
    financeReviewNote: r.financeReviewNote,
    linkedExpenseId: r.linkedExpenseId,
    primaryAttachmentId: r.primaryAttachmentId,
    primaryAttachmentFileName,
    approvalSnapshotHash: r.approvalSnapshotHash,
    claimSignatureAckHash: extras.claimSignatureAckHash,
    // Only when the signature rows were loaded: an action response without them must not guess.
    claimFormLayout: r.claimSignatures && claimFormLayout(r.claimSignatures),
    documentSignedVia: extras.documentSignedVia,
    financeReviewRequired: extras.financeReviewRequired,
    missingReceiptReason: r.missingReceiptReason,
    ...(extras.payout && { payout: extras.payout }),
    ...(extras.payoutCorrection && { payoutCorrection: extras.payoutCorrection }),
    // In the order they were assigned: a correction round's steps carry the sequence number of the
    // approval they replace, so the number alone would not say which came first.
    approvalSteps: [...(r.approvalSteps ?? [])]
      .sort((a, b) => a.sequenceNo - b.sequenceNo || a.assignedAt.getTime() - b.assignedAt.getTime())
      .map((s) => toStepSummary(s, displayNames)),
    payments: (r.payments ?? []).map((p) => toPaymentSummary(
      p, displayNames, extras.paymentSlips?.[p.id], extras.viewerCanOpenSlips,
      p.payoutDestinationVersion === undefined ? undefined : extras.paymentDestinations?.[p.payoutDestinationVersion],
    )),
    duplicateCandidates: (r.duplicateCandidates ?? []).map(toDuplicateSummary),
    duplicateBlocksPayment: extras.duplicateBlocksPayment,
    duplicateReasons: extras.duplicateReasons,
    signatures: (r.claimSignatures ?? []).map((s) => toClaimSignatureSummary(s, displayNames)),
    signedCopies: extras.signedCopies ?? [],
  };
}

/**
 * Detail shape shared by EVERY path that returns a claim detail: line receipts resolve to
 * file names and approver/reviewer/payer/signer ids resolve to display names (one batched
 * lookup — the drawer must never render a cuid). The decision and payment endpoints keep
 * their response in the drawer on purpose (a frozen assignee may lose read permission the
 * moment they decide), so their responses must be as complete as a GET. Lives in the mapper
 * because the request, approval, and finance use-cases all need it and already import here.
 *
 * `viewer` is whoever the answer goes to. Each payment tells them whether they may open its slips
 * (the verdict of the one rule the slip endpoint enforces) and names the slip files only if they
 * may; everyone else gets the count. Required, so no route can return a detail without deciding it.
 * `approvalActions` is the viewer's authority over a pending step, where the route resolved it.
 */
export async function detailWithFileNames(
  repo: PrismaReimbursementRepository,
  evidence: ReimbursementEvidenceService,
  companyId: string,
  req: ReimbursementRequestRecord,
  viewer: ReimbursementPayoutViewer & { scopes?: RequestContext['scopes'] },
  approvalActions?: { canApprove: boolean; canReject: boolean } | null,
): Promise<ReimbursementRequestDetail> {
  const signedCopiesRead = repo.listSignedClaimFormCopies(companyId, req.id);
  const paymentIds = (req.payments ?? []).map((payment) => payment.id);
  // The claim's own snapshot only. A legacy claim has none, and nothing here can reach a member's
  // default account: a draft that still follows the default gets its preview on the detail read alone.
  const payoutRead = req.payoutMethod ? repo.findClaimPayout(req) : Promise.resolve(undefined);
  // The account each payment was confirmed into. Only a payment recorded with one costs a query.
  const paidInto = (req.payments ?? []).flatMap((payment) => payment.payoutDestinationVersion ?? []);
  // In a correction round: the account the claim was approved with, to set beside the one it has now.
  const roundStart = payoutCorrectionPhase(req) ? payoutCorrectionRoundStart(req) : undefined;
  const approvedVersion = roundStart?.payoutVersion;
  const [primaryFileName, lineFileNames, displayNames, signedCopies, policy, paymentSlips, payout, paymentDestinations, approvedAccounts] = await Promise.all([
    evidence.getAttachmentFileName(companyId, req.primaryAttachmentId),
    evidence.getAttachmentFileNames(companyId, (req.lines ?? []).map((line) => line.attachmentId ?? '')),
    // Whoever declared a paper-signed scan, typed the account or attested it is named in the same batch.
    Promise.all([signedCopiesRead, payoutRead]).then(([copies, claimPayout]) => repo.getUserDisplayNames(companyId, [
      ...detailUserIds(req), ...copies.map((copy) => copy.acknowledgedByUserId ?? ''),
      claimPayout?.enteredByUserId ?? '', claimPayout?.verifiedByUserId ?? '',
    ])),
    signedCopiesRead,
    repo.findPolicy(companyId, null).then(effectivePolicy),
    // Only a claim with a payment can have a slip, so an unpaid claim costs no query.
    paymentIds.length > 0 ? repo.listPaymentSlips(companyId, paymentIds) : undefined,
    payoutRead,
    paidInto.length > 0 ? repo.listPaymentPayoutDestinations(companyId, req.id, paidInto) : undefined,
    approvedVersion === undefined ? undefined : repo.listPaymentPayoutDestinations(companyId, req.id, [approvedVersion]),
  ]);
  const requestPolicy = req.status === 'DRAFT' ? policy : effectivePolicyForRequest(req, policy);
  const receiptRequirementStatus = req.status === 'DRAFT'
    ? computeReceiptRequirement({
        requireReceipt: requestPolicy.requireReceipt,
        allowMissingReceiptWithReason: requestPolicy.allowMissingReceiptWithReason,
        lines: req.lines ?? [],
        missingReceiptReason: req.missingReceiptReason,
      }).status
    : req.receiptRequirementStatus;
  // The ack hash is the LIVE claim, not the submit-frozen approval hash: a signer
  // acknowledges what the form prints right now.
  const comparisons = repo.listClaimDuplicateComparisons ? await repo.listClaimDuplicateComparisons(companyId, req.id) : req.duplicateCandidates ?? [];
  const resolverNames = await repo.getUserDisplayNames(companyId, comparisons.flatMap(row => row.resolvedByUserId ? [row.resolvedByUserId] : []));
  const duplicateCandidates: ReimbursementDuplicateCandidateSummary[] = await Promise.all(comparisons.map(async candidate => {
    const summary = toDuplicateSummary(candidate);
    const target = candidate.candidateRequestId ? await repo.findRequestById(companyId, candidate.candidateRequestId, true) : null;
    const readable = target && await assertCanReadRequestOrAssignment({ ...viewer, companyId } as RequestContext, target, repo)
      .then(() => true, error => { if (error instanceof ForbiddenException) return false; throw error; });
    const resolution = { resolvedAt: candidate.resolvedAt?.toISOString(), resolvedByName: candidate.resolvedByUserId ? resolverNames[candidate.resolvedByUserId] ?? 'ผู้ตรวจรายการซ้ำ' : undefined };
    const facts = target ? { ...resolution, documentNumber: target.requestNo, requesterOrPayee: target.requesterDisplayNameSnapshot,
      amount: target.amount, currency: target.currency, date: target.incurredDate.toISOString(), canOpen: Boolean(readable) } : { ...resolution, canOpen: false };
    if (readable) return { ...summary, ...facts };
    return { ...facts, id: summary.id, candidateType: summary.candidateType, score: summary.score, status: summary.status, reason: reimbursementDuplicateReasonText([summary.candidateType]) };
  }));
  if (repo.listClaimDuplicateExpenseTargets) {
    for (const comparison of await repo.listClaimDuplicateExpenseTargets(companyId, req.id)) {
      const canOpen = await evidence.canReadExpense({ ...viewer, companyId } as RequestContext, comparison.candidateExpenseId);
      duplicateCandidates.push({ ...comparison, candidateExpenseId: canOpen ? comparison.candidateExpenseId : undefined, canOpen });
    }
  }
  return { ...toRequestDetail({ ...req, receiptRequirementStatus }, primaryFileName, lineFileNames, displayNames, {
    signedCopies: toSignedCopySummaries(signedCopies, displayNames),
    claimSignatureAckHash: claimSignatureAckHash(req),
    documentSignedVia: req.claimSignatures && documentSignedVia(req, signedCopies.some((copy) => copy.acknowledged)),
    // The same value the approval and payment paths act on.
    financeReviewRequired: requestPolicy.financeReviewRequired,
    allowMissingReceiptWithReason: requestPolicy.allowMissingReceiptWithReason,
    // The payment gate's own test, by the gate's own function: the page marks the claim exactly when
    // recording its payment would answer `duplicate_unresolved`.
    duplicateBlocksPayment: duplicateBlocksPayment(requestPolicy.duplicatePolicy,
      (req.duplicateCandidates ?? []).filter((candidate) => candidate.status === 'OPEN').length, (req.possibleDuplicateExpenseCount ?? 0) + (req.duplicateConfirmationPendingCount ?? 0), req.confirmedDuplicateExpenseCount),
    duplicateReasons: claimDuplicateReasons(req),
    paymentSlips,
    viewerCanOpenSlips: canOpenReimbursementPaymentSlip(
      { userId: viewer.userId, permissions: viewer.permissions },
      { requesterUserId: req.requesterUserId, submittedAt: req.submittedAt, approvalSteps: req.approvalSteps, approvalActions },
    ),
    payout: toPayoutSummary(payout, displayNames),
    paymentDestinations,
    payoutCorrection: toPayoutCorrection(req, displayNames, approvedVersion === undefined ? undefined : approvedAccounts?.[approvedVersion]),
  }), duplicateCandidates, viewerCanCancel: !req.cancellationPendingAt && (mayCancelReimbursement({ ...viewer, companyId } as RequestContext, req) || mayDeleteReimbursementDraft({ ...viewer, companyId } as RequestContext, req)) };
}
