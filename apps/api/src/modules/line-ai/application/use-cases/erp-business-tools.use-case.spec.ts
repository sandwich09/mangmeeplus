// New LINE business read tools: default-to-current-month periods, permission gates, bounded data.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AccountingGetSummaryTool,
  AccountingListRecentDocumentsTool,
  CompanyEmployeeSummaryTool,
  CompanyEmployeeDetailTool,
  ExpenseGetBreakdownTool,
  ProcurementApOutstandingTool,
} from './erp-business-tools.use-case';
import { resolvePeriodInput, currentMonthRange, ExpenseListRecentTool, SalesGetSalesSummaryTool } from './erp-tools.use-case';
import { InventoryGetStockBalanceTool, InventoryListLowStockTool, InventorySearchProductsTool } from './erp-tools.use-case';
import { NotificationsListOpenAlertsTool } from './erp-dashboard-tools.use-case';
import { WorkflowListAssignedTasksTool, WorkflowListRecentFailuresTool, WorkflowSummarizeRuleHealthTool } from './erp-workflow-tools.use-case';
import { ExpenseGetDailyClosingTool } from './erp-expense-daily-closing.use-case';

const baseCtx = { companyId: 'c1', userId: 'u1', locale: 'th-TH' } as any;

describe('resolvePeriodInput (owner decision: default = now)', () => {
  it('defaults to the current month when no range is given', () => {
    const period = resolvePeriodInput(undefined);
    assert.equal(period.defaulted, true);
    assert.deepEqual({ fromDate: period.fromDate, toDate: period.toDate }, currentMonthRange());
    assert.ok(period.fromDate.endsWith('-01'));
  });

  it('honors an explicit range from the model', () => {
    const period = resolvePeriodInput({ fromDate: '2026-06-01', toDate: '2026-06-30' });
    assert.deepEqual(period, { fromDate: '2026-06-01', toDate: '2026-06-30', defaulted: false });
  });

  it('rejects malformed dates instead of silently changing the requested period', () => {
    assert.throws(() => resolvePeriodInput({ fromDate: 'DROP TABLE', toDate: 'x' }), /INVALID_PERIOD/);
  });
});

