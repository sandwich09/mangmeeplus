import { Injectable, ForbiddenException } from '@nestjs/common';
import type { RequestContext } from '../../../auth/domain/models/request-context.model';
import { PrismaMovementRepository } from '../../infrastructure/repositories/prisma-movement.repository';
import { PrismaBalanceQuery } from '../../infrastructure/queries/balance.query';
import { PrismaProductRepository } from '../../infrastructure/repositories/prisma-product.repository';
import type { StockMovementType } from '../../domain/models/inventory.model';
import type { MovementPage } from '../../domain/ports/inventory.repository.port';
import type { StockBalance } from '../../domain/models/inventory.model';
import { parseDecimalUnits } from '../../domain/logic/stock-movement.logic';

export type ListMovementsQuery = {
  productId?: string;
  locationId?: string;
  movementType?: StockMovementType;
  actorUserId?: string;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
};

@Injectable()
export class ListMovementsUseCase {
  constructor(private readonly movements: PrismaMovementRepository) {}

  async execute(ctx: RequestContext, query: ListMovementsQuery): Promise<MovementPage> {
    if (!ctx.permissions.includes('inventory.movement.read')) throw new ForbiddenException();
    return this.movements.list(ctx.companyId, {
      ...query,
      branchIds: ctx.scopes.branchIds,
      fromDate: query.fromDate ? new Date(query.fromDate) : undefined,
      toDate: query.toDate ? new Date(query.toDate) : undefined,
    });
  }
}

@Injectable()
export class GetStockBalanceUseCase {
  constructor(private readonly balance: PrismaBalanceQuery) {}

  async execute(ctx: RequestContext, filter: { productId?: string; locationId?: string; branchIds?: string[] }): Promise<StockBalance[]> {
    if (!ctx.permissions.includes('inventory.report.read')) throw new ForbiddenException();
    return this.balance.listBalances(ctx.companyId, { ...filter, branchIds: ctx.scopes.branchIds });
  }
}

@Injectable()
export class GetStockReportUseCase {
  constructor(
    private readonly balance: PrismaBalanceQuery,
    private readonly products: PrismaProductRepository,
  ) {}

  async execute(ctx: RequestContext, filter: { productId?: string; locationId?: string; branchIds?: string[]; lowStockOnly?: boolean }): Promise<{ items: StockBalance[] }> {
    if (!ctx.permissions.includes('inventory.report.read')) throw new ForbiddenException();

    const balances = await this.balance.listBalances(ctx.companyId, { ...filter, branchIds: ctx.scopes.branchIds });
    const firstPage = await this.products.list(ctx.companyId, { status: 'ACTIVE', page: 1, pageSize: 1000 });
    const products = [...firstPage.items];
    for (let page = 2; products.length < firstPage.total; page += 1) {
      const nextPage = await this.products.list(ctx.companyId, { status: 'ACTIVE', page, pageSize: 1000 });
      if (nextPage.items.length === 0) break;
      products.push(...nextPage.items);
    }
    const reorderByProduct = new Map(products.map((product) => [product.id, product.reorderPoint]));

    const items = balances.map((balance) => {
      const reorderPoint = reorderByProduct.get(balance.productId);
      if (!reorderPoint) return balance;
      const qty = parseDecimalUnits(balance.quantity) ?? 0n;
      const threshold = parseDecimalUnits(reorderPoint) ?? -1n;
      return { ...balance, isLowStock: threshold >= 0n ? qty <= threshold : undefined };
    });

    return { items: filter.lowStockOnly ? items.filter((item) => item.isLowStock) : items };
  }
}
