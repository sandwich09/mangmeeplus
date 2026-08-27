import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { requireTransactionBranchId } from '../../../data-model-core/application/services/transaction-branch';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { canTransitionPO } from '../../domain/logic/procurement.logic';
import { civilPeriodKey, PROCUREMENT_SEQUENCE_KEYS, todayCivilDate } from '@watchdog-bms/contracts';
import type { PurchaseOrderRecord } from '../../domain/models/procurement.model';
import { assertProcurementBranchScope, PROCUREMENT_RELATED_READ_PERMISSIONS, resolveProcurementCreateBranch } from './procurement-access';

@Injectable()
export class CreatePurchaseOrderUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, dto: {
    supplierId: string; branchId?: string; orderDate: Date; expectedDeliveryDate?: Date; paymentTermsDays?: number;
    currency?: string; matchingMode?: string; sourcePurchaseRequestId?: string;
    subtotalAmount: string; discountAmount: string; taxableAmount: string; vatAmount: string; whtEstimateAmount?: string; grandTotalAmount: string;
    outstandingAmount: string; supplierSnapshotJson?: Record<string, unknown>;
    lines: { lineNumber: number; lineType?: string; productId?: string; description: string; unitName?: string; orderedQuantity: string; unitPrice: string; discountAmount: string; vatMode: string; vatRate?: string; vatAmount: string; whtCategoryCode?: string; whtRate?: string; whtEstimateAmount?: string; lineSubtotalAmount: string; lineTotalAmount: string; accountHint?: string; inventoryLocationId?: string; sourcePurchaseRequestLineId?: string }[];
  }): Promise<PurchaseOrderRecord> {
    if (!ctx.permissions.includes('procurement.purchase_order.create')) throw new ForbiddenException();
    const sourceRequest = dto.sourcePurchaseRequestId
      ? await this.repo.findPurchaseRequestById(ctx.companyId, dto.sourcePurchaseRequestId)
      : null;
    if (dto.sourcePurchaseRequestId && !sourceRequest) throw new BadRequestException('Source purchase request not found');
    if (sourceRequest) {
      assertProcurementBranchScope(ctx, sourceRequest.branchId, 'Purchase request');
      if (sourceRequest.status !== 'APPROVED' || sourceRequest.convertedPurchaseOrderId) {
        throw new BadRequestException('Only an unconverted approved purchase request can be converted');
      }
      if (sourceRequest.supplierId && sourceRequest.supplierId !== dto.supplierId) {
        throw new BadRequestException('Purchase request supplier does not match the purchase order supplier');
      }
      if (sourceRequest.currency !== (dto.currency ?? 'THB')) {
        throw new BadRequestException('Purchase request currency does not match the purchase order currency');
      }
      const sourceLineIds = new Set((sourceRequest.lines ?? []).map((line) => line.id));
      const convertedLineIds = dto.lines.map((line) => line.sourcePurchaseRequestLineId);
      if (
        convertedLineIds.some((id) => !id || !sourceLineIds.has(id))
        || convertedLineIds.length !== sourceLineIds.size
        || new Set(convertedLineIds).size !== sourceLineIds.size
      ) {
        throw new BadRequestException('Purchase order conversion must reference every source purchase request line exactly once');
      }
    }
    if (sourceRequest) requireTransactionBranchId(sourceRequest.branchId);
    const branchId = await resolveProcurementCreateBranch(ctx, dto.branchId ?? sourceRequest?.branchId, this.repo);
    if (sourceRequest?.branchId && sourceRequest.branchId !== branchId) {
      throw new BadRequestException('Purchase request branch does not match the purchase order branch');
    }
    if (branchId && !await this.repo.branchExists(ctx.companyId, branchId)) throw new BadRequestException('Branch does not exist in this company');
    const po = await this.repo.createPurchaseOrder(ctx.companyId, { ...dto, branchId }, ctx.userId);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_order.create', targetType: 'purchase_order', targetId: po.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { supplierId: dto.supplierId, grandTotalAmount: dto.grandTotalAmount } });
    return po;
  }
}

