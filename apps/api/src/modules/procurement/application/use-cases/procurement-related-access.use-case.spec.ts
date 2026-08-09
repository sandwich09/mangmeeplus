import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { GetPurchaseRequestUseCase, ListPurchaseRequestsUseCase } from './purchase-request.use-case';
import { GetPurchaseOrderUseCase, ListPurchaseOrdersUseCase } from './purchase-order.use-case';
import { GetGoodsReceiptUseCase, ListGoodsReceiptsUseCase } from './goods-receipt.use-case';
import { GetVendorBillUseCase, ListVendorBillsUseCase } from './vendor-bill.use-case';
import { GetSupplierPaymentUseCase, ListSupplierPaymentsUseCase } from './supplier-payment.use-case';

const ctx = (permissions: string[], branchIds: string[] | undefined = ['branch-1']) => ({
  companyId: 'company-1', userId: 'actor-1', requestId: 'request-1', roles: ['STAFF'], permissions,
  scopes: branchIds === undefined ? {} : { branchIds },
}) as any;

const families = [
  {
    label: 'purchase request', kind: 'PURCHASE_REQUEST', read: 'procurement.purchase_request.read', related: 'procurement.purchase_request.read_related',
    find: 'findPurchaseRequestById', list: 'listPurchaseRequests', Get: GetPurchaseRequestUseCase, List: ListPurchaseRequestsUseCase,
  },
  {
    label: 'purchase order', kind: 'PURCHASE_ORDER', read: 'procurement.purchase_order.read', related: 'procurement.purchase_order.read_related',
    find: 'findPurchaseOrderById', list: 'listPurchaseOrders', Get: GetPurchaseOrderUseCase, List: ListPurchaseOrdersUseCase,
  },
  {
    label: 'goods receipt', kind: 'GOODS_RECEIPT', read: 'procurement.goods_receipt.read', related: 'procurement.goods_receipt.read_related',
    find: 'findGoodsReceiptById', list: 'listGoodsReceipts', Get: GetGoodsReceiptUseCase, List: ListGoodsReceiptsUseCase,
  },
  {
    label: 'vendor bill', kind: 'VENDOR_BILL', read: 'procurement.vendor_bill.read', related: 'procurement.vendor_bill.read_related',
    find: 'findVendorBillById', list: 'listVendorBills', Get: GetVendorBillUseCase, List: ListVendorBillsUseCase,
  },
  {
    label: 'supplier payment', kind: 'SUPPLIER_PAYMENT', read: 'procurement.supplier_payment.read', related: 'procurement.supplier_payment.read_related',
    find: 'findSupplierPaymentById', list: 'listSupplierPayments', Get: GetSupplierPaymentUseCase, List: ListSupplierPaymentsUseCase,
  },
] as const;

describe('procurement related-document reads', () => {
  for (const family of families) {
    it(`allows a persisted related actor to get one ${family.label}`, async () => {
      const relatedCalls: unknown[][] = [];
      const repo = {
        [family.find]: async () => ({ id: 'document-1', branchId: 'branch-1' }),
        isProcurementDocumentRelatedToUser: async (...args: unknown[]) => { relatedCalls.push(args); return true; },
      };
      const result = await new family.Get(repo as any).execute(ctx([family.related]), 'document-1');
      assert.equal(result.id, 'document-1');
      assert.deepEqual(relatedCalls[0], ['company-1', family.kind, 'document-1', 'actor-1', { branchIds: ['branch-1'] }]);
    });

    it(`denies an unrelated actor and never lets relation bypass branch scope for ${family.label}`, async () => {
      let relatedChecks = 0;
      const repo = {
        [family.find]: async () => ({ id: 'document-1', branchId: 'branch-1' }),
        isProcurementDocumentRelatedToUser: async () => { relatedChecks += 1; return false; },
      };
      await assert.rejects(() => new family.Get(repo as any).execute(ctx([family.related]), 'document-1'), ForbiddenException);
      assert.equal(relatedChecks, 1);
      await assert.rejects(() => new family.Get(repo as any).execute(ctx([family.related], ['branch-2']), 'document-1'), NotFoundException);
      assert.equal(relatedChecks, 1, 'branch denial must happen before relation lookup');
    });

    it(`filters ${family.label} lists to related ids while broad read remains broad`, async () => {
      const calls: unknown[][] = [];
      const repo = {
        [family.list]: async (...args: unknown[]) => { calls.push(args); return { data: [], total: 0 }; },
      };
      const useCase = new family.List(repo as any);
      await useCase.execute(ctx([family.related]), { page: 2 });
      assert.deepEqual(calls[0], ['company-1', { page: 2, relatedUserId: 'actor-1' }, { branchIds: ['branch-1'] }]);
      await useCase.execute(ctx([family.read]), { page: 2 });
      assert.deepEqual(calls[1], ['company-1', { page: 2 }, { branchIds: ['branch-1'] }]);
    });
  }
});
