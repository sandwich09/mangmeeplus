import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as contracts from '@watchdog-bms/contracts';
import { LEDGER_ACCOUNT_CLASS_LABELS, type ReportDatasetDefinitionDto, type RequestContext } from '@watchdog-bms/contracts';
import { findReportDefinition, REPORT_CATALOG } from '../domain/report-catalog';
import { buildReportCsv } from '../domain/report-csv.logic';
import { REPORT_VALUE_TEXT, reportResultForPeople } from '../domain/report-row-text.logic';
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

describe('shop-facing report catalogue and export headings', () => {
  it('uses Thai labels for every catalogue field and report export column', () => {
    const catalogText = REPORT_CATALOG.flatMap((report) => [
      report.title, report.description,
      ...report.supportedFilters.map((field) => field.label),
      ...report.supportedDimensions.map((field) => field.label),
      ...report.supportedMeasures.map((field) => field.label),
    ]);
    const adapterSource = readFileSync(join(__dirname, 'report-source-adapters.ts'), 'utf8');
    const exportHeadings = [...adapterSource.matchAll(/label:\s*'([^']+)'/g)].map((match) => match[1]!);
    const sourceRefLabels = [...adapterSource.matchAll(/sourceRef\(ctx\.companyId,\s*(?:'([^']+)'|`([^`]+)`)/g)]
      .map((match) => match[1] ?? match[2]!);
    assert.match(adapterSource, /function reportSourceRef[\s\S]*findReportDefinition\(datasetCode\)\?\.title/);
    for (const report of REPORT_CATALOG) assert.ok(adapterSource.includes(`reportSourceRef(ctx.companyId, '${report.code}'`), report.code);
    const allowedEnglish = /\b(?:LINE|QR|AI|PDF|VAT|Excel|CSV)\b/g;
    for (const label of [...catalogText, ...exportHeadings, ...sourceRefLabels]) {
      const text = label.replace(allowedEnglish, '');
      assert.match(text, /[\u0E00-\u0E7F]/, label);
      assert.doesNotMatch(text, /[A-Za-z]/, label);
    }
  });
});

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
    (overrides.generalLedger ?? unused) as any,
    (overrides.trialBalance ?? unused) as any,
    (overrides.pnl ?? unused) as any,
    (overrides.balanceSheet ?? unused) as any,
    (overrides.documents ?? unused) as any,
    (overrides.stockReport ?? unused) as any,
    (overrides.movements ?? unused) as any,
    (overrides.expenses ?? unused) as any,
    (overrides.apAging ?? unused) as any,
    (overrides.cashPosition ?? unused) as any,
    (overrides.dashboardSnapshot ?? unused) as any,
    (overrides.crmSummary ?? unused) as any,
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

// Owner 2026-10-02: a page or a file a shop user reads shows no key, enum name, id or English word.
// Every name in these fixtures is Thai, so any English letter left in a cell is a key, an enum name, an id, true/false
// or an English fallback. Kept: the names the owner allows, and ISO timestamps in the CSV.
const machineValue = (value: unknown) => typeof value === 'string'
  && /[A-Za-z]/.test(value.replace(/\b(?:LINE|QR|AI|PDF|VAT|Excel|CSV)\b/g, '').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, ''));

describe('report rows and CSV a person reads', () => {
  // Every source answers with what it really stores: enum constants, metric keys, an ISO currency, internal ids,
  // and records without a number, a customer name or a category name of their own.
  const sources = adapters({
    generalLedger: { execute: async () => [{ accountCode: '1100-00', accountNameTh: 'เงินสด', totalDebit: '10.0000', totalCredit: '0.0000', endingBalance: '10.0000' }] },
    trialBalance: { execute: async () => ({ periodKey: '2026-09', totalDebit: '10.0000', totalCredit: '10.0000', difference: '0.0000', lines: [
      { accountId: 'acc_cash', accountCode: '1100-00', accountNameTh: 'เงินสด', accountClass: 'ASSET', reportGroup: 'cash', totalDebit: '10.0000', totalCredit: '0.0000', balance: '10.0000' },
      { accountId: 'acc_sales', accountCode: '4100-00', accountNameTh: 'รายได้จากการขาย', accountClass: 'REVENUE', reportGroup: 'revenue', totalDebit: '0.0000', totalCredit: '10.0000', balance: '10.0000' },
    ] }) },
    pnl: { execute: async () => ({ revenue: '4', grossProfit: '3', netProfit: '1', sections: ['REVENUE', 'COST', 'EXPENSE', 'TAX_EXPENSE'].map((section) => ({ section, total: '1.0000' })) }) },
    balanceSheet: { execute: async () => ({ totalAssets: '1', totalLiabilities: '1', totalEquity: '1', sections: ['ASSET', 'LIABILITY', 'EQUITY'].map((section) => ({ section, total: '1.0000' })) }) },
    documents: {
      execute: async () => ({ data: [{ id: 'doc_internal_1', documentNumber: null, status: 'ISSUED', outstandingAmount: '5.0000', currency: 'THB', paymentStatus: 'OVERDUE',
        counterpartySnapshotJson: {}, documentDate: new Date('2026-09-01T00:00:00.000Z'), dueDate: new Date('2026-09-30T00:00:00.000Z') }], total: 1 }),
      aggregateByType: async () => ({ total: 1, byType: { INVOICE: { totalsByCurrency: [{ currency: 'THB', count: 1, totalAmount: '5.00' }] } } }),
    },
    apAging: { execute: async () => ({ totalOutstanding: '0', suppliers: [{ supplierId: 'sup_internal_1', supplierDisplayName: 'ร้านวัสดุก่อสร้าง', totalOutstanding: '0', buckets: [] }] }) },
    crmSummary: { execute: async () => ({ pipelineOpenCount: 2, pipelineTotalAmount: '1000.00', followUpsDueToday: 1, followUpsOverdue: 1, unassignedLeads: 0, stuckOpportunities: 1 }) },
    stockReport: { execute: async () => ({ items: [{ productId: 'prod_internal_1', productName: 'กาแฟคั่ว', locationId: 'loc_internal_1', locationName: 'หน้าร้าน', quantity: '2', isLowStock: true }] }) },
    movements: { execute: async (_ctx: RequestContext, filter: { page?: number; pageSize?: number }) => pageOf([{ id: 'mov_internal_1', productId: 'prod_internal_1', productName: 'กาแฟคั่ว',
      locationId: 'loc_internal_1', locationName: 'หน้าร้าน', movementType: 'COUNT_ADJUSTMENT_OUT', direction: 'OUT', quantity: '1', occurredAt: new Date('2026-09-02T03:00:00.000Z') }], filter) },
    expenses: {
      readReportSummary: async () => [{ status: 'READY_FOR_CONFIRMATION', currency: 'THB', count: 1, grandTotalAmount: '5.0000', paidAmount: '0.0000', outstandingAmount: '5.0000' }],
      execute: async () => ({ data: [{ id: 'exp_internal_1', expenseNumber: null, uploadedAt: new Date('2026-09-03T03:00:00.000Z'), expenseDate: new Date('2026-09-03T00:00:00.000Z'),
        vendorNameSnapshot: 'ร้านกาแฟ', sourceDocumentType: 'ABBREVIATED_TAX_INVOICE', taxEvidenceStatus: 'SUPPORTING_ONLY', status: 'CONFIRMED', inputVatClaimStatus: 'NON_CLAIMABLE',
        expenseCategoryId: 'cat_internal_1', taxCategory: 'SERVICE_FEE', accountHintKey: 'expense.meals', currency: 'THB', grandTotalAmount: '5.0000', vatAmount: '0.0000', whtAmount: '0.0000' }], total: 1 }),
      listCategoryCandidates: async () => [{ id: 'cat_internal_1', name: 'ค่าอาหารและเครื่องดื่ม' }],
    },
    taxSummary: { execute: async () => ({ periodKey: '2026-09', totalTaxAmount: '1.0000', openIssueCount: 1, rows: [
      { taxType: 'WHT', formType: 'PND53', periodKey: '2026-09', status: 'NEEDS_REVIEW', dueDate: null, activeEventCount: 1, reviewIssueCount: 1, openIssueCount: 1, taxableBase: '100.0000', taxAmount: '3.0000' },
      { taxType: 'CUSTOMS', formType: 'CUSTOMS_SUPPORT', periodKey: '2026-09', status: 'AMENDED', dueDate: null, activeEventCount: 1, reviewIssueCount: 0, openIssueCount: 0, taxableBase: '0.0000', taxAmount: '0.0000' },
    ] }) },
    cashPosition: { execute: async () => [{ bankAccountDisplayName: 'บัญชีออมทรัพย์ร้าน', currency: 'THB', lastReconciledDate: null, lastReconciledBalance: null, unreconciledLineCount: 1, unmatchedLineCount: 0, pendingAdjustmentCount: 0, lastStatementDate: null }] },
    workflowRuns: { execute: async (_ctx: RequestContext, filter: { status?: string }) => ({ items: [], total: filter.status ? 1 : 3, page: 1, pageSize: 1 }) },
    workflowTasks: { execute: async (_ctx: RequestContext, filter: { status?: string; page?: number; pageSize?: number }) => pageOf(filter.status === 'OPEN' ? [{ dueAt: '2000-01-01T00:00:00.000Z' }] : [], filter) },
    workflowRules: { execute: async () => ({ items: [], total: 2, page: 1, pageSize: 1 }) },
    workflowDeadLetters: { execute: async () => ({ items: [], total: 1, page: 1, pageSize: 1 }) },
    dashboardSnapshot: { execute: async () => ({ id: 'snapshot_internal_1', companyId: 'company-1', generatedAt: '2026-09-03T00:00:00.000Z', freshnessStatus: 'stale', widgets: [{
      title: 'สุขภาพคลังสินค้า', metrics: [
        { label: 'สินค้าต่ำกว่าจุดสั่งซื้อ', value: 2, severity: 'warning', sourceRefs: [{ permissionKey: 'inventory.report.read' }] },
        { label: 'สินค้าที่ใช้งาน', value: 9, sourceRefs: [{ permissionKey: 'inventory.report.read' }] },
      ] }] }) },
    aiSuggestions: { execute: async (_ctx: RequestContext, filter: { status?: string; riskLevel?: string; page?: number; pageSize?: number }) => (
      !filter.status && !filter.riskLevel ? pageOf([{ needsData: true }], filter) : { items: [], total: 1, page: 1, pageSize: 1 }) },
  });
  const everyone = { ...ctx, permissions: [...ctx.permissions, 'crm.report.read', 'inventory.report.read', 'inventory.movement.read', 'expense.read', 'expense.export', 'bank.cash.read', 'dashboard.read'] };

  for (const report of REPORT_CATALOG) {
    it(`${report.code}: no key, enum name, id or English word reaches the page or the CSV`, async () => {
      const raw = await sources.execute(everyone, enabled(report.code), { filters: {}, chartKind: report.supportedChartKinds.includes('bar') ? 'bar' : 'table', page: 1, pageSize: 100 });
      assert.ok(raw.rows.length > 0, 'the sources gave this report rows');
      const kept = JSON.parse(JSON.stringify(raw.rows));
      const shown = reportResultForPeople({ ...raw, dataset: enabled(report.code) });
      const cells = shown.rows.flatMap((row) => shown.columns.map((column) => row[column.key]));
      assert.deepEqual([...cells, ...(shown.chart?.labels ?? [])].filter(machineValue), [], 'page cells and chart labels');
      assert.deepEqual(buildReportCsv(shown).split(/[\n,]/).filter(machineValue), [], 'CSV cells');
      // The assistant's report tool reads the same adapter rows and keys on these values; they stay as they are.
      assert.deepEqual(raw.rows, kept);
    });
  }
});

// A shop may be a sole proprietor, a partnership or a company: ส่วนของเจ้าของ and ภาษีเงินได้ are true for each.
describe('one word for equity and for income tax', () => {
  it('names them with the shared ledger words on the statements and in the balance-sheet description', () => {
    assert.equal(LEDGER_ACCOUNT_CLASS_LABELS.EQUITY, 'ส่วนของเจ้าของ');
    assert.equal(LEDGER_ACCOUNT_CLASS_LABELS.TAX_EXPENSE, 'ภาษีเงินได้');
    assert.ok(findReportDefinition('financial.balance_sheet')!.description.includes(LEDGER_ACCOUNT_CLASS_LABELS.EQUITY));
    const section = (code: string, value: string) => reportResultForPeople({ dataset: enabled(code), chart: undefined,
      columns: [{ key: 'section', label: 'หมวด', type: 'string' }], rows: [{ section: value }] }).rows[0]!.section;
    assert.equal(section('financial.balance_sheet', 'EQUITY'), 'ส่วนของเจ้าของ');
    assert.equal(section('financial.profit_and_loss', 'TAX_EXPENSE'), 'ภาษีเงินได้');
  });
});

// Owner 2026-10-02: one source for a word. Words the pages also show come from contracts, never a copy here.
describe('report words come from the shared lists', () => {
  const shared = contracts as unknown as Record<string, Record<string, string> | string | undefined>;
  const list = (name: string) => (shared[name] ?? {}) as Record<string, string>;
  const words = (code: string, column: string) => REPORT_VALUE_TEXT[code]![column]!;

  it('uses the shared lists themselves for movement types and receivable payment status', () => {
    assert.ok(shared.STOCK_MOVEMENT_TYPE_LABELS, 'STOCK_MOVEMENT_TYPE_LABELS');
    assert.equal(words('inventory.stock_movement', 'movementType'), shared.STOCK_MOVEMENT_TYPE_LABELS);
    assert.ok(shared.ACCOUNTING_PAYMENT_STATUS_LABELS, 'ACCOUNTING_PAYMENT_STATUS_LABELS');
    assert.equal(words('ar.aging', 'paymentStatus'), shared.ACCOUNTING_PAYMENT_STATUS_LABELS);
  });

  it('builds the other words from the shared ones', () => {
    assert.equal(words('ar.aging', 'currency').THB, list('REPORT_CURRENCY_WORDS').THB);
    for (const level of ['info', 'critical']) assert.equal(words('ops.workflow_sla', 'severity')[level], list('NOTIFICATION_SEVERITY_LABELS')[level], level);
    for (const state of ['fresh', 'stale']) assert.equal(words('ops.dashboard_health', 'freshnessStatus')[state], list('REPORT_FRESHNESS_LABELS')[state], state);
    assert.equal(words('sales.summary', 'source').issued_invoices, `${list('ACCOUNTING_DOCUMENT_TYPE_LABELS').INVOICE}ที่${list('ACCOUNTING_DOCUMENT_STATUS_LABELS').ISSUED}`);
    const tabs = list('WORKFLOW_TAB_LABELS');
    const workflow = words('ops.workflow_sla', 'metric');
    assert.equal(workflow.workflow_runs_failed, `การทำงานที่${list('WORKFLOW_RUN_STATUS_LABELS').FAILED}`);
    assert.equal(workflow.workflow_tasks_open, `${tabs.tasks}ที่ยัง${list('WORKFLOW_TASK_STATUS_LABELS').OPEN}`);
    assert.equal(workflow.workflow_rules_enabled, `${tabs.rules}ที่${list('WORKFLOW_RULE_STATUS_LABELS').ENABLED}`);
    assert.equal(workflow.workflow_dead_letters_open, `${tabs['dead-letters']}ที่${list('WORKFLOW_DEAD_LETTER_RESOLUTION_LABELS').OPEN}`);
    const ai = words('ai.suggestion_summary', 'metric');
    assert.equal(ai.ai_suggestions_high_risk, `คำแนะนำจาก AI ที่${list('AI_RISK_LEVEL_LABELS').HIGH}`);
    assert.equal(ai.ai_suggestions_needs_data_visible, `คำแนะนำจาก AI ที่${shared.AI_SUGGESTION_NEEDS_DATA_LABEL}`);
    for (const [status, word] of Object.entries(list('AI_SUGGESTION_STATUS_LABELS'))) assert.equal(ai[`ai_suggestions_${status.toLowerCase()}`], `คำแนะนำจาก AI สถานะ${word}`, status);
    assert.ok(Object.keys(list('AI_SUGGESTION_STATUS_LABELS')).length > 0, 'AI_SUGGESTION_STATUS_LABELS');
  });
});

// A money cell reads บาท only for a row in baht, so every report with amounts in more than one currency must
// carry the row's currency. Expenses can be in a foreign currency.
describe('accountant evidence currency', () => {
  it('shows each expense in its own currency: baht as บาท, another currency by its code', async () => {
    const expense = (id: string, currency: string) => ({ id, expenseNumber: `EXP-${id}`, status: 'CONFIRMED', currency, grandTotalAmount: '10.0000', vatAmount: '0.0000', whtAmount: '0.0000' });
    const adapter = adapters({ expenses: {
      execute: async () => ({ data: [expense('1', 'USD'), expense('2', 'THB')], total: 2 }),
      listCategoryCandidates: async () => [],
      listCategoryNames: async () => [],
    } });
    const raw = await adapter.execute({ ...ctx, permissions: [...ctx.permissions, 'expense.export'] }, enabled('expense.accountant_evidence'),
      { filters: {}, chartKind: 'table', page: 1, pageSize: 100 });
    assert.ok(raw.columns.some((column) => column.key === 'currency' && column.label === 'สกุลเงิน'), 'currency column');
    const shown = reportResultForPeople({ ...raw, dataset: enabled('expense.accountant_evidence') });
    assert.deepEqual(shown.rows.map((row) => row.currency), ['USD', 'บาท']);
  });
});
