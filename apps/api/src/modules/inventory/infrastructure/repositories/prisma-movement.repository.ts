import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { MovementRepositoryPort, CreateMovementInput, ListMovementsFilter, MovementPage } from '../../domain/ports/inventory.repository.port';
import type { StockMovement } from '../../domain/models/inventory.model';
import { toMovement } from '../db/inventory.prisma.mapper';
import { parseDecimalUnits } from '../../domain/logic/stock-movement.logic';

@Injectable()
export class PrismaMovementRepository implements MovementRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string, filter: ListMovementsFilter): Promise<MovementPage> {
    const page = filter.page ?? 1;
    const pageSize = filter.pageSize ?? 20;
    const where: any = { companyId };
    if (filter.productId) where.productId = filter.productId;
    if (filter.locationId) where.locationId = filter.locationId;
    if (filter.branchIds) where.location = { OR: [{ branchId: null }, { branchId: { in: filter.branchIds } }] };
    if (filter.movementType) where.movementType = filter.movementType;
    if (filter.actorUserId) where.actorUserId = filter.actorUserId;
    if (filter.fromDate || filter.toDate) {
      where.occurredAt = {};
      if (filter.fromDate) where.occurredAt.gte = filter.fromDate;
      if (filter.toDate) where.occurredAt.lte = filter.toDate;
    }

    const [items, total] = await Promise.all([
      this.prisma.client.stockMovement.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { occurredAt: 'desc' },
      }),
      this.prisma.client.stockMovement.count({ where }),
    ]);
    return { items: items.map(toMovement), total, page, pageSize };
  }

  async create(input: CreateMovementInput): Promise<StockMovement> {
    const row = await this.prisma.client.$transaction(async (tx) => {
      if (input.direction === 'OUT') {
        await this.assertCanCreateOutbound(tx, input);
      }
      return tx.stockMovement.create({ data: this.toCreateData(input) });
    });
    return toMovement(row);
  }

  async createMany(inputs: CreateMovementInput[]): Promise<StockMovement[]> {
    const rows = await this.prisma.client.$transaction(async (tx) => {
      for (const input of inputs) {
        if (input.direction === 'OUT') {
          await this.assertCanCreateOutbound(tx, input);
        }
      }

      const created = [];
      for (const input of inputs) {
        created.push(await tx.stockMovement.create({ data: this.toCreateData(input) }));
      }
      return created;
    });
    return rows.map(toMovement);
  }

  private toCreateData(input: CreateMovementInput) {
    return {
      companyId: input.companyId,
      movementNumber: input.movementNumber,
      productId: input.productId,
      locationId: input.locationId,
      movementType: input.movementType as any,
      direction: input.direction as any,
      quantity: input.quantity,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      transferGroupId: input.transferGroupId,
      reversesMovementId: input.reversesMovementId,
      actorUserId: input.actorUserId,
    };
  }

  private async assertCanCreateOutbound(tx: any, input: CreateMovementInput): Promise<void> {
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      `${input.companyId}:${input.productId}:${input.locationId}`,
    );

    const rows = await tx.stockMovement.groupBy({
      by: ['direction'],
      where: { companyId: input.companyId, productId: input.productId, locationId: input.locationId },
      _sum: { quantity: true },
    });

    let available = 0n;
    for (const row of rows) {
      const qty = parseDecimalUnits(String(row._sum.quantity ?? '0')) ?? 0n;
      available += row.direction === 'IN' ? qty : -qty;
    }

    const requested = parseDecimalUnits(input.quantity) ?? 0n;
    if (requested > available) {
      throw new ConflictException('Insufficient stock.');
    }
  }
}
