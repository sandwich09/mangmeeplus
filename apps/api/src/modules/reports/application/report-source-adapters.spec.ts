import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ReportDatasetDefinitionDto, RequestContext } from '@watchdog-bms/contracts';
import { findReportDefinition } from '../domain/report-catalog';
import { buildReportCsv } from '../domain/report-csv.logic';
import { ReportSourceAdapters } from './report-source-adapters';

const ctx: RequestContext = {
  requestId: 'req-1',
  authSubject: 'user-1',
  userId: 'user-1',
  companyId: 'company-1',
  membershipId: 'membership-1',
  roles: ['OWNER'],
  permissions: [
    'report.catalog.read',
    'report.dataset.read',
    'report.query.run',
    'accounting.document.read',
    'ledger.report.read',
    'procurement.ap.report',
    'tax.report.read',
    'workflow.run.read',
    'workflow.task.read',
    'workflow.rule.read',
    'workflow.dead_letter.read',
    'ai.suggestion.read',
  ],
  scopes: {},
  authProvider: 'watchdog',
};

const unused = { execute: async () => { throw new Error('unused dependency'); } };

function enabled(code: string): ReportDatasetDefinitionDto {
  const definition = findReportDefinition(code);
  assert.ok(definition);
  return { ...definition, status: 'ENABLED' };
}

function pageOf<T>(rows: T[], filter: { page?: number; pageSize?: number }) {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 100;
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), total: rows.length, page, pageSize };
}

function assertSourceChanged(error: unknown): true {
  const exception = error as { getStatus(): number; getResponse(): unknown };
  assert.equal(exception.getStatus(), 409);
  assert.deepEqual(exception.getResponse(), {
    code: 'export_source_changed',
    message: 'ข้อมูลต้นทางเปลี่ยนระหว่างสร้างรายงาน กรุณาลองใหม่',
  });
  return true;
}

function adapters(overrides: Record<string, unknown>) {
  return new ReportSourceAdapters(
    unused as any,
    (overrides.trialBalance ?? unused) as any,
    unused as any,
    unused as any,
    (overrides.documents ?? unused) as any,
    unused as any,
    (overrides.movements ?? unused) as any,
    (overrides.expenses ?? unused) as any,
    (overrides.apAging ?? unused) as any,
    unused as any,
    (overrides.dashboardSnapshot ?? unused) as any,
    unused as any,
    (overrides.taxSummary ?? unused) as any,
    (overrides.workflowRuns ?? unused) as any,
    (overrides.workflowTasks ?? unused) as any,
    (overrides.workflowRules ?? unused) as any,
    (overrides.workflowDeadLetters ?? unused) as any,
    (overrides.aiSuggestions ?? unused) as any,
  );
}