// Period-resolution spec §3.3 (P-04): with NO period stated, every period-scoped read tool answers
// for the CURRENT MONTH — daily closing for TODAY, because closing is a per-day question. One test
// per tool, driving the real adapter and reading the window it actually queried or echoed.
describe('§3.3 default period: current month (daily closing: today)', () => {
  const month = () => currentMonthRange();
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const bangkok = (day: string, end = false) => new Date(`${day}T${end ? '23:59:59.999' : '00:00:00'}+07:00`).toISOString();

  it('sales.get_sales_summary reads the current month', async () => {
    const captured: { where?: any } = {};
    const prisma = {
      client: {
        accountingPayment: { groupBy: async (args: any) => { captured.where = args.where; return []; } },
        company: { findUnique: async () => ({ baseCurrency: 'THB' }) },
      },
    } as any;
    const result = await new SalesGetSalesSummaryTool(prisma).execute({ ...baseCtx, permissions: ['crm.report.read'] });
    assert.deepEqual((result.data as any).period, { ...month(), defaultedToCurrentMonth: true });
    assert.equal(captured.where.paidAt.gte.toISOString(), bangkok(month().fromDate));
    assert.equal(captured.where.paidAt.lt.toISOString(), new Date(`${month().toDate}T17:00:00.000Z`).toISOString());
  });

  it('expense.list_recent reads the current month', async () => {
    const captured: { filter?: any } = {};
    const listExpenses = {
      readAiSummary: async (_ctx: any, filter: any) => { captured.filter = filter; return {
        asOf: new Date(), total: 0,
        byCurrency: [{ currency: 'THB', count: 0, totalAmount: '0', paidAmount: '0', outstandingAmount: '0' }],
        byStatus: [], items: [], hasMore: false, nextCursorSource: null,
      }; },
    } as any;
    const result = await new ExpenseListRecentTool(listExpenses, { client: {} } as any)
      .execute({ ...baseCtx, permissions: ['expense.read'] });
    assert.deepEqual((result.data as any).period, { ...month(), defaultedToCurrentMonth: true });
    assert.equal(captured.filter.fromDate, month().fromDate);
    assert.equal(captured.filter.toDate, month().toDate);
  });

  it('accounting.get_summary reads the current month', async () => {
    const captured: { filter?: any } = {};
    const source = { aggregateByType: async (_ctx: any, filter: any) => { captured.filter = filter; return { total: 0, byType: {} }; } } as any;
    const result = await new AccountingGetSummaryTool(source).execute({ ...baseCtx, permissions: ['accounting.document.read'] });
    assert.deepEqual((result.data as any).period, { ...month(), defaultedToCurrentMonth: true });
    assert.equal(captured.filter.fromDate, month().fromDate);
  });

  it('expense.get_breakdown reads the current month', async () => {
    const source = { readAiBreakdown: async () => ({
      asOf: new Date(), byCurrency: [{ currency: 'THB', count: 0, totalAmount: '0' }],
      byCategory: [], byBranch: [], categoryHasMore: false, branchHasMore: false,
    }) } as any;
    const result = await new ExpenseGetBreakdownTool(source).execute({ ...baseCtx, permissions: ['expense.read'] });
    assert.deepEqual((result.data as any).period, { ...month(), defaultedToCurrentMonth: true });
  });

  it('expense.get_breakdown rejects invalid document/payment enums before reading the repository', async () => {
    let calls = 0;
    const source = { readAiBreakdown: async () => { calls++; throw new Error('must not run'); } } as any;
    const tool = new ExpenseGetBreakdownTool(source);
    for (const input of [{ documentStatus: 'confirmed' }, { paymentStatus: 'settled' }]) {
      const result = await tool.execute({ ...baseCtx, permissions: ['expense.read'] }, input as any);
      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, 'UNSUPPORTED_FILTER');
    }
    assert.equal(calls, 0);
  });

  it('expense.get_daily_closing reads TODAY — the documented per-day exception', async () => {
    const { prisma } = makeDailyClosingPrisma();
    const result = await new ExpenseGetDailyClosingTool(prisma).execute(dailyClosingCtx);
    assert.equal(result.status, 'ok');
    assert.equal((result.data as any).date, today());
  });
});

describe('SalesGetSalesSummaryTool', () => {
  function makePrisma(captured: { where?: any } = {}) {
    return {
      client: {
        accountingPayment: {
          groupBy: async (args: any) => {
            captured.where = args.where;
            return [{ currency: 'THB', _sum: { amount: '1250.5000' }, _count: { _all: 2 } }];
          },
        },
        company: { findUnique: async () => ({ baseCurrency: 'THB' }) },
      },
    } as any;
  }

  it('fails closed without crm.report.read', async () => {
    const result = await new SalesGetSalesSummaryTool(makePrisma()).execute({ ...baseCtx, permissions: [] });
    assert.equal(result.status, 'forbidden');
  });

  it('returns recorded customer receipts for the requested Bangkok date and branch scope', async () => {
    const captured: { where?: any } = {};
    const result = await new SalesGetSalesSummaryTool(makePrisma(captured)).execute(
      { ...baseCtx, permissions: ['crm.report.read'], branchIds: ['b1'] },
      { fromDate: '2026-07-12', toDate: '2026-07-12' },
    );
    const data = result.data as any;
    assert.equal(data.totalSales, '1250.5000');
    assert.equal(data.transactionCount, 2);
    assert.equal(data.basis, 'recorded_received_payments');
    assert.equal(captured.where.paidAt.gte.toISOString(), '2026-07-11T17:00:00.000Z');
    assert.equal(captured.where.paidAt.lt.toISOString(), '2026-07-12T17:00:00.000Z');
    assert.deepEqual(captured.where.counterparty, { is: { type: { in: ['CUSTOMER', 'BOTH'] } } });
    assert.deepEqual(captured.where.OR, [{ branchId: { in: ['b1'] } }, { branchId: null }]);
  });
});

