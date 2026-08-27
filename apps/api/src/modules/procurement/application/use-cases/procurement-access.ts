import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { isBranchInScope } from '../../../data-model-core/domain/logic/branch.logic';
import type { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';

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

export async function resolveProcurementCreateBranch(
  ctx: RequestContext,
  branchId: string | null | undefined,
  repo: PrismaProcurementRepository,
): Promise<string> {
  if (ctx.scopes?.branchIds?.length === 0 || !isBranchInScope(ctx.scopes ?? {}, branchId)) {
    throw new ForbiddenException('Branch is outside your assigned branch scope.');
  }
  return repo.resolveCreateBranchId(ctx.companyId, ctx.scopes ?? {}, branchId);
}
