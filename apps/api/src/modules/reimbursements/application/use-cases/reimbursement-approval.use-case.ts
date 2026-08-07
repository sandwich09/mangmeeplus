import { Injectable, ForbiddenException, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, ReimbursementApprovalQueueItem, ReimbursementRequestDetail } from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { ReimbursementProjectionOrchestratorService } from '../services/reimbursement-projection-orchestrator.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type { ReimbursementApprovalStepRecord, ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';
import { toRequestSummary, toRequestDetail } from '../dto/reimbursement.mapper';
import { effectivePolicy } from '../../domain/reimbursement.constants';
import {
  isSelfApproval,
  matchesApproverRole,
  validateRejectionReason,
  canTransition,
  ageHours,
  isSlaRisk,
} from '../../domain/logic/reimbursement.logic';

function currentApprovalStep(request: ReimbursementRequestRecord): ReimbursementApprovalStepRecord | undefined {
  return request.approvalSteps?.find((step) => step.id === request.currentApprovalStepId);
}

function isEligibleApprover(
  step: ReimbursementApprovalStepRecord | undefined,
  userId: string,
  roles: string[],
): boolean {
  if (!step || step.status !== 'PENDING') return false;
  return step.approverUserId ? step.approverUserId === userId : matchesApproverRole(step.approverRoleSnapshot, roles);
}

function canResumeApprovedDecision(
  step: ReimbursementApprovalStepRecord | undefined,
  userId: string,
  roles: string[],
): boolean {
  return Boolean(step
    && ((step.status === 'APPROVED' && step.decisionByUserId === userId)
      || isEligibleApprover(step, userId, roles)));
}

async function appendOutboxWithinTx(tx: any, input: {
  companyId: string;
  eventType: string;
  aggregateId: string;
  eventKey: string;
  payloadJson: Record<string, unknown>;
}): Promise<void> {
  await tx.outboxEvent.createMany({
    data: [{
      companyId: input.companyId,
      eventType: input.eventType,
      aggregateType: 'reimbursement_request',
      aggregateId: input.aggregateId,
      eventKey: input.eventKey,
      payloadJson: input.payloadJson,
      priority: 'NORMAL',
      status: 'PENDING',
    }],
    skipDuplicates: true,
  });
}

@Injectable()
export class ListApprovalQueueUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository) {}

  async execute(ctx: RequestContext): Promise<ReimbursementApprovalQueueItem[]> {
    if (!ctx.permissions.includes('reimbursement.approve')) throw new ForbiddenException('Missing permission: reimbursement.approve');
    const policy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    const rows = await this.repo.listRequests({ companyId: ctx.companyId, status: 'PENDING_APPROVAL' });
    const now = new Date();
    return rows.filter((request) => isBranchInScope(ctx.scopes ?? {}, request.branchId)
      && isEligibleApprover(currentApprovalStep(request), ctx.userId, ctx.roles)).map((r) => {
      const age = r.submittedAt ? ageHours(r.submittedAt, now) : 0;
      return { ...toRequestSummary(r), ageHours: age, slaRisk: isSlaRisk(age, policy.slaHours) };
    });
  }
}