describe('AccountingGetSummaryTool', () => {
  // PR #238 review T2: the tool now delegates to ONE snapshot-consistent groupBy on the
  // permission-scoped use case — no page walk, so the old count-mismatch and period-too-large
  // refusals are structurally impossible and gone.
  function aggregateSource(legacy: Record<string, { count: number; totalAmount: string }>) {
    const byType = Object.fromEntries(Object.entries(legacy).map(([key, value]) => [key, {
      ...value, currency: 'THB', totalsByCurrency: [{ currency: 'THB', totalAmount: value.totalAmount, count: value.count }],
    }]));
    const calls: Array<{ ctx: any; filter: any }> = [];
    const total = Object.values(byType).reduce((sum, entry) => sum + entry.count, 0);
    const source = {
      aggregateByType: async (ctx: any, filter: any) => {
        calls.push({ ctx, filter });
        return { total, byType };
      },
    } as any;
    return { source, calls };
  }

  it('fails closed without any accounting document view path', async () => {
    const { source, calls } = aggregateSource({});
    const result = await new AccountingGetSummaryTool(source).execute({ ...baseCtx, permissions: [] });
    assert.equal(result.status, 'forbidden');
    assert.equal(calls.length, 0, 'no repository work happens for a refused caller');
  });

  it('aggregates counts and totals by document type with an echoed period', async () => {
    const { source } = aggregateSource({
      TAX_INVOICE: { count: 2, totalAmount: '150.00' },
      RECEIPT: { count: 1, totalAmount: '25.00' },
    });
    const result = await new AccountingGetSummaryTool(source).execute({ ...baseCtx, permissions: ['accounting.document.read'] });
    const data = result.data as any;
    assert.equal(result.status, 'ok');
    assert.equal(data.total, 3);
    assert.equal(data.byType.TAX_INVOICE.count, 2);
    assert.equal(data.byType.TAX_INVOICE.totalAmount, '150.00');
    assert.equal(data.period.defaultedToCurrentMonth, true);
  });

  it('covers any period size in exactly ONE repository operation (PR #238 T2)', async () => {
    // 250 documents used to take 3 pages (and up to 50); a concurrent insert/move between pages
    // could silently corrupt the money while cardinality still matched. One groupBy sees one
    // snapshot, so the regression here is the call count itself.
    const { source, calls } = aggregateSource({
      TAX_INVOICE: { count: 150, totalAmount: '1500.00' },
      RECEIPT: { count: 100, totalAmount: '200.00' },
    });
    const result = await new AccountingGetSummaryTool(source).execute({ ...baseCtx, permissions: ['accounting.document.read'] });
    const data = result.data as any;
    assert.equal(result.status, 'ok');
    assert.equal(data.total, 250);
    assert.equal(data.byType.TAX_INVOICE.totalAmount, '1500.00');
    assert.equal(data.byType.RECEIPT.totalAmount, '200.00');
    assert.equal(calls.length, 1, 'one snapshot-consistent operation, never a page walk');
    assert.equal(calls[0]!.filter.page, undefined, 'no pagination parameters leak into the aggregate');
  });

  it('carries the exact Decimal sum as a STRING across the tool boundary (PR #238 R2)', async () => {
    // 90071992547409.93 cannot round-trip through a JS Number (2^53 = 9007199254740992 caps the
    // cent-safe range at 90,071,992,547,409.92): Number() would answer ...92 and the satang is
    // gone. The repository's toFixed(2) string must reach the payload unchanged — the prepared
    // formatter already renders string | number.
    const { source } = aggregateSource({ INVOICE: { count: 3, totalAmount: '90071992547409.93' } });
    const result = await new AccountingGetSummaryTool(source).execute({ ...baseCtx, permissions: ['accounting.document.read'] });
    assert.equal((result.data as any).byType.INVOICE.totalAmount, '90071992547409.93');
    assert.notEqual(String(Number('90071992547409.93')), '90071992547409.93', 'the tripwire premise: Number cannot hold this value');
  });

  it('accepts related-record view and leaves relation filtering to the source use case', async () => {
    const { source, calls } = aggregateSource({ INVOICE: { count: 1, totalAmount: '100.00' } });
    const result = await new AccountingGetSummaryTool(source).execute({
      ...baseCtx,
      permissions: ['accounting.document.read_related'],
    });
    assert.equal(result.status, 'ok');
    assert.deepEqual(calls[0]!.ctx.permissions, ['accounting.document.read_related']);
  });
});

