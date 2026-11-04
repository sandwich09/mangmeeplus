import { Injectable } from '@nestjs/common';
import type { LineWorkflowId, ReimbursementRequestSummary, RequestContext } from '@watchdog-bms/contracts';
import { ListReimbursementsUseCase } from '../../reimbursements/application/use-cases/reimbursement-request.use-case';
import { canTransition } from '../../reimbursements/domain/logic/reimbursement.logic';
import { LineExpenseActionService, type ExpenseAction } from './line-expense-action.service';

import { CLAIM_WORKFLOW_ACTIONS, type ClaimWorkflowId } from '../domain/logic/line-reimbursement-approval-control.logic';

export type LineWorkflowTargets = { targets: ReimbursementRequestSummary[]; total: number; exhaustive: boolean };

@Injectable()
export class LineWorkflowTargetService {
  constructor(private readonly claims: ListReimbursementsUseCase, private readonly actions: LineExpenseActionService) {}

  async pick(ctx: RequestContext, _chat: string, workflow: LineWorkflowId,
    slots: { search?: string }, _page: number): Promise<LineWorkflowTargets> {
    if (ctx.freeExpenseDrafts || !Object.hasOwn(CLAIM_WORKFLOW_ACTIONS, workflow)) return { targets: [], total: 0, exhaustive: true };
    const act = CLAIM_WORKFLOW_ACTIONS[workflow as ClaimWorkflowId];
    const targets = new Map<string, ReimbursementRequestSummary>();
    let total = 0, scanned = 0;
    for (let page = 1; page <= 3; page++) {
      const result = await this.claims.execute(ctx, { page, pageSize: 100, search: slots.search,
        ...(act === 'REIMBURSEMENT_SUBMIT' ? { bucket: 'draft' as const }
          : act === 'REIMBURSEMENT_RECORD_PAYMENT' ? { bucket: 'payment' as const }
            : act === 'REIMBURSEMENT_APPROVE' || act === 'REIMBURSEMENT_REJECT' ? { status: 'PENDING_APPROVAL' as const } : {}) });
      total = result.total;
      scanned += result.items.length;
      for (const claim of result.items) {
        if (claim.cancellationPending) continue;
        const allowed = act === 'REIMBURSEMENT_APPROVE' ? claim.approvalActions?.canApprove
          : act === 'REIMBURSEMENT_REJECT' ? claim.approvalActions?.canReject
            : act === 'REIMBURSEMENT_SUBMIT' ? await this.actions.canSubmitClaim(ctx, claim.id)
              : (act !== 'REIMBURSEMENT_CANCEL' || canTransition(claim.status, 'CANCELLED'))
                && await this.actions.permitted(ctx, { expenseId: claim.id, createdByUserId: claim.requesterUserId, preview: { action: act as ExpenseAction } });
        if (allowed) targets.set(claim.id, claim);
      }
      if (page * 100 >= total) break;
    }
    return { targets: [...targets.values()], total, exhaustive: total <= 300 && scanned >= total };
  }
}