@Injectable()
export class GetPurchaseOrderUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<PurchaseOrderRecord> {
    const canReadAll = ctx.permissions.includes('procurement.purchase_order.read');
    const canReadRelated = ctx.permissions.includes(PROCUREMENT_RELATED_READ_PERMISSIONS.PURCHASE_ORDER);
    if (!canReadAll && !canReadRelated) throw new ForbiddenException();
    const po = await this.repo.findPurchaseOrderById(ctx.companyId, id);
    if (!po) throw new NotFoundException('Purchase order not found');
    assertProcurementBranchScope(ctx, po.branchId, 'Purchase order');
    if (!canReadAll && !await this.repo.isProcurementDocumentRelatedToUser(ctx.companyId, 'PURCHASE_ORDER', id, ctx.userId, ctx.scopes ?? {})) throw new ForbiddenException();
    return po;
  }
}

@Injectable()
export class ListPurchaseOrdersUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, filter: { status?: string; supplierId?: string; branchId?: string; fromDate?: string; toDate?: string; page?: number; pageSize?: number }): Promise<{ data: PurchaseOrderRecord[]; total: number; page: number; pageSize: number }> {
    const canReadAll = ctx.permissions.includes('procurement.purchase_order.read');
    const canReadRelated = ctx.permissions.includes(PROCUREMENT_RELATED_READ_PERMISSIONS.PURCHASE_ORDER);
    if (!canReadAll && !canReadRelated) throw new ForbiddenException();
    // Explicit out-of-scope branch filter is a 403, never a silent empty list (spec R6). Written out
    // rather than via isBranchInScope, which answers true for an absent branchId (spec §4.2).
    if (ctx.scopes?.branchIds && filter.branchId && !ctx.scopes.branchIds.includes(filter.branchId)) throw new ForbiddenException('Branch is out of scope');
    const { data, total } = await this.repo.listPurchaseOrders(ctx.companyId, {
      ...filter, ...(!canReadAll ? { relatedUserId: ctx.userId } : {}),
    }, ctx.scopes ?? {});
    return { data, total, page: filter.page ?? 1, pageSize: filter.pageSize ?? 20 };
  }
}

@Injectable()
export class ApprovePurchaseOrderUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService, private readonly outbox: OutboxAppendService) {}

  async execute(ctx: RequestContext, id: string, note?: string): Promise<PurchaseOrderRecord> {
    if (!ctx.permissions.includes('procurement.purchase_order.approve')) throw new ForbiddenException();
    const po = await this.repo.findPurchaseOrderById(ctx.companyId, id);
    if (!po) throw new NotFoundException('Purchase order not found');
    assertProcurementBranchScope(ctx, po.branchId, 'Purchase order');
    if (!canTransitionPO(po.status, 'APPROVED')) throw new BadRequestException(`Cannot approve from status ${po.status}`);
    const now = new Date();
    const updated = await this.repo.updatePurchaseOrderStatus(ctx.companyId, id, 'APPROVED', { approvedByUserId: ctx.userId, approvedAt: now, updatedByUserId: ctx.userId });
    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'PURCHASE_ORDER', id, 'APPROVED', ctx.userId, note);
    await this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_order.approve', targetType: 'purchase_order', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    void this.outbox.append('purchase_order.approved', 'purchase_order', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'purchase_order', aggregateId: id, occurredAt: now.toISOString(), data: { status: 'APPROVED', grandTotalAmount: po.grandTotalAmount } });
    return updated;
  }
}

@Injectable()
export class IssuePurchaseOrderUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<PurchaseOrderRecord> {
    if (!ctx.permissions.includes('procurement.purchase_order.issue')) throw new ForbiddenException();
    const po = await this.repo.findPurchaseOrderById(ctx.companyId, id);
    if (!po) throw new NotFoundException('Purchase order not found');
    assertProcurementBranchScope(ctx, po.branchId, 'Purchase order');
    if (!canTransitionPO(po.status, 'ISSUED')) throw new BadRequestException(`Cannot issue from status ${po.status}`);

