import { Injectable, ForbiddenException, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type {
  RequestContext,
  CreateReimbursementRequestInput,
  UpdateReimbursementDraftInput,
  ListReimbursementsFilter,
  ReimbursementLineInput,
  ReimbursementRequestSummary,
  ReimbursementRequestDetail,
} from '@watchdog-bms/contracts';
import { REIMBURSEMENT_SEQUENCE_KEYS } from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { VoidExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type {
  ReimbursementDuplicateCandidateWriteData,
  ReimbursementLineRecord,
  ReimbursementLineWriteData,
  ReimbursementRequestRecord,
} from '../../domain/models/reimbursement.model';
import { toRequestSummary, toRequestDetail, detailUserIds, toSignedCopySummaries } from '../dto/reimbursement.mapper';
import { effectivePolicy } from '../../domain/reimbursement.constants';
import {
  validateRequestFields,
  validateLines,
  requiresApproval,
  computeReceiptRequirement,
  isLineEvidenced,
  computeSnapshotHash,
  canTransition,
  deriveHeaderFromLines,
  byLineNo,
  scoreDuplicate,
  normalizeReason,
  normalizeReimbursementAmount,
} from '../../domain/logic/reimbursement.logic';

async function loadPolicy(repo: PrismaReimbursementRepository, companyId: string) {
  return effectivePolicy(await repo.findPolicy(companyId, null));
}

function toLineWrites(lines: ReimbursementLineInput[]): ReimbursementLineWriteData[] {
  return byLineNo(lines).map((line) => ({
    lineNo: line.lineNo,
    incurredDate: new Date(line.incurredDate),
    description: line.description.trim(),
    purpose: line.purpose?.trim() || null,
    categoryKey: line.categoryKey,
    categoryLabelSnapshot: line.categoryLabel ?? null,
    amount: normalizeReimbursementAmount(line.amount),
    attachmentId: line.attachmentId ?? null,
    linkedExpenseId: line.linkedExpenseId ?? null,
  }));
}

/** Reimbursement numbers follow the Thai business month, independent of the host time zone. */
export function reimbursementPeriodKey(now: Date = new Date()): string {
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${bangkok.getUTCFullYear()}-${String(bangkok.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Detail shape shared by the read and submit paths: line receipts resolve to
 * file names and approver/reviewer/payer ids resolve to display names (one
 * batched lookup — the drawer must never render a cuid).
 */
async function detailWithFileNames(
  repo: PrismaReimbursementRepository,
  evidence: ReimbursementEvidenceService,
  companyId: string,
  req: ReimbursementRequestRecord,
): Promise<ReimbursementRequestDetail> {
  const [primaryFileName, lineFileNames, displayNames, signedCopies] = await Promise.all([
    evidence.getAttachmentFileName(companyId, req.primaryAttachmentId),
    evidence.getAttachmentFileNames(companyId, (req.lines ?? []).map((line) => line.attachmentId ?? '')),
    repo.getUserDisplayNames(companyId, detailUserIds(req)),
    repo.listSignedClaimFormCopies(companyId, req.id),
  ]);
  // The ack hash is the LIVE claim, not the submit-frozen approval hash: a signer
  // acknowledges what the form prints right now.
  return toRequestDetail(req, primaryFileName, lineFileNames, displayNames, {
    signedCopies: toSignedCopySummaries(signedCopies),
    claimSignatureAckHash: claimSignatureAckHash(req),
  });
}

@Injectable()
export class CreateReimbursementDraftUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, input: CreateReimbursementRequestInput): Promise<ReimbursementRequestSummary> {
    if (!ctx.permissions.includes('reimbursement.create')) throw new ForbiddenException('Missing permission: reimbursement.create');

    const errors = validateRequestFields(input);
    if (errors.length > 0) throw new BadRequestException(errors.join(','));
    await this.evidence.validate(ctx, ctx.userId, input.lines);

    const policy = await loadPolicy(this.repo, ctx.companyId);
    const displayName = await this.repo.getUserDisplayName(ctx.userId);
    const receipt = computeReceiptRequirement({
      requireReceipt: policy.requireReceipt,
      allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      lines: input.lines,
      missingReceiptReason: input.missingReceiptReason,
    });
    // Header amount/category/date are the rollup of the lines — never client input.
    const header = deriveHeaderFromLines(input.lines);

    const created = await this.repo.createRequest({
      companyId: ctx.companyId,
      branchId: input.branchId,
      requesterUserId: ctx.userId,
      requesterDisplayNameSnapshot: displayName,
      title: input.title,
      reason: input.reason,
      categoryKey: header.categoryKey,
      categoryLabelSnapshot: header.categoryLabelSnapshot,
      amount: header.amount,
      currency: input.currency ?? policy.currency,
      incurredDate: header.incurredDate,
      missingReceiptReason: input.missingReceiptReason,
      // Draft records the requirement status but does not block until submit.
      receiptRequirementStatus: receipt.status === 'REQUIRED' ? 'REQUIRED' : receipt.status,
      createdByUserId: ctx.userId,
      lines: toLineWrites(input.lines),
    });

    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.create',
      targetType: 'reimbursement_request', targetId: created.id, requestId: ctx.requestId,
      result: 'SUCCESS', riskLevel: 'LOW',
      metadataJson: { amount: created.amount, currency: created.currency, categoryKey: created.categoryKey, lineCount: input.lines.length },
    });
    return toRequestSummary(created);
  }
}

@Injectable()
export class UpdateReimbursementDraftUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string, input: UpdateReimbursementDraftInput): Promise<ReimbursementRequestSummary> {
    const req = await this.repo.findRequestById(ctx.companyId, id);
    if (!req) throw new NotFoundException('Reimbursement request not found');