describe('AccountingListRecentDocumentsTool', () => {
  it('returns bounded document items without raw rows', async () => {
    const listDocuments = {
      execute: async (_ctx: any, filter: any) => ({
        data: [{ documentNumber: 'INV-001', documentType: filter.documentType ?? 'INVOICE', documentDate: '2026-07-01', status: 'ISSUED', counterpartySnapshotJson: { name: 'ลูกค้า A' }, grandTotalAmount: '100.0000' }],
        total: 1, page: 1, pageSize: 10,
      }),
    } as any;
    const result = await new AccountingListRecentDocumentsTool(listDocuments).execute(
      { ...baseCtx, permissions: ['accounting.document.read'] },
      { documentType: 'INVOICE' },
    );
    const data = result.data as any;
    assert.equal(data.items[0].documentNumber, 'INV-001');
    assert.equal(data.items[0].counterpartyName, 'ลูกค้า A');
  });
});

describe('ProcurementApOutstandingTool', () => {
  const aging = {
    execute: async () => ({
      asOfDate: '2026-07-03', currency: 'THB', totalOutstanding: '900.0000',
      suppliers: [
        { supplierId: 's1', supplierDisplayName: 'Supplier A', totalOutstanding: '600.0000', buckets: [] },
        { supplierId: 's2', supplierDisplayName: 'Supplier B', totalOutstanding: '300.0000', buckets: [] },
      ],
    }),
  } as any;

  it('fails closed without procurement.ap.report', async () => {
    const result = await new ProcurementApOutstandingTool(aging).execute({ ...baseCtx, permissions: [] });
    assert.equal(result.status, 'forbidden');
  });

  it('returns total, supplier count, and top suppliers sorted by outstanding', async () => {
    const result = await new ProcurementApOutstandingTool(aging).execute({ ...baseCtx, permissions: ['procurement.ap.report'] });
    const data = result.data as any;
    assert.equal(data.totalOutstanding, '900.0000');
    assert.equal(data.supplierCount, 2);
    assert.equal(data.topSuppliers[0].supplier, 'Supplier A');
  });
});

describe('CompanyEmployeeSummaryTool', () => {
  // Memberships, not employee-access profiles: the owner counts even before any employee onboarding.
  const memberships = [
    { status: 'ACTIVE', roles: [{ role: { name: 'เจ้าของกิจการ' } }] },
    { status: 'ACTIVE', roles: [{ role: { name: 'พนักงานขาย' } }] },
    { status: 'DISABLED', roles: [{ role: { name: 'พนักงานขาย' } }] },
  ];
  const prisma = { client: { companyMembership: { findMany: async () => memberships } } } as any;

  it('fails closed without access.employee.read', async () => {
    const result = await new CompanyEmployeeSummaryTool(prisma).execute({ ...baseCtx, permissions: [] });
    assert.equal(result.status, 'forbidden');
  });

  it('counts memberships (owner included) — no names or identity fields', async () => {
    const result = await new CompanyEmployeeSummaryTool(prisma).execute({ ...baseCtx, permissions: ['access.employee.read'] });
    const data = result.data as any;
    assert.equal(data.total, 3);
    assert.equal(data.active, 2);
    assert.equal(data.byRole['เจ้าของกิจการ'], 1);
    assert.equal(data.byRole['พนักงานขาย'], 2);
    assert.ok(!JSON.stringify(result).includes('displayName'));
  });

  it('owner-only company reports 1 member, not zero', async () => {
    const ownerOnly = { client: { companyMembership: { findMany: async () => [{ status: 'ACTIVE', roles: [{ role: { name: 'เจ้าของกิจการ' } }] }] } } } as any;
    const result = await new CompanyEmployeeSummaryTool(ownerOnly).execute({ ...baseCtx, permissions: ['access.employee.read'] });
    assert.equal((result.data as any).total, 1);
  });
});

