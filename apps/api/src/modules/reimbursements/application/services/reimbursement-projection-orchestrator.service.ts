import { ConflictException, Injectable } from '@nestjs/common';
import type { RequestContext } from '@watchdog-bms/contracts';
import { AuditService } from '../../../audit/application/audit.service';
import { ConfirmExpenseUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { reconcileExpenseDuplicateCandidates } from '../../../expenses/application/services/expense-duplicate-detection';
import { PrismaExpenseRepository } from '../../../expenses/infrastructure/prisma-expense.repository';
import type { ReimbursementRequestRecord } from '../../domain/models/reimbursement.model';
import { PrismaReimbursementRepository } from '../../infrastructure/prisma-reimbursement.repository';
import { MaterializeClaimExpensesService } from './materialize-claim-expenses.service';

export type ReimbursementProjectionDecision = {
  kind: 'MANAGER' | 'FINANCE';
  actorUserId: string;
  approvalStepId?: string;
  allowMissingReceiptWithReason: boolean;
  systemReconcile?: boolean;
};

/**
 * Retry-safe cross-domain saga. The reimbursement decision is already durable;
 * this service creates/scans/confirms exact source-line projections and leaves
 * the request non-payable whenever a non-duplicate projection cannot confirm.
 */
@Injectable()
export class ReimbursementProjectionOrchestratorService {
  constructor(
    private readonly reimbursements: PrismaReimbursementRepository,
    private readonly expenses: PrismaExpenseRepository,
    private readonly materialize: MaterializeClaimExpensesService,
    private readonly confirmExpense: ConfirmExpenseUseCase,
    private readonly audit: AuditService,
  ) {}

  async execute(
    ctx: RequestContext,
    request: ReimbursementRequestRecord,
    decision: ReimbursementProjectionDecision,
  ): Promise<void> {
    const scopes = decision.systemReconcile ? {} : (ctx.scopes ?? {});
    const projections = await this.reimbursements.prepareClaimProjections({
      companyId: ctx.companyId,
      requestId: request.id,
      decisionKind: decision.kind,
      decisionActorUserId: decision.actorUserId,
      approvalStepId: decision.approvalStepId,
      scopes,
      systemReconcile: decision.systemReconcile,
      expectedBranchId: request.branchId,
      items: this.materialize.buildItems(request),
    });

    const created = projections.filter((projection) => projection.created);
    if (created.length) {
      await this.audit.log({
        companyId: ctx.companyId,
        actorUserId: decision.actorUserId,
        action: 'reimbursement.claim_expense.materialize',
        targetType: 'reimbursement_request',
        targetId: request.id,
        requestId: ctx.requestId,
        result: 'SUCCESS',
        riskLevel: 'MEDIUM',
        metadataJson: {
          createdCount: created.length,
          expenseIds: created.map((projection) => projection.expenseId),
          sourceLineIds: created.map((projection) => projection.reimbursementLineId),
          systemReconcile: Boolean(decision.systemReconcile),
        },
      });
    }

    for (const projection of projections) {
      const expense = await this.expenses.findByIdWithRelations(ctx.companyId, projection.expenseId, undefined, scopes);
      if (!expense) throw new ConflictException('reimbursement_projection_source_mismatch');
      if (expense.sourceReimbursementRequestId !== request.id
        || expense.sourceReimbursementLineId !== projection.reimbursementLineId
        || (expense.branchId ?? undefined) !== request.branchId) {
        throw new ConflictException('reimbursement_projection_source_mismatch');
      }
      if (expense.status === 'CONFIRMED') continue;
      if (expense.status !== 'READY_FOR_CONFIRMATION') {
        throw new ConflictException('reimbursement_projection_not_ready');
      }

      const duplicate = await reconcileExpenseDuplicateCandidates(
        this.expenses,
        ctx.companyId,
        projection.expenseId,
        decision.actorUserId,
        scopes,
      );
      if (duplicate.duplicateStatus === 'POSSIBLE_DUPLICATE'
        || duplicate.duplicateStatus === 'CONFIRMED_DUPLICATE') {
        continue;
      }
      await this.confirmExpense.executeForReimbursement(ctx, projection.expenseId, {
        reimbursementRequestId: request.id,
        reimbursementLineId: projection.reimbursementLineId,
        branchId: request.branchId,
        allowMissingReceiptWithReason: decision.allowMissingReceiptWithReason,
        systemReconcile: decision.systemReconcile,
      });
    }
  }
}
