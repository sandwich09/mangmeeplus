import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InventoryHealthProvider } from './inventory-health.provider';

const PERIOD = { periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-08-31T23:59:59Z') };

function makeSut(opts: { throws?: boolean } = {}) {
  const guard = async () => { if (opts.throws) throw new Error('db down'); };
  const prisma = {
    client: {
      product: {
        findMany: async () => { await guard(); return [{ id: 'p1', sku: 'A', name: 'A', reorderPoint: 10 }]; },
        count: async () => { await guard(); return 1; },
      },
      stockMovement: {
        groupBy: async () => { await guard(); return [{ productId: 'p1', direction: 'IN', _sum: { quantity: 4 } }]; },
        findFirst: async () => { await guard(); return { occurredAt: new Date('2026-08-02T00:00:00Z') }; },
      },
    },
  } as any;
  return new InventoryHealthProvider(prisma);
}

const input = () => ({ companyId: 'c1', ...PERIOD });

describe('InventoryHealthProvider', () => {
  it('declares the Inventory entitlement and the keys that may read the card', () => {
    const provider = makeSut();
    assert.equal(provider.featureKey, 'inventory');
    // inventory.product.read follows product_catalog, which is sold separately.
    assert.deepEqual([...provider.readPermissions], ['inventory.report.read', 'inventory.movement.read']);
  });

  it('computes the metrics without a caller permission — entitlement decides, the reader is filtered upstream', async () => {
    const [widget] = await makeSut().collectMetrics(input());
    assert.equal(widget.unavailableReason, undefined);
    assert.deepEqual(widget.metrics.map((m) => m.key), ['total_active_products', 'low_stock_count', 'last_movement_at']);
    // balance 4 <= reorderPoint 10 → counted as low stock
    assert.equal(widget.metrics[1].value, 1);
  });

  it('degrades to an unavailable widget instead of throwing when the query fails', async () => {
    const [widget] = await makeSut({ throws: true }).collectMetrics(input());
    assert.equal(widget.unavailableReason, 'ข้อมูลคลังสินค้าไม่พร้อมใช้งาน');
    assert.deepEqual(widget.metrics, []);
  });
});
