import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { CreateMovementUseCase } from '../../../inventory/application/use-cases/create-movement.use-case';
import { PROCUREMENT_SEQUENCE_KEYS } from '@watchdog-bms/contracts';
import type { GoodsReceiptRecord } from '../../domain/models/procurement.model';

@Injectable()
export class CreateGoodsReceiptUseCase {
  constructor(private readonly repo: PrismaProcurementRepository, private readonly audit: AuditService) {}

  async execute(ctx: RequestContext, dto: {
    purchaseOrderId: string; supplierId: string; branchId?: string; receivedAt: Date;
    note?: string; supplierSnapshotJson?: Record<string, unknown>;
    lines: { purchaseOrderLineId: string; lineNumber: number; lineType?: string; productId?: string; description: string; inventoryLocationId?: string; orderedQuantity: string; previouslyReceivedQuantity: string; receivedQuantity: string; acceptedQuantity: string; rejectedQuantity?: string; unitName?: string; varianceReason?: string }[];
  }): Promise<GoodsReceiptRecord> {
    if (!ctx.permissions.includes('procurement.goods_receipt.create')) throw new ForbiddenException();
    const gr = await this.repo.createGoodsReceipt(ctx.companyId, dto, ctx.userId);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.goods_receipt.create', targetType: 'goods_receipt', targetId: gr.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'LOW', metadataJson: { purchaseOrderId: dto.purchaseOrderId } });
    return gr;
  }
}

@Injectable()
export class GetGoodsReceiptUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, id: string): Promise<GoodsReceiptRecord> {
    if (!ctx.permissions.includes('procurement.goods_receipt.read')) throw new ForbiddenException();
    const gr = await this.repo.findGoodsReceiptById(ctx.companyId, id);
    if (!gr) throw new NotFoundException('Goods receipt not found');
    return gr;
  }
}

@Injectable()
export class ListGoodsReceiptsUseCase {
  constructor(private readonly repo: PrismaProcurementRepository) {}

  async execute(ctx: RequestContext, filter: { status?: string; purchaseOrderId?: string; supplierId?: string; branchId?: string; page?: number; pageSize?: number }): Promise<{ data: GoodsReceiptRecord[]; total: number; page: number; pageSize: number }> {
    if (!ctx.permissions.includes('procurement.goods_receipt.read')) throw new ForbiddenException();
    const { data, total } = await this.repo.listGoodsReceipts(ctx.companyId, filter);
    return { data, total, page: filter.page ?? 1, pageSize: filter.pageSize ?? 20 };
  }
}

