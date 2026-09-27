import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ReportsMonthlySummaryTool } from './erp-report-tools.use-case';

const ctx = {
  companyId: 'c1', userId: 'u1', membershipId: 'm1', roles: [], branchIds: ['b1'], locale: 'th-TH',
  permissions: [
    'report.catalog.read', 'report.dataset.read', 'report.query.run',
    'accounting.document.read', 'crm.report.read', 'ledger.report.read', 'dashboard.read',
  ],
} as any;

function ready(datasetCode: string, filters: Record<string, unknown>) {
  return {
    runId: 'run-1', dataset: { code: datasetCode, version: 1, title: datasetCode, category: 'SALES', sourceModule: 'test' },
    status: 'READY', computedAt: '2026-09-27T00:00:00Z',
    freshness: { computedAt: '2026-09-27T00:00:00Z', sourceModules: ['test'], freshnessStatus: 'fresh' },
    warnings: [], columns: [], rows: [], totals: { count: 0 }, sourceRefs: [], filters,
    page: 1, pageSize: 20, total: 0,
  } as any;
}

describe('reports.get_monthly_report_summary explicit dataset semantics', () => {
  it('requires an explicit dataset rather than selecting one from permissions', async () => {
    let calls = 0;
    const tool = new ReportsMonthlySummaryTool({ execute: async () => { calls += 1; return ready('', {}); } } as any);
    const result = await tool.execute(ctx, {});
    assert.equal(result.status, 'error');
    assert.equal(result.errorCode, 'DATASET_REQUIRED');
    assert.equal(calls, 0);
  });

  it('does not change an operational-sales request to P&L when ledger permission is added', async () => {
    const calls: any[] = [];
    const tool = new ReportsMonthlySummaryTool({ execute: async (_ctx: any, _companyId: string, input: any) => {
      calls.push(input);
      return ready(input.datasetCode, input.filters);
    } } as any);
    const result = await tool.execute(ctx, { dataset: 'operational_sales', periodKey: '2026-02' });
    assert.equal(result.status, 'ok');
    assert.equal(calls[0].datasetCode, 'sales.summary');
    assert.deepEqual(calls[0].filters, { fromDate: '2026-02-01', toDate: '2026-02-28' });
    assert.equal((result.data as any).datasetCode, 'sales.summary');
    assert.equal(result.queryApplied?.dataset, 'operational_sales');
  });

  it('maps posted ledger only from a valid periodKey and rejects silent filter conversion', async () => {
    const calls: any[] = [];
    const tool = new ReportsMonthlySummaryTool({ execute: async (_ctx: any, _companyId: string, input: any) => {
      calls.push(input); return ready(input.datasetCode, input.filters);
    } } as any);
    const invalid = await tool.execute(ctx, { dataset: 'posted_ledger', fromDate: '2026-02-01', toDate: '2026-02-28' });
    assert.equal(invalid.errorCode, 'UNSUPPORTED_FILTER');
    const valid = await tool.execute(ctx, { dataset: 'posted_ledger', periodKey: '2026-02' });
    assert.equal(valid.status, 'ok');
    assert.deepEqual(calls[0], { datasetCode: 'financial.profit_and_loss', filters: { periodKey: '2026-02' }, chartKind: 'table', page: 1, pageSize: 20 });
  });

  it('preserves exact money units and source time and never invents a missing ledger currency', async () => {
    const tool = new ReportsMonthlySummaryTool({ execute: async () => ({ ...ready('financial.profit_and_loss', {}),
      columns: [{ key: 'total', type: 'money' }], rows: [{ section: 'Revenue', total: '90071992547409.93' }], total: 1,
      totals: { revenue: '90071992547409.93', grossProfit: '2.00', netProfit: '1.00' },
    }) } as any);
    const result = await tool.execute(ctx, { dataset: 'posted_ledger', periodKey: '2026-09' });
    assert.equal(result.facts?.find(row => row.metric === 'revenue')?.value, '90071992547409.93');
    assert.equal(result.facts?.every(row => row.unit === 'money' && row.currency === null), true);
    assert.equal(result.asOf, '2026-09-27T00:00:00Z');
    assert.ok((result.data as any).warnings.includes('source_currency_unavailable'));
    assert.equal(result.facts?.find(row => row.metric === 'Revenue.total')?.value, '90071992547409.93');
  });

  it('rejects impossible and partial civil dates before querying', async () => {
    let calls = 0;
    const tool = new ReportsMonthlySummaryTool({ execute: async () => { calls += 1; return ready('', {}); } } as any);
    assert.equal((await tool.execute(ctx, { dataset: 'operational_sales', fromDate: '2026-02-29', toDate: '2026-03-01' })).errorCode, 'INVALID_PERIOD');
    assert.equal((await tool.execute(ctx, { dataset: 'operational_sales', fromDate: '2026-02-01' })).errorCode, 'INCOMPLETE_RANGE');
    assert.equal((await tool.execute(ctx, { dataset: 'operational_sales', fromDate: '2026-03-01', toDate: '2026-02-28' })).errorCode, 'INVALID_PERIOD');
    assert.equal(calls, 0);
  });
});
