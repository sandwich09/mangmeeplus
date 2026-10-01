import { Injectable } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AuditService } from '../../../audit/application/audit.service';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { VoidExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { effectivePolicy, effectivePolicyForRequest } from '../../domain/reimbursement.constants';
import { claimApproverUserId } from '../../domain/logic/reimbursement.logic';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { ReimbursementProjectionOrchestratorService } from './reimbursement-projection-orchestrator.service';
import { ListReimbursementApproverOptionsUseCase } from '../use-cases/reimbursement-policy.use-case';

@Injectable()
export class ReimbursementProjectionReconcilerService {
  constructor(
    private readonly repo: PrismaReimbursementRepository,
    private readonly projections: ReimbursementProjectionOrchestratorService,
    private readonly audit: AuditService,
    private readonly voidExpense: VoidExpenseUseCase,
    private readonly prisma: PrismaService,
    private readonly approverRoutes: ListReimbursementApproverOptionsUseCase,
  ) {}

  /**
   * Freeze in place (owner decision 2026-08-04). The intent queries are cross-tenant and this
   * service runs under a synthetic system context with no permissions, so it never meets the
   * resolver chokepoint that delivers the freeze everywhere else. A frozen company's intents are
   * left exactly as they are — pending — so a re-enable resumes them where they stopped.
   *
   * The canonical evaluator, so an unconfigured (zero-row) company still fails OPEN and its partial
   * projections are not stranded by a company-status filter this service cannot see.
   */
  private async frozen(companyId: string): Promise<boolean> {
    const entitled = await loadEntitledFeatureKeys(this.prisma, companyId);
    // `expenses` counts too: the orchestrator materializes and confirms ExpenseRecord rows for every
    // claim line, so a frozen expenses family must stop this drain — the same rationale as
    // AUTO_POST_REQUIRED_FEATURES. Both keys are read from THIS ONE entitlement query because the
    // contracts forbid a reimbursement ⇒ expenses dependency edge (declaring one would cascade
    // `reimbursement` off and restamp its activation cutoff on the re-enable).
    return entitled !== null && (!entitled.has('reimbursement') || !entitled.has('expenses'));
  }

  async execute(limit = 100): Promise<{ completed: string[]; failed: Array<{ requestId: string; error: string }> }> {
    const completed: string[] = [];
    const failed: Array<{ requestId: string; error: string }> = [];
    const intents = await this.repo.listPendingProjectionIntents(limit);
    for (const intent of intents) {
      if (await this.frozen(intent.request.companyId)) continue;
      const requestId = `system:reimbursement-projection:${intent.request.id}`;
      const ctx: RequestContext = {
        requestId,
        authSubject: 'system:reimbursement-projection-reconciler',
        userId: intent.actorUserId,
        companyId: intent.request.companyId,
        membershipId: 'system',
        roles: [],
        permissions: [],
        scopes: {},
        authProvider: 'system',
      };
      try {
        const currentPolicy = effectivePolicy(await this.repo.findPolicy(intent.request.companyId, null));
        const policy = effectivePolicyForRequest(intent.request, currentPolicy);
        // The same field the live submit writes for a claim that needed no approval, so a replayed
        // ready-to-pay event asks the same people first (owner rule 2026-10-01).
        // And for a claim finance passed, its own approver, exactly as the live finance review writes it.
        const financePathApprover = intent.kind === 'FINANCE' ? claimApproverUserId(intent.request) : undefined;
        const approverRecipientUserIds = intent.kind === 'POLICY'
          ? await this.approverRoutes.resolveWouldBeApproverUserIds(intent.request.companyId, currentPolicy, intent.request).catch(() => [])
          : financePathApprover ? [financePathApprover] : [];
        await this.projections.execute(ctx, intent.request, {
          kind: intent.kind,
          actorUserId: intent.actorUserId,
          approvalStepId: intent.approvalStepId,
          allowMissingReceiptWithReason: policy.allowMissingReceiptWithReason,
          systemReconcile: true,
        });
        const completedAt = new Date();
        const onReadyPersisted = async (tx: any) => {
          await this.audit.log({
            companyId: intent.request.companyId,
            actorType: 'SYSTEM',
            actorRefId: 'reimbursement-projection-reconciler',
            action: intent.kind === 'MANAGER'
              ? 'reimbursement.approval.approve'
              : intent.kind === 'FINANCE'
                ? 'reimbursement.finance_review.update'
                : 'reimbursement.approval.auto_by_policy',
            targetType: 'reimbursement_request',
            targetId: intent.request.id,
            requestId,
            result: 'SUCCESS',
            riskLevel: 'HIGH',
            metadataJson: {
              projectionReady: true,
              systemReconcile: true,
              originalDecisionActorUserId: intent.actorUserId,
            },
          }, tx);
          const eventTypes = intent.kind === 'MANAGER'
            ? ['reimbursement.approved', 'reimbursement.ready_for_payment']
            : intent.kind === 'FINANCE'
              ? ['reimbursement.finance_review_updated', 'reimbursement.ready_for_payment']
              : ['reimbursement.approved', 'reimbursement.ready_for_payment'];
          for (const eventType of eventTypes) {
            const decisionId = intent.approvalStepId
              ?? intent.request.submittedAt?.toISOString()
              ?? intent.actorUserId;
            await tx.outboxEvent.createMany({
              data: [{
                companyId: intent.request.companyId,
                eventType,
                aggregateType: 'reimbursement_request',
                aggregateId: intent.request.id,
                eventKey: `${eventType}:reimbursement_request:${intent.request.id}:${decisionId}`,
                payloadJson: {
                  companyId: intent.request.companyId,
                  actorUserId: intent.actorUserId,
                  requestId,
                  aggregateType: 'reimbursement_request',
                  aggregateId: intent.request.id,
                  occurredAt: completedAt.toISOString(),
                  data: {
                    requestId: intent.request.id,
                    requestNo: intent.request.requestNo,
                    requesterUserId: intent.request.requesterUserId,
                    status: 'READY_FOR_PAYMENT',
                    decision: 'APPROVED',
                    amount: intent.request.amount,
                    currency: intent.request.currency,
                    ...(approverRecipientUserIds.length > 0 && { approverRecipientUserIds }),
                  },
                },
                priority: 'NORMAL',
                status: 'PENDING',
              }],
              skipDuplicates: true,
            });
          }
        };
        if (intent.kind === 'MANAGER') {
          await this.repo.completeApprovalProjectionAtomic({
            companyId: intent.request.companyId,
            requestId: intent.request.id,
            decisionActorUserId: intent.actorUserId,
            approvalStepId: intent.approvalStepId!,
            scopes: {},
            systemReconcile: true,
            expectedBranchId: intent.request.branchId,
            completedAt,
            onReadyPersisted,
          });
        } else if (intent.kind === 'FINANCE') {
          await this.repo.completeFinanceProjectionAtomic({
            companyId: intent.request.companyId,
            requestId: intent.request.id,
            decisionActorUserId: intent.actorUserId,
            scopes: {},
            systemReconcile: true,
            expectedBranchId: intent.request.branchId,
            completedAt,
            onReadyPersisted,
          });
        } else {
          await this.repo.completePolicyProjectionAtomic({
            companyId: intent.request.companyId,
            requestId: intent.request.id,
            actorUserId: intent.actorUserId,
            scopes: {},
            systemReconcile: true,
            expectedBranchId: intent.request.branchId,
            completedAt,
            onReadyPersisted,
          });
        }
        completed.push(intent.request.id);
      } catch (error) {
        failed.push({
          requestId: intent.request.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const cancellations = await this.repo.listPendingCancellationIntents(limit);
    for (const intent of cancellations) {
      if (await this.frozen(intent.request.companyId)) continue;
      const requestId = `system:reimbursement-cancellation:${intent.request.id}`;
      const ctx: RequestContext = {
        requestId,
        authSubject: 'system:reimbursement-projection-reconciler',
        userId: intent.actorUserId,
        companyId: intent.request.companyId,
        membershipId: 'system',
        roles: [],
        permissions: [],
        scopes: {},
        authProvider: 'system',
      };
      try {
        const projections = await this.repo.listClaimProjections(intent.request.companyId, intent.request.id);
        for (const projection of projections) {
          await this.voidExpense.executeForReimbursement(ctx, projection.id, intent.reason, {
            reimbursementRequestId: intent.request.id,
            reimbursementLineId: projection.sourceReimbursementLineId,
            branchId: intent.request.branchId,
            systemReconcile: true,
          });
        }
        const completedAt = new Date();
        await this.repo.completeCancellationAtomic({
          companyId: intent.request.companyId,
          requestId: intent.request.id,
          actorUserId: intent.actorUserId,
          scopes: {},
          systemReconcile: true,
          expectedBranchId: intent.request.branchId,
          completedAt,
          onCancelledPersisted: async (tx) => {
            await this.audit.log({
              companyId: intent.request.companyId,
              actorType: 'SYSTEM',
              actorRefId: 'reimbursement-projection-reconciler',
              action: 'reimbursement.request.cancel',
              targetType: 'reimbursement_request',
              targetId: intent.request.id,
              requestId,
              result: 'SUCCESS',
              riskLevel: 'HIGH',
              metadataJson: {
                reason: intent.reason,
                projectionCount: projections.length,
                systemReconcile: true,
                originalDecisionActorUserId: intent.actorUserId,
              },
            }, tx);
            await tx.outboxEvent.createMany({
              data: [{
                companyId: intent.request.companyId,
                eventType: 'reimbursement.cancelled',
                aggregateType: 'reimbursement_request',
                aggregateId: intent.request.id,
                eventKey: `reimbursement.cancelled:reimbursement_request:${intent.request.id}`,
                payloadJson: {
                  companyId: intent.request.companyId,
                  actorUserId: intent.actorUserId,
                  requestId,
                  aggregateType: 'reimbursement_request',
                  aggregateId: intent.request.id,
                  occurredAt: completedAt.toISOString(),
                  data: { requestId: intent.request.id, status: 'CANCELLED' },
                },
                priority: 'NORMAL',
                status: 'PENDING',
              }],
              skipDuplicates: true,
            });
          },
        });
        completed.push(intent.request.id);
      } catch (error) {
        failed.push({
          requestId: intent.request.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { completed, failed };
  }
}
