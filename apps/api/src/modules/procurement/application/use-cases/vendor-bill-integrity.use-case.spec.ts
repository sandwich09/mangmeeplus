import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CreateVendorBillUseCase } from './vendor-bill.use-case.js';

const ctx = (permissions = ['procurement.vendor_bill.create', 'procurement.vendor_bill.direct_entry'], branchIds?: string[]) => ({
  companyId: 'company-1', userId: 'user-1', requestId: 'request-1', permissions,
  scopes: branchIds ? { branchIds } : {},
}) as any;

const line = (overrides: Record<string, unknown> = {}) => ({
  lineNumber: 1, description: 'service', quantity: '1', unitPrice: '100', ...overrides,
});

const dto = (overrides: Record<string, unknown> = {}) => ({
  supplierId: 'supplier-1', billDate: new Date('2026-07-14'), dueDate: new Date('2026-08-14'),
  currency: 'THB', lines: [line()], ...overrides,
}) as any;

function useCase(repo: any) {
  return new CreateVendorBillUseCase(
    repo,
    { log: async () => undefined } as any,
    { append: async () => undefined } as any,
    { resolveSourceTax: async () => assert.fail('tax resolver is not expected in reference-integrity fixtures') } as any,
  );
}

function validRepo(overrides: Record<string, unknown> = {}) {
  return {
    findSupplierById: async () => ({ id: 'supplier-1', companyId: 'company-1', status: 'ACTIVE', taxId: '0100000000001' }),
    branchExists: async () => true,
    findPurchaseOrderById: async () => null,
    findGoodsReceiptById: async () => null,
    createVendorBill: async (_companyId: string, data: any) => ({ id: 'bill-1', companyId: 'company-1', status: 'DRAFT', matchingStatus: 'NOT_REQUIRED', pp36Candidate: false, lines: [], ...data }),
    updateVendorBillStatus: async (_companyId: string, _id: string, status: string) => ({ id: 'bill-1', status }),
    ...overrides,
  } as any;
}

describe('CreateVendorBillUseCase AP reference integrity', () => {
  it('requires a company supplier and an active in-scope company branch before persistence', async () => {
    let created = false;
    const missingSupplier = validRepo({ findSupplierById: async () => null, createVendorBill: async () => { created = true; } });
    await assert.rejects(() => useCase(missingSupplier).execute(ctx(), dto()), /Supplier does not exist/);
    assert.equal(created, false);

    const branchRepo = validRepo({ branchExists: async () => false, createVendorBill: async () => { created = true; } });
    await assert.rejects(() => useCase(branchRepo).execute(ctx(undefined, ['branch-1']), dto({ branchId: 'branch-1' })), /Branch does not exist/);
    await assert.rejects(() => useCase(validRepo()).execute(ctx(undefined, ['branch-2']), dto({ branchId: 'branch-1' })), /outside your assigned branch scope/);
    assert.equal(created, false);
  });

  it('rejects cross-supplier, cross-branch, and foreign purchase-order line references', async () => {
    const po = {
      id: 'po-1', companyId: 'company-1', supplierId: 'supplier-2', branchId: 'branch-1', matchingMode: 'TWO_WAY_PO_BILL', status: 'ISSUED', currency: 'THB',
      lines: [{ id: 'po-line-1' }],
    };
    await assert.rejects(() => useCase(validRepo({ findPurchaseOrderById: async () => po })).execute(
      ctx(['procurement.vendor_bill.create'], ['branch-1']), dto({ purchaseOrderId: 'po-1', branchId: 'branch-1' }),
    ), /does not belong to this supplier/);

    const matchingPo = { ...po, supplierId: 'supplier-1' };
    await assert.rejects(() => useCase(validRepo({ findPurchaseOrderById: async () => matchingPo })).execute(
      ctx(['procurement.vendor_bill.create'], ['branch-2']), dto({ purchaseOrderId: 'po-1', branchId: 'branch-2' }),
    ), /branch does not match/);
    await assert.rejects(() => useCase(validRepo({ findPurchaseOrderById: async () => matchingPo })).execute(
      ctx(['procurement.vendor_bill.create'], ['branch-1']), dto({ purchaseOrderId: 'po-1', branchId: 'branch-1', lines: [line({ purchaseOrderLineId: 'other-line' })] }),
    ), /outside the referenced purchase order/);
  });

  it('requires the goods receipt to belong to the same company supplier purchase order and branch', async () => {
    const po = { id: 'po-1', companyId: 'company-1', supplierId: 'supplier-1', branchId: 'branch-1', matchingMode: 'THREE_WAY_PO_RECEIPT_BILL', status: 'ISSUED', currency: 'THB', lines: [{ id: 'po-line-1' }] };
    const gr = { id: 'gr-1', companyId: 'company-1', supplierId: 'supplier-1', branchId: 'branch-1', purchaseOrderId: 'po-other', status: 'POSTED' };
    await assert.rejects(() => useCase(validRepo({ findPurchaseOrderById: async () => po, findGoodsReceiptById: async () => gr })).execute(
      ctx(['procurement.vendor_bill.create'], ['branch-1']), dto({ purchaseOrderId: 'po-1', goodsReceiptId: 'gr-1', branchId: 'branch-1' }),
    ), /does not belong to the referenced purchase order/);
    await assert.rejects(() => useCase(validRepo({ findPurchaseOrderById: async () => po, findGoodsReceiptById: async () => null })).execute(
      ctx(['procurement.vendor_bill.create'], ['branch-1']), dto({ purchaseOrderId: 'po-1', goodsReceiptId: 'foreign-gr', branchId: 'branch-1' }),
    ), /Goods receipt does not exist in this company/);
  });

  it('derives trusted PO branch/matching mode and forces direct bills to matching NONE', async () => {
    const saved: any[] = [];
    const directRepo = validRepo({ createVendorBill: async (_companyId: string, data: any) => { saved.push(data); return { id: 'direct', status: 'DRAFT', pp36Candidate: false, lines: [], ...data }; } });
    await useCase(directRepo).execute(ctx(), dto({ matchingMode: 'THREE_WAY_PO_RECEIPT_BILL' }));
    assert.equal(saved[0].matchingMode, 'NONE');

    const po = { id: 'po-1', companyId: 'company-1', supplierId: 'supplier-1', branchId: 'branch-1', matchingMode: 'TWO_WAY_PO_BILL', status: 'ISSUED', currency: 'THB', lines: [{ id: 'po-line-1' }] };
    const poRepo = validRepo({
      findPurchaseOrderById: async () => po,
      createVendorBill: async (_companyId: string, data: any) => { saved.push(data); return { id: 'po-bill', status: 'DRAFT', pp36Candidate: false, lines: [], ...data }; },
    });
    await useCase(poRepo).execute(ctx(['procurement.vendor_bill.create'], ['branch-1']), dto({ purchaseOrderId: 'po-1', lines: [line({ purchaseOrderLineId: 'po-line-1' })] }));
    assert.equal(saved[1].branchId, 'branch-1');
    assert.equal(saved[1].matchingMode, 'TWO_WAY_PO_BILL');
  });
});
