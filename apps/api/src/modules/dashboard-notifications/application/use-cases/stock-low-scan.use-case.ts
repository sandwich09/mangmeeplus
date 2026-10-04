import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { CreateOrUpdateNotificationEventUseCase } from './notification.use-cases';
import { buildDedupKey } from '../../domain/logic/notification.logic';
import { PrismaNotificationRuleRepository } from '../../infrastructure/prisma-notification.repository';
import { loadEntitledFeatureKeys } from '../../../employee-access/application/entitlement.helper';
import { isNotificationTriggerEntitled } from '../../domain/models/notification.model';

/**
 * Stock Low Scan Use Case (Item 06)
 * Scans inventory for products below reorder point and creates notifications.
 * Reads inventory data directly via PrismaService (company-scoped, read-only).
 * Does not import InventoryModule to avoid circular dependency.
 */
@Injectable()
export class StockLowScanUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly createEvent: CreateOrUpdateNotificationEventUseCase,
    private readonly rules: PrismaNotificationRuleRepository,
  ) {}

  async execute(companyId: string): Promise<{ scanned: number; triggered: number }> {
    if (!isNotificationTriggerEntitled('stock_low', await loadEntitledFeatureKeys(this.prisma, companyId))) {
      return { scanned: 0, triggered: 0 };
    }
    // Get active rule for stock_low
    const rule = await this.rules.findByTriggerKey(companyId, 'stock_low');
    if (!rule || rule.status === 'disabled' || rule.status === 'system') {
      return { scanned: 0, triggered: 0 };
    }

    // Get products with reorder points
    const products = await this.prisma.client.product.findMany({
      where: { companyId, status: 'ACTIVE', reorderPoint: { not: null } },
      select: { id: true, sku: true, name: true, reorderPoint: true },
    });

    // Aggregate balances
    const movementGroups = await this.prisma.client.stockMovement.groupBy({
      by: ['productId', 'locationId', 'direction'],
      where: { companyId, productId: { in: products.map((p) => p.id) } },
      _sum: { quantity: true },
    });

    // Map productId+locationId -> balance
    const balanceMap = new Map<string, number>();
    for (const g of movementGroups) {
      const key = `${g.productId}:${g.locationId}`;
      const qty = Number(g._sum.quantity ?? 0);
      const current = balanceMap.get(key) ?? 0;
      balanceMap.set(key, g.direction === 'IN' ? current + qty : current - qty);
    }

    // Resolve company members with inventory or owner roles for recipients
    const ownerUsers = await this.prisma.client.companyMembership.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        roles: { some: { role: { key: { in: ['OWNER', 'INVENTORY', 'ADMIN'] } } } },
      },
      select: { userId: true },
    });
    const recipientUserIds = ownerUsers.map((m) => m.userId);

    let triggered = 0;

    for (const product of products) {
      const reorderPoint = Number(product.reorderPoint ?? 0);
      // Sum balance across all locations for this product
      let totalBalance = 0;
      for (const [key, qty] of balanceMap.entries()) {
        if (key.startsWith(`${product.id}:`)) totalBalance += qty;
      }

      if (totalBalance <= reorderPoint) {
        const result = await this.createEvent.execute({
          companyId,
          triggerKey: 'stock_low',
          sourceModule: 'inventory',
          sourceType: 'product',
          sourceId: product.id,
          severity: 'action',
          title: `สต็อกต่ำ: ${product.name}`,
          body: `SKU ${product.sku}: ปัจจุบัน ${totalBalance}, Reorder Point ${reorderPoint}`,
          deepLinkHref: `/companies/${companyId}/inventory/products/${product.id}`,
          sourceRefs: [{ module: 'inventory', sourceType: 'product', sourceId: product.id, label: product.name, href: `/companies/${companyId}/inventory/products/${product.id}`, permissionKey: 'inventory.product.read' }],
          recipientUserIds,
          // No periodKey: a calendar-date key resets the dedup identity at
          // midnight UTC (07:00 Bangkok) and defeats the 12h cooldown per product.
        });
        if (!result.skipped) triggered++;
      }
    }

    return { scanned: products.length, triggered };
  }
}
