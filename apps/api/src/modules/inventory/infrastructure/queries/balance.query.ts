import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import type { BalanceQueryPort } from '../../domain/ports/inventory.repository.port';
import type { StockBalance } from '../../domain/models/inventory.model';
import { decimalUnitsToString, parseDecimalUnits } from '../../domain/logic/stock-movement.logic';

@Injectable()
export class PrismaBalanceQuery implements BalanceQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(companyId: string, productId: string, locationId: string): Promise<StockBalance> {
    const rows = await this.prisma.client.stockMovement.groupBy({
      by: ['productId', 'locationId', 'direction'],
      where: { companyId, productId, locationId },
      _sum: { quantity: true },
    });

    let inQty = 0n;
    let outQty = 0n;
    for (const r of rows) {
      const qty = parseDecimalUnits(String(r._sum.quantity ?? '0')) ?? 0n;
      if (r.direction === 'IN') inQty += qty;
      else outQty += qty;
    }
    const balance = inQty > outQty ? inQty - outQty : 0n;
    return { productId, locationId, quantity: decimalUnitsToString(balance) };
  }

  async listBalances(
    companyId: string,
    filter: { productId?: string; locationId?: string; branchIds?: string[] },
  ): Promise<StockBalance[]> {
    const where: any = { companyId };
    if (filter.productId) where.productId = filter.productId;
    if (filter.locationId) where.locationId = filter.locationId;
    if (filter.branchIds) where.location = { OR: [{ branchId: null }, { branchId: { in: filter.branchIds } }] };

    const rows = await this.prisma.client.stockMovement.groupBy({
      by: ['productId', 'locationId', 'direction'],
      where,
      _sum: { quantity: true },
    });

    // Aggregate by productId+locationId
    const map = new Map<string, { inQty: bigint; outQty: bigint }>();
    for (const r of rows) {
      const key = `${r.productId}:${r.locationId}`;
      const entry = map.get(key) ?? { inQty: 0n, outQty: 0n };
      const qty = parseDecimalUnits(String(r._sum.quantity ?? '0')) ?? 0n;
      if (r.direction === 'IN') entry.inQty += qty;
      else entry.outQty += qty;
      map.set(key, entry);
    }

    const balances = Array.from(map.entries()).map(([key, { inQty, outQty }]) => {
      const [productId, locationId] = key.split(':');
      return { productId: productId!, locationId: locationId!, quantity: decimalUnitsToString(inQty > outQty ? inQty - outQty : 0n) };
    });
    // Names for pages and reports that show the product and place, never the internal id.
    const [products, locations] = await Promise.all([
      this.prisma.client.product.findMany({ where: { companyId, id: { in: [...new Set(balances.map((b) => b.productId))] } }, select: { id: true, name: true } }),
      this.prisma.client.inventoryLocation.findMany({ where: { companyId, id: { in: [...new Set(balances.map((b) => b.locationId))] } }, select: { id: true, name: true } }),
    ]);
    const productNames = new Map(products.map((row) => [row.id, row.name]));
    const locationNames = new Map(locations.map((row) => [row.id, row.name]));
    return balances.map((balance) => ({ ...balance, productName: productNames.get(balance.productId), locationName: locationNames.get(balance.locationId) }));
  }
}
