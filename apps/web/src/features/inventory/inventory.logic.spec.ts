import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatQty,
  isOutboundMovement,
  parseQrPayload,
  requiresReasonField,
  visibleInventoryTabs,
  withLowStockFlag,
} from './inventory.logic';

describe('inventory.logic (web)', () => {
  describe('visibleInventoryTabs', () => {
    it('shows every hub card backed by a shared permission', () => {
      assert.deepEqual(
        visibleInventoryTabs(['inventory.product.read']),
        ['products', 'scan'],
      );
      assert.deepEqual(
        visibleInventoryTabs(['inventory.stock_count.create']),
        ['stockAction', 'stockCount'],
      );
    });

    it('keeps mixed stock actions visible for any usable action', () => {
      assert.deepEqual(
        visibleInventoryTabs(['inventory.movement.adjust']),
        ['stockAction'],
      );
    });

    it('keeps source order and hides unrelated cards', () => {
      assert.deepEqual(
        visibleInventoryTabs(['inventory.report.read', 'inventory.location.read']),
        ['locations', 'stockReport'],
      );
      assert.deepEqual(visibleInventoryTabs(['crm.customer.read']), []);
    });
  });

  describe('isOutboundMovement', () => {
    it('true for STOCK_OUT', () => assert.equal(isOutboundMovement('STOCK_OUT'), true));
    it('true for TRANSFER_OUT', () => assert.equal(isOutboundMovement('TRANSFER_OUT'), true));
    it('false for STOCK_IN', () => assert.equal(isOutboundMovement('STOCK_IN'), false));
  });

  describe('requiresReasonField', () => {
    it('true for ADJUSTMENT_IN', () => assert.equal(requiresReasonField('ADJUSTMENT_IN'), true));
    it('true for COUNT_ADJUSTMENT_OUT', () => assert.equal(requiresReasonField('COUNT_ADJUSTMENT_OUT'), true));
    it('false for STOCK_IN', () => assert.equal(requiresReasonField('STOCK_IN'), false));
    it('false for TRANSFER_IN', () => assert.equal(requiresReasonField('TRANSFER_IN'), false));
  });

  describe('withLowStockFlag', () => {
    it('sets isLowStock true when qty <= reorderPoint', () => {
      const b = withLowStockFlag({ productId: 'p1', locationId: 'l1', quantity: '5' }, '10');
      assert.equal(b.isLowStock, true);
    });
    it('sets isLowStock false when qty > reorderPoint', () => {
      const b = withLowStockFlag({ productId: 'p1', locationId: 'l1', quantity: '20' }, '10');
      assert.equal(b.isLowStock, false);
    });
    it('leaves isLowStock undefined when no reorderPoint', () => {
      const b = withLowStockFlag({ productId: 'p1', locationId: 'l1', quantity: '5' });
      assert.equal(b.isLowStock, undefined);
    });
  });

  describe('parseQrPayload', () => {
    it('parses product payload', () => {
      assert.deepEqual(parseQrPayload('WD1:P:abc'), { entityType: 'PRODUCT', entityId: 'abc' });
    });
    it('parses location payload', () => {
      assert.deepEqual(parseQrPayload('WD1:LOC:xyz'), { entityType: 'LOCATION', entityId: 'xyz' });
    });
    it('returns null for unknown format', () => {
      assert.equal(parseQrPayload('INVALID'), null);
    });
  });

  describe('formatQty', () => {
    it('formats whole number without decimals', () => assert.equal(formatQty('100.000'), '100'));
    it('preserves decimal when needed', () => assert.equal(formatQty('10.5'), '10.5'));
    it('returns input on non-numeric', () => assert.equal(formatQty('abc'), 'abc'));
  });
});