describe('CompanyEmployeeDetailTool', () => {
  function prismaWith(memberships: unknown[]) {
    return { client: { companyMembership: { findMany: async () => memberships } } } as any;
  }
  const somchai = {
    status: 'ACTIVE',
    createdAt: new Date('2026-05-01T00:00:00Z'),
    user: { displayName: 'สมชาย', email: 'somchai@example.com' },
    roles: [{ role: { name: 'พนักงานขาย' } }],
    employeeAccessProfile: { displayName: 'สมชาย ใจดี', legalName: 'นายสมชาย ใจดี', phoneNumber: '0812345678' },
  };

  it('fails closed without access.employee.read', async () => {
    const result = await new CompanyEmployeeDetailTool(prismaWith([somchai])).execute({ ...baseCtx, permissions: [] }, { nameQuery: 'สมชาย' });
    assert.equal(result.status, 'forbidden');
  });

  it('asks for a name when nameQuery is missing (needsName signal for clarify)', async () => {
    const result = await new CompanyEmployeeDetailTool(prismaWith([somchai])).execute({ ...baseCtx, permissions: ['access.employee.read'] });
    assert.deepEqual(result.data, { matches: 0, needsName: true });
  });

  it('returns contact detail on a single match — never identity fields', async () => {
    const result = await new CompanyEmployeeDetailTool(prismaWith([somchai])).execute({ ...baseCtx, permissions: ['access.employee.read'] }, { nameQuery: 'สมชาย' });
    const data = result.data as any;
    assert.equal(data.matches, 1);
    assert.equal(data.employee.name, 'สมชาย ใจดี');
    assert.equal(data.employee.phoneNumber, '0812345678');
    assert.equal(data.employee.email, 'somchai@example.com');
    assert.deepEqual(data.employee.roles, ['พนักงานขาย']);
    assert.ok(!JSON.stringify(result).includes('identity'));
  });

  it('returns bounded candidates when several people match', async () => {
    const somsri = { ...somchai, user: { displayName: 'สมชาย สอง', email: null }, employeeAccessProfile: null };
    const result = await new CompanyEmployeeDetailTool(prismaWith([somchai, somsri])).execute({ ...baseCtx, permissions: ['access.employee.read'] }, { nameQuery: 'สมชาย' });
    const data = result.data as any;
    assert.equal(data.matches, 2);
    assert.equal(data.candidates.length, 2);
    assert.ok(!JSON.stringify(data.candidates).includes('phoneNumber'), 'candidates carry no contact info');
  });

  it('reports zero matches with the query echoed', async () => {
    const result = await new CompanyEmployeeDetailTool(prismaWith([])).execute({ ...baseCtx, permissions: ['access.employee.read'] }, { nameQuery: 'ไม่มีชื่อนี้' });
    assert.deepEqual(result.data, { matches: 0, query: 'ไม่มีชื่อนี้' });
  });
});

describe('ExpenseGetBreakdownTool', () => {
  function makeSource(captured: { ctx?: any; filter?: any } = {}) {
    return {
      readAiBreakdown: async (ctx: any, filter: any) => {
        captured.ctx = ctx; captured.filter = filter;
        return {
          asOf: new Date('2026-07-31T00:00:00Z'),
          byCurrency: [{ currency: 'THB', count: 3, totalAmount: '300.0000' }],
          byCategory: [{ expenseCategoryId: 'cat1', currency: 'THB', count: 3, totalAmount: '300.0000', label: 'ค่าอาหาร' }],
          byBranch: [
            { branchId: 'b1', currency: 'THB', count: 2, totalAmount: '200.0000', label: 'สาขาลาดพร้าว' },
            { branchId: null, currency: 'THB', count: 1, totalAmount: '100.0000', label: null },
          ],
          categoryHasMore: false, branchHasMore: false,
        };
      },
    } as any;
  }

  it('fails closed without any expense read permission', async () => {
    const result = await new ExpenseGetBreakdownTool(makeSource()).execute({ ...baseCtx, permissions: [] });
    assert.equal(result.status, 'forbidden');
  });

  it('groups by category and branch with readable labels', async () => {
    const result = await new ExpenseGetBreakdownTool(makeSource()).execute({ ...baseCtx, permissions: ['expense.read'] });
    const data = result.data as any;
    assert.equal(data.byCategory[0].category, 'ค่าอาหาร');
    assert.equal(data.byBranch[0].branch, 'สาขาลาดพร้าว');
    assert.equal(data.byBranch[1].branch, 'ส่วนกลาง (ไม่ระบุสาขา)');
    assert.equal(data.totalCount, 3);
    assert.equal(data.totalAmount, '300.0000');
    assert.equal(data.period.defaultedToCurrentMonth, true);
  });

  it('applies the caller branch scope to the query (10D ABAC)', async () => {
    const captured: { ctx?: any; filter?: any } = {};
    await new ExpenseGetBreakdownTool(makeSource(captured)).execute({ ...baseCtx, permissions: ['expense.read'], branchIds: ['b1'] });
    assert.deepEqual(captured.ctx.scopes.branchIds, ['b1']);
  });

  it('limits read_own callers to their own records', async () => {
    const captured: { ctx?: any } = {};
    await new ExpenseGetBreakdownTool(makeSource(captured)).execute({ ...baseCtx, permissions: ['expense.read_own'] });
    assert.deepEqual(captured.ctx.permissions, ['expense.read_own']);
  });

  it('limits read_related callers to the persisted actor relation', async () => {
    const captured: { ctx?: any } = {};
    await new ExpenseGetBreakdownTool(makeSource(captured)).execute({ ...baseCtx, permissions: ['expense.read_related'] });
    assert.deepEqual(captured.ctx.permissions, ['expense.read_related']);
  });
});