    const isOwner = req.requesterUserId === ctx.userId;
    const canUpdate = (isOwner && ctx.permissions.includes('reimbursement.update_own_draft')) || ctx.permissions.includes('reimbursement.finance_review');
    if (!canUpdate) throw new ForbiddenException('Cannot update this reimbursement');
    if (req.status !== 'DRAFT') throw new UnprocessableEntityException('Only draft requests can be edited');

    const data: Record<string, unknown> = { updatedByUserId: ctx.userId };
    if (input.title !== undefined) data.title = input.title;
    if (input.reason !== undefined) data.reason = input.reason;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.missingReceiptReason !== undefined) data.missingReceiptReason = input.missingReceiptReason;

    // Lines are replaced wholesale; the header rollup follows them. The
    // repository compares the version read above under the same lock as submit.
    let lines: ReimbursementLineWriteData[] | undefined;
    if (input.lines !== undefined) {
      const errors = validateLines(input.lines);
      if (errors.length > 0) throw new BadRequestException(errors.join(','));
      await this.evidence.validate(ctx, req.requesterUserId, input.lines);
      const header = deriveHeaderFromLines(input.lines);
      data.amount = header.amount;
      data.categoryKey = header.categoryKey;
      data.categoryLabelSnapshot = header.categoryLabelSnapshot ?? null;
      data.incurredDate = header.incurredDate;
      data.outstandingAmount = header.amount;
      lines = toLineWrites(input.lines);
    }
    const updated = await this.repo.updateDraftRequest(ctx.companyId, id, req.updatedAt, data, lines);
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.update_draft',
      targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW',
    });
    return toRequestSummary(updated);
  }
}

@Injectable()
export class GetReimbursementDetailUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<ReimbursementRequestDetail> {
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    await assertCanReadRequest(ctx, req, this.repo);
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, req);
  }
}

