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

  // The source repository caps page size at 100, so any period past that is read page by page.
  function pagedListDocuments(all: Array<{ documentType: string; grandTotalAmount: string }>, total = all.length) {
    const calls: any[] = [];
    const source = {
      execute: async (_ctx: any, filter: any) => {
        calls.push(filter);
        const start = (filter.page - 1) * filter.pageSize;
        return { data: all.slice(start, start + filter.pageSize), total, page: filter.page, pageSize: filter.pageSize };
      },
    } as any;
    return { source, calls };
  }

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

  it('aggregates every page of a month with more documents than one page (G1)', async () => {
    const many = [
      ...Array.from({ length: 150 }, () => ({ documentType: 'TAX_INVOICE', grandTotalAmount: '10.0000' })),
      ...Array.from({ length: 100 }, () => ({ documentType: 'RECEIPT', grandTotalAmount: '2.0000' })),
    ];
    const { source, calls } = pagedListDocuments(many);
    const result = await new AccountingGetSummaryTool(source).execute({ ...baseCtx, permissions: ['accounting.document.read'] });
    const data = result.data as any;
    assert.equal(result.status, 'ok');
    assert.equal(data.total, 250);
    assert.equal(data.byType.TAX_INVOICE.count, 150);
    assert.equal(data.byType.TAX_INVOICE.totalAmount, 1500);
    assert.equal(data.byType.RECEIPT.count, 100);
    assert.equal(data.byType.RECEIPT.totalAmount, 200);
    assert.deepEqual(calls.map((filter: any) => filter.page), [1, 2, 3]);
    assert.ok(calls.every((filter: any) => filter.pageSize === 100 && filter.fromDate === calls[0].fromDate && filter.toDate === calls[0].toDate));
  });

  it('reports unavailable when the per-type counts disagree with the source total', async () => {
    // Rows shifted under the walk: the source counts 5 documents but only 3 were aggregated.
    const { source } = pagedListDocuments(docs, 5);
    const result = await new AccountingGetSummaryTool(source).execute({ ...baseCtx, permissions: ['accounting.document.read'] });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.errorCode, 'SUMMARY_COUNT_MISMATCH');
    assert.equal(result.data, undefined);
  });

  it('refuses a period past the bound after one query instead of partial totals', async () => {
    const { source, calls } = pagedListDocuments(docs, 100_000);
    const result = await new AccountingGetSummaryTool(source).execute({ ...baseCtx, permissions: ['accounting.document.read'] });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.errorCode, 'SUMMARY_PERIOD_TOO_LARGE');
    assert.equal(result.data, undefined);
    assert.equal(calls.length, 1, 'the bound is detected from the first page total, not by walking to it');
  });

  it('bounds the walk even when the source never reports the end of the period', async () => {
    const fullPage = Array.from({ length: 100 }, () => ({ documentType: 'TAX_INVOICE', grandTotalAmount: '1.0000' }));
    const calls: any[] = [];
    const source = {
      // pageSize 0 makes the "last page" arithmetic never terminate on its own.
      execute: async (_ctx: any, filter: any) => {
        calls.push(filter);
        return { data: fullPage, total: 400, page: filter.page, pageSize: 0 };
      },
    } as any;
    const result = await new AccountingGetSummaryTool(source).execute({ ...baseCtx, permissions: ['accounting.document.read'] });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.errorCode, 'SUMMARY_PERIOD_TOO_LARGE');
    assert.equal(calls.length, 50, 'a pathological source is bounded, never an endless walk');
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