describe('LINE read-tool empty-result grounding', () => {
  function assertGroundedZero(result: any) {
    assert.equal(result.status, 'ok');
    assert.ok(result.sourceRefs.length > 0);
    assert.ok(result.sourceRefs.every((ref: any) => ref.permissionChecked === true));
  }

  it('grounds empty notification and inventory lists', async () => {
    const notification = await new NotificationsListOpenAlertsTool({ execute: async () => ({ items: [] }) } as any)
      .execute({ ...baseCtx, permissions: ['notification.read'] });
    const products = await new InventorySearchProductsTool({ execute: async () => ({ items: [], total: 0 }) } as any)
      .execute({ ...baseCtx, permissions: ['inventory.product.read'] }, {});
    const lowStock = await new InventoryListLowStockTool({ execute: async () => ({ items: [] }) } as any)
      .execute({ ...baseCtx, permissions: ['inventory.product.read', 'inventory.report.read'] });
    const balances = await new InventoryGetStockBalanceTool({ execute: async () => [] } as any)
      .execute({ ...baseCtx, permissions: ['inventory.product.read'] }, {});
    [notification, products, lowStock, balances].forEach(assertGroundedZero);
  });

  it('grounds empty workflow lists and summaries', async () => {
    const tasks = await new WorkflowListAssignedTasksTool({ execute: async () => ({ items: [], total: 0 }) } as any)
      .execute({ ...baseCtx, permissions: ['workflow.task.read'] });
    const failures = await new WorkflowListRecentFailuresTool({ execute: async () => ({ items: [] }) } as any)
      .execute({ ...baseCtx, permissions: ['workflow.run.read'] });
    const health = await new WorkflowSummarizeRuleHealthTool({ execute: async () => ({ items: [], total: 0 }) } as any)
      .execute({ ...baseCtx, permissions: ['workflow.rule.read'] });
    [tasks, failures, health].forEach(assertGroundedZero);
  });
});

const dailyClosingCtx = {
  companyId: 'c1', userId: 'u1', membershipId: 'm1', permissions: ['expense.read'],
  branchIds: ['b1'], locationIds: [], locale: 'th-TH', requestId: 'r1',
};

function dailyClosingDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1', expenseNumber: 'EXP-1', vendorNameSnapshot: 'ร้านทดสอบ',
    expenseDate: new Date('2026-08-16T00:00:00.000Z'), dueDate: new Date('2026-08-16T00:00:00.000Z'),
    currency: 'THB', grandTotalAmount: '200.0000', paidAmount: '50.0000', outstandingAmount: '150.0000',
    status: 'NEEDS_REVIEW', paymentStatus: 'PARTIALLY_PAID', primaryAttachmentId: 'a1',
    missingReceiptReason: null, taxEvidenceStatus: 'SUPPORTING_ONLY', duplicateStatus: 'NO_MATCH',
    expenseCategory: { name: 'วัตถุดิบ' },
    ...overrides,
  };
}