@Injectable()
export class ListReimbursementsUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository) {}

  async execute(ctx: RequestContext, filter: ListReimbursementsFilter): Promise<{ items: ReimbursementRequestSummary[]; total: number; page: number; pageSize: number }> {
    const canReadAll = ctx.permissions.includes('reimbursement.read');
    const canReadOwn = ctx.permissions.includes('reimbursement.read_own');
    const canReadRelated = ctx.permissions.includes('reimbursement.read_related');
    if (!canReadAll && !canReadOwn && !canReadRelated) throw new ForbiddenException('Missing permission to read reimbursements');

    let requesterUserId: string | undefined;
    let relatedUserId: string | undefined;
    if (filter.scope === 'own') {
      requesterUserId = ctx.userId;
    } else if (filter.scope === 'related') {
      if (!canReadRelated) throw new ForbiddenException('Missing permission: reimbursement.read_related');
      relatedUserId = ctx.userId;
    } else if (canReadAll) {
      requesterUserId = filter.requesterUserId;
    } else if (canReadRelated) {
      relatedUserId = ctx.userId;
      requesterUserId = filter.requesterUserId;
    } else {
      requesterUserId = ctx.userId;
    }

    const rows = await this.repo.listRequests({
      companyId: ctx.companyId,
      requesterUserId,
      relatedUserId,
      scopes: ctx.scopes ?? {},
      status: filter.status,
      paymentStatus: filter.paymentStatus,
    });
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const pageSize = filter.pageSize && filter.pageSize > 0 ? Math.min(filter.pageSize, 100) : 20;
    const start = (page - 1) * pageSize;
    return {
      items: rows.slice(start, start + pageSize).map(toRequestSummary),
      total: rows.length,
      page,
      pageSize,
    };
  }
}

@Injectable()
export class SubmitReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<ReimbursementRequestDetail> {
    if (!ctx.permissions.includes('reimbursement.submit')) throw new ForbiddenException('Missing permission: reimbursement.submit');

    const req = await this.repo.findRequestById(ctx.companyId, id);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    if (req.requesterUserId !== ctx.userId && !ctx.permissions.includes('reimbursement.finance_review')) {
      throw new ForbiddenException('Only the requester can submit this request');
    }
    if (!canTransition(req.status, 'PENDING_APPROVAL')) throw new UnprocessableEntityException(`Cannot submit from status ${req.status}`);

    const lines = req.lines ?? [];
    const lineErrors = validateLines(lines);
    if (lineErrors.length > 0) throw new UnprocessableEntityException(lineErrors.join(','));
    await this.evidence.validate(ctx, req.requesterUserId, lines);

    const policy = await loadPolicy(this.repo, ctx.companyId);

    // Receipt gate at submit: every line evidenced, or one claim-level reason.
    const receipt = computeReceiptRequirement({
      requireReceipt: policy.requireReceipt,
      allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      lines,
      missingReceiptReason: req.missingReceiptReason,
    });
    if (receipt.error) throw new UnprocessableEntityException(receipt.error);
    // A receipt-less line is materialized into an employee-payable expense at อนุมัติจ่าย, and
    // that expense confirms only with an attachment or a missing-receipt reason. The claim's
    // waive policy does not travel to the expense, so a claim submitted with neither strands the
    // finance saga after its decision is already durable (BUG-7). Ask for the reason here, where
    // the claim is still a draft the requester can fix.
    if (!req.missingReceiptReason?.trim() && lines.some((line) => !isLineEvidenced(line))) {
      throw new BadRequestException('missing_receipt_reason_required');
    }

    // Double-claim guard: no receipt/expense may be claimed on two live claims.
    await this.assertEvidenceNotClaimedElsewhere(ctx.companyId, id, lines);

    // Duplicate detection (warn on submit; blocking only if policy = BLOCK_SUBMIT).
    const dupResult = await this.detectDuplicates(ctx.companyId, req);
    if (dupResult.blocking && policy.duplicatePolicy === 'BLOCK_SUBMIT') {
      throw new UnprocessableEntityException('duplicate_unresolved');
    }

    const now = new Date();
    const snapshotHash = computeSnapshotHash({
      amount: req.amount,
      currency: req.currency,
      categoryKey: req.categoryKey,
      incurredDate: req.incurredDate.toISOString(),
      reason: req.reason,
      primaryAttachmentId: req.primaryAttachmentId,
      lines,
    });

    const periodKey = reimbursementPeriodKey(now);

