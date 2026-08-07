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
  }): Promise<DashboardWidget[]> {
    const { companyId } = input;
    const computedAt = new Date().toISOString();

    try {
      // Low stock products: balance <= reorderPoint where reorderPoint is set
      const productsWithReorder = await this.prisma.client.product.findMany({
        where: { companyId, status: 'ACTIVE', reorderPoint: { not: null } },
        select: { id: true, sku: true, name: true, reorderPoint: true },
      });

      // Get aggregate balances for these products
      const movementGroups = await this.prisma.client.stockMovement.groupBy({
        by: ['productId', 'direction'],
        where: { companyId, productId: { in: productsWithReorder.map((p) => p.id) } },
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

      // Last stock movement time
      const lastMovement = await this.prisma.client.stockMovement.findFirst({
        where: { companyId },
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