function makeDailyClosingPrisma() {
  const groupResults = [
    [
      { currency: 'THB', paymentStatus: 'PAID', _count: { _all: 1 }, _sum: { grandTotalAmount: '100.0000', paidAmount: '100.0000', outstandingAmount: '0' } },
      { currency: 'THB', paymentStatus: 'PARTIALLY_PAID', _count: { _all: 1 }, _sum: { grandTotalAmount: '200.0000', paidAmount: '50.0000', outstandingAmount: '150.0000' } },
      { currency: 'USD', paymentStatus: 'UNPAID', _count: { _all: 1 }, _sum: { grandTotalAmount: '10.0000', paidAmount: '0', outstandingAmount: '10.0000' } },
    ],
    [{ currency: 'THB', _count: { _all: 1 }, _sum: { outstandingAmount: '150.0000' } }],
    [{ currency: 'THB', _count: { _all: 2 }, _sum: { outstandingAmount: '20.0000' } }],
    [{ currency: 'USD', _count: { _all: 1 }, _sum: { outstandingAmount: '30.0000' } }],
    [{ status: 'REJECTED', _count: { _all: 1 } }, { status: 'VOIDED', _count: { _all: 1 } }],
  ];
  const countResults = [4, 3, 2, 1];
  const findResults = [
    [dailyClosingDetail(), dailyClosingDetail({ id: 'e2', currency: 'USD', grandTotalAmount: '10.0000', paidAmount: '0', outstandingAmount: '10.0000', paymentStatus: 'UNPAID' })],
    [dailyClosingDetail()],
    [dailyClosingDetail({ id: 'overdue-1', dueDate: new Date('2026-08-15T00:00:00.000Z'), outstandingAmount: '10.0000' })],
    [dailyClosingDetail({ id: 'no-due-1', dueDate: null, currency: 'USD', outstandingAmount: '30.0000' })],
    [dailyClosingDetail({ id: 'pending-1' })],
    [dailyClosingDetail({ id: 'evidence-1', primaryAttachmentId: null, taxEvidenceStatus: 'NEEDS_REVIEW' })],
    [dailyClosingDetail({ id: 'duplicate-1', duplicateStatus: 'POSSIBLE_DUPLICATE' })],
  ];
  const calls = { groupBy: [] as any[], count: [] as any[], findMany: [] as any[], isolationLevel: '' };
  let groupIndex = 0;
  let countIndex = 0;
  let findIndex = 0;
  const db = {
    expenseRecord: {
      groupBy: async (args: unknown) => { calls.groupBy.push(args); return groupResults[groupIndex++] ?? []; },
      count: async (args: unknown) => { calls.count.push(args); return countResults[countIndex++] ?? 0; },
      findMany: async (args: any) => {
        calls.findMany.push(args);
        return (findResults[findIndex++] ?? []).slice(0, args.take);
      },
    },
  };
  const prisma = {
    client: {
      $transaction: async (fn: (tx: typeof db) => unknown, options: { isolationLevel: string }) => {
        calls.isolationLevel = options.isolationLevel;
        return fn(db);
      },
    },
  };
  return { prisma: prisma as any, calls };
}

