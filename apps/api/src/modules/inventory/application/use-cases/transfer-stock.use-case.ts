import { Injectable, ForbiddenException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaMovementRepository } from '../../infrastructure/repositories/prisma-movement.repository';
import { PrismaBalanceQuery } from '../../infrastructure/queries/balance.query';
import { PrismaProductRepository } from '../../infrastructure/repositories/prisma-product.repository';
import { PrismaLocationRepository } from '../../infrastructure/repositories/prisma-location.repository';
import { AuditService } from '../../../audit/application/audit.service';
import { OutboxAppendService } from '../../../data-model-core/application/services/outbox-append.service';
import { ReserveDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/reserve-document-number.use-case';
import { CommitDocumentNumberUseCase } from '../../../data-model-core/application/use-cases/commit-document-number.use-case';
import { validateQuantity, wouldGoNegative } from '../../domain/logic/stock-movement.logic';
import type { StockMovement } from '../../domain/models/inventory.model';
import { buildPeriodKey } from '../../../data-model-core/domain/logic/document-sequence.logic';

export type TransferStockCommand = {
  productId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: string;
  reason?: string;
};

@Injectable()
export class TransferStockUseCase {
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

  async execute(ctx: RequestContext, cmd: TransferStockCommand): Promise<StockMovement[]> {
    if (!ctx.permissions.includes('inventory.movement.create')) throw new ForbiddenException();

    const qtyErr = validateQuantity(cmd.quantity);
    if (qtyErr) throw new BadRequestException(qtyErr);
    if (cmd.fromLocationId === cmd.toLocationId) throw new BadRequestException('Source and destination locations must be different');
    await this.assertActiveTransferTarget(ctx, cmd);

    const bal = await this.balance.getBalance(ctx.companyId, cmd.productId, cmd.fromLocationId);
    if (wouldGoNegative(bal.quantity, cmd.quantity)) {
      void this.auditNegativeStock(ctx, cmd, bal.quantity);
      throw new ConflictException(`Insufficient stock at source. Available: ${bal.quantity}, requested: ${cmd.quantity}`);
    }

    const transferGroupId = randomUUID();
    const [outNumber, inNumber] = await Promise.all([
      this.reserveMovementNumber(ctx, `${transferGroupId}:out`),
      this.reserveMovementNumber(ctx, `${transferGroupId}:in`),
    ]);

    let outMovement!: StockMovement;
    let inMovement!: StockMovement;
    try {
      [outMovement, inMovement] = await this.movements.createMany([
        {
          companyId: ctx.companyId,
          movementNumber: outNumber?.documentNumber,
          productId: cmd.productId,
          locationId: cmd.fromLocationId,
          movementType: 'TRANSFER_OUT',
          direction: 'OUT',
          quantity: cmd.quantity,
          reason: cmd.reason,
          transferGroupId,
          actorUserId: ctx.userId,
        },
        {
          companyId: ctx.companyId,
          movementNumber: inNumber?.documentNumber,
          productId: cmd.productId,
          locationId: cmd.toLocationId,
          movementType: 'TRANSFER_IN',
          direction: 'IN',
          quantity: cmd.quantity,
          reason: cmd.reason,
          transferGroupId,
          actorUserId: ctx.userId,
        },
      ]);
    } catch (error) {
      if (error instanceof ConflictException) void this.auditNegativeStock(ctx, cmd, 'race-checked');
      throw error;
    }

    if (outNumber) {
      void this.commitDocumentNumber.execute({ companyId: ctx.companyId, id: outNumber.id, ownerType: 'stockMovement', ownerId: outMovement.id }, ctx.userId);
    }
    if (inNumber) {
      void this.commitDocumentNumber.execute({ companyId: ctx.companyId, id: inNumber.id, ownerType: 'stockMovement', ownerId: inMovement.id }, ctx.userId);
    }

    void this.audit.log({ companyId: ctx.companyId, actorUserId: ctx.userId, action: 'inventory.movement.created', targetType: 'stockMovement', targetId: transferGroupId, requestId: ctx.requestId, result: 'SUCCESS', riskLevel: 'MEDIUM' });
    void this.outbox.append('inventory.movement.created', 'stockMovement', transferGroupId, {
      companyId: ctx.companyId, actorUserId: ctx.userId, requestId: ctx.requestId,
      aggregateType: 'stockMovement', aggregateId: transferGroupId,
      occurredAt: new Date().toISOString(),
      data: { productId: cmd.productId, fromLocationId: cmd.fromLocationId, toLocationId: cmd.toLocationId, quantity: cmd.quantity },
    });

    return [outMovement, inMovement];
  }

  private async assertActiveTransferTarget(ctx: RequestContext, cmd: TransferStockCommand): Promise<void> {
    const [product, fromLocation, toLocation] = await Promise.all([
      this.products.findById(ctx.companyId, cmd.productId),
      this.locations.findById(ctx.companyId, cmd.fromLocationId),
      this.locations.findById(ctx.companyId, cmd.toLocationId),
    ]);
    if (!product) throw new NotFoundException('Product not found');
    if (!fromLocation || !toLocation) throw new NotFoundException('Location not found');
    if (ctx.scopes.branchIds) {
      const scopedOut = [fromLocation, toLocation].some((location) => location.branchId && !ctx.scopes.branchIds!.includes(location.branchId));
      if (scopedOut) throw new ForbiddenException();
    }
    if (product.status !== 'ACTIVE') throw new ConflictException('Archived product cannot receive movements');
    if (product.kind !== 'STOCKABLE') throw new BadRequestException('Only stockable products can receive stock movements');
    if (fromLocation.status !== 'ACTIVE' || toLocation.status !== 'ACTIVE') throw new ConflictException('Archived location cannot receive movements');
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

  private auditNegativeStock(ctx: RequestContext, cmd: TransferStockCommand, available: string): void {
    void this.audit.log({
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      action: 'inventory.negative_stock.denied',
      targetType: 'stockMovement',
      requestId: ctx.requestId,
      result: 'DENIED',
      riskLevel: 'HIGH',
      metadataJson: { productId: cmd.productId, locationId: cmd.fromLocationId, requested: cmd.quantity, available },
    });
  }
}