@Injectable()
export class ApproveReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly projections: ReimbursementProjectionOrchestratorService,
  ) {}

  async execute(ctx: RequestContext, id: string, comment?: string, expectedHash?: string): Promise<ReimbursementRequestDetail> {
    if (!ctx.permissions.includes('reimbursement.approve')) throw new ForbiddenException('Missing permission: reimbursement.approve');

    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    if (req.status !== 'PENDING_APPROVAL') throw new UnprocessableEntityException(`Cannot approve from status ${req.status}`);

    const policy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    if (isSelfApproval(req.requesterUserId, ctx.userId, policy.allowSelfApproval)) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.approval.self_approval_denied',
        targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
      });
      throw new ForbiddenException('self_approval_denied');
    }
    if (!isBranchInScope(ctx.scopes ?? {}, req.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    const step = currentApprovalStep(req);
    if (!canResumeApprovedDecision(step, ctx.userId, ctx.roles)) throw new ForbiddenException('not_eligible_approver');

    const now = new Date();
    const decision = await this.repo.beginApprovalDecisionAtomic({
      companyId: ctx.companyId,
      requestId: id,
      expectedUpdatedAt: req.updatedAt,
      expectedApprovalSnapshotHash: expectedHash,
      actorUserId: ctx.userId,
      actorRoles: ctx.roles,
      scopes: ctx.scopes ?? {},
      allowSelfApproval: policy.allowSelfApproval,
      financeReviewRequired: policy.financeReviewRequired,
      decidedAt: now,
      comment,
      financeRequestPatch: {
        status: 'FINANCE_REVIEW',
        approvedAt: now,
        currentApproverUserId: null,
        currentApprovalStepId: null,
        financeReviewStatus: 'PENDING',
        paymentStatus: 'UNPAID',
        updatedByUserId: ctx.userId,
      },
      onDecisionPersisted: async (tx) => {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: policy.financeReviewRequired
            ? 'reimbursement.approval.approve'
            : 'reimbursement.approval.decision_durable',
          targetType: 'reimbursement_request',
          targetId: id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: {
            amount: req.amount,
            currency: req.currency,
            comment,
            projectionPending: !policy.financeReviewRequired,
          },
        }, tx);
        const eventType = policy.financeReviewRequired
          ? 'reimbursement.approved'
          : 'reimbursement.approval_projection_started';
        await appendOutboxWithinTx(tx, {
          companyId: ctx.companyId,
          eventType,
          aggregateId: id,
          eventKey: `${eventType}:reimbursement_request:${id}:${step!.id}`,
          payloadJson: {
            companyId: ctx.companyId,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
            aggregateType: 'reimbursement_request',
            aggregateId: id,
            occurredAt: now.toISOString(),
            data: {
              requestId: id,
              requestNo: req.requestNo,
              status: policy.financeReviewRequired ? 'FINANCE_REVIEW' : 'PENDING_APPROVAL',
              decision: policy.financeReviewRequired ? 'APPROVED' : 'PROJECTION_PENDING',
              requesterUserId: req.requesterUserId,
              amount: req.amount,
              currency: req.currency,
            },
          },
        });
      },
    });

    if (!policy.financeReviewRequired) {
      await this.projections.execute(ctx, decision.request, {
        kind: 'MANAGER',
        actorUserId: ctx.userId,
        approvalStepId: decision.approvalStepId,
        allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
      });
      const readyAt = new Date();
      await this.repo.completeApprovalProjectionAtomic({
        companyId: ctx.companyId,
        requestId: id,
        decisionActorUserId: ctx.userId,
        approvalStepId: decision.approvalStepId,
        scopes: ctx.scopes ?? {},
        completedAt: readyAt,
        onReadyPersisted: async (tx) => {
          await this.audit.log({
            companyId: ctx.companyId,
            actorUserId: ctx.userId,
            action: 'reimbursement.approval.approve',
            targetType: 'reimbursement_request',
            targetId: id,
            requestId: ctx.requestId,
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            metadataJson: { amount: req.amount, currency: req.currency, comment, projectionReady: true },
          }, tx);
          for (const eventType of ['reimbursement.approved', 'reimbursement.ready_for_payment']) {
            await appendOutboxWithinTx(tx, {
              companyId: ctx.companyId,
              eventType,
              aggregateId: id,
              eventKey: `${eventType}:reimbursement_request:${id}:${decision.approvalStepId}`,
              payloadJson: {
                companyId: ctx.companyId,
                actorUserId: ctx.userId,
                requestId: ctx.requestId,
                aggregateType: 'reimbursement_request',
                aggregateId: id,
                occurredAt: readyAt.toISOString(),
                data: {
                  requestId: id,
                  requestNo: req.requestNo,
                  status: 'READY_FOR_PAYMENT',
                  decision: 'APPROVED',
                  requesterUserId: req.requesterUserId,
                  amount: req.amount,
                  currency: req.currency,
                },
              },
            });
          }
        },
      });
    }

    const detail = await this.repo.findRequestById(ctx.companyId, id, true);
    return toRequestDetail(detail!);
  }
}

@Injectable()
export class RejectReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
  ) {}

  async execute(ctx: RequestContext, id: string, reason: string): Promise<ReimbursementRequestDetail> {
    if (!ctx.permissions.includes('reimbursement.reject')) throw new ForbiddenException('Missing permission: reimbursement.reject');
    if (!validateRejectionReason(reason)) throw new BadRequestException('rejection_reason_required');

    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    if (req.status !== 'PENDING_APPROVAL') throw new UnprocessableEntityException(`Cannot reject from status ${req.status}`);

    const policy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    if (isSelfApproval(req.requesterUserId, ctx.userId, policy.allowSelfApproval)) {
      throw new ForbiddenException('self_approval_denied');
    }
    if (!isBranchInScope(ctx.scopes ?? {}, req.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    const step = currentApprovalStep(req);
    if (!isEligibleApprover(step, ctx.userId, ctx.roles)) throw new ForbiddenException('not_eligible_approver');
    if (!canTransition(req.status, 'REJECTED')) throw new UnprocessableEntityException('invalid_status_transition');

    const now = new Date();
    await this.repo.rejectRequestAtomic({
      companyId: ctx.companyId,
      requestId: id,
      expectedUpdatedAt: req.updatedAt,
      actorUserId: ctx.userId,
      actorRoles: ctx.roles,
      scopes: ctx.scopes ?? {},
      allowSelfApproval: policy.allowSelfApproval,
      decidedAt: now,
      rejectionReason: reason,
      request: {
        status: 'REJECTED', rejectedAt: now, rejectionReason: reason,
        currentApproverUserId: null, currentApprovalStepId: null,
        paymentStatus: 'NOT_PAYABLE', postingStatus: 'not_required', updatedByUserId: ctx.userId,
      },
      onRejectedPersisted: async (tx) => {
        await this.audit.log({
          companyId: ctx.companyId,
          actorUserId: ctx.userId,
          action: 'reimbursement.approval.reject',
          targetType: 'reimbursement_request',
          targetId: id,
          requestId: ctx.requestId,
          result: 'SUCCESS',
          riskLevel: 'HIGH',
          metadataJson: { reason },
        }, tx);
        await appendOutboxWithinTx(tx, {
          companyId: ctx.companyId,
          eventType: 'reimbursement.rejected',
          aggregateId: id,
          eventKey: `reimbursement.rejected:reimbursement_request:${id}:${step!.id}`,
          payloadJson: {
            companyId: ctx.companyId,
            actorUserId: ctx.userId,
            requestId: ctx.requestId,
            aggregateType: 'reimbursement_request',
            aggregateId: id,
            occurredAt: now.toISOString(),
            data: {
              requestId: id,
              requestNo: req.requestNo,
              status: 'REJECTED',
              decision: 'REJECTED',
              requesterUserId: req.requesterUserId,
              amount: req.amount,
              currency: req.currency,
            },
          },
        });
      },
    });

    const detail = await this.repo.findRequestById(ctx.companyId, id, true);
    return toRequestDetail(detail!);
  }
}
