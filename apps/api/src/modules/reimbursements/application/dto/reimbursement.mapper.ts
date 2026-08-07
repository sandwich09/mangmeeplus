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

const iso = (d?: Date): string | undefined => (d ? d.toISOString() : undefined);

export function toPolicySummary(p: ReimbursementPolicyRecord): ReimbursementPolicySummary {
  return {
    id: p.id,
    companyId: p.companyId,
    branchId: p.branchId,
    currency: p.currency,
    approvalThresholdAmount: p.approvalThresholdAmount,
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

export function toRequestSummary(r: ReimbursementRequestRecord): ReimbursementRequestSummary {
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
    financeReviewStatus: r.financeReviewStatus,
    paymentStatus: r.paymentStatus,
    duplicateStatus: r.duplicateStatus,
    receiptRequirementStatus: r.receiptRequirementStatus,
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
    ...(r.approvalSteps ?? []).flatMap((s) => [s.approverUserId, s.decisionByUserId]),
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
  extras: { signedCopies?: ReimbursementSignedCopySummary[]; claimSignatureAckHash?: string } = {},
): ReimbursementRequestDetail {
  return {
    ...toRequestSummary(r),
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
