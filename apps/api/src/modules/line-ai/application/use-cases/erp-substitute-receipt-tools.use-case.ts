import { Injectable } from '@nestjs/common';
import type { SourceRef, ToolResult } from '@watchdog-bms/contracts';
import type { ErpReadToolPort, ErpToolContext } from '../../domain/ports/erp-read-tool.port';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { ListMySubstituteReceiptSignaturesUseCase } from '../../../expenses/application/use-cases/substitute-receipt.use-case';
import { BUSINESS_READ_BASIS_VERSION, appliedQuery, completeResult } from '../../domain/logic/business-read-source.logic';

const MAX_ITEMS_PER_STEP = 10;

/** The caller's REAL roles reach the use case: self-approval — a one-person shop approving what it paid
 *  itself — depends on them, and the shared `toCtx` of the other ERP tools sends `roles: []`. */
function requestContext(ctx: ErpToolContext): RequestContext {
  return {
    requestId: ctx.requestId ?? '', authSubject: ctx.userId, userId: ctx.userId,
    companyId: ctx.companyId, membershipId: ctx.membershipId ?? '', roles: ctx.roles ?? [],
    permissions: ctx.permissions, scopes: { branchIds: ctx.branchIds, locationIds: ctx.locationIds },
    authProvider: 'line',
  };
}

/** Advisor spec §5.2 (slice S1): substitute receipts waiting for THIS caller's own signature, as the payer
 *  or as an approver. Reads the queue only — certifying and approving stay on the web (assertWeb). */
@Injectable()
export class ExpenseListSubstituteReceiptsToSignTool implements ErpReadToolPort {
  toolName = 'expense.list_substitute_receipts_to_sign';

  constructor(private readonly queue: ListMySubstituteReceiptSignaturesUseCase) {}

  async execute(ctx: ErpToolContext, input: { role?: unknown; limit?: unknown } = {}): Promise<ToolResult> {
    const asOf = new Date().toISOString();
    if (!['expense.read_related', 'expense.read_own', 'expense.confirm'].some((permission) => ctx.permissions.includes(permission))) {
      return { toolName: this.toolName, status: 'forbidden', sourceRefs: [], asOf };
    }
    const role = input.role === 'payer' || input.role === 'approver' ? input.role : undefined;
    const requested = Number(input.limit);
    const limit = Number.isInteger(requested) ? Math.min(MAX_ITEMS_PER_STEP, Math.max(1, requested)) : MAX_ITEMS_PER_STEP;
    const queue = await this.queue.execute(requestContext(ctx), { ...(role ? { role } : {}), limit });
    const steps = [queue.asPayer, queue.asApprover].filter((step) => step !== undefined);
    // Every figure the answer may state is here, the sum of both steps included (spec §5.0).
    const total = steps.reduce((sum, step) => sum + step.count, 0);
    const returned = steps.reduce((sum, step) => sum + step.items.length, 0);
    const sourceRefs: SourceRef[] = [{
      label: 'ใบรับรองแทนใบเสร็จ', module: 'expenses', entityType: 'substitute_receipt_queue', asOf, permissionChecked: true,
      webPath: `/companies/${ctx.companyId}/expenses/substitute-receipts`,
    }];
    return {
      toolName: this.toolName, status: 'ok', asOf, sourceRefs,
      data: { accessScope: 'own', total, ...queue },
      queryApplied: appliedQuery(undefined, {
        branch: { mode: 'all_authorized', branchId: null }, dateBasis: 'current_state',
        statusBasis: 'waiting_for_caller_signature_or_approval', dataset: 'expense_substitute_receipts', accessScope: 'own',
        ...(role ? { filters: { role } } : {}),
      }),
      basisVersion: BUSINESS_READ_BASIS_VERSION,
      completeness: completeResult(returned, returned < total),
    };
  }
}
