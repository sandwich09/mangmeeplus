import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { PostGoodsReceiptUseCase } from './goods-receipt.use-case.js';
import { PrismaProcurementRepository } from '../../infrastructure/prisma-procurement.repository.js';
import type { RequestContext } from '../../../auth/domain/models/request-context.model.js';

// Posting a goods receipt with two STOCK lines for the same product and
// location used to fail: both lines reserved the movement number under one
// product+location idempotency key, so the second insert collided on
// StockMovement @@unique([companyId, movementNumber]). The movements and the
// purchase-order roll-forward also ran in separate transactions, so a failure
// mid-way left stock added against a receipt that never finished posting.

const ctx: RequestContext = {
  requestId: 'req-1', authSubject: 'user-1', userId: 'user-1', companyId: 'company-1',
  membershipId: 'membership-1', roles: ['STORE'], permissions: ['procurement.goods_receipt.post'],
  scopes: {}, authProvider: 'watchdog',
};

// Two stock lines for the SAME product and location, plus a service line that
// takes no movement but still rolls its purchase-order line forward.
function receiptLines() {
  return [
    { id: 'grl-1', companyId: 'company-1', goodsReceiptId: 'gr-1', purchaseOrderLineId: 'pol-1', lineNumber: 1, lineType: 'STOCK', productId: 'prod-1', description: 'widget', inventoryLocationId: 'loc-1', orderedQuantity: '10', previouslyReceivedQuantity: '0', receivedQuantity: '4', acceptedQuantity: '4', rejectedQuantity: '0', createdAt: new Date(), updatedAt: new Date() },
    { id: 'grl-2', companyId: 'company-1', goodsReceiptId: 'gr-1', purchaseOrderLineId: 'pol-2', lineNumber: 2, lineType: 'STOCK', productId: 'prod-1', description: 'widget backorder', inventoryLocationId: 'loc-1', orderedQuantity: '6', previouslyReceivedQuantity: '0', receivedQuantity: '6', acceptedQuantity: '6', rejectedQuantity: '0', createdAt: new Date(), updatedAt: new Date() },
    { id: 'grl-3', companyId: 'company-1', goodsReceiptId: 'gr-1', purchaseOrderLineId: 'pol-3', lineNumber: 3, lineType: 'SERVICE', productId: null, description: 'freight', inventoryLocationId: null, orderedQuantity: '1', previouslyReceivedQuantity: '0', receivedQuantity: '1', acceptedQuantity: '1', rejectedQuantity: '0', createdAt: new Date(), updatedAt: new Date() },
  ];
}

function fixture(options: { casFails?: boolean; movementCreateFails?: boolean } = {}) {
  const receipt: any = {
    id: 'gr-1', companyId: 'company-1', status: 'DRAFT', purchaseOrderId: 'po-1', supplierId: 'supplier-1',
    receivedAt: new Date('2026-07-28'), receivedByUserId: 'user-1', postingStatus: 'not_required',
    goodsReceiptNumber: null, inventoryMovementBatchRef: null, createdByUserId: 'user-1',
    createdAt: new Date(), updatedAt: new Date(), lines: receiptLines(),
  };
  const movementCreates: any[] = [];
  const poIncrements: any[] = [];
  const linePointerUpdates: any[] = [];
  let transactionCalls = 0;

  const client: any = {
    $transaction: async (fn: (tx: any) => unknown) => {
      transactionCalls += 1;
      // A real transaction discards every write when the callback throws, the
      // status claim included — so the fixture restores the whole snapshot.
      const snapshot = { receipt: { ...receipt }, movements: movementCreates.length, increments: poIncrements.length, pointers: linePointerUpdates.length };
      try {
        return await fn(client);
      } catch (error) {
        Object.assign(receipt, snapshot.receipt);
        movementCreates.length = snapshot.movements;
        poIncrements.length = snapshot.increments;
        linePointerUpdates.length = snapshot.pointers;
        throw error;
      }
    },
    goodsReceipt: {
      // The pre-flight read the use case validates against. A line id'd
      // `grl-late` models one written after this read but before the
      // transaction, so it is absent here and present inside.
      findUnique: async () => ({ ...receipt, lines: receipt.lines.filter((line: any) => line.id !== 'grl-late') }),
      updateMany: async ({ where, data }: any) => {
        if (options.casFails || receipt.status !== where.status) return { count: 0 };
        Object.assign(receipt, data);
        return { count: 1 };
      },
      findFirstOrThrow: async () => receipt,
    },
    goodsReceiptLine: {
      update: async ({ where, data }: any) => { linePointerUpdates.push({ id: where.id, ...data }); return {}; },
    },
    purchaseOrderLine: {
      updateMany: async ({ where, data }: any) => { poIncrements.push({ id: where.id, increment: String(data.receivedQuantity.increment) }); return { count: 1 }; },
    },
    stockMovement: {
      create: async ({ data }: any) => {
        if (options.movementCreateFails && movementCreates.length === 1) throw new Error('unique constraint violated');
        movementCreates.push(data);
        return { id: `mov-${movementCreates.length}` };
      },
    },
  };

  const reserveKeys: string[] = [];
  const reserveNumber = { execute: async ({ idempotencyKey, documentType }: any) => {
    reserveKeys.push(idempotencyKey);
    // Faithful to PrismaDocumentSequenceRepository.reserveNumber: a repeated
    // idempotency key replays the SAME reservation instead of taking a new one.
    const index = reserveKeys.indexOf(idempotencyKey);
    return { id: `res-${index}`, documentNumber: documentType === 'inventory.movement' ? `MV-${index}` : 'GR-001' };
  } };
  const commits: any[] = [];
  const assertedTargets: any[] = [];

  const useCase = new PostGoodsReceiptUseCase(
    new PrismaProcurementRepository({ client } as any),
    { assertStockTargets: async (_c: any, targets: any) => { assertedTargets.push(...targets); } } as any,
    { log: async () => {} } as any,
    { append: async () => {} } as any,
    reserveNumber as any,
    { execute: async (input: any) => { commits.push(input); } } as any,
  );

  return {
    useCase, receipt, reserveKeys, commits, assertedTargets,
    get movementCreates() { return movementCreates; },
    get poIncrements() { return poIncrements; },
    get linePointerUpdates() { return linePointerUpdates; },
    get transactionCalls() { return transactionCalls; },
  };
}

