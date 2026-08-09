import { Injectable, ForbiddenException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaMovementRepository } from '../../infrastructure/repositories/prisma-movement.repository';
import { PrismaBalanceQuery } from '../../infrastructure/queries/balance.query';
import { PrismaProductRepository } from '../../infrastructure/repositories/prisma-product.repository';
import { PrismaLocationRepository } from '../../infrastructure/repositories/prisma-location.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import {
  movementDirection,
  requiresReason,
  validateQuantity,
  wouldGoNegative,
} from '../../domain/logic/stock-movement.logic';
import type { StockMovement, StockMovementType } from '../../domain/models/inventory.model';
import { buildPeriodKey } from '../../../data-model-core/domain/logic/document-sequence.logic';

export type CreateMovementCommand = {
  productId: string;
  locationId: string;
  movementType: StockMovementType;
  quantity: string;
  reason?: string;
  referenceType?: string;
  referenceId?: string;
};

@Injectable()
export class CreateMovementUseCase {
  constructor(
    private readonly movements: PrismaMovementRepository,
    private readonly balance: PrismaBalanceQuery,
    private readonly products: PrismaProductRepository,
    private readonly locations: PrismaLocationRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxAppendService,
    private readonly reserveDocumentNumber: ReserveDocumentNumberUseCase,
    private readonly commitDocumentNumber: CommitDocumentNumberUseCase,
  ) {}

  async execute(ctx: RequestContext, cmd: CreateMovementCommand): Promise<StockMovement> {
    // Permission check
    const hasCreate = ctx.permissions.includes('inventory.movement.create');
    const hasAdjust = ctx.permissions.includes('inventory.movement.adjust');
    const isAdjustType = cmd.movementType.includes('ADJUSTMENT');
    if (isAdjustType && !hasAdjust) throw new ForbiddenException();
    if (!isAdjustType && !hasCreate) throw new ForbiddenException();
    if (cmd.movementType === 'TRANSFER_IN' || cmd.movementType === 'TRANSFER_OUT' || cmd.movementType.includes('COUNT_ADJUSTMENT')) {
      throw new BadRequestException('Use transfer or stock count endpoint for this movement type');
    }

    // Validation
    const qtyErr = validateQuantity(cmd.quantity);
    if (qtyErr) throw new BadRequestException(qtyErr);
    if (requiresReason(cmd.movementType) && !cmd.reason?.trim()) {
      throw new BadRequestException('Reason is required for adjustment movements');
    }

    const direction = movementDirection(cmd.movementType);
    await this.assertActiveStockTarget(ctx, cmd.productId, cmd.locationId);

    // Negative stock check
    if (direction === 'OUT') {
      const bal = await this.balance.getBalance(ctx.companyId, cmd.productId, cmd.locationId);
      if (wouldGoNegative(bal.quantity, cmd.quantity)) {
        void this.auditNegativeStock(ctx, cmd, bal.quantity);
        throw new ConflictException(`Insufficient stock. Available: ${bal.quantity}, requested: ${cmd.quantity}`);
      }
    }

    const reserved = await this.reserveMovementNumber(ctx, `${cmd.productId}:${cmd.locationId}:${cmd.movementType}`);
    let movement: StockMovement;
    try {
      movement = await this.movements.create({
        companyId: ctx.companyId,
        movementNumber: reserved?.documentNumber,
        productId: cmd.productId,
        locationId: cmd.locationId,
        movementType: cmd.movementType,
        direction,
        quantity: cmd.quantity,
        reason: cmd.reason,
        referenceType: cmd.referenceType,
        referenceId: cmd.referenceId,
        actorUserId: ctx.userId,
      });
    } catch (error) {
      if (error instanceof ConflictException) void this.auditNegativeStock(ctx, cmd, 'race-checked');
      throw error;
    }

    if (reserved) {
      void this.commitDocumentNumber.execute(
        { companyId: ctx.companyId, id: reserved.id, ownerType: 'stockMovement', ownerId: movement.id },
        ctx.userId,
      );
    }

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.movement.created', targetType: 'stockMovement', targetId: movement.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    void this.outbox.append('inventory.movement.created', 'stockMovement', movement.id, {
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      aggregateType: 'stockMovement',
      aggregateId: movement.id,
      occurredAt: movement.occurredAt.toISOString(),
      data: { movementType: movement.movementType, productId: movement.productId, locationId: movement.locationId, quantity: movement.quantity },
    });

    return movement;
  }

  // Target validation without the write, for callers that create their stock
  // movements inside their own transaction (goods-receipt posting). An archived
  // or non-stockable product, an archived location, and a location outside the
  // caller's branch scope stay rejected; only the insert moved.
  async assertStockTargets(ctx: RequestContext, targets: Array<{ productId: string; locationId: string }>): Promise<void> {
    const seen = new Set<string>();
    for (const target of targets) {
      const key = `${target.productId}:${target.locationId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await this.assertActiveStockTarget(ctx, target.productId, target.locationId);
    }
  }

  private async assertActiveStockTarget(ctx: RequestContext, productId: string, locationId: string): Promise<void> {
    const [product, location] = await Promise.all([
      this.products.findById(ctx.companyId, productId),
      this.locations.findById(ctx.companyId, locationId),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!location) throw new NotFoundException('Location not found');
    if (ctx.scopes.branchIds && location.branchId && !ctx.scopes.branchIds.includes(location.branchId)) throw new ForbiddenException();
    if (product.status !== 'ACTIVE') throw new ConflictException('Archived product cannot receive movements');
    if (product.kind !== 'STOCKABLE') throw new BadRequestException('Only stockable products can receive stock movements');
    if (location.status !== 'ACTIVE') throw new ConflictException('Archived location cannot receive movements');
  }

  private async reserveMovementNumber(ctx: RequestContext, key: string) {
    try {
      const now = new Date();
      return await this.reserveDocumentNumber.execute({
        companyId: ctx.companyId,
        documentType: 'inventory.movement',
        periodKey: buildPeriodKey('MONTHLY', now),
        idempotencyKey: `${ctx.requestId}:${key}`,
        reservedByUserId: ctx.userId,
      });
    } catch {
      return null;
    }
  }

  private auditNegativeStock(ctx: RequestContext, cmd: CreateMovementCommand, available: string): void {
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'inventory.negative_stock.denied',
      targetType: 'stockMovement',
      requestId: ctx.requestId,
      result: 'DENIED',
      riskLevel: 'HIGH',
      metadataJson: { productId: cmd.productId, locationId: cmd.locationId, requested: cmd.quantity, available },
    });
  }
}