    // Assign approval step (role-based; MANAGER_ROLE has no per-user assignment).
    // Step creation and DRAFT -> PENDING_APPROVAL are one CAS transaction.
    const approverUserId = policy.approverMode === 'CUSTOM_USER' ? policy.defaultApproverUserId : undefined;
    const {
      step,
      documentNumber,
      documentNumberReused,
      supersededDuplicateCandidateCount,
      supersededApprovalStepCount,
    } = await this.repo.submitDraftAtomic({
      companyId: ctx.companyId,
      requestId: id,
      expectedUpdatedAt: req.updatedAt,
      duplicateCandidates: dupResult.candidates,
      evidence: {
        attachmentIds: lines.map((line) => line.attachmentId).filter((value): value is string => !!value),
        expenseIds: lines.map((line) => line.linkedExpenseId).filter((value): value is string => !!value),
      },
      documentNumber: {
        branchId: req.branchId,
        documentType: REIMBURSEMENT_SEQUENCE_KEYS.REQUEST,
        periodKey,
        reservedByUserId: ctx.userId,
        idempotencyKey: `reimb-submit:${id}`,
      },
      approvalStep: {
        sequenceNo: 1,
        approverUserId,
        approverRoleSnapshot: policy.defaultApproverRole ?? 'MANAGER',
        requestSnapshotHash: snapshotHash,
      },
      request: {
        status: 'PENDING_APPROVAL',
        submittedAt: now,
        submittedByUserId: ctx.userId,
        currentApproverUserId: approverUserId,
        approvalSnapshotHash: snapshotHash,
        receiptRequirementStatus: receipt.status,
        duplicateStatus: dupResult.status,
        // Freeze the outstanding amount to the observed submitted amount.
        outstandingAmount: req.amount,
        updatedByUserId: ctx.userId,
      },
    });
    const requestNo = documentNumber.documentNumber;

