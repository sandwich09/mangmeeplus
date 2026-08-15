import { Injectable } from '@nestjs/common';
import type { DashboardWidget } from '@watchdog-bms/contracts';
import { PrismaService } from '../../../../common/database/prisma.service';

/**
 * Inventory Health Dashboard Provider (Item 06)
 * Uses Prisma directly to query inventory data — all queries are read-only and company-scoped.
 * Does NOT import InventoryModule repositories to avoid circular dependency.
 */
@Injectable()
export class InventoryHealthProvider {
  readonly moduleKey = 'inventory';
  /** Whether these numbers are computed at all follows the company's Inventory entitlement.
   *  `product_catalog` is sold separately and deliberately does not unlock this widget. */
  readonly featureKey = 'inventory';
  /** Who may see the card once computed. `inventory.product.read` is deliberately absent:
   *  feature-gate.logic maps the `inventory.product.` prefix to `product_catalog`. */
  readonly readPermissions: readonly string[] = ['inventory.report.read', 'inventory.movement.read'];

  constructor(private readonly prisma: PrismaService) {}

  async collectMetrics(input: {
    companyId: string;
    periodStart: Date;
    periodEnd: Date;
    /** Absent = company-wide. Present = balances from movements at that branch's locations only;
     *  locations with a null branch are company-central stock and belong to the combined view
     *  alone (spec R4/§4.5). */
    branchIds?: string[];
  }): Promise<DashboardWidget[]> {
    const { companyId, branchIds } = input;
    const computedAt = new Date().toISOString();

    try {
      // Low stock products: balance <= reorderPoint where reorderPoint is set.
      // Company-level on purpose: products are not branch-scoped, so a product with no movement in
      // the branch correctly reads balance 0 rather than disappearing from the count.
      const productsWithReorder = await this.prisma.client.product.findMany({
        where: { companyId, status: 'ACTIVE', reorderPoint: { not: null } },
        select: { id: true, sku: true, name: true, reorderPoint: true },
      });

      // Get aggregate balances for these products. StockMovement has no branchId of its own, so the
      // branch is reached through the location relation (schema.prisma:1154).
      const movementGroups = await this.prisma.client.stockMovement.groupBy({
        by: ['productId', 'direction'],
        where: { companyId, ...(branchIds && { location: { branchId: { in: branchIds } } }), productId: { in: productsWithReorder.map((p) => p.id) } },
        _sum: { quantity: true },
      });

      const balanceMap = new Map<string, number>();
      for (const g of movementGroups) {
        const qty = Number(g._sum.quantity ?? 0);
        const current = balanceMap.get(g.productId) ?? 0;
        balanceMap.set(g.productId, g.direction === 'IN' ? current + qty : current - qty);
      }

      const lowStockProducts = productsWithReorder.filter((p) => {
        const balance = balanceMap.get(p.id) ?? 0;
        const reorder = Number(p.reorderPoint ?? 0);
        return balance <= reorder;
      });

      // Total active products
      const totalProducts = await this.prisma.client.product.count({ where: { companyId, status: 'ACTIVE' } });

      // Last stock movement time. Branch-filtered through the same relation as the balances:
      // company-wide here would report another branch's activity under a branch-named label, which
      // is the mismatch between stated and queried scope this work exists to remove (spec R1).
      const lastMovement = await this.prisma.client.stockMovement.findFirst({
        where: { companyId, ...(branchIds && { location: { branchId: { in: branchIds } } }) },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      });

      const metrics: DashboardWidget['metrics'] = [
        {
          key: 'total_active_products',
          label: 'สินค้าที่ใช้งาน',
          value: totalProducts,
          unit: 'รายการ',
          severity: 'normal',
          freshness: 'fresh',
          sourceRefs: [{ module: 'inventory', sourceType: 'product', label: 'คลังสินค้า', href: `/companies/${companyId}/inventory/products`, permissionKey: 'inventory.product.read' }],
          computedAt,
        },
        {
          key: 'low_stock_count',
          label: 'สินค้าต่ำกว่า Reorder Point',
          value: lowStockProducts.length,
          unit: 'รายการ',
          severity: lowStockProducts.length > 0 ? 'warning' : 'normal',
          freshness: 'fresh',
          sourceRefs: [{ module: 'inventory', sourceType: 'stock_balance', label: 'รายงานสต็อก', href: `/companies/${companyId}/inventory/reports/stock`, permissionKey: 'inventory.report.read' }],
          computedAt,
        },
        {
          key: 'last_movement_at',
          label: 'การเคลื่อนไหวล่าสุด',
          value: lastMovement?.occurredAt?.toISOString() ?? null,
          freshness: lastMovement ? 'fresh' : 'unavailable',
          sourceRefs: [{ module: 'inventory', sourceType: 'stock_movement', label: 'การเคลื่อนไหวสต็อก', href: `/companies/${companyId}/inventory/movements`, permissionKey: 'inventory.movement.read' }],
          computedAt,
        },
      ];

      return [{
        key: 'inventory_health',
        title: 'สุขภาพคลังสินค้า',
        kind: 'metric_card',
        module: 'inventory',
        metrics,
        href: `/companies/${companyId}/inventory`,
      }];
    } catch {
      return [this.unavailableWidget()];
    }
  }

  private unavailableWidget(): DashboardWidget {
    return {
      key: 'inventory_health',
      title: 'สุขภาพคลังสินค้า',
      kind: 'metric_card',
      module: 'inventory',
      metrics: [],
      unavailableReason: 'ข้อมูลคลังสินค้าไม่พร้อมใช้งาน',
    };
  }
}
