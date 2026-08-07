import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { PrismaProcurementRepository } from './prisma-procurement.repository.js';

// Voiding a POSTED goods receipt is a true reversal executed in one
// transaction: CAS status claim, reversing STOCK_OUT movements driven by the
// stockMovement table, PO received-quantity rollback, and a fail-closed
// negative-stock guard (spec section 10 / `inventory_reversal_unavailable`).

function fixture(options: {
  casFails?: boolean;
  issuedOutQty?: string;
  priorReversal?: boolean;
  noMovements?: boolean;
  poReceived?: string;
  secondStockLine?: boolean;
} = {}) {
  const goodsReceipt: any = {
    id: 'gr-1', companyId: 'company-1', status: 'POSTED', goodsReceiptNumber: 'GR-1',
    purchaseOrderId: 'po-1', supplierId: 'supplier-1', receivedAt: new Date('2026-07-01'),
    receivedByUserId: 'receiver-1', postingStatus: 'pending', createdByUserId: 'receiver-1',
    createdAt: new Date(), updatedAt: new Date(),
    lines: [
      { id: 'gr-line-1', companyId: 'company-1', goodsReceiptId: 'gr-1', purchaseOrderLineId: 'po-line-1', lineNumber: 1, lineType: 'STOCK', productId: 'product-1', description: 'widget', inventoryLocationId: 'loc-1', orderedQuantity: '10', previouslyReceivedQuantity: '0', receivedQuantity: '10', acceptedQuantity: '10', rejectedQuantity: '0', createdAt: new Date(), updatedAt: new Date() },
      // Service line: no inventory movement, but posting still counted it on the PO.
      { id: 'gr-line-2', companyId: 'company-1', goodsReceiptId: 'gr-1', purchaseOrderLineId: 'po-line-2', lineNumber: 2, lineType: 'SERVICE', description: 'install', orderedQuantity: '2', previouslyReceivedQuantity: '0', receivedQuantity: '2', acceptedQuantity: '2', rejectedQuantity: '0', createdAt: new Date(), updatedAt: new Date() },
    ],
  };
  if (options.secondStockLine) {
    goodsReceipt.lines.push({ id: 'gr-line-3', companyId: 'company-1', goodsReceiptId: 'gr-1', purchaseOrderLineId: 'po-line-3', lineNumber: 3, lineType: 'STOCK', productId: 'product-1', description: 'widget', inventoryLocationId: 'loc-1', orderedQuantity: '4', previouslyReceivedQuantity: '0', receivedQuantity: '4', acceptedQuantity: '4', rejectedQuantity: '0', createdAt: new Date(), updatedAt: new Date() });
  }

  // Stock ledger the balance guard sums over: the receipt's own STOCK_IN rows
  // plus anything issued out of that product/location since posting.
  const ledger: any[] = options.noMovements ? [] : [
    { id: 'mv-1', companyId: 'company-1', productId: 'product-1', locationId: 'loc-1', direction: 'IN', quantity: '10', referenceType: 'goods_receipt', referenceId: 'gr-1', reversesMovementId: null },
  ];
  if (options.secondStockLine) {
    ledger.push({ id: 'mv-2', companyId: 'company-1', productId: 'product-1', locationId: 'loc-1', direction: 'IN', quantity: '4', referenceType: 'goods_receipt', referenceId: 'gr-1', reversesMovementId: null });
  }
  if (options.priorReversal) {
    ledger.push({ id: 'mv-r1', companyId: 'company-1', productId: 'product-1', locationId: 'loc-1', direction: 'OUT', quantity: '10', referenceType: 'goods_receipt', referenceId: 'gr-1', reversesMovementId: 'mv-1' });
  }
  if (options.issuedOutQty) {
    ledger.push({ id: 'mv-sale', companyId: 'company-1', productId: 'product-1', locationId: 'loc-1', direction: 'OUT', quantity: options.issuedOutQty, referenceType: 'sales_order', referenceId: 'so-1', reversesMovementId: null });
  }

  const poLines: Record<string, any> = {
    'po-line-1': { id: 'po-line-1', companyId: 'company-1', receivedQuantity: options.poReceived ?? '10' },
    'po-line-2': { id: 'po-line-2', companyId: 'company-1', receivedQuantity: '2' },
    'po-line-3': { id: 'po-line-3', companyId: 'company-1', receivedQuantity: '4' },
  };
  const movementCreates: any[] = [];
  const lockKeys: string[] = [];
  const client: any = {
    $transaction: async (fn: (tx: any) => unknown) => fn(client),
    $executeRawUnsafe: async (_sql: string, key: string) => { lockKeys.push(key); return 0; },
    goodsReceipt: {
      updateMany: async ({ where, data }: any) => {
        if (options.casFails || where.status !== 'POSTED') return { count: 0 };
        Object.assign(goodsReceipt, data);
        return { count: 1 };
      },
      findFirstOrThrow: async () => goodsReceipt,
    },
    stockMovement: {
      findMany: async () => ledger.filter((m) => m.referenceType === 'goods_receipt' && m.referenceId === 'gr-1'),
      groupBy: async ({ where }: any) => {
        const rows = ledger.filter((m) => m.productId === where.productId && m.locationId === where.locationId);
        return ['IN', 'OUT']
          .map((direction) => ({ direction, _sum: { quantity: String(rows.filter((m) => m.direction === direction).reduce((sum, m) => sum + Number(m.quantity), 0)) } }))
          .filter((row) => rows.some((m) => m.direction === row.direction));
      },
      create: async ({ data }: any) => {
        movementCreates.push(data);
        const created = { id: `reversal-${movementCreates.length}`, ...data };
        ledger.push(created);
        return created;
      },
    },
    purchaseOrderLine: {
      findFirst: async ({ where }: any) => poLines[where.id] ?? null,
      update: async ({ where, data }: any) => Object.assign(poLines[where.id], data),
    },
  };
  return {
    repo: new PrismaProcurementRepository({ client } as any),
    goodsReceipt,
    poLines,
    get movementCreates() { return movementCreates; },
    get lockKeys() { return lockKeys; },
  };
}