describe('ExpenseGetDailyClosingTool', () => {
  it('fails before querying for missing permission, invalid date, or out-of-scope branch', async () => {
    const { prisma, calls } = makeDailyClosingPrisma();
    const tool = new ExpenseGetDailyClosingTool(prisma);
    assert.equal((await tool.execute({ ...dailyClosingCtx, permissions: [] }, { date: '2026-08-16' })).status, 'forbidden');
    assert.equal((await tool.execute(dailyClosingCtx, { date: '2026-02-30' })).errorCode, 'INVALID_DATE');
    assert.equal((await tool.execute(dailyClosingCtx, { date: '2026-08-16', branchId: 'b2' })).status, 'forbidden');
    assert.equal(calls.groupBy.length, 0);
  });

  it('returns one repeatable-read, bounded, multi-currency daily-closing snapshot', async () => {
    const { prisma, calls } = makeDailyClosingPrisma();
    const result = await new ExpenseGetDailyClosingTool(prisma).execute(dailyClosingCtx, { date: '2026-08-16', detailLimit: 1 });
    assert.equal(result.status, 'ok');
    const data = result.data as any;
    assert.equal(calls.isolationLevel, 'RepeatableRead');
    assert.equal(calls.groupBy.length + calls.count.length + calls.findMany.length, 16);
    assert.deepEqual(data.occurredToday.totals, [
      { currency: 'THB', count: 2, total: '300.0000' },
      { currency: 'USD', count: 1, total: '10.0000' },
    ]);
    assert.deepEqual(data.occurredToday.paid, [{ currency: 'THB', count: 2, total: '150.0000' }]);
    assert.deepEqual(data.occurredToday.outstanding, [
      { currency: 'THB', count: 1, total: '150.0000' },
      { currency: 'USD', count: 1, total: '10.0000' },
    ]);
    assert.deepEqual(data.dueEndOfDay.totals, [{ currency: 'THB', count: 1, total: '150.0000' }]);
    assert.deepEqual(data.overdue.totals, [{ currency: 'THB', count: 2, total: '20.0000' }]);
    assert.deepEqual(data.unscheduledOutstanding.totals, [{ currency: 'USD', count: 1, total: '30.0000' }]);
    assert.deepEqual(data.excluded, { rejected: 1, voided: 1 });
    assert.deepEqual(data.occurredToday.items, {
      total: 3, shown: 1, remaining: 2,
      items: data.occurredToday.items.items,
    });
    assert.equal(data.occurredToday.items.items[0].category, 'วัตถุดิบ');
    assert.equal(data.evidenceBlockers.items.items[0].evidenceAttention, true);
    assert.equal(data.duplicateRisks.items.items[0].duplicateRisk, true);
    assert.equal(data.limitations.neverSubmittedDocumentsObservable, false);
    assert.equal(data.observability.queryCount, 16);
    assert.equal(data.observability.truncated, true);
    assert.deepEqual(data.scope, { kind: 'restricted_branches' });
    assert.ok(!JSON.stringify(data.occurredToday.totals).includes('บาท'));
    assert.match(result.sourceRefs[0]?.webPath ?? '', /^\/companies\/c1\/expenses$/);

    const occurredWhere = calls.groupBy[0].where.AND[1].expenseDate;
    assert.equal(occurredWhere.gte.toISOString(), '2026-08-16T00:00:00.000Z');
    assert.equal(occurredWhere.lt.toISOString(), '2026-08-17T00:00:00.000Z');
    const submittedWhere = calls.count[0].where.AND[1].uploadedAt;
    assert.equal(submittedWhere.gte.toISOString(), '2026-08-15T17:00:00.000Z');
    assert.equal(submittedWhere.lt.toISOString(), '2026-08-16T17:00:00.000Z');
  });

  it('applies tenant, branch, and own/related ABAC to every snapshot query', async () => {
    for (const permissions of [['expense.read_own'], ['expense.read_related']]) {
      const { prisma, calls } = makeDailyClosingPrisma();
      await new ExpenseGetDailyClosingTool(prisma).execute({ ...dailyClosingCtx, permissions }, { date: '2026-08-16' });
      const queries = [...calls.groupBy, ...calls.count, ...calls.findMany].map((query) => JSON.stringify(query));
      assert.equal(queries.length, 16);
      for (const query of queries) {
        assert.match(query, /"companyId":"c1"/);
        assert.match(query, /"branchId":\{"in":\["b1"\]\}/);
        assert.match(query, /"branchId":null/);
        if (permissions.includes('expense.read_own')) assert.match(query, /"createdByUserId":"u1"/);
        else {
          assert.match(query, /"substituteReceiptEvidences"/);
          assert.match(query, /"payerUserId":"u1"/);
        }
      }
    }
  });

  it('uses an explicitly selected in-scope branch without widening to company-central rows', async () => {
    const { prisma, calls } = makeDailyClosingPrisma();
    const result = await new ExpenseGetDailyClosingTool(prisma).execute(dailyClosingCtx, {
      date: '2026-08-16', branchId: 'b1', detailLimit: 99,
    });
    assert.deepEqual((result.data as any).scope, { kind: 'selected_branch', branchId: 'b1' });
    for (const query of [...calls.groupBy, ...calls.count, ...calls.findMany].map((value) => JSON.stringify(value))) {
      assert.match(query, /"companyId":"c1"/);
      assert.match(query, /"branchId":"b1"/);
      assert.doesNotMatch(query, /"branchId":null/);
    }
    assert.equal(calls.findMany[0].take, 10);
  });
});