    if (!documentNumberReused) {
      for (const action of ['document.number.reserve', 'document.number.commit'] as const) {
        void this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action,
          targetType: 'document_number',
          targetId: documentNumber.id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'LOW',
          metadataJson: { documentType: REIMBURSEMENT_SEQUENCE_KEYS.REQUEST, ownerId: id },
        });
      }
    }
    void this.audit.log({
      companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.request.submit',
      targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM',
      metadataJson: {
        requestNo,
        amount: req.amount,
        currency: req.currency,
        lineCount: lines.length,
        requiresApproval: requiresApproval(req.amount, policy.approvalRequiredFromAmount),
        legacyRecovery: {
          documentNumberReused,
          supersededDuplicateCandidateCount,
          supersededApprovalStepCount,
        },
      },
    });
    void this.outbox.append('reimbursement.request_submitted', 'reimbursement_request', id, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'reimbursement_request', aggregateId: id, occurredAt: now.toISOString(),
      // requestId must be present: the reimbursement_pending_approval workflow template's
      // default condition matches on it (same fix as billId in vendor_bill.submitted).
      // requesterUserId is here for the notification's excludeRecipientPayloadKeys (audit H-18):
      // the person who filed the claim must not be invited to approve it while the policy forbids
      // self-approval, which is the same rule the approval queue filters on.
      data: {
        requestId: id, status: 'PENDING_APPROVAL', requestNo, amount: req.amount, currency: req.currency,
        approverRole: policy.defaultApproverRole,
        ...(policy.allowSelfApproval ? {} : { requesterUserId: req.requesterUserId }),
      },
    });
    void this.outbox.append('reimbursement.approval_assigned', 'reimbursement_request', id, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'reimbursement_request', aggregateId: id, occurredAt: now.toISOString(),
      data: { stepId: step.id, approverRole: policy.defaultApproverRole, approverUserId },
    });

    const detail = await this.repo.findRequestById(ctx.companyId, id, true);
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, detail!);
  }

  /**
   * The same receipt or LINE-captured expense may back only one live claim.
   * Rejected/cancelled/voided claims release their evidence, so re-submitting a
   * corrected claim with the same receipt is allowed.
   */
  private async assertEvidenceNotClaimedElsewhere(companyId: string, requestId: string, lines: ReimbursementLineRecord[]): Promise<void> {
    const attachmentIds = lines.map((line) => line.attachmentId).filter((v): v is string => !!v);
    const expenseIds = lines.map((line) => line.linkedExpenseId).filter((v): v is string => !!v);
    const claimed = await this.repo.findLinesClaimedElsewhere(companyId, requestId, attachmentIds, expenseIds);
    const hit = claimed[0];
    if (!hit) return;
    throw new UnprocessableEntityException(
      hit.attachmentId && attachmentIds.includes(hit.attachmentId) ? 'attachment_already_claimed' : 'expense_already_claimed',
    );
  }

  private async detectDuplicates(companyId: string, req: { id: string; requesterUserId: string; amount: string; currency: string; incurredDate: Date; categoryKey: string; reason: string; lines?: ReimbursementLineRecord[] }) {
    const candidates = await this.repo.findDuplicateCandidates(companyId, req.requesterUserId, req.id);
    const a = {
      requesterUserId: req.requesterUserId, amount: req.amount, currency: req.currency,
      incurredDate: req.incurredDate.toISOString(), categoryKey: req.categoryKey,
      normalizedReason: normalizeReason(req.reason), lines: req.lines ?? [],
    };
    let best = 0;
    const duplicateCandidates: ReimbursementDuplicateCandidateWriteData[] = [];
    for (const c of candidates) {
      const match = scoreDuplicate(a, {
        requesterUserId: c.requesterUserId, amount: c.amount, currency: c.currency,
        incurredDate: c.incurredDate.toISOString(), categoryKey: c.categoryKey,
        normalizedReason: normalizeReason(c.reason), lines: c.lines ?? [],
      });
      if (match.score >= 60) {
        duplicateCandidates.push({
          candidateType: match.sharedType === 'ATTACHMENT' ? 'ATTACHMENT_CHECKSUM' : match.sharedType === 'EXPENSE' ? 'EXPENSE_LINK' : 'AMOUNT_DATE_VENDOR',
          candidateRequestId: c.id,
          candidateAttachmentId: match.sharedAttachmentId,
          candidateExpenseId: match.sharedExpenseId,
          score: match.score,
          reason: match.sharedLineNo !== undefined
            ? `line ${match.sharedLineNo} shares ${match.sharedType === 'EXPENSE' ? 'a linked expense' : 'a receipt'} with ${c.requestNo ?? c.id}`
            : undefined,
        });
        best = Math.max(best, match.score);
      }
    }
    if (best >= 80) return { status: 'POSSIBLE_DUPLICATE' as const, blocking: true, candidates: duplicateCandidates };
    if (best >= 60) return { status: 'POSSIBLE_DUPLICATE' as const, blocking: false, candidates: duplicateCandidates };
    return { status: 'NO_MATCH' as const, blocking: false, candidates: duplicateCandidates };
  }
}

@Injectable()
export class CancelReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly voidExpense: VoidExpenseUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string, reason?: string): Promise<ReimbursementRequestSummary> {
    const req = await this.repo.findRequestById(ctx.companyId, id);
    if (!req) throw new NotFoundException('Reimbursement request not found');

