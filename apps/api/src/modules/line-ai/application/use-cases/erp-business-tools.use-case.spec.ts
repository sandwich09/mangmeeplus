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
import { ListExpensesUseCase } from '../../../expenses/application/use-cases/expense-draft.use-case';
import { mergeVendorBreakdownGroups, type VendorBreakdownRawGroup } from '../../../expenses/infrastructure/prisma-expense.repository';

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
      byCategory: [], byBranch: [], byVendor: [], categoryHasMore: false, branchHasMore: false, vendorHasMore: false,
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

  // Advisor spec §5.5: the link opens "รายชื่อพนักงาน" (same `access.employee.read` route), not the
  // add-employee form at /settings/employees.
  it('links to the employee list page', async () => {
    const result = await new CompanyEmployeeSummaryTool(prisma).execute({ ...baseCtx, permissions: ['access.employee.read'] });
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/settings/access-overview');
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

  it('links to the employee list page, not the add-employee form', async () => {
    const result = await new CompanyEmployeeDetailTool(prismaWith([somchai])).execute({ ...baseCtx, permissions: ['access.employee.read'] }, { nameQuery: 'สมชาย' });
    assert.equal(result.sourceRefs[0]?.webPath, '/companies/c1/settings/access-overview');
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
  function makeSource(captured: { ctx?: any; filter?: any } = {}, overrides: { byVendor?: any[]; vendorHasMore?: boolean } = {}) {
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
          byVendor: overrides.byVendor ?? [],
          categoryHasMore: false, branchHasMore: false, vendorHasMore: overrides.vendorHasMore ?? false,
        };
      },
      listCategoryCandidates: async () => [],
      readAiVendorCandidates: async () => [],
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

  it('R7 linked source is replaced only inside the same filtered population', async () => {
    for (const documentStatus of [undefined, 'NEEDS_REVIEW'] as const) {
      // T12 proves the repository population. These are its visible snapshots: a source and
      // projection replace each other only when the projection matches this query.
      const filtered = Boolean(documentStatus);
      const count = filtered ? 1 : 2, amount = filtered ? '1000' : '1200';
      const seen: any[] = [];
      const source = new ListExpensesUseCase({
        readAiExpenseSummary: async (filter: any, scope: any) => {
          seen.push({ filter, scope });
          return { asOf: new Date('2026-10-31T00:00:00Z'), total: count,
            byCurrency: [{ currency: 'THB', count, totalAmount: amount, paidAmount: '0', outstandingAmount: amount }],
            byStatus: [{ status: documentStatus ?? 'CONFIRMED', currency: 'THB', count, totalAmount: amount }],
            items: [{ id: filtered ? 'source' : 'unrelated', expenseNumber: null, expenseDate: new Date('2026-10-20T00:00:00Z'),
              vendorNameSnapshot: 'ผู้ขาย', vendorDocumentNumber: null, status: documentStatus ?? 'CONFIRMED', paymentStatus: 'UNPAID',
              currency: 'THB', grandTotalAmount: filtered ? '1000' : '200', paidAmount: '0', outstandingAmount: filtered ? '1000' : '200' }],
            hasMore: !filtered, nextCursorSource: filtered ? null : { expenseDate: new Date('2026-10-20T00:00:00Z'), id: 'unrelated' } };
        },
        readAiExpenseBreakdown: async (filter: any, scope: any) => {
          seen.push({ filter, scope });
          return { asOf: new Date('2026-10-31T00:00:00Z'), byCurrency: [{ currency: 'THB', count, totalAmount: amount }],
            byCategory: [{ expenseCategoryId: null, currency: 'THB', count, totalAmount: amount, label: null }],
            byBranch: [], byVendor: [], categoryHasMore: false, branchHasMore: false, vendorHasMore: false };
        },
      } as any);
      const ctx = { ...baseCtx, permissions: ['expense.read_related'], branchIds: ['b1'] };
      const input = { period: { fromDate: '2026-10-01', toDate: '2026-10-31' }, ...(documentStatus ? { documentStatus } : {}) };
      const results = [await new ExpenseListRecentTool(source, { client: {} } as any).execute(ctx, { ...input, limit: 1 }),
        await new ExpenseGetBreakdownTool(source).execute(ctx, input)];
      for (const result of results) {
        assert.equal(result.status, 'ok');
        assert.equal((result.data as any).totalAmount ?? (result.data as any).summary?.totalAmount, amount);
        const total = result.facts?.find(fact => fact.metric === 'expense_total');
        assert.equal(total?.value, amount);
        assert.equal(result.queryApplied?.accessScope, 'related');
        assert.ok(result.sourceRefs.every(ref => ref.permissionChecked));
      }
      assert.ok(seen.every(({ filter, scope }) => filter.companyId === ctx.companyId && filter.status === documentStatus
        && scope.relatedUserId === ctx.userId && scope.branchIds[0] === 'b1'));
    }
  });

  it('spec §4 R-M1: echoes the effective groupBy in queryApplied, defaulting to category', async () => {
    const defaulted = await new ExpenseGetBreakdownTool(makeSource()).execute({ ...baseCtx, permissions: ['expense.read'] });
    assert.equal(defaulted.queryApplied?.filters?.['groupBy'], 'category');
    const byVendor = await new ExpenseGetBreakdownTool(makeSource()).execute({ ...baseCtx, permissions: ['expense.read'] }, { groupBy: 'vendor' } as any);
    assert.equal(byVendor.queryApplied?.filters?.['groupBy'], 'vendor');
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

  // Item 1 (spec R-A1 row 18, eval: 15 turns): echoes readAiBreakdown's own accessScope into
  // queryApplied so the answer can state "only your own records" instead of a bare own-scoped total.
  it('echoes a non-company accessScope from readAiBreakdown into queryApplied', async () => {
    const source = {
      readAiBreakdown: async () => ({
        asOf: new Date('2026-07-31T00:00:00Z'), byCurrency: [], byCategory: [], byBranch: [], byVendor: [],
        categoryHasMore: false, branchHasMore: false, vendorHasMore: false, accessScope: 'related',
      }),
      listCategoryCandidates: async () => [], readAiVendorCandidates: async () => [],
    } as any;
    const result = await new ExpenseGetBreakdownTool(source).execute({ ...baseCtx, permissions: ['expense.read_related'] });
    assert.equal((result.data as any).queryApplied.accessScope, 'related');
  });

  it('defaults to company scope when the use case predates accessScope', async () => {
    const result = await new ExpenseGetBreakdownTool(makeSource()).execute({ ...baseCtx, permissions: ['expense.read'] });
    assert.equal((result.data as any).queryApplied.accessScope, 'company');
  });

  // byVendor (spec §3 row 5 / plan P4.1): top 10 by amount descending, the null-vendor group
  // labelled "ไม่ระบุร้าน", and vendorHasMore folded into the pooled completeness.groups signal.
  describe('byVendor', () => {
    const vendorGroup = (i: number, amount: number) => ({
      vendorCounterpartyId: `v${i}`, currency: 'THB', count: 1, totalAmount: amount.toFixed(4), label: `ร้าน ${i}`, linked: true,
    });

    it('orders vendors by amount descending and labels the no-vendor group', async () => {
      const byVendor = [vendorGroup(1, 500), { vendorCounterpartyId: null, currency: 'THB', count: 2, totalAmount: '50.0000', label: null, linked: false }, vendorGroup(2, 100)];
      const result = await new ExpenseGetBreakdownTool(makeSource({}, { byVendor })).execute({ ...baseCtx, permissions: ['expense.read'] });
      const data = result.data as any;
      assert.deepEqual(data.byVendor.map((v: any) => v.vendorId), ['v1', null, 'v2']);
      assert.equal(data.byVendor[0].vendor, 'ร้าน 1');
      assert.equal(data.byVendor[0].linked, true);
      assert.equal(data.byVendor[1].vendor, 'ไม่ระบุร้าน');
      assert.equal(data.byVendor[1].linked, false);
      assert.equal(data.byVendor[0].totalAmount, '500.0000');
    });

    it('surfaces vendorHasMore and folds it into the pooled completeness signal', async () => {
      const byVendor = Array.from({ length: 10 }, (_, i) => vendorGroup(i, 1000 - i));
      const result = await new ExpenseGetBreakdownTool(makeSource({}, { byVendor, vendorHasMore: true })).execute({ ...baseCtx, permissions: ['expense.read'] });
      const data = result.data as any;
      assert.equal(data.byVendor.length, 10);
      assert.equal(data.vendorHasMore, true);
      assert.equal(data.completeness.groups.hasMore, true);
      assert.equal(data.completeness.groups.returned, data.byCategory.length + data.byBranch.length + data.byVendor.length);
    });
  });

  // 2026-09-27 review: "ไม่ระบุร้าน" was misleading — a reimbursement projection (never linked to a
  // counterparty, CON-4) and an older snapshot-only expense both HAVE a real vendor name. These
  // test the repository's merge logic directly (mergeVendorBreakdownGroups), since the tool-level
  // fakes above bypass the repository and can't exercise it.
  describe('mergeVendorBreakdownGroups (repository merge, spec §3 row 5 review)', () => {
    const raw = (over: Partial<VendorBreakdownRawGroup>): VendorBreakdownRawGroup => ({
      vendorCounterpartyId: null, vendorNameSnapshot: null, currency: 'THB', count: 1, totalAmount: '100.0000', ...over,
    });

    it('a linked vendor keeps its counterparty id and is marked linked', () => {
      const { vendorPage } = mergeVendorBreakdownGroups([raw({ vendorCounterpartyId: 'v1', vendorNameSnapshot: 'ร้านเดิม' })], 500, 10);
      assert.deepEqual(vendorPage, [{ vendorCounterpartyId: 'v1', snapshotLabel: null, currency: 'THB', count: 1, totalAmount: '100.0000' }]);
    });

    it('an unlinked snapshot-only vendor is labelled from its snapshot, not "ไม่ระบุร้าน"', () => {
      const { vendorPage } = mergeVendorBreakdownGroups([raw({ vendorNameSnapshot: '  ร้านเก่าไม่ผูกคู่ค้า  ' })], 500, 10);
      assert.equal(vendorPage[0]!.vendorCounterpartyId, null);
      assert.equal(vendorPage[0]!.snapshotLabel, 'ร้านเก่าไม่ผูกคู่ค้า');
    });

    it('a reimbursement projection keeps its "เบิกคืนพนักงาน: …" snapshot as an unlinked label', () => {
      const { vendorPage } = mergeVendorBreakdownGroups([raw({ vendorNameSnapshot: 'เบิกคืนพนักงาน: สมชาย ใจดี' })], 500, 10);
      assert.equal(vendorPage[0]!.vendorCounterpartyId, null);
      assert.equal(vendorPage[0]!.snapshotLabel, 'เบิกคืนพนักงาน: สมชาย ใจดี');
    });

    it('only a row with neither an id nor a snapshot becomes the "unknown" group', () => {
      const { vendorPage } = mergeVendorBreakdownGroups([raw({ vendorNameSnapshot: null }), raw({ vendorNameSnapshot: '   ' })], 500, 10);
      // Both rows have no real name (one null, one whitespace-only) and share the currency, so
      // they merge into ONE unknown row, not two.
      assert.equal(vendorPage.length, 1);
      assert.equal(vendorPage[0]!.vendorCounterpartyId, null);
      assert.equal(vendorPage[0]!.snapshotLabel, null);
      assert.equal(vendorPage[0]!.count, 2);
    });

    it('merges every snapshot variant of one linked vendor into its single canonical row', () => {
      const { vendorPage } = mergeVendorBreakdownGroups([
        raw({ vendorCounterpartyId: 'v1', vendorNameSnapshot: 'ร้านสมใจ', totalAmount: '100.0000', count: 1 }),
        raw({ vendorCounterpartyId: 'v1', vendorNameSnapshot: 'ร้านสมใจ (สาขา 2)', totalAmount: '50.0000', count: 2 }),
      ], 500, 10);
      assert.equal(vendorPage.length, 1);
      assert.equal(vendorPage[0]!.vendorCounterpartyId, 'v1');
      assert.equal(vendorPage[0]!.totalAmount, '150.0000');
      assert.equal(vendorPage[0]!.count, 3);
    });

    it('keeps currencies separate for the same vendor', () => {
      const { vendorPage } = mergeVendorBreakdownGroups([
        raw({ vendorCounterpartyId: 'v1', currency: 'THB', totalAmount: '100.0000' }),
        raw({ vendorCounterpartyId: 'v1', currency: 'USD', totalAmount: '10.0000' }),
      ], 500, 10);
      assert.equal(vendorPage.length, 2);
    });

    it('ranks the merged (not raw) rows by amount descending', () => {
      const { vendorPage } = mergeVendorBreakdownGroups([
        // Split across two snapshot rows, a linked vendor's TRUE total (250) outranks a bigger
        // single raw row (200) only once the two are merged first.
        raw({ vendorCounterpartyId: 'v1', vendorNameSnapshot: 'A', totalAmount: '150.0000' }),
        raw({ vendorCounterpartyId: 'v2', vendorNameSnapshot: 'B', totalAmount: '200.0000' }),
        raw({ vendorCounterpartyId: 'v1', vendorNameSnapshot: 'A (2)', totalAmount: '100.0000' }),
      ], 500, 10);
      assert.deepEqual(vendorPage.map((v) => v.vendorCounterpartyId), ['v1', 'v2']);
      assert.equal(vendorPage[0]!.totalAmount, '250.0000');
    });

    it('sets vendorHasMore when the raw fetch hits the fetch bound, even with 10 or fewer merged vendors', () => {
      const rows = Array.from({ length: 6 }, (_, i) => raw({ vendorCounterpartyId: `v${i}`, totalAmount: '10.0000' }));
      const { vendorHasMore, vendorPage } = mergeVendorBreakdownGroups(rows, 5, 10);
      assert.equal(vendorHasMore, true);
      assert.equal(vendorPage.length, 5);
    });

    it('sets vendorHasMore when the merged population exceeds the display cap, even under the fetch bound', () => {
      const rows = Array.from({ length: 12 }, (_, i) => raw({ vendorCounterpartyId: `v${i}`, totalAmount: `${12 - i}.0000` }));
      const { vendorHasMore, vendorPage } = mergeVendorBreakdownGroups(rows, 500, 10);
      assert.equal(vendorHasMore, true);
      assert.equal(vendorPage.length, 10);
    });

    it('does not set vendorHasMore when everything fits', () => {
      const rows = [raw({ vendorCounterpartyId: 'v1' })];
      const { vendorHasMore } = mergeVendorBreakdownGroups(rows, 500, 10);
      assert.equal(vendorHasMore, false);
    });
  });

  // categoryName/vendorName resolution (spec §3 row 6): wired identically to expense.list_recent —
  // the full match-semantics matrix (exact, contains, ambiguous, not_found, id/name conflict,
  // read_own scoping) is covered against ExpenseListRecentTool in
  // erp-expense-list-recent.use-case.spec.ts; these confirm expense.get_breakdown is wired to the
  // same helper and shapes its own responses the same way.
  // C3 (batch 5c, T-148-b): this tool had NO branch resolution at all — a branchId that was really a
  // name/code/number (e.g. "2" for "สาขา 2") reached the repository as a literal id and silently
  // matched nothing. Now shares `resolveExpenseBranchFilter` with expense.list_recent (full exact/
  // fuzzy/out-of-scope coverage lives in erp-expense-list-recent.use-case.spec.ts); these two confirm
  // this tool is actually wired to it.
  describe('branchId resolution (C3, batch 5c)', () => {
    function fakeBranchPrisma(branches: Array<{ id: string; name: string; code?: string }>) {
      const rows = branches.map((b) => ({ id: b.id, name: b.name, code: b.code ?? null }));
      const allowed = (where: any) => rows.filter((b) => {
        if (where?.id?.in && !where.id.in.includes(b.id)) return false;
        if (where?.name && where.name !== b.name) return false;
        if (where?.OR && !where.OR.some((term: any) => (term.id !== undefined && term.id === b.id)
          || (term.code !== undefined && term.code === b.code) || (term.name !== undefined && term.name === b.name))) return false;
        return true;
      });
      return { client: { branch: { findMany: async ({ where, take }: any) => allowed(where).slice(0, take) } } } as any;
    }

    function makeBranchTool(filters: any[], branches: Array<{ id: string; name: string; code?: string }>) {
      const source = {
        readAiBreakdown: async (_ctx: any, filter: any) => {
          filters.push(filter);
          return {
            asOf: new Date(), byCurrency: [{ currency: 'THB', count: 0, totalAmount: '0' }],
            byCategory: [], byBranch: [], byVendor: [], categoryHasMore: false, branchHasMore: false, vendorHasMore: false,
          };
        },
        listCategoryCandidates: async () => [], readAiVendorCandidates: async () => [],
      } as any;
      return new ExpenseGetBreakdownTool(source, fakeBranchPrisma(branches));
    }

    it('resolves "2" to the branch whose name ends in that number, instead of filtering on the literal string', async () => {
      const filters: any[] = [];
      const tool = makeBranchTool(filters, [
        { id: 'b1', name: 'สำนักงานใหญ่', code: 'BR1' },
        { id: 'b2', name: 'สาขา 2', code: 'BR2' },
      ]);
      const result = await tool.execute({ ...baseCtx, permissions: ['expense.read'] }, { branchId: '2' } as any);

      assert.equal(result.status, 'ok');
      assert.equal(filters[0]?.branchId, 'b2');
      assert.equal((result.data as any).queryApplied?.branch?.branchId, 'b2');
    });

    it('returns the branch catalog instead of a (silently empty) breakdown when the branch cannot be resolved', async () => {
      const filters: any[] = [];
      const tool = makeBranchTool(filters, [{ id: 'b1', name: 'สาขา 1', code: 'BR1' }]);
      const result = await tool.execute({ ...baseCtx, permissions: ['expense.read'] }, { branchId: 'สาขา 99' } as any);

      assert.equal(filters.length, 0);
      assert.equal((result.data as any).branchUnresolved, 'สาขา 99');
      assert.ok(result.sourceRefs.length > 0);
    });
  });

  describe('categoryName / vendorName resolution', () => {
    function makeNamedSource(categories: Array<{ id: string; name: string }>, vendors: Array<{ id: string; name: string }>) {
      const filters: any[] = [];
      return {
        readAiBreakdown: async (_ctx: any, filter: any) => {
          filters.push(filter);
          return {
            asOf: new Date(), byCurrency: [{ currency: 'THB', count: 0, totalAmount: '0' }],
            byCategory: [], byBranch: [], byVendor: [], categoryHasMore: false, branchHasMore: false, vendorHasMore: false,
          };
        },
        listCategoryCandidates: async () => categories,
        readAiVendorCandidates: async () => vendors,
        filters,
      } as any;
    }

    it('resolves an exact category name to its id', async () => {
      const source = makeNamedSource([{ id: 'cat1', name: 'ค่าน้ำมัน' }, { id: 'cat2', name: 'ค่าไฟ' }], []);
      const result = await new ExpenseGetBreakdownTool(source).execute({ ...baseCtx, permissions: ['expense.read'] }, { categoryName: 'ค่าน้ำมัน' } as any);
      assert.equal(result.status, 'ok');
      assert.equal(source.filters[0].expenseCategoryId, 'cat1');
      assert.equal((result.data as any).queryApplied.filters.categoryName, 'ค่าน้ำมัน');
    });

    // batch 9a real repro, through the real tool: the model itself sent categoryName "ค่าเดินทาน"
    // (one Thai character off "ค่าเดินทาง") calling this tool, not a user typo forwarded verbatim.
    it('resolves the model\'s one-character miswrite of a category name to its id', async () => {
      const source = makeNamedSource([{ id: 'cat1', name: 'ค่าเดินทาง' }, { id: 'cat2', name: 'ค่าน้ำมัน' }], []);
      const result = await new ExpenseGetBreakdownTool(source).execute({ ...baseCtx, permissions: ['expense.read'] }, { categoryName: 'ค่าเดินทาน' } as any);
      assert.equal(result.status, 'ok');
      assert.equal(source.filters[0].expenseCategoryId, 'cat1');
      assert.equal((result.data as any).queryApplied.filters.categoryName, 'ค่าเดินทาง');
    });

    it('returns a structured ambiguity for several vendor name matches', async () => {
      const source = makeNamedSource([], [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }]);
      const result = await new ExpenseGetBreakdownTool(source).execute({ ...baseCtx, permissions: ['expense.read'] }, { vendorName: 'สมใจ' } as any);
      assert.equal(result.status, 'ok');
      assert.equal(source.filters.length, 0);
      assert.equal((result.data as any).vendorAmbiguous, 'สมใจ');
      assert.deepEqual((result.data as any).availableVendors, [{ id: 'v1', name: 'ร้านสมใจ' }, { id: 'v2', name: 'ร้านสมใจการค้า' }]);
      // Item 2 (223-turn eval batch 2): this 'ok' result must carry a real source citation, or the
      // gateway's enforceSourceHonesty boundary check discards it as TOOL_RESULT_NO_SOURCE before
      // any caller (classic or model-driven) ever sees availableVendors.
      assert.ok(result.sourceRefs.length > 0);
      assert.ok(result.sourceRefs.every((ref) => ref.permissionChecked === true && ref.module === 'expenses'));
    });

    it('returns a not-found result listing the available categories instead of a breakdown', async () => {
      const source = makeNamedSource([{ id: 'cat1', name: 'ค่าน้ำมัน' }, { id: 'cat2', name: 'ค่าไฟ' }], []);
      const result = await new ExpenseGetBreakdownTool(source).execute({ ...baseCtx, permissions: ['expense.read'] }, { categoryName: 'ค่าเช่า' } as any);
      assert.equal(result.status, 'ok');
      assert.equal(source.filters.length, 0);
      assert.equal((result.data as any).categoryUnresolved, 'ค่าเช่า');
      assert.deepEqual((result.data as any).availableCategories, [{ id: 'cat1', name: 'ค่าน้ำมัน' }, { id: 'cat2', name: 'ค่าไฟ' }]);
      // Item 2: same source-honesty requirement as the ambiguous case above.
      assert.ok(result.sourceRefs.length > 0);
      assert.ok(result.sourceRefs.every((ref) => ref.permissionChecked === true && ref.module === 'expenses'));
    });

    it('returns an input error when categoryId and categoryName disagree', async () => {
      const source = makeNamedSource([{ id: 'cat1', name: 'ค่าน้ำมัน' }], []);
      const result = await new ExpenseGetBreakdownTool(source).execute(
        { ...baseCtx, permissions: ['expense.read'] },
        { categoryId: 'cat-other', categoryName: 'ค่าน้ำมัน' } as any,
      );
      assert.equal(result.status, 'error');
      assert.equal(result.errorCode, 'UNSUPPORTED_FILTER');
      assert.equal(source.filters.length, 0);
    });
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

// F3 (tuning-6b): the caller's own scoped branch catalog (`dailyClosingCtx.branchIds` defaults to
// ['b1']) — `resolveExpenseBranchFilter` reads `prisma.client.branch.findMany` directly (never inside
// the $transaction below), same fake shape as `erp-expense-list-recent.use-case.spec.ts`'s fakePrisma.
function makeDailyClosingPrisma(branches: Array<{ id: string; name: string; code?: string }> = [{ id: 'b1', name: 'สาขา 1', code: 'BR1' }]) {
  const branchRows = branches.map((b) => ({ id: b.id, name: b.name, code: b.code ?? null }));
  const allowedBranches = (where: any) => branchRows.filter((b) => {
    if (where?.companyId && where.companyId !== 'c1') return false;
    if (where?.status && where.status !== 'ACTIVE') return false;
    if (where?.id?.in && !where.id.in.includes(b.id)) return false;
    if (where?.name !== undefined && where.name !== b.name) return false;
    if (where?.OR && !where.OR.some((term: any) => (term.id !== undefined && term.id === b.id)
      || (term.code !== undefined && term.code === b.code) || (term.name !== undefined && term.name === b.name))) return false;
    return true;
  });
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
  const countResults = [4, 3, 1];
  const findResults = [
    [dailyClosingDetail(), dailyClosingDetail({ id: 'e2', currency: 'USD', grandTotalAmount: '10.0000', paidAmount: '0', outstandingAmount: '10.0000', paymentStatus: 'UNPAID' })],
    [dailyClosingDetail()],
    [dailyClosingDetail({ id: 'overdue-1', dueDate: new Date('2026-08-15T00:00:00.000Z'), outstandingAmount: '10.0000' })],
    [dailyClosingDetail({ id: 'no-due-1', dueDate: null, currency: 'USD', outstandingAmount: '30.0000' })],
    [dailyClosingDetail({ id: 'pending-1' })],
    [dailyClosingDetail({ id: 'evidence-1', primaryAttachmentId: null, taxEvidenceStatus: 'NEEDS_REVIEW' }), dailyClosingDetail({ id: 'evidence-2', primaryAttachmentId: null })],
    [dailyClosingDetail({ id: 'duplicate-1', duplicateStatus: 'POSSIBLE_DUPLICATE' })],
  ];
  const calls = { groupBy: [] as any[], count: [] as any[], findMany: [] as any[], isolationLevel: '' };
  let groupIndex = 0;
  let countIndex = 0;
  let findIndex = 0;
  const db = {
    attachmentLink: { findMany: async () => [] },
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
      branch: {
        findMany: async ({ where, take }: any) => allowedBranches(where).slice(0, take),
      },
    },
  };
  return { prisma: prisma as any, calls, findResults };
}

describe('ExpenseGetDailyClosingTool', () => {
  it('fails before querying for missing permission or invalid date', async () => {
    const { prisma, calls } = makeDailyClosingPrisma();
    const tool = new ExpenseGetDailyClosingTool(prisma);
    assert.equal((await tool.execute({ ...dailyClosingCtx, permissions: [] }, { date: '2026-08-16' })).status, 'forbidden');
    assert.equal((await tool.execute(dailyClosingCtx, { date: '2026-02-30' })).errorCode, 'INVALID_DATE');
    assert.equal(calls.groupBy.length, 0);
  });

  // F3 (tuning-6b, T-105-b/run4): branch resolution now reuses resolveExpenseBranchFilter, the same
  // lookup expense.list_recent/get_breakdown already use — a bare id-equality check here used to
  // return 'forbidden' for a real branch name/number the model copied verbatim from the user.
  describe('branch resolution (F3, tuning-6b)', () => {
    it('resolves a bare number to the caller\'s own scoped branch, instead of a bare forbidden', async () => {
      const { prisma, calls } = makeDailyClosingPrisma([{ id: 'b1', name: 'สาขา 2', code: 'BR2' }]);
      const result = await new ExpenseGetDailyClosingTool(prisma).execute(dailyClosingCtx, { date: '2026-08-16', branchId: '2' });
      assert.equal(result.status, 'ok');
      assert.deepEqual((result.data as any).scope, { kind: 'selected_branch', branchId: 'b1' });
      assert.ok(calls.groupBy.length > 0, 'the transaction runs once the branch resolves');
    });

    it('reports an unresolved branch instead of silently querying a nonexistent id and reporting zero (unrestricted caller)', async () => {
      const { prisma, calls } = makeDailyClosingPrisma([{ id: 'b1', name: 'สาขา 1', code: 'BR1' }]);
      const unrestrictedCtx = { ...dailyClosingCtx, branchIds: undefined };
      const result = await new ExpenseGetDailyClosingTool(prisma).execute(unrestrictedCtx, { date: '2026-08-16', branchId: 'สาขา 99' });
      assert.equal(result.status, 'ok');
      assert.equal((result.data as any).branchUnresolved, 'สาขา 99');
      assert.equal(calls.groupBy.length, 0, 'never queries a branch it could not resolve');
    });

    it('reports an out-of-scope branch honestly instead of a bare forbidden (T-105-b/run4 exact case)', async () => {
      const { prisma, calls } = makeDailyClosingPrisma([
        { id: 'b1', name: 'สาขา 1', code: 'BR1' },
        { id: 'b2', name: 'สาขา 2', code: 'BR2' },
      ]);
      const result = await new ExpenseGetDailyClosingTool(prisma).execute(dailyClosingCtx, { date: '2026-08-16', branchId: 'สาขา 2' });
      assert.equal(result.status, 'ok');
      assert.equal((result.data as any).branchOutOfScope, 'สาขา 2');
      assert.equal(calls.groupBy.length, 0);
      assert.ok(result.sourceRefs.length > 0, 'an honest boundary is still a grounded answer, not a bare error');
    });
  });

  // Item 1 (spec R-A1 row 18, eval: 15 turns): this tool computes its own own/related/company
  // classification (no queryApplied wrapper here), so accessScope rides `data.accessScope` directly.
  it('reports accessScope: own for a read_own-only caller, company for a full reader', async () => {
    const own = await new ExpenseGetDailyClosingTool(makeDailyClosingPrisma().prisma)
      .execute({ ...dailyClosingCtx, permissions: ['expense.read_own'] }, { date: '2026-08-16' });
    assert.equal((own.data as any).accessScope, 'own');
    const company = await new ExpenseGetDailyClosingTool(makeDailyClosingPrisma().prisma)
      .execute(dailyClosingCtx, { date: '2026-08-16' });
    assert.equal((company.data as any).accessScope, 'company');
  });

  it('returns one repeatable-read, bounded, multi-currency daily-closing snapshot', async () => {
    const { prisma, calls } = makeDailyClosingPrisma();
    const result = await new ExpenseGetDailyClosingTool(prisma).execute(dailyClosingCtx, { date: '2026-08-16', detailLimit: 1 });
    assert.equal(result.status, 'ok');
    const data = result.data as any;
    assert.equal(calls.isolationLevel, 'RepeatableRead');
    assert.equal(calls.groupBy.length + calls.count.length + calls.findMany.length, 15);
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
      assert.equal(queries.length, 15);
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

import { CompanyGetRolesTool } from './erp-team-tools.use-case';

describe('Round 7 B company.get_roles', () => {
  function harness() {
    const calls: any[] = [];
    let entitlements: any[] = [];
    const role = { id: 'role-manager', key: 'MANAGER', isSystem: true, name: 'Manager', status: 'ACTIVE', permissionKeys: ['reimbursement.approve', 'reimbursement.reject', 'expense.read'], assignableByCurrentUser: true };
    const prisma: any = { client: { companyFeatureEntitlement: { findMany: async () => entitlements }, companyMembership: { findMany: async (args: any) => { calls.push(args); return args.where.roles.some.roleId.in.length ? [{ status: 'ACTIVE', user: { displayName: 'สมใจ' }, employeeAccessProfile: null, roles: [{ roleId: role.id }] }] : []; } } } };
    const tool = new CompanyGetRolesTool(prisma, { execute: async () => [role] } as any);
    const ctx = { ...baseCtx, permissions: ['access.role.read', 'access.employee.read'], roles: ['OWNER'] };
    return { calls, role, tool, ctx, setEntitlements: (rows: any[]) => { entitlements = rows; } };
  }
  it('fails closed before reading roles/people without permission; holders require employee.read', async () => {
    const h = harness();
    assert.equal((await h.tool.execute({ ...h.ctx, permissions: [] })).status, 'forbidden');
    assert.equal((await h.tool.execute({ ...h.ctx, permissions: ['access.role.read'] }, { permissionKey: 'reimbursement.approve' })).status, 'forbidden');
    assert.equal(h.calls.length, 0);
  });
  it('answers who can approve using company-bound active memberships and registry descriptions', async () => {
    const h = harness(), result = await h.tool.execute(h.ctx, { permissionKey: 'reimbursement.approve' });
    assert.equal(result.status, 'ok'); assert.equal((result.data as any).employees[0].name, 'สมใจ');
    assert.equal(h.calls[0].where.companyId, h.ctx.companyId); assert.equal(h.calls[0].where.status, 'ACTIVE');
    assert.match(JSON.stringify(result.data), /Approve reimbursement requests/u); assert.match(JSON.stringify(result.data), /ผู้จัดการ/u);
    assert.doesNotMatch(JSON.stringify(result.data), /role-manager|reimbursement.approve|identity|phoneNumber/u);
  });
  it('named-person lookup is branch-filtered and reports exact held roles', async () => {
    const h = harness(), result = await h.tool.execute({ ...h.ctx, branchIds: ['only-branch'] }, { employeeName: 'สมใจ' });
    assert.equal((result.data as any).employees.length, 1); assert.equal(h.calls[0].where.branchScopeMode.not, 'ALL_BRANCHES');
    assert.match(JSON.stringify(h.calls[0].where), /only-branch/u); assert.match(JSON.stringify(h.calls[0].where), /สมใจ/u);
  });
  it('filters disabled-feature permissions and retains in-flight reimbursement rights as the web does', async () => {
    const h = harness(); h.role.permissionKeys.push('inventory.product.manage'); h.setEntitlements([{ featureKey: 'reimbursement', enabled: false }, { featureKey: 'expenses', enabled: false }, { featureKey: 'inventory', enabled: false }, { featureKey: 'product_catalog', enabled: false }]);
    const result = await h.tool.execute(h.ctx, { permissionKey: 'reimbursement.approve' });
    assert.equal((result.data as any).employees.length, 1); assert.match(JSON.stringify(result.data), /Approve reimbursement requests/u); assert.doesNotMatch(JSON.stringify(result.data), /Manage products/u);
  });
});

for (const locale of ['th-TH', 'en-US']) it(`EVID-1 ${locale}: daily-closing to-do separates an image to add from missing evidence before limiting`, async () => {
  const h = makeDailyClosingPrisma();
  const original = dailyClosingDetail({ id: 'original', primaryAttachmentId: null, aiVerificationSummaryJson: { documentEvidenceDraft: {
    route: 'SOURCE_DOCUMENT', receiptProblem: 'NONE', attachmentIds: [], reason: '', originalDocumentAvailable: true, note: 'เก็บตัวจริงที่ร้าน',
  } } });
  const missing = dailyClosingDetail({ id: 'missing', primaryAttachmentId: null });
  h.findResults[0] = [original];
  h.findResults[4] = [original];
  h.findResults[5] = [original, missing];
  const result = await new ExpenseGetDailyClosingTool(h.prisma).execute({ ...dailyClosingCtx, locale }, { date: '2026-08-16', detailLimit: 1 });
  const data = result.data as any;
  assert.equal(data.evidenceBlockers.count, 1);
  assert.equal(data.evidenceBlockers.items.items[0].id, 'missing');
  assert.equal(data.documentImagesToAdd.count, 1);
  assert.equal(data.documentImagesToAdd.items.items[0].id, 'original');
  assert.equal(data.pendingReview.items.items[0].evidenceAttention, false);
  assert.deepEqual(data.pendingReview.items.items[0].evidenceNotes, locale.startsWith('en')
    ? ['Document image not attached', 'Note: เก็บตัวจริงที่ร้าน'] : ['ยังไม่มีรูปเอกสาร', 'หมายเหตุ: เก็บตัวจริงที่ร้าน']);
});