describe('ReportSourceAdapters item 18 remaining datasets', () => {
  it('reconciles AR aging against the ledger control account and warns on mismatch', async () => {
    const adapter = adapters({
      documents: {
        execute: async () => ({
          data: [{
            id: 'inv-1',
            documentNumber: 'INV-001',
            counterpartySnapshotJson: { displayName: 'Acme' },
            documentDate: new Date('2026-07-10T00:00:00.000Z'),
            dueDate: new Date('2026-07-31T00:00:00.000Z'),
            outstandingAmount: '100.0000',
            paymentStatus: 'UNPAID',
            status: 'ISSUED',
          }],
          total: 1,
          page: 1,
          pageSize: 100,
        }),
      },
      trialBalance: {
        execute: async () => ({
          periodKey: '2026-07',
          totalDebit: '90.0000',
          totalCredit: '0.0000',
          difference: '90.0000',
          lines: [{ accountId: 'ar', accountCode: '1210-00', accountNameTh: 'AR', accountClass: 'ASSET', reportGroup: 'accounts_receivable', normalBalance: 'DEBIT', totalDebit: '90.0000', totalCredit: '0.0000', balance: '90.0000' }],
        }),
      },
    });

    const result = await adapter.execute(ctx, enabled('ar.aging'), { filters: { asOfDate: '2026-07-31' }, chartKind: 'table', page: 1, pageSize: 100 });

    assert.equal(result.totals?.outstandingAmount, '100.0000');
    assert.equal(result.totals?.ledgerControlAmount, '90.0000');
    assert.equal(result.totals?.ledgerControlDifference, '10.0000');
    assert.deepEqual(result.warnings, ['ledger_control_mismatch']);
    assert.deepEqual(result.sourcePermissionsUsed, ['accounting.document.read', 'ledger.report.read']);
  });

  it('excludes unissued receivables and never presents mixed-currency AR as a single amount', async () => {
    const docs = [
      { id: 'draft', status: 'DRAFT', outstandingAmount: '100.00', currency: 'THB' },
      { id: 'issued-thb', status: 'ISSUED', outstandingAmount: '90071992547409.93', currency: 'THB' },
      { id: 'issued-usd', status: 'CREDITED', outstandingAmount: '12.34', currency: 'USD' },
    ];
    const adapter = adapters({ documents: { execute: async () => ({ data: docs, total: docs.length }) } });
    const result = await adapter.execute(ctx, enabled('ar.aging'), { filters: {}, chartKind: 'table', page: 1, pageSize: 100 });
    assert.equal(result.rows.length, 2); assert.equal(result.totals?.outstandingAmount, null);
    assert.deepEqual(result.rows.map(row => row.currency), ['THB', 'USD']);
    assert.ok(result.warnings.includes('mixed_currency_total_unavailable'));
    assert.ok(buildReportCsv(result).includes('90071992547409.93'));
  });

  it('collects every AR detail page for export instead of truncating after 100 rows', async () => {
    const documents = Array.from({ length: 150 }, (_, index) => ({
      id: `inv-${index + 1}`,
      documentNumber: `INV-${index + 1}`,
      counterpartySnapshotJson: { displayName: 'Acme' },
      documentDate: new Date('2026-07-10T00:00:00.000Z'),
      dueDate: new Date('2026-07-31T00:00:00.000Z'),
      outstandingAmount: '1.0000',
      paymentStatus: 'UNPAID',
      status: 'ISSUED',
    }));
    const requestedPages: number[] = [];
    const adapter = adapters({
      documents: {
        execute: async (_ctx: RequestContext, filter: { page?: number; pageSize?: number }) => {
          requestedPages.push(filter.page ?? 1);
          const result = pageOf(documents, filter);
          return { ...result, data: result.items };
        },
      },
    });
    const withoutLedger = { ...ctx, permissions: ctx.permissions.filter((permission) => permission !== 'ledger.report.read') };

    const result = await adapter.executeForExport(withoutLedger, enabled('ar.aging'), { filters: {}, chartKind: 'table', page: 1, pageSize: 100 });

    assert.equal(result.total, 150);
    assert.equal(result.rows.length, 150);
    assert.equal(result.totals?.outstandingAmount, '150.0000');
    assert.deepEqual(requestedPages, [1, 2]);
    assert.deepEqual(result.sourcePermissionsUsed, ['accounting.document.read']);
  });

  it('streams an ordinary AR page above 5,000 output rows while keeping exact totals', async () => {
    const documents = Array.from({ length: 5_001 }, (_, index) => ({
      id: `inv-large-${index + 1}`,
      documentNumber: `INV-LARGE-${index + 1}`,
      counterpartySnapshotJson: { displayName: 'Acme' },
      documentDate: new Date('2026-07-10T00:00:00.000Z'),
      dueDate: new Date('2026-07-31T00:00:00.000Z'),
      outstandingAmount: '1.0000',
      paymentStatus: 'UNPAID',
      status: 'ISSUED',
    }));
    const adapter = adapters({
      documents: {
        execute: async (_ctx: RequestContext, filter: { page?: number; pageSize?: number }) => {
          const result = pageOf(documents, filter);
          return { ...result, data: result.items };
        },
      },
    });
    const withoutLedger = { ...ctx, permissions: ctx.permissions.filter((permission) => permission !== 'ledger.report.read') };

    const result = await adapter.execute(withoutLedger, enabled('ar.aging'), { filters: {}, chartKind: 'table', page: 2, pageSize: 100 });

    assert.equal(result.total, 5_001);
    assert.equal(result.rows.length, 100);
    assert.equal(result.rows[0]?.documentNumber, 'INV-LARGE-101');
    assert.equal(result.totals?.outstandingAmount, '5001.0000');
  });

  it('reads one complete status/currency aggregate without a mutable page walk and preserves exact CSV amounts', async () => {
    let aggregateCalls = 0;
    const rows = [
      { status: 'CONFIRMED', currency: 'THB', count: 5001, grandTotalAmount: '90071992547409.9300', paidAmount: '0.0000', outstandingAmount: '90071992547409.9300' },
      { status: 'CONFIRMED', currency: 'USD', count: 1, grandTotalAmount: '12.3400', paidAmount: '0.0000', outstandingAmount: '12.3400' },
      { status: 'VOIDED', currency: 'THB', count: 1, grandTotalAmount: '7.0000', paidAmount: '0.0000', outstandingAmount: '7.0000' },
    ];
    const adapter = adapters({ expenses: {
      execute: async () => { throw new Error('aggregate must not walk pages'); },
      readReportSummary: async (_ctx: RequestContext, filters: unknown) => { aggregateCalls++; assert.deepEqual(filters, { fromDate: '2026-09-01', toDate: '2026-09-30' }); return rows; },
    } });
    const result = await adapter.execute({ ...ctx, permissions: [...ctx.permissions, 'expense.read'] }, enabled('expense.summary'),
      { filters: { fromDate: '2026-09-01', toDate: '2026-09-30' }, chartKind: 'bar', page: 1, pageSize: 100 });
    assert.equal(aggregateCalls, 1); assert.deepEqual(result.rows, rows);
    const csv = buildReportCsv(result);
    assert.ok(csv.includes('90071992547409.9300')); assert.ok(csv.includes('THB')); assert.ok(csv.includes('USD'));
    assert.equal(result.chart?.series[0]?.values[0], '90071992547409.9300');
  });

  it('marks an own-only expense summary partial and snapshots only the authority actually used', async () => {
    const adapter = adapters({ expenses: { readReportSummary: async () => [] } });
    const ownOnly = { ...ctx, permissions: [...ctx.permissions, 'expense.read_own'] };
    const result = await adapter.execute(ownOnly, enabled('expense.summary'), { filters: {}, chartKind: 'table', page: 1, pageSize: 100 });
    assert.equal(result.status, 'EMPTY');
    assert.deepEqual(result.warnings, ['แสดงเฉพาะรายการค่าใช้จ่ายที่คุณสร้าง']);
    assert.deepEqual(result.sourcePermissionsUsed, ['expense.read_own']);
  });

  it('keeps issued sales amounts separated by currency through the same scoped database aggregate', async () => {
    const adapter = adapters({ documents: { aggregateByType: async (_ctx: RequestContext, filter: unknown) => {
      assert.deepEqual(filter, { documentType: 'INVOICE', status: 'ISSUED', fromDate: '2026-09-01', toDate: '2026-09-30' });
      return { total: 3, byType: { INVOICE: { totalsByCurrency: [
        { currency: 'THB', count: 2, totalAmount: '90071992547409.93' }, { currency: 'USD', count: 1, totalAmount: '12.34' },
      ] } } };
    } } });
    const result = await adapter.execute(ctx, enabled('sales.summary'), { filters: { fromDate: '2026-09-01', toDate: '2026-09-30' }, chartKind: 'table', page: 1, pageSize: 100 });
    assert.equal(result.rows.length, 2); assert.equal(result.rows[0]?.amount, '90071992547409.9300');
    assert.equal(result.rows[1]?.currency, 'USD'); assert.ok(buildReportCsv(result).includes('90071992547409.9300'));
  });

  it('refuses a detail export above 5,000 output rows', async () => {
    const adapter = adapters({
      expenses: {
        execute: async () => ({ data: [], total: 5_001, page: 1, pageSize: 100 }),
      },
    });

    await assert.rejects(
      adapter.executeForExport(ctx, enabled('expense.accountant_evidence'), { filters: {}, chartKind: 'table', page: 1, pageSize: 100 }),
      (error: unknown) => {
        const exception = error as { getStatus(): number; getResponse(): unknown };
        assert.equal(exception.getStatus(), 413);
        assert.deepEqual(exception.getResponse(), {
          code: 'export_too_large',
          message: 'รายงานมีมากกว่า 5,000 แถว กรุณาลดช่วงข้อมูลแล้วลองใหม่',
          maxRows: 5_000,
        });
        return true;
      },
    );
  });

  it('fetches only the requested source page for an ordinary detail query', async () => {
    const movements = Array.from({ length: 150 }, (_, index) => ({
      id: `movement-${index + 1}`,
      movementNumber: `MOV-${index + 1}`,
      productId: 'product-1',
      locationId: 'location-1',
      movementType: 'RECEIVE',
      direction: 'IN',
      quantity: '1.0000',
      occurredAt: new Date('2026-07-10T00:00:00.000Z'),
    }));
    const requestedPages: number[] = [];
    const adapter = adapters({
      movements: {
        execute: async (_ctx: RequestContext, filter: { page?: number; pageSize?: number }) => {
          requestedPages.push(filter.page ?? 1);
          return pageOf(movements, filter);
        },
      },
    });

    const result = await adapter.execute(ctx, enabled('inventory.stock_movement'), { filters: {}, chartKind: 'table', page: 2, pageSize: 25 });

    assert.deepEqual(requestedPages, [2]);
    assert.equal(result.page, 2);
    assert.equal(result.pageSize, 25);
    assert.equal(result.total, 150);
    assert.equal(result.rows.length, 25);
    assert.equal(result.rows[0]?.movementNumber, 'MOV-26');
  });

  it('reconciles AP aging against the ledger control account when totals match', async () => {
    const adapter = adapters({
      apAging: {
        execute: async () => ({
          asOfDate: '2026-07-31',
          currency: 'THB',
          totalOutstanding: '200.0000',
          suppliers: [{ supplierId: 'sup-1', supplierDisplayName: 'Supplier', totalOutstanding: '200.0000', buckets: [{ amount: '0' }, { amount: '200.0000' }, { amount: '0' }, { amount: '0' }, { amount: '0' }] }],
        }),
      },
      trialBalance: {
        execute: async () => ({
          periodKey: '2026-07',
          totalDebit: '0.0000',
          totalCredit: '200.0000',
          difference: '200.0000',
          lines: [{ accountId: 'ap', accountCode: '2120-01', accountNameTh: 'AP', accountClass: 'LIABILITY', reportGroup: 'accounts_payable', normalBalance: 'CREDIT', totalDebit: '0.0000', totalCredit: '200.0000', balance: '200.0000' }],
        }),
      },
    });

    const result = await adapter.execute(ctx, enabled('ap.aging'), { filters: { asOfDate: '2026-07-31' }, chartKind: 'table', page: 1, pageSize: 100 });

    assert.equal(result.totals?.totalOutstanding, '200.0000');
    assert.equal(result.totals?.ledgerControlAmount, '200.0000');
    assert.equal(result.totals?.ledgerControlDifference, '0.0000');
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.sourcePermissionsUsed, ['procurement.ap.report', 'ledger.report.read']);
  });

  it('runs tax.summary from the tax source query use case', async () => {
    const adapter = adapters({
      taxSummary: {
        execute: async () => ({
          periodKey: '2026-07',
          totalTaxAmount: '120.0000',
          openIssueCount: 1,
          rows: [{
            taxType: 'VAT',
            formType: 'PP30',
            periodKey: '2026-07',
            status: 'READY_FOR_REVIEW',
            dueDate: '2026-08-15T00:00:00.000Z',
            activeEventCount: 4,
            reviewIssueCount: 2,
            openIssueCount: 1,
            taxableBase: '1000.0000',
            taxAmount: '120.0000',
          }],
        }),
      },
    });

    const result = await adapter.execute(ctx, enabled('tax.summary'), { filters: { periodKey: '2026-07' }, chartKind: 'bar', page: 1, pageSize: 100 });

    assert.equal(result.status, 'READY');
    assert.equal(result.total, 1);
    assert.equal(result.rows[0]?.amount, '120.0000');
    assert.equal(result.totals?.amount, '120.0000');
  });

  it('runs ops.workflow_sla from workflow run/task/rule/dead-letter use cases', async () => {
    const openWorkflowTasks = Array.from({ length: 150 }, () => ({ dueAt: '2000-01-01T00:00:00.000Z' }));
    const adapter = adapters({
      workflowRuns: {
        execute: async (_ctx: RequestContext, filter: { status?: string }) => ({ items: [], total: filter.status === 'FAILED' ? 2 : filter.status === 'PARTIAL_FAILED' ? 1 : 10, page: 1, pageSize: 1 }),
      },
      workflowTasks: {
        execute: async (_ctx: RequestContext, filter: { status?: string; page?: number; pageSize?: number }) => pageOf(filter.status === 'OPEN' ? openWorkflowTasks : [], filter),
      },
      workflowRules: { execute: async () => ({ items: [], total: 4, page: 1, pageSize: 1 }) },
      workflowDeadLetters: { execute: async () => ({ items: [], total: 1, page: 1, pageSize: 1 }) },
    });

    const result = await adapter.execute(ctx, enabled('ops.workflow_sla'), { filters: {}, chartKind: 'bar', page: 1, pageSize: 100 });

    assert.equal(result.status, 'READY');
    assert.equal(result.rows.find((row) => row.metric === 'workflow_runs_failed')?.value, 2);
    assert.equal(result.rows.find((row) => row.metric === 'workflow_tasks_open')?.value, 150);
    assert.equal(result.rows.find((row) => row.metric === 'workflow_tasks_overdue_visible')?.value, 150);
    assert.equal(result.rows.find((row) => row.metric === 'workflow_dead_letters_open')?.value, 1);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.sourcePermissionsUsed, [
      'workflow.run.read',
      'workflow.task.read',
      'workflow.rule.read',
      'workflow.dead_letter.read',
    ]);
  });

  it('filters cached dashboard metrics by their live source authority and records the exact vector', async () => {
    const adapter = adapters({
      dashboardSnapshot: {
        execute: async () => ({
          id: 'snapshot-1', companyId: 'company-1', generatedAt: '2026-08-01T00:00:00.000Z', freshnessStatus: 'fresh',
          widgets: [{
            title: 'Health',
            metrics: [
              { label: 'Public', value: 1, sourceRefs: [] },
              { label: 'Unknown', value: 1, sourceRefs: [{ label: 'missing permission key' }] },
              { label: 'AR', value: 2, sourceRefs: [{ permissionKey: 'accounting.document.read' }] },
              { label: 'Inventory', value: 3, sourceRefs: [{ permissionKey: 'inventory.report.read' }] },
            ],
          }],
        }),
      },
    });
    const dashboardCtx = { ...ctx, permissions: [...ctx.permissions, 'dashboard.read'] };

    const result = await adapter.execute(dashboardCtx, enabled('ops.dashboard_health'), { filters: {}, chartKind: 'table', page: 1, pageSize: 100 });

    assert.deepEqual(result.rows.map((row) => row.metric), ['Health: AR']);
    assert.deepEqual(result.sourcePermissionsUsed, ['dashboard.read', 'accounting.document.read']);
  });

  it('runs ai.suggestion_summary from the AI suggestion query use case', async () => {
    const suggestions = Array.from({ length: 150 }, (_, index) => ({ needsData: index < 120 }));
    const adapter = adapters({
      aiSuggestions: {
        execute: async (_ctx: RequestContext, filter: { status?: string; riskLevel?: string; page?: number; pageSize?: number }) => {
          if (!filter.status && !filter.riskLevel) return pageOf(suggestions, filter);
          const total = filter.riskLevel === 'HIGH' ? 2 : filter.status === 'NEW' ? 3 : filter.status === 'FAILED' ? 1 : 0;
          return { items: [], total, page: filter.page ?? 1, pageSize: filter.pageSize ?? 100 };
        },
      },
    });

    const result = await adapter.execute(ctx, enabled('ai.suggestion_summary'), { filters: {}, chartKind: 'bar', page: 1, pageSize: 100 });

    assert.equal(result.status, 'READY');
    assert.equal(result.rows.find((row) => row.metric === 'ai_suggestions_total')?.value, 150);
    assert.equal(result.rows.find((row) => row.metric === 'ai_suggestions_high_risk')?.value, 2);
    assert.equal(result.rows.find((row) => row.metric === 'ai_suggestions_failed')?.value, 1);
    assert.equal(result.rows.find((row) => row.metric === 'ai_suggestions_needs_data_visible')?.value, 120);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.sourcePermissionsUsed, ['ai.suggestion.read']);
  });

  it('uses the own-only AI authority path when broad access is absent', async () => {
    const scopes: string[] = [];
    const adapter = adapters({
      aiSuggestions: {
        execute: async (_ctx: RequestContext, filter: { scope: string }) => {
          scopes.push(filter.scope);
          return { items: [], total: 0, page: 1, pageSize: 100 };
        },
      },
    });
    const ownOnly = {
      ...ctx,
      permissions: [...ctx.permissions.filter((permission) => permission !== 'ai.suggestion.read'), 'ai.suggestion.read_own'],
    };

    const result = await adapter.execute(ownOnly, enabled('ai.suggestion_summary'), { filters: {}, chartKind: 'table', page: 1, pageSize: 100 });

    assert.ok(scopes.every((scope) => scope === 'own'));
    assert.deepEqual(result.sourcePermissionsUsed, ['ai.suggestion.read_own']);
  });
});
