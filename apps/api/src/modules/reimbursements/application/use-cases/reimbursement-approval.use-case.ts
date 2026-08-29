import { Injectable, ForbiddenException, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import type { RequestContext, ReimbursementApprovalQueueItem, ReimbursementRequestDetail } from '@watchdog-bms/contracts';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { ReimbursementProjectionOrchestratorService } from '../services/reimbursement-projection-orchestrator.service';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type { ReimbursementApprovalStepRecord, ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';
import { toRequestSummary, detailWithFileNames } from '../dto/reimbursement.mapper';
import { ReimbursementEvidenceService } from '../services/reimbursement-evidence.service';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import {
  isSelfApproval,
  SELF_APPROVAL_EXEMPT_ROLES,
  matchesApproverRole,
  frozenApprovalAuthority,
  validateRejectionReason,
  canTransition,
  ageHours,
  isSlaRisk,
} from '../../domain/logic/reimbursement.logic';

function currentApprovalStep(request: ReimbursementRequestRecord): ReimbursementApprovalStepRecord | undefined {
  return request.approvalSteps?.find((step) => step.id === request.currentApprovalStepId);
}

/**
 * Audit H-20: a step naming a specific approver was approvable by that person and nobody else. With
 * no reassign route, disabling or removing that member froze every request waiting on them and hid
 * it from every queue — the queue filters on this same predicate — leaving cancellation, which
 * burns the document number, as the only way out.
 *
 * `assigneeCanAct` false means the named approver can no longer act for this company, and the step
 * falls back to the role it was ALSO recorded with (steps store `approverRoleSnapshot` even in
 * CUSTOM_USER mode). That is the routing the company would have had without naming a person, so
 * the fallback widens to exactly the role holders and OWNER — never to everyone.
 *
 * Defaults to true so every existing caller keeps exact-match behaviour until it opts in by
 * looking the assignee up; a silent widening is not something a default should decide.
 */
export function isEligibleApprover(
  step: ReimbursementApprovalStepRecord | undefined,
  userId: string,
  roles: string[],
  activeApproverUserIds?: Set<string>,
): boolean {
  if (!step || step.status !== 'PENDING') return false;
  const frozenAuthority = frozenApprovalAuthority(
    step.assignedApproverUserIds,
    activeApproverUserIds ?? new Set(step.assignedApproverUserIds ?? []),
    userId,
  );
  if (frozenAuthority === 'ASSIGNED') return true;
  if (frozenAuthority === 'DENIED') return false;
  if (step.approverUserId && (activeApproverUserIds?.has(step.approverUserId) ?? true)) return step.approverUserId === userId;
  return matchesApproverRole(step.approverRoleSnapshot, roles);
}

export function hasFrozenAssignment(
  step: ReimbursementApprovalStepRecord | undefined,
  userId: string,
  activeApproverUserIds: Set<string>,
): boolean {
  return frozenApprovalAuthority(step?.assignedApproverUserIds, activeApproverUserIds, userId) === 'ASSIGNED';
}

function canResumeApprovedDecision(
  step: ReimbursementApprovalStepRecord | undefined,
  userId: string,
  roles: string[],
  activeApproverUserIds?: Set<string>,
): boolean {
  return Boolean(step
    && ((step.status === 'APPROVED' && step.decisionByUserId === userId)
      || isEligibleApprover(step, userId, roles, activeApproverUserIds)));
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

export async function activeStepApprovers(
  repo: PrismaReimbursementRepository,
  companyId: string,
  step: ReimbursementApprovalStepRecord | undefined,
  branchId?: string | null,
): Promise<Set<string>> {
  return repo.findActiveApproverUserIds(companyId, [
    ...(step?.assignedApproverUserIds ?? []),
    ...(step?.approverUserId ? [step.approverUserId] : []),
  ], branchId);
}

export async function approvalDecisionActions(
  ctx: RequestContext,
  request: ReimbursementRequestRecord,
  repo: PrismaReimbursementRepository,
): Promise<{ canApprove: boolean; canReject: boolean }> {
  if (request.status !== 'PENDING_APPROVAL' || !isBranchInScope(ctx.scopes ?? {}, request.branchId)) {
    return { canApprove: false, canReject: false };
  }
  const step = currentApprovalStep(request);
  const activeApprovers = await activeStepApprovers(repo, ctx.companyId, step, request.branchId);
  const assignedBySnapshot = hasFrozenAssignment(step, ctx.userId, activeApprovers);
  if (!isEligibleApprover(step, ctx.userId, ctx.roles, activeApprovers)) {
    return { canApprove: false, canReject: false };
  }
  const policy = effectivePolicyForRequest(
    request,
    effectivePolicy(await repo.findPolicy(ctx.companyId, null)),
  );
  if (!assignedBySnapshot
    && isSelfApproval(request.requesterUserId, ctx.userId, policy.allowSelfApproval, ctx.roles)) {
    return { canApprove: false, canReject: false };
  }
  return {
    canApprove: assignedBySnapshot || ctx.permissions.includes('reimbursement.approve'),
    canReject: assignedBySnapshot || ctx.permissions.includes('reimbursement.reject'),
  };
}

@Injectable()
export class ListApprovalQueueUseCase {
  constructor(private readonly repo: PrismaReimbursementRepository) {}

  async execute(ctx: RequestContext): Promise<ReimbursementApprovalQueueItem[]> {
    const hasCurrentDecisionPermission = ctx.permissions.some((permission) => permission === 'reimbursement.approve' || permission === 'reimbursement.reject');
    const currentPolicy = effectivePolicy(await this.repo.findPolicy(ctx.companyId, null));
    const rows = await this.repo.listRequests({
      companyId: ctx.companyId,
      status: 'PENDING_APPROVAL',
      scopes: ctx.scopes ?? {},
    });
    // One lookup per branch, not per row: current branch responsibility is part of whether a
    // frozen assignee remains actionable and whether recovery may open.
    const assignedIdsByBranch = new Map<string, string[]>();
    for (const request of rows) {
      const key = request.branchId ?? '';
      const step = currentApprovalStep(request);
      assignedIdsByBranch.set(key, [
        ...(assignedIdsByBranch.get(key) ?? []),
        ...(step?.assignedApproverUserIds ?? []),
        ...(step?.approverUserId ? [step.approverUserId] : []),
      ]);
    }
    const activeApproversByBranch = new Map(await Promise.all(
      [...assignedIdsByBranch].map(async ([key, userIds]) => [
        key,
        await this.repo.findActiveApproverUserIds(ctx.companyId, userIds, key || undefined),
      ] as const),
    ));
    // Every row here is PENDING_APPROVAL, so every desk names people. The ids are already
    // collected above — one names lookup for the whole queue, no per-row query.
    const approverNames = await this.repo.getUserDisplayNames(ctx.companyId, [...assignedIdsByBranch.values()].flat());
    const now = new Date();
    return rows.filter((request) => {
      const step = currentApprovalStep(request);
      const policy = effectivePolicyForRequest(request, currentPolicy);
      const activeApprovers = activeApproversByBranch.get(request.branchId ?? '') ?? new Set<string>();
      const assignedBySnapshot = hasFrozenAssignment(step, ctx.userId, activeApprovers);
      return isBranchInScope(ctx.scopes ?? {}, request.branchId)
        && (hasCurrentDecisionPermission || assignedBySnapshot)
        && isEligibleApprover(step, ctx.userId, ctx.roles, activeApprovers)
        // Audit H-18: the queue used to list the viewer's own claims, so the approve button was
        // offered on a request that answers `self_approval_denied` — and the pending-approval
        // notification pushed a deep link straight to it. Same predicate and same company-level
        // policy the approve gate uses, so the two can never disagree about what is offered and
        // what is allowed; when allowSelfApproval is on, isSelfApproval returns false and nothing
        // is filtered.
        // Assignment resolution already applied the submitted self-approval rule and role
        // exemptions. Re-evaluating it from a later role would hide a still-actionable task.
        && (assignedBySnapshot
          || !isSelfApproval(request.requesterUserId, ctx.userId, policy.allowSelfApproval, ctx.roles));
    }).map((r) => {
      const policy = effectivePolicyForRequest(r, currentPolicy);
      const age = r.submittedAt ? ageHours(r.submittedAt, now) : 0;
      return { ...toRequestSummary(r, { approverNames }), ageHours: age, slaRisk: isSlaRisk(age, policy.slaHours) };
    });
  }
}

@Injectable()
export class ApproveReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly projections: ReimbursementProjectionOrchestratorService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string, comment?: string, expectedHash?: string): Promise<ReimbursementRequestDetail> {
    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    if (req.status !== 'PENDING_APPROVAL') throw new UnprocessableEntityException(`Cannot approve from status ${req.status}`);

    const policy = effectivePolicyForRequest(req, effectivePolicy(await this.repo.findPolicy(ctx.companyId, null)));
    const step = currentApprovalStep(req);
    const activeApprovers = await activeStepApprovers(this.repo, ctx.companyId, step, req.branchId);
    const assignedBySnapshot = hasFrozenAssignment(step, ctx.userId, activeApprovers);
    if (!ctx.permissions.includes('reimbursement.approve') && !assignedBySnapshot) {
      throw new ForbiddenException('Missing permission: reimbursement.approve');
    }
    if (!assignedBySnapshot && isSelfApproval(req.requesterUserId, ctx.userId, policy.allowSelfApproval, ctx.roles)) {
      void this.audit.log({
        companyId: ctx.companyId, actorUserId: ctx.userId, action: 'reimbursement.approval.self_approval_denied',
        targetType: 'reimbursement_request', targetId: id, requestId: ctx.requestId, result: 'DENIED', riskLevel: 'HIGH',
      });
      throw new ForbiddenException('self_approval_denied');
    }
    if (!isBranchInScope(ctx.scopes ?? {}, req.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    if (!canResumeApprovedDecision(step, ctx.userId, ctx.roles, activeApprovers)) {
      throw new ForbiddenException('not_eligible_approver');
    }

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
            // The exemption buys convenience, not anonymity. Recorded in the SAME transaction as
            // the decision, so the trail cannot exist without the approval or the approval without
            // the trail — a post-commit audit write can be lost exactly when it matters most.
            // `via` distinguishes the company having opened the policy from a role standing in for
            // it, which is the question support has to answer when a customer disputes a claim.
            ...(req.requesterUserId === ctx.userId
              ? {
                selfApproval: {
                  approvedOwnRequest: true,
                  via: policy.allowSelfApproval ? 'company_policy' : 'role_exemption',
                  actorRoles: ctx.roles.filter((role) => SELF_APPROVAL_EXEMPT_ROLES.includes(role)),
                },
              }
              : {}),
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
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, detail!);
  }
}

@Injectable()
export class RejectReimbursementUseCase {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly audit: AuditService,
    private readonly evidence: ReimbursementEvidenceService,
  ) {}

  async execute(ctx: RequestContext, id: string, reason: string): Promise<ReimbursementRequestDetail> {
    if (!validateRejectionReason(reason)) throw new BadRequestException('rejection_reason_required');

    const req = await this.repo.findRequestById(ctx.companyId, id, true);
    if (!req) throw new NotFoundException('Reimbursement request not found');
    if (req.status !== 'PENDING_APPROVAL') throw new UnprocessableEntityException(`Cannot reject from status ${req.status}`);

    const policy = effectivePolicyForRequest(req, effectivePolicy(await this.repo.findPolicy(ctx.companyId, null)));
    const step = currentApprovalStep(req);
    const activeApprovers = await activeStepApprovers(this.repo, ctx.companyId, step, req.branchId);
    const assignedBySnapshot = hasFrozenAssignment(step, ctx.userId, activeApprovers);
    if (!ctx.permissions.includes('reimbursement.reject') && !assignedBySnapshot) {
      throw new ForbiddenException('Missing permission: reimbursement.reject');
    }
    if (!assignedBySnapshot && isSelfApproval(req.requesterUserId, ctx.userId, policy.allowSelfApproval, ctx.roles)) {
      throw new ForbiddenException('self_approval_denied');
    }
    if (!isBranchInScope(ctx.scopes ?? {}, req.branchId)) throw new ForbiddenException('Branch is outside your assigned branch scope.');
    if (!isEligibleApprover(step, ctx.userId, ctx.roles, activeApprovers)) {
      throw new ForbiddenException('not_eligible_approver');
    }
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
    return detailWithFileNames(this.repo, this.evidence, ctx.companyId, detail!);
  }
}