describe('voidGoodsReceiptTrueReversal', () => {
  it('claims the status, reverses each posted STOCK_IN, and rolls the PO lines back', async () => {
    const f = fixture();
    const result = await f.repo.voidGoodsReceiptTrueReversal('company-1', 'gr-1', 'voider-1', 'received in error');

    assert.equal(result.goodsReceipt.status, 'VOIDED');
    assert.equal(f.goodsReceipt.postingStatus, 'reversed');
    assert.deepEqual(result.reversalMovements, [{ originalMovementId: 'mv-1', reversalMovementId: 'reversal-1' }]);
    assert.equal(f.movementCreates.length, 1);
    const created = f.movementCreates[0];
    assert.equal(created.movementType, 'STOCK_OUT');
    assert.equal(created.direction, 'OUT');
    assert.equal(String(created.quantity), '10');
    assert.equal(created.reversesMovementId, 'mv-1');
    assert.equal(created.referenceType, 'goods_receipt');
    assert.equal(created.referenceId, 'gr-1');
    assert.equal(created.actorUserId, 'voider-1');
    // Serializes against concurrent inventory issues on the inventory module's
    // own lock key — a different key format would not collide.
    assert.deepEqual(f.lockKeys, ['company-1:product-1:loc-1']);
    // Stock line and service line both counted on the PO at post, so both roll back.
    assert.equal(f.poLines['po-line-1'].receivedQuantity, '0.0000');
    assert.equal(f.poLines['po-line-2'].receivedQuantity, '0.0000');
  });

  it('leaves an earlier partial receipt on the PO line', async () => {
    const f = fixture({ poReceived: '25' });
    await f.repo.voidGoodsReceiptTrueReversal('company-1', 'gr-1', 'voider-1', 'reason');
    assert.equal(f.poLines['po-line-1'].receivedQuantity, '15.0000');
  });

  it('rejects with a conflict when the CAS claim loses (already voided or changed)', async () => {
    const f = fixture({ casFails: true });
    await assert.rejects(
      () => f.repo.voidGoodsReceiptTrueReversal('company-1', 'gr-1', 'voider-1', 'reason'),
      (err: any) => err instanceof ConflictException && (err.getResponse() as any).code === 'goods_receipt_changed',
    );
    assert.equal(f.movementCreates.length, 0);
    assert.equal(f.poLines['po-line-1'].receivedQuantity, '10');
  });

  it('fails closed when the reversal would drive stock negative', async () => {
    const f = fixture({ issuedOutQty: '4' });
    await assert.rejects(
      () => f.repo.voidGoodsReceiptTrueReversal('company-1', 'gr-1', 'voider-1', 'reason'),
      (err: any) => err instanceof ConflictException && (err.getResponse() as any).code === 'inventory_reversal_unavailable',
    );
    assert.equal(f.movementCreates.length, 0);
  });

  it('counts its own earlier reversals against the balance for later lines', async () => {
    // 14 received on one product/location, 2 issued out: reversing line 1 (10)
    // leaves 2 on hand, so reversing line 3 (4) must fail instead of going to -2.
    const f = fixture({ secondStockLine: true, issuedOutQty: '2' });
    await assert.rejects(
      () => f.repo.voidGoodsReceiptTrueReversal('company-1', 'gr-1', 'voider-1', 'reason'),
      (err: any) => err instanceof ConflictException && (err.getResponse() as any).code === 'inventory_reversal_unavailable',
    );
    assert.equal(f.movementCreates.length, 1);
  });

  it('treats an existing reversing movement as already reversed without creating another', async () => {
    const f = fixture({ priorReversal: true });
    const result = await f.repo.voidGoodsReceiptTrueReversal('company-1', 'gr-1', 'voider-1', 'reason');
    assert.equal(result.goodsReceipt.status, 'VOIDED');
    assert.deepEqual(result.reversalMovements, []);
    assert.equal(f.movementCreates.length, 0);
    assert.equal(f.poLines['po-line-1'].receivedQuantity, '0.0000');
  });

  it('voids a receipt with no inventory movements and still rolls the PO back', async () => {
    const f = fixture({ noMovements: true });
    const result = await f.repo.voidGoodsReceiptTrueReversal('company-1', 'gr-1', 'voider-1', 'reason');
    assert.equal(result.goodsReceipt.status, 'VOIDED');
    assert.deepEqual(result.reversalMovements, []);
    assert.deepEqual(f.lockKeys, []);
    assert.equal(f.poLines['po-line-2'].receivedQuantity, '0.0000');
  });
});
