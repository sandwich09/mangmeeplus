import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  movementDirection,
  isOutbound,
  requiresReason,
  countAdjustmentDirection,
  validateQuantity,
  wouldGoNegative,
  decimalDifference,
  decimalUnitsToString,
  parseDecimalUnits,
  buildProductQrPayload,
  buildLocationQrPayload,
  parseQrPayload,
} from './stock-movement.logic';
import { GetStockReportUseCase } from '../../application/use-cases/movement-query.use-cases';

describe('stock-movement.logic', () => {
  describe('movementDirection', () => {
    it('STOCK_IN -> IN', () => assert.equal(movementDirection('STOCK_IN'), 'IN'));
    it('STOCK_OUT -> OUT', () => assert.equal(movementDirection('STOCK_OUT'), 'OUT'));
    it('TRANSFER_IN -> IN', () => assert.equal(movementDirection('TRANSFER_IN'), 'IN'));
    it('TRANSFER_OUT -> OUT', () => assert.equal(movementDirection('TRANSFER_OUT'), 'OUT'));
    it('COUNT_ADJUSTMENT_IN -> IN', () => assert.equal(movementDirection('COUNT_ADJUSTMENT_IN'), 'IN'));
    it('COUNT_ADJUSTMENT_OUT -> OUT', () => assert.equal(movementDirection('COUNT_ADJUSTMENT_OUT'), 'OUT'));
    it('ADJUSTMENT_IN -> IN', () => assert.equal(movementDirection('ADJUSTMENT_IN'), 'IN'));
    it('ADJUSTMENT_OUT -> OUT', () => assert.equal(movementDirection('ADJUSTMENT_OUT'), 'OUT'));
  });

  describe('isOutbound', () => {
    it('true for STOCK_OUT', () => assert.equal(isOutbound('STOCK_OUT'), true));
    it('false for STOCK_IN', () => assert.equal(isOutbound('STOCK_IN'), false));
  });

  describe('requiresReason', () => {
    it('true for ADJUSTMENT_IN', () => assert.equal(requiresReason('ADJUSTMENT_IN'), true));
    it('true for ADJUSTMENT_OUT', () => assert.equal(requiresReason('ADJUSTMENT_OUT'), true));
    it('true for COUNT_ADJUSTMENT_IN', () => assert.equal(requiresReason('COUNT_ADJUSTMENT_IN'), true));
    it('true for COUNT_ADJUSTMENT_OUT', () => assert.equal(requiresReason('COUNT_ADJUSTMENT_OUT'), true));
    it('false for STOCK_IN', () => assert.equal(requiresReason('STOCK_IN'), false));
    it('false for STOCK_OUT', () => assert.equal(requiresReason('STOCK_OUT'), false));
    it('false for TRANSFER_IN', () => assert.equal(requiresReason('TRANSFER_IN'), false));
  });

  describe('countAdjustmentDirection', () => {
    it('counted > current -> IN', () => assert.equal(countAdjustmentDirection(50n, 80n), 'IN'));
    it('counted < current -> OUT', () => assert.equal(countAdjustmentDirection(100n, 60n), 'OUT'));
    it('counted = current -> NONE', () => assert.equal(countAdjustmentDirection(75n, 75n), 'NONE'));
  });

  describe('validateQuantity', () => {
    it('accepts valid positive qty', () => assert.equal(validateQuantity('10'), null));
    it('accepts decimal', () => assert.equal(validateQuantity('1.5'), null));
    it('rejects zero', () => assert.notEqual(validateQuantity('0'), null));
    it('rejects negative', () => assert.notEqual(validateQuantity('-5'), null));
    it('rejects non-numeric', () => assert.notEqual(validateQuantity('abc'), null));
    it('rejects more than six decimal places', () => assert.notEqual(validateQuantity('1.0000001'), null));
  });

  describe('wouldGoNegative', () => {
    it('false when balance is sufficient', () => assert.equal(wouldGoNegative('100', '50'), false));
    it('false when balance equals qty', () => assert.equal(wouldGoNegative('50', '50'), false));
    it('true when qty exceeds balance', () => assert.equal(wouldGoNegative('30', '40'), true));
    it('compares decimal strings without float drift', () => assert.equal(wouldGoNegative('0.3', '0.300001'), true));
  });

  describe('decimal helpers', () => {
    it('round-trips six-decimal units', () => {
      assert.equal(decimalUnitsToString(parseDecimalUnits('12.340001')!), '12.340001');
    });

    it('computes exact decimal difference', () => {
      assert.equal(decimalDifference('10.5', '8.125'), '2.375');
    });
  });

  describe('QR payload helpers', () => {
    it('buildProductQrPayload produces WD1:P: prefix', () => {
      assert.equal(buildProductQrPayload('prod-1'), 'WD1:P:prod-1');
    });
    it('buildLocationQrPayload produces WD1:LOC: prefix', () => {
      assert.equal(buildLocationQrPayload('loc-1'), 'WD1:LOC:loc-1');
    });
  });

  describe('parseQrPayload', () => {
    it('parses product payload', () => {
      const r = parseQrPayload('WD1:P:prod-abc');
      assert.deepEqual(r, { entityType: 'PRODUCT', entityId: 'prod-abc' });
    });
    it('parses location payload', () => {
      const r = parseQrPayload('WD1:LOC:loc-xyz');
      assert.deepEqual(r, { entityType: 'LOCATION', entityId: 'loc-xyz' });
    });
    it('returns null for malformed', () => {
      assert.equal(parseQrPayload('BAD:PAYLOAD'), null);
    });
    it('returns null for wrong prefix', () => {
      assert.equal(parseQrPayload('WD2:P:foo'), null);
    });
    it('returns null for empty', () => {
      assert.equal(parseQrPayload(''), null);
    });
  });
});

describe('GetStockReportUseCase threshold coverage', () => {
  it('loads reorder thresholds beyond the first 1,000 active products', async () => {
    const requestedPages: number[] = [];
    const products = Array.from({ length: 1_001 }, (_, index) => ({
      id: `product-${index + 1}`,
      reorderPoint: index === 1_000 ? '10.0000' : undefined,
    }));
    const productRepo = {
      list: async (_companyId: string, filter: { page: number; pageSize: number }) => {
        requestedPages.push(filter.page);
        const start = (filter.page - 1) * filter.pageSize;
        return {
          items: products.slice(start, start + filter.pageSize),
          total: products.length,
          page: filter.page,
          pageSize: filter.pageSize,
        };
      },
    };
    const useCase = new GetStockReportUseCase({
      listBalances: async () => [{ productId: 'product-1001', locationId: 'location-1', quantity: '5.0000' }],
    } as any, productRepo as any);

    const result = await useCase.execute({
      companyId: 'company-1',
      permissions: ['inventory.report.read'],
      scopes: {},
    } as any, {});

    assert.deepEqual(requestedPages, [1, 2]);
    assert.equal(result.items[0]?.isLowStock, true);
  });
});
