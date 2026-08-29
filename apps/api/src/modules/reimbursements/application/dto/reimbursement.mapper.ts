import type {
  ReimbursementPolicySummary,
  ReimbursementRequestSummary,
  ReimbursementRequestDetail,
  ReimbursementApprovalStepSummary,
  ReimbursementPaymentSummary,
  ReimbursementDuplicateCandidateSummary,
  ReimbursementLineSummary,
  ReimbursementClaimSignatureSummary,
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
import { claimSignatureAckHash, computeReceiptRequirement, currentDesk } from '../../domain/logic/reimbursement.logic';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import type { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
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
  options: { allowMissingReceiptWithReason?: boolean; approverNames?: Record<string, string> } = {},
): ReimbursementRequestSummary {
  const desk = currentDesk({
    status: r.status,
    financeReviewStatus: r.financeReviewStatus,
    steps: r.approvalSteps,
    names: options.approverNames,
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
    ...(desk ? { currentDesk: desk } : {}),
    financeReviewStatus: r.financeReviewStatus,
    paymentStatus: r.paymentStatus,
    duplicateStatus: r.duplicateStatus,
    receiptRequirementStatus: r.receiptRequirementStatus,
    ...(options.allowMissingReceiptWithReason !== undefined
      ? { allowMissingReceiptWithReason: options.allowMissingReceiptWithReason }
      : {}),
    postingStatus: r.postingStatus,
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

export function toPaymentSummary(p: ReimbursementPaymentRecord, names: Record<string, string> = {}): ReimbursementPaymentSummary {
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
  };
}

/** Every user id whose display name the drawer and the claim form need — one batch lookup, no N+1. */
export function detailUserIds(r: ReimbursementRequestRecord): string[] {
  return [
    r.financeReviewedByUserId,
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
  rows: { attachmentId: string; fileName: string; uploadedAt: Date }[],
): ReimbursementSignedCopySummary[] {
  return rows.map((row) => ({ attachmentId: row.attachmentId, fileName: row.fileName, uploadedAt: row.uploadedAt.toISOString() }));
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
    allowMissingReceiptWithReason?: boolean;
  } = {},
): ReimbursementRequestDetail {
  return {
    ...toRequestSummary(r, {
      allowMissingReceiptWithReason: extras.allowMissingReceiptWithReason,
      approverNames: displayNames,
    }),
    lines: (r.lines ?? []).map((l) => toLineSummary(l, l.attachmentId ? lineAttachmentFileNames[l.attachmentId] : undefined)),
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
    missingReceiptReason: r.missingReceiptReason,
    approvalSteps: (r.approvalSteps ?? []).map((s) => toStepSummary(s, displayNames)),
    payments: (r.payments ?? []).map((p) => toPaymentSummary(p, displayNames)),
    duplicateCandidates: (r.duplicateCandidates ?? []).map(toDuplicateSummary),
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
 */
export async function detailWithFileNames(
  repo: PrismaReimbursementRepository,
  evidence: ReimbursementEvidenceService,
  companyId: string,
  req: ReimbursementRequestRecord,
): Promise<ReimbursementRequestDetail> {
  const [primaryFileName, lineFileNames, displayNames, signedCopies, policy] = await Promise.all([
    evidence.getAttachmentFileName(companyId, req.primaryAttachmentId),
    evidence.getAttachmentFileNames(companyId, (req.lines ?? []).map((line) => line.attachmentId ?? '')),
    repo.getUserDisplayNames(companyId, detailUserIds(req)),
    repo.listSignedClaimFormCopies(companyId, req.id),
    repo.findPolicy(companyId, null).then(effectivePolicy),
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
  return toRequestDetail({ ...req, receiptRequirementStatus }, primaryFileName, lineFileNames, displayNames, {
    signedCopies: toSignedCopySummaries(signedCopies),
    claimSignatureAckHash: claimSignatureAckHash(req),
    allowMissingReceiptWithReason: requestPolicy.allowMissingReceiptWithReason,
  });
}
