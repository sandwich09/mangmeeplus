import { ForbiddenException, Injectable } from '@nestjs/common';
import type { SourceRef, ToolResult } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { ListApprovalQueueUseCase } from '../../../reimbursements/application/use-cases/reimbursement-approval.use-case';
import { GetReimbursementApprovalBacklogUseCase } from '../../../reimbursements/application/use-cases/reimbursement-summary.use-case';
import { BUSINESS_READ_BASIS_VERSION, appliedQuery, completeResult } from '../../domain/logic/business-read-source.logic';

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
    // Item 3 (223-turn eval batch 2, T-143): a bare 'forbidden' gave the caller nothing to render,
    // so a STAFF user asking for the approval queue got their own claims summary instead (either a
    // silent fallback to a different tool, or a swap the model made on its own) with no statement
    // that they cannot see the queue at all. A typed errorCode survives the gateway's
    // enforceSourceHonesty boundary (non-'ok' results keep only toolName/status/sourceRefs/asOf/
    // errorCode/errorMessage) so the gateway can render an honest "คุณไม่มีสิทธิ์ดูรายการรออนุมัติ"
    // instead of any answer shaped like the approval queue.
    if (!ctx.permissions.includes('reimbursement.approve')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf, errorCode: 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED' };
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

/**
 * "ใบเบิกค้างที่ใคร" (advisor spec §5.3). Scope, branch and active-approver rules live in the use case;
 * this adapter only shapes the result. The caller's roles ride along like the approval queue above.
 */
@Injectable()
export class ReimbursementGetApprovalBacklogTool implements ErpReadToolPort {
  toolName = 'reimbursement.get_approval_backlog';

  constructor(private readonly backlog: GetReimbursementApprovalBacklogUseCase) {}

  async execute(ctx: ErpToolContext, input: { requester?: unknown } = {}): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    const mine = input.requester === 'me';
    let data;
    try {
      data = await this.backlog.execute(toCtx(ctx), mine ? { requester: 'me' } : {});
    } catch (error) {
      if (error instanceof ForbiddenException) return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
      throw error;
    }
    return {
      toolName: this.toolName,
      status: 'ok',
      data,
      // The first source is the customer's link (spec §2.7): the web claim list shows "อยู่ที่ …" on every row.
      sourceRefs: [{ label: 'ใบเบิกที่ยังรออยู่', module: 'reimbursements', entityType: 'reimbursement_approval_backlog',
        asOf, permissionChecked: true, webPath: `/companies/${ctx.companyId}/reimbursements` }],
      asOf,
      queryApplied: appliedQuery(undefined, {
        dateBasis: 'submitted_or_approved_thai_day', statusBasis: 'waiting_claims', dataset: 'reimbursement_requests',
        accessScope: data.accessScope, ...(mine ? { filters: { requester: 'me' } } : {}),
      }),
      basisVersion: BUSINESS_READ_BASIS_VERSION,
      completeness: completeResult(data.items.length, data.total > data.items.length,
        data.byApprover.length + data.desks.length + (data.sharedPile ? 1 : 0)),
    };
  }
}
