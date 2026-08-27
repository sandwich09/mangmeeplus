import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CreateGoodsReceiptUseCase } from './goods-receipt.use-case.js';
import { CreatePurchaseOrderUseCase } from './purchase-order.use-case.js';

const context = (branchIds = ['branch-1']) => ({
  companyId: 'company-1', userId: 'buyer-1', requestId: 'request-1', roles: ['STAFF'],
  permissions: ['procurement.purchase_order.create', 'procurement.goods_receipt.create'],
  scopes: { branchIds },
}) as any;

const audit = { log: async () => undefined } as any;
const outbox = { append: async () => undefined } as any;

const purchaseOrderDto = () => ({
  supplierId: 'supplier-1', orderDate: new Date('2026-08-10'), currency: 'THB',
  sourcePurchaseRequestId: 'pr-1', subtotalAmount: '100', discountAmount: '0', taxableAmount: '100',
  vatAmount: '0', grandTotalAmount: '100', outstandingAmount: '100',
  lines: [{
    lineNumber: 1, lineType: 'SERVICE', description: 'service', orderedQuantity: '1', unitPrice: '100',
    discountAmount: '0', vatMode: 'NO_VAT', vatAmount: '0', lineSubtotalAmount: '100', lineTotalAmount: '100',
    sourcePurchaseRequestLineId: 'pr-line-1',
  }],
});

const purchaseRequest = (overrides: Record<string, unknown> = {}) => ({
  id: 'pr-1', companyId: 'company-1', branchId: 'branch-1', status: 'APPROVED', supplierId: 'supplier-1', currency: 'THB',
  lines: [{ id: 'pr-line-1' }], ...overrides,
});

describe('procurement create source integrity', () => {
  it('converts only an approved PR in scope and passes its branch to the atomic repository mutation', async () => {
    let createData: any;
    const repo = {
      resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

      findPurchaseRequestById: async () => purchaseRequest(),
      branchExists: async () => true,
      createPurchaseOrder: async (_companyId: string, data: any) => { createData = data; return { id: 'po-1' }; },
    };
    const result = await new CreatePurchaseOrderUseCase(repo as any, audit, outbox).execute(context(), purchaseOrderDto());
    assert.equal(result.id, 'po-1');
    assert.equal(createData.branchId, 'branch-1');
  });

  for (const scenario of [
    { label: 'draft source', source: { status: 'DRAFT' } },
    { label: 'already converted source', source: { convertedPurchaseOrderId: 'po-old' } },
    { label: 'different supplier', source: { supplierId: 'supplier-2' } },
    { label: 'different currency', source: { currency: 'USD' } },
    { label: 'foreign line', dto: { lines: [{ ...purchaseOrderDto().lines[0], sourcePurchaseRequestLineId: 'other-line' }] } },
    { label: 'missing source line', source: { lines: [{ id: 'pr-line-1' }, { id: 'pr-line-2' }] } },
  ]) {
    it(`rejects ${scenario.label} before creating a PO`, async () => {
      let creates = 0;
      const repo = {
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

        findPurchaseRequestById: async () => purchaseRequest(scenario.source),
        branchExists: async () => true,
        createPurchaseOrder: async () => { creates += 1; },
      };
      await assert.rejects(
        () => new CreatePurchaseOrderUseCase(repo as any, audit, outbox).execute(context(), { ...purchaseOrderDto(), ...scenario.dto } as any),
        BadRequestException,
      );
      assert.equal(creates, 0);
    });
  }

  it('checks source branch scope before exposing conversion details', async () => {
    const repo = { findPurchaseRequestById: async () => purchaseRequest() };
    await assert.rejects(
      () => new CreatePurchaseOrderUseCase(repo as any, audit, outbox).execute(context(['branch-2']), purchaseOrderDto()),
      NotFoundException,
    );
  });

  it('rejects a goods receipt whose source PO state, supplier, branch, or lines are inconsistent', async () => {
    const baseDto = {
      purchaseOrderId: 'po-1', supplierId: 'supplier-1', branchId: 'branch-1', receivedAt: new Date('2026-08-10'),
      lines: [{ purchaseOrderLineId: 'po-line-1', lineNumber: 1, description: 'service', orderedQuantity: '1', previouslyReceivedQuantity: '0', receivedQuantity: '1', acceptedQuantity: '1' }],
    };
    const cases = [
      { po: { status: 'DRAFT' }, dto: {}, message: /not open for receiving/ },
      { po: {}, dto: { supplierId: 'supplier-2' }, message: /supplier does not match/ },
      { po: {}, dto: { branchId: 'branch-2' }, message: /branch/ },
      { po: {}, dto: { lines: [{ ...baseDto.lines[0], purchaseOrderLineId: 'foreign-line' }] }, message: /outside the purchase order/ },
    ];
    for (const item of cases) {
      let creates = 0;
      const repo = {
        resolveCreateBranchId: async (_companyId: string, scopes: { branchIds?: string[] }, selected?: string) => selected ?? scopes.branchIds?.[0] ?? 'branch-1',

        findPurchaseOrderById: async () => ({ id: 'po-1', branchId: 'branch-1', supplierId: 'supplier-1', status: 'ISSUED', lines: [{ id: 'po-line-1' }], ...item.po }),
        createGoodsReceipt: async () => { creates += 1; },
      };
      await assert.rejects(
        () => new CreateGoodsReceiptUseCase(repo as any, audit).execute(context(['branch-1', 'branch-2']), { ...baseDto, ...item.dto } as any),
        item.message,
      );
      assert.equal(creates, 0);
    }
  });
});
