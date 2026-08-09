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
import { validateQuantity, countAdjustmentDirection, decimalDifference, parseDecimalUnits } from '../../domain/logic/stock-movement.logic';
import type { StockMovement } from '../../domain/models/inventory.model';
import { buildPeriodKey } from '../../../data-model-core/domain/logic/document-sequence.logic';

export type StockCountCommand = {
  productId: string;
  locationId: string;
  countedQuantity: string;
  reason: string;
};

@Injectable()
export class StockCountUseCase {
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

  async execute(ctx: RequestContext, cmd: StockCountCommand): Promise<StockMovement | null> {
    if (!ctx.permissions.includes('inventory.stock_count.create')) throw new ForbiddenException();

    const qtyErr = validateQuantity(cmd.countedQuantity);
    if (qtyErr) throw new BadRequestException(qtyErr);
    if (!cmd.reason?.trim()) throw new BadRequestException('Reason is required for stock count');
    await this.assertActiveStockTarget(ctx, cmd.productId, cmd.locationId);

    const bal = await this.balance.getBalance(ctx.companyId, cmd.productId, cmd.locationId);

    const currentUnits = parseDecimalUnits(bal.quantity) ?? 0n;
    const countedUnits = parseDecimalUnits(cmd.countedQuantity) ?? 0n;

    const direction = countAdjustmentDirection(currentUnits, countedUnits);

    if (direction === 'NONE') {
      // No movement needed; count matches
      return null;
    }

    const delta = decimalDifference(cmd.countedQuantity, bal.quantity);
    const movementType = direction === 'IN' ? 'COUNT_ADJUSTMENT_IN' : 'COUNT_ADJUSTMENT_OUT';
    const reserved = await this.reserveMovementNumber(ctx, `${cmd.productId}:${cmd.locationId}:count`);

    const movement = await this.movements.create({
      companyId: ctx.companyId,
      movementNumber: reserved?.documentNumber,
      productId: cmd.productId,
      locationId: cmd.locationId,
      movementType,
      direction,
      quantity: delta,
      reason: cmd.reason,
      actorUserId: ctx.userId,
    });

    if (reserved) {
      void this.commitDocumentNumber.execute({ companyId: ctx.companyId, id: reserved.id, ownerType: 'stockMovement', ownerId: movement.id }, ctx.userId);
    }

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.stock_count.created', targetType: 'stockMovement', targetId: movement.id, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'HIGH' });
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
}