@Injectable()
export class PostGoodsReceiptUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly createMovement: CreateMovementUseCase,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveNumber: ReserveDocumentNumberUseCase,
    private readonly commitNumber: CommitDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, id: string): Promise<GoodsReceiptRecord> {
    if (!ctx.permissions.includes('procurement.goods_receipt.post')) throw new ForbiddenException();
    const gr = await this.repo.findGoodsReceiptById(ctx.companyId, id);
    if (!gr) throw new NotFoundException('Goods receipt not found');
    if (gr.status !== 'DRAFT') throw new BadRequestException(`Cannot post goods receipt with status ${gr.status}`);

    const stockLines = (gr.lines ?? []).filter((line) => line.lineType === 'STOCK' && line.productId && line.inventoryLocationId && Number(line.acceptedQuantity) > 0);
    // The movement rows are written inside the receipt's own transaction now, so
    // their product/location validation has to be asked for explicitly.
    await this.createMovement.assertStockTargets(ctx, stockLines.map((line) => ({ productId: line.productId!, locationId: line.inventoryLocationId! })));

    const now = new Date();
    const periodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const reserved = await this.reserveNumber.execute({ companyId: ctx.companyId, documentType: PROCUREMENT_SEQUENCE_KEYS.GOODS_RECEIPT, periodKey, reservedByUserId: ctx.userId, idempotencyKey: `post:${id}` });

    // One movement number per receipt line, keyed by line id. Keying on
    // product + location instead hands two stock lines for the same product and
    // location the same reservation — reserveNumber replays an existing
    // idempotency key — and so the same movementNumber, which the
    // StockMovement @@unique([companyId, movementNumber]) index then rejects.
    const movementReservations = await Promise.all(stockLines.map(async (line) => ({
      lineId: line.id,
      reservation: await this.reserveMovementNumber(ctx, periodKey, `gr:${id}:${line.id}`),
    })));
    const movementNumbers = Object.fromEntries(movementReservations.map((entry) => [entry.lineId, entry.reservation?.documentNumber]));

    const batchRef = `gr:${id}:${reserved.documentNumber}`;
    const { goodsReceipt: posted, movements } = await this.repo.postGoodsReceiptWithInventory(ctx.companyId, id, reserved.documentNumber, batchRef, ctx.userId, movementNumbers);
    await this.commitNumber.execute({ id: reserved.id, companyId: ctx.companyId, ownerType: 'goods_receipt', ownerId: id }, ctx.userId);

    const movementIdByLine = new Map(movements.map((movement) => [movement.lineId, movement.movementId]));
    for (const { lineId, reservation } of movementReservations) {
      const movementId = movementIdByLine.get(lineId);
      if (reservation && movementId) void this.commitNumber.execute({ companyId: ctx.companyId, id: reservation.id, ownerType: 'stockMovement', ownerId: movementId }, ctx.userId);
    }
    // CreateMovementUseCase emitted these per movement; keep emitting them so
    // inventory readers do not go quiet on goods-receipt posts.
    for (const line of stockLines) {
      const movementId = movementIdByLine.get(line.id);
      if (!movementId) continue;
      void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.movement.created', targetType: 'stockMovement', targetId: movementId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
      void this.outbox.append('inventory.movement.created', 'stockMovement', movementId, {
        companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
        aggregateType: 'stockMovement', aggregateId: movementId, occurredAt: now.toISOString(),
        data: { movementType: 'STOCK_IN', productId: line.productId, locationId: line.inventoryLocationId, quantity: line.acceptedQuantity },
      });
    }

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.goods_receipt.post', targetType: 'goods_receipt', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM', metadataJson: { goodsReceiptNumber: reserved.documentNumber, purchaseOrderId: gr.purchaseOrderId } });
    void this.outbox.append('goods_receipt.posted', 'goods_receipt', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'goods_receipt', aggregateId: id, occurredAt: now.toISOString(), data: { status: 'POSTED', purchaseOrderId: gr.purchaseOrderId, goodsReceiptNumber: reserved.documentNumber } });
    return posted;
  }

  // Same tolerance CreateMovementUseCase applies: a company with no
  // inventory.movement sequence still posts, with a null movementNumber.
  //
  // Deliberately no cancel path when the post transaction throws. reserveNumber
  // replays a matching idempotency key whatever its status, so leaving the row
  // RESERVED lets a retry reuse and commit it, and the key's
  // @@unique([companyId, documentType, idempotencyKey]) caps the residue at one
  // row per receipt line. Cancelling instead would hand the retry a CANCELLED
  // reservation whose number the movements are written with, and whose commit
  // then throws 'Only RESERVED document numbers can be committed'.
  // VoidVendorBillUseCase can cancel because its key carries Date.now(), buying
  // that at the cost of burning a number per attempt; posting would rather keep
  // a line's movement number stable across retries.
  private async reserveMovementNumber(ctx: RequestContext, periodKey: string, idempotencyKey: string) {
    try {
      return await this.reserveNumber.execute({ companyId: ctx.companyId, documentType: 'inventory.movement', periodKey, idempotencyKey, reservedByUserId: ctx.userId });
    } catch {
      return null;
    }
  }
}

@Injectable()
export class VoidGoodsReceiptUseCase {
  constructor(
    private readonly repo: PrismaProcurementRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
  ) {}

  async execute(ctx: RequestContext, id: string, reason: string): Promise<GoodsReceiptRecord> {
    if (!ctx.permissions.includes('procurement.goods_receipt.void')) throw new ForbiddenException();
    const gr = await this.repo.findGoodsReceiptById(ctx.companyId, id);
    if (!gr) throw new NotFoundException('Goods receipt not found');
    if (gr.status !== 'POSTED') throw new BadRequestException(`Cannot void goods receipt with status ${gr.status}`);

    // The reversal is transaction-coupled inside the repository: reversing
    // STOCK_OUT movements, the PO received-quantity rollback, and the status
    // claim commit together, and a reversal that would drive stock negative
    // fails the whole void closed with `inventory_reversal_unavailable`.
    const { goodsReceipt, reversalMovements } = await this.repo.voidGoodsReceiptTrueReversal(ctx.companyId, id, ctx.userId, reason);
    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'procurement.goods_receipt.void', targetType: 'goods_receipt', targetId: id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH', metadataJson: { reason, purchaseOrderId: gr.purchaseOrderId, reversalMovements } });
    void this.outbox.append('goods_receipt.voided', 'goods_receipt', id, { companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId, aggregateType: 'goods_receipt', aggregateId: id, occurredAt: new Date().toISOString(), data: { status: 'VOIDED', reason, purchaseOrderId: gr.purchaseOrderId, reversalMovements } });
    return goodsReceipt;
  }
}
