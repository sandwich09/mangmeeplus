import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaProcurementRepository } from './prisma-procurement.repository';

type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  if (where.AND && !(where.AND as Row[]).every((part) => matches(row, part))) return false;
  if (where.OR && !(where.OR as Row[]).some((part) => matches(row, part))) return false;
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'AND' || key === 'OR') return true;
    if (expected && typeof expected === 'object' && 'in' in (expected as Row)) {
      return (expected as Row).in.includes(row[key]);
    }
    return row[key] === expected;
  });
}

function table(rows: Row[]) {
  return {
    findMany: async ({ where, select }: { where?: Row; select?: Row } = {}) => rows
      .filter((row) => matches(row, where))
      .map((row) => select
        ? Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]))
        : row),
  };
}

function repository() {
  const client = {
    purchaseRequest: table([
      { id: 'pr-1', companyId: 'company-1', branchId: 'branch-1', requesterUserId: 'requester-1', createdByUserId: 'requester-1', convertedPurchaseOrderId: 'po-1' },
    ]),
    purchaseOrder: table([
      { id: 'po-1', companyId: 'company-1', branchId: 'branch-1', sourcePurchaseRequestId: 'pr-1', supplierId: 'supplier-1', createdByUserId: 'buyer-1' },
      { id: 'po-cross-branch', companyId: 'company-1', branchId: 'branch-2', sourcePurchaseRequestId: 'pr-1', supplierId: 'supplier-1', createdByUserId: 'other-1' },
    ]),
    goodsReceipt: table([
      { id: 'gr-1', companyId: 'company-1', branchId: 'branch-1', purchaseOrderId: 'po-1', supplierId: 'supplier-1', receivedByUserId: 'receiver-1', createdByUserId: 'receiver-1' },
    ]),
    vendorBill: table([
      { id: 'bill-1', companyId: 'company-1', branchId: 'branch-1', purchaseOrderId: 'po-1', goodsReceiptId: 'gr-1', supplierId: 'supplier-1', createdByUserId: 'finance-1' },
      { id: 'bill-sibling', companyId: 'company-1', branchId: 'branch-1', supplierId: 'supplier-2', createdByUserId: 'finance-2' },
      { id: 'bill-same-supplier-only', companyId: 'company-1', branchId: 'branch-1', supplierId: 'supplier-1', createdByUserId: 'unrelated-1' },
    ]),
    supplierPayment: table([
      { id: 'payment-1', companyId: 'company-1', branchId: 'branch-1', supplierId: 'supplier-2', createdByUserId: 'payer-1', recordedByUserId: 'payer-1' },
    ]),
    purchaseApprovalEvent: table([]),
    auditLog: table([
      { id: 'audit-1', companyId: 'company-1', actorUserId: 'matcher-1', result: 'SUCCESS', targetType: 'vendor_bill', targetId: 'bill-1' },
    ]),
    vendorBillMatch: table([]),
    supplierPaymentAllocation: table([
      { id: 'allocation-1', companyId: 'company-1', supplierPaymentId: 'payment-1', vendorBillId: 'bill-1', createdByUserId: 'payer-1' },
      { id: 'allocation-2', companyId: 'company-1', supplierPaymentId: 'payment-1', vendorBillId: 'bill-sibling', createdByUserId: 'payer-1' },
    ]),
  };
  return new PrismaProcurementRepository({ client } as any);
}

describe('PrismaProcurementRepository related graph', () => {
  it('walks the persisted chain to closure in both directions, including payment siblings', async () => {
    const repo = repository();
    for (const [kind, id] of [
      ['PURCHASE_REQUEST', 'pr-1'], ['PURCHASE_ORDER', 'po-1'], ['GOODS_RECEIPT', 'gr-1'],
      ['VENDOR_BILL', 'bill-1'], ['SUPPLIER_PAYMENT', 'payment-1'], ['VENDOR_BILL', 'bill-sibling'],
    ] as const) {
      assert.equal(await repo.isProcurementDocumentRelatedToUser('company-1', kind, id, 'requester-1', { branchIds: ['branch-1'] }), true, `${kind}:${id}`);
    }
  });

  it('never treats a shared supplier as a document relation and reapplies branch scope at every hop', async () => {
    const repo = repository();
    assert.equal(await repo.isProcurementDocumentRelatedToUser(
      'company-1', 'VENDOR_BILL', 'bill-same-supplier-only', 'requester-1', { branchIds: ['branch-1'] },
    ), false);
    assert.equal(await repo.isProcurementDocumentRelatedToUser(
      'company-1', 'PURCHASE_ORDER', 'po-cross-branch', 'requester-1', { branchIds: ['branch-1'] },
    ), false);
  });

  it('keeps historical successful mutation actors related after mutable header actor fields change', async () => {
    assert.equal(await repository().isProcurementDocumentRelatedToUser(
      'company-1', 'PURCHASE_REQUEST', 'pr-1', 'matcher-1', { branchIds: ['branch-1'] },
    ), true);
  });
});
