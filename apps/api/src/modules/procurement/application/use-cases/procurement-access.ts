import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { isBranchInScope, resolveCreateBranchId } from '../../../data-model-core/domain/logic/branch.logic';

export const PROCUREMENT_RELATED_READ_PERMISSIONS = {
  PURCHASE_REQUEST: 'procurement.purchase_request.read_related',
  PURCHASE_ORDER: 'procurement.purchase_order.read_related',
  GOODS_RECEIPT: 'procurement.goods_receipt.read_related',
  VENDOR_BILL: 'procurement.vendor_bill.read_related',
  SUPPLIER_PAYMENT: 'procurement.supplier_payment.read_related',
} as const;

export function assertProcurementBranchScope(
  ctx: RequestContext,
  branchId: string | null | undefined,
  label = 'Procurement document',
): void {
  if (!isBranchInScope(ctx.scopes ?? {}, branchId)) throw new NotFoundException(`${label} not found`);
}

export function resolveProcurementCreateBranch(
  ctx: RequestContext,
  branchId: string | null | undefined,
): string | undefined {
  if (ctx.scopes?.branchIds?.length === 0 || !isBranchInScope(ctx.scopes ?? {}, branchId)) {
    throw new ForbiddenException('Branch is outside your assigned branch scope.');
  }
  return resolveCreateBranchId(ctx.scopes ?? {}, branchId) ?? undefined;
}
