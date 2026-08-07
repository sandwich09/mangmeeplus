import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import {
  LedgerGetPeriodStatusTool,
  LedgerGetReportSummaryTool,
  ProcurementGetPurchaseOrderDetailTool,
  ProcurementGetSummaryTool,
  ProcurementSearchSuppliersTool,
} from './erp-procurement-ledger-tools.use-case';

const baseCtx = {
  requestId: 'r1', companyId: 'c1', userId: 'u1', membershipId: 'm1', roles: [],
  permissions: ['procurement.purchase_order.read', 'procurement.supplier.read', 'ledger.period.read', 'ledger.report.read'],
  branchIds: ['b1'], locale: 'th-TH',
};

const period = {
  id: 'period-1', companyId: 'c1', periodKey: '2026-07', startDate: '2026-07-01T00:00:00.000Z',
  endDate: '2026-07-31T00:00:00.000Z', status: 'OPEN', closedAt: null, reopenedAt: null,
};

describe('LINE ERP procurement and ledger tools', () => {
  it('denies all tools before calling their authoritative sources', async () => {
    let calls = 0;
    const source = { execute: async () => { calls += 1; return { data: [], total: 0, page: 1, pageSize: 10 }; } } as any;
    const noPerms = { ...baseCtx, permissions: [] };
    const tools = [
      new ProcurementGetSummaryTool(source),
      new ProcurementSearchSuppliersTool(source),
      new ProcurementGetPurchaseOrderDetailTool(source),
      new LedgerGetPeriodStatusTool(source),
      new LedgerGetReportSummaryTool(source, source, source, source),
    ];
    for (const tool of tools) assert.equal((await tool.execute(noPerms, {})).status, 'forbidden');
    assert.equal(calls, 0);
  });

  it('returns exact PO record counts without inventing a monetary aggregate', async () => {
    const filters: any[] = [];
    const tool = new ProcurementGetSummaryTool({ execute: async (_ctx: any, filter: any) => {
      filters.push(filter);
      return { data: [], total: filter.status === 'DRAFT' ? 2 : filter.status ? 0 : 2, page: 1, pageSize: 1 };
    } } as any);
    const result = await tool.execute(baseCtx, { fromDate: '2026-07-01', toDate: '2026-07-31' });
    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).total, 2);
    assert.equal((result.data as any).byStatus.DRAFT, 2);
    assert.equal((result.data as any).monetarySummaryAvailable, false);
    assert.equal((result.data as any).basis, 'canonical_purchase_order_record_counts');
    assert.equal(filters.every((filter) => filter.branchId === 'b1'), true);
  });

  it('fails closed for disallowed or ambiguous branch scope', async () => {
    const source = { execute: async () => { throw new Error('must not call'); } } as any;
    const tool = new ProcurementGetSummaryTool(source);
    assert.equal((await tool.execute(baseCtx, { branchId: 'b2' })).errorCode, 'BRANCH_SCOPE_DENIED');
    const multiBranch = { ...baseCtx, branchIds: ['b1', 'b2'] };
    assert.equal((await tool.execute(multiBranch)).errorCode, 'MULTI_BRANCH_SUMMARY_UNSUPPORTED');
  });

  it('bounds supplier results and strips private contact/tax fields', async () => {
    const tool = new ProcurementSearchSuppliersTool({ execute: async () => ({
      total: 20, page: 1, pageSize: 10,
      data: Array.from({ length: 10 }, (_, index) => ({
        id: `s${index}`, supplierCode: `SUP-${index}`, displayNameSnapshot: `Supplier ${index}`,
        supplierType: 'DOMESTIC', status: 'ACTIVE', defaultCurrency: 'THB', taxId: 'secret', email: 'secret@example.com', phone: 'secret',
      })),
    }) } as any);
    const result = await tool.execute(baseCtx, { limit: 99, search: 'Supplier' });
    assert.equal((result.data as any).items.length, 10);
    assert.equal((result.data as any).items[0].taxId, undefined);
    assert.equal((result.data as any).items[0].email, undefined);
  });

  it('handles required id, not-found, branch ABAC, and bounded PO money detail honestly', async () => {
    const missingId = new ProcurementGetPurchaseOrderDetailTool({} as any);
    assert.equal(((await missingId.execute(baseCtx)).data as any).needsPurchaseOrderId, true);
    const notFound = new ProcurementGetPurchaseOrderDetailTool({ execute: async () => { throw new NotFoundException(); } } as any);
    const absent = await notFound.execute(baseCtx, { purchaseOrderId: 'missing' });
    assert.equal(absent.status, 'ok');
    assert.deepEqual(absent.data, { found: false });
    assert.equal(absent.errorCode, 'PURCHASE_ORDER_NOT_FOUND');
    assert.equal(absent.sourceRefs[0]?.permissionChecked, true);

    const record = {
      id: 'po1', purchaseOrderNumber: 'PO-1', status: 'ISSUED', supplierId: 's1', supplierSnapshotJson: { displayName: 'Supplier A' }, branchId: 'b1',
      orderDate: new Date('2026-07-01'), expectedDeliveryDate: undefined, currency: 'USD', subtotalAmount: '100.00', discountAmount: '0.00',
      taxableAmount: '100.00', vatAmount: '7.00', whtEstimateAmount: '0.00', grandTotalAmount: '107.00', receivedAmount: '0.00', billedAmount: '0.00',
      outstandingAmount: '107.00', matchingMode: 'TWO_WAY', postingStatus: 'NOT_POSTED', taxSyncStatus: 'NOT_SYNCED',
      lines: Array.from({ length: 25 }, (_, lineNumber) => ({ lineNumber, lineType: 'ITEM', description: `Line ${lineNumber}`, orderedQuantity: '1', receivedQuantity: '0', billedQuantity: '0', unitPrice: '4.00', lineTotalAmount: '4.00', vatAmount: '0.28' })),
    };
    const tool = new ProcurementGetPurchaseOrderDetailTool({ execute: async () => record } as any);
    const result = await tool.execute(baseCtx, { purchaseOrderId: 'po1' });
    assert.equal((result.data as any).currency, 'USD');
    assert.equal((result.data as any).grandTotalAmount, '107.00');
    assert.equal((result.data as any).lineCount, 25);
    assert.equal((result.data as any).lines.length, 20);
    const crossBranch = new ProcurementGetPurchaseOrderDetailTool({ execute: async () => ({ ...record, branchId: 'b2' }) } as any);
    assert.equal((await crossBranch.execute(baseCtx, { purchaseOrderId: 'po1' })).errorCode, 'BRANCH_SCOPE_DENIED');
  });

  it('returns ledger period status and reports missing periods honestly', async () => {
    const tool = new LedgerGetPeriodStatusTool({ execute: async () => [period] } as any);
    assert.equal(((await tool.execute(baseCtx)).data as any).needsPeriodKey, true);
    assert.equal(((await tool.execute(baseCtx, { periodKey: '2026-07' })).data as any).status, 'OPEN');
    const absent = await tool.execute(baseCtx, { periodKey: '2025-01' });
    assert.deepEqual(absent.data, { found: false });
    assert.equal(absent.errorCode, 'LEDGER_PERIOD_NOT_FOUND');
    assert.equal(absent.sourceRefs[0]?.permissionChecked, true);
  });

  it('uses only canonical ledger totals, preserves basis/period, and states the currency gap', async () => {
    let trialCalls = 0;
    let pnlCalls = 0;
    let balanceCalls = 0;
    const tool = new LedgerGetReportSummaryTool(
      { execute: async () => [period] } as any,
      { execute: async () => { trialCalls += 1; return { totalDebit: '100.0000', totalCredit: '100.0000', difference: '0.0000' }; } } as any,
      { execute: async () => { pnlCalls += 1; return { revenue: '70.0000', totalCost: '20.0000', grossProfit: '50.0000', totalExpense: '10.0000', taxExpense: '5.0000', netProfit: '35.0000' }; } } as any,
      { execute: async () => { balanceCalls += 1; return { totalAssets: '200.0000', totalLiabilities: '50.0000', totalEquity: '150.0000' }; } } as any,
    );
    const result = await tool.execute(baseCtx, { periodKey: '2026-07', reportType: 'profit_and_loss' });
    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).periodKey, '2026-07');
    assert.equal((result.data as any).basis, 'canonical_ledger_account_balances');
    assert.equal((result.data as any).currency, null);
    assert.equal((result.data as any).profitAndLoss.netProfit, '35.0000');
    assert.deepEqual([trialCalls, pnlCalls, balanceCalls], [0, 1, 0]);
    const absent = await tool.execute(baseCtx, { periodKey: 'missing' });
    assert.deepEqual(absent.data, { found: false });
    assert.equal(absent.errorCode, 'LEDGER_PERIOD_NOT_FOUND');
    assert.equal(absent.sourceRefs[0]?.permissionChecked, true);
  });
});