    const isOwner = req.requesterUserId === ctx.userId;
    const canCancel = (isOwner && ctx.permissions.includes('reimbursement.cancel_own')) || ctx.permissions.includes('reimbursement.finance_review');
    if (!canCancel) throw new ForbiddenException('Cannot cancel this reimbursement');
    if (!canTransition(req.status, 'CANCELLED')) throw new UnprocessableEntityException(`Cannot cancel from status ${req.status}`);
    if (!isBranchInScope(ctx.scopes ?? {}, req.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');

    const cancellationReason = reason?.trim() || 'ยกเลิกคำขอเบิกค่าใช้จ่าย';
    const startedAt = new Date();
    const intent = await this.repo.beginCancellationAtomic({
      companyId: ctx.companyId,
      requestId: id,
      expectedStatus: req.status,
      expectedUpdatedAt: req.updatedAt,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      reason: cancellationReason,
      startedAt,
      onIntentPersisted: async (tx) => {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'reimbursement.request.cancellation_intent',
          targetType: 'reimbursement_request',
          targetId: id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { reason: cancellationReason, projectionCleanupPending: true },
        }, tx);
        await tx.outboxEvent.createMany({
          data: [{
            companyId: ctx.companyId,
            eventType: 'reimbursement.cancellation_started',
            aggregateType: 'reimbursement_request',
            aggregateId: id,
            eventKey: `reimbursement.cancellation_started:reimbursement_request:${id}`,
            payloadJson: {
              companyId: ctx.companyId,
              actorUserId: ctx.userId,
              requestId: ctx.requestId,
              aggregateType: 'reimbursement_request',
              aggregateId: id,
              occurredAt: startedAt.toISOString(),
              data: { requestId: id, status: req.status, cancellation: 'PROJECTION_CLEANUP_PENDING' },
            },
            priority: 'NORMAL',
            status: 'PENDING',
          }],
          skipDuplicates: true,
        });
      },
    });

    const projections = await this.repo.listClaimProjections(ctx.companyId, id);
    for (const projection of projections) {
      await this.voidExpense.executeForReimbursement(ctx, projection.id, cancellationReason, {
        reimbursementRequestId: id,
        reimbursementLineId: projection.sourceReimbursementLineId,
        branchId: intent.request.branchId,
      });
    }

    const completedAt = new Date();
    const updated = await this.repo.completeCancellationAtomic({
      companyId: ctx.companyId,
      requestId: id,
      actorUserId: ctx.userId,
      scopes: ctx.scopes ?? {},
      completedAt,
      onCancelledPersisted: async (tx) => {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'reimbursement.request.cancel',
          targetType: 'reimbursement_request',
          targetId: id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { reason: cancellationReason, projectionCount: projections.length },
        }, tx);
        await tx.outboxEvent.createMany({
          data: [{
            companyId: ctx.companyId,
            eventType: 'reimbursement.cancelled',
            aggregateType: 'reimbursement_request',
            aggregateId: id,
            eventKey: `reimbursement.cancelled:reimbursement_request:${id}`,
            payloadJson: {
              companyId: ctx.companyId,
              actorUserId: ctx.userId,
              requestId: ctx.requestId,
              aggregateType: 'reimbursement_request',
              aggregateId: id,
              occurredAt: completedAt.toISOString(),
              data: { requestId: id, status: 'CANCELLED' },
            },
            priority: 'NORMAL',
            status: 'PENDING',
          }],
          skipDuplicates: true,
        });
      },
    });
    return toRequestSummary(updated);
  }
}

export async function assertCanReadRequest(
  ctx: RequestContext,
  request: Pick<ReimbursementRequestRecord, 'id' | 'branchId' | 'requesterUserId'>,
  repo: PrismaReimbursementRepository,
): Promise<void> {
  if (!isBranchInScope(ctx.scopes ?? {}, request.branchId)) {
    throw new ForbiddenException('Branch is outside your assigned branch scope.');
  }
  if (ctx.permissions.includes('reimbursement.read')) return;
  if (ctx.permissions.includes('reimbursement.read_own') && request.requesterUserId === ctx.userId) return;
  if (ctx.permissions.includes('reimbursement.read_related')
    && await repo.isUserRelatedToRequest(ctx.companyId, request.id, ctx.userId, ctx.scopes ?? {})) return;
  throw new ForbiddenException('Cannot read this reimbursement');
}

/**
 * The hash a claim-form signer acknowledges: the claim as it stands NOW, folded
 * exactly like the approval snapshot (header + every line). Distinct from
 * `approvalSnapshotHash`, which is frozen at submit — you sign what you printed.
 */
export function claimSignatureAckHash(req: ReimbursementRequestRecord): string {
  return computeSnapshotHash({
    amount: req.amount,
    currency: req.currency,
    categoryKey: req.categoryKey,
    incurredDate: req.incurredDate.toISOString(),
    reason: req.reason,
    primaryAttachmentId: req.primaryAttachmentId,
    lines: req.lines ?? [],
  });
}
