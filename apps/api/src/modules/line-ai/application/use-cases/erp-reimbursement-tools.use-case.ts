import { lineReplyLanguage, lineUiLabel } from '../../domain/logic/line-language.logic';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { REIMBURSEMENT_DESK_LABELS, type SourceRef, type ToolResult } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { ListApprovalQueueUseCase } from '../../../reimbursements/application/use-cases/reimbursement-approval.use-case';
import { ListReimbursementsUseCase } from '../../../reimbursements/application/use-cases/reimbursement-request.use-case';
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

  constructor(
    private readonly approvalQueue: ListApprovalQueueUseCase,
    private readonly claims: ListReimbursementsUseCase,
  ) {}

  async execute(ctx: ErpToolContext, input: Record<string, unknown> = {}): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    const language = lineReplyLanguage(ctx.groundingText ?? '', ctx.locale.startsWith('en') ? 'en' : 'th');
    const canReadAll = ctx.permissions.includes('reimbursement.read');
    const canReadRelated = ctx.permissions.includes('reimbursement.read_related');
    if (!canReadAll && !canReadRelated && !ctx.permissions.includes('reimbursement.read_own')) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf, errorCode: 'REIMBURSEMENT_APPROVAL_NOT_PERMITTED' };
    }

    // Owner 2026-10-17: reading pending claims uses the web list's read/branch guards;
    // only an explicit "waiting for me to approve" uses the actionable approval queue.
    const forApprover = input.approver === 'me' && ctx.permissions.includes('reimbursement.approve');
    const accessScope = forApprover ? 'approver' : canReadAll ? 'company' : canReadRelated ? 'related' : 'own';
    const page = forApprover ? undefined : await this.claims.execute(toCtx(ctx), { status: 'PENDING_APPROVAL', page: 1, pageSize: 10 });
    const rows = page?.items ?? await this.approvalQueue.execute(toCtx(ctx));
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
        accessScope,
        total: page?.total ?? rows.length,
        items: rows.slice(0, 10).map((row) => ({
          id: row.id,
          documentNumber: row.requestNo ?? null,
          requesterDisplayName: row.requesterDisplayNameSnapshot,
          amount: row.amount,
          currency: row.currency,
          submittedAt: row.submittedAt ?? null,
          status: row.status,
          branch: row.branchId ?? null,
          ...('currentDesk' in row && row.currentDesk ? {
            waitingOn: row.currentDesk.names?.join(language === 'en' ? ' or ' : ' หรือ ') || lineUiLabel(REIMBURSEMENT_DESK_LABELS[row.currentDesk.kind], language),
          } : {}),
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
