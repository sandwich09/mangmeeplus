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
import { resolvePeriodInput, currentMonthRange, SalesGetSalesSummaryTool } from './erp-tools.use-case';
import { InventoryGetStockBalanceTool, InventoryListLowStockTool, InventorySearchProductsTool } from './erp-tools.use-case';
import { NotificationsListOpenAlertsTool } from './erp-dashboard-tools.use-case';
import { WorkflowListAssignedTasksTool, WorkflowListRecentFailuresTool, WorkflowSummarizeRuleHealthTool } from './erp-workflow-tools.use-case';

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

  it('drops malformed dates and falls back to the current month', () => {
    const period = resolvePeriodInput({ fromDate: 'DROP TABLE', toDate: 'x' });
    assert.equal(period.defaulted, true);
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
    assert.equal(captured.where.paidAt.lte.toISOString(), '2026-07-12T16:59:59.999Z');
    assert.deepEqual(captured.where.counterparty, { is: { type: { in: ['CUSTOMER', 'BOTH'] } } });
    assert.deepEqual(captured.where.OR, [{ branchId: { in: ['b1'] } }, { branchId: null }]);
  });
});

describe('AccountingGetSummaryTool', () => {
  const docs = [
    { documentType: 'TAX_INVOICE', grandTotalAmount: '100.0000' },
    { documentType: 'TAX_INVOICE', grandTotalAmount: '50.0000' },
    { documentType: 'RECEIPT', grandTotalAmount: '25.0000' },
  ];
  const listDocuments = { execute: async () => ({ data: docs, total: 3, page: 1, pageSize: 200 }) } as any;

  it('fails closed without any accounting document view path', async () => {
    const result = await new AccountingGetSummaryTool(listDocuments).execute({ ...baseCtx, permissions: [] });
    assert.equal(result.status, 'forbidden');
  });

  it('aggregates counts and totals by document type with an echoed period', async () => {
    const result = await new AccountingGetSummaryTool(listDocuments).execute({ ...baseCtx, permissions: ['accounting.document.read'] });
    const data = result.data as any;
    assert.equal(data.total, 3);
    assert.equal(data.byType.TAX_INVOICE.count, 2);
    assert.equal(data.byType.TAX_INVOICE.totalAmount, 150);
    assert.equal(data.period.defaultedToCurrentMonth, true);
  });

  it('accepts related-record view and leaves relation filtering to the source use case', async () => {
    let forwarded: any;
    const source = { execute: async (sourceCtx: any) => {
      forwarded = sourceCtx;
      return { data: docs.slice(0, 1), total: 1, page: 1, pageSize: 200 };
    } } as any;
    const result = await new AccountingGetSummaryTool(source).execute({
      ...baseCtx,
      permissions: ['accounting.document.read_related'],
    });
    assert.equal(result.status, 'ok');
    assert.deepEqual(forwarded.permissions, ['accounting.document.read_related']);
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
  function makePrisma(captured: { where?: any } = {}) {
    return {
      client: {
        expenseRecord: {
          groupBy: async (args: any) => {
            captured.where = args.where;
            return args.by[0] === 'expenseCategoryId'
              ? [{ expenseCategoryId: 'cat1', _sum: { grandTotalAmount: '300.0000' }, _count: 3 }]
              : [{ branchId: 'b1', _sum: { grandTotalAmount: '200.0000' }, _count: 2 }, { branchId: null, _sum: { grandTotalAmount: '100.0000' }, _count: 1 }];
          },
        },
        expenseCategory: { findMany: async () => [{ id: 'cat1', name: 'ค่าอาหาร' }] },
        branch: { findMany: async () => [{ id: 'b1', name: 'สาขาลาดพร้าว' }] },
      },
    } as any;
  }

  it('fails closed without any expense read permission', async () => {
    const result = await new ExpenseGetBreakdownTool(makePrisma()).execute({ ...baseCtx, permissions: [] });
    assert.equal(result.status, 'forbidden');
  });

  it('groups by category and branch with readable labels', async () => {
    const result = await new ExpenseGetBreakdownTool(makePrisma()).execute({ ...baseCtx, permissions: ['expense.read'] });
    const data = result.data as any;
    assert.equal(data.byCategory[0].category, 'ค่าอาหาร');
    assert.equal(data.byBranch[0].branch, 'สาขาลาดพร้าว');
    assert.equal(data.byBranch[1].branch, 'ส่วนกลาง (ไม่ระบุสาขา)');
    assert.equal(data.totalCount, 3);
    assert.equal(data.totalAmount, '300.0000');
    assert.equal(data.period.defaultedToCurrentMonth, true);
  });

  it('applies the caller branch scope to the query (10D ABAC)', async () => {
    const captured: { where?: any } = {};
    await new ExpenseGetBreakdownTool(makePrisma(captured)).execute({ ...baseCtx, permissions: ['expense.read'], branchIds: ['b1'] });
    assert.deepEqual(captured.where.AND[0].OR, [{ branchId: { in: ['b1'] } }, { branchId: null }]);
  });

  it('limits read_own callers to their own records', async () => {
    const captured: { where?: any } = {};
    await new ExpenseGetBreakdownTool(makePrisma(captured)).execute({ ...baseCtx, permissions: ['expense.read_own'] });
    assert.equal(captured.where.AND[1].createdByUserId, 'u1');
  });

  it('limits read_related callers to the persisted actor relation', async () => {
    const captured: { where?: any } = {};
    await new ExpenseGetBreakdownTool(makePrisma(captured)).execute({ ...baseCtx, permissions: ['expense.read_related'] });
    assert.ok(captured.where.AND[1].OR.some((clause: any) => clause.payments?.some));
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