    const now = new Date();
    const periodKey = civilPeriodKey(todayCivilDate(undefined, now));
    const reserved = await this.reserveNumber.execute({ companyId: ctx.companyId, documentType: PROCUREMENT_SEQUENCE_KEYS.PURCHASE_ORDER, periodKey, reservedByUserId: ctx.userId, idempotencyKey: `issue:${id}` });
    const updated = await this.repo.setPurchaseOrderNumber(ctx.companyId, id, reserved.documentNumber, ctx.userId);
    await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'purchase_order', ownerId: id }, ctx.userId);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_order.issue', targetType: 'purchase_order', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { purchaseOrderNumber: reserved.documentNumber } });
    void this.outbox.append('purchase_order.issued', 'purchase_order', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'purchase_order', aggregateId: id, occurredAt: now.toISOString(), data: { status: 'ISSUED', purchaseOrderNumber: reserved.documentNumber } });
    return updated;
  }
}

@Injectable()
export class RejectPurchaseOrderUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, note: string): Promise<PurchaseOrderRecord> {
    if (!ctx.permissions.includes('procurement.purchase_order.approve')) throw new ForbiddenException();
    const po = await this.repo.findPurchaseOrderById(ctx.companyId, id);
    if (!po) throw new NotFoundException('Purchase order not found');
    assertProcurementBranchScope(ctx, po.branchId, 'Purchase order');
    if (!canTransitionPO(po.status, 'REJECTED')) throw new BadRequestException(`Cannot reject from status ${po.status}`);
    const updated = await this.repo.updatePurchaseOrderStatus(ctx.companyId, id, 'REJECTED', { rejectedByUserId: ctx.userId, rejectedAt: new Date(), updatedByUserId: ctx.userId });
    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'PURCHASE_ORDER', id, 'REJECTED', ctx.userId, note);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_order.reject', targetType: 'purchase_order', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { note } });
    return updated;
  }
}

@Injectable()
export class CancelPurchaseOrderUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, reason?: string): Promise<PurchaseOrderRecord> {
    if (!ctx.permissions.includes('procurement.purchase_order.manage')) throw new ForbiddenException();
    const po = await this.repo.findPurchaseOrderById(ctx.companyId, id);
    if (!po) throw new NotFoundException('Purchase order not found');
    assertProcurementBranchScope(ctx, po.branchId, 'Purchase order');
    if (!canTransitionPO(po.status, 'CANCELLED')) throw new BadRequestException(`Cannot cancel from status ${po.status}`);
    const updated = await this.repo.updatePurchaseOrderStatus(ctx.companyId, id, 'CANCELLED', { cancelledByUserId: ctx.userId, cancelledAt: new Date(), cancelReason: reason, updatedByUserId: ctx.userId });
    await this.repo.appendPurchaseApprovalEvent(ctx.companyId, 'PURCHASE_ORDER', id, 'CANCELLED', ctx.userId, reason);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_order.cancel', targetType: 'purchase_order', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { reason } });
    return updated;
  }
}

@Injectable()
export class ClosePurchaseOrderUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, id: string, reason?: string): Promise<PurchaseOrderRecord> {
    if (!ctx.permissions.includes('procurement.purchase_order.manage')) throw new ForbiddenException();
    const po = await this.repo.findPurchaseOrderById(ctx.companyId, id);
    if (!po) throw new NotFoundException('Purchase order not found');
    assertProcurementBranchScope(ctx, po.branchId, 'Purchase order');
    if (!canTransitionPO(po.status, 'CLOSED')) throw new BadRequestException(`Cannot close from status ${po.status}`);
    const updated = await this.repo.updatePurchaseOrderStatus(ctx.companyId, id, 'CLOSED', { closedByUserId: ctx.userId, closedAt: new Date(), closeReason: reason, updatedByUserId: ctx.userId });
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.purchase_order.close', targetType: 'purchase_order', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { reason } });
    return updated;
  }
}