describe('PostGoodsReceiptUseCase inventory posting', () => {
  it('gives two stock lines for the same product and location distinct movement numbers', async () => {
    const f = fixture();
    await f.useCase.execute(ctx, 'gr-1');

    const movementKeys = f.reserveKeys.filter((key) => key.startsWith('gr:gr-1:'));
    assert.deepEqual(movementKeys, ['gr:gr-1:grl-1', 'gr:gr-1:grl-2']);
    // The regression: keyed on product+location both lines replayed one
    // reservation, and the second insert hit the movementNumber unique index.
    assert.equal(new Set(movementKeys).size, 2);
    assert.equal(f.movementCreates.length, 2);
    const numbers = f.movementCreates.map((movement) => movement.movementNumber);
    assert.equal(new Set(numbers).size, 2, `expected distinct movement numbers, got ${numbers.join(', ')}`);
    assert.deepEqual(f.movementCreates.map((movement) => String(movement.quantity)), ['4', '6']);
    assert.ok(f.movementCreates.every((movement) => movement.movementType === 'STOCK_IN' && movement.direction === 'IN'));
    // Void finds forward movements by reference, not by the line pointer.
    assert.ok(f.movementCreates.every((movement) => movement.referenceType === 'goods_receipt' && movement.referenceId === 'gr-1'));
    assert.deepEqual(f.linePointerUpdates, [
      { id: 'grl-1', inventoryMovementId: 'mov-1' },
      { id: 'grl-2', inventoryMovementId: 'mov-2' },
    ]);
  });

  it('posts the movements and the purchase-order roll-forward in one transaction', async () => {
    const f = fixture();
    await f.useCase.execute(ctx, 'gr-1');

    assert.equal(f.transactionCalls, 1);
    // Every line rolls its PO line forward, service lines included, because the
    // void rollback mirrors this line for line.
    assert.deepEqual(f.poIncrements, [
      { id: 'pol-1', increment: '4' },
      { id: 'pol-2', increment: '6' },
      { id: 'pol-3', increment: '1' },
    ]);
    assert.equal(f.receipt.status, 'POSTED');
    assert.equal(f.receipt.goodsReceiptNumber, 'GR-001');
    assert.equal(f.receipt.postingStatus, 'posted');
    // Stock targets are still validated even though the write left
    // CreateMovementUseCase.
    assert.deepEqual(f.assertedTargets, [
      { productId: 'prod-1', locationId: 'loc-1' },
      { productId: 'prod-1', locationId: 'loc-1' },
    ]);
    assert.deepEqual(f.commits.map((commit) => commit.ownerType), ['goods_receipt', 'stockMovement', 'stockMovement']);
  });

  it('adds no stock when a movement fails mid-way', async () => {
    const f = fixture({ movementCreateFails: true });
    await assert.rejects(() => f.useCase.execute(ctx, 'gr-1'), /unique constraint violated/);

    assert.equal(f.movementCreates.length, 0);
    assert.equal(f.poIncrements.length, 0);
    assert.equal(f.linePointerUpdates.length, 0);
    // The receipt stays postable: no half-posted state to clean up by hand.
    assert.equal(f.receipt.status, 'DRAFT');
    assert.equal(f.receipt.goodsReceiptNumber, null);
  });

  it('fails closed on a stock line that appeared after the targets were validated', async () => {
    const f = fixture();
    f.receipt.lines.push({ ...receiptLines()[0], id: 'grl-late', purchaseOrderLineId: 'pol-4' });
    // The late line went through neither target validation nor a number
    // reservation, so it must not move stock.
    await assert.rejects(() => f.useCase.execute(ctx, 'gr-1'), ConflictException);
    assert.equal(f.movementCreates.length, 0);
    assert.equal(f.poIncrements.length, 0);
    assert.equal(f.receipt.status, 'DRAFT');
  });

  it('rejects with a conflict when the receipt leaves DRAFT before the claim', async () => {
    const f = fixture({ casFails: true });
    await assert.rejects(() => f.useCase.execute(ctx, 'gr-1'), ConflictException);
    assert.equal(f.movementCreates.length, 0);
    assert.equal(f.poIncrements.length, 0);
  });
});
