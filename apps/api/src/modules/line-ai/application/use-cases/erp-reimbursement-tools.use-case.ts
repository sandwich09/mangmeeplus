import { Injectable } from '@nestjs/common';
import type { SourceRef, ToolResult } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { ListApprovalQueueUseCase } from '../../../reimbursements/application/use-cases/reimbursement-approval.use-case';

function toCtx(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId,
    companyId: ctx.companyId, membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [],
    permissions: ctx.permissions, scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds },
    authProvider: 'watchdog',
  };
}

@Injectable()
export class ReimbursementListPendingApprovalsTool implements ErpReadToolPort {
  toolName = 'reimbursement.list_pending_approvals';

  // The web approval queue is `ListApprovalQueueUseCase`: it needs `reimbursement.approve` and
  // returns only the rows this approver may act on (branch scope + eligible approval step). This
  // tool used to gate on `reimbursement.read` and read the repository directly, so any reader got
  // the whole company's pending queue over LINE — a wider answer than the same person can see on
  // the web. Going through the use case keeps the scoping correct by construction.
  constructor(private readonly approvalQueue: ListApprovalQueueUseCase) {}

  async execute(ctx: ErpToolContext, _input?: Record<string, unknown>): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    if (!ctx.permissions.includes('reimbursement.approve')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }

    const rows = await this.approvalQueue.execute(toCtx(ctx));
    const sourceRefs: SourceRef[] = [{
      label: 'รายการเบิกจ่ายรออนุมัติ',
      module: 'reimbursements',
      entityType: 'reimbursement_approval_queue',
      asOf,
      permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/reimbursements`,
    }];

    return {
      toolName: this.toolName,
      status: 'ok',
      data: {
        total: rows.length,
        items: rows.slice(0, 10).map((row) => ({
          id: row.id,
          documentNumber: row.requestNo ?? null,
          requesterDisplayName: row.requesterDisplayNameSnapshot,
          amount: row.amount,
          currency: row.currency,
          submittedAt: row.submittedAt ?? null,
          status: row.status,
          branch: row.branchId ?? null,
        })),
      },
      sourceRefs,
      asOf,
    };
  }
}
